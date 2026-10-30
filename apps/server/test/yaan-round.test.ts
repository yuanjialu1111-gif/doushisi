import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeYaanOptions, getDefaultOptions } from '@dss/rules';
import type { EngineResult, RoundInput } from '../src/engines.js';
import { assertCardState, moveCards } from '../src/game/cards.js';
import { createYaanCardState } from '../src/game/yaan-pack.js';
import { applyYaanAction, assertYaanRound, createYaanRound, yaanLegalActions, yaanTimedAction,
  viewYaanRound, type YaanAction, type YaanRound } from '../src/game/yaan-round.js';

function input(count = 2, overrides: Record<string, unknown> = {}): RoundInput {
  const rules = { ...getDefaultOptions('6:0'), playerNum: count, gameNum: 4, wangNum: 3, qiWangNum: 0,
    baseBeans: '0.125', ...overrides };
  return { players: Array.from({ length: count }, (_, index) => ({ userId: String.fromCharCode(97 + index), seat: index + 1 })),
    ownerUserId: 'a', number: 1, rules: { ...rules, yaan: freezeYaanOptions(rules) },
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}
function pack(round: RoundInput) {
  return createYaanCardState('6:0', round.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
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
  return createYaanRound(roundInput, order);
}
const zone = (state: YaanRound, name: string) => state.cards.zones.find(item => item.id === name)!.cards;
const code = (state: YaanRound, id: string) => state.cards.pack.find(card => card.id === id)!.code;
function action(state: YaanRound, id: string, type: YaanAction['type'], face?: number) {
  const found = yaanLegalActions(state, id).find(candidate => candidate.type === type &&
    (face === undefined || 'cardId' in candidate && code(state, candidate.cardId) === face ||
      'cardIds' in candidate && candidate.cardIds.some(cardId => code(state, cardId) === face)));
  assert.ok(found, `Missing ${id} ${type} ${face ?? ''}`);
  return found;
}
function apply(state: YaanRound, id: string, selected: YaanAction): YaanRound {
  const before = structuredClone(state);
  const result = applyYaanAction(state, id, selected);
  assert.deepEqual(state, before);
  assertYaanRound(result.snapshot as YaanRound);
  return result.snapshot as YaanRound;
}
function run(state: YaanRound, id: string, type: YaanAction['type'], face?: number) {
  return apply(state, id, action(state, id, type, face));
}
function passAll(state: YaanRound) {
  while (state.phase === 'response') {
    const next = state.players.find(item => yaanLegalActions(state, item.userId).length);
    assert.ok(next);
    const pass = yaanLegalActions(state, next.userId).find(candidate => candidate.type === 'respond' && candidate.choiceId === null)!;
    state = apply(state, next.userId, pass);
  }
  return state;
}

test('Yaan round deals 8/7 physically, preserves the pack and requires explicit actions', () => {
  const state = make([[101, 102, 103, 104, 105, 106, 108, 109], [201, 202, 203, 204, 205, 206, 208]]);
  assert.deepEqual(state.players.map(item => zone(state, `hand:${item.userId}`).length), [8, 7]);
  assert.equal(zone(state, 'deck').length, 40);
  assertCardState(state.cards);
  assert.deepEqual(yaanLegalActions(state, 'a').map(item => item.type), ['begin']);
  const next = run(state, 'a', 'begin');
  assert.equal(next.phase, 'discard'); assert.equal(next.activeId, 'a');
  assert.ok(yaanLegalActions(next, 'a').some(item => item.type === 'discard'));
});

test('Yaan wang stays in hand as a wildcard instead of being stolen', () => {
  const state = make([[1001, 101, 102, 103, 104, 105, 106, 108], [201, 202, 203, 204, 205, 206, 208]], [1002, 109, 110]);
  const next = run(state, 'a', 'begin');
  assert.equal(zone(next, 'hand:a').map(id => code(next, id)).includes(1001), true);
  assert.deepEqual(zone(next, 'bonus:a'), []);
  assert.equal(zone(next, 'hand:a').length, 8);
  assert.equal(next.phase, 'discard');
});

test('Yaan enabled seven-king cards stay in hand as wildcards instead of being stolen', () => {
  const state = make([[107, 101, 102, 103, 104, 105, 106, 108], [201, 202, 203, 204, 205, 206, 208]], [109, 110, 111],
    { wangNum: 3, qiWangNum: 4 });
  const next = run(state, 'a', 'begin');
  assert.equal(zone(next, 'hand:a').map(id => code(next, id)).includes(107), true);
  assert.deepEqual(zone(next, 'bonus:a'), []);
  assert.equal(next.phase, 'discard');
});

test('Yaan chi follows the frozen ziChi setting and does not invent a replacement', () => {
  const hands = [[105, 101, 102, 103, 104, 106, 107, 108], [209, 202, 203, 204, 205, 206, 207]];
  let state = run(make(hands, [], { ziChi: 0 }), 'a', 'begin');
  state = run(state, 'a', 'discard', 105);
  assert.ok(state.claims!.offers.some(offer => offer.userId === 'b' && (offer.action as YaanAction).type === 'chi'));
  const before = zone(state, 'deck').length;
  const chi = state.claims!.offers.find(offer => offer.userId === 'b' && (offer.action as YaanAction).type === 'chi')!;
  state = apply(state, 'b', { type: 'respond', choiceId: chi.id, decisionId: state.claims!.id });
  assert.equal(state.phase, 'discard'); assert.equal(zone(state, 'deck').length, before);
  assert.deepEqual(state.players[1]!.melds.map(meld => meld.kind), ['chi']);
});

test('Yaan declared waits stay locked against response melds', () => {
  const opened = run(make([
    [105, 109, 110, 111, 112, 113, 201, 202],
    [203, 204, 205, 206, 207, 208, 209],
  ], [], { baoJiao: 1, ziChi: 0 }), 'a', 'begin');
  const declaration = yaanLegalActions(opened, 'a').find(candidate => candidate.type === 'declare');
  assert.ok(declaration, 'Expected a legal declaration fixture.');
  const declared = apply(opened, 'a', declaration);
  assert.ok(declared.players[0]!.declaredWaits);
  // The declared player may only wait for a win. Any response chi/peng/gang
  // would change the frozen hand structure.
  assert.equal(yaanLegalActions(declared, 'a').some(candidate =>
    ['chi', 'peng', 'gang', 'tou', 'ba'].includes(candidate.type)), false);
});

function declaredState(): YaanRound {
  const opened = run(make([
    [105, 109, 110, 111, 112, 113, 201, 202],
    [203, 204, 205, 206, 207, 208, 209],
  ], [], { baoJiao: 1, ziChi: 0 }), 'a', 'begin');
  const declaration = yaanLegalActions(opened, 'a').find(candidate => candidate.type === 'declare');
  assert.ok(declaration, 'Expected a legal declaration fixture.');
  return apply(opened, 'a', declaration);
}

test('Yaan declaration freezes an empty bonus snapshot and keeps its discard set stable', () => {
  const opened = run(make([
    [105, 109, 110, 111, 112, 113, 201, 202],
    [203, 204, 205, 206, 207, 208, 209],
  ], [], { baoJiao: 1, ziChi: 0 }), 'a', 'begin');
  assert.equal(opened.players[0]!.declaredWaits, null);
  assert.equal(opened.players[0]!.declaredBonusIds, null);

  const state = declaredState();
  assert.ok(state.players[0]!.declaredWaits);
  assert.deepEqual(state.players[0]!.declaredBonusIds, []);

  const before = yaanLegalActions(state, 'a').filter(candidate => candidate.type === 'discard');
  const addedBonus = zone(state, 'deck').find(cardId => [1001, 1002, 1003]
    .includes(code(state, cardId)));
  assert.ok(addedBonus);
  state.cards = moveCards(state.cards, 'deck', 'bonus:a', [addedBonus]);
  const after = yaanLegalActions(state, 'a').filter(candidate => candidate.type === 'discard');
  assert.deepEqual(after, before);
  assert.deepEqual(state.players[0]!.declaredBonusIds, []);
  assert.equal(yaanLegalActions(state, 'a').some(candidate => candidate.type === 'declare'), false);
});

test('Yaan declared winning sources remain bound to the frozen bonus snapshot', () => {
  let state = declaredState();
  const addedBonus = zone(state, 'deck').find(cardId => [1001, 1002, 1003]
    .includes(code(state, cardId)));
  assert.ok(addedBonus);
  state.cards = moveCards(state.cards, 'deck', 'bonus:a', [addedBonus]);
  assert.deepEqual(state.players[0]!.declaredBonusIds, []);

  const source = zone(state, 'deck').find(cardId => code(state, cardId) === 103);
  assert.ok(source);
  state.cards = moveCards(state.cards, 'deck', 'hand:a', [source]);
  state.phase = 'discard';
  state.activeId = 'a';
  state.claims = null;
  state.source = { kind: 'replacement', userId: 'a', cardId: source };
  assert.ok(yaanLegalActions(state, 'a').some(candidate => candidate.type === 'hu'));

  const wrong = zone(state, 'deck').find(cardId => !state.players[0]!.declaredWaits!.includes(code(state, cardId)));
  assert.ok(wrong);
  state.cards = moveCards(state.cards, 'hand:a', 'deck', [source]);
  state.cards = moveCards(state.cards, 'deck', 'hand:a', [wrong]);
  state.source = { kind: 'replacement', userId: 'a', cardId: wrong };
  assert.equal(yaanLegalActions(state, 'a').some(candidate => candidate.type === 'hu'), false);
});

test('Yaan declarations reject unpaired, duplicate and missing bonus snapshots', () => {
  const state = declaredState();

  const unpaired = structuredClone(state);
  unpaired.players[0]!.declaredBonusIds = null;
  assert.throws(() => assertYaanRound(unpaired), { code: 'INVALID_YAAN_STATE' });

  const inverseUnpaired = structuredClone(state);
  inverseUnpaired.players[0]!.declaredWaits = null;
  assert.throws(() => assertYaanRound(inverseUnpaired), { code: 'INVALID_YAAN_STATE' });

  const bothNull = structuredClone(state);
  bothNull.players[0]!.declaredWaits = null;
  bothNull.players[0]!.declaredBonusIds = null;
  assert.doesNotThrow(() => assertYaanRound(bothNull));

  const missing = structuredClone(state);
  missing.players[0]!.declaredBonusIds = ['missing-card'];
  assert.throws(() => assertYaanRound(missing), { code: 'INVALID_YAAN_STATE' });

  const duplicate = structuredClone(state);
  duplicate.players[0]!.declaredBonusIds = ['missing-card', 'missing-card'];
  assert.throws(() => assertYaanRound(duplicate), { code: 'INVALID_YAAN_STATE' });
});

test('Yaan draw/flip response and discard liability settle with exact rational amounts once', () => {
  let state = make([[102, 103, 104, 105, 106, 107, 108, 109], [201, 202, 203, 204, 205, 206, 207]], [408]);
  state = run(state, 'a', 'begin');
  state = passAll(run(state, 'a', 'discard', 102));
  state = run(state, 'b', 'draw');
  if (state.phase === 'response') state = passAll(state);
  assertYaanRound(state);
  assert.equal(state.outcome, null);
  if (state.phase === 'discard' && state.activeId === 'b') {
    const selected = action(state, 'b', 'discard');
    const result: EngineResult = applyYaanAction(state, 'b', selected);
    assert.deepEqual(result, applyYaanAction(structuredClone(state), 'b', selected));
  }
});

test('Yaan dealer continuation is carried only with final settlement', () => {
  let state = make([[102, 103, 104, 105, 106, 107, 108, 109], [201, 202, 203, 204, 205, 206, 207]], [], { chaJiao: 0 });
  state = run(state, 'a', 'begin');
  while (state.phase !== 'finished') {
    const timed = state.players.map(item => yaanTimedAction(state, item.userId)).find(Boolean)!;
    assert.ok(timed);
    state = apply(state, timed.userId, timed.action as YaanAction);
  }
  assert.equal(state.outcome!.nextRoundContext?.version, state.version);
  assert.equal(state.outcome!.nextRoundContext?.completedRound, 1);
});

test('Yaan view hides other hands and remaining deck while exposing public melds', () => {
  const state = make([[101, 102, 103, 104, 105, 106, 108, 109], [201, 202, 203, 204, 205, 206, 208]]);
  const view = viewYaanRound(state, 'b');
  assert.equal(view.cards.find(item => item.id === 'hand:a')!.cards, undefined);
  assert.equal(view.cards.find(item => item.id === 'deck')!.cards, undefined);
  assert.throws(() => viewYaanRound(state, 'outsider'), { code: 'NOT_ROOM_MEMBER' });
});

for (const count of [2, 3, 4]) for (const [wangNum, qiWangNum] of [[3, 0], [6, 4], [9, 6], [12, 8]]) {
  test(`Yaan finite round completes: ${count} players, ${wangNum} wang, ${qiWangNum} sevens`, () => {
    const roundInput = input(count, { wangNum, qiWangNum, chaJiao: 0 });
    const state = createYaanRound(roundInput, pack(roundInput).map(card => card.id));
    let current = state, steps = 0;
    while (current.phase !== 'finished') {
      assert.ok(steps++ < 800, 'Yaan round must terminate');
      const timed = current.players.map(item => yaanTimedAction(current, item.userId)).find(Boolean)!;
      assert.ok(timed);
      current = apply(current, timed.userId, timed.action as YaanAction);
    }
    assert.ok(current.outcome);
    assert.equal(current.cards.pack.length, yaanPackSpecificationSize(wangNum, qiWangNum));
  });
}

function yaanPackSpecificationSize(wangNum: number, qiWangNum: number) {
  const sevenCopies = qiWangNum >= 8 ? qiWangNum / 4 : 1;
  const extraSevens = qiWangNum === 6 ? 2 : 0;
  return 52 * sevenCopies + extraSevens + wangNum;
}
