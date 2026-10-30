import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultOptions, SCORE_REGION_VERSIONS } from '../../packages/rules/src/index.ts';
import { createScoreRegionEngine } from '../../apps/server/src/game/score-region-engine.ts';
import { applyScoreRegionAction, assertScoreRegionRound, scoreRegionLegalActions }
  from '../../apps/server/src/game/score-region-round.ts';

const players = [
  { userId: 'a', seat: 1 },
  { userId: 'b', seat: 2 },
];

const policy = { selectedUserId: null, triggered: false, probability: '0', version: null };

function rules(variantKey, overrides = {}) {
  return {
    ...getDefaultOptions(variantKey),
    playerNum: 2,
    gameNum: 4,
    baseBeans: '0.1',
    ...overrides,
    scoreRegion: { rulesVersion: SCORE_REGION_VERSIONS[variantKey] },
  };
}

function cardCode(snapshot, cardId) {
  return snapshot.cards.pack.find(card => card.id === cardId)?.code;
}

function zone(snapshot, id) {
  return snapshot.cards.zones.find(item => item.id === id);
}

function assertCardConservation(snapshot) {
  const expected = new Set(snapshot.cards.pack.map(card => card.id));
  const seen = new Set();
  for (const current of snapshot.cards.zones) {
    assert.equal(new Set(current.cards).size, current.cards.length, `duplicate card in ${current.id}`);
    for (const cardId of current.cards) {
      assert.ok(expected.has(cardId), `unknown card ${cardId} in ${current.id}`);
      assert.ok(!seen.has(cardId), `card ${cardId} appears in more than one zone`);
      seen.add(cardId);
    }
  }
  assert.deepEqual([...seen].sort(), [...expected].sort());
}

function makeRound({ variantKey, overrides = {}, hands, melds = {}, bonus = {}, deck = [],
  phase = 'discard', activeId = 'a', source = null }) {
  const engine = createScoreRegionEngine(`response-window-${variantKey}`, variantKey, () => 0);
  const input = { players, ownerUserId: 'a', number: 1, rules: rules(variantKey, overrides), policy };
  const base = engine.create(input);
  const used = new Set();
  const pick = code => {
    const card = base.cards.pack.find(item => item.code === code && !used.has(item.id));
    assert.ok(card, `fixture needs another physical card with code ${code}`);
    used.add(card.id);
    return card.id;
  };

  const assignedMelds = {};
  for (const current of players) {
    assignedMelds[current.userId] = (melds[current.userId] ?? []).map(meld => ({
      kind: meld.kind,
      cardIds: meld.codes.map(pick),
    }));
  }
  const assignedHands = Object.fromEntries(players.map(current => [current.userId,
    (hands[current.userId] ?? []).map(pick)]));
  const assignedBonus = Object.fromEntries(players.map(current => [current.userId,
    (bonus[current.userId] ?? []).map(pick)]));
  const assignedDeck = [...deck.map(pick), ...base.cards.pack.filter(card => !used.has(card.id)).map(card => card.id)];

  const zones = [
    { id: 'deck', visibility: 'hidden', cards: assignedDeck },
    { id: 'table', visibility: 'public', cards: [] },
    { id: 'discards', visibility: 'public', cards: [] },
  ];
  for (const current of players) {
    zones.push({ id: `hand:${current.userId}`, visibility: 'private', ownerId: current.userId,
      cards: assignedHands[current.userId] });
    zones.push({ id: `melds:${current.userId}`, visibility: 'public', ownerId: current.userId,
      cards: assignedMelds[current.userId].flatMap(meld => meld.cardIds) });
    zones.push({ id: `bonus:${current.userId}`, visibility: 'public', ownerId: current.userId,
      cards: assignedBonus[current.userId] });
  }

  const snapshot = {
    ...base,
    players: base.players.map(current => ({ ...current, melds: assignedMelds[current.userId] })),
    cards: { ...base.cards, zones },
    phase,
    activeId,
    source,
    claims: null,
    responseResume: null,
  };
  assertScoreRegionRound(snapshot);
  assertCardConservation(snapshot);
  return { engine, snapshot };
}

