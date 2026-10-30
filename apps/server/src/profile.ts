import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Database, Sql } from './database.js';
import type { Actor } from './auth.js';
import { AppError, requireCondition } from './errors.js';
import { avatarUrl, normalizeAvatar } from './avatars.js';

// 首次资料设置、改昵称、后台驳回（R6、R8、R9）。
const NICKNAME_COOLDOWN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const normalizeWord = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const sensitiveWords = readFileSync(new URL('../data/sensitive-words.txt', import.meta.url), 'utf8')
  .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(normalizeWord).filter(Boolean);

export function nicknameProblem(nickname: string): string | null {
  const length = [...nickname].length;
  if (length < 2 || length > 7) return '昵称要 2–7 个字。';
  if (/[\p{C}]/u.test(nickname) || !/[\p{L}\p{N}]/u.test(nickname)) return '昵称里有不能用的字符。';
  const normalized = normalizeWord(nickname);
  if (sensitiveWords.some(word => normalized.includes(word))) return '昵称包含不允许的词，请换一个。';
  return null;
}

export interface ProfileView {
  nickname: string; sex: number; avatarUrl: string; avatarStatus: string; complete: boolean;
  needs: { avatar: boolean; nickname: boolean; sex: boolean }; nicknameChangeableAt: string | null;
}

const dateText = (date: Date) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' }).format(date);

export class ProfileService {
  constructor(private db: Database) {}

  private async row(sql: Sql, userId: string, lock = false) {
    const found = await sql.query(`SELECT id,nickname,sex,avatar_hash AS "avatarHash",avatar_status AS "avatarStatus",profile_completed_at AS "completedAt",
      nickname_changed_at AS "nicknameChangedAt",nickname_rejected AS "nicknameRejected" FROM accounts WHERE id=$1 AND role='player'${lock ? ' FOR UPDATE' : ''}`, [userId]);
    requireCondition(found.rows[0], 'NOT_FOUND', 'Account not found.', 404);
    return found.rows[0] as Record<string, any>;
  }

  private changeableAt(row: Record<string, any>): Date | null {
    if (!row.completedAt || row.nicknameRejected || !row.nicknameChangedAt) return null;
    const next = new Date(new Date(row.nicknameChangedAt).getTime() + NICKNAME_COOLDOWN_DAYS * DAY_MS);
    return next.getTime() > Date.now() ? next : null;
  }

  private view(row: Record<string, any>): ProfileView {
    const needs = { avatar: row.avatarStatus !== 'active', nickname: row.nicknameRejected || nicknameProblem(row.nickname) !== null, sex: row.sex !== 1 && row.sex !== 2 };
    const next = this.changeableAt(row);
    return { nickname: row.nickname, sex: row.sex, avatarUrl: avatarUrl(row as never), avatarStatus: row.avatarStatus,
      complete: Boolean(row.completedAt) && !needs.avatar && !needs.nickname && !needs.sex, needs, nicknameChangeableAt: next ? next.toISOString() : null };
  }

  async get(userId: string): Promise<ProfileView> { return this.view(await this.row(this.db, userId)); }

  // 开房、进房前调用：资料没设好的人一律挡住，绕过客户端也没用（R6 AC1、AC2）。
  async requireComplete(userId: string, sql: Sql = this.db) {
    requireCondition(this.view(await this.row(sql, userId)).complete, 'PROFILE_REQUIRED', '请先上传头像、设置昵称和性别。', 409);
  }

  // 资料齐了就记完成时间；之后驳回头像或昵称只改对应字段，view() 会重新要求设置。
  private async completeIfReady(sql: Sql, userId: string) {
    const row = await this.row(sql, userId);
    const view = this.view({ ...row, completedAt: row.completedAt ?? new Date() });
    if (!row.completedAt && view.complete) await sql.query('UPDATE accounts SET profile_completed_at=now() WHERE id=$1', [userId]);
  }

