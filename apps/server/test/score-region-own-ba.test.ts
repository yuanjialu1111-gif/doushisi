import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultOptions, SCORE_REGION_VERSIONS } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { createScoreRegionCardState } from '../src/game/score-region-pack.js';
import {
  applyScoreRegionAction, assertScoreRegionRound, createScoreRegionRound, scoreRegionLegalActions,
  viewScoreRegionRound, type ScoreRegionAction, type ScoreRegionRound,
} from '../src/game/score-region-round.js';

const PLAYERS = [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }] as const;

function rules(ownBaKeQiang: 0 | 1) {
  return { ...getDefaultOptions('24:0'), playerNum: 2, gameNum: 4, baseBeans: '0.1', wangNum: 0,
    ownBaKeQiang, tianHu: 0, quanHongHei: 0,
    scoreRegion: { rulesVersion: SCORE_REGION_VERSIONS['24:0'] } };
}

function input(ownBaKeQiang: 0 | 1): RoundInput {
  return { players: [...PLAYERS], ownerUserId: 'a', number: 1, rules: rules(ownBaKeQiang),
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}

interface Fixture {
  state: ScoreRegionRound;
  meldCards: readonly string[];
  ownBaCard: string;
  replacement: string;
  deckLength: number;
}

function fixture(kind: 'peng' | 'tou', ownBaKeQiang: 0 | 1,
  phase: 'discard' | 'draw', canRob: boolean): Fixture {
  const roundRules = rules(ownBaKeQiang);
  const pack = createScoreRegionCardState('24:0', roundRules, 'deck', [
    { id: 'deck', visibility: 'hidden' },
  ]).pack;
  const state = createScoreRegionRound(input(ownBaKeQiang), pack.map(card => card.id), '24:0');
  const assigned = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(item => item.code === code && !assigned.has(item.id));
    assert.ok(card, `The fixture needs another ${code}`);
    assigned.add(card.id);
    return card.id;
  };
  const meldCards = kind === 'peng' ? [104, 304, 404].map(pick) : [205, 305, 405].map(pick);
  const ownBaCode = kind === 'peng' ? 204 : 105;
  const ownBaCard = pick(ownBaCode);
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
  state.players[0]!.melds = [{ kind, cardIds: [...meldCards] as string[] }];
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
  return { state, meldCards, ownBaCard, replacement, deckLength: rest.length + 1 };
}

function baAction(state: ScoreRegionRound, cardId: string, meldIndex = 0): ScoreRegionAction {
  const action = scoreRegionLegalActions(state, 'a').find(candidate => candidate.type === 'ba' &&
    candidate.cardId === cardId && candidate.meldIndex === meldIndex);
  assert.ok(action, 'The concealed ba must be offered by the public action list');
  return action;
}

function responseAction(state: ScoreRegionRound, type: 'hu' | null): ScoreRegionAction {
  const action = scoreRegionLegalActions(state, 'b').find(candidate => {
    if (candidate.type !== 'respond') return false;
    if (type === null) return candidate.choiceId === null;
    const offer = state.claims!.offers.find(item => item.id === candidate.choiceId && item.userId === 'b');
    return offer !== undefined && (offer.action as { type?: string }).type === type;
  });
  assert.ok(action, `Player b must be offered ${type ?? 'pass'}`);
  return action;
}

function cardsIn(state: ScoreRegionRound, zoneId: string): string[] {
  return state.cards.zones.find(zone => zone.id === zoneId)!.cards;
}

function resolveOwnBa(state: ScoreRegionRound, action: ScoreRegionAction): ScoreRegionRound {
  let current = applyScoreRegionAction(state, 'a', action).snapshot as ScoreRegionRound;
  if (current.phase === 'response' && current.source?.ownBa === true &&
    (current.claims!.offers.length || current.claims!.passOnlyUserIds?.length)) {
    current = applyScoreRegionAction(current, 'b', responseAction(current, null)).snapshot as ScoreRegionRound;
  }
  while (current.phase === 'response') {
    const userId = current.players.map(player => player.userId)
      .find(id => scoreRegionLegalActions(current, id).length);
    assert.ok(userId, 'A response window must leave one player a choice');
    current = applyScoreRegionAction(current, userId, responseAction(current, null)).snapshot as ScoreRegionRound;
  }
  return current;
}

