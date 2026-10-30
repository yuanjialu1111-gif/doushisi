import test from 'node:test';
import assert from 'node:assert/strict';
import { ABA_INDEPENDENT_VERSION, getDefaultOptions } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { abaDeclarationFaces, abaLegalActions, applyAbaAction, createAbaRound, type AbaRound } from '../src/game/aba-round.js';
import { createAbaCardState } from '../src/game/aba-pack.js';
import { moveCards } from '../src/game/cards.js';

/** Deal explicit concealed hands; the first hand belongs to the dealer and receives eight faces. */
function fixture(hands: readonly number[][], options: Record<string, unknown> = {}): AbaRound {
  const userIds = ['a', 'b', 'c', 'd'].slice(0, hands.length);
  const rules = { ...getDefaultOptions('9:0'), playerNum: hands.length, gameNum: 4, huRedScore: 300,
    baojiaoCondition: 1, baipiType: 1, maxFan: 99, baseBeans: '0.125', chaJiao: 0,
    aba: { rulesVersion: ABA_INDEPENDENT_VERSION }, ...options };
  const input: RoundInput = { players: userIds.map((userId, index) => ({ userId, seat: index + 1 })),
    ownerUserId: 'a', number: 1, rules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
  const pack = createAbaCardState('9:0', rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  const used = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(card => card.code === code && !used.has(card.id));
    assert.ok(card, `pack exhausted at ${code}`); used.add(card.id); return card.id;
  };
  const order: string[] = [];
  for (let round = 0; round < 7; round++)
    for (const hand of hands) order.push(pick(hand[round]!));
  order.push(pick(hands[0]![7]!));
  order.push(...pack.filter(card => !used.has(card.id)).map(card => card.id));
  const state = createAbaRound(input, order);
  return applyAbaAction(state, 'a', abaLegalActions(state, 'a').find(action => action.type === 'begin')!).snapshot as AbaRound;
}
const zone = (state: AbaRound, id: string) => state.cards.zones.find(entry => entry.id === id)!.cards;
const face = (state: AbaRound, id: string) => state.cards.pack.find(card => card.id === id)!.code;
const declare = (state: AbaRound, id = 'a', cardId?: string) => {
  const action = abaLegalActions(state, id).find(candidate => candidate.type === 'declare' &&
    (cardId === undefined || candidate.cardId === cardId));
  assert.ok(action && action.type === 'declare', `${id} cannot declare${cardId ? ` ${cardId}` : ''}`);
  return applyAbaAction(state, id, action).snapshot as AbaRound;
};
/** Clear the table source and wall, then let the next seat fail its draw so chaJiao resolves. */
function exhaust(state: AbaRound): AbaRound {
  for (const cardId of [...zone(state, 'table')]) state.cards = moveCards(state.cards, 'table', 'discards', [cardId]);
  const remaining = [...zone(state, 'deck')];
  if (remaining.length) state.cards = moveCards(state.cards, 'deck', 'discards', remaining);
  const next = state.players[(state.players.findIndex(item => item.userId === state.activeId) + 1) %
    state.players.length]!.userId;
  state.phase = 'draw'; state.activeId = next; state.source = null; state.claims = null; state.serial++;
  return applyAbaAction(state, next, { type: 'draw', decisionId: `ab:${state.number}:${state.serial}` })
    .snapshot as AbaRound;
}
// 1,2,3,4,7,10,J,Q: discarding 1 waits only on 7 of diamonds.
const WAITING_SEVEN = [101, 102, 103, 104, 107, 110, 111, 112];
// 1,2,3,4,5,9,10,J: discarding 1 waits on 2/5/8/J of the same suit.
const WAITING_EIGHT = [301, 302, 303, 304, 305, 309, 310, 311];
// Two separated suit-runs leave isolated 10/J faces, so no legal structure completes 14.
const NOT_WAITING = [201, 202, 203, 204, 207, 210, 211, 212];
const FILLER = [401, 402, 403, 404, 405, 406, 407, 408];

function declaration(state: AbaRound, id: string, code: number): AbaRound {
  const cardId = zone(state, `hand:${id}`).find(candidate => face(state, candidate) === code);
  assert.ok(cardId, `${id} does not hold ${code}`);
  const action = abaLegalActions(state, id).find(candidate => candidate.type === 'declare' &&
    candidate.cardId === cardId);
  assert.ok(action && action.type === 'declare', `${id} cannot declare ${code}`);
  return applyAbaAction(state, id, action).snapshot as AbaRound;
}

function discard(state: AbaRound, id: string, code: number): AbaRound {
  const cardId = zone(state, `hand:${id}`).find(candidate => face(state, candidate) === code);
  assert.ok(cardId, `${id} does not hold ${code}`);
  const action = abaLegalActions(state, id).find(candidate => candidate.type === 'discard' &&
    candidate.cardId === cardId);
  assert.ok(action && action.type === 'discard', `${id} cannot discard ${code}`);
  return applyAbaAction(state, id, action).snapshot as AbaRound;
}

test('chaJiao is off by default and posts no transfers on a draw', () => {
  const state = declare(fixture([WAITING_SEVEN, FILLER]));
  const outcome = exhaust(state).outcome!;
  assert.equal(outcome.reason, 'draw');
  assert.deepEqual(outcome.payments.postings, [{ userId: 'a', amount: '0' }, { userId: 'b', amount: '0' }]);
  assert.deepEqual(outcome.payments.transfers, []);
});

test('chaJiao charges a non-waiting player the waiter maximum single-hand value', () => {
  const state = declare(fixture([WAITING_SEVEN, FILLER], { chaJiao: 1 }));
  assert.deepEqual(state.players[0]!.declaredWaits, [307]);
  const outcome = exhaust(state).outcome!;
  assert.equal(outcome.reason, 'draw');
  assert.deepEqual(outcome.payments.postings, [{ userId: 'a', amount: '0.35' }, { userId: 'b', amount: '-0.35' }]);
  assert.deepEqual(outcome.payments.transfers, [{ id: 'aba-draw:0:0', payerId: 'b', payeeId: 'a',
    numerator: '350000000000000', denominator: '1000000000000000' }]);
});

test('chaJiao pays each waiting player separately and skips waiting payers', () => {
  let state = fixture([WAITING_SEVEN, WAITING_EIGHT, NOT_WAITING], { chaJiao: 1 });
  state = declare(state, 'a');
  assert.deepEqual(state.players[0]!.declaredWaits, [307]);
  assert.equal(state.players[1]!.declaredWaits, null);
  const table = [...zone(state, 'table')];
  if (table.length) state.cards = moveCards(state.cards, 'table', 'discards', table);
  const filler = zone(state, 'deck').find(cardId => face(state, cardId) === 311);
  assert.ok(filler);
  state.cards = moveCards(state.cards, 'deck', 'hand:b', [filler]);
  state.phase = 'discard'; state.activeId = 'b'; state.source = null; state.claims = null; state.serial++;
  state = declaration(state, 'b', 301);
  assert.deepEqual(state.players[1]!.declaredWaits, [112, 212, 312, 412]);
  const outcome = exhaust(state).outcome!;
  assert.deepEqual(outcome.payments.postings, [{ userId: 'a', amount: '0.35' },
    { userId: 'b', amount: '0.35' }, { userId: 'c', amount: '-0.7' }]);
  assert.deepEqual(outcome.payments.transfers.map(transfer => [transfer.payerId, transfer.payeeId]),
    [['c', 'a'], ['c', 'b']]);
});

test('chaJiao posts nothing when every player waits or no player waits', () => {
  let allWait = declare(fixture([WAITING_SEVEN, FILLER], { chaJiao: 1 }));
  // Replace the second hand directly with a full declared-wait shape so both
  // players are waiting when the wall is exhausted.
  const table = [...zone(allWait, 'table')];
  if (table.length) allWait.cards = moveCards(allWait.cards, 'table', 'discards', table);
  const handIds = [...zone(allWait, 'hand:b')];
  allWait.cards = moveCards(allWait.cards, 'hand:b', 'discards', handIds);
  const replacement = zone(allWait, 'deck').filter(cardId => [301, 302, 303, 304, 305, 309, 310, 311].includes(face(allWait, cardId))).slice(0, 8);
  assert.equal(replacement.length, 8);
  allWait.cards = moveCards(allWait.cards, 'deck', 'hand:b', replacement);
  allWait.phase = 'discard'; allWait.activeId = 'b'; allWait.source = null; allWait.claims = null; allWait.serial++;
  allWait = declaration(allWait, 'b', 301);
  allWait = exhaust(allWait);
  assert.deepEqual(allWait.outcome!.payments.transfers, []);
  assert.deepEqual(allWait.outcome!.payments.postings,
    [{ userId: 'a', amount: '0' }, { userId: 'b', amount: '0' }]);
  const noneWait = exhaust(discard(fixture([NOT_WAITING, FILLER], { chaJiao: 1 }), 'a', 201));
  assert.deepEqual(noneWait.outcome!.payments.transfers, []);
});

test('chaJiao keeps every max-value waiting face in the frozen set', () => {
  const dealt = fixture([WAITING_EIGHT, FILLER], { chaJiao: 1 });
  const first = zone(dealt, 'hand:a').find(cardId => face(dealt, cardId) === 301);
  assert.ok(first);
  const state = declare(dealt, 'a', first);
  assert.deepEqual(state.players[0]!.declaredWaits, [112, 212, 312, 412]);
  const outcome = exhaust(state).outcome!;
  assert.deepEqual(outcome.payments.postings, [{ userId: 'a', amount: '0.35' }, { userId: 'b', amount: '-0.35' }]);
});

test('a declared waiter is charged from its frozen bonus snapshot, not the live bonus zone', () => {
  const state = declare(fixture([WAITING_SEVEN, FILLER], { chaJiao: 1 }));
  assert.deepEqual(state.players[0]!.declaredWaits, [307]);
  assert.deepEqual(state.players[0]!.declaredBonusIds, []);
  // A later bonus king would widen the live waits to include 2/5/8 of the eight; the declaration
  // must keep charging only the frozen third seven.
  const king = zone(state, 'deck').find(cardId => face(state, cardId) === 1001)!;
  state.cards = moveCards(state.cards, 'deck', 'bonus:a', [king]);
  assert.deepEqual(state.players[0]!.declaredWaits, [307]);
  const outcome = exhaust(state).outcome!;
  assert.deepEqual(outcome.payments.postings, [{ userId: 'a', amount: '0.35' }, { userId: 'b', amount: '-0.35' }]);
});
