import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const RETAINED_GAME_IDS = Object.freeze([4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
const acceptanceBindingNames = Object.freeze({
  subjectSha256: 'ACCEPTANCE_SUBJECT_SHA256',
  freshRunId: 'ACCEPTANCE_FRESH_RUN_ID',
  isolatedDatabase: 'ACCEPTANCE_ISOLATED_DATABASE',
});
const sha256Pattern = /^[0-9a-f]{64}$/;
const reportIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function requireBinding(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw Object.assign(new Error(`Missing fresh UI binding: ${name}`), { code: 'ACCEPTANCE_BINDING_MISSING' });
  }
  return value.trim();
}

export function readAcceptanceBindings(environment = process.env) {
  const subjectSha256 = requireBinding(environment, acceptanceBindingNames.subjectSha256);
  if (!sha256Pattern.test(subjectSha256)) {
    throw Object.assign(new Error('Invalid fresh UI binding: ACCEPTANCE_SUBJECT_SHA256'), { code: 'ACCEPTANCE_BINDING_INVALID' });
  }
  const freshRunId = requireBinding(environment, acceptanceBindingNames.freshRunId);
  if (!reportIdPattern.test(freshRunId)) {
    throw Object.assign(new Error('Invalid fresh UI binding: ACCEPTANCE_FRESH_RUN_ID'), { code: 'ACCEPTANCE_BINDING_INVALID' });
  }
  if (requireBinding(environment, acceptanceBindingNames.isolatedDatabase) !== 'true') {
    throw Object.assign(new Error('Invalid fresh UI binding: ACCEPTANCE_ISOLATED_DATABASE'), { code: 'ACCEPTANCE_BINDING_INVALID' });
  }
  return { subjectSha256, freshRunId, isolatedDatabase: true };
}

export function normalizeEvidencePath(value, label = 'evidence path') {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\\') || value.includes('\0') ||
    path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw Object.assign(new Error(`Invalid ${label}: ${String(value)}`), { code: 'ACCEPTANCE_REPORT_INVALID' });
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.endsWith('/')) {
    throw Object.assign(new Error(`Invalid ${label}: ${String(value)}`), { code: 'ACCEPTANCE_REPORT_INVALID' });
  }
  return normalized;
}

function reportError(code, detail) {
  return Object.assign(new Error(detail), { code });
}

function assertReport(condition, code, detail) {
  if (!condition) throw reportError(code, detail);
}

function assertUnique(values, code, detail) {
  const seen = new Set();
  for (const value of values) {
    assertReport(!seen.has(value), code, `${detail}: ${value}`);
    seen.add(value);
  }
}

