import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABA_INDEPENDENT_VERSIONS, freezeAbaOptions, getDefaultOptions, getRoomSpec } from '../packages/rules/dist/index.js';
import { createAbaEngine } from '../apps/server/dist/game/aba-engine.js';
import { createOptionProbe, mergeEvidenceCases } from './option-evidence.mjs';
import { approvalSha256, rulebookContentSha256 } from './rulebook-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const variants = [
  { key: '9:0', directory: '9-0', source: 'docs/rules/ABA-INDEPENDENT.md' },
  { key: '10:0', directory: '10-0', source: 'docs/rules/variants/10-0.md' },
  { key: '11:0', directory: '11-0', source: 'docs/rules/variants/11-0.md' },
  { key: '12:0', directory: '12-0', source: 'docs/rules/variants/12-0.md' },
];

const specialtyCoverage = ['declared-wait-lock', 'concealed-four-pairs', 'payments'];

const baseCovers = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'draw', 'timeout', 'reconnect', 'privacy'];

const specialtyFixtures = {
  fourPairs: {
    huRedScore: 300,
    expectedStructure: 'four-pairs',
    codes: [110, 310, 109, 309, 108, 308, 202, 302],
    bonus: [],
  },
  declaration: {
    huRedScore: 300,
    codes: [110, 204, 201, 213, 202, 212, 203, 211],
    bonus: [1001, 1002],
  },
};

function openingState(engine, input, fixture) {
  const fixtureInput = {
    ...input,
    rules: {
      ...input.rules,
      huRedScore: fixture.huRedScore,
      aba: { ...input.rules.aba, huRedScore: fixture.huRedScore },
    },
  };
  const snapshot = engine.create(fixtureInput);
  const byCode = new Map();
  for (const card of snapshot.cards.pack) {
    const queue = byCode.get(card.code) ?? [];
    queue.push(card.id);
    byCode.set(card.code, queue);
  }
  const take = code => {
    const queue = byCode.get(code);
    assert.ok(queue?.length, 'The frozen Aba pack must contain code ' + code);
    return queue.shift();
  };
  const selected = fixture.codes.map(take);
  const bonus = fixture.bonus.map(take);
  const used = new Set([...selected, ...bonus]);
  const remaining = snapshot.cards.pack.map(card => card.id).filter(id => !used.has(id));
  const opponents = fixtureInput.players.map(player => player.userId).filter(userId => userId !== 'a');
  assert.ok(remaining.length >= opponents.length * 7,
    'Specialty fixture must leave every opponent seven cards and a deck');
  const zoneCards = new Map([
    ['hand:a', selected],
    ['bonus:a', bonus],
    ['melds:a', []],
    ['deck', remaining.slice(opponents.length * 7)],
    ['table', []],
    ['discards', []],
    ['won', []],
  ]);
  opponents.forEach((userId, index) => {
    zoneCards.set('hand:' + userId, remaining.slice(index * 7, (index + 1) * 7));
    zoneCards.set('melds:' + userId, []);
    zoneCards.set('bonus:' + userId, []);
    zoneCards.set('white:' + userId, []);
  });
  snapshot.cards.zones = snapshot.cards.zones.map(zone => ({
    ...zone,
    cards: zoneCards.get(zone.id) ?? [],
  }));
  snapshot.phase = 'discard';
  snapshot.activeId = 'a';
  snapshot.serial = 1;
  snapshot.source = { kind: 'replacement', userId: 'a', cardId: selected[0] };
  snapshot.claims = null;
  snapshot.outcome = null;
  snapshot.replenish = null;
  snapshot.pendingDiscards = [];
  const zoneSize = snapshot.cards.zones.reduce((sum, zone) => sum + zone.cards.length, 0);
  assert.equal(snapshot.cards.zones.find(zone => zone.id === 'hand:a').cards.length, 8);
  for (const userId of opponents) {
    assert.equal(snapshot.cards.zones.find(zone => zone.id === 'hand:' + userId).cards.length, 7);
  }
  assert.equal(snapshot.cards.pack.length, zoneSize, 'Specialty fixture must preserve the physical pack');
  return snapshot;
}

