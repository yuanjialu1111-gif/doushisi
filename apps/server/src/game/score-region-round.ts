import { isDeepStrictEqual } from 'node:util';
import { SCORE_REGION_VERSIONS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { EnginePlayer, EngineResult, RoundContext, RoundInput } from '../engines.js';
import { amount } from '../money.js';
import { baseTimesRatio, roundTransfers } from '../transfers.js';
import { assertCardState, dealCards, moveCards, orderCards, projectCardState, type CardState } from './cards.js';
import { openClaims, projectClaims, resolveClaims, submitClaim, type ClaimWindow, type ClaimOffer } from './claims.js';
import { declaredWaitMatches, sameDeclaredWaits } from './declared-waits.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { createScoreRegionCardState, scoreRegionPackSpecification } from './score-region-pack.js';
import { isRongxianSmallSeat, regionalPackSpecification } from './regional-profile.js';
import { automaticBonusCard, wildcardCard } from './regional-profile.js';
import { evaluateScoreRegionWin, type ScoreRegionHand, type ScoreRegionMeld, type ScoreRegionVersion,
  scoreRegionWaits, type ScoreRegionWin, type ScoreRegionWinItem, type ScoreRegionContext } from './score-region-win.js';
import { evaluateRedRegionWin, redRegionWaits } from './red-region-win.js';
import { regionalThresholdUsesRedPoints } from './regional-profile.js';

type Win = Extract<ScoreRegionWin, { status: 'winning' }>;
type Meld = { kind: ScoreRegionMeld['kind']; cardIds: string[] };
interface PassedClaimFace { rank: number; handRevision: number }
interface Player extends EnginePlayer { melds: Meld[]; declaredWaits: number[] | null; declaredBonusIds: string[] | null;
  piao: number | null; handRevision: number; passedClaimFaces: PassedClaimFace[] }
type Source = { kind: ScoreRegionContext['source']; userId: string; cardId: string | null; afterGang?: boolean; ownBa?: true };
type ResponseResume =
  | { kind: 'discard'; source: Source }
  | { kind: 'draw'; source: Source }
  | { kind: 'own-ba'; userId: string; cardId: string; meldIndex: number; phase: 'discard' | 'draw' }
  | { kind: 'pass-discard' };
type Move =
  | { type: 'begin' | 'draw' | 'hu' }
  | { type: 'discard' | 'declare'; cardId: string }
  | { type: 'tou' | 'gang' | 'peng' | 'chi'; cardIds: string[] }
  | { type: 'ba'; cardId: string; meldIndex: number }
  | { type: 'piao'; value: 0 | 1 };
type MeldMove = Extract<Move, { cardIds: string[] }>;
export type ScoreRegionAction = (Move | { type: 'respond'; choiceId: string | null }) & { decisionId: string };
interface Outcome {
  reason: 'hu' | 'draw'; winners: OutcomeWinner[];
  payments: ReturnType<typeof roundTransfers>; nextRoundContext: RoundContext;
}
interface OutcomeWinner { userId: string; win: Win; waitCode?: number;
  payerWins?: { payerId: string; win: Win; waitCode?: number }[] }
export interface ScoreRegionRound {
  version: ScoreRegionVersion; variantKey: keyof typeof SCORE_REGION_VERSIONS;
  number: number; rules: Record<string, unknown>;
  players: Player[]; cards: CardState; dealerId: string; dealerRun: number; activeId: string;
  phase: 'piao' | 'opening' | 'discard' | 'draw' | 'response' | 'finished'; serial: number;
  source: Source | null; claims: ClaimWindow | null; outcome: Outcome | null;
  responseResume?: ResponseResume | null;
}
export interface ScoreRegionEvent { type: string; [key: string]: unknown }
const special = (code: number) => [1001, 1002, 1003].includes(code);
const enabled = (value: unknown) => value === 1 || value === true;
const handZone = (id: string) => `hand:${id}`;
const meldZone = (id: string) => `melds:${id}`;
const bonusZone = (id: string) => `bonus:${id}`;
const decision = (state: ScoreRegionRound) => `sr:${state.number}:${state.serial}`;
const handRevision = (current: Player) => current.handRevision ?? 0;
const passedClaimFaces = (current: Player) => current.passedClaimFaces ?? [];
const bumpHandRevision = (current: Player) => { current.handRevision = handRevision(current) + 1; };
const passLocked = (state: ScoreRegionRound, current: Player, rank: number) =>
  state.variantKey === '23:0' && enabled(state.rules.guoZhangNoCaozuo) &&
  passedClaimFaces(current).some(face => face.rank === rank && face.handRevision === handRevision(current));
const rememberPass = (state: ScoreRegionRound, current: Player, rank: number) => {
  if (state.variantKey !== '23:0' || !enabled(state.rules.guoZhangNoCaozuo)) return;
  const revision = handRevision(current);
  if (!passedClaimFaces(current).some(face => face.rank === rank && face.handRevision === revision)) {
    current.passedClaimFaces = [...passedClaimFaces(current), { rank, handRevision: revision }];
  }
};
const piaoValue = (state: ScoreRegionRound, id: string) => {
  if (state.variantKey !== '23:0' || state.rules.piaoType === 0) return 0;
  return player(state, id).piao ?? 0;
};
const payerForWinner = (state: ScoreRegionRound, winnerId: string) => {
  const sourceId = state.source?.userId;
  return sourceId && sourceId !== winnerId ? sourceId : undefined;
};
const player = (state: ScoreRegionRound, id: string) => {
  const found = state.players.find(item => item.userId === id);
  requireCondition(found, 'NOT_ROOM_MEMBER', 'Only round members can act or view.', 403);
  return found;
};
const ids = (state: ScoreRegionRound, zone: string) => state.cards.zones.find(item => item.id === zone)!.cards;
const physical = (state: ScoreRegionRound, id: string) => state.cards.pack.find(card => card.id === id)!;
const cards = (state: ScoreRegionRound, zone: string) => ids(state, zone).map(id => physical(state, id));
const fullSize = (state: ScoreRegionRound, id: string) => {
  const current = player(state, id);
  const base = isRongxianSmallSeat(state.variantKey, state.rules, state.players.length,
    current.seat, player(state, state.dealerId).seat) ? 6 : 8;
  return base - 2 * current.melds.length;
};
function cycle(state: ScoreRegionRound, after: string) {
  const at = state.players.findIndex(item => item.userId === after);
  return [...state.players.slice(at + 1), ...state.players.slice(0, at + 1)].map(item => item.userId);
}
function hand(state: ScoreRegionRound, id: string, incoming?: string): ScoreRegionHand {
  return { concealed: [...cards(state, handZone(id)), ...(incoming ? [physical(state, incoming)] : [])],
    melds: player(state, id).melds.map(meld => ({ kind: meld.kind,
      cards: meld.cardIds.map(cardId => physical(state, cardId)) })),
    bonus: cards(state, bonusZone(id)) };
}
function facts(state: ScoreRegionRound, id: string, source: Source, baoJiao = false,
  payerId?: string): ScoreRegionContext {
  return { winnerSeat: player(state, id).seat, dealerSeat: player(state, state.dealerId).seat, source: source.kind,
    sourceSeat: source.kind === 'original-hand' ? null : player(state, source.userId).seat,
    incomingCardId: source.cardId, discardCount: Number(state.rules.__discards ?? 0), baoJiao,
    piaoWinner: piaoValue(state, id), piaoPayer: payerId ? piaoValue(state, payerId) : 0,
    afterGang: source.afterGang, ownBa: source.ownBa };
}
export { declaredWaitMatches, sameDeclaredWaits } from './declared-waits.js';
function winning(state: ScoreRegionRound, id: string, source: Source, external: boolean, payerId?: string): Win | null {
  const current = hand(state, id, external ? source.cardId! : undefined);
  if (current.concealed.length !== fullSize(state, id)) return null;
  const declared = player(state, id).declaredWaits;
  const declaredMatch = declaredWaitMatches(declared,
    source.cardId === null ? null : physical(state, source.cardId).code);
  if (declared !== null && !declaredMatch) return null;
  const context = facts(state, id, source, declaredMatch && !external, payerId);
  const result = regionalThresholdUsesRedPoints(state.variantKey)
    ? evaluateRedRegionWin(current, context, state.rules, state.variantKey)
    : evaluateScoreRegionWin(current, context, state.rules, state.variantKey);
  return result.status === 'winning' ? result : null;
}
export function scoreRegionDeclarationFaces(state: ScoreRegionRound, id: string, discardId: string,
  bonusIds: readonly string[] = ids(state, bonusZone(id))): number[] | null {
  const current = hand(state, id);
  if (current.concealed.length !== fullSize(state, id) || !current.concealed.some(card => card.id === discardId)) return null;
  current.concealed = current.concealed.filter(card => card.id !== discardId);
  const expectedConcealed = fullSize(state, id) - 1;
  if (current.concealed.length !== expectedConcealed) return null;
  current.bonus = bonusIds.map(cardId => physical(state, cardId));
  const context = {
    winnerSeat: player(state, id).seat, dealerSeat: player(state, state.dealerId).seat,
    source: 'discard' as const, sourceSeat: player(state, id).seat,
    discardCount: Number(state.rules.__discards ?? 0),
  };
  const waitFaces = (regionalThresholdUsesRedPoints(state.variantKey)
    ? redRegionWaits(current, context, state.rules, state.variantKey, expectedConcealed)
    : scoreRegionWaits(current, context, state.rules, state.variantKey, expectedConcealed)).map(wait => wait.code);
  return waitFaces.length ? waitFaces : null;
}
function stage(state: ScoreRegionRound, phase: ScoreRegionRound['phase'], activeId: string, source: Source | null = null) {
  state.phase = phase; state.activeId = activeId; state.source = source; state.claims = null;
  state.responseResume = null; state.serial++;
}
function enterDiscard(state: ScoreRegionRound, id: string, source: Source | null, events: ScoreRegionEvent[]) {
  stage(state, 'discard', id, source);
  if (ids(state, handZone(id)).length === 0) drawEnd(state, events);
}
function move(state: ScoreRegionRound, from: string, to: string, selected: string[]) {
  state.cards = moveCards(state.cards, from, to, selected);
}
function continuation(state: ScoreRegionRound, dealerId: string): RoundContext {
  return { version: state.version, completedRound: state.number, nextDealerId: dealerId,
    dealerRun: dealerId === state.dealerId ? state.dealerRun + 1 : 1 };
}
function paymentsFor(state: ScoreRegionRound, winners: Outcome['winners']) {
  const members = state.players.map(item => item.userId);
  const transfers = winners.flatMap((winner, winnerIndex) => {
    const discard = state.source?.kind === 'discard';
    const payers = discard
      ? state.variantKey === '22:0' && enabled(state.rules.dianpaoBaopei)
        ? members.filter(id => id !== winner.userId)
        : [state.source!.userId]
      : members.filter(id => id !== winner.userId);
    const payerWins: NonNullable<OutcomeWinner['payerWins']> = [];
    const winnerTransfers = payers.filter(id => id !== winner.userId).map((payerId, payIndex) => {
      const external = state.source?.kind === 'discard' || state.source?.kind === 'flip';
      const share = state.variantKey === '23:0' && state.rules.piaoType === 2
        ? winning(state, winner.userId, state.source!, external, payerId) ?? winner.win
        : winner.win;
      const transferPayerId = discard && enabled(state.rules.dianpaoBaopei)
        ? state.source!.userId : payerId;
      if (state.variantKey === '23:0' && state.rules.piaoType === 2) {
        // Omit an absent waitCode rather than storing an undefined-valued key. Room actions persist
        // the snapshot as JSON, which drops undefined while replay keeps it, so the property must
        // only exist when it carries a real value or replays can never reproduce the stored state.
        payerWins.push({ payerId: transferPayerId, win: share,
          ...(winner.waitCode === undefined ? {} : { waitCode: winner.waitCode }) });
      }
      return { id: `score-region:${winnerIndex}:${payIndex}`, payerId: transferPayerId, payeeId: winner.userId,
        ...exactPayment({ userId: winner.userId, win: share }, state.rules.baseBeans as string) };
    });
    if (payerWins.length) winner.payerWins = payerWins;
    return winnerTransfers;
  });
  return roundTransfers(transfers, members);
}
function exactPayment(winner: Outcome['winners'][number], baseBeans: string) {
  const ratio = winner.win.scoreRatio;
  const base = ratio.applyBase
    ? baseTimesRatio(baseBeans, BigInt(ratio.numerator), BigInt(ratio.denominator))
    : { numerator: ratio.numerator, denominator: ratio.denominator };
  const additive = BigInt(ratio.additiveUnits);
  return { numerator: (BigInt(base.numerator) + additive * BigInt(base.denominator)).toString(),
    denominator: base.denominator };
}
function comparePayments(left: Outcome['winners'][number], right: Outcome['winners'][number], baseBeans: string) {
  const a = exactPayment(left, baseBeans), b = exactPayment(right, baseBeans);
  const leftValue = BigInt(a.numerator) * BigInt(b.denominator);
  const rightValue = BigInt(b.numerator) * BigInt(a.denominator);
  return leftValue > rightValue ? 1 : leftValue < rightValue ? -1 : 0;
}
function drawPaymentsFor(state: ScoreRegionRound, called: Outcome['winners']) {
  const members = state.players.map(item => item.userId);
  if (!called.length) return roundTransfers([], members);
  const winnerIds = new Set(called.map(winner => winner.userId));
  const payers = members.filter(id => !winnerIds.has(id));
  if (!payers.length) return roundTransfers([], members);
  const transfers = called.flatMap((winner, winnerIndex) => {
    const payerWins: NonNullable<OutcomeWinner['payerWins']> = [];
    const winnerTransfers = payers.map((payerId, payIndex) => {
      const share = drawShareFor(state, winner, payerId);
      if (state.variantKey === '23:0' && state.rules.piaoType === 2) {
        payerWins.push({ payerId, win: share,
          ...(winner.waitCode === undefined ? {} : { waitCode: winner.waitCode }) });
      }
      return {
        id: `score-region-draw:${winnerIndex}:${payIndex}`, payerId, payeeId: winner.userId,
        ...exactPayment({ userId: winner.userId, win: share }, state.rules.baseBeans as string),
      };
    });
    if (payerWins.length) winner.payerWins = payerWins;
    return winnerTransfers;
  });
  return roundTransfers(transfers, members);
}
function drawShareFor(state: ScoreRegionRound, winner: Outcome['winners'][number], payerId: string): Win {
  if (state.variantKey !== '23:0' || state.rules.piaoType !== 2 || winner.waitCode === undefined) return winner.win;
  const nextId = cycle(state, winner.userId)[0]!;
  const currentHand = hand(state, winner.userId);
  const waits = redRegionWaits(currentHand, {
    winnerSeat: player(state, winner.userId).seat, dealerSeat: player(state, state.dealerId).seat,
    sourceSeat: player(state, nextId).seat, discardCount: Math.max(2, Number(state.rules.__discards ?? 0)),
    piaoWinner: piaoValue(state, winner.userId), piaoPayer: piaoValue(state, payerId),
  }, state.rules, state.variantKey, fullSize(state, winner.userId) - 1);
  return waits.find(wait => wait.code === winner.waitCode)?.result ?? winner.win;
}
function finish(state: ScoreRegionRound, reason: Outcome['reason'], winners: Outcome['winners'], events: ScoreRegionEvent[]) {
  const payments = reason === 'draw' ? drawPaymentsFor(state, winners) :
    winners.length ? paymentsFor(state, winners) : roundTransfers([], state.players.map(item => item.userId));
  const dealerId = reason === 'hu' ? winners[0]!.userId : state.dealerId;
  state.outcome = { reason, winners, payments, nextRoundContext: continuation(state, dealerId) };
  stage(state, 'finished', state.activeId);
  events.push({ type: 'round-ended', reason, winnerIds: reason === 'hu' ? winners.map(winner => winner.userId) : [],
    postings: payments.postings });
}
function drawEnd(state: ScoreRegionRound, events: ScoreRegionEvent[]) {
  const called: Outcome['winners'] = [];
  if (state.rules.chaJiao === 1) {
    for (const current of state.players) {
      const currentHand = hand(state, current.userId);
      if (currentHand.concealed.length !== fullSize(state, current.userId) - 1) continue;
      const nextId = cycle(state, current.userId)[0]!;
      const context = {
        winnerSeat: current.seat, dealerSeat: player(state, state.dealerId).seat,
        sourceSeat: player(state, nextId).seat,
        discardCount: Math.max(2, Number(state.rules.__discards ?? 0)),
      };
      if (current.declaredWaits !== null) {
        const lockedHand = hand(state, current.userId);
        lockedHand.bonus = (current.declaredBonusIds ?? []).map(cardId => physical(state, cardId));
        const lockedWaits = regionalThresholdUsesRedPoints(state.variantKey)
          ? redRegionWaits(lockedHand, context, state.rules, state.variantKey, fullSize(state, current.userId) - 1)
          : scoreRegionWaits(lockedHand, context, state.rules, state.variantKey, fullSize(state, current.userId) - 1);
        if (!sameDeclaredWaits(current.declaredWaits, lockedWaits.map(wait => wait.code))) continue;
      }
      const waits = regionalThresholdUsesRedPoints(state.variantKey)
        ? redRegionWaits(currentHand, context, state.rules, state.variantKey, fullSize(state, current.userId) - 1)
        : scoreRegionWaits(currentHand, context, state.rules, state.variantKey, fullSize(state, current.userId) - 1);
      const best = waits.reduce<typeof waits[number] | null>((bestWait, wait) =>
        !bestWait || comparePayments({ userId: current.userId, win: wait.result },
          { userId: current.userId, win: bestWait.result }, state.rules.baseBeans as string) > 0
          ? wait : bestWait, null);
      if (best) called.push({ userId: current.userId, win: best.result, waitCode: best.code });
    }
  }
  finish(state, 'draw', called, events);
}
function replenish(state: ScoreRegionRound, id: string, target: number, events: ScoreRegionEvent[]): string | null {
  let last: string | null = null;
  let handChanged = false;
  for (;;) {
    const rewards = cards(state, handZone(id))
      .filter(card => automaticBonusCard(state.variantKey, state.rules, card.code));
    for (const card of rewards) {
      move(state, handZone(id), bonusZone(id), [card.id]);
      handChanged = true;
      events.push({ type: 'bonus', userId: id, card });
    }
    if (ids(state, handZone(id)).length >= target) {
      if (handChanged) bumpHandRevision(player(state, id));
      return last;
    }
    const next = ids(state, 'deck')[0];
    if (!next) { drawEnd(state, events); return null; }
    move(state, 'deck', handZone(id), [next]);
    handChanged = true;
    last = next;
    events.push({ type: 'replacement', userId: id, card: physical(state, next), remaining: ids(state, 'deck').length });
  }
}
function multiCardGangs(state: ScoreRegionRound, natural: readonly { id: string; code: number }[],
  wildcards: readonly { id: string; code: number }[] = []): MeldMove[] {
  if (state.variantKey !== '23:0' || !enabled(state.rules.gangDuoZhang)) return [];
  const byRank = new Map<number, { id: string; code: number }[]>();
  for (const card of natural) {
    const rank = ordinaryRank(card.code);
    byRank.set(rank, [...(byRank.get(rank) ?? []), card]);
  }
  const results: MeldMove[] = [];
  for (const group of byRank.values()) {
    if (group.length < 4) continue;
    const orderedWildcards = [...wildcards].sort((a, b) => a.id.localeCompare(b.id));
    const maximum = group.length + orderedWildcards.length;
    for (let size = 5; size <= maximum; size++) {
      const cardIds = [...group.map(card => card.id),
        ...orderedWildcards.slice(0, size - group.length).map(card => card.id)].sort();
      results.push({ type: 'gang' as const, cardIds });
    }
  }
  return results;
}
function hasLegalHu(state: ScoreRegionRound, id: string, source: Source): boolean {
  return winning(state, id, source, source.kind === 'discard' || source.kind === 'flip') !== null;
}
function forcedBaAction(state: ScoreRegionRound, id: string, source: Source): Move | null {
  if (state.variantKey !== '23:0' || !enabled(state.rules.baNoGuo) || hasLegalHu(state, id, source)) return null;
  const incoming = physical(state, source.cardId!);
  if (wildcardCard(state.variantKey, state.rules, incoming.code) ||
    automaticBonusCard(state.variantKey, state.rules, incoming.code)) return null;
  const incomingRank = ordinaryRank(incoming.code);
  const current = player(state, id);
  const canFormFourteen = cards(state, handZone(id)).some(card =>
    !wildcardCard(state.variantKey, state.rules, card.code) &&
    !automaticBonusCard(state.variantKey, state.rules, card.code) &&
    ordinaryRank(card.code) === 14 - incomingRank);
  if (canFormFourteen) return null;
  for (let meldIndex = 0; meldIndex < current.melds.length; meldIndex++) {
    const meld = current.melds[meldIndex]!;
    if (!['peng', 'tou'].includes(meld.kind) ||
      ordinaryRank(physical(state, meld.cardIds[0]!).code) !== incomingRank) continue;
    if (source.kind !== 'discard' && source.userId === id) return null;
    return { type: 'ba', cardId: source.cardId!, meldIndex };
  }
  return null;
}
function ownMelds(state: ScoreRegionRound, id: string): Move[] {
  const current = player(state, id);
  if (current.declaredWaits !== null) return [];
  const natural = cards(state, handZone(id)).filter(card =>
    !wildcardCard(state.variantKey, state.rules, card.code) &&
    !automaticBonusCard(state.variantKey, state.rules, card.code));
  const wildcards = cards(state, handZone(id)).filter(card =>
    wildcardCard(state.variantKey, state.rules, card.code));
  const ordinary = ordinaryMeldCandidates(natural, ['peng', 'gang']);
  const moves: Move[] = current.melds.length >= 3 ? [] : [
    ...ordinary.map(meld => ({ type: meld.kind === 'peng' ? 'tou' as const : 'gang' as const,
      cardIds: [...meld.cardIds] })),
    ...multiCardGangs(state, natural, wildcards),
  ];
  current.melds.forEach((meld, meldIndex) => {
    if (!['peng', 'tou'].includes(meld.kind)) return;
    const rank = ordinaryRank(physical(state, meld.cardIds[0]!).code);
    for (const card of natural) if (ordinaryRank(card.code) === rank) moves.push({ type: 'ba', cardId: card.id, meldIndex });
  });
  return moves;
}
function offers(state: ScoreRegionRound, source: Source): { offers: ClaimOffer[]; passOnlyUserIds: string[] } {
  const result: ClaimOffer[] = [];
  const passOnlyUserIds: string[] = [];
  const incoming = physical(state, source.cardId!);
  const add = (userId: string, action: Move, priority: number) => result.push({
    id: `${decision(state)}:${result.length}`, userId, action, priority, simultaneous: action.type === 'hu',
  });
  const nextSeat = cycle(state, source.userId)[0]!;
  for (const id of cycle(state, source.userId)) {
    if (source.ownBa && id === source.userId) continue;
    // A replacement stays in its owner's hand until the other seats have had
    // their chance to rob it. The owner cannot claim their own replacement.
    if (source.kind === 'replacement' && id === source.userId) continue;
    if (source.kind === 'discard' && id === source.userId) continue;
    if (winning(state, id, source, true)) {
      add(id, { type: 'hu' }, 100);
    }
    // A concealed ba is only exposed for the other seats' rob-hu window.
    // It is not a discard and cannot be claimed as chi/peng/gang/ba.
    if (source.ownBa) continue;
    // Robbing a replacement is hu/qiang-7 only. The replacement is not a
    // public discard, so chi/peng/gang/ba cannot consume it.
    if (source.kind === 'replacement') continue;
    const forced = forcedBaAction(state, id, source);
    if (forced) {
      add(id, forced, 30);
      for (let index = result.length - 1; index >= 0; index--) {
        const offer = result[index]!;
        if (offer.userId === id && !isDeepStrictEqual(offer.action, forced)) result.splice(index, 1);
      }
      continue;
    }
    if (player(state, id).declaredWaits !== null) continue;
    if (player(state, id).melds.length >= 3) continue;
    const claimable = [...cards(state, handZone(id)), incoming]
      .filter(card => !wildcardCard(state.variantKey, state.rules, card.code) &&
        !automaticBonusCard(state.variantKey, state.rules, card.code));
    const claimableWildcards = [...cards(state, handZone(id)), incoming]
      .filter(card => wildcardCard(state.variantKey, state.rules, card.code));
    const ordinary = ordinaryMeldCandidates(claimable, ['chi', 'peng', 'gang']);
    const multi = state.variantKey === '23:0' && enabled(state.rules.gangDuoZhang)
      ? multiCardGangs(state, claimable, claimableWildcards) : [];
    const meldMoves: MeldMove[] = [
      ...ordinary.map(meld => ({ type: meld.kind, cardIds: [...meld.cardIds] } as MeldMove)),
      ...multi,
    ];
    let passLockedMeld = false;
    for (const meld of meldMoves) {
      if (!meld.cardIds.includes(incoming.id)) continue;
      if (meld.type === 'chi' && id !== nextSeat && !(state.rules.ziChi === 1 && source.kind === 'flip' && id === source.userId)) continue;
      if (passLocked(state, player(state, id), ordinaryRank(incoming.code)) &&
        (meld.type === 'chi' || meld.type === 'peng' || meld.type === 'gang')) {
        passLockedMeld = true;
        continue;
      }
      add(id, { type: meld.type, cardIds: [...meld.cardIds] },
        meld.type === 'gang' ? 30 : meld.type === 'peng' ? 20 : 10);
    }
    if (wildcardCard(state.variantKey, state.rules, incoming.code) ||
      automaticBonusCard(state.variantKey, state.rules, incoming.code)) continue;
    const incomingRank = ordinaryRank(incoming.code);
    player(state, id).melds.forEach((meld, meldIndex) => {
      if (!['peng', 'tou'].includes(meld.kind) ||
        ordinaryRank(physical(state, meld.cardIds[0]!).code) !== incomingRank) return;
      if (state.variantKey === '24:0' && !enabled(state.rules.ownBaKeQiang)) return;
      add(id, { type: 'ba', cardId: incoming.id, meldIndex }, 30);
    });
    if (passLockedMeld && !result.some(offer => offer.userId === id)) passOnlyUserIds.push(id);
  }
  return { offers: result, passOnlyUserIds };
}
function resumeResponse(state: ScoreRegionRound, resume: ResponseResume, events: ScoreRegionEvent[] = []) {
  if (resume.kind === 'pass-discard') {
    move(state, 'table', 'discards', [state.source!.cardId!]);
    stage(state, 'draw', cycle(state, state.source!.userId)[0]!);
    return;
  }
  if (resume.kind === 'own-ba') {
    move(state, 'table', handZone(resume.userId), [resume.cardId]);
    stage(state, resume.phase, resume.userId, null);
    performMeld(state, resume.userId, { type: 'ba', cardId: resume.cardId,
      meldIndex: resume.meldIndex }, false, events, resume.phase);
    return;
  }
  if (resume.kind === 'discard') {
    enterDiscard(state, resume.source.userId, resume.source, []);
    return;
  }
  stage(state, 'draw', resume.source.userId, resume.source);
}
function openResponse(state: ScoreRegionRound, source: Source, events: ScoreRegionEvent[],
  resume: ResponseResume | null = null) {
  stage(state, 'response', source.userId, source);
  state.responseResume = resume;
  const available = offers(state, source);
  state.claims = openClaims(decision(state), cycle(state, source.userId),
    available.offers, available.passOnlyUserIds);
  if (!state.claims.offers.length && !state.claims.passOnlyUserIds?.length) {
    if (resume) resumeResponse(state, resume, events);
    else {
      move(state, 'table', 'discards', [source.cardId!]);
      stage(state, 'draw', cycle(state, source.userId)[0]!);
    }
  } else events.push({ type: 'response-opened', decisionId: decision(state), sourceId: source.userId });
}
function openOwnBaResponse(state: ScoreRegionRound, id: string, action: Extract<Move, { type: 'ba' }>,
  phase: 'discard' | 'draw', events: ScoreRegionEvent[]) {
  move(state, handZone(id), 'table', [action.cardId]);
  bumpHandRevision(player(state, id));
  const source: Source = { kind: 'discard', userId: id, cardId: action.cardId, ownBa: true };
  openResponse(state, source, events, { kind: 'own-ba', userId: id, cardId: action.cardId,
    meldIndex: action.meldIndex, phase });
}
function performMeld(state: ScoreRegionRound, id: string, action: Move, external: boolean,
  events: ScoreRegionEvent[], explicitResume?: 'discard' | 'draw') {
  const current = player(state, id);
  const resume = explicitResume ?? (external ? 'discard' : state.phase);
  requireCondition(resume === 'discard' || resume === 'draw', 'INVALID_ACTION', 'Unexpected meld phase.', 500);
  const incomingId = external ? state.source!.cardId! : null;
  if (action.type === 'ba') {
    const meld = current.melds[action.meldIndex]!;
    meld.kind = 'ba'; meld.cardIds.push(action.cardId);
    if (external) move(state, 'table', meldZone(id), [action.cardId]);
    else move(state, handZone(id), meldZone(id), [action.cardId]);
  } else {
    requireCondition(['chi', 'peng', 'tou', 'gang'].includes(action.type) && 'cardIds' in action,
      'INVALID_ACTION', 'Expected a server-offered meld.', 409);
    current.melds.push({ kind: action.type as ScoreRegionMeld['kind'], cardIds: [...action.cardIds] });
    if (incomingId) move(state, 'table', meldZone(id), [incomingId]);
    const fromHand = action.cardIds.filter(cardId => cardId !== incomingId);
    if (fromHand.length) move(state, handZone(id), meldZone(id), fromHand);
  }
  bumpHandRevision(current);
  const changedMeld = action.type === 'ba' ? current.melds[action.meldIndex]! : current.melds.at(-1)!;
  events.push({ type: 'meld', userId: id, kind: action.type,
    cards: changedMeld.cardIds.map(cardId => physical(state, cardId)) });
  const fromGang = action.type === 'gang' || action.type === 'ba';
  const replacement = replenish(state, id,
    fullSize(state, id) - (resume === 'draw' ? 1 : 0), events);
  if (state.phase === 'finished') return;
  const replacementSource = replacement
    ? { kind: 'replacement' as const, userId: id, cardId: replacement, afterGang: fromGang }
    : null;
  if (!replacementSource) {
    if (resume === 'discard') enterDiscard(state, id, null, events);
    else stage(state, resume, id, null);
    return;
  }
  openResponse(state, replacementSource, events,
    resume === 'discard' ? { kind: 'discard', source: replacementSource } : { kind: 'draw', source: replacementSource });
}
export function createScoreRegionRound(input: RoundInput, orderedCardIds: readonly string[],
  variantKey: keyof typeof SCORE_REGION_VERSIONS): ScoreRegionRound {
  const players = [...input.players].sort((a, b) => a.seat - b.seat);
  const piaoType = input.rules.piaoType as number;
  requireCondition(players.length >= 2 && players.length <= 4 && players.length === input.rules.playerNum &&
    new Set(players.map(item => item.userId)).size === players.length &&
    players.every((item, index) => item.seat === index + 1) && players.some(item => item.userId === input.ownerUserId) &&
    Number.isSafeInteger(input.number) && input.number >= 1 && [4, 8, 12].includes(input.rules.gameNum as number) &&
    (variantKey !== '23:0' || [0, 2].includes(piaoType)) &&
    typeof input.rules.baseBeans === 'string' && amount(input.rules.baseBeans).gt(0),
  'INVALID_ROUND_INPUT', 'Explicit players, frozen score-region options and a positive base are required.', 500);
  let dealerId = input.ownerUserId, dealerRun = 1;
  if (input.number > 1) {
    const prior = input.previousRoundContext;
    requireCondition(prior?.version === SCORE_REGION_VERSIONS[variantKey] && prior.completedRound === input.number - 1 &&
      typeof prior.nextDealerId === 'string' && players.some(item => item.userId === prior.nextDealerId),
    'ROUND_CONTEXT_REQUIRED', 'A later round cannot guess the historical dealer.', 409);
    dealerId = prior.nextDealerId as string; dealerRun = prior.dealerRun as number;
  } else requireCondition(input.previousRoundContext === undefined, 'INVALID_ROUND_INPUT', 'First rounds have no previous context.', 500);
  let cardState = createScoreRegionCardState(variantKey, input.rules, 'deck', [
    { id: 'deck', visibility: 'hidden' }, { id: 'table', visibility: 'public' }, { id: 'discards', visibility: 'public' },
    ...players.flatMap(item => [{ id: handZone(item.userId), visibility: 'private' as const, ownerId: item.userId },
      { id: meldZone(item.userId), visibility: 'public' as const, ownerId: item.userId },
      { id: bonusZone(item.userId), visibility: 'public' as const, ownerId: item.userId }]),
  ]);
  cardState = orderCards(cardState, 'deck', orderedCardIds);
  const dealerAt = players.findIndex(item => item.userId === dealerId);
  const ordered = [...players.slice(dealerAt), ...players.slice(0, dealerAt)];
  const sequence = ordered.map(item => handZone(item.userId));
  const dealOrder: string[] = [];
  for (let pass = 0; pass < 7; pass++) for (const zone of sequence) {
    const current = players.find(item => handZone(item.userId) === zone)!;
    if (isRongxianSmallSeat(variantKey, input.rules, players.length, current.seat, players[dealerAt]!.seat) &&
      pass >= 5) continue;
    dealOrder.push(zone);
  }
  dealOrder.push(handZone(dealerId));
  cardState = dealCards(cardState, 'deck', dealOrder);
  const state: ScoreRegionRound = { version: SCORE_REGION_VERSIONS[variantKey], variantKey, number: input.number,
    rules: structuredClone(input.rules), players: players.map(item => ({ ...item, melds: [], declaredWaits: null,
      declaredBonusIds: null, piao: variantKey === '23:0' && piaoType === 2 ? null : 0,
      handRevision: 0, passedClaimFaces: [] })),
    cards: cardState, dealerId, dealerRun, activeId: dealerId,
    phase: variantKey === '23:0' && piaoType === 2 ? 'piao' : 'opening', serial: 0,
    source: variantKey === '23:0' && piaoType === 2 ? null : { kind: 'original-hand', userId: dealerId, cardId: null },
    claims: null, outcome: null };
  assertScoreRegionRound(state);
  return state;
}
export function scoreRegionLegalActions(state: ScoreRegionRound, id: string): ScoreRegionAction[] {
  player(state, id);
  if (state.phase === 'finished') return [];
  if (state.phase === 'piao') {
    return player(state, id).piao === null
      ? [{ type: 'piao', value: 0, decisionId: decision(state) }, { type: 'piao', value: 1, decisionId: decision(state) }]
      : [];
  }
  if (state.phase === 'response') {
    const view = projectClaims(state.claims!, id);
    const passOnly = state.claims!.passOnlyUserIds?.includes(id) === true &&
      !state.claims!.replies.some(reply => reply.userId === id);
    const forcedBa = state.variantKey === '23:0' && enabled(state.rules.baNoGuo) &&
      view.options.length > 0 && view.options.every(option => (option.action as Move).type === 'ba');
    return [...view.options.map(option => ({ type: 'respond' as const, choiceId: option.id, decisionId: view.id })),
      ...(forcedBa || (view.options.length === 0 && !passOnly) ? []
        : [{ type: 'respond' as const, choiceId: null, decisionId: view.id }])];
  }
  if (state.activeId !== id) return [];
  if (state.phase === 'discard' && ids(state, handZone(id)).length === 0) return [];
  const choices: Move[] = [];
  if (state.source && winning(state, id, state.source, false)) choices.push({ type: 'hu' });
  if (state.phase === 'opening') choices.push({ type: 'begin' });
  else {
    choices.push(...ownMelds(state, id));
    if (state.phase === 'draw') choices.push({ type: 'draw' });
    else {
      const declared = player(state, id).declaredWaits;
      for (const cardId of ids(state, handZone(id))) {
        const waits = scoreRegionDeclarationFaces(state, id, cardId,
          player(state, id).declaredBonusIds ?? ids(state, bonusZone(id)));
        if (declared !== null && !sameDeclaredWaits(declared, waits)) continue;
        choices.push({ type: 'discard', cardId });
        if (state.rules.baoJiao === 1 && declared === null && waits) choices.push({ type: 'declare', cardId });
      }
    }
  }
  return choices.map(action => ({ ...action, decisionId: decision(state) }));
}
export function applyScoreRegionAction(previous: ScoreRegionRound, id: string, action: unknown): EngineResult {
  assertScoreRegionRound(previous);
  requireCondition(action != null && typeof action === 'object' && 'decisionId' in action &&
    action.decisionId === decision(previous), 'STALE_CLAIM_WINDOW', 'The action belongs to a closed decision.', 409);
  requireCondition(scoreRegionLegalActions(previous, id).some(candidate => isDeepStrictEqual(candidate, action)),
    'INVALID_ACTION', 'Choose an action offered by the server.', 409);
  const typed = action as ScoreRegionAction, state = structuredClone(previous), events: ScoreRegionEvent[] = [];
  if (typed.type === 'piao') {
    player(state, id).piao = typed.value;
    events.push({ type: 'piao', userId: id, value: typed.value });
    if (state.players.every(item => item.piao !== null)) {
      stage(state, 'opening', state.dealerId, { kind: 'original-hand', userId: state.dealerId, cardId: null });
    }
  } else if (typed.type === 'respond') {
    if (typed.choiceId === null && state.variantKey === '23:0' && enabled(state.rules.guoZhangNoCaozuo)) {
      const incomingRank = ordinaryRank(physical(state, state.source!.cardId!).code);
      const ownOffers = state.claims!.offers.filter(offer => offer.userId === id);
      if (ownOffers.some(offer => ['chi', 'peng'].includes((offer.action as Move).type))) {
        rememberPass(state, player(state, id), incomingRank);
      }
    }
    state.claims = submitClaim(state.claims!, typed.decisionId, id, typed.choiceId);
    const chosen = resolveClaims(state.claims);
    if (chosen) {
      if (!chosen.length) {
        const resume = state.responseResume;
        if (resume) resumeResponse(state, resume);
        else {
          move(state, 'table', 'discards', [state.source!.cardId!]);
          stage(state, 'draw', cycle(state, state.source!.userId)[0]!);
        }
      } else if ((chosen[0]!.action as Move).type === 'hu') {
        const winners = chosen.map(choice => ({ userId: choice.userId,
          win: winning(state, choice.userId, state.source!, true, payerForWinner(state, choice.userId)) }));
        requireCondition(winners.every((winner): winner is { userId: string; win: Win } => winner.win !== null),
          'INVALID_ACTION', 'A declared player can only win on a frozen wait face.', 409);
        if (state.source!.ownBa) move(state, 'table', 'discards', [state.source!.cardId!]);
        finish(state, 'hu', winners, events);
      }
      else performMeld(state, chosen[0]!.userId, chosen[0]!.action as Move, true, events);
    }
  } else if (typed.type === 'hu') {
    finish(state, 'hu', [{ userId: id,
      win: winning(state, id, state.source!, false, payerForWinner(state, id))! }], events);
  } else if (typed.type === 'begin') {
    let replacement: string | null = null;
    for (const currentId of [state.dealerId, ...cycle(state, state.dealerId).slice(0, -1)]) {
      const target = fullSize(state, currentId) - (currentId === state.dealerId ? 0 : 1);
      const last = replenish(state, currentId, target, events);
      if (currentId === state.dealerId) replacement = last;
      if (state.phase === 'finished') break;
    }
    if (state.phase !== 'finished') {
      const source = replacement
        ? { kind: 'replacement' as const, userId: state.dealerId, cardId: replacement }
        : null;
      if (source) openResponse(state, source, events, { kind: 'discard', source });
      else enterDiscard(state, state.dealerId, null, events);
    }
  } else if (typed.type === 'draw') {
    const next = ids(state, 'deck')[0];
    if (!next) drawEnd(state, events);
    else if (automaticBonusCard(state.variantKey, state.rules, physical(state, next).code)) {
      move(state, 'deck', handZone(id), [next]);
      bumpHandRevision(player(state, id));
      const last = replenish(state, id, fullSize(state, id), events);
      if (state.phase !== 'finished') {
        if (!last) drawEnd(state, events);
        else {
          const source = { kind: 'replacement' as const, userId: id, cardId: last };
          openResponse(state, source, events, { kind: 'discard', source });
        }
      }
    } else {
      move(state, 'deck', 'table', [next]);
      events.push({ type: 'flip', userId: id, card: physical(state, next), remaining: ids(state, 'deck').length });
      openResponse(state, { kind: 'flip', userId: id, cardId: next }, events);
    }
  } else if (typed.type === 'discard' || typed.type === 'declare') {
    if (typed.type === 'declare') {
      const bonusIds = [...ids(state, bonusZone(id))];
      const waits = scoreRegionDeclarationFaces(state, id, typed.cardId, bonusIds);
      requireCondition(waits, 'INVALID_ACTION', 'The selected discard cannot declare a legal wait.', 409);
      requireCondition(player(state, id).declaredWaits === null, 'INVALID_ACTION',
        'A declared player cannot declare again.', 409);
      player(state, id).declaredWaits = [...waits];
      player(state, id).declaredBonusIds = bonusIds;
    } else {
      const declared = player(state, id).declaredWaits;
      const declaredBonusIds = player(state, id).declaredBonusIds;
      requireCondition(declared === null || sameDeclaredWaits(declared,
        scoreRegionDeclarationFaces(state, id, typed.cardId, declaredBonusIds ?? [])),
        'INVALID_ACTION', 'A declared discard must preserve the complete locked wait set.', 409);
    }
    move(state, handZone(id), 'table', [typed.cardId]);
    bumpHandRevision(player(state, id));
    state.rules.__discards = Number(state.rules.__discards ?? 0) + 1;
    events.push({ type: 'discard', userId: id, card: physical(state, typed.cardId), declared: typed.type === 'declare' });
    openResponse(state, { kind: 'discard', userId: id, cardId: typed.cardId,
      afterGang: state.source?.kind === 'replacement' && state.source.afterGang === true }, events);
  } else if (typed.type === 'ba' && state.variantKey === '24:0' && enabled(state.rules.ownBaKeQiang)) {
    const resume = state.phase;
    requireCondition(resume === 'discard' || resume === 'draw', 'INVALID_ACTION',
      'A concealed ba can only be submitted from a playable phase.', 409);
    openOwnBaResponse(state, id, typed, resume, events);
  } else performMeld(state, id, typed, false, events);
  assertScoreRegionRound(state);
  return { snapshot: state, events, ...(state.outcome ? { confirmedScores: [{ eventId: `score-region:${state.number}:final`,
    postings: state.outcome.payments.postings, transfers: state.outcome.payments.transfers }],
    settlement: state.outcome.payments.postings, nextRoundContext: state.outcome.nextRoundContext } : {}) };
}
export function assertScoreRegionRound(state: ScoreRegionRound): void {
  requireCondition(state.version === SCORE_REGION_VERSIONS[state.variantKey], 'SCORE_REGION_RULES_VERSION_REQUIRED',
    'Unknown round version.', 409);
  assertCardState(state.cards);
  const capacity = regionalPackSpecification(state.variantKey, state.rules)
    .flatMap(entry => Array<number>(entry.count).fill(entry.code)).sort((a, b) => a - b);
  requireCondition(isDeepStrictEqual(state.cards.pack.map(card => card.code).sort((a, b) => a - b), capacity) &&
    state.players.some(item => item.userId === state.dealerId) &&
    ['piao', 'opening', 'discard', 'draw', 'response', 'finished'].includes(state.phase),
  'INVALID_SCORE_REGION_STATE', 'Physical pack and turn phase must be consistent.', 500);
  for (const current of state.players) {
    // Historical approved snapshots predate the optional Xuzhou piao state and omit the field.
    const piao = current.piao === undefined ? 0 : current.piao;
    requireCondition(piao === 0 || piao === 1 ||
      (state.phase === 'piao' && piao === null),
    'INVALID_SCORE_REGION_STATE', 'Piao choices must be server-validated values.', 500);
    requireCondition(current.declaredBonusIds == null ? current.declaredWaits == null :
      Array.isArray(current.declaredBonusIds) && current.declaredWaits !== null &&
      new Set(current.declaredBonusIds).size === current.declaredBonusIds.length &&
      current.declaredBonusIds.every(cardId => ids(state, bonusZone(current.userId)).includes(cardId)),
    'INVALID_SCORE_REGION_STATE', 'Declared bonus snapshots must match the player state.', 500);
    const revision = current.handRevision === undefined ? 0 : current.handRevision;
    const passed = current.passedClaimFaces === undefined ? [] : current.passedClaimFaces;
    requireCondition(Number.isSafeInteger(revision) && revision >= 0 && Array.isArray(passed) &&
      passed.every(face => face !== null && typeof face === 'object' &&
        Number.isSafeInteger(face.rank) && face.rank >= 1 && face.rank <= 13 &&
        Number.isSafeInteger(face.handRevision) && face.handRevision >= 0 && face.handRevision <= revision) &&
      new Set(passed.map(face => `${face.rank}:${face.handRevision}`)).size === passed.length,
    'INVALID_SCORE_REGION_STATE', 'Pass-lock state must be serializable and consistent.', 500);
    if (state.phase === 'finished' || state.phase === 'piao') continue;
    const openingSmallSeat = state.phase === 'opening' && isRongxianSmallSeat(state.variantKey, state.rules,
      state.players.length, current.seat, player(state, state.dealerId).seat) ? 1 : 0;
    const ownBaWindow = state.phase === 'response' && state.source?.ownBa === true;
    const ownBaResume = ownBaWindow && state.responseResume?.kind === 'own-ba' &&
      state.responseResume.userId === current.userId ? state.responseResume : null;
    const replacementWindow = state.phase === 'response' && state.source?.kind === 'replacement' &&
      state.source.userId === current.userId;
    // A meld made while already in the draw phase replenishes only to the
    // short draw hand; the replacement card is still in that same hand while
    // the other seats get their chance to rob it.
    const drawResumeWindow = replacementWindow && state.responseResume?.kind === 'draw' &&
      state.responseResume.source.userId === current.userId;
    const expected = openingSmallSeat
      ? 5
      : ownBaResume
        ? fullSize(state, current.userId) - (ownBaResume.phase === 'draw' ? 2 : 1)
      : fullSize(state, current.userId) - (drawResumeWindow ? 1 : replacementWindow ? 0 :
        (['opening', 'discard'].includes(state.phase) && state.activeId === current.userId ? 0 : 1));
    requireCondition(ids(state, handZone(current.userId)).length === expected,
      'INVALID_SCORE_REGION_STATE',
      `Concealed hand count is inconsistent for ${current.userId}: expected ${expected}, got ${ids(state, handZone(current.userId)).length} in ${state.phase}.`,
      500);
    requireCondition(state.phase === 'opening' ||
      cards(state, handZone(current.userId)).every(card =>
        !automaticBonusCard(state.variantKey, state.rules, card.code)),
      'INVALID_SCORE_REGION_STATE', 'Unprocessed reward cards cannot remain in a playable hand.', 500);
  }
  const ownBaSource = state.phase === 'response' && state.source?.ownBa === true &&
    state.source.cardId !== null && ids(state, 'table').includes(state.source.cardId);
  const replacementInHand = state.phase === 'response' && state.source?.kind === 'replacement' &&
    state.source.cardId !== null && ids(state, handZone(state.source.userId)).includes(state.source.cardId);
  const responseTableConsistent = state.phase !== 'response' ||
    (state.source?.ownBa ? ownBaSource && ids(state, 'table').length === 1 :
      state.source?.kind === 'replacement' ? ids(state, 'table').length === 0 && replacementInHand :
      ids(state, 'table').length === 1);
  requireCondition(!state.source?.ownBa || state.responseResume?.kind === 'own-ba' &&
    state.responseResume.userId === state.source.userId && state.responseResume.cardId === state.source.cardId &&
    state.responseResume.meldIndex >= 0 &&
    state.responseResume.meldIndex < player(state, state.source.userId).melds.length &&
    ['peng', 'tou'].includes(player(state, state.source.userId).melds[state.responseResume.meldIndex]!.kind) &&
    ordinaryRank(physical(state, state.source.cardId!).code) === ordinaryRank(physical(state,
      player(state, state.source.userId).melds[state.responseResume.meldIndex]!.cardIds[0]!).code),
  'INVALID_SCORE_REGION_STATE', 'A pending concealed ba must retain its original peng or concealed triplet.', 500);
  requireCondition(state.phase === 'response' ? state.claims?.id === decision(state) && responseTableConsistent
    : state.claims === null && (state.phase === 'finished' || state.phase === 'piao' || ids(state, 'table').length === 0),
  'INVALID_SCORE_REGION_STATE', 'Public card and response phase must agree.', 500);
}
export function viewScoreRegionRound(state: ScoreRegionRound, id: string) {
  player(state, id);
  const view = { version: state.version, number: state.number, phase: state.phase,
    dealerId: state.dealerId, activeId: state.activeId, decisionId: decision(state),
    cards: projectCardState(state.cards, id),
    players: state.players.map(item => ({ userId: item.userId, seat: item.seat, melds: structuredClone(item.melds) })),
    legalActions: scoreRegionLegalActions(state, id), responses: state.claims ? projectClaims(state.claims, id) : null,
    outcome: state.outcome ? { reason: state.outcome.reason, postings: state.outcome.payments.postings,
      winners: state.outcome.winners.map(winner => ({ userId: winner.userId, structureScore: winner.win.structureScore,
        scoreUnits: winner.win.scoreUnits, items: winner.win.items as ScoreRegionWinItem[],
        ...(winner.payerWins ? { payerWins: winner.payerWins.map(item => ({ payerId: item.payerId,
          ...(item.waitCode === undefined ? {} : { waitCode: item.waitCode }),
          structureScore: item.win.structureScore, scoreUnits: item.win.scoreUnits,
          items: item.win.items as ScoreRegionWinItem[] })) } : {}) })) } : null };
  if (state.variantKey === '23:0' && state.rules.piaoType === 2) {
    Object.assign(view, { piao: state.players.map(item => ({ userId: item.userId, value: item.piao })) });
  }
  return structuredClone(view);
}
export function scoreRegionTimedAction(state: ScoreRegionRound, id: string) {
  const actions = scoreRegionLegalActions(state, id);
  if (!actions.length) return null;
  const hu = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId !== null &&
    (state.claims!.offers.find(offer => offer.id === action.choiceId)!.action as Move).type === 'hu') : actions.find(action => action.type === 'hu');
  const fallback = state.phase === 'piao' ? actions.find(action => action.type === 'piao')
    : state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId === null)
      ?? actions.find(action => action.type === 'respond' && action.choiceId !== null)
    : actions.find(action => action.type === 'begin' || action.type === 'draw') ??
      actions.filter((action): action is ScoreRegionAction & { type: 'discard'; cardId: string } =>
        action.type === 'discard').sort((a, b) => a.cardId.localeCompare(b.cardId))[0];
  return { userId: id, decisionId: decision(state),
    delayMs: state.phase === 'response' || state.phase === 'piao' ? 15000 : 30000,
    action: hu ?? fallback! };
}
