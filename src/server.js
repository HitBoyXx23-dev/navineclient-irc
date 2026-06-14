import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL_MS = 25000;
const MAX_USERS = 200;

const OWNER_USERS = new Set(["hitboyxx23", "zach"]);
const VALID_TAGS = new Set(["[Navine Owner]", "[Navine Dev]", "[Navine]"]);

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

function cleanTag(value) {
  const tag = String(value || "").trim();
  if (VALID_TAGS.has(tag)) {
    return tag;
  }
  return "";
}

function resolveTag(user, requestedTag) {
  const cleaned = cleanTag(requestedTag);
  if (cleaned) {
    return cleaned;
  }
  const lower = user.toLowerCase();
  if (OWNER_USERS.has(lower)) {
    return "[Navine Owner]";
  }
  return "[Navine]";
}

function userList() {
  return [...clients.keys()];
}

function send(ws, packet) {
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(packet));
    } catch {
    }
  }
}

function broadcast(packet, exceptUser = null) {
  for (const [user, client] of clients.entries()) {
    if (user !== exceptUser) {
      send(client.ws, packet);
    }
  }
}

function disconnectUser(user, reason = "disconnected") {
  if (!user || !clients.has(user)) {
    return;
  }
  const client = clients.get(user);
  clients.delete(user);
  send(client.ws, { type: "disconnected", reason });
  broadcast({ type: "leave", user, reason });
  broadcast({ type: "system", message: `${user} left IRC`, user });
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";

  if (url === "/" || url === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "navineclient-irc",
        users: clients.size,
        endpoint: "/irc",
      })
    );
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

const wss = new WebSocketServer({ server, path: "/irc" });

wss.on("connection", (ws) => {
  ws.ircUser = null;
  ws.ircTag = "";
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("error", () => {
  });

  send(ws, {
    type: "hello",
    message: "Send {type:'connect', user:'YourName', tag:'[Navine]'} to join.",
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
      const user = cleanUser(packet.user);
      if (!user) {
        return send(ws, { type: "error", error: "bad_username" });
      }

      const old = clients.get(user);
      if (!old && clients.size >= MAX_USERS) {
        return send(ws, { type: "error", error: "server_full" });
      }
      if (old && old.ws !== ws) {
        send(old.ws, { type: "disconnected", reason: "same_user_reconnected" });
        try {
          old.ws.close();
        } catch {
        }
      }

      const tag = resolveTag(user, packet.tag);
      ws.ircUser = user;
      ws.ircTag = tag;
      clients.set(user, { ws, user, tag, connectedAt: Date.now() });
      send(ws, { type: "connected", user, tag, users: userList() });
      broadcast({ type: "join", user, tag }, user);
      broadcast({ type: "system", message: `${user} joined IRC`, user }, user);
      return;
    }

    if (!ws.ircUser || !clients.has(ws.ircUser)) {
      return send(ws, { type: "error", error: "not_connected" });
    }

    const client = clients.get(ws.ircUser);

    if (type === "disconnect") {
      disconnectUser(ws.ircUser, "client_disconnect");
      ws.ircUser = null;
      ws.ircTag = "";
      try {
        ws.close();
      } catch {
      }
      return;
    }

    if (type === "say") {
      const message = cleanMessage(packet.message);
      if (!message) {
        return send(ws, { type: "error", error: "empty_message" });
      }
      broadcast({
        type: "say",
        from: ws.ircUser,
        message,
        tag: client.tag,
        time: Date.now(),
      });
      return;
    }

    if (type === "dm") {
      const to = cleanUser(packet.to);
      const message = cleanMessage(packet.message);
      if (!to || !message) {
        return send(ws, { type: "error", error: "bad_dm" });
      }

      const target = clients.get(to);
      if (!target) {
        return send(ws, { type: "error", error: "user_offline", to });
      }

      const out = {
        type: "dm",
        from: ws.ircUser,
        to,
        message,
        tag: client.tag,
        time: Date.now(),
      };
      send(target.ws, out);
      send(ws, { ...out, sent: true });
      return;
    }

    if (type === "owner_announce") {
      if (!OWNER_USERS.has(ws.ircUser.toLowerCase())) {
        return send(ws, { type: "error", error: "not_owner" });
      }
      const message = cleanMessage(packet.message);
      if (!message) {
        return send(ws, { type: "error", error: "empty_message" });
      }
      broadcast({
        type: "owner_announce",
        from: ws.ircUser,
        message,
        tag: client.tag,
        time: Date.now(),
      });
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
    const socket = client.ws;
    if (socket.isAlive === false) {
      try {
        socket.terminate();
      } catch {
      }
      continue;
    }
    socket.isAlive = false;
    try {
      socket.ping();
    } catch {
    }
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Navine Client IRC listening on ${PORT}`);
});
