import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedConcurrency,
  buildStabilityReport,
  collectVisibleDealObservations,
  createWebSocketProbeScheduler,
  dealSampleFromReady,
  exactDecimalEquals,
  isSmokeMode,
  isNonLoopbackAddress,
  isTerminalRoomState,
  normalizeExactDecimal,
  percentile95,
  policyNextRoundCheck,
  reconnectCheck,
  readyRoomWith,
  registerVisibleDealObservation,
  flushDealWatcher,
  stabilityChecks,
  stabilityOutputPaths,
  strictStateVersionCheck,
  stateVersionSequencePassed,
  visibleDealSample,
} from '../run-local-stability.mjs';

test('websocket probes continue on cadence through the drain window', async () => {
  let clock = 0;
  let probes = 0;
  const probeIfDue = createWebSocketProbeScheduler(async () => { probes++; }, 2000, () => clock);
  assert.equal(await probeIfDue(), true);
  clock = 1999;
  assert.equal(await probeIfDue(), false);
  clock = 2000;
  assert.equal(await probeIfDue(), true);
  clock = 6000;
  assert.equal(await probeIfDue(), true);
  assert.equal(probes, 3);
  assert.throws(() => createWebSocketProbeScheduler(null, 2000), TypeError);
  assert.throws(() => createWebSocketProbeScheduler(async () => {}, 0), /intervalMs/);
});

function actionSamples(count, durationMs = 10) {
  return Array.from({ length: count }, (_, index) => ({
    clientId: `client-${index}`,
    roomId: `room-${index}`,
    roundId: `round-${index}`,
    durationMs,
  }));
}

