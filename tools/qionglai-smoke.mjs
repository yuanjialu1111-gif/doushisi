import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.ts';
import { AuthService } from '../apps/server/src/auth.ts';
import { openDatabase, migrate } from '../apps/server/src/database.ts';
import { EngineRegistry } from '../apps/server/src/engines.ts';
import { createQionglaiEngine } from '../apps/server/src/game/qionglai-engine.ts';
import { LedgerService } from '../apps/server/src/ledger.ts';
import { PolicyService } from '../apps/server/src/policies.ts';
import { RoomService } from '../apps/server/src/rooms.ts';

const directory = await mkdtemp(join(tmpdir(), 'dss-qionglai-smoke-'));
const db = await openDatabase(undefined, join(directory, 'db'));
try {
  await migrate(db);
  const auth = new AuthService(db);
  const ledger = new LedgerService(db);
  const admin = await auth.create('smoke_admin', 'test-password-only', 'beans_admin');
  const players = [await auth.create('smoke_one', 'test-password-only'), await auth.create('smoke_two', 'test-password-only')];
  for (const player of players) await ledger.adjust(admin, player.id, '10', 'Qionglai smoke credit', `smoke-${player.id}`);
  const engine = createQionglaiEngine('qionglai-smoke');
  const rooms = new RoomService(db, new EngineRegistry([engine]), new PolicyService(db));
  const room = await rooms.create(players[0], '8:0', { playerNum: 2, gameNum: 4, wangNum: 3,
    baseBeans: '0.125', chaJiao: 1, keSuHu: 1 });
  await rooms.join(players[1], room.code);
  await rooms.ready(players[0], room.id, true);
  let view = await rooms.ready(players[1], room.id, true);
  let steps = 0;
  while (view.state !== 'closed') {
    assert.ok(steps++ < 500, 'Smoke room did not terminate');
    if (view.state === 'between_rounds') {
      await rooms.ready(players[0], room.id, true);
      view = await rooms.ready(players[1], room.id, true);
      continue;
    }
    const projected = await Promise.all(players.map(async player => ({ player, view: await rooms.view(room.id, player.id) })));
    const active = projected.find(item => item.view.responseWindow !== null) ??
      projected.find(item => Array.isArray(item.view.legalActions) && item.view.legalActions.length);
    assert.ok(active, 'No player has a legal action');
    const action = active.view.legalActions.find(candidate => candidate.type === 'respond')
      ?? active.view.legalActions.find(candidate => candidate.type === 'hu')
      ?? active.view.legalActions.find(candidate => candidate.type === 'discard')
      ?? active.view.legalActions[0];
    view = await rooms.action(active.player, room.id, `qionglai-smoke-${steps}`, action, view.stateVersion, view.roundId,
      undefined, active.view.responseWindow && action.decisionId ? action.decisionId : undefined);
  }
  assert.equal(view.currentRound, 4);
  const settlements = await db.query("SELECT count(*)::int AS n FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id]);
  assert.equal(settlements.rows[0].n, 4);
  console.log(JSON.stringify({ passed: true, roomId: room.id, variantKey: room.variantKey, rounds: view.currentRound,
    settlements: settlements.rows[0].n, steps }));
} finally {
  await db.close();
  await rm(directory, { recursive: true, force: true });
}
