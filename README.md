# Minecraft IRC Server

Minimal IRC server for clients/plugins that send IRC commands like `NICK`, `USER`, `JOIN`, `PING`, and `PRIVMSG`.

## Local run

```bash
npm install
npm start
```

Test locally:

```bash
nc localhost 6667
NICK Steve
USER Steve 0 * :Steve
JOIN #minecraft
PRIVMSG #minecraft :hello from minecraft
```

## Render note

Render public Web Services are HTTP-facing. A raw public IRC TCP port is not exposed as a normal public IRC endpoint. This repo includes an HTTP health server on port 10000 so the service can start, but a Minecraft server outside Render usually cannot connect to the raw IRC port on Render Web Services.

For a real public `.irc` Minecraft command, deploy this same repo on a host that exposes raw TCP ports, such as a VPS, Fly.io TCP service, Railway TCP proxy, or a paid Render Private Service only if the Minecraft server is also inside the same Render private network.

## Minecraft plugin settings

Use these values if your host exposes port 6667:

- IRC host: your server domain/IP
- IRC port: 6667
- Channel: #minecraft
- TLS/SSL: off
- Password: blank
