# Navine Client IRC Server

Python WebSocket IRC relay for the Navine Minecraft client.

**Production endpoint:** `wss://navineclient-irc.onrender.com/irc`

**Health check:** `GET https://navineclient-irc.onrender.com/health`

## Deploy on Render

1. Connect this repository to Render.
2. Use the included `render.yaml` (Python 3).
3. Start command: `python server.py`

## Protocol v2

All messages are JSON over WebSocket.

### Client to server

| type | fields | description |
|------|--------|-------------|
| `connect` | `user`, `rank_user`, `tag` | Join IRC; `user` is MC display name, `rank_user` is login username for permissions |
| `say` | `message` | Broadcast chat message |
| `dm` | `to`, `message` | Direct message to online user |
| `owner_announce` | `message` | Owner-only broadcast (checked against `rank_user`) |
| `get_logs` | | Request chat history buffer |
| `disconnect` | | Leave IRC |
| `ping` | | Keepalive; server replies with `pong` |

**Connect example**

```json
{"type":"connect","user":"XxVoidReaper","rank_user":"hitboyxx23","tag":"[Navine Owner]"}
```

### Server to client

| type | fields | description |
|------|--------|-------------|
| `hello` | `message` | Sent on WebSocket open |
| `connected` | `user`, `tag` | Join acknowledged |
| `logs` | `entries` | Chat history array |
| `say` | `from`, `message`, `tag`, `time` | Public chat |
| `dm` | `from`, `message`, `tag`, `time` | Direct message |
| `owner_announce` | `from`, `message`, `time` | Owner broadcast |
| `join` | `user` | User joined |
| `leave` | `user` | User left |
| `error` | `message` | Error text |
| `pong` | `time` | Reply to ping |

### Owner permissions

`owner_announce` checks `rank_user` (login username) against `OWNER_USERS` in `server.py`, not the MC display name.
