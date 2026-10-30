import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { LedgerService } from '../src/ledger.js';
import { choosePolicy, PolicyService, selectDeal, type Policy } from '../src/policies.js';

const code = (expected: string) => (error: unknown) => {
  assert.equal((error as { code?: string }).code, expected);
  return true;
};

test('account, exact ledger and policy invariants against PGlite', async t => {
  const db = await openDatabase();
  try {
    await migrate(db);
    const auth = new AuthService(db);
    const ledger = new LedgerService(db);
    const policies = new PolicyService(db);
    const beans = await auth.create('beans_invariants', 'test-password-only', 'beans_admin');
    const dealer = await auth.create('dealer_invariants', 'test-password-only', 'deal_admin');
    const player = await auth.create('player_invariants', 'test-password-only');
    const other = await auth.create('other_invariants', 'test-password-only');

    await t.test('new player starts at zero and repeated decimal credits are exact', async () => {
      assert.equal(await ledger.balance(player.id), '0');
      await Promise.all(Array.from({ length: 50 }, (_, index) =>
        ledger.adjust(beans, player.id, '0.1', 'decimal credit', `decimal-credit-${index}`)));
      assert.equal(await ledger.balance(player.id), '5');
      const entries = await db.query('SELECT count(*)::integer AS count, sum(amount)::text AS total FROM ledger_entries WHERE user_id=$1', [player.id]);
      assert.equal(entries.rows[0].count, 50);
      assert.equal(entries.rows[0].total, '5.0');
    });

    await t.test('simultaneous identical requests post once and return the original operation', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, () =>
        ledger.adjust(beans, other.id, '0.125', 'one credit', 'same-credit-request')));
      assert.equal(new Set(results.map(result => result.operationId)).size, 1);
      assert.equal(results.filter(result => !result.replayed).length, 1);
      assert.equal(await ledger.balance(other.id), '0.125');
      const rows = await db.query('SELECT count(*)::integer AS count FROM ledger_entries WHERE user_id=$1', [other.id]);
      assert.equal(rows.rows[0].count, 1);
      await assert.rejects(ledger.adjust(beans, other.id, '1', 'one credit', 'same-credit-request'), code('IDEMPOTENCY_CONFLICT'));
      await assert.rejects(ledger.adjust(beans, other.id, '0.125', 'changed reason', 'same-credit-request'), code('IDEMPOTENCY_CONFLICT'));
      await assert.rejects(ledger.adjust(beans, player.id, '0.125', 'one credit', 'same-credit-request'), code('IDEMPOTENCY_CONFLICT'));
      assert.equal(await ledger.balance(other.id), '0.125');
    });

    await t.test('manual deductions stop at zero and failures leave no partial operation', async () => {
      await assert.rejects(ledger.adjust(beans, other.id, '-0.126', 'too much', 'deduct-too-much'), code('INSUFFICIENT_BALANCE'));
      assert.equal(await ledger.balance(other.id), '0.125');
      await ledger.adjust(beans, other.id, '-0.125', 'clear exact balance', 'deduct-to-zero');
      assert.equal(await ledger.balance(other.id), '0');
      await assert.rejects(ledger.adjust(beans, other.id, '-0.001', 'below zero', 'deduct-below-zero'), code('INSUFFICIENT_BALANCE'));
      const failed = await db.query("SELECT count(*)::integer AS count FROM ledger_operations WHERE request_key LIKE '%deduct-too-much' OR request_key LIKE '%deduct-below-zero'");
      assert.equal(failed.rows[0].count, 0);
    });

    await t.test('administrators and players cannot cross role boundaries', async () => {
      await assert.rejects(ledger.adjust(dealer, player.id, '100', 'forbidden', 'forbidden-dealer'), code('FORBIDDEN'));
      await assert.rejects(ledger.adjust(player, player.id, '100', 'forbidden', 'forbidden-player'), code('FORBIDDEN'));
      await assert.rejects(policies.update(beans, player.id, true, '100', 'forbidden', 'forbidden-beans', 0), code('FORBIDDEN'));
      await assert.rejects(policies.update(player, player.id, true, '100', 'forbidden', 'forbidden-policy-player', 0), code('FORBIDDEN'));
      await assert.rejects(auth.login(beans.username, 'test-password-only'), code('INVALID_CREDENTIALS'));
      await assert.rejects(auth.login(player.username, 'test-password-only', true), code('INVALID_CREDENTIALS'));
      await assert.rejects(auth.login(beans.username, 'incorrect-password', true), code('INVALID_CREDENTIALS'));
      const login = await auth.login(beans.username.toUpperCase(), 'test-password-only', true);
      assert.equal((await auth.authenticate(login.token)).role, 'beans_admin');
      await auth.logout(login.token);
      await assert.rejects(auth.authenticate(login.token), code('UNAUTHORIZED'));
      assert.equal(await ledger.balance(player.id), '5');
    });

    await t.test('policy edits are versioned, idempotent and separately audited', async () => {
      const first = await policies.update(dealer, player.id, true, '80', 'initial strategy', 'initial-strategy-request', 0);
      assert.equal(first.version, 1);
      const replay = await policies.update(dealer, player.id, true, '80', 'initial strategy', 'initial-strategy-request', 0);
      assert.deepEqual(replay, first);
      await assert.rejects(policies.update(dealer, player.id, true, '50', 'initial strategy', 'initial-strategy-request', 0), code('IDEMPOTENCY_CONFLICT'));
      await assert.rejects(policies.update(dealer, player.id, false, '80', 'stale edit', 'stale-strategy-request', 0), code('VERSION_CONFLICT'));
      const edits = await Promise.allSettled([
        policies.update(dealer, player.id, true, '50', 'concurrent first', 'concurrent-policy-first', 1),
        policies.update(dealer, player.id, false, '80', 'concurrent second', 'concurrent-policy-second', 1),
      ]);
      assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = edits.find(result => result.status === 'rejected');
      assert.ok(rejected?.status === 'rejected');
      assert.equal(rejected.reason.code, 'VERSION_CONFLICT');
      const audit = await db.query("SELECT count(*)::integer AS count FROM audit_events WHERE user_id=$1 AND kind='policy_changed'", [player.id]);
      assert.equal(audit.rows[0].count, 2);
      await assert.rejects(db.query('DELETE FROM audit_events WHERE user_id=$1', [player.id]), /append-only/);
    });
  } finally { await db.close(); }
});

