import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freezeScoreRegionOptions, getDefaultOptions } from '../packages/rules/src/index.ts';
import { createScoreRegionEngine } from '../apps/server/src/game/score-region-engine.ts';
import { beanUnits } from '../apps/server/src/money.ts';

const VARIANTS = new Set(['23:0', '25:0', '26:0', '27:0']);

export const sha256 = value => createHash('sha256').update(value).digest('hex');

function assertVariant(variantKey) {
  assert.ok(VARIANTS.has(variantKey), `Unsupported settlement fixture variant: ${variantKey}`);
}

export function createFixtureRules(variantKey, overrides = {}) {
  assertVariant(variantKey);
  const defaults = getDefaultOptions(variantKey);
  const baseRules = { ...defaults, playerNum: 2, gameNum: 4, baseBeans: '0.125', ...overrides };
  return { ...baseRules, scoreRegion: freezeScoreRegionOptions(baseRules, variantKey) };
}

function fixtureInput(variantKey, overrides = {}) {
  const rules = createFixtureRules(variantKey, overrides);
  return {
    players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
}

function cardPools(snapshot) {
  const byCode = new Map();
  for (const card of snapshot.cards.pack) {
    const cards = byCode.get(card.code) ?? [];
    cards.push(card);
    byCode.set(card.code, cards);
  }
  return byCode;
}

function takeCards(snapshot, codes) {
  const byCode = cardPools(snapshot);
  const used = new Set();
  return codes.map((code, index) => {
    const card = (byCode.get(code) ?? []).find(candidate => !used.has(candidate.id));
    assert.ok(card, `Fixture requested unavailable face ${code} at position ${index}`);
    used.add(card.id);
    return card;
  });
}

function automaticBonus(snapshot, code) {
  if (snapshot.variantKey === '25:0' || snapshot.variantKey === '27:0') {
    return code === 1003 && snapshot.rules.wangNum === 0;
  }
  if (['20:0', '21:0', '23:0', '24:0', '26:0'].includes(snapshot.variantKey)) {
    return [1001, 1002, 1003].includes(code) && snapshot.rules.wangNum === 0;
  }
  return false;
}

function chooseOpponentCards(snapshot, used, count = 7) {
  const selected = [];
  for (const card of snapshot.cards.pack) {
    if (used.has(card.id) || selected.includes(card.id) || automaticBonus(snapshot, card.code)) continue;
    selected.push(card.id);
    if (selected.length === count) return selected;
  }
  assert.fail('Not enough cards for the opponent fixture hand');
}

function setZones(snapshot, { handA, handB, meldsA = [], meldsB = [], bonusesA = [], bonusesB = [],
  table = [], discards = [], deck = null }) {
  const next = structuredClone(snapshot);
  const placed = new Set([...handA, ...handB, ...meldsA.flatMap(meld => meld.cardIds),
    ...meldsB.flatMap(meld => meld.cardIds), ...bonusesA, ...bonusesB, ...table, ...discards]);
  const nextDeck = deck ?? next.cards.pack.map(card => card.id).filter(id => !placed.has(id));
  assert.equal(new Set([...placed, ...nextDeck]).size, next.cards.pack.length,
    'Fixture zones must place every physical card exactly once');
  next.cards.zones = [
    { id: 'deck', visibility: 'hidden', cards: [...nextDeck] },
    { id: 'table', visibility: 'public', cards: [...table] },
    { id: 'discards', visibility: 'public', cards: [...discards] },
    ...next.players.flatMap(player => [
      { id: `hand:${player.userId}`, visibility: 'private', ownerId: player.userId,
        cards: player.userId === 'a' ? [...handA] : [...handB] },
      { id: `melds:${player.userId}`, visibility: 'public', ownerId: player.userId,
        cards: (player.userId === 'a' ? meldsA : meldsB).flatMap(meld => meld.cardIds) },
      { id: `bonus:${player.userId}`, visibility: 'public', ownerId: player.userId,
        cards: player.userId === 'a' ? [...bonusesA] : [...bonusesB] },
    ]),
  ];
  return next;
}

function setMelds(snapshot, melds) {
  const next = structuredClone(snapshot);
  for (const player of next.players) player.melds = (melds[player.userId] ?? []).map(meld => ({
    kind: meld.kind,
    cardIds: [...meld.cardIds],
  }));
  return next;
}

function physical(snapshot, cardId) {
  const card = snapshot.cards.pack.find(item => item.id === cardId);
  assert.ok(card, `Unknown physical card ${cardId}`);
  return card;
}

function legalAction(snapshot, engine, userId, predicate, label) {
  const action = engine.interactions.legalActions(snapshot, userId).find(predicate);
  assert.ok(action, `${label}: no legal action for ${userId}`);
  return action;
}

function apply(snapshot, engine, userId, action, label) {
  const result = engine.apply(snapshot, userId, action);
  assert.ok(result.snapshot, `${label}: apply must return a snapshot`);
  return result;
}

function verifyFinal(result, snapshot, winnerId, label) {
  assert.equal(snapshot.phase, 'finished', `${label}: must finish`);
  assert.ok(result.settlement, `${label}: final settlement is required`);
  assert.deepEqual(result.settlement, snapshot.outcome?.payments?.postings,
    `${label}: settlement must equal final postings`);
  assert.deepEqual(result.confirmedScores?.[0]?.postings, result.settlement,
    `${label}: confirmed score batch must equal final settlement`);
  const total = result.settlement.reduce((sum, posting) => sum + beanUnits(posting.amount), 0n);
  assert.equal(total, 0n, `${label}: postings must conserve balances`);
  const winner = snapshot.outcome?.winners?.find(item => item.userId === winnerId);
  assert.ok(winner, `${label}: expected winner ${winnerId}`);
  return winner;
}

function caseResult(id, initialSnapshot, engine, steps, winnerId, pattern) {
  let current = initialSnapshot;
  let finalResult = null;
  const actions = [];
  for (const step of steps) {
    const action = typeof step.action === 'function' ? step.action(current) : step.action;
    const result = apply(current, engine, step.userId, action, `${id}:${step.name}`);
    actions.push({ userId: step.userId, action: structuredClone(action), name: step.name });
    current = result.snapshot;
    finalResult = result;
  }
  assert.ok(finalResult, `${id}: at least one action is required`);
  const winner = verifyFinal(finalResult, current, winnerId, id);
  if (pattern) assert.ok(winner.win.items.some(item => item.pattern === pattern),
    `${id}: expected ${pattern}`);
  return {
    id,
    initialSnapshot,
    actorId: actions[0].userId,
    action: actions[0].action,
    actions,
    expected: { settlement: finalResult.settlement, scoreUnits: winner.win.scoreUnits, items: winner.win.items },
  };
}

function baseSnapshot(variantKey, overrides, label) {
  const engine = createScoreRegionEngine(`fixture:${variantKey}:${label}`, variantKey, () => 0);
  const snapshot = engine.create(fixtureInput(variantKey, overrides));
  assert.equal(snapshot.variantKey, variantKey, `${label}: wrong engine variant`);
  return { engine, snapshot };
}

function ownWinCase(id, variantKey, codes, overrides, pattern, incomingCode = codes.at(-1)) {
  const { engine, snapshot } = baseSnapshot(variantKey, overrides, id);
  const chosen = takeCards(snapshot, codes);
  const incoming = chosen[codes.indexOf(incomingCode)];
  assert.ok(incoming, `${id}: incoming face ${incomingCode} must be present`);
  const used = new Set(chosen.map(card => card.id));
  const handB = chooseOpponentCards(snapshot, used);
  for (const cardId of handB) used.add(cardId);
  const next = setZones(snapshot, { handA: chosen.map(card => card.id), handB });
  next.phase = 'discard';
  next.activeId = 'a';
  next.source = { kind: 'replacement', userId: 'a', cardId: incoming.id };
  next.serial = 1;
  next.claims = null;
  next.outcome = null;
  const hu = legalAction(next, engine, 'a', action => action.type === 'hu', `${id}: own hu`);
  return caseResult(id, next, engine, [{ userId: 'a', action: hu, name: 'hu' }], 'a', pattern);
}

function sevenRedSevenBlackCase(variantKey) {
  const id = `${variantKey.split(':')[0]}-seven-red-seven-black-final-settlement`;
  const { engine, snapshot } = baseSnapshot(variantKey, {
    da_7hong_7hei: 1, daShaQiangHu: 0, qiang_7Hu: 0, yiDianZhu: 0,
    menQing: 0, haiDiLao: 0, ziQiangHu: 0,
  }, id);
  const meldCodes = [
    [105, 205, 305, 405],
    [106, 206, 306, 406],
    [108, 208, 308, 408],
  ];
  const pair = takeCards(snapshot, [109, 209]);
  const meldCards = meldCodes.map(codes => takeCards(snapshot, codes));
  const melds = meldCards.map(cards => ({ kind: 'gang', cardIds: cards.map(card => card.id) }));
  const used = new Set([...pair, ...meldCards.flat()].map(card => card.id));
  const handB = chooseOpponentCards(snapshot, used);
  const next = setMelds(setZones(snapshot, {
    handA: pair.map(card => card.id),
    handB,
    meldsA: melds,
  }), { a: melds });
  next.phase = 'discard';
  next.activeId = 'a';
  next.source = { kind: 'replacement', userId: 'a', cardId: pair[0].id };
  next.serial = 1;
  next.claims = null;
  next.outcome = null;
  const hu = legalAction(next, engine, 'a', action => action.type === 'hu', `${id}: hu`);
  return caseResult(id, next, engine, [{ userId: 'a', action: hu, name: 'hu' }], 'a', 'sevenRedSevenBlack');
}

function responseWinCase(id, variantKey, codes, overrides, pattern, incomingCode) {
  const { engine, snapshot } = baseSnapshot(variantKey, overrides, id);
  const incoming = takeCards(snapshot, [incomingCode])[0];
  const concealedCodes = codes.filter(code => code !== incomingCode);
  const chosen = takeCards(snapshot, concealedCodes);
  const used = new Set([...chosen, incoming].map(card => card.id));
  const handB = [incoming.id, ...chooseOpponentCards(snapshot, used, 7)];
  for (const cardId of handB) used.add(cardId);
  const next = setZones(snapshot, { handA: chosen.map(card => card.id), handB });
  next.phase = 'discard';
  next.activeId = 'b';
  next.source = null;
  next.serial = 1;
  next.claims = null;
  next.outcome = null;
  const discard = legalAction(next, engine, 'b', action => action.type === 'discard' && action.cardId === incoming.id,
    `${id}: discard`);
  const afterDiscard = apply(next, engine, 'b', discard, `${id}: discard`);
  const response = legalAction(afterDiscard.snapshot, engine, 'a',
    action => action.type === 'respond' && action.choiceId !== null, `${id}: response hu`);
  return caseResult(id, next, engine, [
    { userId: 'b', action: discard, name: 'discard' },
    { userId: 'a', action: response, name: 'respond-hu' },
  ], 'a', pattern);
}

function allFromOthersCase(variantKey) {
  const id = `${variantKey.split(':')[0]}-all-from-others-final-settlement`;
  const { engine, snapshot } = baseSnapshot(variantKey, {
    da_7hong_7hei: 0, daShaQiangHu: 0, qiang_7Hu: 0, yiDianZhu: 0,
    menQing: 0, quanQiuRen: 1,
  }, id);
  const incoming = takeCards(snapshot, [204])[0];
  const concealed = takeCards(snapshot, [110]);
  const meldCards = [
    takeCards(snapshot, [106, 206, 306]),
    takeCards(snapshot, [108, 208, 308]),
    takeCards(snapshot, [112, 212, 312]),
  ];
  const melds = meldCards.map(cards => ({ kind: 'peng', cardIds: cards.map(card => card.id) }));
  const used = new Set([incoming, ...concealed, ...meldCards.flat()].map(card => card.id));
  const handB = [incoming.id, ...chooseOpponentCards(snapshot, used, 7)];
  for (const cardId of handB) used.add(cardId);
  const next = setMelds(setZones(snapshot, {
    handA: concealed.map(card => card.id),
    handB,
    meldsA: melds,
  }), { a: melds });
  next.phase = 'discard';
  next.activeId = 'b';
  next.source = null;
  next.serial = 1;
  next.claims = null;
  next.outcome = null;
  const discard = legalAction(next, engine, 'b', action => action.type === 'discard' && action.cardId === incoming.id,
    `${id}: discard`);
  const afterDiscard = apply(next, engine, 'b', discard, `${id}: discard`);
  const response = legalAction(afterDiscard.snapshot, engine, 'a',
    action => action.type === 'respond' && action.choiceId !== null, `${id}: response hu`);
  return caseResult(id, next, engine, [
    { userId: 'b', action: discard, name: 'discard' },
    { userId: 'a', action: response, name: 'respond-hu' },
  ], 'a', 'allFromOthers');
}

function replacementResponseWinCase(id, variantKey, codes, overrides, pattern, incomingCode) {
  const { engine, snapshot } = baseSnapshot(variantKey, overrides, id);
  const gangCodes = [101, 201, 301, 401];
  const gang = takeCards(snapshot, gangCodes);
  const incoming = takeCards(snapshot, [incomingCode])[0];
  const concealedCodes = codes.filter(code => code !== incomingCode);
  const chosen = takeCards(snapshot, concealedCodes);
  const used = new Set([...chosen, ...gang, incoming].map(card => card.id));
  const extras = chooseOpponentCards(snapshot, used, 4);
  for (const cardId of extras) used.add(cardId);
  const remainingDeck = snapshot.cards.pack.map(card => card.id)
    .filter(cardId => !used.has(cardId));
  const fillerId = remainingDeck.shift();
  assert.ok(fillerId, `${id}: replacement filler must be available`);
  const handB = [...gang.map(card => card.id), ...extras];
  const next = setZones(snapshot, {
    handA: chosen.map(card => card.id), handB, deck: [fillerId, incoming.id, ...remainingDeck],
  });
  next.phase = 'discard';
  next.activeId = 'b';
  next.source = null;
  next.serial = 1;
  next.claims = null;
  next.outcome = null;
  const gangAction = legalAction(next, engine, 'b', action => action.type === 'gang' &&
    action.cardIds.length === 4 && action.cardIds.every(cardId => gang.some(card => card.id === cardId)),
  `${id}: gang`);
  const afterGang = apply(next, engine, 'b', gangAction, `${id}: gang`);
  const response = legalAction(afterGang.snapshot, engine, 'a',
    action => action.type === 'respond' && action.choiceId !== null, `${id}: replacement response hu`);
  return caseResult(id, next, engine, [
    { userId: 'b', action: gangAction, name: 'gang' },
    { userId: 'a', action: response, name: 'respond-hu' },
  ], 'a', pattern);
}

function piaoType2Case() {
  const id = '23-piao-type-2-final-settlement';
  const { engine, snapshot } = baseSnapshot('23:0', { piaoType: 2 }, id);
  assert.equal(snapshot.phase, 'piao', `${id}: piaoType=2 must begin in piao`);
  const chosen = takeCards(snapshot, [110, 104, 109, 205, 108, 206, 107, 207]);
  const used = new Set(chosen.map(card => card.id));
  const handB = chooseOpponentCards(snapshot, used);
  const staged = setZones(snapshot, { handA: chosen.map(card => card.id), handB });
  const piaoA = legalAction(staged, engine, 'a', action => action.type === 'piao' && action.value === 1,
    `${id}: a piao`);
  const afterA = apply(staged, engine, 'a', piaoA, `${id}: a piao`);
  const piaoB = legalAction(afterA.snapshot, engine, 'b', action => action.type === 'piao' && action.value === 1,
    `${id}: b piao`);
  const afterB = apply(afterA.snapshot, engine, 'b', piaoB, `${id}: b piao`);
  assert.equal(afterB.snapshot.phase, 'opening', `${id}: piao completion must enter opening`);
  const hu = legalAction(afterB.snapshot, engine, 'a', action => action.type === 'hu', `${id}: opening hu`);
  return caseResult(id, staged, engine, [
    { userId: 'a', action: piaoA, name: 'piao' },
    { userId: 'b', action: piaoB, name: 'piao' },
    { userId: 'a', action: hu, name: 'hu' },
  ], 'a', 'piao');
}

function baNoGuoCase() {
  const id = '23-ba-no-guo-final-settlement';
  const { engine, snapshot } = baseSnapshot('23:0', { baNoGuo: 1, guoZhangNoCaozuo: 1 }, id);
  const aHand = takeCards(snapshot, [401, 110, 204, 309, 205, 308, 206, 207]);
  const bHand = takeCards(snapshot, [107, 210, 211, 212, 302]);
  const peng = takeCards(snapshot, [101, 201, 301]);
  const replacementCard = takeCards(snapshot, [202])[0];
  const used = new Set([...aHand, ...bHand, ...peng, replacementCard].map(card => card.id));
  const next = setMelds(setZones(snapshot, { handA: aHand.map(card => card.id), handB: bHand.map(card => card.id),
    meldsB: [{ kind: 'peng', cardIds: peng.map(card => card.id) }],
    deck: [replacementCard.id, ...snapshot.cards.pack.map(card => card.id).filter(cardId => !used.has(cardId))] }),
  { b: [{ kind: 'peng', cardIds: peng.map(card => card.id) }] });
  next.phase = 'discard';
  next.activeId = 'a';
  next.source = null;
  next.serial = 0;
  next.claims = null;
  next.outcome = null;
  const discardCardObject = aHand.find(card => card.code === 401);
  assert.ok(discardCardObject, `${id}: fixture must contain the discard face`);
  const discardCardId = discardCardObject.id;
  const discardAction = legalAction(next, engine, 'a', action => action.type === 'discard' && action.cardId === discardCardId,
    `${id}: discard`);
  const afterDiscard = apply(next, engine, 'a', discardAction, `${id}: discard`);
  const forced = legalAction(afterDiscard.snapshot, engine, 'b',
    action => action.type === 'respond' && action.choiceId !== null, `${id}: forced ba`);
  const afterBa = apply(afterDiscard.snapshot, engine, 'b', forced, `${id}: forced ba`);
  assert.equal(afterBa.snapshot.source?.afterGang, true, `${id}: ba must enter replacement`);
  assert.equal(physical(afterBa.snapshot, afterBa.snapshot.source.cardId).code, 202,
    `${id}: replacement must not itself be a winning card for a`);
  const discardReplacement = legalAction(afterBa.snapshot, engine, 'b',
    action => action.type === 'discard' && physical(afterBa.snapshot, action.cardId).code === 107,
    `${id}: replacement discard`);
  const afterReplacement = apply(afterBa.snapshot, engine, 'b', discardReplacement, `${id}: replacement discard`);
  const response = legalAction(afterReplacement.snapshot, engine, 'a',
    action => action.type === 'respond' && action.choiceId !== null &&
      afterReplacement.snapshot.claims.offers.find(offer => offer.id === action.choiceId)?.action?.type === 'hu',
    `${id}: response hu`);
  return caseResult(id, next, engine, [
    { userId: 'a', action: discardAction, name: 'discard' },
    { userId: 'b', action: forced, name: 'forced-ba' },
    { userId: 'b', action: discardReplacement, name: 'replacement-discard' },
    { userId: 'a', action: response, name: 'respond-hu' },
  ], 'a');
}

function guoZhangNoCaozuoCase() {
  const id = '23-guo-zhang-no-caozuo-lock';
  const { engine, snapshot } = baseSnapshot('23:0', { guoZhangNoCaozuo: 1, baNoGuo: 0 }, id);
  const aHand = takeCards(snapshot, [107, 207, 110, 203, 209, 303, 309]);
  const handB = takeCards(snapshot, [307, 101, 102, 103, 111, 201, 202, 212]).map(card => card.id);
  const next = setZones(snapshot, { handA: aHand.map(card => card.id), handB });
  next.phase = 'discard';
  next.activeId = 'b';
  next.source = null;
  next.serial = 0;
  next.claims = null;
  next.outcome = null;
  const discardCard = handB.find(cardId => physical(next, cardId).code === 307);
  assert.ok(discardCard, `${id}: opponent needs a matching discard`);
  const discard = legalAction(next, engine, 'b', action => action.type === 'discard' && action.cardId === discardCard,
    `${id}: discard`);
  const afterDiscard = apply(next, engine, 'b', discard, `${id}: discard`);
  const pass = legalAction(afterDiscard.snapshot, engine, 'a',
    action => action.type === 'respond' && action.choiceId === null, `${id}: pass`);
  const afterPass = apply(afterDiscard.snapshot, engine, 'a', pass, `${id}: pass`);
  const player = afterPass.snapshot.players.find(item => item.userId === 'a');
  assert.ok(player.passedClaimFaces.some(face => face.rank === 7), `${id}: rank must be remembered`);
  return { id, initialSnapshot: next, actorId: 'b', action: discard,
    actions: [{ userId: 'b', action: discard, name: 'discard' },
      { userId: 'a', action: pass, name: 'pass' }],
    expected: { passedClaimFaces: player.passedClaimFaces, handRevision: player.handRevision }, result: afterPass };
}

function gangDuoZhangCase(cardCount) {
  const id = `23-gang-duo-zhang-${cardCount}-final-settlement`;
  const { engine, snapshot } = baseSnapshot('23:0', { gangDuoZhang: 1, wangNum: 3 }, id);
  const natural = takeCards(snapshot, [104, 204, 304, 404]);
  const wildcards = takeCards(snapshot, [1001, 1002]);
  const extra = takeCards(snapshot, [109, 105]);
  const handA = [...natural, ...wildcards, ...extra].map(card => card.id);
  const ordered = takeCards(snapshot, [108, 106, 107, 307]).map(card => card.id);
  const used = new Set([...handA, ...ordered]);
  const handB = chooseOpponentCards(snapshot, used);
  const deck = [...ordered, ...snapshot.cards.pack.map(card => card.id)
    .filter(cardId => !used.has(cardId) && !handB.includes(cardId))];
  const next = setZones(snapshot, { handA, handB, deck });
  next.phase = 'discard';
  next.activeId = 'a';
  next.source = null;
  next.serial = 0;
  next.claims = null;
  next.outcome = null;
  const gangActions = engine.interactions.legalActions(next, 'a')
    .filter(action => action.type === 'gang' && action.cardIds.length >= 5);
  assert.ok(gangActions.some(action => action.cardIds.length === 5), `${id}: expected 5-card gang`);
  assert.ok(gangActions.some(action => action.cardIds.length === 6), `${id}: expected 6-card gang`);
  const action = gangActions.find(item => item.cardIds.length === cardCount);
  assert.ok(action, `${id}: expected ${cardCount}-card gang`);
  const afterGang = apply(next, engine, 'a', action, `${id}: ${cardCount}-card gang`);
  assert.equal(afterGang.snapshot.phase, 'discard', `${id}: ${cardCount}-card gang must enter discard`);
  assert.equal(afterGang.snapshot.source?.kind, 'replacement', `${id}: gang must draw a replacement`);
  assert.equal(afterGang.snapshot.source?.afterGang, true, `${id}: replacement must retain gang context`);
  assert.equal(afterGang.events.filter(event => event.type === 'replacement').length, cardCount - 2,
    `${id}: ${cardCount}-card gang must replenish ${cardCount - 2} cards`);
  assert.equal(afterGang.snapshot.players.find(player => player.userId === 'a').melds[0].cardIds.length, cardCount,
    `${id}: gang must remain exposed as ${cardCount} cards`);
  const hu = legalAction(afterGang.snapshot, engine, 'a', candidate => candidate.type === 'hu', `${id}: hu`);
  return caseResult(id, next, engine, [
    { userId: 'a', action, name: `${cardCount}-card-gang` },
    { userId: 'a', action: hu, name: 'hu' },
  ], 'a');
}

function guoZhangNoCaozuoSettlementCase() {
  const id = '23-guo-zhang-no-caozuo-final-settlement';
  const { engine, snapshot } = baseSnapshot('23:0', { guoZhangNoCaozuo: 1, baNoGuo: 0 }, id);
  const aHand = takeCards(snapshot, [107, 110, 204, 309, 305, 108, 206]);
  const bHand = takeCards(snapshot, [207, 101, 102, 103, 111, 201, 212, 202]);
  const next = setZones(snapshot, {
    handA: aHand.map(card => card.id),
    handB: bHand.map(card => card.id),
  });
  next.phase = 'discard';
  next.activeId = 'b';
  next.source = null;
  next.serial = 1;
  next.claims = null;
  next.outcome = null;
  for (const current of next.players) {
    current.handRevision = 0;
    current.passedClaimFaces = [{ rank: 7, handRevision: 0 }];
  }
  const discardCard = bHand.find(card => card.code === 207);
  assert.ok(discardCard, `${id}: opponent needs the locked second rank-seven discard`);
  const discard = legalAction(next, engine, 'b', action => action.type === 'discard' &&
    action.cardId === discardCard.id, `${id}: second rank-seven discard`);
  const afterDiscard = apply(next, engine, 'b', discard, `${id}: second rank-seven discard`);
  assert.equal(afterDiscard.snapshot.phase, 'response', `${id}: second rank-seven discard must open response`);
  const aOffers = afterDiscard.snapshot.claims.offers.filter(offer => offer.userId === 'a');
  assert.ok(aOffers.some(offer => offer.action.type === 'hu'), `${id}: hu must remain available while locked`);
  assert.equal(aOffers.some(offer => ['chi', 'peng', 'gang'].includes(offer.action.type)), false,
    `${id}: same-rank chi/peng/gang must be locked after the pass`);
  const response = legalAction(afterDiscard.snapshot, engine, 'a', action => action.type === 'respond' &&
    action.choiceId !== null && afterDiscard.snapshot.claims.offers.find(offer => offer.id === action.choiceId)
      ?.action?.type === 'hu', `${id}: response hu`);
  return caseResult(id, next, engine, [
    { userId: 'b', action: discard, name: 'second-rank-seven-discard' },
    { userId: 'a', action: response, name: 'respond-hu' },
  ], 'a');
}

function gangDuoZhangSettlementCase() {
  const id = '23-gang-duo-zhang-seven-final-settlement';
  const { engine, snapshot } = baseSnapshot('23:0', { gangDuoZhang: 1, wangNum: 3 }, id);
  const natural = takeCards(snapshot, [105, 205, 305, 405]);
  const wildcards = takeCards(snapshot, [1001, 1002, 1003]);
  const filler = takeCards(snapshot, [107]);
  const aHand = [...natural, ...wildcards, ...filler].map(card => card.id);
  const bHand = takeCards(snapshot, [307, 301, 313, 302, 312, 304, 310]).map(card => card.id);
  const replacementCards = takeCards(snapshot, [110, 104, 108, 206, 207]);
  const used = new Set([...aHand, ...bHand, ...replacementCards.map(card => card.id)]);
  const deck = [...replacementCards.map(card => card.id),
    ...snapshot.cards.pack.map(card => card.id).filter(cardId => !used.has(cardId))];
  const next = setZones(snapshot, { handA: aHand, handB: bHand, deck });
  next.phase = 'discard';
  next.activeId = 'a';
  next.source = null;
  next.serial = 0;
  next.claims = null;
  next.outcome = null;
  const gang = legalAction(next, engine, 'a', action => action.type === 'gang' &&
    action.cardIds.length === 7 && action.cardIds.every(cardId =>
      [...natural, ...wildcards].some(card => card.id === cardId)), `${id}: seven-card gang`);
  const afterGang = apply(next, engine, 'a', gang, `${id}: seven-card gang`);
  assert.equal(afterGang.snapshot.phase, 'response', `${id}: replacement must open a response window`);
  assert.equal(afterGang.snapshot.source?.kind, 'replacement', `${id}: replacement source`);
  assert.equal(afterGang.snapshot.source?.afterGang, true, `${id}: replacement must retain gang context`);
  assert.equal(afterGang.events.filter(event => event.type === 'replacement').length, 5,
    `${id}: a seven-card gang must replenish five cards`);
  const playerA = afterGang.snapshot.players.find(current => current.userId === 'a');
  assert.equal(playerA.melds[0].cardIds.length, 7, `${id}: the exposed gang must retain seven cards`);
  const handCodes = afterGang.snapshot.cards.zones.find(current => current.id === 'hand:a').cards
    .map(cardId => physical(afterGang.snapshot, cardId).code).sort((left, right) => left - right);
  assert.deepEqual(handCodes, [104, 107, 108, 110, 206, 207],
    `${id}: the controlled replacement must complete the six-card winning hand`);
  const pass = legalAction(afterGang.snapshot, engine, 'b', action => action.type === 'respond' &&
    action.choiceId === null, `${id}: pass replacement window`);
  const afterPass = apply(afterGang.snapshot, engine, 'b', pass, `${id}: pass replacement window`);
  assert.equal(afterPass.snapshot.phase, 'discard', `${id}: passing the replacement must resume the gang owner`);
  const hu = legalAction(afterPass.snapshot, engine, 'a', action => action.type === 'hu', `${id}: hu`);
  return caseResult(id, next, engine, [
    { userId: 'a', action: gang, name: 'seven-card-gang' },
    { userId: 'b', action: pass, name: 'pass-replacement' },
    { userId: 'a', action: hu, name: 'hu' },
  ], 'a');
}

function ganluoAnDuiCase() {
  const id = '26-an-dui-final-settlement';
  const codes = [105, 205, 305, 405, 109, 209, 110, 310];
  return ownWinCase(id, '26:0', codes, { wangNum: 3, qiWangNum: 8, maxFan: 4,
    anDui: 1, siGuiYi: 0, gangPao: 0, gangHua: 0 }, 'anDui', codes.at(-1));
}

export function buildGanluoOfficialCases() {
  const fourPairsCodes = [105, 205, 305, 405, 109, 209, 110, 310];
  const fourPairsSettlement = ownWinCase('26:0-concealed-four-pairs-official', '26:0', fourPairsCodes,
    { wangNum: 3, qiWangNum: 8, maxFan: 4, anDui: 1, siGuiYi: 0, gangPao: 0, gangHua: 0 },
    'anDui', fourPairsCodes.at(-1));
  const fourPairs = {
    id: fourPairsSettlement.id,
    initialSnapshot: fourPairsSettlement.initialSnapshot,
    covers: ['concealed-four-pairs', 'payments'],
    steps: fourPairsSettlement.actions.map((item, index) => ({
      actorId: item.userId,
      action: item.action,
      assert: index === fourPairsSettlement.actions.length - 1
        ? { 'snapshot.phase': 'finished', 'snapshot.outcome.winners.0.win.structure': 'four-pairs' }
        : { 'snapshot.variantKey': '26:0' },
    })),
  };

  const declarationCodes = [101, 113, 105, 309, 104, 310, 112, 106];
  const { engine, snapshot } = baseSnapshot('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4,
    anDui: 1, siGuiYi: 0, gangPao: 0, gangHua: 0 }, '26:0-declared-wait-lock-official');
  const chosen = takeCards(snapshot, declarationCodes);
  const used = new Set(chosen.map(card => card.id));
  const handB = chooseOpponentCards(snapshot, used);
  for (const cardId of handB) used.add(cardId);
  const next = setZones(snapshot, { handA: chosen.map(card => card.id), handB });
  next.phase = 'discard';
  next.activeId = 'a';
  next.source = { kind: 'replacement', userId: 'a', cardId: chosen[0].id };
  next.serial = 0;
  next.claims = null;
  next.outcome = null;
  const declaration = legalAction(next, engine, 'a', action => action.type === 'declare' &&
    action.cardId === chosen.find(card => card.code === 106).id, '26:0 declaration');
  const declared = apply(next, engine, 'a', declaration, '26:0 declaration');
  const claims = declared.snapshot.claims;
  assert.ok(claims && claims.id, '26:0 declaration must open a response window');
  return [fourPairs, {
    id: '26:0-declared-wait-lock-official',
    initialSnapshot: next,
    covers: ['declared-wait-lock'],
    steps: [
      {
        actorId: 'a',
        action: declaration,
        assert: {
          'snapshot.phase': 'response',
          'snapshot.players.0.declaredWaits': [102, 202, 212, 302, 312, 402, 412],
        },
      },
      {
        actorId: 'a',
        action: { type: 'respond', choiceId: 'not-offered', decisionId: claims.id },
        errorCode: 'INVALID_ACTION',
      },
    ],
  }];
}

