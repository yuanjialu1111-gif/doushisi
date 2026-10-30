import assert from 'node:assert/strict';
import { getDefaultOptions, SCORE_REGION_VERSIONS } from '../packages/rules/src/index.js';
import type { EngineResult, RoundInput } from '../apps/server/src/engines.js';
import {
  applyScoreRegionAction, assertScoreRegionRound, createScoreRegionRound, scoreRegionLegalActions,
  type ScoreRegionAction, type ScoreRegionRound,
} from '../apps/server/src/game/score-region-round.js';
import { createScoreRegionCardState } from '../apps/server/src/game/score-region-pack.js';

type VariantKey = '25:0' | '26:0' | '27:0';
type CaseResult = {
  label: string;
  variantKey: VariantKey;
  actions: string[];
  settlement: EngineResult['settlement'];
  winner: {
    userId: string;
    items: { pattern: string; count: number; fan: number }[];
    totalFan: number;
    scoreUnits: string;
    redPoints: number;
    blackPoints: number;
  } | null;
  confirmedScores: EngineResult['confirmedScores'];
  payments: NonNullable<ScoreRegionRound['outcome']>['payments'];
};

function rules(variantKey: VariantKey, overrides: Record<string, unknown> = {}) {
  return { ...getDefaultOptions(variantKey), playerNum: 2, baseBeans: '0.1', ...overrides,
    scoreRegion: { rulesVersion: SCORE_REGION_VERSIONS[variantKey] } };
}

function input(variantKey: VariantKey, overrides: Record<string, unknown> = {}): RoundInput {
  return {
    players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules: rules(variantKey, overrides),
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
}

function fresh(variantKey: VariantKey, overrides: Record<string, unknown> = {}) {
  const roundRules = rules(variantKey, overrides);
  const pack = createScoreRegionCardState(variantKey, roundRules, 'deck', [
    { id: 'deck', visibility: 'hidden' },
  ]).pack;
  return { state: createScoreRegionRound(input(variantKey, overrides), pack.map(card => card.id), variantKey), pack,
    roundRules };
}

function picker(pack: readonly { id: string; code: number }[]) {
  const assigned = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(item => item.code === code && !assigned.has(item.id));
    assert.ok(card, `Fixture requests unavailable face ${code}`);
    assigned.add(card.id);
    return card.id;
  };
  const take = (count: number) => pack.filter(card => !assigned.has(card.id)).slice(0, count)
    .map(card => { assigned.add(card.id); return card.id; });
  return { assigned, pick, take };
}

function setZones(state: ScoreRegionRound, pack: readonly { id: string; code: number }[], assigned: Set<string>,
  hands: Record<string, string[]>, melds: Record<string, { cardIds: string[] }[]> = {},
  bonuses: Record<string, string[]> = {}) {
  state.cards.zones = [
    { id: 'deck', visibility: 'hidden', cards: pack.filter(card => !assigned.has(card.id)).map(card => card.id) },
    { id: 'table', visibility: 'public', cards: [] },
    { id: 'discards', visibility: 'public', cards: [] },
    ...state.players.flatMap(player => [
      { id: `hand:${player.userId}`, visibility: 'private' as const, ownerId: player.userId,
        cards: hands[player.userId] ?? [] },
      { id: `melds:${player.userId}`, visibility: 'public' as const, ownerId: player.userId,
        cards: (melds[player.userId] ?? []).flatMap(meld => meld.cardIds) },
      { id: `bonus:${player.userId}`, visibility: 'public' as const, ownerId: player.userId,
        cards: bonuses[player.userId] ?? [] },
    ]),
  ];
}

