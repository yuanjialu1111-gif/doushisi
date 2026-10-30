import { isDeepStrictEqual } from 'node:util';
import type { ConfirmedScoreBatch, EngineResult } from './engines.js';
import { requireCondition } from './errors.js';
import type { Posting } from './ledger.js';
import { beanUnits, internalMoney, unitsMoney } from './money.js';
import { roundTransfers } from './transfers.js';

export function normalizeScores(postings: Posting[], playerIds: string[], code = 'INVALID_CONFIRMED_SCORE'): Posting[] {
  requireCondition(Array.isArray(postings) && postings.length === playerIds.length
    && postings.every(posting => posting && playerIds.includes(posting.userId))
    && new Set(postings.map(posting => posting.userId)).size === playerIds.length,
  code, 'Scores must include every player exactly once.', 500);
  const normalized = postings.map(posting => ({ userId: posting.userId, amount: internalMoney(posting.amount) }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  requireCondition(normalized.reduce((sum, posting) => sum + beanUnits(posting.amount), 0n) === 0n,
    code, 'Game scores must conserve points.', 500);
  return normalized;
}

export function totalConfirmedScores(batches: ConfirmedScoreBatch[], playerIds: string[]): Posting[] {
  const totals = new Map(playerIds.map(userId => [userId, 0n]));
  for (const batch of batches) for (const posting of batch.postings) {
    requireCondition(totals.has(posting.userId), 'INVALID_CONFIRMED_SCORE', 'Score event contains a non-player.', 500);
    totals.set(posting.userId, totals.get(posting.userId)! + beanUnits(posting.amount));
  }
  return normalizeScores([...totals].map(([userId, value]) => ({ userId, amount: unitsMoney(value) })), playerIds);
}

/** Shared by live play and replay so score history is checked as well as card state. */
export function applyConfirmedScores(previous: ConfirmedScoreBatch[], result: EngineResult, playerIds: string[]) {
  const batches = new Map(previous.map(batch => [batch.eventId, batch]));
  const appended: ConfirmedScoreBatch[] = [];
  requireCondition(result.confirmedScores === undefined || Array.isArray(result.confirmedScores),
    'INVALID_CONFIRMED_SCORE', 'Confirmed score batches must be an array.', 500);
  // Validate the final postings first to preserve the settlement error contract.
  const settlement = result.settlement === undefined ? undefined : normalizeScores(result.settlement, playerIds, 'INVALID_SETTLEMENT');
  for (const emitted of result.confirmedScores ?? []) {
    requireCondition(emitted && typeof emitted.eventId === 'string' && /^[\w:-]{1,100}$/.test(emitted.eventId),
      'INVALID_CONFIRMED_SCORE', 'A stable score event ID is required.', 500);
    const batch: ConfirmedScoreBatch = { eventId: emitted.eventId, postings: normalizeScores(emitted.postings, playerIds) };
    if (emitted.transfers !== undefined) {
      const rounded = roundTransfers(emitted.transfers, playerIds);
      requireCondition(isDeepStrictEqual(rounded.postings, batch.postings), 'TRANSFER_POSTINGS_MISMATCH',
        'Confirmed postings must equal the per-payment rounded transfers.', 500);
      batch.transfers = rounded.transfers;
    }
    const existing = batches.get(batch.eventId);
    requireCondition(!existing || isDeepStrictEqual(existing, batch),
      'CONFIRMED_SCORE_CONFLICT', 'A confirmed score event cannot be changed.', 500);
    if (!existing) { batches.set(batch.eventId, batch); appended.push(batch); }
  }
  const all = [...batches.values()];
  const totals = totalConfirmedScores(all, playerIds);
  requireCondition(!settlement || isDeepStrictEqual(settlement, totals), 'INVALID_SETTLEMENT',
    'Final settlement must equal the accumulated confirmed scores.', 500);
  return { all, appended, totals, settlement };
}
