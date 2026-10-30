import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultOptions, SCORE_REGION_VERSIONS } from '../../packages/rules/src/index.ts';
import { createScoreRegionEngine } from '../../apps/server/src/game/score-region-engine.ts';
import { assertScoreRegionRound } from '../../apps/server/src/game/score-region-round.ts';

const variantKey = '23:0';
const players = [
  { userId: 'a', seat: 1 },
  { userId: 'b', seat: 2 },
];
const policy = { selectedUserId: null, triggered: false, probability: '0', version: null };

function rules(overrides = {}) {
  return {
    ...getDefaultOptions(variantKey),
    playerNum: 2,
    gameNum: 4,
    baseBeans: '0.1',
    ...overrides,
    scoreRegion: { rulesVersion: SCORE_REGION_VERSIONS[variantKey] },
  };
}

function createEngine(overrides = {}) {
  return createScoreRegionEngine('red-region-23-options', variantKey, () => 0);
}

function createSnapshot(engine, overrides = {}) {
  return engine.create({
    players,
    ownerUserId: 'a',
    number: 1,
    rules: rules(overrides),
    policy,
  });
}

function cardCode(snapshot, cardId) {
  return snapshot.cards.pack.find(card => card.id === cardId)?.code;
}

function zone(snapshot, id) {
  return snapshot.cards.zones.find(item => item.id === id);
}

function codeForId(snapshot, cardId) {
  const code = cardCode(snapshot, cardId);
  assert.notEqual(code, undefined, `unknown physical card ${cardId}`);
  return code;
}

