import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { getDefaultOptions, getRoomSpec, RETAINED_VARIANT_KEYS, validateRoomOptions } from '../packages/rules/src/index.ts';
import { AuthService } from '../apps/server/src/auth.ts';
import { openDatabase, migrate } from '../apps/server/src/database.ts';
import { createRuntimeEngineRegistry, runtimeEngineEntries } from '../apps/server/src/runtime-engines.ts';
import { releaseSubject } from './build-fingerprint.mjs';
import { LedgerService } from '../apps/server/src/ledger.ts';
import { PolicyService } from '../apps/server/src/policies.ts';
import { ReplayService } from '../apps/server/src/replays.ts';
import { RoomService } from '../apps/server/src/rooms.ts';
import { buildCanonicalRoomMatrix, canonicalDigest, canonicalRoomMatrixDigest, completedGameReplayDigest,
  replayRoundRecord, resolveRoomMatrixPlan, roomMatrixOutputPaths } from './release-audit.mjs';

// Formal acceptance must execute the whole retained matrix: every retained configuration, every
// player count that configuration actually supports, and every configured round count.
export const REQUIRED_ROUND_COUNTS = Object.freeze([4, 8, 12]);
export const REQUIRED_PLAYER_COUNTS = Object.freeze([2, 3, 4]);
export const EXPECTED_VARIANT_COUNT = RETAINED_VARIANT_KEYS.length;
export const EXPECTED_CELL_COUNT = EXPECTED_VARIANT_COUNT * REQUIRED_PLAYER_COUNTS.length * REQUIRED_ROUND_COUNTS.length;
const SMOKE_PATH_PATTERN = /(?:^|[/._-])smoke/i;
export const MATRIX_ROOT_DIRECTORY = '.local';
export const MATRIX_LOCK_NAME = 'run-complete-room-matrix.lock';
const MATRIX_LOCK_RELATIVE = [MATRIX_ROOT_DIRECTORY, MATRIX_LOCK_NAME].join('/');
const BUILD_MANIFEST_RELATIVE = 'verification/build-manifest.json';
export const FULL_OPTION_MATRIX_OUTPUT_PATHS = Object.freeze({
  report: 'verification/local-option-matrix.json',
  raw: 'verification/raw/local-option-matrix.json',
});
export const FULL_OPTION_MATRIX_SMOKE_OUTPUT_PATHS = Object.freeze({
  report: 'verification/local-option-matrix-smoke.json',
  raw: 'verification/raw/local-option-matrix-smoke.json',
});
export const FULL_OPTION_BASIC_TIMES_PROBES = Object.freeze(['0.1', '1']);
const STRUCTURAL_OPTION_FIELDS = Object.freeze(['gameNum', 'playerNum']);

function sortedUniqueIntegers(values, label) {
  assert.ok(Array.isArray(values) && values.length > 0, label + ' must be a non-empty list.');
  for (const value of values) assert.ok(Number.isInteger(value), label + ' values must be integers.');
  return [...new Set(values)].sort((left, right) => left - right);
}

function sameIntegerSet(left, right) {
  return isDeepStrictEqual(sortedUniqueIntegers(left, 'actual'), sortedUniqueIntegers(right, 'expected'));
}

// The expected matrix is derived from the same room-spec option source release-check uses, so the
// runner and the verifier cannot drift apart on player counts, round counts or option coverage.
// A configuration whose player count is still unresolved (14:0/15:0 today) falls back to 2/3/4,
// which is exactly what RoomService.create() accepts for a manual player count.
export function buildRetainedMatrixVariants(entries, specFor = getRoomSpec) {
  assert.ok(Array.isArray(entries) && entries.length > 0, 'Runtime engine entries are required.');
  assert.equal(entries.length, EXPECTED_VARIANT_COUNT,
    'The retained matrix must contain exactly ' + EXPECTED_VARIANT_COUNT + ' configurations, found ' + entries.length + '.');
  return entries.map(entry => {
    const key = entry.engine.variantKey;
    const spec = specFor(key);
    const playerField = spec.fields.find(field => field.key === 'playerNum');
    const roundField = spec.fields.find(field => field.key === 'gameNum');
    assert.ok(playerField || Array.isArray(spec.unresolvedFields) && spec.unresolvedFields.includes('playerNum'),
      key + ': playerNum must be declared or explicitly listed in unresolvedFields.');
    assert.ok(roundField && Array.isArray(roundField.allowedValues) && roundField.allowedValues.length > 0,
      key + ': the room spec must declare gameNum options.');
    const declaredPlayers = sortedUniqueIntegers(playerField ? [...playerField.allowedValues] : [...REQUIRED_PLAYER_COUNTS],
      key + ': playerNum');
    const declaredRounds = sortedUniqueIntegers([...roundField.allowedValues], key + ': gameNum');
    // The retained acceptance scope is fixed: every configuration must be playable at exactly
    // 2/3/4 players and exactly 4/8/12 rounds. A narrower room spec must be completed before it can
    // produce acceptance evidence, never silently shrunk down to the values it happens to declare.
    assert.ok(sameIntegerSet(declaredPlayers, REQUIRED_PLAYER_COUNTS),
      key + ': the room spec must support playerNum=2/3/4 exactly, found [' + declaredPlayers.join(',') + '].');
    assert.ok(sameIntegerSet(declaredRounds, REQUIRED_ROUND_COUNTS),
      key + ': the room spec must support gameNum=4/8/12 exactly, found [' + declaredRounds.join(',') + '].');
    return { key, name: spec.name, fields: spec.fields,
      playerCounts: [...REQUIRED_PLAYER_COUNTS], roundCounts: [...REQUIRED_ROUND_COUNTS],
      optionCoverage: spec.fields.flatMap(field =>
        field.allowedValues.map(value => 'option:' + field.key + '=' + JSON.stringify(value))) };
  });
}

// The runtime registry must be exactly the retained scope: no missing, extra or duplicate keys.
export function assertRetainedRuntimeEngines(entries, retainedKeys = RETAINED_VARIANT_KEYS) {
  assert.ok(Array.isArray(entries) && entries.length > 0, 'The runtime engine registry is empty.');
  const keys = entries.map(entry => entry.engine?.variantKey);
  for (const key of keys) assert.ok(typeof key === 'string' && key.trim(), 'Every runtime engine must declare a variant key.');
  assert.equal(new Set(keys).size, keys.length, 'Runtime engine variant keys must be unique.');
  assert.equal(keys.length, retainedKeys.length,
    'The runtime registry must contain exactly ' + retainedKeys.length + ' configurations, found ' + keys.length + '.');
  const present = new Set(keys);
  const expected = new Set(retainedKeys);
  const missing = retainedKeys.filter(key => !present.has(key));
  const extra = keys.filter(key => !expected.has(key));
  assert.deepEqual(missing, [], 'Runtime registry is missing retained configurations: ' + missing.join(', '));
  assert.deepEqual(extra, [], 'Runtime registry contains configurations outside the retained scope: ' + extra.join(', '));
  return [...keys];
}

// Cartesian product of a variant's supported player counts and its configured round counts.
export function expectedMatrixCellKeys(variants) {
  const keys = [];
  for (const variant of variants) {
    const playerCounts = REQUIRED_PLAYER_COUNTS;
    const roundCounts = REQUIRED_ROUND_COUNTS;
    for (const playerCount of playerCounts) {
      for (const configuredRounds of roundCounts) keys.push(variant.key + ':' + playerCount + ':' + configuredRounds);
    }
  }
  return keys;
}

