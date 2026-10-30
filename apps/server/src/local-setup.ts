import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDatabase, migrate } from './database.js';
import { AuthService } from './auth.js';
import { LedgerService } from './ledger.js';

if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local setup cannot run against an external or production database.');
const dataDir = resolve(process.env.LOCAL_DATABASE_DIR ?? '.local/database');
const db = await openDatabase(undefined, dataDir);
try {
  await migrate(db);
  const existing = await db.query("SELECT id FROM accounts WHERE role <> 'system' LIMIT 1");
  if (existing.rows.length) throw new Error('Local setup requires an empty database. Existing accounts were not changed.');
  const auth = new AuthService(db);
  const ledger = new LedgerService(db);
  const beansPassword = randomBytes(18).toString('base64url');
  const dealPassword = randomBytes(18).toString('base64url');
  const playerPassword = randomBytes(12).toString('base64url');
  const beans = await auth.create('beans_local', beansPassword, 'beans_admin', 'Local beans operator');
  await auth.create('deal_local', dealPassword, 'deal_admin', 'Local deal operator');
  const players = [];
  for (const username of ['player_one', 'player_two', 'player_three', 'player_four']) {
    const user = await auth.create(username, playerPassword, 'player', username);
    await ledger.adjust(beans, user.id, '100', 'Local verification account credit', `local-setup-${username}`);
    players.push({ username, password: playerPassword, id: user.id });
  }
  const outputDir = resolve('../../.local');
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'local-access.json'), JSON.stringify({ url: 'http://127.0.0.1:3000/admin/', beans: { username: 'beans_local', password: beansPassword }, deal: { username: 'deal_local', password: dealPassword }, players }, null, 2), { mode: 0o600 });
  console.log('Local verification accounts created. Credentials are in .local/local-access.json at the workspace root.');
} finally { await db.close(); }
