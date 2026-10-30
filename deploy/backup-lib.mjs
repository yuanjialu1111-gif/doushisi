import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

const archivePattern = /^dss-\d{8}T\d{6}Z-[a-f0-9]{12}\.dump$/;
const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
export const id = value => { if (!identifier.test(value)) throw new Error('INVALID_DATABASE_IDENTIFIER'); return `"${value}"`; };
export const iso = () => new Date().toISOString();
export function integer(value, fallback, min, max) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error('INVALID_OPERATION_SETTING');
  return result;
}
export async function atomicJson(path, value) {
  const temporary = path + '.' + randomBytes(6).toString('hex') + '.partial';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
export async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function jsonOrNull(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('INVALID_OPERATION_STATE'); }
}
export function pgEnvironment(overrides = {}) {
  const env = { ...process.env, ...overrides, PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'dss-backup-operations' };
  if (!env.PGHOST || !env.PGUSER || !env.PGPASSWORD || !identifier.test(env.PGDATABASE || '')) throw new Error('MISSING_DATABASE_ENVIRONMENT');
  // Disallow inherited alternate connection routes that could bypass restore-host checks.
  for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) delete env[key];
  return env;
}
export function pgTool(name, args, env, input, timeoutMs = 600000) {
  const binary = env.PG_BIN ? join(env.PG_BIN, name + (process.platform === 'win32' ? '.exe' : '')) : name;
  return new Promise((resolvePromise, reject) => {
    const child = execFile(binary, args, { env, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      // Never echo libpq arguments, connection strings, SQL, or raw database errors.
      if (error) reject(Object.assign(new Error(name.toUpperCase() + '_FAILED'), { code: name.toUpperCase() + '_FAILED' }));
      else resolvePromise(stdout.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
export const query = (sql, env) => pgTool('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', env.PGDATABASE], env, sql);

export async function validateArchive(directory, name, env) {
  if (!archivePattern.test(name) || basename(name) !== name) throw new Error('INVALID_ARCHIVE_NAME');
  const path = join(directory, name);
  const metadata = await jsonOrNull(path + '.json');
  if (!metadata || metadata.format !== 'postgres-custom-v1' || metadata.archive !== name || !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error('INVALID_ARCHIVE_MANIFEST');
  const sum = await readFile(path + '.sha256', 'utf8');
  if (sum !== `${metadata.sha256}  ${name}\n` || await digest(path) !== metadata.sha256) throw new Error('ARCHIVE_CHECKSUM_MISMATCH');
  if ((await stat(path)).size !== metadata.bytes) throw new Error('ARCHIVE_SIZE_MISMATCH');
  await pgTool('pg_restore', ['--list', path], env);
  return { path, metadata };
}
export async function committedArchives(directory) {
  const files = await readdir(directory);
  const committed = [];
  for (const name of files.filter(name => archivePattern.test(name) && files.includes(name + '.json') && files.includes(name + '.sha256'))) {
    const metadata = await jsonOrNull(join(directory, name + '.json'));
    if (!metadata || !Number.isFinite(Date.parse(metadata.completedAt))) throw new Error('INVALID_ARCHIVE_MANIFEST');
    committed.push({ name, at: Date.parse(metadata.completedAt) });
  }
  return committed.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name)).map(item => item.name);
}
export async function latestArchive(directory) {
  const names = await committedArchives(directory);
  if (!names.length) throw new Error('NO_COMMITTED_BACKUP');
  return names.at(-1);
}
export async function pruneBackups(directory, keep, preserveName) {
  const names = await committedArchives(directory);
  const retained = new Set([preserveName, ...(keep > 1 ? names.filter(name => name !== preserveName).slice(-(keep - 1)) : [])]);
  let removed = 0;
  for (const name of names) if (!retained.has(name)) {
    // Removing the commit marker first prevents selecting a partly removed archive.
    await rm(join(directory, name + '.json'));
    await rm(join(directory, name + '.sha256'));
    await rm(join(directory, name));
    removed++;
  }
  return removed;
}
export async function runBackup({ directory, env, retentionCount = 14 }) {
  if (!isAbsolute(directory)) throw new Error('BACKUP_DIRECTORY_MUST_BE_ABSOLUTE');
  integer(retentionCount, 14, 1, 3650);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, '.backup-lock');
  try { await mkdir(lock, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw new Error('BACKUP_ALREADY_RUNNING_OR_STALE_LOCK'); throw error; }
  const startedAt = iso();
  const name = `dss-${startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(6).toString('hex')}.dump`;
  const archive = join(directory, name), temporary = archive + '.partial';
  let committed = false;
  try {
    await atomicJson(join(lock, 'owner.json'), { pid: process.pid, startedAt });
    await atomicJson(join(directory, 'latest-status.json'), { state: 'running', startedAt });
    const version = await query('SHOW server_version;', env);
    await pgTool('pg_dump', ['--no-password', '--format=custom', '--compress=6', '--file', temporary, '--dbname', env.PGDATABASE], env);
    await pgTool('pg_restore', ['--list', temporary], env);
    const sha256 = await digest(temporary), bytes = (await stat(temporary)).size;
    if (bytes < 100) throw new Error('EMPTY_ARCHIVE');
    await rename(temporary, archive);
    await writeFile(archive + '.sha256', `${sha256}  ${name}\n`, { mode: 0o600, flag: 'wx' });
    const metadata = { format: 'postgres-custom-v1', archive: name, sourceDatabase: env.PGDATABASE, serverVersion: version, startedAt, completedAt: iso(), bytes, sha256 };
    await atomicJson(archive + '.json', metadata);
    committed = true;
    const removed = await pruneBackups(directory, retentionCount, name);
    const result = { state: 'succeeded', ...metadata, removed, retentionCount };
    await atomicJson(join(directory, 'last-success.json'), result);
    await atomicJson(join(directory, 'latest-status.json'), result);
    return result;
  } catch (error) {
    if (!committed) {
      await rm(archive, { force: true });
      await rm(archive + '.sha256', { force: true });
    }
    await atomicJson(join(directory, 'latest-status.json'), { state: 'failed', startedAt, failedAt: iso(), code: error.code || error.message });
    throw error;
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
export async function health(directory, maxAgeHours = 26, now = Date.now()) {
  const latest = await jsonOrNull(join(directory, 'latest-status.json'));
  const success = await jsonOrNull(join(directory, 'last-success.json'));
  if (!success || !archivePattern.test(success.archive) || !Number.isFinite(Date.parse(success.completedAt)) || now - Date.parse(success.completedAt) > maxAgeHours * 3600000 || Date.parse(success.completedAt) > now + 60000) throw new Error('BACKUP_MISSING_OR_STALE');
  if (latest?.state === 'failed') throw new Error('LATEST_BACKUP_FAILED');
  if (latest?.state === 'running' && now - Date.parse(latest.startedAt) > 12 * 60000) throw new Error('BACKUP_STALLED');
  if (!await stat(join(directory, success.archive)).catch(() => null)) throw new Error('LATEST_ARCHIVE_MISSING');
  return { state: 'healthy', lastSuccess: success.completedAt, archive: success.archive };
}
export function scheduledSlot(now, utcTime) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(utcTime)) throw new Error('INVALID_BACKUP_UTC_TIME');
  const date = new Date(now), [hours, minutes] = utcTime.split(':').map(Number);
  date.setUTCHours(hours, minutes, 0, 0);
  if (date.getTime() > now) date.setUTCDate(date.getUTCDate() - 1);
  return date.getTime();
}

export async function restoredMetrics(env) {
  return JSON.parse(await query(`SELECT json_build_object(
    'database',current_database(),
    'schemaVersion',(SELECT max(version) FROM schema_migrations),
    'accounts',(SELECT count(*) FROM accounts),
    'wallets',(SELECT count(*) FROM wallets),
    'ledgerOperations',(SELECT count(*) FROM ledger_operations),
    'ledgerEntries',(SELECT count(*) FROM ledger_entries),
    'rooms',(SELECT count(*) FROM rooms),
    'rounds',(SELECT count(*) FROM rounds),
    'totalBalance',(SELECT coalesce(sum(balance),0)::text FROM wallets),
    'ledgerMismatches',(SELECT count(*) FROM wallets w LEFT JOIN (SELECT user_id,sum(amount) amount FROM ledger_entries GROUP BY user_id) e ON e.user_id=w.user_id WHERE w.balance<>coalesce(e.amount,0)),
    'historyTriggers',(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgrelid IN ('ledger_entries'::regclass,'ledger_operations'::regclass,'audit_events'::regclass,'game_events'::regclass,'round_score_events'::regclass))
  );`, env));
}
export async function restoreArchive({ directory, name, env, reportDirectory }) {
  if (env.PGDATABASE !== 'postgres' || !env.RESTORE_EXPECT_HOST || env.PGHOST !== env.RESTORE_EXPECT_HOST) throw new Error('RESTORE_REQUIRES_EXPLICIT_ISOLATED_HOST');
  if (env.PGHOST === 'database' || env.PGUSER === 'dss_app' || env.PGUSER === 'dss_migrator' || env.PGUSER === 'dss_backup') throw new Error('RESTORE_REFUSES_LIVE_SERVICE');
  if (!env.PGPASSWORD) throw new Error('RESTORE_PASSWORD_REQUIRED');
  const { path, metadata } = await validateArchive(directory, name || await latestArchive(directory), env);
  const target = 'dss_restore_' + randomBytes(12).toString('hex');
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  const report = { startedAt: iso(), sourceArchive: metadata.archive, sourceSha256: metadata.sha256, targetDatabase: target, passed: false, liveDatabaseModified: false };
  let created = false;
  try {
    // No caller-controlled target, DROP, --clean, or existing database is accepted.
    await query(`CREATE DATABASE ${id(target)} TEMPLATE template0;`, env);
    created = true;
    const targetEnv = { ...env, PGDATABASE: target };
    await pgTool('pg_restore', ['--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname', target, path], targetEnv);
    const metrics = await restoredMetrics(targetEnv);
    if (metrics.ledgerMismatches !== 0 || metrics.historyTriggers < 10 || !metrics.schemaVersion) throw new Error('RESTORED_INTEGRITY_CHECK_FAILED');
    report.metrics = metrics; report.passed = true; report.completedAt = iso();
    return report;
  } catch (error) {
    report.failedAt = iso(); report.code = error.code || error.message; report.targetCreated = created;
    throw error;
  } finally {
    // Keep the isolated database available for inspection, including failed drills.
    await atomicJson(join(reportDirectory, target + '.json'), report);
  }
}
