import { encodeFixtureFrame as encodeFrame } from './fixture-options.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { decodeFrame,  MSGEvent, type DecodedFrame } from '@dss/protocol';
import { getFixtureOptions as getDefaultOptions } from './fixture-options.js';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService } from '../src/auth.js';
import { appendOperation, LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { EngineRegistry } from '../src/engines.js';
import { decodeOriginalExtension, encodeOriginalResponse, registerOriginalProtocol, type OriginalExtension } from '../src/original-wire.js';

interface Received { frame: DecodedFrame; extension?: OriginalExtension }
async function openWireTestClient(url: string) {
  const socket = new WebSocket(url);
  const inbox: Received[] = [];
  socket.on('message', bytes => { const data = bytes as Buffer; inbox.push({ frame: decodeFrame(data), extension: decodeOriginalExtension(data) }); });
  await once(socket, 'open');
  function wait(command: number, start = 0, predicate: (value: Received) => boolean = () => true): Promise<Received> {
    const search = () => inbox.slice(start).find(value => value.frame.cmd === command && predicate(value));
    const existing = search(); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error(`No wire message ${command}`)); }, 5000);
      const listener = () => {
        const value = search(); if (value) { clearTimeout(timeout); socket.off('message', listener); resolve(value); }
      };
      socket.on('message', listener);
    });
  }
  async function request(command: number, body: Record<string, unknown>, response: number) {
    const start = inbox.length;
    socket.send(encodeFrame({ cmd: command, protoVersion: 2 }, body));
    return wait(response, start);
  }
  async function close() { if (socket.readyState !== WebSocket.CLOSED) { socket.close(); await once(socket, 'close'); } }
  return { socket, inbox, wait, request, close };
}

test('version two appends exact decimal strings without truncating the original int64', () => {
  const bytes = encodeOriginalResponse(2, { uid: '100000', state: true }, '100000', {
    decimalFields: [{ path: ['hwResponseGameLogin', 'goldNum'], value: '9007199254740993.125' }],
  });
  const frame = decodeFrame(bytes);
  assert.equal(frame.head.protoVersion, 2);
  assert.ok(!Object.hasOwn(frame.data.hwResponseGameLogin as object, 'goldNum'));
  assert.deepEqual(decodeOriginalExtension(bytes)?.decimalFields, [{ path: ['hwResponseGameLogin', 'goldNum'], value: '9007199254740993.125' }]);
});

