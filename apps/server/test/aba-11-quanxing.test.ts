import test from 'node:test';
import assert from 'node:assert/strict';
import { ABA11_INDEPENDENT_VERSION, ABA12_INDEPENDENT_VERSION, ABA_INDEPENDENT_VERSION,
  getDefaultOptions } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { createAbaCardState } from '../src/game/aba-pack.js';
import { abaLegalActions, applyAbaAction, createAbaRound, assertAbaRound, viewAbaRound, type AbaRound } from '../src/game/aba-round.js';
import { evaluateAbaWin, type AbaHand, type AbaWinContext } from '../src/game/aba-win.js';

const version = (variantKey: '9:0' | '11:0' | '12:0') => variantKey === '11:0'
  ? ABA11_INDEPENDENT_VERSION : variantKey === '12:0' ? ABA12_INDEPENDENT_VERSION : ABA_INDEPENDENT_VERSION;

function input(quanXing: 0 | 1, overrides: Record<string, unknown> = {}, variantKey: '9:0' | '11:0' | '12:0' = '11:0'): RoundInput {
  const rules = { ...getDefaultOptions(variantKey), playerNum: 2, gameNum: 4, huRedScore: 300,
    baojiaoCondition: 1, baipiType: 1, maxFan: 99, baseBeans: '0.125', quanXing, ...overrides };
  return { players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }], ownerUserId: 'a', number: 1,
    rules: { ...rules, aba: { rulesVersion: version(variantKey) } },
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}

function deck(round: RoundInput, variantKey: '9:0' | '11:0' | '12:0') {
  return createAbaCardState(variantKey, round.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
}

function orderWithSeatOne(round: RoundInput, variantKey: '9:0' | '11:0' | '12:0',
  seatOne: number[], seatTwo: number[], tail: number[] = []): string[] {
  const physical = deck(round, variantKey);
  const used = new Set<string>();
  const pick = (code: number) => {
    const card = physical.find(candidate => candidate.code === code && !used.has(candidate.id));
    assert.ok(card, `Fixture face unavailable: ${code}`);
    used.add(card.id);
    return card.id;
  };
  assert.equal(seatOne.length, seatTwo.length + 1, 'Aba two-player deal requires one extra dealer card.');
  const order = seatTwo.flatMap((code, index) => [pick(seatOne[index]!), pick(code)]);
  order.push(pick(seatOne.at(-1)!));
  order.push(...tail.map(pick));
  order.push(...physical.filter(card => !used.has(card.id)).map(card => card.id));
  return order;
}

function zone(state: AbaRound, id: string) {
  return state.cards.zones.find(item => item.id === id)!.cards;
}

function codes(state: AbaRound, ids: string[]) {
  return ids.map(id => state.cards.pack.find(card => card.id === id)!.code);
}

function begin(state: AbaRound): AbaRound {
  const action = abaLegalActions(state, 'a').find(candidate => candidate.type === 'begin');
  assert.ok(action, 'The dealer must be able to begin the opening phase.');
  return applyAbaAction(state, 'a', action).snapshot as AbaRound;
}

function hand(codes: number[], bonus: number[] = []): AbaHand {
  let id = 0;
  const card = (code: number) => ({ id: `test-${++id}`, code });
  return { concealed: codes.map(card), melds: [], bonus: bonus.map(card) };
}

function context(overrides: Partial<AbaWinContext> = {}): AbaWinContext {
  return { winnerSeat: 1, dealerSeat: 1, source: 'original-hand', sourceSeat: null,
    incomingCardId: null, discardCount: 0, ...overrides };
}

test('11:0 quanXing=0 forces sevens and all special faces into bonus and never exposes them as discard targets', () => {
  const round = input(0);
  const state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
    [107, 1001, 1002, 1003, 110, 204, 310, 104], [101, 102, 103, 105, 106, 108, 111]), '11:0'));
  const bonus = zone(state, 'bonus:a');
  assert.deepEqual(new Set(codes(state, bonus)), new Set([107, 1001, 1002, 1003]));
  const concealed = codes(state, zone(state, 'hand:a'));
  for (const forced of [107, 1001, 1002, 1003]) assert.equal(concealed.includes(forced), false);
  const actions = abaLegalActions(state, 'a');
  assert.equal(actions.some(action => 'cardId' in action && bonus.includes(action.cardId)), false);
  assert.equal(actions.some(action => action.type === 'tou' && action.cardIds.length === 1), false);

  const result = evaluateAbaWin(hand([110, 204, 310, 104, 109, 205, 408, 206], [107]),
    context(), round.rules, '11:0');
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') assert.ok(result.structureScore >= 300);
});

