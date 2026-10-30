import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditRelease } from './release-audit.mjs';
import { releaseSubject } from './build-fingerprint.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.argv.includes('--local') ? 'local' : 'production';
const buildBlockers = [];
let subject, entries = [], variants = [];
try {
  subject = await releaseSubject(root);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'verification/build-manifest.json'), 'utf8'));
  if (manifest.sources.sha256 !== subject.sources || manifest.binaries.sha256 !== subject.binaries) {
    buildBlockers.push({ code: 'STALE_BUILD', detail: 'Run pnpm build against the current source tree.' });
  }
  const runtime = await import(pathToFileURL(path.join(root, 'apps/server/dist/runtime-engines.js')).href);
  entries = runtime.runtimeEngineEntries;
  const rules = await import(pathToFileURL(path.join(root, 'packages/rules/dist/index.js')).href);
  variants = rules.catalogue.map(variant => ({ ...variant, playerCounts: rules.getRoomSpec(variant.key).fields.find(field => field.key === 'playerNum')?.allowedValues ?? [2, 3, 4],
    roundCounts: rules.getRoomSpec(variant.key).fields.find(field => field.key === 'gameNum')?.allowedValues ?? [4, 8, 12],
    optionCoverage: rules.getRoomSpec(variant.key).fields.flatMap(field =>
    field.allowedValues.map(value => `option:${field.key}=${JSON.stringify(value)}`)) }));
} catch (error) {
  buildBlockers.push({ code: 'BUILD_UNAVAILABLE', detail: error.message });
  const fallback = await import(pathToFileURL(path.join(root, 'packages/rules/dist/index.js')).href).catch(() => null);
  variants = fallback
    ? fallback.catalogue.map(variant => ({ ...variant, playerCounts: fallback.getRoomSpec(variant.key).fields.find(field => field.key === 'playerNum')?.allowedValues ?? [2, 3, 4],
      roundCounts: fallback.getRoomSpec(variant.key).fields.find(field => field.key === 'gameNum')?.allowedValues ?? [4, 8, 12],
      optionCoverage: fallback.getRoomSpec(variant.key).fields.flatMap(field =>
        field.allowedValues.map(value => `option:${field.key}=${JSON.stringify(value)}`)) }))
    : [];
}
const report = await auditRelease(root, entries, variants, subject ?? { sha256: null }, profile);
report.blockers.unshift(...buildBlockers);
try {
  const ruleGapLedger = JSON.parse(await fs.readFile(path.join(root, 'packages/rules/rule-gaps.json'), 'utf8'));
  if (ruleGapLedger.schemaVersion !== 2 || ruleGapLedger.ledgerVersion !== 'rule-gap-ledger-v2') {
    report.blockers.push({ code: 'RULE_GAP_LEDGER_INVALID', detail: 'The rule-gap ledger is not the supported v2 schema.' });
  } else {
    for (const item of ruleGapLedger.retained ?? []) {
      if (item.gameplayReady === true) continue;
      report.blockers.push({ code: 'RULE_GAP_BLOCKED', variantKey: item.variantKey,
        evidence: item.blockingGapIds ?? [], detail: 'The rule-gap ledger marks this retained configuration as not ready for gameplay.' });
    }
  }
} catch (error) {
  report.blockers.push({ code: 'RULE_GAP_LEDGER_INVALID', detail: error.message });
}
report.releaseReady = profile === 'production' && report.blockers.length === 0;
report.localReady = profile === 'local' && report.blockers.length === 0;
await fs.mkdir(path.join(root, 'verification'), { recursive: true });
await fs.writeFile(path.join(root, profile === 'local' ? 'verification/local-readiness.json' : 'verification/release-readiness.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ profile, localReady: report.localReady, releaseReady: report.releaseReady, configurations: report.configurations,
  registeredEngines: report.registeredEngines, verifiedEngines: report.verifiedEngines,
  blockers: report.blockers.map(({ code, variantKey, evidence }) => ({ code, variantKey, evidence })) }, null, 2));
process.exitCode = report.blockers.length === 0 ? 0 : 1;
