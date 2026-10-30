import { randomInt } from 'node:crypto';
import { PUJIANG_INDEPENDENT_VERSION } from '@dss/rules';
import type { EngineInteractions, EngineResult, RoundInput, RuleEngine } from '../engines.js';
import { requireCondition } from '../errors.js';
import { selectDeal, type FrozenPolicy } from '../policies.js';
import { createRoundOriginalAdapter } from './round-original.js';
import { createPujiangCardState } from './pujiang-pack.js';
import { applyPujiangAction, createPujiangRound, pujiangLegalActions, pujiangTimedAction,
  viewPujiangRound, type PujiangAction, type PujiangEvent, type PujiangRound } from './pujiang-round.js';

export const PUJIANG_ENGINE_VERSION = PUJIANG_INDEPENDENT_VERSION;
export interface PujiangEngineSnapshot extends PujiangRound {
  deal: { version: 'pujiang-deal-v1'; policy: FrozenPolicy; candidates: number; evaluation: number[] };
  startEvents?: PujiangEvent[];
}

function dealerId(input: RoundInput): string {
  if (input.number === 1) return input.ownerUserId;
  const prior = input.previousRoundContext;
  requireCondition(prior?.version === PUJIANG_INDEPENDENT_VERSION && prior.completedRound === input.number - 1 &&
    typeof prior.nextDealerId === 'string' && input.players.some(player => player.userId === prior.nextDealerId),
  'ROUND_CONTEXT_REQUIRED', 'A later round cannot choose a dealer without the prior context.', 409);
  return prior.nextDealerId;
}

function dealEvaluation(candidate: readonly { code: number }[]) {
  const ordinary = candidate.filter(card => ![1001, 1002, 1003].includes(card.code));
  const red = ordinary.filter(card => [1, 3].includes(Math.floor(card.code / 100)));
  return [ordinary.length, red.reduce((sum, card) => sum + Math.min(card.code % 100, 10), 0)];
}

function createSnapshot(input: RoundInput, random: (max: number) => number): PujiangEngineSnapshot {
  const pack = createPujiangCardState('7:0', input.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  const selected = selectDeal(pack, input.policy, dealEvaluation, random);
  const round = createPujiangRound(input, selected.deck.map(card => card.id));
  const deal = { version: 'pujiang-deal-v1' as const, policy: structuredClone(input.policy),
    candidates: selected.candidates, evaluation: [...selected.evaluation] };
  return advanceSystem({ ...round, deal }, null, deal).snapshot as PujiangEngineSnapshot;
}

function core(snapshot: unknown): PujiangEngineSnapshot {
  requireCondition(snapshot !== null && typeof snapshot === 'object' && 'version' in snapshot &&
    snapshot.version === PUJIANG_ENGINE_VERSION && 'deal' in snapshot,
  'INVALID_PUJIANG_SNAPSHOT', 'The snapshot does not belong to the frozen Pujiang engine.', 500);
  return snapshot as PujiangEngineSnapshot;
}

function systemAction(state: PujiangRound): { userId: string; action: PujiangAction } | null {
  if (state.phase === 'opening') {
    const actions = pujiangLegalActions(state, state.dealerId);
    if (actions.some(action => action.type === 'hu')) return null;
    const begin = actions.find(action => action.type === 'begin');
    return begin ? { userId: state.dealerId, action: begin } : null;
  }
  if (state.phase !== 'draw') return null;
  const actions = pujiangLegalActions(state, state.activeId);
  if (actions.some(action => action.type !== 'draw')) return null;
  const draw = actions.find(action => action.type === 'draw');
  return draw ? { userId: state.activeId, action: draw } : null;
}

function advanceSystem(initial: PujiangEngineSnapshot, initialResult: EngineResult | null, deal: PujiangEngineSnapshot['deal']) {
  let snapshot = initial, result = initialResult;
  const events: PujiangEvent[] = [...(initialResult?.events ?? [])] as PujiangEvent[];
  let guard = 0;
  while (!result?.settlement) {
    requireCondition(guard++ < 2000, 'INVALID_PUJIANG_STATE', 'System turn advancement did not terminate.', 500);
    const next = systemAction(snapshot);
    if (!next) break;
    const applied = applyPujiangAction(snapshot, next.userId, next.action);
    events.push(...(applied.events as PujiangEvent[]));
    snapshot = { ...(applied.snapshot as PujiangRound), deal: structuredClone(deal) };
    result = applied;
  }
  if (initialResult === null) return { snapshot: { ...snapshot, deal: structuredClone(deal), startEvents: events }, result: null };
  return { snapshot: { ...(result!.snapshot as PujiangRound), deal: structuredClone(deal) },
    result: { ...result!, events, snapshot: { ...(result!.snapshot as PujiangRound), deal: structuredClone(deal) } } };
}

export function createPujiangEngine(referenceDigest: string, random: (max: number) => number = randomInt): RuleEngine {
  requireCondition(typeof referenceDigest === 'string' && referenceDigest.length > 0,
    'INVALID_ENGINE_EVIDENCE', 'A reference digest is required.', 500);
  const interactions: EngineInteractions = {
    responseWindow(snapshot, userId) {
      const state = core(snapshot);
      if (!state.claims || state.claims.replies.some(reply => reply.userId === userId)) return null;
      return state.claims.offers.some(offer => offer.userId === userId) ? state.claims.id : null;
    },
    legalActions(snapshot, userId) { return pujiangLegalActions(core(snapshot), userId); },
    deadlines(snapshot) {
      const state = core(snapshot);
      return state.players.flatMap(player => {
        const timed = pujiangTimedAction(state, player.userId);
        return timed ? [timed] : [];
      });
    },
    autoPlay(snapshot, userId) {
      const timed = pujiangTimedAction(core(snapshot), userId);
      return timed ? { decisionId: timed.decisionId, delayMs: timed.delayMs, action: timed.action } : null;
    },
  };
  return { variantKey: '7:0', version: PUJIANG_ENGINE_VERSION, evidence: { status: 'verified', referenceDigest },
    create(input) { return createSnapshot(input, random); },
    apply(snapshot, userId, action): EngineResult {
      const state = core(snapshot);
      const result = applyPujiangAction(state, userId, action);
      const advanced = advanceSystem({ ...(result.snapshot as PujiangRound), deal: structuredClone(state.deal) }, result, state.deal);
      return advanced.result as EngineResult;
    },
    view(snapshot, userId) { return viewPujiangRound(core(snapshot), userId); }, interactions,
    original: createRoundOriginalAdapter({
      label: 'Pujiang',
      decisionPrefix: 'pj',
      legalActions: (snapshot, userId) => pujiangLegalActions(core(snapshot), userId),
    }) };
}
