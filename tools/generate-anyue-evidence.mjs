import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeAnyueOptions, getDefaultOptions, getRoomSpec } from '../packages/rules/src/index.ts';
import { createAnyueEngine } from '../apps/server/src/game/anyue-engine.ts';
import { createOptionProbe, mergeEvidenceCases } from './option-evidence.mjs';
import { approvalSha256, rulebookContentSha256 } from './rulebook-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/rules/release/5-0');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const seededRandom = seed => {
  let state = seed >>> 0;
  return max => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
};
const ruleVersion = 'anyue-independent-v1';
const baseRules = {
  ...getDefaultOptions('5:0'),
  playerNum: 2,
  gameNum: 4,
  baseBeans: '0.125',
  piaoType: 2,
  maxFan: 99,
  chengFan: 0,
  zhuangJiadi: 0,
  cheLong: 0,
};
const rules = { ...baseRules, anyue: freezeAnyueOptions(baseRules) };
const input = {
  players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
  ownerUserId: 'a',
  number: 1,
  rules,
  policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
};
const engine = createAnyueEngine('pending-reference-digest', () => 0);
const initialSnapshot = engine.create(input);
assert.equal(initialSnapshot.version, ruleVersion);
assert.equal(initialSnapshot.phase, 'piao');
assert.deepEqual(initialSnapshot.players.map(player => player.piao), [null, null]);

const rulebook = {
  schemaVersion: 1,
  status: 'approved',
  basis: 'user-approved',
  variantKey: '5:0',
  ruleVersion,
  title: '安岳斗十四独立规则 v1',
  approval: { path: 'docs/rules/release/5-0/approval.json', sha256: '' },
  requiredCoverage: ['concealed-four-pairs', 'payments', 'piao'],
  sources: [
    'docs/rules/ANYUE-INDEPENDENT.md',
    'docs/rules/cases/anyue-pack-v1.json',
    'apps/server/src/game/anyue-pack.ts',
    'apps/server/src/game/anyue-win.ts',
    'apps/server/src/game/anyue-round.ts',
  ],
  summary: {
    deck: '52 ordinary cards plus one small king, one big king and one white face; qiToWang changes only the four sevens.',
    win: 'Four groups: sum-14 pairs, exposed same-rank triples, or quads; concealed four-pairs is independent.',
    piao: 'Piao is a payment-formula addend: none, mandatory one, or per-player 0/1 selection with timeout zero.',
    scoring: 'Piao modifies the base factor before the capped fan formula; it is not a standalone fan item.',
    payments: 'Self-draw charges every other player; discard charges the source; baopei makes the source pay all shares.',
  },
};
const approval = {
  kind: 'user-rule-approval',
  ruleVersion,
  variantKey: '5:0',
  recordedAt: '2026-09-16T00:00:00.000Z',
  statement: '用户全部自动批准，允许在21项范围内补齐安岳独立规则定义。',
  evidenceReference: 'docs/rules/INDEPENDENT-APPROVAL.md',
};
const covers = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'draw', 'timeout', 'reconnect', 'privacy',
  'concealed-four-pairs', 'payments', 'piao'];

function zoneIds(snapshot, zoneId) {
  const zone = snapshot.cards?.zones?.find(item => item.id === zoneId);
  assert.ok(zone, `Missing card zone ${zoneId}.`);
  return zone.cards;
}

