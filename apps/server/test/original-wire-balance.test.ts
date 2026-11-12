import { encodeFixtureFrame as encodeFrame } from './fixture-options.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { decodeFrame,  MSGEvent, type DecodedFrame } from '@dss/protocol';
import { getFixtureOptions as getDefaultOptions } from './fixture-options.js';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService, type Actor } from '../src/auth.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';
import { decodeOriginalExtension, registerOriginalProtocol, type OriginalExtension } from '../src/original-wire.js';

interface Received { frame: DecodedFrame; extension?: OriginalExtension }

async function openClient(url: string) {
  const socket = new WebSocket(url);
  const inbox: Received[] = [];
  socket.on('message', bytes => {
    const data = bytes as Buffer;
    inbox.push({ frame: decodeFrame(data), extension: decodeOriginalExtension(data) });
  });
  await once(socket, 'open');
  function wait(command: number, start = 0, predicate: (value: Received) => boolean = () => true): Promise<Received> {
    const find = () => inbox.slice(start).find(value => value.frame.cmd === command && predicate(value));
    const existing = find();
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error(`No wire message ${command}`)); }, 3000);
      const listener = () => {
        const value = find();
        if (value) { clearTimeout(timeout); socket.off('message', listener); resolve(value); }
      };
      socket.on('message', listener);
    });
  }
  async function request(command: number, body: Record<string, unknown>, response: number) {
    const start = inbox.length;
    socket.send(encodeFrame({ cmd: command, protoVersion: 2 }, body));
    return wait(response, start);
  }
  async function close() {
    if (socket.readyState !== WebSocket.CLOSED) { socket.close(); await once(socket, 'close'); }
  }
  return { socket, inbox, wait, request, close };
}

// This synthetic engine exercises infrastructure only. It is intentionally
// kept in the test registry and does not register a regional game in production.
interface Snapshot { players: EnginePlayer[]; actions: number; finished: boolean }
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'balance-notification-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-balance-notification-infrastructure-only' },
  create(input) { return { players: input.players, actions: 0, finished: false }; },
  apply(raw, _userId, action) {
    const state = raw as Snapshot;
    const next = { ...state, actions: state.actions + 1 };
    if ((action as { type?: string }).type !== 'settle') return { snapshot: next, events: [] };
    const postings = state.players.map((player, index) => ({ userId: player.userId, amount: index === 0 ? '0.25' : '-0.25' }));
    return { snapshot: { ...next, finished: true }, events: [{ type: 'settled' }],
      confirmedScores: [{ eventId: 'fixture-settlement', postings }], settlement: postings };
  },
  view(raw) { const state = raw as Snapshot; return { actions: state.actions, finished: state.finished }; },
};

test('original wire pushes committed bean changes without heartbeat and deduplicates retries', async t => {
  const db = await openDatabase();
  await migrate(db);
  const app = Fastify();
  await app.register(websocket);
  const auth = new AuthService(db);
  const ledger = new LedgerService(db);
  const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry([fixture]), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const address = `${(await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws')}/ws/original`;
  const clients: Awaited<ReturnType<typeof openClient>>[] = [];
  t.after(async () => {
    for (const client of clients) await client.close();
    await app.close();
    await db.close();
  });

  const admin = await auth.create('wire_balance_admin', 'test-password-only', 'beans_admin');
  const player = await auth.create('wire_balance_player', 'test-password-only');
  await ledger.adjust(admin, player.id, '10', 'opening balance', 'wire-balance-open');
  const client = await openClient(address); clients.push(client);
  const login = await client.request(MSGEvent.HWRequestGameLogin, { hwRequestGameLogin: { account: player.username, password: 'test-password-only' } }, MSGEvent.HWResponseGameLogin);
  const loginBody = login.frame.data.hwResponseGameLogin as Record<string, unknown>;
  assert.equal(client.inbox[0]!.frame.cmd, MSGEvent.HWResponseGameLogin);
  const notificationsBefore = client.inbox.filter(item => item.frame.cmd === MSGEvent.HWNotifyUserDataChange).length;
  await ledger.adjust(admin, player.id, '0.125', 'immediate notification', 'wire-balance-immediate');
  const update = await client.wait(MSGEvent.HWNotifyUserDataChange, 0);
  assert.equal((update.frame.data.hwNotifyUserDataChange as any).uid, loginBody.uid);
  assert.equal(update.extension?.decimalFields.find(field => field.path.join('.') === 'hwNotifyUserDataChange.goldNum')?.value, '10.125');
  assert.equal(client.inbox.filter(item => item.frame.cmd === MSGEvent.HWNotifyUserDataChange).length, notificationsBefore + 1);
  await ledger.adjust(admin, player.id, '0.125', 'immediate notification', 'wire-balance-immediate');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(client.inbox.filter(item => item.frame.cmd === MSGEvent.HWNotifyUserDataChange).length, notificationsBefore + 1);
});

