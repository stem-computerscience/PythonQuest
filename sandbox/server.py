from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import subprocess

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/execute":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length < 1 or length > 16000:
            self.send_error(413)
            return
        payload = self.rfile.read(length)
        try:
            result = subprocess.run(["python", "-I", "/app/runner.py"], input=payload, capture_output=True, timeout=5, check=False)
            response = json.loads(result.stdout.decode()[:8000])
        except subprocess.TimeoutExpired:
            response = {"ok": False, "error": "Execution exceeded five seconds"}
        except Exception:
            response = {"ok": False, "error": "Execution service error"}
        body = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
