import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultOptions, SCORE_REGION_VERSIONS } from '@dss/rules';
import { AuthService } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry } from '../src/engines.js';
import { createScoreRegionEngine } from '../src/game/score-region-engine.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { ReplayService } from '../src/replays.js';
import { RoomService } from '../src/rooms.js';

const variants = ['14:0', '15:0', '16:0', '19:0', '20:0', '21:0', '22:0', '23:0', '24:0', '25:0', '26:0', '27:0'] as const;

test('Rongxian four-player small seat opens at five cards and plays at six', async () => {
  const db = await openDatabase();
  try {
    await migrate(db);
    const auth = new AuthService(db), ledger = new LedgerService(db);
    const admin = await auth.create('small_seat_admin', 'test-password-only', 'beans_admin');
    const players = [];
    for (let index = 0; index < 4; index++) {
      const player = await auth.create(`small_seat_${index}`, 'test-password-only');
      await ledger.adjust(admin, player.id, '10', 'Small-seat fixture', `small-seat-${index}`);
      players.push(player);
    }
    const engine = createScoreRegionEngine('small-seat-fixture', '20:0', () => 0);
    const rooms = new RoomService(db, new EngineRegistry([engine]), new PolicyService(db));
    const options = { ...getDefaultOptions('20:0'), playerNum: 4, gameNum: 4, daXiaoJia: 1, baseBeans: '0.125' };
    const room = await rooms.create(players[0]!, '20:0', options);
    for (const player of players.slice(1)) await rooms.join(player, room.code);
    for (const player of players) await rooms.ready(player, room.id, true);
    const views = await Promise.all(players.map(async player => await rooms.view(room.id, player.id)));
    let view = views[0]!;
    const opening = view.game as { cards: { id: string; count: number }[]; phase: string };
    assert.equal(opening.phase, 'discard');
    assert.equal(opening.cards.find(zone => zone.id === `hand:${players[3]!.id}`)!.count, 5);
    for (let guard = 0; guard < 500; guard++) {
      const game = view.game as { activeId: string; phase: string; cards: { id: string; count: number }[] };
      if (game.activeId === players[3]!.id && game.phase === 'discard') {
        const snapshot = (await db.query('SELECT snapshot FROM rounds WHERE id=$1', [view.roundId])).rows[0]!.snapshot as {
          players: { userId: string; melds: unknown[] }[]; cards: { zones: { id: string; cards: string[] }[] };
        };
        const smallHand = snapshot.cards.zones.find(zone => zone.id === `hand:${players[3]!.id}`)!.cards;
        const smallMelds = snapshot.players.find(player => player.userId === players[3]!.id)!.melds.length;
        assert.equal(smallHand.length, 6 - 2 * smallMelds);
        const smallView = await rooms.view(room.id, players[3]!.id);
        assert.ok(smallView.legalActions.some(action => action.type === 'discard'),
          'the small seat must be offered a discard after its six-card hand is evaluated');
        return;
      }
      const turn = await Promise.all(players.map(async player => ({ player, view: await rooms.view(room.id, player.id) })));
      const active = turn.find(item => item.view.responseWindow !== null) ??
        turn.find(item => item.view.legalActions.length > 0);
      assert.ok(active, 'the fixture must continue until the small seat discards');
      const legal = active.view.legalActions;
      const action = legal.find(candidate => candidate.type === 'respond') ?? legal.find(candidate => candidate.type === 'hu')
        ?? legal.find(candidate => candidate.type === 'discard') ?? legal[0]!;
      view = await rooms.action(active.player, room.id, `small-seat-${guard}`, action, view.stateVersion!,
        view.roundId!, undefined, active.view.responseWindow && action.decisionId ? action.decisionId : undefined);
    }
    assert.fail('the fixture never reached the small seat discard phase');
  } finally { await db.close(); }
});

for (const variantKey of variants) {
  test(`${variantKey} completes four rounds, settles once per round and replays`, async () => {
    const db = await openDatabase();
    try {
      await migrate(db);
      const auth = new AuthService(db), ledger = new LedgerService(db);
      const admin = await auth.create(`score_${variantKey.replace(':', '_')}_admin`, 'test-password-only', 'beans_admin');
      const players = [await auth.create(`score_${variantKey.replace(':', '_')}_one`, 'test-password-only'),
        await auth.create(`score_${variantKey.replace(':', '_')}_two`, 'test-password-only')];
      const token = variantKey.replace(':', '-');
      for (const player of players) await ledger.adjust(admin, player.id, '2000', 'score region test', `score-${token}-${player.id}`);
      const engine = createScoreRegionEngine(`score-${variantKey}-production-test`, variantKey);
      const rooms = new RoomService(db, new EngineRegistry([engine]), new PolicyService(db));
      const defaults = getDefaultOptions(variantKey);
      const options = { ...defaults, playerNum: 2, gameNum: 4, baseBeans: '0.125' };
      const room = await rooms.create(players[0]!, variantKey, options);
      await rooms.join(players[1]!, room.code);
      await rooms.ready(players[0]!, room.id, true);
      let view = await rooms.ready(players[1]!, room.id, true);
      assert.equal(room.ruleVersion, SCORE_REGION_VERSIONS[variantKey]);
      assert.equal(view.state, 'playing');
      let guard = 0;
      while (view.state !== 'closed') {
        assert.ok(guard++ < 1500, `${variantKey} room must terminate`);
        if (view.state === 'between_rounds') {
          await rooms.ready(players[0]!, room.id, true);
          view = await rooms.ready(players[1]!, room.id, true);
          continue;
        }
        const turn = await Promise.all(players.map(async player => ({ player, view: await rooms.view(room.id, player.id) })));
        const active = turn.find(item => item.view.responseWindow !== null) ??
          turn.find(item => Array.isArray(item.view.legalActions) && item.view.legalActions.length > 0);
        assert.ok(active, `${variantKey} room must expose an action or response window`);
        const legal = active.view.legalActions as { type: string; decisionId?: string }[];
        const action = legal.find(candidate => candidate.type === 'respond') ?? legal.find(candidate => candidate.type === 'hu')
          ?? legal.find(candidate => candidate.type === 'discard') ?? legal[0]!;
        view = await rooms.action(active.player, room.id, `score-${token}-${guard}`, action, view.stateVersion!, view.roundId!,
          undefined, active.view.responseWindow && 'decisionId' in action ? action.decisionId : undefined);
      }
      assert.equal(view.currentRound, 4);
      const settlements = await db.query("SELECT count(*)::int AS n FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id]);
      assert.equal(settlements.rows[0]!.n, 4);
      const rounds = await db.query('SELECT id,number,state,next_round_context FROM rounds WHERE room_id=$1 ORDER BY number', [room.id]);
      assert.equal(rounds.rows.length, 4);
      assert.ok(rounds.rows.every(round => round.state === 'settled' &&
        round.next_round_context?.version === SCORE_REGION_VERSIONS[variantKey]));
      const replay = await new ReplayService(db, new EngineRegistry([engine])).read(players[0]!, room.id, rounds.rows[0]!.id);
      assert.equal(replay.variantKey, variantKey);
      assert.equal(replay.ruleVersion, SCORE_REGION_VERSIONS[variantKey]);
      assert.ok(replay.frames.length >= 1);
    } finally { await db.close(); }
  });
}