test('original wire pushes settlement and winner room-fee balances after their transactions commit', async t => {
  const db = await openDatabase();
  await migrate(db);
  const app = Fastify();
  await app.register(websocket);
  const auth = new AuthService(db);
  const ledger = new LedgerService(db);
  const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry([fixture]), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const address = `${(await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws')}/ws/original`;
  const clients: Awaited<ReturnType<typeof openClient>>[] = [];
  t.after(async () => {
    for (const client of clients) await client.close();
    await app.close();
    await db.close();
  });

  const admin = await auth.create('wire_room_balance_admin', 'test-password-only', 'beans_admin');
  const players: Actor[] = [
    await auth.create('wire_room_balance_a', 'test-password-only'),
    await auth.create('wire_room_balance_b', 'test-password-only'),
  ];
  for (const [index, player] of players.entries()) await ledger.adjust(admin, player.id, '10', 'opening room balance', `wire-room-open-${index}`);
  const connected = [], uids: unknown[] = [];
  for (const player of players) {
    const client = await openClient(address); clients.push(client);
    const login = await client.request(MSGEvent.HWRequestGameLogin, { hwRequestGameLogin: { account: player.username, password: 'test-password-only' } }, MSGEvent.HWResponseGameLogin);
    uids.push((login.frame.data.hwResponseGameLogin as Record<string, unknown>).uid);
    connected.push(client);
  }
  const goldOf = (client: (typeof connected)[number], start: number, uid: unknown) => client.wait(MSGEvent.HWNotifyUserDataChange, start,
    value => (value.frame.data.hwNotifyUserDataChange as any).uid === uid)
    .then(update => update.extension?.decimalFields.find(field => field.path.join('.') === 'hwNotifyUserDataChange.goldNum')?.value);
  const defaults = getDefaultOptions('4:0');
  const created = await connected[0]!.request(MSGEvent.HWRequestCreateTable, { hwRequestCreateTable: { ...defaults, playerNum: 2, roomType: 100, areaType: 4 } }, MSGEvent.HWResponseCreateTable);
  const code = (created.frame.data.hwResponseCreateTable as any).tableInfo.roomId;
  await connected[1]!.request(MSGEvent.HWRequestEnterTable, { hwRequestEnterTable: { roomId: code } }, MSGEvent.HWResponseEnterTable);
  await connected[0]!.request(MSGEvent.HWRequestEnterTableFinish, { hwRequestEnterTableFinish: { roomId: code } }, MSGEvent.HWResponseEnterTableFinish);
  await connected[1]!.request(MSGEvent.HWRequestEnterTableFinish, { hwRequestEnterTableFinish: { roomId: code } }, MSGEvent.HWResponseEnterTableFinish);
  const room = (await rooms.current(players[0]!.id))!;
  // Call the room service directly here because the original-wire adapter
  // guard intentionally rejects a synthetic engine without a game adapter.
  await rooms.ready(players[0]!, room.id, true);
  await rooms.ready(players[1]!, room.id, true);
  // 开局不扣房费（DEC-20261112-大赢家付房费）。
  assert.equal(await ledger.balance(players[0]!.id), '10');
  const started = await rooms.view(room.id, players[0]!.id);
  const settlementStarts = connected.map(client => client.inbox.length);
  await rooms.action(players[0]!, room.id, 'wire-room-settlement', { type: 'settle' }, started.stateVersion!, started.roundId!);
  // 自己和同桌的人都收到每一家结算后的豆子（原版头像按 uid 更新那一家）；赢家够 20 倍底分时推的是扣过房费的数。
  const winner = await ledger.balance(players[0]!.id);
  for (const [index, client] of connected.entries()) for (const [seat, uid] of uids.entries())
    assert.equal(await goldOf(client, settlementStarts[index]!, uid), seat === 0 ? winner : '9.75');
});
