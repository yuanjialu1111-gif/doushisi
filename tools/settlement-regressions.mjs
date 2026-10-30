import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const BEAN_SCALE = 1_000_000_000_000n;
const AMOUNT_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;

function amountUnits(value, label) {
  assert.equal(typeof value, 'string', `${label} must be an exact decimal string`);
  assert.match(value, AMOUNT_PATTERN, `${label} must be an exact decimal string`);
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const units = BigInt(whole) * BEAN_SCALE + BigInt(fraction.padEnd(12, '0'));
  return negative ? -units : units;
}

function winnerFrom(snapshot, label) {
  const winners = snapshot?.outcome?.winners;
  assert.ok(Array.isArray(winners) && winners.length > 0, `${label}: final outcome must include a winner`);
  return winners[0];
}

/**
 * Replays the optional final-settlement fixtures for one runtime engine.
 * The fixture file is the only optional input: when it is absent, the caller gets null.
 */
export async function runSettlementRegressions({ root, engine, entry }) {
  assert.ok(typeof root === 'string' && root.length > 0, 'root is required');
  assert.ok(engine && typeof engine.apply === 'function', 'engine.apply is required');
  assert.ok(typeof engine.variantKey === 'string' && engine.variantKey.length > 0,
    'engine.variantKey is required');

  const variantKey = engine.variantKey;
  const releaseDirectory = path.join('docs/rules/release', variantKey.replace(':', '-'));
  const settlementPath = path.join(root, releaseDirectory, 'settlement-cases.json');
  let raw;
  try {
    raw = await fs.readFile(settlementPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const fixture = JSON.parse(raw);
  assert.equal(fixture.schemaVersion, 1, `${variantKey}: settlement schemaVersion`);
  assert.equal(fixture.kind, 'final-settlement-regression', `${variantKey}: settlement kind`);
  assert.equal(fixture.variantKey, variantKey, `${variantKey}: settlement variant`);
  assert.equal(fixture.ruleVersion, engine.version, `${variantKey}: settlement rule version`);
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length > 0, `${variantKey}: settlement cases must be non-empty`);

  const seen = new Set();
  for (const item of fixture.cases) {
    assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${variantKey}: settlement case must be an object`);
    assert.ok(typeof item.id === 'string' && item.id.length > 0,
      `${variantKey}: settlement case id is required`);
    assert.equal(seen.has(item.id), false, `${variantKey}: duplicate settlement case id ${item.id}`);
    seen.add(item.id);
    const label = `${variantKey}:${item.id}`;
    assert.ok(Array.isArray(item.actions) && item.actions.length > 0, `${label}: actions must be non-empty`);
    assert.ok(item.expected && typeof item.expected === 'object' && !Array.isArray(item.expected),
      `${label}: expected settlement data is required`);

    let snapshot = structuredClone(item.initialSnapshot);
    let result = null;
    for (const [index, step] of item.actions.entries()) {
      assert.ok(step && typeof step === 'object' && !Array.isArray(step), `${label}: action ${index} must be an object`);
      assert.ok(typeof step.userId === 'string' && step.userId.length > 0,
        `${label}: action ${index} userId is required`);
      assert.ok(Object.hasOwn(step, 'action'), `${label}: action ${index} action is required`);
      result = engine.apply(snapshot, step.userId, structuredClone(step.action));
      assert.ok(result && typeof result === 'object' && Object.hasOwn(result, 'snapshot'),
        `${label}: action ${index} must return a snapshot`);
      snapshot = result.snapshot;
    }

    const expectedPhase = item.expected.finalPhase ?? item.expected.phase ?? 'finished';
    const expectedReason = item.expected.outcomeReason ?? item.expected.outcome?.reason
      ?? item.expected.reason ?? 'hu';
    assert.equal(snapshot.phase, expectedPhase, `${label}: final phase`);
    assert.equal(snapshot.outcome?.reason, expectedReason, `${label}: final outcome reason`);
    assert.ok(Array.isArray(result.settlement), `${label}: final settlement is required`);
    assert.deepEqual(result.settlement, item.expected.settlement, `${label}: settlement`);

    const total = result.settlement.reduce((sum, posting, index) => {
      assert.ok(posting && typeof posting === 'object' && !Array.isArray(posting),
        `${label}: settlement posting ${index} must be an object`);
      return sum + amountUnits(posting.amount, `${label}: settlement posting ${index}`);
    }, 0n);
    assert.equal(total, 0n, `${label}: settlement must be zero-sum`);

    assert.ok(Array.isArray(result.confirmedScores), `${label}: confirmedScores are required`);
    if (Object.hasOwn(item.expected, 'confirmedScores')) {
      assert.deepEqual(result.confirmedScores, item.expected.confirmedScores, `${label}: confirmedScores`);
    } else {
      const accumulated = result.confirmedScores.flatMap((batch, batchIndex) => {
        assert.ok(batch && typeof batch === 'object' && !Array.isArray(batch), `${label}: confirmed score batch ${batchIndex}`);
        assert.ok(Array.isArray(batch.postings), `${label}: confirmed score batch ${batchIndex} postings`);
        return batch.postings;
      });
      const totals = new Map();
      for (const [postingIndex, posting] of accumulated.entries()) {
        assert.ok(posting && typeof posting === 'object' && !Array.isArray(posting),
          `${label}: confirmed score posting ${postingIndex}`);
        const current = totals.get(posting.userId) ?? 0n;
        totals.set(posting.userId, current + amountUnits(posting.amount, `${label}: confirmed score posting ${postingIndex}`));
      }
      assert.deepEqual([...totals].map(([userId, units]) => ({ userId, units })).sort((left, right) =>
        left.userId.localeCompare(right.userId)), result.settlement.map(posting =>
        ({ userId: posting.userId, units: amountUnits(posting.amount, `${label}: settlement posting`) })).sort((left, right) =>
        left.userId.localeCompare(right.userId)), `${label}: confirmedScores must reconcile to settlement`);
      assert.equal([...totals.values()].reduce((sum, value) => sum + value, 0n), 0n,
        `${label}: confirmedScores must be zero-sum`);
    }

    const winner = winnerFrom(snapshot, label);
    assert.equal(winner.win?.scoreUnits, item.expected.scoreUnits, `${label}: scoreUnits`);
    assert.deepEqual(winner.win?.items, item.expected.items, `${label}: winning items`);
  }

  return { variantKey, cases: fixture.cases.length, passed: true };
}
