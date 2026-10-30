import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { releaseSubject } from './build-fingerprint.mjs';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const WebSocket = require('ws');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const playerCount = positiveInteger(process.env.DSS_STABILITY_PLAYERS, 20);
const runSeconds = positiveInteger(process.env.DSS_STABILITY_SECONDS, 7200);
const roomCount = Math.max(1, Math.floor(playerCount / 2));
const password = 'stability-password-only';
const baseBeans = '0.001';
const variantKey = '6:0';
const roundsPerRoom = 12;
const actionLatencyLimitMs = 300;
const dealLatencyLimitMs = 2000;
const minimumActionSamples = 100;
const minimumDealSamples = 20;
const minimumNetworkClients = 20;
const websocketProbeIntervalMs = 2000;
const maximumDrainMs = 15 * 60 * 1000;
// PGlite serializes work in-process. A small drive window keeps individual
// requests fast while the independent deal watcher absorbs the waiting time.
const roomConcurrency = positiveInteger(process.env.DSS_STABILITY_CONCURRENCY, 5);
const dealWatchConcurrency = positiveInteger(process.env.DSS_STABILITY_WATCH_CONCURRENCY, 4);
const activeDriveDelayMs = positiveInteger(process.env.DSS_STABILITY_ACTIVE_DRIVE_MS, 1);
const waitingDriveDelayMs = positiveInteger(process.env.DSS_STABILITY_WAITING_DRIVE_MS, 25);
const schedulerSleepMs = Math.min(5, activeDriveDelayMs);
const runTag = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const commandPrefix = `stability-${runTag}`;
const actionSamples = [];
const dealSamples = [];
const actionRequestSamples = [];
const reconnectSamples = [];
const stateVersionChecks = [];
const actionFailures = [];
const websocketFailures = [];
const websocketPings = [];
const clientByUserId = new Map();
const roomBatches = [];
let beansAdmin;
let dealAdmin;
let temporaryDirectory;
let db;
let app;
let policies;
let watcherCursor = 0;
let watcherPumpActive = false;
let driveMaxInFlight = 0;
let driveTotal = 0;
const pendingDeals = new Set();
let dealWatcherPromise = null;
let getDefaultOptions;
let createApp;
let migrate;
let openDatabase;
let createRuntimeEngineRegistry;