// The canonical matrix must be the complete cartesian product with no duplicate, missing or extra
// cell, and every configuration must cover gameNum=4/8/12.
export function assertMatrixCoversVariants(matrix, variants) {
  assert.ok(matrix !== null && typeof matrix === 'object' && Array.isArray(matrix.cells),
    'The canonical room matrix must contain cells.');
  assert.ok(Array.isArray(variants) && variants.length > 0, 'Room variants are required.');
  assert.equal(variants.length, EXPECTED_VARIANT_COUNT,
    'The canonical matrix must cover exactly ' + EXPECTED_VARIANT_COUNT + ' configurations, found ' + variants.length + '.');
  const variantKeys = variants.map(variant => variant.key);
  assert.equal(new Set(variantKeys).size, variantKeys.length, 'Canonical matrix variants must be unique.');
  assert.equal(new Set(matrix.cells.map(cell => cell.variantKey)).size, EXPECTED_VARIANT_COUNT,
    'The canonical matrix must contain cells for exactly ' + EXPECTED_VARIANT_COUNT + ' configurations.');
  assert.equal(matrix.cells.length, EXPECTED_CELL_COUNT,
    'The canonical matrix must contain exactly ' + EXPECTED_CELL_COUNT + ' cells, found ' + matrix.cells.length + '.');
  const expected = expectedMatrixCellKeys(variants);
  const actual = matrix.cells.map(cell => cell.key);
  assert.equal(new Set(actual).size, actual.length, 'The canonical room matrix must not repeat a cell.');
  const present = new Set(actual);
  const wanted = new Set(expected);
  const missing = expected.filter(key => !present.has(key));
  const extra = actual.filter(key => !wanted.has(key));
  assert.deepEqual(missing, [], 'The canonical room matrix is missing cells: ' + missing.join(', '));
  assert.deepEqual(extra, [], 'The canonical room matrix has unexpected cells: ' + extra.join(', '));
  for (const variant of variants) {
    const playerCounts = [...new Set(matrix.cells.filter(cell => cell.variantKey === variant.key)
      .map(cell => cell.playerCount))].sort((left, right) => left - right);
    assert.deepEqual(playerCounts, [...REQUIRED_PLAYER_COUNTS],
      variant.key + ' must cover playerNum=2/3/4 exactly.');
    const roundCounts = [...new Set(matrix.cells.filter(cell => cell.variantKey === variant.key)
      .map(cell => cell.configuredRounds))].sort((left, right) => left - right);
    assert.deepEqual(roundCounts, [...REQUIRED_ROUND_COUNTS],
      variant.key + ' must cover gameNum=' + REQUIRED_ROUND_COUNTS.join('/') + '.');
  }
  return { variants: variants.length, cells: actual.length, expected: expected.length };
}

// Only a smoke plan may be a subset. A formal plan must be exactly the canonical matrix, so a
// smoke or subset run can never masquerade as the full acceptance matrix.
export function assertFormalPlanIsCanonical(plan, matrix) {
  assert.ok(plan !== null && typeof plan === 'object' && Array.isArray(plan.cells), 'A room matrix plan is required.');
  assert.ok(matrix !== null && typeof matrix === 'object' && Array.isArray(matrix.cells),
    'The canonical room matrix must contain cells.');
  if (plan.smokeOnly || plan.acceptanceEligible === false) {
    assert.equal(plan.smokeOnly, true, 'A non-acceptance plan must be explicitly smoke-only.');
    assert.equal(plan.acceptanceEligible, false, 'A smoke-only plan can never be acceptance eligible.');
    assert.ok(plan.cells.length > 0, 'A smoke plan must still execute at least one cell.');
    return { smokeOnly: true, cells: plan.cells.length };
  }
  assert.equal(plan.acceptanceEligible, true, 'The formal plan must be acceptance eligible.');
  assert.equal(plan.cells.length, matrix.cells.length, 'The formal plan must contain every canonical cell.');
  const canonical = new Map(matrix.cells.map(cell => [cell.key, cell]));
  const seen = new Set();
  for (const cell of plan.cells) {
    assert.ok(!seen.has(cell.key), 'The formal plan repeats cell ' + cell.key + '.');
    seen.add(cell.key);
    const expected = canonical.get(cell.key);
    assert.ok(expected, 'The formal plan contains an unexpected cell ' + cell.key + '.');
    assert.ok(isDeepStrictEqual(cell, expected), 'The formal plan cell ' + cell.key + ' drifted from the canonical matrix.');
  }
  return { smokeOnly: false, cells: plan.cells.length };
}

// Smoke and formal runs never share an output path.
export function assertOutputPathsMatchMode(paths, smokeOnly) {
  assert.ok(paths !== null && typeof paths === 'object' &&
    typeof paths.report === 'string' && typeof paths.raw === 'string', 'Room matrix output paths are required.');
  const reportIsSmoke = SMOKE_PATH_PATTERN.test(paths.report);
  const rawIsSmoke = SMOKE_PATH_PATTERN.test(paths.raw);
  if (smokeOnly) assert.ok(reportIsSmoke && rawIsSmoke, 'Smoke runs must write only smoke-labelled artifacts.');
  else assert.ok(!reportIsSmoke && !rawIsSmoke, 'Formal runs must never write smoke-labelled artifacts.');
  return paths;
}

export function fullOptionMatrixOutputPaths(smoke) {
  return smoke ? { ...FULL_OPTION_MATRIX_SMOKE_OUTPUT_PATHS } : { ...FULL_OPTION_MATRIX_OUTPUT_PATHS };
}

function optionValueKey(field, value) {
  return field + '=' + JSON.stringify(value);
}

function optionPairKey(leftField, leftValue, rightField, rightValue) {
  const left = optionValueKey(leftField, leftValue);
  const right = optionValueKey(rightField, rightValue);
  return left < right ? left + '|' + right : right + '|' + left;
}

function fullOptionFields(spec) {
  return spec.fields.filter(field => field.key !== 'gameNum').map(field => ({ key: field.key,
    allowedValues: [...field.allowedValues], sourceGroup: field.sourceGroup }));
}

function fullOptionPairwiseFields(spec) {
  const fields = fullOptionFields(spec).filter(field => field.key !== 'playerNum');
  fields.push({ key: 'playerNum', allowedValues: [...REQUIRED_PLAYER_COUNTS], sourceGroup: 'config_players' });
  fields.push({ key: 'basicTimes', allowedValues: [...FULL_OPTION_BASIC_TIMES_PROBES], sourceGroup: 'config_score' });
  return fields;
}

function fullOptionDefaults(variantKey, spec) {
  const defaults = getDefaultOptions(variantKey);
  if (spec.unresolvedFields.includes('playerNum')) defaults.playerNum = 4;
  return defaults;
}

function optionsAcceptedByValidator(variantKey, spec, assignments) {
  const input = { ...assignments };
  // RoomService owns unresolved playerNum and removes it before validateRoomOptions().
  if (spec.unresolvedFields.includes('playerNum')) delete input.playerNum;
  delete input.basicTimes;
  try {
    validateRoomOptions(variantKey, input);
    return true;
  } catch {
    return false;
  }
}

function findValidOptionAssignment(variantKey, spec, desired) {
  const defaults = fullOptionDefaults(variantKey, spec);
  const base = { ...defaults, ...desired };
  if (optionsAcceptedByValidator(variantKey, spec, base)) return base;

  const adjustable = fullOptionFields(spec).filter(field => !Object.hasOwn(desired, field.key));
  const unresolvedPlayer = spec.unresolvedFields.includes('playerNum') && !Object.hasOwn(desired, 'playerNum');
  if (unresolvedPlayer) adjustable.push({ key: 'playerNum', allowedValues: [...REQUIRED_PLAYER_COUNTS] });
  for (const field of adjustable) {
    for (const value of field.allowedValues) {
      const candidate = { ...base, [field.key]: value };
      if (optionsAcceptedByValidator(variantKey, spec, candidate)) return candidate;
    }
  }
  for (let left = 0; left < adjustable.length; left++) {
    for (let right = left + 1; right < adjustable.length; right++) {
      for (const leftValue of adjustable[left].allowedValues) {
        for (const rightValue of adjustable[right].allowedValues) {
          const candidate = { ...base, [adjustable[left].key]: leftValue, [adjustable[right].key]: rightValue };
          if (optionsAcceptedByValidator(variantKey, spec, candidate)) return candidate;
        }
      }
    }
  }
  return null;
}

function makeFullOptionCase(variantKey, spec, kind, assignments, options = {}) {
  const normalized = { ...getDefaultOptions(variantKey), ...assignments };
  const baseBeans = String(assignments.basicTimes ?? options.baseBeans ?? '0.125');
  delete normalized.basicTimes;
  // The full-option probe completes exactly one round and then dissolves, so the declared round
  // count is pinned to a single-round room and the readback expectation must agree with it.
  const configuredRounds = options.configuredRounds ?? 4;
  normalized.gameNum = configuredRounds;
  if (spec.unresolvedFields.includes('playerNum')) normalized.playerNum = assignments.playerNum ?? 4;
  const createOptions = { ...normalized, baseBeans };
  const expectedReadback = { ...normalized };
  const expectedBaseBeansSource = spec.unresolvedFields.includes('basicTimes') ? 'manual' : 'original-basicTimes';
  const expectedPlayerNumSource = spec.unresolvedFields.includes('playerNum') ? 'manual' : 'original';
  return { id: options.id ?? '', variantKey, kind, assignments: { ...assignments },
    playerCount: Number(normalized.playerNum), configuredRounds, baseBeans,
    createOptions, expectedReadback, expected: options.expected ?? 'valid',
    expectedBaseBeansSource, expectedPlayerNumSource,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.rejectionMessageIncludes ? { rejectionMessageIncludes: options.rejectionMessageIncludes } : {}) };
}

