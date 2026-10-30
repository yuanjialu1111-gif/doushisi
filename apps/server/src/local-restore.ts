import { restoreLocalArchive } from './local-backups.js';
const [archive, destination] = process.argv.slice(2);
if (!archive || !destination) throw new Error('Usage: local-restore archive destination');
try { console.log(JSON.stringify(await restoreLocalArchive(archive, destination))); }
catch { console.error('LOCAL_RESTORE_FAILED'); process.exitCode = 1; }
