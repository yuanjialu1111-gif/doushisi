import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../client/public');
const port = Number(process.env.CLIENT_PORT || 4102);
const api = new URL(process.env.API_BASE || 'http://127.0.0.1:3000');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.atlas': 'text/plain', '.bin': 'application/octet-stream' };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) throw new Error('Not found');
    const localHostname = new URL('http://' + request.headers.host).hostname;
    const apiOrigin = `${api.protocol}//${localHostname}:${api.port || '3000'}`;
    const wsOrigin = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${localHostname}:${api.port || '3000'}`;
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${apiOrigin}; media-src 'self' blob:; connect-src 'self' ${apiOrigin} ${wsOrigin}; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`);
    response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Original Cocos client: http://localhost:${port}`));