function restage(base, spec = {}) {
  const state = structuredClone(base);
  const used = new Set();
  const assigned = new Map();
  const existingHands = Object.fromEntries(state.players.map(current => [current.userId,
    [...zone(state, `hand:${current.userId}`).cards]]));
  const existingBonus = Object.fromEntries(state.players.map(current => [current.userId,
    [...zone(state, `bonus:${current.userId}`).cards]]));
  const reserve = cardId => {
    assert.ok(state.cards.pack.some(card => card.id === cardId), `unknown physical card ${cardId}`);
    assert.ok(!used.has(cardId), `physical card ${cardId} was assigned twice`);
    used.add(cardId);
    assigned.set(cardId, state.cards.pack.find(card => card.id === cardId));
  };
  const pick = code => {
    const card = state.cards.pack.find(item => item.code === code && !used.has(item.id));
    assert.ok(card, `fixture needs an unused physical card with code ${code}`);
    reserve(card.id);
    return card.id;
  };
  const rememberExisting = meld => {
    for (const cardId of meld.cardIds) reserve(cardId);
  };
  const assignedMelds = Object.fromEntries(state.players.map(current => [current.userId,
    spec.melds?.[current.userId] === undefined
      ? current.melds.map(meld => {
          rememberExisting(meld);
          return { kind: meld.kind, cardIds: [...meld.cardIds] };
        })
      : spec.melds[current.userId].map(meld => ({
          kind: meld.kind,
          cardIds: meld.codes.map(pick),
        })),
  ]));
  const assignedHands = Object.fromEntries(state.players.map(current => [current.userId,
    (spec.hands === undefined
      ? existingHands[current.userId]
      : spec.hands[current.userId] ?? existingHands[current.userId]).map(cardId => {
      if (typeof cardId === 'string') {
        reserve(cardId);
        return cardId;
      }
      return pick(cardId);
    }),
  ]));
  const assignedBonus = Object.fromEntries(state.players.map(current => [current.userId,
    spec.bonus === undefined
      ? existingBonus[current.userId].map(cardId => {
          reserve(cardId);
          return cardId;
        })
      : (spec.bonus?.[current.userId] ?? existingBonus[current.userId]).map(cardId => {
          if (typeof cardId === 'string') {
            reserve(cardId);
            return cardId;
          }
          return pick(cardId);
        }),
  ]));
  const handCodes = Object.fromEntries(state.players.map(current => [current.userId,
    spec.hands?.[current.userId] ?? existingHands[current.userId]]));
  const bonusCodes = Object.fromEntries(state.players.map(current => [current.userId,
    spec.bonus?.[current.userId] ?? existingBonus[current.userId]]));
  const assignedDeck = [
    ...(spec.deck ?? []).filter(code => !Object.values(handCodes).some(codes => codes.includes(code)) &&
      !Object.values(bonusCodes).some(codes => codes.includes(code))).map(pick),
    ...state.cards.pack.filter(card => !used.has(card.id)).map(card => card.id),
  ];

  const zoneOverride = zoneId => spec.zones?.[zoneId];
  const meldCodes = ownerId => zoneOverride(`melds:${ownerId}`);

  state.cards.zones = state.cards.zones.map(current => {
    if (current.id === 'deck') return { ...current, cards: assignedDeck };
    if (current.id === 'table' || current.id === 'discards') return { ...current, cards: [] };
    const handOwner = current.id.startsWith('hand:') ? current.id.slice(5) : null;
    if (handOwner) return { ...current, cards: zoneOverride(current.id)?.map(pick) ?? assignedHands[handOwner] ?? [] };
    const meldOwner = current.id.startsWith('melds:') ? current.id.slice(6) : null;
    if (meldOwner) return { ...current, cards: meldCodes(meldOwner)?.map(pick) ??
      (assignedMelds[meldOwner] ?? []).flatMap(meld => meld.cardIds) };
    const bonusOwner = current.id.startsWith('bonus:') ? current.id.slice(6) : null;
    if (bonusOwner) return { ...current, cards: zoneOverride(current.id)?.map(pick) ?? assignedBonus[bonusOwner] ?? [] };
    return current;
  });

  const playerOverride = ownerId => spec.players?.[ownerId];
  state.players = state.players.map(current => ({
    ...current,
    ...(playerOverride(current.userId) ?? {}),
    melds: playerOverride(current.userId)?.melds ?? assignedMelds[current.userId],
  }));
  if (spec.player !== undefined) {
    state.players = state.players.map(current => current.userId === 'b' ? { ...current, ...spec.player } : current);
  }
  if (spec.hand !== undefined) {
    const cards = spec.hand.map(pick);
    state.cards.zones = state.cards.zones.map(current => current.id === 'hand:a' ? { ...current, cards } : current);
  }
  if (spec.meld !== undefined) {
    const cards = spec.meld.map(pick);
    state.cards.zones = state.cards.zones.map(current => current.id === 'melds:a' ? { ...current, cards } : current);
  }
  if (spec.bonusZone !== undefined) {
    const cards = spec.bonusZone.map(pick);
    state.cards.zones = state.cards.zones.map(current => current.id === 'bonus:a' ? { ...current, cards } : current);
  }
  state.phase = spec.phase ?? state.phase;
  state.activeId = spec.activeId ?? state.activeId;
  state.claims = null;
  state.responseResume = null;
  state.outcome = null;
  if (spec.source === undefined) state.source = null;
  else if (spec.source === null) state.source = null;
  else if (spec.source.cardCode !== undefined) {
    const cardId = [...assigned.values()].find(card => card.code === spec.source.cardCode)?.id;
    assert.ok(cardId, `source card code ${spec.source.cardCode} must be in the staged state`);
    state.source = { ...spec.source, cardId };
  } else state.source = structuredClone(spec.source);
  assertScoreRegionRound(state);
  return state;
}

function actionFor(engine, snapshot, userId, predicate, message) {
  const action = engine.interactions.legalActions(snapshot, userId).find(predicate);
  assert.ok(action, message);
  return action;
}

function discardFor(engine, snapshot, code) {
  return actionFor(engine, snapshot, 'a', action => action.type === 'discard' &&
    cardCode(snapshot, action.cardId) === code, `expected a discard of ${code}`);
}

function responseActionFor(engine, snapshot, userId, type, message) {
  return actionFor(engine, snapshot, userId, action => action.type === 'respond' &&
    action.choiceId !== null && snapshot.claims.offers.find(offer => offer.id === action.choiceId)?.action?.type === type,
  message);
}

