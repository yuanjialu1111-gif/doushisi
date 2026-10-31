import { randomUUID } from 'node:crypto';
import type { Database, Sql } from './database.js';
import type { SettingsService } from './settings.js';
import { getVariant } from '@dss/rules';
import { avatarUrl } from './avatars.js';
import { requireCondition } from './errors.js';
import { money, type Decimal } from './money.js';

// 第二轮 S3：好友改成申请制（计划 2.3）。对外只用数字 ID（原版 uid），不露账号的 uuid。
export const RECENT_DAYS = 7;
export const RECENT_LIMIT = 30;
// 第二轮 S4：私聊只发编号。常用语 0–11 是原版牌桌那 12 句，12–17 是约局用语；表情 0–14 是原版牌桌 15 个。
export const PHRASE_COUNT = 18;
export const FACE_COUNT = 15;
// 待确认 16：好友申请附言 0–3，文字在接入层（「一起打牌认识的」等），这里只认编号。
export const FRIEND_NOTE_COUNT = 4;
export const MESSAGES_PER_MINUTE = 30;
export const MESSAGE_PAGE = 50;
export type InviteResult = 'joined' | 'rejected' | 'expired' | 'full';

export type FriendStatus = 'offline' | 'idle' | 'playing';
export interface SocialOptions {
  isOnline(userId: string): boolean;
  /** 公开桌入座门槛（RoomService.thresholdFor），邀请卡上显示。 */
  thresholdFor?(sql: Sql, room: Record<string, any>): Promise<Decimal>;
  now?: () => number;
}

const USER_COLUMNS = 'a.id,a.nickname,a.sex,a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus"';

