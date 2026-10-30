import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acceptanceRequirements, localAcceptanceRequirements, readArtifact, verifyAcceptance } from '../release-audit.mjs';
import { stabilityChecks } from '../run-local-stability.mjs';
import { packageProductionAcceptance } from '../package-production-acceptance.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function aggregateSubject(fields) {
  return sha256(JSON.stringify([fields.sources, fields.binaries, fields.client, fields.acceptance, fields.apk]));
}

// A release subject is the aggregate of five digests; tests build it the same
// way build-fingerprint.mjs does so the packaged manifest is a real binding.
const CURRENT_APK = sha256(Buffer.from('doushisi acceptance apk'));
const CURRENT_SOURCE_FILES = [{ path: 'apps/server/src/main.ts', sha256: sha256(Buffer.from('source-main')) }];
const CURRENT_BINARY_FILES = [{ path: 'apps/server/dist/main.js', sha256: sha256(Buffer.from('binary-main')) }];
const CURRENT_SOURCES = sha256(JSON.stringify(CURRENT_SOURCE_FILES));
const CURRENT_BINARIES = sha256(JSON.stringify(CURRENT_BINARY_FILES));
const CURRENT_CLIENT = sha256(Buffer.from('client-public'));
const CURRENT_ACCEPTANCE = sha256(Buffer.from('acceptance-inputs'));
const CURRENT_SUBJECT = aggregateSubject({
  sources: CURRENT_SOURCES,
  binaries: CURRENT_BINARIES,
  client: CURRENT_CLIENT,
  acceptance: CURRENT_ACCEPTANCE,
  apk: CURRENT_APK,
});

function currentReleaseSubject() {
  return {
    sources: CURRENT_SOURCES,
    binaries: CURRENT_BINARIES,
    client: CURRENT_CLIENT,
    acceptance: CURRENT_ACCEPTANCE,
    apk: CURRENT_APK,
    sha256: CURRENT_SUBJECT,
  };
}

const SOURCE_PATHS = Object.freeze({
  ui: 'verification/local-ui.json',
  network: 'verification/local-network.json',
  stability: 'verification/local-stability.json',
  native: 'verification/local-native.json',
  postgresRaw: 'verification/raw/postgres-concurrency.json',
  postgres: 'verification/postgres-concurrency.json',
});

function sampleP95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

