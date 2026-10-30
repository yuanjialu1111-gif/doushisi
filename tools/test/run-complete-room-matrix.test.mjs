import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { RETAINED_VARIANT_KEYS } from '../../packages/rules/src/index.ts';
import { runtimeEngineEntries } from '../../apps/server/src/runtime-engines.ts';
import { assertFormalPlanIsCanonical, assertMatrixCoversVariants, assertOutputPathsMatchMode,
  assertReplayRebuildStable, assertRetainedRuntimeEngines, assertSettlementCoverage,
  acquireMatrixLock, assertFreshBuild, buildRetainedMatrixVariants, deriveAcceptanceChecks, expectedMatrixCellKeys,
  matrixRootPath, releaseMatrixLock, resolveMatrixRootDirectory,
  REQUIRED_PLAYER_COUNTS, REQUIRED_ROUND_COUNTS } from '../run-complete-room-matrix.mjs';
import { buildCanonicalRoomMatrix, canonicalDigest, canonicalRoomMatrixDigest, completedGameReplayDigest,
  resolveRoomMatrixPlan, roomMatrixOutputPaths, verifyCompletedRooms, verifyAcceptance,
  localAcceptanceRequirements } from '../release-audit.mjs';
import { FULL_OPTION_MATRIX_OUTPUT_PATHS, FULL_OPTION_MATRIX_SMOKE_OUTPUT_PATHS,
  FULL_OPTION_BASIC_TIMES_PROBES, buildFullOptionMatrixPlan, deriveFullOptionCoverage,
  fullOptionMatrixOutputPaths, resolveFullOptionCasePlan } from '../run-complete-room-matrix.mjs';
import { releaseSubject } from '../build-fingerprint.mjs';

const fullVariants = buildRetainedMatrixVariants(runtimeEngineEntries);
const fullEngines = runtimeEngineEntries.map(entry =>
  ({ variantKey: entry.engine.variantKey, version: entry.engine.version }));
const fullMatrix = buildCanonicalRoomMatrix(fullVariants, fullEngines);
const subject = 'a'.repeat(64);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.MATRIX_LOCK_RELATIVE = path.posix.join('.local', 'run-complete-room-matrix.lock');
globalThis.BUILD_MANIFEST_RELATIVE = 'verification/build-manifest.json';

const acceptanceFixtureFiles = [
  'tools/run-local-accounting.mjs', 'tools/run-local-network.mjs', 'tools/run-local-recovery.mjs',
  'tools/run-local-stability.mjs', 'tools/run-local-ui.mjs', 'tools/run-local-native-acceptance.ps1',
  'tools/client-native-release-build.ps1', 'tools/client-native-patch.mjs',
  'tools/client-native-acceptance-build.ps1', 'tools/client-native-regional-peer.mjs',
  'tools/resolve-api-base.mjs', 'tools/run-complete-room-matrix.mjs', 'tools/run-fresh-local-ui.mjs',
  'tools/acceptance-client-adapter.js', 'tools/client-validate.mjs',
  'tools/client-hall-balance-validate.mjs', 'tools/client-e2e.mjs', 'tools/client-regional-e2e.mjs',
];

async function writeFixtureFile(root, relative, contents = relative) {
  const absolute = path.join(root, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents);
}

async function createFreshBuildFixture(root, manifest) {
  for (const entry of [...(manifest.sources?.files ?? []), ...(manifest.binaries?.files ?? [])]) {
    await writeFixtureFile(root, entry.path, 'fixture:' + entry.path);
  }
  await writeFixtureFile(root, 'client/public/fixture.txt');
  await writeFixtureFile(root, 'client/android/doushisi.apk');
  await writeFixtureFile(root, 'tools/android-acceptance-driver/fixture.txt');
  for (const relative of acceptanceFixtureFiles) await writeFixtureFile(root, relative);
}

function unusedPid() {
  for (let pid = 999999; pid > 100000; pid--) {
    try { process.kill(pid, 0); }
    catch (error) { if (error?.code === 'ESRCH') return pid; }
  }
  throw new Error('Unable to find an unused pid for the stale-lock test.');
}

