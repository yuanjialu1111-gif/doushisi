import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ledger = JSON.parse(fs.readFileSync(path.join(project, 'packages/rules/rule-gaps.json'), 'utf8'));

test('release evidence and gameplay readiness are tracked separately', () => {
  assert.equal(ledger.schemaVersion, 2);
  assert.equal(ledger.ledgerVersion, 'rule-gap-ledger-v2');
  assert.equal(ledger.summary.releaseVerifiedConfigurations, 21);
  assert.equal(ledger.summary.gameplayReadyConfigurations, 21);
  assert.equal(ledger.summary.blockedConfigurations, 0);
  assert.equal(ledger.summary.blockingGaps, 0);
  assert.equal(ledger.summary.auditOnlyBlockingGaps, 1);
  assert.deepEqual(ledger.retained.filter(item => !item.gameplayReady).map(item => item.variantKey),
    []);
});

test('every release-verified retained variant has a digest-bound evidence bundle', () => {
  for (const item of ledger.retained) {
    assert.equal(item.evidenceStatus, 'verified-release');
    assert.match(item.releaseEvidence.rulebook.sha256, /^[0-9a-f]{64}$/);
    assert.match(item.releaseEvidence.cases.sha256, /^[0-9a-f]{64}$/);
    assert.match(item.releaseEvidence.approval.sha256, /^[0-9a-f]{64}$/);
    assert.match(item.releaseEvidence.manifest.sha256, /^[0-9a-f]{64}$/);
  }
});

test('the retained Leibo switch is resolved as an independent product rule', () => {
  const retainedKeys = new Set(ledger.retained.map(item => item.variantKey));
  const blocked = ledger.gaps.filter(gap => gap.blocksGameplay && retainedKeys.has(gap.variantKey));
  assert.deepEqual(blocked, []);
  const resolved = ledger.gaps.find(gap => gap.id === '24:0:ownBaKeQiang');
  assert.equal(resolved?.status, 'resolved-by-product-rule');
  assert.equal(resolved?.blocksGameplay, false);
  assert.deepEqual(resolved?.fields, ['ownBaKeQiang']);
  assert.ok(resolved?.description.length > 0);
  assert.ok(resolved?.requiredEvidence.length > 0);
  assert.ok(resolved?.impact.length > 0);
});

test('blood-battle routing remains a separate audit-only blocker', () => {
  const audit = ledger.originalAudit.find(item => item.variantKey === '101:0');
  assert.ok(audit);
  const gap = ledger.gaps.find(item => item.id === '101:0:blood-battle-routing');
  assert.equal(gap?.status, 'behavior-unverified');
  assert.equal(gap?.blocksGameplay, true);
  assert.ok(!ledger.retained.some(item => item.variantKey === '101:0'));
});
