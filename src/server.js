import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const SERVER_SECRET = process.env.SERVER_SECRET || "change-me";

// username -> { ws, user, connectedAt }
const clients = new Map();

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanUser(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_\-\.]/g, "")
    .slice(0, 24);
}

function cleanMessage(value) {
  return String(value || "").trim().slice(0, 500);
}

function send(ws, packet) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(packet));
  }
}

function broadcast(packet, exceptUser = null) {
  for (const [user, client] of clients.entries()) {
    if (user !== exceptUser) send(client.ws, packet);
  }
}

function disconnectUser(user, reason = "disconnected") {
  if (!user || !clients.has(user)) return;
  const client = clients.get(user);
  clients.delete(user);
  send(client.ws, { type: "disconnected", reason });
  broadcast({ type: "system", message: `${user} left IRC`, user });
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
<head><title>MC Custom IRC</title></head>
<body style="font-family: sans-serif; max-width: 760px; margin: 40px auto; line-height: 1.45">
  <h1>MC Custom IRC server is online</h1>
  <p>Connected users: <b>${clients.size}</b></p>
  <p>WebSocket endpoint: <code>wss://${req.headers.host}/irc</code></p>
  <h2>Packets</h2>
  <pre>{"type":"connect","user":"Steve","secret":"optional-secret"}
{"type":"say","message":"hello"}
{"type":"dm","to":"Alex","message":"secret"}
{"type":"disconnect"}</pre>
</body>
</html>`);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

const wss = new WebSocketServer({ server, path: "/irc" });

wss.on("connection", (ws) => {
  ws.ircUser = null;
  send(ws, {
    type: "hello",
    message: "Send {type:'connect', user:'YourName'} to join."
  });

  ws.on("message", (raw) => {
    const packet = safeJsonParse(raw.toString());
    if (!packet || typeof packet !== "object") {
      return send(ws, { type: "error", error: "invalid_json" });
    }

    const type = String(packet.type || "").toLowerCase();

    if (type === "connect") {
      // If SERVER_SECRET is not change-me, clients must send matching secret.
      if (SERVER_SECRET !== "change-me" && packet.secret !== SERVER_SECRET) {
        return send(ws, { type: "error", error: "bad_secret" });
      }

      const user = cleanUser(packet.user);
      if (!user) return send(ws, { type: "error", error: "bad_username" });

      const old = clients.get(user);
      if (old && old.ws !== ws) {
        send(old.ws, { type: "disconnected", reason: "same_user_reconnected" });
        old.ws.close();
      }

      ws.ircUser = user;
      clients.set(user, { ws, user, connectedAt: Date.now() });
      send(ws, { type: "connected", user, users: [...clients.keys()] });
      broadcast({ type: "system", message: `${user} joined IRC`, user }, user);
      return;
    }

    if (!ws.ircUser || !clients.has(ws.ircUser)) {
      return send(ws, { type: "error", error: "not_connected" });
    }

    if (type === "disconnect") {
      disconnectUser(ws.ircUser, "client_disconnect");
      ws.close();
      return;
    }

    if (type === "say") {
      const message = cleanMessage(packet.message);
      if (!message) return send(ws, { type: "error", error: "empty_message" });
      const out = { type: "say", from: ws.ircUser, message, time: Date.now() };
      broadcast(out);
      return;
    }

    if (type === "dm") {
      const to = cleanUser(packet.to);
      const message = cleanMessage(packet.message);
      if (!to || !message) return send(ws, { type: "error", error: "bad_dm" });

      const target = clients.get(to);
      if (!target) return send(ws, { type: "error", error: "user_offline", to });

      const out = { type: "dm", from: ws.ircUser, to, message, time: Date.now() };
      send(target.ws, out);
      send(ws, { ...out, sent: true });
      return;
    }

    if (type === "users") {
      return send(ws, { type: "users", users: [...clients.keys()] });
    }

    send(ws, { type: "error", error: "unknown_type", received: type });
  });

  ws.on("close", () => {
    if (ws.ircUser && clients.get(ws.ircUser)?.ws === ws) {
      disconnectUser(ws.ircUser, "socket_closed");
    }
  });
});

server.listen(PORT, () => {
  console.log(`MC Custom IRC listening on ${PORT}`);
});
