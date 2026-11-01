import { originalCatalogue } from './original-catalogue.js';
import { supportsNewRoom, isVisibleVariant, EDITION_NAME, QIONGLAI_OPTIONS } from './edition.js';
export * from './edition.js';
export * from './yaan.js';
export * from './pujiang.js';
export * from './aba.js';

export const RULE_VERSION = 'apk-4.0-options-v1';
export const EVIDENCE_STATUS = 'unverified-gameplay' as const;
export const RELEASE_EVIDENCE_STATUS = 'verified-release' as const;
export const GAP_LEDGER_VERSION = 'rule-gap-ledger-v2';
export type EvidenceStatus = typeof EVIDENCE_STATUS | typeof RELEASE_EVIDENCE_STATUS;
export type RuleGapStatus = 'missing-evidence' | 'conflicting-client-evidence' | 'behavior-unverified'
  | 'resolved-by-product-rule' | 'non-blocking-record';
export type OptionValue = number | boolean;
export type RoomOptions = Record<string, OptionValue>;
export interface RegionContext { shiName?: string; xianName?: string }
export interface OriginalOption { name: string; value: string | OptionValue; default: number; wenhao?: string }
export interface OriginalGroup { name: string; multiple: number; maxCell: number; param?: string; config: OriginalOption[]; offset?: number }
export interface OriginalVariant { name: string; gameId: number; rule: Record<string, OriginalGroup> }
export interface OptionField {
  key: string;
  label: string;
  type: 'integer' | 'boolean';
  control: 'choice' | 'toggle' | 'fixed';
  allowedValues: readonly OptionValue[];
  defaultValue: OptionValue;
  required: true;
  sourceGroup: string;
  tooltip?: string;
}
export interface Variant {
  key: string;
  gameId: number;
  configurationIndex: number;
  name: string;
  ruleVersion: string;
  evidenceStatus: EvidenceStatus;
  gameplayReady: boolean;
  original: OriginalVariant;
}
export interface RoomSpec extends Variant {
  displayName: string;
  region: RegionContext;
  groups: Record<string, OriginalGroup>;
  fields: OptionField[];
  unresolvedFields: string[];
}
export interface RuleGap {
  id: string;
  variantKey: string;
  status: RuleGapStatus;
  blocksGameplay: boolean;
  fields: string[];
  description: string;
  evidence: string[];
  requiredEvidence: string;
  impact: string;
  exampleValid?: string;
  exampleInvalid?: string;
}
export class RuleValidationError extends Error {
  constructor(public readonly issues: string[]) { super(issues.join('; ')); this.name = 'RuleValidationError'; }
}

function deepFreeze<T>(object: T): T {
  if (object && typeof object === 'object') {
    Object.freeze(object);
    for (const child of Object.values(object)) deepFreeze(child);
  }
  return object;
}
export const originalVariants: readonly Variant[] = deepFreeze(Object.entries(originalCatalogue).flatMap(([id, variants]) =>
  (variants as OriginalVariant[]).map((original, index) => {
    const key = `${id}:${index}`;
    const retained = supportsNewRoom(key);
    return {
      key, gameId: Number(id), configurationIndex: index, name: isVisibleVariant(key) ? EDITION_NAME : original.name,
      ruleVersion: RULE_VERSION,
      evidenceStatus: retained ? RELEASE_EVIDENCE_STATUS : EVIDENCE_STATUS,
      gameplayReady: retained,
      original: isVisibleVariant(key) ? { ...original, name: EDITION_NAME } : original,
    };
  }),
));
export const catalogue: readonly Variant[] = deepFreeze(originalVariants.filter(variant => supportsNewRoom(variant.key)));

export function getVariant(key: string): Variant {
  const variant = originalVariants.find(item => item.key === key);
  if (!variant) throw new RuleValidationError([`Unsupported variant: ${key}`]);
  return variant;
}

/** Map the two deck configurations and Ya'an's dynamic blood-battle selection without conflating IDs. */
export function resolveVariantKey(gameId: number, options: { yifupai?: boolean | number; processType?: number } = {}): string {
  if (gameId === 2) {
    if (![true, false, 0, 1].includes(options.yifupai!)) throw new RuleValidationError(['Game 2 requires an explicit yifupai deck selection']);
    return options.yifupai ? '2:0' : '2:1';
  }
  if (gameId === 6 && options.processType === 2) return '101:0';
  if (options.processType === 2 && gameId !== 101) throw new RuleValidationError(['Blood-battle is only evidenced for Ya\'an red-twenty']);
  return getVariant(`${gameId}:0`).key;
}

