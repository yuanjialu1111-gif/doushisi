import { SCORE_REGION_VERSIONS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import { createCardState, type CardState, type PackEntry, type ZoneSpec } from './cards.js';
import { regionalPackSpecification, type ScoreRegionKey } from './regional-profile.js';

/** Regional score-pack: 52 ordinary cards plus one small king, one big king and one white face. */
export function scoreRegionPackSpecification(): PackEntry[] {
  const entries: PackEntry[] = [];
  for (let suit = 1; suit <= 4; suit++) for (let rank = 1; rank <= 13; rank++) {
    entries.push({ code: suit * 100 + rank, count: 1 });
  }
  entries.push({ code: 1001, count: 1 }, { code: 1002, count: 1 }, { code: 1003, count: 1 });
  return entries;
}

export function createScoreRegionCardState(
  variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>,
  drawZone: string, zones: readonly ZoneSpec[],
): CardState {
  requireCondition(Object.hasOwn(SCORE_REGION_VERSIONS, variantKey), 'SCORE_REGION_PACK_MISMATCH',
    'The score-region pack cannot be used for another region.', 409);
  const metadata = rules.scoreRegion;
  requireCondition(metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).rulesVersion === SCORE_REGION_VERSIONS[variantKey],
  'SCORE_REGION_RULES_VERSION_REQUIRED', 'An explicitly frozen score-region rule version is required.', 409);
  return createCardState(regionalPackSpecification(variantKey, rules), drawZone, zones);
}
