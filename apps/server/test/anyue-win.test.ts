import test from 'node:test';
import assert from 'node:assert/strict';
import { ANYUE_INDEPENDENT_VERSION, getDefaultOptions } from '@dss/rules';
import { evaluateAnyueWin, type AnyueHand, type AnyueWinContext } from '../src/game/anyue-win.js';

function rules(overrides: Record<string, unknown> = {}) {
  const base = { ...getDefaultOptions('5:0'), wangNum: 3, maxFan: 99, chengFan: 0,
    zhuangJiadi: 0, cheLong: 0, ...overrides };
  return { ...base, anyue: { rulesVersion: ANYUE_INDEPENDENT_VERSION } };
}
function hand(codes: number[], bonus: number[] = []): AnyueHand {
  let id = 0;
  const cards = (values: number[]) => values.map(code => ({ id: `ay-${++id}`, code }));
  return { concealed: cards(codes), melds: [], bonus: cards(bonus) };
}
function context(overrides: Partial<AnyueWinContext> = {}): AnyueWinContext {
  return { winnerSeat: 1, dealerSeat: 1, source: 'flip', sourceSeat: 1, incomingCardId: null,
    discardCount: 0, piaoWinner: 0, piaoPayer: 0, ...overrides };
}
const incoming = (state: AnyueHand) => state.concealed[0]!.id;

test('Anyue ordinary red20 win scores with the frozen piao formula', () => {
  const state = hand([110, 204, 309, 205, 101, 413, 206, 408], [1001, 1002]);
  const result = evaluateAnyueWin(state, context({ incomingCardId: incoming(state),
    source: 'replacement', piaoWinner: 1, piaoPayer: 1 }), rules({ kingFan: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.equal(result.redPoints, 20);
  assert.deepEqual(result.items.map(item => item.pattern), ['bonus']);
  assert.equal(result.totalFan, 2);
  assert.equal(result.unitBase, 3);
  assert.equal(result.scoreUnits, '5');
});

test('Anyue full-red/full-black and four-pairs patterns stack when enabled', () => {
  const pairs = hand([105, 205, 305, 405, 109, 209, 309, 409]);
  const result = evaluateAnyueWin(pairs, context({ incomingCardId: incoming(pairs) }), rules({ anDui: 1, quanHongHei: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.deepEqual(Object.fromEntries(result.items.map(item => [item.pattern, item.fan])), { anDui: 3 });
  const mixed = hand([101, 313, 102, 312, 103, 311, 104, 310]);
  const full = evaluateAnyueWin(mixed, context({ incomingCardId: incoming(mixed) }), rules({ quanHongHei: 1 }));
  assert.equal(full.status, 'winning');
  if (full.status === 'winning') assert.deepEqual(full.items.map(item => item.pattern), ['quanHongHei']);
});

test('Anyue return/chip rules add exactly one fan and never substitute Qionglai amounts', () => {
  const state = hand([110, 204, 309, 205, 101, 413, 206, 408], [1001, 1002]);
  const result = evaluateAnyueWin(state, context({ incomingCardId: incoming(state), source: 'replacement',
    sourceSeat: 1, dealerSeat: 1 }), rules({ zhuangJiadi: 1, cheLong: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.deepEqual(Object.fromEntries(result.items.map(item => [item.pattern, item.fan])), { bonus: 2, zhuangJiadi: 1, cheLong: 1 });
  assert.equal(result.totalFan, 4);
});

test('Anyue validates pack copies, rule version and red-20 threshold', () => {
  const state = hand([210, 204, 309, 205, 301, 413, 206, 208]);
  assert.equal(evaluateAnyueWin(state, context({ incomingCardId: incoming(state) }), rules()).status, 'not-winning');
  const duplicate = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  duplicate.concealed[1]!.id = duplicate.concealed[0]!.id;
  assert.throws(() => evaluateAnyueWin(duplicate, context({ incomingCardId: duplicate.concealed[0]!.id }), rules()),
    { code: 'INVALID_ANYUE_HAND' });
  assert.throws(() => evaluateAnyueWin(hand([110, 204, 309, 205, 101, 413, 206, 408]),
    context({ incomingCardId: 'missing' }), rules()), { code: 'INVALID_RULE_FACTS' });
});