function piaoCase(runtime, inputForCase, caseId) {
  const initialSnapshot = runtime.create(inputForCase);
  assert.equal(initialSnapshot.phase, 'piao', `${caseId}: piao phase did not open.`);
  const first = initialSnapshot.players[0].userId, second = initialSnapshot.players[1].userId;
  const firstAction = runtime.interactions.legalActions(initialSnapshot, first)
    .find(action => action.type === 'piao' && action.value === 1);
  assert.ok(firstAction, `${caseId}: player one has no real piao action.`);
  const afterFirst = runtime.apply(structuredClone(initialSnapshot), first, structuredClone(firstAction));
  const secondAction = runtime.interactions.legalActions(afterFirst.snapshot, second)
    .find(action => action.type === 'piao' && action.value === 0);
  assert.ok(secondAction, `${caseId}: player two has no real piao action.`);
  const opened = runtime.apply(structuredClone(afterFirst.snapshot), second, structuredClone(secondAction));
  assert.equal(opened.snapshot.phase, 'discard', `${caseId}: piao choices did not open discard.`);
  const discard = runtime.interactions.legalActions(opened.snapshot, first).find(action => action.type === 'discard');
  assert.ok(discard, `${caseId}: the opened deal exposes no legal discard.`);
  const discarded = runtime.apply(structuredClone(opened.snapshot), first, structuredClone(discard));
  assert.equal(discarded.snapshot.phase, 'discard', `${caseId}: the response window did not advance.`);
  return {
    id: caseId,
    initialSnapshot,
    covers,
    steps: [
      { actorId: first, action: firstAction, assert: { 'snapshot.phase': 'piao', 'snapshot.players.0.piao': 1 } },
      {
        actorId: second,
        action: secondAction,
        assert: {
          'snapshot.phase': 'discard',
          'snapshot.activeId': first,
          'snapshot.players.0.piao': 1,
          'snapshot.players.1.piao': 0,
        },
      },
      {
        actorId: first,
        action: discard,
        assert: {
          'snapshot.phase': 'discard',
          'snapshot.activeId': second,
          'snapshot.source.kind': 'replacement',
          'snapshot.source.userId': second,
        },
      },
    ],
    views: [{
      userId: second,
      expected: {
        version: ruleVersion,
        number: 1,
        phase: 'discard',
        dealerId: first,
        activeId: second,
        decisionId: `ay:1:${discarded.snapshot.serial}`,
        piao: [{ userId: first, value: 1 }, { userId: second, value: 0 }],
        cards: [
          { id: 'deck', count: 35 },
          { id: 'table', count: 0, cards: [] },
          { id: 'discards', count: 3, cards: [
            { id: 'card-2', code: 102 }, { id: 'card-18', code: 205 }, { id: 'card-19', code: 206 },
          ] },
          { id: 'hand:a', ownerId: first, count: 7 },
          { id: 'melds:a', ownerId: first, count: 0, cards: [] },
          { id: 'bonus:a', ownerId: first, count: 0, cards: [] },
          { id: 'hand:b', ownerId: second, count: 8, cards: [
            { id: 'card-3', code: 103 }, { id: 'card-5', code: 105 }, { id: 'card-9', code: 109 },
            { id: 'card-11', code: 111 }, { id: 'card-13', code: 113 }, { id: 'card-15', code: 202 },
            { id: 'card-17', code: 204 }, { id: 'card-21', code: 208 },
          ] },
          { id: 'melds:b', ownerId: second, count: 0, cards: [] },
          { id: 'bonus:b', ownerId: second, count: 2, cards: [
            { id: 'card-7', code: 107 }, { id: 'card-20', code: 207 },
          ] },
        ],
        players: [{ userId: first, seat: 1, melds: [] }, { userId: second, seat: 2, melds: [] }],
        legalActions: runtime.interactions.legalActions(discarded.snapshot, second),
        responses: discarded.snapshot.claims ? runtime.view(discarded.snapshot, second).responses : null,
        outcome: null,
      },
    }],
  };
}

function concealedFourPairsCase(runtime, inputForCase, caseId) {
  const initialSnapshot = runtime.create(inputForCase);
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

function stalePiaoCase(runtime, inputForCase, caseId) {
  const initialSnapshot = runtime.create(inputForCase);
  const actorId = initialSnapshot.players[0].userId;
  const action = runtime.interactions.legalActions(initialSnapshot, actorId).find(candidate => candidate.type === 'piao');
  assert.ok(action, `${caseId}: no piao action is available.`);
  const stale = { ...structuredClone(action), decisionId: `ay:1:${initialSnapshot.serial + 1}` };
  let failure;
  try {
    runtime.apply(structuredClone(initialSnapshot), actorId, structuredClone(stale));
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, 'STALE_CLAIM_WINDOW', `${caseId}: stale piao was not rejected.`);
  return { id: caseId, initialSnapshot, covers, steps: [{ actorId, action: stale, errorCode: 'STALE_CLAIM_WINDOW' }] };
}

const piaoRules = { ...baseRules, anyue: freezeAnyueOptions(baseRules) };
const fourPairsBaseRules = { ...baseRules, piaoType: 0, anDui: 1 };
const fourPairsRules = { ...fourPairsBaseRules, anyue: freezeAnyueOptions(fourPairsBaseRules) };

const cases = {
  schemaVersion: 1,
  variantKey: '5:0',
  ruleVersion,
  rulebookDigest: '',
  cases: [
    piaoCase(createAnyueEngine('pending-reference-digest', () => 0), { ...input, rules: piaoRules },
      'piao-selection-then-private-open'),
    stalePiaoCase(createAnyueEngine('pending-reference-digest', () => 0), { ...input, rules: piaoRules },
      'stale-piao-is-rejected'),
    concealedFourPairsCase(createAnyueEngine('pending-reference-digest', seededRandom(41)), { ...input, rules: fourPairsRules },
      'concealed-four-pairs-wins'),
    ...createOptionProbe(engine, {
      variantKey: '5:0',
      baseRules,
      fields: getRoomSpec('5:0').fields,
      freeze: raw => freezeAnyueOptions(raw),
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
  ownedCoverageExact: ['wildcards', 'gold-hook', 'declared-wait-lock'],
}).cases;
await writeFile(join(output, 'cases.json'), json(cases));
const manifest = {
  schemaVersion: 1,
  variantKey: '5:0',
  ruleVersion,
  rulebook: { path: 'docs/rules/release/5-0/rulebook.json', sha256: cases.rulebookDigest },
  cases: { path: 'docs/rules/release/5-0/cases.json', sha256: sha256(json(cases)) },
  generatedAt: new Date().toISOString(),
};
await writeFile(join(output, 'manifest.json'), json(manifest));
console.log(JSON.stringify({ variantKey: '5:0', ruleVersion, cases: cases.cases.length, output }));
