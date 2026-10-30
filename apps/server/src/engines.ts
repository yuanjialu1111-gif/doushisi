import { AppError } from './errors.js';
import type { Posting } from './ledger.js';
import type { FrozenPolicy } from './policies.js';
import type { ExactTransfer } from './transfers.js';

export interface EnginePlayer { userId: string; seat: number }
export type RoundContext = Record<string, unknown>;
export interface RoundInput {
  players: EnginePlayer[];
  ownerUserId: string;
  rules: Record<string, unknown>;
  number: number;
  policy: FrozenPolicy;
  /** Absent for the first round and historical rounds without recorded context. */
  previousRoundContext?: RoundContext;
}
export interface ConfirmedScoreBatch {
  /** Stable within the round. Retrying the same event cannot award points again. */
  eventId: string;
  /** Incremental, irrevocably earned scores; include every player, including zeroes. */
  postings: Posting[];
  transfers?: ExactTransfer[];
}
export interface EngineResult {
  snapshot: unknown;
  events: unknown[];
  confirmedScores?: ConfirmedScoreBatch[];
  /** Final round totals, exactly equal to all confirmed score batches combined. */
  settlement?: Posting[];
  /** Private, version-specific continuation, emitted only with final settlement. */
  nextRoundContext?: RoundContext | null;
}
export interface EngineTimedAction {
  /** Stable until this decision closes; change it when the action or duration changes. */
  decisionId: string;
  userId: string;
  delayMs: number;
  action: unknown;
}
export interface EngineInteractions {
  /** Same ID only while this player's response choices are unchanged. */
  responseWindow?(snapshot: unknown, userId: string): string | null;
  legalActions(snapshot: unknown, userId: string): unknown[];
  /** Relative durations become durable absolute deadlines when first scheduled. */
  deadlines(snapshot: unknown): EngineTimedAction[];
  autoPlay(snapshot: unknown, userId: string): Omit<EngineTimedAction, 'userId'> | null;
}
export interface EngineOriginalBody {
  body: Record<string, unknown>;
  decimalFields?: { path: (string | number)[]; value: string }[];
}
export interface EngineOriginalPacket extends EngineOriginalBody { command: number; decisionId?: string | null }
export interface EngineOriginalAdapter {
  /** Must depend only on the normalized wire request, never the current snapshot. */
  decodeAction(command: 23 | 53, body: Readonly<Record<string, unknown>>, decisionId?: string): unknown;
  /** Deterministically maps a decoded wire action onto the archived snapshot. */
  resolveAction?(snapshot: unknown, userId: string, action: unknown): unknown;
  /** Viewer-specific original response. Stored with the action for identical retries. */
  response(command: 23 | 53, body: Readonly<Record<string, unknown>>, snapshot: unknown, userId: string): EngineOriginalBody;
  /** Original HWResponseEnterTableFinish game fields, with only this viewer's private cards. */
  enter(snapshot: unknown, userId: string): EngineOriginalBody;
  /** Original animation flow first, then candidate operations. Never include another player's hidden cards. */
  notifications(snapshot: unknown, events: readonly unknown[], userId: string, phase: 'start' | 'action'): EngineOriginalPacket[];
}
export interface OriginalActionContext { command: 23 | 53; body: Record<string, unknown>; decisionId?: string }

export function projectOriginalNotifications(engine: RuleEngine, snapshot: unknown, events: readonly unknown[], userId: string, phase: 'start' | 'action') {
  const packets = engine.original!.notifications(structuredClone(snapshot), structuredClone(events), userId, phase);
  if (!engine.interactions?.responseWindow) return packets;
  const decisionId = engine.interactions.responseWindow(structuredClone(snapshot), userId);
  return packets.map(packet => ({ ...packet, decisionId }));
}
export interface RuleEngine {
  variantKey: string;
  version: string;
  evidence: { status: 'verified'; referenceDigest: string };
  create(input: RoundInput): unknown;
  /** Deterministic for an archived snapshot and action; no external side effects. */
  apply(snapshot: unknown, userId: string, action: unknown): EngineResult;
  view(snapshot: unknown, userId: string): unknown;
  /** Optional for archived engines. Callbacks must be deterministic and side-effect free. */
  interactions?: EngineInteractions;
  /** No generic regional projection is assumed when this adapter is absent. */
  original?: EngineOriginalAdapter;
}

/** Only engines with an independently verified reference suite belong in this registry. */
export class EngineRegistry {
  private engines = new Map<string, RuleEngine>();
  private currentVersions = new Map<string, string>();
  constructor(engines: RuleEngine[] = []) {
    for (const engine of engines) this.register(engine);
  }
  register(engine: RuleEngine): void {
    if (engine.evidence.status !== 'verified' || !engine.evidence.referenceDigest) throw new Error('Missing rule verification evidence');
    const key = `${engine.variantKey}@${engine.version}`;
    if (this.engines.has(key)) throw new Error('An existing engine version cannot be replaced');
    this.engines.set(key, engine);
    this.currentVersions.set(engine.variantKey, engine.version);
  }
  get(variantKey: string, version = this.currentVersions.get(variantKey)): RuleEngine {
    const engine = this.engines.get(`${variantKey}@${version}`);
    if (!engine) throw new AppError('RULES_NOT_VERIFIED', 'This regional rule engine has not passed original-game verification. No beans were charged.', 409);
    return engine;
  }
  has(variantKey: string) { return this.currentVersions.has(variantKey); }
}
