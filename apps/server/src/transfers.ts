import { BEAN_SCALE, beanUnits, unitsMoney } from './money.js';
import type { Posting } from './ledger.js';
import { requireCondition } from './errors.js';

export const TRANSFER_ROUNDING_VERSION = 'payer-half-up-12-v1';
export interface ExactTransfer {
  id: string;
  payerId: string;
  payeeId: string;
  numerator: string;
  denominator: string;
}

/** Each formula stays rational until its final payer -> payee transfer. */
export function roundTransfers(transfers: ExactTransfer[], playerIds: string[]): {
  postings: Posting[]; transfers: ExactTransfer[];
} {
  requireCondition(Array.isArray(transfers) && new Set(transfers.map(t => t.id)).size === transfers.length,
    'INVALID_TRANSFER', 'Transfers require unique identities.', 500);
  const totals = new Map(playerIds.map(id => [id, 0n]));
  const canonical = transfers.map(transfer => {
    requireCondition(transfer && /^[\w:-]{1,100}$/.test(transfer.id) &&
      totals.has(transfer.payerId) && totals.has(transfer.payeeId) && transfer.payerId !== transfer.payeeId &&
      typeof transfer.numerator === 'string' && /^(0|[1-9]\d*)$/.test(transfer.numerator) &&
      typeof transfer.denominator === 'string' && /^[1-9]\d*$/.test(transfer.denominator),
    'INVALID_TRANSFER', 'Expected member identities and a nonnegative exact rational payment.', 500);
    const denominator = BigInt(transfer.denominator);
    const scaled = BigInt(transfer.numerator) * BEAN_SCALE;
    const rounded = scaled / denominator + (scaled % denominator * 2n >= denominator ? 1n : 0n);
    totals.set(transfer.payerId, totals.get(transfer.payerId)! - rounded);
    totals.set(transfer.payeeId, totals.get(transfer.payeeId)! + rounded);
    return { id: transfer.id, payerId: transfer.payerId, payeeId: transfer.payeeId,
      numerator: transfer.numerator, denominator: transfer.denominator };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { transfers: canonical,
    postings: [...totals].map(([userId, units]) => ({ userId, amount: unitsMoney(units) })).sort((a, b) => a.userId.localeCompare(b.userId)) };
}

export function baseTimesRatio(baseBeans: string, numerator: bigint, denominator = 1n) {
  requireCondition(numerator >= 0n && denominator > 0n, 'INVALID_TRANSFER', 'Invalid scoring ratio.', 500);
  return { numerator: (beanUnits(baseBeans) * numerator).toString(), denominator: (BEAN_SCALE * denominator).toString() };
}
