import type { FastifyInstance } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import protobuf from 'protobufjs/minimal.js';
import { z } from 'zod';
import { decodeFrame, encodeFrame, assertCommandBody, expectedBodyField, MSGEvent, MAX_FRAME_BYTES } from '@dss/protocol';
import { catalogue, supportsNewRoom, QIONGLAI_OPTION_VERSION, QIONGLAI_OPTIONS, getRoomSpec, resolveVariantKey, XINJIN_REGION, type RegionContext, type RoomOptions } from '@dss/rules';
import type { Database } from './database.js';
import { type Actor, type AuthService, requireRole } from './auth.js';
import type { BalanceChange, LedgerService } from './ledger.js';
import type { PolicyService } from './policies.js';
import type { RoomService, DissolveState } from './rooms.js';
import { AppError, requireCondition } from './errors.js';
import { Decimal, money } from './money.js';
import { ReplayService } from './replays.js';
import { avatarUrl, wireSex } from './avatars.js';
import type { ProfileService } from './profile.js';
import type { StatsService } from './stats.js';

export const ORIGINAL_WIRE_VERSION = 2;
export const ORIGINAL_EXTENSION_FIELD = 60000;
export { DEFAULT_AVATAR_URL } from './avatars.js';
export interface DecimalField { path: (string | number)[]; value: string }
export interface QionglaiWireOptions { version: typeof QIONGLAI_OPTION_VERSION; qlTianDiHu: 0 | 1; qlHongHeiHu: 0 | 1; qlHongHei50: 0 | 1 }
export interface OriginalExtension {
  version: 2;
  decimalFields: DecimalField[];
  request?: { commandId: string; roomId: string; expectedRoundId?: string; expectedStateVersion?: number; decisionId?: string };
  capabilities?: string[];
  decisionId?: string | null;
  createRoom?: { baseBeans?: string; playerNum?: number; qionglai?: QionglaiWireOptions; visibility?: 'public' };
  roomOptions?: { baseBeans: string; baseBeansSource: 'manual' | 'original-basicTimes'; playerNum: number; playerNumSource: 'manual' | 'original'; qionglai?: QionglaiWireOptions };
  roomState?: { roomId: string | null; roundId: string | null; stateVersion: number | null };
  ack?: { commandId: string };
  replay?: { version: 1; roomId: string; roundId: string; manifestUrl: string };
  error?: { code: string; message: string };
}
const commandIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).refine(value => !value.startsWith('scheduled-'));
const stateVersionSchema = z.number().int().min(0).max(2147483646);
const decisionIdSchema = z.string().regex(/^[\w:-]{1,100}$/);
const requestSchema = z.object({ commandId: commandIdSchema, roomId: z.string().uuid(), expectedRoundId: z.string().uuid().optional(), expectedStateVersion: stateVersionSchema.optional(), decisionId: decisionIdSchema.optional() }).strict();
const qionglaiSchema = z.object({ version: z.literal(QIONGLAI_OPTION_VERSION),
  qlTianDiHu: z.union([z.literal(0), z.literal(1)]), qlHongHeiHu: z.union([z.literal(0), z.literal(1)]), qlHongHei50: z.union([z.literal(0), z.literal(1)]) }).strict();
const createRoomSchema = z.object({
  baseBeans: z.string().regex(/^(?:0|[1-9]\d{0,79})(?:\.\d{1,12})?$/).optional(),
  playerNum: z.number().int().min(2).max(4).optional(),
  qionglai: qionglaiSchema.optional(),
  // 开房勾了「公开到大厅」（R3）。
  visibility: z.literal('public').optional(),
}).strict().refine(value => value.baseBeans !== undefined || value.playerNum !== undefined || value.visibility !== undefined);
const roomOptionsSchema = z.object({
  baseBeans: z.string().regex(/^(?:0|[1-9]\d{0,79})(?:\.\d{1,12})?$/),
  baseBeansSource: z.enum(['manual', 'original-basicTimes']),
  playerNum: z.number().int().min(2).max(4),
  playerNumSource: z.enum(['manual', 'original']),
  qionglai: qionglaiSchema.optional(),
}).strict();
/** 第二轮 S7：新接入层登录时带这个标记，才能发、才会收 13–20 号互动表情。 */
export const EXTRA_EMOTES_VERSION = 'extra-emotes-v1';
export const isExtraEmote = (id: unknown) => typeof id === 'number' && id >= 13;
const extensionSchema = z.object({ version: z.literal(2),
  decimalFields: z.array(z.object({ path: z.array(z.union([z.string().max(100), z.number().int().nonnegative()])).min(2).max(16), value: z.string().regex(/^-?\d+(?:\.\d{1,12})?$/) }).strict()).max(10000),
  request: requestSchema.optional(),
  createRoom: createRoomSchema.optional(),
  capabilities: z.array(z.enum(['decision-window-v1', QIONGLAI_OPTION_VERSION, EXTRA_EMOTES_VERSION])).max(3).optional(),
  decisionId: decisionIdSchema.nullable().optional(),
  roomOptions: roomOptionsSchema.optional(),
  roomState: z.object({ roomId: z.string().uuid().nullable(), roundId: z.string().uuid().nullable(), stateVersion: stateVersionSchema.nullable() }).strict().optional(),
  ack: z.object({ commandId: commandIdSchema }).strict().optional(), error: z.object({ code: z.string().max(100), message: z.string().max(2000) }).strict().optional(),
  replay: z.object({ version: z.literal(1), roomId: z.string().uuid(), roundId: z.string().uuid(), manifestUrl: z.string().regex(/^\/api\/records\/[0-9a-f-]+\/replay\/[0-9a-f-]+\/original$/) }).strict().optional(),
}).strict();
const requestExtensionSchema = extensionSchema.pick({ version: true, decimalFields: true, request: true, createRoom: true, capabilities: true }).strict().refine(value => value.decimalFields.length === 0);
const protectedCommands = new Set<number>([23, 53, 121, 125]);
const roomOptionResponseCommands = new Set<number>([
  MSGEvent.HWResponseGameLogin,
  MSGEvent.HWResponseCreateTable,
  MSGEvent.HWResponseEnterTable,
  MSGEvent.HWResponseEnterTableFinish,
]);
const emptyRoomState = (): NonNullable<OriginalExtension['roomState']> => ({ roomId: null, roundId: null, stateVersion: null });
export interface OriginalProtocolServices {
  db: Database;
  auth: AuthService;
  ledger: LedgerService;
  policies: PolicyService;
  rooms: RoomService;
  replays?: ReplayService;
  profiles?: ProfileService;
  stats?: StatsService;
  profileRequired?: boolean;
  /** 第三轮只留大厅系统桌：原协议开房、输房号进别人的桌回「不支持」（R2 AC2）。 */
  lobbyOnly?: boolean;
  markOnline(userId: string, socket: WebSocket): void;
}

// V2 retains HWFR and all original protobuf numbers. MsgData field 60000 is a
// length-delimited UTF-8 JSON OriginalExtension. The client applies decimalFields
// to the decoded MsgData before handing it to the original controllers.
export function encodeOriginalResponse(cmd: number, body: Record<string, unknown>, uid = '', extension: Partial<OriginalExtension> = {}): Uint8Array {
  const field = expectedBodyField(cmd);
  requireCondition(field, 'UNKNOWN_COMMAND', 'Unknown original response command.');
  const packet = encodeFrame({ cmd, uid, protoVersion: ORIGINAL_WIRE_VERSION }, { [field]: body });
  const json = JSON.stringify({ version: 2, decimalFields: [], ...extension });
  const appended = protobuf.Writer.create().uint32((ORIGINAL_EXTENSION_FIELD << 3) | 2).string(json).finish();
  const result = new Uint8Array(packet.length + appended.length);
  requireCondition(result.length <= MAX_FRAME_BYTES, 'FRAME_TOO_LARGE', 'Response is too large.');
  result.set(packet); result.set(appended, packet.length);
  const view = new DataView(result.buffer);
  const bodyLengthOffset = 12 + view.getUint32(8, false);
  view.setUint32(0, result.length - 4, false);
  view.setUint32(bodyLengthOffset, view.getUint32(bodyLengthOffset, false) + appended.length, false);
  return result;
}

