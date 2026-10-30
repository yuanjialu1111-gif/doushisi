import { SCORE_REGION_VERSIONS } from '@dss/rules';
import { requireCondition } from '../errors.js';
import type { PackEntry } from './cards.js';

export type ScoreRegionKey = keyof typeof SCORE_REGION_VERSIONS;

const specialCodes = [1001, 1002, 1003] as const;
const ordinaryRank = (code: number) => code % 100;
const enabled = (value: unknown) => value === 1 || value === true;

function splitSpecialCount(wangNum: number): [number, number, number] {
  const counts: Record<number, [number, number, number]> = {
    0: [0, 0, 0], 1: [0, 0, 1], 2: [1, 1, 0], 3: [1, 1, 1],
    4: [2, 2, 0], 5: [2, 2, 1], 6: [2, 2, 2], 8: [3, 3, 2],
  };
  requireCondition(counts[wangNum], 'INVALID_REGIONAL_WANG_COUNT', 'Unsupported regional special-card count.', 400);
  return counts[wangNum]!;
}

/** Physical pack for every score-region configuration. */
export function regionalPackSpecification(variantKey: ScoreRegionKey,
  rules: Readonly<Record<string, unknown>>): PackEntry[] {
  const entries: PackEntry[] = [];
  const addSpecial = (code: number, count: number) => { if (count > 0) entries.push({ code, count }); };
  for (let suit = 1; suit <= 4; suit++) for (let rank = 1; rank <= 13; rank++) {
    entries.push({ code: suit * 100 + rank, count: 1 });
  }
  if (['14:0', '15:0', '16:0', '19:0'].includes(variantKey)) {
    addSpecial(1001, 1); addSpecial(1002, 1); addSpecial(1003, 1);
    return entries;
  }
  if (variantKey === '20:0') {
    const [small, big, white] = splitSpecialCount(rules.wangNum as number);
    addSpecial(1001, small); addSpecial(1002, big); addSpecial(1003, white);
    return entries;
  }
  if (variantKey === '21:0') {
    addSpecial(1001, 1); addSpecial(1002, 1); addSpecial(1003, 1);
    return entries;
  }
  if (variantKey === '22:0' && enabled(rules.siCaiErJing)) {
    addSpecial(1001, 1); addSpecial(1002, 1);
    return entries;
  }
  if (variantKey === '22:0') {
    addSpecial(1001, 1); addSpecial(1002, 1); addSpecial(1003, 1);
    return entries;
  }
  if (variantKey === '23:0' || variantKey === '24:0') {
    const [small, big, white] = splitSpecialCount(rules.wangNum as number);
    if (rules.wangNum === 0) {
      addSpecial(1001, 1); addSpecial(1002, 1); addSpecial(1003, 1);
    } else {
      addSpecial(1001, small); addSpecial(1002, big); addSpecial(1003, white);
    }
    return entries;
  }
  if (variantKey === '25:0' || variantKey === '27:0') {
    addSpecial(1003, rules.wangNum === 1 ? 1 : 0);
    return entries;
  }
  if (variantKey === '26:0') {
    const [small, big, white] = splitSpecialCount(rules.wangNum as number);
    addSpecial(1001, small); addSpecial(1002, big); addSpecial(1003, white);
    const totalSevens = rules.qiWangNum as number;
    requireCondition([4, 8, 12].includes(totalSevens), 'INVALID_REGIONAL_SEVEN_COUNT',
      'Ganluo requires 4, 8 or 12 sevens.', 400);
    for (let suit = 1; suit <= 4; suit++) {
      entries.find(entry => entry.code === suit * 100 + 7)!.count = totalSevens / 4;
    }
    return entries;
  }
  throw new Error(`Unsupported score-region pack: ${variantKey}`);
}

export function wildcardCard(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>, code: number): boolean {
  if (variantKey === '20:0') return rules.wangNum !== 0 && specialCodes.includes(code as never);
  if (variantKey === '21:0') return enabled(rules.wangToTingyong) && specialCodes.includes(code as never);
  if (variantKey === '22:0') {
    if (enabled(rules.siCaiErJing)) return ordinaryRank(code) === 7;
    return specialCodes.includes(code as never);
  }
  if (variantKey === '23:0' || variantKey === '24:0' || variantKey === '26:0') {
    return rules.wangNum !== 0 && specialCodes.includes(code as never);
  }
  if (variantKey === '25:0' || variantKey === '27:0') return rules.wangNum === 1 && code === 1003;
  return false;
}

export function automaticBonusCard(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>, code: number): boolean {
  if (wildcardCard(variantKey, rules, code)) return false;
  if (['14:0', '15:0', '16:0', '19:0'].includes(variantKey)) return specialCodes.includes(code as never);
  if (variantKey === '22:0' && enabled(rules.siCaiErJing)) return code === 1001 || code === 1002;
  if (variantKey === '22:0') return specialCodes.includes(code as never);
  if (variantKey === '25:0' || variantKey === '27:0') return code === 1003 && rules.wangNum === 0;
  if (['20:0', '21:0', '23:0', '24:0', '26:0'].includes(variantKey)) {
    return specialCodes.includes(code as never) && !wildcardCard(variantKey, rules, code);
  }
  return specialCodes.includes(code as never);
}

export function regionalHandSize(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>,
  playerCount: number, seat: number, dealerSeat: number): number {
  if (isRongxianSmallSeat(variantKey, rules, playerCount, seat, dealerSeat)) return 5;
  return seat === dealerSeat ? 8 : 7;
}

/** Rongxian's small seat is the dealer's upstream tail seat, not a fixed seat number. */
export function isRongxianSmallSeat(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>,
  playerCount: number, seat: number, dealerSeat: number): boolean {
  if (variantKey !== '20:0' || !enabled(rules.daXiaoJia) || playerCount !== 4) return false;
  const smallSeat = ((dealerSeat - 2 + playerCount) % playerCount) + 1;
  return seat === smallSeat;
}

export function regionalRedThreshold(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>): number {
  if (variantKey === '25:0' || variantKey === '27:0') return Number(rules.huRedScore);
  if (variantKey === '22:0' && enabled(rules.daQuanHong)) return 25;
  if (variantKey === '14:0' || variantKey === '15:0') return 300;
  if (variantKey === '16:0' || variantKey === '19:0') return Number(rules.huRedScore);
  return 20;
}

/** Regions 20-27 gate on red points; regions 14-19 gate on structure score. */
export function regionalThresholdUsesRedPoints(variantKey: ScoreRegionKey): boolean {
  return ['20:0', '21:0', '22:0', '23:0', '24:0', '25:0', '26:0', '27:0'].includes(variantKey);
}

export function regionalScoreUnits(variantKey: ScoreRegionKey, rules: Readonly<Record<string, unknown>>,
  fan: number): bigint {
  requireCondition(Number.isSafeInteger(fan) && fan >= 0, 'INVALID_REGIONAL_SCORE', 'Fan must be a nonnegative integer.', 500);
  const cap = Number(rules.maxFan ?? 99);
  if (variantKey === '20:0') {
    const a = BigInt(rules.chaoFanJiaDi as number);
    return (2n ** BigInt(Math.min(fan, cap))) + a * BigInt(Math.max(fan - cap, 0));
  }
  if (variantKey === '26:0') {
    const a = BigInt(rules.chaoFanJiaDi as number);
    return (2n ** BigInt(Math.min(fan, cap))) + a * BigInt(Math.max(fan - cap, 0));
  }
  const capped = cap === 99 ? fan : Math.min(fan, cap);
  return 2n ** BigInt(capped);
}
