import { requireCondition } from '../errors.js';
import type { PhysicalCard } from './cards.js';

/**
 * 本机测试台的新津 v2 场景（只在 DSS_TEST_DEALS=1 的本机服务里用，线上不开）。
 * 测试台让测试1号开房当庄家，2、3、4 号依次进房，所以 hands 依次是 1、2、3、4 号的牌（庄家 8 张、其他 7 张，
 * 没写满的用固定的牌补）；draws 是开局后依次摸到、翻出的牌。牌面：花色×100+点数，1、3 红，2、4 黑；1001~1003 是鬼。
 * 每个场景在 test/xinjin-scenarios.test.ts 里按 tip 一步步打过。
 */
export interface XinjinScenario { key: string; group: '番型' | '组合' | '操作'; title: string; tip: string; hands: number[][]; draws: number[] }

export const XINJIN_SCENARIOS: readonly XinjinScenario[] = [
  { key: 'tianHu', group: '番型', title: '天胡', tip: '开局 1号弹「报」先点过，再点胡：天胡 3 番（红点 21，天胡也要够 20；点报再胡是报叫＋天胡，看组合）。',
    hands: [[101, 213, 102, 412, 103, 311, 304, 110]], draws: [] },
  { key: 'diHu', group: '番型', title: '地胡', tip: '开局 2号弹「报」先点过；1号打红K，2号点胡：地胡 3 番（红点 22，地胡也要够 20；点报是报叫＋地胡，看组合）。',
    hands: [[113], [105, 309, 106, 408, 203, 311, 401]], draws: [] },
  { key: 'baoJiao', group: '番型', title: '报叫', tip: '开局 1号弹「报」点报，轮到出牌只有留得住叫的牌能打，打黑Q 就是报叫；2号翻出红8，1号点胡：报叫 3 番（开局点过、出牌时再点「报」打黑Q 也一样）。',
    hands: [[110, 304, 109, 305, 201, 213, 206, 412]], draws: [108] },
  { key: 'qia20', group: '番型', title: '金二十', tip: '1号打黑Q；2号翻出红K，1号点胡：红点正好 20，金二十 3 番（「恰二十」图）。',
    hands: [[110, 204, 109, 205, 201, 213, 401, 412]], draws: [113] },
  { key: 'anDui', group: '番型', title: '暗四对', tip: '开局 1号、4号弹「报」都点过；1号打黑K；2号翻出黑J，1号点胡：暗四对 3 番（「对子」图）。',
    hands: [[105, 305, 110, 310, 202, 402, 211, 413]], draws: [411] },
  // 龙对放 3号：3号胡之前轮不到自己，不会冒「偷、杠」（以前放 1号，开局点了杠，补牌把黑2摸走，后面全乱，11-01 测试台）。
  { key: 'longDui', group: '番型', title: '龙对', tip: '开局 3号弹「报」点过；1号打黑K（别人有吃、碰都点过）；2号翻出黑2，3号点胡：暗四对 3 + 龙对 3 = 6 番（不封顶）。',
    hands: [[413], [], [105, 205, 305, 405, 110, 310, 202]], draws: [402] },
  { key: 'quanHong', group: '番型', title: '全红', tip: '开局 1号弹「报」点过；1号打黑7；2号翻出红Q，1号点胡：全红 3 番（红点 22，全红也要够 20）。',
    hands: [[101, 113, 102, 112, 104, 310, 302, 207]], draws: [312] },
  { key: 'quanHei', group: '番型', title: '全黑', tip: '开局 1号弹「报」点过；1号打红7；2号翻出黑Q，1号点胡：全黑 3 番。',
    hands: [[201, 213, 202, 212, 203, 211, 402, 107]], draws: [412] },
  { key: 'hong50', group: '番型', title: '红五十', tip: '开局 1号弹「报」点过；1号打黑Q；2号翻出红7，1号点胡：红正好 50，红五十 3 番（显示「红50」；过了 50 不算）。',
    hands: [[308, 206, 109, 305, 108, 306, 307, 212]], draws: [107] },
  { key: 'hei50', group: '番型', title: '黑五十', tip: '开局 1号弹「报」点过；1号打红Q；2号翻出黑7，1号点胡：黑正好 50，黑五十 3 番（红点只有 6 也能胡；过了 50 不算）。',
    hands: [[408, 106, 209, 405, 208, 406, 207, 112]], draws: [407] },
  { key: 'jinGouDiao', group: '番型', title: '金钩钓（大吊车）',
    tip: '开局 1号弹「报」点过；1号偷三个5、再偷三个10，打红K；2号翻出红9，1号点碰；补到红A，1号点胡（手里黑A 单吊，胡同点的 A 才算大吊车，胡 K 只是普通胡）：碰 3（偷两组、碰一组各 1）+ 金钩钓 3 = 6 番（不封顶）。',
    hands: [[105, 205, 305, 110, 210, 310, 109, 209]], draws: [113, 401, 309, 101] },
  { key: 'guiPengGang', group: '番型', title: '鬼、碰、杠',
    tip: '1号开局的鬼自动亮出补牌，弹「报」点过；手里四个5只弹「偷」，点偷（三个5），补到黑10，再点巴（第四个5，别家这时才看到这组的牌面）；补到红3，冒出「偷」不用管，打黑Q；2号翻出红10，1号点碰（弹框任选一组）；补到红J，1号点胡：鬼 1 + 碰 1 + 杠 2 = 4 番。',
    hands: [[1001, 105, 205, 305, 405, 110, 210, 412]], draws: [104, 410, 103, 310, 311] },
  // 组合：几种番叠在一起，不封顶，番照加（DEC-20261102-不封顶）。
  { key: 'tianQia20', group: '组合', title: '天胡＋金二十', tip: '1号起手点胡：天胡 3 + 金二十 3 = 6 番，64 份（红点正好 20）。',
    hands: [[110, 404, 109, 205, 101, 213, 202, 412]], draws: [] },
  { key: 'tianAnDui', group: '组合', title: '天胡＋暗四对', tip: '1号起手点胡：天胡 3 + 暗四对 3 = 6 番，64 份（红点 38）。',
    hands: [[110, 310, 109, 309, 202, 402, 211, 411]], draws: [] },
  { key: 'diQuanHong', group: '组合', title: '地胡＋全红', tip: '1号打红Q；2号点胡：地胡 3 + 全红 3 = 6 番，点炮 1号一人包三家（红点 22）。',
    hands: [[312], [101, 113, 102, 112, 104, 310, 302]], draws: [] },
  // 起手报叫（DEC-20261102-起手报叫）：发完牌、亮王补牌后一起弹「报」「过」，15 秒不点算不报。
  { key: 'baoTianHu', group: '组合', title: '报叫＋天胡', tip: '开局 1号弹「报」点报，再点胡：报叫 3 + 天胡 3 = 6 番，64 份。',
    hands: [[101, 213, 102, 412, 103, 311, 304, 110]], draws: [] },
  { key: 'baoDiHu', group: '组合', title: '报叫＋地胡', tip: '开局 2号弹「报」点报；1号打红K，2号点胡：报叫 3 + 地胡 3 = 6 番，点炮 1号一人包三家。',
    hands: [[113], [105, 309, 106, 408, 203, 311, 401]], draws: [] },
  { key: 'tianGui', group: '组合', title: '天胡＋鬼',
    tip: '1号起手三个鬼，自动亮出补三张；开局弹「报」点报，再点胡：报叫 3 + 天胡 3 + 鬼 3 = 9 番，512 份（不报直接胡是 6 番）。',
    hands: [[1001, 1002, 1003, 101, 213, 102, 412, 103]], draws: [311, 304, 110] },
  { key: 'cap', group: '组合', title: '不封顶', tip: '1号起手点胡：天胡 3 + 暗四对 3 + 龙对 3 = 9 番，512 份，不封顶照算。',
    hands: [[105, 205, 305, 405, 110, 310, 109, 309]], draws: [] },
  { key: 'gate', group: '番型', title: '红点不够不能胡',
    tip: '1号打红6；2号翻出黑Q，牌凑齐了但 1号没有「胡」：红点 4 不够 20，也不是全黑、黑五十。',
    hands: [[201, 213, 202, 212, 103, 111, 402, 106]], draws: [412] },
  { key: 'chi', group: '操作', title: '下家吃', tip: '1号打红5；2号点吃（红5 + 黑9）；3号、4号不是下家，没有吃。',
    hands: [[105], [209]], draws: [] },
  { key: 'ziChi', group: '操作', title: '自己翻牌自己吃', tip: '1号打黑K（2号手里有黑A，能吃，先点过）；2号翻出红6，2号自己点吃，弹框选黑8还是另一张8。',
    hands: [[413], [208]], draws: [106] },
  { key: 'chiTwo', group: '操作', title: '一张牌两种吃法', tip: '1号打红5；2号点吃，弹框选用哪张9吃。',
    hands: [[105], [209, 409]], draws: [] },
  { key: 'peng', group: '操作', title: '碰', tip: '1号打红10；3号点碰（不是下家也能碰）。',
    hands: [[110], [], [210, 310]], draws: [] },
  { key: 'tou', group: '操作', title: '偷', tip: '1号手里三张5，点偷，自动补一张。',
    hands: [[105, 205, 305]], draws: [] },
  { key: 'gang', group: '操作', title: '杠', tip: '1号打红10；3号手里三张10，点杠（也能点碰）。',
    hands: [[110], [], [210, 310, 410]], draws: [] },
  { key: 'ba', group: '操作', title: '巴', tip: '1号点偷（三个5），补到第四个5，点巴。',
    hands: [[105, 205, 305]], draws: [405] },
  { key: 'gui', group: '操作', title: '摸鬼补牌', tip: '1号打黑K；2号摸到鬼，鬼亮在旁边、补一张红4进手，2号接着出牌。',
    hands: [[413]], draws: [1001, 104] },
  { key: 'baoJiaoLock', group: '操作', title: '报叫后锁牌',
    tip: '开局 1号、3号一起弹「报」：3号点过，1号点报；轮到 1号出牌只有黑Q、黑6能打，其他变灰；打黑Q 就是报叫。2号、3号、4号翻牌都点过；1号摸到鬼补一张黑3，这时只能打黑3（不改叫），其他变灰。',
    hands: [[110, 304, 109, 305, 201, 213, 206, 412]], draws: [403, 411, 401, 1001, 203] },
  { key: 'huOverPeng', group: '操作', title: '胡和碰抢同一张', tip: '开局 1号、3号弹「报」都点过；1号打黑K；2号翻出红10：4号先点碰，3号再点胡，最后是 3号胡（胡优先）。',
    hands: [[413], [], [109, 305, 108, 306, 201, 213, 404], [110, 210]], draws: [310] },
  { key: 'timeoutHu', group: '操作', title: '超时自动胡', tip: '开局 1号、4号弹「报」都点过；1号打黑K；2号翻出黑J后谁都别点，15 秒后 1号自动胡。',
    hands: [[105, 305, 110, 310, 202, 402, 211, 413]], draws: [411] },
  { key: 'timeoutPeng', group: '操作', title: '超时自动碰', tip: '1号打红10，然后谁都别点，15 秒后 3号自动碰。',
    hands: [[110], [], [210, 310]], draws: [] },
  { key: 'liuJu', group: '操作', title: '流局', tip: '1号随便打一张；之后谁弹出「吃」都点过（不点 15 秒后也自动过，全等要 6 分钟左右），牌摸完没人胡：流局，没人输赢，下一局庄家不换。',
    // 四家手里点数各不相同、也凑不出 14，翻一张最多凑一对，托管又只碰不吃，所以没人能胡。
    hands: [[101, 202, 303, 404, 105, 206, 107, 313], [113, 212, 311, 410, 109, 208, 207],
      [301, 402, 103, 204, 305, 406, 307], [213, 112, 211, 310, 209, 108, 407]], draws: [] },
];