export function displayName(key: string, region: RegionContext = {}, surface: 'room' | 'hall' = 'room'): string {
  const variant = getVariant(key);
  // 只留的那个玩法不分地区叫法（老房间存的新津、彭山、眉山也一样）。
  if (isVisibleVariant(key)) return variant.name;
  const city = region.shiName ?? '';
  const county = region.xianName ?? '';
  if (county === '其他区域' && city === '成都市') return '成都斗十四';
  if (surface === 'hall') {
    if (county === '射洪') return '射洪斗十四';
    if (county === '其他区域' && city === '巴中市') return '巴中斗十四';
    if (county === '旺苍') return '旺苍割胡';
    for (const [cityPart, label] of [['自贡', '自贡斗十四'], ['昭通', '昭通斗十四'], ['宜宾', '宜宾斗十四']]) {
      if (county.includes('其他') && city.includes(cityPart!)) return label!;
    }
    if (variant.gameId === 10) return (county === '其他区域' || !county ? '阿坝' : county) + '斗十四';
    if (county === '彭山') return '彭山斗十四';
    if (county === '其他区域' && city === '眉山') return '眉山斗十四';
    return variant.name;
  }
  switch (variant.gameId) {
    case 3: return county === '沿河' ? '沿河火十四' : '彭水火十四';
    case 4: return county === '其他区域' && city === '眉山' ? '眉山斗十四' : county === '彭山' ? '彭山斗十四' : variant.name;
    case 6: return county === '汉源' ? '汉源红二十' : variant.name;
    case 10: return (county === '其他区域' || !county ? '阿坝' : county) + '斗十四';
    case 15: return '阿坝斗十四';
    case 16: return county.includes('射洪') ? '射洪斗十四' : variant.name;
    case 18: return county.includes('旺苍') ? '旺苍割胡' : variant.name;
    case 19: return county.includes('其他') ? '巴中斗十四' : variant.name;
    case 20: return county.includes('其他') ? '自贡斗十四' : variant.name;
    case 22: return county.includes('其他') ? '昭通斗十四' : variant.name;
    case 23: return county.includes('其他') ? '宜宾斗十四' : variant.name;
    default: return variant.name;
  }
}

export function getRoomSpec(key: string, region: RegionContext = {}): RoomSpec {
  const variant = getVariant(key);
  const groups = structuredClone(variant.original.rule);
  // 房内不再定位（R11 AC2）：开房选项不再有「开启GPS定位」。
  delete groups.config_location;
  if (region.xianName?.includes('汶川') || region.xianName === '茂县') {
    groups.config_tingyong = { name: '听用', multiple: 0, maxCell: 3, param: 'hpToTingyong', config: [
      { name: '不打听用', value: 0, default: 0 }, { name: '白皮当听用', value: 1, default: 1 },
    ] };
  }
  if ([6, 101].includes(variant.gameId) && region.shiName?.includes('雅安')) {
    groups.config_hu = { name: '胡牌:', multiple: 0, maxCell: 3, param: 'processType', config: [
      { name: '经典玩法', value: 1, default: 1 }, { name: '血战玩法', value: 2, default: 0 },
    ] };
    if (variant.gameId === 6 && !supportsNewRoom('101:0')) {
      groups.config_hu.config = groups.config_hu.config.filter(option => option.value === 1);
    }
  }
  if (variant.gameId === 8) groups.config_playmethod!.config.push(...QIONGLAI_OPTIONS.map(option => ({ ...option })));
  const fields: OptionField[] = [];
  for (const [sourceGroup, group] of Object.entries(groups)) {
    if (group.multiple) {
      for (const option of group.config) {
        if (typeof option.value !== 'string') throw new Error('Invalid original toggle key');
        fields.push({ key: option.value, label: option.name, type: 'integer', control: 'toggle',
          allowedValues: [0, 1], defaultValue: option.default ? 1 : 0, required: true, sourceGroup,
          ...(option.wenhao ? { tooltip: option.wenhao } : {}),
        });
      }
    } else {
      const defaults = group.config.filter(option => option.default);
      if (!group.param || defaults.length !== 1 || group.config.some(option => typeof option.value === 'string')) throw new Error('Ambiguous original single-selection group');
      fields.push({ key: group.param, label: group.name, type: typeof defaults[0]!.value === 'boolean' ? 'boolean' : 'integer',
        control: 'choice', allowedValues: group.config.map(option => option.value as OptionValue),
        defaultValue: defaults[0]!.value as OptionValue, required: true, sourceGroup,
      });
    }
  }
  if (variant.gameId === 2) fields.push({ key: 'yifupai', label: variant.name, type: 'boolean', control: 'fixed',
    allowedValues: [variant.configurationIndex === 0], defaultValue: variant.configurationIndex === 0,
    required: true, sourceGroup: 'hall:onClickGameBtn',
  });
  if (variant.gameId === 101) {
    const previous = fields.findIndex(field => field.key === 'processType');
    if (previous >= 0) fields.splice(previous, 1);
    fields.push({ key: 'processType', label: '血战玩法', type: 'integer', control: 'fixed', allowedValues: [2],
      defaultValue: 2, required: true, sourceGroup: 'hall:config_hu+dss:getRule',
    });
  }
  // The fire-fourteen UI forcibly disables eight-tens for its one-deck default.
  if (variant.gameId === 3) fields.find(field => field.key === 'bage10tianhu')!.defaultValue = 0;
  // External white faces are implemented and evidenced only for 11:0.
  if ([9, 10, 12].includes(variant.gameId)) {
    const baipiType = fields.find(field => field.key === 'baipiType');
    if (baipiType) baipiType.allowedValues = [1];
  }
  return { ...variant, displayName: displayName(key, region), region: { ...region }, groups, fields,
    unresolvedFields: ['playerNum', 'basicTimes'].filter(field => !fields.some(item => item.key === field)),
  };
}

