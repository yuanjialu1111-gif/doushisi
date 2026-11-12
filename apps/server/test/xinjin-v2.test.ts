import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeXinjinOptions, getDefaultOptions, XINJIN_INDEPENDENT_VERSION, XINJIN_V2_OPTIONS } from '@dss/rules';
import { evaluateXinjinWin, type XinjinHand, type XinjinWinContext } from '../src/game/xinjin-win.js';
import type { EngineResult, RoundInput } from '../src/engines.js';
import { createXinjinEngine } from '../src/game/xinjin-engine.js';
import { playThroughOriginalClient } from './original-client.js';
import { MSGEvent } from '@dss/protocol';
import { assertCardState } from '../src/game/cards.js';
import { createXinjinCardState, xinjinPackSpecification } from '../src/game/xinjin-pack.js';
import { applyXinjinAction, assertXinjinRound, createXinjinRound, viewXinjinRound, xinjinLegalActions,
  xinjinTimedAction, type XinjinAction, type XinjinRound } from '../src/game/xinjin-round.js';

function input(count = 2, overrides: Record<string, unknown> = {}): RoundInput {
  const rules = { ...getDefaultOptions('4:0'), playerNum: count, gameNum: 4, wangNum: 3, baseBeans: '100',
    ...XINJIN_V2_OPTIONS, ...overrides };
  return { players: Array.from({ length: count }, (_, index) => ({ userId: String.fromCharCode(97 + index), seat: index + 1 })),
    ownerUserId: 'a', number: 1, rules: { ...rules, xinjin: freezeXinjinOptions(rules) },
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}
function pack(round: RoundInput) {
  return createXinjinCardState('4:0', round.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
}
function make(hands: number[][], tail: number[] = [], options: Record<string, unknown> = {}) {
  const roundInput = input(hands.length, options), physical = pack(roundInput), used = new Set<string>();
  const id = (code: number) => {
    const card = physical.find(item => item.code === code && !used.has(item.id));
    assert.ok(card, `Fixture face unavailable: ${code}`); used.add(card.id); return card.id;
  };
  const deal = Array.from({ length: 7 }, (_, index) => hands.map(hand => hand[index]!)).flat();
  deal.push(hands[0]![7]!);
  const order = [...deal, ...tail].map(id);
  order.push(...physical.filter(card => !used.has(card.id)).map(card => card.id));
  return createXinjinRound(roundInput, order);
}
const zone = (state: XinjinRound, name: string) => state.cards.zones.find(item => item.id === name)!.cards;
const code = (state: XinjinRound, id: string) => state.cards.pack.find(card => card.id === id)!.code;
function action(state: XinjinRound, id: string, type: XinjinAction['type'], face?: number) {
  const found = xinjinLegalActions(state, id).find(candidate => candidate.type === type &&
    (face === undefined || 'cardId' in candidate && code(state, candidate.cardId) === face ||
      'cardIds' in candidate && candidate.cardIds.some(cardId => code(state, cardId) === face)));
  assert.ok(found, `Missing ${id} ${type} ${face ?? ''}`);
  return found;
}
function apply(state: XinjinRound, id: string, selected: XinjinAction): XinjinRound {
  const before = structuredClone(state);
  const result = applyXinjinAction(state, id, selected);
  assert.deepEqual(state, before);
  assertXinjinRound(result.snapshot as XinjinRound);
  return result.snapshot as XinjinRound;
}
function run(state: XinjinRound, id: string, type: XinjinAction['type'], face?: number) {
  const next = apply(state, id, action(state, id, type, face));
  return type === 'begin' ? noBao(noTou(next)) : next;
}
/** 开局只发牌，停在依次偷那一步。 */
function begun(state: XinjinRound) { return apply(state, 'a', action(state, 'a', 'begin')); }
/** 起手依次偷还没轮完的人都点「过」。 */
function noTou(state: XinjinRound) {
  while (state.phase === 'touing') state = apply(state, state.activeId, action(state, state.activeId, 'guo'));
  return state;
}
/** 起手报叫窗口里还没选的人都点「不报」。 */
function noBao(state: XinjinRound) {
  while (state.phase === 'declaring') state = apply(state, state.openingDeclare!.pending[0]!, action(state, state.openingDeclare!.pending[0]!, 'buBao'));
  return state;
}
function passAll(state: XinjinRound) {
  while (state.phase === 'response') {
    const next = state.players.find(item => xinjinLegalActions(state, item.userId).length);
    assert.ok(next);
    const pass = xinjinLegalActions(state, next.userId).find(candidate => candidate.type === 'respond' && candidate.choiceId === null)!;
    state = apply(state, next.userId, pass);
  }
  return state;
}


// ---- 新津 v2（DEC-20261031-第三轮规则v2）----
function v2Rules(playerNum = 4) {
  return { ...getDefaultOptions('4:0'), wangNum: 3, playerNum, ...XINJIN_V2_OPTIONS,
    xinjin: { rulesVersion: XINJIN_INDEPENDENT_VERSION, scoring: 'v2' } };
}
function v2Hand(codes: number[], melds: { kind: 'tou' | 'gang' | 'peng' | 'ba' | 'chi'; codes: number[] }[] = [], bonus: number[] = []): XinjinHand {
  let n = 0;
  const cards = (values: number[]) => values.map(value => ({ id: `v2-${++n}`, code: value }));
  return { concealed: cards(codes), melds: melds.map(meld => ({ kind: meld.kind, cards: cards(meld.codes) })), bonus: cards(bonus) };
}
const flipAt = (state: XinjinHand): XinjinWinContext =>
  ({ winnerSeat: 2, dealerSeat: 1, source: 'flip', sourceSeat: 1, incomingCardId: state.concealed[0]!.id, discardCount: 3 });

test('v2 门槛几人桌都是红 20（DEC-20261112-都红20起胡）', () => {
  const state = v2Hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const four = evaluateXinjinWin(state, flipAt(state), v2Rules(4));
  assert.equal(four.status, 'winning');
  // 红正好 20 是金二十 3 番。
  if (four.status === 'winning') { assert.equal(four.redPoints, 20); assert.equal(four.totalFan, 3); assert.equal(four.scoreUnits, '8'); }
  assert.equal(evaluateXinjinWin(state, flipAt(state), v2Rules(3)).status, 'winning');
  assert.equal(evaluateXinjinWin(state, flipAt(state), v2Rules(2)).status, 'winning');
  // 红 9 换成黑 9：红只剩 11，几人桌都不够。
  const short = v2Hand([110, 204, 409, 205, 101, 413, 206, 408]);
  for (const players of [4, 3, 2]) {
    const result = evaluateXinjinWin(short, flipAt(short), v2Rules(players));
    assert.equal(result.status, 'not-winning');
    if (result.status === 'not-winning') assert.equal(result.reason, 'points');
  }
});

test('v2 番：鬼每张 1、偷出三张算碰 1、杠 2，跟头翻不封顶', () => {
  const melds = [{ kind: 'tou' as const, codes: [112, 212, 412] }, { kind: 'gang' as const, codes: [113, 213, 313, 413] }];
  const state = v2Hand([110, 204, 309, 205], melds, [1001, 1002]);
  const result = evaluateXinjinWin(state, flipAt(state), v2Rules(4));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.deepEqual(result.items.map(item => [item.pattern, item.fan]), [['gui', 2], ['peng', 1], ['gang', 2]]);
  assert.equal(result.cappedFan, 5);
  assert.equal(result.scoreUnits, '32');
  const more = v2Hand([110, 204, 309, 205], melds, [1001, 1002, 1003]);
  const capped = evaluateXinjinWin(more, flipAt(more), v2Rules(4));
  assert.ok(capped.status === 'winning' && capped.totalFan === 6 && capped.cappedFan === 6 && capped.scoreUnits === '64');
});

test('v2 番表：报叫、金二十、暗四对、龙对、红黑五十、金钩钓各 3 番', () => {
  const fans = (hand: XinjinHand, context: Partial<XinjinWinContext> = {}) => {
    const result = evaluateXinjinWin(hand, { ...flipAt(hand), ...context }, v2Rules(4));
    assert.equal(result.status, 'winning', JSON.stringify(result));
    return result as Extract<typeof result, { status: 'winning' }>;
  };
  const pairs = (result: ReturnType<typeof fans>) => result.items.map(item => [item.pattern, item.fan]);
  // 金二十：红正好 20（10+9+A）；报叫再加 3。
  const jin = v2Hand([110, 404, 109, 405, 101, 213, 202, 412]);
  assert.deepEqual(pairs(fans(jin)), [['qia20', 3]]);
  assert.deepEqual(pairs(fans(jin, { baoJiao: true })), [['baoJiao', 3], ['qia20', 3]]);
  // 暗四对：一组没亮，四个同点对子，不用凑 14。
  const dui = fans(v2Hand([105, 305, 110, 310, 202, 402, 211, 411]));
  assert.equal(dui.structure, 'four-pairs');
  assert.deepEqual(pairs(dui), [['anDui', 3]]);
  // 龙对：暗四对里四张同点，再加 3，共 6 番（不封顶）。
  const long = fans(v2Hand([105, 205, 305, 405, 110, 310, 202, 402]));
  assert.deepEqual(pairs(long), [['anDui', 3], ['longDui', 3]]);
  assert.equal(long.cappedFan, 6);
  // 亮了牌就不是暗四对。
  const opened = evaluateXinjinWin(v2Hand([105, 305, 110, 310, 202, 402], [{ kind: 'tou', codes: [111, 211, 311] }]),
    { ...flipAt(v2Hand([105])), incomingCardId: 'v2-1' }, v2Rules(4));
  assert.equal(opened.status, 'not-winning');
  // 黑五十、红五十要正好 50（DEC-20261102-五十要正好）：黑 50 红 6 能胡，不看门槛；全黑黑 56 只算全黑。
  assert.deepEqual(pairs(fans(v2Hand([408, 106, 209, 405, 208, 406, 207, 407]))), [['hei50', 3]]);
  assert.deepEqual(pairs(fans(v2Hand([210, 404, 209, 405, 208, 406, 207, 407]))), [['quanHei', 3]]);
  // 黑 52、红 4、不是全黑：不算黑五十，红点不够，不能胡。
  const black52 = v2Hand([210, 304, 209, 405, 208, 406, 207, 407]);
  assert.equal(evaluateXinjinWin(black52, flipAt(black52), v2Rules(4)).status, 'not-winning');
  // 红正好 50 算红五十；全红红 56 能胡，只算全红。
  assert.deepEqual(pairs(fans(v2Hand([308, 206, 109, 305, 108, 306, 307, 107]))), [['hong50', 3]]);
  assert.deepEqual(pairs(fans(v2Hand([110, 304, 109, 305, 108, 306, 307, 107]))), [['quanHong', 3]]);
  // 大吊车（金钩钓）：亮满三组碰、偷、杠，手里单吊、胡同点数的（颜色不管，吊 7 胡 7 也算）；胡凑 14 的只是普通胡；有吃的那组就不算。
  const melds = [{ kind: 'tou' as const, codes: [102, 302, 202] }, { kind: 'peng' as const, codes: [103, 303, 403] }, { kind: 'peng' as const, codes: [104, 304, 404] }];
  assert.deepEqual(pairs(fans(v2Hand([110, 210], melds))), [['peng', 3], ['jinGouDiao', 3]]);
  assert.deepEqual(pairs(fans(v2Hand([107, 207], melds))), [['peng', 3], ['jinGouDiao', 3]]);
  assert.deepEqual(pairs(fans(v2Hand([110, 204], melds))), [['peng', 3]]);
  const withChi = evaluateXinjinWin(v2Hand([110, 210], [...melds.slice(0, 2), { kind: 'chi' as const, codes: [109, 305] }]), flipAt(v2Hand([110])), v2Rules());
  assert.equal(withChi.status, 'not-winning', '有吃的组，两张同点凑不成 14，不能胡');
  // 红点不够照样不能胡大吊车（3 组 + 两张黑 10：红 18）。
  assert.equal(evaluateXinjinWin(v2Hand([210, 410], melds), flipAt(v2Hand([210])), v2Rules()).status, 'not-winning');
});

test('v2 手里的三张没偷出来不算组；只有全黑、黑五十、暗四对不看门槛', () => {
  // 三张 10 加一张 4 在手里不能拆成两两凑 14。
  const concealedTriple = v2Hand([110, 210, 310, 104, 101, 413, 206, 408]);
  assert.equal(evaluateXinjinWin(concealedTriple, flipAt(concealedTriple), v2Rules(4)).status, 'not-winning');
  // 全红也要够门槛：红 23 几人桌都能胡（门槛都是 20，DEC-20261112-都红20起胡）；红 16（换进一张黑 7）不能胡。
  const allRed = v2Hand([101, 113, 102, 112, 103, 111, 104, 110]);
  const red = evaluateXinjinWin(allRed, flipAt(allRed), v2Rules(4));
  assert.ok(red.status === 'winning' && red.items.some(item => item.pattern === 'quanHong') && red.scoreUnits === '8');
  assert.equal(evaluateXinjinWin(allRed, flipAt(allRed), v2Rules(3)).status, 'winning');
  const lowRed = v2Hand([101, 113, 102, 112, 103, 111, 207, 307]);
  assert.equal(evaluateXinjinWin(lowRed, flipAt(lowRed), v2Rules(3)).status, 'not-winning');
  const allBlack = v2Hand([201, 213, 202, 212, 203, 211, 204, 210]);
  const black = evaluateXinjinWin(allBlack, flipAt(allBlack), v2Rules(4));
  assert.ok(black.status === 'winning' && black.items.some(item => item.pattern === 'quanHei') && black.redPoints === 0);
  // 天胡也要够门槛：红 3 不能胡，红 28 能胡。
  const tianAt = { winnerSeat: 1, dealerSeat: 1, source: 'original-hand' as const, sourceSeat: null, incomingCardId: null, discardCount: 0 };
  const mixed = v2Hand([201, 213, 202, 212, 103, 211, 204, 210]);
  assert.equal(evaluateXinjinWin(mixed, tianAt, v2Rules(4)).status, 'not-winning');
  const tian = evaluateXinjinWin(v2Hand([110, 304, 109, 305, 201, 213, 202, 412]), tianAt, v2Rules(4));
  assert.ok(tian.status === 'winning' && tian.items.some(item => item.pattern === 'tianHu') && tian.redPoints === 28);
  // 暗四对红 5 也能胡，只算暗四对这种牌型（同一手拆成四组凑 14 的那种不让胡）。
  const pairs4 = v2Hand([102, 202, 103, 203, 211, 411, 212, 412]);
  const anDui = evaluateXinjinWin(pairs4, flipAt(pairs4), v2Rules(4));
  assert.ok(anDui.status === 'winning' && anDui.structure === 'four-pairs' && anDui.redPoints === 5);
});

test('v2 一张牌只让下家胡，点炮放牌人包三家，托管先打不成对的黑牌', () => {
  const state = make([[310, 402, 403, 405, 406, 407, 409, 410], [110, 204, 309, 205, 101, 413, 404],
    [103, 211, 102, 212, 108, 206, 104], [201, 202, 203, 207, 208, 209, 401]]);
  let next = run(state, 'a', 'begin');
  const auto = xinjinTimedAction(next, 'a')!;
  assert.equal(auto.delayMs, 15000);
  const autoFace = code(next, (auto.action as { cardId: string }).cardId);
  assert.ok(Math.floor(autoFace / 100) % 2 === 0 && ![405, 409].includes(autoFace), `托管打了 ${autoFace}`);
  next = run(next, 'a', 'discard', 310);
  assert.equal(next.phase, 'response');
  const hu = (id: string) => xinjinLegalActions(next, id).find(item => item.type === 'respond' && item.choiceId !== null &&
    (next.claims!.offers.find(offer => offer.id === item.choiceId)!.action as { type: string }).type === 'hu')!;
  const huC = hu('c'), huB = hu('b');
  assert.ok(huB && huC);
  next = apply(next, 'c', huC);
  next = apply(next, 'b', huB);
  while (next.phase === 'response') {
    const waiting = next.players.find(item => xinjinLegalActions(next, item.userId).length)!;
    next = apply(next, waiting.userId, xinjinLegalActions(next, waiting.userId).find(item => item.type === 'respond' && item.choiceId === null)!);
  }
  assert.equal(next.phase, 'finished');
  assert.deepEqual(next.outcome!.winners.map(winner => winner.userId), ['b']);
  // 接地 3 番 → 8 份；点炮包三家 → 24 份 × 底分 100。
  assert.equal(next.outcome!.winners[0]!.win.scoreUnits, '8');
  const postings = Object.fromEntries(next.outcome!.payments.postings.map(posting => [posting.userId, Number(posting.amount)]));
  assert.deepEqual(postings, { a: -2400, b: 2400, c: 0, d: 0 });
  // 原版小结算：先播胡，再弹每家手牌、胡的那张、番型（接地 3）、番数和红点。
  const adapter = createXinjinEngine('v2-settle', () => 0).original!;
  const packets = adapter.notifications({ ...next, deal: {} }, [{ type: 'round-ended' }], 'c', 'action');
  assert.deepEqual(packets.map(packet => packet.command), [MSGEvent.HWNotifyActionFlow, MSGEvent.HWNotifyGameOver]);
  assert.equal((packets[0]!.body as any).action.seatIndex, 2);
  const over = packets[1]!.body as any;
  assert.equal(over.round, 1); assert.equal(over.allRound, 4); assert.equal(over.isHuang, false);
  const winner = over.smallResult.userBrand.find((brand: any) => brand.seatIndex === 2);
  assert.equal(winner.huCard, 310); assert.equal(winner.tilesOnHand.length, 8); assert.ok(winner.tilesOnHand.includes(310));
  assert.deepEqual(winner.cardType, [3]); assert.equal(winner.fanNum, 3); assert.equal(winner.pointNum, 30);
  const loser = over.smallResult.userBrand.find((brand: any) => brand.seatIndex === 3);
  assert.equal(loser.huCard, 0); assert.equal(loser.fanNum, 0); assert.equal(loser.pointNum, 17);
  // 原版收到胡动作就拿 redPoint 改本人底部的「红」：赢家要带和小结算一样的红黑点，不然胡完显示 0（11-01 测试台暗四对）。
  const own = (adapter.notifications({ ...next, deal: {} }, [{ type: 'round-ended' }], 'b', 'action')[0]!.body as any).action;
  assert.equal(own.redPoint, 30); assert.equal(own.blackPoint, winner.blackPoint);
  assert.equal((packets[0]!.body as any).action.redPoint, 0, '别人的红点不外露');
});

test('v2 偷出三张后摸到第四张可以巴杠', () => {
  // 手里三张 Q，偷出来补到第四张 Q，接着弹巴（手里本来就四张的直接弹杠，见下一条，DEC-20261112-四张直接杠）。
  const state = make([[112, 212, 312, 101, 102, 103, 104, 105], [201, 202, 203, 204, 205, 206, 208]], [412], {});
  let next = begun(state);
  assert.equal(next.phase, 'touing');
  const tou = xinjinLegalActions(next, 'a').find(item => item.type === 'tou');
  assert.ok(tou);
  next = apply(next, 'a', tou);
  const ba = xinjinLegalActions(next, 'a').find(item => item.type === 'ba');
  assert.ok(ba && code(next, (ba as { cardId: string }).cardId) === 412);
  next = apply(next, 'a', ba);
  assert.equal(next.players[0]!.melds[0]!.kind, 'ba');
  assert.equal(next.players[0]!.melds[0]!.cardIds.length, 4);
});

test('v2 自己翻出的牌自己也能吃，下家照旧能吃；老桌（ziChi 0）只给下家', () => {
  const hands = [[201, 202, 203, 204, 206, 301, 302, 303], [405, 208, 307, 111, 309, 410, 113]];
  const chiers = (options: Record<string, unknown>) => {
    let next = run(make(hands, [104], options), 'a', 'begin');
    next = passAll(run(next, 'a', 'discard', 303));
    next = run(next, 'b', 'draw');
    if (next.phase !== 'response') return [];
    return next.players.map(item => item.userId).filter(id => xinjinLegalActions(next, id).some(item => item.type === 'respond' &&
      item.choiceId !== null && (next.claims!.offers.find(offer => offer.id === item.choiceId)!.action as { type: string }).type === 'chi'));
  };
  assert.deepEqual(chiers({}), ['b']);
  assert.deepEqual(chiers({ ziChi: 0 }), []);
});

test('v2 要牌超时能胡就胡、能碰就碰，其余过', () => {
  const state = make([[201, 202, 203, 204, 206, 301, 302, 405], [205, 305, 307, 111, 309, 410, 113]]);
  const next = run(run(state, 'a', 'begin'), 'a', 'discard', 405);
  const auto = xinjinTimedAction(next, 'b')!;
  assert.equal(auto.action.type, 'respond');
  const choiceId = (auto.action as { choiceId: string | null }).choiceId;
  assert.equal((next.claims!.offers.find(offer => offer.id === choiceId)!.action as { type: string }).type, 'peng');
});

test('v2 第一局随机定庄，第二局起上局赢家当庄', () => {
  const dealers = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    let value = seed;
    const engine = createXinjinEngine(`v2-dealer-${seed}`, max => (value = (value * 16807) % 2147483647) % max);
    const snapshot = engine.create(input(4)) as XinjinRound;
    // 开局从庄家起依次偷：庄家没东西偷就轮到下一个能偷的；都没得偷直接庄家出牌（或起手报叫）。
    if (snapshot.phase === 'touing') assert.equal(snapshot.activeId, snapshot.openingTou!.pending[0]);
    else assert.equal(snapshot.openingTou, null);
    dealers.add(snapshot.dealerId);
  }
  assert.deepEqual([...dealers].sort(), ['a', 'b', 'c', 'd']);
  const engine = createXinjinEngine('v2-dealer-next', () => 0);
  const second = engine.create({ ...input(4), number: 2, previousRoundContext: { version: XINJIN_INDEPENDENT_VERSION, completedRound: 1, nextDealerId: 'c', dealerRun: 1 } }) as XinjinRound;
  assert.equal(second.dealerId, 'c');
});

test('开局从庄家起一家一家偷：轮到的人收到「偷 / 过」，别家只看倒计时；轮完才弹报叫、庄家出牌，之后没事件的一步不重播开局', () => {
  // 这个种子庄家 b 起手两张鬼，c 一张鬼：鬼不自动亮（DEC-20261108-起手依次偷）。
  let seed = 0;
  const engine = createXinjinEngine('v2-start', max => (seed = (seed * 1103515245 + 12345) % 2147483648) % max);
  let snapshot: any = engine.create(input(4));
  const dealer = snapshot.dealerId as string, others = ['a', 'b', 'c', 'd'].filter(id => id !== dealer);
  assert.equal(snapshot.phase, 'touing');
  assert.equal(snapshot.activeId, dealer);
  assert.deepEqual(snapshot.startEvents, []);
  for (const userId of ['a', 'b', 'c', 'd']) assert.equal(snapshot.cards.zones.find((zone: any) => zone.id === `bonus:${userId}`).cards.length, 0);
  const start = (userId: string) => engine.original!.notifications(snapshot, [], userId, 'start');
  assert.deepEqual(start(dealer).map(packet => packet.command), [MSGEvent.HWNotifyGameStart, MSGEvent.HWNotifySeatOperationChoice, MSGEvent.HWNotifyNextOperation]);
  assert.deepEqual((start(dealer)[1]!.body as any).choices.map((choice: any) => choice.actType), [7, 4]);
  for (const userId of others) assert.deepEqual(start(userId).map(packet => packet.command), [MSGEvent.HWNotifyGameStart, MSGEvent.HWNotifyNextOperation]);
  const clock = (userId: string, phase: 'start' | 'action', state = snapshot) => (engine.original!.notifications(state, [], userId, phase)
    .find(packet => packet.command === MSGEvent.HWNotifyNextOperation)?.body as any)?.seatIndex;
  const seat = (userId: string) => snapshot.players.find((player: any) => player.userId === userId).seat;
  for (const userId of ['a', 'b', 'c', 'd']) assert.equal(clock(userId, 'start'), seat(dealer));
  // 庄家偷鬼，轮到下一个有东西偷的；15 秒不点算「过」。
  const legal = (userId: string) => engine.interactions!.legalActions(snapshot, userId) as any[];
  snapshot = engine.apply(snapshot, dealer, legal(dealer).find(item => item.type === 'tou')!).snapshot;
  const order = [snapshot.activeId];
  assert.notEqual(snapshot.activeId, dealer);
  while (snapshot.phase === 'touing') {
    assert.deepEqual(legal(snapshot.activeId).map(item => item.type).at(-1), 'guo');
    for (const userId of ['a', 'b', 'c', 'd'].filter(id => id !== snapshot.activeId)) assert.deepEqual(legal(userId), []);
    assert.equal(xinjinTimedAction(snapshot, snapshot.activeId)!.action.type, 'guo');
    snapshot = engine.apply(snapshot, snapshot.activeId, legal(snapshot.activeId).find(item => item.type === 'guo')!).snapshot;
    if (snapshot.phase === 'touing') order.push(snapshot.activeId);
  }
  const cycle = snapshot.players.map((player: any) => player.userId);
  const after = (id: string) => (cycle.indexOf(id) - cycle.indexOf(dealer) + cycle.length) % cycle.length;
  assert.deepEqual(order, [...order].sort((x, y) => after(x) - after(y)), '按庄家起的座位顺序轮');
  // 偷完过完：起手报叫（都点不报），然后庄家出牌。
  while (snapshot.phase === 'declaring') {
    const next = snapshot.openingDeclare.pending[0];
    snapshot = engine.apply(snapshot, next, legal(next).find(item => item.type === 'buBao')!).snapshot;
  }
  assert.equal(snapshot.phase, 'discard');
  assert.equal(snapshot.activeId, dealer);
  snapshot = engine.apply(snapshot, dealer, legal(dealer).find(item => item.type === 'discard')!).snapshot;
  const responder = ['a', 'b', 'c', 'd'].find(id => engine.interactions!.legalActions(snapshot, id).some((item: any) => item.type === 'respond'));
  assert.ok(responder);
  // 能吃碰的人钟在自己，其他人（含打出、翻出这张的人）钟在当前那家，不暴露谁能吃碰。
  assert.equal(snapshot.phase, 'response');
  assert.equal(clock(responder, 'action'), seat(responder));
  const idle = ['a', 'b', 'c', 'd'].filter(id => !engine.interactions!.legalActions(snapshot, id).length);
  assert.ok(idle.length > 0);
  for (const userId of idle) assert.equal(clock(userId, 'action'), seat(snapshot.activeId), userId);
  const pass = (engine.interactions!.legalActions(snapshot, responder) as any[]).find(item => item.type === 'respond' && item.choiceId === null);
  const passed = engine.apply(snapshot, responder, pass);
  if (passed.events.length === 0) for (const userId of ['a', 'b', 'c', 'd']) {
    const commands = engine.original!.notifications(passed.snapshot, [], userId, 'action').map(packet => packet.command);
    assert.ok(!commands.includes(MSGEvent.HWNotifyPlayerDealCard) && !commands.includes(MSGEvent.HWNotifyActionFlow), userId);
  }
  for (const userId of ['a', 'b', 'c', 'd']) {
    const commands = engine.original!.notifications(snapshot, [], userId, 'action').map(packet => packet.command);
    assert.ok(!commands.includes(MSGEvent.HWNotifyPlayerDealCard) && !commands.includes(MSGEvent.HWNotifyActionFlow), userId);
  }
});

test('摸到鬼进手里、只发给本人，弹「偷」；点了偷四家看到，补的牌标成进手（isShangShou）只发给本人', () => {
  let state = make([[102, 103, 104, 105, 106, 108, 109, 110], [202, 203, 204, 205, 206, 208, 209]], [1001, 107]);
  state = run(state, 'a', 'begin');
  state = passAll(run(state, 'a', 'discard', 110));
  assert.equal(state.phase, 'draw');
  const drawn = applyXinjinAction(state, 'b', action(state, 'b', 'draw'));
  const adapter = createXinjinEngine('v2-replacement', () => 0).original!;
  const deals = (userId: string) => adapter.notifications({ ...(drawn.snapshot as XinjinRound), deal: {} }, drawn.events, userId, 'action')
    .filter(packet => packet.command === MSGEvent.HWNotifyPlayerDealCard).map(packet => packet.body as any);
  // 进手的牌带 isShua，原版才重画手牌（11-01 测试台：偷、摸鬼后手里还显示旧牌）。
  // 鬼不自动亮：进手里（只发给本人、标成进手），轮到他出牌，先弹「偷」（DEC-20261108-起手依次偷）。
  assert.deepEqual(deals('b').map(body => [body.value, body.isShangShou, body.isShua]), [[1001, true, true]]);
  assert.deepEqual(deals('a'), []);
  const touNext = drawn.snapshot as XinjinRound;
  assert.equal(touNext.phase, 'discard');
  assert.deepEqual(xinjinLegalActions(touNext, 'b').filter(item => item.type !== 'discard').map(item => item.type), ['tou']);
  assert.ok(!xinjinLegalActions(touNext, 'b').some(item => item.type === 'discard' && code(touNext, item.cardId) === 1001), '鬼不能打');
  // 点了偷：四家都看到偷出鬼，补的牌只发给本人、标成进手。
  const toued = applyXinjinAction(touNext, 'b', action(touNext, 'b', 'tou', 1001));
  const packets = (userId: string) => adapter.notifications({ ...(toued.snapshot as XinjinRound), deal: {} }, toued.events, userId, 'action');
  const flow = (userId: string) => packets(userId).filter(packet => packet.command === MSGEvent.HWNotifyActionFlow).map(packet => (packet.body as any).action);
  for (const userId of ['a', 'b']) assert.deepEqual(flow(userId).map(item => [item.actType, item.destCard]), [[7, 1001]]);
  const dealt = (userId: string) => packets(userId).filter(packet => packet.command === MSGEvent.HWNotifyPlayerDealCard).map(packet => packet.body as any);
  assert.deepEqual(dealt('b').map(body => [body.value, body.isShangShou, body.isShua]), [[107, true, true]]);
  assert.deepEqual(dealt('a'), []);
  assert.deepEqual(zone(toued.snapshot as XinjinRound, 'bonus:b').map(id => code(toued.snapshot as XinjinRound, id)), [1001]);
});

test('组合动作带和小结算一样的 id：第二个偷有自己的 id，巴挂到原组合上只带加的那张', () => {
  let state = begun(make([[105, 205, 305, 110, 210, 310, 101, 102], [202, 203, 204, 206, 208, 209, 211]], [405, 103, 104, 106]));
  const adapter = createXinjinEngine('v2-meld-id', () => 0).original!;
  const columns = (type: 'tou' | 'ba', face: number) => {
    const chosen = xinjinLegalActions(state, 'a').find(item => item.type === type &&
      ('cardIds' in item ? item.cardIds.some(id => code(state, id) === face) : code(state, item.cardId) === face))!;
    const result = applyXinjinAction(state, 'a', chosen);
    state = result.snapshot as XinjinRound;
    return adapter.notifications({ ...state, deal: {} }, result.events, 'a', 'action')
      .filter(packet => packet.command === MSGEvent.HWNotifyActionFlow).map(packet => (packet.body as any).action.colInfo?.[0]).filter(Boolean)
      .map(column => ({ id: column.id, addToId: column.addToId, cards: [...column.cards].sort() }));
  };
  assert.deepEqual(columns('tou', 105), [{ id: 11, addToId: undefined, cards: [105, 205, 305] }]);
  assert.deepEqual(columns('tou', 110), [{ id: 12, addToId: undefined, cards: [110, 210, 310] }]);
  assert.deepEqual(columns('ba', 405), [{ id: 1011, addToId: 11, cards: [405] }]);
});

test('新津 v2 桌只用原版客户端会发的请求能打完，每手合规动作都发得出（含报叫、碰、偷、巴杠）', () => {
  const seen = new Set<number>();
  for (const count of [4, 3, 2]) for (let game = 0; game < (process.env.XINJIN_GAMES ? Number(process.env.XINJIN_GAMES) : 12); game++) {
    let seed = game * 7919 + count;
    const engine = createXinjinEngine(`v2-client-${count}-${game}`, max => (seed = (seed * 1103515245 + 12345) % 2147483648) % max);
    const result = playThroughOriginalClient(engine, engine.create(input(count)), game + 1);
    assert.equal((result.state as XinjinRound).phase, 'finished', `第 ${game} 局 ${count} 人没打完`);
    for (const actType of result.actTypes) seen.add(actType);
  }
  if (process.env.XINJIN_GAMES) console.log('出现过的原版动作', [...seen].sort((a, b) => a - b).join(','));
  for (const actType of [3, 4, 9]) assert.ok(seen.has(actType), `没打到动作 ${actType}`);
});

test('v2 报叫要手里红点先够门槛；不够时全黑、黑五十、暗四对的叫照样能报（DEC-20261102-报叫要够红点）', () => {
  // 只有起手能报（DEC-20261108-只能起手报）：庄家点「报」后能打的就是能报的那几张。
  const declares = (start: XinjinRound) => {
    const state = noTou(begun(start));
    if (state.phase !== 'declaring' || !state.openingDeclare!.pending.includes('a')) return [];
    const turn = noBao(apply(state, 'a', action(state, 'a', 'bao')));
    return xinjinLegalActions(turn, 'a').filter(item => item.type === 'discard').map(item => code(turn, (item as { cardId: string }).cardId));
  };
  // 打黑Q后红 19（10+9），叫黑K/红K，只有红K够 20：不能报。
  assert.ok(!declares(make([[110, 204, 109, 205, 201, 213, 401, 412], [301, 302, 303, 304, 305, 306, 307]])).includes(412));
  // 打黑K后红 5，只叫暗四对（黑Q）：能报。
  assert.ok(declares(make([[102, 202, 103, 203, 211, 411, 212, 413], [301, 302, 303, 304, 305, 306, 307]])).includes(413));
  // 打黑Q后红 28：能报。
  assert.ok(declares(make([[110, 304, 109, 305, 201, 213, 206, 412], [301, 302, 303, 306, 307, 308, 309]])).includes(412));
});

test('v2 起手报叫：几家一起弹，选完的不影响别人；闲家红点不够不弹；报了锁牌不能吃碰（DEC-20261102-起手报叫）', () => {
  // b 听K（红 21），c 听7 但红点只有 7：只有 b 和能天胡的庄家弹。
  const hands = [[101, 213, 102, 412, 103, 311, 304, 110], [105, 309, 106, 408, 203, 111, 401],
    [202, 212, 204, 210, 205, 209, 107], [306, 307, 308, 206, 208, 302, 301]];
  const opened = apply(make(hands), 'a', action(make(hands), 'a', 'begin'));
  assert.equal(opened.phase, 'declaring');
  assert.deepEqual(opened.openingDeclare!.pending, ['a', 'b']);
  assert.deepEqual(xinjinLegalActions(opened, 'c'), []);
  const afterB = run(opened, 'b', 'bao');
  assert.equal(afterB.phase, 'declaring');
  assert.deepEqual(afterB.openingDeclare!.pending, ['a']);
  assert.deepEqual(xinjinLegalActions(afterB, 'a').map(item => item.type), ['bao', 'buBao']);
  assert.ok((afterB.players[1]!.declaredWaits ?? []).includes(113));
  const turn = run(afterB, 'a', 'buBao');
  assert.equal(turn.phase, 'discard');
  assert.equal(turn.openingDeclare, null);
  assert.ok(xinjinLegalActions(turn, 'a').some(item => item.type === 'hu'));
  // 重连进桌：报过叫的 b 带 baoTing，原版据此摆「报」字；没报的不带。
  const seats = (createXinjinEngine('v2-rejoin', () => 0).original!.enter({ ...turn, deal: {} }, 'c').body as any).gameStart.seats;
  assert.deepEqual(seats.map((seat: any) => seat.baoTing), [false, true, false, false]);
  // 庄家打红3：b 手里有红J 本来能吃，报了锁牌不弹吃。
  const response = run(turn, 'a', 'discard', 103);
  assert.ok(!xinjinLegalActions(response, 'b').some(item => item.type === 'respond' && item.choiceId !== null));
  const free = run(run(run(opened, 'b', 'buBao'), 'a', 'buBao'), 'a', 'discard', 103);
  assert.ok(xinjinLegalActions(free, 'b').some(item => item.type === 'respond' && item.choiceId !== null));
});

test('v2 庄家打掉一张就能报叫，开局和闲家一起弹；点了「报」只能打留得住叫的牌，打出去那张算报叫（DEC-20261102-庄家起手报叫）', () => {
  // a 庄家打黑K或黑Q能报（暗四对）；b 7 张听黑K。
  const hands = [[102, 202, 103, 203, 211, 411, 212, 413], [101, 110, 204, 309, 205, 306, 408]];
  const opened = apply(make(hands), 'a', action(make(hands), 'a', 'begin'));
  assert.deepEqual(opened.openingDeclare!.pending, ['a', 'b']);
  const waiting = run(opened, 'a', 'bao');
  assert.deepEqual(waiting.openingDeclare!.pending, ['b']);
  assert.equal(waiting.players[0]!.declaredWaits, null, '庄家点了报还没出牌，不算报上');
  const turn = run(waiting, 'b', 'buBao');
  assert.equal(turn.phase, 'discard');
  const choices = xinjinLegalActions(turn, 'a');
  assert.deepEqual(choices.map(item => item.type), ['discard', 'discard']);
  assert.deepEqual(choices.map(item => code(turn, (item as { cardId: string }).cardId)).sort(), [212, 413]);
  // 超时托管也只在这两张里挑。
  assert.ok([212, 413].includes(code(turn, (xinjinTimedAction(turn, 'a')!.action as { cardId: string }).cardId)));
  const thrown = applyXinjinAction(turn, 'a', action(turn, 'a', 'discard', 413));
  assert.ok(thrown.events.some(event => event.type === 'discard' && (event as { declared?: boolean }).declared === true));
  const after = thrown.snapshot as XinjinRound;
  assertXinjinRound(after);
  assert.deepEqual(after.players[0]!.declaredWaits, [112, 312, 412]);
  assert.equal(after.players[0]!.declarePending, undefined);
  // b 胡这张：8 份，报叫的 a 点炮多 3 番 → 64 份 × 底分 100。
  const hu = xinjinLegalActions(after, 'b').find(item => item.type === 'respond' && item.choiceId !== null &&
    (after.claims!.offers.find(offer => offer.id === item.choiceId)!.action as { type: string }).type === 'hu')!;
  const done = apply(after, 'b', hu);
  assert.equal(done.outcome!.winners[0]!.win.scoreUnits, '8');
  assert.deepEqual(Object.fromEntries(done.outcome!.payments.postings.map(posting => [posting.userId, Number(posting.amount)])), { a: -6400, b: 6400 });
  // 不报照常：八张都能打；过了起手就不能再报（DEC-20261108-只能起手报）。
  const free = run(run(opened, 'a', 'buBao'), 'b', 'buBao');
  assert.equal(xinjinLegalActions(free, 'a').filter(item => item.type === 'discard').length, 8);
  assert.ok(!xinjinLegalActions(free, 'a').some(item => item.type === 'declare'));
});

test('v2 报叫了没胡、被别家胡了：只有报叫的这家按番数 + 3 付，别人照常（DEC-20261102-报叫被截胡）', () => {
  const hands = [[101, 213, 102, 412, 103, 311, 304, 110], [105, 309, 106, 408, 203, 111, 401],
    [202, 212, 204, 210, 205, 209, 107], [306, 307, 308, 206, 208, 302, 301]];
  const opened = apply(make(hands), 'a', action(make(hands), 'a', 'begin'));
  const turn = run(run(opened, 'b', 'bao'), 'a', 'buBao');
  const done = run(turn, 'a', 'hu');
  const paid = Object.fromEntries(done.outcome!.payments.postings.map(posting => [posting.userId, Number(posting.amount)]));
  assert.ok(paid.c! < 0 && paid.c === paid.d);
  assert.equal(paid.b, paid.c! * 8);
  assert.equal(paid.a, -(paid.b! + paid.c! + paid.d!));
});

test('v2 胡的那张之前手里加摆出的全红只能胡红、全黑只能胡黑，红黑都有两样都能胡（DEC-20261103-胡牌看颜色）', () => {
  const at = (codes: number[], melds: Parameters<typeof v2Hand>[1] = []) => {
    const state = v2Hand(codes, melds);
    // 最后一张是胡的那张。
    return evaluateXinjinWin(state, { ...flipAt(state), incomingCardId: state.concealed.at(-1)!.id }, v2Rules());
  };
  const reason = (win: ReturnType<typeof at>) => win.status === 'not-winning' ? win.reason : 'winning';
  assert.equal(reason(at([110, 104, 109, 105, 108, 106, 107, 207])), 'color', '七张全红不能胡黑7');
  const red = at([110, 104, 109, 105, 108, 106, 107, 307]);
  assert.ok(red.status === 'winning' && red.items.some(item => item.pattern === 'quanHong'));
  assert.equal(reason(at([110, 104, 109, 105, 108, 206, 107, 207])), 'winning', '六红一黑，胡黑的也行');
  assert.equal(reason(at([210, 204, 209, 205, 208, 206, 207, 107])), 'color', '七张全黑不能胡红7');
  // 亮出来的也一起算：手里全红、吃的一组是黑的，就是红黑都有。
  assert.equal(reason(at([110, 304, 109, 305, 108, 206], [{ kind: 'chi', codes: [210, 404] }])), 'winning');
  assert.equal(reason(at([110, 304, 109, 305, 108, 206], [{ kind: 'chi', codes: [107, 307] }])), 'color');
  // 报叫听的牌也照这条：七张全红单吊 7，只听红7。
  const opened = apply(make([[201, 202, 203, 204, 206, 301, 302, 303], [110, 304, 109, 305, 108, 306, 107]]), 'a',
    action(make([[201, 202, 203, 204, 206, 301, 302, 303], [110, 304, 109, 305, 108, 306, 107]]), 'a', 'begin'));
  assert.ok(opened.openingDeclare!.pending.includes('b'));
  assert.deepEqual(run(opened, 'b', 'bao').players[1]!.declaredWaits, [307]);
});

test('v2 报叫了没胡、别人点炮被截胡：多的 3 番由点炮的人付（DEC-20261103-截胡点炮付）', () => {
  const state = make([[310, 402, 403, 405, 406, 407, 409, 410], [110, 204, 309, 205, 101, 413, 404],
    [103, 211, 102, 212, 108, 206, 104], [201, 202, 203, 207, 208, 209, 401]]);
  const next = run(state, 'a', 'begin');
  // d 报了叫（听的牌这里不要紧），a 点炮给 b。
  next.players[3]!.declaredWaits = [113]; next.players[3]!.declaredBonusIds = [];
  let thrown = run(next, 'a', 'discard', 310);
  const hu = xinjinLegalActions(thrown, 'b').find(item => item.type === 'respond' && item.choiceId !== null &&
    (thrown.claims!.offers.find(offer => offer.id === item.choiceId)!.action as { type: string }).type === 'hu')!;
  thrown = apply(thrown, 'b', hu);
  while (thrown.phase === 'response') {
    const waiting = thrown.players.find(item => xinjinLegalActions(thrown, item.userId).length)!;
    thrown = apply(thrown, waiting.userId, xinjinLegalActions(thrown, waiting.userId).find(item => item.type === 'respond' && item.choiceId === null)!);
  }
  assert.deepEqual(thrown.outcome!.winners.map(winner => winner.userId), ['b']);
  // 接地 3 番 8 份 × 包三家 3 × 截胡 8 × 底分 100；报叫的 d 不出钱。
  assert.deepEqual(Object.fromEntries(thrown.outcome!.payments.postings.map(posting => [posting.userId, Number(posting.amount)])),
    { a: -19200, b: 19200, c: 0, d: 0 });
});

test('v2 手里四张一样的直接弹杠（DEC-20261112-四张直接杠）；偷没点就摸牌、出牌，要摸到鬼才再提示（DEC-20261103-偷牌顺序）', () => {
  const four = begun(make([[112, 212, 312, 412, 101, 102, 103, 104], [201, 202, 203, 204, 205, 206, 208]]));
  assert.equal(four.phase, 'touing');
  assert.equal(xinjinLegalActions(four, 'a').filter(item => item.type === 'gang').length, 1, '手里四张直接弹杠');
  assert.ok(!xinjinLegalActions(four, 'a').some(item => item.type === 'tou'), '不再先弹偷三张');
  // 点过杠：记成点数 + 100，出牌时也不再提示杠。
  const passedGang = noBao(noTou(four));
  assert.deepEqual(passedGang.players[0]!.touPassed, [112]);
  assert.ok(!xinjinLegalActions(passedGang, 'a').some(item => item.type === 'gang'));
  const touFaces = (state: XinjinRound) => xinjinLegalActions(state, 'a').filter(item => item.type === 'tou');
  let state = begun(make([[112, 212, 312, 101, 102, 103, 104, 105], [201, 202, 203, 204, 205, 206, 208]], [413, 1001, 113]));
  assert.ok(touFaces(state).length);
  // 起手点「过」：出牌时也不再提示。
  state = noBao(noTou(state));
  assert.deepEqual(state.players[0]!.touPassed, [12]);
  assert.equal(touFaces(state).length, 0);
  state = passAll(run(state, 'a', 'discard', 105));
  assert.deepEqual(state.players[0]!.touPassed, [12]);
  state = passAll(run(state, 'b', 'draw'));
  assert.equal(state.phase, 'draw'); assert.equal(state.activeId, 'a');
  assert.equal(touFaces(state).length, 0, '点过的偷不再提示');
  state = run(state, 'a', 'draw');
  assert.equal(state.players[0]!.touPassed, undefined);
  assert.ok(touFaces(state).length, '摸到鬼再提示偷');
});

test('v2 偷出的三张别家看牌背、自己看灰牌，巴上第四张才翻开（DEC-20261103-偷牌顺序）', () => {
  let state = begun(make([[105, 205, 305, 101, 102, 103, 104, 106], [202, 203, 204, 206, 208, 209, 211]], [405, 110]));
  const adapter = createXinjinEngine('v2-hidden-tou', () => 0).original!;
  const column = (type: 'tou' | 'ba', viewer: string) => {
    const result = applyXinjinAction(state, 'a', xinjinLegalActions(state, 'a').find(item => item.type === type)!);
    const packets = adapter.notifications({ ...result.snapshot as XinjinRound, deal: {} }, result.events, viewer, 'action');
    return { result, column: packets.filter(packet => packet.command === MSGEvent.HWNotifyActionFlow)
      .map(packet => (packet.body as any).action.colInfo?.[0]).find(Boolean) };
  };
  assert.equal(column('tou', 'b').column.isFan, false);
  const tou = column('tou', 'a');
  assert.equal(tou.column.isFan, false);
  state = tou.result.snapshot as XinjinRound;
  // 重连进桌：偷的那组照样不翻。
  const enter = (adapter.enter({ ...state, deal: {} }, 'b') as any).body.gameStart.seats[0].outCol;
  assert.equal(enter[0].isFan, false);
  const ba = column('ba', 'b');
  assert.equal(ba.column.isFan, true); assert.equal(ba.column.addToId, 11);
});

test('v2 翻法、封顶每桌选：梯坎翻 1+番、跟斗翻 2^番，先封顶再算；截胡多的 3 番一起封顶（DEC-20261108-翻法封顶每桌选）', () => {
  const melds = [{ kind: 'tou' as const, codes: [112, 212, 412] }, { kind: 'gang' as const, codes: [113, 213, 313, 413] }];
  const state = v2Hand([110, 204, 309, 205], melds, [1001, 1002]);
  const score = (overrides: Record<string, unknown>) => {
    const result = evaluateXinjinWin(state, flipAt(state), { ...v2Rules(4), ...overrides });
    assert.ok(result.status === 'winning' && result.totalFan === 5);
    return [result.cappedFan, result.scoreUnits];
  };
  assert.deepEqual(score({ chengFan: 1, maxFan: 99 }), [5, '32']);
  assert.deepEqual(score({ chengFan: 0, maxFan: 99 }), [5, '6']);
  assert.deepEqual(score({ chengFan: 1, maxFan: 4 }), [4, '16']);
  assert.deepEqual(score({ chengFan: 0, maxFan: 3 }), [3, '4']);
  // 截胡点炮：接地 3 番 + 截胡 3 番 = 6 番，4 番封顶；梯坎翻 1+4=5 份，跟斗翻 16 份；包三家 × 3 × 底分 100。
  const paid = (overrides: Record<string, unknown>) => {
    const begun = run(make([[310, 402, 403, 405, 406, 407, 409, 410], [110, 204, 309, 205, 101, 413, 404],
      [103, 211, 102, 212, 108, 206, 104], [201, 202, 203, 207, 208, 209, 401]], [], overrides), 'a', 'begin');
    begun.players[3]!.declaredWaits = [113]; begun.players[3]!.declaredBonusIds = [];
    let thrown = run(begun, 'a', 'discard', 310);
    const hu = xinjinLegalActions(thrown, 'b').find(item => item.type === 'respond' && item.choiceId !== null &&
      (thrown.claims!.offers.find(offer => offer.id === item.choiceId)!.action as { type: string }).type === 'hu')!;
    thrown = passAll(apply(thrown, 'b', hu));
    return Object.fromEntries(thrown.outcome!.payments.postings.map(posting => [posting.userId, Number(posting.amount)]));
  };
  assert.deepEqual(paid({ chengFan: 0, maxFan: 4 }), { a: -1500, b: 1500, c: 0, d: 0 });
  assert.deepEqual(paid({ chengFan: 1, maxFan: 4 }), { a: -4800, b: 4800, c: 0, d: 0 });
  assert.deepEqual(paid({ chengFan: 1, maxFan: 99 }), { a: -19200, b: 19200, c: 0, d: 0 });
});

test('v2 起手依次偷：庄家没得偷就跳过；闲家偷完鬼补牌后还有三张能偷就接着轮他，偷完轮下一家（DEC-20261108-起手依次偷）', () => {
  const state = begun(make([[101, 102, 104, 106, 108, 110, 112, 113], [1001, 203, 303, 403, 206, 208, 209]], [107, 109, 111, 211]));
  assert.equal(state.phase, 'touing');
  assert.equal(state.activeId, 'b', '庄家 a 没东西偷，直接轮到 b');
  assert.deepEqual(xinjinLegalActions(state, 'a'), []);
  assert.deepEqual(xinjinLegalActions(state, 'b').map(item => item.type), ['tou', 'tou', 'guo']);
  const ghost = apply(state, 'b', action(state, 'b', 'tou', 1001));
  assert.deepEqual(zone(ghost, 'bonus:b').map(id => code(ghost, id)), [1001]);
  assert.equal(ghost.phase, 'touing');
  assert.equal(ghost.activeId, 'b');
  assert.deepEqual(xinjinLegalActions(ghost, 'b').map(item => item.type), ['tou', 'guo']);
  const triple = apply(ghost, 'b', action(ghost, 'b', 'tou', 203));
  assert.equal(triple.players[1]!.melds[0]!.kind, 'tou');
  // 都轮完：庄家出牌。
  const turn = noBao(triple);
  assert.equal(turn.phase, 'discard');
  assert.equal(turn.activeId, 'a');
  assert.equal(turn.openingTou, null);
});

test('v2 鬼点了「过」留在手里：不能打出去，自己出牌前还能再偷（DEC-20261112-鬼每轮能偷）', () => {
  let state = begun(make([[1001, 102, 104, 106, 108, 110, 112, 113], [201, 203, 205, 206, 208, 209, 211]], [107, 109]));
  assert.equal(state.activeId, 'a');
  state = noBao(noTou(state));
  assert.equal(state.phase, 'discard');
  const discards = xinjinLegalActions(state, 'a').filter(item => item.type === 'discard');
  assert.equal(discards.length, 7);
  assert.ok(discards.every(item => code(state, (item as { cardId: string }).cardId) !== 1001), '鬼不能打');
  assert.ok(xinjinLegalActions(state, 'a').some(item => item.type === 'tou'), '起手点过，轮到自己出牌还能偷');
  assert.equal(xinjinTimedAction(state, 'a')!.action.type, 'discard', '超时照常打牌、不替他偷');
  assert.notEqual(code(state, (xinjinTimedAction(state, 'a')!.action as { cardId: string }).cardId), 1001, '超时也不打鬼');
  assert.ok(zone(state, 'hand:a').some(id => code(state, id) === 1001));
});

test('v2 起手报了叫的人摸到鬼照旧自动亮、补牌（报了锁牌，不用自己点）', () => {
  // a 庄家打黑K或黑Q能报；b 7 张听黑K。b 报，a 不报；a 打牌后 b 翻到鬼。
  const hands = [[102, 202, 103, 203, 211, 411, 212, 413], [101, 110, 204, 309, 205, 306, 408]];
  let state = begun(make(hands, [1001, 107]));
  state = noTou(state);
  assert.equal(state.phase, 'declaring');
  state = run(run(state, 'b', 'bao'), 'a', 'buBao');
  assert.ok(state.players[1]!.declaredWaits);
  state = passAll(run(state, 'a', 'discard', 211));
  assert.equal(state.phase, 'draw');
  assert.equal(state.activeId, 'b');
  const drawn = applyXinjinAction(state, 'b', action(state, 'b', 'draw'));
  assert.ok(drawn.events.some(event => event.type === 'bonus'));
  const after = drawn.snapshot as XinjinRound;
  assertXinjinRound(after);
  assert.deepEqual(zone(after, 'bonus:b').map(id => code(after, id)), [1001]);
  assert.ok(!zone(after, 'hand:b').some(id => code(after, id) === 1001));
});