function siGuiYiCase(id, concealedCodes, meldsCodes = []) {
  const { engine, snapshot } = baseSnapshot('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4,
    anDui: 0, siGuiYi: 1, gangPao: 0, gangHua: 0 }, id);
  const chosen = takeCards(snapshot, concealedCodes);
  const meldCards = meldsCodes.length ? takeCards(snapshot, meldsCodes) : [];
  const used = new Set([...chosen, ...meldCards].map(card => card.id));
  const handB = chooseOpponentCards(snapshot, used);
  const next = setMelds(setZones(snapshot, { handA: chosen.map(card => card.id), handB,
    meldsA: meldCards.length ? [{ kind: 'peng', cardIds: meldCards.map(card => card.id) }] : [] }),
  { a: meldCards.length ? [{ kind: 'peng', cardIds: meldCards.map(card => card.id) }] : [] });
  next.phase = 'discard';
  next.activeId = 'a';
  next.source = { kind: 'replacement', userId: 'a', cardId: chosen.at(-1).id };
  next.serial = 1;
  next.claims = null;
  next.outcome = null;
  const hu = legalAction(next, engine, 'a', action => action.type === 'hu', `${id}: siGuiYi hu`);
  return caseResult(id, next, engine, [{ userId: 'a', action: hu, name: 'hu' }], 'a', 'siGuiYi');
}