for (const kind of ['peng', 'tou'] as const) {
  test(`24:0 ownBaKeQiang opens a hu-only window after a concealed ${kind} ba`, () => {
    const { state, ownBaCard } = fixture(kind, 1, 'discard', true);
    const result = applyScoreRegionAction(state, 'a', baAction(state, ownBaCard));
    const after = result.snapshot as ScoreRegionRound;
    assert.equal(after.phase, 'response');
    assert.deepEqual(after.source, { kind: 'discard', userId: 'a', cardId: ownBaCard, ownBa: true });
    assert.deepEqual(after.responseResume,
      { kind: 'own-ba', userId: 'a', cardId: ownBaCard, meldIndex: 0, phase: 'discard' });
    assert.deepEqual(cardsIn(after, 'table'), [ownBaCard]);
    assert.deepEqual(after.claims!.offers.map(offer => ({ userId: offer.userId,
      type: (offer.action as { type?: string }).type })), [{ userId: 'b', type: 'hu' }]);
    assert.deepEqual(after.claims!.offers.map(offer => offer.priority), [100]);
    assert.equal(cardsIn(after, 'melds:a').length, 3);
    assert.deepEqual(after.players[0]!.melds[0]!.kind, kind);
    assert.ok(result.events.some(event => event.type === 'response-opened'));
  });

  test(`24:0 a robbed concealed ${kind} ba consumes the target once and leaves the old meld intact`, () => {
    const { state, ownBaCard, deckLength } = fixture(kind, 1, 'discard', true);
    const opened = applyScoreRegionAction(state, 'a', baAction(state, ownBaCard)).snapshot as ScoreRegionRound;
    const result = applyScoreRegionAction(opened, 'b', responseAction(opened, 'hu'));
    const after = result.snapshot as ScoreRegionRound;
    assert.equal(after.phase, 'finished');
    assert.equal(cardsIn(after, 'table').length, 0);
    assert.equal(cardsIn(after, 'discards').filter(cardId => cardId === ownBaCard).length, 1);
    assert.equal(cardsIn(after, 'melds:a').includes(ownBaCard), false);
    assert.equal(after.players[0]!.melds[0]!.kind, kind);
    assert.equal(after.players[0]!.melds[0]!.cardIds.length, 3);
    assert.equal(cardsIn(after, 'deck').length, deckLength);
    assert.equal(result.events.some(event => event.type === 'meld' || event.type === 'replacement'), false);
    assert.equal(result.events.filter(event => event.type === 'round-ended').length, 1);
    assert.equal(result.confirmedScores?.length, 1);
    assert.equal(after.confirmedScores, undefined);
    assert.equal(after.outcome?.winners.length, 1);
    assert.equal(after.outcome?.winners[0]!.userId, 'b');
  });

  for (const phase of ['discard', 'draw'] as const) {
    test(`24:0 a clean concealed ${kind} ba resumes ${phase} and replaces once`, () => {
      const { state, ownBaCard, replacement } = fixture(kind, 1, phase, true);
      const opened = applyScoreRegionAction(state, 'a', baAction(state, ownBaCard)).snapshot as ScoreRegionRound;
      assert.equal(opened.phase, 'response');
      assert.equal(opened.source?.ownBa, true);
      const after = resolveOwnBa(state, baAction(state, ownBaCard));
      assert.equal(after.phase, phase);
      assert.equal(after.activeId, 'a');
      assert.equal(after.players[0]!.melds[0]!.kind, 'ba');
      assert.equal(after.players[0]!.melds[0]!.cardIds.length, 4);
      assert.ok(after.players[0]!.melds[0]!.cardIds.includes(ownBaCard));
      assert.equal(cardsIn(after, 'table').length, 0);
      assert.equal(cardsIn(after, 'discards').length, 0);
      assert.equal(cardsIn(after, 'hand:a').includes(replacement), true);
      assert.equal(after.outcome, null);
      assert.equal(cardsIn(after, 'hand:b').length, 7);
    });
  }
}

test('24:0 ownBaKeQiang=0 upgrades immediately without a rob window', () => {
  const { state, ownBaCard } = fixture('peng', 0, 'discard', true);
  const action = baAction(state, ownBaCard);
  const result = applyScoreRegionAction(state, 'a', action);
  const after = result.snapshot as ScoreRegionRound;
  assert.notEqual(after.source?.ownBa, true);
  assert.notEqual(after.responseResume?.kind, 'own-ba');
  assert.equal(result.events.some(event => event.type === 'response-opened' && after.source?.ownBa === true), false);
  assert.equal(after.players[0]!.melds[0]!.kind, 'ba');
  assert.equal(after.players[0]!.melds[0]!.cardIds.length, 4);
});