function passingMetrics(overrides = {}) {
  const actions = actionSamples(100, 10);
  const deals = actionSamples(20, 20).map(sample => ({ ...sample, durationMs: 20 }));
  const actionRequests = actions.map(sample => ({
    clientId: sample.clientId,
    roomId: sample.roomId,
    roundId: sample.roundId,
    legalActionsMs: 2,
    submitMs: 3,
    authorityStateMs: 4,
    totalMs: sample.durationMs,
  }));
  const websocketPings = Array.from({ length: 20 }, (_, index) => ({
    clientId: `client-${index}`,
    durationMs: 1,
    passed: true,
  }));
  const metrics = {
    actualSeconds: 7200,
    configuredSeconds: 7200,
    requiredSeconds: 7200,
    minimumDurationMet: true,
    completedRounds: 12,
    roomsTotal: 1,
    roomsFullyCompleted: 1,
    completedRoomRounds: 12,
    configuredRoomRounds: 12,
    dealPolicyCoverage: {
      optimizedCandidates32: 1,
      ordinaryCandidates1: 1,
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
    reconnectSamples: [{
      clientId: 'client-0',
      disconnectedAt: '2026-10-01T00:00:00.000Z',
      reconnectedAt: '2026-10-01T00:00:01.000Z',
      stateVersionBefore: 4,
      stateVersionAfter: 4,
      roundIdBefore: 'round-0',
      roundIdAfter: 'round-0',
      sameRound: true,
      stateVersionPreserved: true,
      timeOrdered: true,
      passed: true,
    }],
    clients: [{ clientId: 'client-0', reconnectCount: 1 }],
    settlementReconciliation: {
      errors: [],
      postingsBalanced: true,
      walletLedgerMatched: true,
      settledRounds: 12,
      settlementOperations: 12,
    },
    stateVersionChecks: [{
      roundId: 'round-0',
      afterRoundId: 'round-0',
      before: 1,
      submitted: 2,
      after: 2,
      roundEnded: false,
      passed: true,
    }],
    stateLosses: 0,
    websocketFailures: [],
    websocketPings,
    networkClients: 20,
    requiredNetworkClients: 20,
    actionSamples: actions,
    actionRequestSamples: actionRequests,
    actionP95Ms: percentile95(actions.map(sample => sample.durationMs)),
    dealSamples: deals,
    dealP95Ms: percentile95(deals.map(sample => sample.durationMs)),
    actionFailures: [],
    subjectBeforeSha256: 'subject',
    subjectAfterSha256: 'subject',
    apiBase: 'http://192.0.2.10:12345',
    apiHost: '192.0.2.10',
    apiAddresses: [{ address: '192.0.2.10', family: 4 }],
    nonLoopbackApi: true,
  };
  return { ...metrics, ...overrides };
}

function reportFor(metrics, overrides = {}) {
  const checks = stabilityChecks(metrics);
  const raw = {
    scenario: {},
    evidence: [],
    generatedAt: '2026-10-01T00:00:00.000Z',
    checks,
    metrics,
  };
  return buildStabilityReport({
    raw,
    subjectBeforeSha256: metrics.subjectBeforeSha256,
    subjectAfterSha256: metrics.subjectAfterSha256,
    smokeMode: false,
    ...overrides,
  });
}

test('deal latency is measured from the ready request, not the room-loop revisit', () => {
  const sample = dealSampleFromReady({ clientId: 'client-1', roomId: 'room-1',
    roundId: 'round-1', startedAt: 100, completedAt: 145 });
  assert.deepEqual(sample, { clientId: 'client-1', roomId: 'room-1', roundId: 'round-1', durationMs: 45 });
  assert.throws(() => dealSampleFromReady({ clientId: '', roomId: 'room-1',
    roundId: 'round-1', startedAt: 100, completedAt: 145 }), /visible deal sample/);
  assert.throws(() => dealSampleFromReady({ clientId: 'client-1', roomId: 'room-1',
    roundId: 'round-1', startedAt: 145, completedAt: 100 }), /visible deal sample/);
});

test('visible deal latency uses the first member GET that sees the target round', () => {
  const sample = visibleDealSample({
    roomId: 'room-1',
    roundId: 'round-2',
    startedAt: 100,
    observations: [
      { player: { clientId: 'slow' }, view: { state: 'playing', roundId: 'round-2' }, completedAt: 180 },
      { player: { clientId: 'first' }, view: { state: 'playing', roundId: 'round-2' }, completedAt: 145 },
      { player: { clientId: 'wrong-round' }, view: { state: 'playing', roundId: 'round-1' }, completedAt: 120 },
    ],
  });
  assert.deepEqual(sample, { clientId: 'first', roomId: 'room-1', roundId: 'round-2', durationMs: 45 });
  assert.deepEqual(Object.keys(sample).sort(), ['clientId', 'durationMs', 'roomId', 'roundId']);
});

test('visible deal sampling waits for playing and rejects invalid observations', () => {
  const waiting = visibleDealSample({ roomId: 'room-1', roundId: 'round-2', startedAt: 100,
    observations: [{ player: { clientId: 'client-1' }, view: { state: 'waiting', roundId: null }, completedAt: 120 }] });
  assert.equal(waiting, null);

  const wrongRound = visibleDealSample({ roomId: 'room-1', roundId: 'round-2', startedAt: 100,
    observations: [{ player: { clientId: 'client-1' }, view: { state: 'playing', roundId: 'round-3' }, completedAt: 120 }] });
  assert.equal(wrongRound, null);

  const beforeStart = visibleDealSample({ roomId: 'room-1', roundId: 'round-2', startedAt: 100,
    observations: [{ player: { clientId: 'client-1' }, view: { state: 'playing', roundId: 'round-2' }, completedAt: 99 }] });
  assert.equal(beforeStart, null);
});

test('the second ready request starts visible-deal observation without a room-loop revisit', async () => {
  const players = [
    { user: { id: 'user-1', username: 'first' } },
    { user: { id: 'user-2', username: 'second' } },
  ];
  const room = {
    id: 'room-1',
    players,
    pendingDeal: null,
  };
  const members = [{ userId: 'user-1', ready: true }, { userId: 'user-2', ready: false }];
  const views = {
    'user-1': { state: 'waiting', currentRound: 0, members },
    'user-2': { state: 'waiting', currentRound: 0, members },
  };
  const calls = [];
  let observedRoom = null;
  const request = async (player, path, options = {}) => {
    calls.push({ userId: player.user.id, path, method: options.method ?? 'GET' });
    if (path.endsWith('/ready')) {
      return { state: 'playing', roundId: 'round-1' };
    }
    return views[player.user.id];
  };
  const observeDeal = async value => { observedRoom = value; return 'observed'; };

  const result = await readyRoomWith(room, request, observeDeal);

  assert.equal(result, 'observed');
  assert.equal(observedRoom, room);
  assert.equal(room.pendingDeal.roundId, 'round-1');
  assert.equal(room.pendingDeal.roundNumber, 1);
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
    'GET /api/rooms/room-1',
    'GET /api/rooms/room-1',
    'POST /api/rooms/room-1/ready',
  ]);
});

