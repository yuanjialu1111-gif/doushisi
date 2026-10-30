import { ABA_INDEPENDENT_FANS, ABA_INDEPENDENT_VERSIONS, ABA_RED_SCORES } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { PhysicalCard } from './cards.js';
import { decomposeCards } from './combinations.js';
import { ordinaryMeldCandidates, ordinaryRank } from './ordinary-melds.js';
import { abaPackSpecification } from './aba-pack.js';

export interface AbaMeld { kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou'; cards: PhysicalCard[] }
export interface AbaHand { concealed: PhysicalCard[]; melds: AbaMeld[]; bonus: PhysicalCard[] }
export interface AbaWildcardUse { cardId: string; code: number }
export type AbaWinSource = 'original-hand' | 'discard' | 'flip' | 'replacement' | 'white';
export interface AbaWinContext {
  winnerSeat: number; dealerSeat: number;
  source: AbaWinSource;
  sourceSeat: number | null; incomingCardId: string | null; discardCount: number;
  baoJiao?: boolean; deckEmpty?: boolean; wildcards?: AbaWildcardUse[];
}
export type AbaVersion = typeof ABA_INDEPENDENT_VERSIONS[keyof typeof ABA_INDEPENDENT_VERSIONS];
export interface AbaWinItem { pattern: string; count: number; fan: number }
export type AbaWin =
  | { version: AbaVersion; status: 'not-winning';
    reason: 'special-card-in-hand' | 'shape' | 'red-score' | 'minimum-fan' | 'invalid-wildcard-use';
    redScore: number; structureScore: number; redPoints: number; blackPoints: number; wildcardCount: number }
  | { version: AbaVersion; status: 'winning'; structure: 'ordinary' | 'four-pairs';
    items: AbaWinItem[]; totalFan: number; cappedFan: number;
    redScore: number; structureScore: number; redPoints: number; blackPoints: number;
    scoreUnits: string; scoreRatio: { numerator: string; denominator: string }; concealedGroups: string[][];
    wildcardUses: AbaWildcardUse[] };

const special = (code: number) => [1001, 1002, 1003].includes(code);
const enabled = (value: unknown) => value === 1 || value === true;
const red = (code: number) => [1, 3].includes(Math.floor(code / 100));
const point = (code: number) => { const rank = ordinaryRank(code); return rank >= 11 ? 1 : rank; };
const seat = (value: number | null): value is number => Number.isInteger(value) && value! >= 1 && value! <= 4;
const isWhite = (card: PhysicalCard) => card.code === 1003;

type StructureKind = 'ordinary' | 'four-pairs';
interface StructureResult {
  structure: StructureKind;
  concealedGroups: string[][];
  wildcardUses: AbaWildcardUse[];
}

interface WildcardUse extends AbaWildcardUse { }

function declaredWildcards(hand: AbaHand, context: AbaWinContext): WildcardUse[] {
  const declared = context.wildcards ?? [];
  requireCondition(Array.isArray(declared) && declared.every(use => use != null &&
    typeof use.cardId === 'string' && use.cardId.length > 0 && use.code === 1003),
  'INVALID_ABA_HAND', 'White-face uses must identify physical white faces.', 500);
  const handIds = new Set([...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus].map(card => card.id));
  const ids = new Set<string>();
  return declared.map(use => {
    requireCondition(!handIds.has(use.cardId) && !ids.has(use.cardId), 'INVALID_ABA_HAND',
      'An external white face must be distinct from every physical hand card and used at most once.', 500);
    ids.add(use.cardId);
    return { cardId: use.cardId, code: 1003 };
  }).sort((left, right) => left.cardId.localeCompare(right.cardId));
}

function validateMeld(meld: AbaMeld, externalWhite: boolean) {
  const white = meld.cards.filter(isWhite).length;
  const kings = meld.cards.filter(card => card.code === 1001 || card.code === 1002).length;
  requireCondition(kings === 0, 'INVALID_ABA_HAND', 'Kings never substitute into exposed combinations.', 500);
  requireCondition(white === 0 || externalWhite && white === 1, 'INVALID_ABA_HAND',
    'Only external-white modes may substitute one white face in an exposed combination.', 500);
  const ordinary = meld.cards.filter(card => !special(card.code));
  const ranks = ordinary.map(card => ordinaryRank(card.code));
  const length = meld.kind === 'chi' ? 2 : ['peng', 'tou'].includes(meld.kind) ? 3 : 4;
  requireCondition(meld.cards.length === length, 'INVALID_ABA_HAND',
    'The exposed combination does not match its declared length.', 500);
  if (meld.kind === 'chi') {
    requireCondition(white === 1 && ordinary.length === 1 || ordinary.length === 2 && ranks[0]! + ranks[1]! === 14,
      'INVALID_ABA_HAND', 'A chi must be two faces summing to fourteen.', 500);
  } else {
    requireCondition(ranks.length === length - white && new Set(ranks).size === 1, 'INVALID_ABA_HAND',
      'A peng, gang, touch or ba must use one ordinary rank.', 500);
  }
}

function validate(hand: AbaHand, context: AbaWinContext, rules: Readonly<Record<string, unknown>>,
  variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS) {
  const metadata = rules.aba as Record<string, unknown> | undefined;
  requireCondition(metadata?.rulesVersion === ABA_INDEPENDENT_VERSIONS[variantKey], 'ABA_RULES_VERSION_REQUIRED',
    'Only the explicitly frozen independent Aba version can evaluate this hand.', 409);
  requireCondition(ABA_RED_SCORES.includes(rules.huRedScore as number) &&
    [1, 2, 3].includes(rules.baojiaoCondition as number) && [1, 2, 3].includes(rules.baipiType as number) &&
    [2, 3, 4, 99].includes(rules.maxFan as number),
  'INVALID_ROOM_OPTIONS', 'Aba room options must be explicit.', 500);
  requireCondition(variantKey === '11:0' || rules.baipiType === 1, 'INVALID_ROOM_OPTIONS',
    'External white-face modes are implemented and evidenced only for 11:0.', 500);
  requireCondition(hand != null && Array.isArray(hand.concealed) && Array.isArray(hand.melds) && Array.isArray(hand.bonus) &&
    hand.melds.length <= 3 && hand.melds.every(meld => meld != null && ['chi', 'peng', 'gang', 'ba', 'tou'].includes(meld.kind)),
  'INVALID_ABA_HAND', 'Expected bounded concealed, meld and bonus arrays.', 500);

  const wildcards = declaredWildcards(hand, context);
  const cards = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus,
    ...wildcards.map(use => ({ id: use.cardId, code: use.code }))];
  const capacity = new Map(abaPackSpecification().map(entry => [entry.code, entry.count]));
  const ids = new Set<string>();
  for (const card of cards) {
    requireCondition(card != null && typeof card.id === 'string' && card.id.length > 0 && !ids.has(card.id) &&
      (capacity.get(card.code) ?? 0) > 0, 'INVALID_ABA_HAND',
    'Cards must have unique identities and fit the frozen pack.', 500);
    ids.add(card.id); capacity.set(card.code, capacity.get(card.code)! - 1);
  }
  requireCondition(hand.bonus.every(card => special(card.code) ||
    variantKey === '11:0' && ordinaryRank(card.code) === 7), 'INVALID_ABA_HAND',
  'Only the fixed special faces or forced sevens belong in the Aba bonus zone.', 500);
  const externalWhite = variantKey === '11:0' && (rules.baipiType === 2 || rules.baipiType === 3);
  requireCondition(!externalWhite || hand.bonus.every(card => !isWhite(card)), 'INVALID_ABA_HAND',
    'External white faces never earn direct-hand bonus points.', 500);
  requireCondition(wildcards.length === 0 || externalWhite, 'INVALID_ABA_HAND',
    'Direct-hand white faces cannot be substituted as external wildcards.', 500);
  for (const meld of hand.melds) validateMeld(meld, externalWhite);