function hasPass(engine, snapshot, userId) {
  return engine.interactions.legalActions(snapshot, userId).some(action =>
    action.type === 'respond' && action.choiceId === null);
}

test('piaoType=2 records both piao choices and settles both one-piao fans', () => {
  const engine = createEngine({ piaoType: 2 });
  const initial = createSnapshot(engine, { piaoType: 2 });
  assert.equal(initial.phase, 'piao');

  const aPiao = actionFor(engine, initial, 'a', action => action.type === 'piao' && action.value === 1,
    'a should be able to choose one piao');
  const afterA = engine.apply(initial, 'a', aPiao).snapshot;
  assert.equal(afterA.phase, 'piao');

  const bPiao = actionFor(engine, afterA, 'b', action => action.type === 'piao' && action.value === 1,
    'b should be able to choose one piao');
  const afterB = engine.apply(afterA, 'b', bPiao).snapshot;
  assert.deepEqual(afterB.players.map(current => current.piao), [1, 1]);

  const winningHand = [110, 104, 109, 205, 108, 206, 107, 207];
  const staged = restage(afterB, {
    hands: { a: winningHand, b: [101, 102, 103, 111, 112, 113, 201] },
    deck: [202, 203, 204],
    phase: 'discard',
    activeId: 'a',
    source: { kind: 'replacement', userId: 'a', cardCode: 110, afterGang: true },
  });
  const hu = actionFor(engine, staged, 'a', action => action.type === 'hu',
    'a should have a real self-draw hu after both piao choices');
  const result = engine.apply(staged, 'a', hu);

  assert.equal(result.snapshot.phase, 'finished');
  assert.deepEqual(result.settlement, [
    { userId: 'a', amount: '0.4' },
    { userId: 'b', amount: '-0.4' },
  ]);
  const payerWin = result.snapshot.outcome.winners[0].payerWins.find(item => item.payerId === 'b');
  const piaoItem = payerWin.win.items.find(item => item.pattern === 'piao');
  assert.deepEqual(piaoItem, { pattern: 'piao', count: 2, fan: 2 });
});

test('baNoGuo does not force ba over a legal hu or a hand that can form fourteen', () => {
  const engine = createEngine({ baNoGuo: 1 });

  const huBase = createSnapshot(engine, { baNoGuo: 1 });
  const huStage = restage(huBase, {
    hands: {
      a: [110, 101, 102, 103, 111, 112, 113, 201],
      b: [104, 109, 205, 108, 206, 107, 207],
    },
    deck: [202, 203, 204],
  });
  const huOpened = engine.apply(huStage, 'a', discardFor(engine, huStage, 110)).snapshot;
  assert.equal(huOpened.phase, 'response');
  assert.ok(responseActionFor(engine, huOpened, 'b', 'hu', 'b should be offered a legal hu'));
  assert.equal(hasPass(engine, huOpened, 'b'), true, 'legal hu must not remove the pass choice');

  const fourteenBase = createSnapshot(engine, { baNoGuo: 1 });
  const fourteenStage = restage(fourteenBase, {
    hands: {
      a: [405, 101, 102, 103, 111, 112, 113, 201],
      b: [109, 204, 208, 212, 213],
    },
    melds: { b: [{ kind: 'peng', codes: [105, 205, 305] }] },
    deck: [202, 203, 204],
  });
  const fourteenOpened = engine.apply(fourteenStage, 'a', discardFor(engine, fourteenStage, 405)).snapshot;
  assert.equal(fourteenOpened.phase, 'response');
  assert.equal(hasPass(engine, fourteenOpened, 'b'), true,
    'a matching peng plus an incoming card that forms fourteen must leave pass available');
  assert.equal(engine.interactions.legalActions(fourteenOpened, 'b').every(action =>
    action.type === 'respond' && action.choiceId === null), false,
  'the matching peng should remain a legal, but optional, ba');
});