/** 按场景排好整副牌：先按发牌顺序放各家的牌，再放 draws，其余普通牌按固定顺序补，鬼放最后（补的牌里不会冒出鬼）。 */
export function xinjinTestDeck(pack: readonly PhysicalCard[], hands: readonly (readonly number[])[], draws: readonly number[], playerCount: number) {
  requireCondition(hands.length <= playerCount && hands.every((hand, index) => hand.length <= (index === 0 ? 8 : 7)),
    'INVALID_TEST_DEAL', 'Each hand fits its seat.', 400);
  const used = new Set<string>();
  const take = (code: number) => {
    const card = pack.find(item => item.code === code && !used.has(item.id));
    requireCondition(card, 'INVALID_TEST_DEAL', `Card ${code} is not available.`, 400);
    used.add(card.id); return card.id;
  };
  const named = [...hands.flat(), ...draws].map(take);
  const filler = [...pack].filter(card => !used.has(card.id)).sort((a, b) => a.code - b.code || (a.id < b.id ? -1 : 1));
  let seed = 20261101;
  for (let index = filler.length - 1; index > 0; index--) {
    seed = seed * 16807 % 2147483647;
    const other = seed % (index + 1);
    [filler[index], filler[other]] = [filler[other]!, filler[index]!];
  }
  const ordinary = filler.filter(card => card.code < 1000), ghosts = filler.filter(card => card.code >= 1000);
  // 补的牌不让一家凑出三张同点（不然轮到他得先选偷还是摸牌，场景走不顺）。
  const held = Array.from({ length: playerCount }, (_, seat) => [...(hands[seat] ?? [])]);
  const slot = (seat: number, index: number) => {
    const hand = hands[seat] ?? [];
    if (index < hand.length) return named[hands.slice(0, seat).reduce((sum, item) => sum + item.length, 0) + index]!;
    const at = ordinary.findIndex(card => held[seat]!.filter(code => code % 100 === card.code % 100).length < 2);
    const [card] = ordinary.splice(at, 1);
    held[seat]!.push(card!.code);
    return card!.id;
  };
  const order: string[] = [];
  for (let round = 0; round < 7; round++) for (let seat = 0; seat < playerCount; seat++) order.push(slot(seat, round));
  order.push(slot(0, 7));
  order.push(...named.slice(hands.flat().length), ...ordinary.map(card => card.id), ...ghosts.map(card => card.id));
  return order;
}
