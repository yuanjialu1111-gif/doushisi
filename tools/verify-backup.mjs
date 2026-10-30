import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { committedArchives, health, id, jsonOrNull, latestArchive, pgEnvironment, query, restoredMetrics, restoreArchive, runBackup, scheduledSlot, validateArchive } from '../deploy/backup-lib.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runId = randomBytes(8).toString('hex');
const work = resolve(process.env.BACKUP_VERIFY_WORK || join(repository, '../../work/backup-verification', runId));
const reportPath = resolve(process.env.BACKUP_VERIFY_REPORT || join(work, 'verification.json'));
const env = pgEnvironment();
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST), 'Verification only uses a dedicated loopback PostgreSQL instance');
assert.equal(env.PGDATABASE, 'postgres');
assert.equal(process.env.BACKUP_VERIFY_DISPOSABLE_CLUSTER, 'true', 'An explicitly disposable cluster is required');
const database = 'dss_backup_source_' + runId;
const role = 'dss_backup_test_' + runId;
const password = randomBytes(32).toString('hex');
const directory = join(work, 'backups');
const reportDirectory = join(work, 'restore-reports');
const report = { startedAt: new Date().toISOString(), engine: 'PostgreSQL', scope: 'Real pg_dump/pg_restore on a disposable TCP loopback cluster with synthetic ledger fixtures', dockerExecuted: false, productionVerified: false, checks: [] };
let sourceCreated = false, roleCreated = false;
const restoredDatabases = [];

async function check(name, run) {
  const started = Date.now();
  try { const details = await run(); report.checks.push({ name, passed: true, durationMs: Date.now() - started, details }); }
  catch (error) { report.checks.push({ name, passed: false, error: error.code || error.message }); throw error; }
}

