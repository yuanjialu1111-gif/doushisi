import test from 'node:test';
import assert from 'node:assert/strict';
import { ABA11_INDEPENDENT_VERSION, ABA_INDEPENDENT_VERSION, getDefaultOptions } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { abaDeclarationFaces, abaLegalActions, applyAbaAction, assertAbaRound, createAbaRound, type AbaRound } from '../src/game/aba-round.js';
import { createAbaCardState } from '../src/game/aba-pack.js';
import { moveCards } from '../src/game/cards.js';
import { openClaims } from '../src/game/claims.js';
import { declaredWaitMatches, sameDeclaredWaits } from '../src/game/declared-waits.js';

function fixture(codes = [110, 104, 109, 105, 201, 212, 206, 208]): AbaRound {
  const rules = { ...getDefaultOptions('9:0'), playerNum: 2, gameNum: 4, huRedScore: 300,
    baojiaoCondition: 1, baipiType: 1, maxFan: 99, baseBeans: '0.125',
    aba: { rulesVersion: ABA_INDEPENDENT_VERSION } };
  const input: RoundInput = { players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
  const pack = createAbaCardState('9:0', rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  const used = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(card => card.code === code && !used.has(card.id));
    assert.ok(card); used.add(card.id); return card.id;
  };
  const opponentCodes = [101, 102, 103, 106, 108, 111, 113];
  const order = codes.slice(0, 7).flatMap((code, index) => [pick(code), pick(opponentCodes[index]!)]);
  order.push(pick(codes[7]!));
  order.push(...pack.filter(card => !used.has(card.id)).map(card => card.id));
  const state = createAbaRound(input, order);
  return applyAbaAction(state, 'a', abaLegalActions(state, 'a').find(action => action.type === 'begin')!).snapshot as AbaRound;
}
const zone = (state: AbaRound, id: string) => state.cards.zones.find(zone => zone.id === id)!.cards;
const face = (state: AbaRound, id: string) => state.cards.pack.find(card => card.id === id)!.code;

function externalWhiteWaiting(): AbaRound {
  const rules = { ...getDefaultOptions('11:0'), playerNum: 2, gameNum: 4, huRedScore: 300,
    baojiaoCondition: 1, baipiType: 3, maxFan: 99, baseBeans: '0.125', quanXing: 0,
    aba: { rulesVersion: ABA11_INDEPENDENT_VERSION } };
  const input: RoundInput = { players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
  const pack = createAbaCardState('11:0', rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  const used = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(candidate => candidate.code === code && !used.has(candidate.id));
    assert.ok(card); used.add(card.id); return card.id;
  };
  const dealer = [110, 204, 310, 104, 109, 205, 108, 107];
  const opponent = [101, 102, 103, 106, 111, 112, 113];
  const order = dealer.slice(0, 7).flatMap((code, index) => [pick(code), pick(opponent[index]!)]);
  order.push(pick(dealer[7]!), pick(105));
  order.push(...pack.filter(card => !used.has(card.id)).map(card => card.id));
  let state = createAbaRound(input, order, '11:0');
  const begin = abaLegalActions(state, 'a').find(action => action.type === 'begin');
  assert.ok(begin);
  state = applyAbaAction(state, 'a', begin).snapshot as AbaRound;
  assert.deepEqual(zone(state, 'bonus:a').map(id => face(state, id)), [107]);
  const declaration = abaLegalActions(state, 'a').find(action =>
    action.type === 'declare' && face(state, action.cardId) === 105);
  assert.ok(declaration);
  return applyAbaAction(state, 'a', declaration).snapshot as AbaRound;
}

test('declared waits compare full sets independently of order and distinguish null from empty', () => {
  assert.equal(sameDeclaredWaits([104, 208], [208, 104]), true);
  assert.equal(sameDeclaredWaits([104, 208], [104]), false);
  assert.equal(sameDeclaredWaits(null, []), false);
  assert.equal(sameDeclaredWaits(null, null), true);
  assert.equal(declaredWaitMatches([], 104), false);
  assert.equal(declaredWaitMatches([104], null), false);
});

test('declared discard preserves the entire frozen set, not the discarded face', () => {
  const state = fixture();
  const declaration = abaLegalActions(state, 'a').find(action => action.type === 'declare');
  assert.ok(declaration && declaration.type === 'declare');
  const frozen = abaDeclarationFaces(state, 'a', declaration.cardId)!;
  state.players[0]!.declaredWaits = [...frozen].reverse();
  state.players[0]!.declaredBonusIds = [...zone(state, 'bonus:a')];
  const unchanged = abaLegalActions(state, 'a').find(action => action.type === 'discard' && action.cardId === declaration.cardId);
  assert.ok(unchanged);
  assert.equal(abaLegalActions(state, 'a').some(action => action.type === 'declare'), false);
  const changed = zone(state, 'hand:a').find(cardId => !sameDeclaredWaits(frozen, abaDeclarationFaces(state, 'a', cardId)));
  assert.ok(changed);
  assert.equal(abaLegalActions(state, 'a').some(action => action.type === 'discard' && action.cardId === changed), false);
  assert.throws(() => applyAbaAction(state, 'a', { type: 'discard', cardId: changed, decisionId: `ab:1:${state.serial}` }), /offered/);
  assert.throws(() => applyAbaAction(state, 'a', { ...declaration, decisionId: `ab:1:${state.serial}` }), /offered/);
  const next = applyAbaAction(state, 'a', unchanged).snapshot as AbaRound;
  assert.deepEqual(next.players[0]!.declaredWaits, [...frozen].reverse());
});

function waiting(): AbaRound {
  const state = fixture();
  const declaration = abaLegalActions(state, 'a').find(action => action.type === 'declare');
  assert.ok(declaration);
  return applyAbaAction(state, 'a', declaration).snapshot as AbaRound;
}

test('a structurally winning replacement must match its actual source face', () => {
  const state = waiting();
  // Normalize any discard response before installing a physical replacement.
  for (const cardId of [...zone(state, 'table')]) state.cards = moveCards(state.cards, 'table', 'discards', [cardId]);
  const incoming = zone(state, 'deck').find(id => state.players[0]!.declaredWaits!.includes(face(state, id)));
  assert.ok(incoming);
  state.cards = moveCards(state.cards, 'deck', 'hand:a', [incoming]);
  state.phase = 'discard'; state.activeId = 'a'; state.claims = null;
  state.source = { kind: 'replacement', userId: 'a', cardId: incoming };
  assert.ok(abaLegalActions(state, 'a').some(action => action.type === 'hu'));
  const wrong = zone(state, 'hand:a').find(id => !state.players[0]!.declaredWaits!.includes(face(state, id)));
  assert.ok(wrong); state.source.cardId = wrong;
  assert.equal(abaLegalActions(state, 'a').some(action => action.type === 'hu'), false);
  assert.throws(() => applyAbaAction(state, 'a', { type: 'hu', decisionId: `ab:1:${state.serial}` }), /offered/);
});

test('declared external white hu requires a legal structure and an actual white source', () => {
  const state = externalWhiteWaiting();
  assert.deepEqual([...state.players[0]!.declaredWaits!].sort((left, right) => left - right),
    [106, 206, 306, 406]);
  const white = zone(state, 'deck').find(id => face(state, id) === 1003);
  assert.ok(white);
  state.cards = moveCards(state.cards, 'deck', 'white:a', [white]);
  state.phase = 'response';
  state.activeId = 'a';
  state.source = { kind: 'white', userId: 'a', cardId: white };
  state.replenish = { userId: 'a', resume: 'discard', whites: [], last: null };
  state.claims = openClaims('ab:1:' + state.serial, ['a', 'b'], [{
    id: 'white-hu', userId: 'a', action: { type: 'hu' }, priority: 100, simultaneous: true,
  }]);
  assertAbaRound(state);
  const whiteChoice = abaLegalActions(state, 'a').find(action =>
    action.type === 'respond' && action.choiceId === 'white-hu');
  assert.ok(whiteChoice);
  const ended = applyAbaAction(state, 'a', whiteChoice).snapshot as AbaRound;
  assert.equal(ended.phase, 'finished');
  assert.deepEqual(zone(ended, 'won'), [white]);
  const whiteWin = ended.outcome!.winners[0]!.win;
  assert.equal(whiteWin.structureScore, 510);
  assert.ok(whiteWin.wildcardUses.some(use => use.cardId === white));

  const wrongSource = structuredClone(state);
  const wrongCard = zone(wrongSource, 'deck').find(id => face(wrongSource, id) !== 1003 &&
    !wrongSource.players[0]!.declaredWaits!.includes(face(wrongSource, id)));
  assert.ok(wrongCard);
  wrongSource.cards = moveCards(wrongSource.cards, 'deck', 'table', [wrongCard]);
  wrongSource.replenish = null;
  wrongSource.source = { kind: 'flip', userId: 'a', cardId: wrongCard };
  wrongSource.claims = openClaims('ab:1:' + wrongSource.serial, ['a', 'b'], [{
    id: 'wrong-source', userId: 'a', action: { type: 'hu' }, priority: 100, simultaneous: true,
  }]);
  assertAbaRound(wrongSource);
  const wrongChoice = abaLegalActions(wrongSource, 'a').find(action =>
    action.type === 'respond' && action.choiceId === 'wrong-source');
  assert.ok(wrongChoice);
  assert.throws(() => applyAbaAction(wrongSource, 'a', wrongChoice), /cannot win/);

  const broken = structuredClone(state);
  const replaced = zone(broken, 'hand:a').find(id => face(broken, id) === 110);
  const replacement = zone(broken, 'deck').find(id => face(broken, id) === 201);
  assert.ok(replaced && replacement);
  broken.cards = moveCards(broken.cards, 'hand:a', 'deck', [replaced]);
  broken.cards = moveCards(broken.cards, 'deck', 'hand:a', [replacement]);
  broken.claims = openClaims('ab:1:' + broken.serial, ['a', 'b'], [{
    id: 'broken-structure', userId: 'a', action: { type: 'hu' }, priority: 100, simultaneous: true,
  }]);
  assertAbaRound(broken);
  const brokenChoice = abaLegalActions(broken, 'a').find(action =>
    action.type === 'respond' && action.choiceId === 'broken-structure');
  assert.ok(brokenChoice);
  assert.throws(() => applyAbaAction(broken, 'a', brokenChoice), /cannot win/);
});

test('declared own melds are blocked, including client-supplied gang and ba', () => {
  const state = fixture([107, 207, 307, 407, 201, 212, 206, 208]);
  assert.ok(abaLegalActions(state, 'a').some(action => action.type === 'gang'));
  state.players[0]!.declaredWaits = [208];
  state.players[0]!.declaredBonusIds = [];
  assert.equal(abaLegalActions(state, 'a').some(action => ['chi', 'peng', 'tou', 'gang', 'ba'].includes(action.type)), false);
  for (const action of [{ type: 'gang', cardIds: zone(state, 'hand:a').slice(0, 4) }, { type: 'ba', cardId: zone(state, 'hand:a')[0], meldIndex: 0 }]) {
    assert.throws(() => applyAbaAction(state, 'a', { ...action, decisionId: `ab:1:${state.serial}` }), /offered/);
  }
});

test('execution rejects forged response melds and wrong-source hu even when offered', () => {
  for (const type of ['chi', 'peng', 'tou', 'gang', 'ba', 'hu'] as const) {
    const state = waiting();
    for (const cardId of [...zone(state, 'table')]) state.cards = moveCards(state.cards, 'table', 'discards', [cardId]);
    const incoming = zone(state, 'deck').find(id => !state.players[0]!.declaredWaits!.includes(face(state, id)) && face(state, id) < 1000)!;
    state.cards = moveCards(state.cards, 'deck', 'table', [incoming]);
    state.phase = 'response'; state.activeId = 'b';
    state.source = { kind: 'flip', userId: 'b', cardId: incoming };
    const decisionId = `ab:1:${state.serial}`;
    const action = type === 'hu' ? { type } : type === 'ba'
      ? { type, cardId: zone(state, 'hand:a')[0], meldIndex: 0 }
      : { type, cardIds: [zone(state, 'hand:a')[0], incoming] };
    state.claims = openClaims(decisionId, ['a', 'b'], [{ id: 'forged', userId: 'a', action, priority: 100, simultaneous: type === 'hu' }]);
    const response = abaLegalActions(state, 'a').find(action => action.type === 'respond' && action.choiceId === 'forged');
    assert.ok(response);
    assert.throws(() => applyAbaAction(state, 'a', response), type === 'hu' ? /cannot win/ : /cannot meld/);
    assert.equal(state.outcome, null);
  }
});

test('declared bonus snapshot ignores later reward-zone additions', () => {
  const state = waiting();
  for (const cardId of [...zone(state, 'table')]) state.cards = moveCards(state.cards, 'table', 'discards', [cardId]);
  state.phase = 'discard'; state.activeId = 'a'; state.claims = null; state.source = null;
  const before = abaLegalActions(state, 'a').filter(action => action.type === 'discard');
  const lockedCode = state.players[0]!.declaredWaits!.find(code =>
    zone(state, 'deck').some(cardId => face(state, cardId) === code));
  assert.ok(lockedCode);
  const addedBonus = zone(state, 'deck').find(cardId => face(state, cardId) === lockedCode)!;
  state.cards = moveCards(state.cards, 'deck', 'bonus:a', [addedBonus]);
  const after = abaLegalActions(state, 'a').filter(action => action.type === 'discard');
  assert.deepEqual(after, before);
});

test('declared bonus snapshot rejects forged and mismatched declarations', () => {
  const forged = waiting();
  forged.players[0]!.declaredBonusIds = ['missing-card'];
  assert.throws(() => assertAbaRound(forged), { code: 'INVALID_ABA_STATE' });

  const mismatched = waiting();
  mismatched.players[0]!.declaredWaits = null;
  mismatched.players[0]!.declaredBonusIds = [];
  assert.throws(() => assertAbaRound(mismatched), { code: 'INVALID_ABA_STATE' });

  const empty = waiting();
  empty.players[0]!.declaredWaits = [];
  assert.throws(() => assertAbaRound(empty), { code: 'INVALID_ABA_STATE' });

  const duplicate = waiting();
  duplicate.players[0]!.declaredWaits = [208, 208];
  assert.throws(() => assertAbaRound(duplicate), { code: 'INVALID_ABA_STATE' });

  const invalid = waiting();
  invalid.players[0]!.declaredWaits = [0];
  assert.throws(() => assertAbaRound(invalid), { code: 'INVALID_ABA_STATE' });
});
