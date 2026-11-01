import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultOptions, YAAN_INDEPENDENT_VERSION, XINJIN_INDEPENDENT_VERSION,
  ANYUE_INDEPENDENT_VERSION, PUJIANG_INDEPENDENT_VERSION, ABA_INDEPENDENT_VERSION,
  ABA10_INDEPENDENT_VERSION, freezePujiangOptions } from '@dss/rules';
import { ABA11_INDEPENDENT_VERSION, ABA12_INDEPENDENT_VERSION } from '@dss/rules';
import { SCORE_REGION_VERSIONS } from '@dss/rules';
import { createScoreRegionEngine } from '../src/game/score-region-engine.js';
import type { RoundInput, RuleEngine } from '../src/engines.js';
import { createYaanEngine } from '../src/game/yaan-engine.js';
import { createXinjinEngine } from '../src/game/xinjin-engine.js';
import { createAnyueEngine } from '../src/game/anyue-engine.js';
import { createPujiangEngine } from '../src/game/pujiang-engine.js';
import { createAbaEngine } from '../src/game/aba-engine.js';
import { overWire, playThroughOriginalClient } from './original-client.js';

function input(variantKey: '6:0' | '4:0' | '5:0' | '7:0' | '9:0' | '10:0' | '11:0' | '12:0' |
  '14:0' | '15:0' | '16:0' | '19:0' | '20:0' | '21:0' | '22:0' | '23:0' | '24:0' | '25:0' | '26:0' | '27:0',
  overrides: Record<string, unknown> = {}): RoundInput {
  const base = getDefaultOptions(variantKey);
  const rules: Record<string, unknown> = { ...base, playerNum: 2, gameNum: 4, maxFan: 99, baseBeans: '0.125', ...overrides };
  if (variantKey === '6:0') {
    rules.wangNum = 3;
    rules.qiWangNum = 0;
    rules.ziChi = 0;
    rules.chaJiao = 0;
    rules.chengFan = 0;
    rules.yaan = { rulesVersion: YAAN_INDEPENDENT_VERSION };
  }
  if (variantKey === '4:0') {
    rules.wangNum = 3;
    rules.qiToWang = 0;
    rules.ziChi = 0;
    rules.chengFan = 1;
    rules.xinjin = { rulesVersion: XINJIN_INDEPENDENT_VERSION };
  }
  if (variantKey === '5:0') {
    if (rules.piaoType === undefined) rules.piaoType = 0;
    rules.qiToWang = 1;
    rules.chengFan = 1;
    rules.anyue = { rulesVersion: ANYUE_INDEPENDENT_VERSION };
  }
  if (variantKey === '7:0') {
    rules.pujiang = { rulesVersion: PUJIANG_INDEPENDENT_VERSION };
  }
  if (variantKey === '9:0') {
    rules.playerNum = 2;
    rules.huRedScore = 300;
    rules.baojiaoCondition = 1;
    rules.baipiType = 1;
    rules.aba = { rulesVersion: ABA_INDEPENDENT_VERSION };
  }
  if (variantKey === '10:0') {
    rules.playerNum = 2;
    rules.huRedScore = 300;
    rules.baojiaoCondition = 1;
    rules.baipiType = 1;
    rules.aba = { rulesVersion: ABA10_INDEPENDENT_VERSION };
  }
  if (variantKey === '11:0') {
    rules.playerNum = 2;
    rules.huRedScore = 300;
    rules.baojiaoCondition = 1;
    rules.baipiType = 1;
    rules.quanXing = 1;
    rules.aba = { rulesVersion: ABA11_INDEPENDENT_VERSION };
  }
  if (variantKey === '12:0') {
    rules.playerNum = 2;
    rules.huRedScore = 300;
    rules.baojiaoCondition = 1;
    rules.baipiType = 1;
    rules.aba = { rulesVersion: ABA12_INDEPENDENT_VERSION };
  }
  if (['14:0', '15:0', '16:0', '19:0'].includes(variantKey)) {
    rules.playerNum = 2;
    rules.scoreRegion = { rulesVersion: SCORE_REGION_VERSIONS[variantKey as keyof typeof SCORE_REGION_VERSIONS] };
  }
  if (['20:0', '21:0', '22:0', '23:0', '24:0', '25:0', '26:0', '27:0'].includes(variantKey)) {
    rules.playerNum = 2;
    rules.scoreRegion = { rulesVersion: SCORE_REGION_VERSIONS[variantKey as keyof typeof SCORE_REGION_VERSIONS] };
  }
  return { players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }], ownerUserId: 'a', number: 1,
    rules, policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}

