export const QIONGLAI_PACK_VERSION = 'qionglai-approved-pack-v1';
export const QIONGLAI_PACK_APPROVAL = 'user-confirmed:2026-09-16:QL-D03-1';
export const QIONGLAI_WANG_COUNTS: readonly number[] = Object.freeze([3, 6, 9, 12, 15, 18]);
export const INDEPENDENT_APPROVAL_VERSION = 'independent-authorization-20260916-v1';
export const QIONGLAI_INDEPENDENT_VERSION = 'qionglai-independent-v1';
export const QIONGLAI_INDEPENDENT_FANS = Object.freeze({
  tianHu: 3, diHu: 3, redHu: 3, blackHu: 4, red50: 3, black50: 3, bonus: 1,
});
export const QIONGLAI_SCORING_VERSION = 'qionglai-package-scoring-v1';
/** Literal Qionglai amounts, not a complete winning algorithm or payment rule. */
export const QIONGLAI_PACKAGE_FANS = Object.freeze({
  qia20: 3, jinGouDiao: 3, anDui: 3, dragon: 3, siGuiYi: 1, keSuHu: 3, redHu: 3, blackHu: 4,
});
export const QIONGLAI_FAN_SOURCES = Object.freeze({
  options: 'main/FrameGameConfig.js:8:0:config_playmethod',
  colors: 'main/CommonPlayUIController.js:298-302:EN_AREA_TYPE_PKDDS_CDQL',
  formula: 'main/FrameGameConfig.js:8:0:config_fan',
  declaration: 'main/FrameGameConfig.js:8:0:config_baoJiaoYingbao',
});

