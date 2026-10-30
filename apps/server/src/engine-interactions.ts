import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { EngineTimedAction, RuleEngine } from './engines.js';
import { requireCondition } from './errors.js';

export interface ScheduledEngineAction extends EngineTimedAction {
  id: string;
  kind: 'timeout' | 'autoplay';
  dueAt: number;
}
export interface InteractionState {
  format: 1;
  revision: number;
  atMs: number;
  autoPlayUserIds: string[];
  timers: ScheduledEngineAction[];
  responseWindows?: Record<string, { id: string; openedAtVersion: number; actions: unknown[] }>;
}

function serializableAction(action: unknown): void {
  let restored: unknown;
  try { restored = JSON.parse(JSON.stringify(action)); } catch { restored = undefined; }
  requireCondition(restored !== undefined && isDeepStrictEqual(action, restored), 'INVALID_ENGINE_INTERACTIONS',
    'Engine actions must be losslessly serializable JSON.', 500);
}

export function engineLegalActions(engine: RuleEngine, snapshot: unknown, userId: string): unknown[] {
  requireCondition(engine.interactions, 'ENGINE_INTERACTIONS_UNAVAILABLE', 'This archived engine does not provide legal-action controls.', 409);
  const actions = engine.interactions.legalActions(structuredClone(snapshot), userId);
  requireCondition(Array.isArray(actions), 'INVALID_ENGINE_INTERACTIONS', 'Legal actions must be an array.', 500);
  for (const action of actions) serializableAction(action);
  return structuredClone(actions);
}

export function requireLegalAction(engine: RuleEngine, snapshot: unknown, userId: string, action: unknown): void {
  requireCondition(engineLegalActions(engine, snapshot, userId).some(candidate => isDeepStrictEqual(candidate, action)),
    'ILLEGAL_ACTION', 'The action is not currently available to this player.', 409);
}

export const nextScheduledAt = (state: InteractionState | null): number | null => state?.timers[0]?.dueAt ?? null;
export const finishInteractions = (state: InteractionState, atMs: number): InteractionState => ({ ...state, revision: state.revision + 1, atMs, timers: [],
  ...(state.responseWindows ? { responseWindows: {} } : {}) });
const timerKey = (timer: Pick<ScheduledEngineAction, 'kind' | 'userId' | 'decisionId'>) => JSON.stringify([timer.kind, timer.userId, timer.decisionId]);

/** Reused by replay; unchanged decisions retain their deadline across other players' actions. */
export function planInteractions(input: {
  engine: RuleEngine; snapshot: unknown; playerIds: string[]; roundId: string; atMs: number;
  autoPlayUserIds: string[]; previous: InteractionState | null; consumedTimerId?: string;
  stateVersion?: number;
}): InteractionState {
  const { engine, snapshot, playerIds, roundId, atMs, previous, consumedTimerId } = input;
  requireCondition(engine.interactions, 'ENGINE_INTERACTIONS_UNAVAILABLE', 'This archived engine has no deadline controls.', 409);
  requireCondition(Number.isSafeInteger(atMs) && Number.isFinite(new Date(atMs).getTime()),
    'INVALID_ENGINE_INTERACTIONS', 'The recorded scheduling time is invalid.', 500);
  const autoPlayUserIds = [...new Set(input.autoPlayUserIds)].sort();
  requireCondition(autoPlayUserIds.every(userId => playerIds.includes(userId)), 'INVALID_ENGINE_INTERACTIONS', 'Autoplay contains a non-player.', 500);
  const deadlines = engine.interactions.deadlines(structuredClone(snapshot));
  requireCondition(Array.isArray(deadlines), 'INVALID_ENGINE_INTERACTIONS', 'Engine deadlines must be an array.', 500);
  const declarations: (EngineTimedAction & { kind: ScheduledEngineAction['kind'] })[] = deadlines.map(item => ({ ...item, kind: 'timeout' }));
  for (const userId of autoPlayUserIds) {
    const chosen = engine.interactions.autoPlay(structuredClone(snapshot), userId);
    if (chosen !== null) declarations.push({ ...chosen, userId, kind: 'autoplay' });
  }
  const revision = previous ? previous.revision + 1 : 0;
  const existing = new Map((previous?.timers ?? []).filter(timer => timer.id !== consumedTimerId).map(timer => [timerKey(timer), timer]));
  const keys = new Set<string>();
  const timers = declarations.map(declaration => {
    requireCondition(declaration && typeof declaration.decisionId === 'string' && /^[\w:-]{1,100}$/.test(declaration.decisionId)
      && playerIds.includes(declaration.userId) && Number.isInteger(declaration.delayMs) && declaration.delayMs >= 0 && declaration.delayMs <= 2147483647,
    'INVALID_ENGINE_INTERACTIONS', 'Engine deadlines require a valid player, stable decision ID and duration.', 500);
    requireCondition(engineLegalActions(engine, snapshot, declaration.userId).some(action => isDeepStrictEqual(action, declaration.action)),
      'INVALID_ENGINE_INTERACTIONS', 'An automatic engine action must be currently legal.', 500);
    const key = timerKey(declaration);
    requireCondition(!keys.has(key), 'INVALID_ENGINE_INTERACTIONS', 'Engine deadline identities must be unique.', 500);
    keys.add(key);
    const old = existing.get(key);
    if (old) {
      requireCondition(old.delayMs === declaration.delayMs && isDeepStrictEqual(old.action, declaration.action),
        'INVALID_ENGINE_INTERACTIONS', 'A changed engine decision requires a new decision ID.', 500);
      return structuredClone(old);
    }
    return { ...structuredClone(declaration), dueAt: atMs + declaration.delayMs,
      id: createHash('sha256').update(JSON.stringify([roundId, revision, key])).digest('hex') };
  });
  timers.sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
  const responseWindows: NonNullable<InteractionState['responseWindows']> = {};
  if (engine.interactions.responseWindow) for (const userId of playerIds) {
    const id = engine.interactions.responseWindow(structuredClone(snapshot), userId);
    if (id === null) continue;
    requireCondition(typeof id === 'string' && /^[\w:-]{1,100}$/.test(id), 'INVALID_ENGINE_INTERACTIONS', 'Invalid response window.', 500);
    const actions = engineLegalActions(engine, snapshot, userId);
    const old = previous?.responseWindows?.[userId];
    requireCondition(!old || old.id !== id || isDeepStrictEqual(old.actions, actions),
      'INVALID_ENGINE_INTERACTIONS', 'Changed response choices require a new window ID.', 500);
    responseWindows[userId] = { id, openedAtVersion: old?.id === id ? old.openedAtVersion : input.stateVersion ?? 0, actions };
  }
  return { format: 1, revision, atMs, autoPlayUserIds, timers, ...(engine.interactions.responseWindow ? { responseWindows } : {}) };
}

export function validateObservedDecision(state: InteractionState | null, userId: string, observed: number, actual: number, decisionId?: string) {
  const window = state?.responseWindows?.[userId];
  if (window) {
    requireCondition(decisionId !== undefined, 'DECISION_REQUIRED', 'Refresh the response window before acting.', 426);
    requireCondition(decisionId === window.id && observed >= window.openedAtVersion && observed <= actual,
      'DECISION_EXPIRED', 'This response window is no longer available.', 409);
  } else {
    requireCondition(decisionId === undefined, 'DECISION_EXPIRED', 'This response window has closed.', 409);
    requireCondition(observed === actual, 'STATE_VERSION_CONFLICT', 'The round has changed. Refresh the room state before acting.', 409);
  }
}