const engines = {
  '6:0': () => createYaanEngine('round-original-yaan', () => 0),
  '4:0': () => createXinjinEngine('round-original-xinjin', () => 0),
  '5:0': () => createAnyueEngine('round-original-anyue', () => 0),
  '7:0': () => createPujiangEngine('round-original-pujiang', () => 0),
  '9:0': () => createAbaEngine('round-original-aba', () => 0),
  '10:0': () => createAbaEngine('round-original-aba10', () => 0, '10:0'),
  '11:0': () => createAbaEngine('round-original-aba11', () => 0, '11:0'),
  '12:0': () => createAbaEngine('round-original-aba12', () => 0, '12:0'),
  '14:0': () => createScoreRegionEngine('round-original-score14', '14:0', () => 0),
  '15:0': () => createScoreRegionEngine('round-original-score15', '15:0', () => 0),
  '16:0': () => createScoreRegionEngine('round-original-score16', '16:0', () => 0),
  '19:0': () => createScoreRegionEngine('round-original-score19', '19:0', () => 0),
  '20:0': () => createScoreRegionEngine('round-original-score20', '20:0', () => 0),
  '21:0': () => createScoreRegionEngine('round-original-score21', '21:0', () => 0),
  '22:0': () => createScoreRegionEngine('round-original-score22', '22:0', () => 0),
  '23:0': () => createScoreRegionEngine('round-original-score23', '23:0', () => 0),
  '24:0': () => createScoreRegionEngine('round-original-score24', '24:0', () => 0),
  '25:0': () => createScoreRegionEngine('round-original-score25', '25:0', () => 0),
  '26:0': () => createScoreRegionEngine('round-original-score26', '26:0', () => 0),
  '27:0': () => createScoreRegionEngine('round-original-score27', '27:0', () => 0),
} as const;

for (const [variantKey, factory] of Object.entries(engines) as [keyof typeof engines, typeof engines[keyof typeof engines]][]) {
  test(`${variantKey} original adapter projects only the viewer hand and start notification`, () => {
    const engine = factory() as RuleEngine;
    const state = engine.create(input(variantKey));
    const adapter = engine.original!;
    const enter = adapter.enter(state, 'b').body as any;
    assert.equal(enter.seatIndex, 2);
    assert.equal(enter.gameStart.seats.length, 2);
    const own = enter.gameStart.seats.find((seat: any) => seat.seatIndex === 2);
    const other = enter.gameStart.seats.find((seat: any) => seat.seatIndex === 1);
    assert.ok(own.tilesOnHand.length > 0);
    assert.deepEqual(other.tilesOnHand, []);
    assert.ok(other.tilesOnHandNum > 0);
    const packet = adapter.notifications(state, [], 'b', 'start')[0]!;
    assert.equal(packet.command, 11);
    assert.ok(packet.body);
  });

  test(`${variantKey} original adapter resolves a server-offered discard and rejects an absent face`, () => {
    const engine = factory() as RuleEngine;
    const state = engine.create(input(variantKey));
    const adapter = engine.original!;
    const actions = engine.interactions!.legalActions(structuredClone(state), 'a') as { type: string; cardId?: string; decisionId?: string }[];
    const discard = actions.find(action => action.type === 'discard')!;
    assert.ok(discard);
    const snapshot = state as { cards: { pack: { id: string; code: number }[] } };
    const face = snapshot.cards.pack.find(card => card.id === discard.cardId)!.code;
    const decoded = adapter.decodeAction(23, { actType: 3, colType: 1, destCard: face, cards: [face] }, discard.decisionId);
    assert.deepEqual(adapter.resolveAction!(state, 'a', decoded), discard);
    assert.throws(() => adapter.resolveAction!(state, 'b', decoded), { code: 'INVALID_ACTION' });
  });

  test(`${variantKey} original adapter exposes only valid original action enums`, () => {
    const engine = factory() as RuleEngine;
    const state = engine.create(input(variantKey));
    const adapter = engine.original!;
    const packets = adapter.notifications(state, [], 'a', 'action');
    const choice = packets.find(packet => packet.command === 20);
    assert.ok(choice);
    const choices = (choice!.body as any).choices as { actType: number; seatIndex: number }[];
    assert.ok(choices.length > 0);
    assert.ok(choices.every(item => item.seatIndex === 1));
    assert.ok(choices.every(item => [3, 4, 5, 6, 7, 8, 9, 12, 13, 14].includes(item.actType)));
  });
}

test('Anyue original adapter accepts piao only inside a server decision window', () => {
  const engine = createAnyueEngine('round-original-anyue-piao', () => 0);
  const state = engine.create(input('5:0', { piaoType: 2 })) as { phase: string; serial: number; number: number };
  assert.equal(state.phase, 'piao');
  const adapter = engine.original!;
  const decisionId = `ay:${state.number}:${state.serial}`;
  const decoded = adapter.decodeAction(53, { piaoStatus: 1 }, decisionId);
  const resolved = adapter.resolveAction!(state, 'a', decoded) as { type: string; value: number; decisionId: string };
  assert.equal(resolved.type, 'piao');
  assert.equal(resolved.value, 1);
  assert.throws(() => adapter.decodeAction(53, { piaoStatus: 1 }), { code: 'DECISION_REQUIRED' });
});

