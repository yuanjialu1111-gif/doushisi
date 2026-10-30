import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Database, Sql } from './database.js';
import { amount, money, beanUnits, unitsMoney } from './money.js';
import { requireCondition } from './errors.js';
import { requireRole, type Actor } from './auth.js';

export const requestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface Posting { userId: string; amount: string }
export interface Operation {
  key: string; kind: 'admin_add' | 'admin_deduct' | 'room_fee' | 'round_settlement';
  actorId?: string; roomId?: string; roundId?: string; referenceEntryId?: string; reason: string; postings: Posting[];
}

export interface LedgerEntry {
  userId: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
}

export interface OperationResult {
  operationId: string;
  replayed: boolean;
  entries: LedgerEntry[];
}

/** A committed wallet value that can be projected to connected clients. */
export interface BalanceChange {
  userId: string;
  balance: string;
  operationId: string;
  kind: Operation['kind'];
  roomId?: string;
  roundId?: string;
}

export async function appendOperation(tx: Sql, op: Operation): Promise<OperationResult> {
  requireCondition(op.postings.length > 0 && new Set(op.postings.map(p => p.userId)).size === op.postings.length, 'INVALID_POSTINGS', 'Postings must contain unique players.');
  const postings = [...op.postings].sort((a, b) => a.userId.localeCompare(b.userId));
  const hash = requestHash({ ...op, postings });
  // The request lock covers first insertion as well as repeated requests on PostgreSQL.
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [op.key]);
  const found = await tx.query('SELECT * FROM ledger_operations WHERE request_key=$1', [op.key]);
  if (found.rows.length) {
    requireCondition(found.rows[0].request_hash === hash, 'IDEMPOTENCY_CONFLICT', 'Request ID was already used with different parameters.', 409);
    return operationResult(tx, found.rows[0].id, true);
  }
  if (op.referenceEntryId) {
    requireCondition(['admin_add', 'admin_deduct'].includes(op.kind) && postings.length === 1,
      'INVALID_ADJUSTMENT_REFERENCE', 'Only a manual adjustment can reference an existing entry.');
    const original = await tx.query('SELECT user_id FROM ledger_entries WHERE id=$1', [op.referenceEntryId]);
    requireCondition(original.rows[0]?.user_id === postings[0]!.userId,
      'INVALID_ADJUSTMENT_REFERENCE', 'The referenced entry must belong to this player.');
  }
  const balances = new Map<string, bigint>();
  for (const posting of postings) {
    const result = await tx.query('SELECT balance::text FROM wallets WHERE user_id=$1 FOR UPDATE', [posting.userId]);
    requireCondition(result.rows[0], 'USER_NOT_FOUND', 'Player does not exist.', 404);
    balances.set(posting.userId, beanUnits(result.rows[0].balance));
  }
  const id = randomUUID();
  await tx.query('INSERT INTO ledger_operations (id,request_key,request_hash,kind,actor_id,room_id,round_id,reason,reference_entry_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, op.key, hash, op.kind, op.actorId ?? null, op.roomId ?? null, op.roundId ?? null, op.reason, op.referenceEntryId ?? null]);
  for (const posting of postings) {
    const before = balances.get(posting.userId)!;
    if (op.kind === 'admin_add' || op.kind === 'admin_deduct') amount(posting.amount);
    const delta = beanUnits(posting.amount);
    const after = before + delta;
    if (op.kind === 'admin_deduct') requireCondition(before > 0n && after >= 0n, 'INSUFFICIENT_BALANCE', 'Manual deduction cannot create or increase a negative balance.', 409);
    if (op.kind === 'room_fee') requireCondition(after > 0n, 'INSUFFICIENT_BALANCE', 'Every player must retain a positive balance after room fees.', 409);
    await tx.query('UPDATE wallets SET balance=$2, updated_at=now() WHERE user_id=$1', [posting.userId, unitsMoney(after)]);
    await tx.query('INSERT INTO ledger_entries (id,operation_id,user_id,amount,balance_before,balance_after) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, posting.userId, unitsMoney(delta), unitsMoney(before), unitsMoney(after)]);
  }
  return operationResult(tx, id, false);
}

async function operationResult(tx: Sql, id: string, replayed: boolean): Promise<OperationResult> {
  const result = await tx.query('SELECT user_id AS "userId", amount::text, balance_before::text AS "balanceBefore", balance_after::text AS "balanceAfter" FROM ledger_entries WHERE operation_id=$1 ORDER BY user_id', [id]);
  return { operationId: id, replayed, entries: result.rows as LedgerEntry[] };
}

export function balanceChanges(result: OperationResult, op: Operation): BalanceChange[] {
  if (result.replayed) return [];
  return result.entries.map(entry => ({ userId: entry.userId, balance: money(entry.balanceAfter), operationId: result.operationId,
    kind: op.kind, ...(op.roomId ? { roomId: op.roomId } : {}), ...(op.roundId ? { roundId: op.roundId } : {}) }));
}

export class LedgerService extends EventEmitter {
  constructor(private db: Database) { super(); }

  async adjust(actor: Actor, userId: string, delta: string, reason: string, requestId: string, referenceEntryId?: string) {
    requireRole(actor, 'beans_admin');
    const value = amount(delta);
    requireCondition(!value.isZero(), 'ZERO_ADJUSTMENT', 'Adjustment must not be zero.');
    requireCondition(reason.trim().length > 0 && reason.length <= 500, 'REASON_REQUIRED', 'A reason of at most 500 characters is required.');
    requireCondition(/^[\w-]{8,100}$/.test(requestId), 'REQUEST_ID_REQUIRED', 'A unique request ID is required.');
    const operation: Operation = {
      key: `admin:${actor.id}:${requestId}`, kind: value.isPositive() ? 'admin_add' : 'admin_deduct', actorId: actor.id,
      reason: reason.trim(), postings: [{ userId, amount: money(value) }], referenceEntryId,
    };
    const result = await this.db.transaction(tx => appendOperation(tx, operation));
    // Emit only after the transaction has committed. A replay has no new
    // wallet value and therefore does not need a second push.
    const changes = balanceChanges(result, operation);
    if (changes.length) this.emit('balanceChanged', changes);
    return result;
  }

  async balance(userId: string): Promise<string> {
    const result = await this.db.query('SELECT balance::text FROM wallets WHERE user_id=$1', [userId]);
    requireCondition(result.rows[0], 'USER_NOT_FOUND', 'Player does not exist.', 404);
    return money(result.rows[0].balance);
  }
}
