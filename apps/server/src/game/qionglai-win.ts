import { QIONGLAI_INDEPENDENT_VERSION, QIONGLAI_INDEPENDENT_FANS, QIONGLAI_PACKAGE_FANS, QIONGLAI_PACK_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { qionglaiPatterns, type QionglaiPattern } from '../qionglai-patterns.js';
import type { QionglaiScoringOptions } from '../qionglai-scoring.js';
import type { PhysicalCard } from './cards.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { decomposeCards } from './combinations.js';
import { qionglaiPackSpecification } from './qionglai-pack.js';

export interface QionglaiMeld {
  kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou';
  cards: PhysicalCard[];
}
export interface QionglaiHand {
  concealed: PhysicalCard[];
  melds: QionglaiMeld[];
  bonus: PhysicalCard[];
}
export interface QionglaiWinContext {
  winnerSeat: number;
  dealerSeat: number;
  source: 'original-hand' | 'discard' | 'flip' | 'replacement';
  sourceSeat: number | null;
  incomingCardId: string | null;
  stealCount: number;
  replacementCount: number;
  discardCount: number;
}
export interface QionglaiWinItem { pattern: string; count: number; fanEach: number; fan: number }
interface WinBase {
  version: typeof QIONGLAI_INDEPENDENT_VERSION;
  redPoints: number;
  blackPoints: number;
}
export type QionglaiWin =
  | WinBase & { status: 'not-winning'; reason: 'special-card-in-hand' | 'shape' | 'points' | 'minimum-fan' }
  | WinBase & {
    status: 'winning'; structure: 'ordinary' | 'four-pairs'; concealedGroups: string[][];
    items: QionglaiWinItem[]; totalFan: number; cappedFan: number; scoreUnits: string;
  };

const toggleNames = ['qia20', 'jinGouDiao', 'anDui', 'siGuiYi', 'keSuHu', 'qlTianDiHu', 'qlHongHeiHu', 'qlHongHei50'] as const;
const special = (code: number) => [1001, 1002, 1003].includes(code);
const red = (code: number) => [1, 3].includes(Math.floor(code / 100));
const point = (code: number) => { const rank = ordinaryRank(code); return rank >= 11 ? 1 : rank; };
const whole = (value: number) => Number.isSafeInteger(value) && value >= 0;
const seat = (value: number | null): value is number => Number.isInteger(value) && value! >= 1 && value! <= 4;

function validate(hand: QionglaiHand, context: QionglaiWinContext, rules: Readonly<Record<string, unknown>>) {
  const metadata = rules.qionglai as Record<string, unknown> | undefined;
  requireCondition(metadata?.rulesVersion === QIONGLAI_INDEPENDENT_VERSION &&
    metadata.fanVersion === QIONGLAI_INDEPENDENT_VERSION && metadata.packVersion === QIONGLAI_PACK_VERSION, 'QIONGLAI_RULES_VERSION_REQUIRED',
  'Only the explicitly frozen independent Qionglai version can evaluate this hand.', 409);
  requireCondition(toggleNames.every(key => rules[key] === 0 || rules[key] === 1) &&
    [4, 5, 6, 99].includes(rules.maxFan as number) && [0, 1].includes(rules.chengFan as number) &&
    typeof rules.wangNum === 'number', 'INVALID_ROOM_OPTIONS', 'Qionglai options must be explicit.', 500);
  requireCondition(hand != null && Array.isArray(hand.concealed) && Array.isArray(hand.melds) &&
    Array.isArray(hand.bonus) && hand.concealed.length <= 8 && hand.melds.length <= 3 &&
    hand.melds.every(meld => meld != null && Array.isArray(meld.cards) &&
      ['chi', 'peng', 'gang', 'ba', 'tou'].includes(meld.kind)),
  'INVALID_QIONGLAI_HAND', 'Expected bounded physical hand, meld and bonus arrays.', 500);
  const cards = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus];
  const capacity = new Map(qionglaiPackSpecification(rules.wangNum as number).map(entry => [entry.code, entry.count]));
  const ids = new Set<string>();
  for (const card of cards) {
    requireCondition(card != null && typeof card.id === 'string' && card.id.length > 0 &&
      !ids.has(card.id) && (capacity.get(card.code) ?? 0) > 0,
    'INVALID_QIONGLAI_HAND', 'Cards must have unique identities and fit the frozen physical pack.', 500);
    ids.add(card.id);
    capacity.set(card.code, capacity.get(card.code)! - 1);
  }
  requireCondition(hand.bonus.every(card => special(card.code)), 'INVALID_QIONGLAI_HAND',
    'Only the three special card faces are Qionglai bonus cards.', 500);
  for (const meld of hand.melds) {
    requireCondition(meld.cards.every(card => !special(card.code)), 'INVALID_QIONGLAI_HAND',
      'Qionglai reward cards cannot substitute into melds.', 500);
    const ranks = meld.cards.map(card => ordinaryRank(card.code));
    const length = meld.kind === 'chi' ? 2 : ['peng', 'tou'].includes(meld.kind) ? 3 : 4;
    requireCondition(ranks.length === length &&
      (meld.kind === 'chi' ? ranks[0]! + ranks[1]! === 14 : new Set(ranks).size === 1),
    'INVALID_QIONGLAI_HAND', 'The exposed combination does not match its declared structure.', 500);
  }
  requireCondition(context != null && seat(context.winnerSeat) && seat(context.dealerSeat) &&
    ['original-hand', 'discard', 'flip', 'replacement'].includes(context.source) &&
    [context.stealCount, context.replacementCount, context.discardCount].every(whole),
  'INVALID_RULE_FACTS', 'The server must supply valid Qionglai turn facts.', 500);
  if (context.source === 'original-hand') {
    requireCondition(context.incomingCardId === null && context.sourceSeat === null &&
      context.winnerSeat === context.dealerSeat && context.discardCount === 0 &&
      context.stealCount === 0 && context.replacementCount === 0 &&
      hand.melds.length === 0 && hand.bonus.length === 0,
    'INVALID_RULE_FACTS', 'An original-hand win must precede every action and replacement.', 500);
  } else {
    requireCondition(seat(context.sourceSeat) && typeof context.incomingCardId === 'string' &&
      hand.concealed.some(card => card.id === context.incomingCardId) &&
      (context.source !== 'discard' || context.sourceSeat !== context.winnerSeat) &&
      (context.source !== 'replacement' || context.sourceSeat === context.winnerSeat),
    'INVALID_RULE_FACTS', 'The winning source must identify an incoming physical card and its source seat.', 500);
  }
}

