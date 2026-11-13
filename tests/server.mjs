/** Static server for the artifact build, emulating the published page skeleton. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'artifact2');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.css': 'text/css' };

export function serve(port = 4312) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(''); }
    if (p === '/index.html') {
      // The publisher wraps the page in this skeleton; mirror it so tests see
      // the same box model and defaults the live artifact does.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><html><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        + '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui;background:#fafaf9}'
        + 'img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
        + fs.readFileSync(f, 'utf8') + '</body></html>');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
