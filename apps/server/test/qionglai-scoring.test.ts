import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDefaultOptions, QIONGLAI_SCORING_VERSION } from '@dss/rules';
import {
  scoreQionglai, qionglaiBaseAmount, qionglaiBaoJiaoPointRequirement,
  type QionglaiScoringFacts, type QionglaiScoringOptions,
} from '../src/qionglai-scoring.js';
import { roundTransfers, baseTimesRatio } from '../src/transfers.js';

// Structural facts isolate scoring. These are not original winning hands.
const base: QionglaiScoringFacts = {
  legalWin: true, winnerSeat: 1, dealerSeat: 1, phase: 'other',
  stealCount: 0, replacementCount: 0, discardCount: 0, sourceSeat: null,
  handAndMelds: [{ kind: 'ordinary', color: 'red' }, { kind: 'ordinary', color: 'black' }],
  redPoints: 0, blackPoints: 0, winSource: 'other', concealedBeforeWin: 7,
  exposedMeldKinds: [], concealedFourPairs: null, nonKongQuadCount: 0,
};
const options = {
  ...getDefaultOptions('8:0'), qlTianDiHu: 0, qlHongHeiHu: 0, qlHongHei50: 0,
} as unknown as QionglaiScoringOptions;
const references = JSON.parse(readFileSync(new URL('../../../docs/rules/cases/qionglai-score-v1.json', import.meta.url), 'utf8')) as {
  version: string;
  cases: { id: string; facts?: Partial<QionglaiScoringFacts>; options?: Partial<QionglaiScoringOptions>; expected: Record<string, unknown> }[];
};
assert.equal(references.version, QIONGLAI_SCORING_VERSION);
assert.equal(new Set(references.cases.map(item => item.id)).size, references.cases.length);
for (const reference of references.cases) {
  test(`Qionglai independent score case: ${reference.id}`, () => {
    const facts = { ...structuredClone(base), ...reference.facts };
    const settings = { ...options, ...reference.options };
    const before = structuredClone({ facts, settings });
    const result = scoreQionglai(facts, settings);
    assert.deepEqual(Object.fromEntries(Object.keys(reference.expected).map(key =>
      [key, (result as unknown as Record<string, unknown>)[key]])), reference.expected);
    assert.equal(result.version, QIONGLAI_SCORING_VERSION);
    assert.deepEqual({ facts, settings }, before, 'Scoring must not mutate archived input');
    assert.deepEqual(scoreQionglai(facts, settings), result, 'Replay must reproduce scoring');
    assert.equal(new Set(result.items.map(item => item.pattern)).size, result.items.length);
    assert.ok(result.items.every(item => item.reference.length > 0));
    if (result.status !== 'scored') {
      assert.equal('scoreUnits' in result, false);
      assert.equal('cappedFan' in result, false);
      assert.throws(() => qionglaiBaseAmount(result, '1'), { code: 'QIONGLAI_SCORE_UNRESOLVED' });
    }
  });
}

test('Qionglai score itemization preserves package sources and never adds plain-hu to a scored win', () => {
  const result = scoreQionglai({ ...base, redPoints: 20, winSource: 'own-flip', concealedFourPairs: { dragons: 1 } },
    { ...options, keSuHu: 1, maxFan: 4, chengFan: 1 });
  assert.equal(result.status, 'scored');
  assert.deepEqual(result.items.map(({ pattern, count, fanEach, fan }) => ({ pattern, count, fanEach, fan })), [
    { pattern: 'qia20', count: 1, fanEach: 3, fan: '3' },
    { pattern: 'anDui', count: 1, fanEach: 3, fan: '3' },
    { pattern: 'dragon', count: 1, fanEach: 3, fan: '3' },
  ]);
});

