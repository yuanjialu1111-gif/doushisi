import test from 'node:test';
import assert from 'node:assert/strict';
import { ABA10_INDEPENDENT_VERSION, getDefaultOptions } from '@dss/rules';
import { AuthService } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry } from '../src/engines.js';
import { createAbaEngine } from '../src/game/aba-engine.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { ReplayService } from '../src/replays.js';
import { RoomService } from '../src/rooms.js';

test('Aba configuration 10 keeps its own defaults, settles four rounds and replays', async () => {
  const db = await openDatabase();
  try {
    await migrate(db);
    const auth = new AuthService(db), ledger = new LedgerService(db);
    const admin = await auth.create('aba10_room_admin', 'test-password-only', 'beans_admin');
    const players = [await auth.create('aba10_room_one', 'test-password-only'),
      await auth.create('aba10_room_two', 'test-password-only'), await auth.create('aba10_room_three', 'test-password-only'),
      await auth.create('aba10_room_four', 'test-password-only')];
    for (const player of players) await ledger.adjust(admin, player.id, '500', 'Aba 10 room test', `aba10-room-${player.id}`);
    const engine = createAbaEngine('aba10-room-production-test', undefined, '10:0');
    const rooms = new RoomService(db, new EngineRegistry([engine]), new PolicyService(db));
    const options = { ...getDefaultOptions('10:0'), baseBeans: '0.125' };
    const room = await rooms.create(players[0]!, '10:0', options);
    assert.equal(room.rules.aba.rulesVersion, ABA10_INDEPENDENT_VERSION);
    assert.equal(room.rules.aba.diHu, undefined);
    assert.equal(options.diHu, 0);
    assert.equal(options.cheLong, 1);
    await rooms.join(players[1]!, room.code);
    await rooms.join(players[2]!, room.code);
    await rooms.join(players[3]!, room.code);
    await rooms.ready(players[0]!, room.id, true);
    await rooms.ready(players[1]!, room.id, true);
    await rooms.ready(players[2]!, room.id, true);
    let view = await rooms.ready(players[3]!, room.id, true);
    assert.equal(room.ruleVersion, engine.version);
    assert.equal(view.state, 'playing');
    let guard = 0;
    while (view.state !== 'closed') {
      assert.ok(guard++ < 1500, 'Aba 10 room must terminate');
      if (view.state === 'between_rounds') {
        await rooms.ready(players[0]!, room.id, true);
        await rooms.ready(players[1]!, room.id, true);
        await rooms.ready(players[2]!, room.id, true);
        view = await rooms.ready(players[3]!, room.id, true);
        continue;
      }
      const turn = await Promise.all(players.map(async player => ({ player, view: await rooms.view(room.id, player.id) })));
      const active = turn.find(item => item.view.responseWindow !== null) ??
        turn.find(item => Array.isArray(item.view.legalActions) && item.view.legalActions.length > 0);
      assert.ok(active, 'Aba 10 room must expose an action or response window');
      const legal = active.view.legalActions as { type: string; decisionId?: string }[];
      const action = legal.find(candidate => candidate.type === 'respond') ?? legal.find(candidate => candidate.type === 'hu')
        ?? legal.find(candidate => candidate.type === 'discard') ?? legal[0]!;
      view = await rooms.action(active.player, room.id, `aba10-room-${guard}`, action, view.stateVersion!, view.roundId!,
        undefined, active.view.responseWindow && 'decisionId' in action ? action.decisionId : undefined);
    }
    assert.equal(view.currentRound, 4);
    const settlements = await db.query("SELECT count(*)::int AS n FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id]);
    assert.equal(settlements.rows[0]!.n, 4);
    const rounds = await db.query('SELECT id,number,state,next_round_context FROM rounds WHERE room_id=$1 ORDER BY number', [room.id]);
    assert.equal(rounds.rows.length, 4);
    assert.ok(rounds.rows.every(round => round.state === 'settled' && round.next_round_context?.version === engine.version));
    const replay = await new ReplayService(db, new EngineRegistry([engine])).read(players[0]!, room.id, rounds.rows[0]!.id);
    assert.equal(replay.variantKey, '10:0');
    assert.equal(replay.ruleVersion, engine.version);
    assert.ok(replay.frames.length >= 1);
  } finally { await db.close(); }
});
