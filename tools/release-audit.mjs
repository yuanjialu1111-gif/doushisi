import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { sha256 } from './build-fingerprint.mjs';
import { rulebookContentSha256 } from './rulebook-integrity.mjs';
import { stabilityChecks } from './run-local-stability.mjs';
import { runSettlementRegressions } from './settlement-regressions.mjs';

const { RETAINED_VARIANT_KEYS } = await import(pathToFileURL(new URL('../packages/rules/dist/index.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href);

const baseCoverage = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'draw', 'timeout', 'reconnect', 'privacy'];
const canonicalHashPattern = /^[0-9a-f]{64}$/;
export const CANONICAL_PLAYER_COUNTS = Object.freeze([2, 3, 4]);
export const CANONICAL_ROUND_COUNTS = Object.freeze([4, 8, 12]);
export const CANONICAL_VARIANT_KEYS = RETAINED_VARIANT_KEYS;
export const CANONICAL_CELL_COUNT = CANONICAL_VARIANT_KEYS.length * CANONICAL_PLAYER_COUNTS.length * CANONICAL_ROUND_COUNTS.length;
export const acceptanceRequirements = Object.freeze({
  'original-ui-comparison.json': ['retained-layout', 'fonts-and-decimals', 'animations', 'comparison-provenance'],
  'postgres-concurrency.json': ['exact-decimals', 'fee-once', 'settlement-once', 'negative-balance', 'admin-concurrency', 'dissolve-earned-scores', 'role-isolation'],
  'gameplay-capacity.json': ['actual-gameplay', 'candidate-deal-32', 'reconnection', 'no-ledger-errors', 'no-state-loss'],
  'native-end-to-end.json': ['register', 'beans-credit', 'create-and-join', 'completed-round', 'settlement', 'auto-play', 'reconnect', 'animated-replay', 'gps', 'quick-voice', 'standalone-network'],
  'original-network-isolation.json': ['old-domains-blocked', 'gameplay', 'reconnect', 'update-path'],
});
export const localAcceptanceRequirements = Object.freeze({
  'local-ui.json': acceptanceRequirements['original-ui-comparison.json'],
  'local-accounting.json': [...acceptanceRequirements['postgres-concurrency.json'], 'payer-half-up-12', 'derived-large-amounts'],
  'local-native.json': [...acceptanceRequirements['native-end-to-end.json'], 'two-physical-android-devices', 'lan-without-adb'],
  'local-network.json': acceptanceRequirements['original-network-isolation.json'],
  'local-recovery.json': ['service-restart', 'isolated-restore', 'ledger-reconciled', 'old-rule-version', 'daily-backup-catchup'],
  'local-stability.json': acceptanceRequirements['gameplay-capacity.json'],
  'local-completed-games.json': ['all-configurations', 'all-player-counts', 'all-room-rounds', 'real-engine-replay'],
});

function ensure(condition, code, detail) {
  if (!condition) throw Object.assign(new Error(detail), { code });
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(item => canonicalJson(item) ?? 'null').join(',') + ']';
  }
  return '{' + Object.keys(value).sort().flatMap(key => {
    const encoded = canonicalJson(value[key]);
    return encoded === undefined ? [] : [JSON.stringify(key) + ':' + encoded];
  }).join(',') + '}';
}

export function canonicalDigest(value) {
  return sha256(canonicalJson(value));
}

function parseOptionCoverage(value) {
  if (typeof value !== 'string' || !value.startsWith('option:')) return null;
  const separator = value.indexOf('=', 'option:'.length);
  const field = separator === -1 ? '' : value.slice('option:'.length, separator);
  ensure(/^[A-Za-z_$][\w$]*$/.test(field), 'INVALID_OPTION_COVERAGE', value);
  let parsed;
  try { parsed = JSON.parse(value.slice(separator + 1)); }
  catch { ensure(false, 'INVALID_OPTION_COVERAGE', value); }
  return { field, value: parsed, label: value };
}

function fieldsFromOriginal(variant) {
  const original = variant?.original;
  if (!original || typeof original !== 'object' || !original.rule || typeof original.rule !== 'object') return [];
  const fields = [];
  for (const group of Object.values(original.rule)) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.config)) continue;
    if (group.multiple) {
      for (const option of group.config) {
        if (typeof option.value !== 'string') continue;
        fields.push({ key: option.value, defaultValue: option.default ? 1 : 0, allowedValues: [0, 1] });
      }
      continue;
    }
    const defaults = group.config.filter(option => option.default);
    if (!group.param || defaults.length !== 1 || group.config.some(option => typeof option.value === 'string')) continue;
    fields.push({ key: group.param, defaultValue: defaults[0].value, allowedValues: group.config.map(option => option.value) });
  }
  if (variant.gameId === 2) {
    fields.push({ key: 'yifupai', defaultValue: variant.configurationIndex === 0, allowedValues: [variant.configurationIndex === 0] });
  }
  if (variant.gameId === 101) {
    const previous = fields.findIndex(field => field.key === 'processType');
    if (previous >= 0) fields.splice(previous, 1);
    fields.push({ key: 'processType', defaultValue: 2, allowedValues: [2] });
  }
  if (variant.gameId === 3) {
    const field = fields.find(item => item.key === 'bage10tianhu');
    if (field) field.defaultValue = 0;
  }
  if ([9, 10, 12].includes(variant.gameId)) {
    const field = fields.find(item => item.key === 'baipiType');
    if (field) field.allowedValues = [1];
  }
  return fields;
}

function canonicalFields(variant) {
  if (Array.isArray(variant.fields) && variant.fields.length > 0) return variant.fields;
  if (variant.defaults !== null && typeof variant.defaults === 'object' && !Array.isArray(variant.defaults)) {
    return Object.entries(variant.defaults).map(([key, defaultValue]) => ({ key, defaultValue, allowedValues: [defaultValue] }));
  }
  const fields = fieldsFromOriginal(variant);
  const known = new Set(fields.map(field => field.key));
  const covered = new Map();
  for (const label of variant.optionCoverage ?? []) {
    const parsed = parseOptionCoverage(label);
    if (!parsed || known.has(parsed.field)) continue;
    if (!covered.has(parsed.field)) covered.set(parsed.field, []);
    if (!covered.get(parsed.field).includes(parsed.value)) covered.get(parsed.field).push(parsed.value);
  }
  for (const [key, allowedValues] of covered) {
    const defaultValue = key.startsWith('ql') && allowedValues.includes(1) ? 1 : allowedValues[0];
    fields.push({ key, defaultValue, allowedValues });
  }
  return fields;
}

function optionCoverageLabels(fields) {
  return fields.flatMap(field => field.allowedValues.map(value =>
    `option:${field.key}=${JSON.stringify(value)}`));
}

function canonicalOptionCoverage(variant, fields = canonicalFields(variant)) {
  const source = Array.isArray(variant.optionCoverage) ? variant.optionCoverage : optionCoverageLabels(fields);
  const labels = source.filter(value => typeof value === 'string' && value.startsWith('option:'));
  for (const label of labels) parseOptionCoverage(label);
  return [...new Set(labels)].sort();
}

function normalizedOptionSource(variant, playerCount, configuredRounds, useCardType, fields = canonicalFields(variant)) {
  const options = {};
  for (const field of fields) options[field.key] = field.defaultValue;
  options.playerNum = playerCount;
  options.gameNum = configuredRounds;
  if (fields.some(field => field.key === 'useCardType')) options.useCardType = useCardType;
  if (variant.key === '20:0' && playerCount === 3) options.daXiaoJia = 0;
  return Object.fromEntries(Object.entries(options).sort(([left], [right]) => left.localeCompare(right)));
}

function canonicalCellKey(variantKey, playerCount, configuredRounds) {
  return `${variantKey}:${playerCount}:${configuredRounds}`;
}

function expectedUseCardTypeCells(variants) {
  const target = variants.find(variant => variant.key === '4:0');
  if (!target) return new Set();
  const field = canonicalFields(target).find(item => item.key === 'useCardType');
  ensure(field && field.allowedValues.some(value => value === 1), 'COMPLETE_ROOM_PLAN_INVALID',
    'The canonical room matrix must include 4:0 with useCardType=1.');
  // The special option cell is anchored on the canonical grid, never on declaration order.
  const playerCount = CANONICAL_PLAYER_COUNTS[0];
  const configuredRounds = CANONICAL_ROUND_COUNTS[0];
  return new Set([canonicalCellKey(target.key, playerCount, configuredRounds)]);
}

export function buildCanonicalRoomMatrix(variants, currentEngines = []) {
  ensure(Array.isArray(variants) && variants.length > 0, 'COMPLETE_ROOM_PLAN_INVALID', 'Room variants are required.');
  // The acceptance grid is a fixed, independently-verifiable contract. Never derive it from whatever
  // counts a variant happens to declare: that lets a narrowed configuration shrink the target.
  ensure(variants.length === CANONICAL_VARIANT_KEYS.length, 'COMPLETE_ROOM_PLAN_INVALID',
    'The canonical room matrix must cover exactly ' + CANONICAL_VARIANT_KEYS.length + ' configurations.');
  const variantKeys = variants.map(variant => variant.key);
  ensure(new Set(variantKeys).size === variantKeys.length, 'COMPLETE_ROOM_PLAN_INVALID',
    'Canonical room matrix variants must be unique.');
  const missingVariants = CANONICAL_VARIANT_KEYS.filter(key => !variantKeys.includes(key));
  const extraVariants = variantKeys.filter(key => !CANONICAL_VARIANT_KEYS.includes(key));
  ensure(missingVariants.length === 0 && extraVariants.length === 0, 'COMPLETE_ROOM_PLAN_INVALID',
    'Canonical room matrix variants must be exactly the retained scope.');
  const current = new Map(currentEngines.map(entry => [entry.variantKey ?? entry.engine?.variantKey, entry.version ?? entry.engine?.version]));
  const useCardTypeOneCells = expectedUseCardTypeCells(variants);
  const cells = [];
  for (const variant of variants) {
    const fields = canonicalFields(variant);
    const engineVersion = current.get(variant.key) ?? variant.version ?? variant.ruleVersion;
    ensure(typeof engineVersion === 'string' && engineVersion.trim(), 'COMPLETE_ROOM_PLAN_INVALID',
      `${variant.key}: current runtime engine version is required.`);
    // A declared count that cannot cover the canonical grid is a hard failure. Extra declared values
    // are tolerated here because the canonical grid is the acceptance target, but every canonical
    // value must be declared so the room spec genuinely supports the cells being evidenced.
    for (const playerCount of CANONICAL_PLAYER_COUNTS) {
      ensure(variant.playerCounts === undefined || variant.playerCounts.includes(playerCount),
        'COMPLETE_ROOM_PLAN_INVALID', `${variant.key}: playerNum=${playerCount} is not declared by the room spec.`);
      for (const configuredRounds of CANONICAL_ROUND_COUNTS) {
        ensure(variant.roundCounts === undefined || variant.roundCounts.includes(configuredRounds),
          'COMPLETE_ROOM_PLAN_INVALID', `${variant.key}: gameNum=${configuredRounds} is not declared by the room spec.`);
        const key = canonicalCellKey(variant.key, playerCount, configuredRounds);
        const useCardType = useCardTypeOneCells.has(key) ? 1 : 2;
        const normalizedOptions = normalizedOptionSource(variant, playerCount, configuredRounds, useCardType, fields);
        cells.push({ key, variantKey: variant.key, playerCount, configuredRounds, ruleVersion: engineVersion,
          normalizedOptions, optionsSha256: canonicalDigest(normalizedOptions),
          optionCoverage: canonicalOptionCoverage(variant, fields) });
      }
    }
  }
  ensure(cells.length === CANONICAL_CELL_COUNT, 'COMPLETE_ROOM_PLAN_INVALID',
    'The canonical room matrix must contain exactly ' + CANONICAL_CELL_COUNT + ' cells.');
  return { schemaVersion: 1, cells, optionCoverage: [...new Set(cells.flatMap(cell => cell.optionCoverage))].sort() };
}