test('Qionglai requires explicit scoring options and complete server facts', () => {
  for (const key of ['qia20', 'jinGouDiao', 'anDui', 'siGuiYi', 'keSuHu', 'maxFan', 'chengFan',
    'qlTianDiHu', 'qlHongHeiHu', 'qlHongHei50'] as const) {
    assert.throws(() => scoreQionglai(base, { ...options, [key]: undefined }), { code: 'INVALID_ROOM_OPTIONS' });
    assert.throws(() => scoreQionglai(base, { ...options, [key]: '1' }), { code: 'INVALID_ROOM_OPTIONS' });
  }
  for (const value of [0, 3, 7, -1, 100, NaN]) {
    assert.throws(() => scoreQionglai(base, { ...options, maxFan: value } as QionglaiScoringOptions), { code: 'INVALID_ROOM_OPTIONS' });
  }
  for (const facts of [
    { legalWin: 'true' }, { winSource: 'draw' }, { concealedBeforeWin: -1 }, { concealedBeforeWin: 1.5 },
    { nonKongQuadCount: NaN }, { phase: 'unknown' }, { sourceSeat: 0 }, { handAndMelds: [{}] },
    { exposedMeldKinds: ['unknown'] }, { concealedFourPairs: {} }, { concealedFourPairs: { dragons: -1 } },
    { concealedFourPairs: { dragons: 3 } }, { concealedFourPairs: { dragons: 1 }, concealedBeforeWin: 1 },
    { concealedFourPairs: { dragons: 0 }, exposedMeldKinds: ['peng'] },
    { concealedFourPairs: { dragons: 0 }, phase: 'original-hand', concealedBeforeWin: 7 },
    { concealedFourPairs: { dragons: 0 }, phase: 'other', concealedBeforeWin: 8 },
    { redPoints: 1.5 }, { blackPoints: -1 },
  ]) {
    assert.throws(() => scoreQionglai({ ...base, ...facts } as QionglaiScoringFacts, options), { code: 'INVALID_RULE_FACTS' });
  }
});

test('Qionglai bao-jiao excludes or includes the winning card exactly as selected', () => {
  for (const [before, winning, hard, soft] of [
    [19, 0, false, false], [19, 1, false, true], [19, 2, false, true],
    [20, 0, true, true], [20, 1, true, true], [21, 0, true, true], [0, 20, false, true],
  ] as const) {
    assert.equal(qionglaiBaoJiaoPointRequirement(before, winning, 1), hard);
    assert.equal(qionglaiBaoJiaoPointRequirement(before, winning, 0), soft);
  }
  assert.throws(() => qionglaiBaoJiaoPointRequirement(20, -1, 0), { code: 'INVALID_RULE_FACTS' });
  assert.throws(() => qionglaiBaoJiaoPointRequirement(20, 1, undefined as unknown as 0), { code: 'INVALID_ROOM_OPTIONS' });
});

test('Qionglai exact score conversion feeds the existing per-payment ledger without choosing payers', () => {
  const result = scoreQionglai({ ...base, redPoints: 20, concealedFourPairs: { dragons: 1 } },
    { ...options, maxFan: 4, chengFan: 1 });
  assert.equal(result.status, 'scored');
  if (result.status !== 'scored') throw new Error('Expected the independent 16-unit scoring fixture');
  assert.equal(qionglaiBaseAmount(result, '0.125'), '2');
  assert.equal(qionglaiBaseAmount(result, '0.000000000001'), '0.000000000016');
  assert.equal(qionglaiBaseAmount(result, '9007199254740993.000000000001'), '144115188075855888.000000000016');
  const payments = roundTransfers([
    { id: 'fixture:b-a', payerId: 'b', payeeId: 'a', ...baseTimesRatio('0.125', BigInt(result.scoreUnits)) },
    { id: 'fixture:c-a', payerId: 'c', payeeId: 'a', ...baseTimesRatio('0.125', BigInt(result.scoreUnits)) },
  ], ['a', 'b', 'c']);
  assert.deepEqual(payments.postings, [
    { userId: 'a', amount: '4' }, { userId: 'b', amount: '-2' }, { userId: 'c', amount: '-2' },
  ]);
  for (const invalid of ['0', '-1', '1e3', '0.0000000000001', '1'.repeat(81)]) {
    assert.throws(() => qionglaiBaseAmount(result, invalid), { code: 'INVALID_AMOUNT' });
  }
});
