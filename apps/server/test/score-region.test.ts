import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultOptions, SCORE_REGION_VERSIONS } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { moveCards } from '../src/game/cards.js';
import { scoreRegionPackSpecification, createScoreRegionCardState } from '../src/game/score-region-pack.js';
import {
  applyScoreRegionAction, assertScoreRegionRound, createScoreRegionRound, scoreRegionLegalActions,
  scoreRegionTimedAction, viewScoreRegionRound, type ScoreRegionAction, type ScoreRegionRound,
} from '../src/game/score-region-round.js';
import { isRongxianSmallSeat, regionalHandSize } from '../src/game/regional-profile.js';
import { scoreRegionDeclarationFaces } from '../src/game/score-region-round.js';
import { evaluateScoreRegionWin, type ScoreRegionHand, type ScoreRegionContext } from '../src/game/score-region-win.js';

function rules(variantKey: keyof typeof SCORE_REGION_VERSIONS, overrides: Record<string, unknown> = {}) {
  return { ...getDefaultOptions(variantKey), playerNum: 2, baseBeans: '0.1', ...overrides,
    scoreRegion: { rulesVersion: SCORE_REGION_VERSIONS[variantKey] } };
}
function hand(codes: number[], bonus: number[] = [], melds: ScoreRegionHand['melds'] = []): ScoreRegionHand {
  let id = 0;
  const cards = (values: number[], prefix: string) => values.map(code => ({ id: `${prefix}-${++id}`, code }));
  return { concealed: cards(codes, 'hand'), melds: melds.map(meld => ({ kind: meld.kind,
    cards: cards(meld.cards.map(card => card.code), 'meld') })), bonus: cards(bonus, 'bonus') };
}
function context(overrides: Partial<ScoreRegionContext> = {}): ScoreRegionContext {
  return { winnerSeat: 1, dealerSeat: 1, source: 'flip', sourceSeat: 1, incomingCardId: null,
    discardCount: 0, ...overrides };
}
const incoming = (state: ScoreRegionHand) => state.concealed[0]!.id;

test('score-region pack is 52 ordinary cards plus one of each special face', () => {
  const pack = scoreRegionPackSpecification();
  assert.equal(pack.reduce((sum, entry) => sum + entry.count, 0), 55);
  assert.equal(pack.find(entry => entry.code === 1003)!.count, 1);
  for (const key of ['14:0', '15:0', '16:0', '19:0'] as const) {
    const state = createScoreRegionCardState(key, rules(key), 'deck', [{ id: 'deck', visibility: 'hidden' }]);
    assert.equal(state.pack.length, 55);
  }
});

test('Wenchuan and Maoxian apply their scoring formulas and package switches', () => {
  const scoreHand = hand([110, 204, 309, 205, 201, 213], [1001, 1002],
    [{ kind: 'peng', cards: [{ id: 'm1', code: 102 }, { id: 'm2', code: 202 }, { id: 'm3', code: 302 }] }]);
  const wenchuan = evaluateScoreRegionWin(scoreHand, context({ incomingCardId: incoming(scoreHand), baoJiao: true }),
    rules('14:0', { jiaFan_258: 1, baoJiao: 1, siGuiYi: 1 }), '14:0');
  assert.equal(wenchuan.status, 'winning');
  if (wenchuan.status === 'winning') {
    assert.ok(wenchuan.items.some(item => item.pattern === 'baoJiao'));
    assert.ok(wenchuan.items.some(item => item.pattern === 'jiaFan258Peng'));
  }
  const maoxian = evaluateScoreRegionWin(hand([110, 204, 309, 205, 201, 213], [1001, 1002],
    [{ kind: 'peng', cards: [{ id: 'm1', code: 102 }, { id: 'm2', code: 202 }, { id: 'm3', code: 302 }] }]),
    context({ incomingCardId: incoming(scoreHand), baoJiao: true }),
    rules('15:0', { baoJiao: 1 }), '15:0');
  assert.equal(maoxian.status, 'winning');
  if (maoxian.status === 'winning') assert.ok(maoxian.structureScore >= 350);
});

test('Suining and Tongjiang keep their own thresholds and formulas', () => {
  const state = hand([105, 209, 305, 109, 201, 213], [1001, 1002],
    [{ kind: 'peng', cards: [{ id: 'm1', code: 102 }, { id: 'm2', code: 202 }, { id: 'm3', code: 302 }] }]);
  assert.equal(evaluateScoreRegionWin(state, context({ incomingCardId: incoming(state) }),
    rules('16:0', { huRedScore: 500 }), '16:0').status, 'not-winning');
  const tongjiang = evaluateScoreRegionWin(state, context({ incomingCardId: incoming(state), baoJiao: true }),
    rules('19:0', { huRedScore: 300, baoJiao: 1, tianHu: 1 }), '19:0');
  assert.equal(tongjiang.status, 'winning');
  if (tongjiang.status === 'winning') assert.ok(tongjiang.items.some(item => item.pattern === 'baoJiao'));
});

test('the 1000-point switch is evaluated before formula scaling and only once', () => {
  const state = hand([107, 207], [1001, 1002, 1003], [
    { kind: 'ba', cards: [{ id: 'm1', code: 110 }, { id: 'm2', code: 210 }, { id: 'm3', code: 310 }, { id: 'm4', code: 410 }] },
    { kind: 'ba', cards: [{ id: 'm5', code: 109 }, { id: 'm6', code: 209 }, { id: 'm7', code: 309 }, { id: 'm8', code: 409 }] },
    { kind: 'ba', cards: [{ id: 'm9', code: 108 }, { id: 'm10', code: 208 }, { id: 'm11', code: 308 }, { id: 'm12', code: 408 }] },
  ]);
  const result = evaluateScoreRegionWin(state, context({ incomingCardId: incoming(state) }),
    rules('14:0', { qianfenJiafan: 1 }), '14:0');
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') {
    assert.ok(result.structureScore >= 1000);
    assert.equal(result.items.filter(item => item.pattern === 'qianfenJiafan').length, 1);
  }
});

