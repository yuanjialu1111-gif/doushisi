import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETAINED_VARIANT_KEYS } from '../packages/rules/src/edition.ts';
import { rulebookContentSha256 } from './rulebook-integrity.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(project, 'docs/rules');
const runtimePath = resolve(project, 'apps/server/src/runtime-engines.ts');
const readinessPath = resolve(project, 'verification/local-readiness.json');
const ruleGapsPath = resolve(project, 'packages/rules/rule-gaps.json');
const coveragePath = resolve(root, 'coverage.json');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const parseJson = value => JSON.parse(value);
const readJson = async path => parseJson(await readFile(path, 'utf8'));
const releaseDirectory = key => key.replace(':', '-');
const releasePath = (key, file) => `docs/rules/release/${releaseDirectory(key)}/${file}`;
const fixedEngineKeys = { Xinjin: '4:0', Anyue: '5:0', Yaan: '6:0', Pujiang: '7:0', Qionglai: '8:0' };

function parseRuntimeEntries(source) {
  const start = source.indexOf('export const runtimeEngineEntries');
  if (start < 0) throw new Error('runtimeEngineEntries is missing.');
  const open = source.indexOf('[', start);
  const end = source.indexOf('\n]);', open);
  if (open < 0 || end < 0) throw new Error('runtimeEngineEntries array could not be parsed.');
  const block = source.slice(open, end);
  const entries = [];
  const pattern = /\{\s*engine:\s*([^\n]+),\s*rulebook:\s*\{\s*path:\s*'([^']+)',\s*sha256:\s*'([^']+)'\s*\},\s*cases:\s*\{\s*path:\s*'([^']+)',\s*sha256:\s*'([^']+)'\s*\},?\s*\}/g;
  for (const match of block.matchAll(pattern)) {
    const engineLine = match[1];
    const factory = engineLine.match(/create([A-Za-z0-9]+)Engine/)?.[1];
    if (!factory) throw new Error(`Cannot identify engine factory in: ${engineLine}`);
    const explicitKey = [...engineLine.matchAll(/'([^']+)'/g)].map(item => item[1]).find(value => /^\d+:\d+$/.test(value));
    const variantKey = explicitKey ?? fixedEngineKeys[factory];
    if (!variantKey) throw new Error(`Cannot identify variant key for factory ${factory}.`);
    entries.push({ variantKey, rulebook: { path: match[2], sha256: match[3] },
      cases: { path: match[4], sha256: match[5] } });
  }
  if (!entries.length) throw new Error('No runtime engine entries were parsed.');
  return entries;
}

function parsePreviewKeys(source) {
  const start = source.indexOf('export const previewEngineKeys');
  if (start < 0) throw new Error('previewEngineKeys is missing.');
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open < 0 || close < 0) throw new Error('previewEngineKeys could not be parsed.');
  return [...source.slice(open + 1, close).matchAll(/'([^']+)'/g)].map(item => item[1]);
}

const previous = await readJson(coveragePath);
const runtimeSource = await readFile(runtimePath, 'utf8');
const runtimeEntries = parseRuntimeEntries(runtimeSource);
const previewKeys = parsePreviewKeys(runtimeSource);
const readiness = await readJson(readinessPath);
const ruleGapLedger = await readJson(ruleGapsPath);
const fullRoomVerified = readiness.localReady === true;
const releaseReady = readiness.releaseReady === true;
const retainedGapState = new Map(ruleGapLedger.retained.map(item => [item.variantKey, item]));
if (ruleGapLedger.schemaVersion !== 2 || ruleGapLedger.ledgerVersion !== 'rule-gap-ledger-v2') {
  throw new Error('Rule-gap ledger is not the supported v2 schema. Run packages/rules/tools/export-gaps.mjs.');
}
if (retainedGapState.size !== RETAINED_VARIANT_KEYS.length
  || RETAINED_VARIANT_KEYS.some(key => !retainedGapState.has(key))) {
  throw new Error('Rule-gap ledger does not cover the retained configuration scope.');
}
for (const key of RETAINED_VARIANT_KEYS) {
  const state = retainedGapState.get(key);
  if (state.evidenceStatus === 'verified-release' && !state.releaseEvidence) {
    throw new Error(`Release-verified gap entry is missing evidence binding: ${key}`);
  }
  if (state.gameplayReady !== true && (!Array.isArray(state.blockingGapIds) || state.blockingGapIds.length === 0)) {
    throw new Error(`Blocked configuration has no explicit rule gap: ${key}`);
  }
}