test('waiting-room presence, self leave, vote cancellation, timeout and reconnect use original projections', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const ledger = new LedgerService(db); const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const address = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const clients: Awaited<ReturnType<typeof openWireTestClient>>[] = [];
  t.after(async () => { for (const client of clients) await client.close(); await app.close(); await db.close(); });
  async function connect(token: string) {
    const client = await openWireTestClient(address); clients.push(client);
    const login = await client.request(1, { hwRequestGameLogin: { token } }, 2);
    return { ...client, uid: (login.frame.data.hwResponseGameLogin as any).uid };
  }
  const actors = [];
  for (let i = 0; i < 3; i++) actors.push(await auth.create(`presence_${i}`, 'test-password-only'));
  const sessions = [];
  for (const actor of actors) sessions.push(await auth.login(actor.username, 'test-password-only'));
  const a = await connect(sessions[0]!.token); let b = await connect(sessions[1]!.token); const c = await connect(sessions[2]!.token);
  const created = await a.request(3, { hwRequestCreateTable: { ...getDefaultOptions('4:0'), playerNum: 3, roomType: 100, areaType: 4 } }, 4);
  const roomCode = (created.frame.data.hwResponseCreateTable as any).tableInfo.roomId;
  const join = async (client: typeof a) => {
    await client.request(5, { hwRequestEnterTable: { roomId: roomCode } }, 6);
    return client.request(47, { hwRequestEnterTableFinish: { roomId: roomCode } }, 48);
  };
  await a.request(47, { hwRequestEnterTableFinish: { roomId: roomCode } }, 48);
  assert.equal(((await join(b)).frame.data.hwResponseEnterTableFinish as any).seatIndex, 2);
  assert.equal(((await join(c)).frame.data.hwResponseEnterTableFinish as any).seatIndex, 3);
  const roomId = (await db.query('SELECT id FROM rooms WHERE code=$1', [String(roomCode)])).rows[0]!.id;

  let mark = a.inbox.length;
  const hidden = await b.request(43, { hwRequestIsOnline: { online: false } }, 44);
  assert.equal((hidden.frame.data.hwResponseIsOnline as any).online, false);
  await a.wait(45, mark, event => (event.frame.data.hwNotifyIsOnline as any).seatIndex === 2 && !(event.frame.data.hwNotifyIsOnline as any).online);
  mark = a.inbox.length;
  const bSecond = await connect(sessions[1]!.token);
  await a.wait(45, mark, event => Boolean((event.frame.data.hwNotifyIsOnline as any).online));
  mark = a.inbox.length;
  await bSecond.close();
  await a.wait(45, mark, event => !(event.frame.data.hwNotifyIsOnline as any).online);
  await b.request(43, { hwRequestIsOnline: { online: true } }, 44);
  mark = a.inbox.length;
  await b.close();
  await a.wait(45, mark, event => !(event.frame.data.hwNotifyIsOnline as any).online);
  b = await connect(sessions[1]!.token); await join(b);

  mark = a.inbox.length;
  await b.request(29, { hwRequestDissolveTable: { roomId: roomCode, choice: true } }, 30);
  const started = (await a.wait(31, mark)).frame.data.hwNotifyDissolveTableOperation as any;
  assert.equal(started.uid, b.uid);
  assert.deepEqual(started.disList.map((vote: any) => vote.state ?? 0), [0, 1, 0]);
  assert.ok(Number(started.endTime) * 1000 > Date.now());
  assert.ok(started.cd <= 120 && started.cd > 115);
  const restored = await c.request(47, { hwRequestEnterTableFinish: { roomId: roomCode } }, 48);
  const recovered = (restored.frame.data.hwResponseEnterTableFinish as any).dissolveInfos;
  assert.equal(recovered.uid, b.uid); assert.equal(recovered.endTime, started.endTime);
  mark = a.inbox.length;
  await c.request(29, { hwRequestDissolveTable: { roomId: roomCode, choice: true } }, 30);
  const updated = (await a.wait(31, mark)).frame.data.hwNotifyDissolveTableOperation as any;
  assert.deepEqual(updated.disList.map((vote: any) => vote.state ?? 0), [0, 1, 1]);
  mark = c.inbox.length;
  await a.request(29, { hwRequestDissolveTable: { roomId: roomCode, choice: false } }, 30);
  const rejected = (await c.wait(32, mark)).frame.data.hwNotifyDissolvedTable as any;
  assert.equal(rejected.result, false); assert.equal(rejected.dating, false);
  assert.equal(await rooms.dissolveState(roomId), null);

  await c.request(29, { hwRequestDissolveTable: { roomId: roomCode, choice: true } }, 30);
  await db.query("UPDATE dissolve_votes SET created_at=now()-interval '3 minutes' WHERE room_id=$1", [roomId]);
  mark = a.inbox.length; assert.equal(await rooms.expireDissolve(roomId), true);
  const expired = (await a.wait(32, mark)).frame.data.hwNotifyDissolvedTable as any;
  assert.equal(expired.result, false); assert.equal((await rooms.current(actors[0]!.id))!.id, roomId);

  await c.request(29, { hwRequestDissolveTable: { roomId: roomCode, choice: true } }, 30);
  mark = a.inbox.length; const selfMark = b.inbox.length;
  await b.request(13, { hwRequestLogoutTable: { roomId: roomCode } }, 14);
  assert.equal(((await b.wait(15, selfMark)).frame.data.hwNotifyLogoutTable as any).seatIndex, 2);
  assert.equal(((await a.wait(15, mark)).frame.data.hwNotifyLogoutTable as any).seatIndex, 2);
  assert.equal(await rooms.dissolveState(roomId), null);
  await a.wait(32, mark, event => !(event.frame.data.hwNotifyDissolvedTable as any).result);
  assert.equal(await rooms.current(actors[1]!.id), null);
  assert.equal(((await join(b)).frame.data.hwResponseEnterTableFinish as any).seatIndex, 2);

  mark = c.inbox.length;
  await a.request(29, { hwRequestDissolveTable: { roomId: roomCode, choice: true } }, 30);
  const dissolved = (await c.wait(32, mark)).frame.data.hwNotifyDissolvedTable as any;
  assert.equal(dissolved.result, true); assert.equal(dissolved.dating, true);
  assert.equal(await rooms.current(actors[0]!.id), null);
  const another = await a.request(3, { hwRequestCreateTable: { ...getDefaultOptions('4:0'), playerNum: 2, roomType: 100, areaType: 4 } }, 4);
  const anotherCode = (another.frame.data.hwResponseCreateTable as any).tableInfo.roomId;
  await b.request(5, { hwRequestEnterTable: { roomId: anotherCode } }, 6);
  const anotherId = (await db.query('SELECT id FROM rooms WHERE code=$1', [String(anotherCode)])).rows[0]!.id;
  // A room-state fixture verifies voting after a previous round without invoking
  // or simulating a regional game engine or generating a settlement.
  await db.query("UPDATE rooms SET state='between_rounds',current_round=1 WHERE id=$1", [anotherId]);
  await a.request(29, { hwRequestDissolveTable: { roomId: anotherCode, choice: true } }, 30);
  assert.equal((await rooms.current(actors[0]!.id))!.state, 'between_rounds');
  assert.equal((await rooms.dissolveState(anotherId))!.votes.length, 1);
  mark = a.inbox.length;
  await b.request(29, { hwRequestDissolveTable: { roomId: anotherCode, choice: true } }, 30);
  assert.equal(((await a.wait(32, mark)).frame.data.hwNotifyDissolvedTable as any).result, true);
  assert.equal(await rooms.current(actors[0]!.id), null);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ledger_operations')).rows[0]!.n, 0);
});

