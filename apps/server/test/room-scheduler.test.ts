import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, type Actor } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { ReplayService } from '../src/replays.js';
import { RoomScheduler } from '../src/room-scheduler.js';
import type { InteractionState } from '../src/engine-interactions.js';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

interface State { players: EnginePlayer[]; responded: string[] }
// These two arbitrary responses test scheduling infrastructure, not a regional game.
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'deadline-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-deadline-infrastructure-only' },
  create(input): State { return { players: input.players, responded: [] }; },
  apply(raw, userId) {
    const state = raw as State;
    const snapshot = { ...state, responded: [...state.responded, userId] };
    const settlement = state.players.map((player, index) => ({ userId: player.userId, amount: index ? '-0.125' : '0.125' }));
    return { snapshot, events: [], ...(snapshot.responded.length === state.players.length
      ? { confirmedScores: [{ eventId: 'fixture-finish', postings: settlement }], settlement } : {}) };
  },
  view(raw, userId) { const state = raw as State; return { responded: state.responded, ownCard: 10 + state.players.find(player => player.userId === userId)!.seat }; },
  interactions: {
    legalActions(raw, userId) { const state = raw as State; const player = state.players.find(item => item.userId === userId);
      return !player || state.responded.includes(userId) ? [] : [{ type: 'pass' }, { type: 'play', card: 10 + player.seat }]; },
    deadlines(raw) { const state = raw as State; return state.players.filter(player => !state.responded.includes(player.userId)).map(player => ({
      decisionId: `response:${player.seat}`, userId: player.userId, delayMs: 1000 + player.seat * 1000, action: { type: 'pass' },
    })); },
    autoPlay(raw, userId) { const state = raw as State; const player = state.players.find(item => item.userId === userId);
      return !player || state.responded.includes(userId) ? null : { decisionId: `response:${player.seat}`, delayMs: 100, action: { type: 'pass' } }; },
  },
};

