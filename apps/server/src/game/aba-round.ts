import { isDeepStrictEqual } from 'node:util';
import { ABA_INDEPENDENT_VERSIONS, ABA_RED_SCORES } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { EnginePlayer, EngineResult, RoundContext, RoundInput } from '../engines.js';
import { amount } from '../money.js';
import { baseTimesRatio, roundTransfers } from '../transfers.js';
import { assertCardState, dealCards, moveCards, orderCards, projectCardState, type CardState } from './cards.js';
import { openClaims, projectClaims, resolveClaims, submitClaim, type ClaimWindow, type ClaimOffer } from './claims.js';
import { ordinaryMeldCandidates } from './ordinary-melds.js';
import { declaredWaitMatches, sameDeclaredWaits } from './declared-waits.js';
import { createAbaCardState, abaPackSpecification } from './aba-pack.js';
import { evaluateAbaWin, type AbaHand, type AbaMeld, type AbaVersion, type AbaWin, type AbaWinContext } from './aba-win.js';

type Win = Extract<AbaWin, { status: 'winning' }>;
type Meld = { kind: AbaMeld['kind']; cardIds: string[] };
interface Player extends EnginePlayer {
  melds: Meld[];
  declaredWaits: number[] | null;
  declaredBonusIds: string[] | null;
}
type Source = { kind: AbaWinContext['source']; userId: string; cardId: string | null };
type Move =
  | { type: 'begin' | 'draw' | 'hu' }
  | { type: 'discard' | 'declare'; cardId: string }
  | { type: 'tou' | 'gang' | 'peng' | 'chi'; cardIds: string[] }
  | { type: 'ba'; cardId: string; meldIndex: number };
export type AbaAction = (Move | { type: 'respond'; choiceId: string | null }) & { decisionId: string };
interface Outcome {
  reason: 'hu' | 'draw'; winners: { userId: string; win: Win }[];
  payments: ReturnType<typeof roundTransfers>; nextRoundContext: RoundContext;
}
export interface AbaRound {
  version: AbaVersion;
  variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS; number: number; rules: Record<string, unknown>;
  players: Player[]; cards: CardState; dealerId: string; dealerRun: number; activeId: string;
  phase: 'opening' | 'discard' | 'draw' | 'response' | 'finished'; serial: number;
  replenish: { userId: string; resume: 'discard' | 'draw'; whites: string[]; last: string | null } | null;
  source: Source | null; claims: ClaimWindow | null; outcome: Outcome | null;
  openingDealerPending?: boolean;
  pendingDiscards?: string[];
}
export interface AbaEvent { type: string; [key: string]: unknown }
const special = (code: number) => [1001, 1002, 1003].includes(code);
const ordinaryRankForReward = (code: number) => code % 100;
const quanXingClosed = (state: AbaRound) => state.variantKey === '11:0' && state.rules.quanXing === 0;
const rewardCard = (state: AbaRound, code: number) => special(code) ||
  quanXingClosed(state) && ordinaryRankForReward(code) === 7;