test('score-region rejection distinguishes shape, threshold and foreign versions', () => {
  const state = hand([110, 204, 309, 205, 201, 213], [1001],
    [{ kind: 'peng', cards: [{ id: 'm1', code: 102 }, { id: 'm2', code: 202 }, { id: 'm3', code: 302 }] }]);
  assert.equal(evaluateScoreRegionWin(state, context({ incomingCardId: incoming(state) }),
    rules('16:0', { huRedScore: 400 }), '16:0').reason, 'red-score');
  const duplicate = hand([110, 204, 309, 205, 201, 213], [1003]);
  duplicate.concealed[1]!.id = duplicate.concealed[0]!.id;
  assert.throws(() => evaluateScoreRegionWin(duplicate, context({ incomingCardId: duplicate.concealed[0]!.id }),
    rules('16:0'), '16:0'), { code: 'INVALID_SCORE_REGION_HAND' });
});

test('score-region pair scoring excludes automatic reward faces instead of treating them as ordinary cards', () => {
  // Four natural pairs plus a reward face is the shape that previously reached the pair scorer with
  // code 1001/1002/1003 and raised NON_ORDINARY_CARD. The reward face is still counted once through
  // the bonus zone, while the pair score is derived only from the four natural pairs.
  const state = hand([110, 210, 105, 305, 103, 203, 102, 202], [1001]);
  const result = evaluateScoreRegionWin(state, context({ incomingCardId: incoming(state) }),
    rules('16:0', { huRedScore: 300 }), '16:0');
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') {
    assert.equal(result.structure, 'four-pairs');
    assert.equal(result.structureScore, 350);
    assert.equal(result.redPoints, 25);
  }
});

test('score-region formulas keep exact ratios, base rules and additive over-cap points', () => {
  const tongjiang = evaluateScoreRegionWin(hand([110, 204, 309, 205, 201, 213], [1001, 1002],
    [{ kind: 'peng', cards: [{ id: 'm1', code: 102 }, { id: 'm2', code: 202 }, { id: 'm3', code: 302 }] }]),
    context({ incomingCardId: 'hand-1' }), rules('19:0', { huRedScore: 300 }), '19:0');
  assert.equal(tongjiang.status, 'winning');
  if (tongjiang.status === 'winning') {
    assert.equal(tongjiang.scoreRatio.applyBase, true);
    assert.equal(Number(tongjiang.scoreRatio.numerator) / Number(tongjiang.scoreRatio.denominator), 8.6);
    assert.deepEqual(tongjiang.scoreRatio, { numerator: '860', denominator: '100', applyBase: true, additiveUnits: '0' });
  }
  const suining = evaluateScoreRegionWin(hand([110, 204, 309, 205, 201, 213], [1001, 1002],
    [{ kind: 'peng', cards: [{ id: 'm1', code: 102 }, { id: 'm2', code: 202 }, { id: 'm3', code: 302 }] }]),
    context({ incomingCardId: 'hand-1' }), rules('16:0', { huRedScore: 300 }), '16:0');
  assert.equal(suining.status, 'winning');
  if (suining.status === 'winning') assert.equal(suining.scoreRatio.applyBase, false);
});

