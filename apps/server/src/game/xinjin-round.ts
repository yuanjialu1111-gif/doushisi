import { isDeepStrictEqual } from 'node:util';
import { XINJIN_INDEPENDENT_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { EnginePlayer, EngineResult, RoundContext, RoundInput } from '../engines.js';
import { amount } from '../money.js';
import { baseTimesRatio, roundTransfers } from '../transfers.js';
import { assertCardState, dealCards, moveCards, orderCards, projectCardState, type CardState } from './cards.js';
import { openClaims, projectClaims, resolveClaims, submitClaim, type ClaimWindow, type ClaimOffer } from './claims.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { declaredWaitMatches, sameDeclaredWaits } from './declared-waits.js';
import { createXinjinCardState, xinjinPackSpecification } from './xinjin-pack.js';
import { evaluateXinjinWin, type XinjinHand, type XinjinWin, type XinjinWinContext } from './xinjin-win.js';

type Win = Extract<XinjinWin, { status: 'winning' }>;
type Meld = { kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou'; cardIds: string[] };
interface Player extends EnginePlayer { melds: Meld[]; declaredWaits: number[] | null; declaredBonusIds: string[] | null }
type Source = { kind: XinjinWinContext['source']; userId: string; cardId: string | null };
type Move = { type: 'begin' | 'draw' | 'hu' } | { type: 'discard' | 'declare'; cardId: string }
  | { type: 'tou' | 'gang' | 'peng' | 'chi'; cardIds: string[] } | { type: 'ba'; cardId: string; meldIndex: number };
export type XinjinAction = (Move | { type: 'respond'; choiceId: string | null }) & { decisionId: string };
interface Outcome { reason: 'hu' | 'draw'; winners: { userId: string; win: Win }[];
  payments: ReturnType<typeof roundTransfers>; nextRoundContext: RoundContext }
export interface XinjinRound {
  version: typeof XINJIN_INDEPENDENT_VERSION; number: number; rules: Record<string, unknown>;
  players: Player[]; cards: CardState; dealerId: string; dealerRun: number; activeId: string;
  phase: 'opening' | 'discard' | 'draw' | 'response' | 'finished'; serial: number;
  source: Source | null; claims: ClaimWindow | null; outcome: Outcome | null;
}
export interface XinjinEvent { type: string; [key: string]: unknown }
const isSpecial = (code: number) => [1001, 1002, 1003].includes(code);
export function assertXinjinOptionsSupported(rules: Readonly<Record<string, unknown>>): void {
  requireCondition(rules.baoJiao === 0 || rules.baoJiao === 1, 'INVALID_XINJIN_OPTION',
    'Xinjin baoJiao must be frozen as numeric 0 or 1.', 409);
}
const handZone = (id: string) => `hand:${id}`;
const meldZone = (id: string) => `melds:${id}`;
const bonusZone = (id: string) => `bonus:${id}`;
const decision = (state: XinjinRound) => `xj:${state.number}:${state.serial}`;
const player = (state: XinjinRound, id: string) => {
  const found = state.players.find(item => item.userId === id);
  requireCondition(found, 'NOT_ROOM_MEMBER', 'Only round members can act or view.', 403);
  return found;
};
const ids = (state: XinjinRound, zone: string) => state.cards.zones.find(item => item.id === zone)!.cards;
const physical = (state: XinjinRound, id: string) => state.cards.pack.find(card => card.id === id)!;
const cards = (state: XinjinRound, zone: string) => ids(state, zone).map(id => physical(state, id));
const fullSize = (state: XinjinRound, id: string) => 8 - 2 * player(state, id).melds.length;
function normalizeDeclarations(state: XinjinRound): void {
  for (const current of state.players as (Player & { declaredWaits?: number[] | null; declaredBonusIds?: string[] | null })[]) {
    if (current.declaredWaits === undefined && current.declaredBonusIds === undefined) {
      current.declaredWaits = null;
      current.declaredBonusIds = null;
    }
  }
}
function cycle(state: XinjinRound, after: string) {
  const at = state.players.findIndex(item => item.userId === after);
  return [...state.players.slice(at + 1), ...state.players.slice(0, at + 1)].map(item => item.userId);
}
function hand(state: XinjinRound, id: string, incoming?: string): XinjinHand {
  return { concealed: [...cards(state, handZone(id)), ...(incoming ? [physical(state, incoming)] : [])],
    melds: player(state, id).melds.map(meld => ({ kind: meld.kind, cards: meld.cardIds.map(cardId => physical(state, cardId)) })),
    bonus: cards(state, bonusZone(id)) };
}
function facts(state: XinjinRound, id: string, source: Source): XinjinWinContext {
  return { winnerSeat: player(state, id).seat, dealerSeat: player(state, state.dealerId).seat, source: source.kind,
    sourceSeat: source.kind === 'original-hand' ? null : player(state, source.userId).seat,
    incomingCardId: source.cardId, discardCount: Number(state.rules.__discards ?? 0) };
}
function winning(state: XinjinRound, id: string, source: Source, external: boolean): Win | null {
  const current = hand(state, id, external ? source.cardId! : undefined);
  if (current.concealed.length !== fullSize(state, id)) return null;
  const declared = player(state, id).declaredWaits ?? null;
  if (declared !== null && !declaredWaitMatches(declared, source.cardId === null ? null : physical(state, source.cardId).code)) return null;
  const result = evaluateXinjinWin(current, { ...facts(state, id, source), baoJiao: declared !== null }, state.rules);
  return result.status === 'winning' ? result : null;
}
function declarationFaces(state: XinjinRound, id: string, discardId: string, bonusIds: readonly string[] = ids(state, bonusZone(id))): number[] | null {
  const current = hand(state, id);
  if (current.concealed.length !== fullSize(state, id) || !current.concealed.some(card => card.id === discardId)) return null;
  current.concealed = current.concealed.filter(card => card.id !== discardId);
  current.bonus = bonusIds.map(cardId => physical(state, cardId));
  const known = [...current.concealed, ...current.melds.flatMap(meld => meld.cards), ...current.bonus];
  const nextId = cycle(state, id)[0]!;
  const waits: number[] = [];
  for (const entry of xinjinPackSpecification(state.rules.wangNum as number)) {
    if (isSpecial(entry.code) || known.filter(card => card.code === entry.code).length >= entry.count) continue;
    let cardId = 'xj-wait-' + entry.code;
    while (known.some(card => card.id === cardId)) cardId += '_';
    const result = evaluateXinjinWin({ ...current, concealed: [...current.concealed, { id: cardId, code: entry.code }] },
      { winnerSeat: player(state, id).seat, dealerSeat: player(state, state.dealerId).seat, source: 'flip',
        sourceSeat: player(state, nextId).seat, incomingCardId: cardId, discardCount: Number(state.rules.__discards ?? 0) },
      { ...state.rules, __baoJiao: false });
    if (result.status === 'winning') waits.push(entry.code);
  }
  return waits.length ? [...new Set(waits)] : null;
}
function stage(state: XinjinRound, phase: XinjinRound['phase'], activeId: string, source: Source | null = null) {
  state.phase = phase; state.activeId = activeId; state.source = source; state.claims = null; state.serial++;
}
function move(state: XinjinRound, from: string, to: string, selected: string[]) {
  state.cards = moveCards(state.cards, from, to, selected);
}
function continuation(state: XinjinRound, dealerId: string): RoundContext {
  return { version: state.version, completedRound: state.number, nextDealerId: dealerId,
    dealerRun: dealerId === state.dealerId ? state.dealerRun + 1 : 1 };
}
function paymentsFor(state: XinjinRound, winners: Outcome['winners']) {
  const members = state.players.map(item => item.userId);
  const transfers = winners.flatMap((winner, winnerIndex) => {
    const payers = state.source?.kind === 'discard'
      ? [state.source.userId] : members.filter(id => id !== winner.userId);
    return payers.filter(id => id !== winner.userId).map((payerId, payIndex) => ({
      id: `xinjin:${winnerIndex}:${payIndex}`, payerId, payeeId: winner.userId,
      ...baseTimesRatio(state.rules.baseBeans as string,
        BigInt(winner.win.scoreUnits)),
    }));
  });
  return roundTransfers(transfers, members);
}
function finish(state: XinjinRound, reason: Outcome['reason'], winners: Outcome['winners'], events: XinjinEvent[]) {
  const payments = winners.length ? paymentsFor(state, winners) : roundTransfers([], state.players.map(item => item.userId));
  const dealerId = reason === 'hu' ? winners[0]!.userId : state.dealerId;
  state.outcome = { reason, winners, payments, nextRoundContext: continuation(state, dealerId) };
  stage(state, 'finished', state.activeId);
  events.push({ type: 'round-ended', reason, winnerIds: reason === 'hu' ? winners.map(winner => winner.userId) : [],
    postings: payments.postings });
}
function drawEnd(state: XinjinRound, events: XinjinEvent[]) { finish(state, 'draw', [], events); }
function replenish(state: XinjinRound, id: string, target: number, events: XinjinEvent[]): string | null {
  let last: string | null = null;
  for (;;) {
    const stolen = cards(state, handZone(id)).filter(card => isSpecial(card.code) ||
      state.rules.qiToWang === 1 && ordinaryRank(card.code) === 7);
    for (const card of stolen) {
      move(state, handZone(id), bonusZone(id), [card.id]);
      events.push({ type: 'bonus', userId: id, card });
    }
    if (ids(state, handZone(id)).length >= target) return last;
    const next = ids(state, 'deck')[0];
    if (!next) { drawEnd(state, events); return null; }
    move(state, 'deck', handZone(id), [next]);
    last = next;
    events.push({ type: 'replacement', userId: id, card: physical(state, next), remaining: ids(state, 'deck').length });
  }
}
function ownMelds(state: XinjinRound, id: string): Move[] {
  const current = player(state, id), currentCards = cards(state, handZone(id));
  if ((current.declaredWaits ?? null) !== null || current.melds.length >= 3) return [];
  return ordinaryMeldCandidates(currentCards, ['peng', 'gang']).map(meld => ({
    type: meld.kind === 'peng' ? 'tou' as const : 'gang' as const, cardIds: [...meld.cardIds],
  }));
}
function offers(state: XinjinRound, source: Source): ClaimOffer[] {
  const result: ClaimOffer[] = [];
  const incoming = physical(state, source.cardId!);
  const add = (userId: string, action: Move, priority: number) => result.push({
    id: `${decision(state)}:${result.length}`, userId, action, priority, simultaneous: action.type === 'hu',
  });
  const nextSeat = cycle(state, source.userId)[0]!;
  for (const id of cycle(state, source.userId)) {
    if (source.kind === 'discard' && id === source.userId) continue;
    if (winning(state, id, source, true)) add(id, { type: 'hu' }, 100);
    if ((player(state, id).declaredWaits ?? null) !== null) continue;
    if (player(state, id).melds.length >= 3) continue;
    for (const meld of ordinaryMeldCandidates([...cards(state, handZone(id)), incoming], ['chi', 'peng', 'gang'])) {
      if (!meld.cardIds.includes(incoming.id)) continue;
      if (meld.kind === 'chi' && id !== nextSeat && !(state.rules.ziChi === 1 && source.kind === 'flip' && id === source.userId)) continue;
      add(id, { type: meld.kind, cardIds: [...meld.cardIds] }, meld.kind === 'gang' ? 30 : meld.kind === 'peng' ? 20 : 10);
    }
  }
  return result;
}
function openResponse(state: XinjinRound, source: Source, events: XinjinEvent[]) {
  stage(state, 'response', source.userId, source);
  state.claims = openClaims(decision(state), cycle(state, source.userId), offers(state, source));
  if (!state.claims.offers.length) {
    move(state, 'table', 'discards', [source.cardId!]);
    stage(state, 'draw', cycle(state, source.userId)[0]!);
  } else events.push({ type: 'response-opened', decisionId: decision(state), sourceId: source.userId });
}
function performMeld(state: XinjinRound, id: string, action: Move, external: boolean, events: XinjinEvent[]) {
  const current = player(state, id);
  const resume = external ? 'discard' as const : state.phase as 'draw' | 'discard';
  const incomingId = external ? state.source!.cardId! : null;
  if (action.type === 'ba') {
    const meld = current.melds[action.meldIndex]!;
    meld.kind = 'ba'; meld.cardIds.push(action.cardId);
    move(state, handZone(id), meldZone(id), [action.cardId]);
  } else {
    requireCondition(['chi', 'peng', 'tou', 'gang'].includes(action.type) && 'cardIds' in action,
      'INVALID_ACTION', 'Expected a server-offered meld.', 409);
    const selected = action.cardIds;
    current.melds.push({ kind: action.type as Meld['kind'], cardIds: [...action.cardIds] });
    if (incomingId) move(state, 'table', meldZone(id), [incomingId]);
    const fromHand = selected.filter(cardId => cardId !== incomingId);
    if (fromHand.length) move(state, handZone(id), meldZone(id), fromHand);
  }
  events.push({ type: 'meld', userId: id, kind: action.type, cards: current.melds.at(-1)!.cardIds.map(cardId => physical(state, cardId)) });
  const replacement = replenish(state, id, fullSize(state, id) - (resume === 'draw' ? 1 : 0), events);
  if (state.phase === 'finished') return;
  stage(state, resume, id, replacement && resume === 'discard' ? { kind: 'replacement', userId: id, cardId: replacement } : null);
}
export function createXinjinRound(input: RoundInput, orderedCardIds: readonly string[]): XinjinRound {
  const players = [...input.players].sort((a, b) => a.seat - b.seat);
  requireCondition(players.length >= 2 && players.length <= 4 && players.length === input.rules.playerNum &&
    new Set(players.map(item => item.userId)).size === players.length &&
    players.every((item, index) => item.seat === index + 1) && players.some(item => item.userId === input.ownerUserId) &&
    Number.isSafeInteger(input.number) && input.number >= 1 && [4, 8, 12].includes(input.rules.gameNum as number) &&
    typeof input.rules.baseBeans === 'string' && amount(input.rules.baseBeans).gt(0),
  'INVALID_ROUND_INPUT', 'Explicit players, options and a positive base are required.', 500);
  assertXinjinOptionsSupported(input.rules);
  let dealerId = input.ownerUserId, dealerRun = 1;
  if (input.number > 1) {
    const prior = input.previousRoundContext;
    requireCondition(prior?.version === XINJIN_INDEPENDENT_VERSION && prior.completedRound === input.number - 1 &&
      typeof prior.nextDealerId === 'string' && players.some(item => item.userId === prior.nextDealerId),
    'ROUND_CONTEXT_REQUIRED', 'A later round cannot guess the historical dealer.', 409);
    dealerId = prior.nextDealerId as string; dealerRun = prior.dealerRun as number;
  } else requireCondition(input.previousRoundContext === undefined, 'INVALID_ROUND_INPUT', 'First rounds have no previous context.', 500);
  let cardState = createXinjinCardState('4:0', input.rules, 'deck', [
    { id: 'deck', visibility: 'hidden' }, { id: 'table', visibility: 'public' }, { id: 'discards', visibility: 'public' },
    ...players.flatMap(item => [{ id: handZone(item.userId), visibility: 'private' as const, ownerId: item.userId },
      { id: meldZone(item.userId), visibility: 'public' as const, ownerId: item.userId },
      { id: bonusZone(item.userId), visibility: 'public' as const, ownerId: item.userId }]),
  ]);
  cardState = orderCards(cardState, 'deck', orderedCardIds);
  const dealerAt = players.findIndex(item => item.userId === dealerId);
  const sequence = [...players.slice(dealerAt), ...players.slice(0, dealerAt)].map(item => handZone(item.userId));
  cardState = dealCards(cardState, 'deck', [...Array.from({ length: 7 }, () => sequence).flat(), handZone(dealerId)]);
  const state: XinjinRound = { version: XINJIN_INDEPENDENT_VERSION, number: input.number, rules: structuredClone(input.rules),
    players: players.map(item => ({ ...item, melds: [], declaredWaits: null, declaredBonusIds: null })), cards: cardState, dealerId, dealerRun, activeId: dealerId,
    phase: 'opening', serial: 0, source: { kind: 'original-hand', userId: dealerId, cardId: null }, claims: null, outcome: null };
  assertXinjinRound(state);
  return state;
}
export function xinjinLegalActions(state: XinjinRound, id: string): XinjinAction[] {
  player(state, id);
  if (state.phase === 'finished') return [];
  if (state.phase === 'response') {
    const view = projectClaims(state.claims!, id);
    return view.options.length ? [...view.options.map(option => ({ type: 'respond' as const, choiceId: option.id, decisionId: view.id })),
      { type: 'respond', choiceId: null, decisionId: view.id }] : [];
  }
  if (state.activeId !== id) return [];
  const choices: Move[] = [];
  if (state.source && winning(state, id, state.source, false)) choices.push({ type: 'hu' });
  if (state.phase === 'opening') choices.push({ type: 'begin' });
  else {
    choices.push(...ownMelds(state, id));
    if (state.phase === 'draw') choices.push({ type: 'draw' });
    else for (const cardId of ids(state, handZone(id))) {
      const current = player(state, id);
      const waits = declarationFaces(state, id, cardId, current.declaredBonusIds ?? ids(state, bonusZone(id)));
      const declared = current.declaredWaits ?? null;
      if (declared === null || sameDeclaredWaits(declared, waits)) choices.push({ type: 'discard', cardId });
      if (state.rules.baoJiao === 1 && declared === null && waits) choices.push({ type: 'declare', cardId });
    }
  }
  return choices.map(action => ({ ...action, decisionId: decision(state) }));
}
export function applyXinjinAction(previous: XinjinRound, id: string, action: unknown): EngineResult {
  assertXinjinRound(previous);
  requireCondition(action != null && typeof action === 'object' && 'decisionId' in action &&
    action.decisionId === decision(previous), 'STALE_CLAIM_WINDOW', 'The action belongs to a closed decision.', 409);
  requireCondition(xinjinLegalActions(previous, id).some(candidate => isDeepStrictEqual(candidate, action)),
    'INVALID_ACTION', 'Choose an action offered by the server.', 409);
  const typed = action as XinjinAction, state = structuredClone(previous), events: XinjinEvent[] = [];
  normalizeDeclarations(state);
  if (typed.type === 'respond') {
    state.claims = submitClaim(state.claims!, typed.decisionId, id, typed.choiceId);
    const chosen = resolveClaims(state.claims);
    if (chosen) {
      if (!chosen.length) {
        move(state, 'table', 'discards', [state.source!.cardId!]);
        stage(state, 'draw', cycle(state, state.source!.userId)[0]!);
      } else if ((chosen[0]!.action as Move).type === 'hu') finish(state, 'hu',
        chosen.map(choice => ({ userId: choice.userId, win: winning(state, choice.userId, state.source!, true)! })), events);
      else performMeld(state, chosen[0]!.userId, chosen[0]!.action as Move, true, events);
    }
  } else if (typed.type === 'hu') finish(state, 'hu', [{ userId: id, win: winning(state, id, state.source!, false)! }], events);
  else if (typed.type === 'begin') {
    let replacement: string | null = null;
    for (const currentId of [state.dealerId, ...cycle(state, state.dealerId).slice(0, -1)]) {
      const last = replenish(state, currentId, currentId === state.dealerId ? 8 : 7, events);
      if (currentId === state.dealerId) replacement = last;
      if (state.phase === 'finished') break;
    }
    if (state.phase !== 'finished') stage(state, 'discard', state.dealerId,
      replacement ? { kind: 'replacement', userId: state.dealerId, cardId: replacement } : null);
  } else if (typed.type === 'draw') {
    const next = ids(state, 'deck')[0];
    if (!next) drawEnd(state, events);
    else if (isSpecial(physical(state, next).code) ||
      (state.rules.qiToWang === 1 && ordinaryRank(physical(state, next).code) === 7)) {
      move(state, 'deck', handZone(id), [next]);
      const last = replenish(state, id, fullSize(state, id), events);
      if (state.phase !== 'finished') stage(state, 'discard', id, { kind: 'replacement', userId: id, cardId: last! });
    } else {
      move(state, 'deck', 'table', [next]);
      events.push({ type: 'flip', userId: id, card: physical(state, next), remaining: ids(state, 'deck').length });
      openResponse(state, { kind: 'flip', userId: id, cardId: next }, events);
    }
  } else if (typed.type === 'discard') {
    move(state, handZone(id), 'table', [typed.cardId]);
    state.rules.__discards = Number(state.rules.__discards ?? 0) + 1;
    events.push({ type: 'discard', userId: id, card: physical(state, typed.cardId) });
    openResponse(state, { kind: 'discard', userId: id, cardId: typed.cardId }, events);
  } else if (typed.type === 'declare') {
    const current = player(state, id), bonusIds = [...ids(state, bonusZone(id))];
    const waits = declarationFaces(state, id, typed.cardId, bonusIds);
    requireCondition(state.rules.baoJiao === 1 && (current.declaredWaits ?? null) === null && waits, 'INVALID_ACTION', 'This discard cannot declare a legal wait.', 409);
    current.declaredWaits = waits; current.declaredBonusIds = bonusIds;
    move(state, handZone(id), 'table', [typed.cardId]);
    state.rules.__discards = Number(state.rules.__discards ?? 0) + 1;
    events.push({ type: 'discard', userId: id, card: physical(state, typed.cardId), declared: true });
    openResponse(state, { kind: 'discard', userId: id, cardId: typed.cardId }, events);
  } else performMeld(state, id, typed, false, events);
  assertXinjinRound(state);
  return { snapshot: state, events, ...(state.outcome ? { confirmedScores: [{ eventId: `xj:${state.number}:final`,
    postings: state.outcome.payments.postings, transfers: state.outcome.payments.transfers }],
    settlement: state.outcome.payments.postings, nextRoundContext: state.outcome.nextRoundContext } : {}) };
}
export function assertXinjinRound(state: XinjinRound): void {
  requireCondition(state.version === XINJIN_INDEPENDENT_VERSION, 'XINJIN_RULES_VERSION_REQUIRED', 'Unknown round version.', 409);
  assertXinjinOptionsSupported(state.rules);
  assertCardState(state.cards);
  const capacity = xinjinPackSpecification(state.rules.wangNum as number)
    .flatMap(entry => Array<number>(entry.count).fill(entry.code)).sort((a, b) => a - b);
  requireCondition(isDeepStrictEqual(state.cards.pack.map(card => card.code).sort((a, b) => a - b), capacity) &&
    state.players.some(item => item.userId === state.dealerId) &&
    ['opening', 'discard', 'draw', 'response', 'finished'].includes(state.phase),
  'INVALID_XINJIN_STATE', 'Physical pack and turn phase must be consistent.', 500);
  for (const current of state.players) {
    const waits = current.declaredWaits, bonusIds = current.declaredBonusIds;
    requireCondition(waits === undefined && bonusIds === undefined || waits === null && bonusIds === null ||
      Array.isArray(waits) && waits.length > 0 && waits.every(value => Number.isSafeInteger(value) && value > 0) && new Set(waits).size === waits.length &&
      Array.isArray(bonusIds) && new Set(bonusIds).size === bonusIds.length &&
      bonusIds.every(cardId => typeof cardId === 'string' && ids(state, bonusZone(current.userId)).includes(cardId)),
    'INVALID_XINJIN_STATE', 'Declared wait and bonus snapshots must be paired and valid.', 500);
    requireCondition(isDeepStrictEqual(current.melds.flatMap(meld => meld.cardIds).sort(), [...ids(state, meldZone(current.userId))].sort()),
      'INVALID_XINJIN_STATE', 'Meld references must match the physical zone.', 500);
    if (state.phase === 'finished') continue;
    const expected = fullSize(state, current.userId) -
      (['opening', 'discard'].includes(state.phase) && state.activeId === current.userId ? 0 : 1);
    requireCondition(ids(state, handZone(current.userId)).length === expected,
      'INVALID_XINJIN_STATE', 'Concealed hand count is inconsistent.', 500);
    requireCondition(state.phase === 'opening' || cards(state, handZone(current.userId)).every(card =>
      !isSpecial(card.code) && !(state.rules.qiToWang === 1 && ordinaryRank(card.code) === 7)),
    'INVALID_XINJIN_STATE', 'Unprocessed reward cards cannot remain in a playable hand.', 500);
  }
  requireCondition(state.phase === 'response' ? state.claims?.id === decision(state) && ids(state, 'table').length === 1
    : state.claims === null && (state.phase === 'finished' || ids(state, 'table').length === 0),
  'INVALID_XINJIN_STATE', 'Public card and response phase must agree.', 500);
}
export function viewXinjinRound(state: XinjinRound, id: string) {
  player(state, id);
  return structuredClone({ version: state.version, number: state.number, phase: state.phase,
    dealerId: state.dealerId, activeId: state.activeId, decisionId: decision(state),
    cards: projectCardState(state.cards, id),
    players: state.players.map(item => ({ userId: item.userId, seat: item.seat, declared: item.declaredWaits !== null,
      melds: structuredClone(item.melds), ...(item.userId === id ? { declaredWaits: item.declaredWaits } : {}) })),
    legalActions: xinjinLegalActions(state, id), responses: state.claims ? projectClaims(state.claims, id) : null,
    outcome: state.outcome ? { reason: state.outcome.reason, postings: state.outcome.payments.postings,
      winners: state.outcome.winners.map(winner => ({ userId: winner.userId, redPoints: winner.win.redPoints,
        blackPoints: winner.win.blackPoints, scoreUnits: winner.win.scoreUnits })) } : null });
}
export function xinjinTimedAction(state: XinjinRound, id: string) {
  const actions = xinjinLegalActions(state, id);
  if (!actions.length) return null;
  const hu = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId !== null &&
    (state.claims!.offers.find(offer => offer.id === action.choiceId)!.action as Move).type === 'hu') : actions.find(action => action.type === 'hu');
  const fallback = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId === null)
    : actions.find(action => action.type === 'begin' || action.type === 'draw') ??
      actions.find(action => action.type === 'discard');
  return { userId: id, decisionId: decision(state), delayMs: state.phase === 'response' ? 15000 : 30000, action: hu ?? fallback! };
}
