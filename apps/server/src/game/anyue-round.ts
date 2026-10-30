import { isDeepStrictEqual } from 'node:util';
import { ANYUE_INDEPENDENT_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { EnginePlayer, EngineResult, RoundContext, RoundInput } from '../engines.js';
import { amount } from '../money.js';
import { baseTimesRatio, roundTransfers } from '../transfers.js';
import { assertCardState, dealCards, moveCards, orderCards, projectCardState, type CardState } from './cards.js';
import { openClaims, projectClaims, resolveClaims, submitClaim, type ClaimWindow, type ClaimOffer } from './claims.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { anyuePackSpecification, createAnyueCardState } from './anyue-pack.js';
import { evaluateAnyueWin, type AnyueHand, type AnyueWin, type AnyueWinContext } from './anyue-win.js';

type Win = Extract<AnyueWin, { status: 'winning' }>;
type Meld = { kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou'; cardIds: string[] };
interface Player extends EnginePlayer { melds: Meld[]; piao: number | null }
type Source = { kind: AnyueWinContext['source']; userId: string; cardId: string | null };
type Move = { type: 'begin' | 'draw' | 'hu' } | { type: 'discard'; cardId: string }
  | { type: 'tou' | 'gang' | 'peng' | 'chi'; cardIds: string[] }
  | { type: 'ba'; cardId: string; meldIndex: number }
  | { type: 'piao'; value: 0 | 1 };
export type AnyueAction = (Move | { type: 'respond'; choiceId: string | null }) & { decisionId: string };
interface Outcome { reason: 'hu' | 'draw'; winners: { userId: string; win: Win }[];
  payments: ReturnType<typeof roundTransfers>; nextRoundContext: RoundContext }
export interface AnyueRound {
  version: typeof ANYUE_INDEPENDENT_VERSION; number: number; rules: Record<string, unknown>;
  players: Player[]; cards: CardState; dealerId: string; dealerRun: number; activeId: string;
  phase: 'piao' | 'opening' | 'discard' | 'draw' | 'response' | 'finished'; serial: number;
  source: Source | null; claims: ClaimWindow | null; outcome: Outcome | null;
}
export interface AnyueEvent { type: string; [key: string]: unknown }
const isSpecial = (code: number) => [1001, 1002, 1003].includes(code);
const isSeven = (code: number) => ordinaryRank(code) === 7;
const handZone = (id: string) => `hand:${id}`;
const meldZone = (id: string) => `melds:${id}`;
const bonusZone = (id: string) => `bonus:${id}`;
const decision = (state: AnyueRound) => `ay:${state.number}:${state.serial}`;
const player = (state: AnyueRound, id: string) => {
  const found = state.players.find(item => item.userId === id);
  requireCondition(found, 'NOT_ROOM_MEMBER', 'Only round members can act or view.', 403);
  return found;
};
const ids = (state: AnyueRound, zone: string) => state.cards.zones.find(item => item.id === zone)!.cards;
const physical = (state: AnyueRound, id: string) => state.cards.pack.find(card => card.id === id)!;
const cards = (state: AnyueRound, zone: string) => ids(state, zone).map(id => physical(state, id));
const fullSize = (state: AnyueRound, id: string) => 8 - 2 * player(state, id).melds.length;
const piaoValue = (state: AnyueRound, id: string) => {
  if (state.rules.piaoType === 1) return 1;
  if (state.rules.piaoType === 0) return 0;
  return player(state, id).piao ?? 0;
};
function cycle(state: AnyueRound, after: string) {
  const at = state.players.findIndex(item => item.userId === after);
  return [...state.players.slice(at + 1), ...state.players.slice(0, at + 1)].map(item => item.userId);
}
function hand(state: AnyueRound, id: string, incoming?: string): AnyueHand {
  return { concealed: [...cards(state, handZone(id)), ...(incoming ? [physical(state, incoming)] : [])],
    melds: player(state, id).melds.map(meld => ({ kind: meld.kind,
      cards: meld.cardIds.map(cardId => physical(state, cardId)) })),
    bonus: cards(state, bonusZone(id)) };
}
function facts(state: AnyueRound, id: string, source: Source, payerId?: string): AnyueWinContext {
  return { winnerSeat: player(state, id).seat, dealerSeat: player(state, state.dealerId).seat, source: source.kind,
    sourceSeat: source.kind === 'original-hand' ? null : player(state, source.userId).seat,
    incomingCardId: source.cardId, discardCount: Number(state.rules.__discards ?? 0),
    piaoWinner: piaoValue(state, id), piaoPayer: payerId ? piaoValue(state, payerId) : 0 };
}
function winning(state: AnyueRound, id: string, source: Source, external: boolean, payerId?: string): Win | null {
  const current = hand(state, id, external ? source.cardId! : undefined);
  if (current.concealed.length !== fullSize(state, id)) return null;
  const result = evaluateAnyueWin(current, facts(state, id, source, payerId), state.rules);
  return result.status === 'winning' ? result : null;
}
function stage(state: AnyueRound, phase: AnyueRound['phase'], activeId: string, source: Source | null = null) {
  state.phase = phase; state.activeId = activeId; state.source = source; state.claims = null; state.serial++;
}
function move(state: AnyueRound, from: string, to: string, selected: string[]) {
  state.cards = moveCards(state.cards, from, to, selected);
}
function continuation(state: AnyueRound, dealerId: string): RoundContext {
  return { version: state.version, completedRound: state.number, nextDealerId: dealerId,
    dealerRun: dealerId === state.dealerId ? state.dealerRun + 1 : 1 };
}
function paymentGroups(state: AnyueRound, winner: Outcome['winners'][number]) {
  const members = state.players.map(item => item.userId);
  if (state.source?.kind === 'discard') {
    const owed = members.filter(id => id !== winner.userId);
    if (state.rules.dianpaoBaopei === 1) return [[state.source.userId, owed] as const];
    return [[state.source.userId, [state.source.userId]] as const];
  }
  return members.filter(id => id !== winner.userId).map(payerId => [payerId, [payerId]] as const);
}
function paymentsFor(state: AnyueRound, winners: Outcome['winners']) {
  const members = state.players.map(item => item.userId);
  const transfers = winners.flatMap((winner, winnerIndex) => {
    // Each share is computed against the player who would normally owe it, so
    // piao differences survive baopei instead of collapsing to the discarder.
    return paymentGroups(state, winner).flatMap(([payerId, covered]) =>
      covered.filter(id => id !== winner.userId).map((coveredId, index) => {
        requireCondition(coveredId !== winner.userId && payerId !== winner.userId,
          'INVALID_ANYUE_PAYMENT', 'An Anyue winner cannot pay their own win.', 500);
        const external = state.source?.kind === 'discard';
        const share = winning(state, winner.userId, state.source!, external, coveredId) ?? winner.win;
        return {
          id: `anyue:${winnerIndex}:${payerId}:${coveredId}:${index}`, payerId, payeeId: winner.userId,
          ...baseTimesRatio(state.rules.baseBeans as string, BigInt(share.scoreUnits)),
        };
      }));
  });
  return roundTransfers(transfers, members);
}
function finish(state: AnyueRound, reason: Outcome['reason'], winners: Outcome['winners'], events: AnyueEvent[]) {
  const payments = winners.length ? paymentsFor(state, winners) : roundTransfers([], state.players.map(item => item.userId));
  const dealerId = reason === 'hu' ? winners[0]!.userId : state.dealerId;
  state.outcome = { reason, winners, payments, nextRoundContext: continuation(state, dealerId) };
  stage(state, 'finished', state.activeId);
  events.push({ type: 'round-ended', reason, winnerIds: reason === 'hu' ? winners.map(winner => winner.userId) : [],
    postings: payments.postings });
}
function drawEnd(state: AnyueRound, events: AnyueEvent[]) { finish(state, 'draw', [], events); }
function replenish(state: AnyueRound, id: string, target: number, events: AnyueEvent[]): string | null {
  let last: string | null = null;
  for (;;) {
    const stolen = cards(state, handZone(id)).filter(card => isSpecial(card.code) ||
      state.rules.qiToWang === 1 && isSeven(card.code));
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
function ownMelds(state: AnyueRound, id: string): Move[] {
  const current = player(state, id);
  if (current.melds.length >= 3) return [];
  return ordinaryMeldCandidates(cards(state, handZone(id)), ['peng', 'gang']).map(meld => ({
    type: meld.kind === 'peng' ? 'tou' as const : 'gang' as const, cardIds: [...meld.cardIds],
  }));
}
function offers(state: AnyueRound, source: Source): ClaimOffer[] {
  const result: ClaimOffer[] = [];
  const incoming = physical(state, source.cardId!);
  const add = (userId: string, action: Move, priority: number) => result.push({
    id: `${decision(state)}:${result.length}`, userId, action, priority, simultaneous: action.type === 'hu',
  });
  const nextSeat = cycle(state, source.userId)[0]!;
  for (const id of cycle(state, source.userId)) {
    if (source.kind === 'discard' && id === source.userId) continue;
    if (winning(state, id, source, true, source.userId)) add(id, { type: 'hu' }, 100);
    if (player(state, id).melds.length >= 3) continue;
    for (const meld of ordinaryMeldCandidates([...cards(state, handZone(id)), incoming], ['chi', 'peng', 'gang'])) {
      if (!meld.cardIds.includes(incoming.id)) continue;
      if (meld.kind === 'chi' && id !== nextSeat) continue;
      add(id, { type: meld.kind, cardIds: [...meld.cardIds] }, meld.kind === 'gang' ? 30 : meld.kind === 'peng' ? 20 : 10);
    }
  }
  return result;
}
function openResponse(state: AnyueRound, source: Source, events: AnyueEvent[]) {
  stage(state, 'response', source.userId, source);
  state.claims = openClaims(decision(state), cycle(state, source.userId), offers(state, source));
  if (!state.claims.offers.length) {
    move(state, 'table', 'discards', [source.cardId!]);
    stage(state, 'draw', cycle(state, source.userId)[0]!);
  } else events.push({ type: 'response-opened', decisionId: decision(state), sourceId: source.userId });
}
function performMeld(state: AnyueRound, id: string, action: Move, external: boolean, events: AnyueEvent[]) {
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
    current.melds.push({ kind: action.type as Meld['kind'], cardIds: [...action.cardIds] });
    if (incomingId) move(state, 'table', meldZone(id), [incomingId]);
    const fromHand = action.cardIds.filter(cardId => cardId !== incomingId);
    if (fromHand.length) move(state, handZone(id), meldZone(id), fromHand);
  }
  events.push({ type: 'meld', userId: id, kind: action.type, cards: current.melds.at(-1)!.cardIds.map(cardId => physical(state, cardId)) });
  const replacement = replenish(state, id, fullSize(state, id) - (resume === 'draw' ? 1 : 0), events);
  if (state.phase === 'finished') return;
  stage(state, resume, id, replacement && resume === 'discard' ? { kind: 'replacement', userId: id, cardId: replacement } : null);
}
export function createAnyueRound(input: RoundInput, orderedCardIds: readonly string[]): AnyueRound {
  const players = [...input.players].sort((a, b) => a.seat - b.seat);
  requireCondition(players.length >= 2 && players.length <= 4 && players.length === input.rules.playerNum &&
    new Set(players.map(item => item.userId)).size === players.length &&
    players.every((item, index) => item.seat === index + 1) && players.some(item => item.userId === input.ownerUserId) &&
    Number.isSafeInteger(input.number) && input.number >= 1 && [4, 8, 12].includes(input.rules.gameNum as number) &&
    [0, 1, 2].includes(input.rules.piaoType as number) && typeof input.rules.baseBeans === 'string' &&
    amount(input.rules.baseBeans).gt(0),
  'INVALID_ROUND_INPUT', 'Explicit players, options and a positive base are required.', 500);
  let dealerId = input.ownerUserId, dealerRun = 1;
  if (input.number > 1) {
    const prior = input.previousRoundContext;
    requireCondition(prior?.version === ANYUE_INDEPENDENT_VERSION && prior.completedRound === input.number - 1 &&
      typeof prior.nextDealerId === 'string' && players.some(item => item.userId === prior.nextDealerId),
    'ROUND_CONTEXT_REQUIRED', 'A later round cannot guess the historical dealer.', 409);
    dealerId = prior.nextDealerId as string; dealerRun = prior.dealerRun as number;
  } else requireCondition(input.previousRoundContext === undefined, 'INVALID_ROUND_INPUT', 'First rounds have no previous context.', 500);
  let cardState = createAnyueCardState('5:0', input.rules, 'deck', [
    { id: 'deck', visibility: 'hidden' }, { id: 'table', visibility: 'public' }, { id: 'discards', visibility: 'public' },
    ...players.flatMap(item => [{ id: handZone(item.userId), visibility: 'private' as const, ownerId: item.userId },
      { id: meldZone(item.userId), visibility: 'public' as const, ownerId: item.userId },
      { id: bonusZone(item.userId), visibility: 'public' as const, ownerId: item.userId }]),
  ]);
  cardState = orderCards(cardState, 'deck', orderedCardIds);
  const dealerAt = players.findIndex(item => item.userId === dealerId);
  const sequence = [...players.slice(dealerAt), ...players.slice(0, dealerAt)].map(item => handZone(item.userId));
  cardState = dealCards(cardState, 'deck', [...Array.from({ length: 7 }, () => sequence).flat(), handZone(dealerId)]);
  const state: AnyueRound = { version: ANYUE_INDEPENDENT_VERSION, number: input.number, rules: structuredClone(input.rules),
    players: players.map(item => ({ ...item, melds: [], piao: input.rules.piaoType === 1 ? 1 : input.rules.piaoType === 0 ? 0 : null })),
    cards: cardState, dealerId, dealerRun, activeId: dealerId,
    phase: input.rules.piaoType === 2 ? 'piao' : 'opening',
    serial: 0, source: input.rules.piaoType === 2 ? null : { kind: 'original-hand', userId: dealerId, cardId: null },
    claims: null, outcome: null };
  assertAnyueRound(state);
  return state;
}
export function anyueLegalActions(state: AnyueRound, id: string): AnyueAction[] {
  player(state, id);
  if (state.phase === 'finished') return [];
  if (state.phase === 'piao') {
    return player(state, id).piao === null
      ? [{ type: 'piao', value: 0, decisionId: decision(state) }, { type: 'piao', value: 1, decisionId: decision(state) }]
      : [];
  }
  if (state.phase === 'response') {
    const view = projectClaims(state.claims!, id);
    return view.options.length ? [...view.options.map(option => ({ type: 'respond' as const, choiceId: option.id, decisionId: view.id })),
      { type: 'respond', choiceId: null, decisionId: view.id }] : [];
  }
  if (state.activeId !== id) return [];
  const choices: Move[] = [];
  if (state.source && winning(state, id, state.source, false, state.source.userId)) choices.push({ type: 'hu' });
  if (state.phase === 'opening') choices.push({ type: 'begin' });
  else {
    choices.push(...ownMelds(state, id));
    if (state.phase === 'draw') choices.push({ type: 'draw' });
    else for (const cardId of ids(state, handZone(id))) choices.push({ type: 'discard', cardId });
  }
  return choices.map(action => ({ ...action, decisionId: decision(state) }));
}
export function applyAnyueAction(previous: AnyueRound, id: string, action: unknown): EngineResult {
  assertAnyueRound(previous);
  requireCondition(action != null && typeof action === 'object' && 'decisionId' in action &&
    action.decisionId === decision(previous), 'STALE_CLAIM_WINDOW', 'The action belongs to a closed decision.', 409);
  requireCondition(anyueLegalActions(previous, id).some(candidate => isDeepStrictEqual(candidate, action)),
    'INVALID_ACTION', 'Choose an action offered by the server.', 409);
  const typed = action as AnyueAction, state = structuredClone(previous), events: AnyueEvent[] = [];
  if (typed.type === 'piao') {
    player(state, id).piao = typed.value;
    events.push({ type: 'piao', userId: id, value: typed.value });
    if (state.players.every(item => item.piao !== null)) {
      stage(state, 'opening', state.dealerId, { kind: 'original-hand', userId: state.dealerId, cardId: null });
    }
  } else if (typed.type === 'respond') {
    state.claims = submitClaim(state.claims!, typed.decisionId, id, typed.choiceId);
    const chosen = resolveClaims(state.claims);
    if (chosen) {
      if (!chosen.length) {
        move(state, 'table', 'discards', [state.source!.cardId!]);
        stage(state, 'draw', cycle(state, state.source!.userId)[0]!);
      } else if ((chosen[0]!.action as Move).type === 'hu') finish(state, 'hu',
        chosen.map(choice => ({ userId: choice.userId,
          win: winning(state, choice.userId, state.source!, true, state.source!.userId)! })), events);
      else performMeld(state, chosen[0]!.userId, chosen[0]!.action as Move, true, events);
    }
  } else if (typed.type === 'hu') finish(state, 'hu', [{ userId: id,
    win: winning(state, id, state.source!, false, state.source!.userId)! }], events);
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
    else if (isSpecial(physical(state, next).code) || (state.rules.qiToWang === 1 && isSeven(physical(state, next).code))) {
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
  } else performMeld(state, id, typed, false, events);
  assertAnyueRound(state);
  return { snapshot: state, events, ...(state.outcome ? { confirmedScores: [{ eventId: `ay:${state.number}:final`,
    postings: state.outcome.payments.postings, transfers: state.outcome.payments.transfers }],
    settlement: state.outcome.payments.postings, nextRoundContext: state.outcome.nextRoundContext } : {}) };
}
export function assertAnyueRound(state: AnyueRound): void {
  requireCondition(state.version === ANYUE_INDEPENDENT_VERSION, 'ANYUE_RULES_VERSION_REQUIRED', 'Unknown round version.', 409);
  assertCardState(state.cards);
  const capacity = anyuePackSpecification().flatMap(entry => Array<number>(entry.count).fill(entry.code)).sort((a, b) => a - b);
  requireCondition(isDeepStrictEqual(state.cards.pack.map(card => card.code).sort((a, b) => a - b), capacity) &&
    state.players.some(item => item.userId === state.dealerId) &&
    ['piao', 'opening', 'discard', 'draw', 'response', 'finished'].includes(state.phase),
  'INVALID_ANYUE_STATE', 'Physical pack and turn phase must be consistent.', 500);
  for (const current of state.players) {
    if (state.phase === 'finished' || state.phase === 'piao') continue;
    const expected = fullSize(state, current.userId) -
      (['opening', 'discard'].includes(state.phase) && state.activeId === current.userId ? 0 : 1);
    requireCondition(ids(state, handZone(current.userId)).length === expected,
      'INVALID_ANYUE_STATE', 'Concealed hand count is inconsistent.', 500);
    requireCondition(state.phase === 'opening' || cards(state, handZone(current.userId)).every(card => !isSpecial(card.code) &&
      !(state.rules.qiToWang === 1 && isSeven(card.code))),
    'INVALID_ANYUE_STATE', 'Unprocessed reward cards cannot remain in a playable hand.', 500);
  }
  requireCondition(state.phase === 'response' ? state.claims?.id === decision(state) && ids(state, 'table').length === 1
    : state.claims === null && (state.phase === 'finished' || state.phase === 'piao' || ids(state, 'table').length === 0),
  'INVALID_ANYUE_STATE', 'Public card and response phase must agree.', 500);
}
export function viewAnyueRound(state: AnyueRound, id: string) {
  player(state, id);
  return structuredClone({ version: state.version, number: state.number, phase: state.phase,
    dealerId: state.dealerId, activeId: state.activeId, decisionId: decision(state),
    piao: state.players.map(item => ({ userId: item.userId, value: item.piao })),
    cards: projectCardState(state.cards, id),
    players: state.players.map(item => ({ userId: item.userId, seat: item.seat, melds: structuredClone(item.melds) })),
    legalActions: anyueLegalActions(state, id), responses: state.claims ? projectClaims(state.claims, id) : null,
    outcome: state.outcome ? { reason: state.outcome.reason, postings: state.outcome.payments.postings,
      winners: state.outcome.winners.map(winner => ({ userId: winner.userId, redPoints: winner.win.redPoints,
        blackPoints: winner.win.blackPoints, scoreUnits: winner.win.scoreUnits })) } : null });
}
export function anyueTimedAction(state: AnyueRound, id: string) {
  const actions = anyueLegalActions(state, id);
  if (!actions.length) return null;
  const hu = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId !== null &&
    (state.claims!.offers.find(offer => offer.id === action.choiceId)!.action as Move).type === 'hu') : actions.find(action => action.type === 'hu');
  const fallback = state.phase === 'piao' ? actions.find(action => action.type === 'piao')
    : state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId === null)
      : actions.find(action => action.type === 'begin' || action.type === 'draw') ??
        actions.find(action => action.type === 'discard');
  return { userId: id, decisionId: decision(state), delayMs: state.phase === 'response' || state.phase === 'piao' ? 15000 : 30000,
    action: hu ?? fallback! };
}
