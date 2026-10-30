import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditRelease, verifyRuntimeEngine, verifyAcceptance, verifyCompletedRooms, readArtifact, acceptanceRequirements, localAcceptanceRequirements, buildCanonicalRoomMatrix, canonicalJson, canonicalDigest, canonicalRoomMatrixDigest, completedGameReplayDigest, replayRoundRecord, resolveRoomMatrixPlan, roomMatrixOutputPaths, CANONICAL_CELL_COUNT, CANONICAL_PLAYER_COUNTS, CANONICAL_ROUND_COUNTS, CANONICAL_VARIANT_KEYS } from '../release-audit.mjs';
import { RETAINED_VARIANT_KEYS } from '../../packages/rules/src/index.ts';
import { buildRetainedMatrixVariants } from '../run-complete-room-matrix.mjs';
import { runtimeEngineEntries } from '../../apps/server/src/runtime-engines.ts';
import { stabilityChecks } from '../run-local-stability.mjs';
import { sha256 } from '../build-fingerprint.mjs';
import { rulebookContentSha256 } from '../rulebook-integrity.mjs';
import { validateSettlementCases } from '../check-rulebook.mjs';

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-release-'));
  async function artifact(name, value) {
    const text = JSON.stringify(value);
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), text);
    return { path: name, sha256: sha256(text) };
  }
  try { await run(root, artifact); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

function sampleP95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

test('canonical digests survive JSON persistence without changing undefined fields', () => {
  const value = { z: undefined, nested: { omitted: undefined, kept: 2 }, list: [undefined, 1] };
  const persisted = JSON.parse(JSON.stringify(value));
  assert.equal(canonicalJson(value), '{"list":[null,1],"nested":{"kept":2}}');
  assert.equal(canonicalDigest(value), canonicalDigest(persisted));
});

test('replay records digest timestamp columns in their persisted representation', () => {
  const record = replayRoundRecord({
    roomId: 'room-1', roundId: 'round-1', number: 1, variantKey: '6:0', ruleVersion: 'yaan-independent-v1',
    rules: {}, results: [], endReason: 'completed',
    frames: [{ sequence: '0', stateVersion: 0, at: new Date('2026-10-01T00:00:00.000Z'), actorId: null,
      autoPlayUserIds: [], game: { state: 'ready' } }],
  });
  assert.equal(record.frames[0].at, '2026-10-01T00:00:00.000Z');
  assert.equal(canonicalDigest(record), canonicalDigest(JSON.parse(JSON.stringify(record))));
});

function localStabilityMetrics() {
  const actionDurations = Array.from({ length: 100 }, (_, index) => 20 + (index % 20) * 5);
  const dealDurations = Array.from({ length: 100 }, (_, index) => 100 + (index % 20) * 10);
  return {
    actualPlayers: 20,
    durationSeconds: 7200,
    actualSeconds: 7200,
    requiredSeconds: 7200,
    configuredSeconds: 7200,
    minimumDurationMet: true,
    mode: 'acceptance',
    startedAt: '2026-09-30T00:00:00.000Z',
    endedAt: '2026-09-30T02:00:00.000Z',
    completedRounds: 20,
    optimizedDeals: 10,
    networkClients: 20,
    requiredNetworkClients: 20,
    roomsTotal: 2,
    roomsFullyCompleted: 2,
    completedRoomRounds: 20,
    configuredRoomRounds: 20,
    protocols: ['http', 'websocket'],
    apiBase: 'http://192.168.1.17:3000',
    servicePort: 3000,
    clients: Array.from({ length: 20 }, (_, index) => ({
      clientId: `client-${index + 1}`,
      reconnectCount: index === 0 ? 1 : 0,
    })),
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
      settledRounds: 20,
      settlementOperations: 20,
      postingsBalanced: true,
      walletLedgerMatched: true,
      walletLedgerMismatches: 0,
      errors: [],
    },
    stateVersionChecks: [{ roundId: 'round-1', before: 12, submitted: 13, after: 13, roundEnded: false, passed: true }],
    stateLosses: 0,
    dealPolicyCoverage: {
      optimizedCandidates32: 10,
      ordinaryCandidates1: 10,
      policyFrozen: true,
      policyChangeAppliedNextRound: true,
    },
    policyVersionEvidence: {
      auditPassed: true,
      updateVersion: 2,
      auditVersion: 2,
      requestKey: 'policy:user-1:stability-policy-fixture',
      nextRound: 2,
    },
    actionSamples: actionDurations.map((durationMs, index) => ({
      clientId: `client-${index % 20 + 1}`,
      roomId: `room-${index % 2 + 1}`,
      roundId: `round-${index % 5 + 1}`,
      durationMs,
    })),
    actionRequestSamples: actionDurations.map((durationMs, index) => ({
      clientId: `client-${index % 20 + 1}`,
      roomId: `room-${index % 2 + 1}`,
      roundId: `round-${index % 5 + 1}`,
      legalActionsMs: 5,
      submitMs: 5,
      authorityStateMs: 5,
      totalMs: durationMs,
    })),
    dealSamples: dealDurations.map((durationMs, index) => ({
      clientId: `client-${index % 20 + 1}`,
      roomId: `room-${index % 2 + 1}`,
      roundId: `round-${index % 5 + 1}`,
      durationMs,
    })),
    actionP95Ms: sampleP95(actionDurations),
    dealP95Ms: sampleP95(dealDurations),
    actionFailures: [],
    websocketFailures: [],
    websocketPings: Array.from({ length: 20 }, (_, index) => ({
      clientId: `client-${index + 1}`,
      durationMs: 10,
      passed: true,
    })),
    websocketOnline: true,
    subjectBeforeSha256: 'current',
    subjectAfterSha256: 'current',
    subjectStable: true,
  };
}

function localStabilityReport(raw, metrics, scenario = rawScenario(raw), checks = stabilityChecks(metrics)) {
  return {
    schemaVersion: 1,
    passed: true,
    mode: 'acceptance',
    acceptanceEligible: true,
    subjectSha256: 'current',
    checks,
    evidence: [raw],
    metrics,
    scenario,
  };
}

function rawScenario(raw) {
  return raw.scenario ?? {
    variantKey: '6:0',
    roomCount: 2,
    playerCount: 20,
    roundsPerRoom: 12,
    baseBeans: '0.001',
    durationSeconds: 7200,
    requiredDurationSeconds: 7200,
    targetRounds: 20,
  };
}

async function stabilityFixture(artifact, mutateMetrics, options = {}) {
  const metrics = localStabilityMetrics();
  const validChecks = stabilityChecks(metrics);
  if (mutateMetrics) mutateMetrics(metrics);
  const scenario = {
    variantKey: '6:0',
    roomCount: 2,
    playerCount: 20,
    roundsPerRoom: 12,
    baseBeans: '0.001',
    durationSeconds: 7200,
    requiredDurationSeconds: 7200,
    targetRounds: 20,
  };
  if (options.mutateScenario) options.mutateScenario(scenario);
  const checks = options.refreshChecks ? stabilityChecks(metrics) : validChecks;
  const reportMetrics = structuredClone(metrics);
  reportMetrics.checks = checks;
  const rawValue = {
    schemaVersion: 1,
    generatedAt: '2026-09-30T02:00:00.000Z',
    passed: true,
    mode: 'acceptance',
    scenario,
    metrics,
    roomBatches: [{ batchIndex: 0, rooms: ['room-1', 'room-2'] }],
  };
  rawValue.checks = checks;
  rawValue.metrics.checks = rawValue.checks;
  const raw = await artifact('verification/raw/local-stability.json', rawValue);
  const report = localStabilityReport(raw, reportMetrics, scenario, checks);
  return { raw, rawValue, metrics, report };
}

const nativeApk = 'a'.repeat(64);

function nativeAccount(device, userId, role, { roomId, roomCode, roundId }) {
  return {
    device,
    userId,
    username: `${device}-user`,
    register: { registered: true, userId },
    login: { userId },
    credit: { device: { balance: '100' } },
    create: role === 'owner' ? { roomId, roomCode } : null,
    join: role === 'joiner' ? { roomId } : null,
    ready: { submitted: true },
    autoPlay: { submitted: true, enabled: true },
    completed: { rounds: [{ id: roundId, settledAt: '2026-09-30T03:00:00.000Z' }] },
    settlement: { completedRounds: 1 },
    reconnect: { requested: true, hasLiveRoom: true },
    exit: { exited: true },
    exitStatus: { hasLiveRoom: false },
    replay: { loaded: true, attached: true, roomId, roundId },
    gps: { latitude: 30.1234, longitude: 103.5678 },
    voice: { submitted: true, mutualFaceId: 1, targetSeat: 1, targetUid: 'uid', notified: true },
    network: { apiBase: 'http://192.168.1.17:3000', wsUrl: 'ws://192.168.1.17:3000/ws/original', allowed: true },
  };
}

function nativeRunEvidence(options = {}) {
  const runId = options.runId ?? 'native-run';
  const apkSha256 = options.apkSha256 ?? nativeApk;
  const roomId = options.roomId ?? 'room-1';
  const roomCode = options.roomCode ?? '123456';
  const roundId = options.roundId ?? 'round-1';
  const scope = { roomId, roomCode, roundId };
  return {
    schemaVersion: 1,
    runId,
    apkSha256,
    roomId,
    roomCode,
    roundId,
    accounts: [
      nativeAccount('one', 'user-one', 'owner', scope),
      nativeAccount('two', 'user-two', 'joiner', scope),
    ],
  };
}

function nativeDeviceSummary(apkSha256 = nativeApk) {
  return ['one', 'two'].map(id => ({
    id,
    platform: 'android',
    physical: true,
    emulator: false,
    installedApkSha256: apkSha256,
    connectedWithoutAdbReverse: true,
    connectedWithoutAdbForward: true,
  }));
}

function nativeLanEvidence(run) {
  return {
    apiBase: 'http://192.168.1.17:3000',
    devices: run.accounts.map(account => ({ device: account.device, network: account.network })),
    preflightForwardingFree: true,
  };
}

