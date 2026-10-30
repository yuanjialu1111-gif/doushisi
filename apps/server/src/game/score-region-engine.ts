import { randomInt } from 'node:crypto';
import { SCORE_REGION_VERSIONS } from '@dss/rules';
import type { EngineInteractions, EngineResult, RoundInput, RuleEngine } from '../engines.js';
import { requireCondition } from '../errors.js';
import { selectDeal, type FrozenPolicy } from '../policies.js';
import { createRoundOriginalAdapter } from './round-original.js';
import { createScoreRegionCardState } from './score-region-pack.js';
import { applyScoreRegionAction, createScoreRegionRound, scoreRegionLegalActions,
  scoreRegionTimedAction, viewScoreRegionRound, type ScoreRegionAction, type ScoreRegionEvent,
  type ScoreRegionRound } from './score-region-round.js';

export interface ScoreRegionEngineSnapshot extends ScoreRegionRound {
  deal: { version: 'score-region-deal-v1'; policy: FrozenPolicy; candidates: number; evaluation: number[] };
  startEvents?: ScoreRegionEvent[];
}

function dealEvaluation(candidate: readonly { code: number }[]) {
  const ordinary = candidate.filter(card => ![1001, 1002, 1003].includes(card.code));
  const red = ordinary.filter(card => [1, 3].includes(Math.floor(card.code / 100)));
  return [ordinary.length, red.reduce((sum, card) => sum + Math.min(card.code % 100, 10), 0)];
}
function createSnapshot(input: RoundInput, random: (max: number) => number,
  variantKey: keyof typeof SCORE_REGION_VERSIONS): ScoreRegionEngineSnapshot {
  const pack = createScoreRegionCardState(variantKey, input.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  const selected = selectDeal(pack, input.policy, dealEvaluation, random);
  const round = createScoreRegionRound(input, selected.deck.map(card => card.id), variantKey);
  const deal = { version: 'score-region-deal-v1' as const, policy: structuredClone(input.policy),
    candidates: selected.candidates, evaluation: [...selected.evaluation] };
  return advanceSystem({ ...round, deal }, null, deal).snapshot as ScoreRegionEngineSnapshot;
}
function core(snapshot: unknown, variantKey: keyof typeof SCORE_REGION_VERSIONS): ScoreRegionEngineSnapshot {
  requireCondition(snapshot !== null && typeof snapshot === 'object' && 'variantKey' in snapshot &&
    snapshot.variantKey === variantKey && 'version' in snapshot &&
    snapshot.version === SCORE_REGION_VERSIONS[variantKey] && 'deal' in snapshot &&
    (snapshot as { deal?: { version?: unknown } }).deal?.version === 'score-region-deal-v1',
  'INVALID_SCORE_REGION_SNAPSHOT', 'The snapshot does not belong to a frozen score-region engine.', 500);
  return snapshot as ScoreRegionEngineSnapshot;
}
function systemAction(state: ScoreRegionRound): { userId: string; action: ScoreRegionAction } | null {
  if (state.phase === 'piao') return null;
  if (state.phase === 'opening') {
    const actions = scoreRegionLegalActions(state, state.dealerId);
    if (actions.some(action => action.type === 'hu')) return null;
    const begin = actions.find(action => action.type === 'begin');
    return begin ? { userId: state.dealerId, action: begin } : null;
  }
  if (state.phase !== 'draw') return null;
  const actions = scoreRegionLegalActions(state, state.activeId);
  if (actions.some(action => action.type !== 'draw')) return null;
  const draw = actions.find(action => action.type === 'draw');
  return draw ? { userId: state.activeId, action: draw } : null;
}
function advanceSystem(initial: ScoreRegionEngineSnapshot, initialResult: EngineResult | null,
  deal: ScoreRegionEngineSnapshot['deal']) {
  let snapshot = initial, result = initialResult;
  const events: ScoreRegionEvent[] = [...(initialResult?.events ?? [])] as ScoreRegionEvent[];
  let guard = 0;
  while (!result?.settlement) {
    requireCondition(guard++ < 2000, 'INVALID_SCORE_REGION_STATE', 'System turn advancement did not terminate.', 500);
    const next = systemAction(snapshot);
    if (!next) break;
    const applied = applyScoreRegionAction(snapshot, next.userId, next.action);
    events.push(...(applied.events as ScoreRegionEvent[]));
    snapshot = { ...(applied.snapshot as ScoreRegionRound), deal: structuredClone(deal) };
    result = applied;
  }
  if (initialResult === null) return { snapshot: { ...snapshot, deal: structuredClone(deal), startEvents: events }, result: null };
  return { snapshot: { ...(result!.snapshot as ScoreRegionRound), deal: structuredClone(deal) },
    result: { ...result!, events, snapshot: { ...(result!.snapshot as ScoreRegionRound), deal: structuredClone(deal) } } };
}
export function createScoreRegionEngine(referenceDigest: string, variantKey: keyof typeof SCORE_REGION_VERSIONS,
  random: (max: number) => number = randomInt): RuleEngine {
  requireCondition(typeof referenceDigest === 'string' && referenceDigest.length > 0,
    'INVALID_ENGINE_EVIDENCE', 'A reference digest is required.', 500);
  const interactions: EngineInteractions = {
    responseWindow(snapshot, userId) {
      const state = core(snapshot, variantKey);
      if (state.phase === 'piao') {
        return state.players.some(player => player.userId === userId && player.piao === null)
          ? `sr:${state.number}:${state.serial}` : null;
      }
      if (!state.claims || state.claims.replies.some(reply => reply.userId === userId)) return null;
      return state.claims.offers.some(offer => offer.userId === userId) ? state.claims.id : null;
    },
    legalActions(snapshot, userId) { return scoreRegionLegalActions(core(snapshot, variantKey), userId); },
    deadlines(snapshot) {
      const state = core(snapshot, variantKey);
      return state.players.flatMap(player => {
        const timed = scoreRegionTimedAction(state, player.userId);
        return timed ? [timed] : [];
      });
    },
    autoPlay(snapshot, userId) {
      const timed = scoreRegionTimedAction(core(snapshot, variantKey), userId);
      return timed ? { decisionId: timed.decisionId, delayMs: timed.delayMs, action: timed.action } : null;
    },
  };
  return { variantKey, version: SCORE_REGION_VERSIONS[variantKey],
    evidence: { status: 'verified', referenceDigest },
    create(input) { return createSnapshot(input, random, variantKey); },
    apply(snapshot, userId, action): EngineResult {
      const state = core(snapshot, variantKey);
      const result = applyScoreRegionAction(state, userId, action);
      const advanced = advanceSystem({ ...(result.snapshot as ScoreRegionRound), deal: structuredClone(state.deal) },
        result, state.deal);
      return advanced.result as EngineResult;
    },
    view(snapshot, userId) { return viewScoreRegionRound(core(snapshot, variantKey), userId); }, interactions,
    original: createRoundOriginalAdapter({
      label: variantKey, decisionPrefix: 'sr',
      legalActions: (snapshot, userId) => scoreRegionLegalActions(core(snapshot, variantKey), userId),
      supportsPiao: variantKey === '23:0',
    }) };
}