test('baNoGuo does not force ba for wildcard or automatic bonus incoming cards', () => {
  const wildcardEngine = createEngine({ baNoGuo: 1, wangNum: 3 });
  const wildcardBase = createSnapshot(wildcardEngine, { baNoGuo: 1, wangNum: 3 });
  const wildcardStage = restage(wildcardBase, {
    hands: {
      a: [1001, 101, 102, 103, 111, 112, 113, 201],
      b: [104, 108, 109, 204, 208],
    },
    melds: { b: [{ kind: 'peng', codes: [105, 205, 305] }] },
    deck: [202, 203, 204],
  });
  const wildcardResult = wildcardEngine.apply(wildcardStage, 'a', discardFor(wildcardEngine, wildcardStage, 1001));
  assert.equal(wildcardResult.events.some(event => event.type === 'meld' && event.kind === 'ba'), false,
    'a wildcard incoming card must not create a forced ba event');
  assert.equal(wildcardResult.snapshot.players.find(player => player.userId === 'b').melds[0].kind, 'peng');

  const bonusEngine = createEngine({ baNoGuo: 1, wangNum: 0 });
  const bonusBase = createSnapshot(bonusEngine, { baNoGuo: 1, wangNum: 0 });
  const bonusStage = restage(bonusBase, {
    hands: {
      a: [101, 102, 103, 111, 112, 113, 201],
      b: [104, 108, 109, 204, 208],
    },
    melds: { b: [{ kind: 'peng', codes: [105, 205, 305] }] },
    deck: [1001, 210, 211, 212],
    phase: 'draw',
    activeId: 'a',
  });
  const draw = actionFor(bonusEngine, bonusStage, 'a', action => action.type === 'draw',
    'a should be able to draw the automatic bonus card');
  const bonusResult = bonusEngine.apply(bonusStage, 'a', draw);
  assert.equal(bonusResult.events.some(event => event.type === 'meld' && event.kind === 'ba'), false,
    'an automatic bonus incoming card must not create a forced ba event');
  assert.equal(bonusResult.snapshot.players.find(player => player.userId === 'b').melds[0].kind, 'peng');
});

test('baNoGuo forces a matching peng and removes pass, while option off keeps pass', () => {
  const engine = createEngine({ baNoGuo: 1 });
  const base = createSnapshot(engine, { baNoGuo: 1 });
  const stage = restage(base, {
    hands: {
      a: [405, 101, 102, 103, 111, 112, 113, 201],
      b: [204, 208, 212, 213, 202],
    },
    melds: { b: [{ kind: 'peng', codes: [105, 205, 305] }] },
    deck: [202, 203, 204],
  });
  const opened = engine.apply(stage, 'a', discardFor(engine, stage, 405)).snapshot;
  assert.equal(opened.phase, 'response');
  const forcedBa = responseActionFor(engine, opened, 'b', 'ba', 'the matching peng must force ba');
  assert.equal(hasPass(engine, opened, 'b'), false, 'forced ba must not offer pass');

  const afterBa = engine.apply(opened, 'b', forcedBa).snapshot;
  assert.equal(afterBa.players.find(player => player.userId === 'b').melds[0].kind, 'ba');
  assert.equal(afterBa.players.find(player => player.userId === 'b').melds[0].cardIds.length, 4);

  const offEngine = createEngine({ baNoGuo: 0 });
  const offBase = createSnapshot(offEngine, { baNoGuo: 0 });
  const offStage = restage(offBase, {
    hands: {
      a: [405, 101, 102, 103, 111, 112, 113, 201],
      b: [204, 208, 212, 213, 202],
    },
    melds: { b: [{ kind: 'peng', codes: [105, 205, 305] }] },
    deck: [202, 203, 204],
  });
  const offOpened = offEngine.apply(offStage, 'a', discardFor(offEngine, offStage, 405)).snapshot;
  assert.equal(offOpened.phase, 'response');
  assert.ok(responseActionFor(offEngine, offOpened, 'b', 'ba', 'option off should still offer ba'));
  assert.equal(hasPass(offEngine, offOpened, 'b'), true, 'option off must preserve pass');
});