test('visible deal sampling keeps successful observers when a peer request fails', async () => {
  const observations = await collectVisibleDealObservations(['ok', 'failed', 'late'], async player => {
    if (player === 'failed') throw new Error('temporary observer failure');
    return { player, completedAt: player === 'ok' ? 140 : 160 };
  });
  assert.deepEqual(observations, [
    { player: 'ok', completedAt: 140 },
    { player: 'late', completedAt: 160 },
  ]);
});

test('bounded concurrency runs every room without exceeding its limit', async () => {
  const seen = [];
  let active = 0;
  let maximum = 0;
  await boundedConcurrency(Array.from({ length: 11 }, (_, index) => index), 3, async item => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
    seen.push(item);
    active--;
  });
  assert.equal(active, 0);
  assert.equal(maximum, 3);
  assert.deepEqual([...seen].sort((left, right) => left - right), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('visible deal observation is registered independently and deduplicated', async () => {
  const room = { id: 'watch-room', players: [{ clientId: 'watch-client' }], pendingDealObservation: null };
  const pending = { roundId: 'watch-round', startedAt: performance.now() };
  let observations = 0;
  const observe = async () => {
    observations++;
    return { state: 'playing', roundId: 'watch-round' };
  };
  const registered = registerVisibleDealObservation({ room, pending, observe });
  assert.ok(registered);
  assert.equal(registerVisibleDealObservation({ room, pending, observe }), null);
  await flushDealWatcher();
  assert.equal(observations, 1);
  assert.equal(room.pendingDealObservation, null);
});

test('normalizes exact decimal strings without using Number', () => {
  assert.equal(normalizeExactDecimal('1'), '1000000000000');
  assert.equal(normalizeExactDecimal('1.000000000000'), '1000000000000');
  assert.equal(normalizeExactDecimal('+0.000000000001'), '1');
  assert.equal(normalizeExactDecimal('-1.2'), '-1200000000000');
  assert.equal(exactDecimalEquals('12345678901234567890.123456789012', '12345678901234567890.123456789012'), true);
  assert.equal(exactDecimalEquals('1.0', '1.00'), true);
  assert.equal(exactDecimalEquals('1.0', '1.000000000001'), false);
  assert.throws(() => normalizeExactDecimal('1.0000000000001'), /Invalid exact decimal/);
});

test('strict state versions require POST and GET to match in the same round', () => {
  assert.deepEqual(strictStateVersionCheck({ roundId: 'r1', before: 4, submitted: 5, after: 5, afterRoundId: 'r1' }), {
    roundId: 'r1', afterRoundId: 'r1', before: 4, submitted: 5, after: 5, roundEnded: false, passed: true,
  });
  assert.equal(strictStateVersionCheck({ roundId: 'r1', before: 4, submitted: 6, after: 6, afterRoundId: 'r1' }).passed, true);
  assert.equal(strictStateVersionCheck({ roundId: 'r1', before: 4, submitted: 4, after: 4, afterRoundId: 'r1' }).passed, false);
  assert.equal(strictStateVersionCheck({ roundId: 'r1', before: 4, submitted: 5, after: 6, afterRoundId: 'r1' }).passed, false);
  assert.equal(strictStateVersionCheck({ roundId: 'r1', before: 4, submitted: 5, after: 4, afterRoundId: 'r1' }).passed, false);
});

test('strict state versions allow a settled round cursor to clear', () => {
  assert.deepEqual(strictStateVersionCheck({ roundId: 'r1', before: 7, submitted: null, after: null, afterRoundId: null }), {
    roundId: 'r1', afterRoundId: null, before: 7, submitted: null, after: null, roundEnded: true, passed: true,
  });
  assert.equal(strictStateVersionCheck({ roundId: 'r1', before: 7, submitted: 8, after: null, afterRoundId: null }).passed, false);
});

test('room completion is driven by closed state, not the started-round counter', () => {
  assert.equal(isTerminalRoomState('closed'), true);
  assert.equal(isTerminalRoomState('playing'), false);
  assert.equal(isTerminalRoomState('between_rounds'), false);
});

test('policy shutdown evidence uses a null frozen version and a real audit version', () => {
  const auditEvent = {
    kind: 'policy_changed',
    requestKey: 'policy:admin:request-1',
    details: { after: { userId: 'user-1', enabled: false, probability: '0', version: 2 } },
  };
  const round = {
    number: 5,
    candidates: 1,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
    policySnapshotFrozen: true,
  };
  const proof = policyNextRoundCheck({ expectedNumber: 5, round, auditEvent,
    requestId: 'policy:admin:request-1', afterVersion: 2 });
  assert.equal(proof.frozenPolicyVersion, null);
  assert.equal(proof.passed, true);
  assert.equal(proof.auditPassed, true);
  assert.equal(policyNextRoundCheck({ expectedNumber: 6, round, auditEvent,
    requestId: 'policy:admin:request-1', afterVersion: 2 }).passed, false);
  assert.equal(policyNextRoundCheck({ expectedNumber: 5,
    round: { ...round, policy: { ...round.policy, version: 2 } }, auditEvent,
    requestId: 'policy:admin:request-1', afterVersion: 2 }).passed, false);
});

test('reconnect evidence requires the same round and identical state version', () => {
  const before = { roundId: 'round-1', stateVersion: 9 };
  const after = { roundId: 'round-1', stateVersion: 9 };
  assert.equal(reconnectCheck(before, after, '2026-10-01T00:00:00.000Z',
    '2026-10-01T00:00:01.000Z').passed, true);
  assert.equal(reconnectCheck(before, { ...after, stateVersion: 10 },
    '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:01.000Z').passed, false);
  assert.equal(reconnectCheck(before, { ...after, roundId: 'round-2' },
    '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:01.000Z').passed, false);
});

test('smoke output paths never overwrite acceptance evidence', () => {
  assert.deepEqual(stabilityOutputPaths(true).rawPath, 'verification/raw/local-stability.smoke.json');
  assert.deepEqual(stabilityOutputPaths(false).rawPath, 'verification/raw/local-stability.json');
});

test('non-loopback host validation rejects local and unspecified addresses', () => {
  assert.equal(isNonLoopbackAddress('127.0.0.1'), false);
  assert.equal(isNonLoopbackAddress('0.0.0.0'), false);
  assert.equal(isNonLoopbackAddress('::1'), false);
  assert.equal(isNonLoopbackAddress('192.0.2.10'), true);
});

test('smoke mode is forced for short runs and cannot be acceptance eligible', () => {
  assert.equal(isSmokeMode(7199, {}), true);
  assert.equal(isSmokeMode(7200, { DSS_STABILITY_SMOKE: '1' }), true);
  assert.equal(isSmokeMode(7200, {}), false);
  const metrics = passingMetrics();
  const report = reportFor(metrics, { smokeMode: true });
  assert.equal(report.mode, 'smoke');
  assert.equal(report.passed, false);
  assert.equal(report.acceptanceEligible, false);

  const shortRun = reportFor(passingMetrics({ actualSeconds: 2, configuredSeconds: 2 }));
  assert.equal(shortRun.mode, 'smoke');
  assert.equal(shortRun.passed, false);
});

test('acceptance passes only when duration, checks, and subject all pass', () => {
  const metrics = passingMetrics();
  const report = reportFor(metrics);
  assert.equal(report.mode, 'acceptance');
  assert.equal(report.passed, true);
  assert.equal(report.acceptanceEligible, true);
  assert.deepEqual(report.checks, stabilityChecks(metrics));

  const changedSubject = reportFor(passingMetrics({ subjectAfterSha256: 'changed' }));
  assert.equal(changedSubject.passed, false);
  assert.equal(changedSubject.checks.find(check => check.id === 'subject-stable').passed, false);
});

test('checks are derived from raw metrics rather than hard-coded', () => {
  const metrics = passingMetrics({
    actionSamples: actionSamples(99, 10),
    dealP95Ms: 2001,
    completedRoomRounds: 11,
    websocketFailures: [{ clientId: 'client-0', message: 'offline' }],
    actionFailures: [{ roomId: 'room-1', message: 'STATE_VERSION_CONFLICT' }],
  });
  const checks = stabilityChecks(metrics);
  assert.equal(checks.find(check => check.id === 'action-latency').passed, false);
  assert.equal(checks.find(check => check.id === 'deal-latency').passed, false);
  assert.equal(checks.find(check => check.id === 'complete-rooms').passed, false);
  assert.equal(checks.find(check => check.id === 'websocket-online').passed, false);
  assert.equal(checks.find(check => check.id === 'no-action-errors').passed, false);
  assert.ok(checks.every(check => typeof check.id === 'string' && typeof check.passed === 'boolean' && check.details));
});

test('reports ignore forged raw checks and derive them from metrics', () => {
  const metrics = passingMetrics({ actualSeconds: 2, configuredSeconds: 2 });
  const raw = {
    scenario: {},
    evidence: [],
    generatedAt: '2026-10-01T00:00:00.000Z',
    passed: true,
    mode: 'acceptance',
    checks: stabilityChecks(passingMetrics()),
    metrics,
  };
  const report = buildStabilityReport({
    raw,
    subjectBeforeSha256: metrics.subjectBeforeSha256,
    subjectAfterSha256: metrics.subjectAfterSha256,
    smokeMode: false,
  });
  assert.equal(report.mode, 'smoke');
  assert.equal(report.passed, false);
  assert.equal(report.checks.find(check => check.id === 'minimum-duration').passed, false);
});

test('same-round state versions must be strictly increasing and stop after the round ends', () => {
  const increasing = [
    { roundId: 'r1', before: 1, submitted: 2, after: 2, roundEnded: false, passed: true },
    { roundId: 'r1', before: 2, submitted: 4, after: 4, roundEnded: false, passed: true },
  ];
  assert.equal(stateVersionSequencePassed(increasing), true);
  assert.equal(stateVersionSequencePassed([
    { roundId: 'r1', before: 2, submitted: 3, after: 3, roundEnded: false, passed: true },
    { roundId: 'r1', before: 2, submitted: 3, after: 3, roundEnded: false, passed: true },
  ]), false);
  assert.equal(stateVersionSequencePassed([
    { roundId: 'r1', before: 2, submitted: null, after: null, roundEnded: true, passed: true },
    { roundId: 'r1', before: 3, submitted: 4, after: 4, roundEnded: false, passed: true },
  ]), false);
});

test('latency checks recompute from raw samples and reject inconsistent summaries', () => {
  const metrics = passingMetrics({ actionP95Ms: 1 });
  assert.equal(stabilityChecks(metrics).find(check => check.id === 'action-latency').passed, false);

  const missingPhaseSamples = passingMetrics({ actionRequestSamples: [] });
  assert.equal(stabilityChecks(missingPhaseSamples).find(check => check.id === 'action-latency').passed, false);

  const slowPhase = passingMetrics();
  for (const sample of slowPhase.actionRequestSamples.slice(-6)) sample.legalActionsMs = 301;
  assert.equal(stabilityChecks(slowPhase).find(check => check.id === 'action-latency').passed, false);
});

test('websocket evidence must cover every required client with successful pings', () => {
  const missingPing = passingMetrics({ websocketPings: [] });
  assert.equal(stabilityChecks(missingPing).find(check => check.id === 'websocket-online').passed, false);

  const failedPing = passingMetrics();
  failedPing.websocketPings[0] = { clientId: 'client-0', durationMs: 1, passed: false };
  assert.equal(stabilityChecks(failedPing).find(check => check.id === 'websocket-online').passed, false);

  const incompleteCoverage = passingMetrics({ networkClients: 21, requiredNetworkClients: 21 });
  assert.equal(stabilityChecks(incompleteCoverage).find(check => check.id === 'websocket-online').passed, false);
});

test('all configured room rounds are required', () => {
  const metrics = passingMetrics({ completedRoomRounds: 11, roomsFullyCompleted: 0 });
  assert.equal(stabilityChecks(metrics).find(check => check.id === 'complete-rooms').passed, false);
});
