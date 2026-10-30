import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultOptions, PUJIANG_INDEPENDENT_VERSION } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { declaredWaitMatches, sameDeclaredWaits } from '../src/game/declared-waits.js';
import { createPujiangCardState } from '../src/game/pujiang-pack.js';
import { applyPujiangAction, createPujiangRound, pujiangDeclarationFaces, pujiangLegalActions,
  assertPujiangRound, type PujiangAction, type PujiangRound } from '../src/game/pujiang-round.js';
import { moveCards } from '../src/game/cards.js';

const good = [110, 204, 309, 205, 101, 413, 206, 408];
const responder = [301, 302, 304, 107, 108, 109, 111];

function input(overrides: Record<string, unknown> = {}): RoundInput {
  const rules = { ...getDefaultOptions('7:0'), playerNum: 2, maxFan: 99, chengFan: 0,
    baseBeans: '0.125', ...overrides, pujiang: { rulesVersion: PUJIANG_INDEPENDENT_VERSION } };
  return { players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }], ownerUserId: 'a', number: 1,
    rules, policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}

function make(hands: number[][], tail: number[] = [], options: Record<string, unknown> = {}) {
  const roundInput = input(options), physical = createPujiangCardState('7:0', roundInput.rules, 'deck',
    [{ id: 'deck', visibility: 'hidden' }]).pack;
  const used = new Set<string>();
  const pick = (code: number) => {
    const card = physical.find(candidate => candidate.code === code && !used.has(candidate.id));
    assert.ok(card, `Fixture face unavailable: ${code}`);
    used.add(card.id);
    return card.id;
  };
  const deal = Array.from({ length: 7 }, (_, index) => hands.map(hand => hand[index]!)).flat();
  deal.push(hands[0]![7]!);
  const order = [...deal, ...tail].map(pick);
  order.push(...physical.filter(card => !used.has(card.id)).map(card => card.id));
  return createPujiangRound(roundInput, order);
}

const zone = (state: PujiangRound, name: string) => state.cards.zones.find(item => item.id === name)!.cards;
const face = (state: PujiangRound, cardId: string) => state.cards.pack.find(card => card.id === cardId)!.code;

function action(state: PujiangRound, id: string, type: PujiangAction['type'], faceCode?: number) {
  const found = pujiangLegalActions(state, id).find(candidate => candidate.type === type &&
    (faceCode === undefined || 'cardId' in candidate && face(state, candidate.cardId) === faceCode ||
      'cardIds' in candidate && candidate.cardIds.some(cardId => face(state, cardId) === faceCode)));
  assert.ok(found, `Missing ${id} ${type} ${faceCode ?? ''} in ${state.phase}`);
  return found;
}

function apply(state: PujiangRound, id: string, selected: PujiangAction): PujiangRound {
  const before = structuredClone(state);
  const result = applyPujiangAction(state, id, selected);
  assert.deepEqual(state, before, 'apply must not mutate an archived snapshot');
  return result.snapshot as PujiangRound;
}

function run(state: PujiangRound, id: string, type: PujiangAction['type'], faceCode?: number) {
  return apply(state, id, action(state, id, type, faceCode));
}

function reply(state: PujiangRound, id: string, type: string | null) {
  const choiceId = type === null ? null : state.claims!.offers.find(offer =>
    offer.userId === id && (offer.action as { type: string }).type === type)?.id;
  assert.notEqual(choiceId, undefined, `Missing ${id} response ${type}`);
  return apply(state, id, { type: 'respond', decisionId: state.claims!.id, choiceId: choiceId! });
}

function allPass(state: PujiangRound) {
  while (state.phase === 'response') {
    const next = state.players.find(player => pujiangLegalActions(state, player.userId).length);
    assert.ok(next);
    state = reply(state, next.userId, null);
  }
  return state;
}

function declaredState(options: Record<string, unknown> = {}) {
  let state = make([[...good.slice(0, 7), 112], responder], [212, 1001, 303], options);
  state = run(state, 'a', 'begin');
  state = run(state, 'a', 'declare', 112);
  assert.deepEqual(state.players[0]!.declaredWaits, [208, 408]);
  state = allPass(state);
  state = run(state, 'b', 'draw');
  state = allPass(state);
  state = run(state, 'a', 'draw');
  return state;
}

function declaredResponseState() {
  const state = run(declaredState(), 'a', 'discard', 303);
  assert.equal(state.phase, 'response');
  assert.equal(face(state, zone(state, 'table')[0]!), 303);
  return state;
}

