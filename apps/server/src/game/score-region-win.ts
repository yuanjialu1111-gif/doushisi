import { SCORE_REGION_VERSIONS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { PhysicalCard } from './cards.js';
import { decomposeCards } from './combinations.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { scoreRegionPackSpecification } from './score-region-pack.js';
import { automaticBonusCard, regionalPackSpecification, regionalRedThreshold,
  regionalScoreUnits, regionalThresholdUsesRedPoints, wildcardCard, type ScoreRegionKey } from './regional-profile.js';

export interface ScoreRegionMeld { kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou'; cards: PhysicalCard[] }
export interface ScoreRegionHand { concealed: PhysicalCard[]; melds: ScoreRegionMeld[]; bonus: PhysicalCard[] }
export interface ScoreRegionContext {
  winnerSeat: number; dealerSeat: number;
  source: 'original-hand' | 'discard' | 'flip' | 'replacement';
  sourceSeat: number | null; incomingCardId: string | null; discardCount: number;
  baoJiao?: boolean;
  /** Xuzhou piao fan for this winner and payer pair. */
  piaoWinner?: number;
  piaoPayer?: number;
  /** The incoming card is the replacement drawn after a gang or ba. */
  afterGang?: boolean;
  /** The incoming card is the ba target exposed from the player's concealed hand. */
  ownBa?: boolean;
}
export type ScoreRegionVersion = typeof SCORE_REGION_VERSIONS[keyof typeof SCORE_REGION_VERSIONS];
export interface ScoreRegionWinItem { pattern: string; count: number; fan: number }
export interface ExactScore {
  numerator: string;
  denominator: string;
  /** False only for the Suining friend-room formula that omits base beans. */
  applyBase: boolean;
  /** Rongxian over-cap points added after multiplying base beans. */
  additiveUnits: string;
}
export type ScoreRegionWin =
  | { version: ScoreRegionVersion; status: 'not-winning';
    reason: 'special-card-in-hand' | 'shape' | 'red-score' | 'minimum-fan';
    structureScore: number; redPoints: number; blackPoints: number }
  | { version: ScoreRegionVersion; status: 'winning'; structure: 'ordinary' | 'four-pairs';
    items: ScoreRegionWinItem[]; totalFan: number; cappedFan: number;
    structureScore: number; redPoints: number; blackPoints: number;
    scoreUnits: string; scoreRatio: ExactScore; concealedGroups: string[][] };

const special = (code: number) => [1001, 1002, 1003].includes(code);
const enabled = (value: unknown) => value === 1 || value === true;
const red = (code: number) => [1, 3].includes(Math.floor(code / 100));
const point = (code: number) => { const rank = ordinaryRank(code); return rank >= 11 ? 1 : rank; };
const seat = (value: number | null): value is number => Number.isInteger(value) && value! >= 1 && value! <= 4;

/** D15 pair table: 6 -> open 8 / concealed 6 / mandarin 10; 10 -> 15 / 10 / 14. */
function junlianPairFan(rules: Readonly<Record<string, unknown>>, cards: readonly PhysicalCard[],
  incoming: boolean, wildcardCount = 0) {
  const table = Number(rules.anDuiFanNum) === 10
    ? { open: 15, concealed: 10, mandarin: 14 }
    : { open: 8, concealed: 6, mandarin: 10 };
  const mandarin = wildcardCount === 0 && cards.length === 2 &&
    ordinaryRank(cards[0]!.code) === ordinaryRank(cards[1]!.code) && red(cards[0]!.code) !== red(cards[1]!.code);
  if (mandarin) return table.mandarin;
  return incoming ? table.open : table.concealed;
}

function junlianPairPoints(rules: Readonly<Record<string, unknown>>, cards: readonly PhysicalCard[],
  incoming: boolean, wildcardCount = 0) {
  const fan = junlianPairFan(rules, cards, incoming, wildcardCount);
  return cards.reduce((sum, card) => sum + (red(card.code) ? point(card.code) : 0), 0) * fan;
}

function validate(hand: ScoreRegionHand, context: ScoreRegionContext, rules: Readonly<Record<string, unknown>>,
  variantKey: ScoreRegionKey) {
  const metadata = rules.scoreRegion as Record<string, unknown> | undefined;
  requireCondition(metadata?.rulesVersion === SCORE_REGION_VERSIONS[variantKey], 'SCORE_REGION_RULES_VERSION_REQUIRED',
    'Only the explicitly frozen score-region version can evaluate this hand.', 409);
  requireCondition(hand != null && Array.isArray(hand.concealed) && Array.isArray(hand.melds) && Array.isArray(hand.bonus) &&
    hand.melds.length <= 3 && hand.melds.every(meld => ['chi', 'peng', 'gang', 'ba', 'tou'].includes(meld.kind)),
  'INVALID_SCORE_REGION_HAND', 'Expected bounded concealed, meld and bonus arrays.', 500);
  const cards = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus];
  const capacity = new Map(regionalPackSpecification(variantKey, rules).map(entry => [entry.code, entry.count]));
  const ids = new Set<string>();
  for (const card of cards) {
    requireCondition(card != null && typeof card.id === 'string' && !ids.has(card.id) && (capacity.get(card.code) ?? 0) > 0,
      'INVALID_SCORE_REGION_HAND', 'Cards must have unique identities and fit the frozen pack.', 500);
    ids.add(card.id); capacity.set(card.code, capacity.get(card.code)! - 1);
  }
  requireCondition(hand.bonus.every(card => automaticBonusCard(variantKey, rules, card.code)),
    'INVALID_SCORE_REGION_HAND', 'Only configured reward faces belong in the bonus zone.', 500);
  for (const meld of hand.melds) {
    requireCondition(meld.cards.every(card => !automaticBonusCard(variantKey, rules, card.code)), 'INVALID_SCORE_REGION_HAND',
      'Reward cards cannot substitute into exposed combinations.', 500);
    const ranks = meld.cards.map(card => ordinaryRank(card.code));
    const length = meld.kind === 'chi' ? 2 : ['peng', 'tou'].includes(meld.kind) ? 3 : 4;
    const multiGang = variantKey === '23:0' && enabled(rules.gangDuoZhang) &&
      ['gang', 'ba'].includes(meld.kind) && meld.cards.length >= 4 && meld.cards.length <= 6;
    requireCondition((multiGang ? ranks.length >= 4 && ranks.length <= 6 : ranks.length === length) &&
      (meld.kind === 'chi' ? ranks[0]! + ranks[1]! === 14 : new Set(ranks).size === 1),
    'INVALID_SCORE_REGION_HAND', 'The exposed combination does not match its declared structure.', 500);
  }
  requireCondition(context != null && seat(context.winnerSeat) && seat(context.dealerSeat) &&
    ['original-hand', 'discard', 'flip', 'replacement'].includes(context.source) &&
    Number.isSafeInteger(context.discardCount),
  'INVALID_RULE_FACTS', 'The server must supply valid score-region turn facts.', 500);
  requireCondition((context.piaoWinner === undefined || context.piaoWinner === 0 || context.piaoWinner === 1) &&
    (context.piaoPayer === undefined || context.piaoPayer === 0 || context.piaoPayer === 1),
  'INVALID_RULE_FACTS', 'Piao choices must be zero or one.', 500);
  if (context.source === 'original-hand') requireCondition(context.incomingCardId === null && context.sourceSeat === null &&
    context.winnerSeat === context.dealerSeat && context.discardCount === 0,
  'INVALID_RULE_FACTS', 'An original-hand win must precede every action.', 500);
  else requireCondition(seat(context.sourceSeat) && typeof context.incomingCardId === 'string' &&
    hand.concealed.some(card => card.id === context.incomingCardId), 'INVALID_RULE_FACTS',
    'The winning source must identify an incoming physical card.', 500);
}

function structurePoints(cards: readonly PhysicalCard[], melds: readonly ScoreRegionMeld[]) {
  const score = (card: PhysicalCard) => red(card.code) ? point(card.code) : 0;
  let total = 0;
  const pairCandidates = ordinaryMeldCandidates(cards, ['chi']);
  const decompositions = decomposeCards(cards.map(card => card.id), pairCandidates, cards.length / 2);
  for (const group of decompositions[0] ?? []) {
    const candidate = pairCandidates.find(item => item.id === group)!;
    const pair = candidate.cardIds.map(id => cards.find(card => card.id === id)!);
    total += pair.reduce((sum, card) => sum + score(card), 0) * 10;
  }
  for (const meld of melds) {
    const meldPoints = meld.cards.reduce((sum, card) => sum + score(card), 0);
    if (meld.kind === 'chi' || meld.kind === 'peng') total += meldPoints * 10;
    else if (meld.kind === 'tou') total += meldPoints * 15;
    else total += meldPoints * 20;
  }
  return total;
}

function pairedStructurePoints(cards: readonly PhysicalCard[]) {
  const byRank = new Map<number, PhysicalCard[]>();
  for (const card of cards) {
    const rank = ordinaryRank(card.code);
    byRank.set(rank, [...(byRank.get(rank) ?? []), card]);
  }
  return [...byRank.values()].reduce((total, cardsInRank) =>
    total + cardsInRank.reduce((sum, card) => sum + (red(card.code) ? point(card.code) : 0), 0) * 10, 0);
}

/**
 * Exact cover with configured wildcards. A wildcard completes one natural card
 * into a sum-14 pair, or upgrades a same-rank pair/triple to a triple/quad.
 * Its own red and black points remain zero.
 */
function decomposeWildcardHand(
  naturalCards: readonly PhysicalCard[], wildcardCount: number, requiredGroups: number,
): { groups: string[][]; wildcardSizes: number[] }[] {
  if (wildcardCount === 0) {
    const candidates = ordinaryMeldCandidates(naturalCards, ['chi']);
    return decomposeCards(naturalCards.map(card => card.id), candidates, requiredGroups)
      .map(groups => ({ groups: [groups], wildcardSizes: [] }));
  }
  requireCondition(wildcardCount <= 3, 'INVALID_SCORE_REGION_HAND',
    'Wildcard search requires at most three wildcards.', 500);
  const candidates = ordinaryMeldCandidates(naturalCards, ['chi', 'peng', 'gang']);
  const naturalIds = naturalCards.map(card => card.id);
  const results: { groups: string[][]; wildcardSizes: number[] }[] = [];
  const wildcardIds = Array.from({ length: wildcardCount }, (_, index) => `@wildcard-${index}`);
  const expanded = candidates.map(candidate => ({ id: candidate.id, cardIds: [...candidate.cardIds] }));
  for (let index = 0; index < expanded.length; index++) {
    const base = expanded[index]!;
    const rank = naturalCards.find(card => card.id === base.cardIds[0])?.code;
    if (rank === undefined) continue;
    const canPair = base.cardIds.length === 1 && ordinaryRank(rank) <= 13;
    const canTriple = base.cardIds.length === 2;
    const canQuad = base.cardIds.length === 3;
    if (canPair || canTriple || canQuad) {
      expanded.push({ id: `${base.id}+wild`, cardIds: [...base.cardIds, wildcardIds[0]!] });
    }
  }
  for (const groupIds of decomposeCards(naturalIds, expanded, requiredGroups)) {
    results.push({ groups: groupIds.map(id => {
      const candidate = expanded.find(item => item.id === id)!;
      return candidate.cardIds.filter(cardId => !cardId.startsWith('@wildcard-'));
    }), wildcardSizes: groupIds.map(id => expanded.find(item => item.id === id)!.cardIds
      .filter(cardId => cardId.startsWith('@wildcard-')).length) });
  }
  return results;
}

function junlianSpecialFans(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>,
  context: ScoreRegionContext, hand: ScoreRegionHand, ordinaryCards: readonly PhysicalCard[],
  decompositionCount: number, redPoints: number): ScoreRegionWinItem[] {
  if (variantKey !== '25:0' && variantKey !== '27:0') return [];
  const items: ScoreRegionWinItem[] = [];
  const add = (pattern: string, fan = 1, count = 1) => { if (count) items.push({ pattern, count, fan: fan * count }); };
  const redCount = ordinaryCards.filter(card => red(card.code)).length;
  const blackCount = ordinaryCards.length - redCount;
  const qia20 = enabled(rules.qia20) && redPoints === 20;
  const sevenRedSevenBlack = enabled(rules.da_7hong_7hei) && redCount === 7 && blackCount === 7;
  const oneRed = enabled(rules.yiDianZhu) && redCount === 1;
  if (qia20) add('qia20', 4);
  if (redPoints > Number(rules.qiFanDianNum)) add('redFan', Math.floor((redPoints - Number(rules.qiFanDianNum)) / 5));
  const qiangHu = enabled(rules.daShaQiangHu) && context.source === 'replacement' &&
    context.sourceSeat !== null && context.sourceSeat !== context.winnerSeat;
  const qiang7 = enabled(rules.qiang_7Hu) && context.source === 'replacement' &&
    hand.concealed.some(card => card.id === context.incomingCardId &&
      !wildcardCard(variantKey, rules, card.code) && !automaticBonusCard(variantKey, rules, card.code) &&
      ordinaryRank(card.code) === 7);
  if (qiangHu) add('qiangHu');
  else if (qiang7) add('qiang7');
  if (enabled(rules.haiDiLao) && context.source === 'replacement') add('haiDiLao');
  if (enabled(rules.ziQiangHu) && context.source === 'flip' && context.sourceSeat === context.winnerSeat) add('ziQiangHu');
  if (sevenRedSevenBlack) add('sevenRedSevenBlack');
  if (oneRed) add('oneRed');
  if (enabled(rules.menQing) && hand.melds.length === 0) add('menQing');
  if (enabled(rules.quanQiuRen) && hand.melds.length === 3 && ordinaryCards.length === 2 && context.source === 'discard') add('allFromOthers');
  if (enabled(rules.siZhangLuoDi) && hand.melds.some(meld => ['gang', 'ba'].includes(meld.kind) && meld.cards.length === 4)) add('fourFallen');
  if (enabled(rules.luanHu) && decompositionCount > 1) add('randomHu');
  const specialPatterns = new Set(['qia20', 'qiangHu', 'qiang7', 'haiDiLao', 'ziQiangHu',
    'sevenRedSevenBlack', 'oneRed', 'menQing', 'allFromOthers', 'fourFallen', 'randomHu']);
  if (enabled(rules.xiaoHu) && redPoints >= Number(rules.huRedScore) &&
    !items.some(item => specialPatterns.has(item.pattern))) add('smallHu');
  return items;
}

export function evaluateScoreRegionWin(hand: ScoreRegionHand, context: ScoreRegionContext,
  rules: Readonly<Record<string, unknown>>, variantKey: ScoreRegionKey): ScoreRegionWin {
  validate(hand, context, rules, variantKey);
  const expectedConcealed = (4 - hand.melds.length) * 2;
  requireCondition(hand.concealed.length === expectedConcealed, 'INVALID_SCORE_REGION_HAND',
    'Score-region concealed cards must complete the remaining groups.', 500);
  const ordinary = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards)]
    .filter(card => !automaticBonusCard(variantKey, rules, card.code) &&
      !wildcardCard(variantKey, rules, card.code));
  const redPoints = ordinary.filter(card => red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const blackPoints = ordinary.filter(card => !red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const threshold = regionalRedThreshold(variantKey, rules);
  const fail = (reason: Extract<ScoreRegionWin, { status: 'not-winning' }>['reason'], structureScore = 0): ScoreRegionWin =>
    ({ version: SCORE_REGION_VERSIONS[variantKey], status: 'not-winning', reason,
      structureScore, redPoints, blackPoints });
  const naturalConcealed = hand.concealed.filter(card => !wildcardCard(variantKey, rules, card.code) &&
    !automaticBonusCard(variantKey, rules, card.code));
  const candidates = ordinaryMeldCandidates(naturalConcealed, ['chi']);
  const decompositions = decomposeCards(naturalConcealed.map(card => card.id), candidates, 4 - hand.melds.length);
  const byRank = new Map<number, PhysicalCard[]>();
  for (const card of naturalConcealed) byRank.set(ordinaryRank(card.code), [...(byRank.get(ordinaryRank(card.code)) ?? []), card]);
  const fourPairs = hand.melds.length === 0 && [...byRank.values()].every(cards => cards.length % 2 === 0);
  if (!decompositions.length && !fourPairs) return fail('shape');
  const bonusScore = hand.bonus.length * 100;
  const alternatives: Extract<ScoreRegionWin, { status: 'winning' }>[] = [];
  for (const structure of ['ordinary', 'four-pairs'] as const) {
    if (structure === 'ordinary' ? !decompositions.length : !fourPairs) continue;
    const junlianPairScore = ['25:0', '27:0'].includes(variantKey)
      ? structure === 'ordinary'
        ? decompositions[0]!.reduce((sum, groupId) => {
          const group = candidates.find(candidate => candidate.id === groupId)!.cardIds;
          return sum + junlianPairPoints(rules,
            group.map(id => naturalConcealed.find(card => card.id === id)!),
            context.source !== 'original-hand' && group.includes(context.incomingCardId!));
        }, 0)
        : [...byRank.values()].reduce((sum, cards) => {
          if (cards.length === 4) {
            const [first, second] = cards.map(card => card.id).sort();
            const firstCards = cards.filter(card => card.id === first || card.id === second);
            return sum + junlianPairPoints(rules, firstCards,
              context.source !== 'original-hand' && firstCards.some(card => card.id === context.incomingCardId)) +
              junlianPairPoints(rules, cards.filter(card => !firstCards.includes(card)),
                context.source !== 'original-hand' && cards.filter(card => !firstCards.includes(card))
                  .some(card => card.id === context.incomingCardId));
          }
          return sum + junlianPairPoints(rules, cards,
            context.source !== 'original-hand' && cards.some(card => card.id === context.incomingCardId));
        }, 0)
      : 0;
    const junlianScore = junlianPairScore + structurePoints([], hand.melds) + bonusScore;
    // Reward faces are automatically moved out of the hand at the round layer. Evaluate the two
    // concealed structures from the same natural-card projection so an unprocessed reward face can
    // never enter the ordinary rank matcher or be scored as a substitute ordinary card.
    const structureCards = [...naturalConcealed];
    const structureScore = (['25:0', '27:0'].includes(variantKey) ? junlianScore :
      (structure === 'ordinary' ? structurePoints(structureCards, []) :
        pairedStructurePoints(structureCards)) + structurePoints([], hand.melds) + bonusScore) +
      (context.baoJiao && variantKey === '15:0' ? 50 : 0);
    const redEligible = enabled(rules.qia20) && redPoints === 20;
    const junlianSpecialThreshold = ['25:0', '27:0'].includes(variantKey) &&
      ((enabled(rules.yiDianZhu) && ordinary.filter(card => red(card.code)).length === 1) ||
        (enabled(rules.da_7hong_7hei) && ordinary.filter(card => red(card.code)).length === 7 &&
          ordinary.filter(card => !red(card.code)).length === 7));
    if (regionalThresholdUsesRedPoints(variantKey)
      ? redPoints < threshold && !redEligible && !junlianSpecialThreshold
      : structureScore < threshold) continue;
    const items: ScoreRegionWinItem[] = [];
    const add = (pattern: string, fan = 1, count = 1) => { if (count) items.push({ pattern, count, fan: fan * count }); };
    if (redEligible) add('qia20', 4);
    if (['25:0', '27:0'].includes(variantKey)) {
      const decompositionCount = structure === 'ordinary' ? decompositions.length : 1;
      items.push(...junlianSpecialFans(variantKey, rules, context, hand, ordinary,
        decompositionCount, redPoints));
    }
    if (context.baoJiao && variantKey !== '16:0' && variantKey !== '15:0') add('baoJiao', variantKey === '19:0' ? 1 : 1);
    if (enabled(rules.tianHu) && context.source === 'original-hand') add('tianHu', variantKey === '19:0' ? 2 : 1);
    if (enabled(rules.diHu) && context.source === 'discard' && context.discardCount === 1) add('diHu');
    if (enabled(rules.zimoJiafan) && ['flip', 'replacement'].includes(context.source) &&
      context.sourceSeat === context.winnerSeat) add('zimo');
    if (enabled(rules.gangHua) && context.source === 'replacement' && context.sourceSeat === context.winnerSeat) add('gangHua', 2);
    if (enabled(rules.cheLong) && ['flip', 'replacement'].includes(context.source) &&
      context.sourceSeat === context.winnerSeat) add('cheLong');
    if (enabled(rules.jiaFan_258)) {
      const pengs = hand.melds.filter(meld => ['peng', 'tou'].includes(meld.kind) &&
        [2, 5, 8].includes(ordinaryRank(meld.cards[0]!.code))).length;
      const gangs = hand.melds.filter(meld => ['gang', 'ba'].includes(meld.kind) &&
        [2, 5, 8].includes(ordinaryRank(meld.cards[0]!.code))).length;
      add('jiaFan258Peng', 1, pengs);
      add('jiaFan258Gang', 2, gangs);
    }
    if (enabled(rules.siGuiYi)) {
      const counts = new Map<number, number>();
      for (const card of ordinary) counts.set(ordinaryRank(card.code), (counts.get(ordinaryRank(card.code)) ?? 0) + 1);
      const quads = [...counts].filter(([, count]) => count === 4).length;
      add('siGuiYi', 1, quads);
    }
    if (enabled(rules.qianfenJiafan) && structureScore >= 1000) add('qianfenJiafan');
    const totalFan = items.reduce((sum, item) => sum + item.fan, 0);
    const cappedFan = rules.maxFan === undefined || rules.maxFan === 99
      ? totalFan : Math.min(rules.maxFan as number, totalFan);
    const concealedGroups = structure === 'ordinary' ? decompositions[0]!.map(id =>
      [...candidates.find(candidate => candidate.id === id)!.cardIds]) :
      [...byRank].sort(([a], [b]) => a - b).flatMap(([, cards]) => {
        const ids = cards.map(card => card.id).sort();
        return ids.length === 4 ? [ids.slice(0, 2), ids.slice(2)] : [ids];
      });
    const redRegion = ['20:0', '21:0', '22:0', '23:0', '24:0', '25:0', '26:0', '27:0'].includes(variantKey);
    const scoreNumerator = redRegion
      ? regionalScoreUnits(variantKey, rules, cappedFan) * 100n
      : BigInt(structureScore) * regionalScoreUnits(variantKey, rules, cappedFan) *
        (variantKey === '15:0' ? 8n : 1n);
    const scoreDenominator = redRegion ? 100n : variantKey === '15:0' ? 1000n : 100n;
    const scoreValue = scoreNumerator / scoreDenominator;
    const exactScore: ExactScore = {
      numerator: scoreNumerator.toString(),
      denominator: scoreDenominator.toString(),
      applyBase: variantKey !== '16:0',
      additiveUnits: '0',
    };
    alternatives.push({ version: SCORE_REGION_VERSIONS[variantKey], status: 'winning', structure, items, totalFan, cappedFan,
      structureScore, redPoints, blackPoints, scoreUnits: scoreValue.toString(),
      scoreRatio: exactScore, concealedGroups });
  }
  alternatives.sort((a, b) => b.cappedFan - a.cappedFan || b.structureScore - a.structureScore ||
    a.structure.localeCompare(b.structure));
  return alternatives[0] ?? fail('red-score', redPoints * 10 + bonusScore);
}

/** Candidate faces use only the viewer's cards and frozen pack capacity. */
export function scoreRegionWaits(hand: ScoreRegionHand,
  context: Omit<ScoreRegionContext, 'incomingCardId' | 'source'>, rules: Readonly<Record<string, unknown>>,
  variantKey: ScoreRegionKey,
  expectedConcealed = (4 - hand.melds.length) * 2 - 1) {
  requireCondition(hand != null && Array.isArray(hand.concealed) && Array.isArray(hand.melds) &&
    Array.isArray(hand.bonus) && hand.melds.length <= 3 &&
    hand.concealed.length === expectedConcealed,
  'INVALID_SCORE_REGION_HAND', 'Wait evaluation requires a one-card-short hand.', 500);
  const known = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus];
  const waits: { code: number; result: Extract<ScoreRegionWin, { status: 'winning' }> }[] = [];
  for (const entry of regionalPackSpecification(variantKey, rules)) {
    if (special(entry.code) || known.filter(card => card.code === entry.code).length >= entry.count) continue;
    let id = `wait-${entry.code}`;
    while (known.some(card => card.id === id)) id += '_';
    const result = evaluateScoreRegionWin({ ...hand, concealed: [...hand.concealed, { id, code: entry.code }] },
      { ...context, source: 'flip', incomingCardId: id }, rules, variantKey);
    if (result.status === 'winning') waits.push({ code: entry.code, result });
  }
  return waits;
}
