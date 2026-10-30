import { requireCondition } from '../errors.js';

export interface CandidateGroup { id: string; cardIds: readonly string[] }
export interface SearchLimits { maxNodes: number; maxResults: number }

/**
 * Exact cover over physical cards. Regional code must provide legal groups and
 * required group count; no pair, wild-card or winning rule is inferred here.
 */
export function decomposeCards(
  hand: readonly string[], candidates: readonly CandidateGroup[], requiredGroups: number,
  limits: SearchLimits = { maxNodes: 100000, maxResults: 4096 },
): string[][] {
  requireCondition(new Set(hand).size === hand.length && hand.every(id => typeof id === 'string' && id.length > 0) &&
    Number.isSafeInteger(requiredGroups) && requiredGroups >= 0 &&
    Number.isSafeInteger(limits.maxNodes) && limits.maxNodes > 0 &&
    Number.isSafeInteger(limits.maxResults) && limits.maxResults > 0,
  'INVALID_COMBINATION_INPUT', 'Exact-cover input and search limits must be explicit and valid.', 500);
  const index = new Map(hand.map((id, offset) => [id, offset]));
  const ids = new Set<string>();
  const groups = candidates.map(candidate => {
    requireCondition(typeof candidate.id === 'string' && candidate.id.length > 0 && !ids.has(candidate.id) &&
      candidate.cardIds.length > 0 && new Set(candidate.cardIds).size === candidate.cardIds.length &&
      candidate.cardIds.every(id => index.has(id)),
    'INVALID_COMBINATION_INPUT', 'Groups need unique IDs and must refer to distinct physical cards in this hand.', 500);
    ids.add(candidate.id);
    const mask = candidate.cardIds.reduce((value, id) => value | (1n << BigInt(index.get(id)!)), 0n);
    return { id: candidate.id, mask };
  });
  const byCard = hand.map((_card, offset) => groups.filter(group => (group.mask & (1n << BigInt(offset))) !== 0n));
  const all = (1n << BigInt(hand.length)) - 1n;
  const results: string[][] = [];
  const deadEnds = new Set<string>();
  let nodes = 0;
  function search(remaining: bigint, chosen: string[]) {
    requireCondition(++nodes <= limits.maxNodes, 'COMBINATION_SEARCH_LIMIT', 'Exact-cover search exceeded its node budget.', 500);
    if (remaining === 0n) {
      if (chosen.length === requiredGroups) {
        requireCondition(results.length < limits.maxResults, 'COMBINATION_SEARCH_LIMIT', 'Exact-cover results cannot be silently truncated.', 500);
        results.push([...chosen]);
      }
      return;
    }
    if (chosen.length >= requiredGroups) return;
    const key = `${remaining}:${requiredGroups - chosen.length}`;
    if (deadEnds.has(key)) return;
    let eligible: typeof groups | undefined;
    for (let offset = 0; offset < hand.length; offset++) {
      if ((remaining & (1n << BigInt(offset))) === 0n) continue;
      const matches = byCard[offset]!.filter(group => (group.mask & remaining) === group.mask);
      if (!eligible || matches.length < eligible.length) eligible = matches;
      if (matches.length === 0) break;
    }
    const before = results.length;
    for (const group of eligible ?? []) search(remaining ^ group.mask, [...chosen, group.id]);
    if (results.length === before) deadEnds.add(key);
  }
  search(all, []);
  return results;
}
