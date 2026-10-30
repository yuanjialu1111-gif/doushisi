import { isDeepStrictEqual } from 'node:util';
import { PUJIANG_INDEPENDENT_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { EnginePlayer, EngineResult, RoundContext, RoundInput } from '../engines.js';
import { amount } from '../money.js';
import { baseTimesRatio, roundTransfers } from '../transfers.js';
import { assertCardState, dealCards, moveCards, orderCards, projectCardState, type CardState } from './cards.js';
import { openClaims, projectClaims, resolveClaims, submitClaim, type ClaimWindow, type ClaimOffer } from './claims.js';
import { declaredWaitMatches, sameDeclaredWaits } from './declared-waits.js';
import { ordinaryMeldCandidates } from './ordinary-melds.js';
import { createPujiangCardState, pujiangPackSpecification } from './pujiang-pack.js';
import { evaluatePujiangWin, pujiangWaits, type PujiangHand, type PujiangMeld,
  type PujiangWin, type PujiangWinContext } from './pujiang-win.js';

type Win = Extract<PujiangWin, { status: 'winning' }>;
type Meld = { kind: PujiangMeld['kind']; cardIds: string[] };
interface Player extends EnginePlayer {
  melds: Meld[];
  declaredWaits: number[] | null;
  /** Bonus cards present when the server froze this declaration. */
  declaredBonusIds: string[] | null;
}
type Source = { kind: PujiangWinContext['source']; userId: string; cardId: string | null };
type Move =
  | { type: 'begin' | 'draw' | 'hu' }
  | { type: 'discard' | 'declare'; cardId: string }
  | { type: 'tou' | 'gang' | 'peng' | 'chi'; cardIds: string[] }
  | { type: 'ba'; cardId: string; meldIndex: number };
export type PujiangAction = (Move | { type: 'respond'; choiceId: string | null }) & { decisionId: string };
interface Outcome {
  reason: 'hu' | 'draw'; winners: { userId: string; win: Win }[];
  payments: ReturnType<typeof roundTransfers>; nextRoundContext: RoundContext;
}
export interface PujiangRound {
  version: typeof PUJIANG_INDEPENDENT_VERSION; number: number; rules: Record<string, unknown>;
  players: Player[]; cards: CardState; dealerId: string; dealerRun: number; activeId: string;
  phase: 'opening' | 'discard' | 'draw' | 'response' | 'finished'; serial: number;
  source: Source | null; claims: ClaimWindow | null; outcome: Outcome | null;
}
export interface PujiangEvent { type: string; [key: string]: unknown }
const isRoyal = (code: number) => [1001, 1002, 1003].includes(code);
const handZone = (id: string) => `hand:${id}`;
const meldZone = (id: string) => `melds:${id}`;
const bonusZone = (id: string) => `bonus:${id}`;
const decision = (s: PujiangRound) => `pj:${s.number}:${s.serial}`;
const player = (s: PujiangRound, id: string) => {
  const found = s.players.find(item => item.userId === id);
  requireCondition(found, 'NOT_ROOM_MEMBER', 'Only round members can act or view.', 403);
  return found;
};
const ids = (s: PujiangRound, zone: string) => s.cards.zones.find(item => item.id === zone)!.cards;
const physical = (s: PujiangRound, id: string) => s.cards.pack.find(card => card.id === id)!;
const cards = (s: PujiangRound, zone: string) => ids(s, zone).map(id => physical(s, id));
const fullSize = (s: PujiangRound, id: string) => 8 - 2 * player(s, id).melds.length;
function cycle(s: PujiangRound, after: string) {
  const at = s.players.findIndex(item => item.userId === after);
  return [...s.players.slice(at + 1), ...s.players.slice(0, at + 1)].map(item => item.userId);
}
function hand(s: PujiangRound, id: string, incoming?: string): PujiangHand {
  return {
    concealed: [...cards(s, handZone(id)), ...(incoming ? [physical(s, incoming)] : [])],
    melds: player(s, id).melds.map(meld => ({ kind: meld.kind,
      cards: meld.cardIds.map(cardId => physical(s, cardId)) })),
    bonus: cards(s, bonusZone(id)),
  };
}
function declarationWaits(current: PujiangHand, context: Omit<PujiangWinContext, 'incomingCardId' | 'source'>,
  rules: Readonly<Record<string, unknown>>) {
  const waits = pujiangWaits(current, context, rules);
  const redPoint = (code: number) => [1, 3].includes(Math.floor(code / 100))
    ? (code % 100 >= 11 ? 1 : code % 100) : 0;
  const existing = current.concealed.reduce((sum, card) => sum + redPoint(card.code), 0);
  const includeWinningCard = rules.baoJiaoYingbao === 0;
  return waits.filter(wait => existing + (includeWinningCard ? redPoint(wait.code) : 0) >= 20);
}
function facts(s: PujiangRound, id: string, source: Source): PujiangWinContext {
  return {
    winnerSeat: player(s, id).seat, dealerSeat: player(s, s.dealerId).seat, source: source.kind,
    sourceSeat: source.kind === 'original-hand' ? null : player(s, source.userId).seat,
    incomingCardId: source.cardId, discardCount: Number(s.rules.__discards ?? 0),
  };
}
function winning(s: PujiangRound, id: string, source: Source, external: boolean): Win | null {
  const current = hand(s, id, external ? source.cardId! : undefined);
  if (current.concealed.length !== fullSize(s, id)) return null;
  const declared = player(s, id).declaredWaits;
  const declaredMatch = declaredWaitMatches(declared,
    source.cardId === null ? null : physical(s, source.cardId).code);
  if (declared !== null && !declaredMatch) return null;
  const result = evaluatePujiangWin(current, facts(s, id, source), s.rules);
  return result.status === 'winning' ? result : null;
}
/** A declaration locks the exact post-discard wait faces for the rest of the hand. */
export function pujiangDeclarationFaces(s: PujiangRound, id: string, discardId: string,
  bonusIds: readonly string[] = ids(s, bonusZone(id))): number[] | null {
  const current = hand(s, id);
  if (current.concealed.length !== fullSize(s, id) || !current.concealed.some(card => card.id === discardId)) return null;
  current.concealed = current.concealed.filter(card => card.id !== discardId);
  current.bonus = bonusIds.map(cardId => physical(s, cardId));
  const context = {
    winnerSeat: player(s, id).seat, dealerSeat: player(s, s.dealerId).seat,
    source: 'discard' as const, sourceSeat: player(s, id).seat, discardCount: Number(s.rules.__discards ?? 0),
  };
  const usable = declarationWaits(current, context, s.rules);
  return usable.length ? usable.map(wait => wait.code) : null;
}
function stage(s: PujiangRound, phase: PujiangRound['phase'], activeId: string, source: Source | null = null) {
  s.phase = phase; s.activeId = activeId; s.source = source; s.claims = null; s.serial++;
}
function move(s: PujiangRound, from: string, to: string, selected: string[]) { s.cards = moveCards(s.cards, from, to, selected); }
function continuation(s: PujiangRound, dealerId: string): RoundContext {
  return { version: s.version, completedRound: s.number, nextDealerId: dealerId,
    dealerRun: dealerId === s.dealerId ? s.dealerRun + 1 : 1 };
}
function paymentsFor(s: PujiangRound, winners: Outcome['winners'], reason: Outcome['reason'] = 'hu') {
  const members = s.players.map(item => item.userId);
  const transfers = winners.flatMap((winner, winnerIndex) => {
    const winnerIds = new Set(winners.map(item => item.userId));
    const payers = reason === 'draw'
      ? members.filter(id => !winnerIds.has(id))
      : s.source?.kind === 'discard' ? [s.source!.userId] : members.filter(id => id !== winner.userId);
    return payers.filter(id => id !== winner.userId).map((payerId, payIndex) => ({
      id: `pujiang:${winnerIndex}:${payIndex}`, payerId, payeeId: winner.userId,
      ...baseTimesRatio(s.rules.baseBeans as string, BigInt(winner.win.scoreUnits)),
    }));
  });
  return roundTransfers(transfers, members);
}
function finish(s: PujiangRound, reason: Outcome['reason'], winners: Outcome['winners'], events: PujiangEvent[]) {
  const payments = winners.length ? paymentsFor(s, winners, reason) : roundTransfers([], s.players.map(item => item.userId));
  const dealerId = reason === 'hu' ? winners[0]!.userId : s.dealerId;
  s.outcome = { reason, winners, payments, nextRoundContext: continuation(s, dealerId) };
  stage(s, 'finished', s.activeId);
  events.push({ type: 'round-ended', reason, winnerIds: reason === 'hu' ? winners.map(winner => winner.userId) : [],
    postings: payments.postings });
}
function drawEnd(s: PujiangRound, events: PujiangEvent[]) {
  const called: Outcome['winners'] = [];
  if (s.rules.chaJiao === 1) {
    for (const current of s.players) {
      const currentHand = hand(s, current.userId);
      if (currentHand.concealed.length !== fullSize(s, current.userId) - 1 ||
        currentHand.concealed.some(card => isRoyal(card.code))) continue;
      const context = {
        winnerSeat: current.seat, dealerSeat: player(s, s.dealerId).seat,
        source: 'flip' as const, sourceSeat: player(s, cycle(s, current.userId)[0]!).seat,
        discardCount: Math.max(2, Number(s.rules.__discards ?? 0)),
      };
      if (current.declaredWaits !== null) {
        const lockedHand = { ...currentHand,
          bonus: (current.declaredBonusIds ?? []).map(cardId => physical(s, cardId)) };
        const lockedWaits = declarationWaits(lockedHand, context, s.rules);
        if (!sameDeclaredWaits(current.declaredWaits, lockedWaits.map(wait => wait.code))) continue;
      }
      const waits = declarationWaits(currentHand, context, s.rules);
      const best = waits.reduce<Win | null>((best, wait) =>
        !best || BigInt(wait.result.scoreUnits) > BigInt(best.scoreUnits) ? wait.result : best, null);
      if (best) called.push({ userId: current.userId, win: best });
    }
  }
  finish(s, 'draw', called, events);
}
function replenish(s: PujiangRound, id: string, target: number, events: PujiangEvent[]): string | null {
  let last: string | null = null;
  for (;;) {
    const stolen = cards(s, handZone(id)).filter(card => isRoyal(card.code));
    for (const card of stolen) {
      move(s, handZone(id), bonusZone(id), [card.id]);
      events.push({ type: 'bonus', userId: id, card });
    }
    if (ids(s, handZone(id)).length >= target) return last;
    const next = ids(s, 'deck')[0];
    if (!next) { drawEnd(s, events); return null; }
    move(s, 'deck', handZone(id), [next]);
    last = next;
    events.push({ type: 'replacement', userId: id, card: physical(s, next), remaining: ids(s, 'deck').length });
  }
}
function ownMelds(s: PujiangRound, id: string): Move[] {
  const current = player(s, id);
  if (current.declaredWaits !== null) return [];
  if (current.melds.length >= 3) return [];
  const moves: Move[] = ordinaryMeldCandidates(cards(s, handZone(id)), ['peng', 'gang']).map(meld => ({
    type: meld.kind === 'peng' ? 'tou' as const : 'gang' as const, cardIds: [...meld.cardIds],
  }));
  for (let meldIndex = 0; meldIndex < current.melds.length; meldIndex++) {
    const meld = current.melds[meldIndex]!;
    if (meld.kind !== 'peng') continue;
    const rank = physical(s, meld.cardIds[0]!).code % 100;
    const companion = cards(s, handZone(id)).find(card => card.code % 100 === rank);
    if (companion) moves.push({ type: 'ba', cardId: companion.id, meldIndex });
  }
  return moves;
}
function offers(s: PujiangRound, source: Source): ClaimOffer[] {
  const result: ClaimOffer[] = [];
  const incoming = physical(s, source.cardId!);
  const add = (userId: string, action: Move, priority: number) => result.push({
    id: `${decision(s)}:${result.length}`, userId, action, priority, simultaneous: action.type === 'hu',
  });
  const nextSeat = cycle(s, source.userId)[0]!;
  for (const id of cycle(s, source.userId)) {
    if (source.kind === 'discard' && id === source.userId) continue;
    if (winning(s, id, source, true)) add(id, { type: 'hu' }, 100);
    const current = player(s, id);
    if (current.declaredWaits !== null) continue;
    if (current.melds.length >= 3) continue;
    for (const meld of ordinaryMeldCandidates([...cards(s, handZone(id)), incoming], ['chi', 'peng', 'gang'])) {
      if (!meld.cardIds.includes(incoming.id)) continue;
      if (meld.kind === 'chi' && id !== nextSeat) continue;
      add(id, { type: meld.kind, cardIds: [...meld.cardIds] },
        meld.kind === 'gang' ? 30 : meld.kind === 'peng' ? 20 : 10);
    }
  }
  return result;
}
function openResponse(s: PujiangRound, source: Source, events: PujiangEvent[]) {
  stage(s, 'response', source.userId, source);
  s.claims = openClaims(decision(s), cycle(s, source.userId), offers(s, source));
  if (!s.claims.offers.length) {
    move(s, 'table', 'discards', [source.cardId!]);
    stage(s, 'draw', cycle(s, source.userId)[0]!);
  } else events.push({ type: 'response-opened', decisionId: decision(s), sourceId: source.userId });
}
function performMeld(s: PujiangRound, id: string, action: Move, external: boolean, events: PujiangEvent[]) {
  const current = player(s, id);
  requireCondition(current.declaredWaits === null, 'INVALID_ACTION',
    'A declared player cannot chi, peng, gang or ba.', 409);
  const resume = external ? 'discard' : s.phase;
  requireCondition(resume === 'discard' || resume === 'draw', 'INVALID_ACTION', 'Unexpected meld phase.', 500);
  const incomingId = external ? s.source!.cardId! : null;
  if (action.type === 'ba') {
    const meld = current.melds[action.meldIndex]!;
    meld.kind = 'ba'; meld.cardIds.push(action.cardId);
    move(s, handZone(id), meldZone(id), [action.cardId]);
  } else {
    requireCondition(['chi', 'peng', 'tou', 'gang'].includes(action.type) && 'cardIds' in action,
      'INVALID_ACTION', 'Expected a server-offered meld.', 409);
    current.melds.push({ kind: action.type as PujiangMeld['kind'], cardIds: [...action.cardIds] });
    if (incomingId) move(s, 'table', meldZone(id), [incomingId]);
    const fromHand = action.cardIds.filter(cardId => cardId !== incomingId);
    if (fromHand.length) move(s, handZone(id), meldZone(id), fromHand);
  }
  events.push({ type: 'meld', userId: id, kind: action.type,
    cards: current.melds.at(-1)!.cardIds.map(cardId => physical(s, cardId)) });
  const replacement = replenish(s, id, fullSize(s, id) - (resume === 'draw' ? 1 : 0), events);
  if (s.phase === 'finished') return;
  stage(s, resume, id, replacement && resume === 'discard' ? { kind: 'replacement', userId: id, cardId: replacement } : null);
}
export function createPujiangRound(input: RoundInput, orderedCardIds: readonly string[]): PujiangRound {
  const players = [...input.players].sort((a, b) => a.seat - b.seat);
  requireCondition(players.length >= 2 && players.length <= 4 && players.length === input.rules.playerNum &&
    new Set(players.map(item => item.userId)).size === players.length &&
    players.every((item, index) => item.seat === index + 1) && players.some(item => item.userId === input.ownerUserId) &&
    Number.isSafeInteger(input.number) && input.number >= 1 && [4, 8, 12].includes(input.rules.gameNum as number) &&
    [4, 5, 6, 99].includes(input.rules.maxFan as number) && [0, 1].includes(input.rules.baoJiaoYingbao as number) &&
    typeof input.rules.baseBeans === 'string' && amount(input.rules.baseBeans).gt(0),
  'INVALID_ROUND_INPUT', 'Explicit players, frozen Pujiang options and a positive base are required.', 500);
  let dealerId = input.ownerUserId, dealerRun = 1;
  if (input.number > 1) {
    const prior = input.previousRoundContext;
    requireCondition(prior?.version === PUJIANG_INDEPENDENT_VERSION && prior.completedRound === input.number - 1 &&
      typeof prior.nextDealerId === 'string' && players.some(item => item.userId === prior.nextDealerId),
    'ROUND_CONTEXT_REQUIRED', 'A later round cannot guess the historical dealer.', 409);
    dealerId = prior.nextDealerId as string; dealerRun = prior.dealerRun as number;
  } else requireCondition(input.previousRoundContext === undefined, 'INVALID_ROUND_INPUT', 'First rounds have no previous context.', 500);
  let cardState = createPujiangCardState('7:0', input.rules, 'deck', [
    { id: 'deck', visibility: 'hidden' }, { id: 'table', visibility: 'public' }, { id: 'discards', visibility: 'public' },
    ...players.flatMap(item => [{ id: handZone(item.userId), visibility: 'private' as const, ownerId: item.userId },
      { id: meldZone(item.userId), visibility: 'public' as const, ownerId: item.userId },
      { id: bonusZone(item.userId), visibility: 'public' as const, ownerId: item.userId }]),
  ]);
  cardState = orderCards(cardState, 'deck', orderedCardIds);
  const dealerAt = players.findIndex(item => item.userId === dealerId);
  const sequence = [...players.slice(dealerAt), ...players.slice(0, dealerAt)].map(item => handZone(item.userId));
  cardState = dealCards(cardState, 'deck', [...Array.from({ length: 7 }, () => sequence).flat(), handZone(dealerId)]);
  const state: PujiangRound = { version: PUJIANG_INDEPENDENT_VERSION, number: input.number, rules: structuredClone(input.rules),
    players: players.map(item => ({ ...item, melds: [], declaredWaits: null, declaredBonusIds: null })),
    cards: cardState, dealerId, dealerRun,
    activeId: dealerId, phase: 'opening', serial: 0,
    source: { kind: 'original-hand', userId: dealerId, cardId: null }, claims: null, outcome: null };
  assertPujiangRound(state);
  return state;
}
export function pujiangLegalActions(s: PujiangRound, id: string): PujiangAction[] {
  player(s, id);
  if (s.phase === 'finished') return [];
  if (s.phase === 'response') {
    const view = projectClaims(s.claims!, id);
    return view.options.length ? [...view.options.map(option => ({ type: 'respond' as const, choiceId: option.id, decisionId: view.id })),
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
      const current = player(s, id);
      for (const cardId of ids(s, handZone(id))) {
        const waits = pujiangDeclarationFaces(s, id, cardId,
          current.declaredBonusIds ?? ids(s, bonusZone(id)));
        if (current.declaredWaits !== null && !sameDeclaredWaits(current.declaredWaits, waits)) continue;
        choices.push({ type: 'discard', cardId });
        if (current.declaredWaits === null && waits) {
          choices.push({ type: 'declare', cardId });
        }
      }
    }
  }
  return choices.map(action => ({ ...action, decisionId: decision(s) }));
}
export function applyPujiangAction(previous: PujiangRound, id: string, action: unknown): EngineResult {
  assertPujiangRound(previous);
  requireCondition(action != null && typeof action === 'object' && 'decisionId' in action &&
    action.decisionId === decision(previous), 'STALE_CLAIM_WINDOW', 'The action belongs to a closed decision.', 409);
  requireCondition(pujiangLegalActions(previous, id).some(candidate => isDeepStrictEqual(candidate, action)),
    'INVALID_ACTION', 'Choose an action offered by the server.', 409);
  const typed = action as PujiangAction, state = structuredClone(previous), events: PujiangEvent[] = [];
  if (typed.type === 'respond') {
    state.claims = submitClaim(state.claims!, typed.decisionId, id, typed.choiceId);
    const chosen = resolveClaims(state.claims);
    if (chosen) {
      if (!chosen.length) {
        move(state, 'table', 'discards', [state.source!.cardId!]);
        stage(state, 'draw', cycle(state, state.source!.userId)[0]!);
      } else if ((chosen[0]!.action as Move).type === 'hu') {
        const winners = chosen.map(choice => {
          const win = winning(state, choice.userId, state.source!, true);
          requireCondition(win, 'INVALID_ACTION', 'The response no longer satisfies the declared wait.', 409);
          return { userId: choice.userId, win };
        });
        finish(state, 'hu', winners, events);
      } else performMeld(state, chosen[0]!.userId, chosen[0]!.action as Move, true, events);
    }
  } else if (typed.type === 'hu') {
    const win = winning(state, id, state.source!, false);
    requireCondition(win, 'INVALID_ACTION', 'The action no longer satisfies the declared wait.', 409);
    finish(state, 'hu', [{ userId: id, win }], events);
  } else if (typed.type === 'begin') {
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
    else if (isRoyal(physical(state, next).code)) {
      move(state, 'deck', handZone(id), [next]);
      const last = replenish(state, id, fullSize(state, id), events);
      if (state.phase !== 'finished') stage(state, 'discard', id, { kind: 'replacement', userId: id, cardId: last! });
    } else {
      move(state, 'deck', 'table', [next]);
      events.push({ type: 'flip', userId: id, card: physical(state, next), remaining: ids(state, 'deck').length });
      openResponse(state, { kind: 'flip', userId: id, cardId: next }, events);
    }
  } else if (typed.type === 'discard' || typed.type === 'declare') {
    if (typed.type === 'declare') {
      const bonusIds = [...ids(state, bonusZone(id))];
      const waits = pujiangDeclarationFaces(state, id, typed.cardId, bonusIds);
      requireCondition(player(state, id).declaredWaits === null, 'INVALID_ACTION',
        'A declared player cannot declare again.', 409);
      requireCondition(waits, 'INVALID_ACTION', 'The selected discard cannot declare a legal wait.', 409);
      player(state, id).declaredWaits = [...waits];
      player(state, id).declaredBonusIds = bonusIds;
    } else {
      const declared = player(state, id).declaredWaits;
      const declaredBonusIds = player(state, id).declaredBonusIds;
      requireCondition(declared === null || sameDeclaredWaits(declared,
        pujiangDeclarationFaces(state, id, typed.cardId, declaredBonusIds ?? [])),
        'INVALID_ACTION', 'A declared discard must preserve the complete locked wait set.', 409);
    }
    move(state, handZone(id), 'table', [typed.cardId]);
    state.rules.__discards = Number(state.rules.__discards ?? 0) + 1;
    events.push({ type: 'discard', userId: id, card: physical(state, typed.cardId),
      declared: typed.type === 'declare' });
    openResponse(state, { kind: 'discard', userId: id, cardId: typed.cardId }, events);
  } else performMeld(state, id, typed, false, events);
  assertPujiangRound(state);
  return { snapshot: state, events, ...(state.outcome ? { confirmedScores: [{ eventId: `pj:${state.number}:final`,
    postings: state.outcome.payments.postings, transfers: state.outcome.payments.transfers }],
    settlement: state.outcome.payments.postings, nextRoundContext: state.outcome.nextRoundContext } : {}) };
}
export function assertPujiangRound(state: PujiangRound): void {
  requireCondition(state.version === PUJIANG_INDEPENDENT_VERSION, 'PUJIANG_RULES_VERSION_REQUIRED', 'Unknown round version.', 409);
  assertCardState(state.cards);
  const capacity = pujiangPackSpecification(state.rules.wangNum as number)
    .flatMap(entry => Array<number>(entry.count).fill(entry.code)).sort((a, b) => a - b);
  requireCondition(isDeepStrictEqual(state.cards.pack.map(card => card.code).sort((a, b) => a - b), capacity) &&
    state.players.some(item => item.userId === state.dealerId) &&
    ['opening', 'discard', 'draw', 'response', 'finished'].includes(state.phase),
  'INVALID_PUJIANG_STATE', 'Physical pack and turn phase must be consistent.', 500);
  for (const current of state.players) {
    requireCondition(current.declaredBonusIds == null ? current.declaredWaits == null :
      Array.isArray(current.declaredBonusIds) && current.declaredWaits !== null &&
      new Set(current.declaredBonusIds).size === current.declaredBonusIds.length &&
      current.declaredBonusIds.every(cardId => ids(state, bonusZone(current.userId)).includes(cardId)),
    'INVALID_PUJIANG_STATE', 'Declared bonus snapshots must match the player state.', 500);
    requireCondition(current.declaredWaits === null || Array.isArray(current.declaredWaits) &&
      current.declaredWaits.every(cardId => Number.isSafeInteger(cardId) && cardId > 0) &&
      new Set(current.declaredWaits).size === current.declaredWaits.length,
    'INVALID_PUJIANG_STATE', 'Declared waits must be unique positive faces.', 500);
    requireCondition(isDeepStrictEqual(current.melds.flatMap(meld => meld.cardIds).sort(), [...ids(state, meldZone(current.userId))].sort()),
      'INVALID_PUJIANG_STATE', 'Meld references must match the physical zone.', 500);
    if (state.phase === 'finished') continue;
    const expected = fullSize(state, current.userId) -
      (['opening', 'discard'].includes(state.phase) && state.activeId === current.userId ? 0 : 1);
    requireCondition(ids(state, handZone(current.userId)).length === expected,
      'INVALID_PUJIANG_STATE', 'Concealed hand count is inconsistent.', 500);
    requireCondition(state.phase === 'opening' || cards(state, handZone(current.userId)).every(card => !isRoyal(card.code)),
      'INVALID_PUJIANG_STATE', 'Unprocessed royal cards cannot remain in a playable hand.', 500);
  }
  requireCondition(state.phase === 'response' ? state.claims?.id === decision(state) && ids(state, 'table').length === 1
    : state.claims === null && (state.phase === 'finished' || ids(state, 'table').length === 0),
  'INVALID_PUJIANG_STATE', 'Public card and response phase must agree.', 500);
}
export function viewPujiangRound(state: PujiangRound, id: string) {
  player(state, id);
  return structuredClone({ version: state.version, number: state.number, phase: state.phase,
    dealerId: state.dealerId, activeId: state.activeId, decisionId: decision(state),
    cards: projectCardState(state.cards, id),
    players: state.players.map(item => ({ userId: item.userId, seat: item.seat, melds: structuredClone(item.melds),
      declaredWaits: item.declaredWaits === null ? null : [...item.declaredWaits] })),
    legalActions: pujiangLegalActions(state, id), responses: state.claims ? projectClaims(state.claims, id) : null,
    outcome: state.outcome ? { reason: state.outcome.reason, postings: state.outcome.payments.postings,
      winners: state.outcome.winners.map(winner => ({ userId: winner.userId, redPoints: winner.win.redPoints,
        blackPoints: winner.win.blackPoints, scoreUnits: winner.win.scoreUnits })) } : null });
}
export function pujiangTimedAction(state: PujiangRound, id: string) {
  const actions = pujiangLegalActions(state, id);
  if (!actions.length) return null;
  const hu = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId !== null &&
    (state.claims!.offers.find(offer => offer.id === action.choiceId)!.action as Move).type === 'hu') : actions.find(action => action.type === 'hu');
  const fallback = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId === null)
      : actions.find(action => action.type === 'begin' || action.type === 'draw') ??
        actions.filter((action): action is PujiangAction & { type: 'discard'; cardId: string } =>
          action.type === 'discard')
          .sort((a, b) => a.cardId.localeCompare(b.cardId))[0];
  return { userId: id, decisionId: decision(state),
    delayMs: state.phase === 'response' ? 15000 : 30000, action: hu ?? fallback! };
}
