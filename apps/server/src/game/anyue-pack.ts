import { ANYUE_FIXED_KINGS, ANYUE_INDEPENDENT_VERSION } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { createCardState, type CardState, type PackEntry, type ZoneSpec } from './cards.js';

/** Anyue physical pack: 52 ordinary cards plus one of each special face. */
export function anyuePackSpecification(wangNum: number = ANYUE_FIXED_KINGS): PackEntry[] {
  requireCondition(wangNum === ANYUE_FIXED_KINGS, 'INVALID_ANYUE_WANG_COUNT',
    'The original Anyue menu has no king selector; the independent edition uses exactly three kings.', 400);
  const entries: PackEntry[] = [];
  for (let suit = 1; suit <= 4; suit++) for (let rank = 1; rank <= 13; rank++) {
    entries.push({ code: suit * 100 + rank, count: 1 });
  }
  for (const code of [1001, 1002, 1003]) entries.push({ code, count: wangNum / 3 });
  return entries;
}

export function createAnyueCardState(
  variantKey: string, rules: Readonly<Record<string, unknown>>, drawZone: string, zones: readonly ZoneSpec[],
): CardState {
  requireCondition(variantKey === '5:0', 'ANYUE_PACK_REGION_MISMATCH',
    'The independent Anyue pack cannot be used for another region.', 409);
  const metadata = rules.anyue;
  requireCondition(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).rulesVersion === ANYUE_INDEPENDENT_VERSION,
  'ANYUE_RULES_VERSION_REQUIRED', 'An explicitly frozen Anyue rule version is required.', 409);
  return createCardState(anyuePackSpecification(), drawZone, zones);
}
