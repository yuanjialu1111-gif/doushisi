import { randomInt } from 'node:crypto';
import { ABA_INDEPENDENT_VERSIONS } from '@dss/rules';
import type { EngineInteractions, EngineResult, RoundInput, RuleEngine } from '../engines.js';
import { requireCondition } from '../errors.js';
import { selectDeal, type FrozenPolicy } from '../policies.js';
import { createRoundOriginalAdapter } from './round-original.js';
import { createAbaCardState } from './aba-pack.js';
import { abaTimedAction, abaLegalActions, applyAbaAction, createAbaRound, viewAbaRound,
  type AbaAction, type AbaEvent, type AbaRound } from './aba-round.js';

export const ABA_ENGINE_VERSION = ABA_INDEPENDENT_VERSIONS['9:0'];
export const ABA10_ENGINE_VERSION = ABA_INDEPENDENT_VERSIONS['10:0'];
export interface AbaEngineSnapshot extends AbaRound {
  deal: { version: 'aba-deal-v1'; policy: FrozenPolicy; candidates: number; evaluation: number[] };
  startEvents?: AbaEvent[];
}

function dealerId(input: RoundInput, version: string): string {
  if (input.number === 1) return input.ownerUserId;
  const prior = input.previousRoundContext;
  requireCondition(prior?.version === version && prior.completedRound === input.number - 1 &&
    typeof prior.nextDealerId === 'string' && input.players.some(player => player.userId === prior.nextDealerId),
  'ROUND_CONTEXT_REQUIRED', 'A later round cannot choose a dealer without the prior context.', 409);
  return prior.nextDealerId;
}
function dealEvaluation(candidate: readonly { code: number }[]) {
  const ordinary = candidate.filter(card => ![1001, 1002, 1003].includes(card.code));
  const red = ordinary.filter(card => [1, 3].includes(Math.floor(card.code / 100)));
  return [ordinary.length, red.reduce((sum, card) => sum + Math.min(card.code % 100, 10), 0)];
}
function createSnapshot(input: RoundInput, random: (max: number) => number,
  variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS): AbaEngineSnapshot {
  const pack = createAbaCardState(variantKey, input.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  const selected = selectDeal(pack, input.policy, dealEvaluation, random);
  const round = createAbaRound(input, selected.deck.map(card => card.id), variantKey);
  const deal = { version: 'aba-deal-v1' as const, policy: structuredClone(input.policy),
    candidates: selected.candidates, evaluation: [...selected.evaluation] };
  return advanceSystem({ ...round, deal }, null, deal).snapshot as AbaEngineSnapshot;
}
function core(snapshot: unknown, variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS): AbaEngineSnapshot {
  requireCondition(snapshot !== null && typeof snapshot === 'object' && 'variantKey' in snapshot &&
    snapshot.variantKey === variantKey && 'version' in snapshot &&
    snapshot.version === ABA_INDEPENDENT_VERSIONS[variantKey] && 'deal' in snapshot &&
    (snapshot as { deal?: { version?: unknown } }).deal?.version === 'aba-deal-v1',
  'INVALID_ABA_SNAPSHOT', 'The snapshot does not belong to the frozen Aba engine.', 500);
  return snapshot as AbaEngineSnapshot;
}
function systemAction(state: AbaRound): { userId: string; action: AbaAction } | null {
  if (state.phase === 'opening') {
    const actions = abaLegalActions(state, state.dealerId);
    if (actions.some(action => action.type === 'hu')) return null;
    const begin = actions.find(action => action.type === 'begin');
    return begin ? { userId: state.dealerId, action: begin } : null;
  }
  if (state.phase !== 'draw') return null;
  const actions = abaLegalActions(state, state.activeId);
  if (actions.some(action => action.type !== 'draw')) return null;
  const draw = actions.find(action => action.type === 'draw');
  return draw ? { userId: state.activeId, action: draw } : null;
}
function advanceSystem(initial: AbaEngineSnapshot, initialResult: EngineResult | null, deal: AbaEngineSnapshot['deal']) {
  let snapshot = initial, result = initialResult;
  const events: AbaEvent[] = [...(initialResult?.events ?? [])] as AbaEvent[];
  let guard = 0;
  while (!result?.settlement) {
    requireCondition(guard++ < 2000, 'INVALID_ABA_STATE', 'System turn advancement did not terminate.', 500);
    const next = systemAction(snapshot);
    if (!next) break;
    const applied = applyAbaAction(snapshot, next.userId, next.action);
    events.push(...(applied.events as AbaEvent[]));
    snapshot = { ...(applied.snapshot as AbaRound), deal: structuredClone(deal) };
    result = applied;
  }
  if (initialResult === null) return { snapshot: { ...snapshot, deal: structuredClone(deal), startEvents: events }, result: null };
  return { snapshot: { ...(result!.snapshot as AbaRound), deal: structuredClone(deal) },
    result: { ...result!, events, snapshot: { ...(result!.snapshot as AbaRound), deal: structuredClone(deal) } } };
}
export function createAbaEngine(
  referenceDigest: string, random: (max: number) => number = randomInt,
  variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS = '9:0',
): RuleEngine {
  requireCondition(typeof referenceDigest === 'string' && referenceDigest.length > 0,
    'INVALID_ENGINE_EVIDENCE', 'A reference digest is required.', 500);
  const interactions: EngineInteractions = {
    responseWindow(snapshot, userId) {
      const state = core(snapshot, variantKey);
      if (!state.claims || state.claims.replies.some(reply => reply.userId === userId)) return null;
      return state.claims.offers.some(offer => offer.userId === userId) ? state.claims.id : null;
    },
    legalActions(snapshot, userId) { return abaLegalActions(core(snapshot, variantKey), userId); },
    deadlines(snapshot) {
      const state = core(snapshot, variantKey);
      return state.players.flatMap(player => {
        const timed = abaTimedAction(state, player.userId);
        return timed ? [timed] : [];
      });
    },
    autoPlay(snapshot, userId) {
      const timed = abaTimedAction(core(snapshot, variantKey), userId);
      return timed ? { decisionId: timed.decisionId, delayMs: timed.delayMs, action: timed.action } : null;
    },
  };
  return { variantKey, version: ABA_INDEPENDENT_VERSIONS[variantKey], evidence: { status: 'verified', referenceDigest },
    create(input) { return createSnapshot(input, random, variantKey); },
    apply(snapshot, userId, action): EngineResult {
      const state = core(snapshot, variantKey);
      const result = applyAbaAction(state, userId, action);
      const advanced = advanceSystem({ ...(result.snapshot as AbaRound), deal: structuredClone(state.deal) }, result, state.deal);
      return advanced.result as EngineResult;
    },
    view(snapshot, userId) { return viewAbaRound(core(snapshot, variantKey), userId); }, interactions,
    original: createRoundOriginalAdapter({
      label: 'Aba',
      decisionPrefix: 'ab',
      legalActions: (snapshot, userId) => abaLegalActions(core(snapshot, variantKey), userId),
    }) };
}