  requireCondition(context != null && seat(context.winnerSeat) && seat(context.dealerSeat) &&
    ['original-hand', 'discard', 'flip', 'replacement', 'white'].includes(context.source) &&
    Number.isSafeInteger(context.discardCount),
  'INVALID_RULE_FACTS', 'The server must supply valid Aba turn facts.', 500);
  if (context.source === 'original-hand') {
    requireCondition(context.incomingCardId === null && context.sourceSeat === null &&
      context.winnerSeat === context.dealerSeat && context.discardCount === 0 && wildcards.length === 0,
    'INVALID_RULE_FACTS', 'An original-hand win must precede every action and external white use.', 500);
  } else if (context.source === 'white') {
    requireCondition(seat(context.sourceSeat) && typeof context.incomingCardId === 'string' &&
      wildcards.some(use => use.cardId === context.incomingCardId),
    'INVALID_RULE_FACTS', 'A white-face winning source must identify one declared external white.', 500);
    requireCondition(rules.baipiType !== 2 || context.sourceSeat === context.winnerSeat, 'INVALID_RULE_FACTS',
      'Owner-only white faces cannot be used by another seat.', 500);
  } else {
    requireCondition(wildcards.length === 0, 'INVALID_RULE_FACTS',
      'An external white substitution must have a white response source.', 500);
    requireCondition(seat(context.sourceSeat) &&
      (context.source === 'discard' || context.source === 'flip'
        ? context.incomingCardId === null || typeof context.incomingCardId === 'string'
        : typeof context.incomingCardId === 'string'),
    'INVALID_RULE_FACTS',
    'The winning source must identify an incoming physical card.', 500);
  }
}

