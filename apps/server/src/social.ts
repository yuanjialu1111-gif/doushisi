import { randomUUID } from 'node:crypto';
import type { Database, Sql } from './database.js';
import type { SettingsService } from './settings.js';
import { avatarUrl } from './avatars.js';
import { requireCondition } from './errors.js';

// 第二轮 S3：好友改成申请制（计划 2.3）。对外只用数字 ID（原版 uid），不露账号的 uuid。
export const RECENT_DAYS = 7;
export const RECENT_LIMIT = 30;

export type FriendStatus = 'offline' | 'idle' | 'playing';
export interface SocialOptions { isOnline(userId: string): boolean; now?: () => number }

const USER_COLUMNS = 'a.id,a.nickname,a.sex,a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus"';

export class SocialService {
  private searches = new Map<string, number[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private db: Database, private settings: SettingsService, private options: SocialOptions) {}

  private now() { return this.options.now?.() ?? Date.now(); }

  /** 每小时把超期的申请标成过期（查询时也按超期算，不依赖这一步）。 */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.cleanup().catch(() => undefined); }, 60 * 60_000);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async cleanup() {
    const { friendRequestExpiryDays } = await this.settings.get();
    await this.db.query("UPDATE friend_requests SET status='expired',decided_at=now() WHERE status='pending' AND created_at <= now() - make_interval(days => $1)", [friendRequestExpiryDays]);
  }

  /** 对外数字 ID；没登录过原版协议的号第一次用时补一个。 */
  async publicId(userId: string, sql: Sql = this.db): Promise<string> {
    const found = await sql.query("SELECT wire_id FROM original_protocol_ids WHERE entity_kind='user' AND entity_id=$1", [userId]);
    if (found.rows[0]) return String(found.rows[0].wire_id);
    const created = await sql.query("INSERT INTO original_protocol_ids(entity_kind,entity_id) VALUES('user',$1) ON CONFLICT(entity_kind,entity_id) DO UPDATE SET entity_id=EXCLUDED.entity_id RETURNING wire_id", [userId]);
    return String(created.rows[0]!.wire_id);
  }

  private async userByUid(uid: string, sql: Sql = this.db) {
    if (!/^\d{1,10}$/.test(uid) || Number(uid) > 2147483647) return null;
    const found = await sql.query(`SELECT ${USER_COLUMNS},p.wire_id AS uid FROM original_protocol_ids p JOIN accounts a ON a.id=p.entity_id
      WHERE p.entity_kind='user' AND p.wire_id=$1 AND a.role='player' AND NOT a.disabled`, [Number(uid)]);
    return found.rows[0] ?? null;
  }

  private card(row: Record<string, any>) {
    return { uid: String(row.uid), nickname: row.nickname ?? '', sex: row.sex ?? 0, avatarUrl: avatarUrl(row) };
  }

  private async friendCount(userId: string, sql: Sql = this.db): Promise<number> {
    return (await sql.query('SELECT COUNT(*)::int AS count FROM friends WHERE user_id=$1', [userId])).rows[0]!.count;
  }

  private async isFriend(userId: string, otherId: string, sql: Sql = this.db) {
    return Boolean((await sql.query('SELECT 1 FROM friends WHERE user_id=$1 AND friend_id=$2', [userId, otherId])).rows[0]);
  }

  /** 待处理且没超期的那条申请（某一方向）。 */
  private async pending(fromId: string, toId: string, sql: Sql = this.db) {
    const { friendRequestExpiryDays } = await this.settings.get();
    return (await sql.query("SELECT id FROM friend_requests WHERE from_id=$1 AND to_id=$2 AND status='pending' AND created_at > now() - make_interval(days => $3)",
      [fromId, toId, friendRequestExpiryDays])).rows[0] as { id: string } | undefined;
  }

  /** 按数字 ID 搜人（S3-AC1）；每人每分钟次数后台可改（S3-AC3）。 */
  async search(userId: string, uid: string) {
    const { searchPerMinute } = await this.settings.get();
    const now = this.now();
    const recent = (this.searches.get(userId) ?? []).filter(time => now - time < 60_000);
    requireCondition(recent.length < searchPerMinute, 'SEARCH_RATE_LIMITED', `搜得太快了，每分钟最多 ${searchPerMinute} 次，稍等一下再试。`, 429);
    recent.push(now); this.searches.set(userId, recent);
    if (this.searches.size > 5000) for (const [key, times] of this.searches) if (!times.some(time => now - time < 60_000)) this.searches.delete(key);

    const found = await this.userByUid(uid.trim());
    if (!found) return { user: null };
    const self = found.id === userId;
    const together = self ? { rounds: 0, lastAt: null } : (await this.db.query(`SELECT COUNT(*)::int AS rounds,MAX(r.settled_at) AS "lastAt" FROM rounds r
      JOIN room_members x ON x.room_id=r.room_id AND x.user_id=$1 JOIN room_members y ON y.room_id=r.room_id AND y.user_id=$2 WHERE r.state='settled'`, [userId, found.id])).rows[0]!;
    return { user: { ...this.card(found), self, isFriend: !self && await this.isFriend(userId, found.id),
      requested: !self && Boolean(await this.pending(userId, found.id)), incoming: !self && Boolean(await this.pending(found.id, userId)),
      together: { rounds: together.rounds, lastAt: together.lastAt } } };
  }

  /** 发申请（S3-AC2、S3-AC3）。对方已经申请过我，就直接成为好友。 */
  async request(userId: string, uid: string, source: 'search' | 'recent') {
    const settings = await this.settings.get();
    await this.cleanup();
    const target = await this.userByUid(uid);
    requireCondition(Boolean(target), 'USER_NOT_FOUND', '没有这个 ID 的玩家。', 404);
    requireCondition(target!.id !== userId, 'CANNOT_ADD_SELF', '不能加自己为好友。');
    requireCondition(!await this.isFriend(userId, target!.id), 'ALREADY_FRIENDS', '你们已经是好友了。', 409);
    const incoming = await this.pending(target!.id, userId);
    if (incoming) return { ...(await this.decide(userId, incoming.id, true)), autoAccepted: true };
    requireCondition(!await this.pending(userId, target!.id), 'ALREADY_REQUESTED', '已经申请过了，等对方处理。', 409);
    requireCondition(await this.friendCount(userId) < settings.friendLimit, 'FRIEND_LIMIT', `你的好友已满 ${settings.friendLimit} 人。`, 409);
    requireCondition(await this.friendCount(target!.id) < settings.friendLimit, 'TARGET_FRIEND_LIMIT', `对方的好友已满 ${settings.friendLimit} 人。`, 409);
    const today = (await this.db.query("SELECT COUNT(*)::int AS count FROM friend_requests WHERE from_id=$1 AND created_at > now() - interval '24 hours'", [userId])).rows[0]!.count;
    requireCondition(today < settings.dailyFriendRequests, 'DAILY_REQUEST_LIMIT', `今天的好友申请已用完（每天 ${settings.dailyFriendRequests} 个），明天再来。`, 429);
    const rejected = (await this.db.query("SELECT 1 FROM friend_requests WHERE from_id=$1 AND to_id=$2 AND status='rejected' AND decided_at > now() - make_interval(hours => $3) LIMIT 1",
      [userId, target!.id, settings.rejectCooldownHours])).rows[0];
    requireCondition(!rejected, 'REJECT_COOLDOWN', `对方刚拒绝过你，${settings.rejectCooldownHours} 小时后才能再申请。`, 409);
    const id = randomUUID();
    await this.db.query('INSERT INTO friend_requests(id,from_id,to_id,source) VALUES($1,$2,$3,$4)', [id, userId, target!.id, source]);
    return { ok: true, requestId: id, autoAccepted: false };
  }

  /** 同意 / 拒绝。同意时再查一遍上限，一个事务里写双向两条好友。 */
  async decide(userId: string, requestId: string, accept: boolean) {
    const settings = await this.settings.get();
    return this.db.transaction(async tx => {
      const row = (await tx.query("SELECT id,from_id,to_id,source,status,created_at > now() - make_interval(days => $2) AS fresh FROM friend_requests WHERE id=$1 FOR UPDATE",
        [requestId, settings.friendRequestExpiryDays])).rows[0];
      requireCondition(Boolean(row) && row.to_id === userId, 'REQUEST_NOT_FOUND', '这条申请不存在。', 404);
      requireCondition(row.status === 'pending', 'REQUEST_HANDLED', '这条申请已经处理过了。', 409);
      if (!row.fresh) {
        await tx.query("UPDATE friend_requests SET status='expired',decided_at=now() WHERE id=$1", [requestId]);
        return { ok: false, status: 'expired' as const };
      }
      if (!accept) {
        await tx.query("UPDATE friend_requests SET status='rejected',decided_at=now() WHERE id=$1", [requestId]);
        return { ok: true, status: 'rejected' as const };
      }
      requireCondition(await this.friendCount(userId, tx) < settings.friendLimit, 'FRIEND_LIMIT', `你的好友已满 ${settings.friendLimit} 人。`, 409);
      requireCondition(await this.friendCount(row.from_id, tx) < settings.friendLimit, 'TARGET_FRIEND_LIMIT', `对方的好友已满 ${settings.friendLimit} 人。`, 409);
      for (const [a, b] of [[row.from_id, row.to_id], [row.to_id, row.from_id]]) {
        await tx.query('INSERT INTO friends(user_id,friend_id,source) VALUES($1,$2,$3) ON CONFLICT(user_id,friend_id) DO NOTHING', [a, b, row.source]);
      }
      await tx.query("UPDATE friend_requests SET status='accepted',decided_at=now() WHERE id=$1", [requestId]);
      // 反方向如果也有待处理的申请，一并算同意。
      await tx.query("UPDATE friend_requests SET status='accepted',decided_at=now() WHERE from_id=$1 AND to_id=$2 AND status='pending'", [row.to_id, row.from_id]);
      return { ok: true, status: 'accepted' as const };
    });
  }

  /** 收到的（待处理）和发出的（最近几天，带状态）。 */
  async requests(userId: string) {
    const { friendRequestExpiryDays } = await this.settings.get();
    await this.cleanup();
    const incoming = await this.db.query(`SELECT q.id AS "requestId",q.created_at AS "createdAt",q.source,${USER_COLUMNS},p.wire_id AS uid FROM friend_requests q
      JOIN accounts a ON a.id=q.from_id LEFT JOIN original_protocol_ids p ON p.entity_kind='user' AND p.entity_id=a.id
      WHERE q.to_id=$1 AND q.status='pending' ORDER BY q.created_at DESC LIMIT 100`, [userId]);
    const outgoing = await this.db.query(`SELECT q.id AS "requestId",q.created_at AS "createdAt",q.status,q.decided_at AS "decidedAt",${USER_COLUMNS},p.wire_id AS uid FROM friend_requests q
      JOIN accounts a ON a.id=q.to_id LEFT JOIN original_protocol_ids p ON p.entity_kind='user' AND p.entity_id=a.id
      WHERE q.from_id=$1 AND q.created_at > now() - make_interval(days => $2) ORDER BY q.created_at DESC LIMIT 100`, [userId, friendRequestExpiryDays]);
    const withUid = async (row: Record<string, any>) => ({ ...row, uid: row.uid ?? await this.publicId(row.id) });
    return {
      incoming: await Promise.all(incoming.rows.map(async row => ({ id: row.requestId, createdAt: row.createdAt, source: row.source, user: this.card(await withUid(row)) }))),
      outgoing: await Promise.all(outgoing.rows.map(async row => ({ id: row.requestId, createdAt: row.createdAt, status: row.status, decidedAt: row.decidedAt, user: this.card(await withUid(row)) }))),
    };
  }

  /** 最近同桌（S3-AC4）：最近 7 天一起开过局的人，最多 30 个，排除已是好友。 */
  async recent(userId: string) {
    const rows = await this.db.query(`SELECT ${USER_COLUMNS},p.wire_id AS uid,MAX(r.created_at) AS "lastAt",
        EXISTS(SELECT 1 FROM friend_requests q WHERE q.from_id=$1 AND q.to_id=a.id AND q.status='pending') AS requested,
        EXISTS(SELECT 1 FROM friend_requests q WHERE q.from_id=a.id AND q.to_id=$1 AND q.status='pending') AS incoming
      FROM room_members me JOIN rooms r ON r.id=me.room_id AND r.current_round > 0
      JOIN room_members o ON o.room_id=me.room_id AND o.user_id<>me.user_id JOIN accounts a ON a.id=o.user_id
      LEFT JOIN original_protocol_ids p ON p.entity_kind='user' AND p.entity_id=a.id
      WHERE me.user_id=$1 AND r.created_at > now() - make_interval(days => $2)
        AND NOT EXISTS(SELECT 1 FROM friends f WHERE f.user_id=$1 AND f.friend_id=o.user_id)
      GROUP BY a.id,a.nickname,a.sex,a.avatar_hash,a.avatar_status,p.wire_id ORDER BY "lastAt" DESC LIMIT $3`, [userId, RECENT_DAYS, RECENT_LIMIT]);
    return { players: await Promise.all(rows.rows.map(async row => ({ ...this.card({ ...row, uid: row.uid ?? await this.publicId(row.id) }),
      lastAt: row.lastAt, requested: row.requested, incoming: row.incoming }))) };
  }

  /** 好友列表：在线状态 离线 / 空闲 / 打牌中，加来源（S3-AC5 老好友照常列出）。 */
  async friends(userId: string) {
    const rows = await this.db.query(`SELECT ${USER_COLUMNS},p.wire_id AS uid,f.source,f.first_room_id AS "firstRoomId",f.last_played_at AS "lastPlayedAt",
        (SELECT json_build_object('state',r.state,'currentRound',r.current_round,'rounds',r.rounds) FROM room_members m JOIN rooms r ON r.id=m.room_id
          WHERE m.user_id=a.id AND r.state IN ('playing','between_rounds') ORDER BY r.created_at DESC LIMIT 1) AS room
      FROM friends f JOIN accounts a ON a.id=f.friend_id LEFT JOIN original_protocol_ids p ON p.entity_kind='user' AND p.entity_id=a.id
      WHERE f.user_id=$1 ORDER BY f.last_played_at DESC LIMIT 1000`, [userId]);
    const friends = await Promise.all(rows.rows.map(async row => {
      const online = this.options.isOnline(row.id);
      const room = typeof row.room === 'string' ? JSON.parse(row.room) : row.room;
      const status: FriendStatus = !online ? 'offline' : room ? 'playing' : 'idle';
      return { ...this.card({ ...row, uid: row.uid ?? await this.publicId(row.id) }), status,
        round: status === 'playing' ? { current: room.currentRound, total: room.rounds } : null,
        source: row.source ?? (row.firstRoomId ? 'table' : 'search'), lastPlayedAt: row.lastPlayedAt };
    }));
    const order: Record<FriendStatus, number> = { idle: 0, playing: 1, offline: 2 };
    friends.sort((a, b) => order[a.status] - order[b.status]);
    return { myUid: await this.publicId(userId), friends, limit: (await this.settings.get()).friendLimit };
  }
}