test('24:0 an empty concealed ba window resumes the original phase and submits the meld', () => {
  const { state, ownBaCard, replacement } = fixture('tou', 1, 'draw', false);
  const result = applyScoreRegionAction(state, 'a', baAction(state, ownBaCard));
  const after = result.snapshot as ScoreRegionRound;
  assert.equal(result.events.some(event => event.type === 'response-opened'), false);
  assert.equal(after.phase, 'draw');
  assert.equal(after.players[0]!.melds[0]!.kind, 'ba');
  assert.equal(after.players[0]!.melds[0]!.cardIds.length, 4);
  assert.ok(after.players[0]!.melds[0]!.cardIds.includes(ownBaCard));
  assert.ok(cardsIn(after, 'hand:a').includes(replacement));
  assert.equal(cardsIn(after, 'table').length, 0);
});

test('24:0 stale concealed-ba responses cannot be replayed after the window closes', () => {
  const { state, ownBaCard } = fixture('peng', 1, 'discard', true);
  const opened = applyScoreRegionAction(state, 'a', baAction(state, ownBaCard)).snapshot as ScoreRegionRound;
  const stale = responseAction(opened, 'hu');
  const finished = applyScoreRegionAction(opened, 'b', stale).snapshot as ScoreRegionRound;
  assert.throws(() => applyScoreRegionAction(finished, 'b', stale), { code: 'STALE_CLAIM_WINDOW' });
});

test('24:0 duplicate concealed-ba responses are idempotent and settle once', () => {
  const { state, ownBaCard } = fixture('peng', 1, 'discard', true);
  const opened = applyScoreRegionAction(state, 'a', baAction(state, ownBaCard)).snapshot as ScoreRegionRound;
  const hu = responseAction(opened, 'hu');
  const first = applyScoreRegionAction(opened, 'b', hu);
  const second = applyScoreRegionAction(opened, 'b', hu);
  assert.deepEqual(first.snapshot, second.snapshot);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.settlement, second.settlement);
  assert.deepEqual(first.confirmedScores, second.confirmedScores);
  assert.equal((first.events as { type: string }[]).filter(event => event.type === 'round-ended').length, 1);
  assert.deepEqual(first.settlement, [{ userId: 'a', amount: '-0.1' }, { userId: 'b', amount: '0.1' }]);
});

test('24:0 a reconnected concealed-ba snapshot preserves legal actions and private views', () => {
  const { state, ownBaCard } = fixture('tou', 1, 'draw', true);
  const opened = applyScoreRegionAction(state, 'a', baAction(state, ownBaCard)).snapshot as ScoreRegionRound;
  const restored = structuredClone(opened);
  assertScoreRegionRound(restored);
  assert.deepEqual(scoreRegionLegalActions(restored, 'b'), scoreRegionLegalActions(opened, 'b'));
  assert.deepEqual(viewScoreRegionRound(restored, 'b'), viewScoreRegionRound(opened, 'b'));
});

test('24:0 concealed-ba replay is deterministic from the frozen snapshot', () => {
  const opened = fixture('peng', 1, 'discard', true);
  const first = applyScoreRegionAction(opened.state, 'a', baAction(opened.state, opened.ownBaCard));
  const second = applyScoreRegionAction(opened.state, 'a', baAction(opened.state, opened.ownBaCard));
  assert.deepEqual(second, first);
  const firstReply = applyScoreRegionAction(first.snapshot as ScoreRegionRound, 'b',
    responseAction(first.snapshot as ScoreRegionRound, 'hu'));
  const secondReply = applyScoreRegionAction(second.snapshot as ScoreRegionRound, 'b',
    responseAction(second.snapshot as ScoreRegionRound, 'hu'));
  assert.deepEqual(secondReply, firstReply);
  assert.deepEqual(secondReply.snapshot, firstReply.snapshot);
  assert.deepEqual(secondReply.events, firstReply.events);
  assert.deepEqual(secondReply.settlement, firstReply.settlement);
  assert.deepEqual(secondReply.nextRoundContext, firstReply.nextRoundContext);
});
