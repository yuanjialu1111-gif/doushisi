export const YAAN_SCORING_VERSION = 'yaan-package-scoring-v1';
export const YAAN_INDEPENDENT_VERSION = 'yaan-independent-v1';
export const YAAN_WANG_COUNTS: readonly number[] = Object.freeze([3, 6, 9, 12]);
export const YAAN_SEVEN_KING_COUNTS: readonly number[] = Object.freeze([0, 4, 6, 8, 12]);
export const YAAN_PACKAGE_FANS = Object.freeze({ qia20: 1, baoJiao: 3, anDui: 3, dragon: 3 });
/**
 * Independent, user-authorized completion of the amounts the package leaves
 * unstated. Package-backed amounts above remain unchanged and are reused here.
 */
export const YAAN_INDEPENDENT_FANS = Object.freeze({
  qia20: 1, baoJiao: 3, anDui: 3, dragon: 3,
  tianHu: 3, diHu: 3, redHu: 3, blackHu: 4,
  red50: 3, black50: 3, gangHua: 1, gangPao: 1, jinGouDiao: 3,
});
export const YAAN_PLAIN_HU = Object.freeze({ allowed: true, fan: 0 });
export const YAAN_SCORE_SOURCES = Object.freeze({
  options: 'main/FrameGameConfig.js:6:0:config_playmethod',
  summary: 'main/CommonPlayUIController.js:294-297:EN_AREA_TYPE_PKDDS_YAH20',
  formula: 'main/FrameGameConfig.js:6:0:config_fan',
});