if (runtimeEntries.length !== RETAINED_VARIANT_KEYS.length) {
  throw new Error(`Expected ${RETAINED_VARIANT_KEYS.length} runtime entries, found ${runtimeEntries.length}.`);
}
if (new Set(runtimeEntries.map(entry => entry.variantKey)).size !== runtimeEntries.length) {
  throw new Error('runtimeEngineEntries contains duplicate variant keys.');
}
if (runtimeEntries.some(entry => !RETAINED_VARIANT_KEYS.includes(entry.variantKey))) {
  throw new Error('runtimeEngineEntries contains a variant outside the retained scope.');
}
const runtimeByKey = new Map(runtimeEntries.map(entry => [entry.variantKey, entry]));
if (RETAINED_VARIANT_KEYS.some(key => !runtimeByKey.has(key))) {
  throw new Error('runtimeEngineEntries is missing a retained variant.');
}
for (const key of previewKeys) {
  if (runtimeByKey.has(key)) throw new Error(`Preview key overlaps production registry: ${key}`);
}

const releaseEvidence = [];
const rulebookSources = new Set();
for (const key of RETAINED_VARIANT_KEYS) {
  const manifestPath = releasePath(key, 'manifest.json');
  const rulebookPath = releasePath(key, 'rulebook.json');
  const approvalPath = releasePath(key, 'approval.json');
  const casesPath = releasePath(key, 'cases.json');
  const [manifestRaw, rulebookRaw, approvalRaw, casesRaw] = await Promise.all([
    readFile(resolve(project, manifestPath), 'utf8'),
    readFile(resolve(project, rulebookPath), 'utf8'),
    readFile(resolve(project, approvalPath), 'utf8'),
    readFile(resolve(project, casesPath), 'utf8'),
  ]);
  const manifest = parseJson(manifestRaw);
  const rulebook = parseJson(rulebookRaw);
  const approval = parseJson(approvalRaw);
  const rulebookSha256 = sha256(rulebookRaw);
  const casesSha256 = sha256(casesRaw);
  const approvalSha256 = sha256(approvalRaw);
  const runtime = runtimeByKey.get(key);

  if (manifest.variantKey !== key || rulebook.variantKey !== key || approval.variantKey !== key) {
    throw new Error(`Variant key mismatch in release evidence for ${key}.`);
  }
  if (rulebook.status !== 'approved' || rulebook.basis !== 'user-approved') {
    throw new Error(`Release rulebook for ${key} is not user-approved.`);
  }
  if (approval.kind !== 'user-rule-approval') {
    throw new Error(`Release approval for ${key} has the wrong kind.`);
  }
  if (manifest.ruleVersion !== rulebook.ruleVersion || manifest.ruleVersion !== approval.ruleVersion) {
    throw new Error(`Rule version mismatch in release evidence for ${key}.`);
  }
  if (manifest.rulebook.sha256 !== rulebookSha256 || manifest.cases.sha256 !== casesSha256) {
    throw new Error(`Release file digest mismatch for ${key}.`);
  }
  if (rulebook.approval?.sha256 !== approvalSha256) {
    throw new Error(`Approval digest mismatch for ${key}.`);
  }
  if (approval.rulebookSha256 !== rulebookContentSha256(rulebook)) {
    throw new Error(`Approval does not bind the exact rulebook content for ${key}.`);
  }
  if (runtime.rulebook.path !== manifest.rulebook.path || runtime.rulebook.sha256 !== manifest.rulebook.sha256
    || runtime.cases.path !== manifest.cases.path || runtime.cases.sha256 !== manifest.cases.sha256) {
    throw new Error(`Runtime engine evidence does not match the release manifest for ${key}.`);
  }
  if (!Array.isArray(rulebook.sources) || rulebook.sources.length === 0) {
    throw new Error(`Release rulebook for ${key} does not declare its evidence sources.`);
  }
  for (const source of rulebook.sources) {
    if (typeof source !== 'string' || source.trim() === '') {
      throw new Error(`Release rulebook for ${key} declares an invalid evidence source.`);
    }
    rulebookSources.add(source);
  }
  releaseEvidence.push({ key, manifestPath, rulebookPath, approvalPath, casesPath, ruleVersion: manifest.ruleVersion,
    rulebookSha256, casesSha256, approvalSha256, manifestSha256: sha256(manifestRaw) });
}