test('11:0 quanXing=1 keeps seven playable and winning while kings retain the existing special-card behavior', () => {
  const round = input(1);
  const state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
    [107, 1001, 1002, 1003, 110, 204, 310, 104], [101, 102, 103, 105, 106, 108, 111]), '11:0'));
  const handIds = zone(state, 'hand:a');
  const bonus = zone(state, 'bonus:a');
  const seven = handIds.find(id => codes(state, [id])[0] === 107);
  assert.ok(seven);
  assert.equal(codes(state, bonus).includes(107), false);
  assert.deepEqual(new Set(codes(state, bonus)), new Set([1001, 1002, 1003]));
  for (const special of [1001, 1002, 1003]) assert.equal(codes(state, handIds).includes(special), false);
  const actions = abaLegalActions(state, 'a');
  assert.ok(actions.some(action => action.type === 'discard' && action.cardId === seven));
  assert.equal(actions.some(action => action.type === 'tou' && action.cardIds.length === 1), false);

  const result = evaluateAbaWin(hand([107, 307, 110, 204, 310, 104, 109, 205]),
    context(), round.rules, '11:0');
  assert.equal(result.status, 'winning');
  const kingInHand = evaluateAbaWin(hand([110, 204, 310, 104, 109, 205, 1001, 206]),
    context(), round.rules, '11:0');
  assert.equal(kingInHand.reason, 'special-card-in-hand');

  const discard = actions.find(action => action.type === 'discard' && action.cardId === seven)!;
  const discarded = applyAbaAction(state, 'a', discard);
  assert.ok(discarded.events.some(event => event.type === 'discard' &&
    (event as { card?: { code?: number } }).card?.code === 107));
});

test('11:0 rejects a source whose replacement card belongs to another player', () => {
  const round = input(1);
  const state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
    [107, 1001, 1002, 1003, 110, 204, 310, 104], [101, 102, 103, 105, 106, 108, 111]), '11:0'));
  state.source = { kind: 'replacement', userId: 'a', cardId: zone(state, 'hand:b')[0]! };
  assert.throws(() => assertAbaRound(state), { code: 'INVALID_ABA_STATE' });
});

test('non-11:0 configurations keep ordinary sevens out of the bonus zone', () => {
  const round = input(1, {}, '9:0');
  const state = begin(createAbaRound(round, orderWithSeatOne(round, '9:0',
    [107, 110, 204, 310, 104, 109, 205, 206], [101, 102, 103, 105, 106, 108, 111]), '9:0'));
  assert.equal(codes(state, zone(state, 'bonus:a')).includes(107), false);
  assert.equal(codes(state, zone(state, 'hand:a')).includes(107), true);
  assert.throws(() => evaluateAbaWin(hand([110, 204, 310, 104, 109, 205, 408, 206], [107]),
    context(), round.rules, '9:0'), { code: 'INVALID_ABA_HAND' });
});

function choose(state: AbaRound, id: string, kind: string): AbaRound {
  const offer = state.claims!.offers.find(item => item.userId === id && (item.action as { type: string }).type === kind);
  assert.ok(offer, `${id} must have a ${kind} offer`);
  const responders = [...new Set(state.claims!.offers.map(item => item.userId))];
  for (const responder of responders) {
    state = applyAbaAction(state, responder, { type: 'respond', decisionId: state.claims!.id,
      choiceId: responder === id ? offer.id : null }).snapshot as AbaRound;
    assertAbaRound(state);
  }
  return state;
}
function passWhite(state: AbaRound): AbaRound {
  const responders = [...new Set(state.claims!.offers.map(item => item.userId))];
  const decisionId = state.claims!.id;
  for (const id of responders) state = applyAbaAction(state, id, { type: 'respond', choiceId: null, decisionId }).snapshot as AbaRound;
  assertAbaRound(state);
  return state;
}
function conserved(state: AbaRound) {
  assertAbaRound(state);
  const all = state.cards.zones.flatMap(item => item.cards);
  assert.equal(all.length, 56);
  assert.equal(new Set(all).size, 56);
}

