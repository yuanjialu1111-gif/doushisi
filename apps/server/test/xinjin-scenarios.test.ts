import test from 'node:test';
import assert from 'node:assert/strict';
import { MSGEvent } from '@dss/protocol';
import { freezeXinjinOptions, getDefaultOptions, XINJIN_V2_OPTIONS } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { createXinjinEngine } from '../src/game/xinjin-engine.js';
import { xinjinSettlementBrand, type XinjinAction, type XinjinRound } from '../src/game/xinjin-round.js';
import { XINJIN_SCENARIOS } from '../src/game/xinjin-scenarios.js';

// 测试台的每个场景都按 tip 打一遍：1号=a（庄家），2、3、4 号 = b、c、d。
const engine = createXinjinEngine('scenario-test');
const users = ['a', 'b', 'c', 'd'];
type State = XinjinRound & { deal: unknown };

/** 轮到只能翻牌时，按定时器替那家翻（服务端一家一家翻，DEC-20261108-一家一家翻）。 */
function flips(state: State): State {
  while (state.phase === 'draw' && legal(state, state.activeId).every(action => action.type === 'draw'))
    state = engine.apply(state, state.activeId, engine.interactions!.autoPlay!(state, state.activeId)!.action).snapshot as State;
  return state;
}
function apply(state: State, id: string, action: unknown) {
  const result = engine.apply(state, id, action);
  return { ...result, snapshot: flips(result.snapshot as State) };
}

/** 起手报叫窗口里还没选的人都点「过」（不报）。 */
function noBao(state: State) {
  while (state.phase === 'declaring') state = apply(state, state.openingDeclare!.pending[0]!,
    legal(state, state.openingDeclare!.pending[0]!).find(action => action.type === 'buBao')).snapshot as State;
  return state;
}
/** 起手依次偷还没轮完的人都点「过」（DEC-20261108-起手依次偷）。 */
function noTou(state: State) {
  while (state.phase === 'touing') state = step(state, state.activeId, 'guo');
  return state;
}
/** 开局：偷都点过；window 为真停在起手报叫窗口，否则报叫也都点过。 */
function start(key: string, window = false): State {
  return window ? noTou(open(key)) : noBao(noTou(open(key)));
}
function open(key: string): State {
  const scenario = XINJIN_SCENARIOS.find(item => item.key === key)!;
  const rules = { ...getDefaultOptions('4:0'), playerNum: 4, wangNum: 3, baseBeans: '1', ...XINJIN_V2_OPTIONS };
  const input: RoundInput = { players: users.map((userId, index) => ({ userId, seat: index + 1 })), ownerUserId: 'a', number: 1,
    rules: { ...rules, xinjin: freezeXinjinOptions(rules) }, policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
    testDeal: { dealerUserId: 'a', hands: scenario.hands, draws: scenario.draws } };
  return flips(engine.create(input) as State);
}
const code = (state: State, id: string) => state.cards.pack.find(card => card.id === id)!.code;
const zone = (state: State, name: string) => state.cards.zones.find(item => item.id === name)!.cards.map(id => code(state, id));
const legal = (state: State, id: string) => engine.interactions!.legalActions(state, id) as XinjinAction[];
/** 动作的类型：回应时看它对应的那条 offer。 */
function kind(state: State, action: XinjinAction) {
  if (action.type !== 'respond') return { type: action.type, ids: 'cardIds' in action ? action.cardIds : 'cardId' in action ? [action.cardId] : [] };
  if (action.choiceId === null) return { type: 'pass', ids: [] };
  const offer = state.claims!.offers.find(item => item.id === action.choiceId)!.action as { type: string; cardIds?: string[] };
  return { type: offer.type, ids: offer.cardIds ?? [] };
}
function options(state: State, id: string, type: string) {
  return legal(state, id).filter(action => kind(state, action).type === type).map(action => ({ action, faces: kind(state, action).ids.map(cardId => code(state, cardId)) }));
}
function step(state: State, id: string, type: string, faces: number[] = []) {
  const found = options(state, id, type).find(option => faces.every(face => option.faces.includes(face)));
  assert.ok(found, `${id} 没有 ${type} ${faces.join(',')}`);
  return apply(state, id, found.action).snapshot as State;
}
/** 当前这次要牌，keep 以外的人都点过。 */
function pass(state: State, keep: string[] = []) {
  const decision = state.claims?.id;
  while (state.phase === 'response' && state.claims?.id === decision) {
    const who = users.find(id => !keep.includes(id) && options(state, id, 'pass').length);
    if (!who) break;
    state = step(state, who, 'pass');
  }
  return state;
}
function claim(state: State, id: string, type: string, faces: number[] = []) { return pass(step(state, id, type, faces)); }
/** 谁都不点，按服务端的超时动作走一步（当前这次要牌里每个人的超时动作）。 */
function timeout(state: State) {
  const decision = state.serial;
  for (const id of users) {
    if (state.serial !== decision) break;
    const timed = engine.interactions!.autoPlay!(state, id);
    if (timed) state = apply(state, id, timed.action).snapshot as State;
  }
  return state;
}
function won(state: State, id: string, patterns: string[], capped: number) {
  assert.equal(state.phase, 'finished');
  const winner = state.outcome!.winners[0]!;
  assert.equal(winner.userId, id);
  assert.deepEqual(winner.win.items.map(item => item.pattern).sort(), [...patterns].sort());
  assert.equal(winner.win.cappedFan, capped);
  return winner.win;
}
const flipWin = (key: string, discard: number, patterns: string[], capped: number) => {
  const state = pass(step(start(key), 'a', 'discard', [discard]), ['a']);
  return won(claim(state, 'a', 'hu'), 'a', patterns, capped);
};