test('original HWFR registration, login, rooms, reconnect and authorization against real services', async t => {
  const db = await openDatabase();
  await migrate(db);
  const app = Fastify();
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  const auth = new AuthService(db);
  const ledger = new LedgerService(db);
  const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) { socket.close(); await once(socket, 'close'); }
    await app.close(); await db.close();
  });
  async function client() {
    const socket = new WebSocket(address.replace('http', 'ws') + '/ws/original'); sockets.push(socket); await once(socket, 'open');
    const inbox: { frame: DecodedFrame; extension?: OriginalExtension }[] = [];
    socket.on('message', bytes => { const buffer = bytes as Buffer; inbox.push({ frame: decodeFrame(buffer), extension: decodeOriginalExtension(buffer) }); });
    async function request(cmd: number, body: Record<string, unknown>, response: number, version = 2, uid = '') {
      inbox.length = 0;
      const received = new Promise<{ frame: DecodedFrame; extension?: OriginalExtension }>((resolve, reject) => {
        const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error(`No response for ${cmd}`)); }, 5000);
        const listener = (data: Buffer) => {
          const frame = decodeFrame(data);
          if (frame.cmd === response) { clearTimeout(timeout); socket.off('message', listener); resolve({ frame, extension: decodeOriginalExtension(data) }); }
        };
        socket.on('message', listener);
      });
      socket.send(encodeFrame({ cmd, uid, protoVersion: version }, body));
      return received;
    }
    return { socket, request, inbox };
  }
  const a = await client();
  const legacy = await a.request(431, { hwRequestRegister: { account: 'wire_legacy', password: 'test-password-only' } }, 432, 1);
  assert.equal(legacy.extension?.error?.code, 'CLIENT_UPGRADE_REQUIRED');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM accounts WHERE username='wire_legacy'")).rows[0]!.n, 0);
  const registered = await a.request(431, { hwRequestRegister: { account: 'wire_player_a', password: 'test-password-only' } }, 432);
  assert.equal((registered.frame.data.hwResponseRegister as any).result, 1);
  const actorA = (await db.query("SELECT id,username,nickname,role FROM accounts WHERE username='wire_player_a'")).rows[0]!;
  const admin = await auth.create('wire_beans_admin', 'test-password-only', 'beans_admin');
  await ledger.adjust(admin, actorA.id, '12.125', 'wire fixture balance', 'wire-first-adjust');
  const logged = await a.request(1, { hwRequestGameLogin: { account: 'wire_player_a', password: 'test-password-only' } }, 2);
  const userA = logged.frame.data.hwResponseGameLogin as any;
  assert.match(userA.uid, /^\d{6,10}$/);
  assert.equal(userA.state, true);
  assert.equal(userA.picUrl, '/client/standalone/default-avatar.png');
  assert.equal(userA.goldNum, '0');
  assert.equal(logged.extension!.decimalFields[0]!.value, '12.125');
  const b = await client();
  await b.request(431, { hwRequestRegister: { account: 'wire_player_b', password: 'test-password-only' } }, 432);
  const second = await b.request(1, { hwRequestGameLogin: { account: 'wire_player_b', password: 'test-password-only' } }, 2);
  const userB = second.frame.data.hwResponseGameLogin as any;
  assert.notEqual(userA.uid, userB.uid);
  const region = await a.request(49, { hwRequestRegion: {} }, 50);
  assert.ok((region.frame.data.hwResponseRegion as any).shiInfo.length > 0);
  const defaults = getDefaultOptions('4:0'); defaults.playerNum = 2;
  const created = await a.request(3, { hwRequestCreateTable: { ...defaults, areaType: 4, roomType: 100 } }, 4, 2, userB.uid);
  const table = (created.frame.data.hwResponseCreateTable as any).tableInfo;
  assert.equal(table.creatorUid, userA.uid);
  assert.equal(table.playerNum, 2);
  await b.request(5, { hwRequestEnterTable: { roomId: table.roomId } }, 6);
  const entered = await a.request(47, { hwRequestEnterTableFinish: { roomId: table.roomId } }, 48);
  assert.equal((entered.frame.data.hwResponseEnterTableFinish as any).userInfo.length, 2);
  assert.ok((entered.frame.data.hwResponseEnterTableFinish as any).userInfo.every((user: any) => user.picUrl === userA.picUrl));
  await a.request(8, { hwRequestReadyForGame: { state: true } }, 9);
  const blocked = await b.request(8, { hwRequestReadyForGame: { state: true } }, 9);
  assert.equal(blocked.extension?.error?.code, 'RULES_NOT_VERIFIED');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ledger_operations WHERE kind=\'room_fee\'')).rows[0]!.n, 0);
  assert.equal(await ledger.balance(actorA.id), '12.125');
  const reconnected = await client();
  const resume = await reconnected.request(1, { hwRequestGameLogin: { token: userA.token } }, 2);
  assert.equal((resume.frame.data.hwResponseGameLogin as any).uid, userA.uid);
  assert.equal((resume.frame.data.hwResponseGameLogin as any).tableId, table.roomId);
  await ledger.adjust(admin, actorA.id, '0.125', 'wire balance refresh', 'wire-refresh-adjust');
  await a.request(37, { hwRequestHeartBeat: {} }, 38);
  assert.equal(a.inbox.find(item => item.frame.cmd === MSGEvent.HWNotifyUserDataChange)?.extension?.decimalFields[0]?.value, '12.25');
  const friends = await a.request(413, { hwRequestGetFriends: { type: 4 } }, 414);
  assert.equal((friends.frame.data.hwResponseGetFriends as any).result, 1);
  const records = await a.request(301, { hwRequestRecordList: { areaType: 4 } }, 302);
  assert.equal((records.frame.data.hwResponseRecordList as any).result, 1);

  // Seed a history fixture only to verify original record projection. This does
  // not represent a regional engine, an original rule case, or a real settlement.
  const actorB = (await db.query("SELECT id FROM accounts WHERE username='wire_player_b'")).rows[0]!;
  const roomId = (await db.query('SELECT id FROM rooms WHERE code=$1', [String(table.roomId)])).rows[0]!.id;
  await db.query("UPDATE rooms SET state='closed',current_round=1 WHERE id=$1", [roomId]);
  const historicalRoundId = randomUUID();
  const historicalResults = [{ userId: actorA.id, amount: '0.25' }, { userId: actorB.id, amount: '-0.25' }];
  await db.query("INSERT INTO rounds(id,room_id,number,state,snapshot,policy_snapshot,results,settled_at) VALUES($1,$2,1,'settled','{}','{}',$3,now())", [historicalRoundId, roomId, JSON.stringify(historicalResults)]);
  await db.transaction(tx => appendOperation(tx, { key: `wire-history-settlement-${historicalRoundId}`, kind: 'round_settlement', roomId, roundId: historicalRoundId,
    reason: 'Original wire history fixture', postings: historicalResults }));
  await db.query('INSERT INTO friends(user_id,friend_id,first_room_id) VALUES($1,$2,$3)', [actorA.id, actorB.id, roomId]);
  const populated = await a.request(301, { hwRequestRecordList: { areaType: 4 } }, 302);
  const record = (populated.frame.data.hwResponseRecordList as any).recordInfo[0];
  assert.ok(Number.isInteger(record.recordId));
  assert.equal(record.userInfo[0].uid, userA.uid);
  assert.equal(populated.extension!.decimalFields[0]!.value, '0.25');
  const detail = await a.request(303, { hwRequestRecordDetail: { recordId: record.recordId } }, 304);
  const roundRecord = (detail.frame.data.hwResponseRecordDetail as any).smallScore[0];
  assert.ok(Number.isInteger(roundRecord.recordId));
  assert.equal(detail.extension!.decimalFields[1]!.value, '-0.25');
  const populatedFriends = await a.request(413, { hwRequestGetFriends: { type: 4 } }, 414);
  assert.equal((populatedFriends.frame.data.hwResponseGetFriends as any).friendAll[0].uid, userB.uid);
  assert.equal((populatedFriends.frame.data.hwResponseGetFriends as any).friendAll[0].online, '在线');
  assert.equal((populatedFriends.frame.data.hwResponseGetFriends as any).friendAll[0].picUrl, userA.picUrl);
  await b.request(43, { hwRequestIsOnline: { online: false } }, 44);
  const offlineFriends = await a.request(413, { hwRequestGetFriends: { type: 4 } }, 414);
  assert.equal((offlineFriends.frame.data.hwResponseGetFriends as any).friendAll[0].online, '离线中');
  const playback = await a.request(305, { hwRequestPlayBack: { recordId: roundRecord.recordId } }, 306);
  assert.equal(playback.extension?.error?.code, 'RULES_NOT_VERIFIED');
  const mismatch = await a.request(37, { hwRequestRegister: { account: 'spoof_ignored', password: 'test-password-only' } }, 38);
  assert.equal(mismatch.extension?.error?.code, 'INVALID_REQUEST');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM accounts WHERE username='spoof_ignored'")).rows[0]!.n, 0);
  await db.query('DELETE FROM sessions WHERE user_id=$1', [actorA.id]);
  const revoked = await a.request(49, { hwRequestRegion: {} }, 50);
  assert.equal(revoked.extension?.error?.code, 'UNAUTHORIZED');
});

