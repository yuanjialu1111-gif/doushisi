import test from 'node:test';
import assert from 'node:assert/strict';
import { qionglaiPatterns, qionglaiFanTotal, type QionglaiFacts, type QionglaiFanSchedule } from '../src/qionglai-patterns.js';
import type { QionglaiSwitches } from '@dss/rules';
const switches = { qlTianDiHu: 1, qlHongHeiHu: 1, qlHongHei50: 1 } as const;
const base: QionglaiFacts = { legalWin: true, winnerSeat: 1, dealerSeat: 1, phase: 'original-hand', stealCount: 0,
  replacementCount: 0, discardCount: 0, sourceSeat: null, handAndMelds: [{ kind: 'ordinary', color: 'red' }, { kind: 'wild' }, { kind: 'bonus' }],
  redPoints: 50, blackPoints: 0 };
test('Qionglai heaven is raw initial hand only; earth is the first ordinary dealer discard', () => {
  assert.deepEqual(qionglaiPatterns(base, switches), ['tianHu', 'redHu', 'red50']);
  for (const changes of [{ stealCount: 1 }, { replacementCount: 1 }, { discardCount: 1 }]) {
    assert.ok(!qionglaiPatterns({ ...base, ...changes }, switches).includes('tianHu'));
  }
  const earth = { ...base, winnerSeat: 2, phase: 'ordinary-discard' as const, sourceSeat: 1, discardCount: 1 };
  assert.ok(qionglaiPatterns(earth, switches).includes('diHu'));
  assert.ok(!qionglaiPatterns({ ...earth, discardCount: 2 }, switches).includes('diHu'));
  assert.ok(!qionglaiPatterns({ ...earth, sourceSeat: 3 }, switches).includes('diHu'));
});
test('colors include exposed ordinary cards and require at least one; fifty requires a legal win', () => {
  assert.deepEqual(qionglaiPatterns({ ...base, legalWin: false }, switches), []);
  assert.ok(!qionglaiPatterns({ ...base, handAndMelds: [{ kind: 'wild' }] }, switches).includes('redHu'));
  assert.ok(!qionglaiPatterns({ ...base, handAndMelds: [...base.handAndMelds, { kind: 'ordinary', color: 'black' }] }, switches).includes('redHu'));
  for (const points of [49, 50, 51]) {
    assert.equal(qionglaiPatterns({ ...base, redPoints: points }, switches).includes('red50'), points >= 50);
    assert.equal(qionglaiPatterns({ ...base, blackPoints: points }, switches).includes('black50'), points >= 50);
  }
  assert.deepEqual(qionglaiPatterns(base, { qlTianDiHu: 0, qlHongHeiHu: 0, qlHongHei50: 0 }), []);
  assert.deepEqual(qionglaiPatterns({ ...base, phase: 'other', redPoints: 0, blackPoints: 50,
    handAndMelds: [{ kind: 'ordinary', color: 'black' }, { kind: 'bonus' }] }, switches), ['blackHu', 'black50']);
});
test('six fan amounts have no inferred defaults; a synthetic approved schedule sums then caps', () => {
  assert.throws(() => qionglaiFanTotal(['redHu', 'red50'], [2], 6, null), { code: 'QIONGLAI_FANS_UNCONFIRMED' });
  // Deliberately distinctive arithmetic fixtures, not regional fan defaults.
  const schedule = { version: 'qionglai-additions-v1' as const, approvalReference: 'TEST-ONLY',
    values: { tianHu: 11, diHu: 12, redHu: 13, blackHu: 14, red50: 15, black50: 16 } };
  assert.deepEqual(qionglaiFanTotal(['redHu', 'red50'], [2], 6, schedule), { total: '30', capped: '6' });
  assert.deepEqual(qionglaiFanTotal(['redHu', 'red50'], [2], null, schedule), { total: '30', capped: '30' });
});
test('incomplete restored settings cannot silently disable a rule or infer a fan table', () => {
  for (const saved of [{}, { qlTianDiHu: 1, qlHongHeiHu: 1 }, { ...switches, qlHongHei50: '1' }]) {
    assert.throws(() => qionglaiPatterns(base, saved as QionglaiSwitches), { code: 'INVALID_ROOM_OPTIONS' });
  }
  for (const saved of [
    { version: 'qionglai-additions-v1' },
    { version: 'qionglai-additions-v1', approvalReference: 'TEST-ONLY' },
    { version: 'qionglai-additions-v1', approvalReference: 'TEST-ONLY', values: { redHu: 13 } },
  ]) {
    assert.throws(() => qionglaiFanTotal(['redHu'], [], null, saved as QionglaiFanSchedule),
      { code: 'QIONGLAI_FANS_UNCONFIRMED' });
  }
});