function withoutCell(matrix, key) {
  return { ...matrix, cells: matrix.cells.filter(cell => cell.key !== key) };
}

function extraCell(matrix, key) {
  const cell = structuredClone(matrix.cells[0]);
  return { ...matrix, cells: [...matrix.cells, { ...cell, key }] };
}

test('runtime registry is exactly the 21 retained configurations', () => {
  const keys = assertRetainedRuntimeEngines(runtimeEngineEntries);
  assert.equal(keys.length, 21);
  assert.deepEqual([...keys].sort(), [...RETAINED_VARIANT_KEYS].sort());

  assert.throws(() => assertRetainedRuntimeEngines(runtimeEngineEntries.slice(1)), /exactly 21/);
  assert.throws(() => assertRetainedRuntimeEngines([...runtimeEngineEntries, runtimeEngineEntries[0]]),
    /unique|exactly 21/);
  assert.throws(() => assertRetainedRuntimeEngines(runtimeEngineEntries.map((entry, index) => index === 0
    ? { engine: { ...entry.engine, variantKey: '99:0' } } : entry)), /outside the retained scope|missing/);
  assert.throws(() => assertRetainedRuntimeEngines([]), /empty/);
});

test('retained matrix variants refuse to shrink the fixed player and round scopes', () => {
  const narrowedPlayers = key => ({ key, name: key, fields: [
    { key: 'playerNum', defaultValue: 2, allowedValues: [2, 4] },
    { key: 'gameNum', defaultValue: 4, allowedValues: [4, 8, 12] },
  ] });
  assert.throws(() => buildRetainedMatrixVariants(runtimeEngineEntries, narrowedPlayers),
    /playerNum=2\/3\/4/);

  const narrowedRounds = key => ({ key, name: key, fields: [
    { key: 'playerNum', defaultValue: 2, allowedValues: [2, 3, 4] },
    { key: 'gameNum', defaultValue: 4, allowedValues: [4, 8] },
  ] });
  assert.throws(() => buildRetainedMatrixVariants(runtimeEngineEntries, narrowedRounds),
    /gameNum=4\/8\/12/);

  assert.throws(() => buildRetainedMatrixVariants(runtimeEngineEntries.slice(0, -1)),
    /exactly 21 configurations, found 20/);
  assert.throws(() => buildRetainedMatrixVariants([...runtimeEngineEntries, runtimeEngineEntries[0]]),
    /exactly 21 configurations, found 22/);

  const variants = buildRetainedMatrixVariants(runtimeEngineEntries);
  assert.equal(variants.length, 21);
  assert.deepEqual(variants.map(variant => variant.key), runtimeEngineEntries.map(entry => entry.engine.variantKey));
  assert.ok(variants.every(variant => isDeepStrictEqual(variant.playerCounts, [2, 3, 4])));
  assert.ok(variants.every(variant => isDeepStrictEqual(variant.roundCounts, [4, 8, 12])));
});

test('canonical matrix covers every supported player count and every round count', () => {
  const expected = expectedMatrixCellKeys(fullVariants);
  assert.equal(fullMatrix.cells.length, 189);
  assert.equal(new Set(fullMatrix.cells.map(cell => cell.key)).size, 189);
  assert.equal(expected.length, 189);
  assert.deepEqual(assertMatrixCoversVariants(fullMatrix, fullVariants),
    { variants: 21, cells: 189, expected: 189 });

  for (const variant of fullVariants) {
    const cells = fullMatrix.cells.filter(cell => cell.variantKey === variant.key);
    assert.equal(cells.length, variant.playerCounts.length * variant.roundCounts.length, variant.key);
    assert.deepEqual([...new Set(cells.map(cell => cell.playerCount))].sort((a, b) => a - b),
      [...variant.playerCounts].sort((a, b) => a - b), variant.key);
    assert.deepEqual([...new Set(cells.map(cell => cell.configuredRounds))].sort((a, b) => a - b),
      [...REQUIRED_ROUND_COUNTS], variant.key);
    for (const playerCount of variant.playerCounts) assert.ok(REQUIRED_PLAYER_COUNTS.includes(playerCount), variant.key);
  }
});

