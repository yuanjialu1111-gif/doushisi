import { QIONGLAI_INDEPENDENT_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { amount } from '../money.js';
import { baseTimesRatio, roundTransfers, type ExactTransfer } from '../transfers.js';
import type { QionglaiWin } from './qionglai-win.js';

export function qionglaiWinPayments(
  players: readonly string[],
  winners: readonly { userId: string; win: Extract<QionglaiWin, { status: 'winning' }> }[],
  source: { kind: 'original-hand' | 'discard' | 'flip' | 'replacement'; userId: string },
  baseBeans: string,
) {
  requireCondition(players.length >= 2 && players.length <= 4 && new Set(players).size === players.length &&
    players.every(id => typeof id === 'string' && id.length > 0) && winners.length > 0 &&
    new Set(winners.map(winner => winner.userId)).size === winners.length &&
    winners.every(winner => players.includes(winner.userId) &&
      winner.win.version === QIONGLAI_INDEPENDENT_VERSION && winner.win.status === 'winning' &&
      /^[1-9]\d*$/.test(winner.win.scoreUnits)) &&
    ['original-hand', 'discard', 'flip', 'replacement'].includes(source.kind) && players.includes(source.userId),
  'INVALID_QIONGLAI_PAYMENT', 'Payments need member identities and independently versioned winning results.', 500);
  const winnerIds = new Set(winners.map(winner => winner.userId));
  requireCondition(source.kind !== 'discard' || !winnerIds.has(source.userId),
    'INVALID_QIONGLAI_PAYMENT', 'A player cannot win their own discarded card.', 500);
  requireCondition(!['original-hand', 'replacement'].includes(source.kind) ||
    winners.length === 1 && winners[0]!.userId === source.userId,
  'INVALID_QIONGLAI_PAYMENT', 'Private initial/replacement wins belong to the source player only.', 500);
  requireCondition(amount(baseBeans).gt(0), 'INVALID_AMOUNT', 'A positive host-entered base is required.');
  const payers = source.kind === 'discard' ? [source.userId] : players.filter(id => !winnerIds.has(id));
  const transfers: ExactTransfer[] = [];
  for (const winner of [...winners].sort((a, b) => a.userId.localeCompare(b.userId))) {
    for (const payerId of [...payers].sort()) transfers.push({
      id: `win:${transfers.length}`, payerId, payeeId: winner.userId,
      ...baseTimesRatio(baseBeans, BigInt(winner.win.scoreUnits)),
    });
  }
  return roundTransfers(transfers, [...players]);
}
