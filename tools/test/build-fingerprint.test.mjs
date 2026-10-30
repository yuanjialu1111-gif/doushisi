import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fingerprintAcceptance, fingerprintSources, releaseSubject, sha256 } from '../build-fingerprint.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const acceptanceFiles = [
  'tools/run-local-accounting.mjs',
  'tools/run-local-network.mjs',
  'tools/run-local-recovery.mjs',
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
  'tools/acceptance-bridge.ps1',
  'tools/android-acceptance-driver/AndroidManifest.xml',
  'tools/android-acceptance-driver/build-driver.ps1',
  'tools/android-acceptance-driver/src/net/doushisi/acceptance/AcceptanceInstrumentation.java',
  'client/public/standalone.js',
  'client/public/index.html',
];

async function copyFile(root, relative) {
  const destination = path.join(root, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.join(projectRoot, relative), destination);
}

async function copyOrCreate(root, relative, contents = `fixture for ${relative}\n`) {
  try {
    await copyFile(root, relative);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const destination = path.join(root, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }
}

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-build-fingerprint-'));
  for (const relative of acceptanceFiles) await copyFile(root, relative);
  await copyOrCreate(root, 'tools/run-local-stability.mjs', '// fixture stability runner\n');
  await copyFile(root, 'tools/build.mjs');
  await copyFile(root, 'tools/build-fingerprint.mjs');
  await copyFile(root, 'tools/release-audit.mjs');
  await copyFile(root, 'tools/release-check.mjs');
  for (const relative of ['apps/server/src', 'apps/server/migrations', 'apps/admin/src',
    'packages/rules/src', 'packages/protocol/src', 'apps/server/dist', 'apps/admin/dist',
    'packages/rules/dist', 'packages/protocol/dist']) {
    await fs.mkdir(path.join(root, relative), { recursive: true });
  }
  const sourceFiles = [
    'package.json', 'pnpm-lock.yaml', 'apps/server/package.json', 'apps/admin/package.json',
    'packages/rules/package.json', 'packages/protocol/package.json', 'apps/server/tsconfig.json',
    'apps/admin/tsconfig.json', 'packages/rules/tsconfig.json', 'packages/protocol/tsconfig.json',
    'pnpm-workspace.yaml', 'apps/admin/index.html', 'apps/admin/vite.config.ts',
  ];
  for (const relative of sourceFiles) {
    const absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, relative.endsWith('.json') ? '{}\n' : 'fixture\n');
  }
  await fs.writeFile(path.join(root, 'apps/server/src/index.ts'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, 'apps/server/dist/index.js'), 'export const value = 1;\n');
  await fs.mkdir(path.join(root, 'client/android'), { recursive: true });
  await fs.writeFile(path.join(root, 'client/android/doushisi.apk'), 'fixture-apk');
  await fs.mkdir(path.join(root, 'tools/android-acceptance-driver/dist'), { recursive: true });
  await fs.writeFile(path.join(root, 'tools/android-acceptance-driver/dist/generated.apk'), 'generated');
  await fs.mkdir(path.join(root, 'tools/android-acceptance-driver/build'), { recursive: true });
  await fs.writeFile(path.join(root, 'tools/android-acceptance-driver/build/classes.dex'), 'generated');
  return root;
}

test('acceptance fingerprint covers every run-local script, bridge, client adapter, native runner and driver input', async t => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fingerprint = await fingerprintAcceptance(root);
  const files = new Set(fingerprint.files.map(record => record.path));
  for (const relative of [
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
    'tools/acceptance-bridge.ps1',
    'tools/acceptance-client-adapter.js',
    'tools/client-validate.mjs',
    'tools/client-hall-balance-validate.mjs',
    'tools/client-e2e.mjs',
    'tools/client-regional-e2e.mjs',
    'tools/android-acceptance-driver/AndroidManifest.xml',
    'tools/android-acceptance-driver/build-driver.ps1',
    'tools/android-acceptance-driver/src/net/doushisi/acceptance/AcceptanceInstrumentation.java',
  ]) {
    assert.ok(files.has(relative), `missing acceptance input: ${relative}`);
  }
  assert.equal(files.has('tools/android-acceptance-driver/dist/generated.apk'), false);
  assert.equal(files.has('tools/android-acceptance-driver/build/classes.dex'), false);
  assert.equal(files.has('client/public/standalone.js'), false);
});

