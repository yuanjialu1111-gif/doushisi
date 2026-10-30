import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, type Actor } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';
import { LedgerService } from '../src/ledger.js';
import { Decimal } from '../src/money.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { ReplayService } from '../src/replays.js';

interface State { players: EnginePlayer[]; actions: number }
interface Action { eventId?: string; delta?: string; finish?: string; malformed?: 'missing' | 'sum' }

// Infrastructure fixture only: these arbitrary score events establish no regional gameplay rules.
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'confirmed-score-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-score-test-only' },
  create(input): State { return { players: input.players, actions: 0 }; },
  apply(raw, _userId, rawAction) {
    const state = raw as State;
    const action = rawAction as Action;
    const postings = (value: string) => state.players.map((player, index) => ({ userId: player.userId,
      amount: index === 0 ? value : index === 1 ? new Decimal(value).negated().toFixed() : '0' }));
    const earned = postings(action.delta ?? '0');
    if (action.malformed === 'missing') earned.pop();
    if (action.malformed === 'sum') earned[1]!.amount = '0';
    return { snapshot: { ...state, actions: state.actions + 1 }, events: [{ type: 'fixture_action' }],
      ...(action.eventId ? { confirmedScores: [{ eventId: action.eventId, postings: earned }] } : {}),
      ...(action.finish === undefined ? {} : { settlement: postings(action.finish) }) };
  },
  view(raw) { return { actions: (raw as State).actions }; },
};

