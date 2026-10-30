import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultOptions, SCORE_REGION_VERSIONS } from '@dss/rules';
import { evaluateRedRegionWin } from '../src/game/red-region-win.js';
import { regionalPackSpecification, regionalScoreUnits } from '../src/game/regional-profile.js';
import type { ScoreRegionContext, ScoreRegionHand } from '../src/game/score-region-win.js';

function hand(codes: number[]): ScoreRegionHand {
  return { concealed: codes.map((code, index) => ({ id: `r-${index}`, code })), melds: [], bonus: [] };
}
function rules(variantKey: keyof typeof SCORE_REGION_VERSIONS, overrides: Record<string, unknown> = {}) {
  return { ...getDefaultOptions(variantKey), ...overrides,
    scoreRegion: { rulesVersion: SCORE_REGION_VERSIONS[variantKey] } };
}
function context(overrides: Partial<ScoreRegionContext> = {}): ScoreRegionContext {
  return { winnerSeat: 1, dealerSeat: 1, source: 'flip', sourceSeat: 1,
    incomingCardId: 'r-0', discardCount: 0, ...overrides };
}
const incoming = (state: ScoreRegionHand) => state.concealed[0]!.id;

test('Rongxian over-cap scoring uses total fan, not the capped fan', () => {
  const options = { maxFan: 3, chaoFanJiaDi: 1 };
  assert.equal(regionalScoreUnits('20:0', options, 2), 4n);
  assert.equal(regionalScoreUnits('20:0', options, 3), 8n);
  assert.equal(regionalScoreUnits('20:0', options, 6), 11n);
});

test('Ganluo keeps over-cap points outside the base multiplier', () => {
  const state = hand([110, 104, 309, 205, 201, 213, 206, 208]);
  const result = evaluateRedRegionWin(state, context({ source: 'flip' }),
    rules('26:0', { maxFan: 4, chaoFanJiaDi: 1, red50: 0 }), '26:0');
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') {
    assert.deepEqual(result.scoreRatio, {
      numerator: String(2 ** Math.min(result.totalFan, 4)),
      denominator: '1',
      applyBase: true,
      additiveUnits: String(Math.max(result.totalFan - 4, 0)),
    });
  }
});

test('Yuexi refuses the first discard when diHu is disabled', () => {
  const state = hand([110, 204, 309, 205, 201, 213, 206, 208]);
  const result = evaluateRedRegionWin(state, context({ source: 'discard', discardCount: 1, sourceSeat: 2 }),
    rules('21:0', { diHuChuDiyizhang: 0 }), '21:0');
  assert.equal(result.status, 'not-winning');
});

test('Xuzhou zero-wildcard bonus cards score without requiring a wildcard in hand', () => {
  const state: ScoreRegionHand = {
    concealed: [110, 104, 309, 205, 201, 213, 206, 208].map((code, index) => ({ id: `r-${index}`, code })),
    melds: [],
    bonus: [{ id: 'bonus-1', code: 1001 }, { id: 'bonus-2', code: 1002 }, { id: 'bonus-3', code: 1003 }],
  };
  const result = evaluateRedRegionWin(state, context({ source: 'flip' }), rules('23:0', { wangNum: 0 }), '23:0');
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') {
    assert.deepEqual(result.items.find(item => item.pattern === 'wildReplacement'),
      { pattern: 'wildReplacement', count: 1, fan: 3 });
    assert.equal(result.totalFan, 3);
  }
});

test('Leibo zero-wildcard keeps the white face and scores each reward card plus diHu', () => {
  const state: ScoreRegionHand = {
    concealed: [110, 104, 309, 205, 201, 213, 206, 208].map((code, index) => ({ id: `r-${index}`, code })),
    melds: [],
    bonus: [{ id: 'bonus-1', code: 1001 }, { id: 'bonus-2', code: 1002 }, { id: 'bonus-3', code: 1003 }],
  };
  const options = rules('24:0', { wangNum: 0, tianHu: 1, quanHongHei: 0 });
  const pack = regionalPackSpecification('24:0', options);
  assert.equal(pack.reduce((sum, entry) => sum + entry.count, 0), 55);
  assert.deepEqual([1001, 1002, 1003].map(code => pack.find(entry => entry.code === code)?.count), [1, 1, 1]);
  const result = evaluateRedRegionWin(state,
    context({ source: 'discard', sourceSeat: 2, discardCount: 1 }), options, '24:0');
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') {
    assert.deepEqual(result.items.filter(item => ['bonus', 'diHu'].includes(item.pattern)),
      [{ pattern: 'diHu', count: 1, fan: 2 }, { pattern: 'bonus', count: 1, fan: 3 }]);
    assert.equal(result.totalFan, 5);
  }
});