for (const baipiType of [2, 3]) for (const quanXing of [0, 1] as const) {
  test(`11:0 external white mode ${baipiType}, quanXing=${quanXing}: ownership, candidates and snapshot`, () => {
    const round = input(quanXing, { baipiType });
    const state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [1003, 102, 202, 302, 107, 112, 113, 101], [201, 203, 205, 208, 209, 210, 211], [110]), '11:0'));
    assert.equal(state.phase, 'response');
    assert.equal(state.source!.kind, 'white');
    assert.equal(zone(state, 'table').length, 0);
    assert.equal(zone(state, 'white:a').length, 1);
    assert.equal(codes(state, zone(state, 'hand:a')).includes(1003), false);
    assert.equal(codes(state, zone(state, 'bonus:a')).includes(107), quanXing === 0);
    assert.equal(codes(state, zone(state, 'hand:a')).includes(107), quanXing === 1);
    for (const kind of ['chi', 'peng', 'tou', 'gang']) assert.ok(state.claims!.offers.some(offer =>
      offer.userId === 'a' && (offer.action as { type: string }).type === kind));
    assert.equal(abaLegalActions(state, 'b').length > 0, baipiType === 3);
    if (baipiType === 2) assert.throws(() => applyAbaAction(state, 'b',
      abaLegalActions(state, 'a')[0]), { code: 'INVALID_ACTION' });
    const view = viewAbaRound(state, 'b');
    assert.deepEqual(view.legalActions, abaLegalActions(state, 'b'));
    assert.deepEqual(view.responses, viewAbaRound(structuredClone(state), 'b').responses);
    conserved(state);
    const passed = passWhite(state);
    assert.equal(passed.phase, 'discard');
    assert.equal(passed.activeId, 'a');
    assert.equal(zone(passed, 'white:a').length, 0);
    assert.ok(zone(passed, 'discards').includes(state.source!.cardId!));
    assert.equal(zone(passed, 'hand:a').length, 8);
    conserved(passed);
  });

  for (const kind of ['chi', 'peng', 'tou', 'gang']) test(`11:0 white mode ${baipiType}, quanXing=${quanXing}: ${kind} consumes the real white`, () => {
    const round = input(quanXing, { baipiType });
    const state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [1003, 102, 202, 302, 111, 112, 113, 101], [201, 203, 205, 208, 209, 210, 211]), '11:0'));
    const white = state.source!.cardId!;
    const result = choose(state, 'a', kind);
    assert.equal(result.phase, 'discard');
    assert.equal(zone(result, 'white:a').length, 0);
    assert.ok(zone(result, 'melds:a').includes(white));
    assert.equal(zone(result, 'hand:a').length, 6);
    assert.equal(result.players[0]!.melds[0]!.kind, kind);
    conserved(result);
  });

  test(`11:0 white mode ${baipiType}, quanXing=${quanXing}: external wildcard hu is structural and conserved`, () => {
    const round = input(quanXing, { baipiType, cheLong: 0 });
    const state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [1003, 110, 204, 310, 104, 109, 205, 108], [201, 203, 202, 208, 209, 210, 211]), '11:0'));
    const white = state.source!.cardId!;
    const ended = choose(state, 'a', 'hu');
    const win = ended.outcome!.winners[0]!.win;
    assert.deepEqual(win.wildcardUses, [{ cardId: white, code: 1003 }]);
    assert.equal(win.concealedGroups.flat().filter(id => id === white).length, 1);
    assert.equal(win.redPoints, 41);
    assert.equal(win.blackPoints, 9);
    assert.equal(win.structureScore, 410);
    assert.deepEqual(win.scoreRatio, { numerator: '3280', denominator: '1000' });
    assert.deepEqual(zone(ended, 'won'), [white]);
    conserved(ended);
  });
}

