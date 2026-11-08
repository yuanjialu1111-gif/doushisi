import { randomInt, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { catalogue, isVisibleVariant, supportsNewRoom, freezeQionglaiOptions, freezeYaanOptions, freezeXinjinOptions, XINJIN_V2_OPTIONS, XINJIN_V2_CHOICES, freezeAnyueOptions, freezePujiangOptions, freezeAbaOptions, freezeScoreRegionOptions, freezeIndependentApproval, getVariant, validateRoomOptions, getDefaultOptions, getRoomSpec, baseScoreDecimal } from '@dss/rules';
import { encodeFrame, expectedBodyField, MSGEvent } from '@dss/protocol';
import type { Database, Sql } from './database.js';
import { requireRole, type Actor } from './auth.js';
import { requireCondition } from './errors.js';
import { EngineRegistry, projectOriginalNotifications, type ConfirmedScoreBatch, type OriginalActionContext, type EngineOriginalBody, type RuleEngine, type TestDeal } from './engines.js';
import { applyConfirmedScores, capLosses, normalizeScores, totalConfirmedScores } from './confirmed-scores.js';
import { appendOperation, balanceChanges, requestHash, type BalanceChange, type Posting } from './ledger.js';
import { Decimal, amount, beanUnits, money, unitsMoney } from './money.js';
import { isXinjinV2 } from './game/xinjin-win.js';
import { PolicyService } from './policies.js';
import { TRANSFER_ROUNDING_VERSION } from './transfers.js';
import { engineLegalActions, finishInteractions, nextScheduledAt, planInteractions, requireLegalAction, validateObservedDecision, type InteractionState, type ScheduledEngineAction } from './engine-interactions.js';
import { validateNextRoundContext } from './round-context.js';
import { avatarUrl } from './avatars.js';

/** 系统桌房主（迁移 010 建的内置账号，不能登录，不入座）。 */
export const SYSTEM_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
/** 玩家公开桌没有模板，入座门槛按默认 10 倍底分（R5 AC2）。 */
export const DEFAULT_THRESHOLD_MULTIPLIER = 10;
/** 一场打完留座：弹窗倒计时 15 秒，另加胡牌动画和小结算停的 2 秒（第三轮 R5「15 秒不选算离开」）。 */
export const MATCH_HOLD_MS = 17_000;

export interface DissolveState {
  initiatorId: string;
  expiresAt: number;
  votes: { userId: string; agree: boolean; seat: number }[];
}

/** 模板或开房带来的翻法、封顶：没带用默认（跟斗翻、不封顶），带了不在可选里就报错。 */
export function xinjinChoicePicks(options: Record<string, unknown>) {
  const picks: Record<string, number> = {};
  for (const [key, values] of Object.entries(XINJIN_V2_CHOICES)) {
    if (options[key] === undefined) continue;
    requireCondition(values.some(item => item.value === options[key]), 'INVALID_ROOM_OPTIONS',
      key === 'chengFan' ? '翻法只能选跟斗翻或梯坎翻。' : '封顶只能选不封顶、3 番、4 番或 5 番。', 400);
    picks[key] = options[key] as number;
  }
  return picks;
}

export class RoomService extends EventEmitter {
  constructor(private db: Database, public engines: EngineRegistry, private policies: PolicyService, private now: () => number = Date.now) { super(); }
  /** 能新开的玩法：只有四川斗十四（DEC-20261101-四川斗十四）。其他地区的代码留着不启用，只有测试打开它们跑。 */
  opensVariant: (variantKey: string) => boolean = isVisibleVariant;
  /** 仅本机测试台：房间 id → 下一局要发的牌，开局时用掉。设置入口只在 DSS_TEST_DEALS=1 的本机服务里开（app.ts）。 */
  readonly testDeals = new Map<string, TestDeal>();

  async setTestDeal(actor: Actor, roomId: string, deal: Omit<TestDeal, 'dealerUserId'>) {
    requireRole(actor, 'player');
    const room = (await this.db.query('SELECT variant_key,state,rules FROM rooms WHERE id=$1', [roomId])).rows[0];
    requireCondition(room, 'ROOM_NOT_FOUND', 'Room does not exist.', 404);
    const member = await this.db.query('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, actor.id]);
    requireCondition(member.rows[0], 'NOT_ROOM_MEMBER', 'You are not in this room.', 403);
    requireCondition(room.variant_key === '4:0' && isXinjinV2(room.rules ?? {}), 'UNSUPPORTED_OPERATION', '指定牌局只支持新津 v2 桌。', 409);
    requireCondition(['waiting', 'between_rounds'].includes(room.state), 'INVALID_ROOM_STATE', '这一局已经开打了。', 409);
    this.testDeals.set(roomId, { dealerUserId: actor.id, hands: deal.hands.map(hand => [...hand]), draws: [...deal.draws] });
  }

  games() { return catalogue.filter(variant => this.opensVariant(variant.key)).map(variant => ({ ...variant, defaults: getDefaultOptions(variant.key), fields: getRoomSpec(variant.key).fields, playable: this.engines.has(variant.key) })); }

  async current(userId: string) {
    const found = await this.db.query("SELECT r.id FROM rooms r JOIN room_members m ON r.id=m.room_id WHERE m.user_id=$1 AND r.state <> 'closed' AND m.hold_until IS NULL ORDER BY r.created_at DESC LIMIT 1", [userId]);
    return found.rows[0] ? this.view(found.rows[0].id, userId) : null;
  }

  /** 开房选项的权威校验；玩家开房、系统桌和后台模板共用（R2、R3）。 */
  prepareRoom(variantKey: string, options: Record<string, unknown>, region?: unknown) {
    requireCondition(supportsNewRoom(variantKey) && this.opensVariant(variantKey), 'GAME_REMOVED', 'This game is not available in the regional edition.', 409);
    requireCondition(variantKey !== '6:0' || options.processType !== 2, 'GAME_REMOVED', 'Red-twenty blood-battle is not included in this edition.', 409);
    const variant = getVariant(variantKey);
    requireCondition(variant, 'UNKNOWN_VARIANT', 'Unknown game configuration.');
    const spec = getRoomSpec(variantKey, region as never);
    const requestedBaseBeans = options.baseBeans;
    const requestedPlayerNum = options.playerNum;
    // 房内不再定位（R11）：老客户端、老模板带来的 openGps 一律忽略。
    // 新津 v2 的翻法、封顶不走原版选项表（原版封顶没有 3 番），单独校验（DEC-20261108-翻法封顶每桌选）。
    const xinjinPicks = variantKey === '4:0' ? xinjinChoicePicks(options) : {};
    const ruleOptions = Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'baseBeans' && key !== 'openGps' &&
      !(key === 'playerNum' && spec.unresolvedFields.includes('playerNum')) && !(variantKey === '4:0' && key in XINJIN_V2_CHOICES)));
    const normalized = validateRoomOptions(variantKey, { ...getDefaultOptions(variantKey, region as never), ...ruleOptions }, region as never) as Record<string, any>;
    // 新津 v2 玩法固定（DEC-20261031-第三轮规则v2）：番和封顶不再由开房选项决定。
    if (variantKey === '4:0') Object.assign(normalized, XINJIN_V2_OPTIONS, xinjinPicks);
    let playerNumSource: 'manual' | 'original';
    if (spec.unresolvedFields.includes('playerNum')) {
      requireCondition(typeof requestedPlayerNum === 'number' && [2, 3, 4].includes(requestedPlayerNum), 'RULE_DEFAULT_NOT_VERIFIED', 'A player count of 2, 3 or 4 is required.', 409);
      normalized.playerNum = requestedPlayerNum;
      playerNumSource = 'manual';
    } else {
      requireCondition([2, 3, 4].includes(normalized.playerNum), 'RULES_INCOMPLETE', 'This configuration does not contain verified player-count options.', 409);
      playerNumSource = 'original';
    }
    let baseBeans: string;
    let baseBeansSource: 'manual' | 'original-basicTimes';
    if (spec.unresolvedFields.includes('basicTimes')) {
      requireCondition(typeof requestedBaseBeans === 'string', 'RULE_DEFAULT_NOT_VERIFIED', 'A positive base bean amount is required.', 409);
      const parsed = amount(requestedBaseBeans);
      requireCondition(parsed.greaterThan(0), 'INVALID_ROOM_OPTIONS', 'Base beans must be positive.', 400);
      baseBeans = money(parsed);
      baseBeansSource = 'manual';
    } else {
      requireCondition(requestedBaseBeans === undefined, 'INVALID_ROOM_OPTIONS', 'This configuration uses its original base score options.', 400);
      requireCondition(typeof normalized.basicTimes === 'number', 'RULE_DEFAULT_NOT_VERIFIED', 'The original base score is unresolved.', 409);
      baseBeans = baseScoreDecimal(normalized.basicTimes);
      requireCondition(new Decimal(baseBeans).greaterThan(0), 'INVALID_ROOM_OPTIONS', 'Base beans must be positive.', 400);
      baseBeansSource = 'original-basicTimes';
    }
    const ruleVersion = this.engines.has(variantKey) ? this.engines.get(variantKey).version : variant.ruleVersion;
    const rules = { ...normalized, playerNumSource, baseBeans, baseBeansSource, region, roundingVersion: TRANSFER_ROUNDING_VERSION,
      independentApproval: freezeIndependentApproval(variantKey),
      ...(variantKey === '8:0' ? { qionglai: freezeQionglaiOptions(normalized) } : {}),
      ...(variantKey === '6:0' ? { yaan: freezeYaanOptions(normalized) } : {}),
      ...(variantKey === '4:0' ? { xinjin: freezeXinjinOptions(normalized) } : {}),
      ...(variantKey === '5:0' ? { anyue: freezeAnyueOptions(normalized) } : {}),
      ...(variantKey === '7:0' ? { pujiang: freezePujiangOptions(normalized) } : {}),
      ...(variantKey === '9:0' ? { aba: freezeAbaOptions(normalized, '9:0') } : {}),
      ...(variantKey === '10:0' ? { aba: freezeAbaOptions(normalized, '10:0') } : {}),
      ...(variantKey === '11:0' ? { aba: freezeAbaOptions(normalized, '11:0') } : {}),
      ...(variantKey === '12:0' ? { aba: freezeAbaOptions(normalized, '12:0') } : {}),
      ...(['14:0', '15:0', '16:0', '19:0', '20:0', '21:0', '22:0', '23:0', '24:0', '25:0', '26:0', '27:0']
        .includes(variantKey) ? { scoreRegion: freezeScoreRegionOptions(normalized,
          variantKey as '14:0' | '15:0' | '16:0' | '19:0' | '20:0' | '21:0' | '22:0' | '23:0' | '24:0' | '25:0' | '26:0' | '27:0') } : {}) };
    return { variantKey, ruleVersion, rules, playerCount: normalized.playerNum as number, rounds: normalized.gameNum as number,
      feeMode: (normalized.useCardType === 1 ? 'owner' : 'aa') as 'owner' | 'aa', baseBeans };
  }

  private async insertRoom(tx: Sql, ownerId: string, prepared: ReturnType<RoomService['prepareRoom']>, visibility: 'private' | 'public', templateId: string | null) {
    const id = randomUUID();
    // A single creation lock prevents room-code collisions without retrying an aborted transaction.
    await tx.query('SELECT pg_advisory_xact_lock(2026090901)');
    let code: string;
    do { code = String(randomInt(100000, 1000000)); }
    while ((await tx.query("SELECT id FROM rooms WHERE code=$1 AND state <> 'closed'", [code])).rows.length);
    // 公开桌一律 AA（R5 AC1）：桌上显示的房费方式和扣费保持一致。
    const rules = visibility === 'public' && 'useCardType' in prepared.rules ? { ...prepared.rules, useCardType: 2 } : prepared.rules;
    await tx.query("INSERT INTO rooms(id,code,owner_id,variant_key,rule_version,rules,player_count,rounds,fee_mode,state,visibility,lobby_template_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting',$10,$11)",
      [id, code, ownerId, prepared.variantKey, prepared.ruleVersion, JSON.stringify(rules), prepared.playerCount, prepared.rounds,
        visibility === 'public' ? 'aa' : prepared.feeMode, visibility, templateId]);
    return { id, code };
  }

  async create(actor: Actor, variantKey: string, options: Record<string, unknown>, region?: unknown, visibility: 'private' | 'public' = 'private') {
    requireRole(actor, 'player');
    const prepared = this.prepareRoom(variantKey, options, region);
    const { id } = await this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`player-room:${actor.id}`]);
      await this.requireNoRoom(tx, actor.id);
      // 公开房的房主和后来入座的人用同一道门槛，不够就不开房（R5，DEC-20261030-公开房房主也查门槛）。
      if (visibility === 'public') await this.requireThreshold(tx, actor.id, { rules: prepared.rules, lobby_template_id: null });
      const room = await this.insertRoom(tx, actor.id, prepared, visibility, null);
      await tx.query('INSERT INTO room_members(room_id,user_id,seat) VALUES($1,$2,1)', [room.id, actor.id]);
      return room;
    });
    return this.view(id, actor.id);
  }

  /** 系统桌：房主是不能登录的系统账号，不入座（R2）。 */
  async createSystemRoom(templateId: string, variantKey: string, options: Record<string, unknown>, region?: unknown) {
    const prepared = this.prepareRoom(variantKey, options, region);
    return this.db.transaction(tx => this.insertRoom(tx, SYSTEM_ACCOUNT_ID, prepared, 'public', templateId));
  }

  async join(actor: Actor, code: string, wantedSeat?: number) {
    requireRole(actor, 'player');
    requireCondition(/^\d{6}$/.test(code), 'INVALID_ROOM_CODE', 'Room number must have six digits.');
    const id = await this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`player-room:${actor.id}`]);
      const found = await tx.query("SELECT * FROM rooms WHERE code=$1 AND state <> 'closed' FOR UPDATE", [code]);
      requireCondition(found.rows[0], 'ROOM_NOT_FOUND', 'Room does not exist.', 404);
      const room = found.rows[0];
      const members = await tx.query('SELECT user_id,seat,hold_until FROM room_members WHERE room_id=$1', [room.id]);
      const mine = members.rows.find(m => m.user_id === actor.id);
      if (mine && mine.hold_until) {
        // 上一场的人点「再来一局」：认领留着的座位，豆子不够门槛就不让接着打（第三轮 R5 AC2）。
        await this.requireThreshold(tx, actor.id, room);
        await tx.query('UPDATE room_members SET hold_until=NULL,joined_at=now() WHERE room_id=$1 AND user_id=$2', [room.id, actor.id]);
        return room.id as string;
      }
      if (mine) return room.id;
      requireCondition(supportsNewRoom(room.variant_key), 'GAME_REMOVED', 'This game is no longer accepting players.', 409);
      await this.requireNoRoom(tx, actor.id);
      requireCondition(room.state === 'waiting' && room.current_round === 0, 'ROOM_STARTED', 'This room has already started.', 409);
      requireCondition(members.rows.length < room.player_count, 'ROOM_FULL', 'Room is full.', 409);
      if (room.visibility === 'public') await this.requireThreshold(tx, actor.id, room);
      let seat = 1;
      if (wantedSeat !== undefined) {
        // 点哪个空位坐哪个；同时点同一个，后到的人收到「已被坐」（第三轮 R3 AC1、AC2）。
        requireCondition(Number.isInteger(wantedSeat) && wantedSeat >= 1 && wantedSeat <= room.player_count, 'INVALID_SEAT', '没有这个座位。');
        requireCondition(!members.rows.some(m => m.seat === wantedSeat), 'SEAT_TAKEN', '这个座位刚被人坐了，换一个吧。', 409);
        seat = wantedSeat;
      } else while (members.rows.some(m => m.seat === seat)) seat++;
      await tx.query('INSERT INTO room_members(room_id,user_id,seat) VALUES($1,$2,$3)', [room.id, actor.id, seat]);
      await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [room.id]);
      // 第二轮 S4-AC6：被邀请进这桌的，邀请卡写「已入座」。
      await tx.query("UPDATE room_invites SET result='joined' WHERE to_id=$1 AND room_id=$2 AND result IS NULL", [actor.id, room.id]);
      return room.id as string;
    });
    this.emit('changed', id);
    return this.view(id, actor.id);
  }

  /** 公开桌入座门槛：豆子不少于「底分 × 倍数」，不够就提示还差多少（R5 AC2）。 */
  async thresholdFor(sql: Sql, room: Record<string, any>) {
    const template = room.lobby_template_id ? (await sql.query('SELECT threshold_multiplier FROM lobby_templates WHERE id=$1', [room.lobby_template_id])).rows[0] : null;
    return new Decimal(room.rules?.baseBeans ?? '0').times(template?.threshold_multiplier ?? DEFAULT_THRESHOLD_MULTIPLIER);
  }

  private async requireThreshold(tx: Sql, userId: string, room: Record<string, any>) {
    const required = await this.thresholdFor(tx, room);
    const balance = new Decimal((await tx.query('SELECT balance::text FROM wallets WHERE user_id=$1', [userId])).rows[0]?.balance ?? '0');
    requireCondition(balance.greaterThanOrEqualTo(required), 'BELOW_THRESHOLD',
      `豆子不足：这桌至少要 ${money(required)} 豆，你还差 ${money(required.minus(balance))} 豆。`, 409);
  }

  private async requireNoRoom(tx: Sql, userId: string) {
    // 去别的桌就是放弃上一场留着的座位。
    await tx.query('DELETE FROM room_members WHERE user_id=$1 AND hold_until IS NOT NULL', [userId]);
    const active = await tx.query("SELECT r.id FROM rooms r JOIN room_members m ON r.id=m.room_id WHERE m.user_id=$1 AND r.state <> 'closed'", [userId]);
    requireCondition(!active.rows.length, 'ALREADY_IN_ROOM', 'Leave your current room before joining another.', 409);
  }

  async view(roomId: string, userId: string, sql: Sql = this.db) {
    const found = await sql.query('SELECT * FROM rooms WHERE id=$1', [roomId]);
    requireCondition(found.rows[0], 'ROOM_NOT_FOUND', 'Room does not exist.', 404);
    const members = await sql.query(`SELECT m.user_id AS "userId",m.seat,m.ready,m.auto_play AS "autoPlay",
      w.balance::text AS "beanBalance",COALESCE(t.room_bean_delta,0)::text AS "roomBeanDelta",a.username,a.nickname,a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus",a.sex
      FROM room_members m
      JOIN accounts a ON a.id=m.user_id
      JOIN wallets w ON w.user_id=m.user_id
      LEFT JOIN room_member_settlement_totals t ON t.room_id=m.room_id AND t.user_id=m.user_id
      WHERE m.room_id=$1 ORDER BY m.seat`, [roomId]);
    requireCondition(members.rows.some(m => m.userId === userId), 'NOT_ROOM_MEMBER', 'You are not a member of this room.', 403);
    const r = found.rows[0];
    const current = await sql.query("SELECT id,snapshot,state_version,interaction_state FROM rounds WHERE room_id=$1 AND state='playing'", [roomId]);
    const confirmedScores = current.rows[0] ? totalConfirmedScores(await this.scoreHistory(sql, current.rows[0].id), members.rows.map(member => member.userId)) : null;
    const roundDeltas = new Map((confirmedScores ?? []).map(posting => [posting.userId, money(posting.amount)]));
    const memberViews: Record<string, any>[] = members.rows.map(member => {
      const roomBeanDelta = money(member.roomBeanDelta);
      const roundBeanDelta = roundDeltas.get(member.userId) ?? '0';
      const { avatarHash, avatarStatus, ...rest } = member;
      return { ...rest, avatarUrl: avatarUrl({ id: member.userId, avatarHash, avatarStatus }), beanBalance: money(member.beanBalance), roomBeanDelta, roundBeanDelta,
        // These aliases preserve existing callers and original-wire projections.
        score: roomBeanDelta, changeScore: roundBeanDelta };
    });
    const interactionState = current.rows[0]?.interaction_state as InteractionState | null;
    const legalActions = interactionState ? engineLegalActions(this.engines.get(r.variant_key, r.rule_version), current.rows[0]!.snapshot, userId) : null;
    const operationTimers = (interactionState?.timers ?? []).filter(timer => timer.userId === userId).map(timer => ({ kind: timer.kind, decisionId: timer.decisionId, dueAt: timer.dueAt }));
    return { id: r.id, code: r.code, ownerId: r.owner_id, variantKey: r.variant_key, ruleVersion: r.rule_version, rules: r.rules,
      baseBeans: r.rules?.baseBeans ?? null, baseBeansSource: r.rules?.baseBeansSource ?? null, playerNumSource: r.rules?.playerNumSource ?? null,
      playerCount: r.player_count, rounds: r.rounds, currentRound: r.current_round, state: r.state, feeMode: r.fee_mode, feeCharged: r.fee_charged,
      members: memberViews, roundId: current.rows[0]?.id ?? null, stateVersion: current.rows[0]?.state_version ?? null, confirmedScores, legalActions, operationTimers,
      roundBeanDelta: confirmedScores,
      responseWindow: interactionState?.responseWindows?.[userId] ? { id: interactionState.responseWindows[userId]!.id,
        openedAtVersion: interactionState.responseWindows[userId]!.openedAtVersion } : null,
      game: current.rows[0] ? this.engines.get(r.variant_key, r.rule_version).view(current.rows[0].snapshot, userId) : null };
  }

  async ready(actor: Actor, roomId: string, ready: boolean) {
    requireRole(actor, 'player');
    let committedBalances: BalanceChange[] = [];
    await this.db.transaction(async tx => {
      const room = await this.lockRoom(tx, roomId, actor.id);
      if (ready) requireCondition(supportsNewRoom(room.variant_key), 'GAME_REMOVED', 'This game no longer accepts new rounds.', 409);
      requireCondition(['waiting', 'between_rounds'].includes(room.state), 'INVALID_ROOM_STATE', 'Room is not waiting for ready players.', 409);
      await tx.query('UPDATE room_members SET ready=$3 WHERE room_id=$1 AND user_id=$2', [roomId, actor.id, ready]);
      const members = await tx.query('SELECT user_id,seat,ready,auto_play FROM room_members WHERE room_id=$1 ORDER BY seat', [roomId]);
      if (members.rows.length === room.player_count && members.rows.every(m => m.ready)) {
        const engine = this.engines.get(room.variant_key, room.rule_version);
        const sortedIds = members.rows.map(m => m.user_id).sort();
        for (const id of sortedIds) {
          const balance = await tx.query('SELECT balance::text FROM wallets WHERE user_id=$1 FOR UPDATE', [id]);
          requireCondition(new Decimal(balance.rows[0]!.balance).greaterThan(0), 'INSUFFICIENT_BALANCE', 'All players must have a positive balance.', 409);
        }
        const roundId = randomUUID();
        const policy = await this.policies.freeze(tx, sortedIds, roomId, roundId);
        const previous = room.current_round > 0
          ? await tx.query("SELECT next_round_context FROM rounds WHERE room_id=$1 AND number=$2 AND state='settled' AND (end_reason='completed' OR end_reason IS NULL)", [roomId, room.current_round])
          : null;
        requireCondition(!previous || previous.rows.length === 1, 'ROUND_CONTEXT_MISSING', 'The previous completed round is missing.', 409);
        const previousRoundContext = previous?.rows[0]?.next_round_context;
        // 系统桌的房主不入座，首局庄家按 1 号座位算。
        const ownerUserId = members.rows.some(m => m.user_id === room.owner_id) ? room.owner_id : members.rows[0]!.user_id;
        const testDeal = this.testDeals.get(roomId);
        this.testDeals.delete(roomId);
        const snapshot = engine.create({ players: members.rows.map(m => ({ userId: m.user_id, seat: m.seat })), ownerUserId,
          rules: room.rules, number: room.current_round + 1, policy, ...(testDeal ? { testDeal } : {}),
          ...(previousRoundContext == null ? {} : { previousRoundContext: structuredClone(previousRoundContext) }) });
        const atMs = this.now();
        const interactionState = engine.interactions ? planInteractions({ engine, snapshot, playerIds: sortedIds, roundId, atMs,
          autoPlayUserIds: members.rows.filter(member => member.auto_play).map(member => member.user_id), previous: null }) : null;
        if (!room.fee_charged) {
          const perPlayer = room.rounds / 4;
          const postings = room.fee_mode === 'owner' ? [{ userId: room.owner_id, amount: String(-perPlayer * room.player_count) }] : sortedIds.map(userId => ({ userId, amount: String(-perPlayer) }));
          const operation = { key: `room-fee:${roomId}`, kind: 'room_fee' as const, roomId, reason: 'Room creation fee', postings };
          const result = await appendOperation(tx, operation);
          committedBalances = balanceChanges(result, operation);
        }
        await tx.query("INSERT INTO rounds(id,room_id,number,state,snapshot,initial_snapshot,policy_snapshot,interaction_state,initial_interaction_state,next_action_at) VALUES($1,$2,$3,'playing',$4,$4,$5,$6,$6,$7)", [roundId, roomId, room.current_round + 1, JSON.stringify(snapshot), JSON.stringify(policy), interactionState ? JSON.stringify(interactionState) : null, this.scheduledTimestamp(interactionState)]);
        await tx.query("UPDATE rooms SET state='playing',current_round=current_round+1,fee_charged=true WHERE id=$1", [roomId]);
        await this.event(tx, roomId, actor.id, `round-start:${roundId}`, { type: 'round_started', roundId, number: room.current_round + 1, atMs,
          ...(engine.original ? { originalNotifications: this.originalNotifications(engine, snapshot, [], sortedIds, 'start'),
            originalRoomState: { roomId, roundId, stateVersion: 0 } } : {}) });
      }
    });
    if (committedBalances.length) this.emit('balanceChanged', committedBalances);
    this.emit('changed', roomId);
    return this.view(roomId, actor.id);
  }

  async action(actor: Actor, roomId: string, commandId: string, action: unknown, expectedStateVersion?: number, expectedRoundId?: string, original?: OriginalActionContext, decisionId?: string) {
    requireRole(actor, 'player');
    requireCondition(/^[\w-]{8,100}$/.test(commandId), 'INVALID_COMMAND_ID', 'A unique command ID is required.');
    let committedBalances: BalanceChange[] = [];
    await this.db.transaction(async tx => {
      const room = await this.lockRoom(tx, roomId, actor.id);
      // Omitted fields preserve the hash of pre-version commands for identical retries only.
      const commandHash = requestHash({ userId: actor.id, action, expectedStateVersion, expectedRoundId, ...(original ? { original } : {}), ...(decisionId !== undefined ? { decisionId } : {}) });
      const previous = await tx.query('SELECT payload FROM game_events WHERE room_id=$1 AND command_id=$2', [roomId, commandId]);
      if (previous.rows[0]) {
        requireCondition(previous.rows[0].payload.commandHash === commandHash, 'IDEMPOTENCY_CONFLICT', 'Command ID already used for another action.', 409);
        return;
      }
      requireCondition(!commandId.startsWith('scheduled-'), 'INVALID_COMMAND_ID', 'This command prefix is reserved for the scheduler.');
      requireCondition(expectedStateVersion !== undefined, 'STATE_VERSION_REQUIRED', 'The observed round state version is required.');
      requireCondition(Number.isInteger(expectedStateVersion) && expectedStateVersion >= 0 && expectedStateVersion < 2147483647,
        'INVALID_STATE_VERSION', 'Round state version must be a non-negative integer.');
      requireCondition(expectedRoundId !== undefined, 'ROUND_ID_REQUIRED', 'The observed round ID is required.');
      requireCondition(typeof expectedRoundId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedRoundId),
        'INVALID_ROUND_ID', 'The observed round ID must be a UUID.');
      requireCondition(room.state === 'playing', 'INVALID_ROOM_STATE', 'No round is currently running.', 409);
      const round = (await tx.query("SELECT * FROM rounds WHERE room_id=$1 AND state='playing' FOR UPDATE", [roomId])).rows[0]!;
      requireCondition(expectedRoundId === round.id, 'ROUND_VERSION_CONFLICT', 'The action belongs to a different round. Refresh the room state.', 409);
      validateObservedDecision(round.interaction_state, actor.id, expectedStateVersion, round.state_version, decisionId);
      const atMs = this.now();
      if (round.interaction_state) {
        requireCondition(!(round.interaction_state as InteractionState).timers.some(timer => timer.kind === 'timeout' && timer.dueAt <= atMs),
          'ACTION_DEADLINE_EXPIRED', 'A pending deadline must be processed before another player action.', 409);
      }
      committedBalances = await this.applyRoundAction(tx, room, round, actor.id, action, commandId, commandHash, atMs, undefined, original,
        decisionId === undefined ? undefined : { decisionId, observedStateVersion: expectedStateVersion });
    });
    if (committedBalances.length) this.emit('balanceChanged', committedBalances);
    this.emit('changed', roomId);
    return this.view(roomId, actor.id);
  }

  async originalAction(actor: Actor, roomId: string, commandId: string, command: 23 | 53, body: Record<string, unknown>, expectedStateVersion: number, expectedRoundId: string, decisionId?: string): Promise<EngineOriginalBody> {
    const room = await this.view(roomId, actor.id);
    const adapter = this.engines.get(room.variantKey, room.ruleVersion).original;
    requireCondition(adapter, 'ORIGINAL_ADAPTER_UNAVAILABLE', 'This rule version has no verified original-client adapter.', 409);
    if (command === 23 && body.seatIndex !== undefined && body.seatIndex !== 0) {
      requireCondition(body.seatIndex === room.members.find(member => member.userId === actor.id)!.seat,
        'INVALID_ACTOR_SEAT', 'The action seat must belong to the authenticated player.', 403);
    }
    const original = { command, body: JSON.parse(JSON.stringify(body)) as Record<string, unknown>,
      ...(decisionId === undefined ? {} : { decisionId }) };
    const action = adapter.decodeAction(command, structuredClone(original.body), decisionId);
    await this.action(actor, roomId, commandId, action, expectedStateVersion, expectedRoundId, original, decisionId);
    const event = (await this.db.query('SELECT payload FROM game_events WHERE room_id=$1 AND command_id=$2 AND actor_id=$3', [roomId, commandId, actor.id])).rows[0];
    requireCondition(event?.payload.originalResponse, 'ORIGINAL_ADAPTER_UNAVAILABLE', 'No archived original action response exists.', 409);
    return event.payload.originalResponse as EngineOriginalBody;
  }

  async originalEnter(actor: Actor, roomId: string) {
    requireRole(actor, 'player');
    return this.db.transaction(async tx => {
      await this.lockRoom(tx, roomId, actor.id);
      const room = await this.view(roomId, actor.id, tx);
      requireCondition(room.state !== 'closed', 'ROOM_CLOSED', 'Room is closed.', 409);
      const sequence = (await tx.query('SELECT COALESCE(MAX(sequence),0)::int AS value FROM game_events WHERE room_id=$1', [roomId])).rows[0]!.value as number;
      let game: EngineOriginalBody | null = null;
      let resume: ReturnType<typeof projectOriginalNotifications> = [];
      if (room.roundId) {
        const engine = this.engines.get(room.variantKey, room.ruleVersion);
        const adapter = engine.original;
        requireCondition(adapter, 'ORIGINAL_ADAPTER_UNAVAILABLE', 'This rule version has no verified original-client adapter.', 409);
        const round = (await tx.query('SELECT snapshot FROM rounds WHERE id=$1', [room.roundId])).rows[0]!;
        game = adapter.enter(structuredClone(round.snapshot), actor.id);
        this.validateOriginalBody(48, game);
        // 进桌包里没有选项：刷新、断线重连后补发这一手的选项和倒计时，不然要等下一手才有按钮（11-01 测试台）。
        resume = projectOriginalNotifications(engine, round.snapshot, [], actor.id, 'action')
          .filter(packet => packet.command === MSGEvent.HWNotifySeatOperationChoice || packet.command === MSGEvent.HWNotifyNextOperation);
      }
      return { room, game, sequence, resume };
    });
  }

  private scheduledTimestamp(state: InteractionState | null): string | null {
    const dueAt = nextScheduledAt(state);
    return dueAt === null ? null : new Date(dueAt).toISOString();
  }

  private originalNotifications(engine: RuleEngine, snapshot: unknown, events: readonly unknown[], users: string[], phase: 'start' | 'action') {
    return Object.fromEntries(users.map(userId => {
      const packets = projectOriginalNotifications(engine, snapshot, events, userId, phase);
      requireCondition(Array.isArray(packets) && packets.length <= 100, 'INVALID_ORIGINAL_PROJECTION', 'An original action must produce at most 100 notifications per viewer.', 500);
      for (const packet of packets) {
        requireCondition(Object.entries(MSGEvent).some(([name, command]) => command === packet.command && (name.startsWith('HWNotify') || name.startsWith('HWNottify'))),
          'INVALID_ORIGINAL_PROJECTION', 'An engine notification must use an original server notification command.', 500);
        this.validateOriginalBody(packet.command, packet);
      }
      return [userId, packets];
    }));
  }

  private validateOriginalBody(command: number, projection: EngineOriginalBody) {
    requireCondition(projection && typeof projection.body === 'object' && projection.body !== null && !Array.isArray(projection.body),
      'INVALID_ORIGINAL_PROJECTION', 'An original projection requires a message body.', 500);
    const field = expectedBodyField(command);
    requireCondition(field, 'INVALID_ORIGINAL_PROJECTION', 'An original projection requires a known message.', 500);
    encodeFrame({ cmd: command, protoVersion: 2 }, { [field]: projection.body });
    const decimals = projection.decimalFields ?? [];
    requireCondition(Array.isArray(decimals) && JSON.stringify(decimals).length <= 60000, 'INVALID_ORIGINAL_PROJECTION', 'Original decimal metadata is too large.', 500);
    for (const decimal of decimals) {
      requireCondition(Array.isArray(decimal.path) && decimal.path.length >= 2 && decimal.path.length <= 16 && decimal.path[0] === field &&
        decimal.path.every(part => typeof part === 'string' ? !['__proto__', 'constructor', 'prototype'].includes(part) : Number.isSafeInteger(part) && part >= 0),
      'INVALID_ORIGINAL_PROJECTION', 'Original decimal fields must target this message only.', 500);
      money(decimal.value);
    }
  }

  private async applyRoundAction(tx: Sql, room: Record<string, any>, round: Record<string, any>, userId: string,
    action: unknown, commandId: string, commandHash: string, atMs: number, scheduled?: ScheduledEngineAction, original?: OriginalActionContext,
    decision?: { decisionId: string; observedStateVersion: number }) {
    const engine = this.engines.get(room.variant_key, room.rule_version);
    const engineAction = original && engine.original?.resolveAction
      ? engine.original.resolveAction(structuredClone(round.snapshot), userId, structuredClone(action)) : action;
    if (round.interaction_state) requireLegalAction(engine, round.snapshot, userId, engineAction);
    const result = engine.apply(round.snapshot, userId, engineAction);
    const nextRoundContext = validateNextRoundContext(result);
    const originalResponse = original ? engine.original?.response(original.command, structuredClone(original.body), structuredClone(result.snapshot), userId) : undefined;
    requireCondition(!original || originalResponse, 'ORIGINAL_ADAPTER_UNAVAILABLE', 'The engine cannot project this original action response.', 409);
    if (originalResponse) this.validateOriginalBody(original!.command === 23 ? 24 : 54, originalResponse);
    const members = (await tx.query('SELECT user_id,auto_play FROM room_members WHERE room_id=$1 ORDER BY user_id', [room.id])).rows;
    const memberIds = members.map(member => member.user_id);
    const confirmed = round.scoring_version === 1 ? applyConfirmedScores(await this.scoreHistory(tx, round.id), result, memberIds) : null;
    const previous = round.interaction_state as InteractionState | null;
    const interactionState = !previous ? null : result.settlement !== undefined ? finishInteractions(previous, atMs)
      : planInteractions({ engine, snapshot: result.snapshot, playerIds: memberIds, roundId: round.id, atMs,
        autoPlayUserIds: members.filter(member => member.auto_play).map(member => member.user_id), previous, consumedTimerId: scheduled?.id, stateVersion: round.state_version + 1 });
    const closing = result.settlement === undefined ? false : (await this.settlementPlan(tx, room, memberIds, result.settlement, 'completed')).closed;
    await tx.query('UPDATE rounds SET snapshot=$2,state_version=state_version+1,interaction_state=$3,next_action_at=$4,next_round_context=$5 WHERE id=$1',
      [round.id, JSON.stringify(result.snapshot), interactionState ? JSON.stringify(interactionState) : null, this.scheduledTimestamp(interactionState),
        nextRoundContext === null ? null : JSON.stringify(nextRoundContext)]);
    await this.event(tx, room.id, userId, commandId, { commandHash, roundId: round.id, action: engineAction, expectedStateVersion: round.state_version,
      stateVersion: round.state_version + 1, events: result.events, source: scheduled?.kind ?? 'player', atMs,
      ...(decision ? { decision } : {}),
      ...(original ? { original, originalDecoded: action, originalResponse } : {}),
      ...(engine.original ? { originalNotifications: this.originalNotifications(engine, result.snapshot, result.events, memberIds, 'action'),
        originalRoomState: result.settlement ? { roomId: closing ? null : room.id, roundId: null, stateVersion: null }
          : { roomId: room.id, roundId: round.id, stateVersion: round.state_version + 1 } } : {}),
      ...(scheduled ? { scheduledTimerId: scheduled.id } : {}), ...(interactionState ? { interactionState } : {}),
      ...(result.settlement === undefined ? {} : { nextRoundContext }),
      ...(confirmed ? { confirmedScores: confirmed.appended, settlement: confirmed.settlement ?? null } : {}) });
    for (const [ordinal, batch] of (confirmed?.appended ?? []).entries()) {
      await tx.query('INSERT INTO round_score_events(round_id,event_id,room_id,command_id,ordinal,postings,transfers) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [round.id, batch.eventId, room.id, commandId, ordinal, JSON.stringify(batch.postings), batch.transfers ? JSON.stringify(batch.transfers) : null]);
    }
    if (result.settlement) return this.settle(tx, room, round.id, result.settlement);
    return [];
  }

  async dueRoomIds(limit = 100): Promise<string[]> {
    requireCondition(Number.isInteger(limit) && limit > 0 && limit <= 500, 'INVALID_BATCH_SIZE', 'Scheduler batch size must be between 1 and 500.');
    const result = await this.db.query("SELECT q.room_id FROM rounds q JOIN rooms r ON r.id=q.room_id WHERE q.state='playing' AND r.state='playing' AND q.next_action_at <= $1 ORDER BY q.next_action_at,q.room_id LIMIT $2", [new Date(this.now()).toISOString(), limit]);
    return result.rows.map(row => row.room_id);
  }

  /** The room lock serializes scheduler instances with player actions and dissolution. */
  async applyDueAction(roomId: string): Promise<boolean> {
    let committedBalances: BalanceChange[] = [];
    const applied = await this.db.transaction(async tx => {
      const room = (await tx.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE', [roomId])).rows[0];
      if (!room || room.state !== 'playing') return false;
      const round = (await tx.query("SELECT * FROM rounds WHERE room_id=$1 AND state='playing' FOR UPDATE", [roomId])).rows[0];
      const state = round?.interaction_state as InteractionState | null;
      const atMs = this.now();
      const timer = state?.timers[0];
      if (!timer || timer.dueAt > atMs) return false;
      const commandId = `scheduled-${timer.id}`;
      const previous = await tx.query('SELECT 1 FROM game_events WHERE room_id=$1 AND command_id=$2', [roomId, commandId]);
      requireCondition(!previous.rows.length, 'SCHEDULE_HISTORY_CONFLICT', 'An executed timer remains pending in the round state.', 500);
      const commandHash = requestHash({ userId: timer.userId, action: timer.action, expectedStateVersion: round!.state_version, expectedRoundId: round!.id, source: timer.kind });
      committedBalances = await this.applyRoundAction(tx, room, round!, timer.userId, timer.action, commandId, commandHash, atMs, timer);
      return true;
    });
    if (applied) {
      if (committedBalances.length) this.emit('balanceChanged', committedBalances);
      this.emit('changed', roomId);
    }
    return applied;
  }

  /** 原版可胡提示：本人当前在打的这局还差哪几张能胡（E7）；不在局里或玩法不支持就空。 */
  async originalJiaoTishi(userId: string) {
    const found = (await this.db.query(`SELECT r.variant_key,r.rule_version,q.snapshot FROM rooms r JOIN room_members m ON m.room_id=r.id
      JOIN rounds q ON q.room_id=r.id AND q.state='playing' WHERE m.user_id=$1 AND r.state='playing' LIMIT 1`, [userId])).rows[0];
    if (!found) return [];
    const engine = this.engines.get(found.variant_key, found.rule_version);
    return engine.original?.jiaoTishi?.(found.snapshot, userId) ?? [];
  }

  async setAutoPlay(actor: Actor, roomId: string, enabled: boolean, commandId: string) {
    requireRole(actor, 'player');
    requireCondition(typeof enabled === 'boolean', 'INVALID_AUTOPLAY', 'Autoplay must be a boolean.');
    requireCondition(/^[\w-]{8,100}$/.test(commandId) && !commandId.startsWith('scheduled-'), 'INVALID_COMMAND_ID', 'A unique player command ID is required.');
    await this.db.transaction(async tx => {
      const room = await this.lockRoom(tx, roomId, actor.id);
      const commandHash = requestHash({ userId: actor.id, type: 'autoplay_changed', enabled });
      const prior = await tx.query('SELECT payload FROM game_events WHERE room_id=$1 AND command_id=$2', [roomId, commandId]);
      if (prior.rows[0]) {
        requireCondition(prior.rows[0].payload.commandHash === commandHash, 'IDEMPOTENCY_CONFLICT', 'Command ID already used for another operation.', 409);
        return;
      }
      requireCondition(room.state !== 'closed', 'ROOM_CLOSED', 'Room is closed.', 409);
      const engine = this.engines.get(room.variant_key, room.rule_version);
      requireCondition(engine.interactions, 'ENGINE_INTERACTIONS_UNAVAILABLE', 'This archived engine does not support autoplay.', 409);
      const round = (await tx.query("SELECT * FROM rounds WHERE room_id=$1 AND state='playing' FOR UPDATE", [roomId])).rows[0];
      requireCondition(!round || round.interaction_state, 'ENGINE_INTERACTIONS_UNAVAILABLE', 'Autoplay was not enabled for this archived round.', 409);
      await tx.query('UPDATE room_members SET auto_play=$3 WHERE room_id=$1 AND user_id=$2', [roomId, actor.id, enabled]);
      const atMs = this.now();
      let interactionState: InteractionState | null = null;
      if (round) {
        const members = (await tx.query('SELECT user_id,auto_play FROM room_members WHERE room_id=$1 ORDER BY user_id', [roomId])).rows;
        interactionState = planInteractions({ engine, snapshot: round.snapshot, playerIds: members.map(member => member.user_id), roundId: round.id, atMs,
          autoPlayUserIds: members.filter(member => member.auto_play).map(member => member.user_id), previous: round.interaction_state, stateVersion: round.state_version });
        await tx.query('UPDATE rounds SET interaction_state=$2,next_action_at=$3 WHERE id=$1', [round.id, JSON.stringify(interactionState), this.scheduledTimestamp(interactionState)]);
      }
      await this.event(tx, roomId, actor.id, commandId, { commandHash, type: 'autoplay_changed', roundId: round?.id ?? null, enabled, atMs,
        ...(interactionState ? { interactionState } : {}) });
    });
    this.emit('changed', roomId);
    return this.view(roomId, actor.id);
  }

  private async scoreHistory(tx: Sql, roundId: string): Promise<ConfirmedScoreBatch[]> {
    const result = await tx.query('SELECT s.event_id AS "eventId",s.postings,s.transfers FROM round_score_events s JOIN game_events e ON e.room_id=s.room_id AND e.command_id=s.command_id WHERE s.round_id=$1 ORDER BY e.sequence,s.ordinal', [roundId]);
    return result.rows.map(({ transfers, ...batch }) => ({ ...batch, ...(transfers === null ? {} : { transfers }) })) as ConfirmedScoreBatch[];
  }

  /**
   * 这局实际过账的豆子和打完要不要收桌：输家最多输光身上的豆子（capLosses）；
   * 公开桌打完一局有人豆子低于入座门槛（底分 × 倍数），这桌直接散，不留座、不开下一场，大家回大厅。
   */
  private async settlementPlan(tx: Sql, room: Record<string, any>, ids: string[], postings: Posting[], endReason: 'completed' | 'dissolved') {
    const before = new Map<string, bigint>();
    for (const id of ids) before.set(id, beanUnits((await tx.query('SELECT balance::text FROM wallets WHERE user_id=$1 FOR UPDATE', [id])).rows[0]!.balance));
    const paid = normalizeScores(capLosses(normalizeScores(postings, ids, 'INVALID_SETTLEMENT'), before), ids, 'INVALID_SETTLEMENT');
    let lowUserIds: string[] = [];
    let threshold: Decimal | null = null;
    const after = (posting: Posting) => new Decimal(unitsMoney(before.get(posting.userId)! + beanUnits(posting.amount)));
    if (endReason === 'completed' && room.visibility === 'public') {
      threshold = await this.thresholdFor(tx, room);
      lowUserIds = paid.filter(posting => after(posting).lessThan(threshold!)).map(posting => posting.userId);
    } else if (endReason === 'completed' && room.current_round < room.rounds) {
      // 私人房不看门槛，有人输光（0 豆）下一局开不了，也直接散（DEC-20261102-私人房输光散房）。
      threshold = new Decimal(0);
      lowUserIds = paid.filter(posting => !after(posting).greaterThan(0)).map(posting => posting.userId);
    }
    const closed = endReason === 'dissolved' || room.current_round >= room.rounds || lowUserIds.length > 0;
    return { paid, lowUserIds, threshold, closed };
  }

  private async settle(tx: Sql, room: Record<string, any>, roundId: string, postings: Posting[], endReason: 'completed' | 'dissolved' = 'completed'): Promise<BalanceChange[]> {
    const members = await tx.query('SELECT user_id FROM room_members WHERE room_id=$1 ORDER BY user_id', [room.id]);
    const ids = members.rows.map(m => m.user_id);
    if ((await tx.query('SELECT 1 FROM ledger_operations WHERE request_key=$1', [`settlement:${roundId}`])).rows.length) return [];
    const plan = await this.settlementPlan(tx, room, ids, postings, endReason);
    postings = plan.paid;
    const operationSpec = { key: `settlement:${roundId}`, kind: 'round_settlement' as const, roomId: room.id, roundId,
      reason: endReason === 'dissolved' ? 'Confirmed scores at unanimous dissolution' : 'Automatic round settlement', postings };
    const operation = await appendOperation(tx, operationSpec);
    if (operation.replayed) return [];
    await tx.query('UPDATE room_members SET ready=false WHERE room_id=$1', [room.id]);
    // 第二轮 S3-AC4：同桌打完不再自动加好友（改成申请制），只刷新已是好友的最近同桌时间。
    for (const userId of ids) for (const friendId of ids) if (userId !== friendId) await tx.query('UPDATE friends SET last_played_at=now() WHERE user_id=$1 AND friend_id=$2', [userId, friendId]);
    if (endReason === 'dissolved') {
      const previous = (await tx.query('SELECT interaction_state FROM rounds WHERE id=$1', [roundId])).rows[0]?.interaction_state as InteractionState | null;
      if (previous) await tx.query('UPDATE rounds SET interaction_state=$2 WHERE id=$1', [roundId, JSON.stringify(finishInteractions(previous, this.now()))]);
    }
    await tx.query("UPDATE rounds SET state='settled',results=$2,settled_at=now(),end_reason=$3,next_action_at=NULL WHERE id=$1", [roundId, JSON.stringify(postings), endReason]);
    const closed = plan.closed;
    await tx.query('UPDATE rooms SET state=$2,closed_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1', [room.id, closed ? 'closed' : 'between_rounds', closed]);
    if (plan.lowUserIds.length) {
      const names = (await tx.query('SELECT m.user_id,a.nickname FROM room_members m JOIN accounts a ON a.id=m.user_id WHERE m.room_id=$1 ORDER BY m.seat', [room.id])).rows
        .filter(row => plan.lowUserIds.includes(row.user_id)).map(row => `「${row.nickname}」`);
      const message = room.visibility === 'public' ? `${names.join('、')}豆子不到这桌的 ${money(plan.threshold!)} 豆，房间自动解散，大家回大厅重新找桌。`
        : `${names.join('、')}豆子输光了，下一局开不了，房间自动解散，看完结算回大厅。`;
      await this.event(tx, room.id, SYSTEM_ACCOUNT_ID, `room-low-balance:${roundId}`, { type: 'room_closed_low_balance', userIds: plan.lowUserIds, threshold: money(plan.threshold!), message });
    } else if (closed && endReason === 'completed' && room.lobby_template_id) await this.nextMatch(tx, room);
    return balanceChanges(operation, operationSpec);
  }

  async leave(actor: Actor, roomId: string) {
    requireRole(actor, 'player');
    await this.db.transaction(async tx => {
      const room = await this.lockRoom(tx, roomId, actor.id);
      requireCondition(room.state === 'waiting' && room.current_round === 0, 'ROOM_STARTED', 'Use the dissolve vote after play has started.', 409);
      if (room.owner_id === actor.id) await tx.query("UPDATE rooms SET state='closed',closed_at=now() WHERE id=$1", [roomId]);
      else await tx.query('DELETE FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, actor.id]);
      await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [roomId]);
    });
    this.emit('changed', roomId);
    return { ok: true };
  }

  /**
   * 系统桌一场打完：同桌号开下一场，规则不变，上一场的人座位留 15 秒（第三轮 R5）。
   * 模板停用了就不接着开，桌子照常关掉。
   */
  private async nextMatch(tx: Sql, room: Record<string, any>) {
    const template = (await tx.query('SELECT enabled,variant_key FROM lobby_templates WHERE id=$1', [room.lobby_template_id])).rows[0];
    if (!template?.enabled || !isVisibleVariant(room.variant_key) || !supportsNewRoom(room.variant_key)) return;
    // 发布前开的新津老桌（v1）打完不再接着开，大家回大厅坐新规则的桌。
    if (room.variant_key === '4:0' && !isXinjinV2(room.rules ?? {})) return;
    const id = randomUUID();
    await tx.query(`INSERT INTO rooms(id,code,owner_id,variant_key,rule_version,rules,player_count,rounds,fee_mode,state,visibility,lobby_template_id,match_seq,previous_room_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting',$10,$11,$12,$13)`, [id, room.code, room.owner_id, room.variant_key, room.rule_version, JSON.stringify(room.rules),
      room.player_count, room.rounds, room.fee_mode, room.visibility, room.lobby_template_id, (room.match_seq ?? 1) + 1, room.id]);
    await tx.query(`INSERT INTO room_members(room_id,user_id,seat,hold_until) SELECT $1,user_id,seat,$3::timestamptz FROM room_members WHERE room_id=$2`,
      [id, room.id, new Date(this.now() + MATCH_HOLD_MS).toISOString()]);
  }

  /** 留座到时没点「再来一局」：座位空出来，大厅里别人能坐（第三轮 R5）。 */
  async releaseHolds(userId?: string) {
    const released = await this.db.query(`DELETE FROM room_members m USING rooms r WHERE r.id=m.room_id AND m.hold_until IS NOT NULL
      AND (m.user_id=$1 OR ($1::uuid IS NULL AND m.hold_until <= $2::timestamptz)) RETURNING m.room_id`, [userId ?? null, new Date(this.now()).toISOString()]);
    for (const roomId of new Set(released.rows.map(row => row.room_id as string))) this.emit('changed', roomId);
    return released.rows.length;
  }

  /** 一场打完弹的「继续 / 离开」要的信息：留座的桌号、还剩几秒、豆子够不够。 */
  async hold(userId: string) {
    const row = (await this.db.query(`SELECT r.*,m.hold_until FROM room_members m JOIN rooms r ON r.id=m.room_id
      WHERE m.user_id=$1 AND m.hold_until IS NOT NULL AND r.state <> 'closed' ORDER BY m.hold_until DESC LIMIT 1`, [userId])).rows[0];
    if (!row) return { hold: null };
    const required = await this.thresholdFor(this.db, row);
    const balance = new Decimal((await this.db.query('SELECT balance::text FROM wallets WHERE user_id=$1', [userId])).rows[0]?.balance ?? '0');
    return { hold: { code: row.code as string, matchSeq: row.match_seq as number, seconds: Math.max(0, Math.ceil((new Date(row.hold_until).getTime() - this.now()) / 1000)),
      threshold: money(required), enough: balance.greaterThanOrEqualTo(required), short: money(Decimal.max(0, required.minus(balance))) } };
  }

  /** 系统桌清座：坐下超过时限还没开局就请离，不扣豆（R2 AC4）。 */
  async clearIdleSeat(roomId: string, userId: string, idleMinutes: number): Promise<boolean> {
    const cleared = await this.db.transaction(async tx => {
      const room = (await tx.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE', [roomId])).rows[0];
      if (!room?.lobby_template_id || room.state !== 'waiting' || room.current_round !== 0) return false;
      const removed = await tx.query("DELETE FROM room_members WHERE room_id=$1 AND user_id=$2 AND joined_at <= now() - make_interval(mins => $3) RETURNING seat", [roomId, userId, idleMinutes]);
      if (!removed.rows.length) return false;
      await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [roomId]);
      await tx.query('INSERT INTO audit_events(id,actor_id,user_id,kind,details) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), SYSTEM_ACCOUNT_ID, userId, 'lobby_seat_cleared', JSON.stringify({ roomId, seat: removed.rows[0]!.seat, idleMinutes })]);
      return true;
    });
    if (cleared) { this.emit('seatCleared', { roomId, userId, idleMinutes }); this.emit('changed', roomId); }
    return cleared;
  }

  /** 后台调少常驻空桌或停用模板时，关掉多出来的空系统桌；有人坐了就不动。 */
  async closeEmptySystemRoom(roomId: string): Promise<boolean> {
    const closed = await this.db.transaction(async tx => {
      const room = (await tx.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE', [roomId])).rows[0];
      if (!room?.lobby_template_id || room.state !== 'waiting' || room.current_round !== 0) return false;
      if ((await tx.query('SELECT 1 FROM room_members WHERE room_id=$1 LIMIT 1', [roomId])).rows.length) return false;
      await tx.query("UPDATE rooms SET state='closed',closed_at=now() WHERE id=$1", [roomId]);
      return true;
    });
    if (closed) this.emit('changed', roomId);
    return closed;
  }

  async kick(actor: Actor, roomId: string, seatIndex: number) {
    requireRole(actor, 'player');
    const kicked = await this.db.transaction(async tx => {
      // Kick has its own wire result codes, so it must not reuse lockRoom's
      // generic ROOM_NOT_FOUND / NOT_ROOM_MEMBER errors.
      const found = await tx.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
      requireCondition(found.rows[0] && found.rows[0].state !== 'closed', 'KICK_ROOM_NOT_FOUND', 'Room does not exist.', 404);
      const room = found.rows[0];
      requireCondition(room.owner_id === actor.id, 'KICK_OWNER_MISMATCH', 'Only the room owner can remove a player.', 403);
      requireCondition(room.state === 'waiting' && room.current_round === 0, 'KICK_ROOM_STARTED', 'Players cannot be removed after play has started.', 409);
      const target = (await tx.query('SELECT user_id FROM room_members WHERE room_id=$1 AND seat=$2', [roomId, seatIndex])).rows[0];
      requireCondition(target && target.user_id !== room.owner_id, 'KICK_TARGET_NOT_IN_ROOM', 'That seat holds no removable player.', 404);
      await tx.query('DELETE FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, target.user_id]);
      await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [roomId]);
      await tx.query('INSERT INTO audit_events(id,actor_id,user_id,kind,details) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), actor.id, target.user_id, 'room_member_kicked', JSON.stringify({ roomId, seatIndex, kickedUserId: target.user_id })]);
      return { ok: true, seatIndex, userId: target.user_id as string };
    });
    this.emit('changed', roomId);
    return kicked;
  }

  async dissolve(actor: Actor, roomId: string, agree: boolean) {
    requireRole(actor, 'player');
    let committedBalances: BalanceChange[] = [];
    const result = await this.db.transaction(async tx => {
      const room = await this.lockRoom(tx, roomId, actor.id);
      if (room.state === 'closed' && agree) return { closed: true, votes: [] };
      requireCondition(room.state !== 'closed', 'ROOM_CLOSED', 'Room is already closed.', 409);
      // 大厅系统桌开局前只能退出，不能被玩家投票解散（R2 AC2）。
      requireCondition(!(room.lobby_template_id && room.current_round === 0 && room.state === 'waiting'), 'SYSTEM_ROOM_LEAVE', 'Leave a lobby table before play instead of dissolving it.', 409);
      if (room.current_round === 0 && room.owner_id === actor.id && agree) {
        await tx.query("UPDATE rooms SET state='closed',closed_at=now() WHERE id=$1", [roomId]);
        await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [roomId]);
        return { closed: true, votes: [] };
      }
      const expired = await tx.query("SELECT user_id FROM dissolve_votes WHERE room_id=$1 AND created_at < now()-interval '2 minutes'", [roomId]);
      if (expired.rows.length) await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [roomId]);
      if (!agree) {
        await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [roomId]);
        await this.event(tx, roomId, actor.id, `dissolve-rejected:${randomUUID()}`, { type: 'dissolve_rejected' });
        return { closed: false, rejected: true, votes: [] };
      }
      await tx.query('INSERT INTO dissolve_votes(room_id,user_id,agree) VALUES($1,$2,true) ON CONFLICT(room_id,user_id) DO NOTHING', [roomId, actor.id]);
      const votes = await tx.query('SELECT user_id AS "userId",agree FROM dissolve_votes WHERE room_id=$1', [roomId]);
      const memberCount = (await tx.query('SELECT COUNT(*)::int AS count FROM room_members WHERE room_id=$1', [roomId])).rows[0]!.count;
      const closed = votes.rows.length === memberCount;
      if (closed) {
        let settledRoundId: string | null = null;
        let interactionState: InteractionState | null = null;
        if (room.state === 'playing') {
          const round = (await tx.query("SELECT id,scoring_version FROM rounds WHERE room_id=$1 AND state='playing' FOR UPDATE", [roomId])).rows[0];
          requireCondition(round?.scoring_version === 1, 'CONFIRMED_SCORES_UNAVAILABLE', 'This historical round has no durable confirmed score history.', 409);
          const ids = (await tx.query('SELECT user_id FROM room_members WHERE room_id=$1 ORDER BY user_id', [roomId])).rows.map(member => member.user_id);
          committedBalances = await this.settle(tx, room, round.id, totalConfirmedScores(await this.scoreHistory(tx, round.id), ids), 'dissolved');
          settledRoundId = round.id;
          interactionState = (await tx.query('SELECT interaction_state FROM rounds WHERE id=$1', [round.id])).rows[0]!.interaction_state;
        }
        await tx.query("UPDATE rooms SET state='closed',closed_at=now() WHERE id=$1", [roomId]);
        await this.event(tx, roomId, actor.id, `room-dissolved:${randomUUID()}`, { type: 'room_dissolved', roundId: settledRoundId, confirmedScoresSettled: settledRoundId !== null,
          ...(interactionState ? { interactionState, atMs: interactionState.atMs } : {}) });
        await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [roomId]);
      }
      return { closed, votes: votes.rows };
    });
    if (committedBalances.length) this.emit('balanceChanged', committedBalances);
    this.emit('changed', roomId);
    return result;
  }

  async dissolveState(roomId: string): Promise<DissolveState | null> {
    const found = await this.db.query('SELECT v.user_id AS "userId",v.agree,v.created_at,m.seat FROM dissolve_votes v JOIN rooms r ON r.id=v.room_id JOIN room_members m ON m.room_id=v.room_id AND m.user_id=v.user_id WHERE v.room_id=$1 AND r.state <> \'closed\' ORDER BY v.created_at,m.seat', [roomId]);
    if (!found.rows.length) return null;
    return { initiatorId: found.rows[0]!.userId, expiresAt: new Date(found.rows[0]!.created_at).getTime() + 120000,
      votes: found.rows.map(row => ({ userId: row.userId, agree: row.agree, seat: row.seat })),
    };
  }

  /** Expired votes are cancelled, matching the existing dissolve request behavior. */
  async expireDissolve(roomId: string): Promise<boolean> {
    const expired = await this.db.transaction(async tx => {
      await tx.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
      const found = await tx.query("SELECT user_id FROM dissolve_votes WHERE room_id=$1 AND created_at <= now()-interval '2 minutes' LIMIT 1", [roomId]);
      if (!found.rows.length) return false;
      await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [roomId]);
      return true;
    });
    if (expired) this.emit('changed', roomId);
    return expired;
  }

  async chat(actor: Actor, roomId: string, content: { message?: string; faceId?: number; quickVoiceId?: number; mutualFaceId?: number; targetSeat?: number }) {
    requireRole(actor, 'player');
    requireCondition([content.message, content.faceId, content.quickVoiceId, content.mutualFaceId].filter(value => value !== undefined).length === 1, 'INVALID_CHAT', 'Exactly one chat payload is required.');
    if (content.message !== undefined) requireCondition(typeof content.message === 'string' && content.message.length > 0 && content.message.length <= 120, 'INVALID_CHAT', 'Invalid room chat message.');
    if (content.faceId !== undefined) requireCondition(Number.isInteger(content.faceId) && content.faceId >= 0 && content.faceId <= 14, 'INVALID_CHAT', 'Invalid original expression identifier.');
    if (content.quickVoiceId !== undefined) requireCondition(Number.isInteger(content.quickVoiceId) && content.quickVoiceId >= 0 && content.quickVoiceId <= 11, 'INVALID_CHAT', 'Invalid original quick voice identifier.');
    // 2–12 是原版互动表情，13–20 是第二轮新增的 8 个（S7）。
    if (content.mutualFaceId !== undefined) requireCondition(Number.isInteger(content.mutualFaceId) && content.mutualFaceId >= 2 && content.mutualFaceId <= 20 && Number.isInteger(content.targetSeat), 'INVALID_CHAT', 'Invalid original interaction.');
    else requireCondition(content.targetSeat === undefined, 'INVALID_CHAT', 'A target seat requires an interaction.');
    const room = await this.view(roomId, actor.id);
    requireCondition(room.state !== 'closed', 'ROOM_CLOSED', 'Room is closed.', 409);
    if (content.mutualFaceId !== undefined) requireCondition(room.members.some(member => member.seat === content.targetSeat), 'INVALID_CHAT', 'Interaction target is not seated in this room.');
    const event = { roomId, userId: actor.id, ...content };
    this.emit('chat', event);
    return { ok: true };
  }

  private async lockRoom(tx: Sql, roomId: string, userId: string) {
    const found = await tx.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
    requireCondition(found.rows[0], 'ROOM_NOT_FOUND', 'Room does not exist.', 404);
    const member = await tx.query('SELECT user_id FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, userId]);
    requireCondition(member.rows[0], 'NOT_ROOM_MEMBER', 'You are not in this room.', 403);
    return found.rows[0];
  }

  private async event(tx: Sql, roomId: string, userId: string, commandId: string, payload: unknown) {
    await tx.query('INSERT INTO game_events(room_id,sequence,actor_id,command_id,payload) SELECT $1,COALESCE(MAX(sequence),0)+1,$2,$3,$4 FROM game_events WHERE room_id=$1', [roomId, userId, commandId, JSON.stringify(payload)]);
  }
}
