import { requireCondition } from '../errors.js';
import type { PhysicalCard } from './cards.js';
import { ordinaryRank } from './ordinary-melds.js';

export const QIONGLAI_DEAL_VERSION = 'qionglai-deal-v1';

const isBonus = (code: number) => [1001, 1002, 1003].includes(code);
const redPoint = (code: number) => {
  if (isBonus(code)) return 0;
  const rank = ordinaryRank(code);
  return [1, 3].includes(Math.floor(code / 100)) ? rank > 10 ? 1 : rank : 0;
};

interface PotentialGroup { mask: number; cards: number; redPoints: number }

/**
 * Independent deal-selection heuristic. It never determines a winning hand or
 * score; it only ranks complete candidate permutations for a selected player.
 */
export function qionglaiDealEvaluation(ordered: readonly PhysicalCard[], playerCount: number, seatOffset: number) {
  requireCondition(Array.isArray(ordered) && ordered.length >= 52 && playerCount >= 2 && playerCount <= 4 &&
    Number.isInteger(seatOffset) && seatOffset >= 0 && seatOffset < playerCount,
  'INVALID_DEAL_EVALUATION', 'Deal evaluation needs a physical pack and a valid player position.', 500);
  const count = seatOffset === 0 ? 8 : 7;
  const hand: PhysicalCard[] = [];
  for (let index = 0; index < count - 1; index++) hand.push(ordered[index * playerCount + seatOffset]!);
  if (seatOffset === 0) hand.push(ordered[7 * playerCount]!);
  const groups: PotentialGroup[] = [];
  const ordinary = hand.map((card, index) => ({ card, index })).filter(item => !isBonus(item.card.code));
  const append = (items: readonly { card: PhysicalCard; index: number }[]) => {
    if (!items.length || items.some(item => isBonus(item.card.code))) return;
    let mask = 0, redPoints = 0;
    for (const item of items) { mask |= 1 << item.index; redPoints += redPoint(item.card.code); }
    if (groups.some(group => group.mask === mask)) return;
    groups.push({ mask, cards: items.length, redPoints });
  };
  for (let left = 0; left < ordinary.length; left++) for (let right = left + 1; right < ordinary.length; right++) {
    if (ordinaryRank(ordinary[left]!.card.code) + ordinaryRank(ordinary[right]!.card.code) === 14)
      append([ordinary[left]!, ordinary[right]!]);
  }
  const byRank = new Map<number, typeof ordinary>();
  for (const item of ordinary) byRank.set(ordinaryRank(item.card.code),
    [...(byRank.get(ordinaryRank(item.card.code)) ?? []), item]);
  for (const bucket of byRank.values()) {
    if (bucket.length >= 4) append(bucket.slice(0, 4));
    if (bucket.length >= 3) append(bucket.slice(0, 3));
  }
  let best = { groups: 0, redPoints: 0, bonuses: 0 };
  const search = (index: number, mask: number, groupCount: number, redPoints: number) => {
    if (index >= groups.length) {
      const bonuses = hand.filter(card => isBonus(card.code)).length;
      const candidate = { groups: groupCount, redPoints, bonuses };
      if (candidate.groups > best.groups ||
        candidate.groups === best.groups && candidate.redPoints > best.redPoints ||
        candidate.groups === best.groups && candidate.redPoints === best.redPoints && candidate.bonuses > best.bonuses)
        best = candidate;
      return;
    }
    search(index + 1, mask, groupCount, redPoints);
    const group = groups[index]!;
    if ((mask & group.mask) === 0) search(index + 1, mask | group.mask, groupCount + 1, redPoints + group.redPoints);
  };
  search(0, 0, 0, 0);
  return [best.groups, best.redPoints, best.bonuses];
}

export function qionglaiDealHand(
  ordered: readonly PhysicalCard[], playerCount: number, dealerSeat: number, targetSeat: number,
) {
  requireCondition(Number.isInteger(dealerSeat) && dealerSeat >= 1 && dealerSeat <= playerCount &&
    Number.isInteger(targetSeat) && targetSeat >= 1 && targetSeat <= playerCount,
  'INVALID_DEAL_EVALUATION', 'Seats must belong to the selected game.', 500);
  const seatOffset = (targetSeat - dealerSeat + playerCount) % playerCount;
  return qionglaiDealEvaluation(ordered, playerCount, seatOffset);
}
