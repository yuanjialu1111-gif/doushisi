import { encodeFixtureFrame as encodeFrame, getFixtureOptions as getDefaultOptions } from './fixture-options.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import sharp from 'sharp';
import { decodeFrame, type DecodedFrame } from '@dss/protocol';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService } from '../src/auth.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { EngineRegistry } from '../src/engines.js';
import { ProfileService } from '../src/profile.js';
import { DEFAULT_AVATAR_URL } from '../src/avatars.js';
import { decodeOriginalExtension, registerOriginalProtocol, type OriginalExtension } from '../src/original-wire.js';

interface Received { frame: DecodedFrame; extension?: OriginalExtension }

async function wireClient(url: string) {
  const socket = new WebSocket(url);
  const inbox: Received[] = [];
  socket.on('message', bytes => { const data = bytes as Buffer; inbox.push({ frame: decodeFrame(data), extension: decodeOriginalExtension(data) }); });
  await once(socket, 'open');
  async function request(command: number, body: Record<string, unknown>, response: number): Promise<Received> {
    const start = inbox.length;
    socket.send(encodeFrame({ cmd: command, protoVersion: 2 }, body));
    return new Promise((resolve, reject) => {
      const find = () => inbox.slice(start).find(value => value.frame.cmd === response);
      const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error(`No wire message ${response}`)); }, 5000);
      const listener = () => { const value = find(); if (value) { clearTimeout(timeout); socket.off('message', listener); resolve(value); } };
      socket.on('message', listener); listener();
    });
  }
  async function close() { if (socket.readyState !== WebSocket.CLOSED) { socket.close(); await once(socket, 'close'); } }
  return { request, close };
}

const avatar = (background: string) => sharp({ create: { width: 300, height: 300, channels: 3, background } }).jpeg().toBuffer();

test('R6/R7: the original table protocol requires a finished profile and shows each player\'s own avatar and voice sex', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const ledger = new LedgerService(db); const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  const profiles = new ProfileService(db);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, profiles, profileRequired: true, markOnline() {} });
  const address = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const a = await wireClient(address); const b = await wireClient(address);
  t.after(async () => { await a.close(); await b.close(); await app.close(); await db.close(); });

  const actors = [await auth.create('wire_profile_a', 'test-password-only'), await auth.create('wire_profile_b', 'test-password-only')];
  const logins = [];
  for (const [index, client] of [a, b].entries()) {
    const session = await auth.login(actors[index]!.username, 'test-password-only');
    logins.push((await client.request(1, { hwRequestGameLogin: { token: session.token } }, 2)).frame.data.hwResponseGameLogin as any);
  }
  assert.equal(logins[0].picUrl, DEFAULT_AVATAR_URL);
  const options = { ...getDefaultOptions('4:0'), areaType: 4, roomType: 100, playerNum: 2 };
  const blocked = await a.request(3, { hwRequestCreateTable: options }, 4);
  assert.equal(blocked.extension?.error?.code, 'PROFILE_REQUIRED');
  assert.match(blocked.extension!.error!.message, /头像/);

  await profiles.setAvatar(actors[0]!, await avatar('#dd2200'));
  await profiles.update(actors[0]!, { nickname: '红色甲', sex: 2 });
  await profiles.setAvatar(actors[1]!, await avatar('#0022dd'));
  await profiles.update(actors[1]!, { nickname: '蓝色乙', sex: 1 });
  const urls = await Promise.all(actors.map(async actor => (await profiles.get(actor.id)).avatarUrl));
  assert.notEqual(urls[0], urls[1]);

  const created = await a.request(3, { hwRequestCreateTable: options }, 4);
  const table = (created.frame.data.hwResponseCreateTable as any).tableInfo;
  assert.ok(table?.roomId, JSON.stringify(created.extension?.error));
  await b.request(5, { hwRequestEnterTable: { roomId: table.roomId } }, 6);
  const entered = await a.request(47, { hwRequestEnterTableFinish: { roomId: table.roomId } }, 48);
  const users = (entered.frame.data.hwResponseEnterTableFinish as any).userInfo as any[];
  const byNick = Object.fromEntries(users.map(user => [user.nick, user]));
  assert.equal(byNick['红色甲'].picUrl, urls[0]);
  assert.equal(byNick['蓝色乙'].picUrl, urls[1]);
  // 原版客户端 sex 为真用女声：库里 2=女 → 线上 1，1=男 → 线上 0。
  assert.equal(byNick['红色甲'].sex, 1);
  assert.equal(byNick['蓝色乙'].sex ?? 0, 0);

  const head = await a.request(207, { hwRequestHeadInfo: { uid: logins[1].uid } }, 208);
  assert.equal((head.frame.data.hwResponseHeadInfo as any).picUrl, urls[1]);
  const self = await a.request(207, { hwRequestHeadInfo: {} }, 208);
  assert.equal((self.frame.data.hwResponseHeadInfo as any).picUrl, urls[0]);

  // 重新登录拿到的就是新头像（R7 AC2）。
  await profiles.setAvatar(actors[0]!, await avatar('#22dd00'));
  const c = await wireClient(address); t.after(() => c.close());
  const relogin = await c.request(1, { hwRequestGameLogin: { token: (await auth.login(actors[0]!.username, 'test-password-only')).token } }, 2);
  const fresh = (relogin.frame.data.hwResponseGameLogin as any);
  assert.equal(fresh.picUrl, (await profiles.get(actors[0]!.id)).avatarUrl);
  assert.notEqual(fresh.picUrl, urls[0]);
  assert.equal(fresh.sex, 1);
});
