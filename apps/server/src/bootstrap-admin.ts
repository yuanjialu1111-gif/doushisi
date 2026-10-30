import { openDatabase, migrate } from './database.js';
import { AuthService, type Role } from './auth.js';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const [role, username] = process.argv.slice(2);
if (!['beans_admin', 'deal_admin'].includes(role ?? '') || !username) throw new Error('Usage: admin:create <beans_admin|deal_admin> <username>. Set ADMIN_PASSWORD or receive a generated password.');
const db = await openDatabase(process.env.DATABASE_URL, process.env.DATABASE_URL ? undefined : resolve(process.env.LOCAL_DATABASE_DIR ?? '.local/database'));
try {
  if (process.env.SKIP_MIGRATIONS !== 'true') await migrate(db);
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');
  const user = await new AuthService(db).create(username, password, role as Role);
  console.log(JSON.stringify({ id: user.id, username: user.username, role: user.role, ...(process.env.ADMIN_PASSWORD ? {} : { generatedPassword: password }) }, null, 2));
} finally { await db.close(); }
