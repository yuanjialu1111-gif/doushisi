import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { AuthService } from '../apps/server/src/auth.ts';
import { openDatabase, migrate } from '../apps/server/src/database.ts';
import { appendOperation, LedgerService } from '../apps/server/src/ledger.ts';
import { amount, beanUnits } from '../apps/server/src/money.ts';
import { baseTimesRatio, roundTransfers } from '../apps/server/src/transfers.ts';
import { EngineRegistry } from '../apps/server/src/engines.ts';
import { createRuntimeEngineRegistry } from '../apps/server/src/runtime-engines.ts';
import { PolicyService } from '../apps/server/src/policies.ts';
import { RoomService } from '../apps/server/src/rooms.ts';
import { releaseSubject } from './build-fingerprint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'verification/local-accounting.json');
const rawOutput = join(root, 'verification/raw/local-accounting.json');
const checks = [];
const evidence = [];
const record = (id, details) => checks.push({ id, passed: true, details });
const databaseDirectory = await mkdtemp(join(tmpdir(), 'dss-local-accounting-'));
const db = await openDatabase(undefined, join(databaseDirectory, 'database'));
try {
  await migrate(db);
  const auth = new AuthService(db);
  const ledger = new LedgerService(db);
  const beans = await auth.create('local_accounting_admin', 'test-password-only', 'beans_admin');
  const player = await auth.create('local_accounting_player', 'test-password-only');

  const transfer = roundTransfers([
    { id: 'half-up-a', payerId: player.id, payeeId: beans.id, numerator: '5', denominator: '10000000000000' },
    { id: 'half-up-b', payerId: beans.id, payeeId: player.id, numerator: '4', denominator: '10000000000000' },
  ], [beans.id, player.id]);
  assert.deepEqual(transfer.postings, [{ userId: beans.id, amount: '0.000000000001' },
    { userId: player.id, amount: '-0.000000000001' }].sort((a, b) => a.userId.localeCompare(b.userId)));
  record('payer-half-up-12', { version: 'payer-half-up-12-v1', sample: transfer.postings });

  const largeBase = '9'.repeat(80) + '.123456789012';
  const largeTransfer = roundTransfers([{ id: 'large-derived', payerId: player.id, payeeId: beans.id,
    ...baseTimesRatio(largeBase, 1000n) }], [beans.id, player.id]);
  assert.equal(beanUnits(largeTransfer.postings.find(posting => posting.userId === beans.id).amount),
    beanUnits(largeBase) * 1000n);
  assert.equal(amount(largeBase).toFixed(), largeBase);
  assert.throws(() => amount('9'.repeat(81) + '.0'), { code: 'INVALID_AMOUNT' });
  record('derived-large-amounts', { base: largeBase, factor: 1000, postings: largeTransfer.postings });

  const exact = '0.123456789012';
  const operation = { key: 'local-accounting-exact', kind: 'round_settlement',
    reason: 'Local accounting acceptance', postings: [{ userId: player.id, amount: exact }] };
  const first = await db.transaction(tx => appendOperation(tx, operation));
  const replay = await db.transaction(tx => appendOperation(tx, operation));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(await ledger.balance(player.id), exact);
  record('exact-decimals', { amount: exact, replayIdempotent: true });
  record('settlement-once', { operationId: first.operationId, replayOperationId: replay.operationId });

  const beforeDebt = await ledger.balance(player.id);
  await assert.rejects(ledger.adjust(beans, player.id, '-1', 'manual debt must fail', 'local-accounting-debt'), {
    code: 'INSUFFICIENT_BALANCE' });
  assert.equal(await ledger.balance(player.id), beforeDebt);
  const automaticDebt = await db.transaction(tx => appendOperation(tx, { key: 'local-accounting-automatic-debt',
    kind: 'round_settlement', reason: 'Automatic settlement may create debt',
    postings: [{ userId: player.id, amount: '-1' }] }));
  assert.equal(await ledger.balance(player.id), '-0.876543210988');
  record('negative-balance', { manualBlocked: true, automaticAllowed: true, operationId: automaticDebt.operationId });

  const roleBlocked = await ledger.adjust({ ...beans, role: 'player' }, player.id, '1', 'role isolation',
    'local-accounting-role').then(() => false, error => error.code === 'FORBIDDEN');
  assert.equal(roleBlocked, true);
  record('role-isolation', { playerCannotAdjust: true });

  const concurrent = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    db.transaction(tx => appendOperation(tx, { key: `local-accounting-concurrent-${index}`, kind: 'admin_add',
      actorId: beans.id, reason: 'Concurrent exact credit', postings: [{ userId: player.id, amount: '0.000000000001' }] }))));
  assert.equal(new Set(concurrent.map(result => result.operationId)).size, 20);
  assert.equal(await ledger.balance(player.id), '-0.876543210968');
  record('admin-concurrency', { operations: concurrent.length, exactBalance: '-0.876543210968' });

  const second = await auth.create('local_accounting_second', 'test-password-only');
  for (const item of [player, second]) await ledger.adjust(beans, item.id, '10', 'Accounting room funding',
    `accounting-fund-${item.id}`);
  const rooms = new RoomService(db, createRuntimeEngineRegistry(), new PolicyService(db));
  const room = await rooms.create(player, '6:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
  await rooms.join(second, room.code);
  await rooms.ready(player, room.id, true);
  let view = await rooms.ready(second, room.id, true);
  const touch = view.legalActions.find(action => action.type === 'discard') ?? view.legalActions[0];
  await Promise.all(Array.from({ length: 8 }, () => rooms.action(player, room.id, 'accounting-touch',
    touch, 0, view.roundId).catch(error => {
      assert.equal(error.code, 'ILLEGAL_ACTION');
      return null;
    })));
  const feeCount = (await db.query("SELECT count(*)::int AS n FROM ledger_operations WHERE room_id=$1 AND kind='room_fee'",
    [room.id])).rows[0].n;
  assert.equal(feeCount, 1);
  record('fee-once', { roomId: room.id, feeOperations: feeCount, concurrentRetries: 8 });

  const beforeEarned = await ledger.balance(player.id);
  await rooms.dissolve(player, room.id, true);
  const dissolved = await rooms.dissolve(second, room.id, true);
  assert.equal(dissolved.closed, true);
  const settlementCount = (await db.query(
    "SELECT count(*)::int AS n FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id])).rows[0].n;
  assert.equal(settlementCount, 1);
  const settledBalance = await ledger.balance(player.id);
  assert.equal(settledBalance, beforeEarned);
  record('dissolve-earned-scores', { roomId: room.id, settlementOperations: settlementCount,
    zeroUnconfirmed: true, settledBalance });
  await mkdir(dirname(rawOutput), { recursive: true });
  await writeFile(rawOutput, JSON.stringify({ checks, generatedAt: new Date().toISOString() }, null, 2) + '\n');
  const rawBytes = Buffer.from(await (await import('node:fs/promises')).readFile(rawOutput));
  evidence.push({ path: 'verification/raw/local-accounting.json', sha256: createHash('sha256').update(rawBytes).digest('hex') });
} finally {
  await db.close();
  await rm(databaseDirectory, { recursive: true, force: true });
}
const report = {
  schemaVersion: 1,
  passed: true,
  subjectSha256: (await releaseSubject(root)).sha256,
  checks,
  evidence,
  generatedAt: new Date().toISOString(),
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, checks: checks.length, evidence: evidence.length }));
