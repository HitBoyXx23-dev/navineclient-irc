import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;

const RAW_SECRET = process.env.SERVER_SECRET || "";
const SECRET_REQUIRED = RAW_SECRET !== "" && RAW_SECRET !== "change-me";

const HEARTBEAT_INTERVAL_MS = 25000;
const MAX_USERS = 200;

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

function userList() {
  return [...clients.keys()];
}

function send(ws, packet) {
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(packet));
    } catch {
      // ignore send failures on a dying socket
    }
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
  broadcast({ type: "leave", user, reason });
  broadcast({ type: "system", message: `${user} left IRC`, user });
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
<head><title>Navine Client IRC</title></head>
<body style="font-family: sans-serif; max-width: 760px; margin: 40px auto; line-height: 1.45">
  <h1>Navine Client IRC server is online</h1>
  <p>Connected users: <b>${clients.size}</b></p>
  <p>Auth required: <b>${SECRET_REQUIRED ? "yes" : "no"}</b></p>
  <p>WebSocket endpoint: <code>wss://${req.headers.host}/irc</code></p>
  <h2>Inbound packets</h2>
  <pre>{"type":"connect","user":"Steve","secret":"only-if-required"}
{"type":"say","message":"hello"}
{"type":"dm","to":"Alex","message":"secret"}
{"type":"users"}
{"type":"ping"}
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
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("error", () => {
    // swallow socket errors so the process never crashes
  });

  send(ws, {
    type: "hello",
    message: "Send {type:'connect', user:'YourName'} to join.",
    authRequired: SECRET_REQUIRED
  });

  ws.on("message", (raw) => {
    const packet = safeJsonParse(raw.toString());
    if (!packet || typeof packet !== "object") {
      return send(ws, { type: "error", error: "invalid_json" });
    }

    const type = String(packet.type || "").toLowerCase();

    if (type === "ping") {
      ws.isAlive = true;
      return send(ws, { type: "pong", time: Date.now() });
    }

    if (type === "connect") {
      if (SECRET_REQUIRED && packet.secret !== RAW_SECRET) {
        return send(ws, { type: "error", error: "bad_secret" });
      }

      const user = cleanUser(packet.user);
      if (!user) return send(ws, { type: "error", error: "bad_username" });

      const old = clients.get(user);
      if (!old && clients.size >= MAX_USERS) {
        return send(ws, { type: "error", error: "server_full" });
      }
      if (old && old.ws !== ws) {
        send(old.ws, { type: "disconnected", reason: "same_user_reconnected" });
        try {
          old.ws.close();
        } catch {
          // ignore
        }
      }

      ws.ircUser = user;
      clients.set(user, { ws, user, connectedAt: Date.now() });
      send(ws, { type: "connected", user, users: userList() });
      broadcast({ type: "join", user }, user);
      broadcast({ type: "system", message: `${user} joined IRC`, user }, user);
      return;
    }

    if (!ws.ircUser || !clients.has(ws.ircUser)) {
      return send(ws, { type: "error", error: "not_connected" });
    }

    if (type === "disconnect") {
      disconnectUser(ws.ircUser, "client_disconnect");
      ws.ircUser = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
      return;
    }

    if (type === "say") {
      const message = cleanMessage(packet.message);
      if (!message) return send(ws, { type: "error", error: "empty_message" });
      broadcast({ type: "say", from: ws.ircUser, message, time: Date.now() });
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
      return send(ws, { type: "users", users: userList() });
    }

    send(ws, { type: "error", error: "unknown_type", received: type });
  });

  ws.on("close", () => {
    if (ws.ircUser && clients.get(ws.ircUser)?.ws === ws) {
      disconnectUser(ws.ircUser, "socket_closed");
    }
  });
});

const heartbeat = setInterval(() => {
  for (const client of clients.values()) {
    const ws = client.ws;
    if (ws.isAlive === false) {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      // ignore
    }
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Navine Client IRC listening on ${PORT} (auth ${SECRET_REQUIRED ? "on" : "off"})`);
});
