import { encodeFixtureFrame as encodeFrame } from './fixture-options.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { decodeFrame,  expectedBodyField, type DecodedFrame } from '@dss/protocol';
import { getFixtureOptions as getDefaultOptions } from './fixture-options.js';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService } from '../src/auth.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { EngineRegistry, type RuleEngine, type EnginePlayer } from '../src/engines.js';
import { decodeOriginalExtension, encodeOriginalResponse, registerOriginalProtocol, type OriginalExtension } from '../src/original-wire.js';

interface State { players: EnginePlayer[]; actions: number }
const actions = [{ kind: 'move', value: 1, finish: false }, { kind: 'move', value: 0, finish: true }, { kind: 'piao', status: 1 }];
// Exercises transport only; this is not a regional game or a reference rule case.
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'original-transport-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-original-transport-only' },
  create(input): State { return { players: input.players, actions: 0 }; },
  apply(raw, _userId, action) {
    const state = raw as State;
    const settlement = state.players.map((player, index) => ({ userId: player.userId, amount: index ? '-0.125' : '0.125' }));
    return { snapshot: { ...state, actions: state.actions + 1 }, events: [{ type: 'fixture-only' }],
      ...((action as { finish?: boolean }).finish ? { confirmedScores: [{ eventId: 'finish-score', postings: settlement }], settlement } : {}) };
  },
  view(raw) { return { actions: (raw as State).actions }; },
  interactions: { legalActions: () => actions, deadlines: () => [], autoPlay: () => null },
  original: {
    decodeAction(command, body) { return command === 53 ? { kind: 'piao', status: body.piaoStatus } : { kind: 'move', value: body.destCard ?? 0, finish: body.actType === 9 }; },
    response(command, body, raw) { return { body: command === 53 ? { result: 1 } : { result: 1, actType: body.actType, tilesOnHandNum: (raw as State).actions } }; },
    enter(raw) { return { body: { tableState: 1, leftCardNum: 7 + (raw as State).actions } }; },
    notifications(raw, _events, userId, phase) {
      const state = raw as State;
      const seat = state.players.find(player => player.userId === userId)!.seat;
      return phase === 'start' ? [{ command: 11, body: { round: 1 } }, { command: 20, body: { seatIndex: seat } }]
        : [{ command: 25, body: { seatIndex: seat } }, { command: 26, body: { seatIndex: seat } }];
    },
  },
};

interface Received { frame: DecodedFrame; extension?: OriginalExtension }
async function connect(url: string) {
  const socket = new WebSocket(url); const inbox: Received[] = [];
  socket.on('message', bytes => inbox.push({ frame: decodeFrame(bytes as Buffer), extension: decodeOriginalExtension(bytes as Buffer) }));
  await once(socket, 'open');
  function wait(command: number, start: number, predicate: (item: Received) => boolean = () => true): Promise<Received> {
    const search = () => inbox.slice(start).find(item => item.frame.cmd === command && predicate(item));
    const found = search(); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const listener = () => { const item = search(); if (item) { clearTimeout(timer); socket.off('message', listener); resolve(item); } };
      const timer = setTimeout(() => { socket.off('message', listener); reject(new Error(`Missing original message ${command}`)); }, 5000);
      socket.on('message', listener);
    });
  }
  async function request(command: number, body: Record<string, unknown>, response: number, extension?: unknown, uid = '') {
    // Respect the production connection's 20 messages/second limit.
    await delay(60);
    const start = inbox.length;
    socket.send(extension === undefined ? encodeFrame({ cmd: command, uid, protoVersion: 2 }, { [expectedBodyField(command)!]: body })
      : encodeOriginalResponse(command, body, uid, { ...(command === 3 ? { createRoom: { baseBeans: '0.1' } } : {}), ...extension as Partial<OriginalExtension> }));
    return wait(response, start);
  }
  return { socket, inbox, wait, request, async close() { if (socket.readyState !== WebSocket.CLOSED) { socket.close(); await once(socket, 'close'); } } };
}

