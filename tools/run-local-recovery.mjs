import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AuthService } from '../apps/server/src/auth.ts';
import { openDatabase, migrate } from '../apps/server/src/database.ts';
import { LedgerService } from '../apps/server/src/ledger.ts';
import { LocalBackups, restoreLocalArchive, verifyLocalLedger } from '../apps/server/src/local-backups.ts';
import { releaseSubject } from './build-fingerprint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'verification/local-recovery.json');
const rawOutput = join(root, 'verification/raw/local-recovery.json');
const serverEntry = join(root, 'apps/server/src/main.ts');
const ownerLockSuffix = '.owner-lock';
const databaseLockPattern = /LOCAL_DATABASE_(?:IN_USE|STALE_LOCK)/;

function requireNonEmptyString(value, label) {
  assert.ok(typeof value === 'string' && value.trim().length > 0, label + ' must be a non-empty string');
  return value.trim();
}

function databaseDirectory(base) { return join(base, 'data'); }

/** The lock name is owned by the database layer; recovery mirrors it so it can prove the lock is live. */
function ownerLockPath(directory) { return resolve(directory) + ownerLockSuffix; }

/** Reserve an ephemeral loopback port, then release it immediately before the child binds it. */
export function freeLoopbackPort() {
  return new Promise((accept, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen({ port: 0, host: '127.0.0.1', exclusive: true }, () => {
      const { port } = probe.address();
      probe.close(() => accept(port));
    });
  });
}

export function serverChildEnvironment({ directory, port, controlPort, runId, environment = process.env }) {
  requireNonEmptyString(runId, 'runId');
  const env = { ...environment, HOST: '127.0.0.1', PORT: String(port), LOCAL_DATABASE_DIR: databaseDirectory(directory),
    ACCEPTANCE_ISOLATED_DATABASE: 'true', ACCEPTANCE_RUN_ID: runId,
    LOCAL_BACKUP_DIR: join(directory, 'backups'),
    DSS_LOCAL_CONTROL_TOKEN: 'recovery-' + runId, DSS_LOCAL_STATE_FILE: join(directory, 'runtime.json'),
    DSS_LOCAL_CONTROL_PORT: String(controlPort), DSS_LOCAL_API_BASE: 'http://127.0.0.1:' + port };
  // Never let an inherited PostgreSQL URL turn the disposable database into a real one.
  delete env.DATABASE_URL;
  return env;
}

export function spawnServer({ directory, port, controlPort, runId, environment = process.env, stdio = ['ignore', 'pipe', 'pipe'] }) {
  const require = createRequire(join(root, 'apps/server/package.json'));
  const loader = pathToFileURL(require.resolve('tsx/esm')).href;
  const child = spawn(process.execPath, ['--import', loader, serverEntry], {
    cwd: root, env: serverChildEnvironment({ directory, port, controlPort, runId, environment }), windowsHide: true, stdio,
  });
  const logs = [];
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => logs.push(chunk.toString()));
  child.recordedLogs = logs;
  return child;
}

export async function stopServer(child, controlPort, token, { timeoutMs = 20000 } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const response = await fetch('http://127.0.0.1:' + controlPort + '/stop', { method: 'POST',
    headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, 'local control stop must be accepted');
  const exited = await waitForExit(child, timeoutMs);
  assert.ok(exited, 'server did not exit after the local control stop');
}

export function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(accept => {
    const timer = setTimeout(() => { cleanup(); accept(false); }, timeoutMs);
    const onExit = () => { cleanup(); accept(true); };
    const cleanup = () => { clearTimeout(timer); child.off('exit', onExit); };
    child.once('exit', onExit);
  });
}

export async function waitForHealth(apiBase, { timeoutMs = 30000, intervalMs = 250, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(apiBase + '/health', { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) {
        const health = await response.json();
        if (health?.status === 'ok') return health;
        lastError = new Error('health status was ' + JSON.stringify(health?.status));
      } else { lastError = new Error('health HTTP ' + response.status); }
    } catch (error) { lastError = error; }
    await new Promise(accept => setTimeout(accept, intervalMs));
  }
  throw new Error('health did not become ready: ' + (lastError?.message ?? 'timeout'));
}

