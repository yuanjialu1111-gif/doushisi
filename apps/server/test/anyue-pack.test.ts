import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANYUE_INDEPENDENT_VERSION } from '@dss/rules';
import { anyuePackSpecification, createAnyueCardState } from '../src/game/anyue-pack.js';

const fixture = JSON.parse(readFileSync(new URL('../../../docs/rules/cases/anyue-pack-v1.json', import.meta.url), 'utf8')) as {
  version: string; cases: { wangNum: number; total: number; specialCounts: Record<string, number> }[];
};
const rules = (wangNum: number) => ({ wangNum, anyue: { rulesVersion: ANYUE_INDEPENDENT_VERSION } });

for (const item of fixture.cases) test(`Anyue pack ${item.wangNum} specials totals ${item.total}`, () => {
  assert.equal(fixture.version, ANYUE_INDEPENDENT_VERSION);
  const pack = anyuePackSpecification(item.wangNum);
  assert.equal(pack.reduce((sum, entry) => sum + entry.count, 0), item.total);
  for (const [code, count] of Object.entries(item.specialCounts)) {
    assert.equal(pack.find(entry => entry.code === Number(code))!.count, count);
  }
  const state = createAnyueCardState('5:0', rules(item.wangNum), 'deck', [{ id: 'deck', visibility: 'hidden' }]);
  assert.equal(state.pack.length, item.total);
  assert.equal(new Set(state.pack.map(card => card.id)).size, item.total);
});

test('Anyue pack keeps ordinary sevens and rejects unsupported or foreign versions', () => {
  const pack = new Map(anyuePackSpecification().map(entry => [entry.code, entry.count]));
  assert.equal(pack.get(107), 1); assert.equal(pack.get(207), 1);
  for (const value of [0, 1, 2, 6, 9, 12, 18, 3.5]) assert.throws(() => anyuePackSpecification(value));
  assert.throws(() => createAnyueCardState('8:0', rules(3), 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'ANYUE_PACK_REGION_MISMATCH' });
  assert.throws(() => createAnyueCardState('5:0', { wangNum: 3, anyue: {} }, 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'ANYUE_RULES_VERSION_REQUIRED' });
});
