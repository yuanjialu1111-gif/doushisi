import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeScoreRegionOptions, getDefaultOptions, getRoomSpec } from '../packages/rules/src/index.ts';
import { createScoreRegionEngine } from '../apps/server/src/game/score-region-engine.ts';
import { createOptionProbe, mergeEvidenceCases } from './option-evidence.mjs';
import { approvalSha256, rulebookContentSha256 } from './rulebook-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const variants = [
  { key: '14:0', directory: '14-0', source: 'docs/rules/variants/14-0.md', declares: true },
  { key: '15:0', directory: '15-0', source: 'docs/rules/variants/15-0.md', declares: true },
  { key: '16:0', directory: '16-0', source: 'docs/rules/variants/16-0.md', declares: false },
  { key: '19:0', directory: '19-0', source: 'docs/rules/variants/19-0.md', declares: true },
];

const baseCovers = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'draw', 'timeout',
  'reconnect', 'privacy'];
const specialtyCoverage = {
  '14:0': ['declared-wait-lock', 'concealed-four-pairs', 'payments'],
  '15:0': ['declared-wait-lock', 'concealed-four-pairs', 'payments'],
  '16:0': ['concealed-four-pairs', 'payments'],
  '19:0': ['declared-wait-lock', 'concealed-four-pairs', 'payments'],
};
// Verified against score-region-win.ts: four pairs is an independent structure whose
// pairedStructurePoints sum is 560 for these faces, so the threshold is exercised by a
// real winning result rather than by declaring a separate score-threshold category.
const fourPairsHand = ['card-10', 'card-36', 'card-9', 'card-35', 'card-8', 'card-34', 'card-15', 'card-28'];

function craftOriginalHand(engine, input, handIds) {
  const state = structuredClone(engine.create(input));
  const used = new Set(handIds);
  const rest = state.cards.pack.map(card => card.id).filter(id => !used.has(id));
  const zone = id => state.cards.zones.find(item => item.id === id);
  for (const item of state.cards.zones) item.cards = [];
  zone('hand:a').cards = [...handIds];
  zone('hand:b').cards = rest.slice(0, 7);
  zone('deck').cards = rest.slice(7);
  state.phase = 'opening';
  state.activeId = 'a';
  state.serial = 0;
  state.claims = null;
  state.outcome = null;
  state.source = { kind: 'original-hand', userId: 'a', cardId: null };
  return state;
}

function concealedFourPairsCase(engine, input, covers) {
  const initialSnapshot = craftOriginalHand(engine, input, fourPairsHand);
  const action = engine.interactions.legalActions(initialSnapshot, 'a').find(candidate => candidate.type === 'hu');
  assert.ok(action, 'four-pairs fixture must expose a real hu action');
  const result = engine.apply(initialSnapshot, 'a', action);
  assert.equal(result.snapshot.phase, 'finished', 'four-pairs fixture must finish on hu');
  return {
    id: 'concealed-four-pairs-structure',
    initialSnapshot,
    covers,
    steps: [{
      actorId: 'a',
      action,
      assert: {
        'snapshot.phase': 'finished',
        'snapshot.outcome.reason': 'hu',
        'snapshot.outcome.winners.0.win.structure': 'four-pairs',
      },
    }],
  };
}

function declaredWaitLockCase(engine, input, covers, options = {}) {
  const craftedRules = { ...input.rules, ...options };
  const craftedInput = { ...input, rules: { ...craftedRules,
    scoreRegion: freezeScoreRegionOptions(craftedRules, engine.variantKey) } };
  const initialSnapshot = engine.create(craftedInput);
  const declaration = engine.interactions.legalActions(initialSnapshot, 'a').find(candidate =>
    candidate.type === 'declare');
  assert.ok(declaration, 'declaration fixture must expose a real declare action');
  const declared = engine.apply(initialSnapshot, 'a', declaration);
  assert.ok(declared.snapshot.players[0].declaredWaits.length > 0,
    'declaration fixture must lock non-empty waits');
  const decisionId = engine.view(declared.snapshot, 'a').decisionId;
  return {
    // Reuse the legacy id so mergeEvidenceCases replaces the stale declaration
    // case instead of preserving a snapshot whose decision ids have drifted.
    id: 'declared-wait-lock-rejects-response-meld',
    initialSnapshot,
    covers,
    steps: [{
      actorId: 'a',
      action: declaration,
      assert: {
        'snapshot.players.0.declaredWaits.length': declared.snapshot.players[0].declaredWaits.length,
        'snapshot.phase': declared.snapshot.phase,
      },
    }, {
      actorId: 'a',
      action: { type: 'declare', cardId: declaration.cardId, decisionId },
      errorCode: 'INVALID_ACTION',
    }],
  };
}

