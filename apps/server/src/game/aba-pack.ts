import { ABA_FIXED_KINGS, ABA_INDEPENDENT_VERSIONS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { createCardState, type CardState, type PackEntry, type ZoneSpec } from './cards.js';

/** Aba fixed pack: 52 ordinary cards plus 1 small king, 1 big king and 2 white faces. */
export function abaPackSpecification(wangNum: number = ABA_FIXED_KINGS): PackEntry[] {
  requireCondition(wangNum === ABA_FIXED_KINGS, 'INVALID_ABA_WANG_COUNT',
    'The original Aba menu has no king selector; the independent edition uses four special cards.', 400);
  const entries: PackEntry[] = [];
  for (let suit = 1; suit <= 4; suit++) for (let rank = 1; rank <= 13; rank++) {
    entries.push({ code: suit * 100 + rank, count: 1 });
  }
  entries.push({ code: 1001, count: 1 }, { code: 1002, count: 1 }, { code: 1003, count: 2 });
  return entries;
}

export function createAbaCardState(
  variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS, rules: Readonly<Record<string, unknown>>, drawZone: string, zones: readonly ZoneSpec[],
): CardState {
  requireCondition(['9:0', '10:0', '11:0', '12:0'].includes(variantKey), 'ABA_PACK_REGION_MISMATCH',
    'The independent Aba pack cannot be used for another region.', 409);
  const metadata = rules.aba;
  requireCondition(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).rulesVersion === ABA_INDEPENDENT_VERSIONS[variantKey],
  'ABA_RULES_VERSION_REQUIRED', 'An explicitly frozen Aba rule version is required.', 409);
  return createCardState(abaPackSpecification(), drawZone, zones);
}
