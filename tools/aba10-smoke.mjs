import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultOptions } from '../apps/server/node_modules/@dss/rules/dist/index.js';
import { AuthService } from '../apps/server/src/auth.ts';
import { openDatabase, migrate } from '../apps/server/src/database.ts';
import { EngineRegistry } from '../apps/server/src/engines.ts';
import { createAbaEngine } from '../apps/server/src/game/aba-engine.ts';
import { LedgerService } from '../apps/server/src/ledger.ts';
import { PolicyService } from '../apps/server/src/policies.ts';
import { RoomService } from '../apps/server/src/rooms.ts';

const directory = await mkdtemp(join(tmpdir(), 'dss-aba10-smoke-'));
const db = await openDatabase(undefined, join(directory, 'db'));
try {
  await migrate(db);
  const auth = new AuthService(db), ledger = new LedgerService(db);
  const admin = await auth.create('aba10_smoke_admin', 'test-password-only', 'beans_admin');
  const players = [await auth.create('aba10_smoke_one', 'test-password-only'),
    await auth.create('aba10_smoke_two', 'test-password-only'), await auth.create('aba10_smoke_three', 'test-password-only'),
    await auth.create('aba10_smoke_four', 'test-password-only')];
  for (const player of players) await ledger.adjust(admin, player.id, '500', 'Aba 10 smoke credit', `aba10-smoke-${player.id}`);
  const engine = createAbaEngine('aba10-smoke', undefined, '10:0');
  const rooms = new RoomService(db, new EngineRegistry([engine]), new PolicyService(db));
  const options = { ...getDefaultOptions('10:0'), baseBeans: '0.125' };
  const room = await rooms.create(players[0], '10:0', options);
  await rooms.join(players[1], room.code);
  await rooms.join(players[2], room.code);
  await rooms.join(players[3], room.code);
  await rooms.ready(players[0], room.id, true);
  await rooms.ready(players[1], room.id, true);
  await rooms.ready(players[2], room.id, true);
  let view = await rooms.ready(players[3], room.id, true);
  let steps = 0;
  while (view.state !== 'closed') {
    assert.ok(steps++ < 1500, 'Aba 10 smoke room did not terminate');
    if (view.state === 'between_rounds') {
      await rooms.ready(players[0], room.id, true);
      await rooms.ready(players[1], room.id, true);
      await rooms.ready(players[2], room.id, true);
      view = await rooms.ready(players[3], room.id, true);
      continue;
    }
    const turn = await Promise.all(players.map(async player => ({ player, view: await rooms.view(room.id, player.id) })));
    const active = turn.find(item => item.view.responseWindow !== null) ??
      turn.find(item => Array.isArray(item.view.legalActions) && item.view.legalActions.length);
    assert.ok(active, 'No Aba 10 player has an action');
    const action = active.view.legalActions.find(candidate => candidate.type === 'respond')
      ?? active.view.legalActions.find(candidate => candidate.type === 'hu')
      ?? active.view.legalActions.find(candidate => candidate.type === 'discard')
      ?? active.view.legalActions[0];
    view = await rooms.action(active.player, room.id, `aba10-smoke-${steps}`, action, view.stateVersion, view.roundId,
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
