import test from 'node:test';
import assert from 'node:assert/strict';
import { baseScoreDecimal, catalogue, displayName, getDefaultOptions, getRoomSpec, getRuleGaps,
  getVariant, resolveVariantKey, ruleGaps, validateRoomOptions, originalVariants, RETAINED_GAME_IDS,
  RELEASE_EVIDENCE_STATUS, supportsNewRoom, QIONGLAI_OPTIONS } from '../src/index.js';

test('retains exactly 21 regional games and preserves 28 original configurations as evidence', () => {
  assert.equal(catalogue.length, 21);
  assert.equal(originalVariants.length, 28);
  assert.deepEqual(catalogue.map(variant => variant.gameId), [...RETAINED_GAME_IDS]);
  for (const variant of catalogue) {
    assert.equal(variant.evidenceStatus, RELEASE_EVIDENCE_STATUS);
    assert.deepEqual(validateRoomOptions(variant.key, getDefaultOptions(variant.key)), getDefaultOptions(variant.key));
  }
  assert.equal(catalogue.filter(variant => variant.gameplayReady).length, 21);
  assert.deepEqual(catalogue.filter(variant => !variant.gameplayReady).map(variant => variant.key),
    []);
  assert.throws(() => getVariant('601:0'), /Unsupported/);
  assert.throws(() => getVariant('501:0'), /Unsupported/);
});

test('Qionglai additions preserve every original option and remain scoped to Qionglai', () => {
  const original = getVariant('8:0').original.rule.config_playmethod!.config;
  const current = getRoomSpec('8:0').groups.config_playmethod!.config;
  assert.deepEqual(current.slice(0, original.length), original);
  assert.deepEqual(current.slice(original.length), QIONGLAI_OPTIONS);
  for (const key of ['qlTianDiHu', 'qlHongHeiHu', 'qlHongHei50']) {
    assert.equal(getDefaultOptions('8:0')[key], 1);
    assert.equal(getDefaultOptions('7:0')[key], undefined);
  }
  assert.equal(supportsNewRoom('2:0'), false);
  assert.equal(supportsNewRoom('6:0'), true);
  assert.equal(supportsNewRoom('101:0'), false);
  assert.equal(getDefaultOptions('8:0', { shiName: '雅安市' }).processType, undefined);
  for (const variant of catalogue) assert.ok(getRoomSpec(variant.key).unresolvedFields.includes('basicTimes'));
});

test('strict validation rejects omitted fields, foreign options, wrong types and cross-variant values', () => {
  const options = getDefaultOptions('2:0');
  delete options.useCardType;
  assert.throws(() => validateRoomOptions('2:0', options), /Missing option: useCardType/);
  assert.throws(() => validateRoomOptions('2:0', { ...getDefaultOptions('2:0'), maxFan: 99 }), /Unsupported option/);
  assert.throws(() => validateRoomOptions('2:0', { ...getDefaultOptions('2:0'), gameNum: '4' }), /Invalid option gameNum/);
  assert.throws(() => validateRoomOptions('2:0', { ...getDefaultOptions('2:0'), yifupai: false }), /Invalid option yifupai/);
  assert.throws(() => validateRoomOptions('2:0', Object.create(getDefaultOptions('2:0'))), /Missing option/);
});

test('deck routing and blood-battle routing preserve variant identity', () => {
  assert.equal(resolveVariantKey(2, { yifupai: true }), '2:0');
  assert.equal(resolveVariantKey(2, { yifupai: false }), '2:1');
  assert.throws(() => resolveVariantKey(2), /explicit/);
  assert.equal(resolveVariantKey(6, { processType: 2 }), '101:0');
  assert.equal(resolveVariantKey(101), '101:0');
  assert.equal(getDefaultOptions('101:0').processType, 2);
  assert.throws(() => resolveVariantKey(7, { processType: 2 }), /only evidenced/);
});

test('keeps region-driven options without leaking them to unrelated rooms', () => {
  assert.equal(getDefaultOptions('14:0', { xianName: '汶川' }).hpToTingyong, 1);
  assert.equal(getDefaultOptions('15:0', { xianName: '茂县' }).hpToTingyong, 1);
  assert.equal(getDefaultOptions('6:0', { shiName: '雅安市' }).processType, 1);
  assert.deepEqual(getRoomSpec('6:0', { shiName: '雅安市' }).fields.find(field => field.key === 'processType')!.allowedValues, [1]);
  assert.ok(!Object.hasOwn(getDefaultOptions('6:0'), 'processType'));
  assert.throws(() => validateRoomOptions('6:0', { ...getDefaultOptions('6:0'), processType: 2 }), /Unsupported option/);
});