await mkdir(work, { recursive: true });
try {
  await query(`CREATE DATABASE ${id(database)} TEMPLATE template0;`, env); sourceCreated = true;
  await query(`CREATE ROLE ${id(role)} LOGIN PASSWORD '${password}'; GRANT pg_read_all_data TO ${id(role)};`, env); roleCreated = true;
  const sourceEnv = { ...env, PGDATABASE: database };
  const backupEnv = { ...sourceEnv, PGUSER: role, PGPASSWORD: password };
  await query('CREATE TABLE schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());', sourceEnv);
  for (const file of (await readdir(join(repository, 'apps/server/migrations'))).filter(file => /^\d+-[\w-]+\.sql$/.test(file)).sort()) {
    const version = Number(file.split('-')[0]);
    await query('BEGIN;\n' + await readFile(join(repository, 'apps/server/migrations', file), 'utf8') + `\nINSERT INTO schema_migrations(version) VALUES(${version}); COMMIT;`, sourceEnv);
  }
  await query(`
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    INSERT INTO accounts(id,username,nickname,password_hash,role) VALUES
      ('00000000-0000-4000-8000-000000000001','backup_fixture_one','Fixture One','not-a-login-hash','player'),
      ('00000000-0000-4000-8000-000000000002','backup_fixture_two','Fixture Two','not-a-login-hash','player');
    INSERT INTO wallets(user_id,balance) VALUES
      ('00000000-0000-4000-8000-000000000001',9007199254740993.125),('00000000-0000-4000-8000-000000000002',0.375);
    INSERT INTO ledger_operations(id,request_key,request_hash,kind,reason) VALUES
      ('00000000-0000-4000-8000-000000000011','backup-fixture-1','fixture','admin_add','Synthetic backup fixture'),
      ('00000000-0000-4000-8000-000000000012','backup-fixture-2','fixture','admin_add','Synthetic backup fixture');
    INSERT INTO ledger_entries(id,operation_id,user_id,amount,balance_before,balance_after) VALUES
      ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',9007199254740993.125,0,9007199254740993.125),
      ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002',0.375,0,0.375);
  `, sourceEnv);
  const sourceMetrics = await restoredMetrics(sourceEnv);
  await check('read-only backup role cannot update balances', async () => {
    await assert.rejects(query('UPDATE wallets SET balance=balance;', backupEnv), /PSQL_FAILED/);
    return { roleHasReadAllData: true, walletUpdateRejected: true };
  });
  await check('custom dump, manifest, SHA-256 and archive structure', async () => {
    const result = await runBackup({ directory, env: backupEnv, retentionCount: 2 });
    await validateArchive(directory, result.archive, env);
    await health(directory);
    return { format: result.format, bytes: result.bytes, archive: result.archive, sha256: result.sha256 };
  });
  await check('retention preserves two newest committed archives', async () => {
    await runBackup({ directory, env: backupEnv, retentionCount: 2 });
    const result = await runBackup({ directory, env: backupEnv, retentionCount: 2 });
    assert.equal((await committedArchives(directory)).length, 2);
    assert.equal(await latestArchive(directory), result.archive);
    return { retained: 2, latestPreserved: true };
  });
  await check('failed backup becomes unhealthy and later success recovers', async () => {
    await assert.rejects(runBackup({ directory, env: { ...backupEnv, PGPASSWORD: 'deliberately-invalid' }, retentionCount: 2 }));
    assert.equal((await jsonOrNull(join(directory, 'latest-status.json'))).state, 'failed');
    await assert.rejects(health(directory), /LATEST_BACKUP_FAILED/);
    assert.ok(!(await readdir(directory)).some(name => name.endsWith('.partial') || name === '.backup-lock'));
    await runBackup({ directory, env: backupEnv, retentionCount: 2 });
    await health(directory);
    return { failedVisible: true, incompleteArchiveNotPublished: true, recoveryHealthy: true };
  });
  await check('overlapping backup rejects without removing active lock', async () => {
    await mkdir(join(directory, '.backup-lock'));
    try { await assert.rejects(runBackup({ directory, env: backupEnv }), /BACKUP_ALREADY_RUNNING_OR_STALE_LOCK/); }
    finally { await rm(join(directory, '.backup-lock'), { recursive: true }); }
    return { rejected: true };
  });
  await check('daily schedule and stale backup health', async () => {
    assert.equal(new Date(scheduledSlot(Date.parse('2026-09-08T18:59:00Z'), '19:00')).toISOString(), '2026-09-07T19:00:00.000Z');
    assert.equal(new Date(scheduledSlot(Date.parse('2026-09-08T19:00:00Z'), '19:00')).toISOString(), '2026-09-08T19:00:00.000Z');
    await assert.rejects(health(directory, 26, Date.now() + 27 * 3600000), /BACKUP_MISSING_OR_STALE/);
    return { dailyUTC: '19:00', staleAtHours: 27 };
  });
  await check('scheduler CLI performs first backup and reports success', async () => {
    const schedulerDirectory = join(work, 'scheduler-backups');
    const child = spawn(process.execPath, [join(repository, 'deploy/backup-cli.mjs'), 'schedule'], {
      env: { ...backupEnv, BACKUP_DIRECTORY: schedulerDirectory, BACKUP_RETENTION_COUNT: '2' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logs = [];
    child.stdout.on('data', data => logs.push(data.toString()));
    child.stderr.on('data', data => logs.push(data.toString()));
    const exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
    try {
      let success = null;
      for (let poll = 0; poll < 100 && !success; poll++) {
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
        success = await jsonOrNull(join(schedulerDirectory, 'last-success.json'));
      }
      assert.ok(success, 'Scheduler must create its first backup');
      await health(schedulerDirectory);
      assert.ok(logs.join('').includes('scheduler_started'));
      assert.ok(!logs.join('').includes(password), 'Scheduler logs must exclude credentials');
      return { firstBackupCommitted: true, healthPassed: true, passwordAbsentFromLogs: true };
    } finally {
      child.kill('SIGTERM');
      await exited;
    }
  });
  const restoreEnv = { ...env, RESTORE_EXPECT_HOST: env.PGHOST };
  await check('live database and wrong target host are refused', async () => {
    await assert.rejects(restoreArchive({ directory, env: { ...restoreEnv, PGDATABASE: database }, reportDirectory }), /RESTORE_REQUIRES_EXPLICIT_ISOLATED_HOST/);
    await assert.rejects(restoreArchive({ directory, env: { ...restoreEnv, RESTORE_EXPECT_HOST: 'other-host' }, reportDirectory }), /RESTORE_REQUIRES_EXPLICIT_ISOLATED_HOST/);
    await assert.rejects(restoreArchive({ directory, env: { ...restoreEnv, PGHOST: 'database', RESTORE_EXPECT_HOST: 'database' }, reportDirectory }), /RESTORE_REFUSES_LIVE_SERVICE/);
    return { existingDatabaseNeverUsed: true, hostGuardPassed: true };
  });
  await check('corrupted archive rejected before database creation', async () => {
    const corruptDirectory = join(work, 'corrupt'); await mkdir(corruptDirectory);
    const name = await latestArchive(directory);
    for (const suffix of ['', '.sha256', '.json']) await copyFile(join(directory, name + suffix), join(corruptDirectory, name + suffix));
    const file = await open(join(corruptDirectory, name), 'r+');
    try { await file.write(Buffer.from([0]), 0, 1, 0); } finally { await file.close(); }
    const before = await query("SELECT count(*) FROM pg_database WHERE datname LIKE 'dss_restore_%';", env);
    await assert.rejects(restoreArchive({ directory: corruptDirectory, env: restoreEnv, reportDirectory }), /ARCHIVE_CHECKSUM_MISMATCH/);
    assert.equal(await query("SELECT count(*) FROM pg_database WHERE datname LIKE 'dss_restore_%';", env), before);
    return { checksumRejected: true, noDatabaseCreated: true };
  });
  await check('isolated real restore preserves exact balances, ledger and triggers', async () => {
    const result = await restoreArchive({ directory, env: restoreEnv, reportDirectory });
    restoredDatabases.push(result.targetDatabase);
    const { database: ignoredSource, ...expected } = sourceMetrics;
    const { database: ignoredTarget, ...actual } = result.metrics;
    assert.deepEqual(actual, expected);
    assert.equal(actual.totalBalance, '9007199254740993.500');
    await assert.rejects(query('DELETE FROM ledger_entries;', { ...env, PGDATABASE: result.targetDatabase }), /PSQL_FAILED/);
    assert.deepEqual(await restoredMetrics(sourceEnv), sourceMetrics);
    return { ...result.metrics, sourceUnchanged: true, historicalDeleteRejected: true };
  });
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.code || error.message; process.exitCode = 1; }
finally {
  for (const target of restoredDatabases) await query(`DROP DATABASE ${id(target)};`, env);
  if (sourceCreated) await query(`DROP DATABASE ${id(database)};`, env);
  if (roleCreated) await query(`DROP ROLE ${id(role)};`, env);
  report.completedAt = new Date().toISOString();
  report.temporaryDatabasesRemoved = true;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