test('Ganluo settles additive over-cap beans once, not in internal bean units', () => {
  // Hand: gang of 10s, peng of 9s, peng of 8s, and concealed 9+5.
  // Red points are 54 and black points are 51, so the six Ganluo points are
  // red50 (3) + black50 (3). With b=0.1, cap=4 and a=1 the hand pays
  // 0.1*2^4 + 1*(6-4) = 3.6 beans.
  const ganluoRules = rules('26:0', {
    playerNum: 2, baseBeans: '0.1', maxFan: 4, chaoFanJiaDi: 1,
    hongHei_50: 1, baoJiao: 0, qia20: 0, gangHua: 0, siGuiYi: 0,
  });
  const input: RoundInput = {
    players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules: ganluoRules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
  const pack = createScoreRegionCardState('26:0', ganluoRules, 'deck', [
    { id: 'deck', visibility: 'hidden' },
  ]).pack;
  const state = createScoreRegionRound(input, pack.map(card => card.id), '26:0');
  const assigned = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(item => item.code === code && !assigned.has(item.id));
    assert.ok(card, `Fixture requests an unavailable face ${code}`);
    assigned.add(card.id);
    return card.id;
  };
  const gang = [110, 210, 310, 410].map(pick);
  const pengNines = [109, 209, 309].map(pick);
  const pengEights = [108, 208, 308].map(pick);
  const concealed = [409, 405].map(pick);
  const opponentHand = pack.filter(card => !assigned.has(card.id)).slice(0, 7).map(card => {
    assigned.add(card.id);
    return card.id;
  });
  state.players[0]!.melds = [
    { kind: 'gang', cardIds: gang },
    { kind: 'peng', cardIds: pengNines },
    { kind: 'peng', cardIds: pengEights },
  ];
  state.activeId = 'a';
  state.phase = 'discard';
  state.source = { kind: 'replacement', userId: 'a', cardId: concealed[0]! };
  state.claims = null;
  state.cards.zones = [
    { id: 'deck', visibility: 'hidden', cards: pack.filter(card => !assigned.has(card.id)).map(card => card.id) },
    { id: 'table', visibility: 'public', cards: [] },
    { id: 'discards', visibility: 'public', cards: [] },
    { id: 'hand:a', visibility: 'private', ownerId: 'a', cards: concealed },
    { id: 'melds:a', visibility: 'public', ownerId: 'a', cards: [...gang, ...pengNines, ...pengEights] },
    { id: 'bonus:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'hand:b', visibility: 'private', ownerId: 'b', cards: opponentHand },
    { id: 'melds:b', visibility: 'public', ownerId: 'b', cards: [] },
    { id: 'bonus:b', visibility: 'public', ownerId: 'b', cards: [] },
  ];
  const hu = scoreRegionLegalActions(state, 'a').find(action => action.type === 'hu');
  assert.ok(hu);
  const result = applyScoreRegionAction(state, 'a', hu);
  const outcome = (result.snapshot as ScoreRegionRound).outcome!;
  assert.equal(outcome.winners[0]!.win.totalFan, 6);
  assert.deepEqual(result.settlement, [
    { userId: 'a', amount: '3.6' },
    { userId: 'b', amount: '-3.6' },
  ]);
});

test('Ganluo preserves afterGang from a ba replacement through the response win', () => {
  const roundRules = rules('26:0', {
    playerNum: 2, baseBeans: '0.1', gangPao: 1, gangHua: 0, anDui: 0, siGuiYi: 0,
  });
  const input: RoundInput = {
    players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules: roundRules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
  const pack = createScoreRegionCardState('26:0', roundRules, 'deck', [
    { id: 'deck', visibility: 'hidden' },
  ]).pack;
  const state = createScoreRegionRound(input, pack.map(card => card.id), '26:0');
  const assigned = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(item => item.code === code && !assigned.has(item.id));
    assert.ok(card, `Fixture requests an unavailable face ${code}`);
    assigned.add(card.id);
    return card.id;
  };
  const peng = [106, 206, 306].map(pick);
  const aHand = [406, 109, 101, 113, 102, 103].map(pick);
  const bHand = [110, 309, 205, 201, 213, 207, 307].map(pick);
  const replacement = pick(104);
  const deck = pack.filter(card => !assigned.has(card.id)).map(card => card.id);
  state.players[0]!.melds = [{ kind: 'peng', cardIds: peng }];
  state.activeId = 'a';
  state.phase = 'discard';
  state.source = { kind: 'replacement', userId: 'a', cardId: aHand[0]! };
  state.claims = null;
  state.cards.zones = [
    { id: 'deck', visibility: 'hidden', cards: [replacement, ...deck.filter(cardId => cardId !== replacement)] },
    { id: 'table', visibility: 'public', cards: [] },
    { id: 'discards', visibility: 'public', cards: [] },
    { id: 'hand:a', visibility: 'private', ownerId: 'a', cards: aHand },
    { id: 'melds:a', visibility: 'public', ownerId: 'a', cards: [...peng] },
    { id: 'bonus:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'hand:b', visibility: 'private', ownerId: 'b', cards: bHand },
    { id: 'melds:b', visibility: 'public', ownerId: 'b', cards: [] },
    { id: 'bonus:b', visibility: 'public', ownerId: 'b', cards: [] },
  ];
  assertScoreRegionRound(state);

  const ba = scoreRegionLegalActions(state, 'a').find(action => action.type === 'ba' && action.cardId === aHand[0]!);
  assert.ok(ba);
  const afterBa = applyScoreRegionAction(state, 'a', ba).snapshot as ScoreRegionRound;
  assert.equal(afterBa.source?.kind, 'replacement');
  assert.equal(afterBa.source?.cardId, replacement);
  assert.equal(afterBa.source?.afterGang, true);

  const pass = scoreRegionLegalActions(afterBa, 'b').find(action => action.type === 'respond' && action.choiceId === null);
  assert.ok(pass);
  const afterPass = applyScoreRegionAction(afterBa, 'b', pass).snapshot as ScoreRegionRound;
  assert.equal(afterPass.phase, 'discard');
  assert.equal(afterPass.activeId, 'a');
  assert.equal(afterPass.source?.kind, 'replacement');
  assert.equal(afterPass.source?.cardId, replacement);

  const discard = scoreRegionLegalActions(afterPass, 'a').find(action => action.type === 'discard' && action.cardId === replacement);
  assert.ok(discard);
  const afterDiscard = applyScoreRegionAction(afterPass, 'a', discard).snapshot as ScoreRegionRound;
  assert.equal(afterDiscard.phase, 'response');
  assert.equal(afterDiscard.source?.kind, 'discard');
  assert.equal(afterDiscard.source?.afterGang, true);

  const response = scoreRegionLegalActions(afterDiscard, 'b').find(action => action.type === 'respond' &&
    afterDiscard.claims!.offers.find(offer => offer.id === action.choiceId && offer.userId === 'b' &&
      (offer.action as { type?: string }).type === 'hu'));
  assert.ok(response);
  const result = applyScoreRegionAction(afterDiscard, 'b', response);
  const outcome = (result.snapshot as ScoreRegionRound).outcome!;
  assert.equal(outcome.winners[0]!.userId, 'b');
  assert.ok(outcome.winners[0]!.win.items.some(item => item.pattern === 'gangPao'));
});

test('a draw-phase own meld keeps its replacement response one card short of full size', () => {
  const roundRules = rules('26:0', {
    playerNum: 2, baseBeans: '0.1', gangPao: 1, gangHua: 0, anDui: 0, siGuiYi: 0,
  });
  const input: RoundInput = {
    players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules: roundRules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
  const pack = createScoreRegionCardState('26:0', roundRules, 'deck', [
    { id: 'deck', visibility: 'hidden' },
  ]).pack;
  const state = createScoreRegionRound(input, pack.map(card => card.id), '26:0');
  const assigned = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(item => item.code === code && !assigned.has(item.id));
    assert.ok(card, `Fixture requests an unavailable face ${code}`);
    assigned.add(card.id);
    return card.id;
  };
  const aHand = [106, 206, 306, 406, 109, 101, 113].map(pick);
  const bHand = [110, 309, 205, 201, 213, 207, 307].map(pick);
  const replacement = pick(104);
  state.activeId = 'a';
  state.phase = 'draw';
  state.source = null;
  state.claims = null;
  state.cards.zones = [
    { id: 'deck', visibility: 'hidden', cards: [replacement, ...pack.filter(card => !assigned.has(card.id)).map(card => card.id)] },
    { id: 'table', visibility: 'public', cards: [] },
    { id: 'discards', visibility: 'public', cards: [] },
    { id: 'hand:a', visibility: 'private', ownerId: 'a', cards: aHand },
    { id: 'melds:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'bonus:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'hand:b', visibility: 'private', ownerId: 'b', cards: bHand },
    { id: 'melds:b', visibility: 'public', ownerId: 'b', cards: [] },
    { id: 'bonus:b', visibility: 'public', ownerId: 'b', cards: [] },
  ];
  assertScoreRegionRound(state);

  const tou = scoreRegionLegalActions(state, 'a').find(action => action.type === 'tou');
  assert.ok(tou);
  const after = applyScoreRegionAction(state, 'a', tou).snapshot as ScoreRegionRound;
  assert.equal(after.phase, 'response');
  assert.equal(after.source?.kind, 'replacement');
  assert.equal(after.source?.cardId, replacement);
  assert.deepEqual(after.responseResume, { kind: 'draw', source: after.source });
  assert.equal(after.cards.zones.find(zone => zone.id === 'hand:a')!.cards.length, 5);
});

function xuzhouPiaoState(piaoType: 0 | 2, prepareDiscard = false, playerCount: 2 | 3 | 4 = 2): ScoreRegionRound {
  const userIds = ['a', 'b', 'c', 'd'].slice(0, playerCount);
  const roundRules = rules('23:0', { playerNum: playerCount, baseBeans: '0.1', piaoType, wangNum: 0 });
  const input: RoundInput = {
    players: userIds.map((userId, index) => ({ userId, seat: index + 1 })),
    ownerUserId: 'a', number: 1, rules: roundRules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
  const pack = createScoreRegionCardState('23:0', roundRules, 'deck', [
    { id: 'deck', visibility: 'hidden' },
  ]).pack;
  const state = createScoreRegionRound(input, pack.map(card => card.id), '23:0');
  const assigned = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(item => item.code === code && !assigned.has(item.id));
    assert.ok(card, `Fixture requests an unavailable face ${code}`);
    assigned.add(card.id);
    return card.id;
  };
  const concealed = [110, 104, 309, 205, 201, 213, 206, 208].map(pick);
  const opponentHands = userIds.slice(1).map(() => pack.filter(card => !assigned.has(card.id)).slice(0, 7)
    .map(card => { assigned.add(card.id); return card.id; }));
  state.cards.zones = [
    { id: 'deck', visibility: 'hidden', cards: pack.filter(card => !assigned.has(card.id)).map(card => card.id) },
    { id: 'table', visibility: 'public', cards: [] },
    { id: 'discards', visibility: 'public', cards: [] },
    { id: 'hand:a', visibility: 'private', ownerId: 'a', cards: concealed },
    { id: 'melds:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'bonus:a', visibility: 'public', ownerId: 'a', cards: [] },
    ...userIds.slice(1).flatMap((userId, index) => [
      { id: `hand:${userId}`, visibility: 'private' as const, ownerId: userId, cards: opponentHands[index]! },
      { id: `melds:${userId}`, visibility: 'public' as const, ownerId: userId, cards: [] },
      { id: `bonus:${userId}`, visibility: 'public' as const, ownerId: userId, cards: [] },
    ]),
  ];
  if (prepareDiscard) {
    state.activeId = 'a';
    state.phase = 'discard';
    state.source = { kind: 'replacement', userId: 'a', cardId: concealed[0]! };
    state.claims = null;
    state.players.forEach(player => { player.piao = 0; });
  }
  assertScoreRegionRound(state);
  return state;
}

test('Rongxian small seat follows the dealer and later rounds deal 8/7/7/5', () => {
  const roundRules = rules('20:0', { playerNum: 4, gameNum: 4, daXiaoJia: 1, wangNum: 2 });
  const expectedSmallSeat = new Map([[1, 4], [2, 1], [3, 2], [4, 3]]);
  for (const [dealerSeat, smallSeat] of expectedSmallSeat) {
    assert.equal(regionalHandSize('20:0', roundRules, 4, smallSeat, dealerSeat), 5);
    assert.equal(isRongxianSmallSeat('20:0', roundRules, 4, smallSeat, dealerSeat), true);
    const dealerId = `p${dealerSeat}`;
    const input: RoundInput = {
      players: [1, 2, 3, 4].map(seat => ({ userId: `p${seat}`, seat })),
      ownerUserId: 'p1', number: 2, rules: roundRules,
      policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
      previousRoundContext: { version: SCORE_REGION_VERSIONS['20:0'], completedRound: 1,
        nextDealerId: dealerId, dealerRun: 1 },
    };
    const pack = createScoreRegionCardState('20:0', roundRules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
    const state = createScoreRegionRound(input, pack.map(card => card.id), '20:0');
    assert.equal(state.dealerId, dealerId);
    const handCount = (userId: string) => state.cards.zones.find(zone => zone.id === `hand:${userId}`)!.cards.length;
    assert.equal(handCount(dealerId), 8);
    assert.equal(handCount(`p${smallSeat}`), 5);
    for (const seat of [1, 2, 3, 4]) if (seat !== dealerSeat && seat !== smallSeat) assert.equal(handCount(`p${seat}`), 7);
    assert.equal([1, 2, 3, 4].reduce((sum, seat) => sum + handCount(`p${seat}`), 0), 27);

    const begin = scoreRegionLegalActions(state, dealerId).find(action => action.type === 'begin');
    assert.ok(begin);
    let current = applyScoreRegionAction(state, dealerId, begin).snapshot as ScoreRegionRound;
    let reachedSmallSeat = false;
    for (let guard = 0; guard < 500; guard++) {
      if (current.phase === 'discard' && current.activeId === `p${smallSeat}`) {
        const smallHand = current.cards.zones.find(zone => zone.id === `hand:p${smallSeat}`)!.cards;
        const smallMelds = current.players.find(player => player.userId === `p${smallSeat}`)!.melds.length;
        assert.equal(smallHand.length, 6 - 2 * smallMelds);
        const actions = scoreRegionLegalActions(current, `p${smallSeat}`);
        assert.ok(actions.some(action => action.type === 'discard'));
        const discarded = applyScoreRegionAction(current, `p${smallSeat}`,
          actions.find(action => action.type === 'discard')!).snapshot as ScoreRegionRound;
        assert.notEqual(discarded.phase, 'discard');
        reachedSmallSeat = true;
        break;
      }
      let activeId = current.activeId;
      let action: ScoreRegionAction | undefined;
      if (current.phase === 'response') {
        const smallSeatId = `p${smallSeat}`;
        const smallOptions = scoreRegionLegalActions(current, smallSeatId);
        const smallClaim = smallOptions.find(candidate => candidate.type === 'respond' && candidate.choiceId !== null);
        activeId = smallClaim ? smallSeatId : current.players.map(player => player.userId)
          .find(userId => scoreRegionLegalActions(current, userId).length) ?? activeId;
        action = smallClaim ?? scoreRegionLegalActions(current, activeId)
          .find(candidate => candidate.type === 'respond' && candidate.choiceId === null);
      } else {
        const legal = scoreRegionLegalActions(current, activeId);
        action = legal.find(candidate => candidate.type === 'discard') ?? legal.find(candidate => candidate.type === 'draw')
          ?? legal.find(candidate => candidate.type === 'begin') ?? legal[0];
      }
      assert.ok(action, `The ${dealerId} fixture must keep a decision available`);
      current = applyScoreRegionAction(current, activeId, action).snapshot as ScoreRegionRound;
    }
    assert.equal(reachedSmallSeat, true, `The small seat p${smallSeat} must receive its discard decision`);
  }
});

test('Xuzhou piao selection gates the opening and defaults to zero on timeout', () => {
  const state = xuzhouPiaoState(2);
  assert.equal(state.phase, 'piao');
  assert.equal(state.source, null);
  assert.deepEqual(state.players.map(player => player.piao), [null, null]);
  assert.deepEqual(scoreRegionLegalActions(state, 'a').map(action => action.type === 'piao' ? action.value : null),
    [0, 1]);
  const timeout = scoreRegionTimedAction(state, 'b');
  assert.ok(timeout);
  assert.equal(timeout.delayMs, 15000);
  assert.deepEqual(timeout.action, { type: 'piao', value: 0, decisionId: timeout.decisionId });
  const afterB = applyScoreRegionAction(state, 'b', timeout.action).snapshot as ScoreRegionRound;
  assert.equal(afterB.phase, 'piao');
  const afterA = applyScoreRegionAction(afterB, 'a', scoreRegionLegalActions(afterB, 'a')[1]!).snapshot as ScoreRegionRound;
  assert.equal(afterA.phase, 'opening');
  assert.equal(afterA.source?.kind, 'original-hand');
});

test('Xuzhou charges both players piao as one fan each in the final score', () => {
  const state = xuzhouPiaoState(0, true);
  const hu = scoreRegionLegalActions(state, 'a').find(action => action.type === 'hu');
  assert.ok(hu);
  const plain = applyScoreRegionAction(state, 'a', hu).snapshot as ScoreRegionRound;
  const plainWin = plain.outcome!.winners[0]!.win;
  const plainShare = plain.outcome!.payments.transfers[0]!;
  assert.equal(plainWin.items.some(item => item.pattern === 'piao'), false);

  const piaoState = xuzhouPiaoState(2);
  piaoState.phase = 'discard';
  piaoState.source = { kind: 'replacement', userId: 'a', cardId: piaoState.cards.zones
    .find(zone => zone.id === 'hand:a')!.cards[0]! };
  piaoState.players[0]!.piao = 1;
  piaoState.players[1]!.piao = 1;
  const piaoHu = scoreRegionLegalActions(piaoState, 'a').find(action => action.type === 'hu');
  assert.ok(piaoHu);
  const result = applyScoreRegionAction(piaoState, 'a', piaoHu);
  const piaoWin = (result.snapshot as ScoreRegionRound).outcome!.winners[0]!.win;
  assert.deepEqual(piaoWin.items.find(item => item.pattern === 'piao'), { pattern: 'piao', count: 1, fan: 1 });
  assert.equal(piaoWin.totalFan, plainWin.totalFan + 1);
  const piaoShare = (result.snapshot as ScoreRegionRound).outcome!.payments.transfers[0]!;
  assert.equal(BigInt(piaoShare.numerator), BigInt(plainShare.numerator) * 4n);
  assert.equal(piaoShare.denominator, plainShare.denominator);
  assert.deepEqual(result.settlement, [
    { userId: 'a', amount: '0.4' },
    { userId: 'b', amount: '-0.4' },
  ]);
});

test('Xuzhou adds only the winner piao when the payer does not piao', () => {
  const state = xuzhouPiaoState(2);
  state.phase = 'discard';
  state.source = { kind: 'replacement', userId: 'a', cardId: state.cards.zones
    .find(zone => zone.id === 'hand:a')!.cards[0]! };
  state.players[0]!.piao = 1;
  state.players[1]!.piao = 0;
  const hu = scoreRegionLegalActions(state, 'a').find(action => action.type === 'hu');
  assert.ok(hu);
  const result = applyScoreRegionAction(state, 'a', hu);
  const win = (result.snapshot as ScoreRegionRound).outcome!.winners[0]!.win;
  assert.deepEqual(win.items.find(item => item.pattern === 'piao'), { pattern: 'piao', count: 1, fan: 1 });
  assert.deepEqual(result.settlement, [
    { userId: 'a', amount: '0.2' },
    { userId: 'b', amount: '-0.2' },
  ]);
});

test('Xuzhou exposes per-payer piao fan and keeps the legacy win fields in the view', () => {
  const state = xuzhouPiaoState(2, true, 4);
  state.players[0]!.piao = 1;
  state.players[1]!.piao = 0;
  state.players[2]!.piao = 1;
  state.players[3]!.piao = 1;
  const hu = scoreRegionLegalActions(state, 'a').find(action => action.type === 'hu');
  assert.ok(hu);
  const result = applyScoreRegionAction(state, 'a', hu);
  const snapshot = result.snapshot as ScoreRegionRound;
  assert.deepEqual(result.settlement, [
    { userId: 'a', amount: '1' },
    { userId: 'b', amount: '-0.2' },
    { userId: 'c', amount: '-0.4' },
    { userId: 'd', amount: '-0.4' },
  ]);
  const winner = snapshot.outcome!.winners[0]!;
  assert.deepEqual(winner.payerWins?.map(item => ({ payerId: item.payerId,
    piao: item.win.items.find(entry => entry.pattern === 'piao')?.fan ?? 0 })), [
    { payerId: 'b', piao: 1 },
    { payerId: 'c', piao: 2 },
    { payerId: 'd', piao: 2 },
  ]);
  const view = viewScoreRegionRound(snapshot, 'a');
  const viewedWinner = view.outcome!.winners[0]!;
  assert.ok(Array.isArray(viewedWinner.items));
  assert.notEqual(viewedWinner.structureScore, undefined);
  assert.notEqual(viewedWinner.scoreUnits, undefined);
  assert.deepEqual(viewedWinner.payerWins?.map(item => ({ payerId: item.payerId,
    piao: item.items.find(entry => entry.pattern === 'piao')?.fan ?? 0 })), [
    { payerId: 'b', piao: 1 },
    { payerId: 'c', piao: 2 },
    { payerId: 'd', piao: 2 },
  ]);
});

test('Xuzhou adds only the payer piao to a payer-specific share', () => {
  const state = xuzhouPiaoState(2, true);
  state.players[0]!.piao = 0;
  state.players[1]!.piao = 1;
  const hu = scoreRegionLegalActions(state, 'a').find(action => action.type === 'hu');
  assert.ok(hu);
  const result = applyScoreRegionAction(state, 'a', hu);
  const snapshot = result.snapshot as ScoreRegionRound;
  assert.deepEqual(result.settlement, [
    { userId: 'a', amount: '0.2' },
    { userId: 'b', amount: '-0.2' },
  ]);
  const winner = snapshot.outcome!.winners[0]!;
  assert.equal(winner.win.items.some(item => item.pattern === 'piao'), false);
  assert.deepEqual(winner.payerWins?.[0]?.win.items.find(item => item.pattern === 'piao'),
    { pattern: 'piao', count: 1, fan: 1 });
});

// Round snapshots are persisted as JSON, which drops undefined-valued keys. Replay compares the
// replayed snapshot against the stored one with assert.deepStrictEqual, so a discard win with no
// frozen wait code must not leave an undefined waitCode behind on any payer share.
test('Xuzhou discard wins never persist an undefined payer wait code', () => {
  const state = xuzhouPiaoState(2);
  const handA = state.cards.zones.find(zone => zone.id === 'hand:a')!;
  const handB = state.cards.zones.find(zone => zone.id === 'hand:b')!;
  const discardId = handA.cards.find(cardId => {
    const code = state.cards.pack.find(card => card.id === cardId)!.code;
    return scoreRegionDeclarationFaces(state, 'a', cardId)?.includes(code) ?? false;
  });
  assert.ok(discardId, 'The fixture needs a card that completes its own wait');
  handA.cards = handA.cards.filter(cardId => cardId !== discardId);
  handB.cards.push(discardId);
  state.dealerId = 'b';
  state.activeId = 'b';
  state.phase = 'discard';
  state.source = { kind: 'replacement', userId: 'b', cardId: discardId };
  state.players[0]!.piao = 1;
  state.players[1]!.piao = 1;
  assertScoreRegionRound(state);

  const discard = scoreRegionLegalActions(state, 'b').find(action => action.type === 'discard' &&
    action.cardId === discardId);
  assert.ok(discard);
  const responseState = applyScoreRegionAction(state, 'b', discard).snapshot as ScoreRegionRound;
  assert.equal(responseState.phase, 'response');
  const response = scoreRegionLegalActions(responseState, 'a').find(action => {
    if (action.type !== 'respond' || action.choiceId === null) return false;
    const offer = responseState.claims!.offers.find(item => item.id === action.choiceId);
    return offer?.userId === 'a' && (offer.action as { type?: string }).type === 'hu';
  });
  assert.ok(response);
  const result = applyScoreRegionAction(responseState, 'a', response).snapshot as ScoreRegionRound;
  const winner = result.outcome!.winners[0]!;
  assert.ok(winner.payerWins?.length);
  for (const share of winner.payerWins) {
    assert.equal(Object.hasOwn(share, 'waitCode'), false,
      'A share without a frozen wait code must not carry the property at all');
  }
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result,
    'The settled snapshot must survive a JSON persistence round trip unchanged');
});

test('Xuzhou charges the actual discard payer with both piao choices', () => {
  const state = xuzhouPiaoState(2);
  const handA = state.cards.zones.find(zone => zone.id === 'hand:a')!;
  const handB = state.cards.zones.find(zone => zone.id === 'hand:b')!;
  const discardId = handA.cards.find(cardId => {
    const code = state.cards.pack.find(card => card.id === cardId)!.code;
    return scoreRegionDeclarationFaces(state, 'a', cardId)?.includes(code) ?? false;
  });
  assert.ok(discardId, 'The fixture needs a card that completes its own wait');
  handA.cards = handA.cards.filter(cardId => cardId !== discardId);
  handB.cards.push(discardId);
  state.dealerId = 'b';
  state.activeId = 'b';
  state.phase = 'discard';
  state.source = { kind: 'replacement', userId: 'b', cardId: discardId };
  state.players[0]!.piao = 1;
  state.players[1]!.piao = 1;
  assertScoreRegionRound(state);

  const discard = scoreRegionLegalActions(state, 'b').find(action => action.type === 'discard' &&
    action.cardId === discardId);
  assert.ok(discard);
  const responseState = applyScoreRegionAction(state, 'b', discard).snapshot as ScoreRegionRound;
  assert.equal(responseState.phase, 'response');
  assert.deepEqual(scoreRegionLegalActions(responseState, 'b'), []);
  const response = scoreRegionLegalActions(responseState, 'a').find(action => {
    if (action.type !== 'respond' || action.choiceId === null) return false;
    const offer = responseState.claims!.offers.find(item => item.id === action.choiceId);
    return offer?.userId === 'a' && (offer.action as { type?: string }).type === 'hu';
  });
  assert.ok(response);
  const result = applyScoreRegionAction(responseState, 'a', response);
  const snapshot = result.snapshot as ScoreRegionRound;
  assert.deepEqual(result.settlement, [
    { userId: 'a', amount: '0.4' },
    { userId: 'b', amount: '-0.4' },
  ]);
  const winner = snapshot.outcome!.winners[0]!;
  assert.deepEqual(winner.win.items.find(item => item.pattern === 'piao'),
    { pattern: 'piao', count: 2, fan: 2 });
  assert.deepEqual(winner.payerWins?.map(item => ({ payerId: item.payerId,
    piao: item.win.items.find(entry => entry.pattern === 'piao')?.fan ?? 0 })),
    [{ payerId: 'b', piao: 2 }]);
});

function declarationFixture(options: Record<string, unknown> = {}): ScoreRegionRound {
  const roundRules = rules('14:0', { playerNum: 2, baoJiao: 1, ...options });
  const input: RoundInput = {
    players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules: roundRules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
  const pack = createScoreRegionCardState('14:0', roundRules, 'deck', [
    { id: 'deck', visibility: 'hidden' },
  ]).pack;
  const state = createScoreRegionRound(input, pack.map(card => card.id), '14:0');
  const assigned = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(item => item.code === code && !assigned.has(item.id));
    assert.ok(card, `Fixture requests an unavailable face ${code}`);
    assigned.add(card.id);
    return card.id;
  };
  const concealed = [101, 113, 105, 309, 104, 310, 112, 106].map(pick);
  const opponentHand = pack.filter(card => !assigned.has(card.id)).slice(0, 7).map(card => {
    assigned.add(card.id);
    return card.id;
  });
  state.activeId = 'a';
  state.phase = 'discard';
  state.source = { kind: 'replacement', userId: 'a', cardId: concealed[0]! };
  state.claims = null;
  state.cards.zones = [
    { id: 'deck', visibility: 'hidden', cards: pack.filter(card => !assigned.has(card.id)).map(card => card.id) },
    { id: 'table', visibility: 'public', cards: [] },
    { id: 'discards', visibility: 'public', cards: [] },
    { id: 'hand:a', visibility: 'private', ownerId: 'a', cards: concealed },
    { id: 'melds:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'bonus:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'hand:b', visibility: 'private', ownerId: 'b', cards: opponentHand },
    { id: 'melds:b', visibility: 'public', ownerId: 'b', cards: [] },
    { id: 'bonus:b', visibility: 'public', ownerId: 'b', cards: [] },
  ];
  assertScoreRegionRound(state);
  return state;
}

function declaredState(): ScoreRegionRound {
  const state = declarationFixture();
  const declaration = scoreRegionLegalActions(state, 'a').find(action => action.type === 'declare' &&
    state.cards.pack.find(card => card.id === action.cardId)!.code === 106);
  assert.ok(declaration);
  return applyScoreRegionAction(state, 'a', declaration).snapshot as ScoreRegionRound;
}

test('score-region declaration freezes bonus IDs and preserves the locked discard set', () => {
  const state = declaredState();
  assert.deepEqual(state.players[0]!.declaredWaits, [102, 202, 302, 402]);
  assert.deepEqual(state.players[0]!.declaredBonusIds, []);

  const before = scoreRegionLegalActions(state, 'a').filter(action => action.type === 'discard');
  const addedBonus = state.cards.zones.find(zone => zone.id === 'deck')!.cards.find(cardId =>
    [1001, 1002, 1003].includes(state.cards.pack.find(card => card.id === cardId)!.code));
  assert.ok(addedBonus);
  state.cards.zones.find(zone => zone.id === 'deck')!.cards = state.cards.zones
    .find(zone => zone.id === 'deck')!.cards.filter(cardId => cardId !== addedBonus);
  state.cards.zones.find(zone => zone.id === 'bonus:a')!.cards.push(addedBonus);
  const after = scoreRegionLegalActions(state, 'a').filter(action => action.type === 'discard');
  assert.deepEqual(after, before);
  assert.deepEqual(state.players[0]!.declaredBonusIds, []);
  assert.equal(scoreRegionLegalActions(state, 'a').some(action => action.type === 'declare'), false);
});

test('score-region declared winning sources remain bound to the frozen bonus snapshot', () => {
  let state = declaredState();
  const addedBonus = state.cards.zones.find(zone => zone.id === 'deck')!.cards.find(cardId =>
    [1001, 1002, 1003].includes(state.cards.pack.find(card => card.id === cardId)!.code));
  assert.ok(addedBonus);
  state.cards = moveCards(state.cards, 'deck', 'bonus:a', [addedBonus]);
  assert.deepEqual(state.players[0]!.declaredBonusIds, []);
  const source = state.cards.zones.find(zone => zone.id === 'deck')!.cards.find(cardId =>
    state.cards.pack.find(card => card.id === cardId)!.code === 202);
  assert.ok(source);
  state.cards = moveCards(state.cards, 'table', 'discards',
    [...state.cards.zones.find(zone => zone.id === 'table')!.cards]);
  state.cards = moveCards(state.cards, 'deck', 'table', [source]);
  state.phase = 'response';
  state.activeId = 'b';
  state.source = { kind: 'discard', userId: 'b', cardId: source };
  state.serial += 1;
  state.claims = {
    id: `sr:${state.number}:${state.serial}`,
    tieOrder: ['a'],
    replies: [],
    offers: [{ id: 'locked-win', userId: 'a', action: { type: 'hu' }, priority: 100, simultaneous: true }],
  };
  const response = scoreRegionLegalActions(state, 'a').find(action => action.type === 'respond' &&
    action.choiceId === 'locked-win');
  assert.ok(response);
  const result = applyScoreRegionAction(state, 'a', response).snapshot as ScoreRegionRound;
  assert.equal(result.outcome?.winners[0]?.userId, 'a');

  let rejected = declaredState();
  const wrong = rejected.cards.zones.find(zone => zone.id === 'deck')!.cards.find(cardId => {
    const code = rejected.cards.pack.find(card => card.id === cardId)!.code;
    return code < 1000 && !rejected.players[0]!.declaredWaits!.includes(code);
  });
  assert.ok(wrong);
  rejected.cards = moveCards(rejected.cards, 'table', 'discards',
    [...rejected.cards.zones.find(zone => zone.id === 'table')!.cards]);
  rejected.cards = moveCards(rejected.cards, 'deck', 'table', [wrong]);
  rejected.phase = 'response';
  rejected.activeId = 'b';
  rejected.source = { kind: 'discard', userId: 'b', cardId: wrong };
  rejected.serial += 1;
  rejected.claims = {
    id: `sr:${rejected.number}:${rejected.serial}`,
    tieOrder: ['a'],
    replies: [],
    offers: [{ id: 'wrong-win', userId: 'a', action: { type: 'hu' }, priority: 100, simultaneous: true }],
  };
  const forged = scoreRegionLegalActions(rejected, 'a').find(action => action.type === 'respond' &&
    action.choiceId === 'wrong-win');
  assert.ok(forged);
  assert.throws(() => applyScoreRegionAction(rejected, 'a', forged), { code: 'INVALID_ACTION' });
});

test('score-region declarations reject unpaired, duplicate and missing bonus snapshots', () => {
  const state = declaredState();

  const unpaired = structuredClone(state);
  unpaired.players[0]!.declaredWaits = null;
  assert.throws(() => assertScoreRegionRound(unpaired), { code: 'INVALID_SCORE_REGION_STATE' });

  const inverseUnpaired = structuredClone(state);
  inverseUnpaired.players[0]!.declaredBonusIds = null;
  assert.throws(() => assertScoreRegionRound(inverseUnpaired), { code: 'INVALID_SCORE_REGION_STATE' });

  const bothNull = structuredClone(state);
  bothNull.players[0]!.declaredWaits = null;
  bothNull.players[0]!.declaredBonusIds = null;
  assert.doesNotThrow(() => assertScoreRegionRound(bothNull));

  const missing = structuredClone(state);
  missing.players[0]!.declaredBonusIds = ['missing-card'];
  assert.throws(() => assertScoreRegionRound(missing), { code: 'INVALID_SCORE_REGION_STATE' });

  const duplicate = structuredClone(state);
  duplicate.players[0]!.declaredBonusIds = ['missing-card', 'missing-card'];
  assert.throws(() => assertScoreRegionRound(duplicate), { code: 'INVALID_SCORE_REGION_STATE' });
});
