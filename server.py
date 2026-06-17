#!/usr/bin/env python3
"""Tiny static file server for the 3D Solar System.

Windows' Python reads MIME types from the registry, where ".js" is often
"text/plain" — which makes browsers refuse to run ES modules. This server
forces correct JavaScript / CSS MIME types so the app loads anywhere.

Usage:  python server.py [port]   (default port 8000)
Then open the printed URL in your browser.
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        p = str(path).lower()
        if p.endswith(".js") or p.endswith(".mjs"):
            return "text/javascript"
        if p.endswith(".css"):
            return "text/css"
        if p.endswith(".json"):
            return "application/json"
        return super().guess_type(path)

    def end_headers(self):
        # Avoid stale caching while developing.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"Solar System running at  http://127.0.0.1:{PORT}/")
    httpd.serve_forever()