export function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${value}`);
  return parsed;
}

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

export function boundedConcurrency(items, limit, worker) {
  if (!Array.isArray(items)) throw new TypeError('boundedConcurrency expects an array of items.');
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('boundedConcurrency expects a positive integer limit.');
  if (typeof worker !== 'function') throw new TypeError('boundedConcurrency expects a worker function.');
  if (items.length === 0) return Promise.resolve();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  return Promise.all(workers).then(() => undefined);
}

export function percentile95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

export function stateVersionSequencePassed(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return false;
  const byRound = new Map();
  for (const check of checks) {
    if (!check || typeof check.roundId !== 'string' || !check.roundId || check.passed !== true) return false;
    const entries = byRound.get(check.roundId) ?? [];
    entries.push(check);
    byRound.set(check.roundId, entries);
  }
  for (const entries of byRound.values()) {
    let previousBefore = -1;
    let ended = false;
    for (const check of entries) {
      if (ended || !Number.isInteger(check.before) || check.before <= previousBefore) return false;
      previousBefore = check.before;
      if (check.roundEnded === true) ended = true;
    }
  }
  return true;
}

export function isTerminalRoomState(state) {
  return state === 'closed';
}

export function policyNextRoundCheck({ expectedNumber, round, auditEvent, requestId, afterVersion }) {
  const policy = round?.policy ?? null;
  const numberPassed = Number.isInteger(round?.number) && round.number === expectedNumber;
  const candidatesPassed = round?.candidates === 1;
  const frozenVersion = policy?.version ?? null;
  const frozenVersionPassed = frozenVersion === null;
  const snapshotPassed = round?.policySnapshotFrozen === true;
  const auditDetails = auditEvent?.details ?? null;
  const auditPassed = auditEvent?.kind === 'policy_changed' && auditEvent?.requestKey === requestId &&
    Number.isInteger(afterVersion) && auditDetails?.after?.version === afterVersion &&
    auditDetails.after.enabled === false && String(auditDetails.after.probability) === '0';
  return {
    expectedNumber,
    actualNumber: round?.number ?? null,
    candidates: round?.candidates ?? null,
    frozenPolicyVersion: frozenVersion,
    numberPassed,
    candidatesPassed,
    frozenVersionPassed,
    snapshotPassed,
    auditPassed,
    passed: numberPassed && candidatesPassed && frozenVersionPassed && snapshotPassed && auditPassed,
  };
}

/** Normalize an exact decimal string to a signed 12-digit fixed-point value. */
export function normalizeExactDecimal(value) {
  if (typeof value !== 'string') throw new TypeError(`Expected a decimal string, received ${typeof value}`);
  const match = /^([+-]?)(\d+)(?:\.(\d{1,12}))?$/.exec(value);
  if (!match) throw new Error(`Invalid exact decimal: ${value}`);
  const digits = (BigInt(match[2]) * 1_000_000_000_000n + BigInt((match[3] ?? '').padEnd(12, '0'))).toString();
  if (digits === '0') return '0';
  return `${match[1] === '-' ? '-' : ''}${digits}`;
}

export function exactDecimalEquals(left, right) {
  return normalizeExactDecimal(left) === normalizeExactDecimal(right);
}

export function strictStateVersionCheck({ roundId, before, submitted, after, afterRoundId }) {
  const roundEnded = afterRoundId !== roundId;
  const sameRound = !roundEnded;
  const versionPassed = sameRound
    ? Number.isInteger(before) && Number.isInteger(submitted) && submitted > before &&
      Number.isInteger(after) && after === submitted
    : submitted === null && after === null;
  return {
    roundId,
    afterRoundId,
    before,
    submitted,
    after,
    roundEnded,
    passed: versionPassed,
  };
}

export function isSmokeMode(configuredSeconds = runSeconds, env = process.env) {
  return env.DSS_STABILITY_SMOKE === '1' || configuredSeconds < 7200;
}

/**
 * The two-hour deadline can pass while rooms are still draining, so both the
 * gameplay loop and the drain loop must keep probing every WebSocket.
 */
export function createWebSocketProbeScheduler(probe, intervalMs, now = () => performance.now()) {
  if (typeof probe !== 'function') throw new TypeError('probe must be a function');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('intervalMs must be positive');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  let lastProbeAt = now() - intervalMs;
  return async function probeIfDue() {
    const current = now();
    if (current - lastProbeAt < intervalMs) return false;
    lastProbeAt = current;
    await probe();
    return true;
  };
}

export function stabilityOutputPaths(smokeMode) {
  const suffix = smokeMode ? '.smoke' : '';
  const rawPath = `verification/raw/local-stability${suffix}.json`;
  return { rawPath, rawOutput: join(root, rawPath),
    reportOutput: join(root, `verification/local-stability${suffix}.json`) };
}

export function reconnectCheck(before, after, disconnectedAt, reconnectedAt) {
  const sameRound = typeof before.roundId === 'string' && before.roundId.length > 0 &&
    before.roundId === after.roundId;
  const stateVersionPreserved = Number.isInteger(before.stateVersion) && before.stateVersion >= 0 &&
    after.stateVersion === before.stateVersion;
  const timeOrdered = Number.isFinite(Date.parse(disconnectedAt)) &&
    Number.isFinite(Date.parse(reconnectedAt)) && Date.parse(reconnectedAt) > Date.parse(disconnectedAt);
  return { sameRound, stateVersionPreserved, timeOrdered, passed: sameRound && stateVersionPreserved && timeOrdered };
}

// Deal latency is measured from the ready request until any member first reads the target round as
// playing. The ready response itself and the runner's serial room-loop revisit are not the finish line.
export function dealSampleFromReady({ clientId, roomId, roundId, startedAt, completedAt }) {
  const durationMs = completedAt - startedAt;
  if (typeof clientId !== 'string' || !clientId || typeof roomId !== 'string' || !roomId ||
      typeof roundId !== 'string' || !roundId || !finiteNonNegative(durationMs)) {
    throw new Error('A visible deal sample requires a client, room, round and non-negative duration.');
  }
  return { clientId, roomId, roundId, durationMs };
}

export function visibleDealSample({ roomId, roundId, startedAt, observations }) {
  if (!Array.isArray(observations)) return null;
  const visible = observations
    .filter(item => item?.view?.state === 'playing' && item.view.roundId === roundId &&
      item?.player?.clientId && finiteNonNegative(item.completedAt) &&
      item.completedAt >= startedAt)
    .sort((left, right) => left.completedAt - right.completedAt)[0];
  if (!visible) return null;
  return dealSampleFromReady({ clientId: visible.player.clientId, roomId, roundId,
    startedAt, completedAt: visible.completedAt });
}

export async function collectVisibleDealObservations(players, observe) {
  const settled = await Promise.allSettled(players.map(observe));
  return settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
}

export function buildStabilityReport({ raw, subjectBeforeSha256, subjectAfterSha256, smokeMode }) {
  const metrics = raw.metrics;
  const checks = stabilityChecks(metrics);
  const checksPassed = Array.isArray(checks) && checks.length > 0 && checks.every(check => check.passed === true);
  const configuredSeconds = metrics.configuredSeconds;
  const requiredSeconds = metrics.requiredSeconds;
  const durationPassed = Number.isFinite(metrics.actualSeconds) &&
    Number.isFinite(configuredSeconds) && configuredSeconds >= 7200 &&
    Number.isFinite(requiredSeconds) && requiredSeconds >= 7200 &&
    metrics.actualSeconds >= configuredSeconds && metrics.actualSeconds >= requiredSeconds;
  const subjectStable = typeof subjectBeforeSha256 === 'string' && subjectBeforeSha256.length > 0 &&
    subjectBeforeSha256 === subjectAfterSha256 &&
    metrics.subjectBeforeSha256 === subjectBeforeSha256 && metrics.subjectAfterSha256 === subjectAfterSha256;
  const effectiveSmokeMode = smokeMode === true || !durationPassed;
  const passed = !effectiveSmokeMode && durationPassed && checksPassed && subjectStable;
  return {
    schemaVersion: 1,
    passed,
    mode: effectiveSmokeMode ? 'smoke' : 'acceptance',
    acceptanceEligible: passed,
    subjectSha256: subjectAfterSha256,
    subjectBeforeSha256,
    subjectAfterSha256,
    checks,
    metrics,
    scenario: raw.scenario,
    evidence: raw.evidence,
    generatedAt: raw.generatedAt,
  };
}

export function stabilityChecks(metrics) {
  const configuredSeconds = metrics.configuredSeconds;
  const requiredSeconds = metrics.requiredSeconds;
  const durationPassed = Number.isFinite(metrics.actualSeconds) &&
    Number.isFinite(configuredSeconds) && configuredSeconds >= 7200 &&
    Number.isFinite(requiredSeconds) && requiredSeconds >= 7200 &&
    metrics.actualSeconds >= configuredSeconds && metrics.actualSeconds >= requiredSeconds;

  const actionSampleDurations = Array.isArray(metrics.actionSamples)
    ? metrics.actionSamples.map(sample => sample?.durationMs) : [];
  const actionSamplesValid = actionSampleDurations.length >= minimumActionSamples &&
    actionSampleDurations.every(finiteNonNegative);
  const actionP95Ms = actionSamplesValid ? percentile95(actionSampleDurations) : Infinity;
  const actionRequestSamples = Array.isArray(metrics.actionRequestSamples) ? metrics.actionRequestSamples : [];
  const actionRequestsValid = actionRequestSamples.length === actionSampleDurations.length &&
    actionRequestSamples.length >= minimumActionSamples &&
    actionRequestSamples.every((sample, index) => sample &&
      finiteNonNegative(sample.legalActionsMs) &&
      finiteNonNegative(sample.submitMs) &&
      finiteNonNegative(sample.authorityStateMs) &&
      finiteNonNegative(sample.totalMs) && sample.totalMs === actionSampleDurations[index]);
  const actionPhaseP95Ms = actionRequestsValid ? {
    legalActionsMs: percentile95(actionRequestSamples.map(sample => sample.legalActionsMs)),
    submitMs: percentile95(actionRequestSamples.map(sample => sample.submitMs)),
    authorityStateMs: percentile95(actionRequestSamples.map(sample => sample.authorityStateMs)),
    totalMs: percentile95(actionRequestSamples.map(sample => sample.totalMs)),
  } : null;
  const actionLatencyPassed = actionSamplesValid && actionRequestsValid &&
    metrics.actionP95Ms === actionP95Ms && actionP95Ms <= actionLatencyLimitMs &&
    actionPhaseP95Ms !== null &&
    actionPhaseP95Ms.legalActionsMs <= actionLatencyLimitMs &&
    actionPhaseP95Ms.submitMs <= actionLatencyLimitMs &&
    actionPhaseP95Ms.authorityStateMs <= actionLatencyLimitMs;

  const dealSampleDurations = Array.isArray(metrics.dealSamples)
    ? metrics.dealSamples.map(sample => sample?.durationMs) : [];
  const dealSamplesValid = dealSampleDurations.length >= minimumDealSamples &&
    dealSampleDurations.every(finiteNonNegative);
  const dealP95Ms = dealSamplesValid ? percentile95(dealSampleDurations) : Infinity;
  const dealLatencyPassed = dealSamplesValid && metrics.dealP95Ms === dealP95Ms &&
    dealP95Ms <= dealLatencyLimitMs;

  const stateVersionChecks = Array.isArray(metrics.stateVersionChecks) ? metrics.stateVersionChecks : [];
  const stateVersionSequence = stateVersionSequencePassed(stateVersionChecks);
  const stateVersionPassed = stateVersionChecks.length > 0 &&
    stateVersionChecks.every(check => check?.passed === true && Number.isInteger(check.before) && check.before >= 0 &&
      (check.roundEnded === true
        ? check.submitted === null && check.after === null
        : Number.isInteger(check.submitted) && check.submitted === check.before + 1 && check.after === check.submitted)) &&
    metrics.stateLosses === 0 && stateVersionSequence;

  const settlement = metrics.settlementReconciliation;
  const accountingPassed = settlement !== null && typeof settlement === 'object' &&
    Array.isArray(settlement.errors) && settlement.errors.length === 0 &&
    settlement.postingsBalanced === true && settlement.walletLedgerMatched === true &&
    settlement.settledRounds === settlement.settlementOperations && settlement.settledRounds > 0 &&
    (settlement.walletLedgerMismatches === undefined || settlement.walletLedgerMismatches === 0) &&
    settlement.settledRounds === metrics.completedRounds;

  const reconnectSamples = Array.isArray(metrics.reconnectSamples) ? metrics.reconnectSamples : [];
  const clients = Array.isArray(metrics.clients) ? metrics.clients : [];
  const positiveReconnects = clients.filter(client => Number.isInteger(client?.reconnectCount) && client.reconnectCount > 0);
  const reconnectionPassed = reconnectSamples.length > 0 && positiveReconnects.length > 0 &&
    reconnectSamples.every(sample => sample?.passed === true && sample.sameRound === true &&
      sample.stateVersionPreserved === true && sample.timeOrdered === true &&
      reconnectCheck({ roundId: sample.roundIdBefore, stateVersion: sample.stateVersionBefore },
        { roundId: sample.roundIdAfter, stateVersion: sample.stateVersionAfter },
        sample.disconnectedAt, sample.reconnectedAt).passed);

  const actionFailures = Array.isArray(metrics.actionFailures) ? metrics.actionFailures : [];
  const actionFailuresPassed = actionFailures.length === 0;

  const websocketFailures = Array.isArray(metrics.websocketFailures) ? metrics.websocketFailures : [];
  const websocketPings = Array.isArray(metrics.websocketPings) ? metrics.websocketPings : [];
  const requiredNetworkClients = Math.max(minimumNetworkClients,
    Number.isInteger(metrics.requiredNetworkClients) ? metrics.requiredNetworkClients : 0);
  const pingedClients = new Set(websocketPings
    .filter(ping => ping?.passed === true && typeof ping.clientId === 'string' && ping.clientId)
    .map(ping => ping.clientId));
  const websocketPassed = Number.isInteger(metrics.networkClients) &&
    metrics.networkClients >= minimumNetworkClients &&
    metrics.networkClients === requiredNetworkClients &&
    websocketPings.length >= requiredNetworkClients &&
    pingedClients.size === requiredNetworkClients &&
    websocketPings.every(ping => ping && ping.passed === true &&
      typeof ping.clientId === 'string' && ping.clientId && finiteNonNegative(ping.durationMs)) &&
    websocketFailures.length === 0;

  const dealPolicyCoverage = metrics.dealPolicyCoverage ?? {};
  const policyProof = metrics.policyVersionEvidence ?? {};
  const completedRounds = metrics.completedRounds;
  const roomsTotal = metrics.roomsTotal;
  const roomsFullyCompleted = metrics.roomsFullyCompleted;
  const completedRoomRounds = metrics.completedRoomRounds;
  const configuredRoomRounds = metrics.configuredRoomRounds;
  const subjectStable = typeof metrics.subjectBeforeSha256 === 'string' &&
    metrics.subjectBeforeSha256.length > 0 && metrics.subjectBeforeSha256 === metrics.subjectAfterSha256;
  // Older release-audit fixtures predate explicit host and configured-player evidence.
  // Live runs always emit these fields; do not weaken their checks when they are present.
  const configuredPlayers = metrics.playerCount ?? metrics.requiredNetworkClients ?? metrics.networkClients;
  const actualPlayers = metrics.actualPlayers ?? metrics.networkClients;
  const clientCountPassed = Number.isInteger(actualPlayers) && actualPlayers >= minimumNetworkClients &&
    Number.isInteger(metrics.networkClients) && metrics.networkClients >= minimumNetworkClients &&
    actualPlayers === configuredPlayers && metrics.networkClients === configuredPlayers &&
    (metrics.requiredNetworkClients === undefined || metrics.requiredNetworkClients === configuredPlayers);
  const hasResolvedHost = metrics.apiHost !== undefined || metrics.apiAddresses !== undefined ||
    metrics.nonLoopbackApi !== undefined;
  let legacyNonLoopback = true;
  if (!hasResolvedHost && metrics.apiBase !== undefined) {
    try { legacyNonLoopback = isNonLoopbackAddress(new URL(metrics.apiBase).hostname.replace(/^\[|\]$/g, '')); }
    catch { legacyNonLoopback = false; }
  }
  const nonLoopbackPassed = hasResolvedHost
    ? metrics.nonLoopbackApi === true && typeof metrics.apiHost === 'string' && metrics.apiHost.length > 0 &&
      Array.isArray(metrics.apiAddresses) && metrics.apiAddresses.length > 0 &&
      metrics.apiAddresses.every(entry => isNonLoopbackAddress(typeof entry === 'string' ? entry : entry?.address))
    : legacyNonLoopback;

  return [
    { id: 'client-count', passed: clientCountPassed, details: { actualPlayers, configuredPlayers,
      networkClients: metrics.networkClients, requiredNetworkClients: metrics.requiredNetworkClients } },
    { id: 'non-loopback-api', passed: nonLoopbackPassed, details: { apiHost: metrics.apiHost ?? null,
      apiAddresses: metrics.apiAddresses ?? [], nonLoopbackApi: metrics.nonLoopbackApi ?? legacyNonLoopback } },
    { id: 'minimum-duration', passed: durationPassed, details: {
      actualSeconds: metrics.actualSeconds, configuredSeconds, requiredSeconds } },
    { id: 'actual-gameplay', passed: Number.isInteger(completedRounds) && completedRounds > 0 &&
      actionSampleDurations.length > 0 && dealSampleDurations.length > 0, details: {
      completedRounds, actionSamples: actionSampleDurations.length, dealSamples: dealSampleDurations.length } },
    { id: 'complete-rooms', passed: Number.isInteger(roomsTotal) && roomsTotal > 0 &&
      Number.isInteger(configuredRoomRounds) && configuredRoomRounds > 0 &&
      roomsFullyCompleted === roomsTotal && completedRoomRounds === configuredRoomRounds, details: {
      roomsFullyCompleted, roomsTotal, completedRoomRounds, configuredRoomRounds } },
    { id: 'candidate-deal-32', passed: Number.isInteger(dealPolicyCoverage.optimizedCandidates32) &&
      dealPolicyCoverage.optimizedCandidates32 > 0,
      details: { optimizedCandidates32: dealPolicyCoverage.optimizedCandidates32 } },
    { id: 'candidate-deal-1', passed: Number.isInteger(dealPolicyCoverage.ordinaryCandidates1) &&
      dealPolicyCoverage.ordinaryCandidates1 > 0,
      details: { ordinaryCandidates1: dealPolicyCoverage.ordinaryCandidates1 } },
    { id: 'deal-policy-frozen', passed: dealPolicyCoverage.policyFrozen === true,
      details: { policyFrozen: dealPolicyCoverage.policyFrozen,
        frozenPolicyVersion: dealPolicyCoverage.frozenPolicyVersion ?? null } },
    { id: 'deal-policy-next-round', passed: dealPolicyCoverage.policyChangeAppliedNextRound === true,
      details: { policyChangeAppliedNextRound: dealPolicyCoverage.policyChangeAppliedNextRound,
        nextRound: policyProof.nextRound ?? null } },
    { id: 'deal-policy-audit', passed: policyProof.auditPassed === true,
      details: { updateVersion: policyProof.updateVersion ?? null,
        auditVersion: policyProof.auditVersion ?? null,
        requestKey: policyProof.requestKey ?? null } },
    { id: 'reconnection', passed: reconnectionPassed, details: { reconnectSamples: reconnectSamples.length,
      positiveReconnects: positiveReconnects.length } },
    { id: 'no-action-errors', passed: actionFailuresPassed,
      details: { actionFailures: actionFailures.length } },
    { id: 'no-ledger-errors', passed: accountingPassed, details: settlement },
    { id: 'no-state-loss', passed: stateVersionPassed, details: {
      stateVersionChecks: stateVersionChecks.length, stateLosses: metrics.stateLosses,
      strictlyIncreasing: stateVersionSequence } },
    { id: 'strict-state-version', passed: stateVersionPassed, details: {
      stateVersionChecks: stateVersionChecks.length,
      passedChecks: stateVersionChecks.filter(check => check?.passed === true).length,
      stateLosses: metrics.stateLosses, strictlyIncreasing: stateVersionSequence } },
    { id: 'state-version-monotonic', passed: stateVersionSequence, details: {
      rounds: new Set(stateVersionChecks.map(check => check?.roundId).filter(Boolean)).size,
      stateVersionChecks: stateVersionChecks.length } },
    { id: 'accounting-exact', passed: accountingPassed, details: settlement },
    { id: 'websocket-online', passed: websocketPassed, details: {
      networkClients: metrics.networkClients, requiredNetworkClients,
      pings: websocketPings.length, pingedClients: pingedClients.size,
      websocketFailures: websocketFailures.length } },
    { id: 'action-latency', passed: actionLatencyPassed, details: { p95Ms: actionP95Ms,
      rawP95Ms: metrics.actionP95Ms, thresholdMs: actionLatencyLimitMs,
      samples: actionSampleDurations.length, minimumSamples: minimumActionSamples,
      phaseSamples: actionRequestSamples.length, phaseP95Ms: actionPhaseP95Ms } },
    { id: 'deal-latency', passed: dealLatencyPassed, details: { p95Ms: dealP95Ms,
      rawP95Ms: metrics.dealP95Ms, thresholdMs: dealLatencyLimitMs,
      samples: dealSampleDurations.length, minimumSamples: minimumDealSamples } },
    { id: 'subject-stable', passed: subjectStable, details: {
      subjectBeforeSha256: metrics.subjectBeforeSha256, subjectAfterSha256: metrics.subjectAfterSha256 } },
  ];
}

export function isNonLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const family = isIP(address);
  if (family === 4) return address !== '0.0.0.0' && !address.startsWith('127.');
  if (family !== 6) return false;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  if (normalized === '::' || normalized === '::1') return false;
  // URL canonicalization turns dotted IPv4-mapped literals into two hex groups.
  const embedded = /^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (embedded) {
    const upper = parseInt(embedded[1], 16), lower = parseInt(embedded[2], 16);
    if ((upper >>> 8) === 127 || (upper === 0 && lower === 0)) return false;
  }
  return true;
}

export async function resolveNonLoopbackHost(host, lookupAddresses = lookup) {
  const apiHost = host.trim().replace(/^\[|\]$/g, '');
  const apiAddresses = await lookupAddresses(apiHost, { all: true });
  if (!apiAddresses.length || apiAddresses.some(entry => !isNonLoopbackAddress(entry.address))) {
    throw new Error(`DSS_STABILITY_API_HOST must resolve exclusively to non-loopback, non-unspecified addresses: ${apiHost}`);
  }
  return { apiHost, apiAddresses, nonLoopbackApi: true };
}

async function nonLoopbackHost() {
  const configured = process.env.DSS_STABILITY_API_HOST?.trim();
  if (configured) return resolveNonLoopbackHost(configured);
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('127.') || address.address === '0.0.0.0') continue;
      return resolveNonLoopbackHost(address.address);
    }
  }
  throw new Error('No non-loopback IPv4 address is available for DSS_STABILITY_API_HOST.');
}

function jsonBody(value) {
  return JSON.stringify(value);
}

async function api(client, path, { method = 'GET', body, expectedStatus = 200 } = {}) {
  const response = await fetch(client.baseUrl + path, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${client.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : jsonBody(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (response.status !== expectedStatus) {
    throw new Error(`HTTP ${method} ${path} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return payload;
}

