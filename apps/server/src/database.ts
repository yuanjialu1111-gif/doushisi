import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile, readdir, mkdir, open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export interface Sql {
  query<T extends Record<string, any> = Record<string, any>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
  exec(sql: string): Promise<unknown>;
}

export interface Database extends Sql {
  transaction<T>(run: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'postgres' | 'pglite';
  backup?(): Promise<Uint8Array>;
}

export async function openDatabase(url?: string, directory?: string): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 16 });
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      exec: sql => pool.query(sql),
      async transaction(run) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await run({ query: (sql, params) => client.query(sql, params), exec: sql => client.query(sql) });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  let release = async () => {};
  if (directory) {
    await mkdir(dirname(directory), { recursive: true });
    const lockPath = directory + '.owner-lock';
    const owner = { pid: process.pid, nonce: randomUUID() };
    try {
      const lock = await open(lockPath, 'wx');
      await lock.writeFile(JSON.stringify(owner)); await lock.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = JSON.parse(await readFile(lockPath, 'utf8'));
      let alive = true;
      try { process.kill(previous.pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
      if (alive) throw new Error('LOCAL_DATABASE_IN_USE');
      // Preserve stale ownership evidence; a caller must explicitly remove the
      // lock after confirming the old process has exited.
      throw new Error('LOCAL_DATABASE_STALE_LOCK');
    }
    release = async () => {
      const current = JSON.parse(await readFile(lockPath, 'utf8'));
      if (current.nonce === owner.nonce) await unlink(lockPath);
    };
  }
  const engine = new PGlite(directory);
  try { await engine.waitReady; } catch (error) { await release(); throw error; }
  return {
    kind: 'pglite',
    query: (sql, params) => engine.query(sql, params),
    exec: sql => engine.exec(sql),
    transaction: (run) => engine.transaction(tx => run(tx)),
    backup: async () => new Uint8Array(await (await engine.dumpDataDir('gzip')).arrayBuffer()),
    close: async () => { await engine.close(); await release(); },
  };
}

export async function migrate(db: Database): Promise<void> {
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(file => /^\d+-[\w-]+\.sql$/.test(file)).sort();
  await db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(20260908)");
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of files) {
      const version = Number(file.split('-')[0]);
      const existing = await tx.query('SELECT version FROM schema_migrations WHERE version=$1', [version]);
      if (!existing.rows.length) {
        await tx.exec(await readFile(new URL(file, directory), 'utf8'));
        await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      }
    }
  });
}