const oldVariants = new Map(previous.variants.map(variant => [variant.variantKey, variant]));
const variants = releaseEvidence.map(evidence => {
  const old = oldVariants.get(evidence.key);
  if (!old) throw new Error(`Historical research record is missing for ${evidence.key}.`);
  const researchAuthorization = old.researchAuthorization ?? old.approval;
  if (!researchAuthorization) throw new Error(`Historical authorization record is missing for ${evidence.key}.`);
  const dimensions = (old.dimensions ?? []).map(dimension => ({
    ...dimension,
    researchStatus: dimension.researchStatus ?? dimension.status,
    status: 'covered-by-approved-release-rulebook',
  }));
  const variant = {
    ...old,
    ruleStatus: 'approved',
    gameplayReady: retainedGapState.get(evidence.key)?.gameplayReady === true,
    ruleGap: retainedGapState.get(evidence.key)?.blockingGapIds ?? [],
    definition: { status: 'approved', basis: 'user-approved', version: evidence.ruleVersion, document: evidence.rulebookPath },
    implementation: { status: 'registered', fullRoomVerified, fullRoomVerificationScope: 'current-release-subject' },
    release: {
      rulebook: { path: evidence.rulebookPath, sha256: evidence.rulebookSha256 },
      cases: { path: evidence.casesPath, sha256: evidence.casesSha256 },
      approval: { path: evidence.approvalPath, sha256: evidence.approvalSha256 },
      manifest: { path: evidence.manifestPath, sha256: evidence.manifestSha256 },
    },
    researchAuthorization,
    dimensions,
  };
  delete variant.approval;
  return variant;
});

const sourcePaths = new Set([
  ...Object.keys(previous.sourceHashes ?? {}),
  'tools/generate-rulebook.mjs',
  'apps/server/src/runtime-engines.ts',
  ...rulebookSources,
]);
const sourceHashes = {};
for (const source of [...sourcePaths].sort()) {
  sourceHashes[source] = sha256(await readFile(resolve(project, source)));
}

const approved = variants.filter(variant => variant.ruleStatus === 'approved' && variant.definition.status === 'approved').length;
const gameplayReady = variants.filter(variant => variant.gameplayReady).length;
const registered = runtimeEntries.length;
const fullRoomVerifiedConfigurations = variants.filter(variant => variant.implementation.fullRoomVerified === true).length;
const coverage = {
  schemaVersion: 2,
  proposalVersion: previous.proposalVersion,
  status: 'release-rulebooks-approved-engines-registered',
  originApkSha256: previous.originApkSha256,
  summary: {
    ...previous.summary,
    gameIds: RETAINED_VARIANT_KEYS.length,
    configurations: variants.length,
    authorizedConfigurations: variants.length,
    approvedConfigurationRules: approved,
    gameplayReadyConfigurations: gameplayReady,
    completedGameplayEngines: registered,
    registeredRuntimeEngines: registered,
    fullRoomVerifiedConfigurations,
    originalServerComparisons: 0,
  },
  sourceHashes,
  userResearchDirection: previous.userResearchDirection,
  decisionDefinitions: previous.decisionDefinitions,
  variants,
};

