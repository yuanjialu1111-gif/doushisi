import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeXinjinOptions, getDefaultOptions, getRoomSpec } from '../packages/rules/src/index.ts';
import { createXinjinEngine } from '../apps/server/src/game/xinjin-engine.ts';
import { createOptionProbe, mergeEvidenceCases } from './option-evidence.mjs';
import { approvalSha256, rulebookContentSha256 } from './rulebook-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/rules/release/4-0');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const seededRandom = seed => {
  let state = seed >>> 0;
  return max => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
};
const ruleVersion = 'xinjin-independent-v1';
const baseRules = {
  ...getDefaultOptions('4:0'),
  playerNum: 2,
  gameNum: 4,
  wangNum: 3,
  baseBeans: '0.125',
  qiToWang: 0,
  ziChi: 0,
  chengFan: 1,
  maxFan: 99,
};
const rules = { ...baseRules, xinjin: freezeXinjinOptions(baseRules) };
const input = {
  players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
  ownerUserId: 'a',
  number: 1,
  rules,
  policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
};
const engine = createXinjinEngine('pending-reference-digest', () => 0);
const initialSnapshot = engine.create(input);

assert.equal(initialSnapshot.version, ruleVersion);
assert.equal(initialSnapshot.phase, 'discard');
assert.deepEqual(initialSnapshot.cards.zones.find(zone => zone.id === 'hand:a').cards,
  ['card-2', 'card-4', 'card-6', 'card-8', 'card-10', 'card-12', 'card-14', 'card-16']);
assert.deepEqual(initialSnapshot.cards.zones.find(zone => zone.id === 'hand:b').cards,
  ['card-3', 'card-5', 'card-7', 'card-9', 'card-11', 'card-13', 'card-15']);

const rulebook = {
  schemaVersion: 1,
  status: 'approved',
  basis: 'user-approved',
  variantKey: '4:0',
  ruleVersion,
  title: '新津斗十四独立规则 v1',
  approval: { path: 'docs/rules/release/4-0/approval.json', sha256: '' },
  requiredCoverage: ['declared-wait-lock', 'concealed-four-pairs', 'payments'],
  sources: [
    'docs/rules/XINJIN-INDEPENDENT.md',
    'docs/rules/cases/xinjin-pack-v1.json',
    'apps/server/src/game/xinjin-pack.ts',
    'apps/server/src/game/xinjin-win.ts',
    'apps/server/src/game/xinjin-round.ts',
  ],
  summary: {
    deck: '52 ordinary cards plus configured 3/5/6/9 special cards; qiToWang changes only the four physical sevens.',
    win: 'Four groups: sum-14 pairs, exposed same-rank triples, or quads; concealed four-pairs is independent.',
    scoring: 'Package-backed fan table with qia20, longDui, xiaoHu, qia40/qia50 exclusivity and siGuiYi boundaries.',
    declaration: 'Declaration locks the server-computed wait faces.',
    payments: 'Exact per-payer 12-place rounding and no duplicate settlement.',
    zeroFan: 'A legal structure meeting the red-point threshold wins at zero fan for one settlement unit.',
  },
};
const approval = {
  kind: 'user-rule-approval',
  ruleVersion,
  variantKey: '4:0',
  recordedAt: '2026-09-16T00:00:00.000Z',
  statement: '用户全部自动批准，允许在21项范围内补齐新津独立规则定义。',
  evidenceReference: 'docs/rules/INDEPENDENT-APPROVAL.md',
};
const covers = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'draw', 'timeout', 'reconnect', 'privacy',
  'declared-wait-lock', 'concealed-four-pairs', 'payments'];

function zoneIds(snapshot, zoneId) {
  const zone = snapshot.cards?.zones?.find(item => item.id === zoneId);
  assert.ok(zone, `Missing card zone ${zoneId}.`);
  return zone.cards;
}

function declaredWaitLockCase(runtime, inputForCase, rulesForCase, caseId) {
  const initialSnapshot = runtime.create({ ...inputForCase, rules: rulesForCase });
  const actorId = initialSnapshot.activeId;
  const declaration = runtime.interactions.legalActions(initialSnapshot, actorId)
    .find(action => action.type === 'declare');
  assert.ok(declaration, `${caseId}: the seeded deal exposes no declaration.`);
  const declared = runtime.apply(structuredClone(initialSnapshot), actorId, structuredClone(declaration));
  assert.equal(declared.snapshot.phase, 'response', `${caseId}: declaration did not open a response window.`);
  const declaredPlayer = declared.snapshot.players.find(player => player.userId === actorId);
  assert.ok(Array.isArray(declaredPlayer?.declaredWaits) && declaredPlayer.declaredWaits.length > 0,
    `${caseId}: declaration did not record a non-empty wait set.`);
  const decisionId = `xj:${declared.snapshot.number}:${declared.snapshot.serial}`;
  const lockedDiscard = { type: 'discard', cardId: zoneIds(declared.snapshot, `hand:${actorId}`)[0], decisionId };
  let failure;
  try {
    runtime.apply(structuredClone(declared.snapshot), actorId, structuredClone(lockedDiscard));
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, 'INVALID_ACTION', `${caseId}: the locked discard was not rejected as INVALID_ACTION.`);
  return {
    id: caseId,
    initialSnapshot,
    covers: ['declared-wait-lock'],
    steps: [
      {
        actorId,
        action: declaration,
        assert: {
          'snapshot.phase': 'response',
          'snapshot.players.0.declaredWaits.length': declaredPlayer.declaredWaits.length,
        },
      },
      { actorId, action: lockedDiscard, errorCode: 'INVALID_ACTION' },
    ],
  };
}