function groupStructurePoints(groups: readonly (readonly string[])[], cardsById: ReadonlyMap<string, PhysicalCard>) {
  const score = (card: PhysicalCard) => red(card.code) ? point(card.code) : 0;
  let total = 0;
  for (const group of groups) {
    const cards = group.map(id => cardsById.get(id)).filter((card): card is PhysicalCard => card !== undefined);
    requireCondition(cards.length === group.length, 'INVALID_ABA_HAND',
      'Every concealed group card must exist in the evaluated hand.', 500);
    total += cards.filter(card => !special(card.code)).reduce((sum, card) => sum + score(card), 0) * 10;
  }
  return total;
}

function meldStructurePoints(melds: readonly AbaMeld[]) {
  const score = (card: PhysicalCard) => red(card.code) ? point(card.code) : 0;
  let total = 0;
  for (const meld of melds) {
    const cardsInMeld = meld.cards.filter(card => !special(card.code));
    const meldPoints = cardsInMeld.reduce((sum, card) => sum + score(card), 0);
    if (meld.kind === 'chi') total += meldPoints * 10;
    else if (['peng', 'tou'].includes(meld.kind)) total += meldPoints * 10;
    else total += meldPoints * 15;
  }
  return total;
}

function combinations<T>(items: readonly T[], count: number): T[][] {
  if (count < 0 || count > items.length) return [];
  if (count === 0) return [[]];
  const result: T[][] = [];
  function choose(start: number, selected: T[]) {
    if (selected.length === count) { result.push([...selected]); return; }
    for (let index = start; index <= items.length - (count - selected.length); index++) {
      selected.push(items[index]!); choose(index + 1, selected); selected.pop();
    }
  }
  choose(0, []);
  return result;
}