test('guoZhangNoCaozuo locks one face until the hand revision changes', () => {
  const engine = createEngine({ guoZhangNoCaozuo: 1 });
  const firstBase = createSnapshot(engine, { guoZhangNoCaozuo: 1 });
  const firstStage = restage(firstBase, {
    hands: {
      a: [405, 101, 102, 103, 111, 112, 113, 201],
      b: [109, 204, 208, 212, 210, 202, 206],
    },
    deck: [202, 203, 204],
  });
  const firstOpened = engine.apply(firstStage, 'a', discardFor(engine, firstStage, 405)).snapshot;
  const firstChi = responseActionFor(engine, firstOpened, 'b', 'chi', 'first matching discard should offer chi');
  const firstPass = actionFor(engine, firstOpened, 'b', action => action.type === 'respond' && action.choiceId === null,
    'first matching discard should offer pass');
  const afterFirstPass = engine.apply(firstOpened, 'b', firstPass).snapshot;
  assert.ok(afterFirstPass.players.find(player => player.userId === 'b').passedClaimFaces
    .some(face => face.rank === 5 && face.handRevision === 0));
  assert.ok(firstChi);

  const secondStage = restage(afterFirstPass, {
    hands: {
      a: [305, 101, 102, 103, 111, 112, 113, 201],
      b: [109, 204, 208, 212, 210, 202, 206],
    },
    deck: [202, 203, 204],
    phase: 'discard',
    activeId: 'a',
  });
  const secondOpened = engine.apply(secondStage, 'a', discardFor(engine, secondStage, 305)).snapshot;
  const secondChi = engine.interactions.legalActions(secondOpened, 'b').find(action =>
    action.type === 'respond' && action.choiceId !== null &&
    secondOpened.claims.offers.find(offer => offer.id === action.choiceId)?.action?.type === 'chi');
  assert.equal(secondChi, undefined, 'second matching discard should not offer chi');
  assert.equal(hasPass(engine, secondOpened, 'b'), true, 'locked response should still offer pass');

  const changeStage = restage(secondOpened, {
    hands: {
      a: [101, 102, 103, 111, 112, 113, 201],
      b: [104, 106, 107, 108, 109, 110, 204, 205],
    },
    deck: [202, 203, 204],
    phase: 'discard',
    activeId: 'b',
  });
  const bDiscard = actionFor(engine, changeStage, 'b', action => action.type === 'discard' &&
    cardCode(changeStage, action.cardId) === 104, 'b should be able to change their hand');
  const afterHandChange = engine.apply(changeStage, 'b', bDiscard).snapshot;
  assert.equal(afterHandChange.players.find(player => player.userId === 'b').handRevision, 1);

  const unlockedStage = restage(afterHandChange, {
    hands: {
      a: [405, 101, 102, 103, 111, 112, 113, 201],
      b: [109, 204, 208, 212, 210, 202, 206],
    },
    deck: [202, 203, 204],
    phase: 'discard',
    activeId: 'a',
  });
  const unlockedOpened = engine.apply(unlockedStage, 'a', discardFor(engine, unlockedStage, 405)).snapshot;
  assert.ok(responseActionFor(engine, unlockedOpened, 'b', 'chi',
    'changing the hand should release the same-rank chi lock'));
});

function stageMultiGang(engine, wildcardCount) {
  const natural = [105, 205, 305, 405];
  const wildcards = wildcardCount === 1 ? [1001] : wildcardCount === 2 ? [1001, 1002] : [1001, 1002, 1003];
  const fillerCount = 8 - natural.length - wildcards.length;
  const fillers = [106, 107, 108, 109, 110, 111, 112, 113];
  const hand = [...natural, ...wildcards, ...fillers.slice(0, fillerCount)];
  const deck = wildcardCount === 3
    ? [104, 108, 109, 110, 202, 203]
    : wildcardCount === 2 ? [104, 108, 109, 110, 202] : [104, 109, 110, 202];
  const base = createSnapshot(engine, { gangDuoZhang: 1, wangNum: 3 });
  return { engine, snapshot: restage(base, {
    hands: { a: hand, b: [101, 102, 103, 111, 112, 113, 201] },
    deck,
  }) };
}