/** Server-only structural evaluation. It does not authorize a turn or trust a player's score. */
export function evaluateQionglaiWin(
  hand: QionglaiHand, context: QionglaiWinContext, rules: Readonly<Record<string, unknown>>,
): QionglaiWin {
  validate(hand, context, rules);
  const options = rules as unknown as QionglaiScoringOptions;
  const ordinary = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards)].filter(card => !special(card.code));
  const base: WinBase = { version: QIONGLAI_INDEPENDENT_VERSION,
    redPoints: ordinary.filter(card => red(card.code)).reduce((total, card) => total + point(card.code), 0),
    blackPoints: ordinary.filter(card => !red(card.code)).reduce((total, card) => total + point(card.code), 0) };
  const fail = (reason: Extract<QionglaiWin, { status: 'not-winning' }>['reason']): QionglaiWin =>
    ({ ...base, status: 'not-winning', reason });
  if (hand.concealed.some(card => special(card.code))) return fail('special-card-in-hand');
  if (hand.concealed.length !== (4 - hand.melds.length) * 2) return fail('shape');
  const candidates = ordinaryMeldCandidates(hand.concealed, ['chi']);
  const decompositions = decomposeCards(hand.concealed.map(card => card.id), candidates, 4 - hand.melds.length);
  const byRank = new Map<number, PhysicalCard[]>();
  for (const card of hand.concealed) {
    const rank = ordinaryRank(card.code);
    byRank.set(rank, [...(byRank.get(rank) ?? []), card]);
  }
  const fourPairs = options.anDui === 1 && hand.melds.length === 0 &&
    [...byRank.values()].every(cards => cards.length % 2 === 0);
  if (!decompositions.length && !fourPairs) return fail('shape');
  const patterns = qionglaiPatterns({
    legalWin: true, winnerSeat: context.winnerSeat, dealerSeat: context.dealerSeat,
    phase: context.source === 'original-hand' ? 'original-hand' : context.source === 'discard' ? 'ordinary-discard' : 'other',
    sourceSeat: context.sourceSeat, stealCount: context.stealCount, replacementCount: context.replacementCount,
    discardCount: context.discardCount, redPoints: base.redPoints, blackPoints: base.blackPoints,
    handAndMelds: ordinary.map(card => ({ kind: 'ordinary', color: red(card.code) ? 'red' : 'black' })),
  }, options);
  // These explicitly defined special wins waive the ordinary 20-red threshold, not the structure.
  if (base.redPoints < 20 && patterns.length === 0) return fail('points');
  const alternatives: Extract<QionglaiWin, { status: 'winning' }>[] = [];
  for (const structure of ['ordinary', 'four-pairs'] as const) {
    if (structure === 'ordinary' ? !decompositions.length : !fourPairs) continue;
    const items: QionglaiWinItem[] = [];
    const add = (pattern: string, fanEach: number, count = 1) => {
      if (count) items.push({ pattern, count, fanEach, fan: fanEach * count });
    };
    for (const pattern of patterns) add(pattern, QIONGLAI_INDEPENDENT_FANS[pattern as QionglaiPattern]);
    add('bonus', QIONGLAI_INDEPENDENT_FANS.bonus, hand.bonus.length);
    if (options.qia20 && base.redPoints === 20) add('qia20', QIONGLAI_PACKAGE_FANS.qia20);
    if (options.jinGouDiao && hand.concealed.length === 2 && hand.melds.length === 3 &&
      hand.melds.every(meld => meld.kind !== 'chi')) add('jinGouDiao', QIONGLAI_PACKAGE_FANS.jinGouDiao);
    const dragons = structure === 'four-pairs' ? [...byRank].filter(([, cards]) => cards.length === 4).map(([rank]) => rank) : [];
    if (structure === 'four-pairs') {
      add('anDui', QIONGLAI_PACKAGE_FANS.anDui);
      add('dragon', QIONGLAI_PACKAGE_FANS.dragon, dragons.length);
    }
    if (options.siGuiYi) {
      const excluded = new Set([...dragons, ...hand.melds.filter(meld => ['gang', 'ba'].includes(meld.kind))
        .map(meld => ordinaryRank(meld.cards[0]!.code))]);
      const counts = new Map<number, number>();
      for (const card of ordinary) {
        const rank = ordinaryRank(card.code);
        counts.set(rank, (counts.get(rank) ?? 0) + 1);
      }
      add('siGuiYi', QIONGLAI_PACKAGE_FANS.siGuiYi,
        [...counts].filter(([rank, count]) => count === 4 && !excluded.has(rank)).length);
    }
    let totalFan = items.reduce((sum, item) => sum + item.fan, 0);
    if (totalFan === 0) {
      if (!options.keSuHu || !['flip', 'replacement'].includes(context.source) || context.sourceSeat !== context.winnerSeat) continue;
      add('keSuHu', QIONGLAI_PACKAGE_FANS.keSuHu);
      totalFan = QIONGLAI_PACKAGE_FANS.keSuHu;
    }
    const cappedFan = options.maxFan === 99 ? totalFan : Math.min(options.maxFan, totalFan);
    const concealedGroups = structure === 'ordinary'
      ? decompositions[0]!.map(id => [...candidates.find(candidate => candidate.id === id)!.cardIds])
      : [...byRank].sort(([a], [b]) => a - b).flatMap(([, cards]) => {
        const ids = cards.map(card => card.id).sort();
        return ids.length === 4 ? [ids.slice(0, 2), ids.slice(2)] : [ids];
      });
    alternatives.push({ ...base, status: 'winning', structure, concealedGroups, items, totalFan, cappedFan,
      scoreUnits: (options.chengFan ? 2n ** BigInt(cappedFan) : 1n + BigInt(cappedFan)).toString() });
  }
  alternatives.sort((a, b) => b.cappedFan - a.cappedFan || b.totalFan - a.totalFan || a.structure.localeCompare(b.structure));
  return alternatives[0] ?? fail('minimum-fan');
}