async function nativeFixture(artifact, options = {}) {
  const run = options.run ?? nativeRunEvidence();
  const devices = options.devices ?? nativeDeviceSummary(run.apkSha256);
  const lan = options.lan ?? nativeLanEvidence(run);
  const runDescriptor = await artifact(`verification/raw/local-native/${run.runId}/acceptance-run.json`, run);
  const deviceDescriptor = await artifact(`verification/raw/local-native/${run.runId}/two-physical-devices.json`,
    { devices, apkSha256: run.apkSha256 });
  const lanDescriptor = await artifact(`verification/raw/local-native/${run.runId}/lan-without-adb.json`, lan);
  const evidence = [runDescriptor, deviceDescriptor, lanDescriptor];
  const ids = devices.map(device => device.id);
  const details = {
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
    'standalone-network': { apiBase: lan.apiBase },
    'two-physical-android-devices': { count: devices.length, ids },
    'lan-without-adb': { apiBase: lan.apiBase, devices: ids },
  };
  const checks = localAcceptanceRequirements['local-native.json'].map(id => ({ id, passed: true, evidence, details: details[id] }));
  const report = {
    schemaVersion: 1,
    stage: 'acceptance',
    status: 'passed',
    passed: true,
    runId: run.runId,
    subjectBeforeSha256: 'current',
    subjectAfterSha256: 'current',
    apkSha256: run.apkSha256,
    devices,
    checks,
    evidence,
  };
  return { run, devices, lan, report, descriptors: { run: runDescriptor, devices: deviceDescriptor, lan: lanDescriptor } };
}

function swapEvidence(report, descriptorPath, replacement) {
  const swap = list => list.map(item => item.path === descriptorPath ? replacement : item);
  return { ...report, evidence: swap(report.evidence), checks: report.checks.map(check => ({ ...check, evidence: swap(check.evidence) })) };
}

test('an editable engine index cannot supply a missing runtime implementation', () => fixture(async (root, artifact) => {
  await artifact('verification/verified-engines.json', [{ variantKey: '2:0', originalCaseCount: 100, referenceDigest: 'fake' }]);
  const result = await auditRelease(root, [], [{ key: '2:0', name: 'test' }], { sha256: 'current' });
  assert.equal(result.releaseReady, false);
  assert.equal(result.verifiedEngines, 0);
  assert.ok(result.blockers.some(item => item.code === 'MISSING_VERIFIED_RUNTIME_ENGINE'));
}));

test('runtime cases are executed and compared instead of trusting passed flags', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence', variantKey: '2:0', ruleVersion: 'test', requiredCoverage: [] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test', rulebookDigest: book.sha256,
    cases: [
      { id: 'independent-expected', initialSnapshot: { count: 0 },
        covers: ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy'],
        steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'hu' },
          expected: { snapshot: { count: 1, outcome: { reason: 'hu' }, settlement: [{ userId: 'one', amount: '1' }], confirmedScores: [{ eventId: 'final' }] }, events: [] } }],
        views: [{ userId: 'one', expected: { count: 1, outcome: { reason: 'hu' }, settlement: [{ userId: 'one', amount: '1' }], confirmedScores: [{ eventId: 'final' }] } }] },
      { id: 'draw-evidence', initialSnapshot: { count: 0 }, covers: ['draw'],
        steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'draw' },
          expected: { snapshot: { count: 1, outcome: { reason: 'draw' } }, events: [] } }] },
    ] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: (state, actorId, action) => ({ snapshot: { count: state.count + 1, outcome: { reason: action.outcome },
      ...(action.outcome === 'hu' ? { settlement: [{ userId: 'one', amount: '1' }], confirmedScores: [{ eventId: 'final' }] } : {}) }, events: [] }), view: state => state };
  assert.equal((await verifyRuntimeEngine(root, { engine, rulebook: book, cases })).caseCount, 2);
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }, ['option:players=4']), { code: 'REFERENCE_COVERAGE_MISSING' });
  engine.apply = () => ({ snapshot: { count: 99 }, events: [] });
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }), { code: 'REFERENCE_RESULT_MISMATCH' });
}));

test('runtime audit executes final-settlement regressions and blocks a bad fixture', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: [] });
  const settlement = [{ userId: 'one', amount: '1' }, { userId: 'two', amount: '-1' }];
  const winner = { userId: 'one', win: { scoreUnits: '4', items: [{ pattern: 'test', count: 1, fan: 2 }] } };
  const terminal = outcome => ({ snapshot: { count: 1, phase: 'finished', outcome: { reason: outcome,
    winners: outcome === 'hu' ? [winner] : [] } }, events: [],
  ...(outcome === 'hu' ? { settlement, confirmedScores: [{ eventId: 'final', postings: settlement }] } : {}) });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [
      { id: 'winning', initialSnapshot: { count: 0 },
        covers: ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy'],
        steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'hu' }, expected: terminal('hu') }] },
      { id: 'draw', initialSnapshot: { count: 0 }, covers: ['draw'],
        steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'draw' }, expected: terminal('draw') }] },
    ] });
  const applied = [];
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: (state, actorId, action) => { applied.push(action.type); return terminal(action.outcome ?? 'hu'); }, view: state => state };
  const settlementFixture = { schemaVersion: 1, kind: 'final-settlement-regression', variantKey: '2:0',
    ruleVersion: 'test', cases: [{ id: 'settle', initialSnapshot: { count: 0 },
      actions: [{ userId: 'one', action: { type: 'settle', outcome: 'hu' } }],
      expected: { finalPhase: 'finished', outcomeReason: 'hu', settlement, scoreUnits: '4',
        items: [{ pattern: 'test', count: 1, fan: 2 }] } }] };
  await artifact('docs/rules/release/2-0/settlement-cases.json', settlementFixture);

  const entry = { engine, rulebook: book, cases };
  const report = await auditRelease(root, [entry], [{ key: '2:0', name: 'test' }], { sha256: 'local' }, 'local');
  assert.equal(report.engines.length, 1);
  assert.equal(applied.filter(type => type === 'settle').length, 1);

  settlementFixture.cases[0].expected.settlement = [{ userId: 'one', amount: '2' }, { userId: 'two', amount: '-2' }];
  await artifact('docs/rules/release/2-0/settlement-cases.json', settlementFixture);
  const blocked = await auditRelease(root, [entry], [{ key: '2:0', name: 'test' }], { sha256: 'local' }, 'local');
  assert.ok(blocked.blockers.some(blocker => blocker.code === 'ERR_ASSERTION'
    && blocker.detail.includes('settlement')), JSON.stringify(blocked.blockers));
}));

test('settlement release evidence rejects missing files, digest drift and blocked cases', () => {
  const rulebookSha256 = 'a'.repeat(64);
  const officialCasesSha256 = 'b'.repeat(64);
  const valid = {
    schemaVersion: 1,
    kind: 'final-settlement-regression',
    variantKey: '23:0',
    ruleVersion: 'aba-v1',
    officialCasesSha256,
    rulebookDigest: rulebookSha256,
    cases: [{ id: 'final-settlement', status: 'verified', expected: {} }],
    blocked: [],
  };
  const validate = settlement => validateSettlementCases({
    key: '23:0',
    settlementPath: 'docs/rules/release/23-0/settlement-cases.json',
    settlementRaw: settlement === undefined ? undefined : JSON.stringify(settlement),
    officialCasesSha256,
    rulebookSha256,
    ruleVersion: 'aba-v1',
  });

  assert.throws(() => validate(undefined), /settlement cases file is required/);
  assert.throws(() => validate({ ...valid, officialCasesSha256: 'c'.repeat(64) }), /official digest/);
  assert.throws(() => validate({ ...valid, blocked: [{ id: 'guo-zhang', status: 'implementation-blocked' }] }),
    /implementation-blocked/);
  assert.throws(() => validate({ ...valid, cases: [] }), /must be non-empty/);
  assert.throws(() => validate({ ...valid, blocked: [{ id: 'legacy', status: 'unknown' }] }),
    /unsupported blocked settlement status/);
  assert.deepEqual(validate(valid), valid);
  assert.deepEqual(validate({ ...valid, blocked: [{ id: 'legacy', status: 'not-applicable', reason: 'No such rule.' }] }),
    { ...valid, blocked: [{ id: 'legacy', status: 'not-applicable', reason: 'No such rule.' }] });
});

test('runtime option coverage requires a matching typed value in the reference snapshot', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: [] });
  const requiredCoverage = ['option:players=4', 'option:mode="ranked"', 'option:autoPlay=true', 'option:cap=null'];
  const baseCovers = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy'];
  const engine = { variantKey: '2:0', version: 'test', apply: (state, actorId, action) => ({ snapshot: { ...state, count: state.count + 1,
    outcome: { reason: action.outcome }, ...(action.outcome === 'hu' ? { settlement: [{ userId: 'one', amount: '1' }], confirmedScores: [{ eventId: 'final' }] } : {}) }, events: [] }),
    view: state => state };
  const referenceCase = (id, rules) => ({ id, initialSnapshot: { count: 0, rules }, covers: [...baseCovers, ...requiredCoverage],
    steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'hu' }, expected: { snapshot: { count: 1, rules, outcome: { reason: 'hu' }, settlement: [{ userId: 'one', amount: '1' }], confirmedScores: [{ eventId: 'final' }] }, events: [] } }] });
  const drawCase = { id: 'draw-evidence', initialSnapshot: { count: 0 }, covers: ['draw'],
    steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'draw' }, expected: { snapshot: { count: 1, outcome: { reason: 'draw' } }, events: [] } }] };

  const wrongCases = await artifact('rules/wrong-option.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [referenceCase('wrong-player-count', { players: 2, mode: 'ranked', autoPlay: true, cap: null }), drawCase] });
  engine.evidence = { status: 'verified', referenceDigest: wrongCases.sha256 };
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases: wrongCases }, requiredCoverage),
    { code: 'REFERENCE_COVERAGE_MISSING' });

  const typedCases = await artifact('rules/typed-option.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [referenceCase('typed-values', { players: 4, mode: 'ranked', autoPlay: true, cap: null }), drawCase] });
  engine.evidence = { status: 'verified', referenceDigest: typedCases.sha256 };
  assert.equal((await verifyRuntimeEngine(root, { engine, rulebook: book, cases: typedCases }, requiredCoverage)).caseCount, 2);
}));

test('runtime coverage declarations require execution evidence', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: ['winning', 'scoring', 'draw'] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [{ id: 'declaration-only', initialSnapshot: { count: 0 },
      covers: ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'draw', 'timeout', 'reconnect', 'privacy'],
      steps: [{ actorId: 'one', action: 'increment', assert: { 'snapshot.count': 1 } }] }] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: state => ({ snapshot: { count: state.count + 1 }, events: [] }), view: state => state };
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }),
    { code: 'REFERENCE_COVERAGE_MISSING' });
}));

test('runtime scoring evidence requires a non-empty settlement or score value', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: ['scoring'] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [{ id: 'empty-score-evidence', initialSnapshot: { count: 0 },
      covers: ['deck', 'deal', 'actions', 'priority', 'scoring', 'timeout', 'reconnect', 'privacy'],
      steps: [{ actorId: 'one', action: 'increment', assert: { 'snapshot.count': 1, 'snapshot.scoreUnits': null } }] }] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: state => ({ snapshot: { count: state.count + 1, scoreUnits: null }, events: [] }), view: state => state };
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }),
    { code: 'REFERENCE_COVERAGE_MISSING' });
}));