function setMelds(state: ScoreRegionRound, melds: Record<string, { kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou'; cardIds: string[] }[]>) {
  for (const player of state.players) player.melds = (melds[player.userId] ?? []).map(meld => ({ ...meld, cardIds: [...meld.cardIds] }));
}

function prepareOwnWin(state: ScoreRegionRound, source: NonNullable<ScoreRegionRound['source']>) {
  state.activeId = 'a';
  state.phase = 'response';
  state.source = source;
  state.serial = 1;
  state.claims = { id: `sr:${state.number}:${state.serial}`, tieOrder: ['a', 'b'],
    offers: [{ id: `sr:${state.number}:${state.serial}:0`, userId: 'a', action: { type: 'hu' },
      priority: 100, simultaneous: true }], replies: [] };
  assertScoreRegionRound(state);
  return state;
}

function findHu(state: ScoreRegionRound, id: string): ScoreRegionAction {
  const action = scoreRegionLegalActions(state, id).find(candidate => candidate.type === 'hu');
  assert.ok(action, `${id} must have a legal hu action`);
  return action;
}

function findDiscard(state: ScoreRegionRound, id: string, cardId: string): ScoreRegionAction {
  const action = scoreRegionLegalActions(state, id).find(candidate => candidate.type === 'discard' && candidate.cardId === cardId);
  assert.ok(action, `${id} must be able to discard ${cardId}`);
  return action;
}

function findResponseHu(state: ScoreRegionRound, id: string): ScoreRegionAction {
  const action = scoreRegionLegalActions(state, id).find(candidate => {
    if (candidate.type !== 'respond' || candidate.choiceId === null) return false;
    const offer = state.claims?.offers.find(item => item.id === candidate.choiceId);
    return offer?.userId === id && (offer.action as { type?: string }).type === 'hu';
  });
  assert.ok(action, `${id} must have a legal response hu action`);
  return action;
}

function summarize(label: string, variantKey: VariantKey, state: ScoreRegionRound, result: EngineResult,
  actions: string[]): CaseResult {
  const winner = state.outcome!.winners[0]!;
  const resultWinner = (result.snapshot as ScoreRegionRound).outcome!.winners[0]!;
  const total = state.outcome!.payments.postings.reduce((sum, posting) => sum + Number(posting.amount), 0);
  assert.equal(total, 0, `${label} must conserve balances`);
  assert.deepEqual(result.settlement, state.outcome!.payments.postings, `${label} settlement must match postings`);
  return {
    label, variantKey, actions,
    settlement: result.settlement,
    winner: { userId: winner.userId, items: winner.win.items.map(item => ({ ...item })),
      totalFan: winner.win.totalFan, scoreUnits: winner.win.scoreUnits,
      redPoints: winner.win.redPoints, blackPoints: winner.win.blackPoints },
    confirmedScores: result.confirmedScores,
    payments: state.outcome!.payments,
  };
}

function finishOwn(label: string, variantKey: VariantKey, state: ScoreRegionRound, actions: string[]): CaseResult {
  const hu = findHu(state, 'a');
  actions.push('legalActions(a): hu -> apply');
  const result = applyScoreRegionAction(state, 'a', hu);
  const finished = result.snapshot as ScoreRegionRound;
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.outcome?.winners[0]?.userId, 'a');
  return summarize(label, variantKey, finished, result, actions);
}

function response(label: string, variantKey: VariantKey, state: ScoreRegionRound, actions: string[]): CaseResult {
  const discard = scoreRegionLegalActions(state, 'b').find(candidate => candidate.type === 'discard');
  assert.ok(discard, 'b must have a legal discard');
  actions.push('legalActions(b): discard -> apply');
  const afterDiscard = applyScoreRegionAction(state, 'b', discard).snapshot as ScoreRegionRound;
  assert.equal(afterDiscard.phase, 'response');
  const hu = findResponseHu(afterDiscard, 'a');
  actions.push('legalActions(a): respond(hu) -> apply');
  const result = applyScoreRegionAction(afterDiscard, 'a', hu);
  const finished = result.snapshot as ScoreRegionRound;
  assert.equal(finished.outcome?.winners[0]?.userId, 'a');
  return summarize(label, variantKey, finished, result, actions);
}

function junlianOwn(label: string, variantKey: VariantKey, codes: number[], incomingCode: number,
  sourceKind: 'replacement' | 'flip', sourceSeat: number, overrides: Record<string, unknown>,
  melds?: Record<string, { kind: 'chi' | 'peng' | 'gang' | 'ba' | 'tou'; cardIds: string[] }[]>): CaseResult {
  const { state, pack } = fresh(variantKey, overrides);
  const { assigned, pick, take } = picker(pack);
  const concealed = codes.map(pick);
  const opponent = take(7);
  const incomingId = concealed[codes.indexOf(incomingCode)]!;
  const built = melds ?? {};
  setZones(state, pack, assigned, { a: concealed, b: opponent }, built);
  setMelds(state, built);
  prepareOwnWin(state, { kind: sourceKind, userId: 'b', cardId: incomingId });
  return finishOwn(label, variantKey, state, [`fixture: ${variantKey}, own ${sourceKind} win`, 'engine.create -> legalActions -> apply']);
}

