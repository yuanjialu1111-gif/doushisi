import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { XINJIN_INDEPENDENT_VERSION } from '@dss/rules';
import { createXinjinCardState, xinjinPackSpecification } from '../src/game/xinjin-pack.js';

const fixture = JSON.parse(readFileSync(new URL('../../../docs/rules/cases/xinjin-pack-v1.json', import.meta.url), 'utf8')) as {
  version: string; cases: { wangNum: number; total: number; specialCounts: Record<string, number> }[];
};
const rules = (wangNum: number) => ({ wangNum, xinjin: { rulesVersion: XINJIN_INDEPENDENT_VERSION } });

for (const item of fixture.cases) test(`Xinjin pack ${item.wangNum} specials totals ${item.total}`, () => {
  assert.equal(fixture.version, XINJIN_INDEPENDENT_VERSION);
  const pack = xinjinPackSpecification(item.wangNum);
  assert.equal(pack.reduce((sum, entry) => sum + entry.count, 0), item.total);
  for (const [code, count] of Object.entries(item.specialCounts)) assert.equal(pack.find(entry => entry.code === Number(code))!.count, count);
  const state = createXinjinCardState('4:0', rules(item.wangNum), 'deck', [{ id: 'deck', visibility: 'hidden' }]);
  assert.equal(state.pack.length, item.total);
  assert.equal(new Set(state.pack.map(card => card.id)).size, item.total);
});

test('Xinjin pack keeps four ordinary sevens and rejects unsupported or foreign versions', () => {
  assert.equal(xinjinPackSpecification(3).find(entry => entry.code === 107)!.count, 1);
  assert.equal(xinjinPackSpecification(3).find(entry => entry.code === 207)!.count, 1);
  for (const value of [0, 1, 2, 4, 7, 8, 12, 3.5]) assert.throws(() => xinjinPackSpecification(value));
  assert.throws(() => createXinjinCardState('8:0', rules(3), 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'XINJIN_PACK_REGION_MISMATCH' });
  assert.throws(() => createXinjinCardState('4:0', { wangNum: 3, xinjin: {} }, 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'XINJIN_RULES_VERSION_REQUIRED' });
});
