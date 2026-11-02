import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeXinjinOptions, getDefaultOptions, XINJIN_V2_OPTIONS } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { createXinjinEngine } from '../src/game/xinjin-engine.js';
import { xinjinSettlementBrand, type XinjinAction, type XinjinRound } from '../src/game/xinjin-round.js';
import { XINJIN_SCENARIOS } from '../src/game/xinjin-scenarios.js';

// 测试台的每个场景都按 tip 打一遍：1号=a（庄家），2、3、4 号 = b、c、d。
const engine = createXinjinEngine('scenario-test');
const users = ['a', 'b', 'c', 'd'];
type State = XinjinRound & { deal: unknown };

function start(key: string): State {
  const scenario = XINJIN_SCENARIOS.find(item => item.key === key)!;
  const rules = { ...getDefaultOptions('4:0'), playerNum: 4, wangNum: 3, baseBeans: '1', ...XINJIN_V2_OPTIONS };
  const input: RoundInput = { players: users.map((userId, index) => ({ userId, seat: index + 1 })), ownerUserId: 'a', number: 1,
    rules: { ...rules, xinjin: freezeXinjinOptions(rules) }, policy: { selectedUserId: null, triggered: false, probability: '0', version: null },
    testDeal: { dealerUserId: 'a', hands: scenario.hands, draws: scenario.draws } };
  return engine.create(input) as State;
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
  return engine.apply(state, id, found.action).snapshot as State;
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
    if (timed) state = engine.apply(state, id, timed.action).snapshot as State;
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
  assert.equal(units(won(step(start('cap'), 'a', 'hu'), 'a', ['tianHu', 'quanHong', 'hong50'], 9)), '512');
});
test('番型：地胡', () => {
  const state = step(start('diHu'), 'a', 'discard', [113]);
  won(claim(state, 'b', 'hu'), 'b', ['diHu'], 3);
});
test('番型：报叫', () => {
  const state = pass(step(start('baoJiao'), 'a', 'declare', [412]), ['a']);
  won(claim(state, 'a', 'hu'), 'a', ['baoJiao'], 3);
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
  assert.equal(flipWin('hong50', 212, ['hong50'], 3).redPoints, 52);
  assert.equal(flipWin('hei50', 112, ['hei50'], 3).redPoints, 4);
});
test('番型：金钩钓（大吊车）', () => {
  let state = step(start('jinGouDiao'), 'a', 'tou', [105, 205, 305]);
  state = step(state, 'a', 'tou', [110, 210, 310]);
  state = pass(step(state, 'a', 'discard', [113]), ['a']);
  state = claim(state, 'a', 'peng', [309]);
  won(step(state, 'a', 'hu'), 'a', ['peng', 'jinGouDiao'], 6);
});
test('番型：鬼、碰、杠', () => {
  let state = start('guiPengGang');
  assert.deepEqual(zone(state, 'bonus:a'), [1001]);
  state = step(state, 'a', 'gang', [105, 205, 305, 405]);
  state = pass(step(state, 'a', 'discard', [412]), ['a']);
  state = claim(state, 'a', 'peng', [310]);
  const win = won(step(state, 'a', 'hu'), 'a', ['gui', 'peng', 'gang'], 4);
  assert.equal(win.totalFan, 4);
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
  state = step(start('tou'), 'a', 'tou', [105, 205, 305]);
  assert.equal(state.players[0]!.melds[0]!.kind, 'tou');
  state = step(start('gang'), 'a', 'discard', [110]);
  assert.equal(options(state, 'c', 'peng').length > 0, true);
  state = claim(state, 'c', 'gang', [210, 310, 410]);
  assert.equal(state.players[2]!.melds[0]!.kind, 'gang');
  state = step(step(start('ba'), 'a', 'tou', [105, 205, 305]), 'a', 'ba', [405]);
  assert.equal(state.players[0]!.melds[0]!.kind, 'ba');
});
test('操作：摸鬼补牌', () => {
  const state = pass(step(start('gui'), 'a', 'discard', [413]));
  assert.deepEqual(zone(state, 'bonus:b'), [1001]);
  assert.equal(state.phase, 'discard');
  assert.equal(state.activeId, 'b');
  assert.ok(zone(state, 'hand:b').includes(104));
});
test('操作：报叫后锁牌', () => {
  let state = start('baoJiaoLock');
  assert.deepEqual([...new Set(options(state, 'a', 'declare').flatMap(option => option.faces))].sort(), [206, 412]);
  state = step(state, 'a', 'declare', [412]);
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
    state = engine.apply(state, id, engine.interactions!.autoPlay!(state, id)!.action).snapshot as State;
  }
  assert.equal(state.outcome?.reason, 'draw');
  assert.equal(state.outcome?.nextRoundContext.nextDealerId, 'a');
});
test('场景的牌都排得出来，四家手里一开始都没有鬼（鬼、碰、杠那局除外）', () => {
  for (const scenario of XINJIN_SCENARIOS) {
    const state = start(scenario.key);
    for (const id of users) if (scenario.key !== 'guiPengGang') assert.equal(zone(state, 'bonus:' + id).length, 0, scenario.key);
  }
});
