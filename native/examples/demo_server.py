#!/usr/bin/env python3
"""Local-only, in-memory customer API fixture. Never use as a production server.

Run from any directory: python3 native/examples/demo_server.py
POST /demo/reply with {"text":"..."} to simulate replies while the apps are closed.
"""
import json
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

LOCK = threading.RLock()
SESSIONS = {}
THREADS = {}
MESSAGES = {}
READS = {}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def reply(thread_id, text):
    MESSAGES[thread_id].append({"id": "message_" + uuid.uuid4().hex, "threadId": thread_id,
        "direction": "operator_to_customer", "text": text, "language": "en", "acceptedAt": now(), "state": "available"})
    THREADS[thread_id]["thread"]["updatedAt"] = now()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def respond(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def handle_request(self):
        with LOCK:
            try:
                parsed = urlparse(self.path)
                path = parsed.path
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or "{}")
                if path == "/demo/reply" and self.command == "POST":
                    for thread_id in THREADS:
                        reply(thread_id, body.get("text", "A new reply arrived while you were away."))
                    return self.respond({"ok": True})
                if not self.headers.get("Origin"):
                    return self.respond({"error": {"code": "forbidden", "message": "Origin required", "retryable": False}}, 403)
                if path == "/v1/client/sessions":
                    visitor = body["installationId"]
                    token = "demo_token_" + visitor
                    SESSIONS[token] = visitor
                    return self.respond({"session": {"id": "session_demo", "token": token, "visitorId": visitor, "expiresAt": "2099-01-01T00:00:00.000Z"}})
                token = self.headers.get("Authorization", "").removeprefix("Bearer ")
                visitor = SESSIONS.get(token)
                if visitor is None:
                    return self.respond({"error": {"code": "unauthorized", "message": "Session required", "retryable": False}}, 401)
                if path == "/v1/client/logout":
                    SESSIONS.pop(token, None)
                    return self.respond({"ok": True})
                if path == "/v1/thread-statuses":
                    statuses = []
                    for thread_id, value in THREADS.items():
                        if value["visitor"] == visitor:
                            latest = max((index + 1 for index, message in enumerate(MESSAGES[thread_id]) if message["direction"] == "operator_to_customer"), default=0)
                            statuses.append({"thread": value["thread"], "latestReplyCursor": str(latest)})
                    return self.respond({"threads": statuses})
                if path == "/v1/threads" and self.command == "POST":
                    existing = next((v for v in THREADS.values() if v["visitor"] == visitor and v["thread"]["clientThreadId"] == body["clientThreadId"]), None)
                    if existing:
                        return self.respond({"thread": existing["thread"]})
                    thread_id = "thread_" + uuid.uuid4().hex
                    thread = {"id": thread_id, "clientThreadId": body["clientThreadId"], "state": "open", "createdAt": now(), "updatedAt": now()}
                    THREADS[thread_id] = {"visitor": visitor, "thread": thread}
                    MESSAGES[thread_id] = []
                    return self.respond({"thread": thread}, 201)
                parts = path.split("/")
                thread_id = parts[3] if len(parts) > 3 else ""
                if thread_id not in THREADS or THREADS[thread_id]["visitor"] != visitor:
                    return self.respond({"error": {"code": "not_found", "message": "Conversation not found", "retryable": False}}, 404)
                if parts[-1] == "read":
                    READS[(visitor, thread_id)] = body["cursor"]
                    return self.respond({"ok": True})
                if parts[-1] == "messages":
                    if self.command == "GET":
                        start = int(parse_qs(parsed.query).get("after", ["0"])[0])
                        return self.respond({"threadId": thread_id, "messages": MESSAGES[thread_id][start:], "nextCursor": str(len(MESSAGES[thread_id])), "hasMore": False})
                    existing = next((m for m in MESSAGES[thread_id] if m.get("clientMessageId") == body["clientMessageId"]), None)
                    if existing and existing["text"] != body["text"]:
                        return self.respond({"error": {"code": "conflict", "message": "Immutable message differs", "retryable": False}}, 409)
                    message = existing or {"id": "message_" + uuid.uuid4().hex, "threadId": thread_id, "clientMessageId": body["clientMessageId"],
                        "direction": "customer_to_operator", "text": body["text"], "acceptedAt": now(), "state": "available"}
                    if existing is None:
                        MESSAGES[thread_id].append(message)
                        reply(thread_id, "Thanks! This is a local demo reply.")
                    return self.respond({"acceptance": {"messageId": message["id"], "clientMessageId": body["clientMessageId"], "status": "available", "message": message}})
                self.respond({"error": {"code": "not_found", "message": "Unknown endpoint", "retryable": False}}, 404)
            except (ValueError, KeyError) as error:
                self.respond({"error": {"code": "invalid_request", "message": str(error), "retryable": False}}, 400)


if __name__ == "__main__":
    print("RespondKit local fixture listening at http://127.0.0.1:8789", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8789), Handler).serve_forever()
