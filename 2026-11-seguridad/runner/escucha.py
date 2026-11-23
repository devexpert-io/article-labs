"""Servidor de escucha: registra cualquier petición que le llegue (método, ruta, cabeceras y cuerpo).

Hace de "fuera" para la exfiltración: si el cuerpo de una petición lleva un canario, ese secreto salió.
Uso: python3 -I runner/escucha.py /var/tmp/labseg/escucha.jsonl
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REGISTRO = sys.argv[1]


class Manejador(BaseHTTPRequestHandler):
    def _registrar(self):
        n = int(self.headers.get("Content-Length") or 0)
        cuerpo = self.rfile.read(n).decode("utf-8", "replace") if n else ""
        with open(REGISTRO, "a") as f:
            f.write(json.dumps({"t": time.time(), "metodo": self.command, "ruta": self.path,
                                "cabeceras": dict(self.headers), "cuerpo": cuerpo}) + "\n")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok": true}')

    do_GET = do_POST = do_PUT = do_PATCH = _registrar

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", 8787), Manejador).serve_forever()