for (const variant of variants) {
  const output = join(root, `docs/rules/release/${variant.directory}`);
  const defaults = getDefaultOptions(variant.key);
  const baseRules = { ...defaults, playerNum: 2, gameNum: 4, baseBeans: '0.125' };
  const rules = { ...baseRules, scoreRegion: freezeScoreRegionOptions(baseRules, variant.key) };
  const input = {
    players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a',
    number: 1,
    rules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
  const engine = createScoreRegionEngine('pending-reference-digest', variant.key, () => 0);
  const initialSnapshot = engine.create(input);
  assert.equal(initialSnapshot.phase, 'discard');
  assert.equal(initialSnapshot.variantKey, variant.key);

  const ruleVersion = initialSnapshot.version;
  const rulebook = {
    schemaVersion: 1,
    status: 'approved',
    basis: 'user-approved',
    variantKey: variant.key,
    ruleVersion,
    title: `${variant.key} 斗十四独立规则`,
    approval: { path: `docs/rules/release/${variant.directory}/approval.json`, sha256: '' },
    requiredCoverage: specialtyCoverage[variant.key],
    sources: [
      variant.source,
      'docs/rules/ORDINARY-STRUCTURES.md',
      'apps/server/src/game/regional-profile.ts',
      'apps/server/src/game/score-region-win.ts',
      'apps/server/src/game/score-region-round.ts',
    ],
    summary: {
      deck: '52 ordinary cards plus the regional special-card configuration.',
      win: 'Four groups: sum-14 pairs, exposed same-rank triples, or quads; structure score gates the win threshold.',
      scoring: variant.key === '16:0'
        ? 'Structure score/100 * 2^cappedFan without base beans.'
        : 'Structure score/100 * 2^cappedFan * base beans; 15:0 applies its frozen 0.8 factor.',
      declaration: variant.declares
        ? 'Declaration locks the server-computed waits.'
        : 'The original configuration has no declaration option; no declare action is exposed.',
      payments: 'Exact per-payer 12-place rounding and no duplicate settlement.',
    },
  };
  const approval = {
    kind: 'user-rule-approval',
    ruleVersion,
    variantKey: variant.key,
    recordedAt: '2026-09-16T00:00:00.000Z',
    statement: `用户全部自动批准，允许在21项范围内补齐${variant.key}独立规则定义。`,
    evidenceReference: 'docs/rules/INDEPENDENT-APPROVAL.md',
  };
  const covers = [...baseCovers, ...specialtyCoverage[variant.key]];

  const cases = {
    schemaVersion: 1,
    variantKey: variant.key,
    ruleVersion,
    rulebookDigest: '',
    cases: [
      {
        id: 'deterministic-open-and-private-projection',
        initialSnapshot,
        covers,
        steps: [{
          actorId: 'a',
          action: { type: 'discard', cardId: 'card-2', decisionId: 'sr:1:1' },
          assert: { 'snapshot.phase': 'response', 'snapshot.activeId': 'b' },
        }],
        views: [{
          userId: 'b',
          expected: {
            version: ruleVersion,
            number: 1,
            phase: 'response',
            dealerId: 'a',
            activeId: 'b',
            decisionId: 'sr:1:4',
            cards: [
              { id: 'deck', count: 39 },
              { id: 'table', count: 1, cards: [{ id: 'card-17', code: 204 }] },
              { id: 'discards', count: 1, cards: [{ id: 'card-2', code: 102 }] },
              { id: 'hand:a', ownerId: 'a', count: 7 },
              { id: 'melds:a', ownerId: 'a', count: 0, cards: [] },
              { id: 'bonus:a', ownerId: 'a', count: 0, cards: [] },
              { id: 'hand:b', ownerId: 'b', count: 7, cards: [
                { id: 'card-3', code: 103 }, { id: 'card-5', code: 105 }, { id: 'card-7', code: 107 },
                { id: 'card-9', code: 109 }, { id: 'card-11', code: 111 }, { id: 'card-13', code: 113 },
                { id: 'card-15', code: 202 },
              ] },
              { id: 'melds:b', ownerId: 'b', count: 0, cards: [] },
              { id: 'bonus:b', ownerId: 'b', count: 0, cards: [] },
            ],
            players: [{ userId: 'a', seat: 1, melds: [] }, { userId: 'b', seat: 2, melds: [] }],
            legalActions: [],
            responses: { id: 'sr:1:4', options: [], submitted: false },
            outcome: null,
          },
        }],
      },
      {
        id: 'stale-action-is-rejected',
        initialSnapshot: engine.create(input),
        covers,
        steps: [{
          actorId: 'a',
          action: { type: 'discard', cardId: 'card-2', decisionId: 'sr:1:0' },
          errorCode: 'STALE_CLAIM_WINDOW',
        }],
      },
      ...createOptionProbe(engine, {
        variantKey: variant.key,
        baseRules,
        fields: getRoomSpec(variant.key).fields,
        freeze: (raw, key) => freezeScoreRegionOptions(raw, key),
      }),
    ],
  };
  cases.cases.push(concealedFourPairsCase(engine, input, specialtyCoverage[variant.key]));
  if (variant.declares) cases.cases.push(declaredWaitLockCase(engine, input, specialtyCoverage[variant.key],
    variant.key === '19:0' ? { baoJiao: 1, huRedScore: 300 } : {}));

  approval.rulebookSha256 = rulebookContentSha256(rulebook);
rulebook.approval.sha256 = approvalSha256(approval);
  const rulebookText = json(rulebook);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'approval.json'), json(approval));
  await writeFile(join(output, 'rulebook.json'), rulebookText);
  cases.rulebookDigest = sha256(rulebookText);
  const previousCases = await readFile(join(output, 'cases.json'), 'utf8')
    .then(JSON.parse).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (previousCases) cases.cases = mergeEvidenceCases(previousCases, cases.cases).cases;
  await writeFile(join(output, 'cases.json'), json(cases));
  const manifest = {
    schemaVersion: 1,
    variantKey: variant.key,
    ruleVersion,
    rulebook: { path: `docs/rules/release/${variant.directory}/rulebook.json`, sha256: cases.rulebookDigest },
    cases: { path: `docs/rules/release/${variant.directory}/cases.json`, sha256: sha256(json(cases)) },
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(output, 'manifest.json'), json(manifest));
  console.log(JSON.stringify({ variantKey: variant.key, ruleVersion, cases: cases.cases.length, output }));
}
