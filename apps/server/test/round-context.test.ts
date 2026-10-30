import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { ReplayService } from '../src/replays.js';
import { RoomService } from '../src/rooms.js';
import { validateNextRoundContext } from '../src/round-context.js';

interface State { players: EnginePlayer[]; dealerId: string; number: number; finished: boolean }
// The outcomes below are synthetic context-transport cases, not regional rules.
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'continuation-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-infrastructure-only' },
  create(input): State {
    if (input.number > 1 && !input.previousRoundContext) throw Object.assign(new Error('Missing context'), { code: 'MISSING_FIXTURE_CONTEXT' });
    return { players: input.players, dealerId: input.previousRoundContext?.dealerId as string ?? input.ownerUserId,
      number: input.number, finished: false };
  },
  apply(raw, userId, rawAction) {
    const state = raw as State;
    const action = rawAction as { type: string };
    const context = { schemaVersion: 1, dealerId: userId, privateMarker: 'not-for-player-projection' };
    if (action.type === 'early') return { snapshot: state, events: [], nextRoundContext: context };
    const postings = state.players.map(player => ({ userId: player.userId, amount: '0' }));
    return { snapshot: { ...state, finished: true }, events: [],
      confirmedScores: [{ eventId: 'terminal', postings }], settlement: postings,
      nextRoundContext: action.type === 'invalid' ? { invalid: NaN } : context };
  },
  view(raw) {
    const state = raw as State;
    return { number: state.number, dealerId: state.dealerId, finished: state.finished };
  },
};

test('context only accepts terminal lossless JSON and returns an independent copy', () => {
  const result = { snapshot: {}, events: [], settlement: [] };
  const circular: Record<string, unknown> = {}; circular.self = circular;
  for (const value of [{ x: NaN }, { x: undefined }, { x: 1n }, { x: new Date() }, [], circular, { x: 'x'.repeat(65536) }]) {
    assert.throws(() => validateNextRoundContext({ ...result, nextRoundContext: value as any }), { code: 'INVALID_ROUND_CONTEXT' });
  }
  assert.throws(() => validateNextRoundContext({ snapshot: {}, events: [], nextRoundContext: {} }), { code: 'INVALID_ROUND_CONTEXT' });
  const source = { dealerId: 'one', values: [null, 2, 'x'] };
  const copy = validateNextRoundContext({ ...result, nextRoundContext: source });
  assert.deepEqual(copy, source);
  assert.notEqual(copy, source);
  assert.equal(validateNextRoundContext(result), null);
});

test('dealer continuation is atomic, immutable, replayed and restored from an isolated on-disk database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dss-context-'));
  let db = await openDatabase(undefined, join(directory, 'db'));
  try {
    await migrate(db);
    let auth = new AuthService(db);
    const admin = await auth.create('context_admin', 'test-password-only', 'beans_admin');
    const players = [await auth.create('context_one', 'test-password-only'), await auth.create('context_two', 'test-password-only')];
    const ledger = new LedgerService(db);
    for (const player of players) await ledger.adjust(admin, player.id, '20', 'test credit', `context-credit-${player.id}`);
    let registry = new EngineRegistry([fixture]);
    let rooms = new RoomService(db, registry, new PolicyService(db));
    const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
    await rooms.join(players[1]!, room.code);
    await rooms.ready(players[0]!, room.id, true);
    const first = await rooms.ready(players[1]!, room.id, true);
    assert.equal((first.game as State).dealerId, players[0]!.id);
    for (const type of ['early', 'invalid']) {
      await assert.rejects(rooms.action(players[1]!, room.id, `invalid-context-${type}`, { type }, 0, first.roundId!),
        { code: 'INVALID_ROUND_CONTEXT' });
      const unchanged = (await db.query('SELECT state_version,next_round_context FROM rounds WHERE id=$1', [first.roundId])).rows[0]!;
      assert.equal(unchanged.state_version, 0);
      assert.equal(unchanged.next_round_context, null);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id])).rows[0]!.n, 0);
    }
    await rooms.action(players[1]!, room.id, 'finish-context-first', { type: 'finish' }, 0, first.roundId!);
    await rooms.action(players[1]!, room.id, 'finish-context-first', { type: 'finish' }, 0, first.roundId!);
    const persisted = (await db.query('SELECT next_round_context FROM rounds WHERE id=$1', [first.roundId])).rows[0]!.next_round_context;
    assert.equal(persisted.dealerId, players[1]!.id);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id])).rows[0]!.n, 1);
    await assert.rejects(db.query("UPDATE rounds SET next_round_context='{}' WHERE id=$1", [first.roundId]), /immutable/);
    const replay = await new ReplayService(db, registry).read(players[0]!, room.id, first.roundId!);
    assert.equal(JSON.stringify(replay).includes('not-for-player-projection'), false);
    const drift: RuleEngine = { ...fixture, apply(state, userId, action) {
      const result = fixture.apply(state, userId, action);
      return { ...result, nextRoundContext: { changed: true } };
    } };
    await assert.rejects(new ReplayService(db, new EngineRegistry([drift])).read(players[0]!, room.id, first.roundId!), { code: 'REPLAY_DIVERGED' });
    await db.close();
    db = await openDatabase(undefined, join(directory, 'db'));
    await migrate(db);
    registry = new EngineRegistry([fixture, { ...fixture, version: 'continuation-fixture-v2', create() { throw new Error('Must not upgrade existing room'); } }]);
    rooms = new RoomService(db, registry, new PolicyService(db));
    await rooms.ready(players[0]!, room.id, true);
    const second = await rooms.ready(players[1]!, room.id, true);
    assert.equal(second.ruleVersion, fixture.version);
    assert.equal((second.game as State).dealerId, players[1]!.id);
    assert.equal((second.game as State).number, 2);
    await rooms.action(players[1]!, room.id, 'finish-context-second', { type: 'finish' }, 0, second.roundId!);
    await rooms.ready(players[0]!, room.id, true);
    const third = await rooms.ready(players[1]!, room.id, true);
    assert.equal((third.game as State).dealerId, players[1]!.id);
    assert.equal((third.game as State).number, 3);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
