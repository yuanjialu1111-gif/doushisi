import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultOptions, XINJIN_INDEPENDENT_VERSION } from '@dss/rules';
import { evaluateXinjinWin, type XinjinHand, type XinjinWinContext } from '../src/game/xinjin-win.js';

function rules(overrides: Record<string, unknown> = {}) {
  const base = { ...getDefaultOptions('4:0'), wangNum: 3, maxFan: 99, chengFan: 0, ...overrides };
  return { ...base, xinjin: { rulesVersion: XINJIN_INDEPENDENT_VERSION } };
}
function hand(codes: number[], bonus: number[] = []): XinjinHand {
  let id = 0;
  const cards = (values: number[]) => values.map(code => ({ id: `xj-${++id}`, code }));
  return { concealed: cards(codes), melds: [], bonus: cards(bonus) };
}
function context(overrides: Partial<XinjinWinContext> = {}): XinjinWinContext {
  return { winnerSeat: 1, dealerSeat: 1, source: 'flip', sourceSeat: 1, incomingCardId: null, discardCount: 0, ...overrides };
}
const incoming = (state: XinjinHand) => state.concealed[0]!.id;

test('Xinjin ordinary red20 win applies qia20 one fan and the selected fan method', () => {
  const state = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const result = evaluateXinjinWin(state, context({ incomingCardId: incoming(state) }), rules({ qia20: 1, chengFan: 0 }));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.equal(result.redPoints, 20);
  assert.deepEqual(result.items.map(item => item.pattern), ['qia20']);
  assert.equal(result.totalFan, 1);
  assert.equal(result.scoreUnits, '2');
});

test('Xinjin seven-as-king counts each stolen seven and honors exponential/capped scoring', () => {
  const state = hand([110, 204, 309, 205, 101, 413, 206, 408], [107, 207]);
  const result = evaluateXinjinWin(state, context({ incomingCardId: incoming(state), source: 'replacement' }),
    rules({ qiToWang: 1, qia20: 1, maxFan: 4, chengFan: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.deepEqual(Object.fromEntries(result.items.map(item => [item.pattern, item.fan])), { qiToWang: 2, qia20: 1 });
  assert.equal(result.totalFan, 3);
  assert.equal(result.cappedFan, 3);
  assert.equal(result.scoreUnits, '8');
});

test('Xinjin four-pairs adds anDui and long-dui, while red40/50 are mutually exclusive', () => {
  const pairs = hand([105, 205, 305, 405, 109, 209, 309, 409]);
  const result = evaluateXinjinWin(pairs, context({ incomingCardId: incoming(pairs) }), rules({ anDui: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.deepEqual(Object.fromEntries(result.items.map(item => [item.pattern, item.fan])), { anDui: 3 });
  const high = hand([101, 413]);
  high.melds = [
    { kind: 'chi', cards: [{ id: 'm1', code: 109 }, { id: 'm2', code: 305 }] },
    { kind: 'chi', cards: [{ id: 'm3', code: 110 }, { id: 'm4', code: 304 }] },
    { kind: 'chi', cards: [{ id: 'm5', code: 108 }, { id: 'm6', code: 306 }] },
  ];
  const red50 = evaluateXinjinWin(high, context({ incomingCardId: high.concealed[1]!.id }), rules({ qia40: 1, qia50: 1 }));
  assert.equal(red50.status, 'winning');
  if (red50.status !== 'winning') return;
  assert.equal(red50.redPoints, 43);
  assert.deepEqual(Object.fromEntries(red50.items.map(item => [item.pattern, item.fan])), { qia40: 2 });
});

test('Xinjin does not score the same four copies twice as dragon and four-return', () => {
  const state: XinjinHand = {
    concealed: [
      { id: 'a1', code: 101 }, { id: 'a2', code: 201 }, { id: 'a3', code: 301 }, { id: 'a4', code: 401 },
      { id: 'b1', code: 109 }, { id: 'b2', code: 209 }, { id: 'b3', code: 309 }, { id: 'b4', code: 409 },
    ],
    melds: [], bonus: [],
  };
  const result = evaluateXinjinWin(state, context({ incomingCardId: incoming(state) }), rules({ longDui: 1, siGuiYi: 1, anDui: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') {
    assert.equal(result.items.filter(item => item.pattern === 'longDui').length, 1);
    assert.equal(result.items.filter(item => item.pattern === 'siGuiYi').length, 0);
  }
});

test('Xinjin five-small checks every ordinary rank and rejects below twenty red', () => {
  const small = hand([101, 413, 102, 412, 103, 411, 203, 211]);
  const result = evaluateXinjinWin(small, context({ incomingCardId: incoming(small) }), rules({ xiaoHu: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.ok(result.items.some(item => item.pattern === 'xiaoHu'));
  const low = hand([210, 204, 309, 205, 301, 413, 206, 208]);
  assert.equal(evaluateXinjinWin(low, context({ incomingCardId: incoming(low) }), rules()).status, 'not-winning');
});

test('Xinjin validates physical copies, versions and incoming source', () => {
  const state = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const duplicate = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  duplicate.concealed[1]!.id = duplicate.concealed[0]!.id;
  assert.throws(() => evaluateXinjinWin(duplicate, context({ incomingCardId: duplicate.concealed[0]!.id }), rules()),
    { code: 'INVALID_XINJIN_HAND' });
  assert.throws(() => evaluateXinjinWin(state, context({ incomingCardId: incoming(state) }), { ...rules(), xinjin: {} }),
    { code: 'XINJIN_RULES_VERSION_REQUIRED' });
  assert.throws(() => evaluateXinjinWin(state, context({ incomingCardId: 'missing' }), rules()),
    { code: 'INVALID_RULE_FACTS' });
});

test('Xinjin scoring adds the baoJiao fan from the declaration context', () => {
  const state = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const result = evaluateXinjinWin(state,
    context({ incomingCardId: incoming(state), source: 'replacement', baoJiao: true }), rules({ qia20: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') assert.deepEqual(result.items.find(item => item.pattern === 'baoJiao'), { pattern: 'baoJiao', count: 1, fan: 1 });
});

test('Xinjin zero-fan legal structure wins as one unit and still requires twenty red', () => {
  const state = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const result = evaluateXinjinWin(state, context({ incomingCardId: incoming(state) }), rules());
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.equal(result.redPoints, 20);
  assert.equal(result.totalFan, 0);
  assert.equal(result.cappedFan, 0);
  assert.equal(result.scoreUnits, '1');
  const low = hand([210, 204, 309, 205, 301, 413, 206, 208]);
  const rejected = evaluateXinjinWin(low, context({ incomingCardId: incoming(low) }), rules());
  assert.equal(rejected.status, 'not-winning');
  if (rejected.status === 'not-winning') assert.equal(rejected.reason, 'points');
  const scored = evaluateXinjinWin(state, context({ incomingCardId: incoming(state) }), rules({ qia20: 1 }));
  assert.equal(scored.status, 'winning');
  if (scored.status === 'winning') assert.equal(scored.scoreUnits, '2');
});