test('original chat buttons relay bounded phrase, expression and seated interaction payloads', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const ledger = new LedgerService(db); const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  const emitted: unknown[] = []; rooms.on('chat', event => emitted.push(event));
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const address = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const a = await openWireTestClient(address); const b = await openWireTestClient(address); const outsider = await openWireTestClient(address);
  t.after(async () => { await a.close(); await b.close(); await outsider.close(); await app.close(); await db.close(); });
  const users = [];
  for (const [index, client] of [a, b, outsider].entries()) {
    const actor = await auth.create(`chat_${index}`, 'test-password-only');
    const login = await auth.login(actor.username, 'test-password-only');
    const reply = await client.request(1, { hwRequestGameLogin: { token: login.token } }, 2);
    users.push({ actor, uid: (reply.frame.data.hwResponseGameLogin as any).uid });
  }
  const created = await a.request(3, { hwRequestCreateTable: { ...getDefaultOptions('4:0'), areaType: 4, roomType: 100, playerNum: 2 } }, 4);
  const code = (created.frame.data.hwResponseCreateTable as any).tableInfo.roomId;
  await b.request(5, { hwRequestEnterTable: { roomId: code } }, 6);
  const room = (await rooms.current(users[0]!.actor.id))!;
  const payloads = [
    { input: { ctype: 1, mutualFaceId: 0 }, output: { ctype: 1, mutualFaceId: 0 } },
    { input: { ctype: 1, mutualFaceId: 11, message: 'ignored text', quickVoiceId: 99 }, output: { ctype: 1, mutualFaceId: 11 } },
    { input: { ctype: 5, quickVoiceId: 0 }, output: { ctype: 1, mutualFaceId: 0 } },
    { input: { ctype: 2, message: 'res_dss_chat_0' }, output: { ctype: 2, message: 'res_dss_chat_0' } },
    { input: { ctype: 2, message: 'res_dss_chat_14' }, output: { ctype: 2, message: 'res_dss_chat_14' } },
    { input: { ctype: 2, faceId: 14 }, output: { ctype: 2, message: 'res_dss_chat_14' } },
    { input: { ctype: 3, mutualFaceId: 2, mutualFaceToUid: 2 }, output: { ctype: 3, mutualFaceId: 2, mutualFaceToUid: 2 } },
    { input: { ctype: 3, mutualFaceId: 12, mutualFaceToUid: 2 }, output: { ctype: 3, mutualFaceId: 12, mutualFaceToUid: 2 } },
  ];
  for (const fixture of payloads) {
    const mark = a.inbox.length; const peerMark = b.inbox.length;
    a.socket.send(encodeFrame({ cmd: MSGEvent.HWRequestChat, protoVersion: 2, uid: users[1]!.uid }, { hwRequestChat: fixture.input }));
    const response = await a.wait(MSGEvent.HWResponseChat, mark);
    assert.equal(response.extension?.error, undefined);
    const expected = { ...fixture.output, uid: users[0]!.uid };
    for (const [client, start] of [[a, mark], [b, peerMark]] as const) {
      assert.deepEqual((await client.wait(MSGEvent.HWNotifyChat, start)).frame.data.hwNotifyChat, expected);
    }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  assert.equal(emitted.length, payloads.length);
  for (const input of [
    { ctype: 1 }, { ctype: 1, mutualFaceId: -1 }, { ctype: 1, mutualFaceId: 12 },
    { ctype: 2, message: '../foreign' }, { ctype: 2, message: 'res_dss_chat_15' }, { ctype: 2, faceId: 100 },
    { ctype: 3, mutualFaceId: 1, mutualFaceToUid: 2 }, { ctype: 3, mutualFaceId: 13, mutualFaceToUid: 2 },
    { ctype: 3, mutualFaceId: 2, mutualFaceToUid: 3 }, { ctype: 3, mutualFaceId: 2, mutualFaceToUid: Number(users[1]!.uid) },
    { ctype: 5, quickVoiceId: 12 }, { ctype: 4, message: 'https://invalid.test/voice.mp3' },
  ]) {
    const response = await a.request(MSGEvent.HWRequestChat, { hwRequestChat: input }, MSGEvent.HWResponseChat);
    assert.ok(response.extension?.error);
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  const outside = await outsider.request(MSGEvent.HWRequestChat, { hwRequestChat: { ctype: 1, mutualFaceId: 0 } }, MSGEvent.HWResponseChat);
  assert.equal(outside.extension?.error?.code, 'ROOM_NOT_FOUND');
  assert.equal(emitted.length, payloads.length);
  assert.equal(outsider.inbox.filter(event => event.frame.cmd === MSGEvent.HWNotifyChat).length, 0);
  await assert.rejects(rooms.chat(users[0]!.actor, room.id, { message: 'mixed', quickVoiceId: 0 }), { code: 'INVALID_CHAT' });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ledger_operations')).rows[0]!.n, 0);
});

test('R11 AC2/AC3: rooms never ask for a location, old GPS rooms included, and the table gets no distances', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const ledger = new LedgerService(db); const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const address = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const a = await openWireTestClient(address); const b = await openWireTestClient(address);
  t.after(async () => { await a.close(); await b.close(); await app.close(); await db.close(); });
  for (const [index, client] of [a, b].entries()) {
    const user = await auth.create(`gps_player_${index}`, 'test-password-only');
    const login = await auth.login(user.username, 'test-password-only');
    await client.request(1, { hwRequestGameLogin: { token: login.token } }, 2);
  }
  // 老客户端仍可能勾着「开启GPS定位」且拿不到坐标：照常开房，规则里不留 openGps。
  const options = { ...getDefaultOptions('4:0'), areaType: 4, roomType: 100, playerNum: 2, openGps: true };
  const created = await a.request(3, { hwRequestCreateTable: { ...options, lat: 0, lon: 0 } }, 4);
  const createReply = created.frame.data.hwResponseCreateTable as any;
  assert.equal(createReply.result, 1);
  assert.ok(!createReply.tableInfo.openGps);
  const roomCode = createReply.tableInfo.roomId;
  const roomId = (await db.query('SELECT id,rules FROM rooms WHERE code=$1', [String(roomCode)])).rows[0]!;
  assert.equal(roomId.rules.openGps, undefined);
  // AC3：模拟以前开了定位、还没解散的房间。
  await db.query(`UPDATE rooms SET rules = rules || '{"openGps":1}'::jsonb WHERE id=$1`, [roomId.id]);
  const entered = await b.request(5, { hwRequestEnterTable: { roomId: roomCode } }, 6);
  assert.equal((entered.frame.data.hwResponseEnterTable as any).result, 1);
  assert.ok(!(entered.frame.data.hwResponseEnterTable as any).tableInfo.openGps);
  for (const client of [b, a]) {
    // 断线重连同样走进房完成，不带坐标也不被拒。
    const finished = await client.request(47, { hwRequestEnterTableFinish: { roomId: roomCode } }, 48);
    const body = finished.frame.data.hwResponseEnterTableFinish as any;
    assert.equal(finished.extension?.error, undefined);
    assert.equal(body.result, 1);
    assert.equal(body.location, undefined);
    assert.ok(!body.tableInfo.openGps);
  }
  await a.request(37, { hwRequestHeartBeat: {} }, 38);
  for (const client of [a, b]) assert.equal(client.inbox.filter(event => event.frame.cmd === MSGEvent.HWNotifyLocation).length, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ledger_operations')).rows[0]!.n, 0);
});

test('R3 AC1/AC2, R5 AC2: the create-room extension opens a public AA room only when 公开到大厅 is ticked and the host meets the threshold', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const ledger = new LedgerService(db); const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const address = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const a = await openWireTestClient(address); const b = await openWireTestClient(address);
  t.after(async () => { await a.close(); await b.close(); await app.close(); await db.close(); });
  const uids: string[] = [];
  for (const [index, client] of [a, b].entries()) {
    const user = await auth.create(`public_host_${index}`, 'test-password-only');
    const login = await auth.login(user.username, 'test-password-only');
    uids.push((await client.request(1, { hwRequestGameLogin: { token: login.token } }, 2)).frame.data.hwResponseGameLogin.uid as string);
  }
  // 房主付费也照样改成 AA。
  const body = { ...getDefaultOptions('4:0'), areaType: 4, roomType: 100, playerNum: 2, useCardType: 1 };
  async function create(client: typeof a, uid: string, createRoom: NonNullable<OriginalExtension['createRoom']>) {
    const start = client.inbox.length;
    client.socket.send(encodeOriginalResponse(3, body, uid, { createRoom }));
    const received = await client.wait(4, start);
    return Object.assign(received.frame.data.hwResponseCreateTable as any, { error: received.extension?.error });
  }
  // 房主豆子不够「底分 × 10」就不开公开房，并提示还差多少（DEC-20261030-公开房房主也查门槛）。
  const refused = await create(a, uids[0]!, { baseBeans: '1', visibility: 'public' });
  assert.equal(refused.error?.code, 'BELOW_THRESHOLD');
  assert.match(refused.error?.message, /至少要 10 豆，你还差 10 豆/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM rooms')).rows[0]!.n, 0);
  const admin = await auth.create('public_beans_admin', 'test-password-only', 'beans_admin');
  const host = (await db.query("SELECT id FROM accounts WHERE username='public_host_0'")).rows[0]!;
  await ledger.adjust(admin, host.id, '10', 'public host threshold', 'public-host-threshold');
  const opened = await create(a, uids[0]!, { baseBeans: '1', visibility: 'public' });
  assert.equal(opened.result, 1);
  assert.equal(opened.tableInfo.useCardType, 2);
  const kept = await create(b, uids[1]!, { baseBeans: '1' });
  assert.equal(kept.result, 1);
  assert.equal(kept.tableInfo.useCardType, 1);
  const stored = (await db.query('SELECT code,visibility,fee_mode FROM rooms ORDER BY code')).rows;
  assert.deepEqual(Object.fromEntries(stored.map(room => [room.code, [room.visibility, room.fee_mode]])), {
    [String(opened.tableInfo.roomId)]: ['public', 'aa'], [String(kept.tableInfo.roomId)]: ['private', 'owner'],
  });
});

test('owner kick removes the seated target, clears votes and broadcasts the original notification', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const ledger = new LedgerService(db); const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const address = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const owner = await openWireTestClient(address); const target = await openWireTestClient(address); const third = await openWireTestClient(address);
  const clients = [owner, target, third];
  t.after(async () => { for (const client of clients) await client.close(); await app.close(); await db.close(); });
  const identities = [];
  for (const [index, client] of clients.entries()) {
    const actor = await auth.create(`kick_player_${index}`, 'test-password-only');
    const login = await auth.login(actor.username, 'test-password-only');
    const reply = await client.request(1, { hwRequestGameLogin: { token: login.token } }, 2);
    identities.push({ actor, uid: (reply.frame.data.hwResponseGameLogin as any).uid });
  }
  const created = await owner.request(3, { hwRequestCreateTable: { ...getDefaultOptions('4:0'), playerNum: 3, roomType: 100, areaType: 4 } }, 4);
  const roomCode = (created.frame.data.hwResponseCreateTable as any).tableInfo.roomId;
  const join = async (client: typeof owner) => {
    await client.request(5, { hwRequestEnterTable: { roomId: roomCode } }, 6);
    return client.request(47, { hwRequestEnterTableFinish: { roomId: roomCode } }, 48);
  };
  await owner.request(47, { hwRequestEnterTableFinish: { roomId: roomCode } }, 48);
  assert.equal(((await join(target)).frame.data.hwResponseEnterTableFinish as any).seatIndex, 2);
  assert.equal(((await join(third)).frame.data.hwResponseEnterTableFinish as any).seatIndex, 3);
  const roomId = (await db.query('SELECT id FROM rooms WHERE code=$1', [String(roomCode)])).rows[0]!.id;

  // A pending dissolve vote from the target must not survive the kick.
  await target.request(29, { hwRequestDissolveTable: { roomId: roomCode, choice: true } }, 30);
  assert.ok(await rooms.dissolveState(roomId));

  const ownerMark = owner.inbox.length; const targetMark = target.inbox.length; const thirdMark = third.inbox.length;
  const reply = await owner.request(17, { hwRequestOwnerTiren: { seatIndex: 2 } }, 18);
  assert.equal((reply.frame.data.hwResponseOwnerTiren as any).result, 1);
  assert.equal(reply.extension?.error, undefined);
  for (const [client, mark] of [[owner, ownerMark], [target, targetMark], [third, thirdMark]] as const) {
    const notice = await client.wait(MSGEvent.HWNotifyOwnerTiren, mark);
    assert.equal((notice.frame.data.hwNotifyOwnerTiren as any).seatIndex, 2);
  }
  assert.equal(await rooms.current(identities[1]!.actor.id), null);
  assert.equal((await rooms.current(identities[0]!.actor.id))!.members.length, 2);
  assert.equal(await rooms.dissolveState(roomId), null);
  const audit = await db.query("SELECT actor_id,user_id,kind,details FROM audit_events WHERE kind='room_member_kicked' AND details->>'roomId'=$1", [roomId]);
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0]!.actor_id, identities[0]!.actor.id);
  assert.equal(audit.rows[0]!.user_id, identities[1]!.actor.id);
  assert.deepEqual(audit.rows[0]!.details, { roomId, seatIndex: 2, kickedUserId: identities[1]!.actor.id });

  // 1051: the removed player has no active room any more.
  const gone = await target.request(17, { hwRequestOwnerTiren: { seatIndex: 3 } }, 18);
  assert.equal(gone.extension?.error?.code, 'KICK_ROOM_NOT_FOUND');
  assert.equal((gone.frame.data.hwResponseOwnerTiren as any).result, 1051);

  // 1052: a seated non-owner may not kick someone else.
  const forbidden = await third.request(17, { hwRequestOwnerTiren: { seatIndex: 3 } }, 18);
  assert.equal(forbidden.extension?.error?.code, 'KICK_OWNER_MISMATCH');
  assert.equal((forbidden.frame.data.hwResponseOwnerTiren as any).result, 1052);
  // The owner's own seat holds no removable player.
  const self = await owner.request(17, { hwRequestOwnerTiren: { seatIndex: 1 } }, 18);
  assert.equal(self.extension?.error?.code, 'KICK_TARGET_NOT_IN_ROOM');
  assert.equal((self.frame.data.hwResponseOwnerTiren as any).result, 1053);

  // 1053: an empty seat holds no removable player.
  const emptySeat = await owner.request(17, { hwRequestOwnerTiren: { seatIndex: 2 } }, 18);
  assert.equal(emptySeat.extension?.error?.code, 'KICK_TARGET_NOT_IN_ROOM');
  assert.equal((emptySeat.frame.data.hwResponseOwnerTiren as any).result, 1053);

  // 1054: kicking is unavailable once a round has started.
  await db.query("UPDATE rooms SET state='playing',current_round=1 WHERE id=$1", [roomId]);
  const late = await owner.request(17, { hwRequestOwnerTiren: { seatIndex: 3 } }, 18);
  assert.equal(late.extension?.error?.code, 'KICK_ROOM_STARTED');
  assert.equal((late.frame.data.hwResponseOwnerTiren as any).result, 1054);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM room_members WHERE room_id=$1', [roomId])).rows[0]!.n, 2);
  assert.equal((await rooms.current(identities[2]!.actor.id))!.members.length, 2);
});