const wildcardBaseCovers = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy', 'wildcards'];

function wildcardFixtureEngine(cases, outcome) {
  return { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: (state, actorId, action) => ({ snapshot: { ...state, count: state.count + 1,
      ...(action.outcome === 'draw' ? { outcome: { reason: 'draw' } } : {
        outcome: { reason: 'hu', winners: [{ userId: 'one', win: outcome }] },
        settlement: [{ userId: 'one', amount: '1' }], confirmedScores: [{ eventId: 'final' }],
      }) }, events: [] }), view: state => state };
}

function wildcardFixtureCases() {
  return [
    { id: 'wildcard-evidence', initialSnapshot: { count: 0 }, covers: wildcardBaseCovers,
      steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'hu' }, assert: { 'snapshot.count': 1 } }] },
    { id: 'draw-evidence', initialSnapshot: { count: 0 }, covers: ['draw'],
      steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'draw' }, expected: { snapshot: { count: 1, outcome: { reason: 'draw' } }, events: [] } }] },
  ];
}

test('runtime wildcard coverage requires actual wildcard use evidence', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: ['wildcards'] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: wildcardFixtureCases() });
  const engine = wildcardFixtureEngine(cases, { wildcardCount: 1 });
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }),
    { code: 'REFERENCE_COVERAGE_MISSING' });
}));

test('runtime wildcard coverage accepts a non-empty wildcardUses result', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: ['wildcards'] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: wildcardFixtureCases() });
  const engine = wildcardFixtureEngine(cases, { wildcardUses: [{ cardId: 'white-card', code: 1003 }] });
  const report = await verifyRuntimeEngine(root, { engine, rulebook: book, cases });
  assert.equal(report.coverage.includes('wildcards'), true);
}));

test('runtime wildcard coverage rejects a zero wildcardCount result', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: ['wildcards'] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: wildcardFixtureCases() });
  const engine = wildcardFixtureEngine(cases, { wildcardCount: 0 });
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }),
    { code: 'REFERENCE_COVERAGE_MISSING' });
}));

function semanticCoverageFixture(cover) {
  const base = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy'];
  return {
    id: cover + '-evidence', initialSnapshot: { count: 0 }, covers: [...base, cover],
    steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'hu' }, assert: { 'snapshot.count': 1 } }],
  };
}

async function semanticFixture(root, artifact, cover, outcome, options = {}) {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: [cover] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [semanticCoverageFixture(cover),
      { id: 'draw-evidence', initialSnapshot: { count: 0 }, covers: ['draw'],
        steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'draw' },
          expected: { snapshot: { count: 1, outcome: { reason: 'draw' } }, events: [] } }] }] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: (state, actorId, action) => ({ snapshot: { ...state, count: state.count + 1,
      ...(action.outcome === 'draw' ? { outcome: { reason: 'draw' } } : {
        outcome: { reason: 'hu', winners: [{ userId: 'one', win: outcome }] },
        settlement: [{ userId: 'one', amount: '1' }, { userId: 'two', amount: '-1' }],
        confirmedScores: [{ eventId: 'final', postings: [{ userId: 'one', amount: '1' },
          { userId: 'two', amount: '-1' }], transfers: options.transfers ?? [{ id: 't1', payerId: 'two', payeeId: 'one',
          numerator: '1', denominator: '1' }] }] }) }, events: [] }), view: state => state };
  return { book, cases, engine };
}

for (const [cover, outcome] of [
  ['gold-hook', { facts: { jinGouDiao: false } }],
  ['concealed-four-pairs', { structure: 'ordinary' }],
  ['piao', { items: [{ pattern: 'piao', count: 0, fan: 0 }] }],
]) {
  test(`runtime ${cover} coverage rejects declaration-only evidence`, () => fixture(async (root, artifact) => {
    const { book, cases, engine } = await semanticFixture(root, artifact, cover, outcome);
    await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }),
      { code: 'REFERENCE_COVERAGE_MISSING' });
  }));
}

test('runtime gold-hook coverage accepts a real scored pattern', () => fixture(async (root, artifact) => {
  const { book, cases, engine } = await semanticFixture(root, artifact, 'gold-hook',
    { items: [{ pattern: 'jinGouDiao', count: 1, fan: 3 }] });
  const report = await verifyRuntimeEngine(root, { engine, rulebook: book, cases });
  assert.equal(report.coverage.includes('gold-hook'), true);
}));

test('runtime concealed-four-pairs coverage accepts a real four-pairs structure', () => fixture(async (root, artifact) => {
  const { book, cases, engine } = await semanticFixture(root, artifact, 'concealed-four-pairs',
    { structure: 'four-pairs', facts: { concealedFourPairs: { dragons: 1 } } });
  const report = await verifyRuntimeEngine(root, { engine, rulebook: book, cases });
  assert.equal(report.coverage.includes('concealed-four-pairs'), true);
}));

test('runtime declared-wait-lock requires a declaration and a rejected locked action', () => fixture(async (root, artifact) => {
  const base = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy'];
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: ['declared-wait-lock'] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [{ id: 'declared-wait-lock', initialSnapshot: { count: 0 },
      covers: [...base, 'declared-wait-lock'], steps: [
        { actorId: 'one', action: { type: 'declare' }, assert: { 'snapshot.count': 1 } },
        { actorId: 'one', action: { type: 'meld' }, errorCode: 'INVALID_ACTION' },
        { actorId: 'one', action: { type: 'hu' }, assert: { 'snapshot.outcome.reason': 'hu', 'snapshot.settlement.length': 1, 'snapshot.confirmedScores.length': 1 } },
      ] },
      { id: 'draw-evidence', initialSnapshot: { count: 0 }, covers: ['draw'],
        steps: [{ actorId: 'one', action: { type: 'draw' }, assert: { 'snapshot.count': 1, 'snapshot.outcome.reason': 'draw' } }] }] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: (state, actorId, action) => {
      if (action.type === 'meld') throw Object.assign(new Error('locked'), { code: 'INVALID_ACTION' });
      return { snapshot: { ...state, count: state.count + 1,
        ...(action.type === 'draw' ? { outcome: { reason: 'draw' } } : action.type === 'hu' ? {
          outcome: { reason: 'hu' }, settlement: [{ userId: 'one', amount: '1' }],
          confirmedScores: [{ eventId: 'final' }] } : { players: [{ userId: 'one', declaredWaits: [1] }] }) }, events: [] };
    }, view: state => state };
  const report = await verifyRuntimeEngine(root, { engine, rulebook: book, cases });
  assert.equal(report.coverage.includes('declared-wait-lock'), true);
}));

test('runtime declared-wait-lock rejects a declaration without a locked rejection', () => fixture(async (root, artifact) => {
  const base = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy'];
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: ['declared-wait-lock'] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [{ id: 'declared-wait-only', initialSnapshot: { count: 0 },
      covers: [...base, 'declared-wait-lock'], steps: [{ actorId: 'one', action: { type: 'declare' },
        assert: { 'snapshot.count': 1 } }] },
      { id: 'draw-evidence', initialSnapshot: { count: 0 }, covers: ['draw'],
        steps: [{ actorId: 'one', action: { type: 'draw' }, assert: { 'snapshot.count': 1, 'snapshot.outcome.reason': 'draw' } }] }] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: (state, actorId, action) => ({ snapshot: { ...state, count: state.count + 1,
      ...(action.type === 'draw' ? { outcome: { reason: 'draw' } } : { players: [{ userId: 'one', declaredWaits: [1] }] }) }, events: [] }),
    view: state => state };
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }),
    { code: 'REFERENCE_COVERAGE_MISSING' });
}));

test('runtime payments coverage rejects unbalanced transfers', () => fixture(async (root, artifact) => {
  const { book, cases, engine } = await semanticFixture(root, artifact, 'payments', {},
    { transfers: [{ id: 'bad', payerId: 'two', payeeId: 'one', numerator: '2', denominator: '1' }] });
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }),
    { code: 'REFERENCE_COVERAGE_MISSING' });
}));

test('runtime threshold coverage requires both sides of a real boundary', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: ['score-threshold'] });
  const base = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy'];
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [{ id: 'threshold', initialSnapshot: { count: 0 },
      covers: [...base, 'score-threshold'], steps: [
        { actorId: 'one', action: { type: 'below' }, assert: { 'snapshot.win.status': 'not-winning', 'snapshot.win.reason': 'red-score', 'snapshot.win.structureScore': 1 } },
        { actorId: 'one', action: { type: 'above' }, assert: { 'snapshot.win.status': 'winning', 'snapshot.win.structureScore': 2 } },
        { actorId: 'one', action: { type: 'hu' }, assert: { 'snapshot.outcome.reason': 'hu', 'snapshot.settlement.length': 1, 'snapshot.confirmedScores.length': 1 } },
      ] },
      { id: 'draw-evidence', initialSnapshot: { count: 0 }, covers: ['draw'],
        steps: [{ actorId: 'one', action: { type: 'draw' }, assert: { 'snapshot.count': 1, 'snapshot.outcome.reason': 'draw' } }] }] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: (state, actorId, action) => ({ snapshot: { ...state, count: state.count + 1,
      ...(action.type === 'draw' ? { outcome: { reason: 'draw' } } : action.type === 'hu' ? {
        outcome: { reason: 'hu' }, settlement: [{ userId: 'one', amount: '1' }],
        confirmedScores: [{ eventId: 'final' }] } : { win: action.type === 'below' ?
        { status: 'not-winning', reason: 'red-score', structureScore: 1 } : { status: 'winning', structureScore: 2 } }) }, events: [] }), view: state => state };
  const report = await verifyRuntimeEngine(root, { engine, rulebook: book, cases });
  assert.equal(report.coverage.includes('score-threshold'), true);
}));

test('runtime option evidence does not accept unrelated partial matching', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: [] });
  const requiredCoverage = ['option:scene="ranked"'];
  const baseCovers = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy'];
  const engine = { variantKey: '2:0', version: 'test', apply: (state, actorId, action) => ({ snapshot: { ...state, count: state.count + 1,
    outcome: { reason: action.outcome }, ...(action.outcome === 'hu' ? { settlement: [{ userId: 'one', amount: '1' }], confirmedScores: [{ eventId: 'final' }] } : {}) }, events: [] }),
    view: state => state };
  const cases = await artifact('rules/partial-option.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [
      { id: 'partial-option', initialSnapshot: { count: 0, rules: { scene: 'ranked-extra' } },
        covers: [...baseCovers, ...requiredCoverage], steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'hu' },
          expected: { snapshot: { count: 1, rules: { scene: 'ranked-extra' }, outcome: { reason: 'hu' }, settlement: [{ userId: 'one', amount: '1' }], confirmedScores: [{ eventId: 'final' }] }, events: [] } }] },
      { id: 'draw-evidence', initialSnapshot: { count: 0 }, covers: ['draw'],
        steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'draw' },
          expected: { snapshot: { count: 1, outcome: { reason: 'draw' } }, events: [] } }] },
    ] });
  engine.evidence = { status: 'verified', referenceDigest: cases.sha256 };
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }, requiredCoverage),
    { code: 'REFERENCE_COVERAGE_MISSING' });
}));