test('legal actions, deadlines and autoplay are durable engine-owned decisions', async t => {
  const db = await openDatabase();
  try {
    await migrate(db);
    const auth = new AuthService(db);
    const ledger = new LedgerService(db);
    const admin = await auth.create('scheduler_beans', 'test-password-only', 'beans_admin');
    const dealer = await auth.create('scheduler_dealer', 'test-password-only', 'deal_admin');
    const policies = new PolicyService(db);
    let clock = 1800000000000;
    let serial = 0;
    const registry = new EngineRegistry([fixture]);
    const rooms = new RoomService(db, registry, policies, () => clock);
    const replays = new ReplayService(db, registry);
    async function pair(service = rooms, start = true) {
      const players: Actor[] = [];
      for (let index = 0; index < 2; index++) {
        const player = await auth.create(`scheduler_player_${++serial}`, 'test-password-only');
        await ledger.adjust(admin, player.id, '10', 'scheduler fixture funding', `scheduler-funding-${serial}`);
        players.push(player);
      }
      const room = await service.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
      await service.join(players[1]!, room.code);
      if (start) for (const player of players) await service.ready(player, room.id, true);
      return { room, players, roundId: (await service.view(room.id, players[0]!.id)).roundId! };
    }
    const state = async (roundId: string) => (await db.query('SELECT interaction_state FROM rounds WHERE id=$1', [roundId])).rows[0]!.interaction_state as InteractionState;

    await t.test('only the viewer sees their legal actions; another response does not reset a pending deadline', async () => {
      const base = clock;
      const { room, players, roundId } = await pair();
      const first = await rooms.view(room.id, players[0]!.id);
      assert.deepEqual(first.legalActions, [{ type: 'pass' }, { type: 'play', card: 11 }]);
      assert.deepEqual(first.operationTimers, [{ kind: 'timeout', decisionId: 'response:1', dueAt: base + 2000 }]);
      assert.deepEqual((await rooms.view(room.id, players[1]!.id)).legalActions, [{ type: 'pass' }, { type: 'play', card: 12 }]);
      await assert.rejects(rooms.action(players[0]!, room.id, 'scheduler-illegal-card', { type: 'play', card: 12 }, 0, roundId), { code: 'ILLEGAL_ACTION' });
      await assert.rejects(rooms.setAutoPlay(dealer, room.id, true, 'scheduler-admin-autoplay'), { code: 'FORBIDDEN' });
      assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 0);
      const original = await state(roundId);
      const secondDeadline = original.timers.find(timer => timer.userId === players[1]!.id)!;
      clock = base + 500;
      await rooms.action(players[0]!, room.id, 'scheduler-manual-first', { type: 'play', card: 11 }, 0, roundId);
      assert.deepEqual((await state(roundId)).timers, [secondDeadline]);
      await assert.rejects(db.query("UPDATE rounds SET initial_interaction_state='{}' WHERE id=$1", [roundId]), /immutable/);
      const restored = new RoomService(db, new EngineRegistry([fixture]), new PolicyService(db), () => clock);
      clock = base + 3000;
      await assert.rejects(restored.action(players[1]!, room.id, 'scheduler-too-late', { type: 'pass' }, 1, roundId), { code: 'ACTION_DEADLINE_EXPIRED' });
      assert.ok((await restored.dueRoomIds()).includes(room.id));
      const attempts = await Promise.all(Array.from({ length: 16 }, () => restored.applyDueAction(room.id)));
      assert.equal(attempts.filter(Boolean).length, 1);
      assert.equal((await restored.view(room.id, players[0]!.id)).state, 'between_rounds');
      assert.equal(await ledger.balance(players[0]!.id), '10.125');
      assert.equal(await ledger.balance(players[1]!.id), '9.875');
      const replay = await replays.read(players[0]!, room.id, roundId);
      assert.deepEqual(replay.frames.map(frame => frame.stateVersion), [0, 1, 2]);
      assert.equal((await state(roundId)).timers.length, 0);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM game_events WHERE room_id=$1 AND payload->>'source'='timeout'", [room.id])).rows[0]!.count, 1);
    });

    await t.test('autoplay toggles cancel only autoplay timers and replay their exact scheduling history', async () => {
      const base = clock += 10000;
      const { room, players, roundId } = await pair();
      const timeout = (await state(roundId)).timers.find(timer => timer.userId === players[0]!.id)!;
      clock = base + 10;
      await rooms.setAutoPlay(players[0]!, room.id, true, 'autoplay-enable-once');
      const enabled = await state(roundId);
      const autoplay = enabled.timers.find(timer => timer.kind === 'autoplay')!;
      assert.equal(autoplay.dueAt, base + 110);
      clock = base + 20;
      await rooms.setAutoPlay(players[0]!, room.id, true, 'autoplay-enable-once');
      assert.deepEqual(await state(roundId), enabled);
      await assert.rejects(rooms.setAutoPlay(players[0]!, room.id, false, 'autoplay-enable-once'), { code: 'IDEMPOTENCY_CONFLICT' });
      clock = base + 50;
      await rooms.setAutoPlay(players[0]!, room.id, false, 'autoplay-disable-once');
      assert.equal((await state(roundId)).timers.some(timer => timer.kind === 'autoplay'), false);
      assert.deepEqual((await state(roundId)).timers.find(timer => timer.userId === players[0]!.id), timeout);
      clock = base + 110;
      assert.equal(await rooms.applyDueAction(room.id), false);
      clock = base + 200;
      await rooms.setAutoPlay(players[0]!, room.id, true, 'autoplay-enable-again');
      assert.notEqual((await state(roundId)).timers.find(timer => timer.kind === 'autoplay')!.id, autoplay.id);
      clock = base + 300;
      const errors: unknown[] = [];
      const scheduler = new RoomScheduler(rooms, { onError: error => errors.push(error) });
      const results = await Promise.all(Array.from({ length: 12 }, () => scheduler.poll()));
      assert.ok(results.every(result => result.applied === 1 && result.failed === 0));
      assert.equal(errors.length, 0);
      await scheduler.stop();
      assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 1);
      clock = base + 301;
      await rooms.action(players[1]!, room.id, 'autoplay-peer-finish', { type: 'pass' }, 1, roundId);
      const replay = await replays.read(players[0]!, room.id, roundId);
      assert.deepEqual(replay.frames.map(frame => frame.autoPlayUserIds.includes(players[0]!.id)), [false, true, false, true, true, true]);
      assert.deepEqual(replay.frames.map(frame => frame.stateVersion), [0, 0, 0, 0, 1, 2]);
      for (const player of players) await rooms.ready(player, room.id, true);
      const next = await rooms.view(room.id, players[0]!.id);
      assert.equal(next.members.find(member => member.userId === players[0]!.id)!.autoPlay, true);
      assert.equal((await state(next.roundId!)).autoPlayUserIds.includes(players[0]!.id), true);
      await rooms.dissolve(players[0]!, room.id, true);
      await rooms.dissolve(players[1]!, room.id, true);
    });

    await t.test('two scheduler instances and concurrent manual requests cannot execute the same deadline twice', async () => {
      const base = clock += 10000;
      const { room, players, roundId } = await pair();
      clock = base + 2000;
      const failures: unknown[] = [];
      const schedulerA = new RoomScheduler(rooms, { onError: error => failures.push(error) });
      const schedulerB = new RoomScheduler(new RoomService(db, registry, policies, () => clock), { onError: error => failures.push(error) });
      const manual = assert.rejects(rooms.action(players[0]!, room.id, 'scheduler-racing-manual', { type: 'pass' }, 0, roundId),
        (error: unknown) => ['STATE_VERSION_CONFLICT', 'ACTION_DEADLINE_EXPIRED'].includes((error as { code: string }).code));
      const results = await Promise.all([schedulerA.poll(), schedulerB.poll()]);
      await manual;
      assert.equal(results.reduce((sum, result) => sum + result.applied, 0), 1);
      assert.equal(failures.length, 0);
      await assert.rejects(rooms.action(players[0]!, room.id, 'scheduled-user-forgery', { type: 'pass' }, 1, roundId), { code: 'INVALID_COMMAND_ID' });
      assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 1);
      schedulerA.start();
      await schedulerA.stop();
      await schedulerB.stop();
      await rooms.dissolve(players[0]!, room.id, true);
      await rooms.dissolve(players[1]!, room.id, true);
      assert.equal(await rooms.applyDueAction(room.id), false);
      const replay = await replays.read(players[0]!, room.id, roundId);
      assert.equal(replay.endReason, 'dissolved');
      assert.deepEqual((await state(roundId)).timers, []);
    });

    await t.test('invalid automatic engine declarations roll back first deal and fees', async () => {
      const invalid: RuleEngine = { ...fixture, version: 'illegal-timeout-fixture', interactions: { ...fixture.interactions!,
        deadlines(raw) { return [{ decisionId: 'invalid', userId: (raw as State).players[0]!.userId, delayMs: 100, action: { type: 'not-legal' } }]; } } };
      const badRooms = new RoomService(db, new EngineRegistry([invalid]), policies, () => clock);
      const { room, players } = await pair(badRooms, false);
      await badRooms.ready(players[0]!, room.id, true);
      await assert.rejects(badRooms.ready(players[1]!, room.id, true), { code: 'INVALID_ENGINE_INTERACTIONS' });
      assert.equal((await badRooms.view(room.id, players[0]!.id)).currentRound, 0);
      assert.equal(await ledger.balance(players[0]!.id), '10');
      assert.equal(await ledger.balance(players[1]!.id), '10');
      assert.equal((await db.query('SELECT count(*)::int AS count FROM rounds WHERE room_id=$1', [room.id])).rows[0]!.count, 0);
    });

    await t.test('an automatic action failure is observable and does not block another due room', async () => {
      const base = clock += 10000;
      const broken: RuleEngine = { ...fixture, version: 'throwing-timeout-fixture', apply() { throw new Error('Deliberate fixture failure'); } };
      const badRooms = new RoomService(db, new EngineRegistry([broken]), policies, () => clock);
      const bad = await pair(badRooms);
      const good = await pair();
      const combined = new RoomService(db, new EngineRegistry([broken, fixture]), policies, () => clock);
      clock = base + 2000;
      const errors: { error: unknown; roomId?: string }[] = [];
      const scheduler = new RoomScheduler(combined, { onError: (error, roomId) => errors.push({ error, roomId }) });
      assert.deepEqual(await scheduler.poll(), { checked: 2, applied: 1, failed: 1 });
      assert.equal(errors[0]!.roomId, bad.room.id);
      assert.equal((await badRooms.view(bad.room.id, bad.players[0]!.id)).stateVersion, 0);
      assert.equal((await rooms.view(good.room.id, good.players[0]!.id)).stateVersion, 1);
      await scheduler.stop();
    });

    await t.test('archived engines keep their original create/apply/view contract and gain no guessed timers', async () => {
      const legacy: RuleEngine = { ...fixture, version: 'archived-without-interactions', interactions: undefined };
      const oldRooms = new RoomService(db, new EngineRegistry([legacy]), policies, () => clock);
      const { room, players, roundId } = await pair(oldRooms);
      const view = await oldRooms.view(room.id, players[0]!.id);
      assert.equal(view.legalActions, null);
      assert.deepEqual(view.operationTimers, []);
      assert.equal(await state(roundId), null);
      await assert.rejects(oldRooms.setAutoPlay(players[0]!, room.id, true, 'legacy-autoplay-rejected'), { code: 'ENGINE_INTERACTIONS_UNAVAILABLE' });
      await oldRooms.action(players[0]!, room.id, 'legacy-original-apply', { anyOriginalAction: true }, 0, roundId);
      assert.equal((await oldRooms.view(room.id, players[0]!.id)).stateVersion, 1);
      assert.equal(await oldRooms.applyDueAction(room.id), false);
    });
  } finally { await db.close(); }
});