function singleOptionValueKeys(variantKey, spec) {
  const keys = [];
  for (const field of fullOptionFields(spec)) {
    if (STRUCTURAL_OPTION_FIELDS.includes(field.key)) continue;
    for (const value of field.allowedValues) keys.push(optionValueKey(field.key, value));
  }
  for (const value of FULL_OPTION_BASIC_TIMES_PROBES) keys.push(optionValueKey('basicTimes', value));
  if (spec.unresolvedFields.includes('playerNum')) {
    for (const value of REQUIRED_PLAYER_COUNTS) keys.push(optionValueKey('playerNum', value));
  }
  return keys;
}

function buildSingleOptionCases(variantKey, spec) {
  const cases = [];
  for (const field of fullOptionFields(spec)) {
    if (STRUCTURAL_OPTION_FIELDS.includes(field.key)) continue;
    for (const value of field.allowedValues) {
      const assignment = findValidOptionAssignment(variantKey, spec, { [field.key]: value });
      assert.ok(assignment, variantKey + ': no valid single-option assignment for ' +
        optionValueKey(field.key, value) + '.');
      cases.push(makeFullOptionCase(variantKey, spec, 'single', assignment));
    }
  }
  for (const value of FULL_OPTION_BASIC_TIMES_PROBES) {
    const assignment = findValidOptionAssignment(variantKey, spec, { basicTimes: value });
    assert.ok(assignment, variantKey + ': no valid basicTimes assignment for ' + value + '.');
    cases.push(makeFullOptionCase(variantKey, spec, 'basicTimes', assignment, { baseBeans: value }));
  }
  if (spec.unresolvedFields.includes('playerNum')) {
    for (const value of REQUIRED_PLAYER_COUNTS) {
      const assignment = findValidOptionAssignment(variantKey, spec, { playerNum: value });
      assert.ok(assignment, variantKey + ': no valid playerNum assignment for ' + value + '.');
      cases.push(makeFullOptionCase(variantKey, spec, 'playerNum', assignment));
    }
  }
  return cases;
}

function buildPairwiseOptionPlan(variantKey, spec) {
  const fields = fullOptionPairwiseFields(spec);
  const requiredPairs = [];
  const invalidPairs = [];
  for (let left = 0; left < fields.length; left++) {
    for (let right = left + 1; right < fields.length; right++) {
      for (const leftValue of fields[left].allowedValues) {
        for (const rightValue of fields[right].allowedValues) {
          const assignment = findValidOptionAssignment(variantKey, spec,
            { [fields[left].key]: leftValue, [fields[right].key]: rightValue });
          const key = optionPairKey(fields[left].key, leftValue, fields[right].key, rightValue);
          if (assignment) requiredPairs.push({ key, leftField: fields[left].key, leftValue,
            rightField: fields[right].key, rightValue, assignment });
          else invalidPairs.push({ key, leftField: fields[left].key, leftValue,
            rightField: fields[right].key, rightValue,
            reason: 'No complete assignment satisfies this pair under validateRoomOptions().' });
        }
      }
    }
  }

  const uncovered = new Map(requiredPairs.map(pair => [pair.key, pair]));
  const candidates = new Map();
  for (const pair of requiredPairs) {
    const digest = canonicalDigest(pair.assignment);
    if (!candidates.has(digest)) candidates.set(digest, { assignment: pair.assignment, key: digest });
  }
  const cases = [];
  while (uncovered.size > 0) {
    let selected = null;
    let selectedCovered = [];
    for (const candidate of candidates.values()) {
      const covered = [];
      for (const pair of uncovered.values()) {
        if (candidate.assignment[pair.leftField] === pair.leftValue &&
          candidate.assignment[pair.rightField] === pair.rightValue) covered.push(pair.key);
      }
      if (!selected || covered.length > selectedCovered.length ||
        covered.length === selectedCovered.length && candidate.key < selected.key) {
        selected = candidate;
        selectedCovered = covered;
      }
    }
    assert.ok(selected && selectedCovered.length > 0, variantKey + ': pairwise covering array stalled.');
    cases.push(makeFullOptionCase(variantKey, spec, 'pairwise', selected.assignment));
    for (const key of selectedCovered) uncovered.delete(key);
  }
  return { fields, requiredPairs, invalidPairs, cases };
}

function buildKnownConflictCases(variantKeys) {
  const cases = [];
  const add = (variantKey, assignments, reason, expected = 'valid', rejectionMessageIncludes) => {
    const spec = getRoomSpec(variantKey);
    cases.push(makeFullOptionCase(variantKey, spec, 'conflict', assignments,
      { expected, reason, rejectionMessageIncludes }));
  };
  for (const variantKey of ['9:0', '10:0', '11:0', '12:0']) {
    if (variantKeys.includes(variantKey)) add(variantKey, { playerNum: 4, huRedScore: 300 },
      'player-score client event-order conflict: four-player plus the first score option.');
  }
  for (const variantKey of ['14:0', '15:0']) {
    if (!variantKeys.includes(variantKey)) continue;
    for (const playerNum of REQUIRED_PLAYER_COUNTS) add(variantKey, { playerNum },
      'Unresolved original playerNum is exercised through the RoomService manual 2/3/4 path.');
  }
  if (variantKeys.includes('24:0')) {
    for (const value of [0, 1]) add('24:0', { ownBaKeQiang: value },
      'ownBaKeQiang has conflicting client evidence; both values are exercised.');
  }
  if (variantKeys.includes('20:0')) {
    add('20:0', { maxFan: 99, chaoFanJiaDi: 0 },
      'Uncapped Rongxian requires chaoFanJiaDi=0.');
    add('20:0', { playerNum: 3, daXiaoJia: 0 },
      'Three-player Rongxian requires daXiaoJia=0.');
    add('20:0', { maxFan: 99, chaoFanJiaDi: 1 },
      'Known invalid pair: uncapped maxFan=99 conflicts with chaoFanJiaDi=1.', 'rejected',
      'Uncapped Rongxian requires chaoFanJiaDi=0');
    add('20:0', { playerNum: 3, daXiaoJia: 1 },
      'Known invalid pair: three-player Rongxian conflicts with daXiaoJia=1.', 'rejected',
      'Three-player Rongxian requires daXiaoJia=0');
  }
  return cases;
}

export function buildFullOptionMatrixPlan(entries, specFor = getRoomSpec) {
  assert.ok(Array.isArray(entries) && entries.length > 0, 'Runtime engine entries are required.');
  const variantKeys = entries.map(entry => entry.engine.variantKey);
  assert.equal(new Set(variantKeys).size, variantKeys.length, 'Full-option variants must be unique.');
  const variants = [];
  const cases = [];
  for (const variantKey of variantKeys) {
    const spec = specFor(variantKey);
    const singleCases = buildSingleOptionCases(variantKey, spec);
    const pairwise = buildPairwiseOptionPlan(variantKey, spec);
    variants.push({ variantKey, singleValues: singleOptionValueKeys(variantKey, spec),
      pairwiseFields: pairwise.fields, requiredPairs: pairwise.requiredPairs,
      invalidPairs: pairwise.invalidPairs });
    cases.push(...singleCases, ...pairwise.cases);
  }
  const conflicts = buildKnownConflictCases(variantKeys);
  cases.push(...conflicts);
  for (const [index, item] of cases.entries()) item.id = 'option-' + (index + 1).toString().padStart(4, '0') + '-' +
    item.variantKey.replace(/[^A-Za-z0-9_-]/g, '-') + '-' + item.kind;
  // 3:0 and 101:0 are referenced by the plan's conflict list but are deliberately outside the
  // retained runtime scope. They are recorded as uncovered so the evidence never implies the
  // eight-tens and blood-battle branches were exercised when no runtime engine exists for them.
  const uncovered = [
    { variantKey: '3:0', field: 'eight-tens', scope: 'outside-retained',
      reason: '3:0 (fire-fourteen eight-tens / bage10tianhu) is outside RETAINED_VARIANT_KEYS and has no runtime engine.' },
    { variantKey: '101:0', field: 'blood-battle-routing', scope: 'outside-retained',
      reason: '101:0 (Yaan blood-battle routing) is outside RETAINED_VARIANT_KEYS and has no runtime engine.' },
  ];
  const plan = { schemaVersion: 1, variants, cases, conflicts, uncovered };
  plan.coverage = assertFullOptionCoverage(plan);
  return plan;
}

