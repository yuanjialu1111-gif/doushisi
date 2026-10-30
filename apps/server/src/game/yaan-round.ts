import { isDeepStrictEqual } from 'node:util';
import { YAAN_INDEPENDENT_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { EnginePlayer, EngineResult, RoundContext, RoundInput } from '../engines.js';
import { amount } from '../money.js';
import { baseTimesRatio, roundTransfers } from '../transfers.js';
import { assertCardState, dealCards, moveCards, orderCards, projectCardState, type CardState } from './cards.js';
import { openClaims, projectClaims, resolveClaims, submitClaim, type ClaimWindow, type ClaimOffer } from './claims.js';
import { sameDeclaredWaits } from './declared-waits.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { createYaanCardState, yaanPackSpecification } from './yaan-pack.js';
import { evaluateYaanWin, type YaanHand, type YaanMeld, type YaanWin, type YaanWinContext } from './yaan-win.js';

type Win = Extract<YaanWin, { status: 'winning' }>;
type Meld = { kind: YaanMeld['kind']; cardIds: string[] };
interface Player extends EnginePlayer {
  melds: Meld[];
  declaredWaits: number[] | null;
  declaredBonusIds: string[] | null;
}
type Source = { kind: YaanWinContext['source']; userId: string; cardId: string | null; afterGang?: boolean };
type Move =
  | { type: 'begin' | 'draw' | 'hu' }
  | { type: 'discard' | 'declare'; cardId: string }
  | { type: 'tou' | 'gang' | 'peng' | 'chi'; cardIds: string[] }
  | { type: 'ba'; cardId: string; meldIndex: number };
export type YaanAction = (Move | { type: 'respond'; choiceId: string | null }) & { decisionId: string };
interface Outcome { reason: 'hu' | 'draw'; winners: { userId: string; win: Win }[];
  payments: ReturnType<typeof roundTransfers>; nextRoundContext: RoundContext }
export interface YaanRound {
  version: typeof YAAN_INDEPENDENT_VERSION; number: number; rules: Record<string, unknown>;
  players: Player[]; cards: CardState; dealerId: string; dealerRun: number; activeId: string;
  phase: 'opening' | 'discard' | 'draw' | 'response' | 'finished'; serial: number;
  source: Source | null; claims: ClaimWindow | null; outcome: Outcome | null;
}
export interface YaanEvent { type: string; [key: string]: unknown }
const isSpecial = (code: number) => [1001, 1002, 1003].includes(code);
const isSeven = (code: number) => ordinaryRank(code) === 7;
const sevenIsWild = (rules: Readonly<Record<string, unknown>>) => [4, 6, 8, 12].includes(rules.qiWangNum as number);
/** Yaan uses wang and enabled sevens as in-hand wildcards, never as stolen reward cards. */
const isWildcard = (code: number, rules: Readonly<Record<string, unknown>>) =>
  isSpecial(code) || sevenIsWild(rules) && isSeven(code);
const handZone = (id: string) => `hand:${id}`;
const meldZone = (id: string) => `melds:${id}`;
const bonusZone = (id: string) => `bonus:${id}`;
const decision = (s: YaanRound) => `ya:${s.number}:${s.serial}`;
const player = (s: YaanRound, id: string) => {
  const found = s.players.find(item => item.userId === id);
  requireCondition(found, 'NOT_ROOM_MEMBER', 'Only round members can act or view.', 403);
  return found;
};
const ids = (s: YaanRound, zone: string) => s.cards.zones.find(zoneItem => zoneItem.id === zone)!.cards;
const physical = (s: YaanRound, id: string) => s.cards.pack.find(card => card.id === id)!;
const cards = (s: YaanRound, zone: string) => ids(s, zone).map(id => physical(s, id));
const fullSize = (s: YaanRound, id: string) => 8 - 2 * player(s, id).melds.length;
function cycle(s: YaanRound, after: string) {
  const at = s.players.findIndex(item => item.userId === after);
  return [...s.players.slice(at + 1), ...s.players.slice(0, at + 1)].map(item => item.userId);
}
function hand(s: YaanRound, id: string, incoming?: string): YaanHand {
  const concealed = [...cards(s, handZone(id))];
  if (incoming && !concealed.some(card => card.id === incoming)) concealed.push(physical(s, incoming));
  return { concealed,
    melds: player(s, id).melds.map(meld => ({ kind: meld.kind, cards: meld.cardIds.map(cardId => physical(s, cardId)) })),
    bonus: cards(s, bonusZone(id)) };
}
function facts(s: YaanRound, id: string, source: Source, afterGang = source.afterGang === true): YaanWinContext {
  return { winnerSeat: player(s, id).seat, dealerSeat: player(s, s.dealerId).seat, source: source.kind,
    sourceSeat: source.kind === 'original-hand' ? null : player(s, source.userId).seat,
    incomingCardId: source.cardId, discardCount: Number(s.rules.__discards ?? 0), afterGang,
    baoJiao: player(s, id).declaredWaits !== null };
}
function winning(s: YaanRound, id: string, source: Source, external: boolean): Win | null {
  // A replacement/source marker without a physical card cannot be a win
  // input. The action generator still asks for legal actions in this state,
  // so treat it as "no winning action" rather than fabricating a source.
  if (source.cardId === null) return null;
  const current = hand(s, id, external ? source.cardId! : undefined);
  if (current.concealed.length !== fullSize(s, id)) return null;
  const declared = player(s, id).declaredWaits;
  if (declared !== null && (source.cardId === null || !declared.includes(physical(s, source.cardId).code))) return null;
  const result = evaluateYaanWin(current, facts(s, id, source), s.rules);
  return result.status === 'winning' ? result : null;
}
function stage(s: YaanRound, phase: YaanRound['phase'], activeId: string, source: Source | null = null) {
  s.phase = phase; s.activeId = activeId; s.source = source; s.claims = null; s.serial++;
}
function move(s: YaanRound, from: string, to: string, selected: string[]) { s.cards = moveCards(s.cards, from, to, selected); }
function continuation(s: YaanRound, dealerId: string): RoundContext {
  return { version: s.version, completedRound: s.number, nextDealerId: dealerId,
    dealerRun: dealerId === s.dealerId ? s.dealerRun + 1 : 1 };
}
function paymentsFor(s: YaanRound, winners: Outcome['winners']) {
  const members = s.players.map(item => item.userId);
  const transfers = winners.flatMap((winner, winnerIndex) => {
    const payers = s.source?.kind === 'discard'
      ? [s.source.userId] : members.filter(id => id !== winner.userId);
    return payers.filter(id => id !== winner.userId).map((payerId, payIndex) => ({
      id: `yaan:${winnerIndex}:${payIndex}`, payerId, payeeId: winner.userId,
      ...baseTimesRatio(s.rules.baseBeans as string,
        BigInt(winner.win.scoring.status === 'scored' ? winner.win.scoring.scoreUnits : '1')),
    }));
  });
  return roundTransfers(transfers, members);
}
function drawPaymentsFor(s: YaanRound, called: Outcome['winners']) {
  const members = s.players.map(item => item.userId);
  if (!called.length) return roundTransfers([], members);
  const winnerIds = new Set(called.map(winner => winner.userId));
  const payers = members.filter(id => !winnerIds.has(id));
  if (!payers.length) return roundTransfers([], members);
  const transfers = called.flatMap((winner, winnerIndex) => payers.map((payerId, payIndex) => ({
    id: `yaan-draw:${winnerIndex}:${payIndex}`, payerId, payeeId: winner.userId,
    ...baseTimesRatio(s.rules.baseBeans as string,
      BigInt(winner.win.scoring.status === 'scored' ? winner.win.scoring.scoreUnits : '1')),
  })));
  return roundTransfers(transfers, members);
}
function finish(s: YaanRound, reason: Outcome['reason'], winners: Outcome['winners'], events: YaanEvent[]) {
  const payments = reason === 'draw' ? drawPaymentsFor(s, winners) :
    winners.length ? paymentsFor(s, winners) : roundTransfers([], s.players.map(item => item.userId));
  const dealerId = reason === 'hu' ? winners[0]!.userId : s.dealerId;
  s.outcome = { reason, winners, payments, nextRoundContext: continuation(s, dealerId) };
  stage(s, 'finished', s.activeId);
  events.push({ type: 'round-ended', reason, winnerIds: reason === 'hu' ? winners.map(winner => winner.userId) : [],
    postings: payments.postings });
}
function drawEnd(s: YaanRound, events: YaanEvent[]) {
  const called: Outcome['winners'] = [];
  if (s.rules.chaJiao === 1) {
    for (const current of s.players) {
      const currentHand = hand(s, current.userId);
      if (currentHand.concealed.length !== fullSize(s, current.userId) - 1) continue;
      const nextId = cycle(s, current.userId)[0]!;
      if (current.declaredWaits !== null) {
        const lockedHand = { ...currentHand,
          bonus: (current.declaredBonusIds ?? []).map(cardId => physical(s, cardId)) };
        const lockedWaits = drawWaits(s, current.userId, nextId, lockedHand);
        if (!sameDeclaredWaits(current.declaredWaits, lockedWaits.map(wait => wait.code))) continue;
      }
      const waits = drawWaits(s, current.userId, nextId, currentHand, current.declaredWaits);
      const best = waits.reduce<Win | null>((bestWait, wait) =>
        !bestWait || BigInt(wait.win.scoring.status === 'scored' ? wait.win.scoring.scoreUnits : '1') >
          BigInt(bestWait.scoring.status === 'scored' ? bestWait.scoring.scoreUnits : '1') ? wait.win : bestWait, null);
      if (best) called.push({ userId: current.userId, win: best });
    }
  }
  finish(s, 'draw', called, events);
}
function drawWaits(s: YaanRound, id: string, nextId: string, current: YaanHand,
  allowed: readonly number[] | null = null): { code: number; win: Win }[] {
  const waits: { code: number; win: Win }[] = [];
  const known = [...current.concealed, ...current.melds.flatMap(meld => meld.cards), ...current.bonus];
  for (const entry of yaanPackSpecification(s.rules.wangNum as number, s.rules.qiWangNum as number)) {
    if (isWildcard(entry.code, s.rules) || known.filter(card => card.code === entry.code).length >= entry.count) continue;
    if (allowed !== null && !allowed.includes(entry.code)) continue;
    let idValue = `yaan-draw-wait-${entry.code}`;
    while (known.some(card => card.id === idValue)) idValue += '_';
    const candidate = { ...current, concealed: [...current.concealed, { id: idValue, code: entry.code }] };
    const result = evaluateYaanWin(candidate,
      { ...facts(s, id, { kind: 'flip', userId: nextId, cardId: idValue }),
        discardCount: Math.max(2, Number(s.rules.__discards ?? 0)) }, s.rules);
    if (result.status === 'winning') waits.push({ code: entry.code, win: result });
  }
  return waits;
}
function replenish(s: YaanRound, id: string, target: number, events: YaanEvent[]): string | null {
  let last: string | null = null;
  for (;;) {
    if (ids(s, handZone(id)).length >= target) return last;
    const next = ids(s, 'deck')[0];
    if (!next) { drawEnd(s, events); return null; }
    move(s, 'deck', handZone(id), [next]);
    last = next;
    events.push({ type: 'replacement', userId: id, card: physical(s, next), remaining: ids(s, 'deck').length });
  }
}
function declaration(s: YaanRound, id: string, discardId: string,
  bonusIds: readonly string[] = ids(s, bonusZone(id))): number[] | null {
  const current = hand(s, id);
  if (current.concealed.length !== fullSize(s, id) || !current.concealed.some(card => card.id === discardId)) return null;
  current.bonus = bonusIds.map(cardId => physical(s, cardId));
  const remaining = current.concealed.filter(card => card.id !== discardId);
  const waits: number[] = [];
  const known = [...remaining, ...current.melds.flatMap(meld => meld.cards), ...current.bonus];
  for (const entry of yaanPackSpecification(s.rules.wangNum as number, s.rules.qiWangNum as number)) {
    if (isWildcard(entry.code, s.rules) || known.filter(card => card.code === entry.code).length >= entry.count) continue;
    let idValue = `yaan-wait-${entry.code}`;
    while (known.some(card => card.id === idValue)) idValue += '_';
    const candidate = { ...current, concealed: [...remaining, { id: idValue, code: entry.code }] };
    const result = evaluateYaanWin(candidate,
      { ...facts(s, id, { kind: 'flip', userId: id, cardId: idValue }), discardCount: Math.max(2, Number(s.rules.__discards ?? 0)) }, s.rules);
    if (result.status === 'winning') waits.push(entry.code);
  }
  return waits.length ? waits : null;
}
function ownMelds(s: YaanRound, id: string): Move[] {
  const current = player(s, id), handCards = cards(s, handZone(id));
  if (current.declaredWaits || current.melds.length >= 3) return [];
  const natural = handCards.filter(card => !isWildcard(card.code, s.rules));
  return ordinaryMeldCandidates(natural, ['peng', 'gang']).map(meld => ({
    type: meld.kind === 'peng' ? 'tou' as const : 'gang' as const, cardIds: [...meld.cardIds],
  }));
}
function offers(s: YaanRound, source: Source): ClaimOffer[] {
  const result: ClaimOffer[] = [];
  const incoming = physical(s, source.cardId!);
  const add = (userId: string, action: Move, priority: number) => result.push({
    id: `${decision(s)}:${result.length}`, userId, action, priority, simultaneous: action.type === 'hu',
  });
  const nextSeat = cycle(s, source.userId)[0]!;
  for (const id of cycle(s, source.userId)) {
    // The discarder cannot claim its own discard. Only flips can be claimed by
    // the player who produced them (the ziChi "self-draw self-eat" option).
    if (source.kind === 'discard' && id === source.userId) continue;
    if (winning(s, id, source, true)) add(id, { type: 'hu' }, 100);
    const current = player(s, id);
    // A declared wait is locked: only winning is allowed. Letting a declared
    // player chi/peng/gang here would change the concealed hand after the
    // server already froze the wait set.
    if (current.declaredWaits !== null) continue;
    if (current.melds.length < 3) {
      // Wildcards cannot be passed to the ordinary structure matcher. They
      // remain eligible as win substitutes, but exposed meld candidates are
      // generated from real faces plus the incoming real card.
      const claimable = [...cards(s, handZone(id)), incoming]
        .filter(card => !isWildcard(card.code, s.rules));
      for (const meld of ordinaryMeldCandidates(claimable, ['chi', 'peng', 'gang'])) {
        if (!meld.cardIds.includes(incoming.id)) continue;
        if (meld.kind === 'chi' && id !== nextSeat && !(s.rules.ziChi === 1 && source.kind === 'flip' && id === source.userId)) continue;
        add(id, { type: meld.kind, cardIds: [...meld.cardIds] }, meld.kind === 'gang' ? 30 : meld.kind === 'peng' ? 20 : 10);
      }
    }
  }
  return result;
}
function openResponse(s: YaanRound, source: Source, events: YaanEvent[]) {
  stage(s, 'response', source.userId, source);
  s.claims = openClaims(decision(s), cycle(s, source.userId), offers(s, source));
  if (!s.claims.offers.length) {
    move(s, 'table', 'discards', [source.cardId!]);
    stage(s, 'draw', cycle(s, source.userId)[0]!);
  } else events.push({ type: 'response-opened', decisionId: decision(s), sourceId: source.userId });
}
function performMeld(s: YaanRound, id: string, action: Move, external: boolean, events: YaanEvent[]) {
  const current = player(s, id);
  const resume = external ? 'discard' as const : s.phase as 'draw' | 'discard';
  const incomingId = external ? s.source!.cardId! : null;
  if (action.type === 'ba') {
    const meld = current.melds[action.meldIndex]!;
    meld.kind = 'ba'; meld.cardIds.push(action.cardId);
    move(s, handZone(id), meldZone(id), [action.cardId]);
  } else {
    requireCondition(['chi', 'peng', 'tou', 'gang'].includes(action.type) && 'cardIds' in action,
      'INVALID_ACTION', 'Expected a server-offered meld.', 409);
    current.melds.push({ kind: action.type as YaanMeld['kind'], cardIds: [...action.cardIds] });
    if (incomingId) move(s, 'table', meldZone(id), [incomingId]);
    const fromHand = action.cardIds.filter(cardId => cardId !== incomingId);
    if (fromHand.length) move(s, handZone(id), meldZone(id), fromHand);
  }
  events.push({ type: 'meld', userId: id, kind: action.type, cards: current.melds.at(-1)!.cardIds.map(cardId => physical(s, cardId)) });
  const fromGang = action.type === 'gang' || action.type === 'ba';
  const replacement = replenish(s, id, fullSize(s, id) - (resume === 'draw' ? 1 : 0), events);
  if (s.phase === 'finished') return;
  stage(s, resume, id, replacement && resume === 'discard'
    ? { kind: 'replacement', userId: id, cardId: replacement, afterGang: fromGang } : null);
}
export function createYaanRound(input: RoundInput, orderedCardIds: readonly string[]): YaanRound {
  const players = [...input.players].sort((a, b) => a.seat - b.seat);
  requireCondition(players.length >= 2 && players.length <= 4 && players.length === input.rules.playerNum &&
    new Set(players.map(item => item.userId)).size === players.length &&
    players.every((item, index) => item.seat === index + 1) && players.some(item => item.userId === input.ownerUserId) &&
    Number.isSafeInteger(input.number) && input.number >= 1 && [4, 8, 12].includes(input.rules.gameNum as number) &&
    typeof input.rules.baseBeans === 'string' && amount(input.rules.baseBeans).gt(0),
  'INVALID_ROUND_INPUT', 'Explicit players, options and a positive base are required.', 500);
  let dealerId = input.ownerUserId, dealerRun = 1;
  if (input.number > 1) {
    const prior = input.previousRoundContext;
    requireCondition(prior?.version === YAAN_INDEPENDENT_VERSION && prior.completedRound === input.number - 1 &&
      typeof prior.nextDealerId === 'string' && players.some(item => item.userId === prior.nextDealerId),
    'ROUND_CONTEXT_REQUIRED', 'A later round cannot guess the historical dealer.', 409);
    dealerId = prior.nextDealerId as string; dealerRun = prior.dealerRun as number;
  } else requireCondition(input.previousRoundContext === undefined, 'INVALID_ROUND_INPUT', 'First rounds have no previous context.', 500);
  let cardState = createYaanCardState('6:0', input.rules, 'deck', [
    { id: 'deck', visibility: 'hidden' }, { id: 'table', visibility: 'public' }, { id: 'discards', visibility: 'public' },
    ...players.flatMap(item => [{ id: handZone(item.userId), visibility: 'private' as const, ownerId: item.userId },
      { id: meldZone(item.userId), visibility: 'public' as const, ownerId: item.userId },
      { id: bonusZone(item.userId), visibility: 'public' as const, ownerId: item.userId }]),
  ]);
  cardState = orderCards(cardState, 'deck', orderedCardIds);
  const dealerAt = players.findIndex(item => item.userId === dealerId);
  const sequence = [...players.slice(dealerAt), ...players.slice(0, dealerAt)].map(item => handZone(item.userId));
  cardState = dealCards(cardState, 'deck', [...Array.from({ length: 7 }, () => sequence).flat(), handZone(dealerId)]);
  const state: YaanRound = { version: YAAN_INDEPENDENT_VERSION, number: input.number, rules: structuredClone(input.rules),
    players: players.map(item => ({ ...item, melds: [], declaredWaits: null, declaredBonusIds: null })),
    cards: cardState, dealerId, dealerRun, activeId: dealerId,
    phase: 'opening', serial: 0, source: { kind: 'original-hand', userId: dealerId, cardId: null }, claims: null, outcome: null };
  assertYaanRound(state);
  return state;
}
export function yaanLegalActions(s: YaanRound, id: string): YaanAction[] {
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
      const declared = current.declaredWaits;
      for (const cardId of ids(s, handZone(id))) {
        const waits = declaration(s, id, cardId, current.declaredBonusIds ?? ids(s, bonusZone(id)));
        if (declared !== null && !sameDeclaredWaits(declared, waits)) continue;
        choices.push({ type: 'discard', cardId });
        if (declared === null && s.rules.baoJiao === 1 && waits) choices.push({ type: 'declare', cardId });
      }
    }
  }
  return choices.map(action => ({ ...action, decisionId: decision(s) }));
}
export function applyYaanAction(previous: YaanRound, id: string, action: unknown): EngineResult {
  assertYaanRound(previous);
  requireCondition(action != null && typeof action === 'object' && 'decisionId' in action &&
    action.decisionId === decision(previous), 'STALE_CLAIM_WINDOW', 'The action belongs to a closed decision.', 409);
  requireCondition(yaanLegalActions(previous, id).some(candidate => isDeepStrictEqual(candidate, action)),
    'INVALID_ACTION', 'Choose an action offered by the server.', 409);
  const typed = action as YaanAction, state = structuredClone(previous), events: YaanEvent[] = [];
  if (typed.type === 'respond') {
    state.claims = submitClaim(state.claims!, typed.decisionId, id, typed.choiceId);
    const chosen = resolveClaims(state.claims);
    if (chosen) {
      if (!chosen.length) { move(state, 'table', 'discards', [state.source!.cardId!]); stage(state, 'draw', cycle(state, state.source!.userId)[0]!); }
      else if ((chosen[0]!.action as Move).type === 'hu') finish(state, 'hu',
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
    else if (isWildcard(physical(state, next).code, state.rules)) {
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
      const waits = declaration(state, id, typed.cardId, bonusIds);
      requireCondition(waits, 'INVALID_ACTION', 'The selected discard cannot declare a legal wait.', 409);
      requireCondition(player(state, id).declaredWaits === null, 'INVALID_ACTION',
        'A declared player cannot declare again.', 409);
      player(state, id).declaredWaits = [...waits];
      player(state, id).declaredBonusIds = bonusIds;
    } else {
      const current = player(state, id);
      const declared = current.declaredWaits;
      const declaredBonusIds = current.declaredBonusIds;
      requireCondition(declared === null || sameDeclaredWaits(declared,
        declaration(state, id, typed.cardId, declaredBonusIds ?? [])),
        'INVALID_ACTION', 'A declared discard must preserve the complete locked wait set.', 409);
    }
    move(state, handZone(id), 'table', [typed.cardId]);
    state.rules.__discards = Number(state.rules.__discards ?? 0) + 1;
    events.push({ type: 'discard', userId: id, card: physical(state, typed.cardId),
      afterGang: state.source?.afterGang === true });
    openResponse(state, { kind: 'discard', userId: id, cardId: typed.cardId,
      afterGang: state.source?.afterGang === true }, events);
  } else performMeld(state, id, typed, false, events);
  assertYaanRound(state);
  return { snapshot: state, events, ...(state.outcome ? { confirmedScores: [{ eventId: `ya:${state.number}:final`,
    postings: state.outcome.payments.postings, transfers: state.outcome.payments.transfers }],
    settlement: state.outcome.payments.postings, nextRoundContext: state.outcome.nextRoundContext } : {}) };
}
export function assertYaanRound(state: YaanRound): void {
  requireCondition(state.version === YAAN_INDEPENDENT_VERSION, 'YAAN_RULES_VERSION_REQUIRED', 'Unknown round version.', 409);
  assertCardState(state.cards);
  const capacity = yaanPackSpecification(state.rules.wangNum as number, state.rules.qiWangNum as number)
    .flatMap(entry => Array<number>(entry.count).fill(entry.code)).sort((a, b) => a - b);
  requireCondition(isDeepStrictEqual(state.cards.pack.map(card => card.code).sort((a, b) => a - b), capacity) &&
    state.players.some(item => item.userId === state.dealerId) &&
    ['opening', 'discard', 'draw', 'response', 'finished'].includes(state.phase),
  'INVALID_YAAN_STATE', 'Physical pack and turn phase must be consistent.', 500);
  for (const current of state.players) {
    requireCondition(current.declaredBonusIds == null ? current.declaredWaits == null :
      Array.isArray(current.declaredBonusIds) && current.declaredWaits !== null &&
      current.declaredWaits.length > 0 &&
      new Set(current.declaredBonusIds).size === current.declaredBonusIds.length &&
      current.declaredBonusIds.every(cardId => ids(state, bonusZone(current.userId)).includes(cardId)),
    'INVALID_YAAN_STATE', 'Declared bonus snapshots must match the player state.', 500);
    requireCondition(current.declaredWaits === null || Array.isArray(current.declaredWaits) &&
      current.declaredWaits.every(value => Number.isSafeInteger(value) && value > 0) &&
      new Set(current.declaredWaits).size === current.declaredWaits.length,
    'INVALID_YAAN_STATE', 'Declared waits must be unique positive faces.', 500);
    requireCondition(isDeepStrictEqual(current.melds.flatMap(meld => meld.cardIds).sort(), [...ids(state, meldZone(current.userId))].sort()),
      'INVALID_YAAN_STATE', 'Meld references must match the physical zone.', 500);
    if (state.phase === 'finished') continue;
    const expected = fullSize(state, current.userId) -
      (['opening', 'discard'].includes(state.phase) && state.activeId === current.userId ? 0 : 1);
    requireCondition(ids(state, handZone(current.userId)).length === expected,
      'INVALID_YAAN_STATE', 'Concealed hand count is inconsistent.', 500);
  }
  requireCondition(state.phase === 'response' ? state.claims?.id === decision(state) && ids(state, 'table').length === 1
    : state.claims === null && (state.phase === 'finished' || ids(state, 'table').length === 0),
  'INVALID_YAAN_STATE', 'Public card and response phase must agree.', 500);
}
export function viewYaanRound(state: YaanRound, id: string) {
  player(state, id);
  return structuredClone({ version: state.version, number: state.number, phase: state.phase,
    dealerId: state.dealerId, activeId: state.activeId, decisionId: decision(state),
    cards: projectCardState(state.cards, id),
    players: state.players.map(item => ({ userId: item.userId, seat: item.seat, declared: item.declaredWaits !== null,
      melds: structuredClone(item.melds), ...(item.userId === id ? { declaredWaits: item.declaredWaits } : {}) })),
    legalActions: yaanLegalActions(state, id), responses: state.claims ? projectClaims(state.claims, id) : null,
    outcome: state.outcome ? { reason: state.outcome.reason, postings: state.outcome.payments.postings,
      winners: state.outcome.winners.map(winner => ({ userId: winner.userId, redPoints: winner.win.redPoints,
        blackPoints: winner.win.blackPoints, scoreUnits: winner.win.scoring.status === 'scored' ? winner.win.scoring.scoreUnits : '1' })) } : null });
}
export function yaanTimedAction(state: YaanRound, id: string) {
  const actions = yaanLegalActions(state, id);
  if (!actions.length) return null;
  const hu = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId !== null &&
    (state.claims!.offers.find(offer => offer.id === action.choiceId)!.action as Move).type === 'hu') : actions.find(action => action.type === 'hu');
  const fallback = state.phase === 'response' ? actions.find(action => action.type === 'respond' && action.choiceId === null)
    : actions.find(action => action.type === 'begin' || action.type === 'draw') ??
      actions.find(action => action.type === 'discard');
  return { userId: id, decisionId: decision(state), delayMs: state.phase === 'response' ? 15000 : 30000, action: hu ?? fallback! };
}
