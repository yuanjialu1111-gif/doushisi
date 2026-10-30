import test from 'node:test';
import assert from 'node:assert/strict';
import { ANYUE_INDEPENDENT_VERSION, freezeAnyueOptions, getDefaultOptions } from '@dss/rules';
import type { EngineResult, RoundInput } from '../src/engines.js';
import { assertCardState } from '../src/game/cards.js';
import { anyuePackSpecification, createAnyueCardState } from '../src/game/anyue-pack.js';
import { applyAnyueAction, anyueLegalActions, anyueTimedAction, assertAnyueRound, createAnyueRound,
  viewAnyueRound, type AnyueAction, type AnyueRound } from '../src/game/anyue-round.js';

function input(count = 2, overrides: Record<string, unknown> = {}): RoundInput {
  const rules = { ...getDefaultOptions('5:0'), playerNum: count, gameNum: 4, baseBeans: '0.125',
    piaoType: 0, qiToWang: 0, ...overrides };
  return { players: Array.from({ length: count }, (_, index) => ({ userId: String.fromCharCode(97 + index), seat: index + 1 })),
    ownerUserId: 'a', number: 1, rules: { ...rules, anyue: freezeAnyueOptions(rules) },
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}
const pack = (round: RoundInput) => createAnyueCardState('5:0', round.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
function make(hands: number[][], tail: number[] = [], options: Record<string, unknown> = {}) {
  const roundInput = input(hands.length, options), physical = pack(roundInput), used = new Set<string>();
  const id = (code: number) => {
    const card = physical.find(item => item.code === code && !used.has(item.id));
    assert.ok(card, `Fixture face unavailable: ${code}`); used.add(card.id); return card.id;
  };
  const deal = Array.from({ length: 7 }, (_, index) => hands.map(hand => hand[index]!)).flat();
  deal.push(hands[0]![7]!);
  const order = [...deal, ...tail].map(id);
  order.push(...physical.filter(card => !used.has(card.id)).map(card => card.id));
  return createAnyueRound(roundInput, order);
}
const zone = (state: AnyueRound, name: string) => state.cards.zones.find(item => item.id === name)!.cards;
const code = (state: AnyueRound, id: string) => state.cards.pack.find(card => card.id === id)!.code;
function action(state: AnyueRound, id: string, type: AnyueAction['type'], face?: number) {
  const found = anyueLegalActions(state, id).find(candidate => candidate.type === type &&
    (face === undefined || 'cardId' in candidate && code(state, candidate.cardId) === face ||
      'cardIds' in candidate && candidate.cardIds.some(cardId => code(state, cardId) === face)));
  assert.ok(found, `Missing ${id} ${type} ${face ?? ''}`);
  return found;
}
function apply(state: AnyueRound, id: string, selected: AnyueAction): AnyueRound {
  const before = structuredClone(state);
  const result = applyAnyueAction(state, id, selected);
  assert.deepEqual(state, before);
  assertAnyueRound(result.snapshot as AnyueRound);
  return result.snapshot as AnyueRound;
}
const run = (state: AnyueRound, id: string, type: AnyueAction['type'], face?: number) =>
  apply(state, id, action(state, id, type, face));
function passAll(state: AnyueRound) {
  while (state.phase === 'response') {
    const next = state.players.find(item => anyueLegalActions(state, item.userId).length);
    assert.ok(next);
    state = apply(state, next.userId, anyueLegalActions(state, next.userId)
      .find(candidate => candidate.type === 'respond' && candidate.choiceId === null)!);
  }
  return state;
}

test('Anyue round deals 8/7, preserves the pack and keeps the fixed three kings', () => {
  const state = make([[101, 102, 103, 104, 105, 106, 108, 109], [201, 202, 203, 204, 205, 206, 208]]);
  assert.deepEqual(state.players.map(item => zone(state, `hand:${item.userId}`).length), [8, 7]);
  assert.equal(zone(state, 'deck').length, 40);
  assertCardState(state.cards);
  assert.equal(state.cards.pack.length, 55);
  assert.deepEqual(anyueLegalActions(state, 'a').map(item => item.type), ['begin']);
});

test('Anyue piao gate requires every player before play starts and defaults timeout to zero', () => {
  let state = make([[101, 102, 103, 104, 105, 106, 108, 109], [201, 202, 203, 204, 205, 206, 208]], [], { piaoType: 2 });
  assert.equal(state.phase, 'piao');
  assert.deepEqual(anyueLegalActions(state, 'a').map(item => item.type), ['piao', 'piao']);
  assert.equal(anyueTimedAction(state, 'a')!.action.type, 'piao');
  assert.equal((anyueTimedAction(state, 'a')!.action as { value: number }).value, 0);
  state = apply(state, 'a', anyueLegalActions(state, 'a').find(item => item.type === 'piao' && item.value === 1)!);
  assert.equal(state.phase, 'piao');
  state = apply(state, 'b', anyueLegalActions(state, 'b').find(item => item.type === 'piao' && item.value === 0)!);
  assert.equal(state.phase, 'opening');
  assert.equal(state.players.find(item => item.userId === 'a')!.piao, 1);
  assert.equal(state.players.find(item => item.userId === 'b')!.piao, 0);
});

test('Anyue kings and enabled sevens are stolen into the bonus zone with one fan each', () => {
  const state = make([[1001, 107, 101, 102, 103, 104, 105, 108], [201, 202, 203, 204, 205, 206, 208]],
    [1002, 1003, 109, 110], { qiToWang: 1 });
  const next = run(state, 'a', 'begin');
  const bonus = zone(next, 'bonus:a').map(id => code(next, id));
  assert.deepEqual([...bonus].sort((a, b) => a - b), [107, 1001, 1002, 1003]);
  assert.equal(zone(next, 'hand:a').length, 8);
});

test('Anyue chi is next-seat only and consumes no replacement', () => {
  const hands = [[105, 101, 102, 103, 104, 106, 107, 108], [209, 202, 203, 204, 205, 206, 207]];
  let state = run(make(hands), 'a', 'begin');
  state = run(state, 'a', 'discard', 105);
  assert.ok(state.claims!.offers.some(offer => offer.userId === 'b' && (offer.action as AnyueAction).type === 'chi'));
  const deckBefore = zone(state, 'deck').length;
  state = apply(state, 'b', { type: 'respond',
    choiceId: state.claims!.offers.find(offer => offer.userId === 'b' && (offer.action as AnyueAction).type === 'chi')!.id,
    decisionId: state.claims!.id });
  assert.equal(state.phase, 'discard');
  assert.equal(zone(state, 'deck').length, deckBefore);
  assert.deepEqual(state.players[1]!.melds.map(meld => meld.kind), ['chi']);
});

test('Anyue settlement is deterministic, once-only, and carries next-round context', () => {
  let state = make([[102, 103, 104, 105, 106, 107, 108, 109], [201, 202, 203, 204, 205, 206, 207]], [], { qiToWang: 1 });
  state = run(state, 'a', 'begin');
  let steps = 0;
  while (state.phase !== 'finished') {
    assert.ok(steps++ < 800);
    const timed = state.players.map(item => anyueTimedAction(state, item.userId)).find(Boolean)!;
    state = apply(state, timed.userId, timed.action as AnyueAction);
  }
  assert.ok(state.outcome);
  assert.equal(state.outcome!.nextRoundContext?.completedRound, 1);
  assert.deepEqual(state.outcome!.payments.postings.reduce((sum, posting) => sum + Number(posting.amount), 0), 0);
});

test('Anyue view hides other hands and remaining deck', () => {
  const state = make([[101, 102, 103, 104, 105, 106, 108, 109], [201, 202, 203, 204, 205, 206, 208]]);
  const view = viewAnyueRound(state, 'b');
  assert.equal(view.cards.find(item => item.id === 'hand:a')!.cards, undefined);
  assert.equal(view.cards.find(item => item.id === 'deck')!.cards, undefined);
  assert.throws(() => viewAnyueRound(state, 'outsider'), { code: 'NOT_ROOM_MEMBER' });
});

for (const count of [2, 3, 4]) for (const piaoType of [0, 1, 2]) {
  test(`Anyue finite round completes: ${count} players, piao ${piaoType}`, () => {
    const roundInput = input(count, { piaoType, qiToWang: 1 });
    let state = createAnyueRound(roundInput, pack(roundInput).map(card => card.id));
    let steps = 0;
    while (state.phase !== 'finished') {
      assert.ok(steps++ < 800, 'Anyue round must terminate');
      const timed = state.players.map(item => anyueTimedAction(state, item.userId)).find(Boolean)!;
      assert.ok(timed);
      state = apply(state, timed.userId, timed.action as AnyueAction);
    }
    assert.ok(state.outcome);
    assert.equal(state.cards.pack.length, anyuePackSpecification().reduce((sum, entry) => sum + entry.count, 0));
  });
}
