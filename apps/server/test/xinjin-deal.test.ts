import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeXinjinOptions, getDefaultOptions, XINJIN_V2_OPTIONS } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { selectDeal } from '../src/policies.js';
import { createXinjinEngine } from '../src/game/xinjin-engine.js';
import { createXinjinCardState } from '../src/game/xinjin-pack.js';
import { createXinjinRound } from '../src/game/xinjin-round.js';
import { xinjinDealEvaluation, xinjinDealHand } from '../src/game/xinjin-deal.js';

const rules = (count: number) => {
  const base = { ...getDefaultOptions('4:0'), playerNum: count, gameNum: 4, wangNum: 3, baseBeans: '100', ...XINJIN_V2_OPTIONS };
  return { ...base, xinjin: freezeXinjinOptions(base) } as Record<string, unknown>;
};
const pack = (count: number) => createXinjinCardState('4:0', rules(count), 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
const input = (count: number, overrides: Partial<RoundInput> = {}): RoundInput => ({
  players: Array.from({ length: count }, (_, index) => ({ userId: String.fromCharCode(97 + index), seat: index + 1 })),
  ownerUserId: 'a', number: 1, rules: rules(count),
  policy: { selectedUserId: null, triggered: false, probability: '0', version: null }, ...overrides });
const faces = (codes: readonly number[]) => codes.map(code => ({ id: `c${code}`, code }));

/** 按 createXinjinRound 的发牌顺序，把指定手牌摆到目标座位上，其余位置用剩下的牌填。 */
function orderedWithHand(hand: number[], playerNum: number, dealerSeat: number, targetSeat: number) {
  const physical = pack(playerNum);
  const used = new Set<string>();
  const take = (cards: number[]) => {
    const face = cards.shift();
    assert.notEqual(face, undefined, 'Fixture hand ran out');
    const card = physical.find(item => item.code === face && !used.has(item.id));
    assert.ok(card, `Fixture face unavailable: ${face}`);
    used.add(card.id);
    return card.id;
  };
  const offset = (targetSeat - dealerSeat + playerNum) % playerNum;
  const order: string[] = new Array(physical.length).fill('');
  const rest = [...hand];
  for (let index = 0; index < 7 * playerNum; index++) {
    if (index % playerNum === offset) order[index] = take(rest);
  }
  if (offset === 0) order[7 * playerNum] = take(rest);
  assert.equal(rest.length, 0, 'Fixture hand has the wrong size');
  let cursor = 0;
  for (let index = 0; index < order.length; index++) {
    if (order[index]) continue;
    while (used.has(physical[cursor]!.id)) cursor++;
    order[index] = physical[cursor]!.id; used.add(physical[cursor]!.id);
  }
  return order.map(id => physical.find(card => card.id === id)!.code);
}

test('切牌位置和 createXinjinRound 实际发到手上的牌一致', () => {
  for (const count of [2, 3, 4]) {
    for (const dealerSeat of [1, 2]) {
      const physical = pack(count);
      const dealerId = String.fromCharCode(96 + dealerSeat);
      const round = createXinjinRound(input(count, { ownerUserId: dealerId }), physical.map(card => card.id), dealerId);
      for (let seat = 1; seat <= count; seat++) {
        const userId = String.fromCharCode(96 + seat);
        const dealt = round.cards.zones.find(zone => zone.id === `hand:${userId}`)!.cards;
        const sliced = xinjinDealHand(physical, count, dealerSeat, seat);
        assert.deepEqual(sliced.map(card => card.id), dealt, `${count} 人 / 庄 ${dealerSeat} / 座 ${seat} 切的牌不对`);
      }
    }
  }
});

test('评分只算目标座位手里那几张：组数、红点、鬼牌', () => {
  // 四组凑满：A/K、2/Q、7/7、5/9。红点只算红桃和方片：1+1+2+1+7+5 = 17。
  const full = orderedWithHand([101, 113, 102, 112, 107, 207, 105, 209], 4, 1, 1);
  assert.deepEqual(xinjinDealEvaluation(faces(full) as never, 4, 1, 1), [4, 17, 0]);
  // 散牌：只有 4/10、6/8 两组，红点 = 1+2+3+4+5+6+8+10 = 39。
  const scattered = orderedWithHand([101, 102, 103, 104, 105, 106, 108, 110], 4, 1, 1);
  assert.deepEqual(xinjinDealEvaluation(faces(scattered) as never, 4, 1, 1), [2, 39, 0]);
  // 鬼牌单独计数，不参与凑组。
  const withBonus = orderedWithHand([1001, 1002, 101, 102, 103, 104, 105, 106], 4, 1, 1);
  assert.equal(xinjinDealEvaluation(faces(withBonus) as never, 4, 1, 1)[2], 2);
});

test('三张、四张同点算一组，几种拆法取组数最多的；四个同点对子（暗四对）按凑满算（DEC-20261102-发牌评分认三张和暗四对）', () => {
  const groups = (hand: number[]) => xinjinDealEvaluation(faces(orderedWithHand(hand, 4, 1, 1)) as never, 4, 1, 1)[0];
  // 三个 5 没有 9 配：偷出来算一组，加 A/K、2/Q，一共 3 组（以前只算 2 组）。
  assert.equal(groups([105, 205, 305, 101, 113, 102, 112, 107]), 3);
  // 四个 5：杠出来算一组，加 A/K、2/Q、7/7。
  assert.equal(groups([105, 205, 305, 405, 101, 113, 102, 112]), 3);
  assert.equal(groups([105, 205, 305, 405, 101, 113, 107, 207]), 3);
  // 三个 3 带两个 J：拆成 3/J 两组比偷三张多（2 组对 1 组），取 2 组；剩下 A/K 再加 1 组。
  assert.equal(groups([103, 203, 303, 111, 211, 101, 113, 108]), 3);
  // 四个同点对子，一组都凑不上 14：按暗四对算满 4 组。
  assert.equal(groups([102, 202, 103, 203, 104, 204, 105, 205]), 4);
  // 四张同点算两对：四个 2 加两对 3。
  assert.equal(groups([102, 202, 302, 402, 103, 203, 104, 204]), 4);
});

test('同一副牌不同洗法评分不一样（防止再退化成恒定分数）', () => {
  const physical = pack(4);
  let seed = 20261102;
  const random = (max: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
  const scores = new Set<string>();
  for (let attempt = 0; attempt < 200; attempt++) {
    const shuffled = [...physical];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = random(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]; }
    scores.add(xinjinDealEvaluation(shuffled, 4, 1, 1).join('/'));
  }
  assert.ok(scores.size > 1, `200 次洗牌只有 ${scores.size} 种评分，评估函数又变成常量了`);
});

test('触发策略选出来的牌，目标座位评分严格优于随机那一副', () => {
  const physical = pack(4);
  let seed = 7;
  const random = (max: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
  const evaluate = (deck: readonly { code: number }[]) => xinjinDealEvaluation(deck as never, 4, 1, 2);
  const plain = selectDeal(physical, { selectedUserId: null, triggered: false, probability: '0', version: null }, evaluate, random);
  const boosted = selectDeal(physical, { selectedUserId: 'b', triggered: true, probability: '100', version: 1 }, evaluate, random);
  assert.equal(plain.candidates, 1);
  assert.equal(boosted.candidates, 32);
  assert.ok(boosted.evaluation[0]! > plain.evaluation[0]!, `挑完组数 ${boosted.evaluation[0]} 没比随机那副 ${plain.evaluation[0]} 高`);
});

test('引擎按策略选中的人挑牌，选不中就直接报错', () => {
  const engine = createXinjinEngine('xinjin-deal-test', () => 0);
  const snapshot = engine.create(input(4, { policy: { selectedUserId: 'c', triggered: true, probability: '100', version: 3 } })) as
    { deal: { candidates: number; evaluation: number[]; policy: { selectedUserId: string | null } } };
  assert.equal(snapshot.deal.candidates, 32);
  assert.equal(snapshot.deal.policy.selectedUserId, 'c');
  assert.equal(snapshot.deal.evaluation.length, 3);
  assert.throws(() => engine.create(input(4, { policy: { selectedUserId: 'outsider', triggered: true, probability: '100', version: 1 } })),
    /another room/);
});