test('Ganluo gangHua requires the winner replacement after a gang or ba', () => {
  const state = hand([110, 104, 309, 205, 201, 213, 206, 208]);
  const options = rules('26:0', { gangHua: 1, gangPao: 0, anDui: 0, siGuiYi: 0 });
  const valid = evaluateRedRegionWin(state,
    context({ source: 'replacement', sourceSeat: 1, afterGang: true }), options, '26:0');
  assert.equal(valid.status, 'winning');
  if (valid.status === 'winning') {
    assert.deepEqual(valid.items.find(item => item.pattern === 'gangHua'), { pattern: 'gangHua', count: 1, fan: 1 });
  }
  for (const invalidContext of [
    context({ source: 'replacement', sourceSeat: 1 }),
    context({ source: 'replacement', sourceSeat: 1, afterGang: false }),
    context({ source: 'replacement', sourceSeat: 2, afterGang: true }),
  ]) {
    const invalid = evaluateRedRegionWin(state, invalidContext, options, '26:0');
    assert.equal(invalid.status, 'winning');
    if (invalid.status === 'winning') assert.equal(invalid.items.some(item => item.pattern === 'gangHua'), false);
  }
});

test('Ganluo gangPao uses the after-gang discard fact without a dealer approximation', () => {
  const state = hand([110, 104, 309, 205, 201, 213, 206, 208]);
  const options = rules('26:0', { gangHua: 0, gangPao: 1, anDui: 0, siGuiYi: 0 });
  const valid = evaluateRedRegionWin(state,
    context({ source: 'discard', sourceSeat: 2, dealerSeat: 2, discardCount: 2, afterGang: true }), options, '26:0');
  assert.equal(valid.status, 'winning');
  if (valid.status === 'winning') {
    assert.deepEqual(valid.items.find(item => item.pattern === 'gangPao'), { pattern: 'gangPao', count: 1, fan: 1 });
  }
  const invalid = evaluateRedRegionWin(state,
    context({ source: 'discard', sourceSeat: 1, dealerSeat: 2, discardCount: 2, afterGang: false }), options, '26:0');
  assert.equal(invalid.status, 'winning');
  if (invalid.status === 'winning') assert.equal(invalid.items.some(item => item.pattern === 'gangPao'), false);
});

test('Ganluo siGuiYi counts three exposed plus one concealed as one natural quad', () => {
  const state: ScoreRegionHand = {
    concealed: [405, 109, 110, 104, 101, 113].map((code, index) => ({ id: `s-${index}`, code })),
    melds: [{ kind: 'peng', cards: [105, 205, 305].map((code, index) => ({ id: `m-${index}`, code })) }],
    bonus: [],
  };
  const result = evaluateRedRegionWin(state,
    context({ source: 'discard', sourceSeat: 2, incomingCardId: 's-0', discardCount: 1 }),
    rules('26:0', { siGuiYi: 1, anDui: 0 }), '26:0');
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') {
    assert.deepEqual(result.items.find(item => item.pattern === 'siGuiYi'), { pattern: 'siGuiYi', count: 1, fan: 2 });
  }
});

test('Ganluo four-pairs scores anDui plus dragons and does not double-count dragons as siGuiYi', () => {
  const state = hand([105, 205, 305, 405, 109, 209, 110, 310]);
  const result = evaluateRedRegionWin(state,
    context({ incomingCardId: state.concealed[0]!.id }),
    rules('26:0', { anDui: 1, siGuiYi: 1 }), '26:0');
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.equal(result.structure, 'four-pairs');
  assert.deepEqual(result.items, [
    { pattern: 'anDui', count: 1, fan: 2 },
    { pattern: 'dragon', count: 1, fan: 2 },
  ]);
  assert.equal(result.totalFan, 4);
  assert.equal(result.items.some(item => item.pattern === 'siGuiYi'), false);
});