function readOriginalExtension(packet: Uint8Array): unknown {
  decodeFrame(packet);
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const reader = protobuf.Reader.create(packet.subarray(16 + view.getUint32(8, false)));
  let extension: unknown; let found = false;
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    if (tag >>> 3 === ORIGINAL_EXTENSION_FIELD) {
      requireCondition((tag & 7) === 2 && !found, 'INVALID_EXTENSION', 'Invalid or duplicate extension.');
      found = true;
      const text = reader.string();
      requireCondition(text.length <= 65536, 'INVALID_EXTENSION', 'Extension is too large.');
      try { extension = JSON.parse(text); } catch { throw new AppError('INVALID_EXTENSION', 'Extension must contain valid JSON.'); }
    } else reader.skipType(tag & 7);
  }
  return extension;
}
export function decodeOriginalExtension(packet: Uint8Array): OriginalExtension | undefined {
  const raw = readOriginalExtension(packet);
  if (raw === undefined) return undefined;
  const parsed = extensionSchema.safeParse(raw);
  requireCondition(parsed.success, 'INVALID_EXTENSION', 'Invalid original protocol extension.');
  return parsed.data as OriginalExtension;
}

export const ORIGINAL_PROTOCOL_MIGRATION = `
CREATE TABLE IF NOT EXISTS original_protocol_ids (
  wire_id integer GENERATED ALWAYS AS IDENTITY (START WITH 100000) UNIQUE,
  entity_kind text NOT NULL CHECK (entity_kind IN ('user','room','round')),
  entity_id uuid NOT NULL,
  PRIMARY KEY(entity_kind,entity_id)
);
CREATE TABLE IF NOT EXISTS original_protocol_regions (
  user_id uuid PRIMARY KEY REFERENCES accounts(id),
  shi_name text NOT NULL,
  xian_name text NOT NULL
);`;

const ids = [...new Set(catalogue.map(variant => variant.gameId))];
// 地区一律新津（S1）：不看客户端发来的、也不看库里存的；original_protocol_regions 老值留着不删。
const DEFAULT_REGION: RegionContext = { ...XINJIN_REGION };
const messages: Record<string, string> = {
  RULES_NOT_VERIFIED: '该玩法规则尚未完成原版核验，暂不能开始对局，未扣房费。',
  RULE_DEFAULT_NOT_VERIFIED: '该玩法的原服务端默认规则尚未核实，暂不能创建房间。',
  CLIENT_UPGRADE_REQUIRED: '请使用支持精确豆子显示的独立版客户端。',
  INVALID_CREDENTIALS: '账号或密码错误。', UNAUTHORIZED: '登录已过期，请重新登录。',
  USERNAME_TAKEN: '账号已存在。', INVALID_USERNAME: '账号格式不正确。', INVALID_PASSWORD: '密码格式不正确。',
  ROOM_FULL: '当前房间已满。', ROOM_NOT_FOUND: '此房间不存在。', ROOM_STARTED: '对局已经开始。', SYSTEM_ROOM_LEAVE: '大厅桌开局前不用解散，直接退出就行。',
  ALREADY_IN_ROOM: '请先退出当前房间。', INSUFFICIENT_BALANCE: '豆子不足，请联系豆子管理员。',
  KICK_ROOM_NOT_FOUND: '此房间不存在。', KICK_OWNER_MISMATCH: '只有房主可以请离玩家。',
  KICK_TARGET_NOT_IN_ROOM: '该座位没有可请离的玩家。', KICK_ROOM_STARTED: '对局已经开始，不能请离玩家。',
  INVALID_ROOM_OPTIONS: '开房选项不完整或存在不支持的组合。',
  UNSUPPORTED_OPERATION: '此功能未开放。', RATE_LIMITED: '操作过于频繁，请稍后重试。',
  GAME_REMOVED: '此游戏已从斗十四地区版移除，原有记录保留。',
  REPLAY_WHILE_IN_ROOM: '请先退出或结束当前房间，再查看回放。',
};
const resultCodes: Record<string, number> = {
  USERNAME_TAKEN: 1005, INVALID_USERNAME: 1004, INVALID_PASSWORD: 1004, INVALID_CREDENTIALS: 1006,
  UNAUTHORIZED: 1001, ROOM_NOT_FOUND: 1003, ROOM_FULL: 1023, ALREADY_IN_ROOM: 1011,
  RULES_NOT_VERIFIED: 2002, RULE_DEFAULT_NOT_VERIFIED: 2002, CLIENT_UPGRADE_REQUIRED: 2002,
  INVALID_ROOM_OPTIONS: 2001, INSUFFICIENT_BALANCE: 1012, ROOM_STARTED: 1033,
  KICK_ROOM_NOT_FOUND: 1051, KICK_OWNER_MISMATCH: 1052, KICK_TARGET_NOT_IN_ROOM: 1053, KICK_ROOM_STARTED: 1054,
};
const responseCommands = new Map<number, number>(Object.entries(MSGEvent).filter(([name]) => name.startsWith('HWRequest')).flatMap(([name, value]) => {
  const response = MSGEvent[name.replace('HWRequest', 'HWResponse') as keyof typeof MSGEvent];
  return response ? [[value, response] as [number, number]] : [];
}));

function exactField(body: Record<string, any>, key: string, value: string, path: (string | number)[], fields: DecimalField[]): void {
  const decimal = money(value);
  fields.push({ path: [...path, key], value: decimal });
  const number = new Decimal(decimal);
  // V2 patches the explicit zero placeholder before original controllers run.
  // Legacy clients are rejected, so this placeholder never represents a balance.
  body[key] = number.isInteger() && number.abs().lte('9223372036854775807') ? decimal : '0';
}