test('11:0 white mode 3 permits another seat to peng or gang but mode 2 cannot', () => {
  for (const baipiType of [2, 3]) for (const kind of ['peng', 'gang']) {
    const round = input(1, { baipiType });
    const state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [1003, 110, 104, 109, 108, 111, 112, 113], [102, 202, 302, 201, 203, 205, 211]), '11:0'));
    if (baipiType === 2) { assert.equal(state.claims!.offers.some(offer => offer.userId === 'b'), false); continue; }
    const result = choose(state, 'b', kind);
    assert.equal(result.activeId, 'b');
    assert.equal(result.phase, 'discard');
    assert.ok(zone(result, 'melds:b').includes(state.source!.cardId!));
    conserved(result);
  }
});

test('11:0 multiple opening whites are offered once each and passing keeps the dealer continuation', () => {
  for (const baipiType of [2, 3]) {
    const round = input(1, { baipiType });
    let state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [1003, 1003, 110, 104, 109, 108, 111, 112], [201, 203, 205, 208, 209, 210, 211], [113, 101]), '11:0'));
    const first = state.source!.cardId!;
    state = passWhite(state);
    assert.equal(state.phase, 'response');
    assert.notEqual(state.source!.cardId, first);
    state = passWhite(state);
    assert.equal(state.phase, 'discard');
    assert.equal(zone(state, 'white:a').length, 0);
    assert.equal(codes(state, zone(state, 'discards')).filter(code => code === 1003).length, 2);
    conserved(state);
  }
});

test('11:0 gang replacement white opens a fresh response before restoring a full hand', () => {
  for (const baipiType of [2, 3]) {
    const round = input(1, { baipiType });
    let state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [1003, 102, 202, 302, 111, 112, 113, 101], [201, 203, 205, 208, 209, 210, 211], [1003, 110, 104]), '11:0'));
    state = choose(state, 'a', 'gang');
    assert.equal(state.phase, 'response');
    assert.equal(state.source!.kind, 'white');
    assert.equal(zone(state, 'hand:a').length, 5);
    assert.equal(zone(state, 'white:a').length, 1);
    state = passWhite(state);
    assert.equal(state.phase, 'discard');
    assert.equal(zone(state, 'hand:a').length, 6);
    conserved(state);
  }
});

test('11:0 white mode 3 allows a different seat to hu; mode 2 refuses that exact hand', () => {
  for (const baipiType of [2, 3]) {
    const round = input(1, { baipiType });
    const state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [1003, 101, 202, 203, 206, 208, 211, 212], [110, 204, 310, 104, 109, 205, 108]), '11:0'));
    assert.equal(state.claims!.offers.some(offer => offer.userId === 'b' &&
      (offer.action as { type: string }).type === 'hu'), baipiType === 3);
    if (baipiType === 3) {
      const result = choose(state, 'b', 'hu');
      assert.equal(result.outcome!.winners[0]!.userId, 'b');
      assert.equal(result.outcome!.winners[0]!.win.structureScore, 410);
      conserved(result);
    }
  }
});

test('11:0 external white flip is public, owner-scoped and resumes the next draw after passes', () => {
  for (const baipiType of [2, 3]) for (const quanXing of [0, 1] as const) {
    const round = input(quanXing, { baipiType });
    let state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [110, 104, 109, 108, 111, 112, 113, 101], [201, 203, 205, 208, 209, 210, 211], [1003]), '11:0'));
    const discard = abaLegalActions(state, 'a').find(action => action.type === 'discard');
    assert.ok(discard);
    state = applyAbaAction(state, 'a', discard).snapshot as AbaRound;
    if (state.phase === 'response') state = passWhite(state);
    assert.equal(state.phase, 'draw');
    assert.equal(state.activeId, 'b');
    const draw = abaLegalActions(state, 'b').find(action => action.type === 'draw');
    assert.ok(draw);
    state = applyAbaAction(state, 'b', draw).snapshot as AbaRound;
    assert.equal(state.source!.kind, 'white');
    assert.equal(state.source!.userId, 'b');
    assert.equal(zone(state, 'white:b').length, 1);
    assert.equal(zone(state, 'table').length, 0);
    assert.equal(state.claims!.offers.some(offer => offer.userId === 'a'), baipiType === 3);
    state = passWhite(state);
    assert.equal(state.phase, 'draw');
    assert.equal(state.activeId, 'a');
    assert.equal(zone(state, 'hand:a').length, 7);
    assert.equal(zone(state, 'hand:b').length, 7);
    conserved(state);
  }
});

