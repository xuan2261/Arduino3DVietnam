"""Local development server for Arduino 3D Viet (Python standard library only).

Windows installations can identify .js as text/plain. ES Modules require a
JavaScript MIME type, so we override MIME detection instead of requiring Node.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".webmanifest": "application/manifest+json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path: str) -> str:
        return TYPES.get(Path(path).suffix.lower(), super().guess_type(path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Chạy Arduino 3D Việt trên máy tính")
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--open", action="store_true", help="Open browser after server binds")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port phải nằm trong khoảng 1–65535")
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer((args.host, args.port), handler) as server:
        # ASCII output also works in Windows terminals configured as cp1252.
        print(f"Arduino 3D Viet: http://{args.host}:{args.port}/", flush=True)
        print("Ctrl+C to stop.", flush=True)
        if args.open:
            webbrowser.open(f"http://{args.host}:{args.port}/")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
