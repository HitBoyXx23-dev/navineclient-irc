# Navine Client IRC Server

WebSocket IRC relay for the Navine Minecraft client.

**Production endpoint:** `wss://navineclient-irc.onrender.com/irc`

**Health check:** `GET https://navineclient-irc.onrender.com/health`

## Deploy on Render

1. Connect this repository to Render.
2. Use the included `render.yaml` (Web Service, Node 18+).
3. Build command: `npm install`
4. Start command: `npm start`

## Protocol

All messages are JSON over WebSocket.

### Client to server

| type | fields | description |
|------|--------|-------------|
| `connect` | `user` (required), `tag` (optional) | Join IRC as a user |
| `say` | `message` | Broadcast chat message |
| `dm` | `to`, `message` | Direct message to online user |
| `owner_announce` | `message` | Owner-only broadcast |
| `disconnect` | | Leave IRC and close session |
| `ping` | | Optional keepalive; server replies with `pong` |

**Connect example**

```json
{"type":"connect","user":"Steve","tag":"[Navine]"}
```

**Say example**

```json
{"type":"say","message":"hello everyone"}
```

**DM example**

```json
{"type":"dm","to":"Alex","message":"secret"}
```

**Owner announce example**

```json
{"type":"owner_announce","message":"Server maintenance in 10 minutes"}
```

### Server to client

| type | fields | description |
|------|--------|-------------|
| `hello` | `message` | Sent immediately on connect |
| `connected` | `user`, `tag`, `users` | Join acknowledged |
| `say` | `from`, `message`, `tag`, `time` | Public chat message |
| `dm` | `from`, `to`, `message`, `tag`, `time` | Direct message |
| `owner_announce` | `from`, `message`, `tag`, `time` | Owner broadcast |
| `system` | `message`, `user` | Join/leave/system notices |
| `join` | `user`, `tag` | Another user joined |
| `leave` | `user`, `reason` | Another user left |
| `error` | `error` | Error code/message |
| `disconnected` | `reason` | Session ended |
| `pong` | `time` | Reply to client `ping` |

### User tags

Valid tags:

- `[Navine Owner]`
- `[Navine Dev]`
- `[Navine]`

The client may send a tag on `connect`. If omitted, owners receive `[Navine Owner]` and everyone else receives `[Navine]`.

### Owner users

Only these usernames may send `owner_announce`:

- `hitboyxx23`
- `zach`

Matching is case-insensitive.

## Local development

```bash
npm install
npm start
```

WebSocket: `ws://localhost:3000/irc`

Health: `http://localhost:3000/health`
