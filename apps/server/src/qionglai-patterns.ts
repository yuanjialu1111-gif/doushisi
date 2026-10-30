import { type QionglaiSwitches, QIONGLAI_OPTION_VERSION } from '@dss/rules';
import { requireCondition } from './errors.js';

export type QionglaiPattern = 'tianHu' | 'diHu' | 'redHu' | 'blackHu' | 'red50' | 'black50';
export interface QionglaiFacts {
  /** Determined by the eventual server win evaluator, never by a client request. */
  legalWin: boolean;
  winnerSeat: number;
  dealerSeat: number;
  phase: 'original-hand' | 'ordinary-discard' | 'other';
  stealCount: number;
  replacementCount: number;
  discardCount: number;
  sourceSeat: number | null;
  handAndMelds: { kind: 'ordinary' | 'wild' | 'bonus'; color?: 'red' | 'black' }[];
  redPoints: number;
  blackPoints: number;
}
export function qionglaiPatterns(facts: QionglaiFacts, switches: QionglaiSwitches): QionglaiPattern[] {
  requireCondition([facts.winnerSeat, facts.dealerSeat].every(seat => Number.isInteger(seat) && seat >= 1 && seat <= 4) &&
    [facts.stealCount, facts.replacementCount, facts.discardCount, facts.redPoints, facts.blackPoints].every(value => Number.isSafeInteger(value) && value >= 0),
  'INVALID_RULE_FACTS', 'Invalid server-side Qionglai facts.', 500);
  requireCondition(switches != null && ['qlTianDiHu', 'qlHongHeiHu', 'qlHongHei50'].every(key => {
    const value = switches[key as keyof QionglaiSwitches];
    return value === 0 || value === 1;
  }),
    'INVALID_ROOM_OPTIONS', 'Qionglai switches must be explicit.', 500);
  if (!facts.legalWin) return [];
  const patterns: QionglaiPattern[] = [];
  if (switches.qlTianDiHu) {
    if (facts.winnerSeat === facts.dealerSeat && facts.phase === 'original-hand' &&
      facts.stealCount === 0 && facts.replacementCount === 0 && facts.discardCount === 0) patterns.push('tianHu');
    if (facts.winnerSeat !== facts.dealerSeat && facts.phase === 'ordinary-discard' &&
      facts.sourceSeat === facts.dealerSeat && facts.discardCount === 1) patterns.push('diHu');
  }
  const ordinary = facts.handAndMelds.filter(card => card.kind === 'ordinary');
  requireCondition(ordinary.every(card => card.color === 'red' || card.color === 'black'), 'INVALID_RULE_FACTS', 'Ordinary cards need verified colors.', 500);
  if (switches.qlHongHeiHu && ordinary.length) {
    if (ordinary.every(card => card.color === 'red')) patterns.push('redHu');
    if (ordinary.every(card => card.color === 'black')) patterns.push('blackHu');
  }
  if (switches.qlHongHei50) {
    if (facts.redPoints >= 50) patterns.push('red50');
    if (facts.blackPoints >= 50) patterns.push('black50');
  }
  return patterns;
}

export interface QionglaiFanSchedule {
  version: typeof QIONGLAI_OPTION_VERSION;
  approvalReference: string;
  values: Record<QionglaiPattern, number>;
}
/** Legacy explicit schedules remain unchanged; package-backed scoring is versioned separately. */
export function qionglaiFanTotal(patterns: QionglaiPattern[], otherFans: readonly number[], cap: number | null, schedule: QionglaiFanSchedule | null) {
  requireCondition(schedule?.version === QIONGLAI_OPTION_VERSION && typeof schedule.approvalReference === 'string' &&
    schedule.approvalReference.trim().length > 0 && schedule.values != null &&
    ['tianHu', 'diHu', 'redHu', 'blackHu', 'red50', 'black50'].every(key => Number.isSafeInteger(schedule.values[key as QionglaiPattern]) && schedule.values[key as QionglaiPattern] >= 0),
  'QIONGLAI_FANS_UNCONFIRMED', 'Qionglai fan amounts require an explicit approved schedule.', 409);
  const amounts = [...new Set(patterns)].map(pattern => schedule.values[pattern]).concat([...otherFans]);
  requireCondition(amounts.every(value => Number.isSafeInteger(value) && value >= 0) &&
    (cap === null || Number.isSafeInteger(cap) && cap >= 0), 'INVALID_RULE_FACTS', 'Invalid fan values.', 500);
  const total = amounts.reduce((sum, value) => sum + BigInt(value), 0n);
  const capped = cap === null || total < BigInt(cap) ? total : BigInt(cap);
  return { total: total.toString(), capped: capped.toString() };
}
