import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const serverRequire = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const tsxCli = serverRequire.resolve('tsx/cli');

function evaluate(cases) {
  const source = `
    import { evaluateRedRegionWin } from './apps/server/src/game/red-region-win.ts';
    const cases = ${JSON.stringify(cases)};
    const results = cases.map(item => evaluateRedRegionWin(item.hand, item.context, item.rules, item.variantKey));
    process.stdout.write(JSON.stringify(results));
  `;
  const run = spawnSync(process.execPath, [tsxCli, '-e', source], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

function card(id, code) { return { id, code }; }

function rules(variantKey, options = {}) {
  const rulesVersions = {
    '23:0': 'xuzhou-independent-v1',
    '25:0': 'junlian25-independent-v1',
    '26:0': 'ganluo-independent-v1',
    '27:0': 'junlian27-independent-v1',
  };
  return {
    huRedScore: 21,
    qiFanDianNum: 21,
    anDuiFanNum: 6,
    maxFan: 99,
    chaoFanJiaDi: 1,
    wangNum: 0,
    scoreRegion: { rulesVersion: rulesVersions[variantKey] },
    ...options,
  };
}

function context(source, incomingCardId, options = {}) {
  const originalHand = source === 'original-hand';
  return {
    winnerSeat: 1, dealerSeat: 1, source,
    sourceSeat: originalHand ? null : 1,
    incomingCardId: originalHand ? null : incomingCardId,
    discardCount: originalHand ? 0 : 1, ...options,
  };
}

function ordinaryHand(codes, incomingCardId, options = {}) {
  const concealed = codes.map((code, index) => card(`c${index}`, code));
  return {
    hand: { concealed, melds: options.melds ?? [], bonus: [] },
    context: context(options.source ?? 'flip', incomingCardId ?? concealed.at(-1).id, options.context),
  };
}

function patterns(result) {
  if (!Array.isArray(result.items)) {
    throw new Error(`Expected a winning result, received ${result.status}: ${result.reason}`);
  }
  return Object.fromEntries(result.items.map(item => [item.pattern, item.fan]));
}

function winning(result, label = 'hand') {
  assert.equal(result.status, 'winning', `${label}: ${result.reason ?? ''}`);
  return result;
}

function scoreUnits(result) {
  return BigInt(winning(result).scoreUnits);
}

const pair = (redCode, blackCode) => [redCode, blackCode];
const fillers = () => [209, 405, 208, 406, 207, 407];
const mandarinFillers = () => [209, 405, 208, 406, 207, 407];

test('D15 pair table distinguishes open, concealed, and mandarin pairs', () => {
  const pairCases = [
    { name: 'open-six', codes: [...pair(110, 204), ...fillers()], incoming: 'c0', expected: 8, source: 'discard' },
    { name: 'concealed-six', codes: [...pair(110, 204), ...fillers()], incoming: null, expected: 6, source: 'original-hand' },
    { name: 'mandarin-six', codes: [110, 210, 209, 405, 208, 406, 207, 407], incoming: 'c0', expected: 10, source: 'discard' },
    { name: 'open-ten', codes: [...pair(110, 204), ...fillers()], incoming: 'c0', expected: 15, anDuiFanNum: 10, source: 'discard' },
    { name: 'concealed-ten', codes: [...pair(110, 204), ...fillers()], incoming: null, expected: 10, anDuiFanNum: 10, source: 'original-hand' },
    { name: 'mandarin-ten', codes: [110, 210, 209, 405, 208, 406, 207, 407], incoming: 'c0', expected: 14, anDuiFanNum: 10, source: 'discard' },
  ];
  const cases = pairCases.map(item => {
    const built = ordinaryHand(item.codes, item.incoming, { source: item.source });
    return { variantKey: '25:0', ...built,
      rules: rules('25:0', { anDuiFanNum: item.anDuiFanNum ?? 6, yiDianZhu: item.yiDianZhu ?? 1 }) };
  });
  const results = evaluate(cases);
  results.forEach((result, index) => {
    assert.equal(result.status, 'winning', pairCases[index].name);
    assert.equal(result.structureScore, pairCases[index].expected * 10, pairCases[index].name);
    assert.equal(result.scoreUnits, String(2 + pairCases[index].expected * 10), pairCases[index].name);
    assert.equal(result.scoreRatio.numerator, String(2 + pairCases[index].expected * 10), pairCases[index].name);
  });
});

test('D15 pair points, seven-red-seven-black, rob-seven, self-rob, one-red and all-from-others settle exactly', () => {
  const sevenRedSevenBlack = {
    concealed: [card('c0', 110), card('c1', 204)],
    melds: [
      { kind: 'gang', cards: [card('g0', 105), card('g1', 205), card('g2', 305), card('g3', 405)] },
      { kind: 'gang', cards: [card('g4', 106), card('g5', 206), card('g6', 306), card('g7', 406)] },
      { kind: 'gang', cards: [card('g8', 107), card('g9', 207), card('g10', 307), card('g11', 407)] },
    ], bonus: [],
  };
  const allFromOthers = {
    concealed: [card('c0', 110), card('c1', 204)],
    melds: [
      { kind: 'peng', cards: [card('m0', 106), card('m1', 206), card('m2', 306)] },
      { kind: 'peng', cards: [card('m3', 108), card('m4', 208), card('m5', 308)] },
      { kind: 'peng', cards: [card('m6', 112), card('m7', 212), card('m8', 312)] },
    ], bonus: [],
  };
  const cases = [
    {
      variantKey: '25:0', name: 'seven-red-seven-black', hand: sevenRedSevenBlack,
      context: context('original-hand', null),
      rules: rules('25:0', { da_7hong_7hei: 1, yiDianZhu: 0, menQing: 0, quanQiuRen: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).sevenRedSevenBlack, 1);
        assert.equal(result.scoreUnits, '124');
      },
    },
    {
      variantKey: '25:0', name: 'rob-hu',
      ...ordinaryHand([110, 204, 109, 405, 108, 406, 107, 207], 'c6', { source: 'replacement', context: { sourceSeat: 2 } }),
      rules: rules('25:0', { daShaQiangHu: 1, qiang_7Hu: 0, yiDianZhu: 0, menQing: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).qiangHu, 1);
        assert.equal(result.scoreUnits, '240');
      },
    },
    {
      variantKey: '25:0', name: 'rob-seven',
      ...ordinaryHand([110, 204, 109, 405, 108, 406, 107, 207], 'c6', { source: 'replacement', context: { sourceSeat: 2 } }),
      rules: rules('25:0', { daShaQiangHu: 0, qiang_7Hu: 1, yiDianZhu: 0, menQing: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).qiang7, 1);
        assert.equal(result.scoreUnits, '240');
      },
    },
    {
      variantKey: '27:0', name: 'self-rob',
      ...ordinaryHand([110, 204, 309, 205, 308, 206, 107, 207], 'c7', { source: 'flip', context: { sourceSeat: 1 } }),
      rules: rules('27:0', { ziQiangHu: 1, menQing: 0, haiDiLao: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).ziQiangHu, 1);
        // D15: self-rob is one fan; the natural pair structure still contributes
        // its full pair points to the additive settlement ratio (2 + 232 = 234,
        // plus the six-unit self-rob fan = 240).
        assert.equal(result.scoreUnits, '240');
      },
    },
    {
      variantKey: '25:0', name: 'one-red',
      ...ordinaryHand([110, 210, 209, 405, 208, 406, 207, 407], 'c0', { source: 'discard', context: { sourceSeat: 2 } }),
      rules: rules('25:0', { yiDianZhu: 1, menQing: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).oneRed, 1);
        assert.equal(result.scoreUnits, '102');
      },
    },
    {
      variantKey: '25:0', name: 'all-from-others', hand: allFromOthers,
      context: context('discard', 'c1', { sourceSeat: 2 }),
      rules: rules('25:0', { quanQiuRen: 1, menQing: 0, yiDianZhu: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).allFromOthers, 1);
        assert.equal(result.scoreUnits, '96');
      },
    },
    {
      variantKey: '25:0', name: 'rob-hu-and-rob-seven-are-mutually-exclusive',
      ...ordinaryHand([110, 204, 109, 405, 108, 406, 107, 207], 'c6', { source: 'replacement', context: { sourceSeat: 2 } }),
      rules: rules('25:0', { daShaQiangHu: 1, qiang_7Hu: 1, yiDianZhu: 0, menQing: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).qiangHu, 1);
        assert.equal(patterns(result).qiang7, undefined);
      },
    },
    {
      variantKey: '25:0', name: 'seven-red-seven-black-negative',
      hand: { concealed: [card('c0', 110), card('c1', 204), card('c2', 109), card('c3', 405),
        card('c4', 108), card('c5', 406), card('c6', 107), card('c7', 207)], melds: [], bonus: [] },
      context: context('flip', 'c7', { sourceSeat: 1 }),
      rules: rules('25:0', { da_7hong_7hei: 1, huRedScore: 21, yiDianZhu: 0, menQing: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).sevenRedSevenBlack, undefined);
      },
    },
  ];
  const results = evaluate(cases);
  results.forEach((result, index) => cases[index].expect(result));
});