test('runtime option coverage rejects contradictory proven values', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: [] });
  const cases = await artifact('rules/conflicting-option.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [{ id: 'conflicting-option', initialSnapshot: { count: 0, rules: { scene: 'ranked' } },
      covers: ['deck', 'deal', 'actions', 'priority', 'timeout', 'reconnect', 'privacy', 'option:scene="ranked"', 'option:scene="casual"'],
      steps: [{ actorId: 'one', action: 'increment', assert: { 'snapshot.count': 1, 'snapshot.rules.scene': 'ranked' } }] }] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: state => ({ snapshot: { ...state, count: state.count + 1 }, events: [] }), view: state => state };
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }),
    { code: 'CONTRADICTORY_OPTION_COVERAGE' });
}));

test('runtime reference assertions execute and compare declared result paths', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'approved', basis: 'apk-evidence',
    variantKey: '2:0', ruleVersion: 'test', requiredCoverage: [] });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test',
    rulebookDigest: book.sha256, cases: [
      { id: 'compact-assertion', initialSnapshot: { count: 0 },
        covers: ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'timeout', 'reconnect', 'privacy'],
        steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'hu' },
          assert: { 'snapshot.count': 1, 'snapshot.outcome.reason': 'hu', 'snapshot.settlement.length': 1, 'snapshot.confirmedScores.length': 1, 'events.length': 0 } }] },
      { id: 'draw-evidence', initialSnapshot: { count: 0 }, covers: ['draw'],
        steps: [{ actorId: 'one', action: { type: 'increment', outcome: 'draw' },
          assert: { 'snapshot.count': 1, 'snapshot.outcome.reason': 'draw' } }] },
    ] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 },
    apply: (state, actorId, action) => ({ snapshot: { count: state.count + 1, outcome: { reason: action.outcome },
      ...(action.outcome === 'hu' ? { settlement: [{ userId: 'one', amount: '1' }], confirmedScores: [{ eventId: 'final' }] } : {}) }, events: [] }), view: state => state };
  assert.equal((await verifyRuntimeEngine(root, { engine, rulebook: book, cases })).steps, 2);
  const wrongValue = JSON.parse(await fs.readFile(path.join(root, 'rules/cases.json'), 'utf8'));
  wrongValue.cases[0].steps[0].assert['snapshot.count'] = 2;
  const wrong = await artifact('rules/wrong.json', wrongValue);
  engine.evidence.referenceDigest = wrong.sha256;
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases: wrong }),
    { code: 'REFERENCE_ASSERTION_MISMATCH' });
  const mixedValue = JSON.parse(await fs.readFile(path.join(root, 'rules/cases.json'), 'utf8'));
  mixedValue.cases[0].steps[0].expected = { snapshot: { count: 1 }, events: [] };
  const mixed = await artifact('rules/mixed.json', mixedValue);
  engine.evidence.referenceDigest = mixed.sha256;
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases: mixed }), { code: 'INVALID_REFERENCE_STEP' });
}));

test('draft rules cannot qualify a release', () => fixture(async (root, artifact) => {
  const book = await artifact('rules/book.json', { schemaVersion: 1, status: 'draft', basis: 'user-approved', variantKey: '2:0', ruleVersion: 'test' });
  const cases = await artifact('rules/cases.json', {});
  await assert.rejects(verifyRuntimeEngine(root, { engine: { variantKey: '2:0', version: 'test' }, rulebook: book, cases }), { code: 'RULEBOOK_NOT_APPROVED' });
}));

test('approval must bind the exact approved rulebook content', () => fixture(async (root, artifact) => {
  const approvalValue = {
    kind: 'user-rule-approval', variantKey: '2:0', ruleVersion: 'test', statement: 'Approved.',
    evidenceReference: 'conversation:test', recordedAt: '2026-09-30T00:00:00.000Z',
  };
  const base = {
    schemaVersion: 1, status: 'approved', basis: 'user-approved', variantKey: '2:0', ruleVersion: 'test',
    requiredCoverage: [],
  };
  const approvalDescriptor = { path: 'rules/approval-bound.json', sha256: '' };
  const initial = { ...approvalValue, rulebookSha256: rulebookContentSha256({ ...base, approval: approvalDescriptor }) };
  const boundApproval = await artifact('rules/approval-bound.json', initial);
  const book = await artifact('rules/book.json', { ...base, approval: boundApproval });
  const cases = await artifact('rules/cases.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test', rulebookDigest: book.sha256, cases: [] });
  const engine = { variantKey: '2:0', version: 'test', evidence: { status: 'verified', referenceDigest: cases.sha256 } };
  await assert.rejects(verifyRuntimeEngine(root, { engine, rulebook: book, cases }), { code: 'INVALID_REFERENCE_SUITE' });
  approvalValue.statement = 'Altered after approval.';
  const tampered = await artifact('rules/approval-tampered.json', { ...approvalValue, rulebookSha256: initial.rulebookSha256 });
  const tamperedBook = await artifact('rules/book-tampered.json', { ...base, approval: tampered });
  const tamperedCases = await artifact('rules/cases-tampered.json', { schemaVersion: 1, variantKey: '2:0', ruleVersion: 'test', rulebookDigest: tamperedBook.sha256,
    cases: [{ id: 'binding', initialSnapshot: {}, covers: ['deck'], steps: [{ actorId: 'one', action: 'noop', expected: {} }] }] });
  const tamperedEngine = { ...engine, evidence: { status: 'verified', referenceDigest: tamperedCases.sha256 } };
  await assert.rejects(verifyRuntimeEngine(root, { engine: tamperedEngine, rulebook: tamperedBook, cases: tamperedCases }),
    { code: 'RULE_APPROVAL_CONTENT_MISMATCH' });
}));

test('acceptance must match the exact current build and raw evidence', () => fixture(async (root, artifact) => {
  const raw = await artifact('verification/raw.json', { actual: true });
  const name = 'original-network-isolation.json';
  const report = { schemaVersion: 1, passed: true, subjectSha256: 'old', checks: acceptanceRequirements[name].map(id => ({ id, passed: true })), evidence: [raw] };
  await artifact('verification/' + name, report);
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'new' }), { code: 'ACCEPTANCE_STALE_OR_INVALID' });
  assert.equal((await verifyAcceptance(root, name, { sha256: 'old' })).passed, true);
  await fs.writeFile(path.join(root, raw.path), 'changed');
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'old' }), { code: 'EVIDENCE_DIGEST_MISMATCH' });
}));

test('waiting room connection load does not satisfy gameplay capacity', () => fixture(async (root, artifact) => {
  const raw = await artifact('verification/raw.json', {});
  const name = 'gameplay-capacity.json';
  await artifact('verification/' + name, { schemaVersion: 1, passed: true, subjectSha256: 'current', checks: acceptanceRequirements[name].map(id => ({ id, passed: true })), evidence: [raw],
    metrics: { actualPlayers: 20, durationSeconds: 7200, completedRounds: 0, optimizedDeals: 0, actionP95Ms: 10, dealP95Ms: 10, ledgerErrors: 0, stateLosses: 0 } });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }), { code: 'GAMEPLAY_CAPACITY_TARGET_MISSING' });
}));

test('gameplay capacity accepts the 20-player 7200-second boundary and rejects lower values', () => fixture(async (root, artifact) => {
  const name = 'gameplay-capacity.json';
  const raw = await artifact('verification/raw.json', {});
  const baseMetrics = { actualPlayers: 20, durationSeconds: 7200, completedRounds: 1, optimizedDeals: 1,
    actionP95Ms: 10, dealP95Ms: 10, ledgerErrors: 0, stateLosses: 0 };
  const reportFor = metrics => ({ schemaVersion: 1, passed: true, subjectSha256: 'current',
    checks: acceptanceRequirements[name].map(id => ({ id, passed: true })), evidence: [raw], metrics });

  await artifact('verification/' + name, reportFor(baseMetrics));
  assert.equal((await verifyAcceptance(root, name, { sha256: 'current' })).passed, true);

  await artifact('verification/' + name, reportFor({ ...baseMetrics, actualPlayers: 19 }));
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }), { code: 'GAMEPLAY_CAPACITY_TARGET_MISSING' });

  await artifact('verification/' + name, reportFor({ ...baseMetrics, durationSeconds: 7199 }));
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }), { code: 'GAMEPLAY_CAPACITY_TARGET_MISSING' });
}));

test('artifact paths cannot traverse outside the deliverable', () => fixture(async (root) => {
  await assert.rejects(readArtifact(root, { path: '../outside.json', sha256: 'a'.repeat(64) }), { code: 'INVALID_ARTIFACT' });
}));

test('local profile requires real engines and does not relax production readiness', () => fixture(async root => {
  const report = await auditRelease(root, [], [{ key: '2:0' }], { sha256: 'local' }, 'local');
  assert.equal(report.localReady, false);
  assert.equal(report.releaseReady, false);
  assert.ok(report.blockers.some(b => b.code === 'MISSING_VERIFIED_RUNTIME_ENGINE'));
  assert.ok(report.blockers.some(b => b.evidence === 'local-native.json'));
  assert.ok(!report.blockers.some(b => b.evidence === 'gameplay-capacity.json'));
}));

test('local smoke tests and virtual devices cannot qualify for device or stability acceptance', () => fixture(async (root, artifact) => {
  const { report } = await stabilityFixture(artifact, metrics => { metrics.actualPlayers = 19; });
  const name = 'local-stability.json';
  await artifact('verification/' + name, report);
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'LOCAL_GAMEPLAY_CAPACITY_MISSING' });
}));

test('legacy local stability reports with only top-level counters are rejected', () => fixture(async (root, artifact) => {
  const { raw, metrics } = await stabilityFixture(artifact);
  const name = 'local-stability.json';
  await artifact('verification/' + name, { schemaVersion: 1, passed: true, subjectSha256: 'current',
    checks: localAcceptanceRequirements[name].map(id => ({ id, passed: true })), evidence: [raw],
    metrics: { ...metrics, durationSeconds: metrics.durationSeconds + 1 } });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH' });
}));

