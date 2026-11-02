import { randomInt } from 'node:crypto';
import { XINJIN_INDEPENDENT_VERSION } from '@dss/rules';
import type { EngineInteractions, EngineResult, RoundInput, RuleEngine } from '../engines.js';
import { requireCondition } from '../errors.js';
import { selectDeal, type FrozenPolicy } from '../policies.js';
import { createRoundOriginalAdapter } from './round-original.js';
import { createXinjinCardState } from './xinjin-pack.js';
import { xinjinDealEvaluation } from './xinjin-deal.js';
import { xinjinTestDeck } from './xinjin-scenarios.js';
import { isXinjinV2 } from './xinjin-win.js';
import { applyXinjinAction, assertXinjinOptionsSupported, createXinjinRound, viewXinjinRound, xinjinLegalActions, xinjinJiaoTishi, xinjinTurnSeconds, xinjinPoints, xinjinSettlementBrand,
  xinjinOpeningWindow, xinjinTimedAction, type XinjinAction, type XinjinEvent, type XinjinRound } from './xinjin-round.js';

export const XINJIN_ENGINE_VERSION = XINJIN_INDEPENDENT_VERSION;
export interface XinjinEngineSnapshot extends XinjinRound {
  deal: { version: 'xinjin-deal-v1'; policy: FrozenPolicy; candidates: number; evaluation: number[] };
  startEvents?: XinjinEvent[];
}

