import { openDatabase, migrate } from './database.js';
import { createApp } from './app.js';
import { resolve } from 'node:path';
import { LocalBackups } from './local-backups.js';
import { startLocalControl } from './local-control.js';
import { createRuntimeEngineRegistry } from './runtime-engines.js';

const local = !process.env.DATABASE_URL;
if (local && process.env.NODE_ENV === 'production') throw new Error('Production requires DATABASE_URL pointing to PostgreSQL.');
const engines = createRuntimeEngineRegistry();
const db = await openDatabase(process.env.DATABASE_URL, local ? resolve(process.env.LOCAL_DATABASE_DIR ?? '.local/database') : undefined);
const backups = local && process.env.LOCAL_BACKUP_DIR ? new LocalBackups(db, resolve(process.env.LOCAL_BACKUP_DIR)) : null;
let app: Awaited<ReturnType<typeof createApp>>['app'] | undefined;
let closing = false;
let closeControl: (() => Promise<void>) | undefined;
async function close() { if (closing) return; closing = true; await app?.close(); await backups?.stop(); await db.close(); await closeControl?.(); }
try {
  if (backups && (await db.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0]?.name) await backups.save('before-migration');
  if (process.env.SKIP_MIGRATIONS !== 'true') await migrate(db);
  // Isolation is published only for a local PGlite database with an explicit operator opt-in. A
  // PostgreSQL deployment (DATABASE_URL set) never advertises acceptance isolation.
  const isolatedDatabase = local && process.env.ACCEPTANCE_ISOLATED_DATABASE === 'true';
  const acceptanceRunId = isolatedDatabase ? process.env.ACCEPTANCE_RUN_ID : undefined;
  app = (await createApp(db, { logger: true, engines, isolatedDatabase, acceptanceRunId })).app;
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });
  if (backups) await backups.start();
  if (backups && process.env.DSS_LOCAL_CONTROL_TOKEN && process.env.DSS_LOCAL_STATE_FILE) {
    closeControl = await startLocalControl({ stateFile: resolve(process.env.DSS_LOCAL_STATE_FILE), token: process.env.DSS_LOCAL_CONTROL_TOKEN,
      port: Number(process.env.DSS_LOCAL_CONTROL_PORT ?? 3001), apiBase: process.env.DSS_LOCAL_API_BASE ?? 'http://127.0.0.1:3000', backups, close });
  }
} catch {
  console.error('SERVER_STARTUP_FAILED');
  await close();
  process.exitCode = 1;
}
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
