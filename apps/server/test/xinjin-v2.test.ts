import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeXinjinOptions, getDefaultOptions, XINJIN_INDEPENDENT_VERSION, XINJIN_V2_OPTIONS } from '@dss/rules';
import { evaluateXinjinWin, type XinjinHand, type XinjinWinContext } from '../src/game/xinjin-win.js';
import type { EngineResult, RoundInput } from '../src/engines.js';
import { createXinjinEngine } from '../src/game/xinjin-engine.js';
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
  return apply(state, id, action(state, id, type, face));
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

test('v2 门槛按人数：4 人红 20 能胡，3 人要 25', () => {
  const state = v2Hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const four = evaluateXinjinWin(state, flipAt(state), v2Rules(4));
  assert.equal(four.status, 'winning');
  if (four.status === 'winning') { assert.equal(four.redPoints, 20); assert.equal(four.totalFan, 0); assert.equal(four.scoreUnits, '1'); }
  const three = evaluateXinjinWin(state, flipAt(state), v2Rules(3));
  assert.equal(three.status, 'not-winning');
  if (three.status === 'not-winning') assert.equal(three.reason, 'points');
  assert.equal(evaluateXinjinWin(state, flipAt(state), v2Rules(2)).status, 'not-winning');
});

test('v2 番：鬼每张 1、偷出三张算碰 1、杠 2，跟头翻 5 番封顶', () => {
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
  assert.ok(capped.status === 'winning' && capped.totalFan === 6 && capped.cappedFan === 5 && capped.scoreUnits === '32');
});

test('v2 手里的三张没偷出来不算组，全红全黑天走不看门槛', () => {
  // 三张 10 加一张 4 在手里不能拆成两两凑 14。
  const concealedTriple = v2Hand([110, 210, 310, 104, 101, 413, 206, 408]);
  assert.equal(evaluateXinjinWin(concealedTriple, flipAt(concealedTriple), v2Rules(4)).status, 'not-winning');
  const allRed = v2Hand([101, 113, 102, 112, 103, 111, 104, 110]);
  const red = evaluateXinjinWin(allRed, flipAt(allRed), v2Rules(3));
  assert.ok(red.status === 'winning' && red.items.some(item => item.pattern === 'quanHong') && red.scoreUnits === '8');
  const allBlack = v2Hand([201, 213, 202, 212, 203, 211, 204, 210]);
  const black = evaluateXinjinWin(allBlack, flipAt(allBlack), v2Rules(4));
  assert.ok(black.status === 'winning' && black.items.some(item => item.pattern === 'quanHei') && black.redPoints === 0);
  const mixed = v2Hand([201, 213, 202, 212, 103, 211, 204, 210]);
  const tian = evaluateXinjinWin(mixed, { winnerSeat: 1, dealerSeat: 1, source: 'original-hand', sourceSeat: null, incomingCardId: null, discardCount: 0 }, v2Rules(4));
  assert.ok(tian.status === 'winning' && tian.items.some(item => item.pattern === 'tianHu'));
  assert.equal(evaluateXinjinWin(mixed, flipAt(mixed), v2Rules(4)).status, 'not-winning');
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
});

test('v2 偷出三张后摸到第四张可以巴杠', () => {
  const state = make([[112, 212, 312, 412, 101, 102, 103, 104], [201, 202, 203, 204, 205, 206, 208]], [], {});
  let next = run(state, 'a', 'begin');
  const tou = xinjinLegalActions(next, 'a').find(item => item.type === 'tou' && item.cardIds.every(id => code(next, id) !== 412));
  assert.ok(tou);
  next = apply(next, 'a', tou);
  const ba = xinjinLegalActions(next, 'a').find(item => item.type === 'ba');
  assert.ok(ba && code(next, (ba as { cardId: string }).cardId) === 412);
  next = apply(next, 'a', ba);
  assert.equal(next.players[0]!.melds[0]!.kind, 'ba');
  assert.equal(next.players[0]!.melds[0]!.cardIds.length, 4);
});

test('开局庄家收到出牌选项，别家收到倒计时；之后没事件的一步不重播开局摸鬼', () => {
  // 这个种子的牌开局有三家摸到鬼、补牌（startEvents 6 条）。
  let seed = 0;
  const engine = createXinjinEngine('v2-start', max => (seed = (seed * 1103515245 + 12345) % 2147483648) % max);
  const roundInput = input(4);
  let snapshot: any = engine.create(roundInput);
  assert.ok(snapshot.startEvents.length > 0);
  const dealer = snapshot.dealerId as string, other = ['a', 'b', 'c', 'd'].find(id => id !== dealer)!;
  const start = (userId: string) => engine.original!.notifications(snapshot, [], userId, 'start').map(packet => packet.command);
  assert.deepEqual(start(dealer), [MSGEvent.HWNotifyGameStart, MSGEvent.HWNotifySeatOperationChoice]);
  assert.deepEqual(start(other), [MSGEvent.HWNotifyGameStart, MSGEvent.HWNotifyNextOperation]);
  // 庄家出牌后，第一个能响应的人点「过」：这一步没有事件，不能把开局的摸鬼、偷再发一遍。
  snapshot = engine.apply(snapshot, dealer, engine.interactions!.legalActions(snapshot, dealer)[0]!).snapshot;
  const responder = ['a', 'b', 'c', 'd'].find(id => engine.interactions!.legalActions(snapshot, id).some((item: any) => item.type === 'respond'));
  assert.ok(responder);
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

test('摸到鬼后补的牌标成进手（isShangShou），只发给本人', () => {
  let state = make([[102, 103, 104, 105, 106, 108, 109, 110], [202, 203, 204, 205, 206, 208, 209]], [1001, 107]);
  state = run(state, 'a', 'begin');
  state = passAll(run(state, 'a', 'discard', 110));
  assert.equal(state.phase, 'draw');
  const drawn = applyXinjinAction(state, 'b', action(state, 'b', 'draw'));
  const adapter = createXinjinEngine('v2-replacement', () => 0).original!;
  const deals = (userId: string) => adapter.notifications({ ...(drawn.snapshot as XinjinRound), deal: {} }, drawn.events, userId, 'action')
    .filter(packet => packet.command === MSGEvent.HWNotifyPlayerDealCard).map(packet => packet.body as any);
  assert.deepEqual(deals('b').map(body => [body.value, body.isShangShou]), [[1001, false], [107, true]]);
  assert.deepEqual(deals('a').map(body => body.value), [1001]);
});
