import { requireCondition } from '../errors.js';

export interface PhysicalCard { id: string; code: number }
export interface CardZone {
  id: string;
  visibility: 'hidden' | 'private' | 'public';
  ownerId?: string;
  cards: string[];
}
export interface CardState { pack: PhysicalCard[]; zones: CardZone[] }
export interface PackEntry { code: number; count: number }
export type ZoneSpec = Omit<CardZone, 'cards'>;

export function assertCardState(state: CardState): void {
  const cards = new Set<string>();
  for (const card of state.pack) {
    requireCondition(typeof card.id === 'string' && card.id.length > 0 && !cards.has(card.id) &&
      Number.isSafeInteger(card.code) && card.code > 0, 'INVALID_CARD_STATE', 'Physical card IDs and face codes must be valid.', 500);
    cards.add(card.id);
  }
  const zones = new Set<string>();
  const placed = new Set<string>();
  for (const zone of state.zones) {
    requireCondition(typeof zone.id === 'string' && zone.id.length > 0 && !zones.has(zone.id) &&
      ['hidden', 'private', 'public'].includes(zone.visibility) &&
      (zone.visibility !== 'private' || typeof zone.ownerId === 'string' && zone.ownerId.length > 0),
    'INVALID_CARD_STATE', 'Zones need unique IDs and private zones need an owner.', 500);
    zones.add(zone.id);
    for (const id of zone.cards) {
      requireCondition(cards.has(id) && !placed.has(id), 'INVALID_CARD_STATE', 'Every physical card must occur in exactly one zone.', 500);
      placed.add(id);
    }
  }
  requireCondition(placed.size === cards.size, 'INVALID_CARD_STATE', 'A physical card is missing from the table.', 500);
}

export function createCardState(specification: readonly PackEntry[], drawZone: string, zones: readonly ZoneSpec[]): CardState {
  const codes = new Set<number>();
  const pack: PhysicalCard[] = [];
  for (const entry of specification) {
    requireCondition(Number.isSafeInteger(entry.code) && entry.code > 0 && !codes.has(entry.code) &&
      Number.isSafeInteger(entry.count) && entry.count > 0, 'INVALID_PACK', 'An explicit positive count is required for each unique face code.', 500);
    codes.add(entry.code);
    for (let index = 0; index < entry.count; index++) pack.push({ id: `card-${pack.length + 1}`, code: entry.code });
  }
  requireCondition(pack.length > 0, 'INVALID_PACK', 'An empty pack cannot start a game.', 500);
  const state = { pack, zones: zones.map(zone => ({ ...zone, cards: zone.id === drawZone ? pack.map(card => card.id) : [] })) };
  requireCondition(state.zones.some(zone => zone.id === drawZone && zone.visibility === 'hidden'),
    'INVALID_PACK', 'The initial draw zone must be hidden.', 500);
  assertCardState(state);
  return state;
}

function getZone(state: CardState, id: string): CardZone {
  const zone = state.zones.find(zone => zone.id === id);
  requireCondition(zone, 'UNKNOWN_CARD_ZONE', 'The requested card zone does not exist.', 500);
  return zone;
}

export function orderCards(state: CardState, zoneId: string, order: readonly string[]): CardState {
  assertCardState(state);
  const zone = getZone(state, zoneId);
  requireCondition(order.length === zone.cards.length && new Set(order).size === order.length &&
    order.every(id => zone.cards.includes(id)), 'INVALID_CARD_ORDER', 'Reordering cannot add, remove or duplicate cards.', 500);
  const next = structuredClone(state);
  getZone(next, zoneId).cards = [...order];
  return next;
}

export function moveCards(state: CardState, from: string, to: string, ids: readonly string[]): CardState {
  assertCardState(state);
  const source = getZone(state, from);
  getZone(state, to);
  requireCondition(from !== to && ids.length > 0 && new Set(ids).size === ids.length &&
    ids.every(id => source.cards.includes(id)), 'INVALID_CARD_MOVE', 'Only distinct cards present in the source zone can move.', 409);
  const next = structuredClone(state);
  const selected = new Set(ids);
  getZone(next, from).cards = source.cards.filter(id => !selected.has(id));
  getZone(next, to).cards.push(...ids);
  assertCardState(next);
  return next;
}

/** The regional engine supplies the exact deal order, including any extra dealer card. */
export function dealCards(state: CardState, from: string, destinationSequence: readonly string[]): CardState {
  assertCardState(state);
  const source = getZone(state, from);
  requireCondition(source.cards.length >= destinationSequence.length, 'PACK_EXHAUSTED', 'Not enough cards remain for this deal.', 409);
  for (const destination of destinationSequence) {
    requireCondition(destination !== from, 'INVALID_CARD_MOVE', 'A deal cannot return a card to the source.', 500);
    getZone(state, destination);
  }
  const next = structuredClone(state);
  const dealt = getZone(next, from).cards.splice(0, destinationSequence.length);
  destinationSequence.forEach((destination, index) => getZone(next, destination).cards.push(dealt[index]!));
  assertCardState(next);
  return next;
}

export function projectCardState(state: CardState, viewerId: string) {
  assertCardState(state);
  const cards = new Map(state.pack.map(card => [card.id, card]));
  return state.zones.map(zone => ({
    id: zone.id, ...(zone.ownerId === undefined ? {} : { ownerId: zone.ownerId }), count: zone.cards.length,
    ...(zone.visibility === 'public' || zone.visibility === 'private' && zone.ownerId === viewerId
      ? { cards: zone.cards.map(id => ({ ...cards.get(id)! })) } : {}),
  }));
}