test('reopening an isolated database resumes recorded deadlines without recalculating their start time', async () => {
  const workRoot = fileURLToPath(new URL('../../../../../work/', import.meta.url));
  await mkdir(workRoot, { recursive: true });
  const directory = await mkdtemp(resolve(workRoot, 'scheduler-database-'));
  let db = await openDatabase(undefined, directory);
  let clock = 1800000000000;
  try {
    await migrate(db);
    const auth = new AuthService(db);
    const ledger = new LedgerService(db);
    const admin = await auth.create('durable_scheduler_admin', 'test-password-only', 'beans_admin');
    const players = [await auth.create('durable_scheduler_first', 'test-password-only'), await auth.create('durable_scheduler_second', 'test-password-only')];
    for (const player of players) await ledger.adjust(admin, player.id, '10', 'durable fixture funding', `durable-funding-${player.id}`);
    const rooms = new RoomService(db, new EngineRegistry([fixture]), new PolicyService(db), () => clock);
    const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
    await rooms.join(players[1]!, room.code);
    for (const player of players) await rooms.ready(player, room.id, true);
    const started = await rooms.view(room.id, players[0]!.id);
    const original = (await db.query('SELECT interaction_state FROM rounds WHERE id=$1', [started.roundId])).rows[0]!.interaction_state;
    await db.close();
    db = await openDatabase(undefined, directory);
    const restored = new RoomService(db, new EngineRegistry([fixture]), new PolicyService(db), () => clock);
    assert.deepEqual((await db.query('SELECT interaction_state FROM rounds WHERE id=$1', [started.roundId])).rows[0]!.interaction_state, original);
    clock += 2000;
    assert.equal(await restored.applyDueAction(room.id), true);
    assert.equal(await restored.applyDueAction(room.id), false);
    clock += 1000;
    assert.equal(await restored.applyDueAction(room.id), true);
    assert.equal(await new LedgerService(db).balance(players[0]!.id), '10.125');
    assert.equal(await new LedgerService(db).balance(players[1]!.id), '9.875');
    const replay = await new ReplayService(db, new EngineRegistry([fixture])).read(players[0]!, room.id, started.roundId!);
    assert.deepEqual(replay.frames.map(frame => frame.stateVersion), [0, 1, 2]);
    const changed = { ...fixture, interactions: { ...fixture.interactions!, deadlines(raw: unknown) {
      return fixture.interactions!.deadlines(raw).map(timer => ({ ...timer, delayMs: timer.delayMs + 1 }));
    } } };
    await assert.rejects(new ReplayService(db, new EngineRegistry([changed])).read(players[0]!, room.id, started.roundId!), { code: 'REPLAY_DIVERGED' });
  } finally {
    await db.close();
    assert.ok(resolve(directory).startsWith(resolve(workRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