function screenshotDescriptors(report) {
  assertReport(Array.isArray(report.screenshots) && report.screenshots.length > 0,
    'ACCEPTANCE_SCREENSHOT_MISSING', 'Report screenshots must be a nonempty array');
  const paths = [];
  for (const [index, descriptor] of report.screenshots.entries()) {
    assertReport(descriptor !== null && typeof descriptor === 'object' && !Array.isArray(descriptor),
      'ACCEPTANCE_REPORT_INVALID', `Screenshot descriptor ${index} must be an object`);
    const relative = normalizeEvidencePath(descriptor.path, `screenshot path ${index}`);
    assertReport(typeof descriptor.sha256 === 'string' && sha256Pattern.test(descriptor.sha256),
      'ACCEPTANCE_SCREENSHOT_HASH_INVALID', `Screenshot descriptor ${index} needs a sha256`);
    paths.push(relative);
  }
  assertUnique(paths, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH', 'Duplicate screenshot path');
  return { paths, descriptors: report.screenshots };
}

export function assertUniqueAcceptancePaths(paths) {
  assertReport(Array.isArray(paths) && paths.length > 0, 'ACCEPTANCE_REPORT_INVALID',
    'Expected report paths must be a nonempty array');
  const normalized = paths.map((value, index) => normalizeEvidencePath(value, `expected report path ${index}`));
  assertUnique(normalized, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH', 'Duplicate expected report path');
  return normalized;
}

export async function validateAcceptanceReport(root, report, options) {
  const { expectedPath, subjectSha256, freshRunId, startedAt, collection, regional = false, seenSourcePaths } = options;
  const sourcePathRegistry = seenSourcePaths ?? new Set();
  const expected = normalizeEvidencePath(expectedPath, 'expected report path');
  assertReport(sourcePathRegistry instanceof Set, 'ACCEPTANCE_REPORT_INVALID', 'seenSourcePaths must be a Set');
  assertReport(report !== null && typeof report === 'object' && !Array.isArray(report),
    'ACCEPTANCE_REPORT_INVALID', `${expected} must contain an object`);
  assertReport(typeof collection === 'string' && collection.length > 0,
    'ACCEPTANCE_REPORT_INVALID', `${expected}:collection`);
  assertReport(Number.isFinite(startedAt), 'ACCEPTANCE_REPORT_INVALID', `${expected}:startedAt`);
  assertReport(report.subjectSha256 === subjectSha256, 'ACCEPTANCE_BINDING_MISMATCH', `${expected}:subjectSha256`);
  assertReport(report.freshRunId === freshRunId, 'ACCEPTANCE_RUN_ID_MISMATCH', `${expected}:freshRunId`);
  assertReport(report.isolatedDatabase === true, 'ACCEPTANCE_ISOLATION_MISSING', `${expected}:isolatedDatabase`);
  assertReport(Array.isArray(report.errors) && report.errors.length === 0, 'ACCEPTANCE_REPORT_ERRORS', `${expected}:errors`);
  const reportAt = Date.parse(report.at);
  assertReport(Number.isFinite(reportAt) && reportAt >= startedAt, 'ACCEPTANCE_STALE_REPORT', `${expected}:at`);
  assertReport(Array.isArray(report[collection]) && report[collection].length > 0,
    'ACCEPTANCE_REPORT_EMPTY', `${expected}:${collection}`);

  const screenshots = screenshotDescriptors(report);
  for (const sourcePath of [expected, ...screenshots.paths]) {
    assertReport(!sourcePathRegistry.has(sourcePath), 'ACCEPTANCE_DUPLICATE_SOURCE_PATH',
      `Duplicate source path: ${sourcePath}`);
    sourcePathRegistry.add(sourcePath);
  }
  if (regional) {
    const references = [];
    for (const [index, view] of report.views.entries()) {
      assertReport(view !== null && typeof view === 'object' && !Array.isArray(view),
        'ACCEPTANCE_REPORT_INVALID', `${expected}:views[${index}]`);
      assertReport(Array.isArray(view.gameIds), 'ACCEPTANCE_REGIONAL_COVERAGE', `${expected}:views[${index}]:gameIds`);
      assertReport(view.gameIds.length === RETAINED_GAME_IDS.length &&
        view.gameIds.every((gameId, gameIndex) => gameId === RETAINED_GAME_IDS[gameIndex]),
      'ACCEPTANCE_REGIONAL_COVERAGE', `${expected}:views[${index}]:gameIds`);
      const viewScreenshotPath = normalizeEvidencePath(view.screenshot, `${expected}:views[${index}]:screenshot`);
      assertReport(screenshots.paths.includes(viewScreenshotPath), 'ACCEPTANCE_SCREENSHOT_MISSING',
        `${expected}:views[${index}]:screenshot`);
      assertReport(typeof view.screenshotSha256 === 'string' && sha256Pattern.test(view.screenshotSha256) &&
        screenshots.descriptors.some(descriptor => normalizeEvidencePath(descriptor.path) === viewScreenshotPath &&
          descriptor.sha256 === view.screenshotSha256),
      'ACCEPTANCE_SCREENSHOT_HASH_INVALID', `${expected}:views[${index}]:screenshotSha256`);
      references.push({ path: viewScreenshotPath, label: `${expected}:views[${index}]:screenshot` });
    }
    assertReport(report.yaan !== null && typeof report.yaan === 'object' && !Array.isArray(report.yaan) && report.yaan.gameId === 6,
      'ACCEPTANCE_REGIONAL_COVERAGE', `${expected}:yaan`);
    assertReport(Array.isArray(report.yaan.ids) && report.yaan.ids.length === RETAINED_GAME_IDS.length &&
      report.yaan.ids.every((gameId, gameIndex) => gameId === RETAINED_GAME_IDS[gameIndex]),
    'ACCEPTANCE_REGIONAL_COVERAGE', `${expected}:yaan:ids`);
    const yaanScreenshotPath = normalizeEvidencePath(report.yaan.screenshot, `${expected}:yaan:screenshot`);
    assertReport(screenshots.paths.includes(yaanScreenshotPath), 'ACCEPTANCE_SCREENSHOT_MISSING',
      `${expected}:yaan:screenshot`);
    assertReport(typeof report.yaan.screenshotSha256 === 'string' && sha256Pattern.test(report.yaan.screenshotSha256) &&
      screenshots.descriptors.some(descriptor => normalizeEvidencePath(descriptor.path) === yaanScreenshotPath &&
        descriptor.sha256 === report.yaan.screenshotSha256),
    'ACCEPTANCE_SCREENSHOT_HASH_INVALID', `${expected}:yaan:screenshotSha256`);
    references.push({ path: yaanScreenshotPath, label: `${expected}:yaan:screenshot` });
    const referencePaths = references.map(reference => reference.path);
    assertUnique(referencePaths, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH', 'Duplicate regional reference path');
  }

  for (const descriptor of screenshots.descriptors) {
    const relative = normalizeEvidencePath(descriptor.path);
    const absolute = path.resolve(root, ...relative.split('/'));
    const relativeToRoot = path.relative(root, absolute);
    assertReport(relativeToRoot !== '' && !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot),
      'ACCEPTANCE_REPORT_INVALID', `${expected}:${relative} escapes the project root`);
    let bytes;
    try { bytes = await fs.readFile(absolute); }
    catch (error) {
      if (error.code === 'ENOENT') throw reportError('ACCEPTANCE_SCREENSHOT_MISSING', `${expected}:${relative}`);
      throw error;
    }
    assertReport(sha256(bytes) === descriptor.sha256, 'ACCEPTANCE_SCREENSHOT_HASH_INVALID', `${expected}:${relative}`);
  }
  return report;
}

export async function validateRawUiEvidence(root, raw, options) {
  const { subjectSha256, freshRunId, startedAt, expectedSourcePaths, expectedCheckIds } = options;
  assertReport(raw !== null && typeof raw === 'object' && !Array.isArray(raw),
    'ACCEPTANCE_REPORT_INVALID', 'Raw UI evidence must be an object');
  assertReport(raw.subjectSha256 === subjectSha256, 'ACCEPTANCE_BINDING_MISMATCH', 'raw:subjectSha256');
  assertReport(typeof raw.freshRunId === 'string' && reportIdPattern.test(raw.freshRunId) && raw.freshRunId === freshRunId,
    'ACCEPTANCE_RUN_ID_MISMATCH', 'raw:freshRunId');
  assertReport(raw.isolatedDatabase === true, 'ACCEPTANCE_ISOLATION_MISSING', 'raw:isolatedDatabase');
  const generatedAt = Date.parse(raw.generatedAt);
  assertReport(Number.isFinite(startedAt) && Number.isFinite(generatedAt) && generatedAt >= startedAt,
    'ACCEPTANCE_STALE_REPORT', 'raw:generatedAt');

  assertReport(Array.isArray(raw.checks) && raw.checks.length > 0, 'ACCEPTANCE_REPORT_EMPTY', 'raw:checks');
  const checkIds = raw.checks.map((check, index) => {
    assertReport(check !== null && typeof check === 'object' && !Array.isArray(check) && check.passed === true &&
      typeof check.id === 'string' && check.id.length > 0, 'ACCEPTANCE_REPORT_INVALID', `raw:checks[${index}]`);
    return check.id;
  });
  assertUnique(checkIds, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH', 'Duplicate raw check ID');
  if (expectedCheckIds !== undefined) {
    assertReport(Array.isArray(expectedCheckIds) && expectedCheckIds.length > 0,
      'ACCEPTANCE_REPORT_INVALID', 'expectedCheckIds must be a nonempty array');
    const expectedChecks = expectedCheckIds.map((id, index) => {
      assertReport(typeof id === 'string' && id.length > 0, 'ACCEPTANCE_REPORT_INVALID', `expectedCheckIds[${index}]`);
      return id;
    });
    assertUnique(expectedChecks, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH', 'Duplicate expected raw check ID');
    assertReport(expectedChecks.length === checkIds.length && expectedChecks.every(id => checkIds.includes(id)),
      'ACCEPTANCE_REPORT_EMPTY', 'raw:checks do not match expected checks');
  }

  assertReport(Array.isArray(raw.sources) && raw.sources.length > 0, 'ACCEPTANCE_REPORT_EMPTY', 'raw:sources');
  const sourcePaths = [];
  for (const [index, descriptor] of raw.sources.entries()) {
    assertReport(descriptor !== null && typeof descriptor === 'object' && !Array.isArray(descriptor),
      'ACCEPTANCE_REPORT_INVALID', `raw:sources[${index}]`);
    const relative = normalizeEvidencePath(descriptor.path, `raw source path ${index}`);
    assertReport(typeof descriptor.sha256 === 'string' && sha256Pattern.test(descriptor.sha256),
      'ACCEPTANCE_SCREENSHOT_HASH_INVALID', `raw:sources[${index}]:sha256`);
    const absolute = path.resolve(root, ...relative.split('/'));
    const relativeToRoot = path.relative(root, absolute);
    assertReport(relativeToRoot !== '' && !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot),
      'ACCEPTANCE_REPORT_INVALID', `raw:sources[${index}] escapes the project root`);
    let bytes;
    try { bytes = await fs.readFile(absolute); }
    catch (error) {
      if (error.code === 'ENOENT') throw reportError('ACCEPTANCE_SCREENSHOT_MISSING', `raw:${relative}`);
      throw error;
    }
    assertReport(sha256(bytes) === descriptor.sha256, 'ACCEPTANCE_SCREENSHOT_HASH_INVALID', `raw:${relative}`);
    sourcePaths.push(relative);
  }
  assertUnique(sourcePaths, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH', 'Duplicate raw source path');
  if (expectedSourcePaths !== undefined) {
    assertReport(Array.isArray(expectedSourcePaths) && expectedSourcePaths.length > 0,
      'ACCEPTANCE_REPORT_INVALID', 'expectedSourcePaths must be a nonempty array');
    const expected = expectedSourcePaths.map((source, index) => normalizeEvidencePath(source, `expected raw source path ${index}`));
    assertUnique(expected, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH', 'Duplicate expected raw source path');
    assertReport(expected.length === sourcePaths.length && expected.every(source => sourcePaths.includes(source)),
      'ACCEPTANCE_DUPLICATE_SOURCE_PATH', 'raw:sources do not exactly match expected reports');
  }
  return raw;
}

const sourceRoots = ['apps/server/src', 'apps/server/migrations', 'apps/admin/src', 'packages/rules/src', 'packages/protocol/src'];
const binaryRoots = ['apps/server/dist', 'apps/admin/dist', 'packages/rules/dist', 'packages/protocol/dist'];
const sourceFiles = ['package.json', 'pnpm-lock.yaml', 'apps/server/package.json', 'apps/admin/package.json',
  'packages/rules/package.json', 'packages/protocol/package.json', 'apps/server/tsconfig.json', 'apps/admin/tsconfig.json',
  'packages/rules/tsconfig.json', 'packages/protocol/tsconfig.json', 'pnpm-workspace.yaml',
  'apps/admin/index.html', 'apps/admin/vite.config.ts', 'tools/build.mjs', 'tools/build-fingerprint.mjs',
  'tools/release-audit.mjs', 'tools/release-check.mjs'];

// Acceptance logic is release-bearing even though it is not part of the server build.
// Keep the original subject fields intact and bind these inputs through a separate field.
const acceptanceRoots = ['tools/android-acceptance-driver'];
const acceptanceFiles = [
  'tools/run-local-accounting.mjs',
  'tools/run-local-network.mjs',
  'tools/run-local-recovery.mjs',
  'tools/run-local-stability.mjs',
  'tools/run-local-ui.mjs',
  'tools/run-local-native-acceptance.ps1',
  'tools/client-native-release-build.ps1',
  'tools/client-native-patch.mjs',
  'tools/client-native-acceptance-build.ps1',
  'tools/client-native-regional-peer.mjs',
  'tools/resolve-api-base.mjs',
  'tools/run-complete-room-matrix.mjs',
  'tools/run-fresh-local-ui.mjs',
  'tools/acceptance-client-adapter.js',
  'tools/client-validate.mjs',
  'tools/client-hall-balance-validate.mjs',
  'tools/client-e2e.mjs',
  'tools/client-regional-e2e.mjs',
];
const optionalAcceptanceFiles = ['tools/acceptance-bridge.ps1'];
const acceptanceGeneratedRoots = [
  'tools/android-acceptance-driver/build',
  'tools/android-acceptance-driver/dist',
];

function normalizeRelative(value) {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function isWithin(relative, root) {
  const candidate = normalizeRelative(relative);
  const prefix = normalizeRelative(root);
  return candidate === prefix || candidate.startsWith(prefix + '/');
}

async function pathExists(root, relative) {
  try {
    await fs.lstat(path.join(root, relative));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function acceptanceInputs(root) {
  const tools = await fs.readdir(path.join(root, 'tools'));
  const discoveredRunLocal = tools
    .filter(name => /^run-local-.*\.mjs$/.test(name))
    .map(name => path.join('tools', name));
  const optional = [];
  for (const relative of optionalAcceptanceFiles) {
    if (await pathExists(root, relative)) optional.push(relative);
  }
  return [...new Set([...acceptanceRoots, ...acceptanceFiles, ...discoveredRunLocal, ...optional])];
}

async function releaseApkPath(root) {
  const release = path.join('client/android/doushisi.apk');
  if (!(await pathExists(root, release))) throw new Error('RELEASE_APK_NOT_FOUND: ' + release);
  return release;
}

async function enumerate(root, relative, options = {}) {
  const normalized = normalizeRelative(relative);
  if (options.exclude?.(normalized)) return [];
  const absolute = path.join(root, relative);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error('Build input cannot be a symlink: ' + relative);
  if (stat.isFile()) return [relative.replaceAll('\\', '/')];
  return (await Promise.all((await fs.readdir(absolute)).sort().map(name => enumerate(root, path.join(relative, name), options)))).flat();
}

export async function fingerprint(root, inputs, options = {}) {
  const files = [...new Set((await Promise.all(inputs.map(input => enumerate(root, input, options)))).flat())].sort();
  const records = [];
  for (const file of files) records.push({ path: file, sha256: sha256(await fs.readFile(path.join(root, file))) });
  return { sha256: sha256(JSON.stringify(records)), files: records };
}

export function fingerprintSources(root) { return fingerprint(root, [...sourceRoots, ...sourceFiles]); }
export function fingerprintBinaries(root) { return fingerprint(root, binaryRoots); }

export async function fingerprintAcceptance(root) {
  const inputs = await acceptanceInputs(root);
  return fingerprint(root, inputs, {
    exclude: relative => acceptanceGeneratedRoots.some(generated => isWithin(relative, generated)),
  });
}

export async function releaseSubject(root) {
  const sources = await fingerprintSources(root);
  const binaries = await fingerprintBinaries(root);
  const client = await fingerprint(root, ['client/public']);
  const acceptance = await fingerprintAcceptance(root);
  const apk = sha256(await fs.readFile(path.join(root, await releaseApkPath(root))));
  return { sources: sources.sha256, binaries: binaries.sha256, client: client.sha256, acceptance: acceptance.sha256, apk,
    sha256: sha256(JSON.stringify([sources.sha256, binaries.sha256, client.sha256, acceptance.sha256, apk])) };
}