function wildcardStructure(realCards: readonly PhysicalCard[], wildcards: readonly WildcardUse[],
  requiredGroups: number, structure: StructureKind): StructureResult | null {
  const needed = requiredGroups * 2 - realCards.length;
  if (needed < 0 || needed > wildcards.length || structure === 'four-pairs' && requiredGroups !== 4) return null;
  for (const selectedWhites of combinations(wildcards, needed)) {
    const all = [...realCards, ...selectedWhites.map(use => ({ id: use.cardId, code: use.code }))];
    const index = new Map(all.map((card, offset) => [card.id, offset]));
    const candidates: { id: string; cardIds: string[]; mask: bigint }[] = [];
    const add = (cardIds: string[]) => {
      const sorted = [...cardIds].sort();
      candidates.push({ id: JSON.stringify(sorted), cardIds: sorted,
        mask: sorted.reduce((mask, id) => mask | (1n << BigInt(index.get(id)!)), 0n) });
    };
    if (structure === 'ordinary') {
      for (const candidate of ordinaryMeldCandidates(realCards, ['chi'])) add([...candidate.cardIds]);
    } else {
      for (let left = 0; left < realCards.length; left++) for (let right = left + 1; right < realCards.length; right++) {
        if (ordinaryRank(realCards[left]!.code) === ordinaryRank(realCards[right]!.code)) {
          add([realCards[left]!.id, realCards[right]!.id]);
        }
      }
    }
    for (const real of realCards) for (const white of selectedWhites) add([real.id, white.cardId]);
    const allMask = (1n << BigInt(all.length)) - 1n;
    let result: string[][] | null = null;
    const search = (remaining: bigint, chosen: string[][]) => {
      if (result) return;
      if (remaining === 0n) {
        if (chosen.length === requiredGroups) result = chosen;
        return;
      }
      if (chosen.length >= requiredGroups) return;
      let first = 0n;
      while (first < BigInt(all.length) && (remaining & (1n << first)) === 0n) first++;
      const firstMask = 1n << first;
      for (const candidate of candidates) {
        if ((candidate.mask & firstMask) === 0n || (candidate.mask & remaining) !== candidate.mask) continue;
        search(remaining ^ candidate.mask, [...chosen, [...candidate.cardIds]]);
        if (result) return;
      }
    };
    search(allMask, []);
    if (result) return { structure, concealedGroups: result, wildcardUses: [...selectedWhites] };
  }
  return null;
}

