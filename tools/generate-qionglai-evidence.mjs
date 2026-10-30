import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeQionglaiOptions, getDefaultOptions, getRoomSpec } from '../packages/rules/src/index.ts';
import { createQionglaiEngine } from '../apps/server/src/game/qionglai-engine.ts';
import { createOptionProbe, mergeEvidenceCases } from './option-evidence.mjs';
import { approvalSha256, rulebookContentSha256 } from './rulebook-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/rules/release/8-0');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const ruleVersion = 'qionglai-independent-v1';
const baseRules = {
  ...getDefaultOptions('8:0'),
  playerNum: 2,
  gameNum: 4,
  wangNum: 3,
  baseBeans: '0.125',
  chaJiao: 0,
  keSuHu: 1,
};
const rules = { ...baseRules, qionglai: freezeQionglaiOptions(baseRules) };
const input = {
  players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
  ownerUserId: 'a',
  number: 1,
  rules,
  policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
};
const engine = createQionglaiEngine('pending-reference-digest', () => 0);
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
  variantKey: '8:0',
  ruleVersion,
  title: '邛崃斗十四独立规则 v1',
  approval: { path: 'docs/rules/release/8-0/approval.json', sha256: '' },
  requiredCoverage: ['gold-hook', 'declared-wait-lock', 'concealed-four-pairs', 'payments'],
  sources: [
    'docs/rules/QIONGLAI-INDEPENDENT.md',
    'docs/rules/QIONGLAI-PACK.md',
    'docs/rules/cases/qionglai-pack-v1.json',
    'docs/rules/cases/qionglai-win-v1.json',
    'docs/rules/cases/qionglai-score-v1.json',
    'apps/server/src/game/qionglai-pack.ts',
    'apps/server/src/game/qionglai-win.ts',
    'apps/server/src/game/qionglai-round.ts',
  ],
  summary: {
    deck: 'Approved QL-D03-1 pack: 52 ordinary cards plus equal 3/6/9/12/15/18 special reward cards.',
    win: 'Four groups: sum-14 pairs, same-rank exposed triples, or quads; concealed four-pairs is independent.',
    scoring: 'Independent fan table with explicit 4/5/6/99 caps and linear or exponential formulas.',
    declaration: 'Declaration locks server-computed waits; response melds are not allowed after declaration.',
    payments: 'Discard pays one share per winner; public flip charges every non-winner; exact 12-place payer rounding.',
  },
};
const approval = {
  kind: 'user-rule-approval',
  ruleVersion,
  variantKey: '8:0',
  recordedAt: '2026-09-16T00:00:00.000Z',
  statement: '用户全部自动批准，允许在21项范围内补齐邛崃独立规则定义。',
  evidenceReference: 'docs/rules/INDEPENDENT-APPROVAL.md',
};
const baseCovers = ['deck', 'deal', 'actions', 'priority', 'winning', 'scoring', 'draw', 'timeout', 'reconnect', 'privacy'];

function zone(state, zoneId) {
  const found = state.cards.zones.find(item => item.id === zoneId);
  assert.ok(found, `Missing card zone ${zoneId}.`);
  return found;
}

function resetPlayers(state) {
  for (const player of state.players) {
    player.melds = [];
    if ('declaredWaits' in player) player.declaredWaits = null;
    if ('declared' in player) player.declared = null;
    if ('declaredBonusIds' in player) player.declaredBonusIds = null;
  }
}

