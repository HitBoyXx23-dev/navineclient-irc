import asyncio
import json
import os
from typing import Any

from aiohttp import web

clients: dict[int, dict[str, Any]] = {}
OWNER_USERS = {"hitboyxx23", "zach"}


async def health(_request: web.Request) -> web.Response:
    return web.json_response(
        {
            "ok": True,
            "service": "navineclient-irc",
            "users": len(clients),
            "endpoint": "/irc",
        }
    )


async def broadcast(message: dict[str, Any], exclude: web.WebSocketResponse | None = None) -> None:
    payload = json.dumps(message)
    dead: list[int] = []
    for key, info in list(clients.items()):
        ws = info.get("ws")
        if ws is None or ws.closed or ws is exclude:
            continue
        try:
            await ws.send_str(payload)
        except Exception:
            dead.append(key)
    for key in dead:
        clients.pop(key, None)


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=30.0)
    await ws.prepare(request)

    session: dict[str, Any] | None = None
    session_id: int | None = None

    await ws.send_str(json.dumps({"type": "hello", "message": "Welcome to Navine IRC"}))

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                await ws.send_str(json.dumps({"type": "error", "message": "Invalid JSON"}))
                continue

            msg_type = str(data.get("type", "")).lower()

            if msg_type == "connect":
                user = str(data.get("user", "Unknown")).strip() or "Unknown"
                tag = str(data.get("tag", "[Navine]")).strip() or "[Navine]"
                session = {"user": user, "tag": tag, "ws": ws}
                session_id = id(ws)
                clients[session_id] = session
                await ws.send_str(json.dumps({"type": "connected", "user": user}))
                await broadcast({"type": "join", "user": user}, exclude=ws)
                continue

            if session is None:
                await ws.send_str(json.dumps({"type": "error", "message": "Send connect first"}))
                continue

            if msg_type == "say":
                content = str(data.get("message", "")).strip()
                if not content:
                    continue
                await broadcast(
                    {
                        "type": "say",
                        "from": session["user"],
                        "message": content,
                        "tag": session.get("tag", "[Navine]"),
                    }
                )
                continue

            if msg_type == "dm":
                target = str(data.get("to", "")).strip()
                content = str(data.get("message", "")).strip()
                if not target or not content:
                    await ws.send_str(json.dumps({"type": "error", "message": "DM requires to and message"}))
                    continue
                payload = {
                    "type": "dm",
                    "from": session["user"],
                    "message": content,
                    "tag": session.get("tag", "[Navine]"),
                }
                delivered = False
                for info in clients.values():
                    if info.get("user", "").lower() == target.lower():
                        target_ws = info.get("ws")
                        if target_ws and not target_ws.closed:
                            await target_ws.send_str(json.dumps(payload))
                            delivered = True
                if not delivered:
                    await ws.send_str(json.dumps({"type": "error", "message": f"User {target} is not online"}))
                continue

            if msg_type == "owner_announce":
                sender = str(session.get("user", "")).lower()
                if sender not in OWNER_USERS:
                    await ws.send_str(json.dumps({"type": "error", "message": "Owner only"}))
                    continue
                content = str(data.get("message", "")).strip()
                if not content:
                    continue
                await broadcast(
                    {
                        "type": "owner_announce",
                        "from": session["user"],
                        "message": content,
                    }
                )
                continue

            if msg_type == "disconnect":
                break
    finally:
        if session is not None:
            user = session.get("user", "")
            if user:
                await broadcast({"type": "leave", "user": user}, exclude=ws)
            if session_id is not None:
                clients.pop(session_id, None)
        await ws.close()

    return ws


def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/irc", websocket_handler)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    web.run_app(create_app(), host="0.0.0.0", port=port)
