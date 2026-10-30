import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AuthService } from '../apps/server/src/auth.ts';
import { createApp } from '../apps/server/src/app.ts';
import { openDatabase, migrate } from '../apps/server/src/database.ts';
import { createRuntimeEngineRegistry } from '../apps/server/src/runtime-engines.ts';
import {
  assertUniqueAcceptancePaths,
  readAcceptanceBindings,
  releaseSubject,
  sha256,
  validateAcceptanceReport,
  validateRawUiEvidence,
} from './build-fingerprint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/server/package.json'));
const loader = pathToFileURL(require.resolve('tsx/esm')).href;
const subject = await releaseSubject(root);
const runId = randomBytes(12).toString('hex');
const acceptanceEnv = {
  ACCEPTANCE_SUBJECT_SHA256: subject.sha256,
  ACCEPTANCE_FRESH_RUN_ID: runId,
  ACCEPTANCE_ISOLATED_DATABASE: 'true',
};
assert.deepEqual(readAcceptanceBindings(acceptanceEnv), { subjectSha256: subject.sha256, freshRunId: runId, isolatedDatabase: true });
const databaseDirectory = await mkdtemp(join(tmpdir(), 'dss-fresh-local-ui-'));
const db = await openDatabase(undefined, join(databaseDirectory, 'database'));
let app;
const children = new Set();
function run(script, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--import', loader, join(root, 'tools', script)], {
      cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: 'inherit',
    });
    children.add(child);
    const timer = setTimeout(() => { child.kill(); }, 300000);
    child.once('error', error => { clearTimeout(timer); children.delete(child); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer); children.delete(child);
      if (code === 0) resolveRun();
      else reject(new Error(script + ' failed: code=' + code + ', signal=' + signal));
    });
  });
}

async function requireUnchangedSubject() {
  assert.equal((await releaseSubject(root)).sha256, subject.sha256, 'Release changed during browser acceptance');
}

async function writeUiEvidence(suiteResults, startedAt) {
  const layout = suiteResults.find(result => result.suite.script === 'client-validate.mjs').report;
  const balance = suiteResults.find(result => result.suite.script === 'client-hall-balance-validate.mjs').report;
  assert.ok(Array.isArray(layout.views) && layout.views.length >= 2, 'Retained layout evidence needs both required viewports');
  assert.deepEqual(layout.views.map(view => view.viewport).slice(0, 2),
    [{ width: 1334, height: 750 }, { width: 844, height: 390 }], 'Retained layout viewports changed');
  assert.equal(layout.views.filter(view => view.exact === '9007199254740993.125').length, layout.views.length,
    'Decimal formatting evidence is incomplete');
  assert.ok(balance.views.every(view => view.afterPhysicalClick?.normalBackground === true &&
    view.afterPhysicalClick?.shopBackground === false && view.afterStaleCallback?.normalBackground === true),
  'Hall animation evidence is incomplete');

  const checks = [
    { id: 'retained-layout', passed: true, details: { viewports: layout.views.map(view => view.viewport).slice(0, 2) } },
    { id: 'fonts-and-decimals', passed: true, details: { exact: '9007199254740993.125',
      fontEngine: layout.views.map(view => view.engine) } },
    { id: 'animations', passed: true, details: { hallAnimationChanged: layout.views.map(view => view.hallAnimationChanged),
      staleCallbackRejected: true } },
    { id: 'comparison-provenance', passed: true, details: { browserReports: suiteResults.map(result => result.suite.path),
      physicalDevicesRequiredForNativeAcceptance: true } },
  ];
  const sourceDescriptors = suiteResults.map(result => ({ path: result.suite.path, sha256: sha256(result.bytes) }));
  const rawOutput = join(root, 'verification/raw/local-ui.json');
  const raw = {
    schemaVersion: 1,
    subjectSha256: subject.sha256,
    freshRunId: runId,
    isolatedDatabase: true,
    checks,
    sources: sourceDescriptors,
    generatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(rawOutput), { recursive: true });
  await writeFile(rawOutput, JSON.stringify(raw, null, 2) + '\n');
  await validateRawUiEvidence(root, raw, {
    subjectSha256: subject.sha256,
    freshRunId: runId,
    startedAt,
    expectedSourcePaths: suiteResults.map(result => result.suite.path),
  });

  const rawBytes = await readFile(rawOutput);
  const output = join(root, 'verification/local-ui.json');
  const report = {
    schemaVersion: 1,
    passed: true,
    subjectSha256: subject.sha256,
    freshRunId: runId,
    checks,
    evidence: [...sourceDescriptors, { path: 'verification/raw/local-ui.json', sha256: sha256(rawBytes) }],
    generatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
try {
  await migrate(db);
  const account = { username: 'ui_' + runId, password: randomBytes(24).toString('base64url') };
  const admin = { username: 'admin_' + runId, password: randomBytes(24).toString('base64url') };
  await new AuthService(db).create(account.username, account.password);
  await new AuthService(db).create(admin.username, admin.password, 'beans_admin', 'Fresh UI beans admin');
  app = (await createApp(db, { engines: createRuntimeEngineRegistry(), acceptanceRunId: runId,
    isolatedDatabase: true })).app;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = app.server.address().port;
  const env = { ...acceptanceEnv,
    CLIENT_URL: 'http://127.0.0.1:' + port + '/client/', CLIENT_TEST_ACCOUNT: JSON.stringify(account),
    LOCAL_ACCEPTANCE_API_BASE: 'http://127.0.0.1:' + port,
    LOCAL_ACCEPTANCE_BEANS_ADMIN_USERNAME: admin.username,
    LOCAL_ACCEPTANCE_BEANS_ADMIN_PASSWORD: admin.password };
  const suites = [
    { script: 'client-validate.mjs', path: 'client/validation/report.json', collection: 'views' },
    { script: 'client-hall-balance-validate.mjs', path: 'client/validation/hall-balance-report.json', collection: 'views' },
    { script: 'client-e2e.mjs', path: 'client/validation/room-report.json', collection: 'scenarios' },
    { script: 'client-regional-e2e.mjs', path: 'client/validation/regional/report.json', collection: 'views', regional: true },
  ];
  assertUniqueAcceptancePaths(suites.map(suite => suite.path));
  const seenSourcePaths = new Set();
  const suiteResults = [];
  const uiStartedAt = Date.now();
  for (const suite of suites) {
    const started = Date.now();
    await run(suite.script, env);
    await requireUnchangedSubject();
    const bytes = await readFile(join(root, suite.path));
    const report = JSON.parse(bytes.toString('utf8'));
    await validateAcceptanceReport(root, report, { expectedPath: suite.path, subjectSha256: subject.sha256,
      freshRunId: runId, startedAt: started, collection: suite.collection, regional: suite.regional,
      seenSourcePaths });
    suiteResults.push({ suite, bytes, report });
  }
  await writeUiEvidence(suiteResults, uiStartedAt);
  await requireUnchangedSubject();
  await run('run-local-network.mjs', env);
  await requireUnchangedSubject();
} finally {
  for (const child of children) child.kill();
  await app?.close();
  await db.close();
  await rm(databaseDirectory, { recursive: true, force: true });
}