function winningAlternatives(hand: AbaHand, context: AbaWinContext, rules: Readonly<Record<string, unknown>>,
  variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS,
  wildcards: readonly WildcardUse[], redPoints: number, blackPoints: number, bonusScore: number): Extract<AbaWin, { status: 'winning' }>[] {
  const structures: StructureResult[] = [];
  const concealedReal = hand.concealed.filter(card => !special(card.code));
  const requiredGroups = 4 - hand.melds.length;
  requireCondition(concealedReal.length + wildcards.length === requiredGroups * 2, 'INVALID_ABA_HAND',
    'Aba concealed cards and declared white substitutions must complete the remaining groups.', 500);
  for (const structure of ['ordinary', 'four-pairs'] as const) {
    const found = wildcardStructure(concealedReal, wildcards, requiredGroups, structure);
    if (found) structures.push(found);
  }
  const byRank = new Map<number, PhysicalCard[]>();
  const ordinary = [...concealedReal, ...hand.melds.flatMap(meld => meld.cards)].filter(card => !special(card.code));
  for (const card of ordinary) {
    const rank = ordinaryRank(card.code);
    byRank.set(rank, [...(byRank.get(rank) ?? []), card]);
  }
  const cardsById = new Map([...hand.concealed, ...hand.melds.flatMap(meld => meld.cards), ...hand.bonus,
    ...wildcards.map(use => ({ id: use.cardId, code: use.code }))].map(card => [card.id, card]));
  const alternatives: Extract<AbaWin, { status: 'winning' }>[] = [];
  for (const structure of structures) {
    const structureScore = groupStructurePoints(structure.concealedGroups, cardsById) + meldStructurePoints(hand.melds) + bonusScore;
    if (structureScore < (rules.huRedScore as number)) continue;
    const items: AbaWinItem[] = [];
    const add = (pattern: string, fan = 1, count = 1) => { if (count) items.push({ pattern, count, fan: fan * count }); };
    if (context.baoJiao) add('baoJiao');
    if (enabled(rules.diHu) && context.source === 'discard' && context.discardCount === 1 &&
      context.sourceSeat === context.dealerSeat) add('diHu');
    if (enabled(rules.haiDiLao) && context.source === 'flip' && context.deckEmpty) add('haiDiLao');
    if (enabled(rules.cheLong) && ['flip', 'replacement', 'white'].includes(context.source) &&
      context.sourceSeat === context.winnerSeat) add('cheLong');
    if (enabled(rules.jiaFan_258)) {
      const pengs = hand.melds.filter(meld => ['peng', 'tou'].includes(meld.kind) &&
        [2, 5, 8].includes(ordinaryRank(meld.cards.find(card => !special(card.code))!.code))).length;
      const gangs = hand.melds.filter(meld => ['gang', 'ba'].includes(meld.kind) &&
        [2, 5, 8].includes(ordinaryRank(meld.cards.find(card => !special(card.code))!.code))).length;
      add('jiaFan258Peng', ABA_INDEPENDENT_FANS.jiaFan258Peng, pengs);
      add('jiaFan258Gang', ABA_INDEPENDENT_FANS.jiaFan258Gang, gangs);
    }
    if (enabled(rules.doubleInOut)) {
      const hasDoubleKing = hand.bonus.length >= 2;
      // byRank already contains exposed ordinary cards; do not count them twice or rank a white.
      const hasFourSevens = (byRank.get(7) ?? []).length >= 4;
      if (hasDoubleKing || hasFourSevens) add('doubleInOut');
    }
    const totalFan = items.reduce((sum, item) => sum + item.fan, 0);
    const cappedFan = rules.maxFan === 99 ? totalFan : Math.min(rules.maxFan as number, totalFan);
    const scoreNumerator = BigInt(structureScore) * (2n ** BigInt(cappedFan)) * 8n;
    const scoreDenominator = 1000n;
    alternatives.push({ version: ABA_INDEPENDENT_VERSIONS[variantKey], status: 'winning',
      structure: structure.structure, items, totalFan, cappedFan, redScore: redPoints * 10, structureScore, redPoints, blackPoints,
      scoreUnits: (scoreNumerator / scoreDenominator).toString(),
      scoreRatio: { numerator: scoreNumerator.toString(), denominator: scoreDenominator.toString() },
      concealedGroups: structure.concealedGroups.map(group => [...group]), wildcardUses: [...structure.wildcardUses] });
  }
  return alternatives;
}

export function evaluateAbaWin(hand: AbaHand, context: AbaWinContext,
  rules: Readonly<Record<string, unknown>>, variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS = '9:0'): AbaWin {
  validate(hand, context, rules, variantKey);
  const wildcards = declaredWildcards(hand, context);
  const ordinary = [...hand.concealed, ...hand.melds.flatMap(meld => meld.cards)].filter(card => !special(card.code));
  const redPoints = ordinary.filter(card => red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const blackPoints = ordinary.filter(card => !red(card.code)).reduce((sum, card) => sum + point(card.code), 0);
  const bonusScore = hand.bonus.length * 100;
  const fail = (reason: Extract<AbaWin, { status: 'not-winning' }>['reason'], structureScore = 0): AbaWin =>
    ({ version: ABA_INDEPENDENT_VERSIONS[variantKey], status: 'not-winning', reason, redScore: redPoints * 10,
      structureScore, redPoints, blackPoints, wildcardCount: wildcards.length });
  if (hand.concealed.some(card => special(card.code)))
    return fail('special-card-in-hand');
  const alternatives = winningAlternatives(hand, context, rules, variantKey, wildcards, redPoints, blackPoints, bonusScore);
  if (!alternatives.length) return fail('shape', 0);
  alternatives.sort((left, right) => right.cappedFan - left.cappedFan || right.structureScore - left.structureScore ||
    left.structure.localeCompare(right.structure));
  return alternatives[0]!;
}
