import test from 'node:test';
import assert from 'node:assert/strict';
import { ABA_INDEPENDENT_VERSION } from '@dss/rules';
import { abaPackSpecification, createAbaCardState } from '../src/game/aba-pack.js';

const rules = { aba: { rulesVersion: ABA_INDEPENDENT_VERSION } };

test('Aba pack keeps 52 ordinary cards plus 1 small king, 1 big king and 2 white faces', () => {
  const pack = abaPackSpecification();
  assert.equal(pack.reduce((sum, entry) => sum + entry.count, 0), 56);
  assert.equal(pack.filter(entry => entry.code < 1000).length, 52);
  assert.equal(pack.find(entry => entry.code === 1001)!.count, 1);
  assert.equal(pack.find(entry => entry.code === 1002)!.count, 1);
  assert.equal(pack.find(entry => entry.code === 1003)!.count, 2);
  const state = createAbaCardState('9:0', rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]);
  assert.equal(state.pack.length, 56);
  assert.equal(new Set(state.pack.map(card => card.id)).size, 56);
});

test('Aba pack rejects foreign regions, wrong counts and missing rule versions', () => {
  assert.throws(() => abaPackSpecification(3), { code: 'INVALID_ABA_WANG_COUNT' });
  assert.throws(() => createAbaCardState('13:0' as '9:0', rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'ABA_PACK_REGION_MISMATCH' });
  assert.throws(() => createAbaCardState('9:0', { aba: {} }, 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'ABA_RULES_VERSION_REQUIRED' });
});
