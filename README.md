# MC Custom IRC for Render

A small WebSocket chat backend for Minecraft clients that use commands like:

```text
.irc connect
.irc disconnect
.irc say <message>
.irc dm <user> <message>
```

This is **not** a raw TCP IRC daemon. It is an IRC-style WebSocket backend, which is the kind of server Render Web Services can host.

## Deploy to Render

1. Upload this folder to a GitHub repository.
2. In Render, create a **New Web Service** from that repo.
3. Use:

```text
Build Command: npm install
Start Command: npm start
```

4. Render will provide a URL like:

```text
https://your-app.onrender.com
```

Your WebSocket endpoint is:

```text
wss://your-app.onrender.com/irc
```

## Packet format

Your Minecraft command handler should connect to the WebSocket URL and send JSON packets.

### .irc connect

```json
{"type":"connect","user":"Steve","secret":"your-secret-if-enabled"}
```

Server response:

```json
{"type":"connected","user":"Steve","users":["Steve"]}
```

### .irc disconnect

```json
{"type":"disconnect"}
```

### .irc say hello

```json
{"type":"say","message":"hello"}
```

Other users receive:

```json
{"type":"say","from":"Steve","message":"hello","time":1710000000000}
```

### .irc dm Alex hi

```json
{"type":"dm","to":"Alex","message":"hi"}
```

Target user receives:

```json
{"type":"dm","from":"Steve","to":"Alex","message":"hi","time":1710000000000}
```

### Get online users

```json
{"type":"users"}
```

## Security

The server uses the `SERVER_SECRET` environment variable. If it is set to anything except `change-me`, clients must include the same secret in the `.irc connect` packet.

Render's `render.yaml` auto-generates `SERVER_SECRET`. You can also set it manually in Render's environment variables.

## Local testing

```bash
npm install
npm start
```

Then connect to:

```text
ws://localhost:3000/irc
```

## JavaScript browser test

Open your browser console and run:

```js
const ws = new WebSocket("wss://your-app.onrender.com/irc");
ws.onmessage = e => console.log(JSON.parse(e.data));
ws.onopen = () => ws.send(JSON.stringify({ type: "connect", user: "Steve", secret: "your-secret" }));

// public message
ws.send(JSON.stringify({ type: "say", message: "hello" }));

// private message
ws.send(JSON.stringify({ type: "dm", to: "Alex", message: "hi" }));

// disconnect
ws.send(JSON.stringify({ type: "disconnect" }));
```