function findHuResponse(engine, snapshot, userId) {
  const responses = engine.interactions.legalActions(snapshot, userId);
  return responses.find(action => action.type === 'respond' && action.choiceId !== null &&
    snapshot.claims.offers.find(offer => offer.id === action.choiceId)?.action?.type === 'hu');
}

test('discard response window opens on a real engine snapshot', () => {
  const { engine, snapshot } = makeRound({
    variantKey: '25:0',
    hands: {
      a: [107, 101, 102, 103, 104, 105, 106, 111],
      b: [110, 204, 109, 405, 108, 406, 207],
    },
    deck: [112],
  });
  const discard = scoreRegionLegalActions(snapshot, 'a').find(action => action.type === 'discard' &&
    cardCode(snapshot, action.cardId) === 107);
  assert.ok(discard);

  const result = applyScoreRegionAction(snapshot, 'a', discard);
  const opened = result.snapshot;
  assert.equal(opened.phase, 'response');
  assert.equal(opened.source.kind, 'discard');
  assert.equal(cardCode(opened, opened.source.cardId), 107);
  assert.equal(zone(opened, 'table').cards.length, 1);
  assert.equal(engine.interactions.responseWindow(opened, 'b'), opened.claims.id);
  assert.ok(findHuResponse(engine, opened, 'b'));
  assertScoreRegionRound(opened);
  assertCardConservation(opened);
});

test('flip response window opens on a real engine snapshot', () => {
  const { engine, snapshot } = makeRound({
    variantKey: '27:0',
    hands: {
      a: [101, 102, 103, 104, 105, 106, 111],
      b: [110, 204, 109, 405, 108, 406, 207],
    },
    deck: [107],
    phase: 'draw',
  });
  const draw = scoreRegionLegalActions(snapshot, 'a').find(action => action.type === 'draw');
  assert.ok(draw);

  const result = applyScoreRegionAction(snapshot, 'a', draw);
  const opened = result.snapshot;
  assert.equal(opened.phase, 'response');
  assert.equal(opened.source.kind, 'flip');
  assert.equal(cardCode(opened, opened.source.cardId), 107);
  assert.equal(zone(opened, 'table').cards.length, 1);
  assert.equal(engine.interactions.responseWindow(opened, 'b'), opened.claims.id);
  assert.ok(findHuResponse(engine, opened, 'b'));
  assertScoreRegionRound(opened);
  assertCardConservation(opened);
});

test('gang replacement opens a response window and 27 qiang-hu settles through engine.apply', () => {
  const { engine, snapshot } = makeRound({
    variantKey: '27:0',
    overrides: { daShaQiangHu: 1, qiang_7Hu: 1, menQing: 0, haiDiLao: 0, ziQiangHu: 0 },
    hands: {
      a: [102, 202, 302, 402, 101, 103, 104, 111],
      b: [110, 204, 109, 405, 108, 406, 207],
    },
    deck: [112, 107],
  });
  const gang = scoreRegionLegalActions(snapshot, 'a').find(action => action.type === 'gang' &&
    action.cardIds.map(cardId => cardCode(snapshot, cardId)).every(code => code % 100 === 2));
  assert.ok(gang);

  const opened = applyScoreRegionAction(snapshot, 'a', gang).snapshot;
  assert.equal(opened.phase, 'response');
  assert.equal(opened.source.kind, 'replacement');
  assert.equal(opened.source.afterGang, true);
  assert.equal(cardCode(opened, opened.source.cardId), 107);
  assert.equal(zone(opened, 'table').cards.length, 0);
  assert.equal(zone(opened, 'hand:a').cards.length, 6);
  assert.equal(engine.interactions.responseWindow(opened, 'b'), opened.claims.id);
  const hu = findHuResponse(engine, opened, 'b');
  assert.ok(hu);

  const result = engine.apply(opened, 'b', hu);
  const settled = result.snapshot;
  assert.equal(settled.phase, 'finished');
  assert.equal(settled.outcome.winners[0].userId, 'b');
  const items = settled.outcome.winners[0].win.items.map(item => item.pattern);
  assert.ok(items.includes('qiangHu'));
  assert.equal(items.includes('qiang7'), false);
  assert.deepEqual(result.settlement, [
    { userId: 'a', amount: '-24' },
    { userId: 'b', amount: '24' },
  ]);
  assertScoreRegionRound(settled);
  assertCardConservation(settled);
});

