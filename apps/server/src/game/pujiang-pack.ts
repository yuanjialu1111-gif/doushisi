import { PUJIANG_INDEPENDENT_VERSION, PUJIANG_WANG_COUNTS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { createCardState, type CardState, type PackEntry, type ZoneSpec } from './cards.js';

/** Pujiang pack: 52 ordinary cards plus an equal split of the three royal faces. */
export function pujiangPackSpecification(wangNum: number): PackEntry[] {
  requireCondition(PUJIANG_WANG_COUNTS.includes(wangNum), 'INVALID_PUJIANG_WANG_COUNT',
    'Pujiang requires 6, 9, 12 or 15 royal cards.', 400);
  const entries: PackEntry[] = [];
  for (let suit = 1; suit <= 4; suit++) for (let rank = 1; rank <= 13; rank++) {
    entries.push({ code: suit * 100 + rank, count: 1 });
  }
  for (const code of [1001, 1002, 1003]) entries.push({ code, count: wangNum / 3 });
  return entries;
}

export function createPujiangCardState(
  variantKey: string, rules: Readonly<Record<string, unknown>>, drawZone: string, zones: readonly ZoneSpec[],
): CardState {
  requireCondition(variantKey === '7:0', 'PUJIANG_PACK_REGION_MISMATCH',
    'The independent Pujiang pack cannot be used for another region.', 409);
  const metadata = rules.pujiang;
  requireCondition(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).rulesVersion === PUJIANG_INDEPENDENT_VERSION,
  'PUJIANG_RULES_VERSION_REQUIRED', 'An explicitly frozen Pujiang rule version is required.', 409);
  requireCondition(typeof rules.wangNum === 'number', 'INVALID_PUJIANG_WANG_COUNT',
    'The frozen Pujiang royal-card count must be numeric.', 400);
  return createCardState(pujiangPackSpecification(rules.wangNum), drawZone, zones);
}
