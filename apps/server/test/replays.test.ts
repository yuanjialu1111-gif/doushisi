import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { EngineRegistry, type RuleEngine, type EnginePlayer } from '../src/engines.js';
import { ReplayService } from '../src/replays.js';

interface State { players: EnginePlayer[]; hands: Record<string, number[]>; deck: number[]; actions: number; done: boolean }
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'replay-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-test-fixture-only' },
  create(input): State { return { players: input.players, hands: Object.fromEntries(input.players.map((player, index) => [player.userId, [index + 4]])), deck: [88, 99], actions: 0, done: false }; },
  apply(raw, _userId, action) {
    const state = raw as State;
    const done = (action as { type: string }).type === 'finish';
    const settlement = state.players.map((player, index) => ({ userId: player.userId, amount: index ? '-0.125' : '0.125' }));
    return { snapshot: { ...state, actions: state.actions + 1, done }, events: [{ hiddenDeck: state.deck }],
      ...(done ? { confirmedScores: [{ eventId: 'terminal-score', postings: settlement }], settlement } : {}) };
  },
  view(raw, userId) { const state = raw as State; return { hand: state.hands[userId], actions: state.actions, done: state.done }; },
};

test('archived replay pins engine version, rebuilds actions once and filters hidden state', async () => {
  const db = await openDatabase();
  await migrate(db);
  const registry = new EngineRegistry([fixture]);
  const { app, auth, rooms, ledger, replays } = await createApp(db, { staticFiles: false, engines: registry });
  try {
    const beans = await auth.create('beans_replay', 'test-password-only', 'beans_admin');
    const dealer = await auth.create('dealer_replay', 'test-password-only', 'deal_admin');
    const players = await Promise.all(['first_replay', 'second_replay', 'outside_replay'].map(name => auth.create(name, 'test-password-only')));
    for (const player of players) await ledger.adjust(beans, player.id, '10', 'replay fixture funding', `replay-credit-${player.id}`);
    const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
    await rooms.join(players[1]!, room.code);
    await rooms.ready(players[0]!, room.id, true);
    const started = await rooms.ready(players[1]!, room.id, true);
    const roundId = started.roundId!;
    await assert.rejects(replays.read(players[0]!, room.id, roundId), { code: 'REPLAY_NOT_AVAILABLE' });
    await rooms.action(players[0]!, room.id, 'replay-touch-once', { type: 'touch', privateData: 'hidden-action-payload' }, 0, roundId);
    await rooms.action(players[0]!, room.id, 'replay-touch-once', { type: 'touch', privateData: 'hidden-action-payload' }, 0, roundId);
    await rooms.action(players[1]!, room.id, 'replay-finish-once', { type: 'finish' }, 1, roundId);
    registry.register({ ...fixture, version: 'replay-fixture-v2', apply() { throw new Error('New engine must not interpret old replay'); } });
    const restored = new ReplayService(db, new EngineRegistry([fixture]));
    const replay = await restored.read(players[0]!, room.id, roundId);
    assert.deepEqual(await replays.read(players[0]!, room.id, roundId), replay);
    assert.equal(replay.ruleVersion, 'replay-fixture-v1');
    assert.deepEqual(replay.frames.map(frame => frame.game), [
      { hand: [4], actions: 0, done: false }, { hand: [4], actions: 1, done: false }, { hand: [4], actions: 2, done: true },
    ]);
    assert.equal(JSON.stringify(replay).includes('hidden'), false);
    assert.equal(JSON.stringify(replay).includes('deck'), false);
    assert.equal(JSON.stringify(replay).includes('policy'), false);
    assert.deepEqual((await replays.read(players[1]!, room.id, roundId)).frames[0]!.game, { hand: [5], actions: 0, done: false });
    await assert.rejects(replays.read(players[2]!, room.id, roundId), { code: 'NOT_ROOM_MEMBER' });
    await assert.rejects(replays.read(dealer, room.id, roundId), { code: 'FORBIDDEN' });
    await assert.rejects(replays.read(beans, room.id, roundId), { code: 'FORBIDDEN' });
    await assert.rejects(db.query("UPDATE rounds SET initial_snapshot='{}' WHERE id=$1", [roundId]), /immutable/);
    const incompatible = new ReplayService(db, new EngineRegistry([{ ...fixture, apply(raw) { return { snapshot: raw, events: [] }; } }]));
    await assert.rejects(incompatible.read(players[0]!, room.id, roundId), { code: 'REPLAY_DIVERGED' });
    const login = await auth.login(players[0]!.username, 'test-password-only');
    const response = await app.inject({ method: 'GET', url: `/api/records/${room.id}/replay/${roundId}`, headers: { authorization: `Bearer ${login.token}` } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().frames.length, 3);
    assert.equal(await ledger.balance(players[0]!.id), '9.125');
    assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM ledger_operations WHERE kind='round_settlement'")).rows[0]!.count, 1);
  } finally { await app.close(); await db.close(); }
});
