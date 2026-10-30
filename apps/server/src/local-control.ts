import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, unlink, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicLocalJson, type LocalBackups } from './local-backups.js';

export async function startLocalControl(input: { stateFile: string; token: string; port: number; apiBase: string; backups: LocalBackups; close(): Promise<void> }) {
  const expected = Buffer.from('Bearer ' + input.token);
  const control = createServer((request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    response.setHeader('content-type', 'application/json');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(403); response.end('{"error":"FORBIDDEN"}'); return;
    }
    if (request.method === 'GET' && request.url === '/status') {
      response.end(JSON.stringify({ pid: process.pid, apiBase: input.apiBase, status: 'ok' })); return;
    }
    if (request.method === 'POST' && request.url === '/stop') {
      response.end('{"stopping":true}');
      setImmediate(() => { void input.close(); }); return;
    }
    if (request.method === 'POST' && request.url === '/backup') {
      void input.backups.save().then(result => response.end(JSON.stringify(result)), () => {
        response.writeHead(500); response.end('{"error":"LOCAL_BACKUP_FAILED"}');
      }); return;
    }
    response.writeHead(404); response.end('{"error":"NOT_FOUND"}');
  });
  await new Promise<void>((accept, reject) => { control.once('error', reject); control.listen(input.port, '127.0.0.1', accept); });
  await mkdir(dirname(input.stateFile), { recursive: true });
  await atomicLocalJson(input.stateFile, { pid: process.pid, controlPort: input.port, token: input.token, apiBase: input.apiBase });
  return async () => {
    await new Promise<void>(accept => control.close(() => accept()));
    const state = JSON.parse(await readFile(input.stateFile, 'utf8'));
    if (state.token === input.token) await unlink(input.stateFile);
  };
}