test('ba replacement opens a response window and 25 qiang-7 settles through engine.apply', () => {
  const { engine, snapshot } = makeRound({
    variantKey: '25:0',
    overrides: { daShaQiangHu: 0, qiang_7Hu: 1 },
    hands: {
      a: [402, 101, 103, 104, 111, 112],
      b: [110, 204, 109, 405, 108, 406, 207],
    },
    melds: { a: [{ kind: 'peng', codes: [102, 202, 302] }] },
    deck: [107],
  });
  const ba = scoreRegionLegalActions(snapshot, 'a').find(action => action.type === 'ba' &&
    cardCode(snapshot, action.cardId) === 402);
  assert.ok(ba);

  const opened = applyScoreRegionAction(snapshot, 'a', ba).snapshot;
  assert.equal(opened.phase, 'response');
  assert.equal(opened.source.kind, 'replacement');
  assert.equal(cardCode(opened, opened.source.cardId), 107);
  assert.equal(opened.players[0].melds[0].kind, 'ba');
  assert.equal(opened.players[0].melds[0].cardIds.length, 4);
  assert.equal(engine.interactions.responseWindow(opened, 'b'), opened.claims.id);
  const hu = findHuResponse(engine, opened, 'b');
  assert.ok(hu);

  const result = engine.apply(opened, 'b', hu);
  const settled = result.snapshot;
  assert.equal(settled.phase, 'finished');
  assert.equal(settled.outcome.winners[0].userId, 'b');
  const items = settled.outcome.winners[0].win.items.map(item => item.pattern);
  assert.ok(items.includes('qiang7'));
  assert.equal(items.includes('qiangHu'), false);
  assert.deepEqual(result.settlement, [
    { userId: 'a', amount: '-24' },
    { userId: 'b', amount: '24' },
  ]);
  assertScoreRegionRound(settled);
  assertCardConservation(settled);
});

test('automatic bonus replenishment opens a replacement response window', () => {
  const { engine, snapshot } = makeRound({
    variantKey: '24:0',
    hands: {
      a: [101, 102, 103, 104, 105, 106, 111],
      b: [110, 204, 109, 405, 108, 406, 207],
    },
    deck: [1003, 107],
    phase: 'draw',
  });
  const draw = scoreRegionLegalActions(snapshot, 'a').find(action => action.type === 'draw');
  assert.ok(draw);

  const opened = applyScoreRegionAction(snapshot, 'a', draw).snapshot;
  assert.equal(opened.phase, 'response');
  assert.equal(opened.source.kind, 'replacement');
  assert.equal(cardCode(opened, opened.source.cardId), 107);
  assert.equal(zone(opened, 'table').cards.length, 0);
  assert.equal(zone(opened, 'hand:a').cards.length, 8);
  assert.equal(zone(opened, 'bonus:a').cards.length, 1);
  assert.equal(cardCode(opened, zone(opened, 'bonus:a').cards[0]), 1003);
  assert.equal(engine.interactions.responseWindow(opened, 'b'), opened.claims.id);
  assert.ok(findHuResponse(engine, opened, 'b'));
  assertScoreRegionRound(opened);
  assertCardConservation(opened);
});

test('a discard with no response resumes at the next draw phase', () => {
  const { snapshot } = makeRound({
    variantKey: '25:0',
    hands: {
      a: [112, 101, 102, 103, 104, 105, 106, 111],
      b: [110, 201, 203, 205, 209, 211, 213],
    },
    deck: [],
  });
  const discard = scoreRegionLegalActions(snapshot, 'a').find(action => action.type === 'discard' &&
    cardCode(snapshot, action.cardId) === 112);
  assert.ok(discard);

  const resumed = applyScoreRegionAction(snapshot, 'a', discard).snapshot;
  assert.equal(resumed.phase, 'draw');
  assert.equal(resumed.activeId, 'b');
  assert.equal(zone(resumed, 'table').cards.length, 0);
  assert.equal(cardCode(resumed, zone(resumed, 'discards').cards[0]), 112);
  assert.equal(scoreRegionLegalActions(resumed, 'b').some(action => action.type === 'draw'), true);
  assertScoreRegionRound(resumed);
  assertCardConservation(resumed);
});