test('11:0 opening white claim preserves an already-full dealer first discard without an extra draw', () => {
  const round = input(1, { baipiType: 3 });
  let state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
    [110, 104, 109, 108, 111, 112, 113, 101], [1003, 201, 203, 205, 208, 209, 210], [211]), '11:0'));
  assert.equal(state.openingDealerPending, true);
  assert.equal(state.claims!.offers.some(offer => offer.userId === 'a'), false);
  state = choose(state, 'b', 'chi');
  assert.equal(state.activeId, 'b');
  assert.equal(zone(state, 'hand:a').length, 8);
  const discard = abaLegalActions(state, 'b').find(action => action.type === 'discard');
  assert.ok(discard);
  const deckSize = zone(state, 'deck').length;
  state = applyAbaAction(state, 'b', discard).snapshot as AbaRound;
  if (state.phase === 'response') state = passWhite(state);
  assert.equal(state.phase, 'discard');
  assert.equal(state.activeId, 'a');
  assert.equal(zone(state, 'hand:a').length, 8);
  assert.equal(zone(state, 'deck').length, deckSize);
  conserved(state);
});

test('11:0 consuming the first of two white faces preserves the second response and rejects stale decisions', () => {
  for (const baipiType of [2, 3]) {
    const round = input(1, { baipiType });
    let state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [1003, 1003, 110, 104, 109, 108, 111, 112], [201, 203, 205, 208, 209, 210, 211], [113, 101]), '11:0'));
    const old = abaLegalActions(state, 'a')[0]!;
    const first = state.source!.cardId!;
    state = choose(state, 'a', 'chi');
    assert.ok(zone(state, 'melds:a').includes(first));
    assert.throws(() => applyAbaAction(state, 'a', old), { code: 'STALE_CLAIM_WINDOW' });
    if (baipiType === 2) {
      // The owner now has a full hand, so the second white has no legal owner-only use.
      assert.equal(state.phase, 'discard');
      assert.equal(codes(state, zone(state, 'discards')).filter(code => code === 1003).length, 1);
    } else {
      assert.equal(state.phase, 'response');
      assert.notEqual(state.source!.cardId, first);
      assert.equal(state.claims!.offers.some(offer => offer.userId === 'a'), false);
      state = choose(state, 'b', 'chi');
      assert.equal(state.activeId, 'b');
      assert.ok(state.pendingDiscards!.includes('a'));
      const discard = abaLegalActions(state, 'b').find(action => action.type === 'discard');
      assert.ok(discard);
      state = applyAbaAction(state, 'b', discard).snapshot as AbaRound;
      if (state.phase === 'response') state = passWhite(state);
      assert.equal(state.activeId, 'a');
      assert.equal(zone(state, 'hand:a').length, 6);
    }
    assert.equal(state.phase, 'discard');
    conserved(state);
  }
});

test('11:0 exposed white scoring and malformed wildcard uses respect each mode', () => {
  for (const baipiType of [2, 3]) {
    const round = input(1, { baipiType });
    const current = hand([110, 204, 310, 104, 109, 205]);
    current.melds = [{ kind: 'chi', cards: [{ id: 'meld-white', code: 1003 }, { id: 'red-eight', code: 108 }] }];
    const facts = context({ source: 'flip', sourceSeat: 1, incomingCardId: current.concealed[0]!.id });
    const result = evaluateAbaWin(current, facts, round.rules, '11:0');
    assert.equal(result.status, 'winning');
    if (result.status === 'winning') { assert.equal(result.structureScore, 410); assert.equal(result.redPoints, 41); }
    assert.throws(() => evaluateAbaWin(current, facts, input(1).rules, '11:0'), { code: 'INVALID_ABA_HAND' });
    const seven = hand([110, 204, 310, 104, 109, 205, 108]);
    const white = { cardId: 'external-white', code: 1003 };
    const whiteFacts = context({ source: 'white', sourceSeat: 1, incomingCardId: white.cardId, wildcards: [white] });
    assert.throws(() => evaluateAbaWin(seven, { ...whiteFacts, wildcards: [white, white] }, round.rules, '11:0'),
      { code: 'INVALID_ABA_HAND' });
    assert.throws(() => evaluateAbaWin(seven, { ...whiteFacts, source: 'flip' }, round.rules, '11:0'),
      { code: 'INVALID_RULE_FACTS' });
    const foreign = { ...whiteFacts, sourceSeat: 2 };
    if (baipiType === 2) assert.throws(() => evaluateAbaWin(seven, foreign, round.rules, '11:0'), { code: 'INVALID_RULE_FACTS' });
    else assert.equal(evaluateAbaWin(seven, foreign, round.rules, '11:0').status, 'winning');
    assert.equal(evaluateAbaWin(hand([101, 203, 205, 206, 208, 209, 210]), whiteFacts, round.rules, '11:0').status, 'not-winning');
  }
});