async function withFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-production-acceptance-'));
  const artifact = async (relative, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    const absolute = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, bytes);
    return { path: relative, sha256: sha256(bytes) };
  };
  try {
    return await run({ root, artifact });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function checksFor(ids, details = {}) {
  return ids.map(id => ({ id, passed: true, details: details[id] ?? {} }));
}

async function baseFixture(root, artifact) {
  // The packaged manifest must be able to prove the complete build input and
  // output sets, so the fixture ships real source/binary files plus the APK.
  const sourceFiles = [];
  for (const record of CURRENT_SOURCE_FILES) {
    sourceFiles.push(await artifact(record.path, Buffer.from('source-main')));
  }
  const binaryFiles = [];
  for (const record of CURRENT_BINARY_FILES) {
    binaryFiles.push(await artifact(record.path, Buffer.from('binary-main')));
  }
  assert.deepEqual(sourceFiles, CURRENT_SOURCE_FILES);
  assert.deepEqual(binaryFiles, CURRENT_BINARY_FILES);
  await artifact('client/android/doushisi.apk', Buffer.from('doushisi acceptance apk'));
  await artifact('verification/build-manifest.json', {
    version: 1,
    builtAt: '2026-09-30T00:00:00.000Z',
    sources: { sha256: CURRENT_SOURCES, files: CURRENT_SOURCE_FILES },
    binaries: { sha256: CURRENT_BINARIES, files: CURRENT_BINARY_FILES },
  });

  const uiEvidence = await artifact('evidence/ui.json', { kind: 'ui' });
  const networkEvidence = await artifact('evidence/network.json', { kind: 'network' });
  const networkRaw = await artifact('verification/raw/local-network.json', {
    checks: [
      { id: 'old-domains-blocked', passed: true, details: { checked: ['old.example'] } },
      { id: 'gameplay', passed: true, details: { health: { status: 'ok' } } },
      { id: 'reconnect', passed: true, details: { websocketReachable: 'ws://127.0.0.1:3000/api/live' } },
      { id: 'update-path', passed: true, details: { runtimeConfigUsesCurrentOrigin: true } },
    ],
    health: { status: 'ok' },
  });

  const ui = {
    schemaVersion: 1,
    passed: true,
    subjectSha256: CURRENT_SUBJECT,
    checks: checksFor(acceptanceRequirements['original-ui-comparison.json'], {
      'retained-layout': { viewports: [{ width: 1334, height: 750 }, { width: 844, height: 390 }] },
      'fonts-and-decimals': { exact: '9007199254740993.125', fontEngine: ['2.4.7', '2.4.7'] },
      animations: { hallAnimationChanged: [true, true], staleCallbackRejected: true },
      'comparison-provenance': { browserReports: ['client/validation/report.json'],
        physicalDevicesRequiredForNativeAcceptance: true },
    }),
    evidence: [uiEvidence],
  };
  const networkChecks = checksFor(acceptanceRequirements['original-network-isolation.json'], {
    'old-domains-blocked': { checked: ['old.example'] },
    gameplay: { health: { status: 'ok' } },
    reconnect: { websocketReachable: 'ws://127.0.0.1:3000/api/live' },
    'update-path': { runtimeConfigUsesCurrentOrigin: true },
  });
  const network = { schemaVersion: 1, passed: true, subjectSha256: CURRENT_SUBJECT, checks: networkChecks,
    evidence: [networkRaw, networkEvidence] };

  const stabilityMetrics = stabilityFixtureMetrics();
  const stabilityChecksValue = stabilityChecks(stabilityMetrics);
  stabilityMetrics.checks = stabilityChecksValue;
  const rawStabilityReport = await artifact('verification/raw/local-stability.json', {
    schemaVersion: 1,
    passed: true,
    mode: 'acceptance',
    scenario: stabilityScenario(),
    metrics: stabilityMetrics,
    checks: stabilityChecksValue,
    roomBatches: [{ batchIndex: 0, rooms: Array.from({ length: 10 }, (_, index) => `room-${index + 1}`) }],
    generatedAt: '2026-09-30T02:00:00.000Z',
  });
  const stability = { schemaVersion: 1, passed: true, mode: 'acceptance', acceptanceEligible: true,
    subjectSha256: CURRENT_SUBJECT, checks: stabilityChecksValue,
    metrics: stabilityMetrics, scenario: stabilityScenario(),
    evidence: [rawStabilityReport] };

  const nativeRaw = await artifact('verification/raw/local-native/run-1/acceptance-run.json', {
    schemaVersion: 1,
    runId: 'run-1',
    apkSha256: CURRENT_APK,
    roomId: 'room-1',
    roomCode: '123456',
    roundId: 'round-1',
    accounts: [nativeAccount('one', 'user-one', 'owner'), nativeAccount('two', 'user-two', 'joiner')],
  });
  const nativeDevices = [
    { id: 'one', platform: 'android', physical: true, emulator: false, installedApkSha256: CURRENT_APK,
      connectedWithoutAdbReverse: true, connectedWithoutAdbForward: true },
    { id: 'two', platform: 'android', physical: true, emulator: false, installedApkSha256: CURRENT_APK,
      connectedWithoutAdbReverse: true, connectedWithoutAdbForward: true },
  ];
  const nativeDeviceRaw = await artifact('verification/raw/local-native/run-1/two-physical-devices.json',
    { apkSha256: CURRENT_APK, devices: nativeDevices });
  const runJson = JSON.parse((await fs.readFile(path.join(root, nativeRaw.path), 'utf8')));
  const nativeLanRaw = await artifact('verification/raw/local-native/run-1/lan-without-adb.json', {
    apiBase: 'http://192.168.1.17:3000',
    preflightForwardingFree: true,
    devices: runJson.accounts.map(account => ({ device: account.device, network: account.network })),
  });
  const nativeEvidence = [nativeRaw, nativeDeviceRaw, nativeLanRaw];
  const nativeDetails = nativeCheckDetails(runJson, nativeDevices);
  const native = {
    schemaVersion: 1,
    stage: 'acceptance',
    status: 'passed',
    passed: true,
    runId: runJson.runId,
    subjectBeforeSha256: CURRENT_SUBJECT,
    subjectAfterSha256: CURRENT_SUBJECT,
    apkSha256: CURRENT_APK,
    devices: nativeDevices,
    checks: localAcceptanceRequirements['local-native.json'].map(id => ({ id, passed: true,
      details: nativeDetails[id], evidence: nativeEvidence })),
    evidence: nativeEvidence,
  };

  const postgresDetails = {
    'exact-decimals': { amount: '0.123456789012', replayIdempotent: true },
    'fee-once': { feeOperations: 1 },
    'settlement-once': { settlementOperations: 2 },
    'negative-balance': { manualBlocked: true, automaticAllowed: true },
    'admin-concurrency': { operations: 128 },
    'dissolve-earned-scores': { zeroUnconfirmed: true },
    'role-isolation': { playerCannotAdjust: true, historyProtected: true },
  };
  const postgresRawChecks = acceptanceRequirements['postgres-concurrency.json'].map(id => ({
    id, name: id, passed: true, durationMs: 1, details: postgresDetails[id],
  }));
  const postgresEvidence = await artifact('verification/raw/postgres-concurrency.json', {
    schemaVersion: 1, passed: true, subjectBeforeSha256: CURRENT_SUBJECT,
    subjectAfterSha256: CURRENT_SUBJECT, checks: postgresRawChecks,
  });
  const postgres = {
    schemaVersion: 1, passed: true, subjectSha256: CURRENT_SUBJECT,
    checks: acceptanceRequirements['postgres-concurrency.json'].map(id => ({ id, passed: true,
      details: postgresDetails[id] })),
    evidence: [postgresEvidence],
  };

  Object.assign(baseFixture.state = baseFixture.state ?? {}, {
    ui, network, stability, native, postgres, nativeRaw, nativeDeviceRaw, nativeLanRaw, postgresEvidence,
  });
  await artifact(SOURCE_PATHS.ui, ui);
  await artifact(SOURCE_PATHS.network, network);
  await artifact(SOURCE_PATHS.stability, stability);
  await artifact(SOURCE_PATHS.native, native);
  await artifact(SOURCE_PATHS.postgres, postgres);
  return baseFixture.state;
}

function stabilityScenario() {
  return { variantKey: '6:0', roomCount: 10, playerCount: 20, roundsPerRoom: 12, baseBeans: '0.001',
    durationSeconds: 7200, requiredDurationSeconds: 7200, targetRounds: 12 };
}

function stabilityFixtureMetrics() {
  const actionDurations = Array.from({ length: 100 }, (_, index) => 20 + (index % 20) * 5);
  const dealDurations = Array.from({ length: 20 }, (_, index) => 100 + (index % 20) * 10);
  const clients = Array.from({ length: 20 }, (_, index) => ({ clientId: `client-${index + 1}`,
    reconnectCount: index === 0 ? 1 : 0 }));
  const actionRequests = actionDurations.map((durationMs, index) => ({
    clientId: `client-${index % 20 + 1}`, roomId: `room-${index % 10 + 1}`, roundId: `round-${index % 12 + 1}`,
    legalActionsMs: 5, submitMs: 5, authorityStateMs: 5, totalMs: durationMs,
  }));
  const metrics = {
    actualPlayers: 20,
    durationSeconds: 7200,
    actualSeconds: 7200,
    requiredSeconds: 7200,
    configuredSeconds: 7200,
    minimumDurationMet: true,
    mode: 'acceptance',
    startedAt: '2026-09-30T00:00:00.000Z',
    endedAt: '2026-09-30T02:00:00.000Z',
    completedRounds: 12,
    optimizedDeals: 12,
    networkClients: 20,
    requiredNetworkClients: 20,
    roomsTotal: 10,
    roomsFullyCompleted: 10,
    completedRoomRounds: 12,
    configuredRoomRounds: 12,
    protocols: ['http', 'websocket'],
    apiBase: 'http://192.168.1.17:3000',
    apiHost: '192.168.1.17',
    apiAddresses: [{ address: '192.168.1.17', family: 4 }],
    nonLoopbackApi: true,
    servicePort: 3000,
    clients,
    reconnectSamples: [{
      clientId: 'client-1',
      disconnectedAt: '2026-09-30T01:00:00.000Z',
      reconnectedAt: '2026-09-30T01:00:02.000Z',
      stateVersionBefore: 12,
      stateVersionAfter: 12,
      roundIdBefore: 'round-1',
      roundIdAfter: 'round-1',
      sameRound: true,
      stateVersionPreserved: true,
      timeOrdered: true,
      passed: true,
    }],
    settlementReconciliation: {
      settledRounds: 12,
      settlementOperations: 12,
      postingsBalanced: true,
      walletLedgerMatched: true,
      walletLedgerMismatches: 0,
      errors: [],
    },
    stateVersionChecks: [{ roundId: 'round-1', before: 12, submitted: 13, after: 13, roundEnded: false,
      passed: true }],
    stateLosses: 0,
    dealPolicyCoverage: {
      optimizedCandidates32: 12,
      ordinaryCandidates1: 12,
      policyFrozen: true,
      policyChangeAppliedNextRound: true,
      frozenPolicyVersion: null,
    },
    policyVersionEvidence: {
      auditPassed: true,
      updateVersion: 2,
      auditVersion: 2,
      requestKey: 'policy:admin:request-1',
      nextRound: { passed: true, frozenPolicyVersion: null },
    },
    actionSamples: actionDurations.map((durationMs, index) => ({
      clientId: `client-${index % 20 + 1}`, roomId: `room-${index % 10 + 1}`, roundId: `round-${index % 12 + 1}`,
      durationMs,
    })),
    actionRequestSamples: actionRequests,
    dealSamples: dealDurations.map((durationMs, index) => ({
      clientId: `client-${index % 20 + 1}`, roomId: `room-${index % 10 + 1}`, roundId: `round-${index % 12 + 1}`,
      durationMs,
    })),
    actionP95Ms: sampleP95(actionDurations),
    dealP95Ms: sampleP95(dealDurations),
    actionFailures: [],
    websocketFailures: [],
    websocketPings: Array.from({ length: 20 }, (_, index) => ({ clientId: `client-${index + 1}`,
      durationMs: 10, passed: true })),
    websocketOnline: true,
    subjectBeforeSha256: CURRENT_SUBJECT,
    subjectAfterSha256: CURRENT_SUBJECT,
    subjectStable: true,
  };
  return metrics;
}

function nativeAccount(device, userId, role) {
  return {
    device,
    userId,
    username: `${device}-user`,
    register: { registered: true, userId },
    login: { userId },
    credit: { device: { balance: '100' } },
    create: role === 'owner' ? { roomId: 'room-1', roomCode: '123456' } : null,
    join: role === 'joiner' ? { roomId: 'room-1' } : null,
    ready: { submitted: true },
    autoPlay: { submitted: true, enabled: true },
    completed: { rounds: [{ id: 'round-1', settledAt: '2026-09-30T03:00:00.000Z' }] },
    settlement: { completedRounds: 1 },
    reconnect: { requested: true, hasLiveRoom: true },
    exit: { exited: true },
    exitStatus: { hasLiveRoom: false },
    replay: { loaded: true, attached: true, roomId: 'room-1', roundId: 'round-1' },
    gps: { latitude: 30.1234, longitude: 103.5678 },
    voice: { submitted: true, mutualFaceId: 1, targetSeat: 1, targetUid: 'uid', notified: true },
    network: { apiBase: 'http://192.168.1.17:3000', wsUrl: 'ws://192.168.1.17:3000/ws/original', allowed: true },
  };
}

function nativeCheckDetails(run, devices) {
  const ids = devices.map(device => device.id);
  return {
    register: { devices: ids, userIds: run.accounts.map(account => account.userId) },
    'beans-credit': { expectedBalance: '100' },
    'create-and-join': { roomId: run.roomId, roomCode: run.roomCode },
    'completed-round': { roundId: run.roundId, settledCount: 1 },
    settlement: { completedRounds: run.accounts.map(account => account.settlement.completedRounds) },
    'auto-play': { enabled: true },
    reconnect: { liveRooms: run.accounts.map(account => account.reconnect.hasLiveRoom) },
    'animated-replay': { roomId: run.roomId, roundId: run.roundId },
    gps: { devices: ids },
    'quick-voice': { devices: ids },
    'standalone-network': { apiBase: 'http://192.168.1.17:3000' },
    'two-physical-android-devices': { count: devices.length, ids },
    'lan-without-adb': { apiBase: 'http://192.168.1.17:3000', devices: ids },
  };
}

test('valid local evidence produces all five production reports', () => withFixture(async ({ root, artifact }) => {
  await baseFixture(root, artifact);
  const result = await packageProductionAcceptance(root, {
    subjectProvider: async () => currentReleaseSubject(),
  });
  assert.equal(result.subjectSha256, CURRENT_SUBJECT);
  assert.equal(result.outputs.length, 5);
  assert.equal(result.manifestPath, 'verification/production-acceptance.json');
  assert.match(result.manifestStatus, /^(written|unchanged)$/);
  const persistedManifestBytes = await fs.readFile(
    path.join(root, 'verification/production-acceptance.json'));
  assert.equal(result.manifestSha256, sha256(persistedManifestBytes));
  assert.deepEqual(JSON.parse(persistedManifestBytes.toString('utf8')), result.manifest);
  for (const relative of [
    'verification/original-ui-comparison.json',
    'verification/original-network-isolation.json',
    'verification/gameplay-capacity.json',
    'verification/native-end-to-end.json',
    'verification/postgres-concurrency.json',
  ]) {
    await fs.access(path.join(root, relative));
  }
  await verifyAcceptance(root, 'original-ui-comparison.json', { sha256: CURRENT_SUBJECT });
  await verifyAcceptance(root, 'original-network-isolation.json', { sha256: CURRENT_SUBJECT });
  await verifyAcceptance(root, 'gameplay-capacity.json', { sha256: CURRENT_SUBJECT });
  await verifyAcceptance(root, 'postgres-concurrency.json', { sha256: CURRENT_SUBJECT });
  await verifyAcceptance(root, 'native-end-to-end.json', { sha256: CURRENT_SUBJECT, apk: CURRENT_APK },
    acceptanceRequirements);

  const native = JSON.parse(await fs.readFile(path.join(root, 'verification/native-end-to-end.json'), 'utf8'));
  assert.equal(native.subjectBeforeSha256, CURRENT_SUBJECT);
  assert.equal(native.subjectAfterSha256, CURRENT_SUBJECT);
  assert.equal(Object.hasOwn(native, 'subjectSha256'), false);
  assert.deepEqual(native.checks.map(check => check.id),
    acceptanceRequirements['native-end-to-end.json']);
  for (const descriptor of [...native.evidence, ...native.checks.flatMap(check => check.evidence)]) {
    await readArtifact(root, descriptor);
  }
  const postgres = JSON.parse(await fs.readFile(path.join(root, 'verification/postgres-concurrency.json'), 'utf8'));
  assert.deepEqual(postgres, baseFixture.state.postgres);
}));

test('production acceptance CLI treats --help as a flag, not a project root', () => {
  const script = new URL('../package-production-acceptance.mjs', import.meta.url);
  const child = spawnSync(process.execPath,
    ['--experimental-transform-types', fileURLToPath(script), '--help'], {
    encoding: 'utf8',
    env: { ...process.env, DSS_PACKAGE_PRODUCTION_ACCEPTANCE_REEXEC: '1' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /Usage: node tools\/package-production-acceptance\.mjs/);
  assert.equal(child.stderr, '');
});

test('package manifest records the full subject, build set, APK binding, and evidence closure',
  () => withFixture(async ({ root, artifact }) => {
    await baseFixture(root, artifact);
    const result = await packageProductionAcceptance(root, {
      subjectProvider: async () => currentReleaseSubject(),
    });
    const { manifest } = result;
    assert.equal(manifest.formatVersion, 1);
    assert.equal(Number.isFinite(Date.parse(manifest.generatedAt)), true);

    // 1. releaseSubject is a complete object, not a bare digest string.
    assert.deepEqual(manifest.releaseSubject, currentReleaseSubject());
    assert.deepEqual(manifest.releaseSubject, {
      sources: CURRENT_SOURCES,
      binaries: CURRENT_BINARIES,
      client: CURRENT_CLIENT,
      acceptance: CURRENT_ACCEPTANCE,
      apk: CURRENT_APK,
      sha256: CURRENT_SUBJECT,
    });

    // 5. build-manifest carries the complete source input and build output sets.
    assert.equal(manifest.buildManifest.path, 'verification/build-manifest.json');
    assert.deepEqual(manifest.buildManifest.sources.files, CURRENT_SOURCE_FILES);
    assert.deepEqual(manifest.buildManifest.binaries.files, CURRENT_BINARY_FILES);
    assert.equal(manifest.buildManifest.sources.sha256, CURRENT_SOURCES);
    assert.equal(manifest.buildManifest.binaries.sha256, CURRENT_BINARIES);
    assert.equal(manifest.buildManifest.version, 1);
    const manifestBytes = await fs.readFile(path.join(root, 'verification/build-manifest.json'));
    assert.equal(manifest.buildManifest.sha256, sha256(manifestBytes));

    // 2. APK and local-native.json report digests are present and bound.
    assert.equal(manifest.apk.path, 'client/android/doushisi.apk');
    assert.equal(manifest.apk.sha256, CURRENT_APK);
    assert.equal(manifest.apk.report.path, SOURCE_PATHS.native);
    assert.equal(manifest.apk.report.apkSha256, CURRENT_APK);
    const nativeBytes = await fs.readFile(path.join(root, SOURCE_PATHS.native));
    assert.equal(manifest.apk.report.sha256, sha256(nativeBytes));
    assert.equal(manifest.apk.report.subjectBeforeSha256, CURRENT_SUBJECT);
    assert.equal(manifest.apk.report.subjectAfterSha256, CURRENT_SUBJECT);
    assert.deepEqual(manifest.apk.binding, {
      releaseSubjectSha256: CURRENT_SUBJECT,
      apkSha256: CURRENT_APK,
      reportPath: SOURCE_PATHS.native,
      reportSha256: sha256(nativeBytes),
      matches: true,
    });

    // 4. Every formal report closes over verifiable raw/sub-evidence.
    assert.equal(manifest.reports.length, 5);
    const reportPaths = manifest.reports.map(report => report.path).sort();
    assert.deepEqual(reportPaths, [
      'verification/gameplay-capacity.json',
      'verification/native-end-to-end.json',
      'verification/original-network-isolation.json',
      'verification/original-ui-comparison.json',
      'verification/postgres-concurrency.json',
    ]);
    for (const report of manifest.reports) {
      assert.equal(Number.isFinite(Date.parse(manifest.generatedAt)), true);
      assert.equal(report.subjectSha256, CURRENT_SUBJECT);
      assert.equal(report.sha256, sha256(await fs.readFile(path.join(root, report.path))));
      assert.equal(report.passed, true);
      assert.ok(report.evidence.length > 0, `${report.path} must reference evidence`);
      for (const descriptor of report.evidence) await readArtifact(root, descriptor);
      for (const check of report.checks) {
        assert.equal(typeof check.id, 'string');
        for (const descriptor of check.evidence) await readArtifact(root, descriptor);
      }
    }

    // 3. Evidence directories record a digest and a file count.
    assert.ok(manifest.evidenceDirectories.length >= 2);
    for (const directory of manifest.evidenceDirectories) {
      assert.match(directory.path, /^(verification\/raw|client\/validation|evidence)/);
      assert.match(directory.sha256, /^[0-9a-f]{64}$/);
      assert.equal(Number.isInteger(directory.fileCount), true);
      assert.ok(directory.fileCount > 0);
    }
    const rawDirectory = manifest.evidenceDirectories.find(entry => entry.path === 'verification/raw');
    assert.ok(rawDirectory, 'verification/raw must be recorded');

    assert.deepEqual(manifest.outputs.map(output => output.path).sort(),
      result.outputs.map(output => output.target).sort());
    assert.deepEqual(result.outputs.map(output => output.target).sort(), reportPaths);
  }));

test('incomplete release subject is rejected', () => withFixture(async ({ root, artifact }) => {
  await baseFixture(root, artifact);
  const incomplete = currentReleaseSubject();
  delete incomplete.client;
  await assert.rejects(packageProductionAcceptance(root, {
    subjectProvider: async () => incomplete,
  }), error => error.code === 'SUBJECT_INVALID' && error.message.includes('client'));
}));

test('build manifest that omits a recorded file from its aggregate is rejected',
  () => withFixture(async ({ root, artifact }) => {
    await baseFixture(root, artifact);
    const manifestPath = path.join(root, 'verification/build-manifest.json');
    const buildManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const extra = await artifact('apps/server/src/extra.ts', Buffer.from('source-extra'));
    buildManifest.sources.files = [...CURRENT_SOURCE_FILES, extra];
    await artifact('verification/build-manifest.json', buildManifest);
    await assert.rejects(packageProductionAcceptance(root, {
      subjectProvider: async () => currentReleaseSubject(),
    }), error => error.code === 'BUILD_MANIFEST_MISMATCH' && error.message.includes('sources.sha256'));
  }));

test('local-native APK mismatch is rejected', () => withFixture(async ({ root, artifact }) => {
  await baseFixture(root, artifact);
  const native = baseFixture.state.native;
  native.apkSha256 = 'e'.repeat(64);
  await artifact(SOURCE_PATHS.native, native);
  await assert.rejects(packageProductionAcceptance(root, {
    subjectProvider: async () => currentReleaseSubject(),
  }), error => error.code === 'LOCAL_NATIVE_APK_MISMATCH' && error.message.includes(SOURCE_PATHS.native));
}));

test('an acceptance APK cannot substitute for the formal release APK', () => withFixture(async ({ root, artifact }) => {
  await baseFixture(root, artifact);
  await fs.rm(path.join(root, 'client/android/doushisi.apk'));
  await artifact('client/android/doushisi-acceptance.apk', Buffer.from('doushisi acceptance apk'));
  await assert.rejects(packageProductionAcceptance(root, {
    subjectProvider: async () => currentReleaseSubject(),
  }), error => error.code === 'APK_MISSING' && error.message.includes('client/android/doushisi.apk'));
}));

test('unverifiable nested check evidence is rejected', () => withFixture(async ({ root, artifact }) => {
  await baseFixture(root, artifact);
  const ui = baseFixture.state.ui;
  const checkEvidence = await artifact('verification/raw/ui-check.json', { kind: 'ui-check' });
  ui.checks[0].evidence = [{ path: checkEvidence.path, sha256: 'f'.repeat(64) }];
  await artifact(SOURCE_PATHS.ui, ui);
  await assert.rejects(packageProductionAcceptance(root, {
    subjectProvider: async () => currentReleaseSubject(),
  }), error => error.code === 'EVIDENCE_DIGEST_MISMATCH' && error.message.includes('ui-check.json'));
}));

test('stale subject is rejected', () => withFixture(async ({ root, artifact }) => {
  await baseFixture(root, artifact);
  const ui = baseFixture.state.ui;
  ui.subjectSha256 = 'c'.repeat(64);
  await artifact(SOURCE_PATHS.ui, ui);
  await assert.rejects(packageProductionAcceptance(root, {
    subjectProvider: async () => currentReleaseSubject(),
  }), error => error.code === 'ACCEPTANCE_STALE_OR_INVALID' && error.message.includes(SOURCE_PATHS.ui));
}));

test('failed check is rejected', () => withFixture(async ({ root, artifact }) => {
  await baseFixture(root, artifact);
  const network = baseFixture.state.network;
  network.checks.find(check => check.id === 'gameplay').passed = false;
  await artifact(SOURCE_PATHS.network, network);
  await assert.rejects(packageProductionAcceptance(root, {
    subjectProvider: async () => currentReleaseSubject(),
  }), error => error.code === 'ACCEPTANCE_CHECK_FAILED' && error.message.includes(SOURCE_PATHS.network));
}));

test('missing required check is rejected', () => withFixture(async ({ root, artifact }) => {
  await baseFixture(root, artifact);
  const ui = baseFixture.state.ui;
  ui.checks = ui.checks.filter(check => check.id !== 'animations');
  await artifact(SOURCE_PATHS.ui, ui);
  await assert.rejects(packageProductionAcceptance(root, {
    subjectProvider: async () => currentReleaseSubject(),
  }), error => error.code === 'ACCEPTANCE_COVERAGE_MISSING' && error.message.includes('animations'));
}));

test('hash-mismatched evidence is rejected', () => withFixture(async ({ root, artifact }) => {
  await baseFixture(root, artifact);
  const ui = baseFixture.state.ui;
  ui.evidence[0].sha256 = 'd'.repeat(64);
  await artifact(SOURCE_PATHS.ui, ui);
  await assert.rejects(packageProductionAcceptance(root, {
    subjectProvider: async () => currentReleaseSubject(),
  }), error => error.code === 'EVIDENCE_DIGEST_MISMATCH' && error.message.includes('evidence/ui.json'));
}));