function case2527(): CaseResult[] {
  const anDuiCodes = [110, 204, 309, 205, 305, 209, 307, 207];
  const oneRedCodes = [110, 210, 209, 405, 208, 406, 207, 407];
  const sevenCodes = [110, 204, 109, 405, 108, 406, 107, 207];
  return [
    junlianOwn('25 an-dui open pair', '25:0', anDuiCodes, 110, 'discard', 2,
      { da_7hong_7hei: 0, yiDianZhu: 0, menQing: 0 }),
    junlianOwn('27 an-dui open pair', '27:0', anDuiCodes, 110, 'discard', 2,
      { da_7hong_7hei: 0, yiDianZhu: 0, menQing: 0 }),
    junlianOwn('25 seven-red-seven-black', '25:0', sevenCodes, 107, 'replacement', 2,
      { da_7hong_7hei: 1, daShaQiangHu: 0, qiang_7Hu: 0, yiDianZhu: 0, menQing: 0 }),
    junlianOwn('27 seven-red-seven-black', '27:0', sevenCodes, 107, 'replacement', 2,
      { da_7hong_7hei: 1, daShaQiangHu: 0, qiang_7Hu: 0, yiDianZhu: 0, menQing: 0 }),
    junlianOwn('25 qiang-hu', '25:0', sevenCodes, 107, 'replacement', 2,
      { da_7hong_7hei: 0, daShaQiangHu: 1, qiang_7Hu: 0, yiDianZhu: 0, menQing: 0 }),
    junlianOwn('27 qiang-hu', '27:0', sevenCodes, 107, 'replacement', 2,
      { da_7hong_7hei: 0, daShaQiangHu: 1, qiang_7Hu: 0, yiDianZhu: 0, menQing: 0 }),
    junlianOwn('25 qiang-7', '25:0', sevenCodes, 107, 'replacement', 2,
      { da_7hong_7hei: 0, daShaQiangHu: 0, qiang_7Hu: 1, yiDianZhu: 0, menQing: 0 }),
    junlianOwn('27 qiang-7', '27:0', sevenCodes, 107, 'replacement', 2,
      { da_7hong_7hei: 0, daShaQiangHu: 0, qiang_7Hu: 1, yiDianZhu: 0, menQing: 0 }),
    junlianOwn('25 one-red', '25:0', oneRedCodes, 110, 'discard', 2,
      { da_7hong_7hei: 0, yiDianZhu: 1, menQing: 0 }),
    junlianOwn('27 one-red', '27:0', oneRedCodes, 110, 'discard', 2,
      { da_7hong_7hei: 0, yiDianZhu: 1, menQing: 0 }),
  ];
}

function allFromOthers(label: string, variantKey: VariantKey): CaseResult {
  const { state, pack } = fresh(variantKey, { da_7hong_7hei: 0, yiDianZhu: 0, menQing: 0, quanQiuRen: 1 });
  const { assigned, pick, take } = picker(pack);
  const pair = [110, 204].map(pick);
  const tableCard = pair[1]!;
  const fourthPeng = [112, 212, 312].map(pick);
  const melds = [
    { kind: 'peng' as const, cardIds: [106, 206, 306].map(pick) },
    { kind: 'peng' as const, cardIds: [108, 208, 308].map(pick) },
    { kind: 'peng' as const, cardIds: fourthPeng },
  ];
  const opponent = take(7);
  setZones(state, pack, assigned, { a: pair.slice(0, 1), b: opponent }, { a: melds });
  setMelds(state, { a: melds });
  const deck = state.cards.zones.find(zone => zone.id === 'deck')!;
  deck.cards = deck.cards.filter(id => id !== tableCard);
  state.cards.zones.find(zone => zone.id === 'table')!.cards = [tableCard];
  state.activeId = 'a';
  state.phase = 'response';
  state.source = { kind: 'discard', userId: 'b', cardId: tableCard };
  state.claims = { id: `sr:${state.number}:${state.serial}`, tieOrder: ['a', 'b'],
    offers: [{ id: `sr:${state.number}:${state.serial}:0`, userId: 'a', action: { type: 'hu' },
      priority: 100, simultaneous: true }], replies: [] };
  const zoneIds = state.cards.zones.flatMap(zone => zone.cards);
  const missing = pack.filter(card => !zoneIds.includes(card.id)).map(card => card.id);
  const duplicated = zoneIds.filter((cardId, index) => zoneIds.indexOf(cardId) !== index);
  assert.deepEqual({ missing, duplicated }, { missing: [], duplicated: [] }, 'all-from-others fixture card conservation');
  assertScoreRegionRound(state);
  const hu = scoreRegionLegalActions(state, 'a').find(action => action.type === 'hu');
  assert.ok(hu, 'a must have a legal hu action');
  const result = applyScoreRegionAction(state, 'a', hu);
  const finished = result.snapshot as ScoreRegionRound;
  assert.equal(finished.outcome?.winners[0]?.userId, 'a');
  return summarize(label, variantKey, finished, result,
    [`fixture: ${variantKey}, all-from-others`, 'engine.create -> legalActions -> apply']);
}