export function canonicalRoomMatrixDigest(matrix) {
  ensure(matrix !== null && typeof matrix === 'object' && Array.isArray(matrix.cells), 'COMPLETE_ROOM_PLAN_INVALID',
    'Canonical room matrix must contain cells.');
  // The matrix is a multiset of cells, so cell order must not change the digest. Otherwise the
  // runner (runtime registry order) and the verifier (catalogue order) would disagree about the
  // exact same evidence.
  const cells = matrix.cells.map(cell => ({ key: cell.key, variantKey: cell.variantKey, playerCount: cell.playerCount,
    configuredRounds: cell.configuredRounds, ruleVersion: cell.ruleVersion,
    normalizedOptions: cell.normalizedOptions, optionsSha256: cell.optionsSha256, optionCoverage: cell.optionCoverage }))
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
  return canonicalDigest({ schemaVersion: matrix.schemaVersion ?? 1, cells });
}

/** Formal and smoke artifacts never share a path, so a smoke run can never satisfy acceptance. */
export function roomMatrixOutputPaths(smoke) {
  return smoke
    ? { report: 'verification/local-completed-games-smoke.json', raw: 'verification/raw/local-completed-games-smoke.json' }
    : { report: 'verification/local-completed-games.json', raw: 'verification/raw/local-completed-games.json' };
}

/**
 * Full matrix by default. Variant/player/round filters are a smoke-only convenience and must be
 * requested with ROOM_MATRIX_SMOKE=1; the caller is responsible for writing smoke-only paths.
 */
export function resolveRoomMatrixPlan(matrix, { smoke = false, variants = null, players = null, rounds = null } = {}) {
  ensure(matrix !== null && typeof matrix === 'object' && Array.isArray(matrix.cells), 'COMPLETE_ROOM_PLAN_INVALID',
    'Canonical room matrix must contain cells.');
  const subset = Boolean(variants || players || rounds);
  ensure(!subset || smoke, 'ROOM_MATRIX_SUBSET_REQUIRES_SMOKE',
    'Variant, player-count and round-count filters require ROOM_MATRIX_SMOKE=1.');
  const cells = matrix.cells.filter(cell => (!variants || variants.includes(cell.variantKey)) &&
    (!players || players.includes(cell.playerCount)) && (!rounds || rounds.includes(cell.configuredRounds)));
  ensure(cells.length > 0, 'ROOM_MATRIX_PLAN_EMPTY', 'No room matrix cells matched the requested filters.');
  return { smoke, smokeOnly: smoke, acceptanceEligible: !smoke, cells };
}

function readPath(value, path) {
  ensure(typeof path === 'string' && /^(?:[A-Za-z_$][\w$]*|\d+)(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(path) &&
    !path.split('.').some(segment => ['__proto__', 'constructor', 'prototype'].includes(segment)),
    'INVALID_REFERENCE_ASSERTION', 'Assertion paths must be simple dot paths.');
  let current = value;
  for (const segment of path.split('.')) {
    ensure(current !== null && typeof current === 'object' && Object.hasOwn(current, segment),
      'REFERENCE_ASSERTION_MISMATCH', path);
    current = current[segment];
  }
  return current;
}

const runtimeStructuralCoverage = new Set(['deck', 'deal', 'actions', 'priority', 'timeout', 'reconnect', 'privacy']);

function optionLabel(value) {
  return typeof value === 'string' ? value : canonicalJson(value);
}

function optionEvidenceFromSnapshot(snapshot, field, value) {
  const rules = snapshot?.rules;
  return rules !== null && typeof rules === 'object' && !Array.isArray(rules) &&
    Object.hasOwn(rules, field) && isDeepStrictEqual(rules[field], value);
}

function isOptionRulesPath(path, field) {
  const segments = path.split('.');
  return (segments.length === 2 && segments[0] === 'rules' && segments[1] === field) ||
    (segments.length === 3 && segments[0] === 'snapshot' && segments[1] === 'rules' && segments[2] === field);
}

function expectedOptionEvidence(expected, field, value) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return false;
  if (expected.rules && Object.hasOwn(expected.rules, field) && isDeepStrictEqual(expected.rules[field], value)) return true;
  return Boolean(expected.snapshot?.rules && Object.hasOwn(expected.snapshot.rules, field) &&
    isDeepStrictEqual(expected.snapshot.rules[field], value));
}

function optionEvidenceFromAssertion(assertion, field, value) {
  if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) return false;
  for (const [path, expected] of Object.entries(assertion)) {
    if (isOptionRulesPath(path, field) && isDeepStrictEqual(expected, value)) return true;
  }
  return expectedOptionEvidence(assertion, field, value);
}

function nestedEvidence(value, predicate, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (predicate(value)) return true;
  for (const child of Object.values(value)) {
    if (nestedEvidence(child, predicate, seen)) return true;
  }
  return false;
}

function assertionHasTerminalEvidence(assertion, reason) {
  if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) return false;
  for (const [path, expected] of Object.entries(assertion)) {
    const segments = path.split('.');
    if (expected !== reason) continue;
    if (segments.at(-1) === 'phase' && ['hu', 'draw'].includes(reason)) return true;
    if (segments.length >= 2 && segments.at(-2) === 'outcome' && segments.at(-1) === 'reason') return true;
  }
  return nestedEvidence(assertion, value => value?.outcome?.reason === reason ||
    (['hu', 'draw'].includes(reason) && value?.phase === reason));
}

function terminalEvidence(assertions, results, reason) {
  if (assertions.some(assertion => assertionHasTerminalEvidence(assertion, reason))) return true;
  return results.some(result => nestedEvidence(result, value => value?.outcome?.reason === reason ||
    (['hu', 'draw'].includes(reason) && value?.phase === reason)));
}

function winningEvidence(assertions, results) {
  return terminalEvidence(assertions, results, 'hu');
}

function drawEvidence(assertions, results) {
  return terminalEvidence(assertions, results, 'draw');
}

function hasWildcardEvidence(value) {
  return Array.isArray(value?.wildcardUses) && value.wildcardUses.length > 0;
}

function wildcardEvidence(assertions, results) {
  for (const assertion of assertions) {
    if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) continue;
    if (nestedEvidence(assertion, hasWildcardEvidence)) return true;
  }
  return results.some(result => nestedEvidence(result, hasWildcardEvidence));
}

function evidenceValues(assertions, results) {
  return [...assertions, ...results];
}

function hasGoldHookEvidence(value) {
  if (value === null || typeof value !== 'object') return false;
  if (value.jinGouDiao === true || value.facts?.jinGouDiao === true) return true;
  return Array.isArray(value.items) && value.items.some(item => item?.pattern === 'jinGouDiao' &&
    Number(item.count) > 0 && Number(item.fan) > 0);
}

function goldHookEvidence(assertions, results) {
  return evidenceValues(assertions, results).some(value => nestedEvidence(value, hasGoldHookEvidence));
}

function declaredWaitLockEvidence(assertions, results, rejectedCodes) {
  const hasDeclaration = evidenceValues(assertions, results).some(value => nestedEvidence(value,
    item => Array.isArray(item?.declaredWaits) && item.declaredWaits.length > 0));
  return hasDeclaration && rejectedCodes.has('INVALID_ACTION');
}

function hasConcealedFourPairsEvidence(value) {
  if (value === null || typeof value !== 'object') return false;
  return value.structure === 'four-pairs' || value.concealedFourPairs !== undefined &&
    value.concealedFourPairs !== null || value.facts?.concealedFourPairs !== undefined &&
    value.facts.concealedFourPairs !== null;
}

function concealedFourPairsEvidence(assertions, results) {
  return evidenceValues(assertions, results).some(value => nestedEvidence(value, hasConcealedFourPairsEvidence));
}

function decimalValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function balancedPostings(postings) {
  if (!Array.isArray(postings) || postings.length === 0) return false;
  let total = 0;
  for (const posting of postings) {
    if (!posting || typeof posting !== 'object' || typeof posting.userId !== 'string' || !posting.userId.trim()) return false;
    const amount = decimalValue(posting.amount);
    if (amount === null) return false;
    total += amount;
  }
  return Math.abs(total) < 1e-12;
}

function postingMap(postings) {
  const result = new Map();
  for (const posting of postings) {
    result.set(posting.userId, (result.get(posting.userId) ?? 0) + decimalValue(posting.amount));
  }
  return result;
}

function balancedTransfers(postings, transfers) {
  if (!Array.isArray(transfers) || transfers.length === 0) return false;
  const totals = new Map();
  for (const transfer of transfers) {
    if (!transfer || typeof transfer !== 'object' || typeof transfer.payerId !== 'string' ||
      typeof transfer.payeeId !== 'string' || transfer.payerId === transfer.payeeId) return false;
    const numerator = decimalValue(transfer.numerator);
    const denominator = decimalValue(transfer.denominator);
    if (numerator === null || denominator === null || denominator === 0) return false;
    const amount = numerator / denominator;
    if (!Number.isFinite(amount) || amount <= 0) return false;
    totals.set(transfer.payerId, (totals.get(transfer.payerId) ?? 0) - amount);
    totals.set(transfer.payeeId, (totals.get(transfer.payeeId) ?? 0) + amount);
  }
  const expected = postingMap(postings);
  if (expected.size !== totals.size) return false;
  for (const [userId, amount] of expected) {
    if (Math.abs((totals.get(userId) ?? 0) - amount) > 1e-9) return false;
  }
  return true;
}

function paymentEvidence(assertions, results) {
  return evidenceValues(assertions, results).some(value => nestedEvidence(value, item => {
    if (!item || typeof item !== 'object') return false;
    const candidates = [item, ...(Array.isArray(item.confirmedScores) ? item.confirmedScores : [])];
    if (Array.isArray(item.outcome?.payments?.postings)) candidates.push(item.outcome.payments);
    return candidates.some(candidate => balancedPostings(candidate?.postings) &&
      balancedTransfers(candidate.postings, candidate.transfers));
  }));
}

function thresholdEvidence(assertions, results, field, winning) {
  let below = false, above = false;
  for (const value of evidenceValues(assertions, results)) {
    nestedEvidence(value, item => {
      const score = Number(item?.[field]);
      if (!Number.isFinite(score)) return false;
      if (item.status === 'winning') above = true;
      if (item.status === 'not-winning' && ['red-score', 'minimum-fan'].includes(item.reason)) below = true;
      return false;
    });
  }
  return winning ? above && below : below;
}