export function getDefaultOptions(key: string, region: RegionContext = {}): RoomOptions {
  return Object.fromEntries(getRoomSpec(key, region).fields.map(field => [field.key, field.defaultValue]));
}

/** Strict complete-snapshot validation. Defaults are explicit via getDefaultOptions, never silently filled. */
export function validateRoomOptions(key: string, input: unknown, region: RegionContext = {}): RoomOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RuleValidationError(['Options must be an object']);
  const spec = getRoomSpec(key, region);
  const source = input as Record<string, unknown>;
  const fields = new Map(spec.fields.map(field => [field.key, field]));
  const issues: string[] = [];
  const result: RoomOptions = {};
  for (const field of spec.fields) {
    if (!Object.hasOwn(source, field.key)) { issues.push(`Missing option: ${field.key}`); continue; }
    const value = source[field.key];
    if (!field.allowedValues.some(allowed => allowed === value)) issues.push(`Invalid option ${field.key}: expected ${field.allowedValues.join('|')}`);
    else result[field.key] = value as OptionValue;
  }
  for (const key of Object.keys(source)) if (!fields.has(key)) issues.push(`Unsupported option: ${key}`);
  if (spec.gameId === 3 && Object.hasOwn(result, 'yifupai') && result.bage10tianhu !== (result.yifupai ? 0 : 1)) issues.push('Fire-fourteen requires bage10tianhu=0 for one deck and 1 for two decks (client toggle behavior)');
  if (spec.gameId === 20 && result.maxFan === 99 && result.chaoFanJiaDi !== 0) issues.push('Uncapped Rongxian requires chaoFanJiaDi=0');
  if (spec.gameId === 20 && result.playerNum === 3 && result.daXiaoJia !== 0) issues.push('Three-player Rongxian requires daXiaoJia=0');
  if (result.processType === 2 && ![6, 101].includes(spec.gameId)) issues.push('Blood-battle for this regional game is not evidenced');
  if ([9, 10, 12].includes(spec.gameId) && (result.baipiType === 2 || result.baipiType === 3))
    issues.push(`${key} supports only baipiType=1; external white faces are implemented and evidenced for 11:0`);
  if (issues.length) throw new RuleValidationError(issues);
  return result;
}

export function baseScoreDecimal(wireBasicTimes: number): string {
  if (!Number.isSafeInteger(wireBasicTimes) || wireBasicTimes < 0) throw new RuleValidationError(['basicTimes must be a nonnegative safe integer']);
  const tenths = BigInt(wireBasicTimes);
  return tenths % 10n === 0n ? String(tenths / 10n) : `${tenths / 10n}.${tenths % 10n}`;
}

