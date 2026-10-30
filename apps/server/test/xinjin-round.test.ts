import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeXinjinOptions, getDefaultOptions } from '@dss/rules';
import type { EngineResult, RoundInput } from '../src/engines.js';
import { assertCardState } from '../src/game/cards.js';
import { createXinjinCardState, xinjinPackSpecification } from '../src/game/xinjin-pack.js';
import { applyXinjinAction, assertXinjinRound, createXinjinRound, viewXinjinRound, xinjinLegalActions,
  xinjinTimedAction, type XinjinAction, type XinjinRound } from '../src/game/xinjin-round.js';

function input(count = 2, overrides: Record<string, unknown> = {}): RoundInput {
  const rules = { ...getDefaultOptions('4:0'), playerNum: count, gameNum: 4, wangNum: 3, baseBeans: '0.125',
    qiToWang: 0, ...overrides };
  return { players: Array.from({ length: count }, (_, index) => ({ userId: String.fromCharCode(97 + index), seat: index + 1 })),
    ownerUserId: 'a', number: 1, rules: { ...rules, xinjin: freezeXinjinOptions(rules) },
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}
function pack(round: RoundInput) {
  return createXinjinCardState('4:0', round.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
}
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
  return createXinjinRound(roundInput, order);
}
const zone = (state: XinjinRound, name: string) => state.cards.zones.find(item => item.id === name)!.cards;
const code = (state: XinjinRound, id: string) => state.cards.pack.find(card => card.id === id)!.code;
function action(state: XinjinRound, id: string, type: XinjinAction['type'], face?: number) {
  const found = xinjinLegalActions(state, id).find(candidate => candidate.type === type &&
    (face === undefined || 'cardId' in candidate && code(state, candidate.cardId) === face ||
      'cardIds' in candidate && candidate.cardIds.some(cardId => code(state, cardId) === face)));
  assert.ok(found, `Missing ${id} ${type} ${face ?? ''}`);
  return found;
}
function apply(state: XinjinRound, id: string, selected: XinjinAction): XinjinRound {
  const before = structuredClone(state);
  const result = applyXinjinAction(state, id, selected);
  assert.deepEqual(state, before);
  assertXinjinRound(result.snapshot as XinjinRound);
  return result.snapshot as XinjinRound;
}
function run(state: XinjinRound, id: string, type: XinjinAction['type'], face?: number) {
  return apply(state, id, action(state, id, type, face));
}
function passAll(state: XinjinRound) {
  while (state.phase === 'response') {
    const next = state.players.find(item => xinjinLegalActions(state, item.userId).length);
    assert.ok(next);
    const pass = xinjinLegalActions(state, next.userId).find(candidate => candidate.type === 'respond' && candidate.choiceId === null)!;
    state = apply(state, next.userId, pass);
  }
  return state;
}

test('Xinjin round deals 8/7, preserves the pack and exposes only real decisions', () => {
  const state = make([[101, 102, 103, 104, 105, 106, 108, 109], [201, 202, 203, 204, 205, 206, 208]]);
  assert.deepEqual(state.players.map(item => zone(state, `hand:${item.userId}`).length), [8, 7]);
  assert.equal(zone(state, 'deck').length, 40);
  assertCardState(state.cards);
  assert.deepEqual(xinjinLegalActions(state, 'a').map(item => item.type), ['begin']);
  const next = run(state, 'a', 'begin');
  assert.equal(next.phase, 'discard');
  assert.ok(xinjinLegalActions(next, 'a').some(item => item.type === 'discard'));
});

test('Xinjin seven-as-king steals sevens into the reward zone when enabled', () => {
  const state = make([[107, 101, 102, 103, 104, 105, 106, 108], [201, 202, 203, 204, 205, 206, 208]],
    [207, 109, 110], { qiToWang: 1 });
  const next = run(state, 'a', 'begin');
  assert.ok(zone(next, 'bonus:a').map(id => code(next, id)).includes(107));
  assert.equal(zone(next, 'hand:a').length, 8);
  assert.equal(next.phase, 'discard');
});

test('Xinjin chi is limited to the next seat unless self-draw self-eat is enabled', () => {
  const hands = [[105, 101, 102, 103, 104, 106, 107, 108], [209, 202, 203, 204, 205, 206, 207]];
  let state = run(make(hands, [], { ziChi: 0 }), 'a', 'begin');
  state = run(state, 'a', 'discard', 105);
  assert.ok(state.claims!.offers.some(offer => offer.userId === 'b' && (offer.action as XinjinAction).type === 'chi'));
  const deckBefore = zone(state, 'deck').length;
  const chi = state.claims!.offers.find(offer => offer.userId === 'b' && (offer.action as XinjinAction).type === 'chi')!;
  state = apply(state, 'b', { type: 'respond', choiceId: chi.id, decisionId: state.claims!.id });
  assert.equal(state.phase, 'discard');
  assert.equal(zone(state, 'deck').length, deckBefore);
  assert.deepEqual(state.players[1]!.melds.map(meld => meld.kind), ['chi']);
});

test('Xinjin settlement is deterministic and emitted only once with next-round context', () => {
  let state = make([[102, 103, 104, 105, 106, 107, 108, 109], [201, 202, 203, 204, 205, 206, 207]], [], { qia20: 1 });
  state = run(state, 'a', 'begin');
  while (state.phase !== 'finished') {
    const timed = state.players.map(item => xinjinTimedAction(state, item.userId)).find(Boolean)!;
    assert.ok(timed);
    state = apply(state, timed.userId, timed.action as XinjinAction);
  }
  assert.ok(state.outcome);
  assert.equal(state.outcome!.nextRoundContext?.version, state.version);
  assert.equal(state.outcome!.nextRoundContext?.completedRound, 1);
  const totals = state.outcome!.payments.postings.reduce((sum, posting) => sum + Number(posting.amount), 0);
  assert.equal(totals, 0);
  if (state.outcome!.reason === 'hu') {
    assert.ok(state.outcome!.payments.postings.some(posting => Number(posting.amount) !== 0),
      'A win must never settle as an all-zero transfer.');
  }
});

test('Xinjin view hides other hands and remaining deck while showing public melds', () => {
  const state = make([[101, 102, 103, 104, 105, 106, 108, 109], [201, 202, 203, 204, 205, 206, 208]]);
  const view = viewXinjinRound(state, 'b');
  assert.equal(view.cards.find(item => item.id === 'hand:a')!.cards, undefined);
  assert.equal(view.cards.find(item => item.id === 'deck')!.cards, undefined);
  assert.throws(() => viewXinjinRound(state, 'outsider'), { code: 'NOT_ROOM_MEMBER' });
});

for (const count of [2, 3, 4]) for (const wangNum of [3, 5, 6, 9]) {
  test(`Xinjin finite round completes: ${count} players, ${wangNum} kings`, () => {
    const roundInput = input(count, { wangNum, qiToWang: wangNum % 2 });
    let state = createXinjinRound(roundInput, pack(roundInput).map(card => card.id));
    let steps = 0;
    while (state.phase !== 'finished') {
      assert.ok(steps++ < 800, 'Xinjin round must terminate');
      const timed = state.players.map(item => xinjinTimedAction(state, item.userId)).find(Boolean)!;
      assert.ok(timed);
      state = apply(state, timed.userId, timed.action as XinjinAction);
    }
    assert.ok(state.outcome);
    assert.equal(state.cards.pack.length, xinjinPackSpecification(wangNum).reduce((sum, entry) => sum + entry.count, 0));
  });
}