test('第三轮 R5：只留大厅时，保留座位的人按房号进房就是继续（保留清掉），没座位的人进不来', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const ledger = new LedgerService(db); const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {}, lobbyOnly: true });
  const address = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const clients: Awaited<ReturnType<typeof openWireTestClient>>[] = [];
  t.after(async () => { for (const client of clients) await client.close(); await app.close(); await db.close(); });
  const owner = await auth.create('hold_wire_owner', 'test-password-only');
  const held = await auth.create('hold_wire_held', 'test-password-only');
  const stranger = await auth.create('hold_wire_stranger', 'test-password-only');
  const beans = await auth.create('hold_wire_beans', 'test-password-only', 'beans_admin');
  await ledger.adjust(beans, held.id, '50', 'hold wire funding', `hold-wire-${held.id}`);
  const room = await rooms.create(owner, '4:0', { ...getDefaultOptions('4:0'), playerNum: 3, baseBeans: '1' });
  await db.query("INSERT INTO room_members(room_id,user_id,seat,hold_until) VALUES($1,$2,2,now()+interval '15 seconds')", [room.id, held.id]);
  async function enter(actor: typeof owner) {
    const client = await openWireTestClient(address); clients.push(client);
    await client.request(1, { hwRequestGameLogin: { token: (await auth.login(actor.username, 'test-password-only')).token } }, 2);
    return client.request(5, { hwRequestEnterTable: { roomId: Number(room.code) } }, 6);
  }
  const continued = await enter(held);
  assert.equal((continued.frame.data.hwResponseEnterTable as any).result, 1, JSON.stringify(continued.extension));
  const row = (await db.query('SELECT seat,hold_until FROM room_members WHERE room_id=$1 AND user_id=$2', [room.id, held.id])).rows[0];
  assert.deepEqual([row.seat, row.hold_until], [2, null]);
  const refused = await enter(stranger);
  assert.notEqual((refused.frame.data.hwResponseEnterTable as any).result, 1);
  assert.equal((refused.extension as any)?.error?.code, 'UNSUPPORTED_OPERATION', JSON.stringify(refused.extension));
});