test('local stability requires a real reconnect sample and settlement reconciliation', () => fixture(async (root, artifact) => {
  const name = 'local-stability.json';
  const missingReconnect = await stabilityFixture(artifact, metrics => { metrics.reconnectSamples = []; });
  await artifact('verification/' + name, missingReconnect.report);
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'LOCAL_GAMEPLAY_CAPACITY_MISSING' });

  for (const [label, mutate] of [
    ['failed', metrics => { metrics.reconnectSamples[0].passed = false; }],
    ['stale', metrics => { metrics.reconnectSamples[0].reconnectedAt = metrics.reconnectSamples[0].disconnectedAt; }],
    ['missing-round', metrics => { delete metrics.reconnectSamples[0].roundIdAfter; }],
    ['no-recovery', metrics => { metrics.reconnectSamples[0].stateVersionAfter = metrics.reconnectSamples[0].stateVersionBefore - 1; }],
  ]) {
    const invalidReconnect = await stabilityFixture(artifact, mutate);
    await artifact('verification/' + name, invalidReconnect.report);
    await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
      { code: 'LOCAL_GAMEPLAY_CAPACITY_MISSING' }, label);
  }

  const missingSettlement = await stabilityFixture(artifact, metrics => { delete metrics.settlementReconciliation; });
  await artifact('verification/' + name, missingSettlement.report);
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'LOCAL_GAMEPLAY_CAPACITY_MISSING' });
}));

test('local stability rejects forged or incomplete duration evidence', () => fixture(async (root, artifact) => {
  const name = 'local-stability.json';
  for (const [label, mutate, options] of [
    ['durationSeconds', metrics => { metrics.durationSeconds = 7199; }, { refreshChecks: true }],
    ['actualSeconds', metrics => {
      metrics.actualSeconds = 7199;
      metrics.endedAt = '2026-09-30T01:59:59.000Z';
    }, { refreshChecks: true }],
    ['scenario-required', null, { mutateScenario: scenario => { scenario.requiredDurationSeconds = 7199; } }],
  ]) {
    const forged = await stabilityFixture(artifact, mutate, options);
    await artifact('verification/' + name, forged.report);
    await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
      error => ['ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH',
        'LOCAL_GAMEPLAY_CAPACITY_MISSING'].includes(error.code), label);
  }
}));

test('local stability rejects completed rooms that are short or missing replayed rounds', () => fixture(async (root, artifact) => {
  const name = 'local-stability.json';
  for (const [label, mutate] of [
    ['short-room', metrics => {
      metrics.completedRoomRounds = 1;
      metrics.completedRounds = 1;
      metrics.settlementReconciliation.settledRounds = 1;
      metrics.settlementReconciliation.settlementOperations = 1;
    }],
    ['missing-room', metrics => {
      metrics.roomsFullyCompleted = 1;
    }],
    ['missing-round', metrics => {
      metrics.completedRounds = 19;
      metrics.completedRoomRounds = 19;
      metrics.settlementReconciliation.settledRounds = 19;
      metrics.settlementReconciliation.settlementOperations = 19;
    }],
  ]) {
    const forged = await stabilityFixture(artifact, mutate, { refreshChecks: true });
    await artifact('verification/' + name, forged.report);
    await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
      error => ['ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH',
        'LOCAL_GAMEPLAY_CAPACITY_MISSING'].includes(error.code), label);
  }
}));

test('local stability rejects action and deal latency above their thresholds', () => fixture(async (root, artifact) => {
  const name = 'local-stability.json';
  for (const [label, mutate] of [
    ['action', metrics => {
      metrics.actionSamples = metrics.actionSamples.map((sample, index) => index >= 95 ? { ...sample, durationMs: 301 } : sample);
      metrics.actionP95Ms = 301;
      metrics.actionRequestSamples = metrics.actionRequestSamples.map((sample, index) => index >= 95 ? { ...sample, totalMs: 301 } : sample);
    }],
    ['deal', metrics => {
      metrics.dealSamples = metrics.dealSamples.map((sample, index) => index >= 95 ? { ...sample, durationMs: 2001 } : sample);
      metrics.dealP95Ms = 2001;
    }],
  ]) {
    const forged = await stabilityFixture(artifact, mutate, { refreshChecks: true });
    await artifact('verification/' + name, forged.report);
    await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
      { code: 'LOCAL_GAMEPLAY_CAPACITY_MISSING' }, label);
  }
}));

test('local stability requires ordinary deal policy and frozen-policy evidence', () => fixture(async (root, artifact) => {
  const name = 'local-stability.json';
  const withoutOrdinary = await stabilityFixture(artifact, metrics => { delete metrics.dealPolicyCoverage.ordinaryCandidates1; });
  await artifact('verification/' + name, withoutOrdinary.report);
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'LOCAL_GAMEPLAY_CAPACITY_MISSING' });

  const withoutFrozen = await stabilityFixture(artifact, metrics => { metrics.dealPolicyCoverage.policyFrozen = false; });
  await artifact('verification/' + name, withoutFrozen.report);
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'LOCAL_GAMEPLAY_CAPACITY_MISSING' });
}));

test('complete local stability evidence passes the strict gate', () => fixture(async (root, artifact) => {
  const name = 'local-stability.json';
  const { report } = await stabilityFixture(artifact);
  await artifact('verification/' + name, report);
  assert.equal((await verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements)).passed, true);
}));

test('local stability report metrics must be reproduced by the raw evidence', () => fixture(async (root, artifact) => {
  const name = 'local-stability.json';
  const { raw, report } = await stabilityFixture(artifact);
  const forged = structuredClone(report);
  forged.metrics.actionP95Ms = 1;
  await artifact('verification/' + name, forged);
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH' });

  const tamperedRaw = JSON.parse(await fs.readFile(path.join(root, raw.path), 'utf8'));
  tamperedRaw.metrics.completedRounds = 999999;
  const tampered = await artifact('verification/raw/tampered/local-stability.json', tamperedRaw);
  await artifact('verification/' + name, { ...report, evidence: [tampered] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH' });
}));

test('local stability report P95 must equal the raw sample percentile', () => fixture(async (root, artifact) => {
  const name = 'local-stability.json';
  const { raw, report } = await stabilityFixture(artifact);
  const rawValue = JSON.parse(await fs.readFile(path.join(root, raw.path), 'utf8'));
  rawValue.metrics.actionP95Ms = 25;
  const tampered = await artifact(raw.path, rawValue);
  const forged = structuredClone(report);
  forged.metrics.actionP95Ms = 25;
  forged.evidence = [tampered];
  await artifact('verification/' + name, forged);
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'LOCAL_GAMEPLAY_CAPACITY_MISSING' });
}));

test('local stability raw evidence must contain genuine checks and match the report', () => fixture(async (root, artifact) => {
  const name = 'local-stability.json';
  const { raw, rawValue, report } = await stabilityFixture(artifact);
  const mutateRaw = async (mutate, label) => {
    const value = structuredClone(rawValue);
    mutate(value);
    const descriptor = await artifact('verification/raw/local-stability.json', value);
    await artifact('verification/' + name, { ...report, evidence: [descriptor] });
    await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
      error => ['ACCEPTANCE_EVIDENCE_INVALID', 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH',
        'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH'].includes(error.code), label);
  };
  await mutateRaw(value => { delete value.checks; }, 'missing-checks');
  await mutateRaw(value => { value.checks[0].passed = false; }, 'forged-raw-check');
  await mutateRaw(value => { value.metrics.checks = undefined; }, 'forged-metric-checks');
  await mutateRaw(value => { value.checks[0].details.p95Ms = 1; }, 'forged-raw-details');

  const fresh = await stabilityFixture(artifact);
  const forgedReport = structuredClone(fresh.report);
  forgedReport.metrics.checks = structuredClone(fresh.report.metrics.checks);
  forgedReport.checks = structuredClone(fresh.report.checks);
  forgedReport.checks[0].details = { ...forgedReport.checks[0].details, forged: true };
  await artifact('verification/' + name, forgedReport);
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH' }, 'forged-report-details');

  const mismatched = await artifact('verification/raw/other/stability.json', rawValue);
  await artifact('verification/' + name, { ...report, evidence: [mismatched] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_EVIDENCE_MISSING' }, 'missing-evidence-path');
}));

test('acceptance rejects a passing report whose raw evidence is empty or not an object', () => fixture(async (root, artifact) => {
  for (const [name, rawValue] of [
    ['local-accounting.json', {}],
    ['local-recovery.json', {}],
    ['local-network.json', []],
  ]) {
    const raw = await artifact(`verification/raw/${name}`, rawValue);
    await artifact('verification/' + name, {
      schemaVersion: 1,
      passed: true,
      subjectSha256: 'current',
      checks: localAcceptanceRequirements[name].map(id => ({ id, passed: true, details: {} })),
      evidence: [raw],
    });
    await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
      { code: 'ACCEPTANCE_EVIDENCE_INVALID' });
  }
}));

