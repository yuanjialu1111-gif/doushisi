import { encodeFixtureFrame as encodeFrame } from './fixture-options.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { decodeFrame, expectedBodyField, MSGEvent, type DecodedFrame } from '@dss/protocol';
import { getFixtureOptions as getDefaultOptions } from './fixture-options.js';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService } from '../src/auth.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { EngineRegistry } from '../src/engines.js';
import { decodeOriginalExtension, encodeOriginalResponse, EXTRA_EMOTES_VERSION, registerOriginalProtocol, type OriginalExtension } from '../src/original-wire.js';

// 第二轮 S7：13–20 号互动表情。只测转发，不涉及任何地方玩法。
interface Received { frame: DecodedFrame; extension?: OriginalExtension }
async function connect(url: string) {
  const socket = new WebSocket(url); const inbox: Received[] = [];
  socket.on('message', bytes => inbox.push({ frame: decodeFrame(bytes as Buffer), extension: decodeOriginalExtension(bytes as Buffer) }));
  await once(socket, 'open');
  function wait(command: number, start: number): Promise<Received> {
    const search = () => inbox.slice(start).find(item => item.frame.cmd === command);
    const found = search(); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const listener = () => { const item = search(); if (item) { clearTimeout(timer); socket.off('message', listener); resolve(item); } };
      const timer = setTimeout(() => { socket.off('message', listener); reject(new Error(`Missing original message ${command}`)); }, 5000);
      socket.on('message', listener);
    });
  }
  async function request(command: number, body: Record<string, unknown>, response: number, extension?: Partial<OriginalExtension>) {
    await delay(60);
    const start = inbox.length;
    socket.send(extension === undefined ? encodeFrame({ cmd: command, uid: '', protoVersion: 2 }, { [expectedBodyField(command)!]: body })
      : encodeOriginalResponse(command, body, '', { ...(command === 3 ? { createRoom: { baseBeans: '0.1' } } : {}), ...extension }));
    return wait(response, start);
  }
  const chats = () => inbox.filter(item => item.frame.cmd === MSGEvent.HWNotifyChat).map(item => item.frame.data.hwNotifyChat as Record<string, unknown>);
  return { inbox, wait, request, chats, async close() { if (socket.readyState !== WebSocket.CLOSED) { socket.close(); await once(socket, 'close'); } } };
}

async function setup(t: test.TestContext) {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db), ledger = new LedgerService(db), policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const url = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  // 新版两人（声明支持新表情），旧版一人（不带标记）。
  const fresh = await connect(url), peer = await connect(url), old = await connect(url);
  t.after(async () => { await fresh.close(); await peer.close(); await old.close(); await app.close(); await db.close(); });
  const capabilities = ['decision-window-v1', EXTRA_EMOTES_VERSION];
  const uids: string[] = [];
  for (const [index, client] of [fresh, peer, old].entries()) {
    const actor = await auth.create(`emote_${index}`, 'test-password-only');
    const { token } = await auth.login(actor.username, 'test-password-only');
    const login = await client.request(MSGEvent.HWRequestGameLogin, { token }, MSGEvent.HWResponseGameLogin, index < 2 ? { capabilities } : undefined);
    assert.equal(login.extension?.error, undefined);
    uids.push((login.frame.data.hwResponseGameLogin as { uid: string }).uid);
  }
  const created = await fresh.request(MSGEvent.HWRequestCreateTable, { ...getDefaultOptions('4:0'), areaType: 4, roomType: 100, playerNum: 3 }, MSGEvent.HWResponseCreateTable, { capabilities });
  const code = (created.frame.data.hwResponseCreateTable as any).tableInfo.roomId;
  for (const client of [peer, old]) assert.equal((await client.request(MSGEvent.HWRequestEnterTable, { roomId: code }, MSGEvent.HWResponseEnterTable)).extension?.error, undefined);
  return { fresh, peer, old, uids };
}

test('S7-AC1 S7-AC3 the 8 new interactions 13–20 reach upgraded clients only; old clients see nothing and get no error', async t => {
  const { fresh, peer, old, uids } = await setup(t);
  for (let id = 13; id <= 20; id++) {
    const mark = { fresh: fresh.inbox.length, peer: peer.inbox.length };
    const response = await fresh.request(MSGEvent.HWRequestChat, { ctype: 3, mutualFaceId: id, mutualFaceToUid: 1 }, MSGEvent.HWResponseChat);
    assert.equal(response.extension?.error, undefined, `表情 ${id} 被拒`);
    const expected = { ctype: 3, mutualFaceId: id, mutualFaceToUid: 1, uid: uids[0] };
    assert.deepEqual((await fresh.wait(MSGEvent.HWNotifyChat, mark.fresh)).frame.data.hwNotifyChat, expected);
    assert.deepEqual((await peer.wait(MSGEvent.HWNotifyChat, mark.peer)).frame.data.hwNotifyChat, expected);
  }
  // 原版的 2–12 照旧三个人都收到，说明旧客户端连接本身是通的。
  const response = await fresh.request(MSGEvent.HWRequestChat, { ctype: 3, mutualFaceId: 12, mutualFaceToUid: 2 }, MSGEvent.HWResponseChat);
  assert.equal(response.extension?.error, undefined);
  await old.wait(MSGEvent.HWNotifyChat, 0);
  await delay(100);
  assert.deepEqual(old.chats().map(chat => chat.mutualFaceId), [12]);
  assert.deepEqual(peer.chats().map(chat => chat.mutualFaceId), [13, 14, 15, 16, 17, 18, 19, 20, 12]);
  assert.equal(old.inbox.some(item => item.extension?.error), false);
});

test('S7-AC3 a client without the flag cannot send 13–20, and 21 or 1 stay out of range for everyone', async t => {
  const { fresh, peer, old } = await setup(t);
  const rejected = await old.request(MSGEvent.HWRequestChat, { ctype: 3, mutualFaceId: 13, mutualFaceToUid: 0 }, MSGEvent.HWResponseChat);
  assert.equal(rejected.extension?.error?.code, 'INVALID_CHAT');
  for (const id of [1, 21]) {
    const response = await fresh.request(MSGEvent.HWRequestChat, { ctype: 3, mutualFaceId: id, mutualFaceToUid: 1 }, MSGEvent.HWResponseChat);
    assert.equal(response.extension?.error?.code, 'INVALID_CHAT', `编号 ${id} 应被拒`);
  }
  await delay(100);
  assert.equal(peer.chats().length, 0);
  assert.equal(old.chats().length, 0);
});
