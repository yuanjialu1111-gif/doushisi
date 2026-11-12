import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/app.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';

interface State { players: EnginePlayer[]; done: boolean }
// This one-step fixture exercises the HTTP/scheduler integration, not a game rule.
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'autoplay-api-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-http-autoplay-only' },
  create(input): State { return { players: input.players, done: false }; },
  apply(raw) {
    const state = raw as State;
    const settlement = state.players.map((player, index) => ({ userId: player.userId, amount: index ? '-0.125' : '0.125' }));
    return { snapshot: { ...state, done: true }, events: [], confirmedScores: [{ eventId: 'fixture-finish', postings: settlement }], settlement };
  },
  view(raw) { return { done: (raw as State).done }; },
  interactions: {
    legalActions(raw, userId) { const state = raw as State; return !state.done && state.players[0]!.userId === userId ? [{ type: 'finish' }] : []; },
    deadlines(raw) { const state = raw as State; return state.done ? [] : [{ decisionId: 'fixture-decision', userId: state.players[0]!.userId, delayMs: 2000, action: { type: 'finish' } }]; },
    autoPlay(raw, userId) { const state = raw as State; return !state.done && state.players[0]!.userId === userId ? { decisionId: 'fixture-decision', delayMs: 100, action: { type: 'finish' } } : null; },
  },
};

async function startedRoom(services: Awaited<ReturnType<typeof createApp>>, prefix: string) {
  const { auth, ledger, rooms } = services;
  const beans = await auth.create(`${prefix}_beans`, 'test-password-only', 'beans_admin');
  const players = [await auth.create(`${prefix}_first`, 'test-password-only'), await auth.create(`${prefix}_second`, 'test-password-only')];
  for (const player of players) await ledger.adjust(beans, player.id, '10', 'API fixture funding', `api-funding-${player.id}`);
  const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
  await rooms.join(players[1]!, room.code);
  for (const player of players) await rooms.ready(player, room.id, true);
  return { beans, players, room, started: await rooms.view(room.id, players[0]!.id) };
}

test('autoplay JSON endpoint enforces ownership, roles, strict input and immutable request identity', async () => {
  const db = await openDatabase();
  await migrate(db);
  const services = await createApp(db, { engines: new EngineRegistry([fixture]), staticFiles: false, scheduler: false, roomClock: () => 1800000000000 });
  try {
    const { app, auth, rooms } = services;
    const { beans, players, room } = await startedRoom(services, 'http_auto');
    const dealer = await auth.create('http_auto_dealer', 'test-password-only', 'deal_admin');
    const outsider = await auth.create('http_auto_outside', 'test-password-only');
    const tokens = new Map<string, string>();
    for (const actor of [beans, dealer, outsider, ...players]) {
      tokens.set(actor.id, (await auth.login(actor.username, 'test-password-only', actor.role !== 'player')).token);
    }
    const post = (body: object, userId?: string) => app.inject({ method: 'POST', url: `/api/rooms/${room.id}/autoplay`,
      headers: userId ? { authorization: `Bearer ${tokens.get(userId)}` } : {}, payload: body });
    const request = { enabled: true, commandId: 'http-autoplay-enable-once' };
    assert.equal((await post(request)).statusCode, 401);
    for (const actor of [beans, dealer]) {
      const result = await post(request, actor.id);
      assert.equal(result.statusCode, 403);
      assert.equal(result.json().error.code, 'FORBIDDEN');
    }
    assert.equal((await post(request, outsider.id)).json().error.code, 'NOT_ROOM_MEMBER');
    for (const body of [{ enabled: true }, { ...request, enabled: 'true' }, { ...request, userId: players[1]!.id },
      { ...request, action: { type: 'finish' } }, { ...request, commandId: 'tiny' }]) {
      const result = await post(body, players[0]!.id);
      assert.equal(result.statusCode, 400);
      assert.equal(result.json().error.code, 'INVALID_REQUEST');
    }
    assert.ok((await rooms.view(room.id, players[0]!.id)).members.every(member => member.autoPlay === false));
    const enabled = await post(request, players[0]!.id);
    assert.equal(enabled.statusCode, 200);
    assert.equal(enabled.json().members.find((member: { userId: string }) => member.userId === players[0]!.id).autoPlay, true);
    assert.equal(enabled.json().members.find((member: { userId: string }) => member.userId === players[1]!.id).autoPlay, false);
    assert.equal(enabled.json().operationTimers.filter((timer: { kind: string }) => timer.kind === 'autoplay').length, 1);
    assert.equal((await post(request, players[0]!.id)).statusCode, 200);
    assert.equal((await post({ ...request, enabled: false }, players[0]!.id)).json().error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await post(request, players[1]!.id)).json().error.code, 'IDEMPOTENCY_CONFLICT');
    const disabled = await post({ enabled: false, commandId: 'http-autoplay-disable-once' }, players[0]!.id);
    assert.equal(disabled.statusCode, 200);
    assert.equal(disabled.json().operationTimers.some((timer: { kind: string }) => timer.kind === 'autoplay'), false);
    const replayed = await post(request, players[0]!.id);
    assert.equal(replayed.statusCode, 200);
    assert.ok(replayed.json().members.every((member: { autoPlay: boolean }) => member.autoPlay === false));
    assert.equal((await db.query("SELECT count(*)::int AS count FROM game_events WHERE room_id=$1 AND payload->>'type'='autoplay_changed'", [room.id])).rows[0]!.count, 2);
    assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 0);
    assert.equal(await services.ledger.balance(players[0]!.id), '10');
  } finally { await services.app.close(); await db.close(); }
});

