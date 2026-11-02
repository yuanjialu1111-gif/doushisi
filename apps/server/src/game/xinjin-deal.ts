import { requireCondition } from '../errors.js';
import type { PhysicalCard } from './cards.js';
import { ordinaryRank } from './ordinary-melds.js';

export const XINJIN_DEAL_VERSION = 'xinjin-deal-v1';

const isBonus = (code: number) => [1001, 1002, 1003].includes(code);
const isRed = (code: number) => [1, 3].includes(Math.floor(code / 100));
/** 和 xinjin-win 的 point 一致：J/Q/K 记 1 点，其余记本身点数。 */
const point = (code: number) => { const rank = ordinaryRank(code); return rank >= 11 ? 1 : rank; };

/**
 * 从一副排好序的牌堆里切出某个座位这一局拿到的手牌。
 * 顺序必须与 createXinjinRound 的 dealCards 一致：庄家起每轮每家人一张，共 7 轮，庄家最后再多一张。
 */
export function xinjinDealHand(ordered: readonly PhysicalCard[], playerNum: number, dealerSeat: number, targetSeat: number) {
  requireCondition(Array.isArray(ordered) && ordered.length >= 52 && Number.isInteger(playerNum) && playerNum >= 2 && playerNum <= 4 &&
    Number.isInteger(dealerSeat) && dealerSeat >= 1 && dealerSeat <= playerNum &&
    Number.isInteger(targetSeat) && targetSeat >= 1 && targetSeat <= playerNum,
  'INVALID_DEAL_EVALUATION', 'Deal evaluation needs a physical pack and a valid player position.', 500);
  const offset = (targetSeat - dealerSeat + playerNum) % playerNum;
  const hand: PhysicalCard[] = [];
  for (let index = 0; index < 7; index++) hand.push(ordered[index * playerNum + offset]!);
  if (offset === 0) hand.push(ordered[7 * playerNum]!);
  return hand;
}

/**
 * 斗十四的发牌评分：只看目标座位手里这几张牌，不看整副牌。
 * 依次比 能凑几组（两张点数凑 14，7 自配；三张、四张同点能偷、杠出来算一组；四个同点对子是暗四对，按凑满算）> 红点 > 鬼牌数；分数越大越好。
 * 组数是能不能胡的前提，所以排第一；红点决定过不过 20/25 门槛，排第二。
 */
export function xinjinDealEvaluation(ordered: readonly PhysicalCard[], playerNum: number, dealerSeat: number, targetSeat: number): number[] {
  const hand = xinjinDealHand(ordered, playerNum, dealerSeat, targetSeat);
  const counts = new Map<number, number>();
  let redPoints = 0, bonuses = 0;
  for (const card of hand) {
    if (isBonus(card.code)) { bonuses++; continue; }
    if (isRed(card.code)) redPoints += point(card.code);
    const rank = ordinaryRank(card.code);
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  // 暗四对：同点对子数（四张同点算两对），够四对就和凑满四组一样（DEC-20261102-发牌评分认三张和暗四对）。
  let pairs = 0;
  for (const count of counts.values()) pairs += Math.floor(count / 2);
  return [Math.max(bestGroups(counts), pairs), redPoints, bonuses];
}

/**
 * 每张牌只能进一组：三张、四张同点可以先偷、杠出来算一组（大吊车就是亮满三组）；
 * 剩下的 7 只跟自己配，其余按 1/13、2/12、3/11、4/10、5/9、6/8 配。几种拆法取组数最多的。
 */
function bestGroups(counts: ReadonlyMap<number, number>) {
  const pairGroups = (current: ReadonlyMap<number, number>) => {
    let groups = Math.floor((current.get(7) ?? 0) / 2);
    for (let rank = 1; rank <= 6; rank++) groups += Math.min(current.get(rank) ?? 0, current.get(14 - rank) ?? 0);
    return groups;
  };
  const sets = [...counts].filter(([, count]) => count >= 3).map(([rank]) => rank);
  let best = 0;
  const visit = (index: number, current: ReadonlyMap<number, number>, melds: number) => {
    if (index === sets.length) { best = Math.max(best, melds + pairGroups(current)); return; }
    const rank = sets[index]!, count = current.get(rank)!;
    for (const used of count === 4 ? [0, 3, 4] : [0, 3]) {
      const next = new Map(current); next.set(rank, count - used);
      visit(index + 1, next, melds + (used ? 1 : 0));
    }
  };
  visit(0, counts, 0);
  return best;
}