const statusLabel = variant => variant.implementation.fullRoomVerified
  ? variant.gameplayReady
    ? '已批准 / 已注册 / 当前主题完整房间已验证'
    : '已批准 / 已注册 / 行为证据阻塞'
  : variant.gameplayReady
    ? '已批准 / 已注册 / 完整房间验收待当前主题'
    : '已批准 / 已注册 / 行为证据阻塞';
const rows = variants.map(variant => {
  const rulebookLink = variant.release.rulebook.path.replace(/^docs\/rules\//, '');
  return `| [${variant.variantKey} ${variant.name}](variants/${releaseDirectory(variant.variantKey)}.md) | ${variant.family} | [${variant.definition.version}](${rulebookLink}) | ${statusLabel(variant)} |`;
}).join('\n');
const readinessParagraph = fullRoomVerified
  ? `当前 \`verification/local-readiness.json\` 已为 \`localReady: true\`、\`releaseReady: ${releaseReady}\`；因此 coverage 中每个 \`implementation.fullRoomVerified\` 均为 \`true\`，\`originalServerComparisons\` 仍为 \`0\`。`
  : `当前 \`verification/local-readiness.json\` 仍为 \`localReady: false\`、\`releaseReady: ${releaseReady}\`，原因是当前源码对应的构建与本地验收证据已过期；因此 coverage 中每个 \`implementation.fullRoomVerified\` 仍为 \`false\`，\`originalServerComparisons\` 仍为 \`0\`。`;
const blockedKeys = variants.filter(variant => !variant.gameplayReady).map(variant => variant.variantKey);
const gameplayParagraph = blockedKeys.length === 0
  ? '当前 21/21 项均未被规则缺口账本阻止开局。'
  : `当前 16/21 项未被规则缺口账本阻止开局；${blockedKeys.join('、')} 因缺少可执行的正反例或存在客户端矛盾而保持阻塞，不能以已批准规则书替代行为证据。`;
const readme = `# 当前实施状态

21/21 项保留配置已经具备 \`status: approved\`、\`basis: user-approved\` 的发布规则书，并且 21/21 个对应引擎已进入生产注册表。每项注册记录绑定发布规则书与参考用例摘要；旧研究索引、历史决策和未决研究仍保留在 [机器可读覆盖](coverage.json) 与 [历史决策登记](decisions.md) 中。

规则书批准、可开局判定和完整房间验收是三件不同的事。${gameplayParagraph}${readinessParagraph}

- [发布规则书目录](release)
- [历史授权与范围](INDEPENDENT-APPROVAL.md)
- [历史决策登记](decisions.md)
- [机器可读状态](coverage.json)
- [本地验收状态](../../verification/local-readiness.json)

# 斗十四地区版规则书

当前保留 21 编号、21 份配置（含雅安红二十）。下表链接历史研究页，发布定义以对应 release rulebook 为准；历史提案、算例和未决研究不再表示当前定义未批准。

## 配置覆盖

| 配置 | 规则族 | 发布规则版本 | 当前状态 |
| --- | --- | --- | --- |
${rows}

## 构建与检查

在工程目录运行 \`node tools/generate-rulebook.mjs\`。生成器只读取发布证据并写入 \`docs/rules/README.md\` 与 \`docs/rules/coverage.json\`；它不会改写历史研究页、发布文档或运行时注册表。运行 \`node tools/check-rulebook.mjs\` 检查 21 份 approved 文档、摘要绑定、生产/预览注册表隔离、summary 计数和历史研究保留字段。
`;
await writeFile(resolve(root, 'README.md'), readme);
await writeFile(coveragePath, JSON.stringify(coverage, null, 2) + '\n');
console.log(JSON.stringify({ configurations: variants.length, approvedConfigurationRules: approved,
  registeredRuntimeEngines: registered, fullRoomVerifiedConfigurations, status: coverage.status, output: root }));