function gangPaoCase() {
  const id = '26-gang-pao-final-settlement';
  const { engine, snapshot } = baseSnapshot('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4,
    gangPao: 1, gangHua: 0, anDui: 0, siGuiYi: 0 }, id);
  const gang = takeCards(snapshot, [107, 207, 307, 407]);
  const replacement = takeCards(snapshot, [104])[0];
  const aHand = [gang[3], ...takeCards(snapshot, [109, 101, 113, 102, 103])];
  const bHand = takeCards(snapshot, [110, 309, 205, 201, 213, 206, 308]);
  const used = new Set([...gang, ...aHand, ...bHand, replacement].map(card => card.id));
  const remainingDeck = snapshot.cards.pack.map(card => card.id).filter(cardId => !used.has(cardId));
  const next = setMelds(setZones(snapshot, { handA: aHand.map(card => card.id), handB: bHand.map(card => card.id),
    meldsA: [{ kind: 'peng', cardIds: gang.slice(0, 3).map(card => card.id) }],
    deck: [replacement.id, ...remainingDeck] }),
  { a: [{ kind: 'peng', cardIds: gang.slice(0, 3).map(card => card.id) }] });
  next.phase = 'discard';
  next.activeId = 'a';
  next.source = null;
  next.serial = 0;
  next.claims = null;
  next.outcome = null;
  const gangAction = legalAction(next, engine, 'a', action => action.type === 'ba' && action.cardId === gang[3].id,
    `${id}: ba`);
  const afterGang = apply(next, engine, 'a', gangAction, `${id}: gang`);
  assert.equal(afterGang.snapshot.source?.afterGang, true, `${id}: ba must mark afterGang`);
  const replacementId = afterGang.snapshot.source.cardId;
  assert.ok(replacementId, `${id}: gang must draw a replacement`);
  assert.equal(physical(afterGang.snapshot, replacementId).code, 104,
    `${id}: fixture must control the replacement face`);
  assert.ok(!aHand.some(card => card.id === replacementId), `${id}: replacement must be new`);
  const passReplacement = legalAction(afterGang.snapshot, engine, 'b',
    action => action.type === 'respond' && action.choiceId === null, `${id}: pass replacement`);
  const afterPass = apply(afterGang.snapshot, engine, 'b', passReplacement, `${id}: pass replacement`);
  const discard = legalAction(afterPass.snapshot, engine, 'a',
    action => action.type === 'discard' && action.cardId === replacementId, `${id}: replacement discard`);
  const afterDiscard = apply(afterPass.snapshot, engine, 'a', discard, `${id}: discard`);
  const response = legalAction(afterDiscard.snapshot, engine, 'b',
    action => action.type === 'respond' && action.choiceId !== null &&
      afterDiscard.snapshot.claims.offers.find(offer => offer.id === action.choiceId)?.action?.type === 'hu',
    `${id}: gang-pao hu`);
  return caseResult(id, next, engine, [
    { userId: 'a', action: gangAction, name: 'gang' },
    { userId: 'b', action: passReplacement, name: 'pass-replacement' },
    { userId: 'a', action: discard, name: 'replacement-discard' },
    { userId: 'b', action: response, name: 'respond-hu' },
  ], 'b', 'gangPao');
}

