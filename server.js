'use strict';

const net = require('net');
const http = require('http');

const IRC_PORT = Number(process.env.IRC_PORT || process.env.PORT || 6667);
const HTTP_PORT = Number(process.env.HTTP_PORT || 10000);
const HOST = '0.0.0.0';
const SERVER_NAME = process.env.SERVER_NAME || 'mc-irc.local';
const DEFAULT_CHANNEL = process.env.DEFAULT_CHANNEL || '#minecraft';
const MOTD = process.env.MOTD || 'Minecraft IRC bridge is online.';

const clients = new Set();
const channels = new Map();

function safeNick(nick) {
  return (nick || 'guest').replace(/[^A-Za-z0-9_\-\[\]{}^`|]/g, '').slice(0, 24) || 'guest';
}

function send(client, line) {
  client.socket.write(line + '\r\n');
}

function prefix(client) {
  return `${client.nick}!${client.user || client.nick}@minecraft`;
}

function joinChannel(client, channel) {
  if (!channel.startsWith('#')) channel = '#' + channel;
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(client);
  client.channels.add(channel);
  send(client, `:${prefix(client)} JOIN ${channel}`);
  const names = [...channels.get(channel)].map(c => c.nick).join(' ');
  send(client, `:${SERVER_NAME} 353 ${client.nick} = ${channel} :${names}`);
  send(client, `:${SERVER_NAME} 366 ${client.nick} ${channel} :End of /NAMES list.`);
  broadcast(channel, `:${SERVER_NAME} NOTICE ${channel} :${client.nick} joined ${channel}`, client);
}

function partAll(client) {
  for (const channel of client.channels) {
    const set = channels.get(channel);
    if (set) {
      set.delete(client);
      broadcast(channel, `:${prefix(client)} PART ${channel}`);
      if (set.size === 0) channels.delete(channel);
    }
  }
  client.channels.clear();
}

function broadcast(channel, line, except = null) {
  const set = channels.get(channel);
  if (!set) return;
  for (const c of set) {
    if (c !== except) send(c, line);
  }
}

function welcome(client) {
  if (client.registered || !client.nick || !client.user) return;
  client.registered = true;
  send(client, `:${SERVER_NAME} 001 ${client.nick} :Welcome to ${SERVER_NAME}, ${client.nick}`);
  send(client, `:${SERVER_NAME} 002 ${client.nick} :Your host is ${SERVER_NAME}`);
  send(client, `:${SERVER_NAME} 375 ${client.nick} :- ${SERVER_NAME} Message of the day -`);
  send(client, `:${SERVER_NAME} 372 ${client.nick} :- ${MOTD}`);
  send(client, `:${SERVER_NAME} 376 ${client.nick} :End of /MOTD command.`);
  joinChannel(client, DEFAULT_CHANNEL);
}

function handleLine(client, raw) {
  const line = raw.trim();
  if (!line) return;
  const [cmdRaw, ...rest] = line.split(' ');
  const cmd = cmdRaw.toUpperCase();

  if (cmd === 'NICK') {
    const old = client.nick;
    client.nick = safeNick(rest[0]);
    if (old && old !== client.nick) {
      for (const ch of client.channels) broadcast(ch, `:${old}!${client.user || old}@minecraft NICK :${client.nick}`);
    }
    welcome(client);
    return;
  }

  if (cmd === 'USER') {
    client.user = safeNick(rest[0] || client.nick || 'user');
    welcome(client);
    return;
  }

  if (cmd === 'PING') {
    send(client, `PONG ${rest.join(' ') || ':' + SERVER_NAME}`);
    return;
  }

  if (cmd === 'JOIN') {
    const channel = (rest[0] || DEFAULT_CHANNEL).split(',')[0];
    joinChannel(client, channel);
    return;
  }

  if (cmd === 'PART') {
    const channel = rest[0] || DEFAULT_CHANNEL;
    const set = channels.get(channel);
    if (set) set.delete(client);
    client.channels.delete(channel);
    broadcast(channel, `:${prefix(client)} PART ${channel}`);
    return;
  }

  if (cmd === 'PRIVMSG') {
    const target = rest[0] || DEFAULT_CHANNEL;
    const text = line.includes(' :') ? line.slice(line.indexOf(' :') + 2) : rest.slice(1).join(' ');
    if (target.startsWith('#')) broadcast(target, `:${prefix(client)} PRIVMSG ${target} :${text}`, client);
    else {
      for (const c of clients) if (c.nick === target) send(c, `:${prefix(client)} PRIVMSG ${target} :${text}`);
    }
    return;
  }

  if (cmd === 'QUIT') {
    client.socket.end(`:${SERVER_NAME} ERROR :Closing link\r\n`);
    return;
  }

  if (client.nick) send(client, `:${SERVER_NAME} 421 ${client.nick} ${cmd} :Unknown command`);
}

const ircServer = net.createServer(socket => {
  const client = { socket, nick: null, user: null, registered: false, channels: new Set(), buffer: '' };
  clients.add(client);
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    client.buffer += chunk;
    const lines = client.buffer.split(/\r?\n/);
    client.buffer = lines.pop();
    for (const line of lines) handleLine(client, line);
  });
  socket.on('close', () => { partAll(client); clients.delete(client); });
  socket.on('error', () => { partAll(client); clients.delete(client); });
});

ircServer.listen(IRC_PORT, HOST, () => console.log(`IRC server listening on ${HOST}:${IRC_PORT}`));

// Small HTTP health server for platforms that require HTTP checks.
if (HTTP_PORT !== IRC_PORT) {
  http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ircPort: IRC_PORT, clients: clients.size, channel: DEFAULT_CHANNEL }));
  }).listen(HTTP_PORT, HOST, () => console.log(`HTTP health listening on ${HOST}:${HTTP_PORT}`));
}
