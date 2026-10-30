import { ANYUE_INDEPENDENT_FANS, ANYUE_INDEPENDENT_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { PhysicalCard } from './cards.js';
import { decomposeCards } from './combinations.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { anyuePackSpecification } from './anyue-pack.js';

export interface AnyueMeld { kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou'; cards: PhysicalCard[] }
export interface AnyueHand { concealed: PhysicalCard[]; melds: AnyueMeld[]; bonus: PhysicalCard[] }
export interface AnyueWinContext {
  winnerSeat: number; dealerSeat: number;
  source: 'original-hand' | 'discard' | 'flip' | 'replacement';
  sourceSeat: number | null; incomingCardId: string | null; discardCount: number;
  piaoWinner: number; piaoPayer: number;
}
export interface AnyueWinItem { pattern: keyof typeof ANYUE_INDEPENDENT_FANS; count: number; fan: number }
export type AnyueWin =
  | { version: typeof ANYUE_INDEPENDENT_VERSION; status: 'not-winning'; reason: 'special-card-in-hand' | 'shape' | 'points' | 'minimum-fan';
    redPoints: number; blackPoints: number }
  | { version: typeof ANYUE_INDEPENDENT_VERSION; status: 'winning'; structure: 'ordinary' | 'four-pairs'; items: AnyueWinItem[];
    totalFan: number; cappedFan: number; unitBase: number; scoreUnits: string;
    redPoints: number; blackPoints: number; concealedGroups: string[][] };

const special = (code: number) => [1001, 1002, 1003].includes(code);
const enabled = (value: unknown) => value === 1 || value === true;
const red = (code: number) => [1, 3].includes(Math.floor(code / 100));
const point = (code: number) => { const rank = ordinaryRank(code); return rank >= 11 ? 1 : rank; };
const seat = (value: number | null): value is number => Number.isInteger(value) && value! >= 1 && value! <= 4;

function validate(hand: AnyueHand, context: AnyueWinContext, rules: Readonly<Record<string, unknown>>) {
  const metadata = rules.anyue as Record<string, unknown> | undefined;
  requireCondition(metadata?.rulesVersion === ANYUE_INDEPENDENT_VERSION, 'ANYUE_RULES_VERSION_REQUIRED',
    'Only the explicitly frozen independent Anyue version can evaluate this hand.', 409);
  requireCondition(hand != null && Array.isArray(hand.concealed) && Array.isArray(hand.melds) && Array.isArray(hand.bonus) &&
    hand.melds.length <= 3 && hand.melds.every(meld => ['chi', 'peng', 'gang', 'ba', 'tou'].includes(meld.kind)),
  'INVALID_ANYUE_HAND', 'Expected bounded concealed, meld and bonus arrays.', 500);
  const cards = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus];
  const capacity = new Map(anyuePackSpecification(rules.wangNum as number).map(entry => [entry.code, entry.count]));
  const ids = new Set<string>();
  for (const card of cards) {
    requireCondition(card != null && typeof card.id === 'string' && !ids.has(card.id) && (capacity.get(card.code) ?? 0) > 0,
      'INVALID_ANYUE_HAND', 'Cards must have unique identities and fit the frozen pack.', 500);
    ids.add(card.id); capacity.set(card.code, capacity.get(card.code)! - 1);
  }
  requireCondition(hand.bonus.every(card => special(card.code) ||
    enabled(rules.qiToWang) && ordinaryRank(card.code) === 7),
  'INVALID_ANYUE_HAND', 'Only stolen kings (and enabled sevens) belong in the bonus zone.', 500);
  requireCondition(context != null && seat(context.winnerSeat) && seat(context.dealerSeat) &&
    ['original-hand', 'discard', 'flip', 'replacement'].includes(context.source) &&
    Number.isSafeInteger(context.discardCount) && [0, 1].includes(context.piaoWinner) && [0, 1].includes(context.piaoPayer),
  'INVALID_RULE_FACTS', 'The server must supply valid Anyue turn and piao facts.', 500);
  if (context.source === 'original-hand') requireCondition(context.incomingCardId === null && context.sourceSeat === null &&
    context.winnerSeat === context.dealerSeat && context.discardCount === 0,
  'INVALID_RULE_FACTS', 'An original-hand win must precede every action.', 500);
  else requireCondition(seat(context.sourceSeat) && typeof context.incomingCardId === 'string' &&
    hand.concealed.some(card => card.id === context.incomingCardId), 'INVALID_RULE_FACTS',
    'The winning source must identify an incoming physical card.', 500);
}

export function evaluateAnyueWin(hand: AnyueHand, context: AnyueWinContext, rules: Readonly<Record<string, unknown>>): AnyueWin {
  validate(hand, context, rules);
  const expectedConcealed = (4 - hand.melds.length) * 2;
  requireCondition(hand.concealed.length === expectedConcealed, 'INVALID_ANYUE_HAND',
    'Anyue concealed cards must complete the remaining groups.', 500);
  const ordinary = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards)].filter(card => !special(card.code) &&
    !(enabled(rules.qiToWang) && ordinaryRank(card.code) === 7));
  const redPoints = ordinary.filter(card => red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const blackPoints = ordinary.filter(card => !red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const fail = (reason: Extract<AnyueWin, { status: 'not-winning' }>['reason']): AnyueWin =>
    ({ version: ANYUE_INDEPENDENT_VERSION, status: 'not-winning', reason, redPoints, blackPoints });
  if (hand.concealed.some(card => special(card.code))) return fail('special-card-in-hand');
  const candidates = ordinaryMeldCandidates(hand.concealed, ['chi']);
  const decompositions = decomposeCards(hand.concealed.map(card => card.id), candidates, 4 - hand.melds.length);
  const byRank = new Map<number, PhysicalCard[]>();
  for (const card of hand.concealed) byRank.set(ordinaryRank(card.code), [...(byRank.get(ordinaryRank(card.code)) ?? []), card]);
  const fourPairs = enabled(rules.anDui) && hand.melds.length === 0 && [...byRank.values()].every(cards => cards.length % 2 === 0);
  if (!decompositions.length && !fourPairs) return fail('shape');
  if (ordinary.length === 0) return fail('points');
  const allRed = ordinary.every(card => red(card.code));
  const allBlack = ordinary.every(card => !red(card.code));
  const specialWaiver = enabled(rules.quanHongHei) && (allRed || allBlack);
  if (redPoints < 20 && !specialWaiver) return fail('points');
  const alternatives: Extract<AnyueWin, { status: 'winning' }>[] = [];
  for (const structure of ['ordinary', 'four-pairs'] as const) {
    if (structure === 'ordinary' ? !decompositions.length : !fourPairs) continue;
    const items: AnyueWinItem[] = [];
    const add = (pattern: keyof typeof ANYUE_INDEPENDENT_FANS, count = 1) => {
      if (count) items.push({ pattern, count, fan: ANYUE_INDEPENDENT_FANS[pattern] * count });
    };
    add('bonus', hand.bonus.length);
    if (structure === 'four-pairs') add('anDui');
    if (enabled(rules.quanHongHei) && allRed) add('quanHongHei');
    else if (enabled(rules.quanHongHei) && allBlack) add('quanHongHei');
    if (enabled(rules.zhuangJiadi) && (context.winnerSeat === context.dealerSeat || context.sourceSeat === context.dealerSeat)) {
      add('zhuangJiadi');
    }
    if (enabled(rules.cheLong) && hand.bonus.length >= 2) add('cheLong');
    const totalFan = items.reduce((sum, item) => sum + item.fan, 0);
    if (totalFan === 0) continue;
    const cappedFan = rules.maxFan === 99 ? totalFan : Math.min(rules.maxFan as number, totalFan);
    const unitBase = 1 + context.piaoWinner + context.piaoPayer;
    const scoreUnits = (rules.chengFan === 1
      ? BigInt(unitBase) * (2n ** BigInt(cappedFan))
      : BigInt(unitBase + cappedFan)).toString();
    const concealedGroups = structure === 'ordinary' ? decompositions[0]!.map(id =>
      [...candidates.find(candidate => candidate.id === id)!.cardIds]) :
      [...byRank].sort(([a], [b]) => a - b).flatMap(([, cards]) => {
        const ids = cards.map(card => card.id).sort();
        return ids.length === 4 ? [ids.slice(0, 2), ids.slice(2)] : [ids];
      });
    alternatives.push({ version: ANYUE_INDEPENDENT_VERSION, status: 'winning', structure, items, totalFan, cappedFan,
      unitBase, scoreUnits, redPoints, blackPoints, concealedGroups });
  }
  alternatives.sort((a, b) => b.cappedFan - a.cappedFan || b.totalFan - a.totalFan || a.structure.localeCompare(b.structure));
  return alternatives[0] ?? fail('minimum-fan');
}