/** Candidate faces use only the viewer's cards and pack counts, never another hand or deck order. */
export function qionglaiWaits(
  hand: QionglaiHand, context: Omit<QionglaiWinContext, 'incomingCardId' | 'source'>,
  rules: Readonly<Record<string, unknown>>,
) {
  requireCondition(hand != null && Array.isArray(hand.concealed) && Array.isArray(hand.melds) &&
    Array.isArray(hand.bonus) && hand.melds.length <= 3 &&
    hand.concealed.length === (4 - hand.melds.length) * 2 - 1,
  'INVALID_QIONGLAI_HAND', 'Wait evaluation requires a one-card-short hand.', 500);
  const known = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus];
  const waits: { code: number; result: Extract<QionglaiWin, { status: 'winning' }> }[] = [];
  // Validate malformed input even if every possible winning face is already held.
  evaluateQionglaiWin({ ...hand, concealed: [...hand.concealed] }, {
    ...context, source: 'flip', incomingCardId: hand.concealed[0]!.id,
  }, rules);
  for (const entry of qionglaiPackSpecification(rules.wangNum as number)) {
    if (special(entry.code) || known.filter(card => card.code === entry.code).length >= entry.count) continue;
    let id = `wait-${entry.code}`;
    while (known.some(card => card.id === id)) id += '_';
    const result = evaluateQionglaiWin({ ...hand, concealed: [...hand.concealed, { id, code: entry.code }] },
      { ...context, source: 'flip', incomingCardId: id }, rules);
    if (result.status === 'winning') waits.push({ code: entry.code, result });
  }
  return waits;
}
