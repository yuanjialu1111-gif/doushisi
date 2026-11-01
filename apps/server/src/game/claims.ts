import { requireCondition } from '../errors.js';

export interface ClaimOffer {
  id: string;
  userId: string;
  action: unknown;
  priority: number;
  simultaneous: boolean;
}
export interface ClaimReply { userId: string; choiceId: string | null }
export interface ClaimWindow {
  id: string;
  tieOrder: string[];
  offers: ClaimOffer[];
  passOnlyUserIds?: string[];
  replies: ClaimReply[];
}

export function openClaims(id: string, tieOrder: readonly string[], offers: readonly ClaimOffer[],
  passOnlyUserIds: readonly string[] = []): ClaimWindow {
  requireCondition(id.length > 0 && tieOrder.length > 0 && new Set(tieOrder).size === tieOrder.length &&
    tieOrder.every(userId => typeof userId === 'string' && userId.length > 0) &&
    new Set(passOnlyUserIds).size === passOnlyUserIds.length &&
    passOnlyUserIds.every(userId => tieOrder.includes(userId)),
  'INVALID_CLAIM_WINDOW', 'A decision needs an ID and explicit regional tie order.', 500);
  const ids = new Set<string>();
  const priorities = new Map<number, boolean>();
  for (const offer of offers) {
    requireCondition(typeof offer.id === 'string' && offer.id.length > 0 && !ids.has(offer.id) &&
      tieOrder.includes(offer.userId) && Number.isSafeInteger(offer.priority) &&
      typeof offer.simultaneous === 'boolean' &&
      (!priorities.has(offer.priority) || priorities.get(offer.priority) === offer.simultaneous),
    'INVALID_CLAIM_WINDOW', 'Offers must have unique IDs and a consistent resolution rule at each priority.', 500);
    ids.add(offer.id);
    priorities.set(offer.priority, offer.simultaneous);
  }
  return { id, tieOrder: [...tieOrder], offers: structuredClone([...offers]),
    ...(passOnlyUserIds.length ? { passOnlyUserIds: [...passOnlyUserIds] } : {}), replies: [] };
}

export function submitClaim(window: ClaimWindow, decisionId: string, userId: string, choiceId: string | null): ClaimWindow {
  requireCondition(decisionId === window.id, 'STALE_CLAIM_WINDOW', 'The response belongs to another decision.', 409);
  requireCondition(window.offers.some(offer => offer.userId === userId) || window.passOnlyUserIds?.includes(userId),
    'CLAIM_NOT_AVAILABLE', 'This player has no response in this window.', 409);
  requireCondition(choiceId === null || window.offers.some(offer => offer.userId === userId && offer.id === choiceId),
    'INVALID_CLAIM', 'This response is not one of the player legal choices.', 409);
  const previous = window.replies.find(reply => reply.userId === userId);
  requireCondition(!previous || previous.choiceId === choiceId, 'CLAIM_ALREADY_SUBMITTED', 'A submitted response cannot be changed.', 409);
  const next = structuredClone(window);
  if (!previous) next.replies.push({ userId, choiceId });
  return next;
}

/**
 * Higher priority wins; equal priorities use the explicit regional tie order.
 * 还有人没回时，只要没回的人谁都压不过已选的（更高优先级、同级排在前面或同级一起算），就立刻定（DEC-20261101-要牌立刻结算）。
 */
export function resolveClaims(window: ClaimWindow): ClaimOffer[] | null {
  const responders = new Set([...window.offers.map(offer => offer.userId), ...(window.passOnlyUserIds ?? [])]);
  const pending = [...responders].filter(userId => !window.replies.some(reply => reply.userId === userId));
  const chosen = window.replies.flatMap(reply => reply.choiceId === null ? [] :
    window.offers.filter(offer => offer.userId === reply.userId && offer.id === reply.choiceId));
  if (!chosen.length) return pending.length ? null : [];
  const priority = Math.max(...chosen.map(offer => offer.priority));
  const winners = chosen.filter(offer => offer.priority === priority)
    .sort((a, b) => window.tieOrder.indexOf(a.userId) - window.tieOrder.indexOf(b.userId));
  const best = winners[0]!;
  const rank = (userId: string) => window.tieOrder.indexOf(userId);
  if (window.offers.some(offer => pending.includes(offer.userId) && (offer.priority > priority ||
    offer.priority === priority && (best.simultaneous || rank(offer.userId) < rank(best.userId))))) return null;
  return structuredClone(best.simultaneous ? winners : winners.slice(0, 1));
}

export function projectClaims(window: ClaimWindow, userId: string) {
  const own = window.replies.find(reply => reply.userId === userId);
  return {
    id: window.id,
    options: own ? [] : window.offers.filter(offer => offer.userId === userId)
      .map(offer => ({ id: offer.id, action: structuredClone(offer.action) })),
    submitted: own !== undefined,
  };
}
