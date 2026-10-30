import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeYaanOptions, getDefaultOptions, getRoomSpec } from '../packages/rules/src/index.ts';
import { createYaanEngine } from '../apps/server/src/game/yaan-engine.ts';
import { createOptionProbe, mergeEvidenceCases } from './option-evidence.mjs';
import { approvalSha256, rulebookContentSha256 } from './rulebook-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/rules/release/6-0');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const ruleVersion = 'yaan-independent-v1';

function craftYaanState({
  options = {},
  handA = [],
  handB = [],
  meldsA = [],
  meldsB = [],
  deckCodes = [],
  incomingCode = null,
  activeId = 'a',
  source = null,
  discards = 2,
}) {
  const craftedRules = { ...baseRules, ...options };
  const frozenRules = { ...craftedRules, yaan: freezeYaanOptions(craftedRules) };
  const craftedInput = { ...input, rules: frozenRules };
  const state = structuredClone(engine.create(craftedInput));
  const used = new Set();
  const take = code => {
    const card = state.cards.pack.find(item => item.code === code && !used.has(item.id));
    assert.ok(card, `fixture requested unavailable face ${code}`);
    used.add(card.id);
    return card.id;
  };
  const idsFor = codes => codes.map(take);
  const handAIds = idsFor(handA);
  const handBIds = idsFor(handB);
  const incomingIds = incomingCode === null ? [] : idsFor([incomingCode]);
  handAIds.push(...incomingIds);
  const meldAIds = meldsA.map(meld => idsFor(meld.codes));
  const meldBIds = meldsB.map(meld => idsFor(meld.codes));
  const preferredDeck = idsFor(deckCodes);
  const deckIds = [...preferredDeck, ...state.cards.pack.filter(card => !used.has(card.id)).map(card => card.id)];
  const zone = id => state.cards.zones.find(item => item.id === id);
  for (const item of state.cards.zones) item.cards = [];
  zone('deck').cards = deckIds;
  zone('hand:a').cards = handAIds;
  zone('hand:b').cards = handBIds;
  zone('melds:a').cards = meldAIds.flat();
  zone('melds:b').cards = meldBIds.flat();
  zone('bonus:a').cards = [];
  zone('bonus:b').cards = [];
  state.players[0].melds = meldsA.map((meld, index) => ({ kind: meld.kind, cardIds: meldAIds[index] }));
  state.players[1].melds = meldsB.map((meld, index) => ({ kind: meld.kind, cardIds: meldBIds[index] }));
  state.players[0].declaredWaits = null;
  state.players[0].declaredBonusIds = null;
  state.players[1].declaredWaits = null;
  state.players[1].declaredBonusIds = null;
  state.phase = 'discard';
  state.activeId = activeId;
  state.claims = null;
  state.outcome = null;
  state.serial = 1;
  state.source = incomingIds.length
    ? { kind: 'discard', userId: 'b', cardId: incomingIds[0] }
    : source;
  state.rules.__discards = discards;
  return state;
}

function winningFixture(id, covers, state, actorId = 'a', extraAssert = {}) {
  const action = engine.interactions.legalActions(state, actorId).find(item => item.type === 'hu');
  assert.ok(action, `${id}: fixture must expose a real hu action`);
  const result = engine.apply(state, actorId, action);
  assert.equal(result.snapshot.phase, 'finished', `${id}: fixture must finish on hu`);
  return {
    id,
    initialSnapshot: state,
    covers,
    steps: [{
      actorId,
      action,
      assert: {
        'snapshot.phase': 'finished',
        'snapshot.outcome.reason': 'hu',
        'snapshot.outcome.winners.0.win.status': 'winning',
        ...extraAssert,
      },
    }],
  };
}

const baseRules = {
  ...getDefaultOptions('6:0'),
  playerNum: 2,
  gameNum: 4,
  wangNum: 3,
  qiWangNum: 0,
  baseBeans: '0.125',
  baoJiao: 1,
  ziChi: 0,
};
const rules = { ...baseRules, yaan: freezeYaanOptions(baseRules) };
const input = {
  players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
  ownerUserId: 'a',
  number: 1,
  rules,
  policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
};
const engine = createYaanEngine('pending-reference-digest', () => 0);
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
  variantKey: '6:0',
  ruleVersion,
  title: '雅安红二十独立规则 v1',
  approval: { path: 'docs/rules/release/6-0/approval.json', sha256: '' },
  requiredCoverage: ['wildcards', 'gold-hook', 'declared-wait-lock', 'concealed-four-pairs', 'payments'],
  sources: [
    'docs/rules/YAAN-INDEPENDENT.md',
    'docs/rules/IMPLEMENTATION-20260916.md',
    'packages/rules/src/edition.ts',
    'apps/server/src/game/yaan-pack.ts',
    'apps/server/src/game/yaan-win.ts',
    'apps/server/src/game/yaan-round.ts',
  ],
  summary: {
    deck: '52 ordinary cards; configured wang and enabled sevens are in-hand wildcards; qiWangNum=0 keeps ordinary sevens.',
    win: 'Four groups of sum-14 pairs, same-rank peng/tou triples, or gang/ba quads; concealed four-pairs is an independent structure.',
    scoring: 'The package-backed scorer uses explicit qia20, baoJiao, anDui/dragon, gang, color, and fifty switches.',
    declaration: 'A declaration locks the server-computed wait faces; response melds are forbidden after declaration.',
    goldHook: 'Three exposed peng/gang/ba groups plus two concealed cards that form a legal group after the winning card.',
  },
};

