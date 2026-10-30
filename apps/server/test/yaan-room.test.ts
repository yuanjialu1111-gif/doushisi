import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry } from '../src/engines.js';
import { createYaanEngine } from '../src/game/yaan-engine.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { ReplayService } from '../src/replays.js';
import { RoomService } from '../src/rooms.js';

test('Yaan production engine completes a real room, settles once per round and replays', async () => {
  const db = await openDatabase();
  try {
    await migrate(db);
    const auth = new AuthService(db), ledger = new LedgerService(db);
    const admin = await auth.create('yaan_room_admin', 'test-password-only', 'beans_admin');
    const players = [await auth.create('yaan_room_one', 'test-password-only'), await auth.create('yaan_room_two', 'test-password-only')];
    for (const player of players) await ledger.adjust(admin, player.id, '20', 'Yaan room test', `yaan-room-${player.id}`);
    const engine = createYaanEngine('yaan-room-production-test');
    const rooms = new RoomService(db, new EngineRegistry([engine]), new PolicyService(db));
    const room = await rooms.create(players[0]!, '6:0', { playerNum: 2, gameNum: 4, wangNum: 3, qiWangNum: 0,
      baseBeans: '0.125', ziChi: 0, chaJiao: 0, chengFan: 0 });
    await rooms.join(players[1]!, room.code);
    await rooms.ready(players[0]!, room.id, true);
    let view = await rooms.ready(players[1]!, room.id, true);
    assert.equal(room.ruleVersion, engine.version);
    assert.equal(view.state, 'playing');
    let guard = 0;
    while (view.state !== 'closed') {
      assert.ok(guard++ < 1000, 'Yaan room must terminate');
      if (view.state === 'between_rounds') {
        await rooms.ready(players[0]!, room.id, true);
        view = await rooms.ready(players[1]!, room.id, true);
        continue;
      }
      const turn = await Promise.all(players.map(async player => ({ player, view: await rooms.view(room.id, player.id) })));
      const active = turn.find(item => item.view.responseWindow !== null) ??
        turn.find(item => Array.isArray(item.view.legalActions) && item.view.legalActions.length > 0);
      assert.ok(active, 'Yaan room must expose an action or response window');
      const legal = active.view.legalActions as { type: string; decisionId?: string }[];
      const action = legal.find(candidate => candidate.type === 'respond') ?? legal.find(candidate => candidate.type === 'hu')
        ?? legal.find(candidate => candidate.type === 'discard') ?? legal[0]!;
      view = await rooms.action(active.player, room.id, `yaan-room-${guard}`, action, view.stateVersion!, view.roundId!,
        undefined, active.view.responseWindow && 'decisionId' in action ? action.decisionId : undefined);
    }
    assert.equal(view.currentRound, 4);
    const settlements = await db.query("SELECT count(*)::int AS n FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id]);
    assert.equal(settlements.rows[0]!.n, 4);
    const rounds = await db.query('SELECT id,number,state,next_round_context FROM rounds WHERE room_id=$1 ORDER BY number', [room.id]);
    assert.equal(rounds.rows.length, 4);
    assert.ok(rounds.rows.every(round => round.state === 'settled' && round.next_round_context?.version === engine.version));
    const replay = await new ReplayService(db, new EngineRegistry([engine])).read(players[0]!, room.id, rounds.rows[0]!.id);
    assert.equal(replay.variantKey, '6:0');
    assert.equal(replay.ruleVersion, engine.version);
    assert.ok(replay.frames.length >= 1);
    for (const frame of replay.frames) {
      const game = frame.game as { cards?: { id: string; ownerId?: string; cards?: unknown[] }[] } | null;
      if (!game?.cards) continue;
      for (const zone of game.cards) if (zone.id.startsWith('hand:') && zone.ownerId !== players[0]!.id) assert.equal(zone.cards, undefined);
      assert.equal(game.cards.some(zone => zone.id === 'deck' && zone.cards !== undefined), false);
    }
  } finally { await db.close(); }
});
