import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeXinjinOptions, getDefaultOptions } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { applyXinjinAction, assertXinjinRound, createXinjinRound, viewXinjinRound, xinjinLegalActions, type XinjinRound } from '../src/game/xinjin-round.js';
import { createXinjinCardState } from '../src/game/xinjin-pack.js';

function input(overrides: Record<string, unknown> = {}): RoundInput {
  const rules = { ...getDefaultOptions('4:0'), playerNum: 2, gameNum: 4, wangNum: 3, baseBeans: '0.125', qiToWang: 0, ziChi: 0, baoJiao: 0, qia20: 1, ...overrides };
  return { players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }], ownerUserId: 'a', number: 1,
    rules: { ...rules, xinjin: freezeXinjinOptions(rules) }, policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}
function create(overrides: Record<string, unknown> = {}): XinjinRound {
  const round = input(overrides);
  const pack = createXinjinCardState('4:0', round.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  return createXinjinRound(round, pack.map(card => card.id));
}

test('Xinjin creation accepts numeric baoJiao and initializes paired snapshots to null', () => {
  const state = create({ baoJiao: 1 });
  assert.deepEqual(state.players.map(player => [player.declaredWaits, player.declaredBonusIds]), [[null, null], [null, null]]);
});
test('baoJiao zero exposes no declare and boolean values are rejected', () => {
  const state = create();
  const begin = xinjinLegalActions(state, 'a').find(action => action.type === 'begin')!;
  const next = applyXinjinAction(state, 'a', begin).snapshot as XinjinRound;
  assert.ok(xinjinLegalActions(next, 'a').every(action => action.type !== 'declare'));
  assert.throws(() => create({ baoJiao: true }), { code: 'INVALID_XINJIN_OPTION', statusCode: 409 });
});
test('historical snapshots without declaration fields are normalized, while malformed pairs fail', () => {
  const state = create();
  for (const current of state.players) { delete (current as Partial<typeof current>).declaredWaits; delete (current as Partial<typeof current>).declaredBonusIds; }
  assert.doesNotThrow(() => assertXinjinRound(state));
  const begin = xinjinLegalActions(state, 'a').find(action => action.type === 'begin')!;
  const normalized = applyXinjinAction(state, 'a', begin).snapshot as XinjinRound;
  assert.deepEqual(normalized.players.map(player => [player.declaredWaits, player.declaredBonusIds]), [[null, null], [null, null]]);

  for (const mutate of [
    (round: XinjinRound) => { (round.players[0] as Partial<typeof round.players[0]>).declaredWaits = undefined; },
    (round: XinjinRound) => { (round.players[0] as Partial<typeof round.players[0]>).declaredBonusIds = undefined; },
    (round: XinjinRound) => { round.players[0]!.declaredWaits = []; },
    (round: XinjinRound) => { round.players[0]!.declaredWaits = [0]; },
    (round: XinjinRound) => { round.players[0]!.declaredWaits = [102, 102]; round.players[0]!.declaredBonusIds = []; },
    (round: XinjinRound) => { round.players[0]!.declaredWaits = [102]; round.players[0]!.declaredBonusIds = ['missing-card']; },
    (round: XinjinRound) => { round.players[0]!.declaredWaits = [102]; round.players[0]!.declaredBonusIds = ['card-1']; },
    (round: XinjinRound) => { round.players[0]!.declaredWaits = [102]; round.players[0]!.declaredBonusIds = ['missing-card', 'missing-card']; },
  ]) {
    const malformed = create(); mutate(malformed);
    assert.throws(() => assertXinjinRound(malformed), { code: 'INVALID_XINJIN_STATE', statusCode: 500 });
  }
});
test('views expose declaration state publicly but keep frozen waits private', () => {
  const state = create({ baoJiao: 1 });
  const begin = xinjinLegalActions(state, 'a').find(action => action.type === 'begin')!;
  const next = applyXinjinAction(state, 'a', begin).snapshot as XinjinRound;
  next.players[0]!.declaredWaits = [102];
  next.players[0]!.declaredBonusIds = [];
  const own = viewXinjinRound(next, 'a').players[0]!;
  const opponent = viewXinjinRound(next, 'b').players[0]!;
  assert.equal(own.declared, true);
  assert.deepEqual(own.declaredWaits, [102]);
  assert.equal(opponent.declared, true);
  assert.equal(Object.hasOwn(opponent, 'declaredWaits'), false);
});
test('declaration action is part of the frozen Xinjin action model', () => {
  const state = create({ baoJiao: 1 });
  const begin = xinjinLegalActions(state, 'a').find(action => action.type === 'begin')!;
  const next = applyXinjinAction(state, 'a', begin).snapshot as XinjinRound;
  assert.ok(xinjinLegalActions(next, 'a').every(action => action.type === 'discard' || action.type === 'declare' || action.type === 'hu'));
});
