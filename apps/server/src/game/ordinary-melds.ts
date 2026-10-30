import { requireCondition } from '../errors.js';
import type { PhysicalCard } from './cards.js';
import type { CandidateGroup } from './combinations.js';

export const ORDINARY_MELD_MODEL_VERSION = 'dou14-ordinary-structures-v1';
export type OrdinaryMeldKind = 'chi' | 'peng' | 'gang';
export interface OrdinaryMeld extends CandidateGroup {
  kind: OrdinaryMeldKind;
  cardIds: string[];
}

/** Face rank for grouping, NOT red/black scoring. Specials must be handled regionally. */
export function ordinaryRank(code: number): number {
  const suit = Math.floor(code / 100), rank = code % 100;
  requireCondition(Number.isSafeInteger(code) && suit >= 1 && suit <= 4 && rank >= 1 && rank <= 13,
    'NON_ORDINARY_CARD', 'Ordinary structure matching cannot interpret special or unknown card codes.', 500);
  return rank;
}

function validatedCards(cards: readonly PhysicalCard[]): PhysicalCard[] {
  requireCondition(Array.isArray(cards), 'INVALID_COMBINATION_INPUT', 'Expected physical cards.', 500);
  const ids = new Set<string>();
  for (const card of cards) {
    requireCondition(card != null && typeof card.id === 'string' && card.id.length > 0 && !ids.has(card.id),
      'INVALID_COMBINATION_INPUT', 'Each physical card needs a distinct nonempty ID.', 500);
    ids.add(card.id);
    ordinaryRank(card.code);
  }
  return cards.map(card => ({ ...card })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Source-backed structure candidates only: sum-14 pairs, same-rank triples/quads.
 * The caller explicitly enables kinds and must enforce turn/source/seat, exposure,
 * replacement and regional rules before treating any candidate as an action or win.
 */
export function ordinaryMeldCandidates(
  cards: readonly PhysicalCard[], enabledKinds: readonly OrdinaryMeldKind[], maxCandidates = 4096,
): OrdinaryMeld[] {
  requireCondition(Array.isArray(enabledKinds) && enabledKinds.every(kind => ['chi', 'peng', 'gang'].includes(kind)) &&
    new Set(enabledKinds).size === enabledKinds.length && Number.isSafeInteger(maxCandidates) && maxCandidates > 0,
  'INVALID_COMBINATION_INPUT', 'Explicit unique meld kinds and a positive candidate budget are required.', 500);
  const ordered = validatedCards(cards);
  const byRank = Array.from({ length: 14 }, () => [] as PhysicalCard[]);
  for (const card of ordered) byRank[ordinaryRank(card.code)]!.push(card);
  const results: OrdinaryMeld[] = [];
  function append(kind: OrdinaryMeldKind, group: readonly PhysicalCard[]) {
    requireCondition(results.length < maxCandidates, 'COMBINATION_SEARCH_LIMIT',
      'Ordinary structure candidates cannot be silently truncated.', 500);
    const cardIds = group.map(card => card.id).sort();
    results.push({ id: `${kind}:${JSON.stringify(cardIds)}`, kind, cardIds });
  }
  function choose(bucket: readonly PhysicalCard[], count: number, kind: OrdinaryMeldKind, from = 0, chosen: PhysicalCard[] = []) {
    if (chosen.length === count) { append(kind, chosen); return; }
    for (let index = from; index <= bucket.length - (count - chosen.length); index++) {
      chosen.push(bucket[index]!);
      choose(bucket, count, kind, index + 1, chosen);
      chosen.pop();
    }
  }
  if (enabledKinds.includes('chi')) {
    for (let rank = 1; rank < 7; rank++) {
      for (const left of byRank[rank]!) for (const right of byRank[14 - rank]!) append('chi', [left, right]);
    }
    choose(byRank[7]!, 2, 'chi');
  }
  for (const kind of ['peng', 'gang'] as const) {
    if (!enabledKinds.includes(kind)) continue;
    for (let rank = 1; rank <= 13; rank++) choose(byRank[rank]!, kind === 'peng' ? 3 : 4, kind);
  }
  return results;
}

export interface OrdinaryChiCompletion {
  sourceCardId: string;
  companionCardId: string;
}

/** Companion choices for one offered card, not a seat's permission to claim it. */
export function ordinaryChiCompletions(
  hand: readonly PhysicalCard[], offered: PhysicalCard, maxCandidates = 4096,
): OrdinaryChiCompletion[] {
  requireCondition(Array.isArray(hand) && Number.isSafeInteger(maxCandidates) && maxCandidates > 0,
    'INVALID_COMBINATION_INPUT', 'A physical hand and positive candidate budget are required.', 500);
  const all = validatedCards([...hand, offered]);
  const targetRank = 14 - ordinaryRank(offered.code);
  const choices: OrdinaryChiCompletion[] = [];
  for (const card of all) {
    if (card.id === offered.id || ordinaryRank(card.code) !== targetRank) continue;
    requireCondition(choices.length < maxCandidates, 'COMBINATION_SEARCH_LIMIT',
      'Chi companions cannot be silently truncated.', 500);
    choices.push({ sourceCardId: offered.id, companionCardId: card.id });
  }
  return choices;
}