const approval = {
  kind: 'user-rule-approval',
  ruleVersion,
  variantKey: '6:0',
  recordedAt: '2026-09-16T00:00:00.000Z',
  statement: '用户全部自动批准，允许在21项范围内补齐雅安独立规则定义。',
  evidenceReference: 'docs/rules/INDEPENDENT-APPROVAL.md',
};

const baseCovers = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'draw', 'timeout', 'reconnect', 'privacy'];
const covers = baseCovers;
const cases = {
  schemaVersion: 1,
  variantKey: '6:0',
  ruleVersion,
  rulebookDigest: '',
  cases: [
    {
      id: 'deterministic-open-and-private-projection',
      initialSnapshot,
      covers,
      steps: [{
        actorId: 'a',
        action: { type: 'discard', cardId: 'card-2', decisionId: 'ya:1:1' },
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
          decisionId: 'ya:1:4',
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
          responses: { id: 'ya:1:4', options: [], submitted: false },
          outcome: null,
        },
      }],
    },
    {
      id: 'declared-wait-lock-rejects-response-meld',
      initialSnapshot: engine.create(input),
      covers: ['declared-wait-lock'],
      steps: [{
        actorId: 'a',
        action: { type: 'declare', cardId: 'card-14', decisionId: 'ya:1:1' },
        assert: {
          'snapshot.players.0.declaredWaits.length': 4,
          'snapshot.phase': 'response',
          'snapshot.activeId': 'a',
        },
      }, {
        actorId: 'a',
        action: { type: 'respond', choiceId: 'ya:1:2:0', decisionId: 'ya:1:2' },
        errorCode: 'INVALID_ACTION',
      }],
    },
    {
      id: 'stale-action-is-rejected',
      initialSnapshot: engine.create(input),
      covers,
      steps: [{
        actorId: 'a',
        action: { type: 'discard', cardId: 'card-2', decisionId: 'ya:1:0' },
        errorCode: 'STALE_CLAIM_WINDOW',
      }],
    },
    winningFixture('wildcard-substitution-completes-win', ['wildcards'], craftYaanState({
      options: { wangNum: 3, qiWangNum: 0 },
      handA: [110, 204, 109, 305, 108, 306, 101],
      handB: [201, 202, 203, 207, 208, 209, 301],
      incomingCode: 1001,
    }), 'a', {
      'snapshot.outcome.winners.0.win.facts.wildcardUses.length': 1,
    }),
    winningFixture('concealed-four-pairs-structure', ['concealed-four-pairs'], craftYaanState({
      options: { anDui: 1, qiWangNum: 0 },
      handA: [205, 305, 405, 109, 209, 309, 409],
      handB: [201, 202, 203, 204, 206, 207, 208],
      incomingCode: 105,
    })),
    winningFixture('gold-hook-concealed-pair', ['gold-hook'], craftYaanState({
      options: { jinGouDiao: 1, qiWangNum: 0 },
      handA: [204],
      handB: [205, 206, 208, 209, 210, 212, 213],
      meldsA: [
        { kind: 'peng', codes: [101, 201, 301] },
        { kind: 'peng', codes: [102, 202, 302] },
        { kind: 'peng', codes: [103, 203, 303] },
      ],
      incomingCode: 110,
    })),
    ...createOptionProbe(engine, {
      variantKey: '6:0',
      baseRules,
      fields: getRoomSpec('6:0').fields,
      freeze: raw => freezeYaanOptions(raw),
    }),
  ],
};

approval.rulebookSha256 = rulebookContentSha256(rulebook);
rulebook.approval.sha256 = approvalSha256(approval);
const finalRulebookText = json(rulebook);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'approval.json'), json(approval));
await writeFile(join(output, 'rulebook.json'), finalRulebookText);
cases.rulebookDigest = sha256(finalRulebookText);
const previousCases = await readFile(join(output, 'cases.json'), 'utf8')
  .then(JSON.parse).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
if (previousCases) cases.cases = mergeEvidenceCases(previousCases, cases.cases).cases;
await writeFile(join(output, 'cases.json'), json(cases));

const manifest = {
  schemaVersion: 1,
  variantKey: '6:0',
  ruleVersion,
  rulebook: { path: 'docs/rules/release/6-0/rulebook.json', sha256: cases.rulebookDigest },
  cases: { path: 'docs/rules/release/6-0/cases.json', sha256: sha256(json(cases)) },
  generatedAt: new Date().toISOString(),
};
await writeFile(join(output, 'manifest.json'), json(manifest));
console.log(JSON.stringify({ variantKey: '6:0', ruleVersion, cases: cases.cases.length, output }));
