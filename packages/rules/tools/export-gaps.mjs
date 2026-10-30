import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  catalogue, getRoomSpec, getRuleGaps, GAP_LEDGER_VERSION, originalVariants, RELEASE_EVIDENCE_STATUS,
  RULE_VERSION, ruleGaps, supportsNewRoom,
} from '../dist/index.js';
import { rulebookContentSha256 } from '../../../tools/rulebook-integrity.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const releaseDirectory = key => key.replace(':', '-');
const releasePath = (key, file) => `docs/rules/release/${releaseDirectory(key)}/${file}`;

function readReleaseEvidence(key) {
  const manifestPath = releasePath(key, 'manifest.json');
  const rulebookPath = releasePath(key, 'rulebook.json');
  const approvalPath = releasePath(key, 'approval.json');
  const casesPath = releasePath(key, 'cases.json');
  const read = relative => fs.readFileSync(path.resolve(project, relative), 'utf8');
  const manifestRaw = read(manifestPath);
  const rulebookRaw = read(rulebookPath);
  const approvalRaw = read(approvalPath);
  const casesRaw = read(casesPath);
  const manifest = JSON.parse(manifestRaw);
  const rulebook = JSON.parse(rulebookRaw);
  const approval = JSON.parse(approvalRaw);
  const cases = JSON.parse(casesRaw);
  const rulebookSha256 = sha256(rulebookRaw);
  const casesSha256 = sha256(casesRaw);
  const approvalSha256 = sha256(approvalRaw);
  const manifestSha256 = sha256(manifestRaw);

  if (manifest.variantKey !== key || rulebook.variantKey !== key || approval.variantKey !== key) {
    throw new Error(`Variant key mismatch in release evidence for ${key}`);
  }
  if (rulebook.status !== 'approved' || rulebook.basis !== 'user-approved') {
    throw new Error(`Release rulebook for ${key} is not user-approved`);
  }
  if (approval.kind !== 'user-rule-approval') throw new Error(`Release approval for ${key} has the wrong kind`);
  if (manifest.ruleVersion !== rulebook.ruleVersion || manifest.ruleVersion !== approval.ruleVersion) {
    throw new Error(`Rule version mismatch in release evidence for ${key}`);
  }
  if (manifest.rulebook.sha256 !== rulebookSha256 || manifest.cases.sha256 !== casesSha256) {
    throw new Error(`Release file digest mismatch for ${key}`);
  }
  if (rulebook.approval?.sha256 !== approvalSha256) throw new Error(`Approval digest mismatch for ${key}`);
  if (approval.rulebookSha256 !== rulebookContentSha256(rulebook)) {
    throw new Error(`Approval content binding mismatch for ${key}`);
  }
  if (!Array.isArray(cases.cases) || cases.cases.length === 0) throw new Error(`Release cases are empty for ${key}`);

  const runtimeSource = fs.readFileSync(path.resolve(project, 'apps/server/src/runtime-engines.ts'), 'utf8');
  if (!runtimeSource.includes(`'${manifest.rulebook.path}'`) || !runtimeSource.includes(`'${manifest.rulebook.sha256}'`)
    || !runtimeSource.includes(`'${manifest.cases.path}'`) || !runtimeSource.includes(`'${manifest.cases.sha256}'`)) {
    throw new Error(`Runtime registration does not bind release evidence for ${key}`);
  }

  return {
    status: RELEASE_EVIDENCE_STATUS,
    ruleVersion: manifest.ruleVersion,
    rulebook: { path: rulebookPath, sha256: rulebookSha256 },
    cases: { path: casesPath, sha256: casesSha256, count: cases.cases.length },
    approval: { path: approvalPath, sha256: approvalSha256 },
    manifest: { path: manifestPath, sha256: manifestSha256 },
  };
}

const releaseEvidence = Object.fromEntries(catalogue.map(variant => [variant.key, readReleaseEvidence(variant.key)]));
const retained = catalogue.map(variant => {
  const spec = getRoomSpec(variant.key);
  const gaps = getRuleGaps(variant.key);
  const blockers = gaps.filter(gap => gap.blocksGameplay);
  return {
    variantKey: variant.key,
    name: variant.name,
    gameId: variant.gameId,
    ruleVersion: variant.ruleVersion,
    evidenceStatus: variant.evidenceStatus,
    gameplayReady: variant.gameplayReady && blockers.length === 0,
    fieldCount: spec.fields.length,
    unresolvedFields: spec.unresolvedFields,
    releaseEvidence: releaseEvidence[variant.key],
    gapIds: gaps.map(gap => gap.id),
    blockingGapIds: blockers.map(gap => gap.id),
  };
});

const originalAudit = originalVariants.filter(variant => !supportsNewRoom(variant.key)).map(variant => ({
  variantKey: variant.key,
  name: variant.name,
  gameId: variant.gameId,
  evidenceStatus: variant.evidenceStatus,
  gameplayReady: false,
  gapIds: getRuleGaps(variant.key).map(gap => gap.id),
}));

const ledger = {
  schemaVersion: 2,
  ledgerVersion: GAP_LEDGER_VERSION,
  ruleVersion: RULE_VERSION,
  scope: { retainedConfigurations: retained.length, originalAuditConfigurations: originalAudit.length },
  summary: {
    releaseVerifiedConfigurations: retained.filter(item => item.evidenceStatus === RELEASE_EVIDENCE_STATUS).length,
    gameplayReadyConfigurations: retained.filter(item => item.gameplayReady).length,
    blockedConfigurations: retained.filter(item => !item.gameplayReady).length,
    blockingGaps: retained.reduce((count, item) => count + item.blockingGapIds.length, 0),
    resolvedGaps: ruleGaps.filter(gap => gap.status === 'resolved-by-product-rule').length,
    auditOnlyBlockingGaps: ruleGaps.filter(gap => !supportsNewRoom(gap.variantKey) && gap.blocksGameplay).length,
  },
  retained,
  originalAudit,
  gaps: ruleGaps,
};

fs.writeFileSync(new URL('../rule-gaps.json', import.meta.url), JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ retained: retained.length, releaseVerified: ledger.summary.releaseVerifiedConfigurations,
  gameplayReady: ledger.summary.gameplayReadyConfigurations, blocked: ledger.summary.blockedConfigurations,
  blockingGaps: ledger.summary.blockingGaps, auditOnlyBlockingGaps: ledger.summary.auditOnlyBlockingGaps }));
