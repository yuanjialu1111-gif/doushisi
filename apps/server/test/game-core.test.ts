import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCardState, createCardState, dealCards, moveCards, orderCards, projectCardState } from '../src/game/cards.js';
import { decomposeCards } from '../src/game/combinations.js';
import { openClaims, projectClaims, resolveClaims, submitClaim } from '../src/game/claims.js';

function cards() {
  return createCardState([{ code: 105, count: 2 }, { code: 109, count: 2 }, { code: 1001, count: 1 }], 'deck', [
    { id: 'deck', visibility: 'hidden' }, { id: 'one-hand', visibility: 'private', ownerId: 'one' },
    { id: 'two-hand', visibility: 'private', ownerId: 'two' }, { id: 'discard', visibility: 'public' },
    { id: 'one-meld', visibility: 'public', ownerId: 'one' }, { id: 'bonus', visibility: 'public' },
  ]);
}

test('physical copies keep distinct identities through deals, public moves, replacements and recovery', () => {
  const initial = cards();
  assert.notEqual(initial.pack[0]!.id, initial.pack[1]!.id);
  assert.equal(initial.pack[0]!.code, initial.pack[1]!.code);
  const shuffled = orderCards(initial, 'deck', ['card-5', 'card-3', 'card-1', 'card-4', 'card-2']);
  const dealt = dealCards(shuffled, 'deck', ['one-hand', 'two-hand', 'one-hand', 'two-hand']);
  let current = moveCards(dealt, 'one-hand', 'bonus', ['card-5']);
  current = dealCards(current, 'deck', ['one-hand']);
  current = moveCards(current, 'two-hand', 'discard', ['card-3']);
  current = moveCards(current, 'discard', 'one-meld', ['card-3']);
  current = moveCards(current, 'one-hand', 'one-meld', ['card-1']);
  assertCardState(JSON.parse(JSON.stringify(current)));
  assert.equal(current.zones.flatMap(zone => zone.cards).length, 5);
  assert.equal(current.zones.find(zone => zone.id === 'one-meld')!.cards.length, 2);
  assert.equal(initial.zones[0]!.cards.length, 5);
  assert.equal(initial.zones[1]!.cards.length, 0);
});

test('invalid card changes fail atomically and projections do not leak hidden faces or IDs', () => {
  const initial = cards();
  for (const order of [['card-1'], ['card-1', 'card-1', 'card-3', 'card-4', 'card-5']]) {
    assert.throws(() => orderCards(initial, 'deck', order), { code: 'INVALID_CARD_ORDER' });
  }
  assert.throws(() => moveCards(initial, 'deck', 'one-hand', ['card-1', 'card-1']), { code: 'INVALID_CARD_MOVE' });
  assert.throws(() => moveCards(initial, 'two-hand', 'one-hand', ['card-1']), { code: 'INVALID_CARD_MOVE' });
  assert.throws(() => dealCards(initial, 'deck', Array(6).fill('one-hand')), { code: 'PACK_EXHAUSTED' });
  assert.throws(() => dealCards(initial, 'deck', ['missing']), { code: 'UNKNOWN_CARD_ZONE' });
  const dealt = dealCards(initial, 'deck', ['one-hand', 'two-hand']);
  const projection = projectCardState(dealt, 'one');
  assert.deepEqual(projection.find(zone => zone.id === 'one-hand')!.cards, [{ id: 'card-1', code: 105 }]);
  assert.equal(projection.find(zone => zone.id === 'two-hand')!.cards, undefined);
  assert.equal(projection.find(zone => zone.id === 'deck')!.cards, undefined);
  assert.equal(JSON.stringify(projection).includes('card-2'), false);
  const corrupt = structuredClone(dealt);
  corrupt.zones[1]!.cards.push('card-2');
  assert.throws(() => assertCardState(corrupt), { code: 'INVALID_CARD_STATE' });
  assert.equal(initial.zones[0]!.cards.length, 5);
});

