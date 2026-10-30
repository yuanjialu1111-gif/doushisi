import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { decodeFrame, encodeFrame, expectedBodyField, MSGEvent } from '@dss/protocol';
import { type Actor, requireRole } from './auth.js';
import { projectOriginalNotifications } from './engines.js';
import type { Database } from './database.js';
import type { ConfirmedScoreBatch, EngineRegistry, EngineOriginalPacket } from './engines.js';
import { AppError, requireCondition } from './errors.js';
import { applyConfirmedScores, normalizeScores, totalConfirmedScores } from './confirmed-scores.js';
import { finishInteractions, planInteractions, requireLegalAction, validateObservedDecision, type InteractionState } from './engine-interactions.js';
import { money, internalMoney, addMoney } from './money.js';
import { validateNextRoundContext } from './round-context.js';
import type { OriginalExtension } from './original-wire.js';
import { avatarUrl, wireSex } from './avatars.js';

export interface OriginalReplayPacket { command: number; body: Record<string, unknown>; decimalFields: { path: (string | number)[]; value: string }[]; roomOptions?: OriginalExtension['roomOptions'] }
export interface OriginalReplayFrame { index: number; sequence: string; stateVersion: number; at: string; autoPlay: boolean; snapshot: OriginalReplayPacket; packets: OriginalReplayPacket[] }
export interface OriginalReplayManifest {
  version: 1; roomId: string; roundId: string; variantKey: string; ruleVersion: string; number: number; endReason: 'completed' | 'dissolved';
  digest: string; frameCount: number; framesUrl: string; initial: OriginalReplayFrame; limits: { maxPageFrames: 50; maxPageBytes: 1048576 };
}
interface ReplayCapture { snapshot: unknown; confirmed: ConfirmedScoreBatch[]; interactionState: InteractionState | null; sequence: string; stateVersion: number; at: unknown; event?: Record<string, any> }
const originalPath = (roomId: string, roundId: string) => `/api/records/${roomId}/replay/${roundId}/original`;
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class ReplayService {
  private originalCache = new Map<string, { at: number; bytes: number; manifest: OriginalReplayManifest; frames: OriginalReplayFrame[] }>();
  private originalPending = new Map<string, Promise<{ manifest: OriginalReplayManifest; frames: OriginalReplayFrame[] }>>();
  constructor(private db: Database, private engines: EngineRegistry) {}

  async read(actor: Actor, roomId: string, roundId: string) {
    return this.rebuild(actor, roomId, roundId);
  }

  private async rebuild(actor: Actor, roomId: string, roundId: string, capture?: (state: ReplayCapture) => void) {
    requireRole(actor, 'player');
    const members = await this.db.query('SELECT user_id FROM room_members WHERE room_id=$1 ORDER BY user_id', [roomId]);
    const playerIds = members.rows.map(member => member.user_id);
    requireCondition(playerIds.includes(actor.id), 'NOT_ROOM_MEMBER', 'You are not a member of this room.', 403);
    const result = await this.db.query('SELECT q.*,r.variant_key,r.rule_version,r.rules FROM rounds q JOIN rooms r ON r.id=q.room_id WHERE q.id=$1 AND q.room_id=$2', [roundId, roomId]);
    const round = result.rows[0];
    requireCondition(round, 'ROUND_NOT_FOUND', 'Round does not exist.', 404);
    requireCondition(round.state === 'settled', 'REPLAY_NOT_AVAILABLE', 'Only completed rounds can be replayed.', 409);
    requireCondition(round.initial_snapshot !== null, 'REPLAY_ORIGIN_MISSING', 'This historical round has no recorded initial state.', 409);
    const engine = this.engines.get(round.variant_key, round.rule_version);
    const events = await this.db.query("SELECT e.sequence::text,e.command_id,e.actor_id,e.payload,e.created_at FROM game_events e WHERE e.room_id=$1 AND e.payload->>'roundId'=$2 ORDER BY e.sequence LIMIT 10001", [roomId, roundId]);
    requireCondition(events.rows.length <= 10000, 'REPLAY_TOO_LARGE', 'Round exceeds the replay action limit.', 409);
    if (capture) requireCondition(events.rows.filter(event => event.payload.type === 'round_started').length === 1,
      'ORIGINAL_REPLAY_UNAVAILABLE', 'The original round-start notification archive is missing.', 409);
    let snapshot = structuredClone(round.initial_snapshot);
    let confirmed: ConfirmedScoreBatch[] = [];
    let finalSettlement = false;
    let nextRoundContext: Record<string, unknown> | null = null;
    let stateVersion = 0;
    let interactionState = structuredClone(round.initial_interaction_state) as InteractionState | null;
    if (interactionState) {
      const rebuilt = planInteractions({ engine, snapshot, playerIds, roundId, atMs: interactionState.atMs,
        autoPlayUserIds: interactionState.autoPlayUserIds, previous: null });
      requireCondition(isDeepStrictEqual(rebuilt, interactionState), 'REPLAY_DIVERGED', 'The engine does not reproduce the initial operation deadlines.', 409);
    }
    const expectedScores: { eventId: string; postings: ConfirmedScoreBatch['postings']; commandId: string }[] = [];
    // Only the player's projected view leaves this service. Raw actions, deck,
    // policy metadata and unprojected engine events may contain hidden cards.
    const frame = (sequence: string, at: unknown, actorId: string | null, event?: Record<string, any>) => {
      capture?.({ snapshot: structuredClone(snapshot), confirmed: structuredClone(confirmed), interactionState: structuredClone(interactionState), sequence, stateVersion, at, event });
      return { sequence, stateVersion, at, actorId,
        autoPlayUserIds: interactionState?.autoPlayUserIds ?? [], game: capture ? null : structuredClone(engine.view(structuredClone(snapshot), actor.id)) };
    };
    const frames = [frame('0', round.started_at, null)];
    for (const event of events.rows) {
      if (!Object.hasOwn(event.payload, 'action')) {
        if (capture && event.payload.type === 'round_started') {
            const projected = Object.fromEntries(playerIds.map(userId => [userId, projectOriginalNotifications(engine, snapshot, [], userId, 'start')]));
          requireCondition(isDeepStrictEqual(jsonCopy(projected), event.payload.originalNotifications), 'REPLAY_DIVERGED', 'Initial original notifications differ from the frozen adapter.', 409);
        }
        if (interactionState && event.payload.type === 'autoplay_changed') {
          const autoPlayUserIds = interactionState.autoPlayUserIds.filter(userId => userId !== event.actor_id);
          if (event.payload.enabled) autoPlayUserIds.push(event.actor_id);
          interactionState = planInteractions({ engine, snapshot, playerIds, roundId, atMs: event.payload.atMs, autoPlayUserIds, previous: interactionState, stateVersion });
          requireCondition(isDeepStrictEqual(interactionState, event.payload.interactionState), 'REPLAY_DIVERGED', 'Autoplay changes do not reproduce the archived deadlines.', 409);
          frames.push(frame(event.sequence, event.created_at, event.actor_id, event));
        }
        if (interactionState && event.payload.type === 'room_dissolved') {
          interactionState = finishInteractions(interactionState, event.payload.atMs);
          requireCondition(isDeepStrictEqual(interactionState, event.payload.interactionState), 'REPLAY_DIVERGED', 'Dissolution did not clear the archived deadlines.', 409);
        }
        if (capture && event.payload.type === 'room_dissolved') frames.push(frame(event.sequence, event.created_at, event.actor_id, event));
        continue;
      }
      if (Object.hasOwn(event.payload, 'expectedStateVersion')) requireCondition(event.payload.expectedStateVersion === stateVersion
        && event.payload.stateVersion === stateVersion + 1, 'REPLAY_DIVERGED', 'Archived action versions are not sequential.', 409);
      if (event.payload.decision) validateObservedDecision(interactionState, event.actor_id,
        event.payload.decision.observedStateVersion, stateVersion, event.payload.decision.decisionId);
      stateVersion++;
      if (interactionState) {
        requireLegalAction(engine, snapshot, event.actor_id, event.payload.action);
        const source = event.payload.source;
        if (source === 'timeout' || source === 'autoplay') {
          const timer = interactionState.timers[0];
          requireCondition(timer && timer.id === event.payload.scheduledTimerId && timer.kind === source && timer.userId === event.actor_id
            && timer.dueAt <= event.payload.atMs && isDeepStrictEqual(timer.action, event.payload.action),
          'REPLAY_DIVERGED', 'The archived automatic action does not match the due engine decision.', 409);
        } else requireCondition(source === 'player' && !interactionState.timers.some(timer => timer.kind === 'timeout' && timer.dueAt <= event.payload.atMs),
          'REPLAY_DIVERGED', 'The archived player action missed its operation deadline.', 409);
      }
      const applied = engine.apply(snapshot, event.actor_id, event.payload.action);
      let continuation: Record<string, unknown> | null;
      try { continuation = validateNextRoundContext(applied); }
      catch { throw new AppError('REPLAY_DIVERGED', 'The engine emitted invalid continuation data during replay.', 409); }
      requireCondition(isDeepStrictEqual(continuation, event.payload.nextRoundContext ?? null),
        'REPLAY_DIVERGED', 'Actions do not reproduce the archived next-round context.', 409);
      if (applied.settlement !== undefined) nextRoundContext = continuation;
      if (capture) {
        const projected = Object.fromEntries(playerIds.map(userId => [userId, projectOriginalNotifications(engine, applied.snapshot, applied.events, userId, 'action')]));
        requireCondition(isDeepStrictEqual(jsonCopy(projected), event.payload.originalNotifications), 'REPLAY_DIVERGED', 'Original notifications differ from the frozen adapter.', 409);
        if (event.payload.original) {
          requireCondition(isDeepStrictEqual(engine.original!.decodeAction(event.payload.original.command, structuredClone(event.payload.original.body),
            event.payload.decision?.decisionId), event.payload.originalDecoded ?? event.payload.action),
            'REPLAY_DIVERGED', 'The original wire command no longer maps to its archived action.', 409);
          const response = engine.original!.response(event.payload.original.command, structuredClone(event.payload.original.body), structuredClone(applied.snapshot), event.actor_id);
          requireCondition(isDeepStrictEqual(jsonCopy(response), event.payload.originalResponse), 'REPLAY_DIVERGED', 'Original action response differs from the frozen adapter.', 409);
        }
      }
      if (round.scoring_version === 1) {
        requireCondition(!finalSettlement, 'REPLAY_DIVERGED', 'An action follows the final settlement.', 409);
        try {
          const scored = applyConfirmedScores(confirmed, applied, playerIds);
          requireCondition(isDeepStrictEqual(scored.appended, event.payload.confirmedScores)
            && isDeepStrictEqual(scored.settlement ?? null, event.payload.settlement),
          'REPLAY_DIVERGED', 'Engine score events differ from the archived action.', 409);
          confirmed = scored.all;
          finalSettlement = scored.settlement !== undefined;
          expectedScores.push(...scored.appended.map(batch => ({ ...batch, commandId: event.command_id })));
        } catch { throw new AppError('REPLAY_DIVERGED', 'Recorded actions do not reproduce the confirmed score history.', 409); }
      }
      if (interactionState) {
        interactionState = applied.settlement !== undefined ? finishInteractions(interactionState, event.payload.atMs)
          : planInteractions({ engine, snapshot: applied.snapshot, playerIds, roundId, atMs: event.payload.atMs,
            autoPlayUserIds: interactionState.autoPlayUserIds, previous: interactionState, consumedTimerId: event.payload.scheduledTimerId, stateVersion });
        requireCondition(isDeepStrictEqual(interactionState, event.payload.interactionState), 'REPLAY_DIVERGED', 'Actions do not reproduce the archived operation deadlines.', 409);
      }
      snapshot = applied.snapshot;
      frames.push(frame(event.sequence, event.created_at, event.actor_id, event));
    }
    requireCondition(isDeepStrictEqual(snapshot, round.snapshot), 'REPLAY_DIVERGED', 'Recorded actions do not reproduce the final round state.', 409);
    requireCondition(isDeepStrictEqual(nextRoundContext, round.next_round_context ?? null),
      'REPLAY_DIVERGED', 'Actions do not reproduce the stored next-round context.', 409);
    requireCondition(stateVersion === round.state_version, 'REPLAY_DIVERGED', 'Archived actions do not reproduce the stored state version.', 409);
    requireCondition(isDeepStrictEqual(interactionState, round.interaction_state) && round.next_action_at === null,
      'REPLAY_DIVERGED', 'Archived operation deadlines do not reproduce the final round state.', 409);
    if (round.scoring_version === 1) {
      const scores = await this.db.query('SELECT s.event_id AS "eventId",s.postings,s.transfers,s.command_id AS "commandId" FROM round_score_events s JOIN game_events e ON e.room_id=s.room_id AND e.command_id=s.command_id WHERE s.round_id=$1 ORDER BY e.sequence,s.ordinal', [roundId]);
      requireCondition(isDeepStrictEqual(expectedScores, scores.rows.map(({ transfers, ...batch }) => ({ ...batch, ...(transfers === null ? {} : { transfers }) }))), 'REPLAY_DIVERGED', 'Stored score events differ from the archived actions.', 409);
      requireCondition(finalSettlement === (round.end_reason === 'completed')
        && isDeepStrictEqual(totalConfirmedScores(confirmed, playerIds), normalizeScores(round.results, playerIds)),
      'REPLAY_DIVERGED', 'Confirmed scores do not reproduce the posted round results.', 409);
    }
    return { roomId, roundId, number: round.number, variantKey: round.variant_key, ruleVersion: round.rule_version,
      rules: round.rules, results: round.results, endReason: round.end_reason ?? 'completed', frames };
  }

  private originalPacket(packet: EngineOriginalPacket): OriginalReplayPacket {
    const field = expectedBodyField(packet.command);
    requireCondition(field && packet.body && typeof packet.body === 'object', 'INVALID_ORIGINAL_PROJECTION', 'Invalid original replay packet.', 409);
    const body = decodeFrame(encodeFrame({ cmd: packet.command, protoVersion: 2 }, { [field]: packet.body })).data[field] as Record<string, unknown>;
    const decimalFields = packet.decimalFields ?? [];
    for (const decimal of decimalFields) {
      requireCondition(Array.isArray(decimal.path) && decimal.path.length >= 2 && decimal.path.length <= 16 && decimal.path[0] === field &&
        decimal.path.every(part => typeof part === 'string' ? !['__proto__', 'constructor', 'prototype'].includes(part) : Number.isSafeInteger(part) && part >= 0),
      'INVALID_ORIGINAL_PROJECTION', 'Invalid replay decimal path.', 409);
      internalMoney(decimal.value);
    }
    return jsonCopy({ command: packet.command, body, decimalFields });
  }

  private async originalAccess(actor: Actor, roomId: string, roundId: string) {
    requireRole(actor, 'player');
    const member = await this.db.query('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, actor.id]);
    requireCondition(member.rows.length, 'NOT_ROOM_MEMBER', 'You are not a member of this room.', 403);
    const round = (await this.db.query('SELECT q.id,q.state,r.rule_version,r.variant_key FROM rounds q JOIN rooms r ON r.id=q.room_id WHERE q.id=$1 AND q.room_id=$2', [roundId, roomId])).rows[0];
    requireCondition(round, 'ROUND_NOT_FOUND', 'Round does not exist.', 404);
    requireCondition(round.state === 'settled', 'REPLAY_NOT_AVAILABLE', 'Only completed rounds can be replayed.', 409);
    const live = await this.db.query("SELECT 1 FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE m.user_id=$1 AND r.state<>'closed' LIMIT 1", [actor.id]);
    requireCondition(!live.rows.length, 'REPLAY_WHILE_IN_ROOM', 'Leave or finish the current room before opening an original-client replay.', 409);
    const engine = this.engines.get(round.variant_key, round.rule_version);
    requireCondition(engine.original, 'ORIGINAL_REPLAY_UNAVAILABLE', 'This archived rule version has no original replay adapter.', 409);
  }

  private async originalVerified(actor: Actor, roomId: string, roundId: string) {
    await this.originalAccess(actor, roomId, roundId);
    const key = `${actor.id}:${roomId}:${roundId}`;
    for (const [entry, item] of this.originalCache) if (Date.now() - item.at > 30000) this.originalCache.delete(entry);
    const cached = this.originalCache.get(key);
    if (cached) { this.originalCache.delete(key); this.originalCache.set(key, cached); return cached; }
    const pending = this.originalPending.get(key); if (pending) return pending;
    requireCondition(this.originalPending.size < 4, 'REPLAY_BUSY', 'Replay verification is busy. Try again shortly.', 429);
    const promise = this.buildOriginal(actor, roomId, roundId);
    this.originalPending.set(key, promise);
    try {
      const value = await promise;
      const bytes = Buffer.byteLength(JSON.stringify(value));
      let used = [...this.originalCache.values()].reduce((sum, item) => sum + item.bytes, 0);
      for (const [entry, item] of this.originalCache) { if (used + bytes <= 32 * 1024 * 1024) break; this.originalCache.delete(entry); used -= item.bytes; }
      this.originalCache.set(key, { ...value, at: Date.now(), bytes });
      return value;
    } finally { this.originalPending.delete(key); }
  }

  private async buildOriginal(actor: Actor, roomId: string, roundId: string) {
    const rawBytes = (await this.db.query("SELECT COALESCE(SUM(pg_column_size(payload)),0)::text AS bytes FROM game_events WHERE room_id=$1 AND payload->>'roundId'=$2", [roomId, roundId])).rows[0]!.bytes;
    requireCondition(Number(rawBytes) <= 64 * 1024 * 1024, 'REPLAY_TOO_LARGE', 'The original replay archive exceeds its verification budget.', 409);
    const info = (await this.db.query('SELECT r.*,q.number,q.end_reason FROM rounds q JOIN rooms r ON r.id=q.room_id WHERE q.id=$1 AND q.room_id=$2', [roundId, roomId])).rows[0]!;
    const adapter = this.engines.get(info.variant_key, info.rule_version).original!;
    const members = (await this.db.query('SELECT m.user_id,m.seat,a.nickname,a.avatar_hash AS "avatarHash",a.avatar_status AS "avatarStatus",a.sex FROM room_members m JOIN accounts a ON a.id=m.user_id WHERE m.room_id=$1 ORDER BY m.seat', [roomId])).rows;
    for (const member of members) {
      const existing = (await this.db.query("SELECT wire_id FROM original_protocol_ids WHERE entity_kind='user' AND entity_id=$1", [member.user_id])).rows[0];
      member.wireId = String(existing?.wire_id ?? (await this.db.query("INSERT INTO original_protocol_ids(entity_kind,entity_id) VALUES('user',$1) ON CONFLICT(entity_kind,entity_id) DO UPDATE SET entity_id=EXCLUDED.entity_id RETURNING wire_id", [member.user_id])).rows[0]!.wire_id);
    }
    const priorScores = new Map<string, string>(members.map(member => [member.user_id, '0']));
    const prior = await this.db.query("SELECT results FROM rounds WHERE room_id=$1 AND number<$2 AND state='settled' ORDER BY number", [roomId, info.number]);
    for (const row of prior.rows) for (const posting of row.results ?? []) priorScores.set(posting.userId, addMoney(priorScores.get(posting.userId)!, posting.amount));
    const gameId = Number(info.variant_key.split(':')[0]);
    const table = { ...info.rules, roomId: Number(info.code), roomType: 100, areaType: gameId === 101 ? 6 : gameId,
      creatorUid: members.find(member => member.user_id === info.owner_id)!.wireId, playerNum: info.player_count, gameNum: info.rounds,
      useCardType: info.fee_mode === 'owner' ? 1 : 2, ...(gameId === 101 ? { processType: 2 } : {}) };
    delete table.region;
    const frames: OriginalReplayFrame[] = []; let totalBytes = 0;
    const rebuilt = await this.rebuild(actor, roomId, roundId, capture => {
      const game = adapter.enter(structuredClone(capture.snapshot), actor.id);
      const fields = [...(game.decimalFields ?? [])];
      const earned = new Map(totalConfirmedScores(capture.confirmed, members.map(member => member.user_id)).map(posting => [posting.userId, posting.amount]));
      const users = members.map((member, index) => {
        fields.push({ path: ['hwResponseEnterTableFinish', 'userInfo', index, 'score'], value: addMoney(priorScores.get(member.user_id)!, earned.get(member.user_id)!) });
        fields.push({ path: ['hwResponseEnterTableFinish', 'userInfo', index, 'changeScore'], value: earned.get(member.user_id)! });
        return { uid: member.wireId, nick: member.nickname, picUrl: avatarUrl({ id: member.user_id, avatarHash: member.avatarHash, avatarStatus: member.avatarStatus }), seatIndex: member.seat,
          score: '0', changeScore: '0', isReady: true, online: false, sex: wireSex(member.sex), headType: 0 };
      });
      const snapshot = this.originalPacket({ command: 48, body: { ...game.body, result: 1, tableInfo: table, userInfo: users,
        seatIndex: members.find(member => member.user_id === actor.id)!.seat, round: info.number, showPipeiPic: false, pipeiCd: 0,
        shiName: info.rules.region?.shiName ?? '四川省', xianName: info.rules.region?.xianName ?? '其他区域' }, decimalFields: fields });
      if (info.rules.baseBeans && info.rules.baseBeansSource && info.rules.playerNumSource) {
        const ql = info.rules.qionglai;
        snapshot.roomOptions = { baseBeans: info.rules.baseBeans, baseBeansSource: info.rules.baseBeansSource,
          playerNum: info.player_count, playerNumSource: info.rules.playerNumSource,
          ...(ql ? { qionglai: { version: ql.version, qlTianDiHu: ql.qlTianDiHu, qlHongHeiHu: ql.qlHongHeiHu, qlHongHei50: ql.qlHongHei50 } } : {}) };
      }
      const event = capture.event;
      let packets: EngineOriginalPacket[] = event?.payload.originalNotifications?.[actor.id] ?? [];
      if (event?.payload.type === 'autoplay_changed' && event.actor_id === actor.id) packets = [{ command: event.payload.enabled ? 123 : 126, body: event.payload.enabled ? {} : { result: 1 } }];
      if (event?.payload.type === 'room_dissolved') packets = [{ command: 32, body: { roomId: Number(info.code), result: true, dating: false } }];
      for (const packet of packets) requireCondition(packet.command === 126 || Object.entries(MSGEvent).some(([name, command]) => command === packet.command && (name.startsWith('HWNotify') || name.startsWith('HWNottify'))),
        'INVALID_ORIGINAL_PROJECTION', 'Replay actions may contain only original notifications.', 409);
      const frame: OriginalReplayFrame = { index: frames.length, sequence: capture.sequence, stateVersion: capture.stateVersion,
        at: new Date(capture.at as string).toISOString(), autoPlay: capture.interactionState?.autoPlayUserIds.includes(actor.id) ?? false,
        snapshot, packets: packets.map(packet => this.originalPacket(packet)) };
      const bytes = Buffer.byteLength(JSON.stringify(frame)); totalBytes += bytes;
      requireCondition(bytes <= 262144 && totalBytes <= 24 * 1024 * 1024 && frames.length < 10001, 'REPLAY_TOO_LARGE', 'The projected replay exceeds its frame or byte limit.', 409);
      frames.push(frame);
    });
    const base = { version: 1 as const, roomId, roundId, variantKey: rebuilt.variantKey, ruleVersion: rebuilt.ruleVersion, number: rebuilt.number,
      endReason: rebuilt.endReason as 'completed' | 'dissolved', frameCount: frames.length, framesUrl: `${originalPath(roomId, roundId)}/frames` };
    const digest = createHash('sha256').update(JSON.stringify({ ...base, frames })).digest('hex');
    const manifest: OriginalReplayManifest = { ...base, digest, initial: frames[0]!, limits: { maxPageFrames: 50, maxPageBytes: 1048576 } };
    return { manifest, frames };
  }

  async originalManifest(actor: Actor, roomId: string, roundId: string): Promise<OriginalReplayManifest> {
    const value = await this.originalVerified(actor, roomId, roundId);
    await this.originalAccess(actor, roomId, roundId);
    return jsonCopy(value.manifest);
  }

  async originalPage(actor: Actor, roomId: string, roundId: string, offset: number, limit: number, digest: string) {
    requireCondition(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 50 && /^[0-9a-f]{64}$/.test(digest),
      'INVALID_REPLAY_PAGE', 'Invalid original replay pagination.', 400);
    const value = await this.originalVerified(actor, roomId, roundId);
    await this.originalAccess(actor, roomId, roundId);
    requireCondition(value.manifest.digest === digest, 'REPLAY_VERSION_CONFLICT', 'Reload the original replay manifest.', 409);
    requireCondition(offset <= value.frames.length, 'INVALID_REPLAY_PAGE', 'Replay offset is outside the frame range.', 400);
    const frames: OriginalReplayFrame[] = []; let bytes = 1024;
    for (const frame of value.frames.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(frame)); if (bytes + size > 1048576) break;
      frames.push(frame); bytes += size;
    }
    return jsonCopy({ version: 1, digest, frameCount: value.frames.length, offset, nextOffset: offset + frames.length < value.frames.length ? offset + frames.length : null, frames });
  }
}
