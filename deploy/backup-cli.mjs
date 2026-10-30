import { resolve, join } from 'node:path';
import { runBackup, latestArchive, health, integer, iso, jsonOrNull, pgEnvironment, restoreArchive, scheduledSlot, atomicJson } from './backup-lib.mjs';

process.umask(0o077);
const directory = resolve(process.env.BACKUP_DIRECTORY || '/backups');
const action = process.argv[2] || 'schedule';
const log = value => console.log(JSON.stringify(value));
const failure = error => ({ state: 'failed', at: iso(), code: error.code || error.message });
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const once = () => runBackup({ directory, env: pgEnvironment(), retentionCount: integer(process.env.BACKUP_RETENTION_COUNT, 14, 1, 3650) });

try {
  if (action === 'once') log(await once());
  else if (action === 'latest') console.log(await latestArchive(directory));
  else if (action === 'health') log(await health(directory, integer(process.env.BACKUP_MAX_AGE_HOURS, 26, 1, 168)));
  else if (action === 'restore') log(await restoreArchive({ directory, name: process.argv[3], env: pgEnvironment(), reportDirectory: resolve(process.env.RESTORE_REPORT_DIRECTORY || '/reports') }));
  else if (action === 'schedule') {
    const utcTime = process.env.BACKUP_UTC_TIME || '19:00';
    scheduledSlot(Date.now(), utcTime);
    let retryAfter = 0;
    log({ state: 'scheduler_started', dailyUtcTime: utcTime, retryMinutes: 15 });
    while (!stopping) {
      try {
        const success = await jsonOrNull(join(directory, 'last-success.json'));
        const latest = await jsonOrNull(join(directory, 'latest-status.json'));
        if (Date.now() >= retryAfter && (latest?.state === 'failed' || !success || Date.parse(success.completedAt) < scheduledSlot(Date.now(), utcTime))) {
          log(await once());
          retryAfter = 0;
        }
      } catch (error) {
        log(failure(error));
        await atomicJson(join(directory, 'latest-status.json'), failure(error)).catch(() => {});
        retryAfter = Date.now() + 15 * 60000;
      }
      for (let second = 0; second < 30 && !stopping; second++) await new Promise(resolveWait => setTimeout(resolveWait, 1000));
    }
  } else throw new Error('UNKNOWN_BACKUP_ACTION');
} catch (error) { console.error(JSON.stringify(failure(error))); process.exitCode = 1; }