function concealedFourPairsCase(runtime, inputForCase, rulesForCase, caseId) {
  const initialSnapshot = runtime.create({ ...inputForCase, rules: rulesForCase });
  const dealerId = initialSnapshot.activeId;
  const responderId = initialSnapshot.players.find(player => player.userId !== dealerId).userId;
  const legalDiscards = runtime.interactions.legalActions(initialSnapshot, dealerId)
    .filter(action => action.type === 'discard');
  for (const discard of legalDiscards) {
    const opened = runtime.apply(structuredClone(initialSnapshot), dealerId, structuredClone(discard));
    if (opened.snapshot.phase !== 'response') continue;
    for (const response of runtime.interactions.legalActions(opened.snapshot, responderId)) {
      if (response.type !== 'respond' || response.choiceId === null) continue;
      const finished = runtime.apply(structuredClone(opened.snapshot), responderId, structuredClone(response));
      const win = finished.snapshot.outcome?.winners?.[0]?.win;
      if (finished.snapshot.outcome?.reason !== 'hu' || win?.structure !== 'four-pairs') continue;
      return {
        id: caseId,
        initialSnapshot,
        covers: ['concealed-four-pairs', 'winning', 'scoring', 'payments'],
        steps: [
          {
            actorId: dealerId,
            action: discard,
            assert: { 'snapshot.phase': 'response' },
          },
          {
            actorId: responderId,
            action: response,
            assert: {
              'snapshot.phase': 'finished',
              'snapshot.outcome.reason': 'hu',
              'snapshot.outcome.winners.0.win.structure': 'four-pairs',
            },
          },
        ],
      };
    }
  }
  throw new Error(`${caseId}: the seeded deal exposes no four-pairs response.`);
}

const lockBaseRules = { ...baseRules, baoJiao: 1 };
const lockRules = { ...lockBaseRules, xinjin: freezeXinjinOptions(lockBaseRules) };
const fourPairsBaseRules = { ...baseRules, anDui: 1, longDui: 1 };
const fourPairsRules = { ...fourPairsBaseRules, xinjin: freezeXinjinOptions(fourPairsBaseRules) };

const cases = {
  schemaVersion: 1,
  variantKey: '4:0',
  ruleVersion,
  rulebookDigest: '',
  cases: [
    {
      id: 'deterministic-open-and-private-projection',
      initialSnapshot,
      covers,
      steps: [{
        actorId: 'a',
        action: { type: 'discard', cardId: 'card-2', decisionId: 'xj:1:1' },
        assert: {
          'snapshot.phase': 'response',
          'snapshot.activeId': 'b',
          'snapshot.players.0.melds.length': 0,
        },
      }],
      views: [{
        userId: 'b',
        expected: {
          version: ruleVersion,
          number: 1,
          phase: 'response',
          dealerId: 'a',
          activeId: 'b',
          decisionId: 'xj:1:4',
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
          players: [{ userId: 'a', seat: 1, declared: false, melds: [] },
            { userId: 'b', seat: 2, declared: false, melds: [], declaredWaits: null }],
          legalActions: [],
          responses: { id: 'xj:1:4', options: [], submitted: false },
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
        action: { type: 'discard', cardId: 'card-2', decisionId: 'xj:1:0' },
        errorCode: 'STALE_CLAIM_WINDOW',
      }],
    },
    declaredWaitLockCase(createXinjinEngine('pending-reference-digest', () => 0), input, lockRules,
      'declared-wait-lock-rejects-locked-discard'),
    concealedFourPairsCase(createXinjinEngine('pending-reference-digest', seededRandom(1139)), input, fourPairsRules,
      'concealed-four-pairs-wins'),
    ...createOptionProbe(engine, {
      variantKey: '4:0',
      baseRules,
      fields: getRoomSpec('4:0').fields,
      freeze: raw => freezeXinjinOptions(raw),
    }),
  ],
};

approval.rulebookSha256 = rulebookContentSha256(rulebook);
rulebook.approval.sha256 = approvalSha256(approval);
const rulebookText = json(rulebook);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'approval.json'), json(approval));
await writeFile(join(output, 'rulebook.json'), rulebookText);
cases.rulebookDigest = sha256(rulebookText);
const previousCases = await readFile(join(output, 'cases.json'), 'utf8')
  .then(JSON.parse).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
if (previousCases) cases.cases = mergeEvidenceCases(previousCases, cases.cases, {
  ownedCoverageExact: ['wildcards', 'gold-hook'],
}).cases;
await writeFile(join(output, 'cases.json'), json(cases));
const manifest = {
  schemaVersion: 1,
  variantKey: '4:0',
  ruleVersion,
  rulebook: { path: 'docs/rules/release/4-0/rulebook.json', sha256: cases.rulebookDigest },
  cases: { path: 'docs/rules/release/4-0/cases.json', sha256: sha256(json(cases)) },
  generatedAt: new Date().toISOString(),
};
await writeFile(join(output, 'manifest.json'), json(manifest));
console.log(JSON.stringify({ variantKey: '4:0', ruleVersion, cases: cases.cases.length, output }));