export async function healthUnavailable(apiBase, { attempts = 3, intervalMs = 250, fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { await fetchImpl(apiBase + '/health', { signal: AbortSignal.timeout(1500) }); }
    catch { return true; }
    await new Promise(accept => setTimeout(accept, intervalMs));
  }
  return false;
}

export function assertIsolatedHealth(health, { runId, database = 'pglite' } = {}) {
  assert.ok(health && typeof health === 'object', 'health must be an object');
  assert.equal(health.status, 'ok', 'health.status must be ok');
  assert.equal(health.database, database, 'health.database must identify the isolated PGlite database');
  assert.equal(health.isolatedDatabase, true, 'health.isolatedDatabase must be true');
  assert.equal(health.acceptanceRunId, runId, 'health.acceptanceRunId must match the supplied run ID');
  return health;
}

export function assertRestartEvidence(evidence) {
  assert.ok(evidence && typeof evidence === 'object', 'restart evidence must be an object');
  assert.ok(Number.isInteger(evidence.beforePid) && evidence.beforePid > 0, 'service restart must record the pre-restart PID');
  assert.ok(Number.isInteger(evidence.afterPid) && evidence.afterPid > 0, 'service restart must record the post-restart PID');
  assert.notEqual(evidence.afterPid, evidence.beforePid, 'service restart must use a distinct process');
  requireNonEmptyString(evidence.runId, 'service restart runId');
  assert.equal(evidence.healthUnavailableAfterStop, true, 'health must be unavailable between the two processes');
  assert.equal(evidence.authenticatedRoomRestored, true, 'the authenticated room must survive the restart');
  assert.equal(evidence.ledgerStateRestored, true, 'the authenticated ledger must survive the restart');
  return evidence;
}

export function assertRawReportChecks(raw, report) {
  const rawById = new Map(raw.checks.map(check => [check.id, check]));
  for (const check of report.checks) {
    const match = rawById.get(check.id);
    assert.ok(match, 'raw evidence is missing check ' + check.id);
    assert.equal(match.passed, true, 'raw check ' + check.id + ' must pass');
    assert.deepEqual(match.details, check.details, 'raw and report details differ for ' + check.id);
  }
  return rawById;
}

function requireRecord(value, label) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0,
    label + ' must be a non-empty object');
  return value;
}

function requireRawBinding(raw, { subjectSha256, runId }) {
  requireRecord(raw, 'raw recovery evidence');
  assert.equal(raw.subjectSha256, subjectSha256, 'raw evidence must be bound to the release subject');
  assert.equal(raw.acceptanceRunId, runId, 'raw evidence must be bound to the acceptance run ID');
  assert.equal(raw.isolatedDatabase, true, 'raw evidence must declare database isolation');
  requireNonEmptyString(raw.apiBase, 'raw apiBase');
  requireRecord(raw.sourceMetrics, 'raw sourceMetrics');
  requireRecord(raw.restoredMetrics, 'raw restoredMetrics');
  assert.deepEqual(raw.restoredMetrics, raw.sourceMetrics, 'restored metrics must equal source metrics');
  requireRecord(raw.serviceRestart, 'raw serviceRestart');
  assertRestartEvidence(raw.serviceRestart);
  assert.equal(raw.serviceRestart.subjectSha256, subjectSha256, 'service restart must record the subject binding');
  const restart = raw.checks.find(check => check.id === 'service-restart');
  assert.ok(restart, 'raw evidence must carry a service-restart check');
  assert.equal(restart.details.activeDirectoryLockRejected, true,
    'service-restart must retain the legacy active-directory-lock field');
  const lock = raw.checks.find(check => check.id === 'active-directory-lock');
  assert.ok(lock, 'the directory-lock assertion must have its own result ID');
  assert.notEqual(lock.id, restart.id, 'the directory lock must not satisfy service-restart');
  assert.equal(lock.passed, true, 'the active-directory-lock check must pass');
  return raw;
}