test('番型：天胡', () => {
  won(step(start('tianHu'), 'a', 'hu'), 'a', ['tianHu'], 3);
});
test('组合：天胡＋金二十、天胡＋暗四对、地胡＋全红、不封顶', () => {
  const units = (win: { scoreUnits: string }) => win.scoreUnits;
  assert.equal(units(won(step(start('tianQia20'), 'a', 'hu'), 'a', ['tianHu', 'qia20'], 6)), '64');
  const anDui = won(step(start('tianAnDui'), 'a', 'hu'), 'a', ['tianHu', 'anDui'], 6);
  assert.equal(anDui.structure, 'four-pairs');
  const di = step(start('diQuanHong'), 'a', 'discard', [312]);
  const diWon = claim(di, 'b', 'hu');
  assert.equal(won(diWon, 'b', ['diHu', 'quanHong'], 6).redPoints, 22);
  assert.equal(units(won(step(start('cap'), 'a', 'hu'), 'a', ['tianHu', 'anDui', 'longDui'], 9)), '512');
});
test('起手报叫：报叫＋天胡、报叫＋地胡、天胡＋鬼（报 9 番、不报 6 番），15 秒不点算不报（DEC-20261102-起手报叫）', () => {
  const units = (win: { scoreUnits: string }) => win.scoreUnits;
  // 庄家起手能胡：先弹「报」「过」，没有出牌、胡；报了只剩胡。
  let state = start('baoTianHu', true);
  assert.deepEqual(state.openingDeclare!.pending, ['a']);
  assert.deepEqual(legal(state, 'a').map(action => action.type), ['bao', 'buBao']);
  state = step(state, 'a', 'bao');
  assert.deepEqual(legal(state, 'a').map(action => action.type), ['hu']);
  assert.equal(units(won(step(state, 'a', 'hu'), 'a', ['baoJiao', 'tianHu'], 6)), '64');
  // 闲家起手听牌报叫，接庄家第一张：报叫＋地胡。
  state = step(step(start('baoDiHu', true), 'b', 'bao'), 'a', 'discard', [113]);
  won(claim(state, 'b', 'hu'), 'b', ['baoJiao', 'diHu'], 6);
  // 起手三个鬼：轮到 1号偷，点偷亮出补牌后胡照样算天胡，鬼每张 1 番；不偷留在手里胡不了。
  const toued = () => step(open('tianGui'), 'a', 'tou', [1001, 1002, 1003]);
  state = toued();
  assert.equal(zone(state, 'bonus:a').length, 3);
  assert.equal(units(won(step(step(state, 'a', 'bao'), 'a', 'hu'), 'a', ['baoJiao', 'tianHu', 'gui'], 9)), '512');
  won(step(step(toued(), 'a', 'buBao'), 'a', 'hu'), 'a', ['tianHu', 'gui'], 6);
  assert.equal(options(start('tianGui'), 'a', 'hu').length, 0, '鬼留在手里不能胡');
  // 15 秒不点算不报：窗口关了轮到庄家，没人报叫。
  const timed = engine.interactions!.autoPlay!(start('tianHu', true), 'a')!;
  assert.equal(timed.delayMs, 15000);
  assert.equal(timed.action.type, 'buBao');
  state = apply(start('tianHu', true), 'a', timed.action).snapshot as State;
  assert.equal(state.phase, 'discard');
  assert.ok(state.players.every(item => item.declaredWaits === null));
});
test('番型：地胡', () => {
  const state = step(start('diHu'), 'a', 'discard', [113]);
  won(claim(state, 'b', 'hu'), 'b', ['diHu'], 3);
});
test('番型：报叫（只能起手报）', () => {
  // 开局点过：出牌时不再有「报」（DEC-20261108-只能起手报）。
  assert.equal(options(start('baoJiao'), 'a', 'declare').length, 0);
  // 开局点「报」：轮到出牌只给留得住叫的牌，打黑Q 就算报叫（DEC-20261102-庄家起手报叫）。
  const opened = noBao(step(start('baoJiao', true), 'a', 'bao'));
  assert.ok(options(opened, 'a', 'discard').length < 8 && !options(opened, 'a', 'declare').length);
  const early = pass(step(opened, 'a', 'discard', [412]), ['a']);
  won(claim(early, 'a', 'hu'), 'a', ['baoJiao'], 3);
});
test('报叫要手里红点先够 20：金二十那手打黑Q后红 19，只有红K能胡，不出「报」；暗四对的叫红点不够也能报', () => {
  const window = (key: string) => start(key, true);
  const pending = (key: string) => window(key).phase === 'declaring' ? window(key).openingDeclare!.pending : [];
  assert.ok(!pending('qia20').includes('a'));
  assert.ok(options(start('qia20'), 'a', 'discard').some(option => option.faces.includes(412)));
  // 暗四对场景：打黑K后手里红 30，本来就够；换成全靠暗四对的叫看 xinjin-v2 那条。
  assert.ok(pending('anDui').includes('a'));
  assert.ok(options(noBao(step(window('anDui'), 'a', 'bao')), 'a', 'discard').some(option => option.faces.includes(413)));
});
test('番型：金二十、暗四对、龙对、全红、全黑、红五十、黑五十', () => {
  assert.equal(flipWin('qia20', 412, ['qia20'], 3).redPoints, 20);
  flipWin('anDui', 413, ['anDui'], 3);
  // 龙对是 3号胡：开局 3号手里四个5，胡之前轮不到自己、没有偷杠可点。
  const longDui = pass(step(start('longDui'), 'a', 'discard', [413]), ['c']);
  assert.equal(options(start('longDui'), 'c', 'tou').length + options(start('longDui'), 'c', 'gang').length, 0);
  const longDuiWon = claim(longDui, 'c', 'hu');
  won(longDuiWon, 'c', ['anDui', 'longDui'], 6);
  // 胡牌特效按番型编号播：暗四对 14（对子胡）、龙对 110（热更新脚本借大胡动画换字），DEC-20261101-胡牌特效补齐。
  assert.deepEqual(xinjinSettlementBrand(longDuiWon, 'c').cardType, [14, 110]);
  assert.equal(flipWin('quanHong', 207, ['quanHong'], 3).redPoints, 22);
  flipWin('quanHei', 107, ['quanHei'], 3);
  assert.equal(flipWin('hong50', 212, ['hong50'], 3).redPoints, 50);
  assert.equal(flipWin('hei50', 112, ['hei50'], 3).redPoints, 6);
});
test('番型：金钩钓（大吊车）', () => {
  // 开局轮到 1号偷：偷三个5、再偷三个10。
  let state = step(open('jinGouDiao'), 'a', 'tou', [105, 205, 305]);
  state = noBao(noTou(step(state, 'a', 'tou', [110, 210, 310])));
  state = pass(step(state, 'a', 'discard', [113]), ['a']);
  state = claim(state, 'a', 'peng', [309]);
  won(step(state, 'a', 'hu'), 'a', ['peng', 'jinGouDiao'], 6);
});
test('番型：鬼、碰、杠', () => {
  // 开局轮到 1号偷：鬼自己点偷（DEC-20261108-起手依次偷）。
  let state = open('guiPengGang');
  assert.equal(state.phase, 'touing');
  assert.deepEqual(zone(state, 'bonus:a'), []);
  state = step(state, 'a', 'tou', [1001]);
  assert.deepEqual(zone(state, 'bonus:a'), [1001]);
  // 手里四张一样的直接弹「杠」，不再先偷三张（DEC-20261112-四张直接杠）。
  assert.equal(options(state, 'a', 'tou').length, 0);
  assert.equal(options(state, 'a', 'gang').length, 1);
  state = step(state, 'a', 'gang', [105, 205, 305, 405]);
  assert.equal(state.players[0]!.melds[0]!.kind, 'gang');
  // 还弹三个10的「偷」：点过。
  assert.ok(options(state, 'a', 'tou').length);
  state = noBao(noTou(state));
  state = pass(step(state, 'a', 'discard', [412]), ['a']);
  state = claim(state, 'a', 'peng', [310]);
  const win = won(step(state, 'a', 'hu'), 'a', ['gui', 'peng', 'gang'], 4);
  assert.equal(win.totalFan, 4);
});
test('手里三张后来又进第四张，直接弹「杠」不弹「偷」（DEC-20261112-四张直接杠）', () => {
  let state = open('siZhangGang');
  assert.equal(options(state, 'a', 'tou').length, 2);
  state = step(state, 'a', 'tou', [1001]);
  assert.ok(zone(state, `hand:a`).includes(406));
  assert.equal(options(state, 'a', 'tou').length, 0);
  assert.equal(options(state, 'a', 'gang').length, 1);
  state = step(state, 'a', 'gang', [106, 206, 306, 406]);
  assert.equal(state.players[0]!.melds[0]!.kind, 'gang');
  // 点过的杠记下，这四张不再提示；点过三张的偷、后来凑成四张照样提示杠（上面就是）。
  assert.equal(options(state, 'a', 'gang').length, 0);
});
test('番型：红点不够不能胡', () => {
  let state = pass(step(start('gate'), 'a', 'discard', [106]));
  // 2号翻出黑Q：1号没有胡；有人能要就点过，翻过去了它就在弃牌里。
  if (state.phase === 'response' && zone(state, 'table')[0] === 412) {
    assert.equal(options(state, 'a', 'hu').length, 0);
    state = pass(state);
  }
  assert.ok(zone(state, 'discards').includes(412));
});
test('操作：下家吃、自己翻牌自己吃、两种吃法', () => {
  let state = step(start('chi'), 'a', 'discard', [105]);
  assert.deepEqual(options(state, 'b', 'chi').map(option => option.faces.sort()), [[105, 209]]);
  assert.equal(options(state, 'c', 'chi').length + options(state, 'd', 'chi').length, 0);
  state = claim(state, 'b', 'chi', [209]);
  assert.equal(state.players[1]!.melds[0]!.kind, 'chi');

  state = pass(step(start('ziChi'), 'a', 'discard', [413]));
  assert.equal(state.source?.kind, 'flip');
  assert.equal(state.source?.userId, 'b');
  state = claim(state, 'b', 'chi', [106, 208]);
  assert.equal(state.players[1]!.melds[0]!.kind, 'chi');

  state = step(start('chiTwo'), 'a', 'discard', [105]);
  assert.equal(options(state, 'b', 'chi').length, 2);
});
test('操作：碰、偷、杠、巴', () => {
  let state = claim(step(start('peng'), 'a', 'discard', [110]), 'c', 'peng', [210, 310]);
  assert.equal(state.players[2]!.melds[0]!.kind, 'peng');
  state = step(open('tou'), 'a', 'tou', [105, 205, 305]);
  assert.equal(state.players[0]!.melds[0]!.kind, 'tou');
  state = step(start('gang'), 'a', 'discard', [110]);
  assert.equal(options(state, 'c', 'peng').length > 0, true);
  state = claim(state, 'c', 'gang', [210, 310, 410]);
  assert.equal(state.players[2]!.melds[0]!.kind, 'gang');
  state = step(step(open('ba'), 'a', 'tou', [105, 205, 305]), 'a', 'ba', [405]);
  assert.equal(state.players[0]!.melds[0]!.kind, 'ba');
});
test('操作：摸鬼补牌', () => {
  // 2号摸到鬼进手里，弹「偷」；点了才亮出补牌（DEC-20261108-起手依次偷）。
  const drawn = pass(step(start('gui'), 'a', 'discard', [413]));
  assert.ok(zone(drawn, 'hand:b').includes(1001));
  assert.ok(options(drawn, 'b', 'tou').length);
  assert.ok(!options(drawn, 'b', 'discard').some(option => option.faces.includes(1001)));
  const state = step(drawn, 'b', 'tou', [1001]);
  assert.deepEqual(zone(state, 'bonus:b'), [1001]);
  assert.equal(state.phase, 'discard');
  assert.equal(state.activeId, 'b');
  assert.ok(zone(state, 'hand:b').includes(104));
});
test('操作：报叫后锁牌', () => {
  // 开局 1号、3号一起弹「报」：1号点报，只有黑Q、黑6能打。
  assert.deepEqual(start('baoJiaoLock', true).openingDeclare!.pending, ['a', 'c']);
  const opened = noBao(step(start('baoJiaoLock', true), 'a', 'bao'));
  assert.deepEqual(options(opened, 'a', 'discard').flatMap(option => option.faces).sort(), [206, 412]);
  let state = step(opened, 'a', 'discard', [412]);
  for (let guard = 0; guard < 10 && !(state.phase === 'discard' && state.activeId === 'a'); guard++) state = pass(state);
  assert.equal(state.activeId, 'a');
  assert.deepEqual(zone(state, 'bonus:a'), [1001]);
  assert.deepEqual(options(state, 'a', 'discard').flatMap(option => option.faces), [203]);
});
test('操作：胡和碰抢同一张，胡优先', () => {
  let state = pass(step(start('huOverPeng'), 'a', 'discard', [413]));
  assert.ok(options(state, 'd', 'peng').length);
  state = step(state, 'd', 'peng');
  state = claim(state, 'c', 'hu');
  assert.equal(state.outcome!.winners[0]!.userId, 'c');
});
test('操作：超时自动胡、自动碰', () => {
  let state = pass(step(start('timeoutHu'), 'a', 'discard', [413]), ['a']);
  won(timeout(state), 'a', ['anDui'], 3);
  state = timeout(step(start('timeoutPeng'), 'a', 'discard', [110]));
  assert.equal(state.players[2]!.melds[0]!.kind, 'peng');
});
test('翻牌后 1号点胡立刻结算，不等能吃的 3号（测试台暗四对发现）', () => {
  let state = pass(step(start('anDui'), 'a', 'discard', [413]), ['a']);
  assert.ok(options(state, 'c', 'chi').length, '3号能吃');
  state = step(state, 'a', 'hu');
  won(state, 'a', ['anDui'], 3);
});
test('操作：四家托管打到流局', () => {
  let state = start('liuJu');
  for (let guard = 0; guard < 500 && state.phase !== 'finished'; guard++) {
    const id = users.find(user => engine.interactions!.autoPlay!(state, user))!;
    state = apply(state, id, engine.interactions!.autoPlay!(state, id)!.action).snapshot as State;
  }
  assert.equal(state.outcome?.reason, 'draw');
  assert.equal(state.outcome?.nextRoundContext.nextDealerId, 'a');
});
test('开局有鬼不自动亮：轮到的人收到「偷 / 过」，点偷后四家都看到亮鬼；自己的手牌不按原版理好的顺序发，发牌动画收尾会重画（DEC-20261108-起手依次偷）', () => {
  const state = open('tianGui');
  assert.equal(state.phase, 'touing');
  for (const id of users) {
    const packets = engine.original!.notifications(state, [], id, 'start');
    assert.equal(packets[0]!.command, MSGEvent.HWNotifyGameStart);
    assert.ok(!packets.some(packet => packet.command === MSGEvent.HWNotifyActionFlow), id);
    const choice = packets.find(packet => packet.command === MSGEvent.HWNotifySeatOperationChoice);
    assert.deepEqual(choice && (choice.body as any).choices.map((item: any) => item.actType), id === 'a' ? [7, 4] : undefined, id);
    const seats = (packets[0]!.body as any).seats;
    assert.deepEqual(seats[0].protectCards ?? [], []);
    if (id === 'a') assert.deepEqual([...seats[0].tilesOnHand].sort((x: number, y: number) => x - y), [101, 102, 103, 213, 412, 1001, 1002, 1003]);
  }
  const result = apply(state, 'a', options(state, 'a', 'tou')[0]!.action);
  for (const id of users) {
    const tou = engine.original!.notifications(result.snapshot, result.events, id, 'action')
      .filter(packet => packet.command === MSGEvent.HWNotifyActionFlow).map(packet => (packet.body as any).action);
    assert.deepEqual(tou.map(action => [action.seatIndex, action.actType, action.protectCard]), [[1, 7, [1001, 1002, 1003]]], id);
    assert.equal(tou[0].destCardIsOwn, id === 'a');
    // 带上手牌数和红点：原版拿它改底部「红」，不带就变 0、还冒出「准备」。
    assert.equal(tou[0].tilesOnHandNum, 8);
    if (id === 'a') assert.equal(tou[0].redPoint, 21);
  }
});

