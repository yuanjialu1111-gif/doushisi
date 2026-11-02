import { XINJIN_INDEPENDENT_FANS, XINJIN_INDEPENDENT_VERSION, XINJIN_SCORING_V2, XINJIN_V2_FANS, xinjinRedGate } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { PhysicalCard } from './cards.js';
import { decomposeCards } from './combinations.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { xinjinPackSpecification } from './xinjin-pack.js';

export interface XinjinHand { concealed: PhysicalCard[]; melds: { kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou'; cards: PhysicalCard[] }[]; bonus: PhysicalCard[] }
export interface XinjinWinContext {
  winnerSeat: number; dealerSeat: number; baoJiao?: boolean;
  source: 'original-hand' | 'discard' | 'flip' | 'replacement';
  sourceSeat: number | null; incomingCardId: string | null; discardCount: number;
}
export interface XinjinWinItem { pattern: keyof typeof XINJIN_INDEPENDENT_FANS | keyof typeof XINJIN_V2_FANS; count: number; fan: number }
export type XinjinWin =
  | { version: typeof XINJIN_INDEPENDENT_VERSION; status: 'not-winning'; reason: 'special-card-in-hand' | 'shape' | 'points' | 'minimum-fan'; redPoints: number; blackPoints: number }
  | { version: typeof XINJIN_INDEPENDENT_VERSION; status: 'winning'; structure: 'ordinary' | 'four-pairs'; items: XinjinWinItem[];
    totalFan: number; cappedFan: number; scoreUnits: string; redPoints: number; blackPoints: number; concealedGroups: string[][] };

const special = (code: number) => [1001, 1002, 1003].includes(code);
const enabled = (value: unknown) => value === 1 || value === true;
const red = (code: number) => [1, 3].includes(Math.floor(code / 100));
const point = (code: number) => { const rank = ordinaryRank(code); return rank >= 11 ? 1 : rank; };
const seat = (value: number | null): value is number => Number.isInteger(value) && value! >= 1 && value! <= 4;
/** 桌规则里冻结了 v2 才按 v2 算；发布前开的老桌没有这个字段，照 v1 打完。 */
export const isXinjinV2 = (rules: Readonly<Record<string, unknown>>) =>
  (rules.xinjin as Record<string, unknown> | undefined)?.scoring === XINJIN_SCORING_V2;

function validate(hand: XinjinHand, context: XinjinWinContext, rules: Readonly<Record<string, unknown>>) {
  const metadata = rules.xinjin as Record<string, unknown> | undefined;
  requireCondition(metadata?.rulesVersion === XINJIN_INDEPENDENT_VERSION, 'XINJIN_RULES_VERSION_REQUIRED',
    'Only the explicitly frozen independent Xinjin version can evaluate this hand.', 409);
  requireCondition(hand != null && Array.isArray(hand.concealed) && Array.isArray(hand.melds) && Array.isArray(hand.bonus) &&
    hand.melds.length <= 3 && hand.melds.every(meld => ['chi', 'peng', 'gang', 'ba', 'tou'].includes(meld.kind)),
  'INVALID_XINJIN_HAND', 'Expected bounded concealed, meld and bonus arrays.', 500);
  const cards = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus];
  const capacity = new Map(xinjinPackSpecification(rules.wangNum as number).map(entry => [entry.code, entry.count]));
  const ids = new Set<string>();
  for (const card of cards) {
    requireCondition(card != null && typeof card.id === 'string' && !ids.has(card.id) && (capacity.get(card.code) ?? 0) > 0,
      'INVALID_XINJIN_HAND', 'Cards must have unique identities and fit the frozen pack.', 500);
    ids.add(card.id); capacity.set(card.code, capacity.get(card.code)! - 1);
  }
  requireCondition(context != null && seat(context.winnerSeat) && seat(context.dealerSeat) &&
    ['original-hand', 'discard', 'flip', 'replacement'].includes(context.source) && Number.isSafeInteger(context.discardCount),
  'INVALID_RULE_FACTS', 'The server must supply valid Xinjin turn facts.', 500);
  if (context.source === 'original-hand') requireCondition(context.incomingCardId === null && context.sourceSeat === null &&
    // v2 天胡带王：开局亮王补牌后庄家胡照样算天胡，鬼牌区可以有牌（DEC-20261102-起手报叫）。
    context.winnerSeat === context.dealerSeat && context.discardCount === 0 && (hand.bonus.length === 0 || isXinjinV2(rules)),
  'INVALID_RULE_FACTS', 'An original-hand win must precede every action.', 500);
  else requireCondition(seat(context.sourceSeat) && typeof context.incomingCardId === 'string' &&
    hand.concealed.some(card => card.id === context.incomingCardId), 'INVALID_RULE_FACTS',
    'The winning source must identify an incoming physical card.', 500);
}

export function evaluateXinjinWin(hand: XinjinHand, context: XinjinWinContext, rules: Readonly<Record<string, unknown>>): XinjinWin {
  validate(hand, context, rules);
  const expectedConcealed = (4 - hand.melds.length) * 2;
  requireCondition(hand.concealed.length === expectedConcealed, 'INVALID_XINJIN_HAND',
    'Xinjin concealed cards must complete the remaining groups.', 500);
  const ordinary = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards)].filter(card => !special(card.code));
  const redPoints = ordinary.filter(card => red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const blackPoints = ordinary.filter(card => !red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const fail = (reason: Extract<XinjinWin, { status: 'not-winning' }>['reason']): XinjinWin =>
    ({ version: XINJIN_INDEPENDENT_VERSION, status: 'not-winning', reason, redPoints, blackPoints });
  if (hand.concealed.some(card => special(card.code))) return fail('special-card-in-hand');
  if (isXinjinV2(rules)) return evaluateV2(hand, context, rules, ordinary, redPoints, blackPoints, fail);
  const candidates = ordinaryMeldCandidates(hand.concealed, ['chi']);
  const decompositions = decomposeCards(hand.concealed.map(card => card.id), candidates, 4 - hand.melds.length);
  const byRank = new Map<number, PhysicalCard[]>();
  for (const card of hand.concealed) byRank.set(ordinaryRank(card.code), [...(byRank.get(ordinaryRank(card.code)) ?? []), card]);
  const fourPairs = enabled(rules.anDui) && hand.melds.length === 0 && [...byRank.values()].every(cards => cards.length % 2 === 0);
  if (!decompositions.length && !fourPairs) return fail('shape');
  const fiveSmall = enabled(rules.xiaoHu) && ordinary.length > 0 &&
    ordinary.every(card => [1, 2, 3, 11, 12, 13].includes(ordinaryRank(card.code)));
  // Five-small is an explicit special win and waives the ordinary red-20 gate,
  // matching the other enabled special patterns; structure is still required.
  if (redPoints < 20 && !fiveSmall) return fail('points');
  const alternatives: Extract<XinjinWin, { status: 'winning' }>[] = [];
  for (const structure of ['ordinary', 'four-pairs'] as const) {
    if (structure === 'ordinary' ? !decompositions.length : !fourPairs) continue;
    const items: XinjinWinItem[] = [];
    const add = (pattern: keyof typeof XINJIN_INDEPENDENT_FANS, count = 1) => {
      if (count) items.push({ pattern, count, fan: XINJIN_INDEPENDENT_FANS[pattern] * count });
    };
    if (enabled(rules.qiToWang)) add('qiToWang', hand.bonus.length);
    if (context.baoJiao === true) add('baoJiao');
    if (enabled(rules.tianHu) && context.source === 'original-hand') add('tianHu');
    if (enabled(rules.diHu) && context.source === 'discard' && context.discardCount === 1) add('diHu');
    if (enabled(rules.qia20) && redPoints === 20) add('qia20');
    if (enabled(rules.qia40) && redPoints >= 40 && redPoints < 50) add('qia40');
    if (enabled(rules.qia50) && redPoints >= 50) add('qia50');
    if (fiveSmall) add('xiaoHu');
    if (structure === 'four-pairs') {
      add('anDui');
      const dragons = [...byRank].filter(([, cards]) => cards.length === 4).map(([rank]) => rank);
      if (enabled(rules.longDui)) add('longDui', dragons.length);
    }
    if (enabled(rules.siGuiYi)) {
      const counts = new Map<number, number>();
      for (const card of ordinary) counts.set(ordinaryRank(card.code), (counts.get(ordinaryRank(card.code)) ?? 0) + 1);
      const dragonsAlreadyScored = structure === 'four-pairs' && enabled(rules.longDui)
        ? [...byRank.values()].filter(cards => cards.length === 4).length : 0;
      add('siGuiYi', Math.max(0, [...counts.values()].filter(count => count === 4).length - dragonsAlreadyScored));
    }
    const totalFan = items.reduce((sum, item) => sum + item.fan, 0);
    // A legal structure that clears the red gate remains playable when every
    // enabled fan is worth zero; the selected scoring formula then yields one
    // settlement unit.
    const cappedFan = rules.maxFan === 99 ? totalFan : Math.min(rules.maxFan as number, totalFan);
    const concealedGroups = structure === 'ordinary' ? decompositions[0]!.map(id =>
      [...candidates.find(candidate => candidate.id === id)!.cardIds]) :
      [...byRank].sort(([a], [b]) => a - b).flatMap(([, cards]) => {
        const ids = cards.map(card => card.id).sort();
        return ids.length === 4 ? [ids.slice(0, 2), ids.slice(2)] : [ids];
      });
    alternatives.push({ version: XINJIN_INDEPENDENT_VERSION, status: 'winning', structure, items, totalFan, cappedFan,
      scoreUnits: (rules.chengFan === 1 ? 2n ** BigInt(cappedFan) : 1n + BigInt(cappedFan)).toString(), redPoints, blackPoints, concealedGroups });
  }
  alternatives.sort((a, b) => b.cappedFan - a.cappedFan || b.totalFan - a.totalFan || a.structure.localeCompare(b.structure));
  return alternatives[0] ?? fail('minimum-fan');
}

/**
 * v2：门槛 4 人红 20、3 人和 2 人红 25；只有全黑、黑五十、暗四对不看门槛（全红、天走、接地也要够，DEC-20261102-胡牌门槛）；跟头翻不封顶（DEC-20261102-不封顶）。
 * 牌型两种：四组（暗手只按两张凑 14 拆）；暗四对（一组没亮，8 张是四个同点对子，四张同点算一个龙）。两种都成立取番大的。
 */
function evaluateV2(hand: XinjinHand, context: XinjinWinContext, rules: Readonly<Record<string, unknown>>, ordinary: PhysicalCard[],
  redPoints: number, blackPoints: number, fail: (reason: 'shape' | 'points') => XinjinWin): XinjinWin {
  // 手里的三张、四张要先偷出来才算，暗手只按两张凑 14 拆。
  const candidates = ordinaryMeldCandidates(hand.concealed, ['chi']);
  const decompositions = decomposeCards(hand.concealed.map(card => card.id), candidates, 4 - hand.melds.length);
  const byRank = new Map<number, PhysicalCard[]>();
  for (const card of hand.concealed) byRank.set(ordinaryRank(card.code), [...(byRank.get(ordinaryRank(card.code)) ?? []), card]);
  const fourPairs = hand.melds.length === 0 && [...byRank.values()].every(cards => cards.length % 2 === 0);
  // 大吊车（金钩钓）：亮满三组碰、偷、杠、巴（吃的不算），手里单吊一张、胡同点数的那张（颜色不管，吊 7 胡 7 也算）；
  // 胡凑 14 的那张只是普通胡（DEC-20261102-大吊车要吊同点）。
  const daDiao = hand.melds.length === 3 && hand.melds.every(meld => meld.kind !== 'chi') && hand.concealed.length === 2 &&
    hand.concealed.every(card => !special(card.code)) && ordinaryRank(hand.concealed[0]!.code) === ordinaryRank(hand.concealed[1]!.code);
  if (!decompositions.length && !fourPairs && !daDiao) return fail('shape');
  const quanHong = ordinary.length > 0 && ordinary.every(card => red(card.code));
  const quanHei = ordinary.length > 0 && ordinary.every(card => !red(card.code));
  const tianHu = context.source === 'original-hand';
  const diHu = context.source === 'discard' && context.discardCount === 1;
  // 红点不够时只剩暗四对这种牌型能胡（全黑、黑五十两种都行）。
  // 红五十、黑五十要正好 50，过了照常胡、不算五十（DEC-20261102-五十要正好）；黑 52 不算黑五十，要看门槛。
  const belowGate = redPoints < xinjinRedGate(rules.playerNum) && !quanHei && blackPoints !== 50;
  if (belowGate && !fourPairs) return fail('points');
  const alternatives: Extract<XinjinWin, { status: 'winning' }>[] = [];
  for (const structure of ['ordinary', 'four-pairs'] as const) {
    if (structure === 'ordinary' ? !decompositions.length && !daDiao || belowGate : !fourPairs) continue;
    const items: XinjinWinItem[] = [];
    const add = (pattern: keyof typeof XINJIN_V2_FANS, count = 1) => {
      if (count) items.push({ pattern, count, fan: XINJIN_V2_FANS[pattern] * count });
    };
    add('gui', hand.bonus.filter(card => special(card.code)).length);
    add('peng', hand.melds.filter(meld => meld.kind === 'peng' || meld.kind === 'tou').length);
    add('gang', hand.melds.filter(meld => meld.kind === 'gang' || meld.kind === 'ba').length);
    if (context.baoJiao === true) add('baoJiao');
    if (tianHu) add('tianHu');
    if (diHu) add('diHu');
    if (redPoints === 20) add('qia20');
    if (quanHong) add('quanHong');
    if (quanHei) add('quanHei');
    if (redPoints === 50) add('hong50');
    if (blackPoints === 50) add('hei50');
    if (daDiao) add('jinGouDiao');
    if (structure === 'four-pairs') {
      add('anDui');
      add('longDui', [...byRank.values()].filter(cards => cards.length === 4).length);
    }
    const totalFan = items.reduce((sum, item) => sum + item.fan, 0);
    const cappedFan = totalFan;
    const concealedGroups = structure === 'ordinary' ? !decompositions.length ? [hand.concealed.map(card => card.id).sort()] :
      decompositions[0]!.map(id => [...candidates.find(candidate => candidate.id === id)!.cardIds]) :
      [...byRank].sort(([a], [b]) => a - b).flatMap(([, cards]) => {
        const ids = cards.map(card => card.id).sort();
        return ids.length === 4 ? [ids.slice(0, 2), ids.slice(2)] : [ids];
      });
    alternatives.push({ version: XINJIN_INDEPENDENT_VERSION, status: 'winning', structure, items, totalFan, cappedFan,
      scoreUnits: (2n ** BigInt(cappedFan)).toString(), redPoints, blackPoints, concealedGroups });
  }
  alternatives.sort((a, b) => b.cappedFan - a.cappedFan || b.totalFan - a.totalFan || a.structure.localeCompare(b.structure));
  return alternatives[0]!;
}