export async function registerOriginalProtocol(app: FastifyInstance, services: OriginalProtocolServices): Promise<void> {
  const { db, auth, ledger, rooms, markOnline } = services;
  const replays = services.replays ?? new ReplayService(db, rooms.engines);
  await db.query('SELECT wire_id FROM original_protocol_ids LIMIT 1');
  const online = new Map<string, Set<Connection>>();
  const byIp = new Map<string, { count: number; since: number; connections: number }>();
  const projections = new Map<string, RoomProjection>();
  const roomQueues = new Map<string, Promise<void>>();
  const voteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let shuttingDown = false;

  function isUserOnline(userId: string): boolean {
    return [...(online.get(userId) ?? [])].some(connection => !connection.closed && connection.foreground && connection.socket.readyState === 1);
  }
  function roomConnections(roomId: string): Connection[] {
    return [...online.values()].flatMap(connections => [...connections]).filter(connection => connection.roomId === roomId && !connection.closed);
  }

  async function wireId(kind: 'user' | 'room' | 'round', entityId: string): Promise<number> {
    const existing = await db.query('SELECT wire_id FROM original_protocol_ids WHERE entity_kind=$1 AND entity_id=$2', [kind, entityId]);
    if (existing.rows[0]) return existing.rows[0].wire_id;
    const result = await db.query('INSERT INTO original_protocol_ids(entity_kind,entity_id) VALUES($1,$2) ON CONFLICT(entity_kind,entity_id) DO UPDATE SET entity_id=EXCLUDED.entity_id RETURNING wire_id', [kind, entityId]);
    return result.rows[0]!.wire_id;
  }
  async function numericUid(userId: string): Promise<string> { return String(await wireId('user', userId)); }
  async function activeRoom(actor: Actor, code?: number) {
    const room = await rooms.current(actor.id);
    requireCondition(room && (code === undefined || Number(room.code) === code), 'ROOM_NOT_FOUND', 'Room does not exist.', 404);
    return room;
  }
  async function tableInfo(room: NonNullable<Awaited<ReturnType<RoomService['current']>>>) {
    const gameId = Number(room.variantKey.split(':')[0]);
    const data: Record<string, unknown> = { ...room.rules, roomId: Number(room.code), roomType: 100,
      areaType: gameId === 101 ? 6 : gameId, creatorUid: await numericUid(room.ownerId),
      playerNum: room.playerCount, gameNum: room.rounds, useCardType: room.feeMode === 'owner' ? 1 : 2,
    };
    delete data.region;
    // 房内不再定位（R11）：老 GPS 房也按没开定位下发，客户端不弹距离。
    delete data.openGps;
    if (gameId === 101) data.processType = 2;
    return data;
  }
  function frozenRoomOptions(room: NonNullable<Awaited<ReturnType<RoomService['current']>>>): OriginalExtension['roomOptions'] | undefined {
    const baseBeans = room.baseBeans ?? room.rules?.baseBeans;
    const baseBeansSource = room.baseBeansSource ?? room.rules?.baseBeansSource;
    const playerNumSource = room.playerNumSource ?? room.rules?.playerNumSource;
    const frozen = room.rules?.qionglai;
    const qionglai = frozen ? { version: frozen.version, qlTianDiHu: frozen.qlTianDiHu, qlHongHeiHu: frozen.qlHongHeiHu, qlHongHei50: frozen.qlHongHei50 } : undefined;
    const parsed = roomOptionsSchema.safeParse({ baseBeans, baseBeansSource, playerNum: room.playerCount, playerNumSource, ...(qionglai ? { qionglai } : {}) });
    return parsed.success ? parsed.data : undefined;
  }
  async function userInfo(member: Record<string, any>, path: (string | number)[], fields: DecimalField[],
    display: { score?: string; changeScore?: string } = {}) {
    const user: Record<string, any> = { uid: await numericUid(member.userId), nick: member.nickname,
      picUrl: member.avatarUrl ?? avatarUrl({ id: member.userId, avatarHash: member.avatarHash, avatarStatus: member.avatarStatus }), seatIndex: member.seat, isReady: member.ready, online: isUserOnline(member.userId), sex: wireSex(member.sex), headType: 0,
      // 没飘时原版发 -1；缺省成 0 会让客户端以为已开局，开局前只给「解散」不给「退出」。
      piaoNum: -1,
    };
    // S6：牌桌上点别人头像看到的对局数、总胜局、胜率（原版直接读 UserInfo 这三个字段，不发就显示 undefined）。
    const played = await services.stats?.stats(member.userId);
    if (played) Object.assign(user, { gameNum: played.rounds, winNum: played.wins, winRate: played.winRate });
    // Original protobuf names are retained only as a compatibility projection.  In the
    // standalone game a table score is the current bean balance and changeScore is the
    // current round's bean delta; neither represents another currency.
    exactField(user, 'score', display.score ?? member.beanBalance ?? member.score ?? '0', path, fields);
    exactField(user, 'changeScore', display.changeScore ?? member.roundBeanDelta ?? member.changeScore ?? '0', path, fields);
    return user;
  }
  type Connection = {
    socket: WebSocket; actor?: Actor; token?: string; uid: string; region: RegionContext; closed: boolean; lastBalance?: string; pendingBalance?: string;
    roomId?: string; foreground: boolean; balancePushReady: boolean; roomOptions?: OriginalExtension['roomOptions']; roomState: NonNullable<OriginalExtension['roomState']>; sequence: number;
      capabilities?: string[];
      send(cmd: number, body: Record<string, unknown>, decimalFields?: DecimalField[], error?: OriginalExtension['error'], ack?: OriginalExtension['ack'], replay?: OriginalExtension['replay'], decisionId?: string | null): void;
  };

  /**
   * Push a committed bean balance to every live session for the affected
   * account. The operation carries balanceAfter from inside the transaction,
   * so this path never performs a read against an uncommitted wallet row.
   * lastBalance makes retries and overlapping room/admin events idempotent.
   */
  function publishBalanceChanges(changes: readonly Pick<BalanceChange, 'userId' | 'balance'>[]): void {
    if (shuttingDown || !changes.length) return;
    const latest = new Map<string, string>();
    for (const change of changes) latest.set(change.userId, money(change.balance));
    for (const [userId, balance] of latest) for (const connection of online.get(userId) ?? []) {
      if (connection.closed || !connection.actor) continue;
      if (!connection.balancePushReady) { connection.pendingBalance = balance; continue; }
      if (connection.lastBalance === balance) continue;
      const body: Record<string, any> = { uid: connection.uid, changeType: 0 };
      const fields: DecimalField[] = [];
      exactField(body, 'goldNum', balance, ['hwNotifyUserDataChange'], fields);
      connection.lastBalance = balance;
      connection.send(MSGEvent.HWNotifyUserDataChange, body, fields);
    }
  }

  interface RoomProjection { code: number; state: string; members: Record<string, any>[]; dissolve: DissolveState | null; cursor: NonNullable<OriginalExtension['roomState']>; sequence: number; completed: boolean }
  async function roomProjection(roomId: string): Promise<RoomProjection | null> {
    const room = (await db.query("SELECT r.code,r.state,r.current_round,r.rounds,q.id AS round_id,q.state_version,(SELECT COALESCE(MAX(e.sequence),0)::int FROM game_events e WHERE e.room_id=r.id) AS sequence,(SELECT l.end_reason FROM rounds l WHERE l.room_id=r.id ORDER BY l.number DESC LIMIT 1) AS last_end FROM rooms r LEFT JOIN rounds q ON q.room_id=r.id AND q.state='playing' WHERE r.id=$1", [roomId])).rows[0];
    if (!room) return null;
    const members = (await db.query(`SELECT m.user_id AS "userId",m.seat,m.ready,m.auto_play AS "autoPlay",
      COALESCE(t.room_bean_delta,0)::text AS score,w.balance::text AS "beanBalance",a.nickname,a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus",a.sex
      FROM room_members m
      JOIN accounts a ON a.id=m.user_id
      JOIN wallets w ON w.user_id=m.user_id
      LEFT JOIN room_member_settlement_totals t ON t.room_id=m.room_id AND t.user_id=m.user_id
      WHERE m.room_id=$1 ORDER BY m.seat`, [roomId])).rows;
    let dissolve = await rooms.dissolveState(roomId);
    if (dissolve && dissolve.expiresAt <= Date.now()) { await rooms.expireDissolve(roomId); dissolve = null; }
    // 打满局数正常收桌：牌桌留着小结算和「查看总结算」，不直接回大厅（第三轮 R5）。
    const completed = room.state === 'closed' && room.current_round >= room.rounds && room.last_end === 'completed';
    return { code: Number(room.code), state: room.state, members, dissolve, sequence: room.sequence, completed,
      cursor: room.state === 'closed' ? emptyRoomState() : { roomId, roundId: room.round_id ?? null, stateVersion: room.state_version ?? null } };
  }
  async function dissolveInfo(room: RoomProjection): Promise<Record<string, unknown> | undefined> {
    if (!room.dissolve) return undefined;
    const disList = [];
    for (const member of room.members) disList.push({ uid: await numericUid(member.userId), state: room.dissolve.votes.some(vote => vote.userId === member.userId && vote.agree) ? 1 : 0 });
    return { uid: await numericUid(room.dissolve.initiatorId), disList,
      cd: Math.max(0, Math.ceil((room.dissolve.expiresAt - Date.now()) / 1000)), endTime: String(Math.floor(room.dissolve.expiresAt / 1000)),
    };
  }
  function armVoteTimer(roomId: string, state: DissolveState | null) {
    const previous = voteTimers.get(roomId); if (previous) clearTimeout(previous);
    voteTimers.delete(roomId);
    if (state && !shuttingDown) {
      const timer = setTimeout(() => { voteTimers.delete(roomId); void rooms.expireDissolve(roomId).catch(error => app.log.error(error)); }, Math.max(1, state.expiresAt - Date.now() + 10));
      timer.unref(); voteTimers.set(roomId, timer);
    }
  }
  /** 引擎只知道账号 id；结算窗要昵称、原版数字 uid，总结算的 score 是这桌累计（changeScore 仍是这局输赢）。 */
  async function gameOverForWire(packet: Record<string, any>, room: RoomProjection): Promise<Record<string, any>> {
    const body = structuredClone(packet.body ?? {});
    const decimalFields: DecimalField[] = (packet.decimalFields ?? []).map((field: DecimalField) => ({ ...field, path: [...field.path] }));
    for (const [index, info] of (body.userScoreInfo ?? []).entries()) {
      const member = room.members.find(item => item.userId === info.uid);
      info.nick = member?.nickname ?? '';
      info.uid = Number(await numericUid(info.uid));
      const total = decimalFields.find(field => field.path.join('.') === `hwNotifyGameOver.userScoreInfo.${index}.score`);
      if (total && member) { total.value = member.score; info.score = member.score; }
    }
    return { ...packet, body, decimalFields };
  }
  async function syncRoom(roomId: string): Promise<void> {
    if (shuttingDown) return;
    const watchers = roomConnections(roomId);
    if (!watchers.length) { projections.delete(roomId); return; }
    const previous = projections.get(roomId);
    const current = await roomProjection(roomId);
    if (!current) return;
    const firstSequence = Math.min(current.sequence, ...watchers.map(peer => peer.sequence));
    if (current.sequence > firstSequence) {
      const events = await db.query('SELECT payload,sequence FROM game_events WHERE room_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence', [roomId, firstSequence, current.sequence]);
      for (const { payload, sequence } of events.rows) for (const peer of watchers) {
        if (!peer.actor || peer.sequence >= sequence) continue;
        const packets = payload.originalNotifications?.[peer.actor.id] ?? [];
        for (const packet of packets) {
          requireCondition(Object.entries(MSGEvent).some(([name, command]) => command === packet.command && (name.startsWith('HWNotify') || name.startsWith('HWNottify'))),
            'INVALID_ORIGINAL_PROJECTION', 'An engine notification must use an original server notification command.', 500);
          peer.roomState = payload.originalRoomState;
          const shown = packet.command === MSGEvent.HWNotifyGameOver ? await gameOverForWire(packet, current) : packet;
          peer.send(shown.command, shown.body, shown.decimalFields, undefined, undefined, undefined, shown.decisionId);
        }
        peer.sequence = sequence;
      }
    }
    projections.set(roomId, current); armVoteTimer(roomId, current.dissolve);
    for (const peer of watchers) peer.roomState = current.members.some(member => member.userId === peer.actor?.id) ? current.cursor : emptyRoomState();
    if (current.state === 'closed') {
      for (const peer of watchers) { peer.send(MSGEvent.HWNotifyDissolvedTable, { roomId: current.code, result: true, dating: !current.completed }); peer.roomId = undefined; }
      projections.delete(roomId); return;
    }
    if (previous?.dissolve && (!current.dissolve || previous.dissolve.expiresAt !== current.dissolve.expiresAt)) {
      // The original window updates votes only; a new vote needs a fresh window
      // so its initiator and countdown cannot retain the previous vote's values.
      for (const peer of watchers) peer.send(MSGEvent.HWNotifyDissolvedTable, { roomId: current.code, result: false, dating: false });
    }
    for (const departed of previous?.members ?? []) if (!current.members.some(member => member.userId === departed.userId)) {
      // dss.onLeaveRoom is what moves the leaving player back to the hall. A
      // successful HWResponseLogoutTable alone does not drive that transition.
      for (const peer of watchers) peer.send(MSGEvent.HWNotifyLogoutTable, { seatIndex: departed.seat });
      for (const peer of watchers) if (peer.actor?.id === departed.userId) peer.roomId = undefined;
    }
    for (const member of current.members) {
      const prior = previous?.members.find(candidate => candidate.userId === member.userId);
      if (previous && !prior) {
        const fields: DecimalField[] = [];
        const info = await userInfo(member, ['hwNotifyEnterTable', 'userInfo'], fields);
        for (const peer of roomConnections(roomId)) if (peer.actor?.id !== member.userId) peer.send(MSGEvent.HWNottifyEnterTable, { userInfo: info }, fields);
      }
      if (!prior || prior.ready !== member.ready) for (const peer of roomConnections(roomId)) peer.send(MSGEvent.HWNotifyReadyForGame, { seatIndex: member.seat, state: member.ready });
      // This original notification has no seat field and only controls the local player.
      if (prior && !prior.autoPlay && member.autoPlay) for (const peer of roomConnections(roomId)) if (peer.actor?.id === member.userId) peer.send(MSGEvent.HWNotifyAuto, {});
    }
    if (current.dissolve && JSON.stringify(previous?.dissolve) !== JSON.stringify(current.dissolve)) {
      const info = await dissolveInfo(current);
      for (const peer of roomConnections(roomId)) peer.send(MSGEvent.HWNotifyDissolveTableOperation, info!);
    }
  }
  function queueRoomTask(roomId: string, operation: () => Promise<void>): Promise<void> {
    const next = (roomQueues.get(roomId) ?? Promise.resolve()).then(operation);
    const settled = next.catch(error => app.log.error(error));
    roomQueues.set(roomId, settled);
    void settled.finally(() => { if (roomQueues.get(roomId) === settled) roomQueues.delete(roomId); });
    return next;
  }
  function queueRoom(roomId: string): Promise<void> { return queueRoomTask(roomId, () => syncRoom(roomId)).catch(() => {}); }
  async function attachRoom(connection: Connection, roomId: string): Promise<void> {
    const newlyAttached = connection.roomId !== roomId;
    connection.roomId = roomId;
    const room = connection.actor ? await rooms.current(connection.actor.id) : null;
    connection.roomOptions = room && room.id === roomId ? frozenRoomOptions(room) : undefined;
    const state = await roomProjection(roomId);
    if (state) {
      connection.roomState = state.cursor;
      if (newlyAttached) connection.sequence = state.sequence;
      if (!projections.has(roomId)) { projections.set(roomId, state); armVoteTimer(roomId, state.dissolve); }
    }
  }
  function responseCarriesRoomOptions(command: number, body: Record<string, unknown>): boolean {
    if (!roomOptionResponseCommands.has(command)) return false;
    if (command === MSGEvent.HWResponseGameLogin) {
      return body.state === true && Number.isInteger(body.tableId) && /^\d{6}$/.test(String(body.tableId));
    }
    const tableInfo = body.tableInfo as Record<string, unknown> | undefined;
    return body.result === 1 && !!tableInfo && typeof tableInfo === 'object' && !Array.isArray(tableInfo)
      && Number.isInteger(tableInfo.roomId) && /^\d{6}$/.test(String(tableInfo.roomId));
  }
  async function publishPresence(userId: string): Promise<void> {
    if (shuttingDown) return;
    const found = await db.query("SELECT m.room_id,m.seat FROM room_members m JOIN rooms r ON r.id=m.room_id WHERE m.user_id=$1 AND r.state <> 'closed'", [userId]);
    for (const row of found.rows) for (const peer of roomConnections(row.room_id)) peer.send(MSGEvent.HWNotifyIsOnline, { seatIndex: row.seat, online: isUserOnline(userId) });
  }
  const onChanged = (roomId: string) => { void queueRoom(roomId); };
  rooms.on('changed', onChanged);
  // 系统桌清座只通知本人（R2 AC4）；带错误扩展的通知由接入层弹提示，原版不处理。
  const onSeatCleared = ({ userId, idleMinutes }: { userId: string; idleMinutes: number }) => {
    const message = `坐下超过 ${idleMinutes} 分钟还没开局，已自动离座，没有扣豆子。`;
    for (const peer of online.get(userId) ?? []) peer.send(MSGEvent.HWNotifyNotice, { noticeInfo: { msg: message, intervalSecond: 0, endTime: '' } }, [], { code: 'SEAT_CLEARED', message });
  };
  rooms.on('seatCleared', onSeatCleared);
  const onBalanceChanged = (changes: BalanceChange[]) => publishBalanceChanges(changes);
  ledger.on('balanceChanged', onBalanceChanged);
  rooms.on('balanceChanged', onBalanceChanged);
  app.addHook('onClose', async () => {
    shuttingDown = true; rooms.off('changed', onChanged); rooms.off('seatCleared', onSeatCleared); ledger.off('balanceChanged', onBalanceChanged); rooms.off('balanceChanged', onBalanceChanged);
    for (const timer of voteTimers.values()) clearTimeout(timer);
    voteTimers.clear(); await Promise.all(roomQueues.values());
    for (const connections of online.values()) for (const connection of connections) connection.socket.close(1001, 'Server closing');
  });

  app.get('/ws/original', { websocket: true }, (socket, request) => {
    const ip = request.ip;
    if (byIp.size >= 10000) {
      for (const [key, state] of byIp) if (!state.connections && Date.now() - state.since > 60000) byIp.delete(key);
      if (!byIp.has(ip) && byIp.size >= 10000) { socket.close(1013, 'Connection capacity'); return; }
    }
    const ipState = byIp.get(ip) ?? { count: 0, since: Date.now(), connections: 0 };
    byIp.set(ip, ipState);
    if (++ipState.connections > 256) { ipState.connections--; socket.close(1008, 'Connection limit'); return; }
    const connection: Connection = { socket, uid: '', region: DEFAULT_REGION, closed: false, foreground: true, balancePushReady: false, roomState: emptyRoomState(), sequence: 0,
      send(cmd, body, decimalFields = [], error, ack, replay, decisionId) {
        const roomOptions = connection.roomOptions && responseCarriesRoomOptions(cmd, body) ? connection.roomOptions : undefined;
        if (socket.readyState === 1) socket.send(encodeOriginalResponse(cmd, body, connection.uid, { decimalFields, roomState: connection.roomState,
          ...(roomOptions ? { roomOptions } : {}), ...(error ? { error } : {}), ...(ack ? { ack } : {}), ...(replay ? { replay } : {}),
          ...(decisionId !== undefined ? { decisionId } : {}) }));
      },
    };
    let queue = Promise.resolve(); let pending = 0; let burst = 0; let since = Date.now();
    const authTimer = setTimeout(() => socket.close(1008, 'Authentication required'), 20000);
    socket.once('close', () => {
      const wasOnline = connection.actor ? isUserOnline(connection.actor.id) || connection.foreground && !connection.closed : false;
      connection.closed = true; clearTimeout(authTimer); ipState.connections--;
      if (ipState.connections === 0 && Date.now() - ipState.since > 60000) byIp.delete(ip);
      if (connection.actor) {
        const entries = online.get(connection.actor.id); entries?.delete(connection); if (!entries?.size) online.delete(connection.actor.id);
        if (wasOnline !== isUserOnline(connection.actor.id)) void publishPresence(connection.actor.id).catch(error => app.log.error(error));
      }
    });

    async function refreshCursor() {
      if (!connection.actor) { connection.roomState = emptyRoomState(); return; }
      const found = (await db.query("SELECT r.id FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE m.user_id=$1 AND r.state<>'closed' ORDER BY r.created_at DESC LIMIT 1", [connection.actor.id])).rows[0];
      connection.roomState = found ? (await roomProjection(found.id))?.cursor ?? emptyRoomState() : emptyRoomState();
    }

    async function failure(command: number | undefined, error: unknown, ack?: OriginalExtension['ack']) {
      const code = error instanceof AppError ? error.code : error instanceof Error && error.name === 'RuleValidationError' ? 'INVALID_ROOM_OPTIONS' : 'INVALID_REQUEST';
      const message = messages[code] ?? (error instanceof AppError && error.statusCode < 500 ? error.message : '请求无效，请重试。');
      const response = command === undefined ? undefined : responseCommands.get(command);
      const extension = { code, message };
      await refreshCursor();
      if (response === MSGEvent.HWResponseGameLogin) connection.send(response, { state: false, uid: '', token: '' }, [], extension, ack);
      else if (response) connection.send(response, { result: resultCodes[code] ?? 2 }, [], extension, ack);
      else connection.send(MSGEvent.HWNotifyNotice, { noticeInfo: { msg: message, intervalSecond: 0, endTime: '' } }, [], extension, ack);
      if (code === 'UNAUTHORIZED' && connection.actor) socket.close(1008, 'Session expired');
    }

    async function login(body: Record<string, any>) {
      requireCondition(!connection.actor, 'ALREADY_AUTHENTICATED', 'This connection is already authenticated.');
      let actor: Actor; let token: string;
      if (typeof body.token === 'string' && body.token) { token = body.token; actor = await auth.authenticate(token); requireRole(actor, 'player'); }
      else {
        requireCondition(typeof body.account === 'string' && body.account.length <= 32 && typeof body.password === 'string' && body.password.length <= 128, 'INVALID_CREDENTIALS', 'Account and password required.', 401);
        const result = await auth.login(body.account, body.password); actor = result.user; token = result.token;
      }
      const uid = await numericUid(actor.id);
      const wasOnline = isUserOnline(actor.id);
      markOnline(actor.id, socket);
      connection.actor = actor; connection.token = token; connection.uid = uid; clearTimeout(authTimer);
      const peers = online.get(actor.id) ?? new Set<Connection>(); peers.add(connection); online.set(actor.id, peers);
      connection.region = DEFAULT_REGION;
      const room = await rooms.current(actor.id);
      if (room) await attachRoom(connection, room.id);
      else {
        connection.roomId = undefined;
        connection.roomOptions = undefined;
        connection.roomState = emptyRoomState();
      }
      const look = (await db.query('SELECT avatar_hash AS "avatarHash",avatar_status AS "avatarStatus",sex FROM accounts WHERE id=$1', [actor.id])).rows[0] ?? {};
      const reply: Record<string, any> = { state: true, uid, token, nick: actor.nickname, picUrl: avatarUrl({ id: actor.id, ...look }), sex: wireSex(look.sex),
        tableId: room ? Number(room.code) : 0, posType: 0, areaType: ids, ...connection.region,
        mustUpdate: false, isShowSmrz: false, isSmrz: false, winRate: (await services.stats?.stats(actor.id))?.winRate ?? '0%', headType: 0,
        showShouchong: false, showMonthcard: false, showYuandan: false, showChunjie: false, showZhaohuiHyhg: false,
      };
      const decimals: DecimalField[] = [];
      connection.lastBalance = await ledger.balance(actor.id);
      exactField(reply, 'goldNum', connection.lastBalance, ['hwResponseGameLogin'], decimals);
      connection.send(MSGEvent.HWResponseGameLogin, reply, decimals);
      connection.balancePushReady = true;
      // An adjustment can commit while login is loading region/room state. Its
      // latest committed value is held until this client has its login
      // snapshot, then projected without another database read.
      const pendingBalance = connection.pendingBalance;
      connection.pendingBalance = undefined;
      if (pendingBalance !== undefined && pendingBalance !== connection.lastBalance) publishBalanceChanges([{ userId: actor.id, balance: pendingBalance }]);
      if (!wasOnline) await publishPresence(actor.id);
    }

    async function enterFinished(actor: Actor, code: number) {
      const active = await activeRoom(actor, code);
      await queueRoomTask(active.id, async () => {
      const snapshot = await rooms.originalEnter(actor, active.id);
      const room = snapshot.room; const gameProjection = snapshot.game;
      if (room.rules?.qionglai) requireCondition(connection.capabilities?.includes(QIONGLAI_OPTION_VERSION), 'CLIENT_UPGRADE_REQUIRED', messages.CLIENT_UPGRADE_REQUIRED!, 426);
      if (rooms.engines.has(room.variantKey) && rooms.engines.get(room.variantKey, room.ruleVersion).interactions?.responseWindow) {
        requireCondition(connection.capabilities?.includes('decision-window-v1'), 'CLIENT_UPGRADE_REQUIRED', messages.CLIENT_UPGRADE_REQUIRED!, 426);
      }
      await attachRoom(connection, room.id);
      const fields: DecimalField[] = [];
      const users = [];
      for (let index = 0; index < room.members.length; index++) users.push(await userInfo(room.members[index]!, ['hwResponseEnterTableFinish', 'userInfo', index], fields));
      const info = await tableInfo(room);
      const projection = await roomProjection(room.id);
      const pendingVote = projection ? await dissolveInfo(projection) : undefined;
      connection.roomState = { roomId: room.id, roundId: room.roundId, stateVersion: room.stateVersion };
      connection.sequence = snapshot.sequence;
      connection.send(MSGEvent.HWResponseEnterTableFinish, { ...(gameProjection?.body ?? {}), result: 1, tableInfo: info, userInfo: users, tableState: gameProjection?.body.tableState ?? 0,
        seatIndex: room.members.find(member => member.userId === actor.id)!.seat, ...(pendingVote ? { dissolveInfos: pendingVote } : {}),
        leftCardNum: gameProjection?.body.leftCardNum ?? 0, round: room.currentRound, shiName: room.rules.region?.shiName ?? connection.region.shiName,
        xianName: room.rules.region?.xianName ?? connection.region.xianName, showPipeiPic: false, pipeiCd: 0,
      }, [...fields, ...(gameProjection?.decimalFields ?? [])], undefined, undefined, undefined, room.responseWindow?.id ?? null);
      await syncRoom(room.id);
      });
    }

    async function dispatch(command: number, body: Record<string, any>, version: number, metadata?: OriginalExtension['request'], createRoom?: OriginalExtension['createRoom']) {
      if (command === MSGEvent.HWRequestHeartBeat) {
        if (connection.actor) {
          await auth.authenticate(connection.token!);
          const balance = await ledger.balance(connection.actor.id);
          if (balance !== connection.lastBalance) publishBalanceChanges([{ userId: connection.actor.id, balance }]);
        }
        connection.send(MSGEvent.HWResponseHeartBeat, { state: true }); return;
      }
      requireCondition(version === 2, 'CLIENT_UPGRADE_REQUIRED', messages.CLIENT_UPGRADE_REQUIRED!, 426);
      if (!connection.actor) {
        if (Date.now() - ipState.since >= 60000) { ipState.since = Date.now(); ipState.count = 0; }
        if (command !== MSGEvent.HWRequestGameLogin || !body.token) requireCondition(++ipState.count <= 20, 'RATE_LIMITED', messages.RATE_LIMITED!, 429);
        if (command === MSGEvent.HWRequestRegister) {
          requireCondition(typeof body.account === 'string' && typeof body.password === 'string', 'INVALID_CREDENTIALS', 'Account and password required.');
          const created = await auth.create(body.account, body.password); await numericUid(created.id);
          connection.send(MSGEvent.HWResponseRegister, { result: 1 }); return;
        }
        requireCondition(command === MSGEvent.HWRequestGameLogin, 'UNAUTHORIZED', 'Login required.', 401);
        await login(body); return;
      }
      const actor = await auth.authenticate(connection.token!); requireRole(actor, 'player');
      await refreshCursor();
      switch (command) {
        case MSGEvent.HWRequestDoAction:
        case MSGEvent.HWRequestPiao: {
          requireCondition(metadata?.expectedRoundId !== undefined && metadata.expectedStateVersion !== undefined,
            'ACTION_METADATA_REQUIRED', 'Original actions require request, room, round and state version metadata.', 426);
          const reply = await rooms.originalAction(actor, metadata.roomId, metadata.commandId, command, body, metadata.expectedStateVersion, metadata.expectedRoundId, metadata.decisionId);
          await refreshCursor();
          connection.send(responseCommands.get(command)!, reply.body, reply.decimalFields, undefined, { commandId: metadata.commandId });
          await queueRoom(metadata.roomId); return;
        }
        case MSGEvent.HWRequestJiaoTishi: {
          const huInfo = await rooms.originalJiaoTishi(actor.id);
          connection.send(MSGEvent.HWResponseJiaoTishi, { status: huInfo.length ? 1 : 0, huInfo }); return;
        }
        case MSGEvent.HWRequestAuto:
        case MSGEvent.HWRequestCancelAuto: {
          requireCondition(metadata, 'ACTION_METADATA_REQUIRED', 'Original autoplay commands require request and room metadata.', 426);
          await rooms.setAutoPlay(actor, metadata.roomId, command === MSGEvent.HWRequestAuto, metadata.commandId);
          await refreshCursor();
          connection.send(responseCommands.get(command)!, { result: 1 }, [], undefined, { commandId: metadata.commandId });
          await queueRoom(metadata.roomId); return;
        }
        case MSGEvent.HWRequestRegion:
          connection.send(MSGEvent.HWResponseRegion, { result: 1, shiInfo: [{ shiName: DEFAULT_REGION.shiName, title: DEFAULT_REGION.shiName, xianInfo: [{ xianName: DEFAULT_REGION.xianName, areaType: ids }] }] }); return;
        // 旧客户端还可能发选地区：照样回成功，地区仍是新津，也不再存。
        case MSGEvent.HWRequestRegionChoice:
          connection.region = DEFAULT_REGION;
          connection.send(MSGEvent.HWResponseRegionChoice, { result: 1, areaType: ids }); return;
        case MSGEvent.HWRequestCreateTable: {
          requireCondition(!services.lobbyOnly, 'UNSUPPORTED_OPERATION', '开房已经下线，请在大厅点空位入座。', 403);
          if (services.profileRequired) await services.profiles!.requireComplete(actor.id);
          requireCondition(body.roomType === undefined || body.roomType === 100, 'UNSUPPORTED_OPERATION', 'Only host-created friend rooms are available.');
          const key = resolveVariantKey(body.areaType, body);
          requireCondition(supportsNewRoom(key), 'GAME_REMOVED', messages.GAME_REMOVED!, 409);
          requireCondition(key === '8:0' || createRoom?.qionglai === undefined, 'INVALID_ROOM_OPTIONS', 'Qionglai options belong to Qionglai only.');
          if (key === '8:0') requireCondition(connection.capabilities?.includes(QIONGLAI_OPTION_VERSION) && createRoom?.qionglai,
            'CLIENT_UPGRADE_REQUIRED', messages.CLIENT_UPGRADE_REQUIRED!, 426);
          if (rooms.engines.has(key) && rooms.engines.get(key).interactions?.responseWindow) {
            requireCondition(connection.capabilities?.includes('decision-window-v1'), 'CLIENT_UPGRADE_REQUIRED', messages.CLIENT_UPGRADE_REQUIRED!, 426);
          }
          const spec = getRoomSpec(key, connection.region);
          const playerNum = spec.unresolvedFields.includes('playerNum') ? createRoom?.playerNum : body.playerNum;
          const baseBeans = spec.unresolvedFields.includes('basicTimes') ? createRoom?.baseBeans : undefined;
          requireCondition(!spec.unresolvedFields.includes('playerNum') || playerNum !== undefined, 'RULE_DEFAULT_NOT_VERIFIED', '请选择房间人数。');
          requireCondition(!spec.unresolvedFields.includes('basicTimes') || baseBeans !== undefined, 'RULE_DEFAULT_NOT_VERIFIED', '请输入正数底分。');
          const options: RoomOptions = {};
          for (const field of spec.fields) {
            const addition = key === '8:0' && QIONGLAI_OPTIONS.some(option => option.value === field.key);
            const value = addition ? createRoom?.qionglai?.[field.key as keyof QionglaiWireOptions]
              : field.key === 'playerNum' ? playerNum : body[field.key];
            if (value !== undefined) options[field.key] = field.type === 'boolean' ? value : typeof value === 'boolean' ? Number(value) : value;
          }
          // RoomService performs the authoritative validation.  In particular,
          // unresolved original fields (baseBeans/playerNum) are supplied through
          // the V2 extension and intentionally do not belong to the legacy option map.
          const room = await rooms.create(actor, key, {
            ...options,
            ...(spec.unresolvedFields.includes('playerNum') ? { playerNum } : {}),
            ...(baseBeans ? { baseBeans } : {}),
          }, connection.region, createRoom?.visibility ?? 'private');
          await attachRoom(connection, room.id);
          connection.send(MSGEvent.HWResponseCreateTable, { result: 1, tableInfo: await tableInfo(room), userInfo: [], showType: [], leftCardNum: 0 }); return;
        }
        case MSGEvent.HWRequestEnterTable: {
          requireCondition(Number.isInteger(body.roomId) && /^\d{6}$/.test(String(body.roomId)), 'ROOM_NOT_FOUND', 'Room does not exist.');
          const target = (await db.query("SELECT id FROM rooms WHERE code=$1 AND state <> 'closed'", [String(body.roomId)])).rows[0];
          requireCondition(target, 'ROOM_NOT_FOUND', 'Room does not exist.', 404);
          await queueRoomTask(target.id, async () => {
            const current = (await db.query("SELECT r.rules,EXISTS(SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.user_id=$2) AS member FROM rooms r WHERE r.id=$1 AND r.state <> 'closed'", [target.id, actor.id])).rows[0];
            requireCondition(current, 'ROOM_NOT_FOUND', 'Room does not exist.', 404);
            // 大厅入座先走 /api/lobby/sit 坐上指定座位，这里只让已在桌上的人（含上一场留座的人）进桌。
            requireCondition(!services.lobbyOnly || current.member, 'UNSUPPORTED_OPERATION', '请在大厅点空位入座。', 403);
            if (services.profileRequired && !current.member) await services.profiles!.requireComplete(actor.id);
            const variant = (await db.query('SELECT variant_key,rule_version FROM rooms WHERE id=$1', [target.id])).rows[0]!;
            if (current.rules?.qionglai) requireCondition(connection.capabilities?.includes(QIONGLAI_OPTION_VERSION), 'CLIENT_UPGRADE_REQUIRED', messages.CLIENT_UPGRADE_REQUIRED!, 426);
            if (rooms.engines.has(variant.variant_key) && rooms.engines.get(variant.variant_key, variant.rule_version).interactions?.responseWindow) {
              requireCondition(connection.capabilities?.includes('decision-window-v1'), 'CLIENT_UPGRADE_REQUIRED', messages.CLIENT_UPGRADE_REQUIRED!, 426);
            }
            const room = await rooms.join(actor, String(body.roomId));
            await attachRoom(connection, room.id);
            connection.send(MSGEvent.HWResponseEnterTable, { result: 1, tableInfo: await tableInfo(room) });
          });
          return;
        }
        case MSGEvent.HWRequestEnterTableFinish: await enterFinished(actor, body.roomId); return;
        case MSGEvent.HWRequestReadyForGame: {
          const room = await activeRoom(actor);
          requireCondition(typeof body.state === 'boolean', 'INVALID_REQUEST', 'Ready state is required.');
          if (body.state && rooms.engines.has(room.variantKey)) requireCondition(rooms.engines.get(room.variantKey, room.ruleVersion).original,
            'ORIGINAL_ADAPTER_UNAVAILABLE', 'This rule version has no verified original-client adapter.', 409);
          await rooms.ready(actor, room.id, body.state);
          await refreshCursor();
          connection.send(MSGEvent.HWResponseReadyForGame, { result: 1, state: body.state, showType: [], leftCardNum: 0 }); return;
        }
        case MSGEvent.HWRequestLogoutTable: {
          const room = await activeRoom(actor, body.roomId);
          await attachRoom(connection, room.id);
          await rooms.leave(actor, room.id); await refreshCursor(); connection.send(MSGEvent.HWResponseLogoutTable, { result: 1 });
          await queueRoom(room.id); return;
        }
        case MSGEvent.HWRequestOwnerTiren: {
          requireCondition(Number.isInteger(body.seatIndex), 'INVALID_REQUEST', 'A target seat is required.');
          const seatIndex = body.seatIndex as number;
          const current = await rooms.current(actor.id);
          requireCondition(current, 'KICK_ROOM_NOT_FOUND', messages.KICK_ROOM_NOT_FOUND!, 404);
          // Capture recipients before the kick commits: the change event can
          // detach the removed player's connection while the sync is queued.
          const peers = roomConnections(current.id);
          await rooms.kick(actor, current.id, seatIndex);
          connection.send(MSGEvent.HWResponseOwnerTiren, { result: 1 });
          for (const peer of peers) peer.send(MSGEvent.HWNotifyOwnerTiren, { seatIndex });
          await queueRoom(current.id); return;
        }
        case MSGEvent.HWRequestDissolveTable: {
          const room = await activeRoom(actor, body.roomId);
          requireCondition(typeof body.choice === 'boolean', 'INVALID_REQUEST', 'Dissolve choice is required.');
          await attachRoom(connection, room.id);
          await rooms.dissolve(actor, room.id, body.choice);
          await refreshCursor();
          connection.send(MSGEvent.HWResponseDissolveTable, { result: 1 }); await queueRoom(room.id); return;
        }
        case MSGEvent.HWRequestGetFriends: {
          const rows = await db.query('SELECT a.id,a.nickname,a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus",f.first_room_id,f.source FROM friends f JOIN accounts a ON a.id=f.friend_id WHERE f.user_id=$1 ORDER BY f.last_played_at DESC LIMIT 200', [actor.id]);
          const friends = [];
          for (const friend of rows.rows) friends.push({ uid: await numericUid(friend.id), nick: friend.nickname, picUrl: avatarUrl(friend),
            recordId: friend.first_room_id ? await wireId('room', friend.first_room_id) : 0, online: isUserOnline(friend.id) ? '在线' : '离线中',
            source: friend.source === 'recent' ? '最近同桌' : friend.source === 'search' ? '搜索添加' : '同桌对局', keZhaohui: false, headType: 0, maxGoldLevel: 0 });
          connection.send(MSGEvent.HWResponseGetFriends, { result: 1, friendAll: friends, gradeInfo: [] }); return;
        }
        case MSGEvent.HWRequestHeadInfo: {
          const requested = body.uid && body.uid !== connection.uid ? (await db.query("SELECT a.id,a.nickname,a.avatar_hash AS \"avatarHash\",a.avatar_status AS \"avatarStatus\" FROM original_protocol_ids p JOIN accounts a ON a.id=p.entity_id WHERE p.entity_kind='user' AND p.wire_id=$1 AND EXISTS(SELECT 1 FROM room_members m JOIN room_members mine ON mine.room_id=m.room_id WHERE m.user_id=a.id AND mine.user_id=$2)", [Number(body.uid), actor.id])).rows[0] : (await db.query('SELECT id,nickname,avatar_hash AS "avatarHash",avatar_status AS "avatarStatus" FROM accounts WHERE id=$1', [actor.id])).rows[0];
          requireCondition(requested, 'USER_NOT_FOUND', 'User not found.', 404);
          // 第二轮 S6-AC1：个人资料的对局数、总胜局、胜率走原协议这三个字段，原版界面直接显示。
          const played = await services.stats?.stats(requested.id) ?? { rounds: 0, wins: 0, winRate: '0%' };
          const reply: Record<string, any> = { result: 1, uid: await numericUid(requested.id), nick: requested.nickname, picUrl: avatarUrl(requested), headList: [], headType: 0,
            gameNum: played.rounds, winNum: played.wins, winRate: played.winRate };
          const fields: DecimalField[] = [];
          if (requested.id === actor.id) exactField(reply, 'goldNum', await ledger.balance(actor.id), ['hwResponseHeadInfo'], fields);
          connection.send(MSGEvent.HWResponseHeadInfo, reply, fields); return;
        }
        case MSGEvent.HWRequestChangeSex: {
          // 原版设置页的男女切换：线上 0=男、1=女，库里 1=男、2=女。
          const sex = Number(body.sex) === 1 ? 2 : 1;
          if (services.profiles) await services.profiles.update(actor, { sex });
          else await db.query('UPDATE accounts SET sex=$2 WHERE id=$1', [actor.id, sex]);
          connection.send(MSGEvent.HWResponseChangeSex, { result: 1, sex: wireSex(sex), uid: await numericUid(actor.id) }); return;
        }
        case MSGEvent.HWRequestRecordList: {
          const found = await db.query('SELECT r.* FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE m.user_id=$1 AND r.current_round>0 ORDER BY r.created_at DESC LIMIT 100', [actor.id]);
          const records = []; const fields: DecimalField[] = [];
          for (const room of found.rows) {
            if (body.areaType && Number(room.variant_key.split(':')[0]) !== body.areaType && !(body.areaType === 6 && room.variant_key === '101:0')) continue;
            const members = await db.query(`SELECT m.user_id AS "userId",m.seat,
              COALESCE(t.room_bean_delta,0)::text AS score,w.balance::text AS "beanBalance",a.nickname,a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus",a.sex
              FROM room_members m
              JOIN accounts a ON a.id=m.user_id
              JOIN wallets w ON w.user_id=m.user_id
              LEFT JOIN room_member_settlement_totals t ON t.room_id=m.room_id AND t.user_id=m.user_id
              WHERE m.room_id=$1 ORDER BY m.seat`, [room.id]);
            const users: Record<string, any>[] = [];
            for (let index = 0; index < members.rows.length; index++) users.push(await userInfo(
              members.rows[index]!, ['hwResponseRecordList', 'recordInfo', records.length, 'userInfo', index], fields,
              { score: members.rows[index]!.score ?? '0', changeScore: '0' },
            ));
            records.push({ recordId: await wireId('room', room.id), roomId: Number(room.code), round: room.current_round, date: new Date(room.created_at).toISOString(), userInfo: users });
          }
          connection.send(MSGEvent.HWResponseRecordList, { result: 1, recordInfo: records }, fields); return;
        }
        case MSGEvent.HWRequestRecordDetail: {
          const found = await db.query("SELECT r.* FROM original_protocol_ids p JOIN rooms r ON r.id=p.entity_id JOIN room_members m ON m.room_id=r.id WHERE p.entity_kind='room' AND p.wire_id=$1 AND m.user_id=$2", [body.recordId, actor.id]);
          requireCondition(found.rows[0], 'ROOM_NOT_FOUND', 'Record does not exist.', 404);
          const room = found.rows[0];
          const rounds = (await db.query("SELECT id,number,results FROM rounds WHERE room_id=$1 AND state='settled' ORDER BY number", [room.id])).rows;
          const members = (await db.query('SELECT a.id,a.nickname FROM room_members m JOIN accounts a ON a.id=m.user_id WHERE m.room_id=$1', [room.id])).rows;
          const fields: DecimalField[] = []; const smallScore = [];
          for (const round of rounds) {
            const userScore: Record<string, any>[] = [];
            for (const posting of round.results ?? []) {
              const item: Record<string, any> = { uid: await numericUid(posting.userId), nick: members.find(m => m.id === posting.userId)?.nickname ?? '', cardType: [] };
              exactField(item, 'score', posting.amount, ['hwResponseRecordDetail', 'smallScore', smallScore.length, 'userScore', userScore.length], fields); userScore.push(item);
            }
            smallScore.push({ round: round.number, recordId: await wireId('round', round.id), userScore });
          }
          connection.send(MSGEvent.HWResponseRecordDetail, { result: 1, smallScore, roomId: Number(room.code), date: new Date(room.created_at).toISOString() }, fields); return;
        }
        case MSGEvent.HWRequestPlayBack: {
          requireCondition(Number.isInteger(body.recordId) && body.recordId > 0, 'INVALID_RECORD_ID', 'A round record ID is required.');
          const round = (await db.query("SELECT q.id,q.room_id FROM original_protocol_ids p JOIN rounds q ON q.id=p.entity_id JOIN room_members m ON m.room_id=q.room_id WHERE p.entity_kind='round' AND p.wire_id=$1 AND m.user_id=$2", [body.recordId, actor.id])).rows[0];
          requireCondition(round, 'ROUND_NOT_FOUND', 'Round record does not exist.', 404);
          await replays.originalManifest(actor, round.room_id, round.id);
          connection.send(MSGEvent.HWResponsePlayBack, { result: 1 }, [], undefined, undefined,
            { version: 1, roomId: round.room_id, roundId: round.id, manifestUrl: `/api/records/${round.room_id}/replay/${round.id}/original` }); return;
        }
        case MSGEvent.HWRequestIsOnline: {
          requireCondition(typeof body.online === 'boolean', 'INVALID_REQUEST', 'Online state is required.');
          const before = isUserOnline(actor.id); connection.foreground = body.online;
          connection.send(MSGEvent.HWResponseIsOnline, { result: 1, online: body.online });
          if (before !== isUserOnline(actor.id)) await publishPresence(actor.id); return;
        }
        case MSGEvent.HWRequestChat: {
          const room = await activeRoom(actor);
          let content: Parameters<RoomService['chat']>[2];
          let message: Record<string, unknown>;
          // The original UI's CHARACTER command carries a preset index, not free text.
          if (body.ctype === 1 || body.ctype === 5) {
            const id = body.ctype === 1 ? body.mutualFaceId : body.quickVoiceId;
            requireCondition(Number.isInteger(id), 'INVALID_CHAT', 'A quick voice identifier is required.');
            content = { quickVoiceId: id };
            message = { ctype: 1, mutualFaceId: id };
          } else if (body.ctype === 2) {
            const match = typeof body.message === 'string' ? /^res_dss_chat_([0-9]|1[0-4])$/.exec(body.message) : undefined;
            const id = match ? Number(match[1]) : body.message === undefined ? body.faceId : undefined;
            requireCondition(Number.isInteger(id), 'INVALID_CHAT', 'An original expression is required.');
            content = { faceId: id };
            message = { ctype: 2, message: `res_dss_chat_${id}` };
          } else if (body.ctype === 3) {
            requireCondition(Number.isInteger(body.mutualFaceId) && Number.isInteger(body.mutualFaceToUid), 'INVALID_CHAT', 'An interaction and target seat are required.');
            requireCondition(!isExtraEmote(body.mutualFaceId) || connection.capabilities?.includes(EXTRA_EMOTES_VERSION), 'INVALID_CHAT', 'This client does not support the new interactions.');
            content = { mutualFaceId: body.mutualFaceId, targetSeat: body.mutualFaceToUid };
            message = { ctype: 3, mutualFaceId: body.mutualFaceId, mutualFaceToUid: body.mutualFaceToUid };
          } else throw new AppError('UNSUPPORTED_OPERATION', 'Only original quick phrases, expressions and interactions are enabled.', 403);
          await rooms.chat(actor, room.id, content);
          message.uid = connection.uid;
          connection.send(MSGEvent.HWResponseChat, { result: 1 });
          // S7-AC3：旧客户端不认识 13–20，收不到这类互动表情。
          const extra = message.ctype === 3 && isExtraEmote(message.mutualFaceId);
          for (const member of room.members) for (const peer of online.get(member.userId) ?? []) {
            if (!extra || peer.capabilities?.includes(EXTRA_EMOTES_VERSION)) peer.send(MSGEvent.HWNotifyChat, message);
          }
          return;
        }
        case MSGEvent.HWRequestNotice: connection.send(MSGEvent.HWResponseNotice, { result: 1, noticeInfos: [] }); return;
        case MSGEvent.HWRequestShowList: connection.send(MSGEvent.HWResponseShowList, { result: 1, showInfo: [] }); return;
        case MSGEvent.HWRequestUrlInfo: connection.send(MSGEvent.HWResponseUrlInfo, { result: 1, urlInfo: [] }); return;
        case MSGEvent.HWRequestGoldList: connection.send(MSGEvent.HWResponseGoldList, { result: 1, goldRoomInfo: [] }); return;
        case MSGEvent.HWRequestItemList: connection.send(MSGEvent.HWResponseItemList, { result: 1, items: [], records: [] }); return;
        default: throw new AppError('UNSUPPORTED_OPERATION', messages.UNSUPPORTED_OPERATION!, 403);
      }
    }

    socket.on('message', (raw: RawData, isBinary: boolean) => {
      if (connection.closed) return;
      if (Date.now() - since >= 1000) { since = Date.now(); burst = 0; }
      if (!isBinary || ++burst > 20 || ++pending > 30) { socket.close(1008, 'Invalid message or rate limit'); return; }
      const bytes = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
      queue = queue.then(async () => {
        if (connection.closed) return;
        let command: number | undefined; let ack: OriginalExtension['ack'];
        try {
          const frame = decodeFrame(bytes); command = frame.cmd;
          const raw = readOriginalExtension(bytes) as { request?: { commandId?: unknown } } | undefined;
          const requestId = commandIdSchema.safeParse(raw?.request?.commandId);
          if (requestId.success) ack = { commandId: requestId.data };
          let metadata: OriginalExtension['request']; let createRoom: OriginalExtension['createRoom'];
          if (raw !== undefined) {
            const parsed = requestExtensionSchema.safeParse(raw);
            requireCondition(parsed.success, 'INVALID_EXTENSION', 'Client extensions may contain only request metadata and no decimal overrides.');
            metadata = parsed.data.request;
            createRoom = parsed.data.createRoom;
            if (frame.cmd === MSGEvent.HWRequestGameLogin) connection.capabilities = parsed.data.capabilities ?? [];
          }
          requireCondition(!protectedCommands.has(frame.cmd) || metadata, 'ACTION_METADATA_REQUIRED', 'This command requires versioned request metadata.', 426);
          assertCommandBody(frame);
          // Never use head.uid as identity. Authentication is established only by
          // credentials/token and refreshed for every authorized command.
          await dispatch(frame.cmd, frame.data[expectedBodyField(frame.cmd)!] as Record<string, any>, frame.head.protoVersion ?? 0, metadata, createRoom);
        } catch (error) { await failure(command, error, ack); }
      }).catch(error => { app.log.error(error); socket.close(1011, 'Request failed'); }).finally(() => { pending--; });
    });
  });
}