export function deriveFullOptionCoverage(plan, cases = plan.cases) {
  assert.ok(plan && Array.isArray(plan.variants) && Array.isArray(plan.cases), 'A full-option plan is required.');
  assert.ok(Array.isArray(cases), 'Full-option coverage cases must be an array.');
  const singleRequired = new Set();
  const singleCovered = new Set();
  const pairwiseRequired = new Set();
  const pairwiseCovered = new Set();
  for (const variant of plan.variants) {
    for (const key of variant.singleValues) singleRequired.add(variant.variantKey + '|' + key);
    for (const pair of variant.requiredPairs) pairwiseRequired.add(variant.variantKey + '|' + pair.key);
  }
  const variantByKey = new Map(plan.variants.map(variant => [variant.variantKey, variant]));
  for (const item of cases) {
    if (['single', 'basicTimes', 'playerNum'].includes(item.kind)) {
      for (const [field, value] of Object.entries(item.assignments)) {
        const key = item.variantKey + '|' + optionValueKey(field, value);
        if (singleRequired.has(key)) singleCovered.add(key);
      }
    }
    if (item.kind !== 'pairwise') continue;
    const variant = variantByKey.get(item.variantKey);
    if (!variant) continue;
    const fields = variant.pairwiseFields.map(field => field.key);
    for (let left = 0; left < fields.length; left++) {
      for (let right = left + 1; right < fields.length; right++) {
        const key = optionPairKey(fields[left], item.assignments[fields[left]], fields[right], item.assignments[fields[right]]);
        if (pairwiseRequired.has(item.variantKey + '|' + key)) pairwiseCovered.add(item.variantKey + '|' + key);
      }
    }
  }
  const conflictCases = cases.filter(item => item.kind === 'conflict');
  const missingSingle = [...singleRequired].filter(key => !singleCovered.has(key)).sort();
  const missingPairwise = [...pairwiseRequired].filter(key => !pairwiseCovered.has(key)).sort();
  const missingConflicts = plan.conflicts.map(item => item.id).filter(id => !conflictCases.some(item => item.id === id));
  return { singleValues: { required: singleRequired.size, covered: singleCovered.size, missing: missingSingle },
    pairwise: { required: pairwiseRequired.size, covered: pairwiseCovered.size,
      invalid: plan.variants.reduce((sum, variant) => sum + variant.invalidPairs.length, 0),
      missing: missingPairwise },
    conflicts: { required: plan.conflicts.length, covered: conflictCases.length, missing: missingConflicts },
    uncovered: plan.uncovered.length };
}

export function assertFullOptionCoverage(plan) {
  const coverage = deriveFullOptionCoverage(plan);
  assert.deepEqual(coverage.singleValues.missing, [],
    'Full-option single-value coverage is incomplete: ' + coverage.singleValues.missing.join(', '));
  assert.deepEqual(coverage.pairwise.missing, [],
    'Full-option pairwise coverage is incomplete: ' + coverage.pairwise.missing.join(', '));
  assert.deepEqual(coverage.conflicts.missing, [],
    'Full-option known-conflict coverage is incomplete: ' + coverage.conflicts.missing.join(', '));
  return coverage;
}

// Every settled round must have exactly one settlement operation. A correct global count is not
// enough: one round settling twice and another never settling would still sum to the right total.
export function assertSettlementCoverage(roundIds, operations) {
  assert.ok(Array.isArray(roundIds) && roundIds.length > 0, 'Settlement coverage requires the settled round ids.');
  assert.ok(Array.isArray(operations), 'Settlement coverage requires the settlement operations.');
  const expected = roundIds.map(String);
  assert.equal(new Set(expected).size, expected.length, 'Settled round ids must be unique.');
  const byRound = new Map();
  const operationIds = new Set();
  const requestKeys = new Set();
  for (const operation of operations) {
    assert.ok(operation !== null && typeof operation === 'object', 'Every settlement operation must be an object.');
    assert.ok(operation.roundId !== null && operation.roundId !== undefined && String(operation.roundId).trim() !== '',
      'Every settlement operation must reference a round id.');
    assert.ok(operation.operationId !== null && operation.operationId !== undefined && String(operation.operationId).trim() !== '',
      'Every settlement operation must have an id.');
    assert.ok(operation.requestKey !== null && operation.requestKey !== undefined && String(operation.requestKey).trim() !== '',
      'Every settlement operation must have a request key.');
    const roundId = String(operation.roundId);
    const operationId = String(operation.operationId);
    const requestKey = String(operation.requestKey);
    assert.ok(!operationIds.has(operationId), 'Duplicate settlement operation id ' + operationId + '.');
    assert.ok(!requestKeys.has(requestKey), 'Duplicate settlement request key ' + requestKey + '.');
    operationIds.add(operationId);
    requestKeys.add(requestKey);
    if (!byRound.has(roundId)) byRound.set(roundId, []);
    byRound.get(roundId).push({ roundId, operationId, requestKey });
  }
  const missing = expected.filter(roundId => !byRound.has(roundId));
  const extra = [...byRound.keys()].filter(roundId => !expected.includes(roundId));
  assert.deepEqual(missing, [], 'Rounds without a settlement: ' + missing.join(', '));
  assert.deepEqual(extra, [], 'Settlement operations for unknown rounds: ' + extra.join(', '));
  for (const roundId of expected) {
    assert.equal(byRound.get(roundId).length, 1, 'Round ' + roundId + ' must settle exactly once.');
  }
  return expected.map(roundId => byRound.get(roundId)[0]);
}

// Two independent rebuilds of the same round must agree, otherwise the replay evidence is unsound.
export function assertReplayRebuildStable(first, second, detail) {
  assert.ok(isDeepStrictEqual(first, second), detail + ': two independent replay rebuilds must agree.');
  return canonicalDigest(first);
}

function nonEmptyMatrixIdentifier(value) {
  return (typeof value === 'string' && value.trim().length > 0) ||
    (Number.isSafeInteger(value) && value >= 0);
}