function dealerId(input: RoundInput): string {
  if (input.number === 1) return input.ownerUserId;
  const prior = input.previousRoundContext;
  requireCondition(prior?.version === XINJIN_INDEPENDENT_VERSION && prior.completedRound === input.number - 1 &&
    typeof prior.nextDealerId === 'string' && input.players.some(player => player.userId === prior.nextDealerId),
  'ROUND_CONTEXT_REQUIRED', 'A later round cannot choose a dealer without the prior context.', 409);
  return prior.nextDealerId;
}
/** 目标座位：开了策略的人；没人开就是庄家自己。政策里的用户必须坐在这一桌。 */
function selectedSeat(input: RoundInput, policy: FrozenPolicy, dealer: string): number {
  const userId = policy.selectedUserId ?? dealer;
  const player = input.players.find(item => item.userId === userId);
  requireCondition(player, 'INVALID_DEAL_POLICY', 'The selected deal policy belongs to another room.', 500);
  return player.seat;
}
function createSnapshot(input: RoundInput, random: (max: number) => number): XinjinEngineSnapshot {
  assertXinjinOptionsSupported(input.rules);
  const dealer = dealerId(input);
  // v2 第一局随机定庄，以后上局赢家当庄（流局不换）。本机测试台指定牌局时由它定庄。
  const test = input.testDeal;
  const first = test ? test.dealerUserId
    : input.number === 1 && isXinjinV2(input.rules) ? input.players[random(input.players.length)]!.userId : dealer;
  // 先定庄再挑牌：评分要按目标座位这一局实际拿到的那几张算，不能拿整副牌算。
  const dealerPlayer = input.players.find(item => item.userId === first);
  requireCondition(dealerPlayer, 'INVALID_ROUND_INPUT', 'The dealer must be seated.', 500);
  const dealerSeat = dealerPlayer.seat;
  const targetSeat = selectedSeat(input, input.policy, first);
  const playerNum = input.rules.playerNum as number;
  const pack = createXinjinCardState('4:0', input.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
  const selected = selectDeal(pack, input.policy,
    candidate => xinjinDealEvaluation(candidate, playerNum, dealerSeat, targetSeat), random);
  const round = createXinjinRound(input, test ? xinjinTestDeck(pack, test.hands, test.draws, input.players.length)
    : selected.deck.map(card => card.id), first);
  const deal = { version: 'xinjin-deal-v1' as const, policy: structuredClone(input.policy),
    candidates: selected.candidates, evaluation: [...selected.evaluation] };
  return advanceSystem({ ...round, deal }, null, deal).snapshot as XinjinEngineSnapshot;
}
function core(snapshot: unknown): XinjinEngineSnapshot {
  requireCondition(snapshot !== null && typeof snapshot === 'object' && 'version' in snapshot &&
    snapshot.version === XINJIN_ENGINE_VERSION && 'deal' in snapshot,
  'INVALID_XINJIN_SNAPSHOT', 'The snapshot does not belong to the frozen Xinjin engine.', 500);
  const state = snapshot as XinjinEngineSnapshot;
  assertXinjinOptionsSupported(state.rules);
  return state;
}
function systemAction(state: XinjinRound): { userId: string; action: XinjinAction } | null {
  if (state.phase === 'opening') {
    const actions = xinjinLegalActions(state, state.dealerId);
    // v2 先亮王补牌再看天胡（补完牌胡照样算天胡），所以开局一律先补牌。
    if (!isXinjinV2(state.rules) && actions.some(action => action.type === 'hu')) return null;
    const begin = actions.find(action => action.type === 'begin');
    return begin ? { userId: state.dealerId, action: begin } : null;
  }
  if (state.phase !== 'draw') return null;
  const actions = xinjinLegalActions(state, state.activeId);
  if (actions.some(action => action.type !== 'draw')) return null;
  const draw = actions.find(action => action.type === 'draw');
  return draw ? { userId: state.activeId, action: draw } : null;
}
function advanceSystem(initial: XinjinEngineSnapshot, initialResult: EngineResult | null, deal: XinjinEngineSnapshot['deal']) {
  let snapshot = initial, result = initialResult;
  const events: XinjinEvent[] = [...(initialResult?.events ?? [])] as XinjinEvent[];
  let guard = 0;
  while (!result?.settlement) {
    requireCondition(guard++ < 2000, 'INVALID_XINJIN_STATE', 'System turn advancement did not terminate.', 500);
    const next = systemAction(snapshot);
    if (!next) break;
    const applied = applyXinjinAction(snapshot, next.userId, next.action);
    events.push(...(applied.events as XinjinEvent[]));
    snapshot = { ...(applied.snapshot as XinjinRound), deal: structuredClone(deal) };
    result = applied;
  }
  if (initialResult === null) return { snapshot: { ...snapshot, deal: structuredClone(deal), startEvents: events }, result: null };
  return { snapshot: { ...(result!.snapshot as XinjinRound), deal: structuredClone(deal) },
    result: { ...result!, events, snapshot: { ...(result!.snapshot as XinjinRound), deal: structuredClone(deal) } } };
}
export function createXinjinEngine(referenceDigest: string, random: (max: number) => number = randomInt): RuleEngine {
  requireCondition(typeof referenceDigest === 'string' && referenceDigest.length > 0,
    'INVALID_ENGINE_EVIDENCE', 'A reference digest is required.', 500);
  const interactions: EngineInteractions = {
    responseWindow(snapshot, userId) {
      const state = core(snapshot);
      const opening = xinjinOpeningWindow(state, userId);
      if (opening) return opening;
      if (!state.claims || state.claims.replies.some(reply => reply.userId === userId)) return null;
      return state.claims.offers.some(offer => offer.userId === userId) ? state.claims.id : null;
    },
    legalActions(snapshot, userId) { return xinjinLegalActions(core(snapshot), userId); },
    deadlines(snapshot) {
      const state = core(snapshot);
      return state.players.flatMap(player => {
        const timed = xinjinTimedAction(state, player.userId);
        return timed ? [timed] : [];
      });
    },
    autoPlay(snapshot, userId) {
      const timed = xinjinTimedAction(core(snapshot), userId);
      return timed ? { decisionId: timed.decisionId, delayMs: timed.delayMs, action: timed.action } : null;
    },
  };
  return { variantKey: '4:0', version: XINJIN_ENGINE_VERSION, evidence: { status: 'verified', referenceDigest },
    create(input) { return createSnapshot(input, random); },
    apply(snapshot, userId, action): EngineResult {
      const state = core(snapshot);
      const result = applyXinjinAction(state, userId, action);
      const advanced = advanceSystem({ ...(result.snapshot as XinjinRound), deal: structuredClone(state.deal) }, result, state.deal);
      return advanced.result as EngineResult;
    },
    view(snapshot, userId) { return viewXinjinRound(core(snapshot), userId); }, interactions,
    original: createRoundOriginalAdapter({
      label: 'Xinjin',
      decisionPrefix: 'xj',
      legalActions: (snapshot, userId) => xinjinLegalActions(core(snapshot), userId),
      settlement: (snapshot, userId) => xinjinSettlementBrand(core(snapshot), userId),
      points: (snapshot, userId) => xinjinPoints(core(snapshot), userId),
      jiaoTishi: (snapshot, userId) => xinjinJiaoTishi(core(snapshot), userId),
      turnSeconds: snapshot => xinjinTurnSeconds(core(snapshot)),
    }) };
}