test('confirmed scores survive restart, dissolve atomically and remain independently replayable', async t => {
  const db = await openDatabase();
  try {
    await migrate(db);
    const auth = new AuthService(db);
    const ledger = new LedgerService(db);
    const beans = await auth.create('score_beans_admin', 'test-password-only', 'beans_admin');
    const policies = new PolicyService(db);
    const registry = new EngineRegistry([fixture]);
    const rooms = new RoomService(db, registry, policies);
    const replay = new ReplayService(db, registry);
    let serial = 0;
    async function pair(count = 2, opening = '10') {
      const players: Actor[] = [];
      for (let i = 0; i < count; i++) {
        const player = await auth.create(`score_player_${++serial}`, 'test-password-only');
        await ledger.adjust(beans, player.id, opening, 'fixture funding', `score-funding-${serial}`);
        players.push(player);
      }
      const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: count, gameNum: 4 });
      for (const player of players.slice(1)) await rooms.join(player, room.code);
      for (const player of players) await rooms.ready(player, room.id, true);
      const roundId = (await rooms.view(room.id, players[0]!.id)).roundId!;
      return { players, room, roundId };
    }
    const count = async (roomId: string, kind: string) => (await db.query('SELECT count(*)::int AS count FROM ledger_operations WHERE room_id=$1 AND kind=$2', [roomId, kind])).rows[0]!.count;
    const totals = (players: Actor[], delta: string) => players.map((player, index) => ({ userId: player.id,
      amount: index === 0 ? delta : index === 1 ? new Decimal(delta).negated().toFixed() : '0' })).sort((a, b) => a.userId.localeCompare(b.userId));

    await t.test('confirmed batches are exact, immutable, all-player and deduplicated across commands', async () => {
      const { players, room, roundId } = await pair(3);
      const action = { eventId: 'confirmed:1', delta: '0.123456789012' };
      await Promise.all(Array.from({ length: 5 }, () => rooms.action(players[0]!, room.id, 'score-first-command', action, 0, roundId)));
      await rooms.action(players[1]!, room.id, 'score-reemit-command', action, 1, roundId);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM round_score_events WHERE round_id=$1', [roundId])).rows[0]!.count, 1);
      assert.deepEqual((await rooms.view(room.id, players[0]!.id)).confirmedScores, totals(players, action.delta));
      assert.equal(await ledger.balance(players[0]!.id), '9');
      assert.equal(await count(room.id, 'round_settlement'), 0);
      for (const [suffix, invalid, code] of [
        ['changed', { ...action, delta: '2' }, 'CONFIRMED_SCORE_CONFLICT'],
        ['missing', { eventId: 'missing', delta: '1', malformed: 'missing' }, 'INVALID_CONFIRMED_SCORE'],
        ['sum', { eventId: 'bad-sum', delta: '1', malformed: 'sum' }, 'INVALID_CONFIRMED_SCORE'],
        ['precision', { eventId: 'overprecision', delta: '0.0000000000001' }, 'INVALID_AMOUNT'],
      ] as const) await assert.rejects(rooms.action(players[0]!, room.id, `score-invalid-${suffix}`, invalid, 2, roundId), { code });
      assert.equal(((await rooms.view(room.id, players[0]!.id)).game as { actions: number }).actions, 2);
      await assert.rejects(db.query("UPDATE round_score_events SET postings='[]' WHERE round_id=$1", [roundId]), /append-only/);
      await assert.rejects(db.query('DELETE FROM round_score_events WHERE round_id=$1', [roundId]), /append-only/);
      await assert.rejects(db.query('TRUNCATE round_score_events'), /append-only/);
      await assert.rejects(db.query('UPDATE rounds SET scoring_version=0 WHERE id=$1', [roundId]), /immutable/);
    });

    await t.test('unanimous dissolve posts only durable scores after service restart and concurrent adjustments', async () => {
      const { players, room, roundId } = await pair();
      await rooms.action(players[0]!, room.id, 'score-before-restart', { eventId: 'earned:1', delta: '0.125' }, 0, roundId);
      await rooms.action(players[0]!, room.id, 'score-unfinished-action', {}, 1, roundId);
      assert.equal((await rooms.dissolve(players[0]!, room.id, true)).closed, false);
      assert.equal(await count(room.id, 'round_settlement'), 0);
      const recovered = new RoomService(db, new EngineRegistry([fixture]), new PolicyService(db));
      await Promise.all([
        ...Array.from({ length: 12 }, () => recovered.dissolve(players[1]!, room.id, true)),
        ...Array.from({ length: 20 }, (_, index) => ledger.adjust(beans, players[0]!.id, '0.01', 'concurrent adjustment', `score-concurrent-${index}`)),
      ]);
      assert.equal(await ledger.balance(players[0]!.id), '9.325');
      assert.equal(await ledger.balance(players[1]!.id), '8.875');
      assert.equal(await count(room.id, 'round_settlement'), 1);
      assert.equal(await count(room.id, 'room_fee'), 1);
      const saved = (await db.query('SELECT state,snapshot,results,end_reason FROM rounds WHERE id=$1', [roundId])).rows[0]!;
      assert.equal(saved.state, 'settled');
      assert.equal(saved.end_reason, 'dissolved');
      assert.equal(saved.snapshot.actions, 2);
      assert.deepEqual(saved.results, totals(players, '0.125'));
      assert.equal((await recovered.view(room.id, players[0]!.id)).state, 'closed');
      const restoredReplay = await new ReplayService(db, new EngineRegistry([fixture])).read(players[0]!, room.id, roundId);
      assert.equal(restoredReplay.endReason, 'dissolved');
      assert.deepEqual(restoredReplay.frames.map(frame => frame.game), [{ actions: 0 }, { actions: 1 }, { actions: 2 }]);
      assert.deepEqual(restoredReplay.results, totals(players, '0.125'));
      assert.equal((await db.query('SELECT count(*)::int AS count FROM friends WHERE first_room_id=$1', [room.id])).rows[0]!.count, 2);
      await assert.rejects(db.query("UPDATE rounds SET results='[]' WHERE id=$1", [roundId]), /immutable/);
    });

    await t.test('a round with no confirmed score dissolves at zero without calculating a winner', async () => {
      const { players, room, roundId } = await pair();
      const recovered = new RoomService(db, new EngineRegistry([{ ...fixture, apply() { throw new Error('Dissolve must not invoke a winning or draw evaluator'); } }]), policies);
      await recovered.dissolve(players[0]!, room.id, true);
      await recovered.dissolve(players[1]!, room.id, true);
      assert.equal(await ledger.balance(players[0]!.id), '9');
      assert.equal(await ledger.balance(players[1]!.id), '9');
      assert.deepEqual((await replay.read(players[0]!, room.id, roundId)).results, totals(players, '0'));
      assert.equal(await count(room.id, 'round_settlement'), 1);
    });

    await t.test('rejection cancels the vote while earned scores remain and dissolved losses may create debt', async () => {
      const { players, room, roundId } = await pair(2, '2');
      await rooms.action(players[0]!, room.id, 'score-negative-earned', { eventId: 'earned:loss', delta: '-3.25' }, 0, roundId);
      await rooms.dissolve(players[0]!, room.id, true);
      assert.equal((await rooms.dissolve(players[1]!, room.id, false)).rejected, true);
      assert.equal((await rooms.view(room.id, players[0]!.id)).state, 'playing');
      assert.deepEqual((await rooms.view(room.id, players[0]!.id)).confirmedScores, totals(players, '-3.25'));
      await rooms.dissolve(players[0]!, room.id, true);
      await rooms.dissolve(players[1]!, room.id, true);
      assert.equal(await ledger.balance(players[0]!.id), '-2.25');
      assert.equal(await ledger.balance(players[1]!.id), '4.25');
      await assert.rejects(ledger.adjust(beans, players[0]!.id, '-0.01', 'forbidden debt increase', 'score-debt-deduction'), { code: 'INSUFFICIENT_BALANCE' });
    });

    await t.test('terminal scores must explain the full settlement and completed rounds survive later dissolution', async () => {
      const { players, room, roundId } = await pair();
      await rooms.action(players[0]!, room.id, 'score-first-increment', { eventId: 'earned:first', delta: '0.125' }, 0, roundId);
      await assert.rejects(rooms.action(players[0]!, room.id, 'score-unexplained-final', { finish: '1' }, 1, roundId), { code: 'INVALID_SETTLEMENT' });
      await assert.rejects(rooms.action(players[0]!, room.id, 'score-final-missing-earlier', { eventId: 'earned:terminal', delta: '0.375', finish: '0.375' }, 1, roundId), { code: 'INVALID_SETTLEMENT' });
      await rooms.action(players[0]!, room.id, 'score-terminal-increment', { eventId: 'earned:terminal', delta: '0.375', finish: '0.5' }, 1, roundId);
      assert.equal(await ledger.balance(players[0]!.id), '9.5');
      const first = (await db.query('SELECT snapshot,results,end_reason FROM rounds WHERE id=$1', [roundId])).rows[0];
      assert.equal((await replay.read(players[0]!, room.id, roundId)).endReason, 'completed');
      for (const player of players) await rooms.ready(player, room.id, true);
      const nextRound = await rooms.view(room.id, players[0]!.id);
      await rooms.action(players[1]!, room.id, 'score-second-round-earned', { eventId: 'earned:first', delta: '-0.125' }, 0, nextRound.roundId!);
      await rooms.dissolve(players[0]!, room.id, true);
      await rooms.dissolve(players[1]!, room.id, true);
      assert.deepEqual((await db.query('SELECT snapshot,results,end_reason FROM rounds WHERE id=$1', [roundId])).rows[0], first);
      assert.equal(await count(room.id, 'room_fee'), 1);
      assert.equal(await count(room.id, 'round_settlement'), 2);
      assert.equal(await ledger.balance(players[0]!.id), '9.375');
      assert.equal(await ledger.balance(players[1]!.id), '8.625');
      const scores = (await rooms.view(room.id, players[0]!.id)).members.map(member => new Decimal(member.score).toFixed());
      assert.deepEqual(scores, ['0.375', '-0.375']);
    });

    await t.test('replay detects a changed score evaluator even when the card snapshot is unchanged', async () => {
      const { players, room, roundId } = await pair();
      await rooms.action(players[0]!, room.id, 'score-replay-event', { eventId: 'earned:1', delta: '0.125' }, 0, roundId);
      await rooms.dissolve(players[0]!, room.id, true);
      await rooms.dissolve(players[1]!, room.id, true);
      const altered: RuleEngine = { ...fixture, apply(snapshot, userId, action) {
        return fixture.apply(snapshot, userId, { ...(action as Action), delta: '0.25' });
      } };
      await assert.rejects(new ReplayService(db, new EngineRegistry([altered])).read(players[0]!, room.id, roundId), { code: 'REPLAY_DIVERGED' });
    });
  } finally { await db.close(); }
});
