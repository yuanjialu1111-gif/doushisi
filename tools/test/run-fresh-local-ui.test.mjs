import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertUniqueAcceptancePaths,
  readAcceptanceBindings,
  sha256,
  validateAcceptanceReport,
  validateRawUiEvidence,
} from '../build-fingerprint.mjs';

const source = readFileSync(new URL('../run-fresh-local-ui.mjs', import.meta.url), 'utf8');
const regionalSource = readFileSync(new URL('../client-regional-e2e.mjs', import.meta.url), 'utf8');
const subjectSha256 = 'a'.repeat(64);
const freshRunId = 'run-20261001';
const gameIds = [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27];

async function fixture(report, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-fresh-ui-test-'));
  const png = Buffer.from(options.png || 'png fixture');
  const screenshot = 'client/validation/shot.png';
  await fs.mkdir(path.join(root, 'client/validation'), { recursive: true });
  await fs.writeFile(path.join(root, screenshot), png);
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(png).digest('hex');
  const base = {
    at: new Date(options.at ?? Date.now()).toISOString(),
    subjectSha256,
    freshRunId,
    isolatedDatabase: true,
    errors: [],
    views: [{ viewport: { width: 1334, height: 750 } }],
    screenshots: [{ path: screenshot, sha256 }],
  };
  if (options.regional) {
    base.views[0].gameIds = [...gameIds];
    base.views[0].screenshot = screenshot;
    base.views[0].screenshotSha256 = sha256;
    base.yaan = { gameId: 6, ids: [...gameIds], screenshot, screenshotSha256: sha256 };
  }
  Object.assign(base, report);
  const expectedPath = 'client/validation/report.json';
  const result = { root, expectedPath, screenshot, sha256 };
  if (options.validate !== false) await validateAcceptanceReport(root, base, {
    expectedPath,
    subjectSha256,
    freshRunId,
    startedAt: options.startedAt ?? Date.now() - 1000,
    collection: options.collection || 'views',
    regional: options.regional,
  });
  return { ...result, report: base };
}

async function rejects(root, report, options, code) {
  await assert.rejects(() => validateAcceptanceReport(root, report, {
    expectedPath: 'client/validation/report.json',
    subjectSha256,
    freshRunId,
    startedAt: Date.now() - 1000,
    collection: options.collection || 'views',
    regional: options.regional,
  }), error => error.code === code);
}

async function rawFixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-fresh-ui-raw-test-'));
  const paths = options.paths || [
    'client/validation/report.json',
    'client/validation/hall-balance-report.json',
    'client/validation/room-report.json',
    'client/validation/regional/report.json',
  ];
  const sources = [];
  for (const relative of paths) {
    const absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const bytes = Buffer.from(`fixture ${relative}`);
    await fs.writeFile(absolute, bytes);
    sources.push({ path: relative, sha256: sha256(bytes) });
  }
  const raw = {
    schemaVersion: 1,
    subjectSha256,
    freshRunId,
    isolatedDatabase: true,
    checks: ['retained-layout', 'fonts-and-decimals', 'animations', 'comparison-provenance']
      .map(id => ({ id, passed: true })),
    sources,
    generatedAt: new Date(options.at ?? Date.now()).toISOString(),
  };
  Object.assign(raw, options.report);
  return { root, raw, sources };
}

async function rejectsRaw(root, raw, options = {}, code) {
  await assert.rejects(() => validateRawUiEvidence(root, raw, {
    subjectSha256,
    freshRunId,
    startedAt: options.startedAt ?? Date.now() - 1000,
    expectedSourcePaths: options.expectedSourcePaths,
    expectedCheckIds: options.expectedCheckIds,
  }), error => error.code === code);
}

