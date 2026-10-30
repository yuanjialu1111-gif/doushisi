#!/usr/bin/env node
/**
 * Rebuilds the 24:0 reference suite's executable rob-ba cases from the same
 * deterministic fixtures used by apps/server/test/score-region-own-ba.test.ts.
 *
 * The audit replays every step through the frozen engine, so each action has to
 * be the concrete action offered at that exact intermediate snapshot. This
 * script drives the engine while building the case and records what it sees.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScoreRegionEngine } from '../apps/server/src/game/score-region-engine.ts';
import { createScoreRegionCardState } from '../apps/server/src/game/score-region-pack.ts';
import {
  assertScoreRegionRound, createScoreRegionRound, scoreRegionLegalActions,
} from '../apps/server/src/game/score-region-round.ts';
import { getDefaultOptions, SCORE_REGION_VERSIONS } from '../packages/rules/src/index.ts';
import { sha256 } from './red-region-evidence-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/rules/release/24-0');
const casesPath = join(output, 'cases.json');
const manifestPath = join(output, 'manifest.json');
const json = value => JSON.stringify(value, null, 2) + '\n';

const generatedIds = new Set([
  'own-ba-keqiang-peng-opens-window',
  'own-ba-keqiang-peng-robbed-settles',
  'own-ba-keqiang-peng-clean-resumes-discard',
  'own-ba-keqiang-tou-clean-resumes-draw',
  'own-ba-keqiang-disabled-upgrades-immediately',
  'own-ba-keqiang-stale-response-rejected',
]);

const PLAYERS = [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }];

function rules(ownBaKeQiang) {
  return {
    ...getDefaultOptions('24:0'), playerNum: 2, gameNum: 4, baseBeans: '0.1', wangNum: 0,
    ownBaKeQiang, tianHu: 0, quanHongHei: 0,
    scoreRegion: { rulesVersion: SCORE_REGION_VERSIONS['24:0'] },
  };
}

function input(ownBaKeQiang) {
  return {
    players: structuredClone(PLAYERS), ownerUserId: 'a', number: 1,
    rules: rules(ownBaKeQiang),
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
}

function fixture(kind, ownBaKeQiang, phase, canRob) {
  const roundRules = rules(ownBaKeQiang);
  const pack = createScoreRegionCardState('24:0', roundRules, 'deck', [
    { id: 'deck', visibility: 'hidden' },
  ]).pack;
  const state = createScoreRegionRound(input(ownBaKeQiang), pack.map(card => card.id), '24:0');
  const assigned = new Set();
  const pick = code => {
    const card = pack.find(item => item.code === code && !assigned.has(item.id));
    assert.ok(card, `The fixture needs another ${code}`);
    assigned.add(card.id);
    return card.id;
  };
  const meldCards = kind === 'peng' ? [104, 304, 404].map(pick) : [205, 305, 405].map(pick);
  const ownBaCard = pick(kind === 'peng' ? 204 : 105);
  const handCodes = kind === 'peng'
    ? phase === 'discard' ? [201, 202, 203, 205, 206] : [201, 202, 203, 205]
    : phase === 'discard' ? [304, 302, 303, 306, 308] : [304, 302, 303, 306];
  const aHand = handCodes.map(pick);
  const bHand = (canRob
    ? kind === 'peng' ? [110, 103, 111, 102, 112, 109, 105]
      : [110, 104, 111, 103, 106, 108, 109]
    : kind === 'peng' ? [110, 103, 111, 102, 112, 109, 113]
      : [110, 104, 111, 103, 106, 108, 112]).map(pick);
  const replacement = pick(107);
  const rest = pack.filter(card => !assigned.has(card.id)).map(card => card.id);
  state.players[0].melds = [{ kind, cardIds: [...meldCards] }];
  state.activeId = 'a';
  state.phase = phase;
  state.source = null;
  state.claims = null;
  state.responseResume = null;
  state.cards.zones = [
    { id: 'deck', visibility: 'hidden', cards: [replacement, ...rest] },
    { id: 'table', visibility: 'public', cards: [] },
    { id: 'discards', visibility: 'public', cards: [] },
    { id: 'hand:a', visibility: 'private', ownerId: 'a', cards: [...aHand, ownBaCard] },
    { id: 'melds:a', visibility: 'public', ownerId: 'a', cards: [...meldCards] },
    { id: 'bonus:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'hand:b', visibility: 'private', ownerId: 'b', cards: bHand },
    { id: 'melds:b', visibility: 'public', ownerId: 'b', cards: [] },
    { id: 'bonus:b', visibility: 'public', ownerId: 'b', cards: [] },
  ];
  assertScoreRegionRound(state);
  return { state, ownBaCard, replacement, deckLength: rest.length + 1 };
}

function withDeal(state) {
  return {
    ...state,
    deal: {
      version: 'score-region-deal-v1',
      policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
      candidates: 1,
      evaluation: [0, 0],
    },
    startEvents: [],
  };
}

function baAction(state, cardId, meldIndex = 0) {
  const action = scoreRegionLegalActions(state, 'a').find(candidate => candidate.type === 'ba' &&
    candidate.cardId === cardId && candidate.meldIndex === meldIndex);
  assert.ok(action, 'The concealed ba must be offered by the public action list');
  return action;
}

function responseAction(state, type) {
  const action = scoreRegionLegalActions(state, 'b').find(candidate => {
    if (candidate.type !== 'respond') return false;
    if (type === null) return candidate.choiceId === null;
    const offer = state.claims.offers.find(item => item.id === candidate.choiceId && item.userId === 'b');
    return offer !== undefined && offer.action.type === type;
  });
  assert.ok(action, `Player b must be offered ${type ?? 'pass'}`);
  return action;
}

function cardsIn(state, zoneId) {
  return state.cards.zones.find(zone => zone.id === zoneId).cards;
}

/**
 * Runs the real engine over a recorded action sequence and returns a release
 * case. Each step action is resolved against the snapshot the audit will see.
 */
