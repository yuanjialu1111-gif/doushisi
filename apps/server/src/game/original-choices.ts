/**
 * 按原版客户端的读法整理一手的选项（HWNotifySeatOperationChoice.choices）。
 * - 原版同一种操作只认第一条（dss_gameController._ntfOperate），所以吃、碰、偷、杠（含巴）各合成一条，
 *   所有组合放进 colInfo，原版自己弹框让人挑；isColAllCard 让它直接发这组牌，不再从手里另挑（阿坝、分数区会另挑）。
 * - 别人打出、翻出的那张放在组合第一张：原版多种吃法的选牌框显示每组的第二张（手里那张）。
 * - 出牌只发一条，deathCard 是这手不能打的牌，原版会变灰锁住（报叫后只能打不改叫的牌）。
 * - 报叫也只发一条，deathCard 是不能报叫的牌；原版不读它，由热更新脚本在点「报」后锁牌。
 */
export interface OriginalColumn { seatIndex: number; actType: number; colType: number; cards: number[] }
export type OriginalChoiceItem =
  | { kind: 'discard' | 'declare'; code: number }
  /** incoming：别人打出或翻出、这手要吃碰的那张；自己手里的偷、杠、巴不带。destCard 是服务端核对时认的那张。 */
  | { kind: 'meld'; column: OriginalColumn; destCard: number; incoming?: number }
  | { kind: 'other'; choice: Record<string, unknown> };

const DISCARD = 3, DECLARE = 12;

export function originalChoices(seatIndex: number, handCodes: readonly number[], items: readonly OriginalChoiceItem[]) {
  const result: Record<string, unknown>[] = [];
  const allowed = new Map<number, Set<number>>([[DISCARD, new Set()], [DECLARE, new Set()]]);
  const melds = new Map<number, Record<string, unknown> & { colInfo: Record<string, unknown>[] }>();
  const others = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'meld' && item.kind !== 'other') {
      const actType = item.kind === 'discard' ? DISCARD : DECLARE;
      if (!allowed.get(actType)!.size) result.push({ seatIndex, actType, destCard: 0 });
      allowed.get(actType)!.add(item.code);
      continue;
    }
    if (item.kind === 'other') {
      const key = JSON.stringify(item.choice);
      if (!others.has(key)) { others.add(key); result.push(item.choice); }
      continue;
    }
    const { column, destCard, incoming } = item;
    const cards = [...column.cards];
    if (incoming !== undefined && cards.includes(incoming)) cards.splice(cards.indexOf(incoming), 1), cards.unshift(incoming);
    const col = { ...column, cards, destCard, destCardIsOwn: false };
    const group = melds.get(column.actType);
    if (group) { group.colInfo.push(col); continue; }
    const choice = { seatIndex, actType: column.actType, destCard, destCardIsOwn: false, isColAllCard: true, colInfo: [col] };
    melds.set(column.actType, choice);
    result.push(choice);
  }
  for (const choice of result) {
    const legal = allowed.get(choice.actType as number);
    if (legal?.size) choice.deathCard = [...new Set(handCodes)].filter(code => !legal.has(code));
  }
  return result;
}

/** 原版请求的动作字段。出牌、报叫只带牌面（destCard），不带 colType 和 cards；服务端按那张牌核对。 */
export function originalRequest(body: Readonly<Record<string, unknown>>) {
  const actType = Number(body.actType), destCard = Number(body.destCard) || 0;
  const cards = Array.isArray(body.cards) ? body.cards.map(Number) : [];
  if ((actType === DISCARD || actType === DECLARE) && !cards.length && destCard) return { actType, colType: Number(body.colType) || 1, destCard, cards: [destCard] };
  return { actType, colType: Number(body.colType) || 0, destCard, cards };
}