test('application readiness automatically resumes an overdue stored action after service replacement', async () => {
  const db = await openDatabase();
  await migrate(db);
  let clock = 1800000000000;
  let services = await createApp(db, { engines: new EngineRegistry([fixture]), staticFiles: false, scheduler: false, roomClock: () => clock });
  try {
    const { room, players, started } = await startedRoom(services, 'ready_auto');
    await services.app.close();
    clock += 2000;
    services = await createApp(db, { engines: new EngineRegistry([fixture]), staticFiles: false, scheduler: { intervalMs: 10 }, roomClock: () => clock });
    const changed = once(services.rooms, 'changed', { signal: AbortSignal.timeout(5000) });
    await services.app.ready();
    assert.equal((await changed)[0], room.id);
    assert.equal((await services.rooms.view(room.id, players[0]!.id)).state, 'between_rounds');
    assert.equal(await services.ledger.balance(players[0]!.id), '10.125');
    assert.equal(await services.ledger.balance(players[1]!.id), '9.875');
    assert.deepEqual(await services.scheduler!.poll(), { checked: 0, applied: 0, failed: 0 });
    const replay = await services.replays.read(players[0]!, room.id, started.roundId!);
    assert.deepEqual(replay.frames.map(frame => frame.stateVersion), [0, 1]);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id])).rows[0]!.count, 1);
  } finally { await services.app.close(); await db.close(); }
});

test('application close drains an in-flight scheduler scan and prevents later polls', async t => {
  for (const fails of [false, true]) await t.test(fails ? 'failed scan also drains during shutdown' : 'successful scan drains during shutdown', async () => {
    const db = await openDatabase();
    await migrate(db);
    const services = await createApp(db, { staticFiles: false, scheduler: { intervalMs: 10 } });
    let release!: () => void;
    let notifyEntered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { notifyEntered = resolve; });
    let scans = 0;
    services.rooms.dueRoomIds = async () => {
      scans++; notifyEntered(); await gate;
      if (fails) throw new Error('Deliberate scan failure');
      return [];
    };
    try {
      await services.app.ready();
      await entered;
      let closed = false;
      const closing = services.app.close().then(() => { closed = true; });
      await delay(20);
      assert.equal(closed, false);
      release();
      await closing;
      const atClose = scans;
      await delay(30);
      assert.equal(scans, atClose);
      assert.equal(scans, 1);
    } finally { release(); await services.app.close(); await db.close(); }
  });
});
