#!/usr/bin/env python3
"""Serve the Ruffle harness, and accept screen captures back from it.

Some RCU screens — the Select Total views, the access-level dialogs — are
composed at runtime and are not bitmaps inside the movie, so the only way to get
artwork for them is to photograph the running program. The browser cannot write
files, so the page POSTs a PNG here and this writes it.

    python3 tools/original/serve.py [port] [outdir]

POST /save?name=<slug>  with a data: URL as the body -> outdir/<slug>.png
"""
import base64
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

OUTDIR = os.environ.get('CAPTURE_DIR', 'captures')
SAFE = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if not self.path.startswith('/save'):
            self.send_error(404)
            return
        name = ''
        if '?' in self.path:
            for part in self.path.split('?', 1)[1].split('&'):
                if part.startswith('name='):
                    name = part[5:]
        # The name becomes a filename, so it is checked rather than trusted.
        if not SAFE.match(name):
            self.send_error(400, 'bad name')
            return
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('latin-1')
        b64 = body.split(',', 1)[1] if ',' in body else body
        os.makedirs(OUTDIR, exist_ok=True)
        path = os.path.join(OUTDIR, name + '.png')
        with open(path, 'wb') as fh:
            fh.write(base64.b64decode(b64))
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(f'{path} {os.path.getsize(path)}'.encode())

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    if len(sys.argv) > 2:
        OUTDIR = sys.argv[2]
    print(f'serving {os.getcwd()} on :{port}, captures -> {OUTDIR}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