export function getRuleGaps(key: string): RuleGap[] {
  const variant = getVariant(key);
  const gaps: RuleGap[] = [];
  const retained = supportsNewRoom(key);
  const resolved = (field: string, description: string, evidence: string[], impact: string): RuleGap => ({
    id: `${key}:${field}`, variantKey: key, status: 'resolved-by-product-rule', blocksGameplay: false,
    fields: [field], description, evidence, impact,
    requiredEvidence: 'No original-client value is required because the local server requires an explicit host selection.',
  });

  if (!retained) {
    gaps.push({
      id: `${key}:audit-only`, variantKey: key, status: 'missing-evidence', blocksGameplay: false,
      fields: [], description: 'This original configuration is outside the retained 21-room release scope; it remains in the audit catalogue only.',
      evidence: ['packages/rules/src/edition.ts:RETAINED_VARIANT_KEYS'],
      requiredEvidence: 'No release evidence is required unless this configuration is added to the supported room scope.',
      impact: 'It is not offered as a local room and is excluded from the 21-configuration readiness count.',
    });
  }

  if (retained) {
    gaps.push(resolved('basicTimes', 'The original client omits basicTimes, but the local product requires the room host to enter a positive baseBeans value for every room.',
      ['apps/server/src/rooms.ts:45-68', 'apps/server/src/original-wire.ts:629-647'],
      'This is a product-level input rule, not an inferred original default, and it does not block room creation.'));
  }
  if (key === '14:0' || key === '15:0') {
    gaps.push(resolved('playerNum', 'The original client omits playerNum for this configuration, but the local product requires the host to choose 2, 3, or 4 players.',
      ['apps/server/src/rooms.ts:45-52'], 'The host must select the player count explicitly; no original default is guessed.'));
  }
  if (key === '15:0') gaps.push({
    id: `${key}:name`, variantKey: key, status: 'non-blocking-record', blocksGameplay: false, fields: [],
    description: 'Configured title is 茂县斗十四; the room renderer returns 阿坝斗十四 for the same area identifier.',
    evidence: ['main:4351', 'dss:766'], impact: 'Display naming only; it does not change legal actions or settlement.',
    requiredEvidence: 'Reference screenshots for retained hall and room pages.',
  });
  if ([9, 10, 11, 12].includes(variant.gameId)) gaps.push({
    id: `${key}:player-score`, variantKey: key, status: 'resolved-by-product-rule', blocksGameplay: false,
    fields: ['playerNum', 'huRedScore'],
    description: 'The independent Aba rules use huRedScore as a direct structure-score threshold. playerNum selects how many seats are dealt and settled, but it does not scale the threshold.',
    evidence: ['apps/server/src/game/aba-win.ts:86,252', 'apps/server/src/game/aba-round.ts:328-330,463',
      'docs/rules/ABA-INDEPENDENT.md', 'docs/rules/release/' + key.replace(':', '-') + '/cases.json'],
    impact: 'A hand below the selected huRedScore is rejected; a hand at or above it is accepted independently of the selected player count.',
    requiredEvidence: 'No original-server value is required because the threshold is an explicitly approved independent rule. Boundary and player-count cases are release evidence, not a rule gap.',
  });
  if (variant.gameId === 24) gaps.push({
    id: `${key}:ownBaKeQiang`, variantKey: key, status: 'resolved-by-product-rule', blocksGameplay: false,
    fields: ['ownBaKeQiang'],
    description: 'Independent product rule for the conflicting original copy: ownBaKeQiang=1 lets other players rob-hu the tile used to complete the ba; ownBaKeQiang=0 still completes the submitter\'s ba normally but creates no rob-hu offer.',
    evidence: ['main:5646', 'main:1167', 'dss:947', 'apps/server/src/game/score-region-round.ts:425',
      'docs/rules/release/24-0/cases.json'],
    impact: 'The switch controls only whether a rob-hu response window follows the submitter\'s ba; it does not disable the ba upgrade.',
    requiredEvidence: 'No original-server value is required because this is an explicitly approved independent product rule. Both switch values have executable release cases.',
  });
  if (variant.gameId === 101) gaps.push({
    id: `${key}:blood-battle-routing`, variantKey: key, status: 'behavior-unverified', blocksGameplay: true,
    fields: ['areaType', 'processType'],
    description: 'ID101 has its own config but is outside the retained scope; Ya\'an routes processType=2 to it. Multi-winner continuation and subsequent-hand behavior are unverified.',
    evidence: ['hall:786', 'hall:864', 'dss:982'],
    exampleValid: 'After a blood-battle win, the remaining players continue and the next-hand state and settlement follow the original behavior.',
    exampleInvalid: 'A blood-battle route without a complete continuation rule is rejected instead of silently using classic Ya\'an behavior.',
    impact: 'Blood-battle routing is audit-only and cannot be enabled without a complete multi-winner round contract.',
    requiredEvidence: 'Original request/response for blood-battle and a complete multi-winner round, including subsequent hand handling.',
  });
  if (variant.gameId === 3) gaps.push({
    id: `${key}:eight-tens`, variantKey: key, status: 'conflicting-client-evidence', blocksGameplay: false, fields: ['yifupai', 'bage10tianhu'],
    description: 'Config defaults eight-tens on; the UI forces it off for one deck and on for two decks, and onClickGameBtn overwrites the restored deck selection after loading controls.',
    evidence: ['hall:893', 'hall:947', 'hall:1050'], impact: 'Audit-only configuration outside the retained scope; it is not offered for play.',
    requiredEvidence: 'Fresh and restored room creation payloads for both deck choices and the eight-tens win case.',
  });
  return gaps;
}
export const ruleGaps: readonly RuleGap[] = deepFreeze(originalVariants.flatMap(variant => getRuleGaps(variant.key)));