function hasPiaoEvidence(value) {
  if (value === null || typeof value !== 'object') return false;
  if (value.type === 'piao' && typeof value.userId === 'string' && [0, 1].includes(value.value)) return true;
  if (value.pattern === 'piao' && Number(value.count) > 0 && Number(value.fan) > 0) return true;
  return false;
}

function piaoEvidence(assertions, results) {
  return evidenceValues(assertions, results).some(value => nestedEvidence(value, hasPiaoEvidence));
}

function hasScoringEvidence(value) {
  if (value === null || typeof value !== 'object') return false;
  return (Array.isArray(value.settlement) && value.settlement.length > 0) ||
    (Array.isArray(value.confirmedScores) && value.confirmedScores.length > 0) ||
    (value.scoreUnits !== undefined && value.scoreUnits !== null && value.scoreUnits !== '');
}

function scoringEvidence(assertions, results) {
  for (const assertion of assertions) {
    if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) continue;
    if (nestedEvidence(assertion, hasScoringEvidence)) return true;
  }
  return results.some(result => nestedEvidence(result, hasScoringEvidence));
}

function localNativeDeviceText(device) {
  const values = [device.id, device.serial, device.manufacturer, device.model, device.hardware, device.board,
    device.platformName, device.fingerprint, device.characteristics];
  if (device.properties && typeof device.properties === 'object') values.push(...Object.values(device.properties));
  return values.filter(value => value !== null && value !== undefined)
    .map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
}

function finiteNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function nonEmptyObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function nonEmptyIdentifier(value) {
  return (typeof value === 'string' && value.trim().length > 0) || finiteNonNegativeInteger(value);
}

function timestampValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function protocolName(value) {
  if (typeof value === 'string') return value.toLowerCase().replace(/[^a-z]/g, '');
  if (value !== null && typeof value === 'object') {
    for (const key of ['name', 'protocol', 'type']) {
      if (typeof value[key] === 'string') return protocolName(value[key]);
    }
  }
  return '';
}

function percentile95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function reconnectCountEntries(metrics) {
  const entries = [];
  const collect = (value, fallbackClientId) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    const count = value.reconnectCount;
    if (!Number.isInteger(count) || count < 0) return;
    const clientId = value.clientId ?? value.id ?? fallbackClientId;
    if (clientId === undefined || clientId === null || String(clientId).trim() === '') return;
    entries.push({ clientId: String(clientId), count });
  };
  if (Array.isArray(metrics.clients)) metrics.clients.forEach(value => collect(value));
  if (Array.isArray(metrics.reconnectCounts)) metrics.reconnectCounts.forEach(value => collect(value));
  if (metrics.reconnectCounts !== null && typeof metrics.reconnectCounts === 'object' &&
    !Array.isArray(metrics.reconnectCounts)) {
    for (const [clientId, value] of Object.entries(metrics.reconnectCounts)) {
      if (Number.isInteger(value) && value >= 0) entries.push({ clientId, count: value });
      else collect(value, clientId);
    }
  }
  if (Array.isArray(metrics.reconnectSamples)) {
    for (const sample of metrics.reconnectSamples) collect(sample);
  }
  return entries;
}

function evidenceDescriptors(report) {
  return Array.isArray(report.evidence) ? report.evidence.filter(descriptor => descriptor && typeof descriptor.path === 'string') : [];
}

async function readEvidenceJson(root, report, expectedName) {
  const descriptors = evidenceDescriptors(report).filter(descriptor => descriptor.path.endsWith('/' + expectedName));
  ensure(descriptors.length === 1, 'ACCEPTANCE_EVIDENCE_MISSING', expectedName);
  const bytes = await readArtifact(root, descriptors[0]);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { ensure(false, 'ACCEPTANCE_EVIDENCE_INVALID', expectedName); }
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0,
    'ACCEPTANCE_EVIDENCE_INVALID', expectedName);
  return value;
}

function assertEvidenceMatchesSubject(raw, report, name) {
  if (!Object.hasOwn(raw, 'subjectSha256')) return;
  const expected = isNativeAcceptanceReport(name) ? report.subjectAfterSha256 : report.subjectSha256;
  ensure(raw.subjectSha256 === expected, 'ACCEPTANCE_EVIDENCE_MISMATCH', name + ':subjectSha256');
}

function isNativeAcceptanceReport(name) {
  return name === 'local-native.json' || name === 'native-end-to-end.json';
}

function rawCheckIndex(raw, name) {
  ensure(Array.isArray(raw.checks) && raw.checks.length > 0, 'ACCEPTANCE_EVIDENCE_INVALID', name + ':checks');
  const checks = new Map();
  for (const check of raw.checks) {
    ensure(check !== null && typeof check === 'object' && !Array.isArray(check) && typeof check.id === 'string' && check.id,
      'ACCEPTANCE_EVIDENCE_INVALID', name + ':check');
    ensure(!checks.has(check.id), 'ACCEPTANCE_EVIDENCE_INVALID', name + ':duplicate:' + check.id);
    checks.set(check.id, check);
  }
  return checks;
}