test('exact cover handles alternate legal decompositions without reusing a physical card', () => {
  const hand = ['a', 'b', 'c', 'd'];
  const candidates = [
    { id: 'ac', cardIds: ['a', 'c'] }, { id: 'ad', cardIds: ['a', 'd'] },
    { id: 'bc', cardIds: ['b', 'c'] }, { id: 'bd', cardIds: ['b', 'd'] },
  ];
  assert.deepEqual(decomposeCards(hand, candidates, 2).map(groups => groups.sort()).sort(), [['ac', 'bd'], ['ad', 'bc']]);
  assert.deepEqual(decomposeCards(hand, candidates.slice(0, 2), 2), []);
  assert.deepEqual(decomposeCards(hand, candidates, 3), []);
  assert.deepEqual(decomposeCards([], [], 0), [[]]);
  assert.throws(() => decomposeCards(['a', 'a'], [], 1), { code: 'INVALID_COMBINATION_INPUT' });
  assert.throws(() => decomposeCards(hand, [{ id: 'bad', cardIds: ['a', 'a'] }], 1), { code: 'INVALID_COMBINATION_INPUT' });
  assert.throws(() => decomposeCards(hand, candidates, 2, { maxNodes: 1, maxResults: 100 }), { code: 'COMBINATION_SEARCH_LIMIT' });
  assert.throws(() => decomposeCards(hand, candidates, 2, { maxNodes: 100, maxResults: 1 }), { code: 'COMBINATION_SEARCH_LIMIT' });
});

test('response resolution waits for peers, uses rule-supplied priority and keeps choices private', () => {
  const window = openClaims('decision-one', ['second', 'third', 'first'], [
    { id: 'first-claim', userId: 'first', action: { type: 'meld', privateCards: [101] }, priority: 1, simultaneous: false },
    { id: 'second-claim', userId: 'second', action: { type: 'win', privateCards: [209] }, priority: 2, simultaneous: true },
    { id: 'third-claim', userId: 'third', action: { type: 'win', privateCards: [305] }, priority: 2, simultaneous: true },
  ]);
  assert.equal(resolveClaims(window), null);
  const one = submitClaim(window, window.id, 'first', 'first-claim');
  assert.equal(resolveClaims(one), null);
  assert.equal(projectClaims(one, 'first').options.length, 0);
  assert.equal(JSON.stringify(projectClaims(one, 'first')).includes('209'), false);
  assert.equal(projectClaims(one, 'outsider').options.length, 0);
  assert.throws(() => submitClaim(one, window.id, 'first', null), { code: 'CLAIM_ALREADY_SUBMITTED' });
  assert.deepEqual(submitClaim(one, window.id, 'first', 'first-claim'), one);
  assert.throws(() => submitClaim(one, 'old', 'second', 'second-claim'), { code: 'STALE_CLAIM_WINDOW' });
  assert.throws(() => submitClaim(one, window.id, 'second', 'third-claim'), { code: 'INVALID_CLAIM' });
  assert.throws(() => submitClaim(one, window.id, 'outsider', null), { code: 'CLAIM_NOT_AVAILABLE' });
  const done = submitClaim(submitClaim(one, window.id, 'third', 'third-claim'), window.id, 'second', 'second-claim');
  assert.deepEqual(resolveClaims(done)!.map(offer => offer.userId), ['second', 'third']);
  assert.equal(window.replies.length, 0);
});

test('single-claim ties and all-pass outcomes do not depend on network arrival order', () => {
  const original = openClaims('tie', ['b', 'a'], [
    { id: 'a-choice', userId: 'a', action: 'a', priority: 1, simultaneous: false },
    { id: 'b-choice', userId: 'b', action: 'b', priority: 1, simultaneous: false },
  ]);
  const first = submitClaim(submitClaim(original, 'tie', 'a', 'a-choice'), 'tie', 'b', 'b-choice');
  const second = submitClaim(submitClaim(original, 'tie', 'b', 'b-choice'), 'tie', 'a', 'a-choice');
  assert.deepEqual(resolveClaims(first), resolveClaims(second));
  assert.equal(resolveClaims(first)![0]!.userId, 'b');
  assert.deepEqual(resolveClaims(submitClaim(submitClaim(original, 'tie', 'b', null), 'tie', 'a', null)), []);
});