function bypassResponse(state: PujiangRound, action: unknown) {
  const bypass = structuredClone(state);
  bypass.claims = { id: bypass.claims!.id, tieOrder: ['b', 'a'], replies: [], offers: [
    { id: 'bypass', userId: 'a', action, priority: 100, simultaneous: (action as { type: string }).type === 'hu' },
  ] };
  return bypass;
}

test('declared waits compare as an order-independent set and distinguish null from empty', () => {
  assert.equal(sameDeclaredWaits([408, 208], [208, 408]), true);
  assert.equal(sameDeclaredWaits(null, []), false);
  assert.equal(sameDeclaredWaits([], null), false);
  assert.equal(sameDeclaredWaits([], []), true);
  assert.equal(declaredWaitMatches([], 208), false);
  assert.equal(declaredWaitMatches(null, 208), false);
});

test('Pujiang declared locking accepts an unchanged discard and rejects changed waits', () => {
  const state = declaredState();
  assert.deepEqual(state.players[0]!.declaredWaits, [208, 408]);
  assert.deepEqual(pujiangLegalActions(state, 'a').filter(candidate => candidate.type === 'discard')
    .map(candidate => 'cardId' in candidate ? face(state, candidate.cardId) : null), [303]);
  assert.equal(pujiangLegalActions(state, 'a').some(candidate => candidate.type === 'declare'), false);
  assert.throws(() => applyPujiangAction(state, 'a',
    { type: 'declare', cardId: zone(state, 'hand:a')[0]!, decisionId: state.claims?.id ??
      `pj:${state.number}:${state.serial}` }), { code: 'INVALID_ACTION' });

  const unchanged = action(state, 'a', 'discard', 303);
  const changed = structuredClone(state);
  changed.players = changed.players.map(player => player.userId === 'a'
    ? { ...player, declaredWaits: [408] } : player);
  assert.throws(() => applyPujiangAction(changed, 'a', unchanged), { code: 'INVALID_ACTION' });

  const accepted = apply(state, 'a', unchanged);
  assert.equal(accepted.phase, 'response');
  assert.equal(face(accepted, zone(accepted, 'table')[0]!), 303);
});

test('Pujiang declared waits block response melds and wrong-source wins at execution', () => {
  const state = declaredResponseState();
  const declared = state.players[0]!;
  assert.deepEqual(declared.declaredWaits, [208, 408]);
  assert.deepEqual(pujiangLegalActions(state, 'a'), []);

  const tableId = zone(state, 'table')[0]!;
  const handId = zone(state, 'hand:a')[0]!;
  const blocked: PujiangAction[] = [
    { type: 'hu', decisionId: state.claims!.id },
    { type: 'chi', cardIds: [tableId], decisionId: state.claims!.id },
    { type: 'peng', cardIds: [tableId], decisionId: state.claims!.id },
    { type: 'gang', cardIds: [tableId], decisionId: state.claims!.id },
    { type: 'ba', cardId: handId, meldIndex: 0, decisionId: state.claims!.id },
  ];
  for (const action of blocked) {
    const bypass = bypassResponse(state, action);
    assert.throws(() => applyPujiangAction(bypass, 'a',
      { type: 'respond', choiceId: 'bypass', decisionId: bypass.claims!.id }), { code: 'INVALID_ACTION' });
  }
});

test('Pujiang declared state never exposes own or response chi, peng, gang or ba', () => {
  const state = declaredState();
  assert.equal(pujiangLegalActions(state, 'a').some(candidate =>
    ['chi', 'peng', 'gang', 'tou', 'ba'].includes(candidate.type)), false);
  assert.deepEqual(pujiangDeclarationFaces(state, 'a', zone(state, 'hand:a')[0]!), null);
});

test('Pujiang declaration freezes its bonus snapshot when a later royal joins the bonus zone', () => {
  const state = declaredState();
  const frozen = [...state.players[0]!.declaredBonusIds!];
  const before = pujiangLegalActions(state, 'a').filter(candidate => candidate.type === 'discard');
  assert.deepEqual(before.map(candidate => 'cardId' in candidate ? face(state, candidate.cardId) : null), [303]);

  const royal = zone(state, 'deck').find(cardId => face(state, cardId) >= 1001)!;
  assert.ok(royal);
  state.cards = moveCards(state.cards, 'deck', 'bonus:a', [royal]);
  assert.deepEqual(state.players[0]!.declaredBonusIds, frozen);

  const after = pujiangLegalActions(state, 'a').filter(candidate => candidate.type === 'discard');
  assert.deepEqual(after.map(candidate => 'cardId' in candidate ? face(state, candidate.cardId) : null), [303]);
  const accepted = apply(state, 'a', action(state, 'a', 'discard', 303));
  assert.equal(accepted.phase, 'response');
  assert.deepEqual(accepted.players[0]!.declaredBonusIds, frozen);
});