function buildFourPairsCase(engine, input, id, fixture, covers) {
  const snapshot = openingState(engine, input, fixture);
  const legal = engine.interactions.legalActions(snapshot, 'a');
  const offered = legal.filter(action => action.type === 'hu');
  assert.equal(offered.length, 1, `${id}: exactly one four-pairs hu action must be offered.`);
  const result = engine.apply(structuredClone(snapshot), 'a', offered[0]);
  assert.equal(result.snapshot.phase, 'finished', `${id}: the four-pairs hu must finish the round.`);
  assert.equal(result.snapshot.outcome?.reason, 'hu', `${id}: the four-pairs action must produce a hu outcome.`);
  assert.equal(result.snapshot.outcome?.winners?.[0]?.win?.structure, fixture.expectedStructure,
    `${id}: the accepted hu must use the four-pairs structure.`);
  return {
    id,
    initialSnapshot: snapshot,
    covers,
    steps: [{
      actorId: 'a',
      action: offered[0],
      assert: {
        'snapshot.phase': 'finished',
        'snapshot.outcome.reason': 'hu',
        'snapshot.outcome.winners.0.win.structure': fixture.expectedStructure,
      },
    }],
  };
}

function buildDeclaredWaitLockCase(engine, input, id, fixture, covers) {
  const snapshot = openingState(engine, input, fixture);
  const legal = engine.interactions.legalActions(snapshot, 'a');
  const declare = legal.find(action => action.type === 'declare');
  assert.ok(declare, `${id}: a real declare action must be offered.`);
  const declared = engine.apply(structuredClone(snapshot), 'a', declare);
  const waits = declared.snapshot.players.find(player => player.userId === 'a')?.declaredWaits;
  assert.ok(Array.isArray(waits) && waits.length > 0, `${id}: the declaration must lock server-computed waits.`);
  const decisionId = `ab:${declared.snapshot.number}:${declared.snapshot.serial}`;
  const repeated = legal.find(action => action.type === 'declare' && action.cardId !== declare.cardId) ?? declare;
  let rejection;
  try {
    engine.apply(structuredClone(declared.snapshot), 'a', { ...repeated, decisionId });
  } catch (error) {
    rejection = error;
  }
  assert.equal(rejection?.code, 'INVALID_ACTION',
    `${id}: a repeated declaration must be rejected with INVALID_ACTION.`);
  return {
    id,
    initialSnapshot: snapshot,
    covers,
    steps: [{
      actorId: 'a',
      action: declare,
      assert: {
        'snapshot.players.0.declaredWaits': waits,
        'snapshot.phase': declared.snapshot.phase,
      },
    }, {
      actorId: 'a',
      action: { ...repeated, decisionId },
      errorCode: 'INVALID_ACTION',
    }],
  };
}