  async update(actor: Actor, input: { nickname?: string; sex?: number }): Promise<ProfileView> {
    try {
      await this.db.transaction(async tx => {
        const row = await this.row(tx, actor.id, true);
        if (input.nickname !== undefined) {
          const nickname = input.nickname.trim();
          if (nickname !== row.nickname || row.nicknameRejected || !row.completedAt) {
            const problem = nicknameProblem(nickname);
            requireCondition(!problem, 'INVALID_NICKNAME', problem ?? '');
            if (nickname !== row.nickname) {
              const next = this.changeableAt(row);
              requireCondition(!next, 'NICKNAME_COOLDOWN', `昵称 30 天只能改一次，${next ? dateText(next) : ''}以后可以再改。`, 409);
              // 第一次设置和被驳回后重填不算「改」，不开始 30 天计时（R8 AC2）。
              const counts = Boolean(row.completedAt) && !row.nicknameRejected;
              await tx.query('UPDATE accounts SET nickname=$2,nickname_changed_at=CASE WHEN $3 THEN now() ELSE nickname_changed_at END WHERE id=$1', [actor.id, nickname, counts]);
            }
            await tx.query('UPDATE accounts SET nickname_rejected=false WHERE id=$1', [actor.id]);
          }
        }
        if (input.sex !== undefined) {
          requireCondition(input.sex === 1 || input.sex === 2, 'INVALID_SEX', '请选择性别。');
          await tx.query('UPDATE accounts SET sex=$2 WHERE id=$1', [actor.id, input.sex]);
        }
        await this.completeIfReady(tx, actor.id);
      });
    } catch (error: any) {
      if (error?.code === '23505') throw new AppError('NICKNAME_TAKEN', '这个昵称已经有人用了，请换一个。', 409);
      throw error;
    }
    return this.get(actor.id);
  }

  async setAvatar(actor: Actor, input: Buffer): Promise<ProfileView> {
    const { bytes, hash } = await normalizeAvatar(input);
    await this.db.transaction(async tx => {
      await this.row(tx, actor.id, true);
      const previous = await tx.query('SELECT rejected_at FROM account_avatars WHERE account_id=$1 AND hash=$2', [actor.id, hash]);
      requireCondition(!previous.rows[0]?.rejected_at, 'AVATAR_REJECTED_BEFORE', '这张头像被驳回过，请换一张。', 409);
      if (!previous.rows[0]) await tx.query('INSERT INTO account_avatars(account_id,hash,bytes) VALUES($1,$2,$3)', [actor.id, hash, bytes]);
      await tx.query("UPDATE accounts SET avatar_hash=$2,avatar_status='active' WHERE id=$1", [actor.id, hash]);
      await this.completeIfReady(tx, actor.id);
    });
    return this.get(actor.id);
  }

  async avatarBytes(accountId: string, hash: string): Promise<Buffer | null> {
    const found = await this.db.query('SELECT bytes FROM account_avatars WHERE account_id=$1 AND hash=$2 AND rejected_at IS NULL', [accountId, hash]);
    return found.rows[0] ? Buffer.from(found.rows[0].bytes) : null;
  }

  // 后台驳回头像：变回默认头像，下次进游戏必须重传；留审计记录（R9 AC2）。
  async rejectAvatar(admin: Actor, userId: string, reason: string) {
    await this.db.transaction(async tx => {
      const row = await this.row(tx, userId, true);
      requireCondition(row.avatarStatus === 'active' && row.avatarHash, 'NOTHING_TO_REJECT', '这个玩家现在没有可驳回的头像。', 409);
      await tx.query('UPDATE account_avatars SET rejected_at=now() WHERE account_id=$1 AND hash=$2', [userId, row.avatarHash]);
      await tx.query("UPDATE accounts SET avatar_status='rejected' WHERE id=$1", [userId]);
      await tx.query('INSERT INTO audit_events(id,actor_id,user_id,kind,details) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), admin.id, userId, 'avatar_rejected', JSON.stringify({ hash: row.avatarHash, reason: reason.trim() })]);
    });
  }

  // 后台驳回昵称：下次进游戏必须重填（R9 AC3）。
  async rejectNickname(admin: Actor, userId: string, reason: string) {
    await this.db.transaction(async tx => {
      const row = await this.row(tx, userId, true);
      requireCondition(!row.nicknameRejected, 'NOTHING_TO_REJECT', '这个昵称已经驳回过了。', 409);
      await tx.query('UPDATE accounts SET nickname_rejected=true WHERE id=$1', [userId]);
      await tx.query('INSERT INTO audit_events(id,actor_id,user_id,kind,details) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), admin.id, userId, 'nickname_rejected', JSON.stringify({ nickname: row.nickname, reason: reason.trim() })]);
    });
  }

  async recentAvatars(page: number, pageSize: number) {
    const rows = await this.db.query(`SELECT a.id AS "userId",a.username,a.nickname,a.nickname_rejected AS "nicknameRejected",
      a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus",v.created_at AS "uploadedAt"
      FROM accounts a JOIN account_avatars v ON v.account_id=a.id AND v.hash=a.avatar_hash
      WHERE a.role='player' ORDER BY v.created_at DESC,a.id LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]);
    const total = (await this.db.query("SELECT COUNT(*)::int AS count FROM accounts a JOIN account_avatars v ON v.account_id=a.id AND v.hash=a.avatar_hash WHERE a.role='player'")).rows[0]!.count;
    return { items: rows.rows.map(row => ({ ...row, avatarUrl: avatarUrl({ id: row.userId, avatarHash: row.avatarHash, avatarStatus: row.avatarStatus }) })), total };
  }
}
