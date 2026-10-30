import { YAAN_INDEPENDENT_VERSION, YAAN_WANG_COUNTS, YAAN_SEVEN_KING_COUNTS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { createCardState, type CardState, type PackEntry, type ZoneSpec } from './cards.js';

/** Yaan physical quantities only; wildcard substitution and winning are separate rule stages. */
export function yaanPackSpecification(wangNum: number, qiWangNum: number): PackEntry[] {
  requireCondition(YAAN_WANG_COUNTS.includes(wangNum), 'INVALID_YAAN_WANG_COUNT',
    'Yaan requires 3, 6, 9 or 12 special cards.', 400);
  requireCondition(YAAN_SEVEN_KING_COUNTS.includes(qiWangNum), 'INVALID_YAAN_SEVEN_COUNT',
    'Yaan requires a 0, 4, 6, 8 or 12 seven-king count.', 400);
  const entries: PackEntry[] = [];
  const sevenCopies = qiWangNum >= 8 ? qiWangNum / 4 : 1;
  for (let suit = 1; suit <= 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) entries.push({ code: suit * 100 + rank, count: sevenCopies });
  }
  // The six-seven option adds one red and one black seven beyond the ordinary four.
  if (qiWangNum === 6) {
    entries.find(entry => entry.code === 107)!.count = 2;
    entries.find(entry => entry.code === 207)!.count = 2;
  }
  for (const code of [1001, 1002, 1003]) entries.push({ code, count: wangNum / 3 });
  return entries;
}

export function createYaanCardState(
  variantKey: string, rules: Readonly<Record<string, unknown>>, drawZone: string, zones: readonly ZoneSpec[],
): CardState {
  requireCondition(variantKey === '6:0', 'YAAN_PACK_REGION_MISMATCH',
    'The independent Yaan pack cannot be used for another region.', 409);
  const metadata = rules.yaan;
  requireCondition(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).rulesVersion === YAAN_INDEPENDENT_VERSION,
  'YAAN_RULES_VERSION_REQUIRED', 'An explicitly frozen Yaan rule version is required.', 409);
  requireCondition(typeof rules.wangNum === 'number' && typeof rules.qiWangNum === 'number',
    'INVALID_YAAN_WANG_COUNT', 'The frozen Yaan wang and seven-king counts must be numeric.', 400);
  return createCardState(yaanPackSpecification(rules.wangNum, rules.qiWangNum), drawZone, zones);
}
