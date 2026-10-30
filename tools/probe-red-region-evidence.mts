import { getDefaultOptions, SCORE_REGION_VERSIONS } from '../packages/rules/src/index.ts';
import type { RoundInput } from '../apps/server/src/engines.ts';
import { createScoreRegionCardState } from '../apps/server/src/game/score-region-pack.ts';
import { applyScoreRegionAction, assertScoreRegionRound, createScoreRegionRound,
  scoreRegionLegalActions, type ScoreRegionRound } from '../apps/server/src/game/score-region-round.ts';

function rules(variantKey: keyof typeof SCORE_REGION_VERSIONS, overrides: Record<string, unknown> = {}) {
  return { ...getDefaultOptions(variantKey), playerNum: 2, baseBeans: '0.1', ...overrides,
    scoreRegion: { rulesVersion: SCORE_REGION_VERSIONS[variantKey] } };
}

function fixture(variantKey: keyof typeof SCORE_REGION_VERSIONS, roundRules: Record<string, unknown>,
  pickCodes: number[], opponentCodes: number[], configure?: (state: ScoreRegionRound) => void) {
  const input: RoundInput = {
    players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
    ownerUserId: 'a', number: 1, rules: roundRules,
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
  };
  const pack = createScoreRegionCardState(variantKey, roundRules, 'deck', [
    { id: 'deck', visibility: 'hidden' },
  ]).pack;
  const state = createScoreRegionRound(input, pack.map(card => card.id), variantKey);
  const assigned = new Set<string>();
  const pick = (code: number) => {
    const card = pack.find(item => item.code === code && !assigned.has(item.id));
    if (!card) throw new Error(`${variantKey} missing card ${code}`);
    assigned.add(card.id);
    return card.id;
  };
  const concealed = pickCodes.map(pick);
  const opponent = opponentCodes.map(pick);
  state.cards.zones = [
    { id: 'deck', visibility: 'hidden', cards: pack.filter(card => !assigned.has(card.id)).map(card => card.id) },
    { id: 'table', visibility: 'public', cards: [] },
    { id: 'discards', visibility: 'public', cards: [] },
    { id: 'hand:a', visibility: 'private', ownerId: 'a', cards: concealed },
    { id: 'melds:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'bonus:a', visibility: 'public', ownerId: 'a', cards: [] },
    { id: 'hand:b', visibility: 'private', ownerId: 'b', cards: opponent },
    { id: 'melds:b', visibility: 'public', ownerId: 'b', cards: [] },
    { id: 'bonus:b', visibility: 'public', ownerId: 'b', cards: [] },
  ];
  state.activeId = 'a';
  state.phase = 'discard';
  state.source = { kind: 'replacement', userId: 'a', cardId: concealed[0]! };
  state.claims = null;
  configure?.(state);
  assertScoreRegionRound(state);
  return state;
}

function result(state: ScoreRegionRound, label: string) {
  const hu = scoreRegionLegalActions(state, 'a').find(action => action.type === 'hu');
  if (!hu) { console.log(JSON.stringify({ label, error: 'no hu', actions: scoreRegionLegalActions(state, 'a') })); return; }
  const applied = applyScoreRegionAction(state, 'a', hu);
  const outcome = (applied.snapshot as ScoreRegionRound).outcome!;
  console.log(JSON.stringify({ label, settlement: applied.settlement, winner: outcome.winners[0] }));
}

// 25/27 common hand: four pair groups, red/black counts and special patterns.
result(fixture('25:0', rules('25:0', { wangNum: 0, baseBeans: '0.1' }),
  [110, 104, 309, 205, 201, 213, 206, 208],
  [101, 102, 103, 107, 111, 112, 113]), '25 default');

result(fixture('27:0', rules('27:0', { wangNum: 0, baseBeans: '0.1' }),
  [110, 104, 309, 205, 201, 213, 206, 208],
  [101, 102, 103, 107, 111, 112, 113]), '27 default');

result(fixture('26:0', rules('26:0', { wangNum: 0, qiWangNum: 4, baseBeans: '0.1', anDui: 0, siGuiYi: 0 }),
  [110, 104, 309, 205, 201, 213, 206, 208],
  [101, 102, 103, 107, 111, 112, 113]), '26 default');