test('a flip with no response resumes at the next draw phase', () => {
  const { snapshot } = makeRound({
    variantKey: '27:0',
    hands: {
      a: [101, 102, 103, 104, 105, 106, 111],
      b: [110, 201, 203, 205, 209, 211, 213],
    },
    deck: [112],
    phase: 'draw',
  });
  const draw = scoreRegionLegalActions(snapshot, 'a').find(action => action.type === 'draw');
  assert.ok(draw);

  const resumed = applyScoreRegionAction(snapshot, 'a', draw).snapshot;
  assert.equal(resumed.phase, 'draw');
  assert.equal(resumed.activeId, 'b');
  assert.equal(zone(resumed, 'table').cards.length, 0);
  assert.equal(cardCode(resumed, zone(resumed, 'discards').cards[0]), 112);
  assert.equal(scoreRegionLegalActions(resumed, 'b').some(action => action.type === 'draw'), true);
  assertScoreRegionRound(resumed);
  assertCardConservation(resumed);
});

test('a replacement with no response resumes at the owner discard phase', () => {
  const { snapshot } = makeRound({
    variantKey: '25:0',
    hands: {
      a: [102, 202, 302, 402, 101, 103, 104, 111],
      b: [110, 201, 203, 205, 209, 211, 213],
    },
    deck: [112, 107],
  });
  const gang = scoreRegionLegalActions(snapshot, 'a').find(action => action.type === 'gang' &&
    action.cardIds.map(cardId => cardCode(snapshot, cardId)).every(code => code % 100 === 2));
  assert.ok(gang);

  const resumed = applyScoreRegionAction(snapshot, 'a', gang).snapshot;
  assert.equal(resumed.phase, 'discard');
  assert.equal(resumed.activeId, 'a');
  assert.equal(resumed.source.kind, 'replacement');
  assert.equal(resumed.source.afterGang, true);
  assert.equal(cardCode(resumed, resumed.source.cardId), 107);
  assert.equal(zone(resumed, 'table').cards.length, 0);
  assert.equal(zone(resumed, 'hand:a').cards.length, 6);
  assert.equal(scoreRegionLegalActions(resumed, 'a').some(action => action.type === 'discard'), true);
  assertScoreRegionRound(resumed);
  assertCardConservation(resumed);
});

test('an expired response decisionId is rejected', () => {
  const { engine, snapshot } = makeRound({
    variantKey: '25:0',
    overrides: { daShaQiangHu: 1 },
    hands: {
      a: [102, 202, 302, 402, 101, 103, 104, 111],
      b: [110, 204, 109, 405, 108, 406, 207],
    },
    deck: [112, 107],
  });
  const gang = scoreRegionLegalActions(snapshot, 'a').find(action => action.type === 'gang' &&
    action.cardIds.map(cardId => cardCode(snapshot, cardId)).every(code => code % 100 === 2));
  assert.ok(gang);
  const opened = applyScoreRegionAction(snapshot, 'a', gang).snapshot;
  const staleHu = findHuResponse(engine, opened, 'b');
  assert.ok(staleHu);
  const pass = engine.interactions.legalActions(opened, 'b').find(action => action.type === 'respond' &&
    action.choiceId === null);
  assert.ok(pass);

  const afterPass = applyScoreRegionAction(opened, 'b', pass).snapshot;
  assert.notEqual(afterPass.phase, 'response');
  assert.notEqual(staleHu.decisionId, afterPass.decisionId);
  assert.throws(() => applyScoreRegionAction(afterPass, 'b', staleHu),
    error => error?.code === 'STALE_CLAIM_WINDOW');
  assertCardConservation(afterPass);
});
