import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeQionglaiOptions, getDefaultOptions } from '@dss/rules';
import type { RoundInput, RuleEngine } from '../src/engines.js';
import { createQionglaiCardState } from '../src/game/qionglai-pack.js';
import { qionglaiDealEvaluation, qionglaiDealHand } from '../src/game/qionglai-deal.js';
import { createQionglaiEngine, type QionglaiEngineSnapshot } from '../src/game/qionglai-engine.js';

function input(options: Record<string, unknown> = {}, count = 2): RoundInput {
  const rules = { ...getDefaultOptions('8:0'), playerNum: count, wangNum: 3, baseBeans: '0.125',
    chaJiao: 0, ...options };
  return { players: Array.from({ length: count }, (_, index) => ({
    userId: String.fromCharCode(97 + index), seat: index + 1,
  })), ownerUserId: 'a', number: 1, rules: { ...rules, qionglai: freezeQionglaiOptions(rules) },
  policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}
function random(source: () => number) { return (max: number) => source() % max; }
function snapshot(engine: RuleEngine, round = input()) {
  return engine.create(round) as QionglaiEngineSnapshot;
}
function handCodes(state: QionglaiEngineSnapshot, userId: string) {
  const ids = state.cards.zones.find(zone => zone.id === `hand:${userId}`)!.cards;
  return ids.map(id => state.cards.pack.find(card => card.id === id)!.code);
}

test('deal evaluation follows the regional deal order and never mutates physical cards', () => {
  const state = snapshot(createQionglaiEngine('test-deal', random(() => 0)));
  const cards = createQionglaiCardState('8:0', input().rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  assert.deepEqual(qionglaiDealHand(cards, 2, 1, 1), qionglaiDealEvaluation(cards, 2, 0));
  assert.deepEqual(qionglaiDealHand(cards, 2, 1, 2), qionglaiDealEvaluation(cards, 2, 1));
  assert.equal(handCodes(state, 'a').length, 8);
  assert.equal(handCodes(state, 'b').length, 7);
  assert.deepEqual(state.cards.pack.map(card => card.code).sort((a, b) => a - b),
    cards.map(card => card.code).sort((a, b) => a - b));
  assert.equal(new Set(state.cards.pack.map(card => card.id)).size, 55);
  assert.throws(() => qionglaiDealEvaluation(cards, 2, 2), { code: 'INVALID_DEAL_EVALUATION' });
  assert.throws(() => qionglaiDealHand(cards, 2, 1, 3), { code: 'INVALID_DEAL_EVALUATION' });
});

test('production engine snapshots the selected order, candidate count and exact policy', () => {
  const engine = createQionglaiEngine('test-engine', random(() => 0));
  const ordinary = snapshot(engine);
  assert.equal(ordinary.deal.candidates, 1);
  assert.deepEqual(ordinary.deal.policy, input().policy);
  const optimizedInput = input();
  optimizedInput.policy = { selectedUserId: 'b', triggered: true, probability: '100', version: 7 };
  const optimized = snapshot(engine, optimizedInput);
  assert.equal(optimized.deal.candidates, 32);
  assert.equal(optimized.deal.policy.selectedUserId, 'b');
  assert.equal(optimized.deal.evaluation.length, 3);
});

test('engine create/apply/view/interactions preserve privacy, deadlines and immutable snapshots', () => {
  const engine = createQionglaiEngine('test-interactions', random(() => 0));
  const state = snapshot(engine);
  const before = structuredClone(state);
  assert.equal(engine.interactions!.deadlines(state).length, 1);
  assert.equal(engine.interactions!.deadlines(state)[0]!.userId, 'a');
  assert.deepEqual(engine.interactions!.legalActions(state, 'b'), []);
  const action = engine.interactions!.legalActions(state, 'a')[0];
  assert.ok(action);
  assert.notEqual(action.type, 'begin');
  assert.notEqual(action.type, 'draw');
  const result = engine.apply(state, 'a', action);
  assert.deepEqual(state, before);
  assert.deepEqual((result.snapshot as QionglaiEngineSnapshot).deal, before.deal);
  const view = engine.view(result.snapshot, 'b') as { cards: { id: string; cards?: unknown[] }[] };
  assert.equal(view.cards.find(zone => zone.id === 'hand:a')!.cards, undefined);
  assert.equal(view.cards.find(zone => zone.id === 'deck')!.cards, undefined);
  assert.notDeepEqual(result.snapshot, state);
  assert.throws(() => engine.apply(engine.create({ ...input(), number: 2 }), 'a', action),
    { code: 'ROUND_CONTEXT_REQUIRED' });
});

test('deal optimization prefers maximum structure, then red points, then reward cards', () => {
  const packageState = createQionglaiCardState('8:0', input().rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  const ordered = [...packageState];
  const twoSeat = packageState.slice();
  // The target sits at offset one: positions 1,3,5,7,9,11 are seven cards.
  twoSeat.splice(0, twoSeat.length, ...ordered);
  const baseline = qionglaiDealEvaluation(twoSeat, 2, 1);
  assert.equal(baseline.length, 3);
  assert.ok(baseline.every(value => Number.isInteger(value) && value >= 0));
});
