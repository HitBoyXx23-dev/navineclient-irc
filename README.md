# Navine Client IRC (Render WebSocket backend)

A small WebSocket chat relay for Minecraft clients that use commands like:

```text
.irc connect
.irc disconnect
.irc say <message>
.irc dm <user> <message>
.irc users
```

This is **not** a raw TCP IRC daemon. It is an IRC-style WebSocket backend, the kind of server Render Web Services can host.

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render, create a **New Web Service** from that repo.
3. Use:

```text
Build Command: npm install
Start Command: npm start
```

4. Render provides a URL like `https://your-app.onrender.com`.

Your WebSocket endpoint is:

```text
wss://your-app.onrender.com/irc
```

## Authentication

Auth is **off by default**. The server only requires a secret when the `SERVER_SECRET`
environment variable is set to a real value (anything other than empty or `change-me`).

- Leave `SERVER_SECRET` unset → any client may connect (recommended for public chat).
- Set `SERVER_SECRET=mysecret` → every `connect` packet must include `"secret":"mysecret"`.

> Note: `render.yaml` no longer auto-generates a random secret. A random auto-generated
> secret would be unknown to clients and would silently reject every connection.

## Protocol

The client opens the WebSocket and exchanges JSON packets.

### Inbound (client to server)

| Packet | Fields |
| --- | --- |
| `connect` | `user` (required), `secret` (only if auth enabled) |
| `say` | `message` |
| `dm` | `to`, `message` |
| `users` | none |
| `ping` | none |
| `disconnect` | none |

### Outbound (server to client)

| Packet | Meaning | Fields |
| --- | --- | --- |
| `hello` | sent on socket open | `message`, `authRequired` |
| `connected` | your `connect` succeeded | `user`, `users[]` |
| `say` | public chat message | `from`, `message`, `time` |
| `dm` | direct message (sender copy has `sent:true`) | `from`, `to`, `message`, `time` |
| `join` | another user joined | `user` |
| `leave` | another user left | `user`, `reason` |
| `system` | human-readable status line | `message`, `user` |
| `users` | online user list | `users[]` |
| `pong` | heartbeat reply | `time` |
| `error` | request failed | `error` (code) |
| `disconnected` | this socket is being closed | `reason` |

Error codes: `invalid_json`, `bad_secret`, `bad_username`, `server_full`,
`not_connected`, `empty_message`, `bad_dm`, `user_offline`, `unknown_type`.

### Examples

Connect:

```json
{"type":"connect","user":"Steve"}
```

```json
{"type":"connected","user":"Steve","users":["Steve"]}
```

Public message:

```json
{"type":"say","message":"hello"}
```

Everyone (including the sender) receives:

```json
{"type":"say","from":"Steve","message":"hello","time":1710000000000}
```

Direct message:

```json
{"type":"dm","to":"Alex","message":"hi"}
```

Target receives:

```json
{"type":"dm","from":"Steve","to":"Alex","message":"hi","time":1710000000000}
```

## Heartbeat

The server pings every client every 25 seconds and terminates sockets that miss a
pong. This keeps connections alive through Render's idle proxy timeout. Clients may
also send `{"type":"ping"}` and will receive `{"type":"pong"}`.

## Local testing

```bash
npm install
npm start
```

Connect to `ws://localhost:3000/irc`.

### Browser console test

```js
const ws = new WebSocket("ws://localhost:3000/irc");
ws.onmessage = e => console.log(JSON.parse(e.data));
ws.onopen = () => ws.send(JSON.stringify({ type: "connect", user: "Steve" }));
ws.send(JSON.stringify({ type: "say", message: "hello" }));
ws.send(JSON.stringify({ type: "dm", to: "Alex", message: "hi" }));
ws.send(JSON.stringify({ type: "disconnect" }));
```
