import { randomInt, randomUUID } from 'node:crypto';
import type { Database, Sql } from './database.js';
import { type Actor, requireRole } from './auth.js';
import { requireCondition } from './errors.js';
import { requestHash } from './ledger.js';
import { Decimal } from './money.js';

export interface Policy { userId: string; enabled: boolean; probability: string; version: number }
export interface FrozenPolicy { selectedUserId: string | null; triggered: boolean; probability: string; version: number | null }

export function choosePolicy(policies: Policy[], random: (max: number) => number = randomInt): FrozenPolicy {
  const eligible = policies.filter(p => p.enabled && new Decimal(p.probability).greaterThan(0));
  if (!eligible.length) return { selectedUserId: null, triggered: false, probability: '0', version: null };
  const selected = eligible[random(eligible.length)];
  return { selectedUserId: selected.userId, triggered: random(10000) < new Decimal(selected.probability).times(100).toNumber(), probability: selected.probability, version: selected.version };
}

export function shuffle<T>(cards: readonly T[], random: (max: number) => number = randomInt): T[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function selectDeal<T>(deck: readonly T[], policy: FrozenPolicy, evaluate: (deck: readonly T[]) => readonly number[], random: (max: number) => number = randomInt) {
  const count = policy.triggered ? 32 : 1;
  let chosen = shuffle(deck, random);
  let score = evaluate(chosen);
  requireCondition(score.length > 0 && score.every(Number.isFinite), 'INVALID_EVALUATION', 'Rule evaluator returned an invalid score.', 500);
  let ties = 1;
  for (let i = 1; i < count; i++) {
    const candidate = shuffle(deck, random);
    const next = evaluate(candidate);
    requireCondition(next.length === score.length && next.every(Number.isFinite), 'INVALID_EVALUATION', 'Rule evaluator returned an invalid score.', 500);
    const different = next.findIndex((value, index) => value !== score[index]);
    const comparison = different === -1 ? 0 : next[different] - score[different];
    if (comparison > 0) { chosen = candidate; score = next; ties = 1; }
    else if (comparison === 0 && random(++ties) === 0) chosen = candidate;
  }
  return { deck: chosen, evaluation: score, candidates: count };
}

export class PolicyService {
  constructor(private db: Database) {}

  async update(actor: Actor, userId: string, enabled: boolean, probability: string, reason: string, requestId: string, expectedVersion?: number) {
    requireRole(actor, 'deal_admin');
    requireCondition(/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(probability), 'INVALID_PROBABILITY', 'Probability must be between 0 and 100 with up to two decimal places.');
    const value = new Decimal(probability);
    requireCondition(value.greaterThanOrEqualTo(0) && value.lessThanOrEqualTo(100), 'INVALID_PROBABILITY', 'Probability must be between 0 and 100.');
    requireCondition(reason.trim().length > 0 && reason.length <= 500 && /^[\w-]{8,100}$/.test(requestId), 'INVALID_REQUEST', 'Reason and unique request ID are required.');
    const key = `policy:${actor.id}:${requestId}`;
    const hash = requestHash({ userId, enabled, probability: value.toFixed(), reason: reason.trim(), expectedVersion });
    return this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`policy:${userId}`]);
      const oldRequest = await tx.query('SELECT details,request_hash FROM audit_events WHERE request_key=$1', [key]);
      if (oldRequest.rows[0]) {
        requireCondition(oldRequest.rows[0].request_hash === hash, 'IDEMPOTENCY_CONFLICT', 'Request ID already used with different parameters.', 409);
        return oldRequest.rows[0].details.after as Policy;
      }
      const account = await tx.query("SELECT id FROM accounts WHERE id=$1 AND role='player'", [userId]);
      requireCondition(account.rows[0], 'USER_NOT_FOUND', 'Player does not exist.', 404);
      const previous = await tx.query('SELECT enabled,probability::text,version FROM deal_policies WHERE user_id=$1', [userId]);
      const before = previous.rows[0] ?? { enabled: false, probability: '0', version: 0 };
      requireCondition(expectedVersion === undefined || expectedVersion === before.version, 'VERSION_CONFLICT', 'Policy changed. Refresh before saving.', 409);
      const after: Policy = { userId, enabled, probability: value.toFixed(), version: before.version + 1 };
      await tx.query('INSERT INTO deal_policies (user_id,enabled,probability,version,updated_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,probability=excluded.probability,version=excluded.version,updated_by=excluded.updated_by,updated_at=now()', [userId, enabled, after.probability, after.version, actor.id]);
      await tx.query('INSERT INTO audit_events(id,actor_id,user_id,kind,request_key,request_hash,details) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), actor.id, userId, 'policy_changed', key, hash, JSON.stringify({ before, after, reason: reason.trim() })]);
      return after;
    });
  }

  async freeze(tx: Sql, userIds: string[], roomId: string, roundId: string) {
    const result = await tx.query('SELECT user_id AS "userId",enabled,probability::text,version FROM deal_policies WHERE user_id=ANY($1::uuid[]) ORDER BY user_id', [userIds]);
    const selected = choosePolicy(result.rows as Policy[]);
    await tx.query('INSERT INTO audit_events(id,user_id,kind,details) VALUES($1,$2,$3,$4)', [randomUUID(), selected.selectedUserId, 'deal_selected', JSON.stringify({ roomId, roundId, ...selected })]);
    return selected;
  }
}