test('11:0 double-in-out counts real sevens once and never treats an exposed white as a seven', () => {
  for (const baipiType of [2, 3]) for (const kind of ['peng', 'gang'] as const) {
    const round = input(1, { baipiType, doubleInOut: 1, cheLong: 0 });
    const current = hand([110, 204, 310, 104, 109, 205]);
    current.melds = [{ kind, cards: [
      { id: 'seven-one', code: 107 }, { id: 'seven-two', code: 307 },
      ...(kind === 'gang' ? [{ id: 'seven-three', code: 207 }] : []), { id: 'white-meld', code: 1003 },
    ] }];
    const result = evaluateAbaWin(current, context({ source: 'flip', sourceSeat: 1, incomingCardId: current.concealed[0]!.id }),
      round.rules, '11:0');
    assert.equal(result.status, 'winning');
    if (result.status === 'winning') assert.equal(result.items.some(item => item.pattern === 'doubleInOut'), false);
  }
});

test('11:0 white mode 3 simultaneous hu cites one physical source without duplicating it', () => {
  const round = input(1, { baipiType: 3, cheLong: 0 });
  let state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
    [1003, 110, 204, 310, 104, 109, 205, 108], [105, 309, 106, 308, 107, 207, 303]), '11:0'));
  const white = state.source!.cardId!;
  const window = state.claims!;
  for (const id of ['a', 'b']) {
    const offer = window.offers.find(item => item.userId === id && (item.action as { type: string }).type === 'hu');
    assert.ok(offer);
    state = applyAbaAction(state, id, { type: 'respond', choiceId: offer.id, decisionId: window.id }).snapshot as AbaRound;
  }
  assert.equal(state.phase, 'finished');
  assert.deepEqual(new Set(state.outcome!.winners.map(item => item.userId)), new Set(['a', 'b']));
  for (const winner of state.outcome!.winners) assert.equal(winner.win.concealedGroups.flat().filter(id => id === white).length, 1);
  assert.deepEqual(zone(state, 'won'), [white]);
  conserved(state);
});

test('11:0 passing consecutive final white flips reaches a real exhausted-deck draw', () => {
  for (const baipiType of [2, 3]) {
    const round = input(1, { baipiType });
    let state = begin(createAbaRound(round, orderWithSeatOne(round, '11:0',
      [110, 104, 109, 108, 111, 112, 113, 101], [201, 203, 205, 208, 209, 210, 211]), '11:0'));
    let guard = 0;
    const whites = new Set<string>();
    while (state.phase !== 'finished') {
      assert.ok(guard++ < 300);
      if (state.phase === 'response') {
        if (state.source!.kind === 'white') whites.add(state.source!.cardId!);
        state = passWhite(state);
      } else {
        const action = abaLegalActions(state, state.activeId).find(candidate => candidate.type === 'discard' || candidate.type === 'draw');
        assert.ok(action);
        state = applyAbaAction(state, state.activeId, action).snapshot as AbaRound;
      }
      conserved(state);
    }
    assert.equal(whites.size, 2);
    assert.equal(zone(state, 'deck').length, 0);
    assert.equal(state.outcome!.reason, 'draw');
    assert.equal(state.outcome!.winners.length, 0);
  }
});

