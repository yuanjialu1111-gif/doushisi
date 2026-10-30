import { openDatabase, migrate } from './database.js';
import { createApp } from './app.js';
import { resolve } from 'node:path';
import { LocalBackups } from './local-backups.js';
import { startLocalControl } from './local-control.js';
import { createPreviewEngineRegistry } from './runtime-engines.js';

if (process.env.DATABASE_URL) throw new Error('Preview engines are local-only and never run against DATABASE_URL.');
const db = await openDatabase(undefined, resolve(process.env.LOCAL_DATABASE_DIR ?? '.local/preview-database'));
const backups = process.env.LOCAL_BACKUP_DIR ? new LocalBackups(db, resolve(process.env.LOCAL_BACKUP_DIR)) : null;
let app: Awaited<ReturnType<typeof createApp>>['app'] | undefined;
let closing = false;
let closeControl: (() => Promise<void>) | undefined;
async function close() {
  if (closing) return;
  closing = true;
  await app?.close();
  await backups?.stop();
  await db.close();
  await closeControl?.();
}
try {
  if (process.env.SKIP_MIGRATIONS !== 'true') await migrate(db);
  app = (await createApp(db, { logger: true, engines: createPreviewEngineRegistry() })).app;
  await app.listen({ port: Number(process.env.PREVIEW_PORT ?? process.env.PORT ?? 3100),
    host: process.env.PREVIEW_HOST ?? process.env.HOST ?? '127.0.0.1' });
  if (backups) await backups.start();
  if (backups && process.env.DSS_LOCAL_CONTROL_TOKEN && process.env.DSS_LOCAL_STATE_FILE) {
    closeControl = await startLocalControl({ stateFile: resolve(process.env.DSS_LOCAL_STATE_FILE),
      token: process.env.DSS_LOCAL_CONTROL_TOKEN, port: Number(process.env.DSS_LOCAL_CONTROL_PORT ?? 3001),
      apiBase: process.env.DSS_LOCAL_API_BASE ?? 'http://127.0.0.1:3000', backups, close });
  }
} catch {
  console.error('PREVIEW_STARTUP_FAILED');
  await close();
  process.exitCode = 1;
}
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