function executableCase(id, initialSnapshot, covers, stepFactories, assertions) {
  const engine = createScoreRegionEngine('pending-own-ba-digest', '24:0');
  let snapshot = structuredClone(initialSnapshot);
  const steps = [];
  const recorded = [];
  stepFactories.forEach((factory, index) => {
    const action = factory(snapshot, index);
    const actorId = typeof action === 'object' && action !== null && 'actorId' in action
      ? action.actorId : (index === 0 ? 'a' : 'b');
    const resolved = typeof action === 'object' && action !== null && 'actorId' in action
      ? action.action : action;
    const result = engine.apply(structuredClone(snapshot), actorId, resolved);
    recorded.push({ actorId, action: resolved, result });
    steps.push({ actorId, action: resolved,
      assert: index === stepFactories.length - 1 ? {} : { 'snapshot.variantKey': '24:0' } });
    snapshot = structuredClone(result.snapshot);
  });
  const finalAssertions = typeof assertions === 'function'
    ? assertions(snapshot, recorded.at(-1).result) : assertions;
  steps[steps.length - 1].assert = finalAssertions;
  return { id, initialSnapshot, covers, steps };
}

function buildCases() {
  const cases = [];
  {
    const { state, ownBaCard } = fixture('peng', 1, 'discard', true);
    cases.push(executableCase('own-ba-keqiang-peng-opens-window', withDeal(state),
      ['option:ownBaKeQiang=1', 'actions', 'priority', 'winning'],
      [snapshot => baAction(snapshot, ownBaCard)], {
        'snapshot.phase': 'response',
        'snapshot.source.ownBa': true,
        'snapshot.responseResume.kind': 'own-ba',
        'snapshot.claims.offers.0.userId': 'b',
        'snapshot.claims.offers.0.action.type': 'hu',
        'snapshot.claims.offers.0.priority': 100,
      }));
  }
  {
    const { state, ownBaCard, deckLength } = fixture('peng', 1, 'discard', true);
    cases.push(executableCase('own-ba-keqiang-peng-robbed-settles', withDeal(state),
      ['option:ownBaKeQiang=1', 'winning', 'scoring', 'payments'], [
        snapshot => baAction(snapshot, ownBaCard),
        snapshot => responseAction(snapshot, 'hu'),
      ], {
        'snapshot.phase': 'finished',
        'snapshot.outcome.winners.0.userId': 'b',
        'snapshot.cards.zones.1.cards.length': 0,
        'snapshot.cards.zones.2.cards.length': 1,
        'snapshot.cards.zones.3.cards.length': 5,
        'snapshot.cards.zones.6.cards.length': 7,
        'settlement.0.userId': 'a', 'settlement.0.amount': '-0.1',
        'settlement.1.userId': 'b', 'settlement.1.amount': '0.1',
      }));
    assert.equal(deckLength > 0, true);
  }
  {
    const { state, ownBaCard, replacement } = fixture('peng', 1, 'discard', true);
    cases.push(executableCase('own-ba-keqiang-peng-clean-resumes-discard', withDeal(state),
      ['option:ownBaKeQiang=1', 'actions', 'draw', 'reconnect'], [
        snapshot => baAction(snapshot, ownBaCard),
        snapshot => responseAction(snapshot, null),
      ], snapshot => ({
        'snapshot.phase': 'discard',
        'snapshot.players.0.melds.0.kind': 'ba',
        'snapshot.players.0.melds.0.cardIds.length': 4,
        'snapshot.cards.zones.0.cards.length': cardsIn(snapshot, 'deck').length,
      })));
    assert.ok(replacement);
  }
  {
    const { state, ownBaCard } = fixture('tou', 1, 'draw', true);
    cases.push(executableCase('own-ba-keqiang-tou-clean-resumes-draw', withDeal(state),
      ['option:ownBaKeQiang=1', 'actions', 'draw', 'reconnect'], [
        snapshot => baAction(snapshot, ownBaCard),
        snapshot => responseAction(snapshot, null),
  ], snapshot => ({
        'snapshot.phase': snapshot.phase,
        'snapshot.players.0.melds.0.kind': 'ba',
        'snapshot.players.0.melds.0.cardIds.length': 4,
      })));
  }
  {
    const { state, ownBaCard } = fixture('peng', 0, 'discard', true);
    cases.push(executableCase('own-ba-keqiang-disabled-upgrades-immediately', withDeal(state),
      ['option:ownBaKeQiang=0', 'actions', 'winning'],
      [snapshot => baAction(snapshot, ownBaCard)], {
        'snapshot.players.0.melds.0.kind': 'ba',
        'snapshot.players.0.melds.0.cardIds.length': 4,
      }));
  }
  {
    const { state, ownBaCard } = fixture('peng', 1, 'discard', true);
    const opened = withDeal(state);
    const engine = createScoreRegionEngine('pending-own-ba-digest', '24:0');
    const firstAction = baAction(opened, ownBaCard);
    const firstResult = engine.apply(structuredClone(opened), 'a', firstAction);
    const secondAction = responseAction(firstResult.snapshot, 'hu');
    const secondResult = engine.apply(structuredClone(firstResult.snapshot), 'b', secondAction);
    cases.push({
      id: 'own-ba-keqiang-stale-response-rejected',
      initialSnapshot: structuredClone(secondResult.snapshot),
      covers: ['option:ownBaKeQiang=1', 'timeout'],
      steps: [{ actorId: 'b', action: secondAction, errorCode: 'STALE_CLAIM_WINDOW' }],
    });
  }
  return cases;
}

async function main() {
  const [casesText, manifestText] = await Promise.all([
    readFile(casesPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  const suite = JSON.parse(casesText);
  const manifest = JSON.parse(manifestText);
  assert.equal(suite.variantKey, '24:0');
  const generated = buildCases();
  suite.cases = [...suite.cases.filter(reference => !generatedIds.has(reference.id)), ...generated];
  const nextCasesText = json(suite);
  await writeFile(casesPath, nextCasesText);
  manifest.cases.sha256 = sha256(nextCasesText);
  manifest.generatedAt = new Date().toISOString();
  await writeFile(manifestPath, json(manifest));
  console.log(JSON.stringify({ cases: suite.cases.length, digest: manifest.cases.sha256 }, null, 2));
}

await main();