// A single safe directory name below .local. Anything that could escape the workspace, address a
// device/UNC path, or point at a parent directory is rejected before it is ever joined or removed.
export function resolveMatrixRootDirectory(value, fallback = 'room-matrix-v2') {
  const name = value === undefined || value === null ? fallback : value;
  assert.equal(typeof name, 'string', 'ROOM_MATRIX_ROOT must be a string.');
  assert.ok(name.length > 0 && name.length <= 120, 'ROOM_MATRIX_ROOT must be 1-120 characters.');
  assert.ok(name !== '.' && name !== '..', 'ROOM_MATRIX_ROOT must not be a relative path segment.');
  assert.ok(!/[\\/:*?"<>|]/.test(name), 'ROOM_MATRIX_ROOT must be a single directory name without separators.');
  assert.ok(!/^[A-Za-z]:/.test(name) && !name.startsWith('.'), 'ROOM_MATRIX_ROOT must be a plain directory name.');
  return name;
}

export function matrixRootPath(root, value) {
  const directory = resolveMatrixRootDirectory(value);
  const parent = resolve(root, MATRIX_ROOT_DIRECTORY);
  const target = resolve(parent, directory);
  assert.ok(dirname(target) === parent, 'ROOM_MATRIX_ROOT must stay directly below .local.');
  return target;
}

// The lock is exclusive-create, so two matrix runs can never share databases or evidence paths.
export async function acquireMatrixLock(root, { pid = process.pid } = {}) {
  const lockPath = join(root, MATRIX_LOCK_RELATIVE);
  await mkdir(dirname(lockPath), { recursive: true });
  const payload = JSON.stringify({ pid, nonce: createHash('sha256').update(String(Date.now()) + ':' + pid).digest('hex'),
    startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(payload + '\n');
      await handle.close();
      return lockPath;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = JSON.parse(await readFile(lockPath, 'utf8'));
      let alive = false;
      if (Number.isInteger(existing.pid) && existing.pid > 0) {
        try { process.kill(existing.pid, 0); alive = true; }
        catch (probeError) { alive = probeError?.code === 'EPERM'; }
      }
      if (alive) throw new Error('Another complete-room matrix run is active (pid ' + existing.pid + ').');
      await rm(lockPath, { force: true });
    }
  }
  throw new Error('Unable to acquire the complete-room matrix lock.');
}

export async function releaseMatrixLock(lockPath) {
  if (!lockPath) return;
  await rm(lockPath, { force: true });
}

// The frozen subject lives in verification/build-manifest.json. Long acceptance runs must refuse
// to start when the tree has moved past the last build, otherwise the evidence is stale on arrival.
export async function assertFreshBuild(root) {
  const manifest = JSON.parse(await readFile(join(root, BUILD_MANIFEST_RELATIVE), 'utf8'));
  const subject = await releaseSubject(root);
  assert.equal(manifest.sources?.sha256, subject.sources,
    'Source files changed after the last build. Run pnpm build before the acceptance matrix.');
  assert.equal(manifest.binaries?.sha256, subject.binaries,
    'Server binaries changed after the last build. Run pnpm build before the acceptance matrix.');
  return subject;
}

async function publishFile(path, contents) {
  const temporary = path + '.' + process.pid + '.' + Date.now() + '.tmp';
  await writeFile(temporary, contents);
  await rename(temporary, path);
}

async function existingDirectory(path) {
  try { return (await stat(path)).isDirectory(); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function gameMemberIdSet(game) {
  if (!Array.isArray(game.memberIds) || game.memberIds.length !== game.playerCount ||
    !game.memberIds.every(nonEmptyMatrixIdentifier)) return null;
  const ids = game.memberIds.map(String);
  if (new Set(ids).size !== ids.length) return null;
  return new Set(ids);
}

function continuationChainValid(game) {
  const memberIds = gameMemberIdSet(game);
  if (!memberIds || !Array.isArray(game.rounds) || game.rounds.length !== game.configuredRounds) return false;
  return game.rounds.every((round, index) => {
    if (!Number.isInteger(round.number) || round.number !== index + 1 ||
      !memberIds.has(String(round.dealerId)) ||
      !Number.isSafeInteger(round.dealerRun) || round.dealerRun < 1) return false;
    const continuation = round.continuation;
    if (!continuation || typeof continuation !== 'object' ||
      continuation.version !== game.ruleVersion ||
      continuation.completedRound !== round.number ||
      !memberIds.has(String(continuation.nextDealerId)) ||
      !Number.isSafeInteger(continuation.dealerRun) || continuation.dealerRun < 1) return false;
    if (index + 1 < game.rounds.length) {
      const next = game.rounds[index + 1];
      if (!next || next.dealerId !== continuation.nextDealerId || next.dealerRun !== continuation.dealerRun) return false;
    }
    return true;
  });
}

// The four acceptance checks are computed independently so one dimension cannot inherit another's
// pass. Each check is derived from the recorded games, never hardcoded.
export function deriveAcceptanceChecks({ games, variants, retainedKeys = RETAINED_VARIANT_KEYS }) {
  assert.ok(Array.isArray(games), 'Games are required to derive acceptance checks.');
  assert.ok(Array.isArray(variants), 'Variants are required to derive acceptance checks.');
  const gameKeys = new Set(games.map(game => game.variantKey));
  const allConfigurations = games.length > 0 && gameKeys.size === retainedKeys.length &&
    retainedKeys.every(key => gameKeys.has(key));
  const allPlayerCounts = allConfigurations && retainedKeys.every(key => {
    const observed = [...new Set(games.filter(game => game.variantKey === key)
      .map(game => game.playerCount))].sort((a, b) => a - b);
    // The acceptance target is fixed at 2/3/4 regardless of what a variant declares, so a
    // configuration that silently drops a player count cannot pass its own narrow declaration.
    return isDeepStrictEqual(observed, [...REQUIRED_PLAYER_COUNTS]);
  });
  const allRoomRounds = allPlayerCounts && retainedKeys.every(key => {
    return REQUIRED_PLAYER_COUNTS.every(playerCount => {
      const observed = [...new Set(games.filter(game => game.variantKey === key && game.playerCount === playerCount)
        .map(game => game.configuredRounds))].sort((a, b) => a - b);
      return isDeepStrictEqual(observed, [...REQUIRED_ROUND_COUNTS]);
    });
  }) && games.every(game => game.completedRounds === game.configuredRounds &&
    gameMemberIdSet(game) !== null && game.roomState === 'closed' &&
    game.currentRound === game.configuredRounds && game.continuationVerified === true &&
    continuationChainValid(game) &&
    Array.isArray(game.rounds) && game.rounds.length === game.configuredRounds &&
    game.settlementCount === game.configuredRounds && Array.isArray(game.settlements) &&
    game.settlements.length === game.configuredRounds &&
    new Set(game.settlements.map(item => String(item.roundId))).size === game.configuredRounds);
  const realEngineReplay = allRoomRounds && games.every(game => game.replayVerified === true &&
    game.replayStable === true && game.replayRebuilds === 2 &&
    game.replayedRounds === game.configuredRounds &&
    Array.isArray(game.rounds) && game.rounds.every(round => canonicalDigest(round.replay) === round.digest));
  return [
    { id: 'all-configurations', passed: allConfigurations },
    { id: 'all-player-counts', passed: allPlayerCounts },
    { id: 'all-room-rounds', passed: allRoomRounds },
    { id: 'real-engine-replay', passed: realEngineReplay },
  ];
}

export async function runCompleteRoomMatrix() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = createRuntimeEngineRegistry();
  const smoke = process.env.ROOM_MATRIX_SMOKE === '1';
  const selectedVariants = process.env.ROOM_MATRIX_VARIANTS?.split(',').map(value => value.trim()).filter(Boolean);
  const selectedPlayers = process.env.ROOM_MATRIX_PLAYERS?.split(',').map(Number).filter(Number.isInteger);
  const selectedRounds = process.env.ROOM_MATRIX_ROUNDS?.split(',').map(Number).filter(Number.isInteger);

  const retainedKeys = assertRetainedRuntimeEngines(runtimeEngineEntries);
  const variants = buildRetainedMatrixVariants(runtimeEngineEntries);
  const currentEngines = runtimeEngineEntries.map(entry =>
    ({ variantKey: entry.engine.variantKey, version: entry.engine.version }));
  const matrix = buildCanonicalRoomMatrix(variants, currentEngines);
  assertMatrixCoversVariants(matrix, variants);
  const plan = resolveRoomMatrixPlan(matrix, { smoke, variants: selectedVariants, players: selectedPlayers, rounds: selectedRounds });
  assertFormalPlanIsCanonical(plan, matrix);
  const paths = roomMatrixOutputPaths(plan.smokeOnly);
  assertOutputPathsMatchMode(paths, plan.smokeOnly);
  const output = join(root, paths.report);
  const rawOutput = join(root, paths.raw);
  const matrixRoot = matrixRootPath(root, process.env.ROOM_MATRIX_ROOT);
  const games = [];
  const subjectBefore = plan.smokeOnly ? await releaseSubject(root) : await assertFreshBuild(root);
  const subjectBeforeSha256 = subjectBefore.sha256;
  assert.match(subjectBeforeSha256, /^[0-9a-f]{64}$/, 'The build subject must be a SHA-256 digest.');
  // The lock is held across the whole run and both publications. Any failure or interruption
  // releases it in the finally block so a stale lock never blocks the next acceptance run.
  const lockPath = await acquireMatrixLock(root);
  let completed = false;
  try {
   if (await existingDirectory(matrixRoot)) {
     await rm(matrixRoot, { recursive: true, force: true });
   }
   for (const cell of plan.cells) {
    const { variantKey, playerCount, configuredRounds } = cell;
    {
      const directory = join(matrixRoot,
        variantKey.replace(':', '-'), playerCount + '-' + configuredRounds);
      const db = await openDatabase(undefined, join(directory, 'db'));
      try {
        await migrate(db);
        const auth = new AuthService(db), ledger = new LedgerService(db);
        const token = createHash('sha256').update(variantKey + '_' + playerCount + '_' + configuredRounds + '_' + Date.now())
          .digest('hex').slice(0, 12);
        const admin = await auth.create('matrix_' + token, 'test-password-only', 'beans_admin');
        const players = [];
        for (let index = 0; index < playerCount; index++) {
          players.push(await auth.create('matrix_' + token + '_' + index, 'test-password-only'));
        }
        for (const player of players) await ledger.adjust(admin, player.id, '100000',
          'Complete-room matrix credit', 'matrix-' + token + '-' + player.id);
        const rooms = new RoomService(db, runtime, new PolicyService(db));
        const options = { ...cell.normalizedOptions, baseBeans: '0.125' };
        const room = await rooms.create(players[0], variantKey, options);
        for (const player of players.slice(1)) await rooms.join(player, room.code);
        for (const player of players.slice(0, -1)) await rooms.ready(player, room.id, true);
        let view = await rooms.ready(players.at(-1), room.id, true);
        let steps = 0;
        while (view.state !== 'closed') {
          assert.ok(steps++ < 10000, variantKey + ' ' + playerCount + 'p ' + configuredRounds + 'r room must terminate');
          if (view.state === 'between_rounds') {
            for (const player of players.slice(0, -1)) await rooms.ready(player, room.id, true);
            view = await rooms.ready(players.at(-1), room.id, true);
            continue;
          }
          const turn = await Promise.all(players.map(async player => ({ player, view: await rooms.view(room.id, player.id) })));
          const active = turn.find(item => item.view.responseWindow !== null) ??
            turn.find(item => Array.isArray(item.view.legalActions) && item.view.legalActions.length > 0);
          if (!active) {
            const state = await rooms.view(room.id, players[0].id);
            throw new Error(variantKey + ' ' + playerCount + 'p ' + configuredRounds + 'r must expose an action: ' + JSON.stringify({
              state: state.state, currentRound: state.currentRound, roundId: state.roundId,
              stateVersion: state.stateVersion, responseWindow: state.responseWindow,
              game: state.game,
            }));
          }
          const legal = active.view.legalActions;
          const action = legal.find(candidate => candidate.type === 'respond') ?? legal.find(candidate => candidate.type === 'hu')
            ?? legal.find(candidate => candidate.type === 'discard') ?? legal[0];
          view = await rooms.action(active.player, room.id, 'matrix-' + steps, action, view.stateVersion, view.roundId,
            undefined, active.view.responseWindow && action.decisionId ? action.decisionId : undefined);
        }
        const rounds = await db.query('SELECT id,number,state,snapshot,next_round_context FROM rounds WHERE room_id=$1 ORDER BY number', [room.id]);
        assert.equal(rounds.rows.length, configuredRounds);
        assert.deepEqual(rounds.rows.map(round => round.number),
          Array.from({ length: configuredRounds }, (_, index) => index + 1),
          variantKey + ' ' + playerCount + 'p ' + configuredRounds + 'r rounds must be numbered 1..' + configuredRounds);
        assert.equal(new Set(rounds.rows.map(round => String(round.id))).size, configuredRounds,
          'Round ids must be unique within a room.');
        const memberIds = new Set(players.map(player => player.id));
        assert.equal(memberIds.size, playerCount);
        const dealerIds = new Set();
        for (const [index, round] of rounds.rows.entries()) {
          const continuation = round.next_round_context;
          const snapshot = round.snapshot;
          assert.equal(round.number, index + 1, 'Round numbers must be continuous.');
          assert.ok(snapshot && typeof snapshot === 'object', 'Each settled round must retain its final snapshot.');
          assert.ok(memberIds.has(snapshot.dealerId), 'Round dealer must be a room member.');
          assert.ok(Number.isSafeInteger(snapshot.dealerRun) && snapshot.dealerRun >= 1,
            'Round dealerRun must be a positive integer.');
          assert.ok(continuation && typeof continuation === 'object' &&
            continuation.version === room.ruleVersion &&
            continuation.completedRound === round.number &&
            memberIds.has(continuation.nextDealerId) &&
            Number.isSafeInteger(continuation.dealerRun) && continuation.dealerRun >= 1,
            'Settled round continuation context must name the next valid dealer.');
          dealerIds.add(snapshot.dealerId);
          if (index + 1 < rounds.rows.length) {
            const nextSnapshot = rounds.rows[index + 1].snapshot;
            assert.ok(nextSnapshot && typeof nextSnapshot === 'object');
            assert.equal(nextSnapshot.number, round.number + 1, 'Next round snapshot number must continue the room.');
            assert.equal(nextSnapshot.dealerId, continuation.nextDealerId,
              'Next round snapshot must use the prior round continuation dealer.');
            assert.equal(nextSnapshot.dealerRun, continuation.dealerRun,
              'Next round snapshot must use the prior round continuation dealerRun.');
          }
        }
        const continuationVerified = rounds.rows.every((round, index) => {
          const continuation = round.next_round_context;
          return continuation?.completedRound === round.number &&
            (index + 1 === rounds.rows.length ||
              rounds.rows[index + 1].snapshot?.dealerId === continuation.nextDealerId &&
              rounds.rows[index + 1].snapshot?.dealerRun === continuation.dealerRun);
        });
        assert.equal(continuationVerified, true);
        assert.equal(dealerIds.size > 0, true);
        const replayService = new ReplayService(db, runtime);
        const replayedRoundIds = [];
        const roundRecords = [];
        for (const round of rounds.rows) {
          const replay = await replayService.read(players[0], room.id, round.id);
          assert.equal(replay.variantKey, variantKey);
          assert.equal(replay.ruleVersion, room.ruleVersion);
          assert.ok(replay.frames.length >= 1);
          const record = replayRoundRecord(replay);
          // A second, independent rebuild of the same round must reproduce the first exactly.
          const rebuilt = replayRoundRecord(await replayService.read(players[0], room.id, round.id));
          assertReplayRebuildStable(record, rebuilt,
            variantKey + ':' + playerCount + ':' + configuredRounds + ':round:' + round.number);
          roundRecords.push({ roundId: round.id, number: round.number,
            dealerId: round.snapshot.dealerId, dealerRun: round.snapshot.dealerRun,
            continuation: { version: round.next_round_context.version,
              completedRound: round.next_round_context.completedRound,
              nextDealerId: round.next_round_context.nextDealerId,
              dealerRun: round.next_round_context.dealerRun },
            digest: canonicalDigest(record), replay: record });
          replayedRoundIds.push(round.id);
        }
        assert.equal(new Set(replayedRoundIds).size, configuredRounds);
        const settlementRows = await db.query(
          'SELECT id AS "operationId", round_id AS "roundId", request_key AS "requestKey" FROM ledger_operations '
          + "WHERE room_id=$1 AND kind='round_settlement' ORDER BY round_id, id", [room.id]);
        const settlements = assertSettlementCoverage(rounds.rows.map(round => round.id), settlementRows.rows);
        const expectedOptions = cell.normalizedOptions;
        const actualOptions = Object.fromEntries(Object.entries(room.rules ?? {})
          .filter(([key]) => Object.hasOwn(expectedOptions, key)));
        // passed is derived from real comparisons only after the room, options, replays and subject
        // have all been corroborated. Nothing here is hardcoded.
        const passed = room.ruleVersion === cell.ruleVersion &&
          isDeepStrictEqual(actualOptions, expectedOptions) &&
          view.state === 'closed' && view.currentRound === configuredRounds &&
          continuationVerified &&
          rounds.rows.length === configuredRounds &&
          roundRecords.length === configuredRounds &&
          new Set(replayedRoundIds).size === configuredRounds &&
          settlements.length === configuredRounds &&
          roundRecords.every(record => canonicalDigest(record.replay) === record.digest) &&
          /^[0-9a-f]{64}$/.test(subjectBeforeSha256);
        assert.ok(passed, variantKey + ' ' + playerCount + 'p ' + configuredRounds + 'r evidence must corroborate');
        games.push({ variantKey, playerCount, configuredRounds, completedRounds: view.currentRound,
          memberIds: [...memberIds].sort(), roomState: view.state, currentRound: view.currentRound,
          continuationVerified,
          replayVerified: true, replayStable: true, replayRebuilds: 2,
          replayedRounds: replayedRoundIds.length, replayedRoundIds,
          ruleVersion: room.ruleVersion, steps, normalizedOptions: expectedOptions,
          optionsSha256: canonicalDigest(expectedOptions), optionCoverage: cell.optionCoverage,
          rounds: roundRecords, settlementCount: settlements.length, settlements,
          settlementSha256: canonicalDigest(settlements),
          replaySummary: { rounds: roundRecords.length,
            digest: completedGameReplayDigest(roundRecords) },
          subjectBeforeSha256, subjectAfterSha256: subjectBeforeSha256, subjectSha256: subjectBeforeSha256,
          passed });
        console.log(JSON.stringify({ completedCells: games.length, variantKey, playerCount,
          configuredRounds, replayedRounds: replayedRoundIds.length, settlements: settlements.length }));
      } finally {
        await db.close();
        await rm(directory, { recursive: true, force: true });
      }
    }
  }

   const checks = deriveAcceptanceChecks({ games, variants, retainedKeys });
   const expectedCells = plan.smokeOnly ? plan.cells.length : EXPECTED_CELL_COUNT;
   const passed = checks.every(check => check.passed === true) &&
     games.length === plan.cells.length && games.length === expectedCells &&
     games.every(game => game.passed === true) &&
     new Set(games.map(game => game.variantKey + ':' + game.playerCount + ':' + game.configuredRounds)).size === games.length;
   // The build subject must be identical before and after the run, otherwise the evidence is stale.
   const subjectAfter = await releaseSubject(root);
   assert.equal(subjectAfter.sha256, subjectBeforeSha256, 'The build subject changed during the room matrix run.');
   const subject = { sha256: subjectBeforeSha256 };
   const mode = plan.smokeOnly ? 'smoke' : 'acceptance';
   const rawReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: 'Real isolated rooms using the production runtime engine registry; every listed matrix cell completed and replayed.',
    mode,
    smokeOnly: plan.smokeOnly,
    acceptanceEligible: plan.acceptanceEligible,
    matrixDigest: canonicalRoomMatrixDigest(matrix),
    subjectSha256: subject.sha256,
    games,
    summary: { variants: new Set(games.map(game => game.variantKey)).size, games: games.length,
      minSteps: Math.min(...games.map(game => game.steps)), maxSteps: Math.max(...games.map(game => game.steps)) },
    checks,
    passed,
   };
   await mkdir(dirname(rawOutput), { recursive: true });
   await publishFile(rawOutput, JSON.stringify(rawReport, null, 2) + '\n');
   const rawBytes = await readFile(rawOutput);
   const report = {
    schemaVersion: 1,
    mode,
    smokeOnly: plan.smokeOnly,
    acceptanceEligible: plan.acceptanceEligible,
    matrixDigest: rawReport.matrixDigest,
    passed,
    subjectSha256: subject.sha256,
    checks,
    evidence: [{ path: paths.raw,
      sha256: createHash('sha256').update(rawBytes).digest('hex') }],
    games,
    summary: rawReport.summary,
    generatedAt: rawReport.generatedAt,
   };
   await mkdir(dirname(output), { recursive: true });
   await publishFile(output, JSON.stringify(report, null, 2) + '\n');
   completed = true;
   console.log(JSON.stringify({ output, mode, smokeOnly: plan.smokeOnly, acceptanceEligible: plan.acceptanceEligible,
     games: games.length, variants: report.summary.variants,
     minSteps: report.summary.minSteps, maxSteps: report.summary.maxSteps,
     checks: checks.map(check => ({ id: check.id, passed: check.passed })) }));
  } finally {
   if (await existingDirectory(matrixRoot)) await rm(matrixRoot, { recursive: true, force: true });
   await releaseMatrixLock(lockPath);
   if (!completed) console.error('Complete-room matrix run did not publish evidence.');
  }
}

/**
 * A full-option run may be filtered down to a variant subset only in smoke mode. A formal run must
 * execute every planned option case, so a smoke probe can never masquerade as the full coverage.
 */
export function resolveFullOptionCasePlan(plan, { smoke = false, variants = null } = {}) {
  assert.ok(plan && Array.isArray(plan.cases), 'A full-option plan is required.');
  if (variants) {
    assert.equal(smoke, true, 'Full-option variant filters require ROOM_MATRIX_SMOKE=1.');
  }
  const cases = variants ? plan.cases.filter(item => variants.includes(item.variantKey)) : plan.cases;
  assert.ok(cases.length > 0, 'No full-option cases matched the requested filters.');
  const coverage = deriveFullOptionCoverage(plan, cases);
  if (!smoke) {
    assert.deepEqual(coverage.singleValues.missing, [],
      'Full-option single-value coverage is incomplete: ' + coverage.singleValues.missing.join(', '));
    assert.deepEqual(coverage.pairwise.missing, [],
      'Full-option pairwise coverage is incomplete: ' + coverage.pairwise.missing.join(', '));
    assert.deepEqual(coverage.conflicts.missing, [],
      'Full-option known-conflict coverage is incomplete: ' + coverage.conflicts.missing.join(', '));
  }
  return { smoke, smokeOnly: smoke, acceptanceEligible: !smoke, cases, coverage };
}

// Drive a freshly started room until its first round settles. The full-option probe deliberately
// stops after one settled round instead of playing the whole configured series: it exists to prove
// the option combination creates, plays and settles, not to re-run the multi-round acceptance grid.
async function playUntilRoundSettled(rooms, players, room, label) {
  let view = await rooms.view(room.id, players[0].id);
  let steps = 0;
  while (view.state === 'playing') {
    assert.ok(steps++ < 10000, label + ' must terminate');
    const turn = await Promise.all(players.map(async player => ({ player, view: await rooms.view(room.id, player.id) })));
    const active = turn.find(item => item.view.responseWindow !== null) ??
      turn.find(item => Array.isArray(item.view.legalActions) && item.view.legalActions.length > 0);
    if (!active) {
      const state = await rooms.view(room.id, players[0].id);
      throw new Error(label + ' must expose an action: ' + JSON.stringify({
        state: state.state, currentRound: state.currentRound, roundId: state.roundId,
        stateVersion: state.stateVersion, responseWindow: state.responseWindow, game: state.game,
      }));
    }
    const legal = active.view.legalActions;
    const action = legal.find(candidate => candidate.type === 'respond') ?? legal.find(candidate => candidate.type === 'hu')
      ?? legal.find(candidate => candidate.type === 'discard') ?? legal[0];
    view = await rooms.action(active.player, room.id, 'option-' + steps, action, view.stateVersion, view.roundId,
      undefined, active.view.responseWindow && action.decisionId ? action.decisionId : undefined);
  }
  return { view, steps };
}

async function settledRoundIdForRoom(db, roomId, label) {
  const settled = await db.query(
    "SELECT id FROM rounds WHERE room_id=$1 AND state='settled' ORDER BY number DESC LIMIT 1",
    [roomId]);
  assert.equal(settled.rows.length, 1, label + ' must persist exactly one settled round');
  assert.ok(settled.rows[0].id, label + ' settled round must have an id');
  return settled.rows[0].id;
}

async function runFullOptionCase(root, matrixRoot, runtime, item) {
  const label = item.id + ' ' + item.variantKey;
  const directory = join(matrixRoot, item.id);
  const db = await openDatabase(undefined, join(directory, 'db'));
  try {
    await migrate(db);
    const auth = new AuthService(db), ledger = new LedgerService(db);
    const token = createHash('sha256').update(item.id + ':' + Date.now()).digest('hex').slice(0, 12);
    const admin = await auth.create('matrix_admin_' + token, 'test-password-only', 'beans_admin');
    const players = [];
    for (let index = 0; index < item.playerCount; index++) {
      players.push(await auth.create('matrix_' + token + '_' + index, 'test-password-only'));
    }
    for (const player of players) await ledger.adjust(admin, player.id, '100000',
      'Full-option matrix credit', 'matrix-' + token + '-' + player.id);
    const rooms = new RoomService(db, runtime, new PolicyService(db));
    if (item.expected === 'rejected') {
      await assert.rejects(rooms.create(players[0], item.variantKey, { ...item.createOptions }), error => {
        assert.ok(error && typeof error.message === 'string', label + ' rejection must carry a message');
        assert.ok(error.message.includes(item.rejectionMessageIncludes),
          label + ' rejection must mention "' + item.rejectionMessageIncludes + '", got: ' + error.message);
        return true;
      });
      return { id: item.id, variantKey: item.variantKey, kind: item.kind, assignments: item.assignments,
        expected: 'rejected', rejected: true, rejectionMessageIncludes: item.rejectionMessageIncludes,
        playerCount: item.playerCount, configuredRounds: item.configuredRounds, completedRounds: 0,
        settlementCount: 0, replayVerified: false, replayRebuilds: 0, replayDigest: null, steps: 0, passed: true };
    }
    const room = await rooms.create(players[0], item.variantKey, { ...item.createOptions });
    for (const player of players.slice(1)) await rooms.join(player, room.code);
    for (const player of players.slice(0, -1)) await rooms.ready(player, room.id, true);
    let view = await rooms.ready(players.at(-1), room.id, true);
    const played = await playUntilRoundSettled(rooms, players, room, label);
    view = played.view;
    assert.ok(view.state === 'between_rounds' || view.state === 'closed',
      label + ' must reach a settled round, got ' + view.state);
    // RoomService.view() only exposes a roundId while a round is playing. Once the first round
    // settles the room moves to between_rounds and view.roundId is null, so the evidence must read
    // the durable settled round row instead of treating the missing active-round pointer as a bug.
    const settledRoundId = await settledRoundIdForRoom(db, room.id, label);
    const settlementRows = await db.query(
      'SELECT id AS "operationId", round_id AS "roundId", request_key AS "requestKey" FROM ledger_operations '
      + "WHERE room_id=$1 AND kind='round_settlement' ORDER BY round_id, id", [room.id]);
    const settlements = assertSettlementCoverage([settledRoundId], settlementRows.rows);
    const replayService = new ReplayService(db, runtime);
    const replay = await replayService.read(players[0], room.id, settledRoundId);
    assert.equal(replay.variantKey, item.variantKey, label + ' replay variant must match');
    assert.equal(replay.ruleVersion, room.ruleVersion, label + ' replay rule version must match');
    assert.ok(replay.frames.length >= 1, label + ' replay must contain at least one frame');
    const record = replayRoundRecord(replay);
    const rebuilt = replayRoundRecord(await replayService.read(players[0], room.id, settledRoundId));
    assertReplayRebuildStable(record, rebuilt, label + ':round:1');
    const replayDigest = canonicalDigest(record);
    // Close the room so no half-played round is left behind and the dissolve path is exercised too.
    let dissolved = false;
    for (const player of players) {
      const result = await rooms.dissolve(player, room.id, true);
      dissolved = result.closed === true;
    }
    assert.equal(dissolved, true, label + ' must close after a unanimous dissolve');
    const finalView = await rooms.view(room.id, players[0].id);
    assert.equal(finalView.state, 'closed', label + ' must end closed');
    const actualOptions = Object.fromEntries(Object.entries(room.rules ?? {})
      .filter(([key]) => Object.hasOwn(item.expectedReadback, key)));
    const readbackMatches = isDeepStrictEqual(actualOptions, item.expectedReadback);
    const sourceMatches = room.baseBeansSource === item.expectedBaseBeansSource &&
      room.playerNumSource === item.expectedPlayerNumSource &&
      room.baseBeans === item.baseBeans;
    const passed = readbackMatches && sourceMatches && settlements.length === 1 &&
      view.currentRound === 1 && canonicalDigest(record) === replayDigest &&
      finalView.state === 'closed';
    assert.ok(readbackMatches, label + ' option readback must equal the requested options: ' +
      JSON.stringify({ expected: item.expectedReadback, actual: actualOptions }));
    assert.ok(sourceMatches, label + ' baseBeans/playerNum source must match: ' +
      JSON.stringify({ baseBeans: room.baseBeans, baseBeansSource: room.baseBeansSource,
        playerNumSource: room.playerNumSource }));
    assert.ok(passed, label + ' evidence must corroborate');
    return { id: item.id, variantKey: item.variantKey, kind: item.kind, assignments: item.assignments,
      expected: 'valid', rejected: false, playerCount: item.playerCount, configuredRounds: item.configuredRounds,
      completedRounds: view.currentRound, settlementCount: settlements.length, settlements,
      normalizedOptions: item.expectedReadback, readback: actualOptions,
      baseBeans: room.baseBeans, baseBeansSource: room.baseBeansSource, playerNumSource: room.playerNumSource,
      replayVerified: true, replayRebuilds: 2, replayDigest, steps: played.steps, passed };
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runFullOptionMatrix() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = createRuntimeEngineRegistry();
  const smoke = process.env.ROOM_MATRIX_SMOKE === '1';
  const selectedVariants = process.env.ROOM_MATRIX_VARIANTS?.split(',').map(value => value.trim()).filter(Boolean);
  const plan = buildFullOptionMatrixPlan(runtimeEngineEntries);
  const casePlan = resolveFullOptionCasePlan(plan, { smoke, variants: selectedVariants ?? null });
  const paths = fullOptionMatrixOutputPaths(casePlan.smokeOnly);
  assertOutputPathsMatchMode(paths, casePlan.smokeOnly);
  const output = join(root, paths.report);
  const rawOutput = join(root, paths.raw);
  const matrixRoot = matrixRootPath(root, process.env.ROOM_MATRIX_ROOT);
  const subjectBefore = casePlan.smokeOnly ? await releaseSubject(root) : await assertFreshBuild(root);
  const subjectBeforeSha256 = subjectBefore.sha256;
  assert.match(subjectBeforeSha256, /^[0-9a-f]{64}$/, 'The build subject must be a SHA-256 digest.');
  const lockPath = await acquireMatrixLock(root);
  const executedCases = [];
  let completed = false;
  try {
    if (await existingDirectory(matrixRoot)) await rm(matrixRoot, { recursive: true, force: true });
    for (const item of casePlan.cases) {
      const record = await runFullOptionCase(root, matrixRoot, runtime, item);
      executedCases.push(record);
      console.log(JSON.stringify({ completedCases: executedCases.length, id: item.id,
        variantKey: item.variantKey, kind: item.kind, expected: item.expected, passed: record.passed }));
    }
    const coverage = deriveFullOptionCoverage(plan, casePlan.cases);
    const validCases = executedCases.filter(item => item.expected === 'valid');
    const rejectedCases = executedCases.filter(item => item.expected === 'rejected');
    const passed = executedCases.every(item => item.passed === true) &&
      validCases.every(item => item.settlementCount === 1 && item.completedRounds === 1 && item.replayVerified === true) &&
      rejectedCases.every(item => item.rejected === true) &&
      (casePlan.smokeOnly || (coverage.singleValues.missing.length === 0 &&
        coverage.pairwise.missing.length === 0 && coverage.conflicts.missing.length === 0));
    const subjectAfter = await releaseSubject(root);
    assert.equal(subjectAfter.sha256, subjectBeforeSha256, 'The build subject changed during the full-option matrix run.');
    const mode = casePlan.smokeOnly ? 'full-options-smoke' : 'full-options';
    const rawReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scope: 'Per-configuration option value and pairwise coverage using real isolated rooms; each valid case completes one settled round and is dissolved, each invalid case is rejected.',
      mode,
      smokeOnly: casePlan.smokeOnly,
      acceptanceEligible: casePlan.acceptanceEligible,
      subjectSha256: subjectBeforeSha256,
      cases: executedCases,
      coverage,
      uncovered: plan.uncovered,
      summary: {
        variants: new Set(executedCases.map(item => item.variantKey)).size,
        cases: executedCases.length,
        validCases: validCases.length,
        rejectedCases: rejectedCases.length,
        settledRounds: validCases.length,
        replayRebuilds: validCases.length * 2,
      },
      passed,
    };
    await mkdir(dirname(rawOutput), { recursive: true });
    await publishFile(rawOutput, JSON.stringify(rawReport, null, 2) + '\n');
    const rawBytes = await readFile(rawOutput);
    const report = {
      schemaVersion: 1,
      mode,
      smokeOnly: casePlan.smokeOnly,
      acceptanceEligible: casePlan.acceptanceEligible,
      passed,
      subjectSha256: subjectBeforeSha256,
      coverage,
      uncovered: plan.uncovered,
      summary: rawReport.summary,
      evidence: [{ path: paths.raw, sha256: createHash('sha256').update(rawBytes).digest('hex') }],
      cases: executedCases,
      generatedAt: rawReport.generatedAt,
    };
    await mkdir(dirname(output), { recursive: true });
    await publishFile(output, JSON.stringify(report, null, 2) + '\n');
    completed = true;
    console.log(JSON.stringify({ output, mode, smokeOnly: casePlan.smokeOnly,
      acceptanceEligible: casePlan.acceptanceEligible, cases: executedCases.length,
      coverage, passed }));
  } finally {
    if (await existingDirectory(matrixRoot)) await rm(matrixRoot, { recursive: true, force: true });
    await releaseMatrixLock(lockPath);
    if (!completed) console.error('Full-option matrix run did not publish evidence.');
  }
}

const invokedDirectly = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedDirectly) {
  if (process.env.ROOM_MATRIX_MODE === 'full-options') await runFullOptionMatrix();
  else await runCompleteRoomMatrix();
}