test('the canonical matrix rejects missing, duplicate and extra cells', () => {
  const missing = withoutCell(fullMatrix, '8:0:3:8');
  assert.throws(() => assertMatrixCoversVariants(missing, fullVariants), /exactly 189 cells, found 188/);

  const duplicate = { ...fullMatrix, cells: [...fullMatrix.cells, structuredClone(fullMatrix.cells[0])] };
  assert.throws(() => assertMatrixCoversVariants(duplicate, fullVariants), /exactly 189 cells, found 190/);

  const extra = extraCell(fullMatrix, '99:0:2:4');
  assert.throws(() => assertMatrixCoversVariants(extra, fullVariants), /exactly 189 cells, found 190/);
});

test('the canonical matrix rejects a 126-cell shrunken player-by-round matrix', () => {
  const shrunken = { ...fullMatrix, cells: fullMatrix.cells.filter(cell => cell.playerCount !== 3) };
  assert.equal(shrunken.cells.length, 126);
  assert.throws(() => assertMatrixCoversVariants(shrunken, fullVariants), /exactly 189 cells, found 126/);
});

test('the canonical matrix rejects missing and extra cells without a count shortcut', () => {
  const missing = withoutCell(fullMatrix, '8:0:3:8');
  missing.cells.push(structuredClone(fullMatrix.cells[0]));
  assert.equal(missing.cells.length, 189);
  assert.throws(() => assertMatrixCoversVariants(missing, fullVariants), /must not repeat a cell/);

});

test('matrix root directory accepts only one plain name directly below .local', () => {
  for (const invalid of ['..', '../x', 'a/b', 'C:\\x', path.resolve('escaped-root'), '.hidden']) {
    assert.throws(() => resolveMatrixRootDirectory(invalid), Error, String(invalid));
    assert.throws(() => matrixRootPath('C:\\workspace', invalid), Error, String(invalid));
  }

  assert.equal(resolveMatrixRootDirectory('matrix-run-1'), 'matrix-run-1');
  const root = path.resolve('workspace-root');
  const parent = path.join(root, '.local');
  const target = matrixRootPath(root, 'matrix-run-1');
  assert.equal(target, path.join(parent, 'matrix-run-1'));
  assert.equal(path.dirname(target), parent);
  assert.equal(path.relative(parent, target), 'matrix-run-1');
});