test('original actions use authenticated seats, immutable acknowledgements and ordered versioned projections', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const ledger = new LedgerService(db); const policies = new PolicyService(db);
  const registry = new EngineRegistry([fixture]); const rooms = new RoomService(db, registry, policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const url = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const clients: Awaited<ReturnType<typeof connect>>[] = [];
  t.after(async () => { for (const client of clients) await client.close(); await app.close(); await db.close(); });
  const admin = await auth.create('original_meta_admin', 'test-password-only', 'beans_admin');
  const players = [await auth.create('original_meta_first', 'test-password-only'), await auth.create('original_meta_second', 'test-password-only')];
  const sessions = [];
  for (const player of players) {
    await ledger.adjust(admin, player.id, '10', 'wire transport test fixture', `original-meta-fund-${player.id}`);
    sessions.push(await auth.login(player.username, 'test-password-only'));
  }
  const a = await connect(url); const b = await connect(url); clients.push(a, b);
  const loginA = await a.request(1, { token: sessions[0]!.token }, 2);
  const loginB = await b.request(1, { token: sessions[1]!.token }, 2);
  assert.deepEqual(loginA.extension!.roomState, { roomId: null, roundId: null, stateVersion: null });
  const otherUid = (loginB.frame.data.hwResponseGameLogin as any).uid;
  const create = await a.request(3, { ...getDefaultOptions('4:0'), playerNum: 2, gameNum: 4, roomType: 100, areaType: 4 }, 4);
  const roomId = create.extension!.roomState!.roomId!;
  const code = (create.frame.data.hwResponseCreateTable as any).tableInfo.roomId;
  assert.deepEqual(create.extension!.roomState, { roomId, roundId: null, stateVersion: null });
  await b.request(5, { roomId: code }, 6);
  await a.request(47, { roomId: code }, 48); await b.request(47, { roomId: code }, 48);
  const mark = a.inbox.length;
  await a.request(8, { state: true }, 9); await b.request(8, { state: true }, 9);
  const started = await a.wait(11, mark); await a.wait(20, mark);
  const roundId = started.extension!.roomState!.roundId!;
  assert.deepEqual(started.extension!.roomState, { roomId, roundId, stateVersion: 0 });
  assert.deepEqual(a.inbox.slice(mark).filter(item => [11, 20].includes(item.frame.cmd)).map(item => item.frame.cmd), [11, 20]);
  const metadata = (commandId: string, version = 0, extra: Record<string, unknown> = {}) => ({ request: { commandId, roomId, expectedRoundId: roundId, expectedStateVersion: version, ...extra } });

  await t.test('missing and malformed metadata cannot change state and valid IDs receive failure acknowledgements', async () => {
    const missing = await a.request(23, { destCard: 1 }, 24);
    assert.equal(missing.extension!.error!.code, 'ACTION_METADATA_REQUIRED');
    const cases = [
      { ...metadata('original-bad-decimal'), decimalFields: [{ path: ['hwRequestDoAction', 'destCard'], value: '2' }] },
      { ...metadata('original-server-cursor'), roomState: { roomId, roundId, stateVersion: 0 } },
      { ...metadata('original-server-ack'), ack: { commandId: 'original-server-ack' } },
      { ...metadata('original-extra-field'), unexpected: true },
      metadata('original-invalid-version', -1), metadata('original-invalid-room', 0, { roomId: '123456' }),
    ];
    for (const extension of cases) {
      const failed = await a.request(23, { destCard: 1 }, 24, extension);
      assert.equal(failed.extension!.error!.code, 'INVALID_EXTENSION');
      assert.equal(failed.extension!.ack!.commandId, extension.request.commandId);
    }
    const incomplete = await a.request(23, { destCard: 1 }, 24, { request: { commandId: 'original-incomplete', roomId } });
    assert.equal(incomplete.extension!.error!.code, 'ACTION_METADATA_REQUIRED');
    assert.equal(incomplete.extension!.ack!.commandId, 'original-incomplete');
    assert.equal((await rooms.view(roomId, players[0]!.id)).stateVersion, 0);
  });

  await t.test('other seats, rooms and old round versions are rejected using the token identity', async () => {
    for (const [body, extension, error] of [
      [{ seatIndex: 2, destCard: 1 }, metadata('original-other-seat'), 'INVALID_ACTOR_SEAT'],
      [{ destCard: 1 }, metadata('original-other-room', 0, { roomId: randomUUID() }), 'ROOM_NOT_FOUND'],
      [{ destCard: 1 }, metadata('original-other-round', 0, { expectedRoundId: randomUUID() }), 'ROUND_VERSION_CONFLICT'],
      [{ destCard: 1 }, metadata('original-stale-version', 1), 'STATE_VERSION_CONFLICT'],
    ] as const) {
      const failed = await a.request(23, body, 24, extension, otherUid);
      assert.equal(failed.extension!.error!.code, error);
      assert.equal(failed.extension!.ack!.commandId, extension.request.commandId);
    }
  });

  await t.test('accepted actions publish flow before choices and exact retries never reapply', async () => {
    const start = a.inbox.length;
    const first = await a.request(23, { seatIndex: 1, actType: 1, destCard: 1 }, 24, metadata('original-accepted-move'), otherUid);
    assert.equal(first.extension!.error, undefined);
    assert.equal(first.extension!.ack!.commandId, 'original-accepted-move');
    assert.equal((first.frame.data.hwResponseDoAction as any).tilesOnHandNum, 1);
    await a.wait(26, start);
    const flow = a.inbox.slice(start).filter(item => [25, 26].includes(item.frame.cmd));
    assert.deepEqual(flow.map(item => item.frame.cmd), [25, 26]);
    for (const item of flow) assert.deepEqual(item.extension!.roomState, { roomId, roundId, stateVersion: 1 });
    const retry = await a.request(23, { seatIndex: 1, actType: 1, destCard: 1 }, 24, metadata('original-accepted-move'));
    assert.deepEqual(retry.frame.data, first.frame.data);
    assert.equal((await rooms.view(roomId, players[0]!.id)).stateVersion, 1);
    const changed = await a.request(23, { seatIndex: 1, actType: 2, destCard: 1 }, 24, metadata('original-accepted-move'));
    assert.equal(changed.extension!.error!.code, 'IDEMPOTENCY_CONFLICT');
    const piao = await a.request(53, { piaoStatus: 1 }, 54, metadata('original-piao-command', 1));
    assert.equal(piao.extension!.error, undefined); assert.equal(piao.extension!.roomState!.stateVersion, 2);
  });

  await t.test('autoplay touches only the authenticated player and notification 123 is never sent to another seat', async () => {
    const markA = a.inbox.length; const markB = b.inbox.length;
    const request = { request: { commandId: 'original-auto-command', roomId } };
    const enabled = await a.request(121, {}, 122, request, otherUid);
    assert.equal(enabled.extension!.ack!.commandId, 'original-auto-command');
    await a.wait(123, markA);
    await b.request(37, {}, 38);
    assert.equal(b.inbox.slice(markB).some(item => item.frame.cmd === 123), false);
    const view = await rooms.view(roomId, players[0]!.id);
    assert.deepEqual(view.members.map(member => member.autoPlay), [true, false]);
    const duplicate = await a.request(121, {}, 122, request);
    assert.equal(duplicate.extension!.error, undefined);
    const conflicting = await a.request(125, {}, 126, request);
    assert.equal(conflicting.extension!.error!.code, 'IDEMPOTENCY_CONFLICT');
    await a.request(125, {}, 126, { request: { commandId: 'original-cancel-command', roomId } });
    assert.deepEqual((await rooms.view(roomId, players[0]!.id)).members.map(member => member.autoPlay), [false, false]);
  });

  await t.test('reconnection returns an adapter snapshot and settlement retries keep the archived reply', async () => {
    const reconnect = await connect(url); clients.push(reconnect);
    const login = await reconnect.request(1, { token: sessions[0]!.token }, 2);
    assert.deepEqual(login.extension!.roomState, { roomId, roundId, stateVersion: 2 });
    const entered = await reconnect.request(47, { roomId: code }, 48);
    assert.equal((entered.frame.data.hwResponseEnterTableFinish as any).tableState, 1);
    assert.equal((entered.frame.data.hwResponseEnterTableFinish as any).leftCardNum, 9);
    assert.deepEqual(entered.extension!.roomState, { roomId, roundId, stateVersion: 2 });
    const finishRequest = metadata('original-finish-command', 2);
    const finished = await a.request(23, { actType: 9 }, 24, finishRequest);
    assert.equal((finished.frame.data.hwResponseDoAction as any).tilesOnHandNum, 3);
    assert.deepEqual(finished.extension!.roomState, { roomId, roundId: null, stateVersion: null });
    const retry = await a.request(23, { actType: 9 }, 24, finishRequest);
    assert.deepEqual(retry.frame.data, finished.frame.data);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM ledger_operations WHERE kind='round_settlement'")).rows[0]!.n, 1);
    await a.request(8, { state: true }, 9); await b.request(8, { state: true }, 9);
    const nextRound = await rooms.view(roomId, players[0]!.id);
    const laterRetry = await a.request(23, { actType: 9 }, 24, finishRequest);
    assert.deepEqual(laterRetry.frame.data, finished.frame.data);
    assert.deepEqual(laterRetry.extension!.roomState, { roomId, roundId: nextRound.roundId, stateVersion: 0 });
    await rooms.dissolve(players[0]!, roomId, true); await rooms.dissolve(players[1]!, roomId, true);
    const closedRetry = await a.request(23, { actType: 9 }, 24, finishRequest);
    assert.deepEqual(closedRetry.frame.data, finished.frame.data);
    assert.deepEqual(closedRetry.extension!.roomState, { roomId: null, roundId: null, stateVersion: null });
  });

  await t.test('a rule engine without an original adapter fails closed', async () => {
    registry.register({ ...fixture, version: 'original-no-adapter-fixture', original: undefined });
    const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
    await rooms.join(players[1]!, room.code);
    const deniedReady = await a.request(8, { state: true }, 9);
    assert.equal(deniedReady.extension!.error!.code, 'ORIGINAL_ADAPTER_UNAVAILABLE');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM ledger_operations WHERE kind='room_fee' AND room_id=$1", [room.id])).rows[0]!.n, 0);
    await rooms.ready(players[0]!, room.id, true);
    const state = await rooms.ready(players[1]!, room.id, true);
    const request = { request: { commandId: 'original-no-adapter-action', roomId: room.id, expectedRoundId: state.roundId, expectedStateVersion: 0 } };
    const denied = await a.request(23, { destCard: 1 }, 24, request);
    assert.equal(denied.extension!.error!.code, 'ORIGINAL_ADAPTER_UNAVAILABLE');
    const resume = await a.request(47, { roomId: Number(room.code) }, 48);
    assert.equal(resume.extension!.error!.code, 'ORIGINAL_ADAPTER_UNAVAILABLE');
    assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 0);
  });
});

