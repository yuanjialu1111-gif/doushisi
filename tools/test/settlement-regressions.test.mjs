import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSettlementRegressions } from '../settlement-regressions.mjs';
import { runtimeEngineEntries } from '../../apps/server/src/runtime-engines.ts';

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-settlement-'));
  try { await run(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function writeCase(root, fixtureValue) {
  const directory = path.join(root, 'docs/rules/release/2-0');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'settlement-cases.json'), JSON.stringify(fixtureValue));
}

const expected = {
  settlement: [{ userId: 'a', amount: '1' }, { userId: 'b', amount: '-1' }],
  scoreUnits: '4',
  items: [{ pattern: 'test', count: 1, fan: 2 }],
};

const fixtureValue = {
  schemaVersion: 1,
  kind: 'final-settlement-regression',
  variantKey: '2:0',
  ruleVersion: 'test',
  cases: [{
    id: 'final-settlement',
    initialSnapshot: { phase: 'discard', outcome: null },
    actions: [{ userId: 'a', action: { type: 'finish' } }],
    expected,
  }],
};

function fakeEngine() {
  return {
    variantKey: '2:0',
    version: 'test',
    apply(snapshot) {
      return {
        snapshot: { ...snapshot, phase: 'finished', outcome: { reason: 'hu', winners: [{ userId: 'a', win: {
          scoreUnits: '4', items: [{ pattern: 'test', count: 1, fan: 2 }],
        } }] } },
        settlement: [...expected.settlement],
        confirmedScores: [{ eventId: 'final', postings: [...expected.settlement] }],
      };
    },
  };
}

test('settlement regressions skip variants without a fixture', async () => {
  await fixture(async root => {
    assert.equal(await runSettlementRegressions({ root, engine: fakeEngine(), entry: {} }), null);
  });
});

test('settlement regressions replay actions and enforce final settlement invariants', async () => {
  await fixture(async root => {
    await writeCase(root, fixtureValue);
    const engine = fakeEngine();
    let calls = 0;
    const apply = engine.apply;
    engine.apply = (...args) => { calls++; return apply(...args); };
    assert.deepEqual(await runSettlementRegressions({ root, engine, entry: {} }), {
      variantKey: '2:0', cases: 1, passed: true,
    });
    assert.equal(calls, 1);
  });
});

test('settlement regressions reject a non-final outcome', async () => {
  await fixture(async root => {
    await writeCase(root, fixtureValue);
    const engine = fakeEngine();
    const apply = engine.apply;
    engine.apply = snapshot => ({ ...apply(snapshot), snapshot: { ...snapshot, phase: 'discard', outcome: null } });
    await assert.rejects(runSettlementRegressions({ root, engine, entry: {} }), /final phase/);
  });
});

test('settlement regressions reject missing confirmed scores', async () => {
  await fixture(async root => {
    await writeCase(root, fixtureValue);
    const engine = fakeEngine();
    const apply = engine.apply;
    engine.apply = snapshot => { const result = apply(snapshot); delete result.confirmedScores; return result; };
    await assert.rejects(runSettlementRegressions({ root, engine, entry: {} }), /confirmedScores are required/);
  });
});

test('settlement regressions replay every released final-settlement fixture', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const variants = new Set(['23:0', '25:0', '26:0', '27:0']);
  let total = 0;
  for (const entry of runtimeEngineEntries.filter(item => variants.has(item.engine.variantKey))) {
    const summary = await runSettlementRegressions({ root, engine: entry.engine, entry });
    assert.ok(summary, `${entry.engine.variantKey}: settlement fixture must exist`);
    assert.equal(summary.passed, true, `${entry.engine.variantKey}: settlement replay`);
    total += summary.cases;
  }
  assert.equal(total, 20, 'released settlement fixture count');
});
