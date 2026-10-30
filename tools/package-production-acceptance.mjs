import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseSubject } from './build-fingerprint.mjs';

const SOURCE_PATHS = Object.freeze({
  ui: 'verification/local-ui.json',
  network: 'verification/local-network.json',
  stability: 'verification/local-stability.json',
  native: 'verification/local-native.json',
  postgresRaw: 'verification/raw/postgres-concurrency.json',
  postgres: 'verification/postgres-concurrency.json',
});

// releaseSubject() folds exactly these five digests into subject.sha256, so the
// packaged manifest must validate and re-derive the aggregate from the same set.
const SUBJECT_FIELDS = Object.freeze(['sources', 'binaries', 'client', 'acceptance', 'apk']);
const BUILD_MANIFEST = 'verification/build-manifest.json';
const NATIVE_OUTPUT = 'verification/native-end-to-end.json';
const POSTGRES_OUTPUT = 'verification/postgres-concurrency.json';
const EVIDENCE_ROOTS = Object.freeze(['verification/raw', 'client/validation']);
const RELEASE_APK = 'client/android/doushisi.apk';
const PRODUCTION_MANIFEST = 'verification/production-acceptance.json';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function fail(code, detail) {
  throw Object.assign(new Error(detail), { code });
}

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertSha256(value, code, detail) {
  if (!SHA256_PATTERN.test(value ?? '')) fail(code, detail);
  return value;
}

function validateReleaseSubject(subject) {
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) {
    fail('SUBJECT_INVALID', 'release subject: expected a complete object.');
  }
  for (const field of SUBJECT_FIELDS) {
    assertSha256(subject[field], 'SUBJECT_INVALID',
      `release subject: ${field} must be a lowercase 64-character SHA-256.`);
  }
  const aggregate = sha256(JSON.stringify(SUBJECT_FIELDS.map(field => subject[field])));
  if (subject.sha256 !== aggregate) {
    fail('SUBJECT_INVALID', 'release subject: sha256 does not match the source, binary, client, acceptance, and APK digests.');
  }
  return {
    sources: subject.sources,
    binaries: subject.binaries,
    client: subject.client,
    acceptance: subject.acceptance,
    apk: subject.apk,
    sha256: subject.sha256,
  };
}

function pathFor(root, relative) {
  return path.join(root, ...relative.split('/'));
}

async function loadReleaseAudit() {
  return import('./release-audit.mjs');
}

async function preflightSources(root) {
  for (const relative of Object.values(SOURCE_PATHS)) {
    try {
      const stat = await fs.stat(pathFor(root, relative));
      if (!stat.isFile()) fail('SOURCE_ARTIFACT_INVALID', `${relative}: expected a regular file.`);
    } catch (error) {
      if (error?.code === 'SOURCE_ARTIFACT_INVALID') throw error;
      if (error?.code === 'ENOENT') fail('MISSING_SOURCE_ARTIFACT', `${relative}: source artifact is missing.`);
      fail('SOURCE_ARTIFACT_INVALID', `${relative}: unable to read source artifact: ${error.message}`);
    }
  }
}