test('Pujiang declared winning source remains bound to the frozen wait faces', () => {
  const sourceState = declaredResponseState();
  const incoming = zone(sourceState, 'deck').find(cardId => face(sourceState, cardId) === 208);
  const wrong = zone(sourceState, 'deck').find(cardId => face(sourceState, cardId) !== 208 && face(sourceState, cardId) < 1000);
  assert.ok(incoming && wrong);

  const valid = structuredClone(sourceState);
  const discarded = zone(valid, 'table')[0]!;
  valid.cards = moveCards(valid.cards, 'table', 'discards', [discarded]);
  valid.cards = moveCards(valid.cards, 'deck', 'table', [incoming]);
  valid.source = { kind: 'discard', userId: 'b', cardId: incoming };
  const accepted = apply(bypassResponse(valid, { type: 'hu' }), 'a',
    { type: 'respond', choiceId: 'bypass', decisionId: valid.claims!.id });
  assert.equal(accepted.outcome?.winners[0]?.userId, 'a');

  const rejected = structuredClone(sourceState);
  rejected.cards = moveCards(rejected.cards, 'table', 'discards', [discarded]);
  rejected.cards = moveCards(rejected.cards, 'deck', 'table', [wrong]);
  rejected.source = { kind: 'discard', userId: 'b', cardId: wrong };
  const bypass = bypassResponse(rejected, { type: 'hu' });
  assert.throws(() => applyPujiangAction(bypass, 'a',
    { type: 'respond', choiceId: 'bypass', decisionId: bypass.claims!.id }), { code: 'INVALID_ACTION' });
});

test('Pujiang chaJiao validates declared waits against the frozen bonus snapshot', () => {
  let state = declaredState({ chaJiao: 1 });
  state = run(state, 'a', 'discard', 303);
  state = allPass(state);
  const frozen = [...state.players[0]!.declaredBonusIds!];
  const addedBonus = zone(state, 'deck').find(cardId => face(state, cardId) === 1001);
  assert.ok(addedBonus);
  state.cards = moveCards(state.cards, 'deck', 'bonus:a', [addedBonus]);
  assert.deepEqual(state.players[0]!.declaredBonusIds, frozen);
  const remaining = [...zone(state, 'deck')];
  if (remaining.length) state.cards = moveCards(state.cards, 'deck', 'discards', remaining);
  state = run(state, 'b', 'draw');
  const outcome = state.outcome!;
  assert.equal(outcome.reason, 'draw');
  assert.deepEqual(outcome.winners.map(winner => winner.userId), ['a']);
});

test('Pujiang assertions reject unpaired, duplicate and missing bonus snapshots', () => {
  const state = declaredState();
  assert.doesNotThrow(() => assertPujiangRound(state));
  const unpaired = structuredClone(state);
  unpaired.players[0]!.declaredBonusIds = null;
  assert.throws(() => assertPujiangRound(unpaired), { code: 'INVALID_PUJIANG_STATE' });

  const inverseUnpaired = structuredClone(state);
  inverseUnpaired.players[0]!.declaredWaits = null;
  assert.throws(() => assertPujiangRound(inverseUnpaired), { code: 'INVALID_PUJIANG_STATE' });

  const bothNull = structuredClone(state);
  bothNull.players[0]!.declaredWaits = null;
  bothNull.players[0]!.declaredBonusIds = null;
  assert.doesNotThrow(() => assertPujiangRound(bothNull));

  const duplicate = structuredClone(state);
  const bonusId = duplicate.players[0]!.declaredBonusIds![0];
  if (bonusId === undefined) {
    duplicate.players[0]!.declaredBonusIds = ['missing-card', 'missing-card'];
  } else duplicate.players[0]!.declaredBonusIds = [bonusId, bonusId];
  assert.throws(() => assertPujiangRound(duplicate), { code: 'INVALID_PUJIANG_STATE' });

  const missing = structuredClone(state);
  missing.players[0]!.declaredBonusIds = ['missing-card'];
  assert.throws(() => assertPujiangRound(missing), { code: 'INVALID_PUJIANG_STATE' });
});
