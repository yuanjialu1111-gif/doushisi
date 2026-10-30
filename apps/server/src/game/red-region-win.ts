import { SCORE_REGION_VERSIONS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { PhysicalCard } from './cards.js';
import { decomposeCards, type CandidateGroup } from './combinations.js';
import { ordinaryRank } from './ordinary-melds.js';
import {
  automaticBonusCard, regionalPackSpecification, regionalRedThreshold, regionalScoreUnits,
  wildcardCard, type ScoreRegionKey,
} from './regional-profile.js';
import type {
  ExactScore, ScoreRegionContext, ScoreRegionHand, ScoreRegionWin, ScoreRegionWinItem,
} from './score-region-win.js';

type Win = Extract<ScoreRegionWin, { status: 'winning' }>;
type Fail = Extract<ScoreRegionWin, { status: 'not-winning' }>;

const red = (code: number) => [1, 3].includes(Math.floor(code / 100));
const point = (code: number) => { const rank = ordinaryRank(code); return rank >= 11 ? 1 : rank; };
const enabled = (value: unknown) => value === 1 || value === true;
const seat = (value: number | null): value is number => Number.isInteger(value) && value! >= 1 && value! <= 4;

function validate(hand: ScoreRegionHand, context: ScoreRegionContext, rules: Readonly<Record<string, unknown>>,
  variantKey: ScoreRegionKey) {
  const metadata = rules.scoreRegion as Record<string, unknown> | undefined;
  requireCondition(metadata?.rulesVersion === SCORE_REGION_VERSIONS[variantKey], 'SCORE_REGION_RULES_VERSION_REQUIRED',
    'Only the explicitly frozen regional version can evaluate this hand.', 409);
  requireCondition(hand != null && Array.isArray(hand.concealed) && Array.isArray(hand.melds) && Array.isArray(hand.bonus) &&
    hand.melds.length <= 3 && hand.melds.every(meld => ['chi', 'peng', 'gang', 'ba', 'tou'].includes(meld.kind)),
  'INVALID_SCORE_REGION_HAND', 'Expected bounded concealed, meld and bonus arrays.', 500);
  const capacity = new Map(regionalPackSpecification(variantKey, rules).map(entry => [entry.code, entry.count]));
  const ids = new Set<string>();
  for (const card of [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus]) {
    requireCondition(card != null && typeof card.id === 'string' && !ids.has(card.id) &&
      (capacity.get(card.code) ?? 0) > 0,
    'INVALID_SCORE_REGION_HAND', 'Cards must have unique identities and fit the frozen pack.', 500);
    ids.add(card.id); capacity.set(card.code, capacity.get(card.code)! - 1);
  }
  requireCondition(hand.bonus.every(card => automaticBonusCard(variantKey, rules, card.code)),
    'INVALID_SCORE_REGION_HAND', 'Only configured reward faces belong in the bonus zone.', 500);
  for (const meld of hand.melds) {
    const multiGang = variantKey === '23:0' && enabled(rules.gangDuoZhang) &&
      meld.kind === 'gang' && meld.cards.length >= 4;
    requireCondition(meld.cards.every(card => !automaticBonusCard(variantKey, rules, card.code) &&
      (multiGang || !wildcardCard(variantKey, rules, card.code))), 'INVALID_SCORE_REGION_HAND',
    multiGang
      ? 'Reward cards cannot substitute into exposed combinations.'
      : 'Wild or reward cards cannot substitute into exposed combinations.', 500);
    const naturalCards = multiGang
      ? meld.cards.filter(card => !wildcardCard(variantKey, rules, card.code))
      : meld.cards;
    const ranks = naturalCards.map(card => ordinaryRank(card.code));
    const wildcardCount = meld.cards.length - naturalCards.length;
    const length = meld.kind === 'chi' ? 2 : ['peng', 'tou'].includes(meld.kind) ? 3 :
      multiGang ? meld.cards.length : 4;
    requireCondition((multiGang ? naturalCards.length >= 4 : ranks.length === length) &&
      (meld.kind === 'chi' ? ranks[0]! + ranks[1]! === 14 : new Set(ranks).size === 1),
    'INVALID_SCORE_REGION_HAND', 'The exposed combination does not match its declared structure.', 500);
  }
  requireCondition(context != null && seat(context.winnerSeat) && seat(context.dealerSeat) &&
    ['original-hand', 'discard', 'flip', 'replacement'].includes(context.source) &&
    Number.isSafeInteger(context.discardCount),
  'INVALID_RULE_FACTS', 'The server must supply valid regional turn facts.', 500);
  if (context.source === 'original-hand') requireCondition(context.incomingCardId === null && context.sourceSeat === null &&
    context.winnerSeat === context.dealerSeat && context.discardCount === 0,
  'INVALID_RULE_FACTS', 'An original-hand win must precede every action.', 500);
  else requireCondition(seat(context.sourceSeat) && typeof context.incomingCardId === 'string' &&
    [...hand.concealed, ...hand.bonus, ...hand.melds.flatMap(meld => meld.cards)]
      .some(card => card.id === context.incomingCardId),
  'INVALID_RULE_FACTS',
    'The winning source must identify an incoming physical card.', 500);
}

function pairDecompositions(variantKey: ScoreRegionKey, natural: readonly PhysicalCard[],
  wildcards: readonly PhysicalCard[], pairCount: number) {
  requireCondition(natural.length + wildcards.length === pairCount * 2, 'INVALID_SCORE_REGION_HAND',
    'Concealed cards must complete the remaining pair groups.', 500);
  const groups: CandidateGroup[] = [];
  const add = (id: string, cards: readonly PhysicalCard[]) => groups.push({ id, cardIds: cards.map(card => card.id) });
  for (let left = 0; left < natural.length; left++) for (let right = left + 1; right < natural.length; right++) {
    const a = natural[left]!, b = natural[right]!;
    if (ordinaryRank(a.code) + ordinaryRank(b.code) === 14) {
      add(`pair:${a.id}:${b.id}`, [a, b]);
    }
    if (['25:0', '27:0'].includes(variantKey) && ordinaryRank(a.code) === ordinaryRank(b.code) &&
      red(a.code) !== red(b.code)) {
      add(`mandarin:${a.id}:${b.id}`, [a, b]);
    }
    if (variantKey === '26:0' && ordinaryRank(a.code) === ordinaryRank(b.code)) {
      add(`concealed-pair:${a.id}:${b.id}`, [a, b]);
    }
  }
  for (const card of natural) for (const wild of wildcards) add(`wild:${card.id}:${wild.id}`, [card, wild]);
  for (let left = 0; left < wildcards.length; left++) for (let right = left + 1; right < wildcards.length; right++) {
    add(`wildpair:${wildcards[left]!.id}:${wildcards[right]!.id}`, [wildcards[left]!, wildcards[right]!]);
  }
  const byGroupId = new Map(groups.map(group => [group.id, group.cardIds]));
  return decomposeCards([...natural.map(card => card.id), ...wildcards.map(card => card.id)], groups, pairCount)
    .map(plan => plan.map(groupId => {
      const cardIds = byGroupId.get(groupId);
      requireCondition(cardIds, 'INVALID_SCORE_REGION_HAND',
        'A decomposition returned a group outside the frozen candidate set.', 500);
      return [...cardIds];
    }));
}


function structureScore(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>,
  natural: readonly PhysicalCard[], wildcards: readonly PhysicalCard[], groups: readonly string[][],
  melds: ScoreRegionHand['melds']) {
  const byId = new Map([...natural, ...wildcards].map(card => [card.id, card]));
  let total = 0;
  for (const group of groups) {
    for (const id of group) {
      const card = byId.get(id)!;
      requireCondition(card, 'INVALID_SCORE_REGION_HAND', 'A structure group referenced an unknown card.', 500);
      if (wildcardCard(variantKey, rules, card.code)) continue;
      total += (red(card.code) ? point(card.code) : 0) * 10;
    }
  }
  for (const meld of melds) {
    const points = meld.cards.reduce((sum, card) => sum + (red(card.code) ? point(card.code) : 0), 0);
    total += points * (['gang', 'ba'].includes(meld.kind) ? 15 : 10);
  }
  return total;
}

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

function junlianSpecialFans(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>,
  context: ScoreRegionContext, hand: ScoreRegionHand, ordinaryCards: readonly PhysicalCard[],
  decompositions: readonly string[][][], redPoints: number, blackPoints: number): ScoreRegionWinItem[] {
  if (variantKey !== '25:0' && variantKey !== '27:0') return [];
  const items: ScoreRegionWinItem[] = [];
  const add = (pattern: string, fan = 1, count = 1) => { if (count) items.push({ pattern, count, fan: fan * count }); };
  const qia20 = enabled(rules.qia20) && redPoints === 20;
  const redCount = ordinaryCards.filter(card => red(card.code)).length;
  const blackCount = ordinaryCards.length - redCount;
  const sevenRedSevenBlack = enabled(rules.da_7hong_7hei) && redCount === 7 && blackCount === 7;
  const oneRed = enabled(rules.yiDianZhu) && redCount === 1;
  if (qia20) add('qia20', 4);
  if (redPoints > Number(rules.qiFanDianNum)) add('redFan', Math.floor((redPoints - Number(rules.qiFanDianNum)) / 5));
  const qiangHu = enabled(rules.daShaQiangHu) && context.source === 'replacement' &&
    context.sourceSeat !== null && context.sourceSeat !== context.winnerSeat;
  const qiang7 = enabled(rules.qiang_7Hu) && context.source === 'replacement' &&
    context.sourceSeat !== null && context.sourceSeat !== context.winnerSeat &&
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
  if (enabled(rules.quanQiuRen) && hand.melds.length === 3 && hand.concealed.length === 2 &&
    hand.concealed.every(card => !wildcardCard(variantKey, rules, card.code) &&
      !automaticBonusCard(variantKey, rules, card.code)) && context.source === 'discard') add('allFromOthers');
  if (enabled(rules.siZhangLuoDi) && hand.melds.some(meld => ['gang', 'ba'].includes(meld.kind) && meld.cards.length === 4)) add('fourFallen');
  if (enabled(rules.luanHu) && decompositions.length > 1) add('randomHu');
  const specialPatterns = new Set(['qia20', 'qiangHu', 'qiang7', 'haiDiLao', 'ziQiangHu',
    'sevenRedSevenBlack', 'oneRed', 'menQing', 'allFromOthers', 'fourFallen', 'randomHu']);
  if (enabled(rules.xiaoHu) && redPoints >= Number(rules.huRedScore) &&
    !items.some(item => specialPatterns.has(item.pattern))) add('smallHu');
  return items;
}

function scoreRegionFans(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>,
  context: ScoreRegionContext, hand: ScoreRegionHand, natural: readonly PhysicalCard[],
  ordinaryCards: readonly PhysicalCard[], decompositions: readonly string[][][],
  redPoints: number, blackPoints: number, structure: 'ordinary' | 'four-pairs' = 'ordinary',
  dragonRanks: readonly number[] = []): ScoreRegionWinItem[] {
  const items: ScoreRegionWinItem[] = [];
  const add = (pattern: string, fan = 1, count = 1) => { if (count) items.push({ pattern, count, fan: fan * count }); };
  const allRed = natural.length > 0 && natural.every(card => red(card.code));
  const allBlack = natural.length > 0 && natural.every(card => !red(card.code));
  if (variantKey === '20:0') {
    if (enabled(rules.tianHuKeTou) && ['original-hand', 'replacement'].includes(context.source) &&
      context.sourceSeat === context.winnerSeat) add('tianHu', 3);
    return items;
  }
  if (variantKey === '21:0') {
    if (!enabled(rules.diHuChuDiyizhang) && context.source === 'discard' && context.discardCount === 1) return [];
    if (enabled(rules.diHuChuDiyizhang) && context.source === 'discard' && context.discardCount === 1) add('diHu', 3);
    if (!enabled(rules.wangToTingyong) && hand.bonus.length) add('bonus', hand.bonus.length);
    return items;
  }
  if (variantKey === '22:0') {
    if (enabled(rules.quanHongHei) && allRed) add('quanHong', 2);
    if (enabled(rules.quanHongHei) && allBlack) add('quanHei', 2);
    if (enabled(rules.tianHu) && context.source === 'original-hand') add('tianHu', 2);
    if (enabled(rules.diHu) && context.source === 'discard' && context.discardCount === 1) add('diHu', 2);
    if (enabled(rules.qia25) && redPoints === 25) add('qia25', 2);
    if (hand.bonus.length) add('bonus', hand.bonus.length);
    if (hand.concealed.some(card => wildcardCard(variantKey, rules, card.code)) &&
      !enabled(rules.tingyongHuDaFan) && context.source === 'discard') return [];
    return items;
  }
  if (variantKey === '23:0') {
    if (hand.bonus.length) add('wildReplacement', hand.bonus.length);
    const piaoCount = Number(context.piaoWinner ?? 0) + Number(context.piaoPayer ?? 0);
    if (piaoCount) add('piao', 1, piaoCount);
    return items;
  }
  if (variantKey === '24:0') {
    if (enabled(rules.quanHongHei) && allRed) add('quanHong', 2);
    if (enabled(rules.quanHongHei) && allBlack) add('quanHei', 2);
    if (enabled(rules.tianHu) && context.source === 'original-hand') add('tianHu', 2);
    if (enabled(rules.tianHu) && context.source === 'discard' && context.discardCount === 1 &&
      context.ownBa !== true) add('diHu', 2);
    if (hand.bonus.length) add('bonus', hand.bonus.length);
    return items;
  }
  if (variantKey === '25:0' || variantKey === '27:0') {
    return junlianSpecialFans(variantKey, rules, context, hand, ordinaryCards,
      decompositions, redPoints, blackPoints);
  }
  if (variantKey === '26:0') {
    if (enabled(rules.red50 ?? rules.hongHei_50) && redPoints >= 50) add('red50', 3);
    if (enabled(rules.red50 ?? rules.hongHei_50) && blackPoints >= 50) add('black50', 3);
    if (enabled(rules.baoJiao) && context.baoJiao) add('baoJiao', 2);
    if (enabled(rules.qia20) && redPoints === 20) add('qia20', 1);
    if (enabled(rules.gangHua) && context.source === 'replacement' && context.sourceSeat === context.winnerSeat &&
      context.afterGang === true) add('gangHua', 1);
    if (enabled(rules.gangPao) && context.source === 'discard' && context.afterGang === true) add('gangPao', 1);
    if (structure === 'four-pairs') {
      add('anDui', 2);
      add('dragon', 2, dragonRanks.length);
    }
    if (enabled(rules.siGuiYi)) {
      const concealedCounts = new Map<number, number>();
      for (const card of natural) {
        concealedCounts.set(ordinaryRank(card.code), (concealedCounts.get(ordinaryRank(card.code)) ?? 0) + 1);
      }
      const exposedCounts = new Map<number, number>();
      const exposedCards = ordinaryCards.filter(card => !natural.some(naturalCard => naturalCard.id === card.id));
      for (const card of exposedCards) {
        exposedCounts.set(ordinaryRank(card.code), (exposedCounts.get(ordinaryRank(card.code)) ?? 0) + 1);
      }
      const exposedThreePlusConcealed = [...concealedCounts]
        .filter(([rank, count]) => count === 1 && exposedCounts.get(rank) === 3 && !dragonRanks.includes(rank)).length;
      // A concealed quad is only skipped when that same quad already formed a dragon.
      const concealedFour = [...concealedCounts]
        .filter(([rank, count]) => count === 4 && !dragonRanks.includes(rank)).length;
      add('siGuiYi', 2, exposedThreePlusConcealed + concealedFour);
    }
    return items;
  }
  return items;
}

export function evaluateRedRegionWin(hand: ScoreRegionHand, context: ScoreRegionContext,
  rules: Readonly<Record<string, unknown>>, variantKey: ScoreRegionKey): ScoreRegionWin {
  validate(hand, context, rules, variantKey);
  const pairCount = 4 - hand.melds.length;
  const natural = hand.concealed.filter(card => !wildcardCard(variantKey, rules, card.code) &&
    !automaticBonusCard(variantKey, rules, card.code));
  const wildcards = hand.concealed.filter(card => wildcardCard(variantKey, rules, card.code));
  const exposed = hand.melds.flatMap(meld => meld.cards);
  const pointCards = [...natural, ...exposed.filter(card => !wildcardCard(variantKey, rules, card.code))];
  const redPoints = pointCards.filter(card => red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const blackPoints = pointCards.filter(card => !red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const fail = (reason: Fail['reason'], score = 0): Fail =>
    ({ version: SCORE_REGION_VERSIONS[variantKey], status: 'not-winning', reason, structureScore: score, redPoints, blackPoints });
  if (hand.concealed.some(card => automaticBonusCard(variantKey, rules, card.code))) return fail('special-card-in-hand');
  let decompositions: string[][][];
  try {
    decompositions = pairDecompositions(variantKey, natural, wildcards, pairCount);
  } catch (error) {
    if ((error as { code?: string }).code === 'INVALID_SCORE_REGION_HAND') return fail('shape');
    throw error;
  }
  const byRank = new Map<number, PhysicalCard[]>();
  for (const card of natural) byRank.set(ordinaryRank(card.code), [...(byRank.get(ordinaryRank(card.code)) ?? []), card]);
  const pairFaces = [...byRank.values()].every(cards => cards.length % 2 === 0);
  const fourPairs = variantKey === '26:0' && enabled(rules.anDui) && hand.melds.length === 0 &&
    wildcards.length === 0 && (pairFaces || decompositions.length > 0);
  if (!decompositions.length && !fourPairs) return fail('shape');
  const threshold = regionalRedThreshold(variantKey, rules);
  const qia20 = enabled(rules.qia20) && redPoints === 20;
  const ordinaryCards = [...natural, ...exposed];
  const ordinaryRedCount = ordinaryCards.filter(card => red(card.code)).length;
  const ordinaryBlackCount = ordinaryCards.length - ordinaryRedCount;
  const junlianSpecialThreshold = ['25:0', '27:0'].includes(variantKey) &&
    ((enabled(rules.yiDianZhu) && ordinaryRedCount === 1) ||
      (enabled(rules.da_7hong_7hei) && ordinaryRedCount === 7 && ordinaryBlackCount === 7));
  if (redPoints < threshold && !qia20 && !junlianSpecialThreshold) return fail('red-score');
  if (variantKey === '22:0' && wildcards.length > 0 && !enabled(rules.tingyongHuDaFan) && context.source === 'discard') {
    return fail('minimum-fan');
  }
  const alternatives: Win[] = [];
  for (const structure of ['ordinary', 'four-pairs'] as const) {
    if (structure === 'ordinary' ? !decompositions.length : !fourPairs) continue;
    const byId = new Map([...natural, ...wildcards].map(card => [card.id, card]));
    const pairPlans = ['25:0', '27:0'].includes(variantKey)
      ? decompositions.map(groups => ({ groups, points: groups.reduce((sum, group) => sum + junlianPairPoints(rules,
        group.map(id => byId.get(id)!),
        context.source !== 'original-hand' && group.includes(context.incomingCardId!),
        group.filter(id => wildcards.some(card => card.id === id)).length), 0) }))
      : [{ groups: decompositions[0] ?? [], points: 0 }];
    const pairPlan = pairPlans.reduce((best, plan) => plan.points > best.points ? plan : best, pairPlans[0]!);
    const pairPoints = pairPlan.points;
    const structurePoints = pairPoints + structureScore(variantKey, rules, natural, wildcards, [], hand.melds);
    const dragonRanks = structure === 'four-pairs'
      ? [...byRank.values()].flatMap(cards => Array<number>(Math.floor(cards.length / 4))
        .fill(ordinaryRank(cards[0]!.code)))
        .flatMap(rank => enabled(rules.siGuiYi) ? [rank] : [rank, rank]) : [];
    const items = scoreRegionFans(variantKey, rules, context, hand, natural, ordinaryCards,
      decompositions, redPoints, blackPoints, structure, dragonRanks);
    const totalFan = items.reduce((sum, item) => sum + item.fan, 0);
    const cappedFan = rules.maxFan === undefined || rules.maxFan === 99
      ? totalFan : Math.min(rules.maxFan as number, totalFan);
    const groups = structure === 'ordinary' || decompositions.length > 0
      ? pairPlan.groups.map(group => [...group])
      : [...byRank].sort(([left], [right]) => left - right).flatMap(([, cards]) => {
        const ids = cards.map(card => card.id).sort();
        return ids.length === 4 ? [ids.slice(0, 2), ids.slice(2)] : [ids];
      });
    const baseUnits = regionalScoreUnits(variantKey, rules, totalFan);
    const overCap = variantKey === '26:0'
      ? BigInt(rules.chaoFanJiaDi as number) * BigInt(Math.max(totalFan - Number(rules.maxFan ?? 4), 0))
      : 0n;
    const basicUnits = variantKey === '26:0'
      ? 2n ** BigInt(Math.min(totalFan, Number(rules.maxFan ?? 4)))
      : baseUnits;
    const yanjinSelfDraw = variantKey === '22:0' && enabled(rules.zimoJiafan) &&
      ['flip', 'replacement'].includes(context.source) && context.sourceSeat === context.winnerSeat;
    const yanjinNumerator = variantKey === '22:0'
      ? BigInt(1 + totalFan + (yanjinSelfDraw ? totalFan + 1 : 0))
      : basicUnits;
    const yanjinDenominator = 1n;
    // D15 treats pair points as an additive settlement component, not a condition fan.
    // Keep structureScore diagnostic while making the same points reach the final ratio.
    const pairSettlementUnits = ['25:0', '27:0'].includes(variantKey)
      ? BigInt(pairPoints)
      : 0n;
    const finalNumerator = yanjinNumerator + pairSettlementUnits;
    const scoreUnits = variantKey === '22:0'
      ? (finalNumerator / yanjinDenominator).toString() : finalNumerator.toString();
    alternatives.push({ version: SCORE_REGION_VERSIONS[variantKey], status: 'winning', structure,
      items, totalFan, cappedFan, structureScore: structurePoints,
      redPoints, blackPoints, scoreUnits,
      scoreRatio: {
        numerator: finalNumerator.toString(),
        denominator: yanjinDenominator.toString(),
        applyBase: true,
        additiveUnits: overCap.toString(),
      } satisfies ExactScore,
      concealedGroups: groups });
  }
  alternatives.sort((left, right) => right.cappedFan - left.cappedFan || right.totalFan - left.totalFan ||
    left.structure.localeCompare(right.structure));
  return alternatives[0] ?? fail('minimum-fan');
}

export function redRegionWaits(hand: ScoreRegionHand,
  context: Omit<ScoreRegionContext, 'incomingCardId' | 'source'>, rules: Readonly<Record<string, unknown>>,
  variantKey: ScoreRegionKey,
  expectedConcealed = (4 - hand.melds.length) * 2 - 1) {
  requireCondition(hand.concealed.length === expectedConcealed, 'INVALID_SCORE_REGION_HAND',
    'Wait evaluation requires a one-card-short hand.', 500);
  const known = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus];
  const waits: { code: number; result: Win }[] = [];
  for (const entry of regionalPackSpecification(variantKey, rules)) {
    if (wildcardCard(variantKey, rules, entry.code) || automaticBonusCard(variantKey, rules, entry.code) ||
      known.filter(card => card.code === entry.code).length >= entry.count) continue;
    let id = `wait-${entry.code}`;
    while (known.some(card => card.id === id)) id += '_';
    const result = evaluateRedRegionWin({ ...hand, concealed: [...hand.concealed, { id, code: entry.code }] },
      { ...context, source: 'flip', incomingCardId: id }, rules, variantKey);
    if (result.status === 'winning') waits.push({ code: entry.code, result });
  }
  return waits;
}
