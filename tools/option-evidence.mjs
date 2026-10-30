import assert from 'node:assert/strict';

const RESERVED_FREEZE_FIELDS = new Set(['useCardType', 'gameNum', 'baseBeans']);

const FREEZE_FIELD_BY_GAME_ID = new Map([
  [4, 'xinjin'],
  [5, 'anyue'],
  [6, 'yaan'],
  [7, 'pujiang'],
  [8, 'qionglai'],
  [9, 'aba'], [10, 'aba'], [11, 'aba'], [12, 'aba'],
  [14, 'scoreRegion'], [15, 'scoreRegion'], [16, 'scoreRegion'], [19, 'scoreRegion'],
  [20, 'scoreRegion'], [21, 'scoreRegion'], [22, 'scoreRegion'], [23, 'scoreRegion'],
  [24, 'scoreRegion'], [25, 'scoreRegion'], [26, 'scoreRegion'], [27, 'scoreRegion'],
]);

/** Every regional engine reads its frozen metadata from a named field, never the rules root. */
export function freezeFieldForVariant(variantKey) {
  const gameId = Number(String(variantKey).split(':')[0]);
  const field = FREEZE_FIELD_BY_GAME_ID.get(gameId);
  if (!field) throw new Error(variantKey + ': no frozen metadata field is registered');
  return field;
}

function freezeField(overrides, freeze, variantKey) {
  const keys = Object.keys(freeze ?? {}).filter(key => !RESERVED_FREEZE_FIELDS.has(key));
  return {
    variantKey,
    keys,
    canonicalize(rules) {
      const next = { ...rules };
      delete next.baseBeans;
      for (const key of Object.keys(next)) {
        if (key === 'playerNum' || RESERVED_FREEZE_FIELDS.has(key)) continue;
        if (typeof next[key] === 'object' && next[key] !== null) delete next[key];
      }
      return next;
    },
  };
}

export function createOptionProbe(engine, options) {
  assert.ok(engine && typeof engine.create === 'function' && typeof engine.apply === 'function',
    'An option probe requires a runtime engine with create/apply.');
  assert.ok(options && typeof options === 'object', 'Option probe options are required.');
  const { variantKey, baseRules, fields, freeze, playersFor, compatibleOverrides } = options;
  assert.ok(typeof variantKey === 'string' && variantKey.length > 0, 'variantKey is required.');
  assert.ok(baseRules && typeof baseRules === 'object', 'baseRules are required.');
  assert.ok(Array.isArray(fields) && fields.length > 0, 'fields are required.');
  assert.ok(typeof freeze === 'function', 'freeze is required.');
  const makePlayers = playersFor ?? (count => ['a', 'b', 'c', 'd'].slice(0, count)
    .map((userId, index) => ({ userId, seat: index + 1 })));
  const freezeField = typeof options.freezeField === 'function' ? options.freezeField(variantKey)
    : options.freezeField ?? freezeFieldForVariant(variantKey);
  const compatible = typeof compatibleOverrides === 'function' ? compatibleOverrides : () => ({});

  const rulesFor = overrides => {
    const raw = { ...baseRules, ...overrides };
    if (!Object.hasOwn(raw, 'playerNum')) throw new Error(variantKey + ': option probe requires an explicit playerNum');
    const frozen = freeze(raw, variantKey);
    return { ...raw, [freezeField]: frozen };
  };

  const inputFor = rules => {
    const playerNum = Number(rules.playerNum);
    assert.ok(Number.isInteger(playerNum) && playerNum >= 2, variantKey + ': invalid playerNum');
    return {
      players: makePlayers(playerNum),
      ownerUserId: 'a',
      number: 1,
      rules,
      policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
    };
  };

  const cases = [];
  const seen = new Set();
  for (const field of fields) {
    assert.ok(field && typeof field.key === 'string' && Array.isArray(field.allowedValues),
      variantKey + ': every field must expose key/allowedValues');
    for (const value of field.allowedValues) {
      const label = `option:${field.key}=${JSON.stringify(value)}`;
      const caseId = `option-${field.key}-${JSON.stringify(value).replace(/[^A-Za-z0-9_-]/g, '_')}`;
      assert.equal(seen.has(caseId), false, variantKey + ': duplicate option case ' + caseId);
      seen.add(caseId);

      const rules = rulesFor({ ...compatible(variantKey, field.key, value, baseRules), [field.key]: value });
      const initialSnapshot = engine.create(inputFor(rules));
      const actorId = initialSnapshot.activeId ?? initialSnapshot.players?.[0]?.userId ?? 'a';
      const legal = engine.interactions.legalActions(initialSnapshot, actorId);
      assert.ok(Array.isArray(legal) && legal.length > 0, label + ': no legal action was exposed');
      const action = legal.find(candidate => candidate.type !== 'begin') ?? legal[0];
      const result = engine.apply(structuredClone(initialSnapshot), actorId, structuredClone(action));
      assert.equal(result.snapshot?.rules?.[field.key], value, label + ': engine did not preserve the option');
      cases.push({
        id: caseId,
        initialSnapshot,
        covers: [label],
        steps: [{
          actorId,
          action,
          assert: {
            ['snapshot.rules.' + field.key]: value,
            'snapshot.phase': result.snapshot.phase,
          },
        }],
      });
    }
  }
  return cases;
}

export function optionCoverageLabels(fields) {
  return fields.flatMap(field => field.allowedValues.map(value =>
    `option:${field.key}=${JSON.stringify(value)}`));
}

/**
 * Merge freshly generated evidence into an existing suite without discarding
 * hand-written regression cases. Generated case IDs and the coverage labels
 * they own are replaced deterministically; every other case is preserved.
 */
export function mergeEvidenceCases(existingDoc, generatedCases, {
  ownedPrefixes = ['option-'],
  ownedCoveragePrefixes = ['option:'],
  ownedCoverageExact = [],
  normalizePreserved = item => item,
} = {}) {
  assert.ok(existingDoc && Array.isArray(existingDoc.cases), 'existingDoc.cases is required');
  assert.ok(Array.isArray(generatedCases), 'generatedCases must be an array');
  assert.ok(Array.isArray(ownedPrefixes) && ownedPrefixes.length > 0,
    'ownedPrefixes must contain at least one case-id prefix');
  assert.ok(Array.isArray(ownedCoveragePrefixes) && Array.isArray(ownedCoverageExact),
    'ownedCoveragePrefixes and ownedCoverageExact must be arrays');
  const generatedIds = new Set(generatedCases.map(item => item.id));
  assert.equal(generatedIds.size, generatedCases.length, 'generated case IDs must be unique');
  const ownedCoverage = new Set(generatedCases.flatMap(item => item.covers ?? []).filter(category =>
    ownedCoverageExact.includes(category) || ownedCoveragePrefixes.some(prefix => category.startsWith(prefix))));
  const preserved = existingDoc.cases
    .filter(reference => !generatedIds.has(reference.id) &&
      !ownedPrefixes.some(prefix => reference.id.startsWith(prefix)))
    .map(reference => normalizePreserved({
      ...reference,
      covers: (reference.covers ?? []).filter(category => !ownedCoverage.has(category)),
    }));
  return { ...existingDoc, cases: [...preserved, ...generatedCases] };
}
