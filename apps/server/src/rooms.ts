import { randomInt, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { catalogue, supportsNewRoom, freezeQionglaiOptions, freezeYaanOptions, freezeXinjinOptions, freezeAnyueOptions, freezePujiangOptions, freezeAbaOptions, freezeScoreRegionOptions, freezeIndependentApproval, getVariant, validateRoomOptions, getDefaultOptions, getRoomSpec, baseScoreDecimal } from '@dss/rules';
import { encodeFrame, expectedBodyField, MSGEvent } from '@dss/protocol';
import type { Database, Sql } from './database.js';
import { requireRole, type Actor } from './auth.js';
import { requireCondition } from './errors.js';
import { EngineRegistry, projectOriginalNotifications, type ConfirmedScoreBatch, type OriginalActionContext, type EngineOriginalBody, type RuleEngine } from './engines.js';
import { applyConfirmedScores, normalizeScores, totalConfirmedScores } from './confirmed-scores.js';
import { appendOperation, balanceChanges, requestHash, type BalanceChange, type Posting } from './ledger.js';
import { Decimal, amount, money } from './money.js';
import { PolicyService } from './policies.js';
import { TRANSFER_ROUNDING_VERSION } from './transfers.js';
import { engineLegalActions, finishInteractions, nextScheduledAt, planInteractions, requireLegalAction, validateObservedDecision, type InteractionState, type ScheduledEngineAction } from './engine-interactions.js';
import { validateNextRoundContext } from './round-context.js';
import { avatarUrl } from './avatars.js';

export interface DissolveState {
  initiatorId: string;
  expiresAt: number;
  votes: { userId: string; agree: boolean; seat: number }[];
}

export class RoomService extends EventEmitter {
  constructor(private db: Database, public engines: EngineRegistry, private policies: PolicyService, private now: () => number = Date.now) { super(); }

  games() { return catalogue.map(variant => ({ ...variant, defaults: getDefaultOptions(variant.key), fields: getRoomSpec(variant.key).fields, playable: this.engines.has(variant.key) })); }

  async current(userId: string) {
    const found = await this.db.query("SELECT r.id FROM rooms r JOIN room_members m ON r.id=m.room_id WHERE m.user_id=$1 AND r.state <> 'closed' ORDER BY r.created_at DESC LIMIT 1", [userId]);
    return found.rows[0] ? this.view(found.rows[0].id, userId) : null;
  }

  async create(actor: Actor, variantKey: string, options: Record<string, unknown>, region?: unknown) {
    requireRole(actor, 'player');
    requireCondition(supportsNewRoom(variantKey), 'GAME_REMOVED', 'This game is not available in the regional edition.', 409);
    requireCondition(variantKey !== '6:0' || options.processType !== 2, 'GAME_REMOVED', 'Red-twenty blood-battle is not included in this edition.', 409);
    const variant = getVariant(variantKey);
    requireCondition(variant, 'UNKNOWN_VARIANT', 'Unknown game configuration.');
    const spec = getRoomSpec(variantKey, region as never);
    const requestedBaseBeans = options.baseBeans;
    const requestedPlayerNum = options.playerNum;
    const ruleOptions = Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'baseBeans' &&
      !(key === 'playerNum' && spec.unresolvedFields.includes('playerNum'))));
    const normalized = validateRoomOptions(variantKey, { ...getDefaultOptions(variantKey, region as never), ...ruleOptions }, region as never) as Record<string, any>;
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
    const id = randomUUID();
    await this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`player-room:${actor.id}`]);
      await this.requireNoRoom(tx, actor.id);
      // A single creation lock prevents room-code collisions without retrying an aborted transaction.
      await tx.query('SELECT pg_advisory_xact_lock(2026090901)');
      let code: string;
      do { code = String(randomInt(100000, 1000000)); }
      while ((await tx.query("SELECT id FROM rooms WHERE code=$1 AND state <> 'closed'", [code])).rows.length);
      const version = this.engines.has(variantKey) ? this.engines.get(variantKey).version : variant.ruleVersion;
      await tx.query("INSERT INTO rooms(id,code,owner_id,variant_key,rule_version,rules,player_count,rounds,fee_mode,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting')", [id, code, actor.id, variantKey, version, JSON.stringify({ ...normalized, playerNumSource, baseBeans, baseBeansSource, region, roundingVersion: TRANSFER_ROUNDING_VERSION,
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
            variantKey as '14:0' | '15:0' | '16:0' | '19:0' | '20:0' | '21:0' | '22:0' | '23:0' | '24:0' | '25:0' | '26:0' | '27:0') } : {}) }),
      normalized.playerNum,
      normalized.gameNum, normalized.useCardType === 1 ? 'owner' : 'aa']);
      await tx.query('INSERT INTO room_members(room_id,user_id,seat) VALUES($1,$2,1)', [id, actor.id]);
    });
    return this.view(id, actor.id);
  }

  async join(actor: Actor, code: string) {
    requireRole(actor, 'player');
    requireCondition(/^\d{6}$/.test(code), 'INVALID_ROOM_CODE', 'Room number must have six digits.');
    const id = await this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`player-room:${actor.id}`]);
      const found = await tx.query("SELECT * FROM rooms WHERE code=$1 AND state <> 'closed' FOR UPDATE", [code]);
      requireCondition(found.rows[0], 'ROOM_NOT_FOUND', 'Room does not exist.', 404);
      const room = found.rows[0];
      const members = await tx.query('SELECT user_id,seat FROM room_members WHERE room_id=$1', [room.id]);
      if (members.rows.some(m => m.user_id === actor.id)) return room.id;
      requireCondition(supportsNewRoom(room.variant_key), 'GAME_REMOVED', 'This game is no longer accepting players.', 409);
      await this.requireNoRoom(tx, actor.id);
      requireCondition(room.state === 'waiting' && room.current_round === 0, 'ROOM_STARTED', 'This room has already started.', 409);
      requireCondition(members.rows.length < room.player_count, 'ROOM_FULL', 'Room is full.', 409);
      let seat = 1;
      while (members.rows.some(m => m.seat === seat)) seat++;
      await tx.query('INSERT INTO room_members(room_id,user_id,seat) VALUES($1,$2,$3)', [room.id, actor.id, seat]);
      await tx.query('DELETE FROM dissolve_votes WHERE room_id=$1', [room.id]);
      return room.id as string;
    });
    this.emit('changed', id);
    return this.view(id, actor.id);
  }

  private async requireNoRoom(tx: Sql, userId: string) {
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
        const snapshot = engine.create({ players: members.rows.map(m => ({ userId: m.user_id, seat: m.seat })), ownerUserId: room.owner_id,
          rules: room.rules, number: room.current_round + 1, policy,
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
      if (room.roundId) {
        const adapter = this.engines.get(room.variantKey, room.ruleVersion).original;
        requireCondition(adapter, 'ORIGINAL_ADAPTER_UNAVAILABLE', 'This rule version has no verified original-client adapter.', 409);
        const round = (await tx.query('SELECT snapshot FROM rounds WHERE id=$1', [room.roundId])).rows[0]!;
        game = adapter.enter(structuredClone(round.snapshot), actor.id);
        this.validateOriginalBody(48, game);
      }
      return { room, game, sequence };
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
    await tx.query('UPDATE rounds SET snapshot=$2,state_version=state_version+1,interaction_state=$3,next_action_at=$4,next_round_context=$5 WHERE id=$1',
      [round.id, JSON.stringify(result.snapshot), interactionState ? JSON.stringify(interactionState) : null, this.scheduledTimestamp(interactionState),
        nextRoundContext === null ? null : JSON.stringify(nextRoundContext)]);
    await this.event(tx, room.id, userId, commandId, { commandHash, roundId: round.id, action: engineAction, expectedStateVersion: round.state_version,
      stateVersion: round.state_version + 1, events: result.events, source: scheduled?.kind ?? 'player', atMs,
      ...(decision ? { decision } : {}),
      ...(original ? { original, originalDecoded: action, originalResponse } : {}),
      ...(engine.original ? { originalNotifications: this.originalNotifications(engine, result.snapshot, result.events, memberIds, 'action'),
        originalRoomState: result.settlement ? { roomId: room.current_round >= room.rounds ? null : room.id, roundId: null, stateVersion: null }
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

  private async settle(tx: Sql, room: Record<string, any>, roundId: string, postings: Posting[], endReason: 'completed' | 'dissolved' = 'completed'): Promise<BalanceChange[]> {
    const members = await tx.query('SELECT user_id FROM room_members WHERE room_id=$1 ORDER BY user_id', [room.id]);
    const ids = members.rows.map(m => m.user_id);
    postings = normalizeScores(postings, ids, 'INVALID_SETTLEMENT');
    const operationSpec = { key: `settlement:${roundId}`, kind: 'round_settlement' as const, roomId: room.id, roundId,
      reason: endReason === 'dissolved' ? 'Confirmed scores at unanimous dissolution' : 'Automatic round settlement', postings };
    const operation = await appendOperation(tx, operationSpec);
    if (operation.replayed) return [];
    await tx.query('UPDATE room_members SET ready=false WHERE room_id=$1', [room.id]);
    for (const userId of ids) for (const friendId of ids) if (userId !== friendId) await tx.query('INSERT INTO friends(user_id,friend_id,first_room_id) VALUES($1,$2,$3) ON CONFLICT(user_id,friend_id) DO UPDATE SET last_played_at=now()', [userId, friendId, room.id]);
    if (endReason === 'dissolved') {
      const previous = (await tx.query('SELECT interaction_state FROM rounds WHERE id=$1', [roundId])).rows[0]?.interaction_state as InteractionState | null;
      if (previous) await tx.query('UPDATE rounds SET interaction_state=$2 WHERE id=$1', [roundId, JSON.stringify(finishInteractions(previous, this.now()))]);
    }
    await tx.query("UPDATE rounds SET state='settled',results=$2,settled_at=now(),end_reason=$3,next_action_at=NULL WHERE id=$1", [roundId, JSON.stringify(postings), endReason]);
    const closed = endReason === 'dissolved' || room.current_round >= room.rounds;
    await tx.query('UPDATE rooms SET state=$2,closed_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1', [room.id, closed ? 'closed' : 'between_rounds', closed]);
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
    if (content.mutualFaceId !== undefined) requireCondition(Number.isInteger(content.mutualFaceId) && content.mutualFaceId >= 2 && content.mutualFaceId <= 12 && Number.isInteger(content.targetSeat), 'INVALID_CHAT', 'Invalid original interaction.');
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
