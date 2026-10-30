import { isDeepStrictEqual } from 'node:util';
import { QIONGLAI_INDEPENDENT_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { EnginePlayer, EngineResult, RoundContext, RoundInput } from '../engines.js';
import { amount } from '../money.js';
import { roundTransfers } from '../transfers.js';
import { qionglaiBaoJiaoPointRequirement } from '../qionglai-scoring.js';
import { assertCardState, dealCards, moveCards, orderCards, projectCardState, type CardState } from './cards.js';
import { openClaims, projectClaims, resolveClaims, submitClaim, type ClaimWindow, type ClaimOffer } from './claims.js';
import { sameDeclaredWaits } from './declared-waits.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { createQionglaiCardState, qionglaiPackSpecification } from './qionglai-pack.js';
import { evaluateQionglaiWin, qionglaiWaits, type QionglaiHand, type QionglaiMeld, type QionglaiWin, type QionglaiWinContext } from './qionglai-win.js';
import { qionglaiWinPayments } from './qionglai-payments.js';

type Win = Extract<QionglaiWin, { status: 'winning' }>;
type Meld = { kind: QionglaiMeld['kind']; cardIds: string[] };
interface Player extends EnginePlayer {
  melds: Meld[];
  declared: number[] | null;
  /** Bonus cards present when the server froze this declaration. */
  declaredBonusIds: string[] | null;
}
type Source = { kind: QionglaiWinContext['source']; userId: string; cardId: string | null };
type Move =
  | { type: 'begin' | 'draw' | 'hu' }
  | { type: 'discard' | 'declare'; cardId: string }
  | { type: 'tou' | 'gang' | 'peng' | 'chi'; cardIds: string[] }
  | { type: 'ba'; cardId: string; meldIndex: number };
export type QionglaiAction = (Move | { type: 'respond'; choiceId: string | null }) & { decisionId: string };
interface Outcome {
  reason: 'hu' | 'draw';
  winners: { userId: string; win: Win }[];
  payments: ReturnType<typeof roundTransfers>;
  nextRoundContext: RoundContext;
}
export interface QionglaiRound {
  version: typeof QIONGLAI_INDEPENDENT_VERSION;
  number: number;
  rules: Record<string, unknown>;
  players: Player[];
  cards: CardState;
  dealerId: string;
  dealerRun: number;
  activeId: string;
  phase: 'opening' | 'discard' | 'draw' | 'response' | 'finished';
  serial: number;
  counters: { steals: number; replacements: number; discards: number };
  source: Source | null;
  claims: ClaimWindow | null;
  outcome: Outcome | null;
}
export interface QionglaiEvent { type: string; [key: string]: unknown }
const isBonus = (code: number) => [1001, 1002, 1003].includes(code);
const redPointsOf = (code: number) => {
  const rank = ordinaryRank(code);
  return [1, 3].includes(Math.floor(code / 100)) ? rank > 10 ? 1 : rank : 0;
};
const handZone = (id: string) => `hand:${id}`;
const meldZone = (id: string) => `melds:${id}`;
const bonusZone = (id: string) => `bonus:${id}`;
const decision = (s: QionglaiRound) => `ql:${s.number}:${s.serial}`;
const player = (s: QionglaiRound, id: string) => {
  const found = s.players.find(p => p.userId === id);
  requireCondition(found, 'NOT_ROOM_MEMBER', 'Only round members can act or view.', 403);
  return found;
};
const ids = (s: QionglaiRound, zone: string) => s.cards.zones.find(z => z.id === zone)!.cards;
const physical = (s: QionglaiRound, id: string) => s.cards.pack.find(c => c.id === id)!;
const cards = (s: QionglaiRound, zone: string) => ids(s, zone).map(id => physical(s, id));
const fullSize = (s: QionglaiRound, id: string) => 8 - 2 * player(s, id).melds.length;
function cycle(s: QionglaiRound, after: string) {
  const at = s.players.findIndex(p => p.userId === after);
  return [...s.players.slice(at + 1), ...s.players.slice(0, at + 1)].map(p => p.userId);
}
function hand(s: QionglaiRound, id: string, incoming?: string): QionglaiHand {
  return { concealed: [...cards(s, handZone(id)), ...(incoming ? [physical(s, incoming)] : [])],
    melds: player(s, id).melds.map(m => ({ kind: m.kind, cards: m.cardIds.map(cid => physical(s, cid)) })),
    bonus: cards(s, bonusZone(id)) };
}
function facts(s: QionglaiRound, id: string, source: Source): QionglaiWinContext {
  return { winnerSeat: player(s, id).seat, dealerSeat: player(s, s.dealerId).seat,
    source: source.kind, sourceSeat: source.kind === 'original-hand' ? null : player(s, source.userId).seat,
    incomingCardId: source.cardId, stealCount: s.counters.steals,
    replacementCount: s.counters.replacements, discardCount: s.counters.discards };
}
function winning(s: QionglaiRound, id: string, source: Source, external: boolean): Win | null {
  const p = player(s, id);
  if (p.declared && source.cardId && !p.declared.includes(physical(s, source.cardId).code)) return null;
  const h = hand(s, id, external ? source.cardId! : undefined);
  if (h.concealed.length !== fullSize(s, id)) return null;
  const win = evaluateQionglaiWin(h, facts(s, id, source), s.rules);
  return win.status === 'winning' ? win : null;
}
function stage(s: QionglaiRound, phase: QionglaiRound['phase'], activeId: string, source: Source | null = null) {
  s.phase = phase; s.activeId = activeId; s.source = source; s.claims = null; s.serial++;
}
function move(s: QionglaiRound, from: string, to: string, selected: string[]) {
  s.cards = moveCards(s.cards, from, to, selected);
}
function continuation(s: QionglaiRound, dealerId: string): RoundContext {
  return { version: s.version, completedRound: s.number, nextDealerId: dealerId,
    dealerRun: dealerId === s.dealerId ? s.dealerRun + 1 : 1 };
}
function finish(s: QionglaiRound, reason: Outcome['reason'], winners: Outcome['winners'], events: QionglaiEvent[]) {
  const members = s.players.map(p => p.userId);
  const payments = winners.length ? qionglaiWinPayments(members, winners, {
    kind: reason === 'draw' ? 'flip' : s.source!.kind, userId: s.source?.userId ?? s.dealerId,
  }, s.rules.baseBeans as string) : roundTransfers([], members);
  const dealerId = reason === 'hu' ? winners[0]!.userId : s.dealerId;
  s.outcome = { reason, winners, payments, nextRoundContext: continuation(s, dealerId) };
  stage(s, 'finished', s.activeId);
  events.push({ type: 'round-ended', reason, winnerIds: reason === 'hu' ? winners.map(w => w.userId) : [],
    postings: payments.postings });
}
function drawEnd(s: QionglaiRound, events: QionglaiEvent[]) {
  const called: Outcome['winners'] = [];
  if (s.rules.chaJiao === 1) {
    for (const p of s.players) {
      const h = hand(s, p.userId);
      if (h.concealed.length !== fullSize(s, p.userId) - 1 || h.concealed.some(c => isBonus(c.code))) continue;
      // A neutral other-player flip grants neither a hypothetical self-draw nor earth fan.
      const context = facts(s, p.userId, { kind: 'flip', userId: cycle(s, p.userId)[0]!, cardId: null });
      const waits = qionglaiWaits(h, { ...context, discardCount: Math.max(2, context.discardCount) }, s.rules)
        .filter(w => !p.declared || p.declared.includes(w.code));
      const best = waits.reduce<Win | null>((best, w) => !best || BigInt(w.result.scoreUnits) > BigInt(best.scoreUnits) ? w.result : best, null);
      if (best) called.push({ userId: p.userId, win: best });
    }
  }
  finish(s, 'draw', called, events);
}

/** Fill to the regional target; reward chains consume real deck cards until ordinary cards remain. */
function replenish(s: QionglaiRound, id: string, target: number, events: QionglaiEvent[]): string | null {
  let last: string | null = null;
  for (;;) {
    const rewards = cards(s, handZone(id)).filter(c => isBonus(c.code));
    for (const reward of rewards) {
      move(s, handZone(id), bonusZone(id), [reward.id]); s.counters.steals++;
      events.push({ type: 'bonus', userId: id, card: reward });
    }
    if (ids(s, handZone(id)).length >= target) return last;
    const next = ids(s, 'deck')[0];
    if (!next) { drawEnd(s, events); return null; }
    move(s, 'deck', handZone(id), [next]); s.counters.replacements++; last = next;
    events.push({ type: 'replacement', userId: id, card: physical(s, next), remaining: ids(s, 'deck').length });
  }
}

function declaration(s: QionglaiRound, id: string, discardId: string,
  bonusIds: readonly string[] = ids(s, bonusZone(id))): number[] {
  const h = hand(s, id);
  h.concealed = h.concealed.filter(c => c.id !== discardId);
  h.bonus = bonusIds.map(cardId => physical(s, cardId));
  const ordinary = [...h.concealed, ...h.melds.flatMap(m => m.cards)];
  const redPoints = ordinary.reduce((n, c) => n + redPointsOf(c.code), 0);
  const context = { ...facts(s, id, { kind: 'flip', userId: id, cardId: null }),
    stealCount: 0, replacementCount: 0 };
  return qionglaiWaits(h, context, s.rules).filter(w => {
    return qionglaiBaoJiaoPointRequirement(redPoints, redPointsOf(w.code), s.rules.baoJiaoYingbao as 0 | 1);
  }).map(w => w.code);
}

function ownMelds(s: QionglaiRound, id: string): Move[] {
  const p = player(s, id), h = cards(s, handZone(id));
  if (p.declared) return [];
  const moves: Move[] = p.melds.length < 3 ? ordinaryMeldCandidates(h, ['peng', 'gang'])
    .map(m => ({ type: m.kind === 'peng' ? 'tou' : 'gang', cardIds: [...m.cardIds] })) : [];
  p.melds.forEach((m, meldIndex) => {
    if (m.kind !== 'peng' && m.kind !== 'tou') return;
    for (const c of h) if (ordinaryRank(c.code) === ordinaryRank(physical(s, m.cardIds[0]!).code))
      moves.push({ type: 'ba', cardId: c.id, meldIndex });
  });
  return moves;
}

function offers(s: QionglaiRound, source: Source): ClaimOffer[] {
  const result: ClaimOffer[] = [];
  const incoming = physical(s, source.cardId!);
  const add = (userId: string, action: Move, priority: number) => result.push({
    id: `${decision(s)}:offer:${result.length}`, userId, action, priority, simultaneous: action.type === 'hu',
  });
  for (const id of cycle(s, source.userId)) {
    if (source.kind === 'discard' && id === source.userId) continue;
    if (winning(s, id, source, true)) add(id, { type: 'hu' }, 100);
    const p = player(s, id);
    if (p.declared) continue;
    if (p.melds.length < 3) {
      for (const m of ordinaryMeldCandidates([...cards(s, handZone(id)), incoming], ['chi', 'peng', 'gang'])) {
        if (!m.cardIds.includes(incoming.id)) continue;
        if (m.kind === 'chi' && id !== cycle(s, source.userId)[0] && !(source.kind === 'flip' && id === source.userId)) continue;
        add(id, { type: m.kind, cardIds: [...m.cardIds] }, m.kind === 'gang' ? 30 : m.kind === 'peng' ? 20 : 10);
      }
    }
    p.melds.forEach((m, meldIndex) => {
      if (['peng', 'tou'].includes(m.kind) && ordinaryRank(physical(s, m.cardIds[0]!).code) === ordinaryRank(incoming.code))
        add(id, { type: 'ba', cardId: incoming.id, meldIndex }, 30);
    });
  }
  return result;
}

function openResponse(s: QionglaiRound, source: Source, events: QionglaiEvent[]) {
  stage(s, 'response', source.userId, source);
  s.claims = openClaims(decision(s), cycle(s, source.userId), offers(s, source));
  if (!s.claims.offers.length) {
    move(s, 'table', 'discards', [source.cardId!]);
    stage(s, 'draw', cycle(s, source.userId)[0]!);
  } else events.push({ type: 'response-opened', decisionId: decision(s), sourceId: source.userId });
}

function performMeld(s: QionglaiRound, id: string, action: Move, external: boolean, events: QionglaiEvent[]) {
  const p = player(s, id);
  const resumePhase = external ? 'discard' : s.phase as 'draw' | 'discard';
  const incomingId = external ? s.source!.cardId! : null;
  let selected: string[];
  if (action.type === 'ba') {
    selected = [action.cardId];
    const m = p.melds[action.meldIndex]!;
    m.kind = 'ba'; m.cardIds.push(action.cardId);
  } else {
    requireCondition(['chi', 'peng', 'tou', 'gang'].includes(action.type) && 'cardIds' in action,
      'INVALID_ACTION', 'Expected a server-offered meld.', 409);
    selected = [...action.cardIds];
    p.melds.push({ kind: action.type as QionglaiMeld['kind'], cardIds: [...selected] });
  }
  if (incomingId) move(s, 'table', meldZone(id), [incomingId]);
  const fromHand = selected.filter(cid => cid !== incomingId);
  if (fromHand.length) move(s, handZone(id), meldZone(id), fromHand);
  events.push({ type: 'meld', userId: id, kind: action.type, cards: selected.map(cid => physical(s, cid)) });
  const replacement = replenish(s, id, fullSize(s, id) - (resumePhase === 'draw' ? 1 : 0), events);
  if (s.phase === 'finished') return;
  stage(s, resumePhase, id, replacement && resumePhase === 'discard'
    ? { kind: 'replacement', userId: id, cardId: replacement } : null);
}

/** Deterministic core only. The server must supply the complete policy-selected physical order. */
export function createQionglaiRound(input: RoundInput, orderedCardIds: readonly string[]): QionglaiRound {
  const players = [...input.players].sort((a, b) => a.seat - b.seat);
  requireCondition(players.length >= 2 && players.length <= 4 && players.length === input.rules.playerNum &&
    new Set(players.map(p => p.userId)).size === players.length &&
    players.every((p, i) => typeof p.userId === 'string' && p.userId.length > 0 && p.seat === i + 1) &&
    players.some(p => p.userId === input.ownerUserId) && Number.isSafeInteger(input.number) && input.number >= 1 &&
    [4, 8, 12].includes(input.rules.gameNum as number) && input.number <= (input.rules.gameNum as number) &&
    [0, 1].includes(input.rules.chaJiao as number) && [0, 1].includes(input.rules.baoJiaoYingbao as number) &&
    typeof input.rules.baseBeans === 'string' && amount(input.rules.baseBeans).gt(0),
  'INVALID_ROUND_INPUT', 'Explicit players, options, round number and positive base are required.', 500);
  let dealerId = input.ownerUserId, dealerRun = 1;
  if (input.number > 1) {
    const prior = input.previousRoundContext;
    requireCondition(prior?.version === QIONGLAI_INDEPENDENT_VERSION && prior.completedRound === input.number - 1 &&
      players.some(p => p.userId === prior.nextDealerId) &&
      Number.isSafeInteger(prior.dealerRun) && (prior.dealerRun as number) >= 1,
    'ROUND_CONTEXT_REQUIRED', 'A later round cannot guess the historical dealer.', 409);
    dealerId = prior.nextDealerId as string; dealerRun = prior.dealerRun as number;
  } else requireCondition(input.previousRoundContext === undefined, 'INVALID_ROUND_INPUT', 'First rounds have no previous context.', 500);
  let cardState = createQionglaiCardState('8:0', input.rules, 'deck', [
    { id: 'deck', visibility: 'hidden' }, { id: 'table', visibility: 'public' }, { id: 'discards', visibility: 'public' },
    ...players.flatMap(p => [{ id: handZone(p.userId), visibility: 'private' as const, ownerId: p.userId },
      { id: meldZone(p.userId), visibility: 'public' as const, ownerId: p.userId },
      { id: bonusZone(p.userId), visibility: 'public' as const, ownerId: p.userId }]),
  ]);
  cardState = orderCards(cardState, 'deck', orderedCardIds);
  const dealerAt = players.findIndex(p => p.userId === dealerId);
  const sequence = [...players.slice(dealerAt), ...players.slice(0, dealerAt)].map(p => handZone(p.userId));
  cardState = dealCards(cardState, 'deck', [...Array.from({ length: 7 }, () => sequence).flat(), handZone(dealerId)]);
  const s: QionglaiRound = { version: QIONGLAI_INDEPENDENT_VERSION, number: input.number,
    rules: structuredClone(input.rules),
    players: players.map(p => ({ ...p, melds: [], declared: null, declaredBonusIds: null })),
    cards: cardState, dealerId, dealerRun, activeId: dealerId, phase: 'opening', serial: 0,
    counters: { steals: 0, replacements: 0, discards: 0 },
    source: { kind: 'original-hand', userId: dealerId, cardId: null }, claims: null, outcome: null };
  // Validate frozen win options even if the opening hand contains special cards.
  evaluateQionglaiWin(hand(s, dealerId), facts(s, dealerId, s.source!), s.rules);
  assertQionglaiRound(s);
  return s;
}

export function qionglaiLegalActions(s: QionglaiRound, id: string): QionglaiAction[] {
  player(s, id);
  if (s.phase === 'finished') return [];
  if (s.phase === 'response') {
    const view = projectClaims(s.claims!, id);
    return view.options.length ? [...view.options.map(o => ({ type: 'respond' as const, choiceId: o.id, decisionId: view.id })),
      { type: 'respond', choiceId: null, decisionId: view.id }] : [];
  }
  if (s.activeId !== id) return [];
  const choices: Move[] = [];
  if (s.source && winning(s, id, s.source, false)) choices.push({ type: 'hu' });
  if (s.phase === 'opening') choices.push({ type: 'begin' });
  else {
    choices.push(...ownMelds(s, id));
    if (s.phase === 'draw') choices.push({ type: 'draw' });
    else {
      const p = player(s, id);
      for (const cardId of ids(s, handZone(id))) {
        const waits = declaration(s, id, cardId,
          p.declaredBonusIds ?? ids(s, bonusZone(id)));
        if (p.declared !== null && !sameDeclaredWaits(p.declared, waits)) continue;
        choices.push({ type: 'discard', cardId });
        if (p.declared === null && waits.length) choices.push({ type: 'declare', cardId });
      }
    }
  }
  return choices.map(action => ({ ...action, decisionId: decision(s) }));
}

export function applyQionglaiAction(previous: QionglaiRound, id: string, action: unknown): EngineResult {
  assertQionglaiRound(previous);
  requireCondition(action != null && typeof action === 'object' && 'decisionId' in action &&
    action.decisionId === decision(previous), 'STALE_CLAIM_WINDOW', 'The action belongs to a closed decision.', 409);
  requireCondition(qionglaiLegalActions(previous, id).some(candidate => isDeepStrictEqual(candidate, action)),
    'INVALID_ACTION', 'Choose an action offered by the server.', 409);
  const a = action as QionglaiAction, s = structuredClone(previous), events: QionglaiEvent[] = [];
  if (a.type === 'respond') {
    s.claims = submitClaim(s.claims!, a.decisionId, id, a.choiceId);
    const chosen = resolveClaims(s.claims);
    if (chosen) {
      if (!chosen.length) {
        const source = s.source!;
        move(s, 'table', 'discards', [source.cardId!]);
        stage(s, 'draw', cycle(s, source.userId)[0]!);
      } else if ((chosen[0]!.action as Move).type === 'hu') {
        finish(s, 'hu', chosen.map(c => ({ userId: c.userId, win: winning(s, c.userId, s.source!, true)! })), events);
      } else performMeld(s, chosen[0]!.userId, chosen[0]!.action as Move, true, events);
    }
  } else if (a.type === 'hu') {
    finish(s, 'hu', [{ userId: id, win: winning(s, id, s.source!, false)! }], events);
  } else if (a.type === 'begin') {
    let dealerReplacement: string | null = null;
    for (const current of [s.dealerId, ...cycle(s, s.dealerId).slice(0, -1)]) {
      const last = replenish(s, current, current === s.dealerId ? 8 : 7, events);
      if (current === s.dealerId) dealerReplacement = last;
      if (s.phase === 'finished') break;
    }
    if (s.phase !== 'finished') stage(s, 'discard', s.dealerId, dealerReplacement
      ? { kind: 'replacement', userId: s.dealerId, cardId: dealerReplacement } : null);
  } else if (a.type === 'draw') {
    const next = ids(s, 'deck')[0];
    if (!next) drawEnd(s, events);
    else if (isBonus(physical(s, next).code)) {
      move(s, 'deck', handZone(id), [next]);
      const last = replenish(s, id, fullSize(s, id), events);
      if (s.phase !== 'finished') stage(s, 'discard', id, { kind: 'replacement', userId: id, cardId: last! });
    } else {
      move(s, 'deck', 'table', [next]);
      events.push({ type: 'flip', userId: id, card: physical(s, next), remaining: ids(s, 'deck').length });
      openResponse(s, { kind: 'flip', userId: id, cardId: next }, events);
    }
  } else if (a.type === 'discard' || a.type === 'declare') {
    if (a.type === 'declare') {
      requireCondition(player(s, id).declared === null, 'INVALID_ACTION', 'A declared player cannot declare again.', 409);
      const bonusIds = [...ids(s, bonusZone(id))];
      player(s, id).declared = declaration(s, id, a.cardId, bonusIds);
      player(s, id).declaredBonusIds = bonusIds;
      requireCondition(player(s, id).declared!.length > 0, 'INVALID_ACTION', 'The selected discard cannot declare a legal wait.', 409);
    } else {
      const declared = player(s, id).declared;
      const declaredBonusIds = player(s, id).declaredBonusIds;
      requireCondition(declared === null || sameDeclaredWaits(declared,
        declaration(s, id, a.cardId, declaredBonusIds ?? [])),
        'INVALID_ACTION', 'A declared discard must preserve the complete locked wait set.', 409);
    }
    move(s, handZone(id), 'table', [a.cardId]); s.counters.discards++;
    const locked = player(s, id).declared;
    events.push({ type: 'discard', userId: id, card: physical(s, a.cardId), declared: a.type === 'declare',
      ...(locked ? { declaredWaits: [...locked] } : {}) });
    openResponse(s, { kind: 'discard', userId: id, cardId: a.cardId }, events);
  } else performMeld(s, id, a, false, events);
  assertQionglaiRound(s);
  return { snapshot: s, events, ...(s.outcome ? {
    confirmedScores: [{ eventId: `ql:${s.number}:final`, postings: s.outcome.payments.postings,
      transfers: s.outcome.payments.transfers }],
    settlement: s.outcome.payments.postings, nextRoundContext: s.outcome.nextRoundContext,
  } : {}) };
}

export function assertQionglaiRound(s: QionglaiRound): void {
  requireCondition(s.version === QIONGLAI_INDEPENDENT_VERSION, 'QIONGLAI_RULES_VERSION_REQUIRED', 'Unknown round version.', 409);
  assertCardState(s.cards);
  const capacity = qionglaiPackSpecification(s.rules.wangNum as number)
    .flatMap(entry => Array<number>(entry.count).fill(entry.code)).sort((a, b) => a - b);
  requireCondition(isDeepStrictEqual(s.cards.pack.map(c => c.code).sort((a, b) => a - b), capacity) &&
    [s.serial, s.counters.steals, s.counters.replacements, s.counters.discards].every(v => Number.isSafeInteger(v) && v >= 0) &&
    ['opening', 'discard', 'draw', 'response', 'finished'].includes(s.phase) &&
    s.players.some(p => p.userId === s.activeId) && s.players.some(p => p.userId === s.dealerId),
  'INVALID_QIONGLAI_STATE', 'Physical pack, phase and server counters must be consistent.', 500);
  for (const p of s.players) {
    requireCondition(p.declaredBonusIds == null ? p.declared == null :
      Array.isArray(p.declaredBonusIds) && p.declared !== null &&
      new Set(p.declaredBonusIds).size === p.declaredBonusIds.length &&
      p.declaredBonusIds.every(cardId => ids(s, bonusZone(p.userId)).includes(cardId)),
    'INVALID_QIONGLAI_STATE', 'Declared bonus snapshots must match the player state.', 500);
    requireCondition(isDeepStrictEqual(p.melds.flatMap(m => m.cardIds).sort(), [...ids(s, meldZone(p.userId))].sort()),
      'INVALID_QIONGLAI_STATE', 'Meld references must match the physical zone.', 500);
    if (s.phase === 'finished') continue;
    const expected = fullSize(s, p.userId) - (['opening', 'discard'].includes(s.phase) && s.activeId === p.userId ? 0 : 1);
    requireCondition(ids(s, handZone(p.userId)).length === expected, 'INVALID_QIONGLAI_STATE', 'Concealed hand count is inconsistent.', 500);
    requireCondition(s.phase === 'opening' || cards(s, handZone(p.userId)).every(c => !isBonus(c.code)),
      'INVALID_QIONGLAI_STATE', 'Unprocessed rewards cannot remain in a playable hand.', 500);
  }
  requireCondition(s.phase === 'response' ? s.claims?.id === decision(s) && ids(s, 'table').length === 1 &&
    s.source?.cardId === ids(s, 'table')[0] && ['flip', 'discard'].includes(s.source.kind)
    : s.claims === null && (s.phase === 'finished' || ids(s, 'table').length === 0),
  'INVALID_QIONGLAI_STATE', 'Public card and response phase must agree.', 500);
}

export function viewQionglaiRound(s: QionglaiRound, id: string) {
  player(s, id);
  return structuredClone({ version: s.version, number: s.number, phase: s.phase, dealerId: s.dealerId, activeId: s.activeId,
    decisionId: decision(s), cards: projectCardState(s.cards, id),
    players: s.players.map(p => ({ userId: p.userId, seat: p.seat, declared: p.declared !== null,
      melds: structuredClone(p.melds), ...(p.userId === id ? { declaredWaits: p.declared } : {}) })),
    legalActions: qionglaiLegalActions(s, id),
    responses: s.claims ? projectClaims(s.claims, id) : null,
    outcome: s.outcome ? { reason: s.outcome.reason, postings: s.outcome.payments.postings,
      winners: s.outcome.winners.map(w => ({ userId: w.userId, redPoints: w.win.redPoints,
        blackPoints: w.win.blackPoints, items: w.win.items, scoreUnits: w.win.scoreUnits })) } : null });
}

export function qionglaiTimedAction(s: QionglaiRound, id: string) {
  const actions = qionglaiLegalActions(s, id);
  if (!actions.length) return null;
  const hu = s.phase === 'response' ? actions.find(a => a.type === 'respond' && a.choiceId !== null &&
    (s.claims!.offers.find(o => o.id === a.choiceId)!.action as Move).type === 'hu') : actions.find(a => a.type === 'hu');
  const discards = actions.filter((a): a is QionglaiAction & { type: 'discard'; cardId: string } => a.type === 'discard');
  // Preserve the greatest number of disjoint sum-14 pairs using this player's hand only.
  const retainedPairs = (discardId: string) => {
    const counts = Array<number>(14).fill(0);
    for (const c of cards(s, handZone(id))) if (c.id !== discardId) counts[ordinaryRank(c.code)]!++;
    return Math.floor(counts[7]! / 2) + [1, 2, 3, 4, 5, 6].reduce((n, rank) => n + Math.min(counts[rank]!, counts[14 - rank]!), 0);
  };
  discards.sort((a, b) => retainedPairs(b.cardId) - retainedPairs(a.cardId) || a.cardId.localeCompare(b.cardId));
  const fallback = s.phase === 'response' ? actions.find(a => a.type === 'respond' && a.choiceId === null)
    : actions.find(a => a.type === 'begin' || a.type === 'draw') ?? discards[0];
  return { userId: id, decisionId: decision(s), delayMs: s.phase === 'response' ? 15000 : 30000, action: hu ?? fallback! };
}
