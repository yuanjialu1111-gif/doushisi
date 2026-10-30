import { XINJIN_INDEPENDENT_VERSION, XINJIN_WANG_COUNTS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { createCardState, type CardState, type PackEntry, type ZoneSpec } from './cards.js';

/** Xinjin physical pack: ordinary A-K per suit plus the original king composition. */
export function xinjinPackSpecification(wangNum: number): PackEntry[] {
  requireCondition(XINJIN_WANG_COUNTS.includes(wangNum), 'INVALID_XINJIN_WANG_COUNT',
    'Xinjin requires 3, 5, 6 or 9 special cards.', 400);
  const entries: PackEntry[] = [];
  for (let suit = 1; suit <= 4; suit++) for (let rank = 1; rank <= 13; rank++) {
    entries.push({ code: suit * 100 + rank, count: 1 });
  }
  const counts: Record<number, [number, number, number]> = { 3: [1, 1, 1], 5: [2, 2, 1], 6: [2, 2, 2], 9: [3, 3, 3] };
  const [small, big, white] = counts[wangNum]!;
  entries.push({ code: 1001, count: small }, { code: 1002, count: big }, { code: 1003, count: white });
  return entries;
}

export function createXinjinCardState(
  variantKey: string, rules: Readonly<Record<string, unknown>>, drawZone: string, zones: readonly ZoneSpec[],
): CardState {
  requireCondition(variantKey === '4:0', 'XINJIN_PACK_REGION_MISMATCH',
    'The independent Xinjin pack cannot be used for another region.', 409);
  const metadata = rules.xinjin;
  requireCondition(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).rulesVersion === XINJIN_INDEPENDENT_VERSION,
  'XINJIN_RULES_VERSION_REQUIRED', 'An explicitly frozen Xinjin rule version is required.', 409);
  requireCondition(typeof rules.wangNum === 'number', 'INVALID_XINJIN_WANG_COUNT',
    'The frozen Xinjin special-card count must be numeric.', 400);
  return createCardState(xinjinPackSpecification(rules.wangNum), drawZone, zones);
}
