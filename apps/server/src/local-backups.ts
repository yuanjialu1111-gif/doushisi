import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Database, Sql } from './database.js';

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const archiveName = /^beans-\d{8}T\d{6}Z-[a-f0-9-]+\.tgz$/;
const slot = (at: Date) => new Date(at.getTime() + 5 * 3600_000).toISOString().slice(0, 10); // 03:00 Asia/Shanghai
export async function atomicLocalJson(path: string, value: unknown) {
  const pending = path + '.' + randomUUID() + '.partial';
  await writeFile(pending, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(pending, path);
}

export async function verifyLocalLedger(db: Sql) {
  const migration = await db.query('SELECT MAX(version)::int AS version FROM schema_migrations');
  const invalid = await db.query(`SELECT count(*)::int AS n FROM wallets w WHERE w.balance IS DISTINCT FROM
    (SELECT COALESCE(sum(e.amount),0) FROM ledger_entries e WHERE e.user_id=w.user_id)`);
  if (invalid.rows[0]!.n !== 0) throw new Error('BACKUP_LEDGER_MISMATCH');
  const inconsistent = await db.query(`SELECT count(*)::int AS n FROM ledger_entries
    WHERE balance_after <> balance_before + amount`);
  if (inconsistent.rows[0]!.n !== 0) throw new Error('BACKUP_ENTRY_MISMATCH');
  const counts = await db.query(`SELECT (SELECT count(*)::int FROM accounts) AS accounts,
    (SELECT count(*)::int FROM ledger_entries) AS entries,(SELECT count(*)::int FROM rounds) AS rounds,
    (SELECT count(*)::int FROM game_events) AS events`);
  return { migration: migration.rows[0]!.version, ...counts.rows[0] };
}

export class LocalBackups {
  private running: Promise<unknown> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private db: Database, readonly directory: string, private now = () => new Date()) {}

  async save(reason: 'daily' | 'manual' | 'before-migration' = 'manual') {
    if (this.running) return this.running;
    this.running = this.perform(reason);
    try { return await this.running; } finally { this.running = null; }
  }
  private async perform(reason: string) {
    if (!this.db.backup) throw new Error('LOCAL_BACKUP_REQUIRES_PGLITE');
    await mkdir(this.directory, { recursive: true });
    const now = this.now();
    const name = `beans-${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z-${randomUUID()}.tgz`;
    const data = await this.db.backup();
    const metadata = { format: 'pglite-datadir-v1', archive: name, sha256: digest(data), bytes: data.length,
      createdAt: now.toISOString(), slot: slot(now), reason };
    const path = join(this.directory, name);
    await writeFile(path + '.partial', data, { mode: 0o600 });
    await rename(path + '.partial', path);
    await atomicLocalJson(path + '.json', metadata);
    await atomicLocalJson(join(this.directory, 'latest.json'), metadata);
    const names = (await readdir(this.directory)).filter(file => archiveName.test(file)).sort();
    const committed = [];
    for (const file of names) {
      try { await readFile(join(this.directory, file + '.json')); committed.push(file); } catch { /* Incomplete archive. */ }
    }
    for (const file of committed.slice(0, Math.max(0, committed.length - 14))) {
      await unlink(join(this.directory, file + '.json'));
      await unlink(join(this.directory, file));
    }
    return metadata;
  }
  async daily() {
    let previous: { slot?: string } = {};
    try { previous = JSON.parse(await readFile(join(this.directory, 'latest.json'), 'utf8')); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (previous.slot !== slot(this.now())) return this.save('daily');
    return null;
  }
  async start() {
    await this.daily();
    this.timer = setInterval(() => { void this.daily().catch(async () => {
      await atomicLocalJson(join(this.directory, 'failure.json'), { at: this.now().toISOString(), code: 'LOCAL_BACKUP_FAILED' }).catch(() => {});
    }); }, 60_000);
    this.timer.unref();
  }
  async stop() { if (this.timer) clearInterval(this.timer); await this.running; }
}

/** Restore only into a newly created directory; live data is never overwritten. */
export async function restoreLocalArchive(archive: string, destination: string) {
  const path = resolve(archive), target = resolve(destination);
  if (!archiveName.test(path.split(/[\\/]/).at(-1)!)) throw new Error('INVALID_BACKUP_ARCHIVE');
  const metadata = JSON.parse(await readFile(path + '.json', 'utf8'));
  const bytes = await readFile(path);
  if (metadata.format !== 'pglite-datadir-v1' || metadata.sha256 !== digest(bytes) || metadata.bytes !== bytes.length) throw new Error('BACKUP_CHECKSUM_MISMATCH');
  await mkdir(target, { recursive: false }); // Reject existing destinations.
  const restored = new PGlite(target, { loadDataDir: new Blob([bytes]) });
  try {
    await restored.waitReady;
    const checks = await verifyLocalLedger(restored);
    await atomicLocalJson(target + '.verified.json', { archive: path, sha256: metadata.sha256, ...checks });
    return checks;
  } finally { await restored.close(); }
}