test('场景的牌都排得出来，四家手里一开始都没有鬼（鬼、碰、杠，天胡＋鬼，凑成四张弹杠那三局除外）', () => {
  for (const scenario of XINJIN_SCENARIOS) {
    const state = open(scenario.key);
    for (const id of users) {
      assert.equal(zone(state, 'bonus:' + id).length, 0, scenario.key);
      const ghosts = zone(state, 'hand:' + id).filter(face => face > 1000).length;
      assert.equal(ghosts > 0, id === 'a' && ['guiPengGang', 'tianGui', 'siZhangGang'].includes(scenario.key), `${scenario.key} ${id}`);
    }
  }
});

test('没人要的牌一家一家翻：每步最多翻一张，轮到只能翻的人隔 1.5 秒自动翻（DEC-20261108-一家一家翻）', () => {
  let flipped = 0, timedFlips = 0;
  for (const scenario of XINJIN_SCENARIOS) {
    let state = start(scenario.key);
    for (let guard = 0; guard < 200 && state.phase !== 'finished'; guard++) {
      const id = users.find(user => engine.interactions!.autoPlay!(state, user))!;
      const timed = engine.interactions!.autoPlay!(state, id)!;
      if (state.phase === 'draw' && legal(state, id).every(action => action.type === 'draw')) { assert.equal(timed.delayMs, 1500); timedFlips++; }
      const result = engine.apply(state, id, timed.action);
      const flips = result.events.filter(event => (event as { type: string }).type === 'flip').length;
      assert.ok(flips <= 1, `${scenario.key} 一步翻了 ${flips} 张`);
      flipped += flips; state = result.snapshot as State;
    }
  }
  assert.ok(flipped > 10 && timedFlips > 10);
});