export class SocialService {
  private searches = new Map<string, number[]>();
  private sent = new Map<string, number[]>();
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
    const { friendRequestExpiryDays, messageRetentionDays } = await this.settings.get();
    await this.db.query("UPDATE friend_requests SET status='expired',decided_at=now() WHERE status='pending' AND created_at <= now() - make_interval(days => $1)", [friendRequestExpiryDays]);
    await this.db.query("UPDATE room_invites SET result='expired' WHERE result IS NULL AND expires_at <= now()");
    // S4-AC3：私聊消息和邀请卡按后台天数清掉。
    await this.db.query('DELETE FROM friend_messages WHERE created_at <= now() - make_interval(days => $1)', [messageRetentionDays]);
    await this.db.query('DELETE FROM room_invites WHERE created_at <= now() - make_interval(days => $1)', [messageRetentionDays]);
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
  async request(userId: string, uid: string, source: 'search' | 'recent', note: number | null = null) {
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
    await this.db.query('INSERT INTO friend_requests(id,from_id,to_id,source,note) VALUES($1,$2,$3,$4,$5)', [id, userId, target!.id, source, note]);
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
    const incoming = await this.db.query(`SELECT q.id AS "requestId",q.created_at AS "createdAt",q.source,q.note,${USER_COLUMNS},p.wire_id AS uid FROM friend_requests q
      JOIN accounts a ON a.id=q.from_id LEFT JOIN original_protocol_ids p ON p.entity_kind='user' AND p.entity_id=a.id
      WHERE q.to_id=$1 AND q.status='pending' ORDER BY q.created_at DESC LIMIT 100`, [userId]);
    const outgoing = await this.db.query(`SELECT q.id AS "requestId",q.created_at AS "createdAt",q.status,q.decided_at AS "decidedAt",${USER_COLUMNS},p.wire_id AS uid FROM friend_requests q
      JOIN accounts a ON a.id=q.to_id LEFT JOIN original_protocol_ids p ON p.entity_kind='user' AND p.entity_id=a.id
      WHERE q.from_id=$1 AND q.created_at > now() - make_interval(days => $2) ORDER BY q.created_at DESC LIMIT 100`, [userId, friendRequestExpiryDays]);
    const withUid = async (row: Record<string, any>) => ({ ...row, uid: row.uid ?? await this.publicId(row.id) });
    return {
      incoming: await Promise.all(incoming.rows.map(async row => ({ id: row.requestId, createdAt: row.createdAt, source: row.source, note: row.note, user: this.card(await withUid(row)) }))),
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

  /** 在线状态：离线 / 空闲 / 打牌中（打牌中带第几局）。 */
  private async presence(ids: string[], sql: Sql = this.db) {
    const rooms = ids.length ? (await sql.query(`SELECT DISTINCT ON (m.user_id) m.user_id AS "userId",r.current_round AS "currentRound",r.rounds FROM room_members m JOIN rooms r ON r.id=m.room_id
      WHERE m.user_id = ANY($1::uuid[]) AND r.state IN ('playing','between_rounds') ORDER BY m.user_id,r.created_at DESC`, [ids])).rows : [];
    const playing = new Map(rooms.map(row => [row.userId as string, row]));
    return new Map(ids.map(id => {
      const room = playing.get(id), status: FriendStatus = !this.options.isOnline(id) ? 'offline' : room ? 'playing' : 'idle';
      return [id, { status, round: status === 'playing' ? { current: room!.currentRound, total: room!.rounds } : null }];
    }));
  }

  private async friendByUid(userId: string, uid: string, sql: Sql = this.db) {
    const target = await this.userByUid(uid, sql);
    requireCondition(Boolean(target), 'USER_NOT_FOUND', '没有这个 ID 的玩家。', 404);
    requireCondition(target!.id !== userId && await this.isFriend(userId, target!.id, sql), 'NOT_FRIENDS', '只能和好友私聊、邀请好友。', 403);
    return target!;
  }

  private rateLimit(userId: string) {
    const now = this.now();
    const recent = (this.sent.get(userId) ?? []).filter(time => now - time < 60_000);
    requireCondition(recent.length < MESSAGES_PER_MINUTE, 'MESSAGE_RATE_LIMITED', '发得太快了，歇一下再发。', 429);
    recent.push(now); this.sent.set(userId, recent);
    if (this.sent.size > 5000) for (const [key, times] of this.sent) if (!times.some(time => now - time < 60_000)) this.sent.delete(key);
  }

  /** 发私聊（S4-AC1）：只收常用语编号、表情编号；邀请卡只能走 invite()。 */
  async send(userId: string, uid: string, kind: 'phrase' | 'face', ref: number) {
    requireCondition(Number.isInteger(ref) && ref >= 0 && ref < (kind === 'phrase' ? PHRASE_COUNT : FACE_COUNT), 'INVALID_MESSAGE', '没有这句常用语或这个表情。');
    const target = await this.friendByUid(userId, uid);
    this.rateLimit(userId);
    const id = randomUUID();
    const row = (await this.db.query('INSERT INTO friend_messages(id,from_id,to_id,kind,ref) VALUES($1,$2,$3,$4,$5) RETURNING created_at AS "createdAt"', [id, userId, target.id, kind, String(ref)])).rows[0]!;
    return { message: { id, fromMe: true, kind, ref, createdAt: row.createdAt } };
  }

  /** 邀请卡上的房间和状态（S4-AC6）。没处理过的按当时情况算：过期、桌满或已开局。 */
  private async inviteViews(ids: string[], sql: Sql = this.db) {
    if (!ids.length) return new Map<string, Record<string, unknown>>();
    const rows = (await sql.query(`SELECT r.*,i.id AS "inviteId",i.result,i.expires_at AS "expiresAt",i.expires_at <= now() AS "timedOut",
        (SELECT COUNT(*)::int FROM room_members m WHERE m.room_id=r.id) AS seated
      FROM room_invites i JOIN rooms r ON r.id=i.room_id WHERE i.id = ANY($1::uuid[])`, [ids])).rows;
    const views = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const open = row.state === 'waiting' && row.current_round === 0 && row.seated < row.player_count;
      const state = row.result ?? (row.timedOut ? 'expired' : open ? 'pending' : 'full');
      const threshold = row.visibility === 'public' && this.options.thresholdFor ? money(await this.options.thresholdFor(sql, row)) : null;
      views.set(row.inviteId, { id: row.inviteId, state, expiresAt: row.expiresAt, room: { code: row.code, name: getVariant(row.variant_key)?.name ?? row.variant_key,
        baseBeans: row.rules?.baseBeans ?? null, rounds: row.rounds, playerCount: row.player_count, seated: row.seated, threshold } });
    }
    return views;
  }

  private async messageViews(userId: string, rows: Record<string, any>[], sql: Sql = this.db) {
    const invites = await this.inviteViews(rows.filter(row => row.kind === 'invite').map(row => row.ref), sql);
    return rows.map(row => ({ id: row.id, fromMe: row.from_id === userId, kind: row.kind, createdAt: row.created_at,
      ...(row.kind === 'invite' ? { invite: invites.get(row.ref) ?? null } : { ref: Number(row.ref) }) }));
  }

  /** 和某个好友的最近 50 条，旧的在前；顺手把对方发来的标成已读（S4-AC2）。 */
  async messages(userId: string, uid: string, before?: string) {
    const { messageRetentionDays } = await this.settings.get();
    const target = await this.userByUid(uid);
    requireCondition(Boolean(target) && target!.id !== userId, 'USER_NOT_FOUND', '没有这个 ID 的玩家。', 404);
    const rows = (await this.db.query(`SELECT id,from_id,kind,ref,created_at FROM friend_messages
      WHERE ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)) AND created_at > now() - make_interval(days => $3) AND ($4::timestamptz IS NULL OR created_at < $4)
      ORDER BY created_at DESC LIMIT $5`, [userId, target!.id, messageRetentionDays, before ?? null, MESSAGE_PAGE])).rows.reverse();
    await this.db.query('UPDATE friend_messages SET read_at=now() WHERE to_id=$1 AND from_id=$2 AND read_at IS NULL', [userId, target!.id]);
    const presence = (await this.presence([target!.id])).get(target!.id)!;
    return { user: { ...this.card({ ...target, uid: target!.uid }), ...presence, isFriend: await this.isFriend(userId, target!.id) },
      messages: await this.messageViews(userId, rows), more: rows.length === MESSAGE_PAGE };
  }

  /** 「消息」页左边的会话列表：每个人最后一条和未读数，新的在前。 */
  async conversations(userId: string) {
    const { messageRetentionDays } = await this.settings.get();
    const rows = (await this.db.query(`SELECT DISTINCT ON (other) other,id,from_id,kind,ref,created_at FROM (
        SELECT *,CASE WHEN from_id=$1 THEN to_id ELSE from_id END AS other FROM friend_messages
        WHERE (from_id=$1 OR to_id=$1) AND created_at > now() - make_interval(days => $2)) m
      ORDER BY other,created_at DESC`, [userId, messageRetentionDays])).rows;
    if (!rows.length) return { conversations: [] };
    const others = rows.map(row => row.other as string);
    const users = new Map((await this.db.query(`SELECT ${USER_COLUMNS},p.wire_id AS uid FROM accounts a LEFT JOIN original_protocol_ids p ON p.entity_kind='user' AND p.entity_id=a.id
      WHERE a.id = ANY($1::uuid[])`, [others])).rows.map(row => [row.id as string, row]));
    const unread = new Map((await this.db.query('SELECT from_id,COUNT(*)::int AS count FROM friend_messages WHERE to_id=$1 AND read_at IS NULL GROUP BY from_id', [userId])).rows
      .map(row => [row.from_id as string, row.count as number]));
    const presence = await this.presence(others);
    const last = await this.messageViews(userId, rows);
    const conversations = await Promise.all(rows.map(async (row, index) => {
      const user = users.get(row.other)!;
      return { user: { ...this.card({ ...user, uid: user.uid ?? await this.publicId(row.other) }), ...presence.get(row.other)! }, last: last[index], unread: unread.get(row.other) ?? 0 };
    }));
    conversations.sort((a, b) => new Date(b.last.createdAt).getTime() - new Date(a.last.createdAt).getTime());
    return { conversations };
  }

  /** 牌桌上邀请好友（S4-AC4、S4-AC5）：自己在没开局、有空座的房间；对方是在线好友；同一好友间隔、邀请有效期都按后台秒数。 */
  async invite(userId: string, uid: string) {
    const { inviteSeconds } = await this.settings.get();
    const target = await this.friendByUid(userId, uid);
    requireCondition(this.options.isOnline(target.id), 'TARGET_OFFLINE', '对方不在线，把房号发给他吧。', 409);
    return this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`invite:${userId}:${target.id}`]);
      const room = (await tx.query(`SELECT r.*,(SELECT COUNT(*)::int FROM room_members x WHERE x.room_id=r.id) AS seated FROM rooms r JOIN room_members m ON m.room_id=r.id
        WHERE m.user_id=$1 AND r.state <> 'closed' ORDER BY r.created_at DESC LIMIT 1`, [userId])).rows[0];
      requireCondition(room && room.state === 'waiting' && room.current_round === 0, 'INVITE_NEEDS_ROOM', '先坐进一张还没开局的桌子，再邀请好友。', 409);
      requireCondition(room.seated < room.player_count, 'ROOM_FULL', '桌子已经坐满了。', 409);
      requireCondition(!(await tx.query('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2', [room.id, target.id])).rows[0], 'ALREADY_SEATED', '对方已经在这桌了。', 409);
      const last = (await tx.query(`SELECT CEIL(EXTRACT(EPOCH FROM created_at + make_interval(secs => $3) - now()))::int AS wait FROM room_invites
        WHERE from_id=$1 AND to_id=$2 AND created_at > now() - make_interval(secs => $3) ORDER BY created_at DESC LIMIT 1`, [userId, target.id, inviteSeconds])).rows[0];
      requireCondition(!last, 'INVITE_COOLDOWN', `刚邀请过他，${Math.max(1, last?.wait ?? 1)} 秒后才能再邀请。`, 429);
      const id = randomUUID();
      const created = (await tx.query(`INSERT INTO room_invites(id,from_id,to_id,room_id,expires_at) VALUES($1,$2,$3,$4,now() + make_interval(secs => $5))
        RETURNING expires_at AS "expiresAt"`, [id, userId, target.id, room.id, inviteSeconds])).rows[0]!;
      await tx.query("INSERT INTO friend_messages(id,from_id,to_id,kind,ref) VALUES($1,$2,$3,'invite',$4)", [randomUUID(), userId, target.id, id]);
      const presence = (await this.presence([target.id], tx)).get(target.id)!;
      return { inviteId: id, expiresAt: created.expiresAt, now: new Date(), status: presence.status };
    });
  }

  /** 接受邀请（S4-AC6）：再查一遍没过期、房间还在、有空座，回房号；真正入座走原来的输房号进房，门槛照查。 */
  async acceptInvite(userId: string, inviteId: string) {
    return this.db.transaction(async tx => {
      const invite = (await tx.query('SELECT id,to_id,room_id,result,expires_at <= now() AS "timedOut" FROM room_invites WHERE id=$1 FOR UPDATE', [inviteId])).rows[0];
      requireCondition(invite && invite.to_id === userId, 'INVITE_NOT_FOUND', '这条邀请不存在。', 404);
      await tx.query("UPDATE friend_messages SET read_at=now() WHERE to_id=$1 AND kind='invite' AND ref=$2 AND read_at IS NULL", [userId, inviteId]);
      if (invite.result === 'joined') return { ok: true, result: 'joined' as InviteResult, code: (await tx.query('SELECT code FROM rooms WHERE id=$1', [invite.room_id])).rows[0]!.code as string };
      requireCondition(!invite.result, 'INVITE_HANDLED', invite.result === 'rejected' ? '这条邀请已经忽略了。' : '邀请已经失效了。', 409);
      const finish = async (result: InviteResult) => { await tx.query('UPDATE room_invites SET result=$2 WHERE id=$1', [inviteId, result]); return { ok: false, result }; };
      if (invite.timedOut) return finish('expired');
      const room = (await tx.query('SELECT r.code,r.state,r.current_round,r.player_count,(SELECT COUNT(*)::int FROM room_members m WHERE m.room_id=r.id) AS seated FROM rooms r WHERE r.id=$1 FOR UPDATE', [invite.room_id])).rows[0]!;
      if (room.state !== 'waiting' || room.current_round !== 0 || room.seated >= room.player_count) return finish('full');
      return { ok: true, result: null, code: room.code as string };
    });
  }

  async rejectInvite(userId: string, inviteId: string) {
    const invite = (await this.db.query('SELECT to_id,result FROM room_invites WHERE id=$1', [inviteId])).rows[0];
    requireCondition(invite && invite.to_id === userId, 'INVITE_NOT_FOUND', '这条邀请不存在。', 404);
    await this.db.query("UPDATE room_invites SET result='rejected' WHERE id=$1 AND result IS NULL", [inviteId]);
    await this.db.query("UPDATE friend_messages SET read_at=now() WHERE to_id=$1 AND kind='invite' AND ref=$2 AND read_at IS NULL", [userId, inviteId]);
    return { ok: true };
  }

  /** 每 5 秒的小轮询（计划 2.4）：未处理申请数、未读私聊数（按人）、还在有效期的邀请。popup 为 false 表示对方在房间里，不弹窗只进「消息」。 */
  async pulse(userId: string) {
    const { friendRequestExpiryDays } = await this.settings.get();
    const requests = (await this.db.query("SELECT COUNT(*)::int AS count FROM friend_requests WHERE to_id=$1 AND status='pending' AND created_at > now() - make_interval(days => $2)",
      [userId, friendRequestExpiryDays])).rows[0]!.count as number;
    const unreadRows = (await this.db.query(`SELECT p.wire_id AS uid,COUNT(*)::int AS count FROM friend_messages m
      LEFT JOIN original_protocol_ids p ON p.entity_kind='user' AND p.entity_id=m.from_id WHERE m.to_id=$1 AND m.read_at IS NULL GROUP BY p.wire_id`, [userId])).rows;
    const unreadFrom: Record<string, number> = {};
    for (const row of unreadRows) if (row.uid !== null) unreadFrom[String(row.uid)] = row.count;
    const pending = (await this.db.query(`SELECT i.id AS "inviteId",i.created_at AS "createdAt",${USER_COLUMNS},p.wire_id AS uid FROM room_invites i JOIN accounts a ON a.id=i.from_id
      LEFT JOIN original_protocol_ids p ON p.entity_kind='user' AND p.entity_id=a.id
      WHERE i.to_id=$1 AND i.result IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC LIMIT 5`, [userId])).rows;
    const seated = Boolean((await this.db.query("SELECT 1 FROM room_members m JOIN rooms r ON r.id=m.room_id WHERE m.user_id=$1 AND r.state <> 'closed' LIMIT 1", [userId])).rows[0]);
    const views = await this.inviteViews(pending.map(row => row.inviteId));
    const invites = await Promise.all(pending.filter(row => views.get(row.inviteId)?.state === 'pending').map(async row => ({ ...views.get(row.inviteId)!,
      from: this.card({ ...row, uid: row.uid ?? await this.publicId(row.id) }), popup: !seated })));
    return { now: new Date(), requests, unread: unreadRows.reduce((sum, row) => sum + row.count, 0), unreadFrom, invites };
  }
}