async function login(baseUrl, username, administrator = false) {
  const response = await fetch(baseUrl + (administrator ? '/api/admin/login' : '/api/auth/login'), {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json' },
    body: jsonBody({ username, password }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Login failed for ${username}: ${response.status} ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  return { token: payload.token, user: payload.user };
}

function actionFromView(view) {
  const legal = Array.isArray(view.legalActions) ? view.legalActions : [];
  if (!legal.length) return null;
  return legal.find(candidate => candidate?.type === 'respond') ??
    legal.find(candidate => candidate?.type === 'hu') ??
    legal.find(candidate => candidate?.type === 'discard') ?? legal[0];
}

function selectActor(entries) {
  return entries.find(entry => entry.view.responseWindow !== null && actionFromView(entry.view)) ??
    entries.find(entry => actionFromView(entry.view));
}

function terminalRoomState(view) {
  // currentRound counts started rounds, not settled rounds. The last round must still be driven.
  return view.state === 'closed';
}

async function createRoomBatch(batchIndex, players, policyTarget = null) {
  const batch = { rooms: [], clients: [], closed: false, batchIndex };
  const roomsInBatch = Math.floor(players.length / 2);
  for (let roomIndex = 0; roomIndex < roomsInBatch; roomIndex++) {
    const roomPlayers = [players[roomIndex * 2], players[roomIndex * 2 + 1]];
    const owner = clientByUserId.get(roomPlayers[0].id);
    const guest = clientByUserId.get(roomPlayers[1].id);
    const target = typeof policyTarget === 'function' ? policyTarget(roomPlayers, roomIndex) : policyTarget;
    let enabledPolicy = null;
    if (target) {
      enabledPolicy = await policies.update(dealAdmin, target.id, true, '100', 'Stability optimized deal',
        `stability-policy-${runTag}-${batchIndex}-${roomIndex}-on`);
    }
    const options = { ...getDefaultOptions(variantKey), playerNum: 2, gameNum: roundsPerRoom };
    const created = await api(owner, '/api/rooms', {
      method: 'POST',
      body: { variantKey, options, baseBeans },
    });
    const joined = await api(guest, '/api/rooms/join', { method: 'POST', body: { code: created.code } });
    const room = {
      id: created.id,
      code: created.code,
      players: [owner, guest],
      policyTarget: target,
      policyEnabledVersion: enabledPolicy?.version ?? null,
      configuredRounds: options.gameNum,
      initialVersion: joined.stateVersion,
      closed: false,
      pendingDeal: null,
      completedRounds: 0,
      previousRoundId: null,
      policyChangeApplied: false,
      policyChangeAt: null,
      policyChangeFromVersion: null,
      policyChangeVersion: null,
      policyChangeRequestId: null,
      policyChangeRound: null,
    };
    batch.rooms.push(room);
  }
  roomBatches.push(batch);
  return batch;
}

async function readyRoom(room) {
  return readyRoomWith(room, api, recordVisibleDeal);
}

// Kept dependency-injected so the ready -> deal -> visibility scheduling can be
// tested without a live server.
export async function readyRoomWith(room, request, observeDeal) {
  for (const player of room.players) {
    const before = await request(player, `/api/rooms/${room.id}`);
    if (before.state === 'playing') continue;
    if (terminalRoomState(before)) continue;
    if (before.members.find(member => member.userId === player.user.id)?.ready) continue;
    const roundNumber = before.currentRound + 1;
    const started = performance.now();
    const result = await request(player, `/api/rooms/${room.id}/ready`, { method: 'POST', body: { ready: true } });
    if (result.state === 'playing') {
      room.pendingDeal = {
        startedAt: started,
        roundId: result.roundId,
        roundNumber,
      };
      // Observation is registered with a shared watcher. It must not be tied to
      // the room driver, or serial room loops become part of the deal latency.
      return observeDeal(room);
    }
  }
  return null;
}

export function registerVisibleDealObservation({ room, pending, observe = api }) {
  if (!room || typeof room.id !== 'string' || !room.id || !pending || typeof pending.roundId !== 'string' ||
      !pending.roundId || !finiteNonNegative(pending.startedAt) || !Array.isArray(room.players) ||
      room.players.length === 0 || room.pendingDealObservation) return null;
  const observation = {
    room,
    roomId: room.id,
    roundId: pending.roundId,
    startedAt: pending.startedAt,
    players: room.players,
    nextPlayerIndex: watcherCursor++,
    attempts: 0,
    intervalMs: 10,
    nextAttemptAt: performance.now(),
    observe,
  };
  room.pendingDealObservation = observation;
  pendingDeals.add(observation);
  startDealWatcher();
  return observation;
}

function startDealWatcher() {
  if (dealWatcherPromise) return dealWatcherPromise;
  watcherPumpActive = true;
  dealWatcherPromise = (async () => {
    try {
      while (pendingDeals.size > 0) {
        const now = performance.now();
        const due = [...pendingDeals].filter(deal => deal.nextAttemptAt <= now);
        if (due.length > 0) {
          await boundedConcurrency(due, dealWatchConcurrency, async deal => {
            if (!pendingDeals.has(deal)) return;
            deal.attempts++;
            const player = deal.players[deal.nextPlayerIndex++ % deal.players.length];
            let completedAt = performance.now();
            try {
              const view = await deal.observe(player, `/api/rooms/${deal.roomId}`);
              completedAt = performance.now();
              if (view?.state === 'playing' && view.roundId === deal.roundId && completedAt >= deal.startedAt) {
                dealSamples.push(dealSampleFromReady({ clientId: player.clientId, roomId: deal.roomId,
                  roundId: deal.roundId, startedAt: deal.startedAt, completedAt }));
                clearDealObservation(deal);
                return;
              }
            } catch {
              completedAt = performance.now();
            }
            if (completedAt - deal.startedAt >= dealLatencyLimitMs) {
              clearDealObservation(deal);
              actionFailures.push({ roomId: deal.roomId,
                message: `DEAL_VISIBILITY_TIMEOUT ${deal.roundId} attempts=${deal.attempts}` });
              return;
            }
            deal.intervalMs = Math.min(100, Math.ceil(deal.intervalMs * 1.5));
            deal.nextAttemptAt = performance.now() + deal.intervalMs;
          });
        }
        await sleep(5);
      }
    } finally {
      watcherPumpActive = false;
      dealWatcherPromise = null;
    }
  })();
  return dealWatcherPromise;
}

export async function flushDealWatcher() {
  while (pendingDeals.size > 0) {
    if (!dealWatcherPromise) startDealWatcher();
    await dealWatcherPromise;
  }
}

function recordVisibleDeal(room) {
  if (!room.pendingDeal) return;
  const pending = room.pendingDeal;
  room.pendingDeal = null;
  const observation = registerVisibleDealObservation({ room, pending });
  if (observation) room.pendingDealObservation = observation;
  return observation;
}

function clearDealObservation(deal) {
  pendingDeals.delete(deal);
  const room = deal.room;
  if (room?.pendingDealObservation === deal) room.pendingDealObservation = null;
}

export async function driveRoomsWith(rooms, limit, worker, onError) {
  let inFlight = 0;
  await boundedConcurrency(rooms, limit, async room => {
    inFlight++;
    driveTotal++;
    driveMaxInFlight = Math.max(driveMaxInFlight, inFlight);
    try {
      await worker(room);
    } catch (error) {
      if (typeof onError === 'function') onError(error, room);
      else throw error;
    } finally {
      inFlight--;
    }
  });
}

async function driveRoom(room) {
  const entries = await Promise.all(room.players.map(async player => ({ player, view: await api(player, `/api/rooms/${room.id}`) })));
  const reference = entries[0].view;
  if (terminalRoomState(reference)) {
    room.closed = true;
    return;
  }
  if (reference.state === 'between_rounds' || reference.state === 'waiting') {
    if (reference.state === 'between_rounds' && room.policyTarget && reference.currentRound >= 1 && !room.policyChangeApplied) {
      const requestId = `stability-policy-${room.id}-off`;
      const changed = await policies.update(dealAdmin, room.policyTarget.id, false, '0', 'Stability policy change',
        requestId, room.policyEnabledVersion);
      room.policyChangeAt = new Date().toISOString();
      room.policyChangeFromVersion = room.policyEnabledVersion;
      room.policyChangeVersion = changed.version;
      room.policyChangeRequestId = requestId;
      room.policyChangeRound = reference.currentRound;
      room.policyChangeApplied = true;
    }
    await readyRoom(room);
    return;
  }
  const selected = selectActor(entries);
  if (!selected) return;
  const started = performance.now();
  try {
    const legalStarted = performance.now();
    const legalView = await api(selected.player, `/api/rooms/${room.id}`);
    const legalDurationMs = performance.now() - legalStarted;
    const currentAction = actionFromView(legalView);
    if (!currentAction || legalView.state !== 'playing' || legalView.roundId !== selected.view.roundId) return;
    const body = {
      commandId: `${commandPrefix}-${room.id}-${legalView.stateVersion}-${Math.random().toString(36).slice(2, 10)}`,
      action: currentAction,
      expectedStateVersion: legalView.stateVersion,
      expectedRoundId: legalView.roundId,
    };
    if (legalView.responseWindow) body.decisionId = legalView.responseWindow.id;
    const submitStarted = performance.now();
    const result = await api(selected.player, `/api/rooms/${room.id}/actions`, { method: 'POST', body });
    const submitDurationMs = performance.now() - submitStarted;
    const authorityStarted = performance.now();
    const after = await api(selected.player, `/api/rooms/${room.id}`);
    let check;
    if (after.roundId !== legalView.roundId) {
      // Both POST and GET clear the round cursor on settlement. Read the immutable
      // action event committed in the same transaction instead of inventing a cursor.
      const committed = await db.query(`SELECT e.payload->>'roundId' AS "roundId",
        e.payload->>'stateVersion' AS "stateVersion",
        e.payload->>'expectedStateVersion' AS "expectedStateVersion",
        e.payload->>'commandHash' AS "commandHash", r.state AS "roundState"
        FROM game_events e JOIN rounds r ON r.id::text=e.payload->>'roundId'
        WHERE e.room_id=$1 AND e.command_id=$2 AND e.actor_id=$3`,
      [room.id, body.commandId, selected.player.user.id]);
      const event = committed.rows[0];
      const submitted = Number(event?.stateVersion);
      if (!event || event.roundId !== legalView.roundId ||
        !/^\d+$/.test(event.stateVersion ?? '') || !/^\d+$/.test(event.expectedStateVersion ?? '') ||
        Number(event.expectedStateVersion) !== legalView.stateVersion ||
        submitted !== legalView.stateVersion + 1 || !/^[0-9a-f]{64}$/.test(event.commandHash ?? '') ||
        event.roundState !== 'settled' || after.roundId !== null || after.stateVersion !== null ||
        !['between_rounds', 'closed'].includes(after.state)) {
        throw new Error(`STATE_VERSION_SETTLEMENT_EVIDENCE_INVALID ${legalView.roundId}`);
      }
      check = { ...strictStateVersionCheck({ roundId: legalView.roundId, before: legalView.stateVersion,
        submitted, after: submitted, afterRoundId: event.roundId }),
      settlementObserved: true, settledRoundId: event.roundId, authoritySource: 'game_event',
      commandId: body.commandId, commandHash: event.commandHash, roundState: event.roundState };
    } else {
      check = strictStateVersionCheck({ roundId: legalView.roundId, before: legalView.stateVersion,
        submitted: result.stateVersion, after: after.stateVersion, afterRoundId: after.roundId });
      check.passed = check.passed && result.roundId === legalView.roundId &&
        result.stateVersion === legalView.stateVersion + 1;
    }
    const authorityDurationMs = performance.now() - authorityStarted;
    const durationMs = performance.now() - started;
    actionSamples.push({
      clientId: selected.player.clientId,
      roomId: room.id,
      roundId: selected.view.roundId,
      durationMs,
    });
    actionRequestSamples.push({
      clientId: selected.player.clientId,
      roomId: room.id,
      roundId: selected.view.roundId,
      legalActionsMs: legalDurationMs,
      submitMs: submitDurationMs,
      authorityStateMs: authorityDurationMs,
      totalMs: durationMs,
    });
    stateVersionChecks.push(check);
    if (!check.passed) throw new Error(`STATE_VERSION_CHECK_FAILED ${legalView.roundId}`);
    if (after.roundId !== legalView.roundId && result.currentRound !== room.completedRounds) {
      room.completedRounds = result.currentRound ?? room.completedRounds;
    }
    if (result.roundId && result.roundId !== room.previousRoundId) {
      room.previousRoundId = result.roundId;
    }
  } catch (error) {
    actionFailures.push({ roomId: room.id, message: error instanceof Error ? error.message : String(error) });
  }
}

async function performReconnect(client, room) {
  const before = await api(client, `/api/rooms/${room.id}`);
  if (before.state !== 'playing' || !before.roundId || !Number.isInteger(before.stateVersion)) return false;
  const disconnectedAt = new Date().toISOString();
  await client.close();
  await sleep(250);
  await client.connect();
  const after = await api(client, `/api/rooms/${room.id}`);
  const reconnectedAt = new Date().toISOString();
  const check = reconnectCheck(before, after, disconnectedAt, reconnectedAt);
  reconnectSamples.push({
    clientId: client.clientId,
    disconnectedAt,
    reconnectedAt,
    stateVersionBefore: before.stateVersion,
    stateVersionAfter: after.stateVersion,
    roundIdBefore: before.roundId,
    roundIdAfter: after.roundId,
    ...check,
  });
  return check.passed;
}

async function probeWebSockets() {
  const results = await Promise.all([...clientByUserId.values()].map(async client => {
    const started = performance.now();
    try {
      await client.ping();
      if (!client.socket || client.socket.readyState !== WebSocket.OPEN) {
        throw new Error(`WebSocket is not open for ${client.clientId}`);
      }
      const durationMs = performance.now() - started;
      websocketPings.push({ clientId: client.clientId, durationMs, passed: true });
      return true;
    } catch (error) {
      const durationMs = performance.now() - started;
      websocketPings.push({ clientId: client.clientId, durationMs, passed: false,
        message: error instanceof Error ? error.message : String(error) });
      websocketFailures.push({ clientId: client.clientId, message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }));
  return results.every(Boolean);
}

async function assertAllClientsOnline() {
  const offline = [...clientByUserId.values()].filter(client => !client.socket || client.socket.readyState !== WebSocket.OPEN);
  if (offline.length) throw new Error(`WebSocket clients offline: ${offline.map(client => client.clientId).join(', ')}`);
  await probeWebSockets();
}

async function reconcile() {
  const settled = await db.query("SELECT count(*)::int AS count FROM rounds WHERE state='settled'");
  const operations = await db.query("SELECT count(*)::int AS count FROM ledger_operations WHERE kind='round_settlement'");
  const unbalanced = await db.query(`SELECT e.operation_id FROM ledger_entries e
    JOIN ledger_operations o ON o.id=e.operation_id
    WHERE o.kind='round_settlement'
    GROUP BY e.operation_id HAVING SUM(e.amount)<>0`);
  const wallets = await db.query(`SELECT w.user_id AS "userId",w.balance::text AS balance,COALESCE(SUM(e.amount),0)::text AS ledger
    FROM wallets w LEFT JOIN ledger_entries e ON e.user_id=w.user_id GROUP BY w.user_id,w.balance`);
  const walletLedgerMatched = wallets.rows.every(row => exactDecimalEquals(row.balance, row.ledger));
  const settlementOperations = operations.rows[0].count;
  const settledRounds = settled.rows[0].count;
  const errors = [];
  if (settledRounds !== settlementOperations) errors.push('settled round and settlement operation counts differ');
  if (!walletLedgerMatched) errors.push('wallet and ledger balances differ');
  return { settledRounds, settlementOperations, postingsBalanced: unbalanced.rows.length === 0, walletLedgerMatched,
    walletLedgerMismatches: wallets.rows.filter(row => !exactDecimalEquals(row.balance, row.ledger)).length, errors };
}

async function dealCoverage(room) {
  const rows = await db.query(`SELECT id,number,started_at,
    (initial_snapshot->'deal'->>'candidates')::int AS candidates,
    initial_snapshot->'deal'->'policy' AS policy,
    (policy_snapshot IS NOT DISTINCT FROM initial_snapshot->'deal'->'policy') AS policy_frozen
    FROM rounds WHERE room_id=$1 ORDER BY number`, [room.id]);
  const candidateValues = rows.rows.map(row => row.candidates);
  const changedRound = room.policyChangeApplied
    ? rows.rows.find(row => row.number === room.policyChangeRound + 1)
    : null;
  let policyChangeAuditVerified = false;
  let policyChangeAudit = null;
  const requestKey = room.policyChangeRequestId ? `policy:${dealAdmin.id}:${room.policyChangeRequestId}` : null;
  if (requestKey && room.policyTarget) {
    const audit = await db.query(`SELECT user_id AS "userId",request_key AS "requestKey",details
      FROM audit_events WHERE kind='policy_changed' AND actor_id=$1 AND user_id=$2 AND request_key=$3`,
    [dealAdmin.id, room.policyTarget.id, requestKey]);
    policyChangeAudit = audit.rows[0] ?? null;
    const updated = policyChangeAudit?.details?.after;
    policyChangeAuditVerified = audit.rows.length === 1 &&
      policyChangeAudit.userId === room.policyTarget.id && policyChangeAudit.requestKey === requestKey &&
      updated?.userId === room.policyTarget.id && updated.version === room.policyChangeVersion &&
      Number.isInteger(updated.version) && updated.version === room.policyChangeFromVersion + 1 &&
      updated.enabled === false && updated.probability === '0';
  }
  const nextRoundVerified = Boolean(changedRound && changedRound.number === room.policyChangeRound + 1 &&
    changedRound.candidates === 1 && changedRound.policy?.version === null && changedRound.policy_frozen === true);
  return {
    roomId: room.id,
    optimized: Boolean(room.policyTarget),
    policyTargetId: room.policyTarget?.id ?? null,
    candidates32: candidateValues.filter(value => value === 32).length,
    candidates1: candidateValues.filter(value => value === 1).length,
    policyFrozen: rows.rows.length > 0 && rows.rows.every(row => row.policy_frozen === true),
    policyChangeFromVersion: room.policyChangeFromVersion,
    policyChangeVersion: room.policyChangeVersion,
    policyChangeRound: room.policyChangeRound,
    policyChangeRequestId: room.policyChangeRequestId,
    policyChangeAuditVerified,
    policyChangeAudit,
    nextRound: changedRound ?? null,
    frozenPolicyVersion: changedRound ? changedRound.policy?.version ?? null : null,
    nextRoundVerified,
    policyChangeAppliedNextRound: policyChangeAuditVerified && nextRoundVerified,
    rounds: rows.rows,
  };
}

async function roomCompletionSummary() {
  const rooms = roomBatches.flatMap(batch => batch.rooms);
  if (!rooms.length) return { roomsTotal: 0, roomsFullyCompleted: 0, completedRoomRounds: 0, configuredRoomRounds: 0 };
  const placeholders = rooms.map((_, index) => `$${index + 1}`).join(',');
  const result = await db.query(`SELECT room_id AS "roomId", count(*) FILTER (WHERE state='settled')::int AS settled
    FROM rounds WHERE room_id IN (${placeholders}) GROUP BY room_id`, rooms.map(room => room.id));
  const settledByRoom = new Map(result.rows.map(row => [row.roomId, row.settled]));
  let roomsFullyCompleted = 0;
  let completedRoomRounds = 0;
  let configuredRoomRounds = 0;
  for (const room of rooms) {
    const settled = settledByRoom.get(room.id) ?? 0;
    if (settled === room.configuredRounds) roomsFullyCompleted++;
    completedRoomRounds += settled;
    configuredRoomRounds += room.configuredRounds;
  }
  return { roomsTotal: rooms.length, roomsFullyCompleted, completedRoomRounds,
    configuredRoomRounds };
}

function makeClient(user, baseUrl) {
  const client = {
    user,
    clientId: `client-${user.username}`,
    token: null,
    baseUrl,
    socket: null,
    reconnectCount: 0,
    connectPromise: null,
    authenticatedPromise: null,
    pongPromise: null,
    async connect() {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
      this.socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/api/live`);
      this.authenticatedPromise = new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => rejectPromise(new Error(`WebSocket authentication timed out for ${this.clientId}`)), 10000);
        const onMessage = raw => {
          const message = JSON.parse(raw.toString());
          if (message.type === 'authenticated') {
            clearTimeout(timer);
            this.socket.off('message', onMessage);
            resolvePromise(message);
          }
        };
        this.socket.on('message', onMessage);
        this.socket.on('error', error => { clearTimeout(timer); rejectPromise(error); });
      });
      await new Promise((resolvePromise, rejectPromise) => {
        this.socket.once('open', resolvePromise);
        this.socket.once('error', rejectPromise);
      });
      this.socket.send(JSON.stringify({ type: 'authenticate', token: this.token }));
      await this.authenticatedPromise;
    },
    async ping() {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      this.pongPromise = new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => rejectPromise(new Error(`WebSocket pong timed out for ${this.clientId}`)), 5000);
        const onMessage = raw => {
          const message = JSON.parse(raw.toString());
          if (message.type === 'pong') {
            clearTimeout(timer);
            this.socket.off('message', onMessage);
            resolvePromise();
          }
        };
        this.socket.on('message', onMessage);
      });
      this.socket.send(JSON.stringify({ type: 'ping' }));
      await this.pongPromise;
    },
    async close() {
      if (!this.socket) return;
      const socket = this.socket;
      this.socket = null;
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise(resolvePromise => {
        socket.once('close', resolvePromise);
        socket.close(1000, 'Stability reconnect');
        setTimeout(resolvePromise, 1000);
      });
    },
  };
  return client;
}

async function main() {
  ({ getDefaultOptions } = await import('../packages/rules/src/index.ts'));
  ({ createApp } = await import('../apps/server/src/app.ts'));
  ({ migrate, openDatabase } = await import('../apps/server/src/database.ts'));
  ({ createRuntimeEngineRegistry } = await import('../apps/server/src/runtime-engines.ts'));
  temporaryDirectory = join(os.tmpdir(), `dss-stability-${process.pid}-${Date.now()}`);
  db = await openDatabase(undefined, join(temporaryDirectory, 'db'));
  await migrate(db);
  const services = await createApp(db, {
    engines: createRuntimeEngineRegistry(),
    staticFiles: false,
    rateLimit: false,
    scheduler: { intervalMs: 50 },
  });
  app = services.app;
  const { auth, ledger } = services;
  policies = services.policies;
  await app.listen({ host: '0.0.0.0', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('The isolated server did not expose a TCP address.');
  const servicePort = address.port;
  const resolvedHost = await nonLoopbackHost();
  const apiBase = `http://${resolvedHost.apiHost}:${servicePort}`;
  const { rawPath, rawOutput, reportOutput } = stabilityOutputPaths(isSmokeMode(runSeconds));

  beansAdmin = await auth.create(`beans_${runTag}`, password, 'beans_admin');
  dealAdmin = await auth.create(`deal_${runTag}`, password, 'deal_admin');
  const players = [];
  for (let index = 0; index < playerCount; index++) {
    players.push(await auth.create(`p_${runTag}_${index}`, password));
  }
  for (const player of players) await ledger.adjust(beansAdmin, player.id, '100000', 'Isolated stability credit', `stability-credit-${player.id}`);
  for (const player of players) {
    const client = makeClient(player, apiBase);
    const session = await login(apiBase, player.username);
    client.token = session.token;
    clientByUserId.set(player.id, client);
    await client.connect();
  }
  const smokeMode = isSmokeMode(runSeconds);
  const subjectBefore = await releaseSubject(root);
  const monotonicStartedAt = performance.now();
  const wallStartedAt = new Date().toISOString();
  const deadline = monotonicStartedAt + runSeconds * 1000;
  const probeWebSocketsIfDue = createWebSocketProbeScheduler(probeWebSockets, websocketProbeIntervalMs);

  const halfPlayers = Math.max(2, Math.floor(playerCount / 2));
  const ordinaryPlayers = players.slice(0, halfPlayers);
  const optimizedPlayers = players.slice(halfPlayers, halfPlayers * 2);
  if (optimizedPlayers.length < 2) throw new Error('Stability run requires at least four players for ordinary and optimized rooms.');
  let nextBatchIndex = 0;
  const ordinaryBatch = await createRoomBatch(nextBatchIndex++, ordinaryPlayers);
  const optimizedBatch = await createRoomBatch(nextBatchIndex++, optimizedPlayers, (roomPlayers) => roomPlayers[0]);

  const recordDriveFailure = (error, room) => {
    actionFailures.push({ roomId: room.id, message: error instanceof Error ? error.message : String(error) });
  };
  const driveAllOpenRooms = async () => {
    const rooms = roomBatches.flatMap(batch => batch.rooms).filter(room => !room.closed);
    await driveRoomsWith(rooms, roomConcurrency, driveRoom, recordDriveFailure);
    return rooms.length;
  };
  let reconnectPerformed = false;
  while (performance.now() < deadline) {
    await probeWebSocketsIfDue();
    const openRooms = await driveAllOpenRooms();
    if (!reconnectPerformed && actionSamples.length > 0) {
      const room = optimizedBatch.rooms[0];
      const client = room.players[0];
      if (await performReconnect(client, room)) client.reconnectCount++;
      reconnectPerformed = true;
    }
    const activeRooms = roomBatches.flatMap(batch => batch.rooms).filter(room => !room.closed);
    if (!activeRooms.length && performance.now() < deadline) {
      await createRoomBatch(nextBatchIndex++, ordinaryPlayers);
      await createRoomBatch(nextBatchIndex++, optimizedPlayers, (roomPlayers) => roomPlayers[0]);
    }
    await sleep(openRooms > 0 ? activeDriveDelayMs : waitingDriveDelayMs);
  }
  const drainDeadline = performance.now() + maximumDrainMs;
  while (roomBatches.flatMap(batch => batch.rooms).some(room => !room.closed) && performance.now() < drainDeadline) {
    await probeWebSocketsIfDue();
    const openRooms = await driveAllOpenRooms();
    await sleep(openRooms > 0 ? activeDriveDelayMs : waitingDriveDelayMs);
  }
  await flushDealWatcher();
  const monotonicEndedAt = performance.now();
  const wallEndedAt = new Date().toISOString();
  const actualSeconds = (monotonicEndedAt - monotonicStartedAt) / 1000;
  await assertAllClientsOnline();
  const completedRounds = (await db.query("SELECT count(*)::int AS count FROM rounds WHERE state='settled'")).rows[0].count;
  const optimizedDeals = (await db.query(`SELECT count(*)::int AS count FROM rounds
    WHERE (initial_snapshot->'deal'->>'candidates')::int=32`)).rows[0].count;
  const settlementReconciliation = await reconcile();
  const optimizedCoverage = await dealCoverage(optimizedBatch.rooms[0]);
  const ordinaryCoverage = await dealCoverage(ordinaryBatch.rooms[0]);
  const policyChangeEvidence = {
    passed: optimizedCoverage.policyChangeAppliedNextRound === true,
    auditPassed: optimizedCoverage.policyChangeAuditVerified === true,
    nextRound: optimizedCoverage.nextRound ?? null,
    updateVersion: optimizedCoverage.policyChangeVersion ?? null,
    auditVersion: optimizedCoverage.policyChangeAudit?.details?.after?.version ?? null,
    requestKey: optimizedCoverage.policyChangeAudit?.requestKey ?? null,
  };
  const coverage = {
    optimizedCandidates32: optimizedCoverage.candidates32,
    ordinaryCandidates1: ordinaryCoverage.candidates1,
    policyFrozen: optimizedCoverage.policyFrozen && ordinaryCoverage.policyFrozen,
    policyChangeAppliedNextRound: optimizedCoverage.policyChangeAppliedNextRound === true && policyChangeEvidence.passed,
    frozenPolicyVersion: optimizedCoverage.frozenPolicyVersion,
    policyVersionEvidence: policyChangeEvidence,
  };
  const reconnects = [...clientByUserId.values()].map(client => ({ clientId: client.clientId, reconnectCount: client.reconnectCount }));
  const completion = await roomCompletionSummary();
  const subjectAfter = await releaseSubject(root);
  const stateLosses = actionFailures.filter(failure => /STATE_VERSION|ROUND_VERSION|DECISION|ACTION_DEADLINE|DEAL_VISIBILITY/.test(failure.message)).length;
  const metrics = {
    actualPlayers: players.length,
    durationSeconds: actualSeconds,
    actualSeconds,
    requiredSeconds: 7200,
    configuredSeconds: runSeconds,
    minimumDurationMet: actualSeconds >= 7200,
    mode: smokeMode ? 'smoke' : 'acceptance',
    completedRounds,
    optimizedDeals,
    networkClients: clientByUserId.size,
    requiredNetworkClients: playerCount,
    protocols: ['http', 'websocket'],
    apiBase,
    apiHost: resolvedHost.apiHost,
    apiAddresses: resolvedHost.apiAddresses,
    nonLoopbackApi: resolvedHost.nonLoopbackApi,
    servicePort,
    clients: reconnects,
    reconnectCounts: reconnects,
    reconnectSamples,
    settlementReconciliation,
    stateVersionChecks,
    stateLosses,
    roomsTotal: completion.roomsTotal,
    roomsFullyCompleted: completion.roomsFullyCompleted,
    completedRoomRounds: completion.completedRoomRounds,
    configuredRoomRounds: completion.configuredRoomRounds,
    dealPolicyCoverage: {
      optimizedCandidates32: coverage.optimizedCandidates32,
      ordinaryCandidates1: coverage.ordinaryCandidates1,
      policyFrozen: coverage.policyFrozen,
      policyChangeAppliedNextRound: coverage.policyChangeAppliedNextRound,
      frozenPolicyVersion: coverage.frozenPolicyVersion,
    },
    policyVersionEvidence: coverage.policyVersionEvidence,
    subjectBeforeSha256: subjectBefore.sha256,
    subjectAfterSha256: subjectAfter.sha256,
    subjectStable: subjectBefore.sha256 === subjectAfter.sha256,
    actionSamples,
    actionRequestSamples,
    dealSamples,
    actionP95Ms: percentile95(actionSamples.map(sample => sample.durationMs)),
    dealP95Ms: percentile95(dealSamples.map(sample => sample.durationMs)),
    actionFailures,
    websocketFailures,
    websocketPings,
    websocketOnline: websocketFailures.length === 0,
    startedAt: wallStartedAt,
    endedAt: wallEndedAt,
  };
  metrics.checks = stabilityChecks(metrics);
  const scenario = { variantKey, roomCount, playerCount, roundsPerRoom, baseBeans, durationSeconds: actualSeconds,
    requiredDurationSeconds: 7200, configuredDurationSeconds: runSeconds, configuredRounds: roundsPerRoom, smoke: smokeMode };
  const generatedAt = new Date().toISOString();
  const raw = {
    schemaVersion: 1,
    generatedAt,
    checks: metrics.checks,
    scenario,
    metrics,
    roomBatches: roomBatches.map(batch => ({ batchIndex: batch.batchIndex, rooms: batch.rooms.map(room => room.id) })),
    subjectSha256: subjectBefore.sha256,
    subjectBeforeSha256: subjectBefore.sha256,
    subjectAfterSha256: subjectAfter.sha256,
    subjectStable: subjectBefore.sha256 === subjectAfter.sha256,
  };
  const preliminaryReport = buildStabilityReport({ raw, subjectBeforeSha256: subjectBefore.sha256,
    subjectAfterSha256: subjectAfter.sha256, smokeMode });
  raw.mode = preliminaryReport.mode;
  raw.passed = preliminaryReport.passed;
  await mkdir(dirname(rawOutput), { recursive: true });
  await writeFile(rawOutput, JSON.stringify(raw, null, 2) + '\n');
  const rawBytes = await readFile(rawOutput);
  raw.evidence = [{ path: rawPath, sha256: createHash('sha256').update(rawBytes).digest('hex') }];
  const report = buildStabilityReport({ raw, subjectBeforeSha256: subjectBefore.sha256,
    subjectAfterSha256: subjectAfter.sha256, smokeMode });
  await writeFile(reportOutput, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: reportOutput, passed: report.passed, servicePort, completedRounds,
    actionSamples: actionSamples.length,
    dealSamples: dealSamples.length, actionP95Ms: metrics.actionP95Ms, dealP95Ms: metrics.dealP95Ms,
    actualSeconds, mode: report.mode }));
  if (report.mode !== 'smoke' && !report.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } finally {
    for (const client of clientByUserId.values()) await client.close().catch(() => undefined);
    if (app) await app.close().catch(() => undefined);
    if (db) await db.close().catch(() => undefined);
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