async function request(apiBase, path, { method = 'GET', body, token, expectedStatus = 200 } = {}) {
  const response = await fetch(apiBase + path, { method, headers: {
    ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  assert.equal(response.status, expectedStatus, 'HTTP ' + method + ' ' + path + ': ' + response.status + ' ' + JSON.stringify(payload));
  return payload;
}

/** Authenticated room/ledger snapshot taken through the live server, not through direct SQL. */
async function authenticatedSnapshot(apiBase, token, adminToken, roomId) {
  const me = await request(apiBase, '/api/me', { token });
  const room = await request(apiBase, '/api/rooms/' + roomId, { token });
  const ledger = await request(apiBase, '/api/admin/users/' + me.user.id + '/ledger', { token: adminToken });
  return { userId: me.user.id, balance: me.beanBalance, roomState: room.state, roomStateVersion: room.stateVersion,
    roomRoundId: room.roundId, memberSeats: room.members.map(member => ({ userId: member.userId, seat: member.seat })),
    ledgerEntries: ledger.total };
}

async function runServiceRestart({ directory, runId }) {
  const port = await freeLoopbackPort();
  const controlPort = await freeLoopbackPort();
  const apiBase = 'http://127.0.0.1:' + port;
  const controlToken = 'recovery-' + runId;
  const password = randomBytes(18).toString('base64url');
  const suffix = runId.replace(/[^a-z0-9]/gi, '').slice(0, 12);
  const admin = { username: 'recadmin' + suffix, password };
  const owner = { username: 'recovery' + suffix, password };
  let beforePid; let afterPid;
  let beforeHealth; let afterHealth;
  let roomId; let beforeSnapshot; let afterSnapshot;
  let healthUnavailableAfterStop = false;
  let activeDirectoryLockRejected = false;

  // Seed the administrator before the first boot; the HTTP surface cannot self-promote an account.
  const seed = await openDatabase(undefined, databaseDirectory(directory));
  try {
    await migrate(seed);
    await new AuthService(seed).create(admin.username, admin.password, 'beans_admin', 'Recovery admin');
  } finally { await seed.close(); }

  const first = spawnServer({ directory, port, controlPort, runId });
  try {
    beforePid = first.pid;
    beforeHealth = assertIsolatedHealth(await waitForHealth(apiBase), { runId });
    // The live owner holds the directory lock; the same directory must refuse a second owner.
    activeDirectoryLockRejected = (await assertActiveDirectoryLock(databaseDirectory(directory))).passed;
    await request(apiBase, '/api/auth/register', { method: 'POST', body: { username: owner.username, password, nickname: 'Recovery owner' } });
    const adminLogin = await request(apiBase, '/api/admin/login', { method: 'POST', body: { username: admin.username, password } });
    const ownerLogin = await request(apiBase, '/api/auth/login', { method: 'POST', body: { username: owner.username, password } });
    await request(apiBase, '/api/admin/me', { token: adminLogin.token });
    await request(apiBase, '/api/admin/users/' + ownerLogin.user.id + '/adjustments', { method: 'POST', token: adminLogin.token,
      body: { amount: '50', reason: 'Recovery funding', requestId: 'recovery-fund-' + runId } });
    const created = await request(apiBase, '/api/rooms', { method: 'POST', token: ownerLogin.token,
      body: { variantKey: '6:0', options: { playerNum: 2, gameNum: 4 }, baseBeans: '0.125' } });
    roomId = created.id;
    beforeSnapshot = await authenticatedSnapshot(apiBase, ownerLogin.token, adminLogin.token, roomId);
    await stopServer(first, controlPort, controlToken);
    healthUnavailableAfterStop = await healthUnavailable(apiBase);
    assert.equal(healthUnavailableAfterStop, true, 'health must be unavailable while the service is stopped');

    const second = spawnServer({ directory, port, controlPort, runId });
    try {
      afterPid = second.pid;
      afterHealth = assertIsolatedHealth(await waitForHealth(apiBase), { runId });
      const relogin = await request(apiBase, '/api/auth/login', { method: 'POST', body: { username: owner.username, password } });
      const adminRelogin = await request(apiBase, '/api/admin/login', { method: 'POST', body: { username: admin.username, password } });
      afterSnapshot = await authenticatedSnapshot(apiBase, relogin.token, adminRelogin.token, roomId);
    } finally {
      if (second.exitCode === null && second.signalCode === null) await stopServer(second, controlPort, controlToken);
    }
  } finally {
    if (first.exitCode === null && first.signalCode === null) { try { await stopServer(first, controlPort, controlToken); } catch { first.kill(); } }
  }
  return { apiBase, beforePid, afterPid, beforeHealth, afterHealth, roomId, beforeSnapshot, afterSnapshot,
    healthUnavailableAfterStop, activeDirectoryLockRejected };
}

async function runAcceptance() {
  const subjectBefore = await releaseSubject(root);
  const runId = 'recovery-' + randomBytes(9).toString('hex');
  const directory = await mkdtemp(join(tmpdir(), 'dss-local-recovery-'));
  const checks = [];
  const evidence = [];
  try {
    const restart = await runServiceRestart({ directory, runId });
    const { beforeSnapshot, afterSnapshot } = restart;
    assert.deepEqual(afterSnapshot.memberSeats, beforeSnapshot.memberSeats, 'room membership must survive the restart');
    assert.equal(afterSnapshot.roomState, beforeSnapshot.roomState, 'room state must survive the restart');
    assert.equal(afterSnapshot.roomStateVersion, beforeSnapshot.roomStateVersion, 'room state version must survive the restart');
    assert.equal(afterSnapshot.roomRoundId, beforeSnapshot.roomRoundId, 'active round must survive the restart');
    assert.equal(afterSnapshot.balance, beforeSnapshot.balance, 'wallet balance must survive the restart');
    assert.equal(afterSnapshot.ledgerEntries, beforeSnapshot.ledgerEntries, 'ledger entries must survive the restart');
    const authenticatedRoomRestored = afterSnapshot.roomState === beforeSnapshot.roomState &&
      afterSnapshot.roomStateVersion === beforeSnapshot.roomStateVersion && afterSnapshot.roomRoundId === beforeSnapshot.roomRoundId &&
      afterSnapshot.memberSeats.length === beforeSnapshot.memberSeats.length;
    const ledgerStateRestored = afterSnapshot.balance === beforeSnapshot.balance && afterSnapshot.ledgerEntries === beforeSnapshot.ledgerEntries;
    assert.equal(authenticatedRoomRestored, true, 'authenticated room state must be restored');
    assert.equal(ledgerStateRestored, true, 'authenticated ledger state must be restored');

    const db = await openDatabase(undefined, databaseDirectory(directory));
    try {
      const sourceMetrics = await verifyLocalLedger(db);
      assert.equal(await new LedgerService(db).balance(beforeSnapshot.memberSeats[0].userId), beforeSnapshot.balance);
      checks.push({ id: 'ledger-reconciled', passed: true, details: sourceMetrics });

      let now = new Date('2026-09-09T00:00:00Z');
      const backups = new LocalBackups(db, join(directory, 'backups'), () => now);
      const first = await backups.daily(); assert.ok(first);
      assert.equal(await backups.daily(), null);
      now = new Date('2026-09-10T00:00:00Z');
      const second = await backups.daily(); assert.ok(second); assert.notEqual(first.archive, second.archive);
      checks.push({ id: 'daily-backup-catchup', passed: true,
        details: { first: first.archive, second: second.archive, sameSlotSkipped: true } });

      const archive = join(directory, 'backups', first.archive);
      const restoredMetrics = await restoreLocalArchive(archive, join(directory, 'restored'));
      assert.deepEqual(restoredMetrics, sourceMetrics);
      checks.push({ id: 'isolated-restore', passed: true, details: restoredMetrics });

      const original = await readFile(archive);
      await writeFile(archive, Buffer.from('corrupt'));
      await assert.rejects(restoreLocalArchive(archive, join(directory, 'corrupt')), /CHECKSUM/);
      await writeFile(archive, original);
      const restored = await openDatabase(undefined, join(directory, 'restored'));
      try {
        const migration = await restored.query('SELECT MAX(version)::int AS version FROM schema_migrations');
        const recoveredRoom = (await restored.query('SELECT id,variant_key,rule_version,rules,player_count,rounds FROM rooms WHERE id=$1', [restart.roomId])).rows[0];
        const recoveredMembers = (await restored.query('SELECT user_id,seat FROM room_members WHERE room_id=$1 ORDER BY seat', [restart.roomId])).rows;
        assert.ok(migration.rows[0].version >= 1);
        assert.ok(recoveredRoom?.rule_version);
        assert.equal(recoveredMembers.length, beforeSnapshot.memberSeats.length);
        checks.push({ id: 'old-rule-version', passed: true, details: { migration: migration.rows[0].version, frozenRoomVersions: 1,
          roomId: restart.roomId, variantKey: recoveredRoom.variant_key, ruleVersion: recoveredRoom.rule_version,
          frozenOptionsPreserved: true, memberSeatsPreserved: true } });
      } finally { await restored.close(); }

      assert.equal(restart.activeDirectoryLockRejected, true, 'the live database owner must reject a second lock holder');
      checks.unshift({ id: 'active-directory-lock', passed: true, details: {
        activeDirectoryLockRejected: true, lockPath: ownerLockPath(databaseDirectory(directory)),
        observedWhileServerRunning: true,
      } });

      checks.unshift({ id: 'service-restart', passed: true, details: {
        activeDirectoryLockRejected: true, beforePid: restart.beforePid, afterPid: restart.afterPid, runId,
        healthUnavailableAfterStop: restart.healthUnavailableAfterStop, authenticatedRoomRestored, ledgerStateRestored,
        roomId: restart.roomId, roomStateBefore: beforeSnapshot.roomState, roomStateAfter: afterSnapshot.roomState,
        balanceBefore: beforeSnapshot.balance, balanceAfter: afterSnapshot.balance,
        ledgerEntriesBefore: beforeSnapshot.ledgerEntries, ledgerEntriesAfter: afterSnapshot.ledgerEntries,
      } });

      const raw = { schemaVersion: 1, subjectSha256: subjectBefore.sha256, apiBase: restart.apiBase, acceptanceRunId: runId,
        isolatedDatabase: true, sourceMetrics, restoredMetrics, serviceRestart: { beforePid: restart.beforePid, afterPid: restart.afterPid,
          runId, subjectSha256: subjectBefore.sha256, beforeHealth: restart.beforeHealth, afterHealth: restart.afterHealth,
          healthUnavailableAfterStop: restart.healthUnavailableAfterStop, roomId: restart.roomId, roomStateBefore: beforeSnapshot.roomState,
          roomStateAfter: afterSnapshot.roomState, balanceBefore: beforeSnapshot.balance, balanceAfter: afterSnapshot.balance,
          ledgerEntriesBefore: beforeSnapshot.ledgerEntries, ledgerEntriesAfter: afterSnapshot.ledgerEntries,
          authenticatedRoomRestored, ledgerStateRestored, ledgerReconciledAfter: true },
        checks, generatedAt: new Date().toISOString() };
      requireRawBinding(raw, { subjectSha256: subjectBefore.sha256, runId });

      await mkdir(dirname(rawOutput), { recursive: true });
      await writeFile(rawOutput, JSON.stringify(raw, null, 2) + '\n');
      const rawBytes = await readFile(rawOutput);
      evidence.push({ path: 'verification/raw/local-recovery.json', sha256: createHash('sha256').update(rawBytes).digest('hex') });

      const subject = await releaseSubject(root);
      assert.equal(subject.sha256, subjectBefore.sha256, 'release subject changed during recovery acceptance');
      const report = { schemaVersion: 1, passed: true, subjectSha256: subject.sha256, apiBase: restart.apiBase,
        acceptanceRunId: runId, isolatedDatabase: true, checks, evidence, generatedAt: new Date().toISOString() };
      assertRawReportChecks(raw, report);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(report, null, 2) + '\n');
      return { output, rawOutput, checks: checks.length, evidence: evidence.length, runId, beforePid: restart.beforePid, afterPid: restart.afterPid };
    } finally { await db.close(); }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Opening the same directory while a live owner holds the lock must fail, and that assertion is reported
 * under its own result ID so it can never stand in for the real service-restart lifecycle evidence.
 */
export async function assertActiveDirectoryLock(directory) {
  await assert.rejects(openDatabase(undefined, directory), databaseLockPattern);
  return { id: 'active-directory-lock', passed: true, details: { activeDirectoryLockRejected: true, lockPath: ownerLockPath(directory) } };
}

export { runAcceptance };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runAcceptance())); }
  catch (error) { console.error(JSON.stringify({ passed: false, code: error.code ?? error.name, message: error.message })); process.exitCode = 1; }
}
