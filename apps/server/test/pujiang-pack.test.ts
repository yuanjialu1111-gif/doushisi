import test from 'node:test';
import assert from 'node:assert/strict';
import { PUJIANG_INDEPENDENT_VERSION, PUJIANG_WANG_COUNTS } from '@dss/rules';
import { createPujiangCardState, pujiangPackSpecification } from '../src/game/pujiang-pack.js';

const rules = (wangNum: number) => ({ wangNum, pujiang: { rulesVersion: PUJIANG_INDEPENDENT_VERSION } });

test('Pujiang pack keeps exactly 52 ordinary cards and splits every royal count equally', () => {
  for (const wangNum of PUJIANG_WANG_COUNTS) {
    const pack = pujiangPackSpecification(wangNum);
    assert.equal(pack.reduce((sum, entry) => sum + entry.count, 0), 52 + wangNum);
    const ordinary = pack.filter(entry => entry.code < 1000);
    assert.equal(ordinary.length, 52);
    assert.ok(ordinary.every(entry => entry.count === 1));
    for (const code of [1001, 1002, 1003]) {
      assert.equal(pack.find(entry => entry.code === code)!.count, wangNum / 3);
    }
    const state = createPujiangCardState('7:0', rules(wangNum), 'deck', [{ id: 'deck', visibility: 'hidden' }]);
    assert.equal(state.pack.length, 52 + wangNum);
    assert.equal(new Set(state.pack.map(card => card.id)).size, 52 + wangNum);
  }
});

test('Pujiang pack rejects unsupported counts, foreign regions and missing frozen versions', () => {
  for (const value of [0, 3, 4, 5, 7, 8, 10, 18, 6.5]) assert.throws(() => pujiangPackSpecification(value));
  assert.throws(() => createPujiangCardState('8:0', rules(9), 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'PUJIANG_PACK_REGION_MISMATCH' });
  assert.throws(() => createPujiangCardState('7:0', { wangNum: 9, pujiang: {} }, 'deck', [{ id: 'deck', visibility: 'hidden' }]),
    { code: 'PUJIANG_RULES_VERSION_REQUIRED' });
});