test('enforces only evidenced cross-option restrictions', () => {
  const rongxian = getDefaultOptions('20:0');
  assert.throws(() => validateRoomOptions('20:0', { ...rongxian, maxFan: 99 }), /chaoFanJiaDi=0/);
  assert.throws(() => validateRoomOptions('20:0', { ...rongxian, playerNum: 3 }), /daXiaoJia=0/);
  validateRoomOptions('20:0', { ...rongxian, playerNum: 3, daXiaoJia: 0, maxFan: 99, chaoFanJiaDi: 0 });
  assert.throws(() => validateRoomOptions('3:0', { ...getDefaultOptions('3:0'), bage10tianhu: 1 }), /one deck/);
  validateRoomOptions('3:0', { ...getDefaultOptions('3:0'), yifupai: false, bage10tianhu: 1 });
});

test('only 11:0 exposes the implemented external white-face modes', () => {
  for (const key of ['9:0', '10:0', '12:0']) {
    const options = getDefaultOptions(key);
    assert.equal(options.baipiType, 1);
    assert.deepEqual(getRoomSpec(key).fields.find(field => field.key === 'baipiType')!.allowedValues, [1]);
    validateRoomOptions(key, options);
    for (const baipiType of [2, 3]) {
      assert.throws(() => validateRoomOptions(key, { ...options, baipiType }),
        /Invalid option baipiType: expected 1/);
    }
  }
  assert.deepEqual(getRoomSpec('11:0').fields.find(field => field.key === 'baipiType')!.allowedValues, [1, 2, 3]);
  const external = getDefaultOptions('11:0');
  for (const baipiType of [1, 2, 3]) validateRoomOptions('11:0', { ...external, baipiType });
});

test('separates product-resolved inputs from behavior blockers', () => {
  assert.ok(getRoomSpec('14:0').unresolvedFields.includes('playerNum'));
  assert.ok(getRoomSpec('4:0').unresolvedFields.includes('basicTimes'));
  for (const key of catalogue.map(variant => variant.key)) {
    assert.ok(getRuleGaps(key).some(gap => gap.id === `${key}:basicTimes`
      && gap.status === 'resolved-by-product-rule' && gap.blocksGameplay === false));
  }
  for (const key of ['14:0', '15:0']) {
    assert.ok(getRuleGaps(key).some(gap => gap.id === `${key}:playerNum`
      && gap.status === 'resolved-by-product-rule' && gap.blocksGameplay === false));
  }
  for (const key of ['9:0', '10:0', '11:0', '12:0']) {
    const gap = getRuleGaps(key).find(item => item.id === `${key}:player-score`);
    assert.equal(gap?.status, 'resolved-by-product-rule');
    assert.equal(gap?.blocksGameplay, false);
    assert.deepEqual(gap?.fields, ['playerNum', 'huRedScore']);
  }
  const robBa = getRuleGaps('24:0').find(gap => gap.id === '24:0:ownBaKeQiang');
  assert.equal(robBa?.status, 'resolved-by-product-rule');
  assert.equal(robBa?.blocksGameplay, false);
  assert.deepEqual(robBa?.fields, ['ownBaKeQiang']);
  const bloodBattle = getRuleGaps('101:0').find(gap => gap.id === '101:0:blood-battle-routing');
  assert.equal(bloodBattle?.status, 'behavior-unverified');
  assert.equal(bloodBattle?.blocksGameplay, true);
  assert.equal(getVariant('101:0').gameplayReady, false);
});

test('keeps room and hall alias differences and exact tenths conversion', () => {
  assert.equal(displayName('15:0', {}, 'hall'), '茂县斗十四');
  assert.equal(displayName('15:0'), '阿坝斗十四');
  assert.equal(displayName('6:0', { xianName: '汉源' }), '汉源红二十');
  assert.equal(displayName('10:0', { xianName: '金川' }), '金川斗十四');
  assert.equal(baseScoreDecimal(1), '0.1');
  assert.equal(baseScoreDecimal(10), '1');
  assert.equal(baseScoreDecimal(9007199254740991), '900719925474099.1');
  assert.throws(() => baseScoreDecimal(0.1), /integer/);
});

test('returned options can be changed without mutating original config evidence', () => {
  const options = getDefaultOptions('2:0'); options.gameNum = 12;
  const spec = getRoomSpec('2:0'); spec.groups.config_count!.config[0]!.name = 'changed';
  assert.equal(getDefaultOptions('2:0').gameNum, 4);
  assert.equal(getRoomSpec('2:0').groups.config_count!.config[0]!.name, '4局');
  assert.throws(() => { (catalogue as unknown as unknown[]).pop(); });
});