test('D15 rejects same-seat rob-seven and wildcard-only all-from-others', () => {
  const wildcardPair = {
    concealed: [card('c0', 110), card('c1', 1003), card('c2', 109), card('c3', 405),
      card('c4', 108), card('c5', 406), card('c6', 107), card('c7', 207)], melds: [], bonus: [],
  };
  const wildcardAllFromOthers = {
    concealed: [card('c0', 110), card('c1', 1003)],
    melds: [
      { kind: 'peng', cards: [card('m0', 106), card('m1', 206), card('m2', 306)] },
      { kind: 'peng', cards: [card('m3', 108), card('m4', 208), card('m5', 308)] },
      { kind: 'peng', cards: [card('m6', 112), card('m7', 212), card('m8', 312)] },
    ], bonus: [],
  };
  const cases = [
    {
      variantKey: '25:0', name: 'same-seat-rob-seven-is-not-robbery',
      ...ordinaryHand([110, 204, 109, 405, 108, 406, 107, 207], 'c6', { source: 'replacement', context: { sourceSeat: 1 } }),
      rules: rules('25:0', { daShaQiangHu: 0, qiang_7Hu: 1, yiDianZhu: 0, menQing: 0 }),
      expect: result => { winning(result); assert.equal(patterns(result).qiang7, undefined); },
    },
    {
      variantKey: '25:0', name: 'wildcard-all-from-others-is-not-natural', hand: wildcardAllFromOthers,
      context: context('discard', 'c1', { sourceSeat: 2 }),
      rules: rules('25:0', { wangNum: 1, quanQiuRen: 1, yiDianZhu: 0, menQing: 0 }),
      expect: result => { winning(result); assert.equal(patterns(result).allFromOthers, undefined); },
    },
    {
      variantKey: '25:0', name: 'wildcard-pair-does-not-crash', hand: wildcardPair,
      context: context('flip', 'c1', { sourceSeat: 1 }),
      rules: rules('25:0', { wangNum: 1, yiDianZhu: 0, menQing: 0 }),
      expect: result => { winning(result); assert.equal(result.scoreUnits, '256'); },
    },
  ];
  const results = evaluate(cases);
  results.forEach((result, index) => cases[index].expect(result));
});

