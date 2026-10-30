import { readFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { RETAINED_VARIANT_KEYS } from '../packages/rules/src/edition.ts';
import { rulebookContentSha256 } from './rulebook-integrity.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(project, 'docs/rules');
const runtimePath = resolve(project, 'apps/server/src/runtime-engines.ts');
const ruleGapsPath = resolve(project, 'packages/rules/rule-gaps.json');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const releaseDirectory = key => key.replace(':', '-');
const releasePath = (key, file) => `docs/rules/release/${releaseDirectory(key)}/${file}`;
const fixedEngineKeys = { Xinjin: '4:0', Anyue: '5:0', Yaan: '6:0', Pujiang: '7:0', Qionglai: '8:0' };
const settlementVariants = new Set(['23:0', '25:0', '26:0', '27:0']);

export function validateSettlementCases({ key, settlementPath, settlementRaw, officialCasesSha256, rulebookSha256, ruleVersion }) {
  assert.ok(settlementRaw !== undefined && settlementRaw !== null,
    `${key}: settlement cases file is required: ${settlementPath}`);
  const settlement = JSON.parse(settlementRaw);
  assert.equal(settlement.schemaVersion, 1, `${key}: settlement cases schema`);
  assert.equal(settlement.kind, 'final-settlement-regression', `${key}: settlement cases kind`);
  assert.equal(settlement.variantKey, key, `${key}: settlement cases variant`);
  assert.equal(settlement.ruleVersion, ruleVersion, `${key}: settlement cases version`);
  assert.equal(settlement.officialCasesSha256, officialCasesSha256, `${key}: settlement cases official digest`);
  assert.equal(settlement.rulebookDigest, rulebookSha256, `${key}: settlement cases rulebook digest`);
  assert.ok(Array.isArray(settlement.cases) && settlement.cases.length > 0,
    `${key}: settlement cases must be non-empty`);
  assert.ok(Array.isArray(settlement.blocked), `${key}: settlement blocked entries must be an array`);

  const blocked = [...settlement.cases, ...settlement.blocked]
    .filter(item => item?.status === 'implementation-blocked');
  assert.equal(blocked.length, 0,
    `${key}: settlement cases remain implementation-blocked: ${blocked.map(item => item.id ?? item.requirement ?? 'unknown').join(', ')}`);

  for (const item of settlement.blocked) {
    const label = item?.id ?? item?.requirement ?? 'unknown';
    assert.equal(item?.status, 'not-applicable',
      `${key}: unsupported blocked settlement status for ${label}: ${item?.status ?? 'missing'}`);
    assert.ok(typeof item.reason === 'string' && item.reason.trim().length > 0,
      `${key}: not-applicable settlement case must include a reason: ${label}`);
  }
  return settlement;
}

function parseRuntimeEntries(source) {
  const start = source.indexOf('export const runtimeEngineEntries');
  assert.ok(start >= 0, 'runtimeEngineEntries is missing');
  const open = source.indexOf('[', start);
  const end = source.indexOf('\n]);', open);
  assert.ok(open >= 0 && end >= 0, 'runtimeEngineEntries array could not be parsed');
  const block = source.slice(open, end);
  const entries = [];
  const pattern = /\{\s*engine:\s*([^\n]+),\s*rulebook:\s*\{\s*path:\s*'([^']+)',\s*sha256:\s*'([^']+)'\s*\},\s*cases:\s*\{\s*path:\s*'([^']+)',\s*sha256:\s*'([^']+)'\s*\},?\s*\}/g;
  for (const match of block.matchAll(pattern)) {
    const engineLine = match[1];
    const factory = engineLine.match(/create([A-Za-z0-9]+)Engine/)?.[1];
    assert.ok(factory, `Cannot identify engine factory in: ${engineLine}`);
    const explicitKey = [...engineLine.matchAll(/'([^']+)'/g)].map(item => item[1]).find(value => /^\d+:\d+$/.test(value));
    entries.push({ variantKey: explicitKey ?? fixedEngineKeys[factory],
      rulebook: { path: match[2], sha256: match[3] }, cases: { path: match[4], sha256: match[5] } });
  }
  assert.ok(entries.length > 0, 'No runtime engine entries were parsed');
  return entries;
}

function parsePreviewKeys(source) {
  const start = source.indexOf('export const previewEngineKeys');
  assert.ok(start >= 0, 'previewEngineKeys is missing');
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  assert.ok(open >= 0 && close >= 0, 'previewEngineKeys could not be parsed');
  return [...source.slice(open + 1, close).matchAll(/'([^']+)'/g)].map(item => item[1]);
}

export async function checkRulebook() {
const coverage = JSON.parse(await readFile(resolve(root, 'coverage.json'), 'utf8'));
const readiness = JSON.parse(await readFile(resolve(project, 'verification/local-readiness.json'), 'utf8'));
const ruleGaps = JSON.parse(await readFile(ruleGapsPath, 'utf8'));
const runtimeSource = await readFile(runtimePath, 'utf8');
const expected = RETAINED_VARIANT_KEYS;
assert.deepEqual(coverage.variants.map(variant => variant.variantKey), expected);
assert.equal(new Set(coverage.variants.map(variant => variant.gameId)).size, expected.length);
assert.equal(coverage.schemaVersion, 2);
assert.equal(coverage.status, 'release-rulebooks-approved-engines-registered');
assert.equal(coverage.userResearchDirection.version, 'independent-authorization-20260916-v1');
assert.equal(coverage.userResearchDirection.answer, '全部自动批准');
assert.equal(coverage.userResearchDirection.verificationBypass, false);
assert.equal(coverage.userResearchDirection.videosAllowed, false);
assert.equal(coverage.decisionDefinitions.length, 17);
assert.equal(coverage.summary.originalServerComparisons, 0);
assert.equal(ruleGaps.schemaVersion, 2);
assert.equal(ruleGaps.ledgerVersion, 'rule-gap-ledger-v2');
assert.equal(ruleGaps.scope.retainedConfigurations, expected.length);
assert.deepEqual(ruleGaps.retained.map(item => item.variantKey), expected);
const gapStateByKey = new Map(ruleGaps.retained.map(item => [item.variantKey, item]));

const releaseDirectories = (await readdir(resolve(root, 'release'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
assert.deepEqual(releaseDirectories, expected.map(releaseDirectory).sort(), 'release directory scope mismatch');

const runtimeEntries = parseRuntimeEntries(runtimeSource);
assert.equal(runtimeEntries.length, expected.length, 'runtimeEngineEntries count mismatch');
assert.equal(new Set(runtimeEntries.map(entry => entry.variantKey)).size, runtimeEntries.length,
  'runtimeEngineEntries contains duplicate variant keys');
assert.deepEqual([...runtimeEntries.map(entry => entry.variantKey)].sort(), [...expected].sort(),
  'runtimeEngineEntries key scope mismatch');
const runtimeByKey = new Map(runtimeEntries.map(entry => [entry.variantKey, entry]));

const previewKeys = parsePreviewKeys(runtimeSource);
for (const key of previewKeys) assert.equal(runtimeByKey.has(key), false, `preview key is in production registry: ${key}`);
const previewStart = runtimeSource.indexOf('export function createPreviewEngineRegistry');
assert.ok(previewStart >= 0, 'createPreviewEngineRegistry is missing');
const nextExport = runtimeSource.indexOf('\nexport function', previewStart + 1);
const previewBody = runtimeSource.slice(previewStart, nextExport < 0 ? undefined : nextExport);
assert.match(previewBody, /previewEngineKeys/, 'preview registry must use previewEngineKeys');
assert.doesNotMatch(previewBody, /createRuntimeEngineRegistry|runtimeEngineEntries/,
  'preview registry must not fall back to production entries');

let approvedCount = 0;
let registeredCount = 0;
let fullRoomVerifiedCount = 0;
const rulebookSources = new Set();
const duplicateSourceKeys = [];
for (const key of expected) {
  const manifestPath = releasePath(key, 'manifest.json');
  const rulebookPath = releasePath(key, 'rulebook.json');
  const approvalPath = releasePath(key, 'approval.json');
  const casesPath = releasePath(key, 'cases.json');
  const [manifestRaw, rulebookRaw, approvalRaw, casesRaw] = await Promise.all([
    readFile(resolve(project, manifestPath)),
    readFile(resolve(project, rulebookPath)),
    readFile(resolve(project, approvalPath)),
    readFile(resolve(project, casesPath)),
  ]);
  const manifest = JSON.parse(manifestRaw);
  const rulebook = JSON.parse(rulebookRaw);
  const approval = JSON.parse(approvalRaw);
  const manifestSha256 = sha256(manifestRaw);
  const rulebookSha256 = sha256(rulebookRaw);
  const casesSha256 = sha256(casesRaw);
  const approvalSha256 = sha256(approvalRaw);

  assert.equal(manifest.schemaVersion, 1, `${key}: manifest schema`);
  assert.equal(manifest.variantKey, key, `${key}: manifest variant`);
  assert.match(manifest.ruleVersion, /^[a-z0-9][a-z0-9-]+-v\d+$/, `${key}: rule version`);
  assert.equal(manifest.rulebook.path, rulebookPath, `${key}: manifest rulebook path`);
  assert.equal(manifest.cases.path, casesPath, `${key}: manifest cases path`);
  assert.equal(manifest.rulebook.sha256, rulebookSha256, `${key}: manifest rulebook digest`);
  assert.equal(manifest.cases.sha256, casesSha256, `${key}: manifest cases digest`);

  if (settlementVariants.has(key)) {
    const settlementPath = releasePath(key, 'settlement-cases.json');
    let settlementRaw;
    try {
      settlementRaw = await readFile(resolve(project, settlementPath));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    validateSettlementCases({ key, settlementPath, settlementRaw, officialCasesSha256: casesSha256,
      rulebookSha256: manifest.rulebook.sha256, ruleVersion: manifest.ruleVersion });
  }

  assert.equal(rulebook.schemaVersion, 1, `${key}: rulebook schema`);
  assert.equal(rulebook.status, 'approved', `${key}: rulebook status`);
  assert.equal(rulebook.basis, 'user-approved', `${key}: rulebook basis`);
  assert.equal(rulebook.variantKey, key, `${key}: rulebook variant`);
  assert.equal(rulebook.ruleVersion, manifest.ruleVersion, `${key}: rulebook version`);
  assert.equal(rulebook.approval?.path, approvalPath, `${key}: rulebook approval path`);
  assert.equal(rulebook.approval?.sha256, approvalSha256, `${key}: rulebook approval digest`);

  assert.ok(Array.isArray(rulebook.sources) && rulebook.sources.length > 0,
    `${key}: rulebook must declare its evidence sources`);
  for (const source of rulebook.sources) {
    assert.ok(typeof source === 'string' && source.trim() === source && source.length > 0,
      `${key}: invalid evidence source declaration`);
    assert.ok(!isAbsolute(source) && !/^[A-Za-z]:/.test(source) && !source.includes('\\\\'),
      `${key}: evidence source must be a portable project-relative path: ${source}`);
    rulebookSources.add(source);
  }
  if (new Set(rulebook.sources).size !== rulebook.sources.length) duplicateSourceKeys.push(key);

  assert.equal(approval.kind, 'user-rule-approval', `${key}: approval kind`);
  assert.equal(approval.variantKey, key, `${key}: approval variant`);
  assert.equal(approval.ruleVersion, manifest.ruleVersion, `${key}: approval version`);
  assert.equal(approval.rulebookSha256, rulebookContentSha256(rulebook), `${key}: approval content binding`);
  assert.ok(!Number.isNaN(Date.parse(approval.recordedAt)), `${key}: approval date`);
  assert.equal(approval.evidenceReference, 'docs/rules/INDEPENDENT-APPROVAL.md', `${key}: approval evidence reference`);

  const runtime = runtimeByKey.get(key);
  assert.ok(runtime, `${key}: runtime registration`);
  assert.deepEqual(runtime.rulebook, manifest.rulebook, `${key}: runtime rulebook binding`);
  assert.deepEqual(runtime.cases, manifest.cases, `${key}: runtime cases binding`);

  const variant = coverage.variants.find(item => item.variantKey === key);
  assert.ok(variant, `${key}: coverage variant`);
  assert.equal(variant.ruleStatus, 'approved', `${key}: coverage rule status`);
  const gapState = gapStateByKey.get(key);
  assert.ok(gapState, `${key}: rule-gap ledger entry`);
  assert.equal(gapState.evidenceStatus, 'verified-release', `${key}: release evidence status`);
  assert.equal(variant.gameplayReady, gapState.gameplayReady, `${key}: coverage gameplay readiness`);
  assert.deepEqual(variant.ruleGap, gapState.blockingGapIds, `${key}: coverage blocking gaps`);
  assert.equal(variant.definition.status, 'approved', `${key}: coverage definition status`);
  assert.equal(variant.definition.basis, 'user-approved', `${key}: coverage definition basis`);
  assert.equal(variant.definition.version, manifest.ruleVersion, `${key}: coverage definition version`);
  assert.equal(variant.definition.document, rulebookPath, `${key}: coverage definition document`);
  assert.equal(variant.implementation.status, 'registered', `${key}: coverage implementation status`);
  assert.equal(variant.implementation.fullRoomVerified, readiness.localReady === true,
    `${key}: full-room verification must match local-readiness`);
  assert.equal(variant.implementation.fullRoomVerificationScope, 'current-release-subject', `${key}: verification scope`);
  assert.deepEqual(variant.release.rulebook, manifest.rulebook, `${key}: coverage rulebook evidence`);
  assert.deepEqual(variant.release.cases, manifest.cases, `${key}: coverage cases evidence`);
  assert.deepEqual(variant.release.approval, { path: approvalPath, sha256: approvalSha256 },
    `${key}: coverage approval evidence`);
  assert.deepEqual(variant.release.manifest, { path: manifestPath, sha256: manifestSha256 },
    `${key}: coverage manifest evidence`);
  assert.ok(variant.researchAuthorization, `${key}: historical authorization retained`);
  assert.equal(variant.researchAuthorization.variantKey, key, `${key}: historical authorization variant`);
  assert.ok(variant.originalEvidence.options.length > 0, `${key}: original option evidence retained`);
  assert.ok(variant.proposedRules.length > 0, `${key}: proposed research retained`);
  assert.ok(variant.examples.length > 0, `${key}: research examples retained`);
  assert.ok(variant.unresolvedResearch.length > 0, `${key}: unresolved research retained`);
  assert.ok(variant.dimensions.every(dimension => dimension.researchStatus), `${key}: research dimension history retained`);
  assert.equal(variant.dimensions.length, 8, `${key}: research dimensions`);
  approvedCount++;
  registeredCount++;
  if (variant.implementation.fullRoomVerified) fullRoomVerifiedCount++;
}

assert.equal(coverage.summary.approvedConfigurationRules, approvedCount);
assert.equal(coverage.summary.gameplayReadyConfigurations,
  ruleGaps.retained.filter(item => item.gameplayReady).length);
assert.equal(coverage.summary.completedGameplayEngines, registeredCount);
assert.equal(coverage.summary.registeredRuntimeEngines, registeredCount);
assert.equal(coverage.summary.fullRoomVerifiedConfigurations, fullRoomVerifiedCount);
assert.equal(coverage.summary.configurations, expected.length);
assert.equal(coverage.summary.gameIds, expected.length);
assert.equal(coverage.summary.authorizedConfigurations, expected.length);
assert.equal(coverage.summary.originalServerComparisons, 0);

for (const [file, expectedHash] of Object.entries(coverage.sourceHashes)) {
  const actual = sha256(await readFile(resolve(project, file)));
  assert.equal(actual, expectedHash, `Source drift: ${file}; regenerate rulebook`);
}

for (const source of rulebookSources) {
  assert.ok(Object.hasOwn(coverage.sourceHashes, source),
    `Rulebook evidence source is not hash-bound: ${source}; regenerate rulebook`);
  const actual = sha256(await readFile(resolve(project, source)));
  assert.equal(actual, coverage.sourceHashes[source],
    `Rulebook evidence source drift: ${source}; regenerate rulebook`);
}

const markdown = ['README.md', 'decisions.md', 'github-review.md', 'INDEPENDENT-APPROVAL.md', 'QIONGLAI-INDEPENDENT.md',
  ...(await readdir(resolve(root, 'variants'))).filter(file => file.endsWith('.md')).map(file => `variants/${file}`)];
let links = 0;
for (const file of markdown) {
  const text = await readFile(resolve(root, file), 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^https?:/.test(target)) continue;
    assert.equal(isAbsolute(target), false, `Use portable document links in ${file}`);
    const targetPath = target.startsWith('docs/rules/')
      ? resolve(project, target)
      : resolve(dirname(resolve(root, file)), target);
    await access(targetPath);
    links++;
  }
}

console.log(JSON.stringify({ passed: true, configurations: coverage.variants.length,
  approvedConfigurationRules: approvedCount, registeredRuntimeEngines: registeredCount,
  fullRoomVerifiedConfigurations: fullRoomVerifiedCount, previewEngineKeys: previewKeys.length,
  localLinks: links, sourceHashes: Object.keys(coverage.sourceHashes).length,
  rulebookEvidenceSources: rulebookSources.size, duplicateSourceKeys }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkRulebook();