test('deleting any required browser acceptance script fails fingerprint generation', async () => {
  const required = [
    'tools/client-validate.mjs',
    'tools/client-hall-balance-validate.mjs',
    'tools/client-e2e.mjs',
    'tools/client-regional-e2e.mjs',
  ];
  for (const relative of required) {
    const root = await makeFixture();
    try {
      await fs.rm(path.join(root, relative));
      await assert.rejects(() => fingerprintAcceptance(root), error => error.code === 'ENOENT',
        `deleting ${relative} must fail fingerprint generation`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test('generated client validation outputs are not acceptance fingerprint inputs', async t => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const generated = [
    'client/validation/report.json',
    'client/validation/hall-balance-report.json',
    'client/validation/room-report.json',
    'client/validation/regional/report.json',
    'client/validation/hall-1334.png',
  ];
  for (const relative of generated) {
    const absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, 'generated');
  }
  const fingerprint = await fingerprintAcceptance(root);
  const files = new Set(fingerprint.files.map(record => record.path));
  for (const relative of generated) assert.equal(files.has(relative), false, `unexpected generated input: ${relative}`);
});

test('any acceptance script change changes releaseSubject.sha256 and the acceptance field', async t => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = await releaseSubject(root);
  const changed = path.join(root, 'tools/run-local-network.mjs');
  await fs.appendFile(changed, '\n// changed acceptance logic\n');
  const after = await releaseSubject(root);
  assert.notEqual(after.acceptance, before.acceptance);
  assert.notEqual(after.sha256, before.sha256);
  assert.equal(after.sources, before.sources);
  assert.equal(after.binaries, before.binaries);
  assert.equal(after.client, before.client);
  assert.equal(after.apk, before.apk);
});

test('release subject always uses the formal APK and fails when it is missing', async t => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const developmentApk = path.join(root, 'client/android/doushisi.apk');
  const acceptanceApk = path.join(root, 'client/android/doushisi-acceptance.apk');

  const developmentOnly = await releaseSubject(root);
  assert.equal(developmentOnly.apk, sha256(await fs.readFile(developmentApk)));

  await fs.writeFile(acceptanceApk, 'fixture-acceptance-apk');
  const withAcceptance = await releaseSubject(root);
  assert.equal(withAcceptance.apk, developmentOnly.apk);
  assert.equal(withAcceptance.sha256, developmentOnly.sha256);

  await fs.rm(developmentApk);
  await assert.rejects(releaseSubject(root), /RELEASE_APK_NOT_FOUND/);
});

test('client/public remains covered by the compatibility client fingerprint', async t => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = await releaseSubject(root);
  await fs.appendFile(path.join(root, 'client/public/standalone.js'), '\n// changed browser client\n');
  const after = await releaseSubject(root);
  assert.notEqual(after.client, before.client);
  assert.notEqual(after.sha256, before.sha256);
  assert.equal(after.acceptance, before.acceptance);
});

test('driver and native runner inputs change the acceptance fingerprint', async t => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = await releaseSubject(root);
  await fs.appendFile(path.join(root, 'tools/android-acceptance-driver/src/net/doushisi/acceptance/AcceptanceInstrumentation.java'), '\n// changed driver\n');
  await fs.appendFile(path.join(root, 'tools/run-local-native-acceptance.ps1'), '\n# changed native runner\n');
  const after = await releaseSubject(root);
  assert.notEqual(after.acceptance, before.acceptance);
  assert.notEqual(after.sha256, before.sha256);
});

test('generated, credential, database and private artifacts are not acceptance inputs', async t => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const relative of ['.local/local-access.json', 'work/client-build/doushisi-dev.jks',
    'runtime/server.pem', 'apps/server/data/local.db', 'client/android/doushisi.apk']) {
    const absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, 'secret-or-generated');
  }
  const fingerprint = await fingerprintAcceptance(root);
  const files = fingerprint.files.map(record => record.path);
  for (const relative of ['.local/local-access.json', 'work/client-build/doushisi-dev.jks',
    'runtime/server.pem', 'apps/server/data/local.db', 'client/android/doushisi.apk']) {
    assert.equal(files.includes(relative), false, `unexpected acceptance input: ${relative}`);
  }
});

test('missing required acceptance files fail and optional bridge absence is explicit', async t => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.rm(path.join(root, 'tools/run-complete-room-matrix.mjs'));
  await assert.rejects(() => fingerprintAcceptance(root), error => error.code === 'ENOENT');
  await copyFile(root, 'tools/run-complete-room-matrix.mjs');
  await fs.rm(path.join(root, 'tools/acceptance-bridge.ps1'));
  const fingerprint = await fingerprintAcceptance(root);
  assert.equal(fingerprint.files.some(record => record.path === 'tools/acceptance-bridge.ps1'), false);
});

test('source fingerprint behavior remains unchanged by the acceptance extension', async t => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = await fingerprintSources(root);
  await fs.appendFile(path.join(root, 'tools/run-local-network.mjs'), '\n// source fingerprint must not absorb this\n');
  const after = await fingerprintSources(root);
  assert.equal(after.sha256, before.sha256);
});