async function readSourceJson(root, relative) {
  let text;
  try {
    text = await fs.readFile(pathFor(root, relative), 'utf8');
  } catch (error) {
    fail(error?.code === 'ENOENT' ? 'MISSING_SOURCE_ARTIFACT' : 'SOURCE_ARTIFACT_INVALID',
      `${relative}: unable to read source artifact: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail('SOURCE_ARTIFACT_INVALID', `${relative}: invalid JSON: ${error.message}`);
  }
}

async function readJsonBytes(root, relative, missingCode, invalidCode) {
  let bytes;
  try {
    bytes = await fs.readFile(pathFor(root, relative));
  } catch (error) {
    fail(error?.code === 'ENOENT' ? missingCode : invalidCode,
      `${relative}: unable to read artifact: ${error.message}`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    fail(invalidCode, `${relative}: invalid JSON: ${error.message}`);
  }
}

function withPath(relative, error) {
  const wrapped = new Error(`${relative}: ${error?.message ?? String(error)}`);
  wrapped.code = error?.code ?? 'SOURCE_VALIDATION_FAILED';
  wrapped.cause = error;
  return wrapped;
}

async function validateSource(relative, validate) {
  try {
    return await validate();
  } catch (error) {
    if (error?.code === 'ACCEPTANCE_STALE_OR_INVALID') {
      fail('ACCEPTANCE_STALE_OR_INVALID',
        `${relative}: source report is stale or does not match the current release subject (${error.message}).`);
    }
    throw withPath(relative, error);
  }
}

function productionChecks(report, requiredIds, sourcePath) {
  if (!Array.isArray(report?.checks) || report.checks.length === 0) {
    fail('ACCEPTANCE_CHECKS_MISSING', `${sourcePath}: source report has no checks.`);
  }
  const allowed = new Set(requiredIds);
  const checks = report.checks.filter(check => allowed.has(check?.id)).map(check => clone(check));
  for (const id of requiredIds) {
    if (!checks.some(check => check.id === id)) {
      fail('ACCEPTANCE_COVERAGE_MISSING', `${sourcePath}: missing required production check ${id}.`);
    }
  }
  for (const check of checks) {
    if (check.passed !== true) fail('ACCEPTANCE_CHECK_FAILED', `${sourcePath}: check ${check.id} did not pass.`);
  }
  return checks;
}

function assertFormalEnvelope(report, relative, subject, requiredIds) {
  if (report?.schemaVersion !== 1 || report?.passed !== true || report?.subjectSha256 !== subject.sha256) {
    fail('OUTPUT_PREVALIDATION_FAILED',
      `${relative}: expected schemaVersion 1, passed true, and the current subject SHA-256.`);
  }
  if (!Array.isArray(report.checks) || report.checks.length === 0) {
    fail('OUTPUT_PREVALIDATION_FAILED', `${relative}: checks are missing.`);
  }
  const ids = new Set();
  for (const check of report.checks) {
    if (typeof check?.id !== 'string' || !check.id || check.passed !== true || ids.has(check.id)) {
      fail('OUTPUT_PREVALIDATION_FAILED', `${relative}: invalid or duplicate production check.`);
    }
    ids.add(check.id);
  }
  for (const id of requiredIds) {
    if (!ids.has(id)) fail('OUTPUT_PREVALIDATION_FAILED', `${relative}: missing production check ${id}.`);
  }
}

async function assertEvidence(root, descriptors, relative, audit) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    fail('ACCEPTANCE_EVIDENCE_MISSING', `${relative}: evidence descriptors are missing.`);
  }
  for (const descriptor of descriptors) {
    try {
      await audit.readArtifact(root, descriptor);
    } catch (error) {
      throw withPath(relative, error);
    }
  }
}

function reportEvidenceDescriptors(report, relative) {
  const descriptors = [];
  const byPath = new Map();
  const add = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.path !== 'string' || !SHA256_PATTERN.test(value.sha256 ?? '')) {
      fail('ACCEPTANCE_EVIDENCE_MISSING', `${relative}: ${label} is not a valid evidence descriptor.`);
    }
    const previous = byPath.get(value.path);
    if (previous && previous !== value.sha256) {
      fail('ACCEPTANCE_EVIDENCE_MISMATCH', `${relative}: conflicting digests for ${value.path}.`);
    }
    if (previous) return;
    byPath.set(value.path, value.sha256);
    descriptors.push({ path: value.path, sha256: value.sha256 });
  };
  if (Array.isArray(report?.evidence)) report.evidence.forEach((value, index) => add(value, `evidence[${index}]`));
  if (Array.isArray(report?.checks)) {
    for (const check of report.checks) {
      if (Array.isArray(check?.evidence)) {
        check.evidence.forEach((value, index) => add(value, `check ${check.id} evidence[${index}]`));
      }
    }
  }
  if (descriptors.length === 0) fail('ACCEPTANCE_EVIDENCE_MISSING', `${relative}: evidence descriptors are missing.`);
  return descriptors;
}

async function validateReportEvidence(root, report, relative, audit) {
  const descriptors = reportEvidenceDescriptors(report, relative);
  for (const descriptor of descriptors) {
    try {
      await audit.readArtifact(root, descriptor);
    } catch (error) {
      throw withPath(relative, error);
    }
  }
  return descriptors;
}

async function validateBuildFingerprint(root, fingerprint, label, expectedSha256, audit) {
  if (!fingerprint || typeof fingerprint !== 'object' || Array.isArray(fingerprint) ||
    !Array.isArray(fingerprint.files) || fingerprint.files.length === 0) {
    fail('BUILD_MANIFEST_INVALID', `${BUILD_MANIFEST}: ${label} must contain a nonempty files array.`);
  }
  assertSha256(fingerprint.sha256, 'BUILD_MANIFEST_INVALID',
    `${BUILD_MANIFEST}: ${label}.sha256 must be a lowercase 64-character SHA-256.`);
  if (fingerprint.sha256 !== expectedSha256) {
    fail('BUILD_MANIFEST_MISMATCH', `${BUILD_MANIFEST}: ${label}.sha256 does not match the release subject.`);
  }
  const seen = new Set();
  for (const descriptor of fingerprint.files) {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) ||
      typeof descriptor.path !== 'string' || !descriptor.path || !SHA256_PATTERN.test(descriptor.sha256 ?? '')) {
      fail('BUILD_MANIFEST_INVALID', `${BUILD_MANIFEST}: ${label} contains an invalid file record.`);
    }
    if (seen.has(descriptor.path)) {
      fail('BUILD_MANIFEST_INVALID', `${BUILD_MANIFEST}: ${label} contains duplicate path ${descriptor.path}.`);
    }
    seen.add(descriptor.path);
    try {
      await audit.readArtifact(root, descriptor);
    } catch (error) {
      throw withPath(BUILD_MANIFEST, error);
    }
  }
  const aggregate = sha256(JSON.stringify(fingerprint.files));
  if (aggregate !== fingerprint.sha256) {
    fail('BUILD_MANIFEST_MISMATCH', `${BUILD_MANIFEST}: ${label}.sha256 is not the digest of its complete file set.`);
  }
  return clone(fingerprint);
}

async function loadBuildManifest(root, subject, audit) {
  const { bytes, value } = await readJsonBytes(root, BUILD_MANIFEST,
    'BUILD_MANIFEST_MISSING', 'BUILD_MANIFEST_INVALID');
  if (value?.version !== 1 || typeof value.builtAt !== 'string' || !Number.isFinite(Date.parse(value.builtAt))) {
    fail('BUILD_MANIFEST_INVALID', `${BUILD_MANIFEST}: expected version 1 and a valid builtAt timestamp.`);
  }
  const sources = await validateBuildFingerprint(root, value.sources, 'sources', subject.sources, audit);
  const binaries = await validateBuildFingerprint(root, value.binaries, 'binaries', subject.binaries, audit);
  return {
    path: BUILD_MANIFEST,
    sha256: sha256(bytes),
    version: value.version,
    builtAt: value.builtAt,
    sources,
    binaries,
  };
}

async function resolveReleaseApk(root, subject) {
  let bytes;
  try {
    bytes = await fs.readFile(pathFor(root, RELEASE_APK));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      fail('APK_MISSING', `${RELEASE_APK}: release APK is missing.`);
    }
    fail('APK_INVALID', `${RELEASE_APK}: unable to read APK: ${error.message}`);
  }
  const digest = sha256(bytes);
  if (digest !== subject.apk) {
    fail('APK_SUBJECT_MISMATCH',
      `${RELEASE_APK}: APK SHA-256 ${digest} does not match the release subject APK ${subject.apk}.`);
  }
  return { relative: RELEASE_APK, sha256: digest };
}

async function apkManifestRecord(root, subject, nativeBytes) {
  const { relative, sha256: apkSha256 } = await resolveReleaseApk(root, subject);
  let native;
  try {
    native = JSON.parse(nativeBytes.toString('utf8'));
  } catch (error) {
    fail('LOCAL_NATIVE_REPORT_INVALID', `${SOURCE_PATHS.native}: invalid JSON: ${error.message}`);
  }
  if (native?.apkSha256 !== subject.apk) {
    fail('LOCAL_NATIVE_APK_MISMATCH', `${SOURCE_PATHS.native}: apkSha256 does not match the release subject APK.`);
  }
  if (native?.subjectBeforeSha256 !== subject.sha256 || native?.subjectAfterSha256 !== subject.sha256) {
    fail('LOCAL_NATIVE_SUBJECT_MISMATCH', `${SOURCE_PATHS.native}: native subject fields do not match the release subject.`);
  }
  const reportSha256 = sha256(nativeBytes);
  return {
    path: relative,
    sha256: apkSha256,
    report: {
      path: SOURCE_PATHS.native,
      sha256: reportSha256,
      runId: native.runId,
      apkSha256: native.apkSha256,
      subjectBeforeSha256: native.subjectBeforeSha256,
      subjectAfterSha256: native.subjectAfterSha256,
    },
    binding: {
      releaseSubjectSha256: subject.sha256,
      apkSha256: subject.apk,
      reportPath: SOURCE_PATHS.native,
      reportSha256,
      matches: true,
    },
  };
}

function isWithin(relative, root) {
  return relative === root || relative.startsWith(root + '/');
}

function canonicalEvidenceDirectory(relative) {
  for (const root of EVIDENCE_ROOTS) {
    if (isWithin(relative, root)) return root;
  }
  const directory = path.posix.dirname(relative);
  if (!directory || directory === '.' || directory.startsWith('../')) {
    fail('ACCEPTANCE_EVIDENCE_MISSING', `${relative}: evidence must be inside a project directory.`);
  }
  return directory;
}

async function directoryRecord(root, relative) {
  const base = await fs.realpath(root);
  const absolute = await fs.realpath(pathFor(root, relative));
  if (!absolute.startsWith(base + path.sep)) {
    fail('EVIDENCE_DIRECTORY_INVALID', `${relative}: directory resolves outside the project root.`);
  }
  const stat = await fs.stat(absolute);
  if (!stat.isDirectory()) fail('EVIDENCE_DIRECTORY_INVALID', `${relative}: expected a directory.`);
  const files = [];
  const walk = async directory => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail('EVIDENCE_DIRECTORY_INVALID', `${relative}: symlinks are not allowed.`);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        files.push({ path: path.relative(absolute, child).split(path.sep).join('/'),
          sha256: sha256(await fs.readFile(child)) });
      }
    }
  };
  await walk(absolute);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const digest = sha256(Buffer.from(files.map(file => `${file.path}:${file.sha256}`).join('\n'), 'utf8'));
  return { path: relative, sha256: digest, fileCount: files.length };
}

async function evidenceDirectoryRecords(root, reports) {
  const directories = new Set(EVIDENCE_ROOTS);
  for (const report of reports) {
    for (const descriptor of report.evidence) directories.add(canonicalEvidenceDirectory(descriptor.path));
  }
  const records = [];
  for (const relative of [...directories].sort()) {
    try {
      records.push(await directoryRecord(root, relative));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        if (!EVIDENCE_ROOTS.includes(relative)) throw error;
      } else {
        throw error;
      }
    }
  }
  return records;
}

function projectedStabilityMetrics(source, sourcePath) {
  const metrics = source?.metrics;
  if (!Number.isInteger(metrics?.actualPlayers) || metrics.actualPlayers < 20) {
    fail('GAMEPLAY_CAPACITY_TARGET_MISSING',
      `${sourcePath}: actualPlayers is ${metrics?.actualPlayers ?? 'missing'}; production requires at least 20.`);
  }
  if (!Number.isFinite(metrics.durationSeconds) || metrics.durationSeconds < 7200) {
    fail('GAMEPLAY_CAPACITY_TARGET_MISSING',
      `${sourcePath}: durationSeconds is ${metrics.durationSeconds ?? 'missing'}; production requires at least 7200.`);
  }
  if (!Number.isInteger(metrics.completedRounds) || metrics.completedRounds <= 0) {
    fail('GAMEPLAY_CAPACITY_TARGET_MISSING', `${sourcePath}: completedRounds must be positive.`);
  }
  if (!Number.isInteger(metrics.optimizedDeals) || metrics.optimizedDeals <= 0) {
    fail('GAMEPLAY_CAPACITY_TARGET_MISSING', `${sourcePath}: optimizedDeals must be positive.`);
  }
  if (!Number.isFinite(metrics.actionP95Ms) || metrics.actionP95Ms < 0 || metrics.actionP95Ms > 300) {
    fail('GAMEPLAY_CAPACITY_TARGET_MISSING', `${sourcePath}: actionP95Ms must be between 0 and 300.`);
  }
  if (!Number.isFinite(metrics.dealP95Ms) || metrics.dealP95Ms < 0 || metrics.dealP95Ms > 2000) {
    fail('GAMEPLAY_CAPACITY_TARGET_MISSING', `${sourcePath}: dealP95Ms must be between 0 and 2000.`);
  }
  if (metrics.stateLosses !== 0) {
    fail('GAMEPLAY_CAPACITY_TARGET_MISSING', `${sourcePath}: stateLosses must be zero.`);
  }
  return {
    actualPlayers: metrics.actualPlayers,
    durationSeconds: metrics.durationSeconds,
    completedRounds: metrics.completedRounds,
    optimizedDeals: metrics.optimizedDeals,
    actionP95Ms: metrics.actionP95Ms,
    dealP95Ms: metrics.dealP95Ms,
    ledgerErrors: 0,
    stateLosses: 0,
  };
}

function formalReport(source, subject, requiredIds, sourcePath) {
  return {
    schemaVersion: 1,
    passed: true,
    subjectSha256: subject.sha256,
    checks: productionChecks(source, requiredIds, sourcePath),
    evidence: clone(source.evidence),
  };
}

function nativeReport(source, subject, requiredIds, sourcePath) {
  return {
    schemaVersion: 1,
    stage: source.stage,
    status: source.status,
    passed: true,
    runId: source.runId,
    subjectBeforeSha256: subject.sha256,
    subjectAfterSha256: subject.sha256,
    apkSha256: source.apkSha256,
    devices: clone(source.devices),
    checks: productionChecks(source, requiredIds, sourcePath),
    evidence: clone(source.evidence),
  };
}

async function validateNativeOutput(root, report, subject, requiredIds, audit) {
  if (report?.schemaVersion !== 1 || report?.passed !== true || report?.stage !== 'acceptance' ||
    report?.status !== 'passed') {
    fail('OUTPUT_PREVALIDATION_FAILED', `${NATIVE_OUTPUT}: native acceptance envelope is invalid.`);
  }
  if (Object.hasOwn(report, 'subjectSha256')) {
    fail('OUTPUT_PREVALIDATION_FAILED', `${NATIVE_OUTPUT}: subjectSha256 must not be present.`);
  }
  if (report.subjectBeforeSha256 !== subject.sha256 || report.subjectAfterSha256 !== subject.sha256) {
    fail('OUTPUT_PREVALIDATION_FAILED', `${NATIVE_OUTPUT}: native subject fields do not match the current subject.`);
  }
  if (report.apkSha256 !== subject.apk) {
    fail('OUTPUT_PREVALIDATION_FAILED', `${NATIVE_OUTPUT}: apkSha256 does not match the current acceptance APK.`);
  }
  assertFormalEnvelope({ ...report, subjectSha256: subject.sha256 }, NATIVE_OUTPUT, subject, requiredIds);
  await assertEvidence(root, report.evidence, NATIVE_OUTPUT, audit);
  for (const check of report.checks) {
    await assertEvidence(root, check.evidence, `${NATIVE_OUTPUT}:${check.id}`, audit);
  }
}

async function atomicWriteIfChanged(absolute, bytes) {
  let existing = null;
  try {
    existing = await fs.readFile(absolute);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (existing && existing.equals(bytes)) return 'unchanged';

  const directory = path.dirname(absolute);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory,
    `.${path.basename(absolute)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, absolute);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return 'written';
}

export async function packageProductionAcceptance(root = process.cwd(), options = {}) {
  const projectRoot = path.resolve(root);
  await preflightSources(projectRoot);

  const audit = await loadReleaseAudit();
  const subjectProvider = options.subjectProvider ?? releaseSubject;
  let providedSubject;
  try {
    providedSubject = await subjectProvider(projectRoot);
  } catch (error) {
    throw withPath('release subject', error);
  }
  const subject = validateReleaseSubject(providedSubject);

  // The build manifest carries the complete source input set and build output
  // set. Its aggregate digests must be the ones folded into the release subject,
  // otherwise a stale manifest could ship next to fresh reports.
  const buildManifest = await loadBuildManifest(projectRoot, subject, audit);
  const nativeSourceBytes = await fs.readFile(pathFor(projectRoot, SOURCE_PATHS.native));
  const apk = await apkManifestRecord(projectRoot, subject, nativeSourceBytes);

  await validateSource(SOURCE_PATHS.ui, () =>
    audit.verifyAcceptance(projectRoot, 'local-ui.json', subject, audit.localAcceptanceRequirements));
  await validateSource(SOURCE_PATHS.network, () =>
    audit.verifyAcceptance(projectRoot, 'local-network.json', subject, audit.localAcceptanceRequirements));
  await validateSource(SOURCE_PATHS.stability, () =>
    audit.verifyAcceptance(projectRoot, 'local-stability.json', subject, audit.localAcceptanceRequirements));
  await validateSource(SOURCE_PATHS.native, () =>
    audit.verifyAcceptance(projectRoot, 'local-native.json', subject, audit.localAcceptanceRequirements));
  await validateSource(SOURCE_PATHS.postgres, () =>
    audit.verifyAcceptance(projectRoot, 'postgres-concurrency.json', subject, audit.acceptanceRequirements));

  const sources = {
    ui: await readSourceJson(projectRoot, SOURCE_PATHS.ui),
    network: await readSourceJson(projectRoot, SOURCE_PATHS.network),
    stability: await readSourceJson(projectRoot, SOURCE_PATHS.stability),
    native: await readSourceJson(projectRoot, SOURCE_PATHS.native),
    postgres: await readSourceJson(projectRoot, SOURCE_PATHS.postgres),
  };

  const uiReport = formalReport(sources.ui, subject,
    audit.acceptanceRequirements['original-ui-comparison.json'], SOURCE_PATHS.ui);
  const networkReport = formalReport(sources.network, subject,
    audit.acceptanceRequirements['original-network-isolation.json'], SOURCE_PATHS.network);
  const stabilityReport = {
    schemaVersion: 1,
    passed: true,
    subjectSha256: subject.sha256,
    checks: productionChecks(sources.stability, audit.acceptanceRequirements['gameplay-capacity.json'],
      SOURCE_PATHS.stability),
    evidence: clone(sources.stability.evidence),
    metrics: projectedStabilityMetrics(sources.stability, SOURCE_PATHS.stability),
  };
  const native = nativeReport(sources.native, subject,
    audit.acceptanceRequirements['native-end-to-end.json'], SOURCE_PATHS.native);
  const prepared = [
    { source: SOURCE_PATHS.ui, target: 'verification/original-ui-comparison.json', report: uiReport,
      requirements: audit.acceptanceRequirements['original-ui-comparison.json'] },
    { source: SOURCE_PATHS.network, target: 'verification/original-network-isolation.json', report: networkReport,
      requirements: audit.acceptanceRequirements['original-network-isolation.json'] },
    { source: SOURCE_PATHS.stability, target: 'verification/gameplay-capacity.json', report: stabilityReport,
      requirements: audit.acceptanceRequirements['gameplay-capacity.json'] },
  ];

  for (const item of prepared) {
    assertFormalEnvelope(item.report, item.target, subject, item.requirements);
    await assertEvidence(projectRoot, item.report.evidence, item.target, audit);
    if (item.target === 'verification/gameplay-capacity.json') {
      const keys = Object.keys(item.report.metrics).sort();
      const expected = ['actionP95Ms', 'actualPlayers', 'completedRounds', 'dealP95Ms', 'durationSeconds',
        'ledgerErrors', 'optimizedDeals', 'stateLosses'];
      if (JSON.stringify(keys) !== JSON.stringify(expected)) {
        fail('OUTPUT_PREVALIDATION_FAILED', `${item.target}: metrics contain unexpected fields.`);
      }
    }
    item.bytes = Buffer.from(`${JSON.stringify(item.report, null, 2)}\n`);
  }

  await validateNativeOutput(projectRoot, native, subject,
    audit.acceptanceRequirements['native-end-to-end.json'], audit);
  const nativeBytes = Buffer.from(`${JSON.stringify(native, null, 2)}\n`);
  await validateSource(POSTGRES_OUTPUT, () =>
    audit.verifyAcceptance(projectRoot, 'postgres-concurrency.json', subject, audit.acceptanceRequirements));
  const postgresBytes = await fs.readFile(pathFor(projectRoot, POSTGRES_OUTPUT));

  const reportArtifacts = [
    ...prepared.map(item => ({ ...item, bytes: item.bytes })),
    { source: SOURCE_PATHS.postgres, target: POSTGRES_OUTPUT, report: sources.postgres, bytes: postgresBytes },
    { source: SOURCE_PATHS.native, target: NATIVE_OUTPUT, report: native, bytes: nativeBytes },
  ];

  const written = [];
  for (const item of reportArtifacts) {
    try {
      const status = await atomicWriteIfChanged(pathFor(projectRoot, item.target), item.bytes);
      written.push({ item, status });
    } catch (error) {
      throw withPath(item.target, error);
    }
  }

  await validateSource('verification/original-ui-comparison.json', () =>
    audit.verifyAcceptance(projectRoot, 'original-ui-comparison.json', subject, audit.acceptanceRequirements));
  await validateSource('verification/original-network-isolation.json', () =>
    audit.verifyAcceptance(projectRoot, 'original-network-isolation.json', subject, audit.acceptanceRequirements));
  await validateSource('verification/gameplay-capacity.json', () =>
    audit.verifyAcceptance(projectRoot, 'gameplay-capacity.json', subject, audit.acceptanceRequirements));
  await validateSource('verification/postgres-concurrency.json', () =>
    audit.verifyAcceptance(projectRoot, 'postgres-concurrency.json', subject, audit.acceptanceRequirements));
  await validateNativeOutput(projectRoot, await readSourceJson(projectRoot, NATIVE_OUTPUT), subject,
    audit.acceptanceRequirements['native-end-to-end.json'], audit);

  // Every formal report must close over the raw/sub-evidence it cites: each
  // descriptor is re-read from disk and its digest re-checked, so a report can
  // never reference a file that is missing or has drifted.
  const reports = [];
  for (const { item } of written) {
    const evidence = await validateReportEvidence(projectRoot, item.report, item.target, audit);
    const record = {
      path: item.target,
      source: item.source,
      sha256: sha256(item.bytes),
      schemaVersion: item.report.schemaVersion,
      passed: item.report.passed === true,
      subjectSha256: subject.sha256,
      checks: (item.report.checks ?? []).map(check => ({
        id: check.id,
        passed: check.passed === true,
        evidence: clone(check.evidence ?? []),
      })),
      evidence,
    };
    if (item.target === NATIVE_OUTPUT) record.apkSha256 = item.report.apkSha256;
    reports.push(record);
  }

  const evidenceDirectories = await evidenceDirectoryRecords(projectRoot, reports);
  const outputs = written.map(({ item, status }) => ({
    source: item.source,
    target: item.target,
    status,
    sha256: sha256(item.bytes),
    checks: Array.isArray(item.report.checks) ? item.report.checks.length : 0,
    evidence: Array.isArray(item.report.evidence) ? item.report.evidence.length : 0,
  }));

  const manifest = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseSubject: clone(subject),
    buildManifest,
    apk,
    reports,
    evidenceDirectories,
    outputs: outputs.map(record => ({ path: record.target, source: record.source,
      sha256: record.sha256, status: record.status })),
  };

  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  let manifestStatus;
  try {
    manifestStatus = await atomicWriteIfChanged(pathFor(projectRoot, PRODUCTION_MANIFEST), manifestBytes);
  } catch (error) {
    throw withPath(PRODUCTION_MANIFEST, error);
  }

  return {
    subjectSha256: subject.sha256,
    outputs,
    manifest,
    manifestStatus,
    manifestPath: PRODUCTION_MANIFEST,
    manifestSha256: sha256(manifestBytes),
  };
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write('Usage: node tools/package-production-acceptance.mjs [project-root]\n');
    return;
  }
  const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const result = await packageProductionAcceptance(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isMain = invokedPath === fileURLToPath(import.meta.url);

if (isMain) {
  const hasTypeTransform = process.execArgv.includes('--experimental-transform-types');
  const marker = process.env.DSS_PACKAGE_PRODUCTION_ACCEPTANCE_REEXEC === '1';
  if (!hasTypeTransform && !marker) {
    const child = spawnSync(process.execPath,
      ['--experimental-transform-types', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, DSS_PACKAGE_PRODUCTION_ACCEPTANCE_REEXEC: '1' } });
    if (child.error) {
      process.stderr.write(`PACKAGE_PRODUCTION_ACCEPTANCE_FAILED: ${child.error.message}\n`);
      process.exitCode = 1;
    } else {
      process.exit(child.status ?? 1);
    }
  } else {
    main().catch(error => {
      const prefix = error?.code ? `${error.code}: ` : '';
      process.stderr.write(`${prefix}${error?.message ?? String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
