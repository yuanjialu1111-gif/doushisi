import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { YAAN_INDEPENDENT_VERSION } from '@dss/rules';
import { createYaanCardState, yaanPackSpecification } from '../src/game/yaan-pack.js';

const fixture = JSON.parse(readFileSync(new URL('../../../docs/rules/cases/yaan-pack-v1.json', import.meta.url), 'utf8')) as {
  version: string; cases: { wangNum: number; qiWangNum: number; total: number }[];
};
const rules = (wangNum: number, qiWangNum: number) => ({ wangNum, qiWangNum, yaan: { rulesVersion: YAAN_INDEPENDENT_VERSION } });

for (const item of fixture.cases) test(`Yaan pack ${item.wangNum} specials with seven-king ${item.qiWangNum} totals ${item.total}`, () => {
  assert.equal(fixture.version, YAAN_INDEPENDENT_VERSION);
  const pack = yaanPackSpecification(item.wangNum, item.qiWangNum);
  assert.equal(pack.reduce((sum, entry) => sum + entry.count, 0), item.total);
  const state = createYaanCardState('6:0', rules(item.wangNum, item.qiWangNum), 'deck', [{ id: 'deck', visibility: 'hidden' }]);
  assert.equal(state.pack.length, item.total);
  assert.equal(new Set(state.pack.map(card => card.id)).size, item.total);
});

test('Yaan pack seven composition is explicit and region/version bounded', () => {
  const ordinary = new Map(yaanPackSpecification(6, 0).map(entry => [entry.code, entry.count]));
  assert.equal(ordinary.get(107), 1); assert.equal(ordinary.get(207), 1);
  const six = new Map(yaanPackSpecification(6, 6).map(entry => [entry.code, entry.count]));
  assert.equal(six.get(107), 2); assert.equal(six.get(207), 2);
  const double = new Map(yaanPackSpecification(6, 8).map(entry => [entry.code, entry.count]));
  assert.equal(double.get(107), 2); assert.equal(double.get(207), 2);
  assert.equal(double.get(1001), 2); assert.equal(double.get(1002), 2); assert.equal(double.get(1003), 2);
  for (const [wangNum, qiWangNum] of [[2, 0], [15, 0], [3, 2], [3, 10], [3, 3.5], [3.5, 0]]) {
    assert.throws(() => yaanPackSpecification(wangNum as number, qiWangNum as number));
  }
  assert.throws(() => createYaanCardState('8:0', rules(6, 8), 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'YAAN_PACK_REGION_MISMATCH' });
  assert.throws(() => createYaanCardState('6:0', { wangNum: 6, qiWangNum: 8, yaan: {} }, 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'YAAN_RULES_VERSION_REQUIRED' });
});