test('wire clients negotiate response windows; same opening version is accepted for different waiting responders', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db), ledger = new LedgerService(db), policies = new PolicyService(db);
  const windowEngine: RuleEngine = { ...fixture, version: 'wire-window-fixture',
    create: input => ({ players: input.players, actions: 0, replies: [] }),
    apply: (raw, userId) => { const state = raw as State & { replies: string[] };
      return { snapshot: { ...state, actions: state.actions + 1, replies: [...state.replies, userId] }, events: [] }; },
    interactions: { ...fixture.interactions!,
      responseWindow: (raw, userId) => (raw as { replies: string[] }).replies.includes(userId) ? null : 'choice:one',
      legalActions: (raw, userId) => (raw as { replies: string[] }).replies.includes(userId) ? [] : [actions[0]],
    } };
  const rooms = new RoomService(db, new EngineRegistry([windowEngine]), policies);
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const url = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const a = await connect(url), b = await connect(url), old = await connect(url);
  t.after(async () => { await a.close(); await b.close(); await old.close(); await app.close(); await db.close(); });
  const admin = await auth.create('window_wire_admin', 'test-password-only', 'beans_admin');
  const players = await Promise.all(['one', 'two', 'old'].map(suffix => auth.create('wire_window_' + suffix, 'test-password-only')));
  for (const player of players) await ledger.adjust(admin, player.id, '10', 'Wire window fixture', 'fund-' + player.id);
  const sessions = await Promise.all(players.map(player => auth.login(player.username, 'test-password-only')));
  await a.request(1, { token: sessions[0]!.token }, 2, { capabilities: ['decision-window-v1'] });
  await b.request(1, { token: sessions[1]!.token }, 2, { capabilities: ['decision-window-v1'] });
  await old.request(1, { token: sessions[2]!.token }, 2);
  const options = { ...getDefaultOptions('4:0'), playerNum: 2, roomType: 100, areaType: 4 };
  assert.equal((await old.request(3, options, 4)).extension?.error?.code, 'CLIENT_UPGRADE_REQUIRED');
  const created = await a.request(3, options, 4);
  const roomId = created.extension!.roomState!.roomId!;
  const code = (created.frame.data.hwResponseCreateTable as any).tableInfo.roomId;
  await b.request(5, { roomId: code }, 6);
  const mark = a.inbox.length;
  await a.request(8, { state: true }, 9); await b.request(8, { state: true }, 9);
  const projection = await a.wait(20, mark);
  assert.equal(projection.extension?.decisionId, 'choice:one');
  const roundId = projection.extension!.roomState!.roundId!;
  const request = (commandId: string) => ({ request: { commandId, roomId, expectedRoundId: roundId, expectedStateVersion: 0, decisionId: 'choice:one' } });
  assert.equal((await a.request(23, { actType: 1, destCard: 1 }, 24, request('wire-window-first'))).extension?.error, undefined);
  const restored = await b.request(47, { roomId: code }, 48);
  assert.equal(restored.extension?.decisionId, 'choice:one');
  assert.equal((await b.request(23, { actType: 1, destCard: 1 }, 24, request('wire-window-second'))).extension?.error, undefined);
  assert.equal((await rooms.view(roomId, players[0]!.id)).stateVersion, 2);
});