function ganluoPair(label: string, anDui: number, siGuiYi: number, withThreePlusOne = false): CaseResult {
  const { state, pack } = fresh('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4,
    anDui, siGuiYi, gangPao: 0, gangHua: 0 });
  const { assigned, pick, take } = picker(pack);
  const concealed = withThreePlusOne
    ? [405, 109, 110, 104, 101, 113].map(pick)
    : [107, 207, 307, 407, 110, 204, 108, 206].map(pick);
  const melds = withThreePlusOne
    ? [{ kind: 'peng' as const, cardIds: [105, 205, 305].map(pick) }]
    : [];
  const opponent = take(7);
  setZones(state, pack, assigned, { a: concealed, b: opponent }, { a: melds });
  setMelds(state, { a: melds });
  const incoming = withThreePlusOne ? concealed[3]! : concealed[7]!;
  prepareOwnWin(state, { kind: 'discard', userId: 'a', cardId: incoming, sourceSeat: 2 });
  return finishOwn(label, '26:0', state, ['fixture: 26:0, four-pairs/siGuiYi', 'engine.create -> legalActions -> apply']);
}

function gangPao(): CaseResult {
  const { state, pack } = fresh('26:0', { wangNum: 3, qiWangNum: 8, maxFan: 4,
    gangPao: 1, gangHua: 0, anDui: 0, siGuiYi: 0 });
  const { assigned, pick, take } = picker(pack);
  const peng = [106, 206, 306].map(pick);
  const aHand = [406, 109, 101, 113, 102, 103].map(pick);
  const bHand = [110, 309, 205, 201, 213, 207, 307].map(pick);
  const replacement = pick(104);
  const rest = pack.filter(card => !assigned.has(card.id)).map(card => card.id).filter(id => id !== replacement);
  setZones(state, pack, assigned, { a: aHand, b: bHand }, { a: [{ kind: 'peng', cardIds: peng }] });
  setMelds(state, { a: [{ kind: 'peng', cardIds: peng }] });
  state.activeId = 'a';
  state.phase = 'discard';
  state.source = { kind: 'replacement', userId: 'a', cardId: aHand[0]! };
  state.claims = null;
  const deck = state.cards.zones.find(zone => zone.id === 'deck')!;
  deck.cards = [replacement, ...rest];
  assertScoreRegionRound(state);

  const ba = scoreRegionLegalActions(state, 'a').find(candidate => candidate.type === 'ba' && candidate.cardId === aHand[0]!);
  assert.ok(ba, 'a must be able to add the drawn card to its exposed peng');
  const afterBa = applyScoreRegionAction(state, 'a', ba).snapshot as ScoreRegionRound;
  assert.equal(afterBa.source?.kind, 'replacement');
  assert.equal(afterBa.source?.afterGang, true);
  const discard = findDiscard(afterBa, 'a', replacement);
  const afterDiscard = applyScoreRegionAction(afterBa, 'a', discard).snapshot as ScoreRegionRound;
  assert.equal(afterDiscard.phase, 'response');
  assert.equal(afterDiscard.source?.afterGang, true);
  const hu = findResponseHu(afterDiscard, 'b');
  const result = applyScoreRegionAction(afterDiscard, 'b', hu);
  const finished = result.snapshot as ScoreRegionRound;
  assert.equal(finished.outcome?.winners[0]?.userId, 'b');
  return summarize('26 gang-pao', '26:0', finished, result,
    ['fixture: 26:0, exposed peng + replacement', 'legalActions(a): ba -> apply',
      'legalActions(a): discard replacement -> apply', 'legalActions(b): respond(hu) -> apply']);
}

const results = [
  ...case2527(),
  allFromOthers('25 all-from-others', '25:0'),
  allFromOthers('27 all-from-others', '27:0'),
  ganluoPair('26 an-dui dragons', 1, 0),
  ganluoPair('26 si-gui-yi exposed-three-plus-concealed', 0, 1, true),
  ganluoPair('26 si-gui-yi concealed quad without an-dui', 0, 1),
  ganluoPair('26 an-dui and si-gui-yi mutual exclusion', 1, 1),
  gangPao(),
];

for (const result of results) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