function assertMultiGangSettlement(engine, snapshot, wildcardCount) {
  const gang = actionFor(engine, snapshot, 'a', action => action.type === 'gang' &&
    action.cardIds.length === 4 + wildcardCount &&
    action.cardIds.filter(cardId => [1001, 1002, 1003].includes(cardCode(snapshot, cardId)))
      .length === wildcardCount,
  `expected a ${4 + wildcardCount}-card same-rank gang`);
  const gangResult = engine.apply(snapshot, 'a', gang);
  assert.equal(gangResult.events.filter(event => event.type === 'replacement').length, 2 + wildcardCount,
    `a ${4 + wildcardCount}-card gang should replenish ${2 + wildcardCount} cards`);
  assert.equal(gangResult.snapshot.players.find(player => player.userId === 'a').melds[0].cardIds.length,
    4 + wildcardCount);
  assert.equal(zone(gangResult.snapshot, 'hand:a').cards.length, 6);

  const huStage = restage(gangResult.snapshot, {
    hands: {
      a: [110, 104, 108, 206, 107, 207],
      b: [101, 102, 103, 111, 112, 113, 201],
    },
    deck: [202, 203, 204],
    phase: 'discard',
    activeId: 'a',
    source: { kind: 'replacement', userId: 'a', cardCode: 110, afterGang: true },
  });
  let legalActions;
  assert.doesNotThrow(() => {
    legalActions = engine.interactions.legalActions(huStage, 'a');
  }, `red-region evaluator must accept the ${4 + wildcardCount}-card gang meld`);
  const hu = legalActions.find(action => action.type === 'hu');
  assert.ok(hu, `a valid concealed hand plus the ${4 + wildcardCount}-card gang should be hu-able`);
  const settled = engine.apply(huStage, 'a', hu);
  assert.equal(settled.snapshot.phase, 'finished');
  assert.ok(settled.settlement);
}

test('gangDuoZhang permits a five-card same-rank gang and red-region settlement', () => {
  const engine = createEngine({ gangDuoZhang: 1, wangNum: 3 });
  const { snapshot } = stageMultiGang(engine, 1);
  assertMultiGangSettlement(engine, snapshot, 1);
});

test('gangDuoZhang permits a six-card same-rank gang and red-region settlement', () => {
  const engine = createEngine({ gangDuoZhang: 1, wangNum: 3 });
  const { snapshot } = stageMultiGang(engine, 2);
  assertMultiGangSettlement(engine, snapshot, 2);
});

test('gangDuoZhang permits a seven-card same-rank gang and red-region settlement', () => {
  const engine = createEngine({ gangDuoZhang: 1, wangNum: 3 });
  const { snapshot } = stageMultiGang(engine, 3);
  assertMultiGangSettlement(engine, snapshot, 3);
});

test('gangDuoZhang off never offers a gang longer than four cards', () => {
  const engine = createEngine({ gangDuoZhang: 0, wangNum: 3 });
  const base = createSnapshot(engine, { gangDuoZhang: 0, wangNum: 3 });
  const snapshot = restage(base, {
    hands: {
      a: [105, 205, 305, 405, 1001, 1002, 106, 107],
      b: [101, 102, 103, 111, 112, 113, 201],
    },
    deck: [104, 108, 109, 110, 202],
  });
  const gangs = engine.interactions.legalActions(snapshot, 'a').filter(action => action.type === 'gang');
  assert.ok(gangs.length > 0, 'the ordinary four-card gang should remain available');
  assert.equal(gangs.every(action => action.cardIds.length <= 4), true,
    'gangDuoZhang off must not offer five- or six-card gangs');
});