const handZone = (id: string) => `hand:${id}`;
const meldZone = (id: string) => `melds:${id}`;
const bonusZone = (id: string) => `bonus:${id}`;
const whiteZone = (id: string) => `white:${id}`;
const decision = (state: AbaRound) => `ab:${state.number}:${state.serial}`;
const player = (state: AbaRound, id: string) => {
  const found = state.players.find(item => item.userId === id);
  requireCondition(found, 'NOT_ROOM_MEMBER', 'Only round members can act or view.', 403);
  return found;
};
const ids = (state: AbaRound, zone: string) => state.cards.zones.find(item => item.id === zone)!.cards;
const physical = (state: AbaRound, id: string) => state.cards.pack.find(card => card.id === id)!;
const cards = (state: AbaRound, zone: string) => ids(state, zone).map(id => physical(state, id));
const fullSize = (state: AbaRound, id: string) => 8 - 2 * player(state, id).melds.length;
function cycle(state: AbaRound, after: string) {
  const at = state.players.findIndex(item => item.userId === after);
  return [...state.players.slice(at + 1), ...state.players.slice(0, at + 1)].map(item => item.userId);
}
function hand(state: AbaRound, id: string, incoming?: string): AbaHand {
  return { concealed: [...cards(state, handZone(id)), ...(incoming ? [physical(state, incoming)] : [])],
    melds: player(state, id).melds.map(meld => ({ kind: meld.kind,
      cards: meld.cardIds.map(cardId => physical(state, cardId)) })),
    bonus: cards(state, bonusZone(id)) };
}
function whiteOwner(state: AbaRound, source: Source): string | null {
  if (source.kind !== 'white' || !source.cardId) return null;
  const zone = state.cards.zones.find(item => item.id.startsWith('white:') && item.cards.includes(source.cardId!));
  return zone ? zone.ownerId ?? zone.id.slice('white:'.length) : null;
}
function whiteUses(state: AbaRound, id: string, source: Source): string[] {
  if (source.kind !== 'white' || !source.cardId) return [];
  const owner = whiteOwner(state, source);
  if (!owner) return [];
  if (state.rules.baipiType === 2 && id !== owner) return [];
  return [source.cardId];
}
function facts(state: AbaRound, id: string, source: Source, baoJiao = false): AbaWinContext {
  const wildcards = whiteUses(state, id, source).map(cardId => ({ cardId, code: 1003 }));
  return { winnerSeat: player(state, id).seat, dealerSeat: player(state, state.dealerId).seat, source: source.kind,
    sourceSeat: source.kind === 'original-hand' ? null : player(state, source.userId).seat,
    incomingCardId: source.cardId, discardCount: Number(state.rules.__discards ?? 0), baoJiao,
    deckEmpty: ids(state, 'deck').length === 0, ...(wildcards.length ? { wildcards } : {}) };
}
function winning(state: AbaRound, id: string, source: Source, external: boolean): Win | null {
  const incoming = source.kind === 'white' ? undefined : external ? source.cardId! : undefined;
  const current = hand(state, id, incoming);
  if (current.concealed.length + whiteUses(state, id, source).length !== fullSize(state, id)) return null;
  const declared = player(state, id).declaredWaits;
  // A white face has no ordinary face of its own. It can satisfy a declared hand only when the
  // server can actually form a complete winning structure with that physical white as the wildcard.
  const declaredMatch = source.kind === 'white' ? true :
    declaredWaitMatches(declared, source.cardId === null ? null : physical(state, source.cardId).code);
  if (declared !== null && !declaredMatch) return null;
  if (source.kind === 'white' && state.rules.baipiType === 2 && id !== whiteOwner(state, source)) return null;
  if (source.kind === 'white' && !whiteUses(state, id, source).length) {
    return null;
  }
  const result = evaluateAbaWin(current, facts(state, id, source, declaredMatch && !external),
    state.rules, state.variantKey);
  return result.status === 'winning' ? result : null;
}
function stage(state: AbaRound, phase: AbaRound['phase'], activeId: string, source: Source | null = null) {
  if (phase === 'draw' && state.pendingDiscards?.includes(activeId) &&
    ids(state, handZone(activeId)).length === fullSize(state, activeId)) phase = 'discard';
  state.phase = phase; state.activeId = activeId; state.source = source; state.claims = null; state.serial++;
}
function assertSource(state: AbaRound): void {
  const source = state.source;
  requireCondition(state.phase !== 'opening' || source?.kind === 'original-hand',
    'INVALID_ABA_STATE', 'An opening round must retain its original-hand source.', 500);
  requireCondition(state.phase !== 'response' || source !== null,
    'INVALID_ABA_STATE', 'A response round must identify its source.', 500);
  if (source === null) return;
  requireCondition(typeof source.kind === 'string' && typeof source.userId === 'string' &&
    state.players.some(item => item.userId === source.userId),
  'INVALID_ABA_STATE', 'A round source must belong to a member.', 500);
  const zoneHas = (zoneId: string, cardId: unknown) => typeof cardId === 'string' &&
    state.cards.zones.some(zone => zone.id === zoneId && zone.cards.includes(cardId));
  if (source.kind === 'original-hand') {
    requireCondition(state.phase === 'opening' && source.userId === state.dealerId && source.cardId === null,
      'INVALID_ABA_STATE', 'An original-hand source must belong to the opening dealer.', 500);
  } else if (source.kind === 'replacement') {
    requireCondition(state.phase === 'discard' && zoneHas(handZone(source.userId), source.cardId),
      'INVALID_ABA_STATE', 'A replacement source must remain in its receiver hand.', 500);
  } else if (source.kind === 'white') {
    requireCondition(state.phase === 'response' && state.replenish !== null &&
      whiteOwner(state, source) === source.userId,
    'INVALID_ABA_STATE', 'A white source must remain in its owner response zone.', 500);
  } else if (source.kind === 'flip' || source.kind === 'discard') {
    requireCondition(state.phase === 'response' && zoneHas('table', source.cardId),
      'INVALID_ABA_STATE', 'A flipped or discarded source must remain on the table.', 500);
  } else {
    requireCondition(false, 'INVALID_ABA_STATE', 'Unknown round source kind.', 500);
  }
}
function move(state: AbaRound, from: string, to: string, selected: string[]) {
  state.cards = moveCards(state.cards, from, to, selected);
}
function continuation(state: AbaRound, dealerId: string): RoundContext {
  return { version: state.version, completedRound: state.number, nextDealerId: dealerId,
    dealerRun: dealerId === state.dealerId ? state.dealerRun + 1 : 1 };
}
function paymentsFor(state: AbaRound, winners: Outcome['winners']) {
  const members = state.players.map(item => item.userId);
  const transfers = winners.flatMap((winner, winnerIndex) => {
    const payers = state.source?.kind === 'discard'
      ? [state.source.userId] : members.filter(id => id !== winner.userId);
    return payers.filter(id => id !== winner.userId).map((payerId, payIndex) => ({
      id: `aba:${winnerIndex}:${payIndex}`, payerId, payeeId: winner.userId,
      ...exactPayment(winner, state.rules.baseBeans as string),
    }));
  });
  return roundTransfers(transfers, members);
}
function exactPayment(winner: Outcome['winners'][number], baseBeans: string) {
  return baseTimesRatio(baseBeans, BigInt(winner.win.scoreRatio.numerator),
    BigInt(winner.win.scoreRatio.denominator));
}
function comparePayments(left: Outcome['winners'][number], right: Outcome['winners'][number], baseBeans: string) {
  const a = exactPayment(left, baseBeans), b = exactPayment(right, baseBeans);
  const leftValue = BigInt(a.numerator) * BigInt(b.denominator);
  const rightValue = BigInt(b.numerator) * BigInt(a.denominator);
  return leftValue > rightValue ? 1 : leftValue < rightValue ? -1 : 0;
}
/** D08: every non-waiting player pays every valid waiter that waiter's own maximum single-hand value. */
function drawPaymentsFor(state: AbaRound, called: Outcome['winners']) {
  const members = state.players.map(item => item.userId);
  if (!called.length) return roundTransfers([], members);
  const waiterIds = new Set(called.map(winner => winner.userId));
  const payers = members.filter(id => !waiterIds.has(id));
  if (!payers.length) return roundTransfers([], members);
  const transfers = called.flatMap((winner, winnerIndex) => payers.map((payerId, payIndex) => ({
    id: `aba-draw:${winnerIndex}:${payIndex}`, payerId, payeeId: winner.userId,
    ...exactPayment(winner, state.rules.baseBeans as string),
  })));
  return roundTransfers(transfers, members);
}
function finish(state: AbaRound, reason: Outcome['reason'], winners: Outcome['winners'], events: AbaEvent[]) {
  const payments = reason === 'draw' ? drawPaymentsFor(state, winners) :
    winners.length ? paymentsFor(state, winners) : roundTransfers([], state.players.map(item => item.userId));
  const dealerId = reason === 'hu' ? winners[0]!.userId : state.dealerId;
  state.outcome = { reason, winners, payments, nextRoundContext: continuation(state, dealerId) };
  stage(state, 'finished', state.activeId);
  events.push({ type: 'round-ended', reason, winnerIds: reason === 'hu' ? winners.map(winner => winner.userId) : [],
    postings: payments.postings });
}
function drawEnd(state: AbaRound, events: AbaEvent[]) {
  const called: Outcome['winners'] = [];
  if (state.rules.chaJiao === 1) {
    for (const current of state.players) {
      const currentHand = hand(state, current.userId);
      if (currentHand.concealed.length !== fullSize(state, current.userId) - 1) continue;
      const bonusIds = current.declaredBonusIds ?? ids(state, bonusZone(current.userId));
      // A neutral other-seat flip grants neither a hypothetical self-draw nor an earth fan.
      const sourceSeat = player(state, cycle(state, current.userId)[0]!).seat;
      const waits = abaWaitResults(state, current.userId, currentHand, bonusIds, sourceSeat)
        .filter(wait => current.declaredWaits === null || current.declaredWaits.includes(wait.code));
      const best = waits.reduce<Win | null>((bestWait, wait) =>
        !bestWait || comparePayments({ userId: current.userId, win: wait.result },
          { userId: current.userId, win: bestWait }, state.rules.baseBeans as string) > 0
          ? wait.result : bestWait, null);
      if (best) called.push({ userId: current.userId, win: best });
    }
  }
  finish(state, 'draw', called, events);
}
function processRewards(state: AbaRound, id: string, events: AbaEvent[], whites: string[]) {
  const rewards = cards(state, handZone(id)).filter(card => rewardCard(state, card.code));
  for (const card of rewards) {
    if (card.code === 1003 && state.rules.baipiType !== 1) {
      move(state, handZone(id), whiteZone(id), [card.id]);
      whites.push(card.id);
      events.push({ type: 'white-revealed', userId: id, card, zone: whiteZone(id) });
    } else {
      move(state, handZone(id), bonusZone(id), [card.id]);
      events.push({ type: 'bonus', userId: id, card });
    }
  }
}
function replenish(state: AbaRound, id: string, target: number, events: AbaEvent[], whites: string[] = []): string | null {
  let last: string | null = null;
  for (;;) {
    processRewards(state, id, events, whites);
    if (ids(state, handZone(id)).length >= target) return last;
    const next = ids(state, 'deck')[0];
    if (!next) { drawEnd(state, events); return null; }
    move(state, 'deck', handZone(id), [next]);
    last = next;
    events.push({ type: 'replacement', userId: id, card: physical(state, next), remaining: ids(state, 'deck').length });
  }
}
/** Normalize to a waiting hand before offering each external white; never lose the continuation. */
function continueWhiteFlow(state: AbaRound, events: AbaEvent[]) {
  const pending = state.replenish!;
  for (;;) {
    const waiting = fullSize(state, pending.userId) - 1;
    const last = replenish(state, pending.userId, waiting, events, pending.whites);
    if (last) pending.last = last;
    if (state.phase === 'finished') { state.replenish = null; return; }
    const next = pending.whites.shift();
    if (next) {
      const source: Source = { kind: 'white', userId: '', cardId: next };
      source.userId = whiteOwner(state, source)!;
      openResponse(state, source, events);
      if (state.claims) return;
      move(state, whiteZone(source.userId), 'discards', [next]);
      continue;
    }
    if (pending.resume === 'discard' && ids(state, handZone(pending.userId)).length < fullSize(state, pending.userId)) {
      const nextCard = ids(state, 'deck')[0];
      if (!nextCard) { drawEnd(state, events); state.replenish = null; return; }
      move(state, 'deck', handZone(pending.userId), [nextCard]);
      pending.last = nextCard;
      events.push({ type: 'replacement', userId: pending.userId, card: physical(state, nextCard), remaining: ids(state, 'deck').length });
      processRewards(state, pending.userId, events, pending.whites);
      if (pending.whites.length || ids(state, handZone(pending.userId)).length < fullSize(state, pending.userId)) continue;
    }
    state.replenish = null;
    if (pending.resume === 'discard' && !state.pendingDiscards!.includes(pending.userId))
      state.pendingDiscards!.push(pending.userId);
    stage(state, pending.resume, pending.userId, pending.last && pending.resume === 'discard'
      ? { kind: 'replacement', userId: pending.userId, cardId: pending.last } : null);
    return;
  }
}
function whiteUsesAllowed(state: AbaRound, id: string, owner: string): boolean {
  return state.rules.baipiType === 3 || id === owner;
}
function ownMelds(state: AbaRound, id: string): Move[] {
  const current = player(state, id);
  if (current.declaredWaits !== null) return [];
  if (current.melds.length >= 3) return [];
  const ordinary = cards(state, handZone(id)).filter(card => !special(card.code));
  return ordinaryMeldCandidates(ordinary, ['peng', 'gang']).map(meld => ({
    type: meld.kind === 'peng' ? 'tou' as const : 'gang' as const, cardIds: [...meld.cardIds],
  }));
}
type ExposedMeld = { type: 'chi' | 'peng' | 'gang'; cardIds: string[] };
function whiteMeldCandidates(state: AbaRound, id: string, whiteId: string,
  kinds: readonly ('chi' | 'peng' | 'gang')[]): ExposedMeld[] {
  const current = player(state, id);
  if (current.melds.length >= 3) return [];
  const handCards = cards(state, handZone(id)).filter(card => !special(card.code));
  const result: ExposedMeld[] = [];
  const byRank = new Map<number, string[]>();
  for (const card of handCards) {
    const rank = card.code % 100;
    byRank.set(rank, [...(byRank.get(rank) ?? []), card.id]);
  }
  if (kinds.includes('chi')) {
    for (const card of handCards) result.push({ type: 'chi', cardIds: [card.id, whiteId] });
  }
  if (kinds.includes('peng')) {
    for (const ranks of byRank.values()) {
      if (ranks.length < 2) continue;
      for (let left = 0; left < ranks.length; left++) for (let right = left + 1; right < ranks.length; right++) {
        result.push({ type: 'peng', cardIds: [ranks[left]!, ranks[right]!, whiteId] });
      }
    }
  }
  if (kinds.includes('gang')) {
    for (const ranks of byRank.values()) {
      if (ranks.length < 3) continue;
      for (let first = 0; first < ranks.length; first++) for (let second = first + 1; second < ranks.length; second++) {
        for (let third = second + 1; third < ranks.length; third++) {
          result.push({ type: 'gang', cardIds: [ranks[first]!, ranks[second]!, ranks[third]!, whiteId] });
        }
      }
    }
  }
  return result;
}
/**
 * Enumerate the waiting faces of a hand against a frozen bonus snapshot. Only the initial pack
 * capacity constrains a wait; the remaining deck is never consulted (D08). The synthetic incoming
 * face uses a neutral other-seat flip so no hypothetical self-draw, 海底 or 杠上花 fan is counted.
 */
