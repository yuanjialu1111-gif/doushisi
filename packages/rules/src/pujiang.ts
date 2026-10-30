export const PUJIANG_INDEPENDENT_VERSION = 'pujiang-independent-v1';
export const PUJIANG_WANG_COUNTS: readonly number[] = Object.freeze([6, 9, 12, 15]);
export const PUJIANG_FANS = Object.freeze({ qia20: 3, jinGouDiao: 3, anDui: 3, dragon: 3, siGuiYi: 1, keSuHu: 3 });
export function freezePujiangOptions(options: Record<string, unknown>) {
  return {
    version: PUJIANG_INDEPENDENT_VERSION,
    rulesVersion: PUJIANG_INDEPENDENT_VERSION,
    wangNum: options.wangNum,
    baoJiaoYingbao: options.baoJiaoYingbao,
    status: 'independent-definition-authorized',
    source: 'docs/rules/PUJIANG-INDEPENDENT.md:2026-09-24',
  };
}
