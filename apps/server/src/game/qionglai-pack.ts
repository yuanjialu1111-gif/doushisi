import { QIONGLAI_PACK_VERSION, QIONGLAI_WANG_COUNTS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { createCardState, type CardState, type PackEntry, type ZoneSpec } from './cards.js';

/** QL-D03-1 defines card quantities only, not card roles, points or dealing rules. */
export function qionglaiPackSpecification(wangNum: number): PackEntry[] {
  requireCondition(Number.isSafeInteger(wangNum) && QIONGLAI_WANG_COUNTS.includes(wangNum),
    'INVALID_QIONGLAI_WANG_COUNT', 'Qionglai requires 3, 6, 9, 12, 15 or 18 special cards.', 400);
  const entries: PackEntry[] = [];
  for (let suit = 1; suit <= 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) entries.push({ code: suit * 100 + rank, count: 1 });
  }
  for (const code of [1001, 1002, 1003]) entries.push({ code, count: wangNum / 3 });
  return entries;
}

export function createQionglaiCardState(
  variantKey: string, rules: Readonly<Record<string, unknown>>, drawZone: string, zones: readonly ZoneSpec[],
): CardState {
  requireCondition(variantKey === '8:0', 'QIONGLAI_PACK_REGION_MISMATCH',
    'The approved Qionglai pack cannot be used for another region.', 409);
  const metadata = rules.qionglai;
  requireCondition(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).packVersion === QIONGLAI_PACK_VERSION,
  'QIONGLAI_PACK_VERSION_REQUIRED', 'An explicitly frozen, supported Qionglai pack version is required.', 409);
  requireCondition(typeof rules.wangNum === 'number', 'INVALID_QIONGLAI_WANG_COUNT',
    'The frozen Qionglai special-card count must be numeric.', 400);
  return createCardState(qionglaiPackSpecification(rules.wangNum), drawZone, zones);
}