test('没人要的牌进打出、翻出那家的出牌区：四家都收到「弃牌」，自己那条带红黑点不清零，重连按顺序补出牌区（DEC-20261108-出牌翻牌都看得见）', () => {
  let state = start('liuJu');
  let checked = 0;
  for (let guard = 0; guard < 200 && state.phase !== 'finished' && checked < 3; guard++) {
    const id = users.find(user => engine.interactions!.autoPlay!(state, user))!;
    const result = engine.apply(state, id, engine.interactions!.autoPlay!(state, id)!.action);
    const fold = result.events.find(event => (event as { type: string }).type === 'fold') as { userId: string; card: { code: number } } | undefined;
    state = result.snapshot as State;
    if (!fold) continue;
    for (const viewer of users) {
      const flow = engine.original!.notifications(state, result.events, viewer, 'action')
        .filter(packet => packet.command === MSGEvent.HWNotifyActionFlow).map(packet => (packet.body as any).action).find(action => action.actType === 1)!;
      assert.equal(flow.destCard, fold.card.code);
      assert.equal(flow.destCardIsOwn, viewer === fold.userId);
      assert.equal(flow.tilesOnHandNum, state.cards.zones.find(zone => zone.id === `hand:${fold.userId}`)!.cards.length);
      if (viewer === fold.userId) assert.ok(flow.redPoint + flow.blackPoint > 0, '自己的红黑点要带上');
    }
    checked++;
  }
  assert.equal(checked, 3);
  for (const viewer of users) {
    const seats = (engine.original!.enter(state, viewer).body as any).gameStart?.seats ?? (engine.original!.enter(state, viewer).body as any).seats;
    for (const [index, userId] of users.entries()) assert.deepEqual(seats[index].outCardsNo ?? [], (state.folds?.[userId] ?? []).map(cardId => code(state, cardId)));
  }
  assert.ok(Object.values(state.folds ?? {}).flat().length >= 3);
});
test('出牌动作带的手牌张数就是出完后手里的张数，原版直接拿来显示（DEC-20261108-手牌张数）', () => {
  let state = start('liuJu');
  let checked = 0;
  for (let guard = 0; guard < 200 && state.phase !== 'finished' && checked < 3; guard++) {
    const id = users.find(user => engine.interactions!.autoPlay!(state, user))!;
    const result = engine.apply(state, id, engine.interactions!.autoPlay!(state, id)!.action);
    const discard = result.events.find(event => (event as { type: string }).type === 'discard') as { userId: string } | undefined;
    state = result.snapshot as State;
    if (!discard) continue;
    for (const viewer of users) {
      const flow = engine.original!.notifications(state, result.events, viewer, 'action')
        .filter(packet => packet.command === MSGEvent.HWNotifyActionFlow).map(packet => (packet.body as any).action).find(action => action.actType === 3)!;
      assert.equal(flow.tilesOnHandNum, state.cards.zones.find(zone => zone.id === `hand:${discard.userId}`)!.cards.length);
    }
    checked++;
  }
  assert.equal(checked, 3);
});
