import { randomInt } from 'node:crypto';
import { QIONGLAI_INDEPENDENT_VERSION } from '@dss/rules';
import type { EngineInteractions, EngineResult, RoundInput, RuleEngine } from '../engines.js';
import { requireCondition } from '../errors.js';
import { selectDeal, type FrozenPolicy } from '../policies.js';
import { createQionglaiCardState } from './qionglai-pack.js';
import { qionglaiDealHand } from './qionglai-deal.js';
import { createQionglaiOriginalAdapter } from './qionglai-original.js';
import { applyQionglaiAction, createQionglaiRound, qionglaiLegalActions, qionglaiTimedAction,
  viewQionglaiRound, type QionglaiAction, type QionglaiEvent, type QionglaiRound } from './qionglai-round.js';

export const QIONGLAI_ENGINE_VERSION = QIONGLAI_INDEPENDENT_VERSION;
export interface QionglaiEngineSnapshot extends QionglaiRound {
  deal: {
    version: 'qionglai-deal-v1';
    policy: FrozenPolicy;
    candidates: number;
    evaluation: number[];
  };
  /** Startup system events retained for the first original-client projection. */
  startEvents?: QionglaiEvent[];
}

function dealerId(input: RoundInput): string {
  if (input.number === 1) return input.ownerUserId;
  const prior = input.previousRoundContext;
  requireCondition(prior?.version === QIONGLAI_INDEPENDENT_VERSION && prior.completedRound === input.number - 1 &&
    typeof prior.nextDealerId === 'string' && input.players.some(player => player.userId === prior.nextDealerId),
  'ROUND_CONTEXT_REQUIRED', 'A later round cannot choose a dealer without the prior context.', 409);
  return prior.nextDealerId;
}

function selectedSeat(input: RoundInput, policy: FrozenPolicy, dealer: string): number {
  const seat = policy.selectedUserId === null ? dealer : policy.selectedUserId;
  const player = input.players.find(item => item.userId === seat);
  requireCondition(player, 'INVALID_DEAL_POLICY', 'The selected deal policy belongs to another room.', 500);
  return player.seat;
}

function createSnapshot(input: RoundInput, random: (max: number) => number): QionglaiEngineSnapshot {
  const dealer = dealerId(input);
  const pack = createQionglaiCardState('8:0', input.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  const dealerSeat = input.players.find(player => player.userId === dealer)!.seat;
  const targetSeat = selectedSeat(input, input.policy, dealer);
  const selected = selectDeal(pack, input.policy,
    candidate => qionglaiDealHand(candidate, input.rules.playerNum as number, dealerSeat, targetSeat), random);
  const round = createQionglaiRound(input, selected.deck.map(card => card.id));
  const deal = { version: 'qionglai-deal-v1' as const, policy: structuredClone(input.policy),
    candidates: selected.candidates, evaluation: [...selected.evaluation] };
  return advanceSystem({ ...round, deal }, null, deal).snapshot as QionglaiEngineSnapshot;
}

function core(snapshot: unknown): QionglaiEngineSnapshot {
  requireCondition(snapshot !== null && typeof snapshot === 'object' && 'version' in snapshot &&
    snapshot.version === QIONGLAI_ENGINE_VERSION && 'deal' in snapshot,
  'INVALID_QIONGLAI_SNAPSHOT', 'The snapshot does not belong to the frozen Qionglai engine.', 500);
  return snapshot as QionglaiEngineSnapshot;
}

function systemAction(state: QionglaiRound): { userId: string; action: QionglaiAction } | null {
  if (state.phase === 'opening') {
    const actions = qionglaiLegalActions(state, state.dealerId);
    if (actions.some(action => action.type === 'hu')) return null;
    const begin = actions.find(action => action.type === 'begin');
    return begin ? { userId: state.dealerId, action: begin } : null;
  }
  if (state.phase !== 'draw') return null;
  const actions = qionglaiLegalActions(state, state.activeId);
  if (actions.some(action => action.type !== 'draw')) return null;
  const draw = actions.find(action => action.type === 'draw');
  return draw ? { userId: state.activeId, action: draw } : null;
}

function advanceSystem(
  initial: QionglaiEngineSnapshot, initialResult: EngineResult | null, deal: QionglaiEngineSnapshot['deal'],
) {
  let snapshot = initial;
  let result = initialResult;
  const events: QionglaiEvent[] = [...(initialResult?.events ?? [])] as QionglaiEvent[];
  let guard = 0;
  while (!result?.settlement) {
    requireCondition(guard++ < 1000, 'INVALID_QIONGLAI_STATE', 'System turn advancement did not terminate.', 500);
    const next = systemAction(snapshot);
    if (!next) break;
    const applied = applyQionglaiAction(snapshot, next.userId, next.action);
    events.push(...(applied.events as QionglaiEvent[]));
    snapshot = { ...(applied.snapshot as QionglaiRound), deal: structuredClone(deal) };
    result = applied;
  }
  if (initialResult === null) {
    return { snapshot: { ...snapshot, deal: structuredClone(deal), startEvents: events }, result: null };
  }
  if (!result) return { snapshot: { ...(snapshot as QionglaiRound), deal: structuredClone(deal) },
    result: { snapshot: { ...(snapshot as QionglaiRound), deal: structuredClone(deal) }, events } };
  return { snapshot: { ...(result.snapshot as QionglaiRound), deal: structuredClone(deal) },
    result: { ...result, events, snapshot: { ...(result.snapshot as QionglaiRound), deal: structuredClone(deal) } } };
}

export function createQionglaiEngine(referenceDigest: string, random: (max: number) => number = randomInt): RuleEngine {
  requireCondition(typeof referenceDigest === 'string' && referenceDigest.length > 0,
    'INVALID_ENGINE_EVIDENCE', 'A reference digest is required.', 500);
  const interactions: EngineInteractions = {
    responseWindow(snapshot, userId) {
      const state = core(snapshot);
      if (!state.claims || state.claims.replies.some(reply => reply.userId === userId)) return null;
      return state.claims.offers.some(offer => offer.userId === userId) ? state.claims.id : null;
    },
    legalActions(snapshot, userId) { return qionglaiLegalActions(core(snapshot), userId); },
    deadlines(snapshot) {
      const state = core(snapshot);
      return state.players.flatMap(player => {
        const timed = qionglaiTimedAction(state, player.userId);
        return timed ? [timed] : [];
      });
    },
    autoPlay(snapshot, userId) {
      const timed = qionglaiTimedAction(core(snapshot), userId);
      return timed ? { decisionId: timed.decisionId, delayMs: timed.delayMs, action: timed.action } : null;
    },
  };
  return {
    variantKey: '8:0',
    version: QIONGLAI_ENGINE_VERSION,
    evidence: { status: 'verified', referenceDigest },
    create(input) { return createSnapshot(input, random); },
    apply(snapshot, userId, action): EngineResult {
      const state = core(snapshot);
      const result = applyQionglaiAction(state, userId, action);
      const advanced = advanceSystem({ ...(result.snapshot as QionglaiRound), deal: structuredClone(state.deal) }, result, state.deal);
      return advanced.result as EngineResult;
    },
    view(snapshot, userId) { return viewQionglaiRound(core(snapshot), userId); },
    interactions,
    original: createQionglaiOriginalAdapter(),
  };
}