for (const variant of variants) {
  const output = join(root, `docs/rules/release/${variant.directory}`);
  const ruleVersion = ABA_INDEPENDENT_VERSIONS[variant.key];
  const baseRules = { ...getDefaultOptions(variant.key), gameNum: 4, baseBeans: '0.125' };
  const playersFor = count => Array.from({ length: count }, (_, index) => ({
    userId: String.fromCharCode('a'.charCodeAt(0) + index), seat: index + 1,
  }));
  const inputFor = (overrides = {}) => {
    const nextRules = { ...baseRules, ...overrides };
    return {
      players: playersFor(Number(nextRules.playerNum)),
      ownerUserId: 'a',
      number: 1,
      rules: { ...nextRules, aba: freezeAbaOptions(nextRules, variant.key) },
      policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
    };
  };
  const input = inputFor({ playerNum: 2 });
  const engine = createAbaEngine('pending-reference-digest', () => 0, variant.key);
  const initialSnapshot = engine.create(input);
  assert.equal(initialSnapshot.version, ruleVersion);
  assert.equal(initialSnapshot.phase, 'discard');

  const rulebook = {
    schemaVersion: 1,
    status: 'approved',
    basis: 'user-approved',
    variantKey: variant.key,
    ruleVersion,
    title: `${variant.key} 阿坝斗十四独立规则`,
    approval: { path: `docs/rules/release/${variant.directory}/approval.json`, sha256: '' },
    requiredCoverage: specialtyCoverage,
    sources: [...new Set([variant.source, 'docs/rules/ABA-INDEPENDENT.md', 'apps/server/src/game/aba-pack.ts',
      'apps/server/src/game/aba-win.ts', 'apps/server/src/game/aba-round.ts'])],
    summary: {
      deck: '52 ordinary cards plus one small king, one big king and two white faces; no king-count selector.',
      win: '必须形成合法四组结构，且结构分 >= huRedScore 才可胡牌。起胡线仅由 huRedScore 决定，playerNum 不缩放；同一手牌在 2、3、4 人配置下给出相同胡牌结果。',
      threshold: '起胡线仅由 huRedScore 决定，playerNum 不缩放；playerNum 只影响入座、发牌和结算人数。',
      scoring: 'Structure score/100 * 2^cappedFan * 0.8, with explicit 258, double-in/out, haidilao and baijiao facts.',
      declaration: 'Declaration uses the configured threshold condition and locks the server-computed waits.',
      payments: 'Exact per-payer 12-place rounding and no duplicate settlement.',
    },
  };
  const approval = {
    kind: 'user-rule-approval',
    ruleVersion,
    variantKey: variant.key,
    recordedAt: '2026-09-16T00:00:00.000Z',
    statement: `用户全部自动批准，允许在21项范围内补齐${variant.key}阿坝独立规则定义。`,
    evidenceReference: 'docs/rules/INDEPENDENT-APPROVAL.md',
  };
  const covers = [...baseCovers];

  const optionCases = createOptionProbe(engine, {
    variantKey: variant.key,
    baseRules,
    fields: getRoomSpec(variant.key).fields,
    freeze: raw => freezeAbaOptions(raw, variant.key),
    playersFor: count => playersFor(count),
  });
  const specialtyCases = [
    buildFourPairsCase(engine, inputFor({ playerNum: 2 }), 'specialty-concealed-four-pairs',
      specialtyFixtures.fourPairs, [...baseCovers, 'concealed-four-pairs', 'payments']),
    buildDeclaredWaitLockCase(engine, inputFor({ playerNum: 2 }), 'specialty-declared-wait-lock',
      specialtyFixtures.declaration, [...baseCovers, 'declared-wait-lock']),
  ];
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
          action: { type: 'discard', cardId: 'card-2', decisionId: 'ab:1:1' },
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
            decisionId: 'ab:1:4',
            cards: [
              { id: 'deck', count: 40 },
              { id: 'table', count: 1, cards: [{ id: 'card-17', code: 204 }] },
              { id: 'discards', count: 1, cards: [{ id: 'card-2', code: 102 }] },
              { id: 'won', count: 0, cards: [] },
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
            responses: { id: 'ab:1:4', options: [], submitted: false },
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
          action: { type: 'discard', cardId: 'card-2', decisionId: 'ab:1:0' },
          errorCode: 'STALE_CLAIM_WINDOW',
        }],
      },
      ...optionCases,
      ...specialtyCases,
    ],
  };
  const generatedSpecialtyCases = cases.cases.filter(item => item.id.startsWith('specialty-'));
  assert.deepEqual(generatedSpecialtyCases.map(item => item.id),
    ['specialty-concealed-four-pairs', 'specialty-declared-wait-lock']);
  assert.ok(generatedSpecialtyCases[0].covers.includes('concealed-four-pairs')
    && generatedSpecialtyCases[0].covers.includes('payments'));
  assert.ok(generatedSpecialtyCases[1].covers.includes('declared-wait-lock'));

  approval.rulebookSha256 = rulebookContentSha256(rulebook);
  rulebook.approval.sha256 = approvalSha256(approval);
  const rulebookText = json(rulebook);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'approval.json'), json(approval));
  await writeFile(join(output, 'rulebook.json'), rulebookText);
  cases.rulebookDigest = sha256(rulebookText);
  const previousCases = await readFile(join(output, 'cases.json'), 'utf8')
    .then(JSON.parse).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (previousCases) {
    cases.cases = mergeEvidenceCases(previousCases, cases.cases, {
      ownedPrefixes: ['option-', 'score-threshold-', 'specialty-'],
      ownedCoverageExact: [],
    }).cases;
  }
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
