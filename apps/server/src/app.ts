import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import type { WebSocket } from 'ws';
import type { Database } from './database.js';
import { AuthService, requireRole, type Actor } from './auth.js';
import { LedgerService } from './ledger.js';
import { PolicyService } from './policies.js';
import { RoomService } from './rooms.js';
import { RoomScheduler } from './room-scheduler.js';
import { EngineRegistry } from './engines.js';
import { createConfiguredEngineRegistry } from './runtime-engines.js';
import { ReplayService } from './replays.js';
import { AppError, requireCondition } from './errors.js';
import { registerOriginalProtocol } from './original-wire.js';
import { ProfileService } from './profile.js';
import { LobbyService } from './lobby.js';
import { AVATAR_CONTENT_TYPES, AVATAR_ROUTE, DEFAULT_AVATAR_URL, MAX_AVATAR_UPLOAD, avatarUrl, parseAvatarFile } from './avatars.js';

const credentials = z.object({ username: z.string().min(4).max(32), password: z.string().min(8).max(128) }).strict();
const idSchema = z.string().uuid();
const pageSchema = z.object({ query: z.string().max(80).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), userId: z.string().uuid().optional() });
const requestIdSchema = z.string().regex(/^[\w-]{8,100}$/);
const PAGE_SIZE = 30;

/**
 * Publish the acceptance run ID and isolation marker only when the caller explicitly opts in and the
 * database is the throwaway local PGlite instance. A PostgreSQL-backed deployment never advertises
 * isolation, so acceptance tooling cannot mistake production for a disposable database.
 */
function healthIsolation(db: Database, options: { acceptanceRunId?: string; isolatedDatabase?: boolean }) {
  const isolatedDatabase = options.isolatedDatabase ?? process.env.ACCEPTANCE_ISOLATED_DATABASE === 'true';
  const requested = options.acceptanceRunId ?? process.env.ACCEPTANCE_RUN_ID ?? process.env.ACCEPTANCE_FRESH_RUN_ID;
  const runId = typeof requested === 'string' ? requested.trim() : '';
  if (isolatedDatabase !== true || db.kind !== 'pglite' || runId === '') return {};
  return { isolatedDatabase: true, acceptanceRunId: runId };
}