test('the matrix lock is exclusive, releasable, and reclaims a stale pid', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-matrix-lock-'));
  let first;
  let reacquired;
  try {
    first = await acquireMatrixLock(root);
    assert.equal(first, path.join(root, '.local', 'run-complete-room-matrix.lock'));
    const held = JSON.parse(await fs.readFile(first, 'utf8'));
    assert.equal(held.pid, process.pid);

    await assert.rejects(acquireMatrixLock(root, { pid: 999999 }),
      /Another complete-room matrix run is active \(pid \d+\)\./);

    await releaseMatrixLock(first);
    reacquired = await acquireMatrixLock(root, { pid: 999999 });
    const reclaimedPayload = JSON.parse(await fs.readFile(reacquired, 'utf8'));
    assert.equal(reclaimedPayload.pid, 999999);
    await releaseMatrixLock(reacquired);

    const stalePid = unusedPid();
    await fs.writeFile(first, JSON.stringify({ pid: stalePid, nonce: 'stale',
      startedAt: '2026-01-01T00:00:00.000Z' }) + '\n');
    const staleReclaimed = await acquireMatrixLock(root);
    const stalePayload = JSON.parse(await fs.readFile(staleReclaimed, 'utf8'));
    assert.equal(stalePayload.pid, process.pid);
    await releaseMatrixLock(staleReclaimed);
  } finally {
    await releaseMatrixLock(first);
    await releaseMatrixLock(reacquired);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('assertFreshBuild accepts a matching manifest and rejects a copied mismatched source hash', async t => {
  const realManifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'verification/build-manifest.json'), 'utf8'));
  const realSubject = await releaseSubject(repoRoot);
  if (realManifest.sources?.sha256 === realSubject.sources && realManifest.binaries?.sha256 === realSubject.binaries) {
    await assertFreshBuild(repoRoot);
  } else {
    t.diagnostic('The real verification/build-manifest.json is stale against the current tree; using a copied matching fixture for the success assertion.');
  }

  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-fresh-build-'));
  try {
    await createFreshBuildFixture(fixture, realManifest);
    const fixtureSubject = await releaseSubject(fixture);
    const matching = { ...realManifest, sources: { ...realManifest.sources, sha256: fixtureSubject.sources },
      binaries: { ...realManifest.binaries, sha256: fixtureSubject.binaries } };
    await fs.mkdir(path.join(fixture, 'verification'), { recursive: true });
    await fs.writeFile(path.join(fixture, 'verification/build-manifest.json'), JSON.stringify(matching, null, 2) + '\n');
    const fresh = await assertFreshBuild(fixture);
    assert.equal(fresh.sources, fixtureSubject.sources);

    matching.sources.sha256 = '0'.repeat(64);
    await fs.writeFile(path.join(fixture, 'verification/build-manifest.json'), JSON.stringify(matching, null, 2) + '\n');
    await assert.rejects(assertFreshBuild(fixture),
      /Source files changed after the last build\. Run pnpm build before the acceptance matrix\./);
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

test('a room spec without gameNum fails instead of silently falling back', () => {
  const emptySpec = key => ({ key, name: key, fields: [{ key: 'playerNum', defaultValue: 2, allowedValues: [2, 3, 4] }] });
  assert.throws(() => buildRetainedMatrixVariants(runtimeEngineEntries, emptySpec), /gameNum/);

  const partialSpec = key => ({ key, name: key, fields: [
    { key: 'playerNum', defaultValue: 2, allowedValues: [2, 3, 4] },
    { key: 'gameNum', defaultValue: 4, allowedValues: [4] },
  ] });
  assert.throws(() => buildRetainedMatrixVariants(runtimeEngineEntries, partialSpec), /gameNum=4\/8\/12/);
});

test('playerNum may fall back only when the room spec explicitly leaves it unresolved', () => {
  const unresolvedPlayerSpec = key => ({ key, name: key, fields: [
    { key: 'gameNum', defaultValue: 4, allowedValues: [4, 8, 12] },
  ], unresolvedFields: ['playerNum'] });
  const unresolved = buildRetainedMatrixVariants(runtimeEngineEntries, unresolvedPlayerSpec);
  assert.ok(unresolved.every(variant => isDeepStrictEqual(variant.playerCounts, [2, 3, 4])));

  const accidentallyMissingPlayerSpec = key => ({ key, name: key, fields: [
    { key: 'gameNum', defaultValue: 4, allowedValues: [4, 8, 12] },
  ], unresolvedFields: [] });
  assert.throws(() => buildRetainedMatrixVariants(runtimeEngineEntries, accidentallyMissingPlayerSpec),
    /playerNum must be declared or explicitly listed in unresolvedFields/);
});

test('a formal plan must be the whole canonical matrix while subsets stay smoke-only', () => {
  const plan = resolveRoomMatrixPlan(fullMatrix);
  assert.equal(plan.acceptanceEligible, true);
  assert.equal(plan.smokeOnly, false);
  assert.equal(plan.cells.length, 189);
  assert.doesNotThrow(() => assertFormalPlanIsCanonical(plan, fullMatrix));

  const subset = { smokeOnly: false, acceptanceEligible: true, cells: fullMatrix.cells.slice(0, 1) };
  assert.throws(() => assertFormalPlanIsCanonical(subset, fullMatrix), /must contain every canonical cell/);

  const duplicated = { smokeOnly: false, acceptanceEligible: true,
    cells: [...fullMatrix.cells, structuredClone(fullMatrix.cells[0])] };
  assert.throws(() => assertFormalPlanIsCanonical(duplicated, fullMatrix), /must contain every canonical cell/);

  const relabelled = { smokeOnly: true, acceptanceEligible: true, cells: fullMatrix.cells.slice(0, 1) };
  assert.throws(() => assertFormalPlanIsCanonical(relabelled, fullMatrix), /can never be acceptance eligible/);

  const smokeSubset = resolveRoomMatrixPlan(fullMatrix, { smoke: true, variants: ['4:0'] });
  assert.equal(smokeSubset.acceptanceEligible, false);
  assert.doesNotThrow(() => assertFormalPlanIsCanonical(smokeSubset, fullMatrix));

  assert.throws(() => resolveRoomMatrixPlan(fullMatrix, { variants: ['4:0'] }), { code: 'ROOM_MATRIX_SUBSET_REQUIRES_SMOKE' });
  assert.throws(() => resolveRoomMatrixPlan(fullMatrix, { players: [3] }), { code: 'ROOM_MATRIX_SUBSET_REQUIRES_SMOKE' });
  assert.throws(() => resolveRoomMatrixPlan(fullMatrix, { rounds: [4] }), { code: 'ROOM_MATRIX_SUBSET_REQUIRES_SMOKE' });
});

test('smoke and formal artifacts never share an output path', () => {
  const formal = roomMatrixOutputPaths(false);
  const smoke = roomMatrixOutputPaths(true);
  assert.doesNotThrow(() => assertOutputPathsMatchMode(formal, false));
  assert.doesNotThrow(() => assertOutputPathsMatchMode(smoke, true));
  assert.throws(() => assertOutputPathsMatchMode(smoke, false), /must never write smoke-labelled/);
  assert.throws(() => assertOutputPathsMatchMode(formal, true), /must write only smoke-labelled/);
  assert.notEqual(formal.report, smoke.report);
  assert.notEqual(formal.raw, smoke.raw);
});

test('each round must settle exactly once and never twice', () => {
  const rounds = ['r1', 'r2', 'r3'];
  const operation = (roundId, index) => ({ roundId, operationId: 'op-' + index, requestKey: 'settlement:' + roundId });
  const good = [operation('r1', 1), operation('r2', 2), operation('r3', 3)];
  assert.deepEqual(assertSettlementCoverage(rounds, good).map(item => item.roundId), rounds);

  // Total count still 3, but r1 settles twice while r3 never settles: the classic counterexample.
  assert.throws(() => assertSettlementCoverage(rounds, [operation('r1', 1), operation('r1', 2), operation('r2', 3)]),
    /without a settlement|exactly once|Duplicate settlement request key/);
  assert.throws(() => assertSettlementCoverage(rounds, [operation('r1', 1), operation('r2', 2), operation('r4', 3)]),
    /without a settlement|unknown rounds/);
  assert.throws(() => assertSettlementCoverage(rounds,
    [operation('r1', 1), { roundId: 'r2', operationId: 'op-1', requestKey: 'settlement:r2' }, operation('r3', 3)]),
  /Duplicate settlement operation id/);
  assert.throws(() => assertSettlementCoverage(rounds,
    [{ roundId: 'r1', operationId: 'op-1', requestKey: 'settlement:r1' },
      { roundId: 'r2', operationId: 'op-2', requestKey: 'settlement:r1' },
      { roundId: 'r3', operationId: 'op-3', requestKey: 'settlement:r3' }]),
  /Duplicate settlement request key/);
  assert.throws(() => assertSettlementCoverage(rounds,
    [operation('r1', 1), { roundId: '', operationId: 'op-2', requestKey: 'settlement:r2' }, operation('r3', 3)]),
  /must reference a round id/);
  assert.throws(() => assertSettlementCoverage(rounds, good.slice(0, 2)), /without a settlement/);
});

test('two independent replay rebuilds must agree', () => {
  const record = { roomId: 'room', roundId: 'round', frames: [{ sequence: '0', gameSha256: 'b'.repeat(64) }] };
  assert.equal(assertReplayRebuildStable(record, structuredClone(record), 'cell'), canonicalDigest(record));
  assert.throws(() => assertReplayRebuildStable(record, { ...record, frames: [{ sequence: '0', gameSha256: 'c'.repeat(64) }] }, 'cell'),
    /two independent replay rebuilds must agree/);
});

test('each acceptance check is derived independently from the recorded games', () => {
  const games = fullMatrix.cells.map(cell => syntheticGame(cell));
  assert.deepEqual(deriveAcceptanceChecks({ games, variants: fullVariants }).map(check => check.passed),
    [true, true, true, true]);

  const dropConfiguration = games.filter(game => game.variantKey !== '23:0');
  assert.deepEqual(deriveAcceptanceChecks({ games: dropConfiguration, variants: fullVariants }).map(check => check.passed),
    [false, false, false, false]);

  const dropPlayerCount = games.filter(game => game.playerCount !== 3);
  assert.deepEqual(deriveAcceptanceChecks({ games: dropPlayerCount, variants: fullVariants }).map(check => check.passed),
    [true, false, false, false]);

  const dropRoundCount = games.filter(game => game.configuredRounds !== 8);
  assert.deepEqual(deriveAcceptanceChecks({ games: dropRoundCount, variants: fullVariants }).map(check => check.passed),
    [true, true, false, false]);

  const unstable = structuredClone(games);
  unstable[0].replayStable = false;
  assert.deepEqual(deriveAcceptanceChecks({ games: unstable, variants: fullVariants }).map(check => check.passed),
    [true, true, true, false]);

  const unsettled = structuredClone(games);
  unsettled[0].settlementCount = unsettled[0].settlementCount - 1;
  assert.deepEqual(deriveAcceptanceChecks({ games: unsettled, variants: fullVariants }).map(check => check.passed),
    [true, true, false, false]);

  const notClosed = structuredClone(games);
  notClosed[0].roomState = 'active';
  assert.deepEqual(deriveAcceptanceChecks({ games: notClosed, variants: fullVariants }).map(check => check.passed),
    [true, true, false, false]);

  const wrongFinalRound = structuredClone(games);
  wrongFinalRound[0].currentRound = wrongFinalRound[0].configuredRounds - 1;
  assert.deepEqual(deriveAcceptanceChecks({ games: wrongFinalRound, variants: fullVariants }).map(check => check.passed),
    [true, true, false, false]);

  const wrongMembers = structuredClone(games);
  wrongMembers[0].memberIds = wrongMembers[0].memberIds.slice(0, -1);
  assert.deepEqual(deriveAcceptanceChecks({ games: wrongMembers, variants: fullVariants }).map(check => check.passed),
    [true, true, false, false]);

  const brokenContinuation = structuredClone(games);
  brokenContinuation[0].continuationVerified = false;
  assert.deepEqual(deriveAcceptanceChecks({ games: brokenContinuation, variants: fullVariants }).map(check => check.passed),
    [true, true, false, false]);

  assert.deepEqual(deriveAcceptanceChecks({ games: [], variants: fullVariants }).map(check => check.passed),
    [false, false, false, false]);
});

test('the runner report shape stays compatible with the formal verifier', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dss-room-matrix-'));
  try {
    const games = fullMatrix.cells.map(cell => syntheticGame(cell));
    const summary = { variants: 21, games: games.length,
      minSteps: Math.min(...games.map(game => game.steps)), maxSteps: Math.max(...games.map(game => game.steps)) };
    const matrixDigest = canonicalRoomMatrixDigest(fullMatrix);
    const checks = deriveAcceptanceChecks({ games, variants: fullVariants });
    const raw = {
      schemaVersion: 1, generatedAt: 'now', scope: 'real rooms', mode: 'acceptance',
      smokeOnly: false, acceptanceEligible: true, matrixDigest, subjectSha256: subject,
      games, summary, checks, passed: true,
    };
    await fs.mkdir(path.join(root, 'verification/raw'), { recursive: true });
    const rawBytes = JSON.stringify(raw);
    await fs.writeFile(path.join(root, 'verification/raw/local-completed-games.json'), rawBytes);
    await fs.writeFile(path.join(root, 'verification/local-completed-games.json'), JSON.stringify({
      schemaVersion: 1, mode: 'acceptance', smokeOnly: false, acceptanceEligible: true,
      matrixDigest, subjectSha256: subject, passed: true, checks,
      evidence: [{ path: 'verification/raw/local-completed-games.json',
        sha256: (await import('node:crypto')).createHash('sha256').update(rawBytes).digest('hex') }],
      games, summary, generatedAt: 'now',
    }));

    // The runner now records settlement coverage and a second rebuild per round; the verifier must
    // still accept the corroborated evidence and reject a subset.
    assert.doesNotThrow(() => verifyCompletedRooms({ games, matrixDigest, subjectSha256: subject,
      smokeOnly: false, acceptanceEligible: true }, fullVariants, fullEngines));
    const accepted = await verifyAcceptance(root, 'local-completed-games.json', { sha256: subject },
      localAcceptanceRequirements);
    assert.equal(accepted.passed, true);

    await fs.writeFile(path.join(root, 'verification/local-completed-games.json'), JSON.stringify({
      schemaVersion: 1, mode: 'acceptance', smokeOnly: false, acceptanceEligible: true,
      matrixDigest, subjectSha256: subject, passed: true,
      checks: localAcceptanceRequirements['local-completed-games.json'].map(id => ({ id, passed: true })),
      evidence: [{ path: 'verification/raw/local-completed-games.json',
        sha256: (await import('node:crypto')).createHash('sha256').update(rawBytes).digest('hex') }],
      games: games.slice(0, 1), summary, generatedAt: 'now',
    }));
    await assert.rejects(verifyAcceptance(root, 'local-completed-games.json', { sha256: subject }, localAcceptanceRequirements),
      { code: 'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('importing the runner never starts the matrix', async () => {
  const runnerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../run-complete-room-matrix.mjs');
  const module = await import(pathToFileURL(runnerPath).href);
  assert.equal(typeof module.runCompleteRoomMatrix, 'function');
  assert.deepEqual(module.REQUIRED_ROUND_COUNTS, [4, 8, 12]);
  assert.deepEqual(module.REQUIRED_PLAYER_COUNTS, [2, 3, 4]);
});

test('full-option evidence paths are isolated from the canonical acceptance artifacts', () => {
  assert.notDeepEqual(FULL_OPTION_MATRIX_OUTPUT_PATHS, roomMatrixOutputPaths(false));
  assert.notDeepEqual(FULL_OPTION_MATRIX_SMOKE_OUTPUT_PATHS, roomMatrixOutputPaths(true));
  assert.deepEqual(fullOptionMatrixOutputPaths(false), FULL_OPTION_MATRIX_OUTPUT_PATHS);
  assert.deepEqual(fullOptionMatrixOutputPaths(true), FULL_OPTION_MATRIX_SMOKE_OUTPUT_PATHS);
  for (const paths of [FULL_OPTION_MATRIX_OUTPUT_PATHS, FULL_OPTION_MATRIX_SMOKE_OUTPUT_PATHS]) {
    assert.notEqual(paths.report, paths.raw);
    assert.ok(paths.report.startsWith('verification/'));
    assert.ok(paths.raw.startsWith('verification/raw/'));
  }
});

test('full-option plan covers every retained configuration option and pairwise branch', () => {
  const plan = buildFullOptionMatrixPlan(runtimeEngineEntries);
  const coverage = deriveFullOptionCoverage(plan);
  assert.equal(plan.variants.length, 21);
  assert.equal(coverage.singleValues.required, 568);
  assert.equal(coverage.singleValues.covered, 568);
  assert.deepEqual(coverage.singleValues.missing, []);
  assert.equal(coverage.pairwise.required, 9060);
  assert.equal(coverage.pairwise.covered, 9060);
  assert.equal(coverage.pairwise.invalid, 5);
  assert.deepEqual(coverage.pairwise.missing, []);
  assert.equal(coverage.conflicts.required, 16);
  assert.equal(coverage.conflicts.covered, 16);
  assert.deepEqual(coverage.conflicts.missing, []);

  for (const variant of plan.variants) {
    const useCardType = variant.singleValues.filter(value => value === 'useCardType=1' || value === 'useCardType=2');
    assert.equal(useCardType.length, 2, variant.variantKey + ':useCardType');
    for (const value of FULL_OPTION_BASIC_TIMES_PROBES) {
      assert.ok(variant.singleValues.includes('basicTimes=' + JSON.stringify(value)),
        variant.variantKey + ':basicTimes=' + value);
    }
  }

  assert.deepEqual(plan.uncovered.map(item => item.variantKey + ':' + item.field).sort(),
    ['101:0:blood-battle-routing', '3:0:eight-tens']);
  assert.ok(plan.uncovered.every(item => item.scope === 'outside-retained' && item.reason));

  const rejected = plan.cases.filter(item => item.kind === 'conflict' && item.expected === 'rejected');
  assert.equal(rejected.length, 2);
  assert.deepEqual(rejected.map(item => item.assignments).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))), [
    { maxFan: 99, chaoFanJiaDi: 1 },
    { playerNum: 3, daXiaoJia: 1 },
  ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
  assert.ok(rejected.every(item => item.rejectionMessageIncludes));

  assert.throws(() => resolveFullOptionCasePlan(plan, { variants: ['20:0'] }),
    /variant filters require ROOM_MATRIX_SMOKE=1/);
  const smokePlan = resolveFullOptionCasePlan(plan, { smoke: true, variants: ['20:0'] });
  assert.equal(smokePlan.smokeOnly, true);
  assert.equal(smokePlan.acceptanceEligible, false);
  assert.ok(smokePlan.cases.length > 0);
  assert.ok(smokePlan.cases.every(item => item.variantKey === '20:0'));
});

function syntheticGame(cell, subjectSha256 = subject) {
  const memberIds = Array.from({ length: cell.playerCount }, (_, index) => cell.key + '-p' + (index + 1));
  const rounds = Array.from({ length: cell.configuredRounds }, (_, index) => {
    const roundId = cell.key + '-r' + (index + 1);
    const replay = {
      roomId: cell.key + '-room', roundId, number: index + 1, variantKey: cell.variantKey,
      ruleVersion: cell.ruleVersion, rules: { ...cell.normalizedOptions }, results: [], endReason: 'completed',
      frames: [{ sequence: '0', stateVersion: 0, at: '2026-10-01T00:00:00.000Z', actorId: null,
        autoPlayUserIds: [], gameSha256: canonicalDigest({ index }) }],
    };
    return { roundId, number: index + 1, dealerId: memberIds[index % memberIds.length], dealerRun: index + 1,
      continuation: { version: cell.ruleVersion, completedRound: index + 1,
        nextDealerId: memberIds[(index + 1) % memberIds.length], dealerRun: index + 2 },
      digest: canonicalDigest(replay), replay };
  });
  const settlements = rounds.map((round, index) => ({ roundId: round.roundId,
    operationId: cell.key + '-settle-' + (index + 1), requestKey: 'settlement:' + round.roundId }));
  return {
    variantKey: cell.variantKey, playerCount: cell.playerCount, configuredRounds: cell.configuredRounds,
    completedRounds: cell.configuredRounds, currentRound: cell.configuredRounds, roomState: 'closed',
    continuationVerified: true, memberIds, replayVerified: true, replayStable: true, replayRebuilds: 2,
    replayedRounds: rounds.length, replayedRoundIds: rounds.map(round => round.roundId),
    ruleVersion: cell.ruleVersion, steps: 40 + rounds.length,
    normalizedOptions: cell.normalizedOptions, optionsSha256: cell.optionsSha256, optionCoverage: cell.optionCoverage,
    rounds, settlementCount: settlements.length, settlements, settlementSha256: canonicalDigest(settlements),
    replaySummary: { rounds: rounds.length, digest: completedGameReplayDigest(rounds) },
    subjectBeforeSha256: subjectSha256, subjectAfterSha256: subjectSha256, subjectSha256, passed: true,
  };
}