test('policy probabilities, eligibility and candidate deals have deterministic boundaries', async t => {
  const policy = (userId: string, probability: string, enabled = true): Policy => ({ userId, probability, enabled, version: 1 });
  await t.test('zero and disabled policies never participate, while 100 percent always triggers', () => {
    const noRandom = () => { throw new Error('An ineligible policy must not draw random numbers'); };
    assert.deepEqual(choosePolicy([policy('zero', '0'), policy('disabled', '100', false)], noRandom), { selectedUserId: null, triggered: false, probability: '0', version: null });
    const draws = [0, 9999];
    assert.equal(choosePolicy([policy('certain', '100')], () => draws.shift()!).triggered, true);
    for (const [roll, expected] of [[7999, true], [8000, false]] as const) {
      const samples = [0, roll];
      assert.equal(choosePolicy([policy('eighty', '80')], () => samples.shift()!).triggered, expected);
    }
  });

  await t.test('selection is uniform among eligible users before applying each probability', () => {
    const players = [policy('zero', '0'), policy('first', '10'), policy('second', '90')];
    for (const [index, expected] of [[0, 'first'], [1, 'second']] as const) {
      const bounds: number[] = [];
      const samples = [index, 0];
      const chosen = choosePolicy(players, max => { bounds.push(max); return samples.shift()!; });
      assert.equal(chosen.selectedUserId, expected);
      assert.deepEqual(bounds, [2, 10000]);
    }
  });

  await t.test('triggered optimization evaluates 32 legal permutations and keeps a best score', () => {
    const deck = Array.from({ length: 80 }, (_, index) => index);
    let seed = 123456;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const scores: number[] = [];
    const result = selectDeal(deck, { selectedUserId: 'chosen', triggered: true, probability: '100', version: 1 }, candidate => {
      assert.deepEqual([...candidate].sort((a, b) => a - b), deck);
      const score = candidate.slice(0, 14).reduce((sum, card) => sum + card, 0);
      scores.push(score);
      return [score];
    }, random);
    assert.equal(scores.length, 32);
    assert.equal(result.candidates, 32);
    assert.equal(result.evaluation[0], Math.max(...scores));
    assert.equal(result.deck.slice(0, 14).reduce((sum, card) => sum + card, 0), Math.max(...scores));
    assert.deepEqual(deck, Array.from({ length: 80 }, (_, index) => index));
    let evaluations = 0;
    const ordinary = selectDeal(deck, { selectedUserId: null, triggered: false, probability: '0', version: null }, () => { evaluations++; return [0]; }, random);
    assert.equal(ordinary.candidates, 1);
    assert.equal(evaluations, 1);
  });
});
