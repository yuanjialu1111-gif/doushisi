import { YAAN_INDEPENDENT_VERSION, YAAN_SCORING_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { scoreYaan, type YaanScoringFacts } from '../yaan-scoring.js';
import type { PhysicalCard } from './cards.js';
import { decomposeCards } from './combinations.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { yaanPackSpecification } from './yaan-pack.js';

export interface YaanMeld { kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou'; cards: PhysicalCard[] }
export interface YaanHand { concealed: PhysicalCard[]; melds: YaanMeld[]; bonus: PhysicalCard[] }
export interface YaanWinContext {
  winnerSeat: number;
  dealerSeat: number;
  source: 'original-hand' | 'discard' | 'flip' | 'replacement';
  sourceSeat: number | null;
  incomingCardId: string | null;
  discardCount: number;
  baoJiao?: boolean;
  afterGang?: boolean;
}
export interface YaanWinFacts extends YaanScoringFacts {
  concealedGroups: string[][];
  usedWildcards: number;
  wildcardUses: { cardId: string; code: number }[];
}
interface YaanStructure {
  kind: 'ordinary' | 'four-pairs';
  concealedGroups: string[][];
  usedWildcards: number;
  wildcardUses: { cardId: string; code: number }[];
  concealedFourPairs: { dragons: number } | null;
}
export type YaanWin =
  | { version: typeof YAAN_INDEPENDENT_VERSION; status: 'not-winning'; reason: 'shape' | 'points' | 'scoring-unresolved'; redPoints: number; blackPoints: number; missingRules?: string[] }
  | { version: typeof YAAN_INDEPENDENT_VERSION; status: 'winning'; redPoints: number; blackPoints: number; facts: YaanWinFacts;
    scoring: ReturnType<typeof scoreYaan> };

const special = (code: number) => [1001, 1002, 1003].includes(code);
const red = (code: number) => [1, 3].includes(Math.floor(code / 100));
const point = (code: number) => { const rank = ordinaryRank(code); return rank >= 11 ? 1 : rank; };
const seat = (value: number | null): value is number => Number.isInteger(value) && value! >= 1 && value! <= 4;
const whole = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** A wildcard substitute is a synthetic ordinary card; it never contributes red/black points. */
function wildcardFaces(rules: Readonly<Record<string, unknown>>) {
  const qiWangNum = rules.qiWangNum as number;
  const wildSeven = [4, 6, 8, 12].includes(qiWangNum);
  return { wildSeven, maxWildcards: (rules.wangNum as number) + (wildSeven ? qiWangNum : 0) };
}

function isWild(card: PhysicalCard, rules: Readonly<Record<string, unknown>>) {
  const { wildSeven } = wildcardFaces(rules);
  return special(card.code) || wildSeven && ordinaryRank(card.code) === 7;
}

/** Synthetic substitute face used only for audit evidence; it is never a physical card. */
function substituteCode(real: PhysicalCard, targetRank: number): number {
  requireCondition(targetRank >= 1 && targetRank <= 13, 'INVALID_YAAN_HAND',
    'A wildcard substitute must resolve to an ordinary face.', 500);
  return Math.floor(real.code / 100) * 100 + targetRank;
}

function validate(hand: YaanHand, context: YaanWinContext, rules: Readonly<Record<string, unknown>>) {
  const metadata = rules.yaan as Record<string, unknown> | undefined;
  requireCondition(metadata?.rulesVersion === YAAN_INDEPENDENT_VERSION, 'YAAN_RULES_VERSION_REQUIRED',
    'Only the explicitly frozen independent Yaan version can evaluate this hand.', 409);
  requireCondition(hand != null && Array.isArray(hand.concealed) && Array.isArray(hand.melds) &&
    Array.isArray(hand.bonus) && hand.concealed.length <= 8 && hand.melds.length <= 3 &&
    hand.melds.every(meld => meld != null && Array.isArray(meld.cards) &&
      ['chi', 'peng', 'gang', 'ba', 'tou'].includes(meld.kind)),
  'INVALID_YAAN_HAND', 'Expected bounded concealed, meld and bonus arrays.', 500);
  const expectedConcealed = (4 - hand.melds.length) * 2;
  requireCondition(hand.concealed.length === expectedConcealed, 'INVALID_YAAN_HAND',
    'Yaan concealed cards must complete the remaining four groups.', 500);
  const cards = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus];
  const capacity = new Map(yaanPackSpecification(rules.wangNum as number, rules.qiWangNum as number).map(entry => [entry.code, entry.count]));
  const ids = new Set<string>();
  for (const card of cards) {
    requireCondition(card != null && typeof card.id === 'string' && card.id.length > 0 && !ids.has(card.id) &&
      (capacity.get(card.code) ?? 0) > 0, 'INVALID_YAAN_HAND',
    'Cards must have unique identities and fit the frozen physical pack.', 500);
    ids.add(card.id); capacity.set(card.code, capacity.get(card.code)! - 1);
  }
  for (const meld of hand.melds) {
    const ranks = meld.cards.map(card => ordinaryRank(card.code));
    const length = meld.kind === 'chi' ? 2 : ['peng', 'tou'].includes(meld.kind) ? 3 : 4;
    requireCondition(ranks.length === length && (meld.kind === 'chi'
      ? ranks[0]! + ranks[1]! === 14 : new Set(ranks).size === 1),
    'INVALID_YAAN_HAND', 'The exposed combination does not match its declared structure.', 500);
  }
  requireCondition(context != null && seat(context.winnerSeat) && seat(context.dealerSeat) &&
    ['original-hand', 'discard', 'flip', 'replacement'].includes(context.source) && whole(context.discardCount),
  'INVALID_RULE_FACTS', 'The server must supply valid Yaan turn facts.', 500);
  if (context.source === 'original-hand') requireCondition(context.incomingCardId === null && context.sourceSeat === null &&
    context.winnerSeat === context.dealerSeat && context.discardCount === 0 && hand.bonus.length === 0,
  'INVALID_RULE_FACTS', 'An original-hand win must precede every action.', 500);
  else requireCondition(seat(context.sourceSeat) && typeof context.incomingCardId === 'string' &&
    hand.concealed.some(card => card.id === context.incomingCardId), 'INVALID_RULE_FACTS',
    'The winning source must identify an incoming physical card.', 500);
}

/**
 * Server-only structural evaluation with explicit wildcard substitution.
 * Wildcards are enumerated against the regional pack; substituted faces are
 * synthetic and never counted as real red/black points.
 */
export function evaluateYaanWin(
  hand: YaanHand, context: YaanWinContext, rules: Readonly<Record<string, unknown>>,
): YaanWin {
  validate(hand, context, rules);
  const expectedConcealed = (4 - hand.melds.length) * 2;
  const ordinary = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards)].filter(card => !isWild(card, rules));
  const redPoints = ordinary.filter(card => red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const blackPoints = ordinary.filter(card => !red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const fail = (reason: Extract<YaanWin, { status: 'not-winning' }>['reason'], missingRules?: string[]): YaanWin =>
    ({ version: YAAN_INDEPENDENT_VERSION, status: 'not-winning', reason, redPoints, blackPoints, ...(missingRules ? { missingRules } : {}) });
  const concealedOrdinary = hand.concealed.filter(card => !isWild(card, rules));
  const wilds = hand.concealed.filter(card => isWild(card, rules));
  const goldHook = hand.melds.length === 3 && hand.concealed.length === 2 &&
    hand.melds.every(meld => ['peng', 'gang', 'ba'].includes(meld.kind));
  const groupsNeeded = 4 - hand.melds.length;
  const structures: YaanStructure[] = [];
  if (concealedOrdinary.length + wilds.length === expectedConcealed && groupsNeeded >= 1) {
    const candidates = ordinaryMeldCandidates(concealedOrdinary, ['chi']);
    for (const card of concealedOrdinary) for (const wild of wilds) {
      candidates.push({ id: `wild:${card.id}:${wild.id}`, kind: 'chi', cardIds: [card.id, wild.id] });
    }
    const decompositions = decomposeCards([...concealedOrdinary, ...wilds].map(card => card.id), candidates, groupsNeeded,
      { maxNodes: 20000, maxResults: 256 });
    for (const decomposition of decompositions) {
      const chosen = decomposition.map(id => candidates.find(candidate => candidate.id === id)!);
      const concealedGroups = chosen.map(candidate => [...candidate.cardIds]);
      const wildcardUses = chosen.flatMap(candidate => {
        const wildId = candidate.cardIds.find(cardId => wilds.some(wild => wild.id === cardId));
        if (!wildId) return [];
        const realId = candidate.cardIds.find(cardId => cardId !== wildId)!;
        const real = concealedOrdinary.find(card => card.id === realId)!;
        return [{ cardId: wildId, code: substituteCode(real, 14 - ordinaryRank(real.code)) }];
      });
      structures.push({ kind: 'ordinary', concealedGroups, usedWildcards: wildcardUses.length,
        wildcardUses, concealedFourPairs: null });
    }
  }
  // A four-pairs structure uses four natural same-rank pairs. A wildcard can
  // complete one missing natural card, but two wildcards cannot form a pair.
  if (rules.anDui === 1 && hand.melds.length === 0 && hand.concealed.length === expectedConcealed) {
    const byRank = new Map<number, PhysicalCard[]>();
    for (const card of concealedOrdinary) {
      const rank = ordinaryRank(card.code);
      byRank.set(rank, [...(byRank.get(rank) ?? []), card]);
    }
    const groups: string[][] = [];
    const wildcardUses: { cardId: string; code: number }[] = [];
    let wildIndex = 0, dragons = 0;
    for (const [, cardsInRank] of [...byRank].sort(([a], [b]) => a - b)) {
      if (cardsInRank.length === 4) dragons++;
      const ids = cardsInRank.map(card => card.id).sort();
      while (ids.length >= 2) groups.push(ids.splice(0, 2));
      if (ids.length === 1) {
        if (wildIndex >= wilds.length) { groups.length = 0; break; }
        const real = concealedOrdinary.find(card => card.id === ids[0]!)!;
        const wild = wilds[wildIndex++]!;
        groups.push([ids[0]!, wild.id]);
        wildcardUses.push({ cardId: wild.id, code: substituteCode(real, ordinaryRank(real.code)) });
      }
    }
    if (groups.length === 4 && wildIndex === wilds.length) {
      structures.push({ kind: 'four-pairs', concealedGroups: groups, usedWildcards: wildcardUses.length,
        wildcardUses, concealedFourPairs: { dragons } });
    }
  }
  if (!structures.length) return fail('shape');
  const alternatives = structures.flatMap(structure => {
    const facts: YaanWinFacts = {
      legalWin: true, redPoints, baoJiao: context.baoJiao === true,
      concealedFourPairs: structure.concealedFourPairs,
      red50: redPoints >= 50, black50: blackPoints >= 50,
      gangHua: context.source === 'replacement' && context.sourceSeat === context.winnerSeat && context.afterGang === true,
      gangPao: context.source === 'discard' && context.afterGang === true,
      jinGouDiao: goldHook,
      tianHu: context.source === 'original-hand', diHu: context.source === 'discard' && context.discardCount === 1,
      redHu: ordinary.length > 0 && ordinary.every(card => red(card.code)),
      blackHu: ordinary.length > 0 && ordinary.every(card => !red(card.code)),
      concealedGroups: structure.concealedGroups, usedWildcards: structure.usedWildcards,
      wildcardUses: structure.wildcardUses,
    };
    if (redPoints < 20 && !facts.tianHu && !facts.diHu && !facts.red50 && !facts.black50) return [];
    const scoring = scoreYaan(facts, rules as never);
    return scoring.status === 'scored' ? [{ facts, scoring }] : [];
  });
  alternatives.sort((left, right) =>
    BigInt(right.scoring.scoreUnits) > BigInt(left.scoring.scoreUnits) ? 1 :
      BigInt(right.scoring.scoreUnits) < BigInt(left.scoring.scoreUnits) ? -1 :
        Number(right.facts.concealedFourPairs !== null) - Number(left.facts.concealedFourPairs !== null));
  const best = alternatives[0];
  if (!best) return fail(redPoints < 20 ? 'points' : 'scoring-unresolved');
  return { version: YAAN_INDEPENDENT_VERSION, status: 'winning', redPoints, blackPoints,
    facts: best.facts, scoring: best.scoring };
}
