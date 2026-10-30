import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../apps/server/src/database.ts';
import { assertActiveDirectoryLock, assertIsolatedHealth, assertRawReportChecks, assertRestartEvidence,
  freeLoopbackPort, healthUnavailable, runAcceptance, serverChildEnvironment } from '../run-local-recovery.mjs';

const validRestart = () => ({ beforePid: 100, afterPid: 200, runId: 'recovery-1', healthUnavailableAfterStop: true,
  authenticatedRoomRestored: true, ledgerStateRestored: true });

test('importing recovery tooling does not run acceptance as a side effect', () => {
  assert.equal(typeof runAcceptance, 'function');
  assert.equal(typeof assertActiveDirectoryLock, 'function');
});

test('child environment binds an isolated loopback database and never inherits DATABASE_URL', () => {
  const env = serverChildEnvironment({ directory: join(tmpdir(), 'recovery-fixture'), port: 4321, controlPort: 4322,
    runId: 'recovery-run', environment: { DATABASE_URL: 'postgres://prod.example/db', PATH: 'x' } });
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.PORT, '4321');
  assert.equal(env.ACCEPTANCE_ISOLATED_DATABASE, 'true');
  assert.equal(env.ACCEPTANCE_RUN_ID, 'recovery-run');
  assert.match(env.LOCAL_DATABASE_DIR, /data$/);
  assert.throws(() => serverChildEnvironment({ directory: 'x', port: 1, controlPort: 2, runId: '  ' }), /runId/);
});

test('health must publish the isolation marker and the matching run ID', () => {
  const health = { status: 'ok', database: 'pglite', isolatedDatabase: true, acceptanceRunId: 'recovery-1' };
  assert.equal(assertIsolatedHealth(health, { runId: 'recovery-1' }), health);
  assert.throws(() => assertIsolatedHealth({ ...health, isolatedDatabase: false }, { runId: 'recovery-1' }), /isolatedDatabase/);
  assert.throws(() => assertIsolatedHealth({ ...health, acceptanceRunId: 'other' }, { runId: 'recovery-1' }), /acceptanceRunId/);
  assert.throws(() => assertIsolatedHealth({ ...health, database: 'postgres' }, { runId: 'recovery-1' }), /database/);
  assert.throws(() => assertIsolatedHealth(null, { runId: 'recovery-1' }), /object/);
});

test('service-restart evidence rejects a synthetic or same-process pass', () => {
  assert.equal(assertRestartEvidence(validRestart()).afterPid, 200);
  assert.throws(() => assertRestartEvidence({ ...validRestart(), afterPid: 100 }), /distinct process/);
  assert.throws(() => assertRestartEvidence({ ...validRestart(), beforePid: 0 }), /pre-restart PID/);
  assert.throws(() => assertRestartEvidence({ ...validRestart(), healthUnavailableAfterStop: false }), /unavailable/);
  assert.throws(() => assertRestartEvidence({ ...validRestart(), authenticatedRoomRestored: false }), /room/);
  assert.throws(() => assertRestartEvidence({ ...validRestart(), ledgerStateRestored: false }), /ledger/);
});

test('raw and report checks must agree exactly, and lock has its own result ID', () => {
  const raw = { checks: [
    { id: 'service-restart', passed: true, details: { activeDirectoryLockRejected: true, beforePid: 1, afterPid: 2 } },
    { id: 'active-directory-lock', passed: true, details: { activeDirectoryLockRejected: true } },
  ] };
  const report = { checks: JSON.parse(JSON.stringify(raw.checks)) };
  const byId = assertRawReportChecks(raw, report);
  assert.ok(byId.has('active-directory-lock'));
  assert.notEqual(byId.get('service-restart').id, byId.get('active-directory-lock').id);
  const drifted = { checks: [{ ...raw.checks[0], details: { ...raw.checks[0].details, afterPid: 3 } }, raw.checks[1]] };
  assert.throws(() => assertRawReportChecks(raw, drifted), /details differ/);
  const rawMissing = { checks: [raw.checks[0]] };
  assert.throws(() => assertRawReportChecks(rawMissing, report), /missing check active-directory-lock/);
});

test('freeLoopbackPort yields a usable ephemeral loopback port', async () => {
  const port = await freeLoopbackPort();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
});

test('healthUnavailable reports true only when the endpoint refuses connections', async () => {
  assert.equal(await healthUnavailable('http://127.0.0.1:1', { attempts: 1, intervalMs: 1 }), true);
  const served = { status: 'ok' };
  assert.equal(await healthUnavailable('http://example.test', { attempts: 2, intervalMs: 1,
    fetchImpl: async () => ({ status: 200, json: async () => served }) }), false);
});

test('the live directory lock is reported under its own result ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dss-recovery-lock-'));
  const data = join(directory, 'data');
  const db = await openDatabase(undefined, data);
  try {
    const check = await assertActiveDirectoryLock(data);
    assert.equal(check.id, 'active-directory-lock');
    assert.equal(check.passed, true);
    assert.equal(check.details.activeDirectoryLockRejected, true);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
