import test from 'node:test';
import assert from 'node:assert/strict';
import { baseTimesRatio, roundTransfers } from '../src/transfers.js';
import { addMoney, amount, beanUnits } from '../src/money.js';
import { applyConfirmedScores } from '../src/confirmed-scores.js';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService } from '../src/auth.js';
import { appendOperation, LedgerService } from '../src/ledger.js';

test('each payer rounds once at 12 places, including ties; recipients sum the payments', () => {
  const ids = ['a', 'b', 'c'];
  const transfers = ['b', 'c'].map(payerId => ({ id: payerId, payerId, payeeId: 'a', numerator: '5', denominator: '10000000000000' }));
  const batch = roundTransfers(transfers, ids);
  assert.deepEqual(batch.postings, [{ userId: 'a', amount: '0.000000000002' },
    { userId: 'b', amount: '-0.000000000001' }, { userId: 'c', amount: '-0.000000000001' }]);
  assert.equal(roundTransfers([{ ...transfers[0]!, numerator: '4' }], ids).postings[0]!.amount, '0');
  assert.throws(() => roundTransfers([transfers[0]!, transfers[0]!], ids), { code: 'INVALID_TRANSFER' });
  const result = { snapshot: {}, events: [], confirmedScores: [{ eventId: 'win', ...batch }], settlement: batch.postings };
  assert.equal(applyConfirmedScores([], result, ids).appended.length, 1);
  assert.equal(applyConfirmedScores(result.confirmedScores, result, ids).appended.length, 0);
  assert.throws(() => applyConfirmedScores([], { ...result, confirmedScores: [{ eventId: 'win', ...batch, postings: batch.postings.map(p => ({ ...p, amount: '0' })) }] }, ids), { code: 'TRANSFER_POSTINGS_MISMATCH' });
});

test('large derived balances keep the final fractional bean without floating point rounding', () => {
  const big = '1' + '0'.repeat(160);
  assert.equal(addMoney(big, '0.000000000001'), big + '.000000000001');
  assert.throws(() => amount(big), { code: 'INVALID_AMOUNT' });
  const base = '9'.repeat(80) + '.123456789012';
  const rounded = roundTransfers([{ id: 'hu', payerId: 'b', payeeId: 'a', ...baseTimesRatio(base, 1000n) }], ['a', 'b']);
  assert.equal(beanUnits(rounded.postings[0]!.amount), beanUnits(base) * 1000n);
});

test('ledger posts derived amounts beyond 80 digits exactly; manual input remains bounded', async () => {
  const db = await openDatabase(); await migrate(db);
  try {
    const auth = new AuthService(db), ledger = new LedgerService(db);
    const a = await auth.create('large_bean_first', 'test-password-only');
    const b = await auth.create('large_bean_second', 'test-password-only');
    const large = '1' + '0'.repeat(160) + '.000000000001';
    const op = { key: 'large-derived-once', kind: 'round_settlement' as const, reason: 'Accounting fixture only',
      postings: [{ userId: a.id, amount: large }, { userId: b.id, amount: '-' + large }] };
    await db.transaction(tx => appendOperation(tx, op));
    assert.equal((await db.transaction(tx => appendOperation(tx, op))).replayed, true);
    assert.equal(await ledger.balance(a.id), large);
    assert.equal(await ledger.balance(b.id), '-' + large);
    assert.equal((await db.query('SELECT sum(amount)::text AS total FROM ledger_entries')).rows[0]!.total.replace(/\.0+$/, ''), '0');
  } finally { await db.close(); }
});
