import json
import os
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

import config
import database
from services import scheduler_service
from routes.sync import handle_sync_route
from routes.posts import handle_posts_route
from routes.accounts import handle_accounts_route
from routes.settings import handle_settings_route

_admin_html_cache = None
_admin_html_mtime = 0

# Attempt to load FastAPI if available for OpenAPI / Swagger UI support
HAS_FASTAPI = False
try:
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    import uvicorn
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

if HAS_FASTAPI:
    app = FastAPI(
        title="fbAUTO Python Backend",
        description="Standalone Facebook Auto-Posting & Scheduling Engine in Python",
        version="1.0.0"
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def startup_event():
        scheduler_service.start_scheduler(15)

    @app.on_event("shutdown")
    def shutdown_event():
        scheduler_service.stop_scheduler()

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    async def catch_all(request: Request, path: str):
        if request.method == "OPTIONS":
            return JSONResponse(status_code=204, content={})
        
        full_path = "/" + path.lstrip("/")
        query = dict(request.query_params)
        body = {}
        if request.method in ["POST", "PUT", "PATCH"]:
            try:
                body = await request.json()
            except Exception:
                body = {}

        if full_path.startswith("/sync/"):
            status, res_data = handle_sync_route(full_path, request.method, body)
            return JSONResponse(status_code=status, content=res_data)

        if full_path.startswith("/api/posts"):
            status, res_data = handle_posts_route(full_path, request.method, body, query)
            return JSONResponse(status_code=status, content=res_data)


        if full_path.startswith("/api/accounts"):
            status, res_data = handle_accounts_route(full_path, request.method, body)
            return JSONResponse(status_code=status, content=res_data)

        if full_path == "/api/logs":
            all_logs = database.get_collection("logs")
            logs = all_logs[-100:][::-1]
            return JSONResponse(status_code=200, content={"logs": logs, "total": len(all_logs)})

        if full_path in ["/", "", "/admin", "/admin/"]:
            try:
                global _admin_html_cache, _admin_html_mtime
                admin_path = os.path.join(config.BASE_DIR, "admin.html")
                mtime = os.path.getmtime(admin_path)
                if _admin_html_cache is None or mtime > _admin_html_mtime:
                    with open(admin_path, "r", encoding="utf-8") as f:
                        _admin_html_cache = f.read()
                    _admin_html_mtime = mtime
                from fastapi.responses import HTMLResponse
                return HTMLResponse(
                    content=_admin_html_cache,
                    status_code=200,
                    headers={
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                        "Pragma": "no-cache",
                        "Expires": "0"
                    }
                )
            except Exception as e:
                return JSONResponse(status_code=500, content={"error": str(e)})

        if full_path == "/health":
            return JSONResponse(status_code=200, content={"status": "healthy", "engine": "FastAPI"})

        return JSONResponse(status_code=404, content={"error": "Endpoint not found"})

class FallbackHTTPHandler(BaseHTTPRequestHandler):
    def _send_response(self, code, content):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
        self.wfile.write(json.dumps(content, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    def do_PATCH(self):
        self._route("PATCH")

    def do_DELETE(self):
        self._route("DELETE")

    def _route(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        query_single = {k: v[0] for k, v in query.items()} if query else {}

        body = {}
        if method in ["POST", "PUT", "PATCH"]:
            length = int(self.headers.get("Content-Length", 0))
            if length > 0:
                raw_body = self.rfile.read(length).decode("utf-8")
                try:
                    body = json.loads(raw_body)
                except Exception:
                    body = {"raw": raw_body}

        if path in ["/", "", "/admin", "/admin/"]:
            try:
                global _admin_html_cache, _admin_html_mtime
                admin_path = os.path.join(config.BASE_DIR, "admin.html")
                mtime = os.path.getmtime(admin_path)
                if _admin_html_cache is None or mtime > _admin_html_mtime:
                    with open(admin_path, "r", encoding="utf-8") as f:
                        _admin_html_cache = f.read()
                    _admin_html_mtime = mtime
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(_admin_html_cache.encode("utf-8"))
                return
            except Exception as e:
                self._send_response(500, {"error": str(e)})
                return

        if path == "/health":
            self._send_response(200, {"status": "healthy", "engine": "Standard HTTP"})
            return

        if path.startswith("/sync/"):
            code, res = handle_sync_route(path, method, body)
            self._send_response(code, res)
            return

        if path.startswith("/api/posts"):
            code, res = handle_posts_route(path, method, body, query_single)
            self._send_response(code, res)
            return


        if path.startswith("/api/accounts"):
            code, res = handle_accounts_route(path, method, body)
            self._send_response(code, res)
            return

        if path.startswith("/api/settings"):
            code, res = handle_settings_route(path, method, body)
            self._send_response(code, res)
            return

        if path == "/api/logs":
            all_logs = database.get_collection("logs")
            logs = all_logs[-100:][::-1]
            self._send_response(200, {"logs": logs, "total": len(all_logs)})
            return

        self._send_response(404, {"error": "Endpoint not found"})

class ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True
    allow_reuse_port = True

def run_server():
    print("====================================================")
    print(f"🚀 Starting Standard Python Engine on http://{config.HOST}:{config.PORT}")
    print("====================================================")
    scheduler_service.start_scheduler(15)
    server = ReusableHTTPServer((config.HOST, config.PORT), FallbackHTTPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        scheduler_service.stop_scheduler()

if __name__ == "__main__":
    run_server()