function craftOriginalHand(engine, input, codes) {
  const state = structuredClone(engine.create(input));
  const used = new Set();
  const selected = codes.map(code => {
    const card = state.cards.pack.find(item => item.code === Number(code) && !used.has(item.id));
    assert.ok(card, `Missing physical card ${code}.`);
    used.add(card.id);
    return card.id;
  });
  const opponent = state.cards.pack.filter(card => !used.has(card.id) && card.code < 1000).slice(0, 7);
  assert.equal(opponent.length, 7, 'Not enough ordinary cards for the opponent hand.');
  opponent.forEach(card => used.add(card.id));
  for (const cardZone of state.cards.zones) cardZone.cards = [];
  zone(state, 'hand:a').cards = selected;
  zone(state, 'hand:b').cards = opponent.map(card => card.id);
  zone(state, 'deck').cards = state.cards.pack.filter(card => !used.has(card.id)).map(card => card.id);
  resetPlayers(state);
  state.phase = 'opening';
  state.activeId = 'a';
  state.serial = 0;
  state.source = { kind: 'original-hand', userId: 'a', cardId: null };
  state.claims = null;
  state.outcome = null;
  return state;
}

function craftGoldHook(engine, input) {
  const state = structuredClone(engine.create(input));
  const used = new Set();
  const take = codes => codes.map(code => {
    const card = state.cards.pack.find(item => item.code === Number(code) && !used.has(item.id));
    assert.ok(card, `Missing physical card ${code}.`);
    used.add(card.id);
    return card.id;
  });
  const meldIds = [
    ['101', '201', '301'],
    ['103', '203', '303'],
    ['105', '205', '305'],
  ].map(take);
  const concealedIds = take(['107', '307']);
  const opponent = state.cards.pack.filter(card => !used.has(card.id) && card.code < 1000).slice(0, 7);
  assert.equal(opponent.length, 7, 'Not enough ordinary cards for the opponent hand.');
  opponent.forEach(card => used.add(card.id));
  for (const cardZone of state.cards.zones) cardZone.cards = [];
  zone(state, 'hand:a').cards = concealedIds;
  zone(state, 'melds:a').cards = meldIds.flat();
  zone(state, 'hand:b').cards = opponent.map(card => card.id);
  zone(state, 'deck').cards = state.cards.pack.filter(card => !used.has(card.id)).map(card => card.id);
  resetPlayers(state);
  state.players[0].melds = meldIds.map(cardIds => ({ kind: 'peng', cardIds }));
  state.phase = 'discard';
  state.activeId = 'a';
  state.serial = 0;
  state.source = { kind: 'replacement', userId: 'a', cardId: concealedIds[1] };
  state.claims = null;
  state.outcome = null;
  return state;
}

