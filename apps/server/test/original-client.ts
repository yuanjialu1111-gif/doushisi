import assert from 'node:assert/strict';
import { decodeFrame, encodeFrame, expectedBodyField } from '@dss/protocol';
import type { RuleEngine } from '../src/engines.js';

/**
 * 按原版客户端（assets/dss/index.js 的 dss_gameController、dss_selectController）加上热更新脚本的做法，
 * 把一手的选项变成它真会发的 HWRequestDoAction：
 * - 同一种操作只认第一条选项（_ntfOperate）；
 * - 出牌只发牌面 destCard，deathCard 里的牌锁着打不出；报叫是点「报」后再出一张，按 actType 12 发；
 *   起手报叫（这手没有出牌）照原版点「报」直接发，destCard 是选项里的 0；
 * - 吃、碰、偷、杠发所选那组的 colType、destCard、cards（isColAllCard 时不从手里另挑）；
 * - 胡、过只发 actType 和选项的 destCard。
 * 请求按原版的 protobuf 编一遍再解开，没设的字段（colType、cards）就和线上一样缺着。
 */
const DISCARD = 3, CHI = 9, DECLARE = 12;

export function clientRequests(choices: readonly Record<string, any>[], handCodes: readonly number[]) {
  const operatorList = new Map<number, Record<string, any>>();
  for (const choice of choices) if (!operatorList.has(choice.actType)) operatorList.set(choice.actType, choice);
  const requests: Record<string, unknown>[] = [];
  for (const [actType, choice] of operatorList) {
    const seatIndex = choice.seatIndex;
    if (actType === DECLARE && !operatorList.has(DISCARD)) requests.push({ seatIndex, actType, destCard: choice.destCard ?? 0 });
    else if (actType === DISCARD || actType === DECLARE) {
      for (const code of new Set(handCodes)) if (!(choice.deathCard ?? []).includes(code)) requests.push({ seatIndex, actType, destCard: code });
    } else if (choice.colInfo?.length) {
      if (actType !== CHI) assert.ok(choice.isColAllCard, `操作 ${actType} 没带 isColAllCard，阿坝、分数区会让人从手里另挑`);
      // 多种吃法的选牌框显示每组第二张（手里那张），要能分得清。
      else if (choice.colInfo.length > 1) assert.equal(new Set(choice.colInfo.map((col: any) => col.cards[1])).size, choice.colInfo.length, '吃法选牌框里有两组一样');
      for (const col of choice.colInfo) requests.push({ seatIndex, actType: actType === CHI ? col.actType : actType,
        colType: col.colType, destCard: col.destCard, cards: col.cards });
    } else requests.push({ seatIndex, actType, destCard: choice.destCard ?? 0 });
  }
  return requests;
}

export function overWire(body: Record<string, unknown>) {
  const field = expectedBodyField(23)!;
  return decodeFrame(encodeFrame({ cmd: 23 }, { [field]: body })).data[field] as Record<string, unknown>;
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function ownHand(engine: RuleEngine, state: unknown, userId: string) {
  const body = engine.original!.enter(structuredClone(state), userId).body as any;
  const own = body.gameStart.seats.find((seat: any) => seat.seatIndex === body.seatIndex);
  return (own?.tilesOnHand ?? []) as number[];
}

/**
 * 只用原版客户端会发的请求把一局打到底：每一手核对客户端能发的请求都被服务端接受、
 * 而且服务端允许的每个动作客户端都发得出来；再随机挑一个打下去。
 */
export function playThroughOriginalClient(engine: RuleEngine, start: unknown, seed: number, maxSteps = 400) {
  let state = start, random = seed, steps = 0;
  const next = () => (random = (random * 1103515245 + 12345) % 2147483648) / 2147483648;
  const players = ((start as any).players ?? []).map((player: any) => String(player.userId ?? player.id));
  assert.ok(players.length >= 2, '取不到玩家');
  const seen = new Set<number>();
  let combos = 0;
  for (; steps < maxSteps; steps++) {
    const acting = players.map((userId: string) => ({ userId, actions: engine.interactions!.legalActions(structuredClone(state), userId) as Record<string, any>[] }))
      .filter((item: { actions: unknown[] }) => item.actions.length);
    if (!acting.length) break;
    const server = acting.find((item: { actions: Record<string, any>[] }) => item.actions.some(action => ['begin', 'draw', 'piao'].includes(action.type)));
    if (server) { state = engine.apply(structuredClone(state), server.userId, server.actions[0]).snapshot; continue; }
    const { userId, actions } = acting[Math.floor(next() * acting.length)]!;
    const packet = engine.original!.notifications(structuredClone(state), [], userId, 'action').find(item => item.command === 20);
    assert.ok(packet, `${userId} 有可走的动作却没收到选项`);
    combos += (packet!.body as any).choices.filter((choice: any) => (choice.colInfo?.length ?? 0) > 1).length;
    const requests = clientRequests((packet!.body as any).choices, ownHand(engine, state, userId));
    const decisionId = actions[0]!.decisionId;
    const reached = new Map<string, unknown>();
    for (const request of requests) {
      const decoded = engine.original!.decodeAction(23, overWire(request), decisionId);
      let resolved: unknown;
      try { resolved = engine.original!.resolveAction!(structuredClone(state), userId, decoded); }
      catch (error) { assert.fail(`第 ${steps} 手 ${userId} 发 ${JSON.stringify(request)} 被拒：${(error as Error).message}`); }
      reached.set(canonical(resolved), resolved);
      seen.add(Number(request.actType));
    }
    const legal = new Set(actions.map(canonical));
    for (const key of legal) assert.ok(reached.has(key), `第 ${steps} 手 ${userId} 原版客户端发不出 ${key}`);
    for (const key of reached.keys()) assert.ok(legal.has(key), `第 ${steps} 手 ${userId} 解出了不合规的 ${key}`);
    const options = [...reached.values()];
    state = engine.apply(structuredClone(state), userId, options[Math.floor(next() * options.length)]).snapshot;
  }
  return { state, steps, actTypes: seen, combos };
}