export async function createApp(db: Database, options: {
  logger?: boolean; engines?: EngineRegistry; staticFiles?: boolean; roomClock?: () => number;
  scheduler?: false | { intervalMs?: number; batchSize?: number; concurrency?: number };
  /** Isolated acceptance may disable the global API limiter; production keeps the default. */
  rateLimit?: boolean;
  /** Ephemeral acceptance run ID published by /health only when this server owns an isolated database. */
  acceptanceRunId?: string;
  /** Explicit isolation marker; never published for a non-PGlite database. */
  isolatedDatabase?: boolean;
  /** 资料没设好的人不能开房进房（R6）。正式入口 main.ts 打开；原有测试夹具不设资料，默认关。 */
  profileRequired?: boolean;
  /** 正式入口第一次启动时放入默认大厅桌模板（R2）。 */
  seedLobby?: boolean;
} = {}) {
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: { err: (error: Error & { code?: string }) => ({ type: error.name, code: error.code, stack: '',
      message: error instanceof AppError ? error.message : 'Operation failed' }) } } : false, bodyLimit: 64 * 1024, trustProxy: false });
  const auth = new AuthService(db);
  const ledger = new LedgerService(db);
  const policies = new PolicyService(db);
  const rooms = new RoomService(db, options.engines ?? createConfiguredEngineRegistry(), policies, options.roomClock);
  const replays = new ReplayService(db, rooms.engines);
  const profiles = new ProfileService(db);
  const requireProfile = async (userId: string) => { if (options.profileRequired) await profiles.requireComplete(userId); };
  const scheduler = options.scheduler === false ? null : new RoomScheduler(rooms, {
    ...options.scheduler, onError: (error, roomId) => app.log.error({ err: error, roomId }, 'Room scheduler operation failed'),
  });
  const lobby = new LobbyService(db, rooms, { profiles, profileRequired: options.profileRequired === true,
    onError: error => app.log.error({ err: error }, 'Lobby maintenance failed') });
  if (options.seedLobby) await lobby.seedDefaults();
  app.addHook('onReady', async () => { scheduler?.start(); if (scheduler) lobby.start(); });
  const live = new Map<string, Set<WebSocket>>();
  const isOnline = (userId: string) => Boolean(live.get(userId)?.size);
  const markOnline = (userId: string, socket: WebSocket) => {
    const connections = live.get(userId) ?? new Set<WebSocket>();
    requireCondition(connections.size < 5, 'TOO_MANY_CONNECTIONS', 'Too many sessions for this account.', 429);
    connections.add(socket); live.set(userId, connections);
    socket.once('close', () => { connections.delete(socket); if (!connections.size) live.delete(userId); });
  };
  await app.register(cors, { origin: process.env.ADMIN_ORIGIN ? process.env.ADMIN_ORIGIN.split(',') : false });
  if (options.rateLimit !== false) {
    await app.register(rateLimit, { max: 300, timeWindow: '1 minute', allowList: request => !request.url.startsWith('/api/') });
  }
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  app.addContentTypeParser(AVATAR_CONTENT_TYPES, { parseAs: 'buffer', bodyLimit: MAX_AVATAR_UPLOAD }, (_request, body, done) => done(null, body));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') } });
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    if (error instanceof Error && error.name === 'RuleValidationError') return reply.code(400).send({ error: { code: 'INVALID_ROOM_OPTIONS', message: error.message } });
    if ((error as { code?: string }).code === '22P02') return reply.code(400).send({ error: { code: 'INVALID_ID', message: 'Invalid identifier.' } });
    const reportedStatus = (error as { statusCode?: number }).statusCode;
    const status = reportedStatus && reportedStatus >= 400 && reportedStatus < 500 ? reportedStatus : 500;
    if (status === 413) return reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: '上传的内容太大了，图片请换一张 5MB 以内的。' } });
    if (status === 415) return reply.code(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '只支持 JPG、PNG、WebP 图片。' } });
    app.log.error(error);
    return reply.code(status).send({ error: { code: status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR', message: status === 429 ? 'Too many requests. Try again later.' : 'Request failed.' } });
  });

  async function actor(request: { headers: { authorization?: string } }, role?: Actor['role']) {
    const user = await auth.authenticate(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
    if (role) requireRole(user, role);
    return user;
  }

  const isolation = healthIsolation(db, options);
  app.get('/health', async () => { await db.query('SELECT 1'); return { status: 'ok', database: db.kind, releaseReady: false, protocolVersion: 2, ruleEnginesVerified: rooms.games().filter(g => g.playable).length, ...isolation }; });
  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => {
    const input = credentials.extend({ nickname: z.string().min(1).max(32).optional() }).parse(request.body);
    const user = await auth.create(input.username, input.password, 'player', input.nickname);
    return { user, beanBalance: '0', balance: '0' };
  });
  for (const path of ['/api/auth/login', '/api/admin/login']) app.post(path, { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async request => {
    const input = credentials.parse(request.body);
    return auth.login(input.username, input.password, path.includes('/admin/'));
  });
  for (const path of ['/api/auth/logout', '/api/admin/logout']) app.post(path, async request => {
    const user = await actor(request);
    await auth.logout(request.headers.authorization!.replace(/^Bearer /, ''));
    for (const socket of live.get(user.id) ?? []) socket.close(1000, 'Logged out');
    return { ok: true };
  });
  app.get('/api/admin/me', async request => { const user = await actor(request); requireCondition(user.role !== 'player', 'FORBIDDEN', 'Administrator account required.', 403); return { user }; });
  app.get('/api/me', async request => {
    const user = await actor(request, 'player');
    const beanBalance = await ledger.balance(user.id);
    return { user, beanBalance, balance: beanBalance, room: await rooms.current(user.id) };
  });
  app.get('/api/me/profile', async request => profiles.get((await actor(request, 'player')).id));
  app.put('/api/me/profile', async request => {
    const user = await actor(request, 'player');
    return profiles.update(user, z.object({ nickname: z.string().max(40).optional(), sex: z.number().int().optional() }).strict().parse(request.body));
  });
  app.post('/api/me/avatar', { bodyLimit: MAX_AVATAR_UPLOAD, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async request => {
    const user = await actor(request, 'player');
    requireCondition(Buffer.isBuffer(request.body), 'AVATAR_NOT_IMAGE', '只支持 JPG、PNG、WebP 图片。', 415);
    return profiles.setAvatar(user, request.body);
  });
  app.get(`${AVATAR_ROUTE}:file`, async (request, reply) => {
    const parsed = parseAvatarFile((request.params as { file: string }).file);
    const bytes = parsed ? await profiles.avatarBytes(parsed.accountId, parsed.hash) : null;
    // 驳回或不存在：回默认头像，不缓存，客户端下次拿到的就是新地址。
    if (!bytes) return reply.header('cache-control', 'no-store').redirect(DEFAULT_AVATAR_URL);
    return reply.type('image/jpeg').header('cache-control', 'public, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').send(bytes);
  });

  app.get('/api/admin/stats', async request => {
    const user = await actor(request); requireCondition(user.role !== 'player', 'FORBIDDEN', 'Administrator account required.', 403);
    const stats = (await db.query("SELECT (SELECT COUNT(*)::int FROM accounts WHERE role='player') AS users, (SELECT COUNT(*)::int FROM rooms WHERE state <> 'closed') AS rooms")).rows[0]!;
    if (user.role === 'beans_admin') return { ...stats, online: live.size, ledgerEntries: (await db.query('SELECT COUNT(*)::int AS count FROM ledger_entries')).rows[0]!.count, policyEnabled: 0 };
    const selected = (await db.query("SELECT COUNT(*) FILTER (WHERE kind='deal_selected' AND details->>'selectedUserId' IS NOT NULL)::int AS selected,COUNT(*) FILTER (WHERE kind='deal_selected' AND details->>'triggered'='true')::int AS triggered FROM audit_events")).rows[0]!;
    return { ...stats, online: live.size, ledgerEntries: 0, policyEnabled: (await db.query('SELECT COUNT(*)::int AS count FROM deal_policies WHERE enabled=true')).rows[0]!.count, policySelected: selected.selected, policyTriggered: selected.triggered };
  });

  app.get('/api/admin/users', async request => {
    await actor(request, 'beans_admin');
    const { query, page } = pageSchema.parse(request.query);
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await db.query("SELECT a.id,a.username,a.nickname,a.avatar_hash AS \"avatarHash\",a.avatar_status AS \"avatarStatus\",a.nickname_rejected AS \"nicknameRejected\",w.balance::text AS \"beanBalance\" FROM accounts a JOIN wallets w ON w.user_id=a.id WHERE a.role='player' AND (a.username ILIKE $1 OR a.nickname ILIKE $1 OR a.id::text=$2) ORDER BY a.created_at DESC,a.id LIMIT $3 OFFSET $4", [pattern, query, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const total = (await db.query("SELECT COUNT(*)::int AS count FROM accounts a WHERE a.role='player' AND (a.username ILIKE $1 OR a.nickname ILIKE $1 OR a.id::text=$2)", [pattern, query])).rows[0]!.count;
    return { users: rows.rows.map(u => ({ ...u, avatarUrl: avatarUrl(u), balance: u.beanBalance, online: isOnline(u.id) })), total, page, pageSize: PAGE_SIZE };
  });
  // 头像昵称审核（R9）：两种管理员都能驳回，留审计记录。
  const requireAdmin = async (request: { headers: { authorization?: string } }) => {
    const user = await actor(request);
    requireCondition(user.role === 'beans_admin' || user.role === 'deal_admin', 'FORBIDDEN', 'Administrator account required.', 403);
    return user;
  };
  app.get('/api/admin/avatars', async request => {
    await requireAdmin(request);
    const { page } = pageSchema.parse(request.query);
    return { ...(await profiles.recentAvatars(page, PAGE_SIZE)), page, pageSize: PAGE_SIZE };
  });
  const rejection = z.object({ reason: z.string().trim().min(1).max(200) }).strict();
  app.post('/api/admin/users/:id/avatar-rejection', async request => {
    const admin = await requireAdmin(request);
    await profiles.rejectAvatar(admin, idSchema.parse((request.params as any).id), rejection.parse(request.body).reason);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/nickname-rejection', async request => {
    const admin = await requireAdmin(request);
    await profiles.rejectNickname(admin, idSchema.parse((request.params as any).id), rejection.parse(request.body).reason);
    return { ok: true };
  });
  app.get('/api/admin/users/:id/ledger', async request => {
    await actor(request, 'beans_admin');
    const id = idSchema.parse((request.params as any).id);
    const { page } = pageSchema.parse(request.query);
    const rows = await db.query('SELECT e.id,o.kind AS type,e.amount::text,e.balance_before::text AS "balanceBefore",e.balance_after::text AS "balanceAfter",o.reason,e.created_at AS "createdAt",a.username AS "actorName",o.room_id AS "roomId",o.round_id AS "roundId",o.id AS "correlationId",o.reference_entry_id AS "referenceEntryId" FROM ledger_entries e JOIN ledger_operations o ON o.id=e.operation_id LEFT JOIN accounts a ON a.id=o.actor_id WHERE e.user_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT $2 OFFSET $3', [id, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const total = (await db.query('SELECT COUNT(*)::int AS count FROM ledger_entries WHERE user_id=$1', [id])).rows[0]!.count;
    const beanBalance = await ledger.balance(id);
    return { entries: rows.rows, beanBalance, balance: beanBalance, total, page, pageSize: PAGE_SIZE };
  });
  app.post('/api/admin/users/:id/adjustments', async request => {
    const user = await actor(request, 'beans_admin');
    const id = idSchema.parse((request.params as any).id);
    const input = z.object({ amount: z.string().max(100), reason: z.string().min(1).max(500), requestId: requestIdSchema, referenceEntryId: idSchema.optional() }).strict().parse(request.body);
    return ledger.adjust(user, id, input.amount, input.reason, input.requestId, input.referenceEntryId);
  });
  app.get('/api/admin/deal-policies', async request => {
    await actor(request, 'deal_admin');
    const { query, page } = pageSchema.parse(request.query);
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await db.query("SELECT a.id AS \"userId\",a.username,a.nickname,COALESCE(p.enabled,false) AS enabled,COALESCE(p.probability,0)::text AS probability,COALESCE(p.version,0) AS version,p.updated_at AS \"updatedAt\" FROM accounts a LEFT JOIN deal_policies p ON p.user_id=a.id WHERE a.role='player' AND (a.username ILIKE $1 OR a.nickname ILIKE $1 OR a.id::text=$2) ORDER BY a.created_at DESC,a.id LIMIT $3 OFFSET $4", [pattern, query, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const total = (await db.query("SELECT COUNT(*)::int AS count FROM accounts a WHERE a.role='player' AND (a.username ILIKE $1 OR a.nickname ILIKE $1 OR a.id::text=$2)", [pattern, query])).rows[0]!.count;
    return { policies: rows.rows.map(row => ({ ...row, probability: Number(row.probability) })), total, page, pageSize: PAGE_SIZE };
  });
  app.put('/api/admin/deal-policies/:id', async request => {
    const user = await actor(request, 'deal_admin');
    const id = idSchema.parse((request.params as any).id);
    const input = z.object({ enabled: z.boolean(), probability: z.union([z.string().max(6), z.number().finite()]), reason: z.string().min(1).max(500), requestId: requestIdSchema, expectedVersion: z.number().int().min(0) }).strict().parse(request.body);
    return policies.update(user, id, input.enabled, String(input.probability), input.reason, input.requestId, input.expectedVersion);
  });
  app.get('/api/admin/deal-audit', async request => {
    await actor(request, 'deal_admin');
    const { page, userId } = pageSchema.parse(request.query);
    const rows = await db.query("SELECT e.id,e.kind,e.user_id AS \"userId\",e.details,e.created_at AS \"createdAt\",a.username AS \"actorName\" FROM audit_events e LEFT JOIN accounts a ON a.id=e.actor_id WHERE e.kind IN ('policy_changed','deal_selected','deal_evaluated') AND ($1::uuid IS NULL OR e.user_id=$1) ORDER BY e.created_at DESC,e.id DESC LIMIT $2 OFFSET $3", [userId ?? null, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const total = (await db.query("SELECT COUNT(*)::int AS count FROM audit_events WHERE kind IN ('policy_changed','deal_selected','deal_evaluated') AND ($1::uuid IS NULL OR user_id=$1)", [userId ?? null])).rows[0]!.count;
    return { entries: rows.rows, total, page, pageSize: PAGE_SIZE };
  });

  // 大厅（R1、R4、R10）：轮询按登录令牌限流，同一出口 IP 下的多个玩家互不影响。
  const perToken = { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: (request: { headers: { authorization?: string }; ip: string }) => request.headers.authorization ?? request.ip } };
  app.get('/api/lobby/tables', { config: perToken }, async request => {
    const user = await actor(request, 'player');
    const query = z.object({ variant: z.string().max(20).optional(), since: z.string().max(40).optional() }).strict().parse(request.query);
    return lobby.tables(user.id, query.variant || undefined, query.since);
  });
  app.post('/api/lobby/quick-start', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async request => {
    const user = await actor(request, 'player');
    const { variant } = z.object({ variant: z.string().max(20).optional() }).strict().parse(request.body ?? {});
    return lobby.quickStart(user, variant || undefined);
  });
  // 位置只放请求体，不进网址；服务端只存内存（R10）。
  app.post('/api/me/location', { config: perToken }, async request => {
    const user = await actor(request, 'player');
    const input = z.object({ lat: z.number(), lon: z.number() }).strict().parse(request.body);
    lobby.setLocation(user.id, input.lat, input.lon);
    return { ok: true };
  });
  const templateSchema = z.object({ variantKey: z.string().max(20), options: z.record(z.unknown()), standingEmpty: z.number(), thresholdMultiplier: z.number(),
    idleClearMinutes: z.number(), enabled: z.boolean(), sortOrder: z.number() }).strict();
  app.get('/api/admin/lobby-templates', async request => { await actor(request, 'beans_admin'); return lobby.listTemplates(); });
  app.post('/api/admin/lobby-templates', async request => lobby.createTemplate(await actor(request, 'beans_admin'), templateSchema.parse(request.body)));
  app.put('/api/admin/lobby-templates/:id', async request => {
    const admin = await actor(request, 'beans_admin');
    return lobby.updateTemplate(admin, idSchema.parse((request.params as any).id), templateSchema.parse(request.body));
  });

  app.get('/api/games', async request => { await actor(request, 'player'); return { games: rooms.games() }; });
  app.post('/api/rooms', async request => {
    const user = await actor(request, 'player');
    const input = z.object({ variantKey: z.string().max(20), options: z.record(z.unknown()).default({}),
      baseBeans: z.string().regex(/^(?:0|[1-9]\d{0,79})(?:\.\d{1,12})?$/).optional(),
      playerNum: z.number().int().min(2).max(4).optional(),
      region: z.object({ shiName: z.string().max(30).optional(), xianName: z.string().max(30).optional() }).optional() }).strict().parse(request.body);
    requireCondition(input.playerNum === undefined || input.options.playerNum === undefined, 'INVALID_ROOM_OPTIONS', 'Player count may be supplied only once.', 400);
    requireCondition(input.baseBeans === undefined || input.options.baseBeans === undefined, 'INVALID_ROOM_OPTIONS', 'Base beans may be supplied only once.', 400);
    await requireProfile(user.id);
    return rooms.create(user, input.variantKey, { ...input.options,
      ...(input.baseBeans === undefined ? {} : { baseBeans: input.baseBeans }),
      ...(input.playerNum === undefined ? {} : { playerNum: input.playerNum }) }, input.region);
  });
  app.post('/api/rooms/join', async request => { const user = await actor(request, 'player'); const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(request.body); await requireProfile(user.id); return rooms.join(user, code); });
  app.get('/api/rooms/:id', async request => { const user = await actor(request, 'player'); return rooms.view(idSchema.parse((request.params as any).id), user.id); });
  app.post('/api/rooms/:id/ready', async request => { const user = await actor(request, 'player'); const { ready } = z.object({ ready: z.boolean() }).strict().parse(request.body); return rooms.ready(user, idSchema.parse((request.params as any).id), ready); });
  app.post('/api/rooms/:id/actions', async request => { const user = await actor(request, 'player'); const input = z.object({ commandId: requestIdSchema, action: z.unknown(), expectedStateVersion: z.number().int().min(0).max(2147483646).optional(), expectedRoundId: idSchema.optional(), decisionId: z.string().regex(/^[\w:-]{1,100}$/).optional() }).strict().parse(request.body); return rooms.action(user, idSchema.parse((request.params as any).id), input.commandId, input.action, input.expectedStateVersion, input.expectedRoundId, undefined, input.decisionId); });
  app.post('/api/rooms/:id/autoplay', async request => { const user = await actor(request, 'player'); const input = z.object({ enabled: z.boolean(), commandId: requestIdSchema }).strict().parse(request.body); return rooms.setAutoPlay(user, idSchema.parse((request.params as any).id), input.enabled, input.commandId); });
  app.post('/api/rooms/:id/leave', async request => { const user = await actor(request, 'player'); return rooms.leave(user, idSchema.parse((request.params as any).id)); });
  app.post('/api/rooms/:id/dissolve', async request => { const user = await actor(request, 'player'); const { agree } = z.object({ agree: z.boolean() }).strict().parse(request.body); return rooms.dissolve(user, idSchema.parse((request.params as any).id), agree); });
  app.post('/api/rooms/:id/chat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async request => { const user = await actor(request, 'player'); const content = z.object({ message: z.string().min(1).max(120).optional(), faceId: z.number().int().min(0).max(100).optional(), quickVoiceId: z.number().int().min(0).max(100).optional() }).strict().parse(request.body); return rooms.chat(user, idSchema.parse((request.params as any).id), content); });
  app.get('/api/friends', async request => {
    const user = await actor(request, 'player');
    const rows = await db.query('SELECT a.id,a.username,a.nickname,a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus",f.last_played_at AS "lastPlayedAt" FROM friends f JOIN accounts a ON a.id=f.friend_id WHERE f.user_id=$1 ORDER BY f.last_played_at DESC,a.id LIMIT 200', [user.id]);
    return { friends: rows.rows.map(({ avatarHash, avatarStatus, ...row }) => ({ ...row, avatarUrl: avatarUrl({ id: row.id, avatarHash, avatarStatus }), online: isOnline(row.id) })) };
  });
  app.get('/api/records', async request => {
    const user = await actor(request, 'player');
    const { page } = pageSchema.parse(request.query);
    const rows = await db.query(`SELECT r.id,r.code,r.variant_key AS "variantKey",r.rules,r.rule_version AS "ruleVersion",r.state,
      r.current_round AS "currentRound",r.created_at AS "createdAt",w.balance::text AS "beanBalance",COALESCE(t.room_bean_delta,0)::text AS "roomBeanDelta"
      FROM rooms r
      JOIN room_members m ON m.room_id=r.id
      JOIN wallets w ON w.user_id=m.user_id
      LEFT JOIN room_member_settlement_totals t ON t.room_id=m.room_id AND t.user_id=m.user_id
      WHERE m.user_id=$1 AND r.current_round>0 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`, [user.id, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    return { records: rows.rows.map(record => ({ ...record, score: record.roomBeanDelta })), page, pageSize: PAGE_SIZE };
  });
  app.get('/api/records/:id', async request => {
    const user = await actor(request, 'player');
    const roomId = idSchema.parse((request.params as any).id);
    await rooms.view(roomId, user.id);
    const results = await db.query("SELECT id,number,results,settled_at AS \"settledAt\" FROM rounds WHERE room_id=$1 AND state='settled' ORDER BY number", [roomId]);
    return { rounds: results.rows.map(round => ({ ...round, roundBeanDelta: round.results ?? [] })) };
  });
  app.get('/api/records/:id/replay/:roundId', async request => {
    const user = await actor(request, 'player');
    const params = z.object({ id: idSchema, roundId: idSchema }).parse(request.params);
    return replays.read(user, params.id, params.roundId);
  });
  app.get('/api/records/:id/replay/:roundId/original', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = await actor(request, 'player');
    const params = z.object({ id: idSchema, roundId: idSchema }).parse(request.params);
    reply.header('Cache-Control', 'private, no-store');
    return replays.originalManifest(user, params.id, params.roundId);
  });
  app.get('/api/records/:id/replay/:roundId/original/frames', async (request, reply) => {
    const user = await actor(request, 'player');
    const params = z.object({ id: idSchema, roundId: idSchema }).parse(request.params);
    const query = z.object({ offset: z.coerce.number().int().min(0).max(10001), limit: z.coerce.number().int().min(1).max(50).default(50), digest: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(request.query);
    reply.header('Cache-Control', 'private, no-store');
    return replays.originalPage(user, params.id, params.roundId, query.offset, query.limit, query.digest);
  });

  app.get('/api/live', { websocket: true }, (socket) => {
    let user: Actor | undefined;
    let queue = Promise.resolve();
    let count = 0; let since = Date.now();
    const timeout = setTimeout(() => socket.close(1008, 'Authentication required'), 10000);
    socket.on('close', () => clearTimeout(timeout));
    socket.on('message', data => {
      queue = queue.then(async () => {
        if (Date.now() - since > 1000) { since = Date.now(); count = 0; }
        requireCondition(++count <= 15, 'RATE_LIMITED', 'Too many messages.', 429);
        const message = JSON.parse(data.toString());
        if (!user) {
          const input = z.object({ type: z.literal('authenticate'), token: z.string().max(128) }).strict().parse(message);
          user = await auth.authenticate(input.token); requireRole(user, 'player'); markOnline(user.id, socket); clearTimeout(timeout);
          socket.send(JSON.stringify({ type: 'authenticated', userId: user.id, protocolVersion: 2, room: await rooms.current(user.id) }));
        } else {
          z.object({ type: z.literal('ping') }).strict().parse(message);
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      }).catch(error => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'error', code: error instanceof AppError ? error.code : 'INVALID_MESSAGE' })); socket.close(1008, 'Message rejected'); });
    });
  });
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, replays, markOnline, profiles, profileRequired: options.profileRequired === true });
  if (options.staticFiles !== false) {
    const adminDist = fileURLToPath(new URL('../../admin/dist/', import.meta.url));
    if (existsSync(adminDist)) await app.register(fastifyStatic, { root: adminDist, prefix: '/admin/', decorateReply: false });
    const clientRoot = fileURLToPath(new URL('../../../client/public/', import.meta.url));
    if (existsSync(clientRoot)) await app.register(fastifyStatic, { root: clientRoot, prefix: '/client/', decorateReply: false });
    app.get('/', async (_request, reply) => reply.redirect('/admin/'));
  }
  app.addHook('onClose', async () => {
    await scheduler?.stop(); await lobby.stop();
    for (const sockets of live.values()) for (const socket of sockets) socket.close(1001, 'Server restarting');
  });
  return { app, auth, ledger, policies, rooms, replays, profiles, lobby, live, scheduler };
}