function concealedFourPairsCase(engine, input, caseId) {
  const initialSnapshot = craftOriginalHand(engine, input, ['110', '310', '109', '309', '108', '308', '202', '302']);
  const action = engine.interactions.legalActions(initialSnapshot, 'a').find(candidate => candidate.type === 'hu');
  assert.ok(action, `${caseId}: the crafted hand exposes no real hu action.`);
  const result = engine.apply(structuredClone(initialSnapshot), 'a', structuredClone(action));
  const win = result.snapshot.outcome?.winners?.[0]?.win;
  assert.equal(result.snapshot.outcome?.reason, 'hu', `${caseId}: four-pairs action did not finish on hu.`);
  assert.equal(win?.structure, 'four-pairs', `${caseId}: the result is not a four-pairs structure.`);
  return {
    id: caseId,
    initialSnapshot,
    covers: ['concealed-four-pairs', 'winning', 'scoring', 'payments'],
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

function goldHookCase(engine, input, caseId) {
  const initialSnapshot = craftGoldHook(engine, input);
  const action = engine.interactions.legalActions(initialSnapshot, 'a').find(candidate => candidate.type === 'hu');
  assert.ok(action, `${caseId}: the crafted hand exposes no real hu action.`);
  const result = engine.apply(structuredClone(initialSnapshot), 'a', structuredClone(action));
  const win = result.snapshot.outcome?.winners?.[0]?.win;
  assert.equal(result.snapshot.outcome?.reason, 'hu', `${caseId}: gold-hook action did not finish on hu.`);
  assert.equal(win?.structure, 'ordinary', `${caseId}: gold-hook must use the ordinary structure.`);
  assert.ok(win?.items?.some(item => item.pattern === 'jinGouDiao' && item.count > 0 && item.fan > 0),
    `${caseId}: the real result does not contain scored jinGouDiao.`);
  return {
    id: caseId,
    initialSnapshot,
    covers: ['gold-hook', 'winning', 'scoring', 'payments'],
    steps: [{
      actorId: 'a',
      action,
      assert: {
        'snapshot.phase': 'finished',
        'snapshot.outcome.reason': 'hu',
        'snapshot.outcome.winners.0.win.items.0.pattern': 'jinGouDiao',
      },
    }],
  };
}

function declaredWaitLockCase(engine, input, caseId) {
  const initialSnapshot = engine.create(input);
  const declaration = engine.interactions.legalActions(initialSnapshot, 'a')
    .find(candidate => candidate.type === 'declare');
  assert.ok(declaration, `${caseId}: the deal exposes no real declaration.`);
  const declared = engine.apply(structuredClone(initialSnapshot), 'a', structuredClone(declaration));
  const waits = declared.snapshot.players[0].declared;
  assert.ok(Array.isArray(waits) && waits.length > 0, `${caseId}: declaration did not lock waits.`);
  const decisionId = engine.view(declared.snapshot, 'a').decisionId;
  assert.equal(decisionId, 'ql:1:2', `${caseId}: declaration did not advance one response window.`);
  return {
    id: caseId,
    initialSnapshot,
    covers: ['declared-wait-lock'],
    steps: [{
      actorId: 'a',
      action: declaration,
      assert: {
        'snapshot.phase': 'response',
        'snapshot.activeId': 'a',
        'events.0.declaredWaits.length': waits.length,
      },
    }, {
      actorId: 'a',
      action: { type: 'declare', cardId: declaration.cardId, decisionId },
      errorCode: 'INVALID_ACTION',
    }],
  };
}

const cases = {
  schemaVersion: 1,
  variantKey: '8:0',
  ruleVersion,
  rulebookDigest: '',
  cases: [
    {
      id: 'deterministic-open-and-private-projection',
      initialSnapshot,
      covers: baseCovers,
      steps: [{
        actorId: 'a',
        action: { type: 'discard', cardId: 'card-2', decisionId: 'ql:1:1' },
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
          decisionId: 'ql:1:4',
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
          responses: { id: 'ql:1:4', options: [], submitted: false },
          outcome: null,
        },
      }],
    },
    declaredWaitLockCase(engine, input, 'declared-wait-lock-rejects-response-meld'),
    {
      id: 'stale-action-is-rejected',
      initialSnapshot: engine.create(input),
      covers: [],
      steps: [{
        actorId: 'a',
        action: { type: 'discard', cardId: 'card-2', decisionId: 'ql:1:0' },
        errorCode: 'STALE_CLAIM_WINDOW',
      }],
    },
    concealedFourPairsCase(engine, input, 'concealed-four-pairs-structure'),
    goldHookCase(engine, input, 'gold-hook-concealed-pair'),
    ...createOptionProbe(engine, {
      variantKey: '8:0',
      baseRules,
      fields: getRoomSpec('8:0').fields,
      freeze: raw => freezeQionglaiOptions(raw),
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
if (previousCases) cases.cases = mergeEvidenceCases(previousCases, cases.cases).cases;
await writeFile(join(output, 'cases.json'), json(cases));
const manifest = {
  schemaVersion: 1,
  variantKey: '8:0',
  ruleVersion,
  rulebook: { path: 'docs/rules/release/8-0/rulebook.json', sha256: cases.rulebookDigest },
  cases: { path: 'docs/rules/release/8-0/cases.json', sha256: sha256(json(cases)) },
  generatedAt: new Date().toISOString(),
};
await writeFile(join(output, 'manifest.json'), json(manifest));
console.log(JSON.stringify({ variantKey: '8:0', ruleVersion, cases: cases.cases.length, output }));
