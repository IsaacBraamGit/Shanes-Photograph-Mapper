#!/usr/bin/env python3
"""Photoshoot Scout - stdlib-only HTTP server.

Serves the static frontend and a tiny JSON API backed by data/locations.json.
No third-party dependencies. Run: python3 -S server.py  (then open http://localhost:8055)
"""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DATA = os.path.join(ROOT, "data", "locations.json")
PORT = 8055

_lock = threading.Lock()

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
}


def load_locations():
    with _lock:
        if not os.path.exists(DATA):
            return []
        with open(DATA, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return []


def save_locations(locs):
    with _lock:
        os.makedirs(os.path.dirname(DATA), exist_ok=True)
        with open(DATA, "w", encoding="utf-8") as f:
            json.dump(locs, f, indent=2, ensure_ascii=False)


class Handler(BaseHTTPRequestHandler):
    server_version = "PhotoshootScout/1.0"

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/locations":
            return self._send(200, load_locations())
        # static files
        if path == "/":
            path = "/index.html"
        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self._send(404, {"error": "not found"})
        ext = os.path.splitext(full)[1]
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/locations":
            return self._send(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            loc = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._send(400, {"error": "invalid json"})
        locs = load_locations()
        existing_ids = {l.get("id") for l in locs}
        new_id = loc.get("id") or f"user-{len(locs) + 1}"
        while new_id in existing_ids:
            new_id += "x"
        loc["id"] = new_id
        loc.setdefault("source", "user")
        locs.append(loc)
        save_locations(locs)
        return self._send(201, loc)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/locations/"):
            return self._send(404, {"error": "not found"})
        target = path.rsplit("/", 1)[-1]
        locs = load_locations()
        kept = [l for l in locs if l.get("id") != target]
        save_locations(kept)
        return self._send(200, {"deleted": target, "remaining": len(kept)})

    def log_message(self, fmt, *args):
        pass  # quiet


def main():
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Photoshoot Scout running at http://localhost:{PORT}")
    print(f"  {len(load_locations())} locations loaded from data/locations.json")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
