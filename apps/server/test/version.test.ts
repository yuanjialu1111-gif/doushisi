import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService } from '../src/auth.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { EngineRegistry, type RuleEngine } from '../src/engines.js';

function fixture(version: string): RuleEngine {
  return { variantKey: '4:0', version, evidence: { status: 'verified', referenceDigest: 'synthetic-test-only' },
    create: () => ({ version, actions: 0 }),
    apply: snapshot => ({ snapshot: { ...(snapshot as object), used: version }, events: [] }),
    view: snapshot => snapshot,
  };
}

test('engine upgrades cannot replace a room version or reinterpret its persisted snapshot', async () => {
  const db = await openDatabase();
  try {
    await migrate(db);
    const auth = new AuthService(db);
    const admin = await auth.create('version_admin', 'test-password-only', 'beans_admin');
    const first = await auth.create('version_first', 'test-password-only');
    const second = await auth.create('version_second', 'test-password-only');
    const ledger = new LedgerService(db);
    for (const player of [first, second]) await ledger.adjust(admin, player.id, '100', 'test credit', `credit-${player.id}`);
    const engines = new EngineRegistry([fixture('old')]);
    const service = new RoomService(db, engines, new PolicyService(db));
    const room = await service.create(first, '4:0', { baseBeans: '0.1', playerNum: 2 });
    await service.join(second, room.code);
    engines.register(fixture('new'));
    await service.ready(first, room.id, true);
    const started = await service.ready(second, room.id, true);
    assert.equal(started.ruleVersion, 'old');
    assert.equal((started.game as any).version, 'old');
    const acted = await service.action(first, room.id, 'version-action-0001', {}, 0, started.roundId!);
    assert.equal((acted.game as any).used, 'old');
    assert.throws(() => engines.register(fixture('old')), /cannot be replaced/);
  } finally { await db.close(); }
});