test('26:0 anDui, gangPao and siGuiYi branches stay distinct', () => {
  const cases = [
    {
      variantKey: '26:0', name: 'an-dui-two-dragons',
      ...ordinaryHand([105, 205, 305, 405, 109, 209, 110, 310], 'c7', { source: 'discard', context: { sourceSeat: 2 } }),
      rules: rules('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4, anDui: 1, siGuiYi: 0, gangPao: 0, gangHua: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).anDui, 2);
        assert.equal(patterns(result).dragon, 4);
        assert.equal(result.scoreUnits, '16');
      },
    },
    {
      variantKey: '26:0', name: 'si-gui-yi-exposed-three-plus-concealed',
      hand: { concealed: [card('c0', 405), card('c1', 109), card('c2', 110), card('c3', 104),
        card('c4', 101), card('c5', 113)],
        melds: [{ kind: 'peng', cards: [card('m0', 105), card('m1', 205), card('m2', 305)] }], bonus: [] },
      context: context('discard', 'c3', { sourceSeat: 2 }),
      rules: rules('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4, anDui: 0, siGuiYi: 1 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).siGuiYi, 2);
        assert.equal(result.scoreUnits, '4');
      },
    },
    {
      variantKey: '26:0', name: 'si-gui-yi-concealed-quad-without-an-dui',
      ...ordinaryHand([107, 207, 307, 407, 110, 204, 108, 206], 'c7', { source: 'discard', context: { sourceSeat: 2 } }),
      rules: rules('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4, anDui: 0, siGuiYi: 1 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).siGuiYi, 2);
        assert.equal(result.scoreUnits, '4');
      },
    },
    {
      variantKey: '26:0', name: 'si-gui-yi-concealed-quad-not-duplicated-as-dragon',
      ...ordinaryHand([107, 207, 307, 407, 110, 204, 108, 206], 'c7', { source: 'discard', context: { sourceSeat: 2 } }),
      rules: rules('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4, anDui: 1, siGuiYi: 1 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).siGuiYi, undefined);
        assert.equal(patterns(result).dragon, 2);
        assert.equal(result.scoreUnits, '16');
      },
    },
    {
      variantKey: '26:0', name: 'eight-same-rank-cards-form-two-dragons',
      ...ordinaryHand([107, 207, 307, 407, 107, 207, 307, 407], 'c7', { source: 'discard', context: { sourceSeat: 2 } }),
      rules: rules('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4, anDui: 1, siGuiYi: 1 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).anDui, 2);
        assert.equal(patterns(result).dragon, 4);
        assert.equal(result.totalFan, 6);
        assert.equal(result.cappedFan, 4);
        assert.equal(result.scoreUnits, '16');
      },
    },
    {
      variantKey: '26:0', name: 'eight-same-rank-cards-form-four-dragons-without-si-gui-yi',
      ...ordinaryHand([107, 207, 307, 407, 107, 207, 307, 407], 'c7', { source: 'discard', context: { sourceSeat: 2 } }),
      rules: rules('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 99, anDui: 1, siGuiYi: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).anDui, 2);
        assert.equal(patterns(result).dragon, 8);
        assert.equal(result.totalFan, 10);
      },
    },
    {
      variantKey: '26:0', name: 'concealed-quad-still-counts-si-gui-yi-with-an-dui-on-ordinary-structure',
      hand: { concealed: [card('c0', 107), card('c1', 207), card('c2', 307), card('c3', 407),
        card('c4', 110), card('c5', 104)],
        melds: [{ kind: 'peng', cards: [card('m0', 105), card('m1', 205), card('m2', 305)] }], bonus: [] },
      context: context('discard', 'c5', { sourceSeat: 2 }),
      rules: rules('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4, anDui: 1, siGuiYi: 1 }),
      expect: result => {
        winning(result);
        assert.equal(result.structure, 'ordinary');
        assert.equal(patterns(result).siGuiYi, 2);
        assert.equal(result.scoreUnits, '4');
      },
    },
    {
      variantKey: '26:0', name: 'gang-pao-requires-after-gang-discard',
      ...ordinaryHand([110, 204, 309, 205, 308, 206, 107, 207], 'c7', { source: 'discard', context: { sourceSeat: 2 } }),
      rules: rules('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4, gangPao: 1, gangHua: 0, anDui: 0, siGuiYi: 0 }),
      expect: result => {
        winning(result);
        assert.equal(patterns(result).gangPao, undefined);
      },
    },
  ];
  const results = evaluate(cases);
  results.forEach((result, index) => cases[index].expect(result));
});

test('25:0 conditional fans require their independent facts and threshold exemptions', () => {
  const cases = [
    {
      variantKey: '25:0',
      name: 'one-red-exempts-threshold',
      hand: { concealed: [card('c0', 110), card('c1', 210), card('c2', 209), card('c3', 405),
        card('c4', 208), card('c5', 406), card('c6', 207), card('c7', 407)], melds: [], bonus: [] },
      context: context('flip', 'c7'),
      rules: rules('25:0', { yiDianZhu: 1 }),
      expect: result => { assert.equal(result.status, 'winning'); assert.equal(patterns(result).oneRed, 1); },
    },
    {
      variantKey: '25:0',
      name: 'men-qing-requires-no-meld',
      ...ordinaryHand([110, 204, 309, 205, 308, 206, 107, 207], 'c7', { source: 'discard' }),
      rules: rules('25:0', { menQing: 1 }),
      expect: result => { assert.equal(patterns(result).menQing, 1); },
    },
    {
      variantKey: '25:0',
      name: 'men-qing-negative-with-meld',
      hand: { concealed: [card('c0', 110), card('c1', 204), card('c2', 109), card('c3', 405),
        card('c4', 208), card('c5', 406)],
        melds: [{ kind: 'peng', cards: [card('m0', 112), card('m1', 212), card('m2', 312)] }], bonus: [] },
      context: context('discard', 'c1', { sourceSeat: 2 }),
      rules: rules('25:0', { menQing: 1, huRedScore: 0 }),
      expect: result => { assert.equal(patterns(result).menQing, undefined); },
    },
    {
      variantKey: '25:0',
      name: 'quan-qiu-ren-requires-three-melds-and-discard',
      hand: { concealed: [card('c0', 110), card('c1', 204)],
        melds: [
          { kind: 'peng', cards: [card('m0', 106), card('m1', 206), card('m2', 306)] },
          { kind: 'peng', cards: [card('m3', 108), card('m4', 208), card('m5', 308)] },
          { kind: 'peng', cards: [card('m6', 112), card('m7', 212), card('m8', 312)] },
        ], bonus: [] },
      context: context('discard', 'c1', { sourceSeat: 2 }),
      rules: rules('25:0', { quanQiuRen: 1 }),
      expect: result => { assert.equal(patterns(result).allFromOthers, 1); },
    },
    {
      variantKey: '25:0',
      name: 'four-fallen-requires-quad',
      hand: { concealed: [card('c0', 110), card('c1', 204), card('c2', 209), card('c3', 405),
        card('c4', 208), card('c5', 406)],
        melds: [{ kind: 'gang', cards: [card('m0', 112), card('m1', 212), card('m2', 312), card('m3', 412)] }], bonus: [] },
      context: context('discard', 'c3', { sourceSeat: 2 }),
      rules: rules('25:0', { siZhangLuoDi: 1, huRedScore: 0 }),
      expect: result => { assert.equal(patterns(result).fourFallen, 1); },
    },
    {
      variantKey: '25:0',
      name: 'qiang-hu-and-qiang-7-are-mutually-exclusive',
      hand: { concealed: [card('c0', 110), card('c1', 204), card('c2', 109), card('c3', 405),
        card('c4', 108), card('c5', 406), card('c6', 107), card('c7', 207)], melds: [], bonus: [] },
      context: context('replacement', 'c6', { sourceSeat: 2 }),
      rules: rules('25:0', { daShaQiangHu: 1, qiang_7Hu: 1 }),
      expect: result => { assert.equal(patterns(result).qiangHu, 1); assert.equal(patterns(result).qiang7, undefined); },
    },
    {
      variantKey: '25:0',
      name: 'seven-red-seven-black-is-unreachable-and-does-not-exempt-threshold',
      hand: { concealed: [card('c0', 101), card('c1', 201), card('c2', 102), card('c3', 202),
        card('c4', 103), card('c5', 203), card('c6', 104), card('c7', 204)], melds: [], bonus: [] },
      context: context('flip', 'c7'),
      rules: rules('25:0', { da_7hong_7hei: 1, huRedScore: 25 }),
      expect: result => {
        assert.equal(result.status, 'not-winning');
        assert.equal(result.reason, 'red-score');
      },
    },
    {
      variantKey: '25:0',
      name: 'xiao-hu-is-only-plain-threshold-win',
      ...ordinaryHand([110, 204, 309, 205, 308, 206, 107, 207], 'c7', { source: 'discard' }),
      rules: rules('25:0', { xiaoHu: 1 }),
      expect: result => { assert.equal(patterns(result).smallHu, 1); },
    },
    {
      variantKey: '25:0',
      name: 'xiao-hu-negative-with-conditional-fan',
      ...ordinaryHand([110, 104, 109, 105, 108, 106, 107, 307], 'c7', { source: 'discard' }),
      rules: rules('25:0', { xiaoHu: 1, menQing: 1 }),
      expect: result => {
        assert.equal(result.status, 'winning');
        assert.equal(patterns(result).smallHu, undefined);
        assert.equal(patterns(result).menQing, 1);
      },
    },
  ];
  const results = evaluate(cases);
  results.forEach((result, index) => cases[index].expect(result));
});

test('27:0 shares conditional scoring without changing 23/26 behavior', () => {
  const cases = [
    {
      variantKey: '27:0',
      ...ordinaryHand([110, 204, 309, 205, 308, 206, 107, 207], 'c7', { source: 'discard' }),
      rules: rules('27:0', { menQing: 1, xiaoHu: 1 }),
      expect: result => { assert.equal(result.status, 'winning'); assert.equal(patterns(result).menQing, 1); assert.equal(patterns(result).smallHu, undefined); },
    },
    {
      variantKey: '23:0',
      ...ordinaryHand([110, 204, 309, 205, 308, 206, 107, 207], 'c7', { source: 'discard' }),
      rules: rules('23:0', { menQing: 1 }),
      expect: result => { assert.equal(patterns(result).menQing, undefined); },
    },
  ];
  const results = evaluate(cases);
  results.forEach((result, index) => cases[index].expect(result));
});