test('fresh local UI bootstrap creates a beans_admin administrator', () => {
  assert.match(
    source,
    /await\s+new\s+AuthService\(db\)\.create\(\s*admin\.username,\s*admin\.password,\s*'beans_admin'/,
  );
});

test('fresh local UI passes generated beans admin credentials to the acceptance subprocess', () => {
  assert.match(source, /LOCAL_ACCEPTANCE_BEANS_ADMIN_USERNAME:\s*admin\.username/);
  assert.match(source, /LOCAL_ACCEPTANCE_BEANS_ADMIN_PASSWORD:\s*admin\.password/);
  assert.match(source, /spawn\([\s\S]*?env:\s*\{\s*\.\.\.process\.env,\s*\.\.\.env\s*\}/);
});

test('fresh local UI passes acceptance bindings to every browser process', () => {
  assert.match(source, /ACCEPTANCE_SUBJECT_SHA256:\s*subject\.sha256/);
  assert.match(source, /ACCEPTANCE_FRESH_RUN_ID:\s*runId/);
  assert.match(source, /ACCEPTANCE_ISOLATED_DATABASE:\s*'true'/);
  assert.match(source, /await run\(suite\.script, env\)/);
  assert.match(source, /const seenSourcePaths = new Set\(\)/);
  assert.match(source, /seenSourcePaths/);
  assert.match(source, /const suiteResults = \[\]/);
  assert.match(source, /await writeUiEvidence\(suiteResults, uiStartedAt\)/);
  assert.match(source, /subjectSha256:\s*subject\.sha256/);
  assert.match(source, /freshRunId:\s*runId/);
  assert.match(source, /isolatedDatabase:\s*true/);
  assert.doesNotMatch(source, /run\('run-local-ui\.mjs'/);
  assert.doesNotMatch(source, /report\.subjectSha256\s*=/);
  assert.doesNotMatch(source, /report\.freshRunId\s*=/);
});

test('regional browser writer asserts the exact retained game configuration list', () => {
  assert.match(regionalSource,
    /assert\.deepEqual\(\[\.\.\.RETAINED_GAME_IDS\],\s*\[4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27\]\)/);
});

test('acceptance bindings reject missing or malformed values', () => {
  assert.throws(() => readAcceptanceBindings({}), error => error.code === 'ACCEPTANCE_BINDING_MISSING');
  assert.throws(() => readAcceptanceBindings({
    ACCEPTANCE_SUBJECT_SHA256: subjectSha256,
    ACCEPTANCE_FRESH_RUN_ID: freshRunId,
    ACCEPTANCE_ISOLATED_DATABASE: 'false',
  }), error => error.code === 'ACCEPTANCE_BINDING_INVALID');
});

test('report validator rejects missing subject, run and isolation bindings', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-fresh-ui-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const field of ['subjectSha256', 'freshRunId', 'isolatedDatabase']) {
    const report = { at: new Date().toISOString(), subjectSha256, freshRunId, isolatedDatabase: true, errors: [], views: [{}], screenshots: [] };
    delete report[field];
    await assert.rejects(() => validateAcceptanceReport(root, report, {
      expectedPath: 'client/validation/report.json', subjectSha256, freshRunId, startedAt: Date.now() - 1000, collection: 'views',
    }));
  }
});

test('report validator rejects mixed run IDs and stale timestamps', async () => {
  const valid = await fixture({});
  try {
    await rejects(valid.root, { ...valid.report, freshRunId: 'other-run' }, {}, 'ACCEPTANCE_RUN_ID_MISMATCH');
    await rejects(valid.root, { ...valid.report, at: new Date(Date.now() - 60000).toISOString() }, {}, 'ACCEPTANCE_STALE_REPORT');
  } finally { await fs.rm(valid.root, { recursive: true, force: true }); }
});

test('report validator rejects empty views and scenarios', async () => {
  const views = await fixture({}, { validate: false });
  try {
    views.report.views = [];
    await rejects(views.root, views.report, {}, 'ACCEPTANCE_REPORT_EMPTY');
  } finally { await fs.rm(views.root, { recursive: true, force: true }); }
  const scenarios = await fixture({ scenarios: [] }, { collection: 'scenarios', validate: false });
  try { await rejects(scenarios.root, scenarios.report, { collection: 'scenarios' }, 'ACCEPTANCE_REPORT_EMPTY'); }
  finally { await fs.rm(scenarios.root, { recursive: true, force: true }); }
});

test('report validator rejects missing screenshots and screenshot hash mismatches', async () => {
  const missing = await fixture({}, { validate: false });
  try {
    missing.report.screenshots = [];
    await rejects(missing.root, missing.report, {}, 'ACCEPTANCE_SCREENSHOT_MISSING');
  } finally { await fs.rm(missing.root, { recursive: true, force: true }); }
  const mismatch = await fixture({});
  try {
    await fs.writeFile(path.join(mismatch.root, mismatch.screenshot), 'changed');
    await rejects(mismatch.root, mismatch.report, {}, 'ACCEPTANCE_SCREENSHOT_HASH_INVALID');
  } finally { await fs.rm(mismatch.root, { recursive: true, force: true }); }
});

test('report validator rejects duplicate source paths', async () => {
  const duplicate = await fixture({});
  try {
    duplicate.report.screenshots.push({ ...duplicate.report.screenshots[0] });
    await rejects(duplicate.root, duplicate.report, {}, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH');
  } finally { await fs.rm(duplicate.root, { recursive: true, force: true }); }
});

test('report validator rejects source paths reused across reports', async () => {
  const first = await fixture({}, { validate: false });
  const second = await fixture({}, { validate: false });
  const seenSourcePaths = new Set();
  const options = {
    subjectSha256,
    freshRunId,
    startedAt: Date.now() - 1000,
    collection: 'views',
    seenSourcePaths,
  };
  try {
    await validateAcceptanceReport(first.root, first.report, {
      ...options,
      expectedPath: 'client/validation/report.json',
    });
    await assert.rejects(() => validateAcceptanceReport(second.root, second.report, {
      ...options,
      expectedPath: 'client/validation/other-report.json',
    }), error => error.code === 'ACCEPTANCE_DUPLICATE_SOURCE_PATH');
  } finally {
    await fs.rm(first.root, { recursive: true, force: true });
    await fs.rm(second.root, { recursive: true, force: true });
  }
});

test('expected report paths must be unique', () => {
  assert.throws(() => assertUniqueAcceptancePaths([
    'client/validation/report.json',
    'client/validation/report.json',
  ]), error => error.code === 'ACCEPTANCE_DUPLICATE_SOURCE_PATH');
});

test('report validator rejects regional game ID mismatches and missing Yaan coverage', async () => {
  const mismatch = await fixture({}, { regional: true, validate: false });
  try {
    mismatch.report.views[0].gameIds = [4];
    await rejects(mismatch.root, mismatch.report, { regional: true }, 'ACCEPTANCE_REGIONAL_COVERAGE');
  } finally { await fs.rm(mismatch.root, { recursive: true, force: true }); }
  const missing = await fixture({}, { regional: true, validate: false });
  try {
    delete missing.report.yaan;
    await rejects(missing.root, missing.report, { regional: true }, 'ACCEPTANCE_REGIONAL_COVERAGE');
  } finally { await fs.rm(missing.root, { recursive: true, force: true }); }
});

test('raw UI validator accepts bound source evidence and rejects missing or mismatched bindings', async t => {
  const valid = await rawFixture();
  t.after(() => fs.rm(valid.root, { recursive: true, force: true }));
  await validateRawUiEvidence(valid.root, valid.raw, {
    subjectSha256,
    freshRunId,
    startedAt: Date.now() - 1000,
    expectedSourcePaths: valid.sources.map(source => source.path),
    expectedCheckIds: valid.raw.checks.map(check => check.id),
  });
  for (const field of ['subjectSha256', 'freshRunId', 'isolatedDatabase']) {
    const report = structuredClone(valid.raw);
    delete report[field];
    await rejectsRaw(valid.root, report, {}, field === 'subjectSha256'
      ? 'ACCEPTANCE_BINDING_MISMATCH'
      : field === 'freshRunId' ? 'ACCEPTANCE_RUN_ID_MISMATCH' : 'ACCEPTANCE_ISOLATION_MISSING');
  }
  await rejectsRaw(valid.root, { ...valid.raw, subjectSha256: 'b'.repeat(64) }, {}, 'ACCEPTANCE_BINDING_MISMATCH');
  await rejectsRaw(valid.root, { ...valid.raw, freshRunId: 'other-run' }, {}, 'ACCEPTANCE_RUN_ID_MISMATCH');
});

test('raw UI validator rejects stale timestamps, empty checks, and mismatched checks', async t => {
  const fixtureRoot = await rawFixture();
  t.after(() => fs.rm(fixtureRoot.root, { recursive: true, force: true }));
  await rejectsRaw(fixtureRoot.root, { ...fixtureRoot.raw, generatedAt: new Date(Date.now() - 60000).toISOString() },
    {}, 'ACCEPTANCE_STALE_REPORT');
  await rejectsRaw(fixtureRoot.root, { ...fixtureRoot.raw, checks: [] }, {}, 'ACCEPTANCE_REPORT_EMPTY');
  await rejectsRaw(fixtureRoot.root, { ...fixtureRoot.raw, checks: fixtureRoot.raw.checks.slice(0, 3) },
    { expectedCheckIds: fixtureRoot.raw.checks.map(check => check.id) }, 'ACCEPTANCE_REPORT_EMPTY');
});

test('raw UI validator rejects missing, duplicate, mismatched, and tampered source reports', async t => {
  const fixtureRoot = await rawFixture();
  t.after(() => fs.rm(fixtureRoot.root, { recursive: true, force: true }));
  await rejectsRaw(fixtureRoot.root, { ...fixtureRoot.raw, sources: fixtureRoot.raw.sources.slice(0, 3) },
    { expectedSourcePaths: fixtureRoot.raw.sources.map(source => source.path) }, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH');
  await rejectsRaw(fixtureRoot.root, { ...fixtureRoot.raw, sources: [...fixtureRoot.raw.sources, { ...fixtureRoot.raw.sources[0] }] },
    { expectedSourcePaths: fixtureRoot.raw.sources.map(source => source.path) }, 'ACCEPTANCE_DUPLICATE_SOURCE_PATH');
  await rejectsRaw(fixtureRoot.root, {
    ...fixtureRoot.raw,
    sources: fixtureRoot.raw.sources.map((source, index) => index === 0
      ? { ...source, path: 'client/validation/other-report.json' } : source),
  }, { expectedSourcePaths: fixtureRoot.raw.sources.map(source => source.path) }, 'ACCEPTANCE_SCREENSHOT_MISSING');
  await fs.writeFile(path.join(fixtureRoot.root, fixtureRoot.sources[0].path), 'changed');
  await rejectsRaw(fixtureRoot.root, fixtureRoot.raw, {}, 'ACCEPTANCE_SCREENSHOT_HASH_INVALID');
});
