import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database } from './database.js';
import { AppError, requireCondition } from './errors.js';

const scrypt = promisify(scryptCallback);
export type Role = 'player' | 'beans_admin' | 'deal_admin';
export interface Actor { id: string; username: string; nickname: string; role: Role }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, expected] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const hash = await scrypt(password, salt, 64) as Buffer;
  const reference = Buffer.from(expected, 'hex');
  return hash.length === reference.length && timingSafeEqual(hash, reference);
}

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export class AuthService {
  constructor(private db: Database) {}

  async create(username: string, password: string, role: Role = 'player', nickname = username): Promise<Actor> {
    requireCondition(/^[a-zA-Z0-9_]{4,32}$/.test(username), 'INVALID_USERNAME', 'Username must contain 4-32 letters, digits or underscores.');
    requireCondition(password.length >= 8 && password.length <= 128, 'INVALID_PASSWORD', 'Password must contain 8-128 characters.');
    requireCondition(nickname.length > 0 && nickname.length <= 32, 'INVALID_NICKNAME', 'Nickname must contain 1-32 characters.');
    const actor = { id: randomUUID(), username: username.toLowerCase(), nickname, role };
    const hashed = await hashPassword(password);
    try {
      await this.db.transaction(async tx => {
        await tx.query('INSERT INTO accounts (id, username, nickname, password_hash, role) VALUES ($1,$2,$3,$4,$5)', [actor.id, actor.username, nickname, hashed, role]);
        if (role === 'player') await tx.query('INSERT INTO wallets (user_id) VALUES ($1)', [actor.id]);
      });
    } catch (error: any) {
      if (error.code === '23505') throw new AppError('USERNAME_TAKEN', 'Username is already registered.', 409);
      throw error;
    }
    return actor;
  }

  async login(username: string, password: string, administrator = false): Promise<{ token: string; user: Actor }> {
    const result = await this.db.query('SELECT * FROM accounts WHERE username = $1', [username.toLowerCase()]);
    const user = result.rows[0];
    // Perform a scrypt derivation for unknown accounts too.
    const valid = await verifyPassword(password, user?.password_hash ?? `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`);
    requireCondition(user && valid && !user.disabled && (administrator ? user.role !== 'player' : user.role === 'player'), 'INVALID_CREDENTIALS', 'Invalid account or password.', 401);
    const token = randomBytes(32).toString('base64url');
    await this.db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,now() + interval '12 hours')", [tokenHash(token), user.id]);
    return { token, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } };
  }

  async authenticate(token: string): Promise<Actor> {
    requireCondition(token.length >= 32 && token.length <= 128, 'UNAUTHORIZED', 'Login required.', 401);
    const result = await this.db.query('SELECT a.id, a.username, a.nickname, a.role FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.disabled=false', [tokenHash(token)]);
    requireCondition(result.rows[0], 'UNAUTHORIZED', 'Session expired. Please log in again.', 401);
    return result.rows[0] as Actor;
  }

  async logout(token: string) { await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]); }
}

export function requireRole(actor: Actor, role: Role): void {
  requireCondition(actor.role === role, 'FORBIDDEN', 'This account does not have permission for this operation.', 403);
}