test('Xuzhou original adapter accepts piao only inside a server decision window', () => {
  const engine = createScoreRegionEngine('round-original-xuzhou-piao', '23:0', () => 0);
  const state = engine.create(input('23:0', { piaoType: 2 })) as { phase: string; serial: number; number: number };
  assert.equal(state.phase, 'piao');
  const adapter = engine.original!;
  const decisionId = `sr:${state.number}:${state.serial}`;
  const decoded = adapter.decodeAction(53, { piaoStatus: 1 }, decisionId);
  const resolved = adapter.resolveAction!(state, 'a', decoded) as { type: string; value: number; decisionId: string };
  assert.equal(resolved.type, 'piao');
  assert.equal(resolved.value, 1);
  assert.throws(() => adapter.decodeAction(53, { piaoStatus: 1 }), { code: 'DECISION_REQUIRED' });
});

test('the generic adapter never reads Pujiang options into another region', () => {
  const rules = { wangNum: 9, pujiang: freezePujiangOptions({ wangNum: 9 }) };
  const inputValue = input('6:0');
  inputValue.rules = { ...inputValue.rules, ...rules };
  const engine = createYaanEngine('round-original-yaan-pujiang-mismatch', () => 0);
  const state = engine.create(inputValue);
  const adapter = engine.original!;
  const enter = adapter.enter(state, 'a').body as any;
  assert.equal(enter.gameStart.seats.length, 2);
});

test('ABA engines reject snapshots from another ABA configuration', () => {
  const nine = createAbaEngine('aba-binding-nine', () => 0, '9:0');
  const ten = createAbaEngine('aba-binding-ten', () => 0, '10:0');
  const snapshot = nine.create(input('9:0'));
  assert.throws(() => ten.view(snapshot, 'a'), { code: 'INVALID_ABA_SNAPSHOT' });
  assert.throws(() => ten.interactions!.legalActions(snapshot, 'a'), { code: 'INVALID_ABA_SNAPSHOT' });
  assert.throws(() => ten.original!.notifications(snapshot, [], 'a', 'action'),
    { code: 'INVALID_ABA_SNAPSHOT' });
  assert.throws(() => ten.apply(snapshot, 'a', { type: 'begin', decisionId: 'ab:1:0' }),
    { code: 'INVALID_ABA_SNAPSHOT' });
});

test('score-region engines reject snapshots from another score-region configuration', () => {
  const wenchuan = createScoreRegionEngine('score-binding-wenchuan', '14:0', () => 0);
  const maoxian = createScoreRegionEngine('score-binding-maoxian', '15:0', () => 0);
  const snapshot = wenchuan.create(input('14:0'));
  assert.throws(() => maoxian.view(snapshot, 'a'), { code: 'INVALID_SCORE_REGION_SNAPSHOT' });
  assert.throws(() => maoxian.interactions!.legalActions(snapshot, 'a'),
    { code: 'INVALID_SCORE_REGION_SNAPSHOT' });
  assert.throws(() => maoxian.original!.notifications(snapshot, [], 'a', 'action'),
    { code: 'INVALID_SCORE_REGION_SNAPSHOT' });
  assert.throws(() => maoxian.apply(snapshot, 'a', { type: 'begin', decisionId: 'sr:1:0' }),
    { code: 'INVALID_SCORE_REGION_SNAPSHOT' });
});

for (const [variantKey, factory] of Object.entries(engines) as [keyof typeof engines, typeof engines[keyof typeof engines]][]) {
  test(`${variantKey} 原版出牌请求只带牌面也能打出去，锁住的牌被拒`, () => {
    const engine = factory() as RuleEngine;
    const state = engine.create(input(variantKey));
    const adapter = engine.original!;
    const actions = engine.interactions!.legalActions(structuredClone(state), 'a') as { type: string; cardId?: string; decisionId?: string }[];
    const discard = actions.find(action => action.type === 'discard')!;
    const snapshot = state as { cards: { pack: { id: string; code: number }[] } };
    const face = snapshot.cards.pack.find(card => card.id === discard.cardId)!.code;
    const decoded = adapter.decodeAction(23, overWire({ seatIndex: 1, actType: 3, destCard: face }), discard.decisionId);
    assert.ok(actions.some(action => JSON.stringify(adapter.resolveAction!(state, 'a', decoded)) === JSON.stringify(action)));
    const choices = (adapter.notifications(state, [], 'a', 'action').find(packet => packet.command === 20)!.body as any).choices;
    const chupai = choices.filter((choice: any) => choice.actType === 3);
    assert.equal(chupai.length, 1);
    for (const code of chupai[0].deathCard ?? []) assert.throws(() => adapter.resolveAction!(state, 'a',
      adapter.decodeAction(23, overWire({ seatIndex: 1, actType: 3, destCard: code }), discard.decisionId)), { code: 'INVALID_ACTION' });
  });

  test(`${variantKey} 只用原版客户端会发的请求能把几局打完，每手合规动作都发得出`, () => {
    const seen = new Set<number>();
    for (const seed of [1, 7, 42, 99, 2026]) {
      const engine = factory() as RuleEngine;
      const result = playThroughOriginalClient(engine, engine.create(input(variantKey)), seed);
      assert.ok(result.steps > 3);
      for (const actType of result.actTypes) seen.add(actType);
    }
    assert.ok(seen.has(3));
  });
}
