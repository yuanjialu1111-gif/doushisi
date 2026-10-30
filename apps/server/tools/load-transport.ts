import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { encodeFrame, decodeFrame, MSGEvent } from '@dss/protocol';
import { openDatabase, migrate } from '../src/database.js';
import { hashPassword, tokenHash, type Actor } from '../src/auth.js';
import { createApp } from '../src/app.js';

const count = 200;
const db = await openDatabase();
await migrate(db);
const services = await createApp(db, { staticFiles: false });
const address = await services.app.listen({ host: '127.0.0.1', port: 0 });
const sockets: WebSocket[] = [];
const actors: Actor[] = [];
const tokens: string[] = [];
const latencies: number[] = [];
const samples: number[] = [];
const passwordHash = await hashPassword('synthetic-load-fixture-only');

function request(socket: WebSocket, command: number, field: string, body: Record<string, unknown>, responseCommand: number) {
  const started = performance.now();
  return new Promise<ReturnType<typeof decodeFrame>>((resolveRequest, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Response timeout for ${command}`)); }, 15000);
    const onMessage = (bytes: Buffer) => {
      const frame = decodeFrame(bytes);
      if (frame.cmd === responseCommand) { cleanup(); latencies.push(performance.now() - started); resolveRequest(frame); }
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timeout); socket.off('message', onMessage); socket.off('error', onError); };
    socket.on('message', onMessage); socket.on('error', onError);
    socket.send(encodeFrame({ cmd: command, protoVersion: 2 }, { [field]: body }));
  });
}

async function connect(index: number) {
  const socket = new WebSocket(address.replace('http:', 'ws:') + '/ws/original');
  sockets[index] = socket;
  await once(socket, 'open');
  const response = await request(socket, MSGEvent.HWRequestGameLogin, 'hwRequestGameLogin', { token: tokens[index] }, MSGEvent.HWResponseGameLogin);
  assert.equal((response.data.hwResponseGameLogin as any).state, true);
}

try {
  await db.transaction(async tx => {
    for (let index = 0; index < count; index++) {
      const actor: Actor = { id: randomUUID(), username: `load_${index}`, nickname: `Load ${index}`, role: 'player' };
      const token = randomBytes(32).toString('base64url');
      actors.push(actor); tokens.push(token);
      await tx.query("INSERT INTO accounts(id,username,nickname,password_hash,role) VALUES($1,$2,$3,$4,'player')", [actor.id, actor.username, actor.nickname, passwordHash]);
      await tx.query('INSERT INTO wallets(user_id) VALUES($1)', [actor.id]);
      await tx.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [tokenHash(token), actor.id]);
    }
  });
  for (let index = 0; index < count; index += 4) {
    const room = await services.rooms.create(actors[index]!, '2:0', {});
    for (let offset = 1; offset < 4; offset++) await services.rooms.join(actors[index + offset]!, room.code);
  }
  const started = performance.now();
  for (let index = 0; index < count; index += 20) await Promise.all(Array.from({ length: 20 }, (_, offset) => connect(index + offset)));
  assert.equal(services.live.size, count);
  const loginMs = performance.now() - started;
  latencies.length = 0;
  for (let sample = 0; sample < 3; sample++) {
    const begin = performance.now();
    await Promise.all(sockets.map(socket => request(socket, MSGEvent.HWRequestHeartBeat, 'hwRequestHeartBeat', {}, MSGEvent.HWResponseHeartBeat)));
    samples.push(performance.now() - begin);
  }
  for (let index = 0; index < 10; index++) {
    const old = sockets[index]!; const closed = once(old, 'close'); old.close(); await closed;
    await connect(index);
  }
  assert.equal(services.live.size, count);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM ledger_entries')).rows[0]!.count, 0);
  const sorted = [...latencies].sort((a, b) => a - b);
  const report = {
    date: new Date().toISOString(), database: 'PGlite isolated in-memory',
    scope: 'Original HWFR authentication, 50 waiting rooms, heartbeat transport and reconnect only; no regional gameplay engine is registered.',
    clients: count, waitingRooms: 50, simultaneousHeartbeatBatches: samples.length,
    loginMs: Math.round(loginMs), heartbeatBatchMs: samples.map(Math.round),
    responseP50Ms: Math.round(sorted[Math.floor(sorted.length * 0.5)]!), responseP95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]!),
    reconnects: 10, ledgerEntries: 0, gameplayCapacityVerified: false,
  };
  await mkdir(resolve('../../verification'), { recursive: true });
  await writeFile(resolve('../../verification/transport-load.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.all(sockets.map(async socket => { if (socket.readyState === WebSocket.CLOSED) return; const closed = once(socket, 'close'); socket.close(); await closed; }));
  await services.app.close(); await db.close();
}