function assertRawCheck(rawChecks, reportCheck, name, requireDetails = true) {
  const rawCheck = rawChecks.get(reportCheck.id);
  ensure(rawCheck, 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', name + ':' + reportCheck.id + ':missing');
  ensure(rawCheck.passed === true, 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', name + ':' + reportCheck.id + ':passed');
  if (requireDetails || Object.hasOwn(rawCheck, 'details') || Object.hasOwn(reportCheck, 'details')) {
    ensure(Object.hasOwn(rawCheck, 'details') && Object.hasOwn(reportCheck, 'details') &&
      isDeepStrictEqual(rawCheck.details, reportCheck.details),
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', name + ':' + reportCheck.id + ':details');
  }
}

function assertRawChecksCoverReport(rawChecks, reportChecks, name, requireDetails = true) {
  for (const check of reportChecks) assertRawCheck(rawChecks, check, name, requireDetails);
}

function assertLocalAccountingEvidence(raw, reportChecks) {
  const rawChecks = rawCheckIndex(raw, 'local-accounting.json');
  assertRawChecksCoverReport(rawChecks, reportChecks, 'local-accounting.json');
  const exact = rawChecks.get('exact-decimals');
  ensure(exact.details.amount === '0.123456789012' && exact.details.replayIdempotent === true,
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-accounting.json:exact-decimals');
  const settlement = rawChecks.get('settlement-once');
  ensure(nonEmptyIdentifier(settlement.details.operationId) &&
    settlement.details.operationId === settlement.details.replayOperationId,
  'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-accounting.json:settlement-once');
  ensure(rawChecks.get('admin-concurrency').details.operations === 20,
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-accounting.json:admin-concurrency');
  ensure(rawChecks.get('fee-once').details.feeOperations === 1,
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-accounting.json:fee-once');
  ensure(rawChecks.get('dissolve-earned-scores').details.zeroUnconfirmed === true,
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-accounting.json:dissolve-earned-scores');
  const negative = rawChecks.get('negative-balance');
  ensure(negative.details.manualBlocked === true && negative.details.automaticAllowed === true,
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-accounting.json:negative-balance');
  ensure(rawChecks.get('role-isolation').details.playerCannotAdjust === true,
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-accounting.json:role-isolation');
}

function assertLocalRecoveryEvidence(raw, reportChecks) {
  const rawChecks = rawCheckIndex(raw, 'local-recovery.json');
  assertRawChecksCoverReport(rawChecks, reportChecks, 'local-recovery.json');
  const source = raw.sourceMetrics;
  const restored = raw.restoredMetrics;
  ensure(nonEmptyObject(source) && nonEmptyObject(restored) && isDeepStrictEqual(source, restored),
    'ACCEPTANCE_EVIDENCE_MISMATCH', 'local-recovery.json:metrics');
  for (const key of ['migration', 'accounts', 'entries', 'rounds', 'events']) {
    ensure(finiteNonNegativeInteger(source[key]), 'ACCEPTANCE_EVIDENCE_INVALID', 'local-recovery.json:' + key);
  }
  ensure(source.migration > 0, 'ACCEPTANCE_EVIDENCE_INVALID', 'local-recovery.json:migration');
  ensure(isDeepStrictEqual(rawChecks.get('isolated-restore').details, restored) &&
    isDeepStrictEqual(rawChecks.get('ledger-reconciled').details, source),
  'ACCEPTANCE_EVIDENCE_MISMATCH', 'local-recovery.json:reconciled checks');
  const restart = rawChecks.get('service-restart').details;
  ensure(restart.activeDirectoryLockRejected === true, 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH',
    'local-recovery.json:service-restart');
  const backup = rawChecks.get('daily-backup-catchup').details;
  ensure(typeof backup.first === 'string' && backup.first.trim() && typeof backup.second === 'string' &&
    backup.second.trim() && backup.first !== backup.second && backup.sameSlotSkipped === true,
  'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-recovery.json:daily-backup-catchup');
  const oldRule = rawChecks.get('old-rule-version').details;
  ensure(Number.isInteger(oldRule.migration) && oldRule.migration > 0 && oldRule.frozenRoomVersions > 0 &&
    typeof oldRule.ruleVersion === 'string' && oldRule.ruleVersion.trim() &&
    oldRule.frozenOptionsPreserved === true && oldRule.memberSeatsPreserved === true,
  'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-recovery.json:old-rule-version');
}

function assertLocalNetworkEvidence(raw, reportChecks) {
  const rawChecks = rawCheckIndex(raw, 'local-network.json');
  assertRawChecksCoverReport(rawChecks, reportChecks, 'local-network.json');
  ensure(nonEmptyObject(raw.health) && raw.health.status === 'ok' &&
    isDeepStrictEqual(rawChecks.get('gameplay').details.health, raw.health),
  'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-network.json:health');
  const reconnectUrl = rawChecks.get('reconnect').details.websocketReachable;
  ensure(typeof reconnectUrl === 'string' && /^wss?:\/\//.test(reconnectUrl),
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-network.json:reconnect');
  const blocked = rawChecks.get('old-domains-blocked').details.checked;
  ensure(Array.isArray(blocked) && blocked.length > 0 && blocked.every(value => typeof value === 'string' && value.trim()),
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-network.json:old-domains-blocked');
  ensure(rawChecks.get('update-path').details.runtimeConfigUsesCurrentOrigin === true,
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-network.json:update-path');
}

function completedGamesSummary(games) {
  return {
    variants: new Set(games.map(game => game.variantKey)).size,
    games: games.length,
    minSteps: Math.min(...games.map(game => game.steps)),
    maxSteps: Math.max(...games.map(game => game.steps)),
  };
}

/** Formal artifacts are never marked smoke-only, and smoke artifacts are never acceptance eligible. */
function isSmokeArtifact(value) {
  if (!nonEmptyObject(value)) return true;
  if (value.smokeOnly === true || value.acceptanceEligible === false) return true;
  if (value.smokeOnly !== false || value.acceptanceEligible !== true) return true;
  if (typeof value.mode === 'string' && value.mode !== 'acceptance') return true;
  const paths = Array.isArray(value.evidence)
    ? value.evidence.map(descriptor => descriptor?.path).filter(candidate => typeof candidate === 'string') : [];
  return paths.some(candidate => /(?:^|[\\/._-])smoke/i.test(candidate));
}

/**
 * Deterministic projection of one rebuilt round. Frames keep only verifiable metadata plus a digest
 * of the projected game state so a full matrix stays small enough to archive.
 */
export function replayRoundRecord(replay) {
  ensure(nonEmptyObject(replay) && Array.isArray(replay.frames) && replay.frames.length > 0,
    'COMPLETE_ROOM_REPLAY_MISMATCH', 'Replay frames are required.');
  const record = {
    roomId: replay.roomId,
    roundId: replay.roundId,
    number: replay.number,
    variantKey: replay.variantKey,
    ruleVersion: replay.ruleVersion,
    rules: replay.rules,
    results: replay.results,
    endReason: replay.endReason,
    frames: replay.frames.map(frame => {
      ensure(nonEmptyObject(frame) && Object.hasOwn(frame, 'game'),
        'COMPLETE_ROOM_REPLAY_MISMATCH', 'Replay frame is invalid.');
      return {
        sequence: frame.sequence,
        stateVersion: frame.stateVersion,
        at: frame.at,
        actorId: frame.actorId ?? null,
        autoPlayUserIds: Array.isArray(frame.autoPlayUserIds) ? [...frame.autoPlayUserIds] : [],
        gameSha256: canonicalDigest(frame.game),
      };
    }),
  };
  // PostgreSQL returns timestamp columns as Date instances. Canonical JSON treats a Date as an
  // empty object, while the archived report stores it as an ISO string. Normalize through JSON so
  // the digest is computed over exactly the same representation that is persisted and audited.
  return JSON.parse(JSON.stringify(record));
}

export function completedGameReplayDigest(rounds) {
  return canonicalDigest(rounds
    .map(round => ({ roundId: String(round.roundId), number: round.number, digest: round.digest }))
    .sort((left, right) => left.roundId.localeCompare(right.roundId) || left.number - right.number));
}

function completeRoomMemberIdSet(game) {
  if (!Array.isArray(game.memberIds) || game.memberIds.length !== game.playerCount ||
    !game.memberIds.every(nonEmptyIdentifier)) return null;
  const memberIds = game.memberIds.map(String);
  if (new Set(memberIds).size !== memberIds.length) return null;
  return new Set(memberIds);
}

function assertReplayRound(game, round, index, rounds, memberIds) {
  const detail = `local-completed-games.json:${game.variantKey}:${game.playerCount}:${game.configuredRounds}:round:${index + 1}`;
  ensure(nonEmptyObject(round) && nonEmptyIdentifier(round.roundId) &&
    Number.isInteger(round.number) && round.number === index + 1 &&
    canonicalHashPattern.test(round.digest ?? '') &&
    nonEmptyObject(round.replay),
  'COMPLETE_ROOM_REPLAY_MISMATCH', detail);
  ensure(canonicalDigest(round.replay) === round.digest,
    'COMPLETE_ROOM_REPLAY_MISMATCH', detail + ':digest');
  ensure(String(round.replay.roundId) === String(round.roundId) && round.replay.number === round.number &&
    round.replay.variantKey === game.variantKey && round.replay.ruleVersion === game.ruleVersion,
  'COMPLETE_ROOM_REPLAY_MISMATCH', detail + ':identity');
  const frames = round.replay.frames;
  ensure(Array.isArray(frames) && frames.length > 0, 'COMPLETE_ROOM_REPLAY_MISMATCH', detail + ':frames');
  let previousSequence = null;
  let previousVersion = -1;
  for (const frame of frames) {
    ensure(nonEmptyObject(frame) && typeof frame.sequence === 'string' && /^\d+$/.test(frame.sequence) &&
      Number.isInteger(frame.stateVersion) && frame.stateVersion >= 0 &&
      canonicalHashPattern.test(frame.gameSha256 ?? '') && Array.isArray(frame.autoPlayUserIds),
    'COMPLETE_ROOM_REPLAY_MISMATCH', detail + ':frame');
    const sequence = BigInt(frame.sequence);
    ensure((previousSequence === null || sequence > previousSequence) && frame.stateVersion >= previousVersion,
      'COMPLETE_ROOM_REPLAY_MISMATCH', detail + ':frame-order');
    previousSequence = sequence;
    previousVersion = frame.stateVersion;
  }

  ensure(nonEmptyIdentifier(round.dealerId) && memberIds.has(String(round.dealerId)) &&
    Number.isSafeInteger(round.dealerRun) && round.dealerRun >= 1,
  'COMPLETE_ROOM_REPLAY_MISMATCH', detail + ':dealer');
  const continuation = round.continuation;
  ensure(nonEmptyObject(continuation) && continuation.version === game.ruleVersion &&
    continuation.completedRound === round.number &&
    nonEmptyIdentifier(continuation.nextDealerId) && memberIds.has(String(continuation.nextDealerId)) &&
    Number.isSafeInteger(continuation.dealerRun) && continuation.dealerRun >= 1,
  'COMPLETE_ROOM_REPLAY_MISMATCH', detail + ':continuation');
  if (index + 1 < rounds.length) {
    const next = rounds[index + 1];
    ensure(nonEmptyObject(next) && next.dealerId === continuation.nextDealerId &&
      next.dealerRun === continuation.dealerRun,
    'COMPLETE_ROOM_REPLAY_MISMATCH', detail + ':next-dealer');
  }
}

/** Validates one game cell in isolation: options, option coverage, replay digests and subject binding. */
function assertCompletedGame(game, expectedSubject) {
  ensure(nonEmptyObject(game) && typeof game.variantKey === 'string' && game.variantKey.trim() &&
    Number.isInteger(game.playerCount) && game.playerCount >= 2 &&
    Number.isInteger(game.configuredRounds) && game.configuredRounds > 0 &&
    game.completedRounds === game.configuredRounds && game.currentRound === game.configuredRounds &&
    game.roomState === 'closed' && game.continuationVerified === true && game.replayVerified === true &&
    typeof game.ruleVersion === 'string' && game.ruleVersion.trim() &&
    Number.isInteger(game.steps) && game.steps > 0 && game.passed === true,
  'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH', 'local-completed-games.json:game');

  const memberIds = completeRoomMemberIdSet(game);
  ensure(memberIds !== null, 'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH',
    `local-completed-games.json:${game.variantKey}:memberIds`);

  ensure(nonEmptyObject(game.normalizedOptions) &&
    game.normalizedOptions.playerNum === game.playerCount &&
    game.normalizedOptions.gameNum === game.configuredRounds &&
    game.optionsSha256 === canonicalDigest(game.normalizedOptions),
  'COMPLETE_ROOM_OPTION_MISMATCH', `local-completed-games.json:${game.variantKey}:options`);

  ensure(Array.isArray(game.optionCoverage) && game.optionCoverage.length > 0 &&
    game.optionCoverage.every(label => { parseOptionCoverage(label); return true; }) &&
    new Set(game.optionCoverage).size === game.optionCoverage.length &&
    isDeepStrictEqual(game.optionCoverage, [...game.optionCoverage].sort()),
  'COMPLETE_ROOM_OPTION_MISMATCH', `local-completed-games.json:${game.variantKey}:optionCoverage`);

  ensure(Array.isArray(game.replayedRoundIds) && game.replayedRoundIds.length === game.configuredRounds &&
    game.replayedRounds === game.configuredRounds &&
    game.replayedRoundIds.every(id => nonEmptyIdentifier(id)) &&
    new Set(game.replayedRoundIds.map(String)).size === game.replayedRoundIds.length &&
    Array.isArray(game.rounds) && game.rounds.length === game.configuredRounds,
  'COMPLETE_ROOM_REPLAY_MISMATCH', `local-completed-games.json:${game.variantKey}:replayedRounds`);

  const roundIds = [];
  game.rounds.forEach((round, index) => {
    assertReplayRound(game, round, index, game.rounds, memberIds);
    roundIds.push(String(round.roundId));
  });
  ensure(new Set(roundIds).size === roundIds.length &&
    isDeepStrictEqual([...game.replayedRoundIds.map(String)].sort(), [...roundIds].sort()),
  'COMPLETE_ROOM_REPLAY_MISMATCH', `local-completed-games.json:${game.variantKey}:roundIds`);

  ensure(nonEmptyObject(game.replaySummary) && game.replaySummary.rounds === game.configuredRounds &&
    canonicalHashPattern.test(game.replaySummary.digest ?? '') &&
    game.replaySummary.digest === completedGameReplayDigest(game.rounds),
  'COMPLETE_ROOM_REPLAY_MISMATCH', `local-completed-games.json:${game.variantKey}:replaySummary`);

  ensure(canonicalHashPattern.test(expectedSubject ?? '') &&
    game.subjectBeforeSha256 === game.subjectAfterSha256 &&
    game.subjectAfterSha256 === game.subjectSha256 && game.subjectSha256 === expectedSubject,
  'COMPLETE_ROOM_SUBJECT_MISMATCH', `local-completed-games.json:${game.variantKey}:subject`);
}

function assertCompletedGamesEvidence(raw, report) {
  ensure(!isSmokeArtifact(raw) && !isSmokeArtifact(report), 'COMPLETE_ROOM_SMOKE_ARTIFACT',
    'local-completed-games.json:smoke');
  ensure(Array.isArray(raw.games) && raw.games.length > 0, 'ACCEPTANCE_EVIDENCE_INVALID',
    'local-completed-games.json:games');
  ensure(Array.isArray(report.games) && isDeepStrictEqual(report.games, raw.games),
    'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH', 'local-completed-games.json:games');
  ensure(nonEmptyObject(report.summary) && isDeepStrictEqual(report.summary, raw.summary) &&
    isDeepStrictEqual(report.summary, completedGamesSummary(raw.games)),
  'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH', 'local-completed-games.json:summary');
  ensure(typeof raw.matrixDigest === 'string' && canonicalHashPattern.test(raw.matrixDigest) &&
    report.matrixDigest === raw.matrixDigest,
  'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH', 'local-completed-games.json:matrixDigest');
  for (const game of raw.games) assertCompletedGame(game, report.subjectSha256);
  // The matrix must prove the owner-pays fee mode explicitly rather than only covering the default.
  ensure(raw.games.filter(game => game.variantKey === '4:0' && game.normalizedOptions.useCardType === 1).length === 1,
    'COMPLETE_ROOM_OPTION_MISMATCH', 'local-completed-games.json:4:0:useCardType=1');
  // Reaching this point means every expected/actual comparison above succeeded, so a `passed` flag
  // is only accepted when it agrees with the corroborated evidence rather than being hardcoded.
  ensure(raw.passed === true && report.passed === true && raw.games.every(game => game.passed === true),
    'ACCEPTANCE_GAMES_EVIDENCE_MISMATCH', 'local-completed-games.json:passed');
}

function assertLocalStabilityEvidence(raw, report) {
  ensure(nonEmptyObject(raw.metrics) && isDeepStrictEqual(report.metrics, raw.metrics),
    'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:metrics');
  ensure(raw.passed === true && raw.mode === 'acceptance' && report.passed === true &&
    report.mode === 'acceptance' && report.acceptanceEligible === true,
  'ACCEPTANCE_EVIDENCE_INVALID', 'local-stability.json:acceptance mode');
  assertLocalStabilityMetrics({ metrics: raw.metrics }, 'local-stability.json');
  ensure(nonEmptyObject(raw.scenario) && isDeepStrictEqual(report.scenario, raw.scenario),
    'ACCEPTANCE_EVIDENCE_INVALID', 'local-stability.json:scenario');
  ensure(Array.isArray(raw.roomBatches) && raw.roomBatches.length > 0,
    'ACCEPTANCE_EVIDENCE_INVALID', 'local-stability.json:roomBatches');
  ensure(Array.isArray(raw.metrics.actionSamples) && raw.metrics.actionSamples.length > 0 &&
    Array.isArray(raw.metrics.dealSamples) && raw.metrics.dealSamples.length > 0,
  'ACCEPTANCE_EVIDENCE_INVALID', 'local-stability.json:samples');
  const rawChecks = rawCheckIndex(raw, 'local-stability.json');
  assertRawChecksCoverReport(rawChecks, report.checks, 'local-stability.json');
  ensure(raw.metrics.checks === undefined || isDeepStrictEqual(raw.metrics.checks, raw.checks),
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-stability.json:metrics.checks');
  ensure(isDeepStrictEqual(raw.checks, stabilityChecks(raw.metrics)),
    'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', 'local-stability.json:checks');

  const startedAt = timestampValue(raw.metrics.startedAt);
  const endedAt = timestampValue(raw.metrics.endedAt);
  ensure(startedAt !== null && endedAt !== null && endedAt > startedAt &&
    raw.scenario.durationSeconds === raw.metrics.actualSeconds &&
    raw.scenario.requiredDurationSeconds === raw.metrics.requiredSeconds &&
    raw.metrics.requiredSeconds >= 7200 && raw.metrics.actualSeconds >= raw.metrics.requiredSeconds,
  'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:duration');
  ensure(Math.abs((endedAt - startedAt) / 1000 - raw.metrics.actualSeconds) <= 30,
    'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:duration timestamps');

  const requiredRoomRounds = raw.metrics.configuredRoomRounds;
  ensure(Number.isInteger(requiredRoomRounds) && requiredRoomRounds > 0 &&
    Number.isInteger(raw.metrics.roomsTotal) && raw.metrics.roomsTotal > 0 &&
    raw.metrics.completedRoomRounds === requiredRoomRounds &&
    raw.metrics.roomsFullyCompleted === raw.metrics.roomsTotal &&
    raw.metrics.completedRounds >= raw.metrics.completedRoomRounds,
  'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:complete rooms');
  const roomIds = new Set();
  for (const batch of raw.roomBatches) {
    ensure(nonEmptyObject(batch) && finiteNonNegativeInteger(batch.batchIndex) &&
      Array.isArray(batch.rooms) && batch.rooms.length > 0,
    'ACCEPTANCE_EVIDENCE_INVALID', 'local-stability.json:roomBatch');
    for (const roomId of batch.rooms) {
      ensure(nonEmptyIdentifier(roomId) && !roomIds.has(String(roomId)),
        'ACCEPTANCE_EVIDENCE_INVALID', 'local-stability.json:room id');
      roomIds.add(String(roomId));
    }
  }
  ensure(roomIds.size === raw.metrics.roomsTotal,
    'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:room count');

  for (const check of raw.metrics.stateVersionChecks) {
    ensure(nonEmptyObject(check) && nonEmptyIdentifier(check.roundId) &&
      finiteNonNegativeInteger(check.before) && finiteNonNegativeInteger(check.submitted) &&
      check.submitted === check.before + 1 &&
      (check.after === null
        ? check.roundEnded === true
        : finiteNonNegativeInteger(check.after) && check.after === check.submitted && check.roundEnded !== true) &&
      check.passed === true,
    'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:stateVersionCheck');
  }

  const sampleDurations = raw.metrics.actionSamples.map(sample => Number(sample.durationMs)).sort((left, right) => left - right);
  ensure(sampleDurations.every(Number.isFinite), 'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH',
    'local-stability.json:actionSamples');
  ensure(percentile95(sampleDurations) === raw.metrics.actionP95Ms,
    'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:actionP95Ms');
  const dealDurations = raw.metrics.dealSamples.map(sample => Number(sample.durationMs)).sort((left, right) => left - right);
  ensure(dealDurations.every(Number.isFinite) && percentile95(dealDurations) === raw.metrics.dealP95Ms,
    'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:dealP95Ms');

  const reconciliation = raw.metrics.settlementReconciliation;
  ensure(nonEmptyObject(reconciliation) && reconciliation.postingsBalanced === true &&
    reconciliation.walletLedgerMatched === true && reconciliation.walletLedgerMismatches === 0 &&
    reconciliation.settledRounds === reconciliation.settlementOperations &&
    reconciliation.settledRounds === raw.metrics.completedRounds &&
    Array.isArray(reconciliation.errors) && reconciliation.errors.length === 0,
  'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:accounting');
  if (Object.hasOwn(raw, 'actionLatencies')) {
    ensure(Array.isArray(raw.actionLatencies) && raw.actionLatencies.length === raw.metrics.actionSamples.length,
      'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:actionLatencies');
    const latencies = raw.actionLatencies.map(value => Number(value)).sort((left, right) => left - right);
    ensure(latencies.every(Number.isFinite) && isDeepStrictEqual(latencies, sampleDurations),
      'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:actionLatencies');
  }
  if (Object.hasOwn(raw.metrics, 'actionRequests')) {
    ensure(raw.metrics.actionRequests === raw.metrics.actionSamples.length,
      'ACCEPTANCE_METRICS_EVIDENCE_MISMATCH', 'local-stability.json:actionRequests');
  }
}

function assertNativeRunEvidence(raw, report) {
  ensure(raw.schemaVersion === 1 && raw.runId === report.runId && raw.apkSha256 === report.apkSha256 &&
    nonEmptyIdentifier(raw.roomId) && nonEmptyIdentifier(raw.roomCode) && nonEmptyIdentifier(raw.roundId) &&
    Array.isArray(raw.accounts) && raw.accounts.length >= 2,
  'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:acceptance-run');
  const accountsByDevice = new Map();
  for (const account of raw.accounts) {
    ensure(nonEmptyObject(account) && typeof account.device === 'string' && account.device.trim() &&
      !accountsByDevice.has(account.device) && nonEmptyIdentifier(account.userId) &&
      account.register?.registered === true && account.register?.userId === account.userId &&
      account.login?.userId === account.userId &&
      account.credit?.device?.balance === '100' && account.ready?.submitted === true &&
      account.autoPlay?.submitted === true && account.autoPlay?.enabled === true &&
      Number.isInteger(account.settlement?.completedRounds) && account.settlement.completedRounds > 0 &&
      account.reconnect?.requested === true && account.reconnect?.hasLiveRoom === true &&
      account.exit?.exited === true && account.exitStatus?.hasLiveRoom === false &&
      account.replay?.loaded === true && account.replay?.attached === true &&
      account.replay?.roomId === raw.roomId && account.replay?.roundId === raw.roundId &&
      Number.isFinite(Number(account.gps?.latitude)) && Number.isFinite(Number(account.gps?.longitude)) &&
      !(Number(account.gps.latitude) === 0 && Number(account.gps.longitude) === 0) &&
      account.voice?.submitted === true && account.voice?.notified === true &&
      account.network?.allowed === true,
    'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:account');
    if (accountsByDevice.size === 0) {
      ensure(account.create?.roomId === raw.roomId, 'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH',
        'local-native.json:owner create');
    } else {
      ensure(account.join?.roomId === raw.roomId, 'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH',
        'local-native.json:joiner join');
    }
    const completed = account.completed?.rounds;
    ensure(Array.isArray(completed) && completed.some(round => round && round.id === raw.roundId && round.settledAt),
      'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:completed-round');
    accountsByDevice.set(account.device, account);
  }
  return accountsByDevice;
}

function assertNativeDeviceEvidence(raw, report, accountsByDevice) {
  ensure(raw.apkSha256 === report.apkSha256 && Array.isArray(raw.devices) && raw.devices.length >= 2,
    'LOCAL_NATIVE_DEVICE_EVIDENCE_MISMATCH', 'local-native.json:two-physical-devices');
  const rawDevices = new Map();
  for (const device of raw.devices) {
    ensure(nonEmptyObject(device) && typeof device.id === 'string' && device.id.trim() && !rawDevices.has(device.id) &&
      device.platform === 'android' && device.physical === true && device.emulator !== true &&
      device.installedApkSha256 === report.apkSha256 && device.connectedWithoutAdbReverse === true &&
      device.connectedWithoutAdbForward === true,
    'LOCAL_NATIVE_DEVICE_EVIDENCE_MISMATCH', 'local-native.json:two-physical-devices');
    ensure(accountsByDevice.has(device.id), 'LOCAL_NATIVE_DEVICE_EVIDENCE_MISMATCH',
      'local-native.json:device/account mismatch');
    rawDevices.set(device.id, device);
  }
  for (const device of report.devices) {
    const rawDevice = rawDevices.get(device.id);
    ensure(rawDevice && isDeepStrictEqual(rawDevice, device), 'LOCAL_NATIVE_DEVICE_EVIDENCE_MISMATCH',
      'local-native.json:report device');
  }
  ensure(rawDevices.size >= 2 && report.devices.every(device => rawDevices.has(device.id)),
    'LOCAL_NATIVE_DEVICE_EVIDENCE_MISMATCH', 'local-native.json:two-physical-devices');
}

function assertNativeLanEvidence(raw, report, accountsByDevice) {
  ensure(typeof raw.apiBase === 'string' && raw.apiBase.trim() && raw.preflightForwardingFree === true &&
    Array.isArray(raw.devices) && raw.devices.length >= 2,
  'LOCAL_NATIVE_LAN_EVIDENCE_MISMATCH', 'local-native.json:lan-without-adb');
  const lanDevices = new Map();
  for (const entry of raw.devices) {
    ensure(nonEmptyObject(entry) && typeof entry.device === 'string' && entry.device.trim() &&
      !lanDevices.has(entry.device) && nonEmptyObject(entry.network) && entry.network.allowed === true,
    'LOCAL_NATIVE_LAN_EVIDENCE_MISMATCH', 'local-native.json:lan device');
    const account = accountsByDevice.get(entry.device);
    ensure(account && isDeepStrictEqual(entry.network, account.network),
      'LOCAL_NATIVE_LAN_EVIDENCE_MISMATCH', 'local-native.json:lan account mismatch');
    lanDevices.set(entry.device, entry);
  }
  ensure(lanDevices.size >= 2 && report.devices.every(device => lanDevices.has(device.id)),
    'LOCAL_NATIVE_LAN_EVIDENCE_MISMATCH', 'local-native.json:lan coverage');
}

function assertNativeCheckEvidence(report, accounts, runEvidence, rawLan, requiredCheckIds) {
  const checks = new Map(report.checks.map(check => [check.id, check]));
  const runCheck = checks.get('register');
  ensure(runCheck && isDeepStrictEqual(runCheck.details, {
    devices: report.devices.map(device => device.id),
    userIds: [...accounts.values()].map(account => account.userId),
  }), 'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:register details');
  const completed = checks.get('completed-round');
  const completedCounts = [...accounts.values()].map(account => account.completed.rounds.filter(round => round.settledAt).length);
  ensure(completed && isDeepStrictEqual(completed.details, { roundId: runEvidence.roundId, settledCount: Math.max(...completedCounts) }),
    'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:completed-round details');
  const settlement = checks.get('settlement');
  ensure(settlement && isDeepStrictEqual(settlement.details, {
    completedRounds: [...accounts.values()].map(account => account.settlement.completedRounds),
  }), 'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:settlement details');
  const reconnect = checks.get('reconnect');
  ensure(reconnect && isDeepStrictEqual(reconnect.details, {
    liveRooms: [...accounts.values()].map(account => account.reconnect.hasLiveRoom),
  }), 'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:reconnect details');
  const deviceCheck = checks.get('two-physical-android-devices');
  ensure((!requiredCheckIds.has('two-physical-android-devices') || deviceCheck) &&
    (!deviceCheck || isDeepStrictEqual(deviceCheck.details, {
      count: report.devices.length,
      ids: report.devices.map(device => device.id),
    })), 'LOCAL_NATIVE_DEVICE_EVIDENCE_MISMATCH', 'local-native.json:device details');
  const lanCheck = checks.get('lan-without-adb');
  ensure((!requiredCheckIds.has('lan-without-adb') || lanCheck) &&
    (!lanCheck || isDeepStrictEqual(lanCheck.details, {
      apiBase: rawLan.apiBase,
      devices: report.devices.map(device => device.id),
    })), 'LOCAL_NATIVE_LAN_EVIDENCE_MISMATCH', 'local-native.json:lan details');
  ensure(checks.get('beans-credit') && isDeepStrictEqual(checks.get('beans-credit').details,
    { expectedBalance: '100' }), 'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:beans-credit details');
  ensure(checks.get('create-and-join') && isDeepStrictEqual(checks.get('create-and-join').details,
    { roomId: runEvidence.roomId, roomCode: runEvidence.roomCode }),
  'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:create-and-join details');
  ensure(checks.get('auto-play') && isDeepStrictEqual(checks.get('auto-play').details, { enabled: true }),
    'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:auto-play details');
  ensure(checks.get('animated-replay') && isDeepStrictEqual(checks.get('animated-replay').details,
    { roomId: runEvidence.roomId, roundId: runEvidence.roundId }),
  'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:animated-replay details');
  ensure(checks.get('gps') && isDeepStrictEqual(checks.get('gps').details,
    { devices: report.devices.map(device => device.id) }),
  'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:gps details');
  ensure(checks.get('quick-voice') && isDeepStrictEqual(checks.get('quick-voice').details,
    { devices: report.devices.map(device => device.id) }),
  'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:quick-voice details');
  ensure(checks.get('standalone-network') && isDeepStrictEqual(checks.get('standalone-network').details,
    { apiBase: rawLan.apiBase }),
  'LOCAL_NATIVE_RUN_EVIDENCE_MISMATCH', 'local-native.json:standalone-network details');
}

function assertLocalStabilityMetrics(report, name) {
  const metrics = report.metrics;
  const code = 'LOCAL_GAMEPLAY_CAPACITY_MISSING';
  ensure(metrics !== null && typeof metrics === 'object' && !Array.isArray(metrics), code, name + ':metrics');
  ensure(Number.isInteger(metrics.actualPlayers) && metrics.actualPlayers >= 20,
    code, name + ':actualPlayers');
  ensure(Number.isFinite(metrics.durationSeconds) && metrics.durationSeconds >= 7200,
    code, name + ':durationSeconds');
  ensure(Number.isInteger(metrics.completedRounds) && metrics.completedRounds > 0,
    code, name + ':completedRounds');
  ensure(Number.isInteger(metrics.optimizedDeals) && metrics.optimizedDeals > 0,
    code, name + ':optimizedDeals');

  ensure(Number.isInteger(metrics.networkClients) && metrics.networkClients >= 20,
    code, name + ':networkClients');
  const protocols = (Array.isArray(metrics.protocols) ? metrics.protocols : []).map(protocolName);
  ensure(protocols.includes('http') && (protocols.includes('websocket') || protocols.includes('ws')),
    code, name + ':protocols');
  ensure(typeof metrics.apiBase === 'string' && metrics.apiBase.trim(), code, name + ':apiBase');
  let apiUrl;
  try { apiUrl = new URL(metrics.apiBase); }
  catch { ensure(false, code, name + ':apiBase'); }
  const apiHost = apiUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  ensure(apiUrl.protocol === 'http:' || apiUrl.protocol === 'https:', code, name + ':apiBase protocol');
  ensure(apiHost !== 'localhost' && !apiHost.endsWith('.localhost') && apiHost !== '::1' &&
    apiHost !== '0.0.0.0' && apiHost !== '::' && !/^127\./.test(apiHost),
  code, name + ':apiBase must be reachable off-loopback');
  ensure(Number.isInteger(metrics.servicePort) && metrics.servicePort > 0 && metrics.servicePort <= 65535,
    code, name + ':servicePort');
  const apiPort = apiUrl.port ? Number(apiUrl.port) : (apiUrl.protocol === 'http:' ? 80 : 443);
  ensure(apiPort === metrics.servicePort, code, name + ':servicePort/apiBase mismatch');

  const counts = reconnectCountEntries(metrics);
  ensure(counts.some(entry => entry.count > 0), code, name + ':reconnectCount');
  ensure(Array.isArray(metrics.reconnectSamples) && metrics.reconnectSamples.length > 0,
    code, name + ':reconnectSamples');
  const positiveClients = new Set(counts.filter(entry => entry.count > 0).map(entry => entry.clientId));
  let sawPositiveClientSample = false;
  for (const sample of metrics.reconnectSamples) {
    ensure(sample !== null && typeof sample === 'object' && !Array.isArray(sample),
      code, name + ':reconnectSample');
    ensure(typeof sample.clientId === 'string' && sample.clientId.trim(),
      code, name + ':reconnectSample.clientId');
    const disconnectedAt = timestampValue(sample.disconnectedAt);
    const reconnectedAt = timestampValue(sample.reconnectedAt);
    ensure(disconnectedAt !== null && reconnectedAt !== null && reconnectedAt > disconnectedAt,
      code, name + ':reconnectSample timestamps');
    ensure(finiteNonNegativeInteger(sample.stateVersionBefore) &&
      finiteNonNegativeInteger(sample.stateVersionAfter) && sample.stateVersionAfter >= sample.stateVersionBefore,
    code, name + ':reconnectSample state versions');
    ensure(nonEmptyIdentifier(sample.roundIdBefore) && nonEmptyIdentifier(sample.roundIdAfter),
      code, name + ':reconnectSample round ids');
    ensure(sample.passed === true, code, name + ':reconnectSample passed');
    if (positiveClients.has(sample.clientId)) sawPositiveClientSample = true;
  }
  ensure(positiveClients.size === 0 || sawPositiveClientSample, code, name + ':reconnectSample/client mismatch');

  const settlement = metrics.settlementReconciliation;
  ensure(settlement !== null && typeof settlement === 'object' && !Array.isArray(settlement),
    code, name + ':settlementReconciliation');
  ensure(Number.isInteger(settlement.settledRounds) && settlement.settledRounds > 0 &&
    Number.isInteger(settlement.settlementOperations) && settlement.settlementOperations > 0 &&
    settlement.settledRounds === settlement.settlementOperations,
  code, name + ':settlementReconciliation counts');
  ensure(settlement.postingsBalanced === true && settlement.walletLedgerMatched === true,
    code, name + ':settlementReconciliation checks');
  ensure(settlement.walletLedgerMismatches === 0,
    code, name + ':settlementReconciliation mismatches');
  ensure(Array.isArray(settlement.errors) && settlement.errors.length === 0,
    code, name + ':settlementReconciliation errors');

  ensure(Array.isArray(metrics.stateVersionChecks) && metrics.stateVersionChecks.length > 0,
    code, name + ':stateVersionChecks');
  for (const check of metrics.stateVersionChecks) {
    ensure(check !== null && typeof check === 'object' && !Array.isArray(check) &&
      nonEmptyIdentifier(check.roundId) && finiteNonNegativeInteger(check.before) &&
      finiteNonNegativeInteger(check.submitted) && check.submitted === check.before + 1 &&
      (check.after === null
        ? check.roundEnded === true
        : finiteNonNegativeInteger(check.after) && check.after === check.submitted && check.roundEnded !== true) &&
      check.passed === true,
      code, name + ':stateVersionCheck');
  }
  ensure(metrics.stateLosses === 0, code, name + ':stateLosses');

  const dealCoverage = metrics.dealPolicyCoverage;
  ensure(dealCoverage !== null && typeof dealCoverage === 'object' && !Array.isArray(dealCoverage),
    code, name + ':dealPolicyCoverage');
  ensure(Number.isInteger(dealCoverage.optimizedCandidates32) && dealCoverage.optimizedCandidates32 > 0 &&
    Number.isInteger(dealCoverage.ordinaryCandidates1) && dealCoverage.ordinaryCandidates1 > 0 &&
    dealCoverage.policyFrozen === true && dealCoverage.policyChangeAppliedNextRound === true,
  code, name + ':dealPolicyCoverage');

  const assertSamples = (sampleKey, p95Key, limit) => {
    const samples = metrics[sampleKey];
    ensure(Array.isArray(samples) && samples.length > 0, code, name + ':' + sampleKey);
    const durations = samples.map(sample => {
      ensure(sample !== null && typeof sample === 'object' && !Array.isArray(sample),
        code, name + ':' + sampleKey + ' sample');
      ensure(typeof sample.clientId === 'string' && sample.clientId.trim() &&
        nonEmptyIdentifier(sample.roomId) && nonEmptyIdentifier(sample.roundId),
      code, name + ':' + sampleKey + ' identifiers');
      ensure(Number.isFinite(sample.durationMs) && sample.durationMs >= 0,
        code, name + ':' + sampleKey + ' durationMs');
      return sample.durationMs;
    });
    const sampleP95 = percentile95(durations);
    ensure(Number.isFinite(metrics[p95Key]) && metrics[p95Key] >= 0 && metrics[p95Key] <= limit &&
      Number.isFinite(sampleP95) && sampleP95 <= limit,
    code, name + ':' + p95Key);
    ensure(metrics[p95Key] === sampleP95,
      code, name + ':' + p95Key + ' not supported by ' + sampleKey);
  };
  assertSamples('actionSamples', 'actionP95Ms', 300);
  assertSamples('dealSamples', 'dealP95Ms', 2000);
}

function assertLocalNativeDevice(device, seen, apkSha256) {
  ensure(device !== null && typeof device === 'object' && !Array.isArray(device), 'PHYSICAL_DEVICE_EVIDENCE_MISSING', 'Device entry must be an object.');
  ensure(typeof device.id === 'string' && device.id.trim() && !seen.has(device.id), 'PHYSICAL_DEVICE_EVIDENCE_MISSING', 'Device ids must be present and distinct.');
  ensure(device.platform === 'android' && device.physical === true, 'PHYSICAL_DEVICE_EVIDENCE_MISSING', device.id);
  ensure(device.emulator !== true && device.isEmulator !== true && device.qemu !== true &&
    !/^emulator-/i.test(device.id) && !/emulator|sdk_gphone|ranchu|goldfish|android sdk built for/i.test(localNativeDeviceText(device)),
  'EMULATOR_DEVICE_REJECTED', device.id);
  ensure(device.installedApkSha256 === apkSha256, 'LOCAL_NATIVE_DEVICE_APK_MISMATCH', device.id);
  ensure(device.connectedWithoutAdbReverse === true && device.connectedWithoutAdbForward === true &&
    device.adbReverse !== true && device.adbForward !== true, 'LOCAL_NATIVE_ADB_FORWARDING_PRESENT', device.id);
  seen.add(device.id);
}

export async function readArtifact(root, descriptor) {
  ensure(descriptor && typeof descriptor.path === 'string' && /^[0-9a-f]{64}$/.test(descriptor.sha256), 'INVALID_ARTIFACT', 'Expected relative path and SHA-256.');
  const base = await fs.realpath(root);
  ensure(!path.isAbsolute(descriptor.path) && !descriptor.path.split(/[\\/]/).includes('..'), 'INVALID_ARTIFACT', 'Evidence must stay inside the project.');
  const absolute = await fs.realpath(path.join(base, descriptor.path));
  ensure(absolute.startsWith(base + path.sep), 'INVALID_ARTIFACT', 'Evidence cannot resolve outside the project.');
  const data = await fs.readFile(absolute);
  ensure(sha256(data) === descriptor.sha256, 'EVIDENCE_DIGEST_MISMATCH', descriptor.path);
  return data;
}

export async function verifyRuntimeEngine(root, entry, optionCoverage = []) {
  const { engine } = entry;
  const book = JSON.parse(await readArtifact(root, entry.rulebook));
  const suite = JSON.parse(await readArtifact(root, entry.cases));
  ensure(book.schemaVersion === 1 && book.status === 'approved', 'RULEBOOK_NOT_APPROVED', engine.variantKey);
  ensure(['apk-evidence', 'user-approved'].includes(book.basis), 'INVALID_RULE_BASIS', engine.variantKey);
  ensure(book.variantKey === engine.variantKey && book.ruleVersion === engine.version, 'RULEBOOK_VERSION_MISMATCH', engine.variantKey);
  ensure(engine.evidence.status === 'verified' && engine.evidence.referenceDigest === entry.cases.sha256, 'ENGINE_CASE_DIGEST_MISMATCH', engine.variantKey);
  if (book.basis === 'user-approved') {
    const approval = JSON.parse(await readArtifact(root, book.approval));
    ensure(approval.kind === 'user-rule-approval' && approval.ruleVersion === book.ruleVersion
      && approval.variantKey === book.variantKey && approval.statement?.trim() && approval.evidenceReference?.trim()
      && Number.isFinite(Date.parse(approval.recordedAt)), 'RULE_APPROVAL_MISSING', engine.variantKey);
    ensure(approval.rulebookSha256 === rulebookContentSha256(book), 'RULE_APPROVAL_CONTENT_MISMATCH', engine.variantKey);
  }
  ensure(suite.schemaVersion === 1 && suite.variantKey === engine.variantKey && suite.ruleVersion === engine.version
    && suite.rulebookDigest === entry.rulebook.sha256 && Array.isArray(suite.cases) && suite.cases.length > 0, 'INVALID_REFERENCE_SUITE', engine.variantKey);
  ensure(Array.isArray(book.requiredCoverage), 'INVALID_RULE_COVERAGE', engine.variantKey);
  const optionRequirements = optionCoverage.map(parseOptionCoverage).filter(Boolean);
  const exercisedOptions = new Set();
  const ids = new Set(), covered = new Set();
  let steps = 0;
  for (const reference of suite.cases) {
    ensure(typeof reference.id === 'string' && reference.id && !ids.has(reference.id), 'INVALID_CASE_ID', engine.variantKey);
    ids.add(reference.id);
    ensure(Array.isArray(reference.covers) && reference.covers.every(value => typeof value === 'string')
      && Array.isArray(reference.steps) && reference.steps.length > 0 && Object.hasOwn(reference, 'initialSnapshot'), 'EMPTY_REFERENCE_CASE', reference.id);
    let snapshot = structuredClone(reference.initialSnapshot);
    const assertions = [], results = [], referenceRejectedCodes = new Set();
    const declaredOptions = new Map();
    for (const category of reference.covers) {
      const parsed = parseOptionCoverage(category);
      if (!parsed) continue;
      if (declaredOptions.has(parsed.field) && !isDeepStrictEqual(declaredOptions.get(parsed.field), parsed.value)) {
        ensure(false, 'CONTRADICTORY_OPTION_COVERAGE',
          reference.id + ':' + parsed.field + '=' + optionLabel(declaredOptions.get(parsed.field)) +
          ',' + optionLabel(parsed.value));
      }
      declaredOptions.set(parsed.field, parsed.value);
    }
    for (const step of reference.steps) {
      const assertionKeys = ['expected', 'errorCode', 'assert'].filter(key => Object.hasOwn(step, key));
      ensure(typeof step.actorId === 'string' && Object.hasOwn(step, 'action') && assertionKeys.length === 1,
        'INVALID_REFERENCE_STEP', reference.id);
      let result, failure;
      try { result = engine.apply(structuredClone(snapshot), step.actorId, structuredClone(step.action)); }
      catch (error) { failure = error; }
      if (step.errorCode) ensure(failure?.code === step.errorCode, 'REFERENCE_REJECTION_MISMATCH', reference.id);
      if (step.errorCode) referenceRejectedCodes.add(step.errorCode);
      else {
        ensure(!failure, 'REFERENCE_RESULT_MISMATCH', reference.id);
        if (Object.hasOwn(step, 'expected')) {
          ensure(isDeepStrictEqual(result, step.expected), 'REFERENCE_RESULT_MISMATCH', reference.id);
        } else {
          ensure(step.assert !== null && typeof step.assert === 'object' && !Array.isArray(step.assert) &&
            Object.keys(step.assert).length > 0, 'INVALID_REFERENCE_ASSERTION', reference.id);
          for (const [path, expected] of Object.entries(step.assert)) {
            ensure(isDeepStrictEqual(readPath(result, path), expected), 'REFERENCE_ASSERTION_MISMATCH',
              reference.id + ':' + path);
          }
        }
        assertions.push(Object.hasOwn(step, 'expected') ? step.expected : step.assert);
        results.push(result);
        snapshot = structuredClone(result.snapshot);
      }
      steps++;
    }
    for (const projection of reference.views ?? []) {
      ensure(typeof projection.userId === 'string' && Object.hasOwn(projection, 'expected'), 'INVALID_REFERENCE_VIEW', reference.id);
      ensure(isDeepStrictEqual(engine.view(structuredClone(snapshot), projection.userId), projection.expected), 'REFERENCE_VIEW_MISMATCH', reference.id);
    }
    if (reference.steps.length > 0) {
      for (const category of reference.covers) {
        if (runtimeStructuralCoverage.has(category)) {
          covered.add(category);
          continue;
        }
        if (category === 'winning' && winningEvidence(assertions, results)) covered.add(category);
        if (category === 'scoring' && scoringEvidence(assertions, results)) covered.add(category);
        if (category === 'draw' && drawEvidence(assertions, results)) covered.add(category);
        if (category === 'wildcards' && wildcardEvidence(assertions, results)) covered.add(category);
        if (category === 'gold-hook' && goldHookEvidence(assertions, results)) covered.add(category);
        if (category === 'declared-wait-lock' && declaredWaitLockEvidence(assertions, results, referenceRejectedCodes)) covered.add(category);
        if (category === 'concealed-four-pairs' && concealedFourPairsEvidence(assertions, results)) covered.add(category);
        if (category === 'payments' && paymentEvidence(assertions, results)) covered.add(category);
        if (category === 'score-threshold' && thresholdEvidence(assertions, results, 'structureScore', true)) covered.add(category);
        if (category === 'red-threshold' && thresholdEvidence(assertions, results, 'redPoints', true)) covered.add(category);
        if (category === 'piao' && piaoEvidence(assertions, results)) covered.add(category);
        const parsed = parseOptionCoverage(category);
        if (!parsed) continue;
        const evidenced = optionEvidenceFromSnapshot(reference.initialSnapshot, parsed.field, parsed.value) ||
          assertions.some(assertion => optionEvidenceFromAssertion(assertion, parsed.field, parsed.value));
        if (evidenced) {
          covered.add(category);
          for (const [index, requirement] of optionRequirements.entries()) {
            if (requirement.field === parsed.field && isDeepStrictEqual(requirement.value, parsed.value)) {
              exercisedOptions.add(index);
            }
          }
        }
      }
    }
  }
  const missingCoverage = [...baseCoverage, ...book.requiredCoverage, ...optionCoverage]
    .filter(category => !covered.has(category));
  ensure(missingCoverage.length === 0, 'REFERENCE_COVERAGE_MISSING',
    engine.variantKey + ':' + missingCoverage.join(','));
  for (const [index, requirement] of optionRequirements.entries()) {
    ensure(exercisedOptions.has(index), 'OPTION_VALUE_NOT_EXERCISED',
      engine.variantKey + ':' + requirement.label);
  }
  return { variantKey: engine.variantKey, version: engine.version, basis: book.basis, rulebookDigest: entry.rulebook.sha256,
    referenceDigest: entry.cases.sha256, caseCount: ids.size, steps, coverage: [...covered].sort() };
}

export async function verifyAcceptance(root, name, subject, requirements = acceptanceRequirements) {
  const report = JSON.parse(await fs.readFile(path.join(root, 'verification', name), 'utf8'));
  const subjectMatches = isNativeAcceptanceReport(name)
    ? report.subjectBeforeSha256 === subject.sha256 && report.subjectAfterSha256 === subject.sha256
    : report.subjectSha256 === subject.sha256;
  ensure(typeof subject.sha256 === 'string' && report.schemaVersion === 1 && report.passed === true && subjectMatches,
    'ACCEPTANCE_STALE_OR_INVALID', name);
  ensure(Array.isArray(report.checks) && report.checks.length > 0, 'ACCEPTANCE_CHECKS_MISSING', name);
  if (name === 'local-stability.json') {
    const raw = await readEvidenceJson(root, report, 'local-stability.json');
    assertEvidenceMatchesSubject(raw, report, name);
    assertLocalStabilityEvidence(raw, report);
    assertLocalStabilityMetrics(report, name);
  }
  const checks = new Set();
  for (const check of report.checks) {
    ensure(check.passed === true && typeof check.id === 'string', 'ACCEPTANCE_CHECK_FAILED', name);
    ensure(!checks.has(check.id), 'ACCEPTANCE_DUPLICATE_CHECK', name + ':' + check.id);
    checks.add(check.id);
  }
  for (const required of requirements[name]) ensure(checks.has(required), 'ACCEPTANCE_COVERAGE_MISSING', name + ':' + required);
  ensure(Array.isArray(report.evidence) && report.evidence.length > 0, 'ACCEPTANCE_EVIDENCE_MISSING', name);
  for (const artifact of report.evidence) await readArtifact(root, artifact);
  if (name === 'gameplay-capacity.json') {
    const m = report.metrics;
    ensure(m && m.actualPlayers >= 20 && m.durationSeconds >= 7200 && m.completedRounds > 0 && m.optimizedDeals > 0
      && Number.isFinite(m.actionP95Ms) && m.actionP95Ms >= 0 && m.actionP95Ms <= 300
      && Number.isFinite(m.dealP95Ms) && m.dealP95Ms >= 0 && m.dealP95Ms <= 2000
      && m.ledgerErrors === 0 && m.stateLosses === 0, 'GAMEPLAY_CAPACITY_TARGET_MISSING', name);
  }
  if (name === 'local-accounting.json') {
    const raw = await readEvidenceJson(root, report, 'local-accounting.json');
    assertEvidenceMatchesSubject(raw, report, name);
    assertLocalAccountingEvidence(raw, report.checks);
  }
  if (name === 'postgres-concurrency.json') {
    // The PostgreSQL gate is a two-file contract: the runner writes raw machine output under
    // verification/raw/, and the formal descriptor promotes it. Every promoted check must exist in
    // the raw run with the same outcome and details, so a hand-written formal file cannot invent a
    // pass that the database run never produced.
    const raw = await readEvidenceJson(root, report, 'postgres-concurrency.json');
    assertEvidenceMatchesSubject(raw, report, name);
    const rawChecks = rawCheckIndex(raw, name);
    for (const check of report.checks) assertRawCheck(rawChecks, check, name);
    ensure(rawChecks.size >= report.checks.length, 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH',
      name + ':raw checks must cover every promoted check.');
    for (const required of requirements[name]) {
      ensure(rawChecks.has(required), 'ACCEPTANCE_CHECK_EVIDENCE_MISMATCH', name + ':raw:' + required);
    }
  }
  if (name === 'local-recovery.json') {
    const raw = await readEvidenceJson(root, report, 'local-recovery.json');
    assertEvidenceMatchesSubject(raw, report, name);
    assertLocalRecoveryEvidence(raw, report.checks);
  }
  if (name === 'local-network.json') {
    const raw = await readEvidenceJson(root, report, 'local-network.json');
    assertEvidenceMatchesSubject(raw, report, name);
    assertLocalNetworkEvidence(raw, report.checks);
  }
  if (name === 'local-completed-games.json') {
    const raw = await readEvidenceJson(root, report, 'local-completed-games.json');
    assertEvidenceMatchesSubject(raw, report, name);
    assertCompletedGamesEvidence(raw, report);
  }
  if (isNativeAcceptanceReport(name)) {
    ensure(report.stage === 'acceptance', 'LOCAL_NATIVE_STAGE_INVALID', name);
    ensure(report.status === 'passed', 'LOCAL_NATIVE_STATUS_INVALID', name);
    ensure(typeof report.runId === 'string' && report.runId.trim(), 'LOCAL_NATIVE_RUN_ID_MISSING', name);
    ensure(/^[0-9a-f]{64}$/.test(subject.apk ?? '') && report.apkSha256 === subject.apk,
      'LOCAL_NATIVE_APK_MISMATCH', name);
    ensure(Array.isArray(report.devices), 'PHYSICAL_DEVICE_EVIDENCE_MISSING', name);
    const devices = new Set();
    for (const device of report.devices) assertLocalNativeDevice(device, devices, report.apkSha256);
    ensure(devices.size >= 2, 'PHYSICAL_DEVICE_EVIDENCE_MISSING', name);
    for (const check of report.checks) {
      if (!requirements[name].includes(check.id)) continue;
      ensure(Array.isArray(check.evidence) && check.evidence.length > 0,
        'LOCAL_NATIVE_CHECK_EVIDENCE_MISSING', check.id);
      for (const artifact of check.evidence) await readArtifact(root, artifact);
    }
    const run = await readEvidenceJson(root, report, 'acceptance-run.json');
    assertEvidenceMatchesSubject(run, report, name);
    const accounts = assertNativeRunEvidence(run, report);
    const rawDevices = await readEvidenceJson(root, report, 'two-physical-devices.json');
    assertEvidenceMatchesSubject(rawDevices, report, name);
    assertNativeDeviceEvidence(rawDevices, report, accounts);
    const rawLan = await readEvidenceJson(root, report, 'lan-without-adb.json');
    assertEvidenceMatchesSubject(rawLan, report, name);
    assertNativeLanEvidence(rawLan, report, accounts);
    assertNativeCheckEvidence(report, accounts, run, rawLan, new Set(requirements[name]));
  }
  return { file: name, checks: checks.size, artifacts: report.evidence.length, passed: true };
}

export function verifyCompletedRooms(report, variants, currentEngines) {
  ensure(!isSmokeArtifact(report), 'COMPLETE_ROOM_SMOKE_ARTIFACT',
    'A smoke-only artifact can never satisfy release acceptance.');
  ensure(Array.isArray(report.games), 'COMPLETE_ROOM_EVIDENCE_MISSING', 'Completed rooms are missing.');
  const expected = buildCanonicalRoomMatrix(variants, currentEngines);
  const expectedByKey = new Map();
  for (const cell of expected.cells) {
    ensure(!expectedByKey.has(cell.key), 'COMPLETE_ROOM_PLAN_INVALID', cell.key);
    expectedByKey.set(cell.key, cell);
  }
  const actualByKey = new Map();
  for (const game of report.games) {
    ensure(nonEmptyObject(game) && typeof game.variantKey === 'string' &&
      Number.isInteger(game.playerCount) && Number.isInteger(game.configuredRounds),
    'COMPLETE_ROOM_EVIDENCE_MISSING', 'local-completed-games.json:game');
    const key = canonicalCellKey(game.variantKey, game.playerCount, game.configuredRounds);
    ensure(!actualByKey.has(key), 'COMPLETE_ROOM_EVIDENCE_DUPLICATE', key);
    actualByKey.set(key, game);
  }
  for (const key of actualByKey.keys()) ensure(expectedByKey.has(key), 'COMPLETE_ROOM_EVIDENCE_EXTRA', key);
  for (const [key, cell] of expectedByKey) {
    const game = actualByKey.get(key);
    ensure(game, 'COMPLETE_ROOM_EVIDENCE_MISSING', key);
    ensure(game.completedRounds === cell.configuredRounds && game.replayVerified === true && game.passed === true,
      'COMPLETE_ROOM_EVIDENCE_MISSING', key);
    ensure(game.ruleVersion === cell.ruleVersion, 'COMPLETE_ROOM_STALE_VERSION',
      `${key}:${game.ruleVersion} != ${cell.ruleVersion}`);
    assertCompletedGame(game, report.subjectSha256);
    ensure(isDeepStrictEqual(game.normalizedOptions, cell.normalizedOptions),
      'COMPLETE_ROOM_OPTION_MISMATCH', key + ':normalizedOptions');
    ensure(game.optionsSha256 === cell.optionsSha256, 'COMPLETE_ROOM_OPTION_MISMATCH', key + ':optionsSha256');
    ensure(isDeepStrictEqual(game.optionCoverage, cell.optionCoverage),
      'COMPLETE_ROOM_OPTION_MISMATCH', key + ':optionCoverage');
  }
  const useCardTypeOne = [...actualByKey.values()].filter(game => game.normalizedOptions?.useCardType === 1);
  ensure(useCardTypeOne.some(game => game.variantKey === '4:0'),
    'COMPLETE_ROOM_OPTION_MISMATCH', '4:0:useCardType=1');
  for (const game of actualByKey.values()) {
    if (game.variantKey === '4:0' && game.normalizedOptions?.useCardType === 1) continue;
    ensure(game.normalizedOptions?.useCardType !== 1, 'COMPLETE_ROOM_OPTION_MISMATCH',
      `${game.variantKey}:${game.playerCount}:${game.configuredRounds}:unexpected-useCardType=1`);
  }
  ensure(report.matrixDigest === canonicalRoomMatrixDigest(expected),
    'COMPLETE_ROOM_PLAN_INVALID', 'local-completed-games.json:matrixDigest');
}

export async function auditRelease(root, entries, variants, subject, profile = 'production') {
  ensure(profile === 'production' || profile === 'local', 'INVALID_ACCEPTANCE_PROFILE', profile);
  const blockers = [], verified = [], acceptances = [], seen = new Set();
  for (const entry of entries) {
    const key = entry.engine.variantKey + '@' + entry.engine.version;
    if (seen.has(key)) blockers.push({ code: 'DUPLICATE_RUNTIME_ENGINE', key });
    seen.add(key);
    try {
      const variant = variants.find(variant => variant.key === entry.engine.variantKey);
      ensure(variant, 'UNKNOWN_RUNTIME_VARIANT', key);
      const verifiedEngine = await verifyRuntimeEngine(root, entry, variant.optionCoverage ?? []);
      await runSettlementRegressions({ root, engine: entry.engine, entry });
      verified.push(verifiedEngine);
    } catch (error) { blockers.push({ code: error.code ?? 'ENGINE_EVIDENCE_INVALID', variantKey: entry.engine.variantKey, detail: error.message }); }
  }
  for (const variant of variants) {
    const current = entries.filter(entry => entry.engine.variantKey === variant.key).at(-1);
    if (!current || !verified.some(entry => entry.variantKey === variant.key && entry.version === current.engine.version)) blockers.push({ code: 'MISSING_VERIFIED_RUNTIME_ENGINE', variantKey: variant.key, name: variant.name });
  }
  const requirements = profile === 'local' ? localAcceptanceRequirements : acceptanceRequirements;
  for (const name of Object.keys(requirements)) {
    try {
      acceptances.push(await verifyAcceptance(root, name, subject, requirements));
      if (name === 'local-completed-games.json') {
        const report = JSON.parse(await fs.readFile(path.join(root, 'verification', name), 'utf8'));
        const current = variants.flatMap(variant => {
          const entry = entries.filter(entry => entry.engine.variantKey === variant.key).at(-1);
          return entry ? verified.filter(engine => engine.variantKey === variant.key && engine.version === entry.engine.version) : [];
        });
        verifyCompletedRooms(report, variants, current);
      }
    }
    catch (error) { blockers.push({ code: error.code === 'ENOENT' ? 'ACCEPTANCE_MISSING' : error.code ?? 'ACCEPTANCE_INVALID', evidence: name, detail: error.message }); }
  }
  return { schemaVersion: 2, profile, generatedAt: new Date().toISOString(),
    releaseReady: profile === 'production' && blockers.length === 0, localReady: profile === 'local' && blockers.length === 0,
    configurations: variants.length, registeredEngines: entries.length, verifiedEngines: verified.length, subject, engines: verified, acceptances, blockers };
}