export function buildSettlementCases(variantKey, options = {}) {
  assertVariant(variantKey);
  const cases = [];
  if (variantKey === '23:0') {
    cases.push(piaoType2Case(), baNoGuoCase(), guoZhangNoCaozuoSettlementCase(),
      gangDuoZhangSettlementCase());
  } else if (variantKey === '25:0' || variantKey === '27:0') {
    cases.push(
      ownWinCase(`${variantKey.split(':')[0]}-an-dui-final-settlement`, variantKey,
        [110, 204, 309, 205, 305, 209, 307, 207],
        { da_7hong_7hei: 0, yiDianZhu: 0, menQing: 0 }, null),
      sevenRedSevenBlackCase(variantKey),
      replacementResponseWinCase(`${variantKey.split(':')[0]}-qiang-hu-final-settlement`, variantKey,
        [110, 204, 109, 405, 108, 406, 107, 207],
        { da_7hong_7hei: 0, daShaQiangHu: 1, qiang_7Hu: 0, yiDianZhu: 0, menQing: 0 }, 'qiangHu', 107),
      replacementResponseWinCase(`${variantKey.split(':')[0]}-qiang-seven-final-settlement`, variantKey,
        [110, 204, 109, 405, 108, 406, 107, 207],
        { da_7hong_7hei: 0, daShaQiangHu: 0, qiang_7Hu: 1, yiDianZhu: 0, menQing: 0 }, 'qiang7', 107),
      responseWinCase(`${variantKey.split(':')[0]}-one-red-final-settlement`, variantKey,
        [110, 210, 209, 405, 208, 406, 207, 407],
        { da_7hong_7hei: 0, yiDianZhu: 1, menQing: 0 }, 'oneRed', 110),
      allFromOthersCase(variantKey),
    );
  } else if (variantKey === '26:0') {
    cases.push(
      ganluoAnDuiCase(),
      gangPaoCase(),
      siGuiYiCase('26-si-gui-yi-exposed-three-plus-concealed',
        [405, 109, 110, 104, 101, 113], [105, 205, 305]),
      siGuiYiCase('26-si-gui-yi-concealed-quad', [107, 207, 307, 407, 110, 204, 108, 206]),
    );
  }
  return { cases, blocked: [] };
}

export function buildXuzhouOptionCases() {
  return {
    piaoType2: piaoType2Case(),
    baNoGuo: baNoGuoCase(),
    guoZhangNoCaozuo: guoZhangNoCaozuoCase(),
    gangDuoZhang: gangDuoZhangCase(6),
  };
}

export function buildSettlementEvidence(variantKey, options = {}) {
  const built = buildSettlementCases(variantKey, options);
  return {
    schemaVersion: 1,
    kind: 'final-settlement-regression',
    variantKey,
    ruleVersion: options.ruleVersion ?? createScoreRegionEngine(`fixture:${variantKey}:meta`, variantKey).version,
    officialCasesSha256: options.officialCasesSha256 ?? null,
    rulebookDigest: options.rulebookDigest ?? null,
    cases: built.cases.map(item => ({
      id: item.id,
      initialSnapshot: item.initialSnapshot,
      actorId: item.actorId,
      action: item.action,
      actions: item.actions,
      expected: item.expected,
    })),
    blocked: built.blocked,
  };
}

export default buildSettlementCases;
