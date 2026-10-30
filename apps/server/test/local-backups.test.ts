import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService } from '../src/auth.js';
import { LedgerService } from '../src/ledger.js';
import { LocalBackups, restoreLocalArchive, verifyLocalLedger } from '../src/local-backups.js';

test('local backup restores accounts and ledger, catches corruption, and catches up after a missed day', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dss-backup-'));
  const db = await openDatabase(undefined, join(root, 'data'));
  try {
    await migrate(db);
    const auth = new AuthService(db), ledger = new LedgerService(db);
    const admin = await auth.create('backup_admin', 'test-password-only', 'beans_admin');
    const player = await auth.create('backup_player', 'test-password-only');
    await ledger.adjust(admin, player.id, '0.125', 'Local backup fixture', 'backup-funding');
    await assert.rejects(openDatabase(undefined, join(root, 'data')), /LOCAL_DATABASE_IN_USE/);
    let now = new Date('2026-09-09T00:00:00Z');
    const backups = new LocalBackups(db, join(root, 'backups'), () => now);
    await backups.daily();
    assert.equal(await backups.daily(), null);
    now = new Date('2026-09-10T00:00:00Z');
    await backups.daily();
    const names = (await readdir(join(root, 'backups'))).filter(file => file.endsWith('.tgz'));
    assert.equal(names.length, 2);
    const archive = join(root, 'backups', names[0]!);
    assert.deepEqual(await restoreLocalArchive(archive, join(root, 'restored')), await verifyLocalLedger(db));
    await assert.rejects(restoreLocalArchive(archive, join(root, 'restored')), { code: 'EEXIST' });
    const original = await readFile(archive);
    await writeFile(archive, Buffer.from('invalid'));
    await assert.rejects(restoreLocalArchive(archive, join(root, 'corrupt')), /CHECKSUM/);
    await writeFile(archive, original);
    const restored = await openDatabase(undefined, join(root, 'restored'));
    try { assert.equal(await new LedgerService(restored).balance(player.id), '0.125'); }
    finally { await restored.close(); }
  } finally { await db.close(); await rm(root, { recursive: true, force: true }); }
});