test('acceptance rejects a passing report whose raw check is missing or contradicts details', () => fixture(async (root, artifact) => {
  const name = 'local-network.json';
  const health = { status: 'ok', database: 'pglite', releaseReady: false, protocolVersion: 2, ruleEnginesVerified: 21 };
  const rawChecks = [
    { id: 'old-domains-blocked', passed: true, details: { checked: ['d14api.handka.com'] } },
    { id: 'update-path', passed: true, details: { runtimeConfigUsesCurrentOrigin: true } },
    { id: 'gameplay', passed: true, details: { health } },
    { id: 'reconnect', passed: true, details: { websocketReachable: 'ws://192.168.1.17:3000/ws/original' } },
  ];
  const reportChecks = rawChecks.map(check => ({ id: check.id, passed: true, details: check.details }));

  const missing = await artifact('verification/raw/missing.json', { checks: rawChecks.slice(1), generatedAt: 'now', health });
  await artifact('verification/' + name, { schemaVersion: 1, passed: true, subjectSha256: 'current', checks: reportChecks, evidence: [missing] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_EVIDENCE_MISSING' });

  const failedRaw = structuredClone(rawChecks);
  failedRaw[0].passed = false;
  const rawFailed = await artifact('verification/raw/local-network.json', { checks: failedRaw, generatedAt: 'now', health });
  await artifact('verification/' + name, { schemaVersion: 1, passed: true, subjectSha256: 'current', checks: reportChecks, evidence: [rawFailed] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH' });

  const forgedReport = structuredClone(reportChecks);
  forgedReport[2].details = { health: { ...health, status: 'degraded' } };
  const rawGood = await artifact('verification/raw/local-network.json', { checks: rawChecks, generatedAt: 'now', health });
  await artifact('verification/' + name, { schemaVersion: 1, passed: true, subjectSha256: 'current', checks: forgedReport, evidence: [rawGood] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH' });
}));

test('local accounting report must match independently verifiable raw checks', () => fixture(async (root, artifact) => {
  const name = 'local-accounting.json';
  const checks = [
    { id: 'payer-half-up-12', passed: true, details: { version: 'payer-half-up-12-v1' } },
    { id: 'derived-large-amounts', passed: true, details: { factor: 1000 } },
    { id: 'exact-decimals', passed: true, details: { amount: '0.123456789012', replayIdempotent: true } },
    { id: 'settlement-once', passed: true, details: { operationId: 'op-1', replayOperationId: 'op-1' } },
    { id: 'negative-balance', passed: true, details: { manualBlocked: true, automaticAllowed: true } },
    { id: 'role-isolation', passed: true, details: { playerCannotAdjust: true } },
    { id: 'admin-concurrency', passed: true, details: { operations: 20 } },
    { id: 'fee-once', passed: true, details: { feeOperations: 1 } },
    { id: 'dissolve-earned-scores', passed: true, details: { zeroUnconfirmed: true } },
  ];
  const reportFor = raw => ({
    schemaVersion: 1,
    passed: true,
    subjectSha256: 'current',
    checks: checks.map(check => ({ id: check.id, passed: true, details: check.details })),
    evidence: [raw],
  });

  const goodRaw = await artifact('verification/raw/local-accounting.json', { checks, generatedAt: 'now' });
  await artifact('verification/' + name, reportFor(goodRaw));
  assert.equal((await verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements)).passed, true);

  const contradictoryChecks = structuredClone(checks);
  contradictoryChecks[3].details.replayOperationId = 'op-2';
  const contradictoryRaw = await artifact('verification/raw/local-accounting.json',
    { checks: contradictoryChecks, generatedAt: 'now' });
  await artifact('verification/' + name, reportFor(contradictoryRaw));
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH' });
}));

test('postgres concurrency promotion must be supported by the raw database checks', () => fixture(async (root, artifact) => {
  const name = 'postgres-concurrency.json';
  const rawPath = 'verification/raw/postgres-concurrency.json';
  const required = acceptanceRequirements[name];
  const details = {
    'exact-decimals': { amount: '0.123456789012', replayIdempotent: true },
    'fee-once': { feeOperations: 1 },
    'settlement-once': { settlementOperations: 2 },
    'negative-balance': { manualBlocked: true, automaticAllowed: true },
    'admin-concurrency': { operations: 128 },
    'dissolve-earned-scores': { zeroUnconfirmed: true },
    'role-isolation': { playerCannotAdjust: true, historyProtected: true },
  };
  const rawChecks = required.map(id => ({ id, name: id, passed: true, durationMs: 1, details: details[id] }));
  const formalChecks = required.map(id => ({ id, passed: true, details: details[id] }));
  const raw = await artifact(rawPath, { schemaVersion: 1, generatedAt: 'now', passed: true,
    subjectBeforeSha256: 'current', subjectAfterSha256: 'current', checks: rawChecks });
  const formal = subject => ({ schemaVersion: 1, passed: true, subjectSha256: subject, checks: formalChecks, evidence: [raw] });

  await artifact('verification/' + name, formal('current'));
  assert.equal((await verifyAcceptance(root, name, { sha256: 'current' })).passed, true);

  // A formal descriptor without the raw machine run behind it must never pass.
  await artifact('verification/' + name, { ...formal('current'), evidence: [] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }),
    { code: 'ACCEPTANCE_EVIDENCE_MISSING' });

  // A raw run that never produced a required check cannot be promoted by editing the formal file.
  const missingRaw = await artifact(rawPath, { schemaVersion: 1, generatedAt: 'now', passed: true,
    subjectBeforeSha256: 'current', subjectAfterSha256: 'current',
    checks: rawChecks.filter(check => check.id !== 'fee-once') });
  await artifact('verification/' + name, { ...formal('current'), evidence: [missingRaw] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }),
    { code: 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH' });

  // The promoted outcome and details must be identical to the raw run, not just present.
  const contradicted = structuredClone(rawChecks);
  contradicted.find(check => check.id === 'settlement-once').details = { settlementOperations: 99 };
  const contradictedRaw = await artifact(rawPath, { schemaVersion: 1, generatedAt: 'now', passed: true,
    subjectBeforeSha256: 'current', subjectAfterSha256: 'current', checks: contradicted });
  await artifact('verification/' + name, { ...formal('current'), evidence: [contradictedRaw] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }),
    { code: 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH' });

  // A failed raw run cannot be promoted even if the formal file claims success.
  const failedRaw = structuredClone(rawChecks);
  failedRaw.find(check => check.id === 'negative-balance').passed = false;
  const failedDescriptor = await artifact(rawPath, { schemaVersion: 1, generatedAt: 'now', passed: false,
    subjectBeforeSha256: 'current', subjectAfterSha256: 'current', checks: failedRaw });
  await artifact('verification/' + name, { ...formal('current'), evidence: [failedDescriptor] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }),
    { code: 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH' });
}));

test('local recovery must reconcile restored metrics with the raw source metrics', () => fixture(async (root, artifact) => {
  const name = 'local-recovery.json';
  const sourceMetrics = { migration: 9, accounts: 3, entries: 1, rounds: 0, events: 0 };
  const checks = [
    { id: 'service-restart', passed: true, details: { activeDirectoryLockRejected: true } },
    { id: 'daily-backup-catchup', passed: true, details: { first: 'a.tgz', second: 'b.tgz', sameSlotSkipped: true } },
    { id: 'isolated-restore', passed: true, details: { ...sourceMetrics } },
    { id: 'ledger-reconciled', passed: true, details: { ...sourceMetrics } },
    { id: 'old-rule-version', passed: true, details: { migration: 9, frozenRoomVersions: 1, ruleVersion: 'v1', frozenOptionsPreserved: true, memberSeatsPreserved: true } },
  ];
  const raw = await artifact('verification/raw/local-recovery.json', {
    checks,
    sourceMetrics,
    restoredMetrics: { ...sourceMetrics, entries: 2 },
    generatedAt: 'now',
  });
  await artifact('verification/' + name, {
    schemaVersion: 1,
    passed: true,
    subjectSha256: 'current',
    checks: checks.map(check => ({ id: check.id, passed: true, details: check.details })),
    evidence: [raw],
  });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current' }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_EVIDENCE_MISMATCH' });
}));

// The formal verifier deliberately pins the grid to the fixed retained scope, so its fixtures are
// built from the real 21 retained configurations rather than an arbitrary two-variant subset.
const roomMatrixVariants = buildRetainedMatrixVariants(runtimeEngineEntries);
const roomMatrixEngines = runtimeEngineEntries.map(entry =>
  ({ variantKey: entry.engine.variantKey, version: entry.engine.version }));
const roomMatrixSubject = 'c'.repeat(64);

function optionCoverageFor(variant) {
  return variant.fields.flatMap(field => field.allowedValues.map(value => `option:${field.key}=${JSON.stringify(value)}`));
}

/** Builds a self-consistent completed-game cell straight from the canonical matrix generator. */
function syntheticGame(cell, subjectSha256 = roomMatrixSubject) {
  const memberIds = Array.from({ length: cell.playerCount }, (_, index) => `${cell.key}-p${index + 1}`);
  const rounds = Array.from({ length: cell.configuredRounds }, (_, index) => {
    const roundId = `${cell.key}-r${index + 1}`;
    const replay = {
      roomId: `${cell.key}-room`, roundId, number: index + 1, variantKey: cell.variantKey,
      ruleVersion: cell.ruleVersion, rules: { ...cell.normalizedOptions }, results: [], endReason: 'completed',
      frames: [{ sequence: '0', stateVersion: 0, at: '2026-10-01T00:00:00.000Z', actorId: null,
        autoPlayUserIds: [], gameSha256: canonicalDigest({ index }) }],
    };
    return { roundId, number: index + 1, dealerId: memberIds[index % memberIds.length], dealerRun: index + 1,
      continuation: { version: cell.ruleVersion, completedRound: index + 1,
        nextDealerId: memberIds[(index + 1) % memberIds.length], dealerRun: index + 2 },
      digest: canonicalDigest(replay), replay };
  });
  return {
    variantKey: cell.variantKey, playerCount: cell.playerCount, configuredRounds: cell.configuredRounds,
    completedRounds: cell.configuredRounds, currentRound: cell.configuredRounds, roomState: 'closed',
    continuationVerified: true, memberIds, replayVerified: true, replayedRounds: rounds.length,
    replayedRoundIds: rounds.map(round => round.roundId), ruleVersion: cell.ruleVersion, steps: 40 + rounds.length,
    normalizedOptions: cell.normalizedOptions, optionsSha256: cell.optionsSha256, optionCoverage: cell.optionCoverage,
    rounds, replaySummary: { rounds: rounds.length, digest: completedGameReplayDigest(rounds) },
    subjectBeforeSha256: subjectSha256, subjectAfterSha256: subjectSha256, subjectSha256, passed: true,
  };
}

function syntheticMatrixGames() {
  const matrix = buildCanonicalRoomMatrix(roomMatrixVariants, roomMatrixEngines);
  const games = matrix.cells.map(cell => syntheticGame(cell));
  return { matrix, games, summary: {
    variants: roomMatrixVariants.length, games: games.length,
    minSteps: Math.min(...games.map(game => game.steps)), maxSteps: Math.max(...games.map(game => game.steps)) } };
}

test('completed games report must match the raw games and recomputed summary', () => fixture(async (root, artifact) => {
  const name = 'local-completed-games.json';
  const { matrix, games, summary } = syntheticMatrixGames();
  const matrixDigest = canonicalRoomMatrixDigest(matrix);
  const raw = await artifact('verification/raw/local-completed-games.json', {
    schemaVersion: 1, generatedAt: 'now', scope: 'real rooms', smokeOnly: false, acceptanceEligible: true,
    matrixDigest, subjectSha256: roomMatrixSubject, games, summary, passed: true,
  });
  const checks = localAcceptanceRequirements[name].map(id => ({ id, passed: true }));

  await artifact('verification/' + name, { schemaVersion: 1, passed: true, smokeOnly: false, acceptanceEligible: true,
    matrixDigest, subjectSha256: roomMatrixSubject, checks, evidence: [raw], games, summary: { ...summary, maxSteps: 999 } });
  await assert.rejects(verifyAcceptance(root, name, { sha256: roomMatrixSubject }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH' });

  await artifact('verification/' + name, { schemaVersion: 1, passed: true, smokeOnly: false, acceptanceEligible: true,
    matrixDigest, subjectSha256: roomMatrixSubject, checks, evidence: [raw], games: games.slice(0, 1),
    summary: { variants: 1, games: 1, minSteps: games[0].steps, maxSteps: games[0].steps } });
  await assert.rejects(verifyAcceptance(root, name, { sha256: roomMatrixSubject }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH' });

  await artifact('verification/' + name, { schemaVersion: 1, passed: true, smokeOnly: false, acceptanceEligible: true,
    matrixDigest, subjectSha256: roomMatrixSubject, checks, evidence: [raw], games, summary });
  assert.equal((await verifyAcceptance(root, name, { sha256: roomMatrixSubject }, localAcceptanceRequirements)).passed, true);
}));

test('native preflight check ids cannot impersonate final acceptance', () => fixture(async (root, artifact) => {
  const raw = await artifact('verification/raw/preflight.json', { devices: [] });
  const name = 'local-native.json';
  const checks = localAcceptanceRequirements[name].map(id => ({ id: `preflight-${id}`, passed: true, evidence: [raw] }));
  await artifact('verification/' + name, { schemaVersion: 1, stage: 'acceptance', status: 'passed', passed: true,
    runId: 'preflight-run', subjectBeforeSha256: 'current', subjectAfterSha256: 'current', apkSha256: 'a'.repeat(64),
    devices: [{ id: 'one', platform: 'android', physical: true }, { id: 'two', platform: 'android', physical: true }],
    checks, evidence: [raw] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current', apk: 'a'.repeat(64) }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_COVERAGE_MISSING' });
}));

test('failed local-native reports remain failed and cannot retain a stale pass', () => fixture(async (root, artifact) => {
  const raw = await artifact('verification/raw/native.json', { failed: true });
  const name = 'local-native.json';
  await artifact('verification/' + name, { schemaVersion: 1, stage: 'acceptance', status: 'failed', passed: false,
    runId: 'failed-run', subjectBeforeSha256: 'current', subjectAfterSha256: 'current', apkSha256: 'a'.repeat(64),
    devices: [{ id: 'one', platform: 'android', physical: true }, { id: 'two', platform: 'android', physical: true }],
    checks: localAcceptanceRequirements[name].map(id => ({ id, passed: false, evidence: [raw] })), evidence: [raw] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current', apk: 'a'.repeat(64) }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_STALE_OR_INVALID' });
}));

test('local-native evidence hashes are checked per required check', () => fixture(async (root, artifact) => {
  const name = 'local-native.json';
  const { report } = await nativeFixture(artifact);
  await artifact('verification/' + name, report);
  assert.equal((await verifyAcceptance(root, name, { sha256: 'current', apk: nativeApk }, localAcceptanceRequirements)).passed, true);
  await fs.writeFile(path.join(root, report.evidence[0].path), 'changed');
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current', apk: nativeApk }, localAcceptanceRequirements),
    { code: 'EVIDENCE_DIGEST_MISMATCH' });
}));

test('local-native requires two distinct physical Android devices and rejects emulator fields', () => fixture(async (root, artifact) => {
  const name = 'local-native.json';
  const { report } = await nativeFixture(artifact);
  const physicalDevice = id => ({ id, platform: 'android', physical: true, installedApkSha256: nativeApk,
    connectedWithoutAdbReverse: true, connectedWithoutAdbForward: true });
  for (const [devices, code] of [
    [[physicalDevice('one')], 'PHYSICAL_DEVICE_EVIDENCE_MISSING'],
    [[physicalDevice('one'), physicalDevice('one')], 'PHYSICAL_DEVICE_EVIDENCE_MISSING'],
    [[physicalDevice('one'), { ...physicalDevice('emulator-5554') }], 'EMULATOR_DEVICE_REJECTED'],
    [[physicalDevice('one'), { ...physicalDevice('two'), model: 'ranchu' }], 'EMULATOR_DEVICE_REJECTED'],
    [[physicalDevice('one'), { ...physicalDevice('two'), installedApkSha256: 'b'.repeat(64) }], 'LOCAL_NATIVE_DEVICE_APK_MISMATCH'],
    [[physicalDevice('one'), { ...physicalDevice('two'), connectedWithoutAdbForward: false }], 'LOCAL_NATIVE_ADB_FORWARDING_PRESENT'],
  ]) {
    await artifact('verification/' + name, { ...report, devices });
    await assert.rejects(verifyAcceptance(root, name, { sha256: 'current', apk: nativeApk }, localAcceptanceRequirements),
      { code });
  }
  await artifact('verification/' + name, { ...report, devices: [physicalDevice('one'), physicalDevice('two')] });
  await assert.rejects(verifyAcceptance(root, name, { sha256: 'current', apk: 'b'.repeat(64) }, localAcceptanceRequirements),
    { code: 'LOCAL_NATIVE_APK_MISMATCH' });
}));

test('local-native must be bound to the same subject before and after the run', () => fixture(async (root, artifact) => {
  const name = 'local-native.json';
  const { report } = await nativeFixture(artifact);
  for (const [label, subject] of [
    ['before', { subjectBeforeSha256: 'old' }],
    ['after', { subjectAfterSha256: 'old' }],
    ['both', { subjectBeforeSha256: 'old', subjectAfterSha256: 'older' }],
  ]) {
    await artifact('verification/' + name, { ...report, ...subject });
    await assert.rejects(verifyAcceptance(root, name, { sha256: 'current', apk: nativeApk }, localAcceptanceRequirements),
      { code: 'ACCEPTANCE_STALE_OR_INVALID' }, label);
  }
}));

test('local-native passing report must be supported by the raw run, device and LAN evidence', () => fixture(async (root, artifact) => {
  const name = 'local-native.json';
  const options = { sha256: 'current', apk: nativeApk };
  const rawPath = (fixtureResult, key) => path.join(root, fixtureResult.descriptors[key].path);

  async function forge(fixtureResult, key, mutate, suffix) {
    const value = JSON.parse(await fs.readFile(rawPath(fixtureResult, key), 'utf8'));
    mutate(value);
    const originalPath = fixtureResult.descriptors[key].path;
    const replacement = await artifact(originalPath, value);
    return swapEvidence(fixtureResult.report, originalPath, replacement);
  }

  const missingRun = await nativeFixture(artifact);
  await fs.writeFile(rawPath(missingRun, 'run'), '{"schemaVersion":1}');
  await artifact('verification/' + name, missingRun.report);
  await assert.rejects(verifyAcceptance(root, name, options, localAcceptanceRequirements),
    { code: 'EVIDENCE_DIGEST_MISMATCH' });

  const forgedRun = await nativeFixture(artifact);
  await artifact('verification/' + name, await forge(forgedRun, 'run', value => { value.accounts[1].voice.notified = false; }, 'forged-run'));
  await assert.rejects(verifyAcceptance(root, name, options, localAcceptanceRequirements),
    { code: 'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH' });

  const forgedDevice = await nativeFixture(artifact);
  await artifact('verification/' + name, await forge(forgedDevice, 'devices', value => { value.devices[1].physical = false; }, 'forged-devices'));
  await assert.rejects(verifyAcceptance(root, name, options, localAcceptanceRequirements),
    { code: 'LOCAL_NATIVE_DEVICE_EVIDENCE_MISMATCH' });

  const forgedLan = await nativeFixture(artifact);
  await artifact('verification/' + name, await forge(forgedLan, 'lan', value => { value.devices[1].network.allowed = false; }, 'forged-lan'));
  await assert.rejects(verifyAcceptance(root, name, options, localAcceptanceRequirements),
    { code: 'LOCAL_NATIVE_LAN_EVIDENCE_MISMATCH' });

  const mismatched = await nativeFixture(artifact);
  await artifact('verification/' + name, {
    ...mismatched.report,
    checks: mismatched.report.checks.map(check => check.id === 'completed-round'
      ? { ...check, details: { roundId: 'other-round', settledCount: 1 } }
      : check),
  });
  await assert.rejects(verifyAcceptance(root, name, options, localAcceptanceRequirements),
    { code: 'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH' });
}));

test('complete native acceptance fixture passes the strict gate', () => fixture(async (root, artifact) => {
  const name = 'local-native.json';
  const { report } = await nativeFixture(artifact);
  await artifact('verification/' + name, report);
  assert.equal((await verifyAcceptance(root, name, { sha256: 'current', apk: nativeApk }, localAcceptanceRequirements)).passed, true);
}));

test('complete-room evidence is an exact cell multiset at the current rule version', () => {
  const { matrix, games } = syntheticMatrixGames();
  const report = { games, matrixDigest: canonicalRoomMatrixDigest(matrix), subjectSha256: roomMatrixSubject,
    smokeOnly: false, acceptanceEligible: true };
  assert.doesNotThrow(() => verifyCompletedRooms(report, roomMatrixVariants, roomMatrixEngines));

  for (const missing of games) assert.throws(() => verifyCompletedRooms({
    ...report, games: games.filter(game => game !== missing),
  }, roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_EVIDENCE_MISSING' }, `missing ${missing.variantKey}`);

  const extra = { ...syntheticGame(matrix.cells[0]), variantKey: '99:0', playerCount: 2, configuredRounds: 4 };
  assert.throws(() => verifyCompletedRooms({ ...report, games: [...games, extra] }, roomMatrixVariants, roomMatrixEngines),
    { code: 'COMPLETE_ROOM_EVIDENCE_EXTRA' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: [...games, structuredClone(games[0])] },
    roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_EVIDENCE_DUPLICATE' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, ruleVersion: 'stale' } : game) }, roomMatrixVariants, roomMatrixEngines),
  { code: 'COMPLETE_ROOM_STALE_VERSION' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, normalizedOptions: { ...game.normalizedOptions, gameNum: 4 } } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_OPTION_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, roomState: 'between_rounds' } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, currentRound: game.configuredRounds - 1 } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, continuationVerified: false } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, memberIds: game.memberIds.slice(0, -1) } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, rounds: game.rounds.map((round, index) => index === 1
      ? { ...round, number: 3 } : round) } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_REPLAY_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, rounds: game.rounds.map((round, index) => index === 0
      ? { ...round, dealerId: 'outside-member' } : round) } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_REPLAY_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, rounds: game.rounds.map((round, index) => index === 0
      ? { ...round, continuation: { ...round.continuation, completedRound: 99 } } : round) } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_REPLAY_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, rounds: game.rounds.map((round, index) => index === 0
      ? { ...round, continuation: { ...round.continuation, nextDealerId: 'outside-member' } } : round) } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_REPLAY_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '8:0'
    ? { ...game, rounds: game.rounds.map((round, index) => index === 0
      ? { ...round, continuation: { ...round.continuation, dealerRun: 999 } } : round) } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_REPLAY_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, games: games.map(game => game.variantKey === '4:0'
    ? { ...game, normalizedOptions: { ...game.normalizedOptions, useCardType: 2 } } : game) },
  roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_OPTION_MISMATCH' });

  assert.throws(() => verifyCompletedRooms({ ...report, smokeOnly: true, acceptanceEligible: false },
    roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_SMOKE_ARTIFACT' });

  assert.throws(() => verifyCompletedRooms({ ...report, matrixDigest: canonicalDigest({ other: true }) },
    roomMatrixVariants, roomMatrixEngines), { code: 'COMPLETE_ROOM_PLAN_INVALID' });
});

test('the canonical matrix digest is a cell multiset, not a registry ordering', () => {
  const { matrix } = syntheticMatrixGames();
  const reordered = { ...matrix, cells: [...matrix.cells].reverse() };
  // The runner walks runtimeEngineEntries while the verifier walks the rules catalogue; those
  // orders differ, so an order-sensitive digest would reject otherwise identical evidence.
  assert.equal(canonicalRoomMatrixDigest(reordered), canonicalRoomMatrixDigest(matrix));
  const changed = { ...matrix, cells: matrix.cells.map((cell, index) => index === 0
    ? { ...cell, ruleVersion: 'stale' } : cell) };
  assert.notEqual(canonicalRoomMatrixDigest(changed), canonicalRoomMatrixDigest(matrix));
});

test('full matrix is default and subset filters are smoke-only with smoke-only paths', () => {
  const { matrix } = syntheticMatrixGames();
  assert.deepEqual(resolveRoomMatrixPlan(matrix), { smoke: false, smokeOnly: false, acceptanceEligible: true, cells: matrix.cells });
  assert.throws(() => resolveRoomMatrixPlan(matrix, { variants: ['4:0'] }), { code: 'ROOM_MATRIX_SUBSET_REQUIRES_SMOKE' });
  assert.throws(() => resolveRoomMatrixPlan(matrix, { players: [3] }), { code: 'ROOM_MATRIX_SUBSET_REQUIRES_SMOKE' });
  assert.throws(() => resolveRoomMatrixPlan(matrix, { rounds: [4] }), { code: 'ROOM_MATRIX_SUBSET_REQUIRES_SMOKE' });
  const smokePlan = resolveRoomMatrixPlan(matrix, { smoke: true, variants: ['4:0'] });
  assert.equal(smokePlan.smokeOnly, true);
  assert.equal(smokePlan.acceptanceEligible, false);
  // A smoke filter narrows only the variant list; the canonical grid keeps the full
  // 2/3/4 x 4/8/12 shape even in smoke mode.
  assert.deepEqual(smokePlan.cells.map(cell => cell.key), [
    '4:0:2:4', '4:0:2:8', '4:0:2:12',
    '4:0:3:4', '4:0:3:8', '4:0:3:12',
    '4:0:4:4', '4:0:4:8', '4:0:4:12',
  ]);
  assert.deepEqual(roomMatrixOutputPaths(true), {
    report: 'verification/local-completed-games-smoke.json', raw: 'verification/raw/local-completed-games-smoke.json' });
  assert.deepEqual(roomMatrixOutputPaths(false), {
    report: 'verification/local-completed-games.json', raw: 'verification/raw/local-completed-games.json' });
  assert.throws(() => resolveRoomMatrixPlan(matrix, { smoke: true, variants: ['nope'] }), { code: 'ROOM_MATRIX_PLAN_EMPTY' });
});

test('completed games evidence rejects forged replay, subject and smoke artifacts', () => fixture(async (root, artifact) => {
  const name = 'local-completed-games.json';
  const { matrix, games, summary } = syntheticMatrixGames();
  const matrixDigest = canonicalRoomMatrixDigest(matrix);
  const checks = localAcceptanceRequirements[name].map(id => ({ id, passed: true }));

  async function rejects(label, mutateGames, code, rawExtras = {}, reportExtras = {}, subject = roomMatrixSubject) {
    const forgedGames = structuredClone(games);
    mutateGames(forgedGames);
    const raw = await artifact('verification/raw/local-completed-games.json', {
      schemaVersion: 1, generatedAt: 'now', scope: 'real rooms', smokeOnly: false, acceptanceEligible: true,
      matrixDigest, subjectSha256: subject, games: forgedGames, summary, passed: true, ...rawExtras,
    });
    await artifact('verification/' + name, { schemaVersion: 1, passed: true, smokeOnly: false, acceptanceEligible: true,
      matrixDigest, subjectSha256: subject, checks, evidence: [raw], games: forgedGames, summary, ...reportExtras });
    await assert.rejects(verifyAcceptance(root, name, { sha256: subject }, localAcceptanceRequirements), { code }, label);
  }

  await rejects('short room', games => { games[0].completedRounds = 1; games[0].replayedRounds = 1; },
    'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH');

  await rejects('missing replay round', games => { games[0].replayedRoundIds.pop(); games[0].rounds.pop(); },
    'COMPLETE_ROOM_REPLAY_MISMATCH');

  await rejects('duplicate round id', games => { games[0].replayedRoundIds[1] = games[0].replayedRoundIds[0]; },
    'COMPLETE_ROOM_REPLAY_MISMATCH');

  await rejects('forged round digest', games => { games[0].rounds[0].digest = canonicalDigest({ forged: true }); },
    'COMPLETE_ROOM_REPLAY_MISMATCH');

  await rejects('forged round content', games => { games[0].rounds[0].replay.frames[0].gameSha256 = 'd'.repeat(64); },
    'COMPLETE_ROOM_REPLAY_MISMATCH');

  await rejects('forged replay summary', games => { games[0].replaySummary.digest = canonicalDigest({ forged: true }); },
    'COMPLETE_ROOM_REPLAY_MISMATCH');

  await rejects('missing replay summary', games => { delete games[0].replaySummary; },
    'COMPLETE_ROOM_REPLAY_MISMATCH');

  await rejects('subject mismatch', games => { games[0].subjectAfterSha256 = 'e'.repeat(64); },
    'COMPLETE_ROOM_SUBJECT_MISMATCH', {}, {}, 'e'.repeat(64));

  await rejects('hardcoded pass', games => { games[0].passed = false; },
    'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH');

  await rejects('smoke raw artifact', () => {}, 'COMPLETE_ROOM_SMOKE_ARTIFACT',
    { smokeOnly: true, acceptanceEligible: false });

  const smokePathRaw = await artifact('verification/raw/local-completed-games-smoke.json', {
    schemaVersion: 1, generatedAt: 'now', scope: 'real rooms', smokeOnly: true, acceptanceEligible: false,
    matrixDigest, subjectSha256: roomMatrixSubject, games, summary, passed: true,
  });
  await artifact('verification/' + name, { schemaVersion: 1, passed: true, smokeOnly: false, acceptanceEligible: true,
    matrixDigest, subjectSha256: roomMatrixSubject, checks, evidence: [smokePathRaw], games, summary });
  await assert.rejects(verifyAcceptance(root, name, { sha256: roomMatrixSubject }, localAcceptanceRequirements),
    { code: 'ACCEPTANCE_EVIDENCE_MISSING' }, 'smoke evidence path');

  await rejects('missing useCardType=1', games => { const target = games.find(game => game.variantKey === '4:0');
    target.normalizedOptions.useCardType = 2; target.optionsSha256 = canonicalDigest(target.normalizedOptions); },
  'COMPLETE_ROOM_OPTION_MISMATCH');

  await rejects('forged option coverage', games => { games[0].optionCoverage = [...games[0].optionCoverage, 'option:bogus=1']; },
    'COMPLETE_ROOM_OPTION_MISMATCH');

  const raw = await artifact('verification/raw/local-completed-games.json', {
    schemaVersion: 1, generatedAt: 'now', scope: 'real rooms', smokeOnly: false, acceptanceEligible: true,
    matrixDigest, subjectSha256: roomMatrixSubject, games, summary, passed: true,
  });
  await artifact('verification/' + name, { schemaVersion: 1, passed: true, smokeOnly: false, acceptanceEligible: true,
    matrixDigest, subjectSha256: roomMatrixSubject, checks, evidence: [raw], games, summary });
  assert.equal((await verifyAcceptance(root, name, { sha256: roomMatrixSubject }, localAcceptanceRequirements)).passed, true);
}));

test('checked-in regional evidence is bound to each registered engine and reports coverage gaps', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const runtime = await import(pathToFileURL(path.join(root, 'apps/server/dist/runtime-engines.js')).href);
  for (const [variantKey, directory] of [['6:0', '6-0'], ['8:0', '8-0'], ['4:0', '4-0'], ['5:0', '5-0'], ['7:0', '7-0'],
    ['9:0', '9-0'], ['10:0', '10-0'], ['11:0', '11-0'], ['12:0', '12-0'], ['14:0', '14-0'], ['15:0', '15-0'],
    ['16:0', '16-0'], ['19:0', '19-0'], ['20:0', '20-0'], ['21:0', '21-0'], ['22:0', '22-0'], ['23:0', '23-0'],
    ['24:0', '24-0'], ['25:0', '25-0'], ['26:0', '26-0'], ['27:0', '27-0']]) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, `docs/rules/release/${directory}/manifest.json`), 'utf8'));
    const registered = runtime.runtimeEngineEntries.find(entry => entry.engine.variantKey === variantKey);
    assert.ok(registered, `${variantKey} must be present in the production engine registry.`);
    assert.deepEqual(registered.rulebook, manifest.rulebook);
    assert.deepEqual(registered.cases, manifest.cases);
    assert.equal(registered.engine.evidence.referenceDigest, manifest.cases.sha256);
    try {
      const verified = await verifyRuntimeEngine(root, registered);
      assert.ok(verified.caseCount >= 2);
    } catch (error) {
      assert.ok(['REFERENCE_COVERAGE_MISSING', 'CONTRADICTORY_OPTION_COVERAGE'].includes(error.code), `${variantKey}: ${error.code}`);
    }
  }
});

test('all 21 retained configurations have a registered verified engine', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const runtime = await import(pathToFileURL(path.join(root, 'apps/server/dist/runtime-engines.js')).href);
  const variants = (await import(pathToFileURL(path.join(root, 'packages/rules/dist/index.js')).href)).RETAINED_VARIANT_KEYS;
  const registered = new Set(runtime.runtimeEngineEntries.map(entry => entry.engine.variantKey));
  assert.equal(variants.length, 21);
  for (const key of variants) assert.ok(registered.has(key), `missing verified runtime engine: ${key}`);
  assert.equal(runtime.runtimeEngineEntries.length, 21);
});