function abaWaitResults(state: AbaRound, id: string, current: AbaHand, bonusIds: readonly string[],
  sourceSeat: number): { code: number; result: Win }[] {
  const bonus = bonusIds.map(cardId => physical(state, cardId));
  const threshold = state.rules.baojiaoCondition === 1 ? (state.rules.huRedScore as number) - 100
    : state.rules.baojiaoCondition === 2 ? state.rules.huRedScore as number
      : Math.ceil((state.rules.huRedScore as number) / 2);
  const results: { code: number; result: Win }[] = [];
  for (const entry of abaPackSpecification()) {
    if (special(entry.code)) continue;
    const used = current.concealed.filter(card => card.code === entry.code).length +
      current.melds.flatMap(meld => meld.cards).filter(card => card.code === entry.code).length +
      bonus.filter(card => card.code === entry.code).length;
    if (used >= entry.count) continue;
    let idValue = `wait-${entry.code}`;
    while (current.concealed.some(card => card.id === idValue) ||
      current.melds.flatMap(meld => meld.cards).some(card => card.id === idValue) ||
      bonus.some(card => card.id === idValue)) idValue += '_';
    const result = evaluateAbaWin({
      concealed: [...current.concealed, { id: idValue, code: entry.code }],
      melds: current.melds, bonus,
    }, { winnerSeat: player(state, id).seat, dealerSeat: player(state, state.dealerId).seat,
      source: 'flip', sourceSeat, incomingCardId: idValue,
      discardCount: Number(state.rules.__discards ?? 0) }, state.rules, state.variantKey);
    if (result.status === 'winning' && result.structureScore >= threshold)
      results.push({ code: entry.code, result });
  }
  return results;
}
export function abaDeclarationFaces(state: AbaRound, id: string, discardId: string,
  bonusIds: readonly string[] = ids(state, bonusZone(id))): number[] | null {
  const current = hand(state, id);
  if (current.concealed.length !== fullSize(state, id) || !current.concealed.some(card => card.id === discardId)) return null;
  current.concealed = current.concealed.filter(card => card.id !== discardId);
  const faces = abaWaitResults(state, id, current, bonusIds, player(state, id).seat).map(wait => wait.code);
  return faces.length ? faces : null;
}
function offers(state: AbaRound, source: Source): ClaimOffer[] {
  const result: ClaimOffer[] = [];
  const add = (userId: string, action: Move, priority: number) => result.push({
    id: `${decision(state)}:${result.length}`, userId, action, priority, simultaneous: action.type === 'hu',
  });
  const nextSeat = cycle(state, source.userId)[0]!;
  if (source.kind === 'white') {
    const owner = whiteOwner(state, source)!;
    for (const id of cycle(state, source.userId)) {
      if (!whiteUsesAllowed(state, id, owner)) continue;
      if (winning(state, id, source, true)) add(id, { type: 'hu' }, 100);
      if (player(state, id).declaredWaits !== null) continue;
      if (ids(state, handZone(id)).length !== fullSize(state, id) - 1) continue;
      if (player(state, id).melds.length >= 3) continue;
      for (const meld of whiteMeldCandidates(state, id, source.cardId!, ['chi', 'peng', 'gang'])) {
        const priority = meld.type === 'gang' ? 30 : meld.type === 'peng' ? 20 : 10;
        add(id, meld, priority);
        if (meld.type === 'peng' && id === owner) add(id, { ...meld, type: 'tou' }, priority);
      }
    }
    return result;
  }
  const incoming = physical(state, source.cardId!);
  const incomingCards = special(incoming.code) ? [] : [incoming];
  for (const id of cycle(state, source.userId)) {
    if (source.kind === 'discard' && id === source.userId) continue;
    if (winning(state, id, source, true)) add(id, { type: 'hu' }, 100);
    if (player(state, id).declaredWaits !== null) continue;
    if (ids(state, handZone(id)).length !== fullSize(state, id) - 1) continue;
    if (player(state, id).melds.length >= 3) continue;
    const handCards = cards(state, handZone(id)).filter(card => !special(card.code));
    for (const meld of ordinaryMeldCandidates([...handCards, ...incomingCards], ['chi', 'peng', 'gang'])) {
      if (!meld.cardIds.includes(incoming.id)) continue;
      if (meld.kind === 'chi' && id !== nextSeat) continue;
      add(id, { type: meld.kind, cardIds: [...meld.cardIds] },
        meld.kind === 'gang' ? 30 : meld.kind === 'peng' ? 20 : 10);
    }
  }
  return result;
}
function openResponse(state: AbaRound, source: Source, events: AbaEvent[]) {
  stage(state, 'response', source.userId, source);
  state.claims = openClaims(decision(state), cycle(state, source.userId), offers(state, source));
  if (!state.claims.offers.length) {
    if (source.kind === 'white') {
      // The flow owns white disposal and the queued continuation.
      state.claims = null;
    } else {
      move(state, 'table', 'discards', [source.cardId!]);
      stage(state, 'draw', cycle(state, source.userId)[0]!);
    }
  } else events.push({ type: 'response-opened', decisionId: decision(state), sourceId: source.userId });
}
function performMeld(state: AbaRound, id: string, action: Move, external: boolean, events: AbaEvent[]) {
  const current = player(state, id);
  requireCondition(current.declaredWaits === null, 'INVALID_ACTION', 'A declared player cannot meld.', 409);
  const resume = external ? 'discard' : state.phase;
  requireCondition(resume === 'discard' || resume === 'draw', 'INVALID_ACTION', 'Unexpected meld phase.', 500);
  const incomingId = external ? state.source!.cardId! : null;
  if (action.type === 'ba') {
    const meld = current.melds[action.meldIndex]!;
    meld.kind = 'ba'; meld.cardIds.push(action.cardId);
    move(state, handZone(id), meldZone(id), [action.cardId]);
  } else {
    requireCondition(['chi', 'peng', 'tou', 'gang'].includes(action.type) && 'cardIds' in action,
      'INVALID_ACTION', 'Expected a server-offered meld.', 409);
    current.melds.push({ kind: action.type as AbaMeld['kind'], cardIds: [...action.cardIds] });
    if (incomingId) {
      const sourceKind = state.source!.kind;
      const sourceOwner = sourceKind === 'white' && state.source!.cardId
        ? whiteOwner(state, state.source!) ?? id : id;
      const sourceZone = sourceKind === 'white' ? whiteZone(sourceOwner) : 'table';
      move(state, sourceZone, meldZone(id), [incomingId]);
    }
    const fromHand = action.cardIds.filter(cardId => cardId !== incomingId);
    if (fromHand.length) move(state, handZone(id), meldZone(id), fromHand);
  }
  events.push({ type: 'meld', userId: id, kind: action.type,
    cards: current.melds.at(-1)!.cardIds.map(cardId => physical(state, cardId)) });
  if (state.rules.baipiType !== 1 && state.variantKey === '11:0') {
    if (ids(state, handZone(id)).length === fullSize(state, id) && !state.pendingDiscards!.includes(id))
      state.pendingDiscards!.push(id);
    state.replenish = { userId: id, resume, whites: state.replenish?.whites ?? [], last: null };
    continueWhiteFlow(state, events);
    return;
  }
  state.replenish = null;
  const replacement = replenish(state, id, fullSize(state, id) - (resume === 'draw' ? 1 : 0), events);
  if (state.phase === 'finished') return;
  if (!external) {
    stage(state, resume, id, replacement && resume === 'discard' ? { kind: 'replacement', userId: id, cardId: replacement } : null);
  } else {
    state.phase = resume; state.activeId = id; state.source = null; state.claims = null; state.serial++;
  }
}
export function createAbaRound(input: RoundInput, orderedCardIds: readonly string[],
  variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS = '9:0'): AbaRound {
  const players = [...input.players].sort((a, b) => a.seat - b.seat);
  requireCondition(players.length >= 2 && players.length <= 4 && players.length === input.rules.playerNum &&
    new Set(players.map(item => item.userId)).size === players.length &&
    players.every((item, index) => item.seat === index + 1) && players.some(item => item.userId === input.ownerUserId) &&
    Number.isSafeInteger(input.number) && input.number >= 1 && [4, 8, 12].includes(input.rules.gameNum as number) &&
    ABA_RED_SCORES.includes(input.rules.huRedScore as number) && [2, 3, 4, 99].includes(input.rules.maxFan as number) &&
    [1, 2, 3].includes(input.rules.baojiaoCondition as number) && typeof input.rules.baseBeans === 'string' &&
    amount(input.rules.baseBeans).gt(0),
  'INVALID_ROUND_INPUT', 'Explicit players, frozen Aba options and a positive base are required.', 500);
  requireCondition([1, 2, 3].includes(input.rules.baipiType as number), 'INVALID_ROUND_INPUT',
    'Aba white-face mode must be explicit.', 500);
  let dealerId = input.ownerUserId, dealerRun = 1;
  if (input.number > 1) {
    const prior = input.previousRoundContext;
    requireCondition(prior?.version === ABA_INDEPENDENT_VERSIONS[variantKey] && prior.completedRound === input.number - 1 &&
      typeof prior.nextDealerId === 'string' && players.some(item => item.userId === prior.nextDealerId),
    'ROUND_CONTEXT_REQUIRED', 'A later round cannot guess the historical dealer.', 409);
    dealerId = prior.nextDealerId as string; dealerRun = prior.dealerRun as number;
  } else requireCondition(input.previousRoundContext === undefined, 'INVALID_ROUND_INPUT', 'First rounds have no previous context.', 500);
  let cardState = createAbaCardState(variantKey, input.rules, 'deck', [
    { id: 'deck', visibility: 'hidden' }, { id: 'table', visibility: 'public' }, { id: 'discards', visibility: 'public' },
    { id: 'won', visibility: 'public' },
    ...players.flatMap(item => [{ id: handZone(item.userId), visibility: 'private' as const, ownerId: item.userId },
      { id: meldZone(item.userId), visibility: 'public' as const, ownerId: item.userId },
      { id: bonusZone(item.userId), visibility: 'public' as const, ownerId: item.userId },
      ...(input.rules.baipiType === 1 ? [] : [{ id: whiteZone(item.userId), visibility: 'public' as const,
        ownerId: item.userId }])]),
  ]);
  cardState = orderCards(cardState, 'deck', orderedCardIds);
  const dealerAt = players.findIndex(item => item.userId === dealerId);
  const sequence = [...players.slice(dealerAt), ...players.slice(0, dealerAt)].map(item => handZone(item.userId));
  cardState = dealCards(cardState, 'deck', [...Array.from({ length: 7 }, () => sequence).flat(), handZone(dealerId)]);
  const state: AbaRound = { version: ABA_INDEPENDENT_VERSIONS[variantKey], variantKey,
    number: input.number, rules: structuredClone(input.rules),
    players: players.map(item => ({ ...item, melds: [], declaredWaits: null, declaredBonusIds: null })), cards: cardState, dealerId, dealerRun,
    activeId: dealerId, phase: 'opening', serial: 0,
    replenish: null, source: { kind: 'original-hand', userId: dealerId, cardId: null }, claims: null, outcome: null, pendingDiscards: [] };
  assertAbaRound(state);
  return state;
}
export function abaLegalActions(state: AbaRound, id: string): AbaAction[] {
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
      const card = physical(state, cardId);
      if (rewardCard(state, card.code)) continue;
      const declared = player(state, id).declaredWaits;
      const waits = abaDeclarationFaces(state, id, cardId,
        player(state, id).declaredBonusIds ?? ids(state, bonusZone(id)));
      if (declared !== null && !sameDeclaredWaits(declared, waits)) continue;
      choices.push({ type: 'discard', cardId });
      if (declared === null && waits) {
        choices.push({ type: 'declare', cardId });
      }
    }
  }
  return choices.map(action => ({ ...action, decisionId: decision(state) }));
}
export function applyAbaAction(previous: AbaRound, id: string, action: unknown): EngineResult {
  assertAbaRound(previous);
  requireCondition(action != null && typeof action === 'object' && 'decisionId' in action &&
    action.decisionId === decision(previous), 'STALE_CLAIM_WINDOW', 'The action belongs to a closed decision.', 409);
  requireCondition(abaLegalActions(previous, id).some(candidate => isDeepStrictEqual(candidate, action)),
    'INVALID_ACTION', 'Choose an action offered by the server.', 409);
  const typed = action as AbaAction, state = structuredClone(previous), events: AbaEvent[] = [];
  if (typed.type === 'respond') {
    state.claims = submitClaim(state.claims!, typed.decisionId, id, typed.choiceId);
    const chosen = resolveClaims(state.claims);
    if (chosen) {
      const source = state.source!;
      if (!chosen.length) {
        if (source.kind === 'white') {
          move(state, whiteZone(whiteOwner(state, source)!), 'discards', [source.cardId!]);
          continueWhiteFlow(state, events);
        } else {
          move(state, 'table', 'discards', [source.cardId!]);
          stage(state, 'draw', cycle(state, source.userId)[0]!);
        }
      } else if ((chosen[0]!.action as Move).type === 'hu') {
        const winners = chosen.map(choice => {
          const win = winning(state, choice.userId, source, true);
          requireCondition(win, 'INVALID_ACTION', 'The claimed source cannot win this hand.', 409);
          return { userId: choice.userId, win };
        });
        if (source.kind === 'white') move(state, whiteZone(whiteOwner(state, source)!), 'won', [source.cardId!]);
        state.replenish = null;
        finish(state, 'hu', winners, events);
      } else performMeld(state, chosen[0]!.userId, chosen[0]!.action as Move, true, events);
    }
  } else if (typed.type === 'hu') {
    const win = state.source && winning(state, id, state.source, false);
    requireCondition(win, 'INVALID_ACTION', 'The current source cannot win this hand.', 409);
    finish(state, 'hu', [{ userId: id, win }], events);
  } else if (typed.type === 'begin') {
    const order = [state.dealerId, ...cycle(state, state.dealerId).slice(0, -1)];
    const whites: string[] = [];
    let dealerReplacement: string | null = null;
    if (state.variantKey === '11:0' && state.rules.baipiType !== 1) {
      // All seats must have processed special faces before anyone can use an opening white.
      for (const currentId of order) {
        processRewards(state, currentId, events, whites);
        replenish(state, currentId, 7, events, whites);
        if (state.phase === 'finished') break;
      }
      if (state.phase !== 'finished') {
        state.openingDealerPending = ids(state, handZone(state.dealerId)).length === 8;
        if (state.openingDealerPending) state.pendingDiscards!.push(state.dealerId);
        // A dealer with eight ordinary cards needs no external white to fill its hand.
        state.replenish = { userId: state.dealerId, resume: 'discard', whites, last: null };
        continueWhiteFlow(state, events);
      }
    } else {
      for (const currentId of order) {
        const replacement = replenish(state, currentId, currentId === state.dealerId ? 8 : 7, events);
        if (currentId === state.dealerId) dealerReplacement = replacement;
        if (state.phase === 'finished') break;
      }
      if (state.phase !== 'finished') stage(state, 'discard', state.dealerId,
        dealerReplacement ? { kind: 'replacement', userId: state.dealerId, cardId: dealerReplacement } : null);
    }
  } else if (typed.type === 'draw') {
    const next = ids(state, 'deck')[0];
    if (!next) drawEnd(state, events);
    else {
      const isWhite = physical(state, next).code === 1003 && state.rules.baipiType !== 1;
      move(state, 'deck', isWhite ? whiteZone(id) : 'table', [next]);
      events.push({ type: isWhite ? 'white-revealed' : 'flip', userId: id, card: physical(state, next),
        remaining: ids(state, 'deck').length });
      if (isWhite) {
        state.replenish = { userId: cycle(state, id)[0]!, resume: 'draw', whites: [next], last: null };
        continueWhiteFlow(state, events);
      } else openResponse(state, { kind: 'flip', userId: id, cardId: next }, events);
    }
  } else if (typed.type === 'discard' || typed.type === 'declare') {
    if (id === state.dealerId) state.openingDealerPending = false;
    state.pendingDiscards = state.pendingDiscards?.filter(current => current !== id) ?? [];
    if (typed.type === 'declare') {
      requireCondition(player(state, id).declaredWaits === null, 'INVALID_ACTION', 'A declared player cannot declare again.', 409);
      const bonusIds = [...ids(state, bonusZone(id))];
      const waits = abaDeclarationFaces(state, id, typed.cardId, bonusIds);
      requireCondition(waits, 'INVALID_ACTION', 'The selected discard has no legal declared wait.', 409);
      player(state, id).declaredWaits = [...waits];
      player(state, id).declaredBonusIds = bonusIds;
    } else {
      const declared = player(state, id).declaredWaits;
      const declaredBonusIds = player(state, id).declaredBonusIds;
      requireCondition(declared === null || sameDeclaredWaits(declared,
        abaDeclarationFaces(state, id, typed.cardId, declaredBonusIds ?? [])),
        'INVALID_ACTION', 'A discard must preserve the complete declared wait set.', 409);
    }
    move(state, handZone(id), 'table', [typed.cardId]);
    state.rules.__discards = Number(state.rules.__discards ?? 0) + 1;
    events.push({ type: 'discard', userId: id, card: physical(state, typed.cardId), declared: typed.type === 'declare' });
    openResponse(state, { kind: 'discard', userId: id, cardId: typed.cardId }, events);
  } else performMeld(state, id, typed, false, events);
  assertAbaRound(state);
  return { snapshot: state, events, ...(state.outcome ? { confirmedScores: [{ eventId: `ab:${state.number}:final`,
    postings: state.outcome.payments.postings, transfers: state.outcome.payments.transfers }],
    settlement: state.outcome.payments.postings, nextRoundContext: state.outcome.nextRoundContext } : {}) };
}
export function assertAbaRound(state: AbaRound): void {
  requireCondition(state.version === ABA_INDEPENDENT_VERSIONS[state.variantKey], 'ABA_RULES_VERSION_REQUIRED',
    'Unknown round version.', 409);
  assertCardState(state.cards);
  assertSource(state);
  const capacity = abaPackSpecification().flatMap(entry => Array<number>(entry.count).fill(entry.code)).sort((a, b) => a - b);
  requireCondition(isDeepStrictEqual(state.cards.pack.map(card => card.code).sort((a, b) => a - b), capacity) &&
    state.players.some(item => item.userId === state.dealerId) &&
    ['opening', 'discard', 'draw', 'response', 'finished'].includes(state.phase),
  'INVALID_ABA_STATE', 'Physical pack and turn phase must be consistent.', 500);
  requireCondition(new Set(state.pendingDiscards ?? []).size === (state.pendingDiscards ?? []).length &&
    (state.pendingDiscards ?? []).every(id => state.players.some(item => item.userId === id)),
  'INVALID_ABA_STATE', 'Only unique round members may retain a pending discard.', 500);
  for (const current of state.players) {
    const meldIds = current.melds.flatMap(meld => meld.cardIds);
    requireCondition(isDeepStrictEqual([...meldIds].sort(), [...ids(state, meldZone(current.userId))].sort()),
      'INVALID_ABA_STATE', 'Declared melds must reference exactly the physical meld zone.', 500);
    requireCondition(current.declaredBonusIds == null ? current.declaredWaits == null :
      Array.isArray(current.declaredBonusIds) && Array.isArray(current.declaredWaits) &&
      current.declaredWaits.length > 0 && current.declaredWaits.every(value => Number.isSafeInteger(value) && value > 0) &&
      new Set(current.declaredWaits).size === current.declaredWaits.length &&
      new Set(current.declaredBonusIds).size === current.declaredBonusIds.length &&
      current.declaredBonusIds.every(cardId => ids(state, bonusZone(current.userId)).includes(cardId)),
    'INVALID_ABA_STATE', 'A declaration must freeze a valid bonus snapshot with its waits.', 500);
    if (state.rules.baipiType !== 1) requireCondition(cards(state, whiteZone(current.userId)).every(card => card.code === 1003) &&
      cards(state, bonusZone(current.userId)).every(card => card.code !== 1003),
    'INVALID_ABA_STATE', 'External white faces never become bonus cards or non-white identities.', 500);
    if (state.phase === 'finished') continue;
    const expected = fullSize(state, current.userId) -
      (['opening', 'discard'].includes(state.phase) && state.activeId === current.userId ? 0 : 1);
    const pendingDiscard = state.pendingDiscards?.includes(current.userId) &&
      ids(state, handZone(current.userId)).length === fullSize(state, current.userId);
    requireCondition(ids(state, handZone(current.userId)).length === expected || pendingDiscard,
      'INVALID_ABA_STATE', 'Concealed hand count is inconsistent.', 500);
    requireCondition(state.phase === 'opening' ||
      cards(state, handZone(current.userId)).every(card => !rewardCard(state, card.code)),
      'INVALID_ABA_STATE', 'Unprocessed white-face rewards cannot remain in a playable hand.', 500);
  }
  const responseCard = state.source?.kind === 'white'
    ? ids(state, 'table').length === 0 && whiteOwner(state, state.source) === state.source.userId && state.replenish !== null
    : ids(state, 'table').length === 1;
  requireCondition(state.phase === 'response' ? state.claims?.id === decision(state) && responseCard
    : state.claims === null && (state.phase === 'finished' || ids(state, 'table').length === 0),
  'INVALID_ABA_STATE', 'Public card and response phase must agree.', 500);
  if (state.replenish) {
    const pending = state.replenish;
    requireCondition(state.phase === 'response' && state.source?.kind === 'white' &&
      state.players.some(item => item.userId === pending.userId) &&
      new Set(pending.whites).size === pending.whites.length &&
      pending.whites.every(cardId => cardId !== state.source!.cardId &&
        whiteOwner(state, { kind: 'white', userId: '', cardId }) !== null),
    'INVALID_ABA_STATE', 'A white response must retain a unique physical continuation queue.', 500);
  }
}
export function viewAbaRound(state: AbaRound, id: string) {
  player(state, id);
  return structuredClone({ version: state.version, number: state.number, phase: state.phase,
    dealerId: state.dealerId, activeId: state.activeId, decisionId: decision(state),
    cards: projectCardState(state.cards, id),
    players: state.players.map(item => ({ userId: item.userId, seat: item.seat, melds: structuredClone(item.melds) })),
    legalActions: abaLegalActions(state, id), responses: state.claims ? projectClaims(state.claims, id) : null,
    outcome: state.outcome ? { reason: state.outcome.reason, postings: state.outcome.payments.postings,
      winners: state.outcome.winners.map(winner => ({ userId: winner.userId, structureScore: winner.win.structureScore,
        redPoints: winner.win.redPoints, blackPoints: winner.win.blackPoints, scoreUnits: winner.win.scoreUnits })) } : null });
}
export function abaTimedAction(state: AbaRound, id: string) {
  const actions = abaLegalActions(state, id);
  if (!actions.length) return null;
  const hu = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId !== null &&
    (state.claims!.offers.find(offer => offer.id === action.choiceId)!.action as Move).type === 'hu') : actions.find(action => action.type === 'hu');
  const fallback = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId === null)
    : actions.find(action => action.type === 'begin' || action.type === 'draw') ??
      actions.filter((action): action is AbaAction & { type: 'discard'; cardId: string } => action.type === 'discard')
        .sort((a, b) => a.cardId.localeCompare(b.cardId))[0];
  return { userId: id, decisionId: decision(state), delayMs: state.phase === 'response' ? 15000 : 30000,
    action: hu ?? fallback! };
}