export const EDITION_ID = 'dou14-regions-21-v1';
export const RETAINED_GAME_IDS = Object.freeze([4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
export const RETAINED_VARIANT_KEYS = Object.freeze(RETAINED_GAME_IDS.map(id => `${id}:0`));
export const supportsNewRoom = (key: string): boolean => RETAINED_VARIANT_KEYS.includes(key);
// 第二轮只留新津斗十四（DEC-20261031-单玩法去地区）：界面只显示这些玩法、地区一律当新津；
// 服务端照旧接受 RETAINED 里的全部，老房间、战绩、回放不受影响。
export const VISIBLE_GAME_IDS = Object.freeze([4]);
export const VISIBLE_VARIANT_KEYS = Object.freeze(VISIBLE_GAME_IDS.map(id => `${id}:0`));
export const isVisibleVariant = (key: string): boolean => VISIBLE_VARIANT_KEYS.includes(key);
export const XINJIN_REGION = Object.freeze({ shiName: '成都市', xianName: '新津' });
export function freezeIndependentApproval(variantKey: string) {
  if (!supportsNewRoom(variantKey)) throw new Error('Independent authorization is limited to retained configurations');
  return { version: INDEPENDENT_APPROVAL_VERSION, variantKey, approvedAt: '2026-09-16',
    source: 'user:all-independent-definitions-approved', verification: 'implementation-and-tests-required' };
}
export const QIONGLAI_OPTION_VERSION = 'qionglai-additions-v1';
export const YAAN_OPTION_VERSION = 'yaan-classic-additions-v1';
const YAAN_RULES_VERSION = 'yaan-independent-v1';
export const XINJIN_INDEPENDENT_VERSION = 'xinjin-independent-v1';
export const XINJIN_WANG_COUNTS: readonly number[] = Object.freeze([3, 5, 6, 9]);
export const XINJIN_INDEPENDENT_FANS = Object.freeze({
  qiToWang: 1, baoJiao: 1, diHu: 3, tianHu: 3, anDui: 3, qia20: 1,
  longDui: 4, xiaoHu: 3, qia40: 2, qia50: 3, siGuiYi: 1,
  // v2（DEC-20261031-第三轮规则v2）：鬼每张 1、碰（含偷出的三张）每组 1、杠（含巴杠）每组 2、全红 3、全黑 3。
  gui: 1, peng: 1, gang: 2, quanHong: 3, quanHei: 3,
});
/** 新津 v2 计分：跟头翻 2^番、5 番封顶，门槛按人数，点炮包三家，只一家胡。 */
export const XINJIN_SCORING_V2 = 'v2';
export const XINJIN_V2_MAX_FAN = 5;
export const xinjinRedGate = (playerNum: unknown): number => playerNum === 4 ? 20 : 25;
/** v2 固定玩法：报叫留动作不加番，天走、接地开，其余 v1 番关，7 不偷；自己翻出的牌自己也能吃（ziChi 1，下家照旧能吃）。 */
export const XINJIN_V2_OPTIONS = Object.freeze({
  maxFan: 5, chengFan: 1, qiToWang: 0, baoJiao: 1, diHu: 1, tianHu: 1, ziChi: 1, anDui: 0, qia20: 0,
  longDui: 0, xiaoHu: 0, qia40: 0, qia50: 0, siGuiYi: 0,
});
export function freezeXinjinOptions(options: Record<string, unknown>) {
  return {
    version: XINJIN_INDEPENDENT_VERSION,
    rulesVersion: XINJIN_INDEPENDENT_VERSION,
    wangNum: options.wangNum,
    ziChi: options.ziChi,
    status: 'independent-definition-authorized',
    source: 'docs/rules/XINJIN-INDEPENDENT.md:2026-10-31',
    scoring: XINJIN_SCORING_V2,
  };
}
export const ANYUE_INDEPENDENT_VERSION = 'anyue-independent-v1';
/** The original option list has no king selector; three kings are an independent definition. */
export const ANYUE_FIXED_KINGS = 3;
export const ANYUE_INDEPENDENT_FANS = Object.freeze({ bonus: 1, anDui: 3, quanHongHei: 3, zhuangJiadi: 1, cheLong: 1 });

export const ABA_INDEPENDENT_VERSION = 'aba-independent-v1';
export const ABA10_INDEPENDENT_VERSION = 'aba10-independent-v1';
export const ABA11_INDEPENDENT_VERSION = 'aba11-independent-v1';
export const ABA12_INDEPENDENT_VERSION = 'aba12-independent-v1';
export const WENCHUAN_INDEPENDENT_VERSION = 'wenchuan-independent-v1';
export const MAOXIAN_INDEPENDENT_VERSION = 'maoxian-independent-v1';
export const SUINING_INDEPENDENT_VERSION = 'suining-independent-v1';
export const TONGJIANG_INDEPENDENT_VERSION = 'tongjiang-independent-v1';
export const ABA_INDEPENDENT_VERSIONS = Object.freeze({
  '9:0': ABA_INDEPENDENT_VERSION,
  '10:0': ABA10_INDEPENDENT_VERSION,
  '11:0': ABA11_INDEPENDENT_VERSION,
  '12:0': ABA12_INDEPENDENT_VERSION,
});
export const SCORE_REGION_VERSIONS = Object.freeze({
  '14:0': WENCHUAN_INDEPENDENT_VERSION,
  '15:0': MAOXIAN_INDEPENDENT_VERSION,
  '16:0': SUINING_INDEPENDENT_VERSION,
  '19:0': TONGJIANG_INDEPENDENT_VERSION,
  '20:0': 'rongxian-independent-v1',
  '21:0': 'yuexi-independent-v1',
  '22:0': 'yanjin-independent-v1',
  '23:0': 'xuzhou-independent-v1',
  '24:0': 'leibo-independent-v1',
  '25:0': 'junlian25-independent-v1',
  '26:0': 'ganluo-independent-v1',
  '27:0': 'junlian27-independent-v1',
});
export const SCORE_REGION_SOURCES = Object.freeze({
  '14:0': 'docs/rules/variants/14-0.md:2026-09-24',
  '15:0': 'docs/rules/variants/15-0.md:2026-09-24',
  '16:0': 'docs/rules/variants/16-0.md:2026-09-24',
  '19:0': 'docs/rules/variants/19-0.md:2026-09-24',
  '20:0': 'docs/rules/variants/20-0.md:2026-09-24',
  '21:0': 'docs/rules/variants/21-0.md:2026-09-24',
  '22:0': 'docs/rules/variants/22-0.md:2026-09-24',
  '23:0': 'docs/rules/variants/23-0.md:2026-09-24',
  '24:0': 'docs/rules/variants/24-0.md:2026-09-24',
  '25:0': 'docs/rules/variants/25-0.md:2026-09-24',
  '26:0': 'docs/rules/variants/26-0.md:2026-09-24',
  '27:0': 'docs/rules/variants/27-0.md:2026-09-24',
});
/** Game 9 has no king-count selector: one small king, one big king and two white faces. */
export const ABA_FIXED_KINGS = 4;
export const ABA_RED_SCORES: readonly number[] = Object.freeze([300, 400, 500]);
export const ABA_BAOJIAO_CONDITIONS: readonly number[] = Object.freeze([1, 2, 3]);
export const ABA_BAIPI_TYPES: readonly number[] = Object.freeze([1, 2, 3]);
export const ABA_FAN_CAPS: readonly number[] = Object.freeze([2, 3, 4, 99]);
export const ABA_INDEPENDENT_FANS = Object.freeze({
  baoJiao: 1, diHu: 1, cheLong: 1, jiaFan258Peng: 1, jiaFan258Gang: 2,
  doubleInOut: 1, haiDiLao: 1,
});
export function freezeAbaOptions(options: Record<string, unknown>, variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS = '9:0') {
  return {
    version: ABA_INDEPENDENT_VERSIONS[variantKey],
    rulesVersion: ABA_INDEPENDENT_VERSIONS[variantKey],
    huRedScore: options.huRedScore,
    baojiaoCondition: options.baojiaoCondition,
    baipiType: options.baipiType,
    maxFan: options.maxFan,
    status: 'independent-definition-authorized',
    source: `docs/rules/ABA-INDEPENDENT.md:2026-09-24:${variantKey}`,
  };
}
export function freezeScoreRegionOptions(options: Record<string, unknown>,
  variantKey: keyof typeof SCORE_REGION_VERSIONS) {
  return {
    version: SCORE_REGION_VERSIONS[variantKey],
    rulesVersion: SCORE_REGION_VERSIONS[variantKey],
    status: 'independent-definition-authorized',
    source: SCORE_REGION_SOURCES[variantKey],
  };
}
export function freezeAnyueOptions(options: Record<string, unknown>) {
  return {
    version: ANYUE_INDEPENDENT_VERSION,
    rulesVersion: ANYUE_INDEPENDENT_VERSION,
    wangNum: ANYUE_FIXED_KINGS,
    piaoType: options.piaoType,
    status: 'independent-definition-authorized',
    source: 'docs/rules/ANYUE-INDEPENDENT.md:2026-09-24',
  };
}
export function freezeYaanOptions(options: Record<string, unknown>) {
  return {
    version: YAAN_OPTION_VERSION,
    rulesVersion: YAAN_RULES_VERSION,
    qiWangNum: options.qiWangNum,
    wangNum: options.wangNum,
    ziChi: options.ziChi,
    status: 'independent-definition-authorized',
    source: 'docs/rules/YAAN-INDEPENDENT.md:2026-09-24',
  };
}
export const QIONGLAI_OPTIONS = Object.freeze([
  Object.freeze({ name: '天地胡', value: 'qlTianDiHu', default: 1,
    wenhao: '天胡仅限庄家原始起手，偷牌或补牌后不算；地胡为闲家胡庄家首次普通弃牌。' }),
  Object.freeze({ name: '红胡黑胡', value: 'qlHongHeiHu', default: 1,
    wenhao: '手牌与落地组合中的普通牌全红或全黑；奖励牌不计，王和白板不改变颜色，至少含一张普通牌。' }),
  Object.freeze({ name: '红50黑50', value: 'qlHongHei50', default: 1,
    wenhao: '先满足合法胡牌，手牌加落地组合中的红点或黑点达到50及以上计入该牌型；各牌型相加后封顶。' }),
]);
export interface QionglaiSwitches { qlTianDiHu: 0 | 1; qlHongHeiHu: 0 | 1; qlHongHei50: 0 | 1 }
export const QIONGLAI_CONDITIONS = Object.freeze({
  heaven: 'original-dealer-hand-before-steal-or-replacement',
  earth: 'non-dealer-wins-first-ordinary-dealer-discard',
  colors: 'hand-and-melds-real-normal-cards-at-least-one-exclude-bonus-and-wildcards',
  fifty: 'legal-win-and-at-least-50',
  stacking: 'sum-all-pattern-fan-then-cap',
});
export function freezeQionglaiOptions(options: Record<string, unknown>) {
  return {
    version: QIONGLAI_OPTION_VERSION,
    packVersion: QIONGLAI_PACK_VERSION,
    packSource: QIONGLAI_PACK_APPROVAL,
    rulesVersion: QIONGLAI_INDEPENDENT_VERSION,
    qlTianDiHu: options.qlTianDiHu, qlHongHeiHu: options.qlHongHeiHu, qlHongHei50: options.qlHongHei50,
    conditions: { ...QIONGLAI_CONDITIONS },
    fanStatus: 'independent-definition-authorized',
    fanVersion: QIONGLAI_INDEPENDENT_VERSION,
    fanSources: { colors: QIONGLAI_FAN_SOURCES.colors,
      independent: 'docs/rules/QIONGLAI-INDEPENDENT.md:2026-09-16' },
    fanTable: { ...QIONGLAI_INDEPENDENT_FANS },
  };
}
export const clientEdition = Object.freeze({ id: EDITION_ID, gameIds: RETAINED_GAME_IDS, visibleGameIds: VISIBLE_GAME_IDS,
  qionglaiVersion: QIONGLAI_OPTION_VERSION, qionglaiOptions: QIONGLAI_OPTIONS, qionglaiConditions: QIONGLAI_CONDITIONS });
