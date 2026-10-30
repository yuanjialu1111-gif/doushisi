import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freezeQionglaiOptions, QIONGLAI_PACK_VERSION, RETAINED_VARIANT_KEYS } from '@dss/rules';
import { createQionglaiCardState, qionglaiPackSpecification } from '../src/game/qionglai-pack.js';
import { assertCardState, dealCards, moveCards, orderCards, projectCardState, type ZoneSpec } from '../src/game/cards.js';

const fixtures = JSON.parse(readFileSync(new URL('../../../docs/rules/cases/qionglai-pack-v1.json', import.meta.url), 'utf8')) as {
  version: string; ordinaryCodes: number[]; ordinaryCopiesPerCode: number;
  cases: { wangNum: number; total: number; specialCounts: Record<string, number> }[];
  invalidWangCounts: number[];
};
const zones: ZoneSpec[] = [
  { id: 'deck', visibility: 'hidden' },
  { id: 'a', visibility: 'private', ownerId: 'a' }, { id: 'b', visibility: 'private', ownerId: 'b' },
  { id: 'public', visibility: 'public' },
];
const rules = (wangNum: number) => ({ wangNum, qionglai: freezeQionglaiOptions({}) });

for (const fixture of fixtures.cases) {
  test(`Qionglai ${fixture.wangNum} special cards has the approved ${fixture.total}-card pack`, () => {
    assert.equal(fixtures.version, QIONGLAI_PACK_VERSION);
    const specification = qionglaiPackSpecification(fixture.wangNum);
    assert.deepEqual(specification.filter(entry => entry.code < 1000),
      fixtures.ordinaryCodes.map(code => ({ code, count: fixtures.ordinaryCopiesPerCode })));
    assert.deepEqual(specification.filter(entry => entry.code >= 1000),
      Object.entries(fixture.specialCounts).map(([code, count]) => ({ code: Number(code), count })));
    const state = createQionglaiCardState('8:0', rules(fixture.wangNum), 'deck', zones);
    assert.equal(state.pack.length, fixture.total);
    assert.equal(new Set(state.pack.map(card => card.id)).size, fixture.total);
    assert.deepEqual(state.zones[0]!.cards, state.pack.map(card => card.id));
    for (const entry of specification) assert.equal(state.pack.filter(card => card.code === entry.code).length, entry.count);
    assert.equal(state.pack.filter(card => card.code < 1000 && card.code % 100 === 7).length, 4);
    assert.equal(state.pack.some(card => card.code === 1004), false);
    assertCardState(state);
    assert.deepEqual(createQionglaiCardState('8:0', rules(fixture.wangNum), 'deck', zones), state);
  });
}

test('Qionglai pack rejects unsupported counts instead of rounding, coercing or falling back', () => {
  for (const value of [...fixtures.invalidWangCounts, NaN, Infinity]) {
    assert.throws(() => qionglaiPackSpecification(value), { code: 'INVALID_QIONGLAI_WANG_COUNT' });
    assert.throws(() => createQionglaiCardState('8:0', rules(value), 'deck', zones), { code: 'INVALID_QIONGLAI_WANG_COUNT' });
  }
  for (const value of ['3', null, undefined, true]) {
    assert.throws(() => createQionglaiCardState('8:0', { ...rules(3), wangNum: value }, 'deck', zones),
      { code: 'INVALID_QIONGLAI_WANG_COUNT' });
  }
});

test('only Qionglai rooms with the approved frozen version can construct this pack', () => {
  for (const key of [...RETAINED_VARIANT_KEYS.filter(key => key !== '8:0'), '8:1']) {
    assert.throws(() => createQionglaiCardState(key, rules(3), 'deck', zones), { code: 'QIONGLAI_PACK_REGION_MISMATCH' });
  }
  for (const metadata of [undefined, null, [], {}, { version: 'qionglai-additions-v1' }, { packVersion: 'future-v2' }]) {
    const legacy = { wangNum: 3, qionglai: metadata };
    const before = structuredClone(legacy);
    assert.throws(() => createQionglaiCardState('8:0', legacy, 'deck', zones), { code: 'QIONGLAI_PACK_VERSION_REQUIRED' });
    assert.deepEqual(legacy, before);
  }
});

test('pack instances are independent and retain unique copies, conservation and privacy after recovery', () => {
  const spec = qionglaiPackSpecification(18);
  spec[0]!.count = 99;
  spec.pop();
  assert.equal(qionglaiPackSpecification(18)[0]!.count, 1);
  const initial = createQionglaiCardState('8:0', rules(18), 'deck', zones);
  // This is a conservation fixture, not an approved regional deal or replacement sequence.
  const reversed = orderCards(initial, 'deck', [...initial.zones[0]!.cards].reverse());
  const dealt = dealCards(reversed, 'deck', ['a', 'b', 'a', 'b']);
  const exposed = dealt.zones.find(zone => zone.id === 'a')!.cards[0]!;
  const moved = moveCards(dealt, 'a', 'public', [exposed]);
  const recovered = JSON.parse(JSON.stringify(moved));
  assertCardState(recovered);
  assert.deepEqual(recovered, moved);
  const view = projectCardState(recovered, 'a');
  assert.equal(view.find(zone => zone.id === 'deck')!.cards, undefined);
  assert.equal(view.find(zone => zone.id === 'b')!.cards, undefined);
  assert.equal(view.reduce((total, zone) => total + zone.count, 0), 70);
  assert.deepEqual(view.find(zone => zone.id === 'public')!.cards, [{ id: exposed, code: 1003 }]);
  assert.equal(initial.zones[0]!.cards.length, 70);
  assert.equal(zones.some(zone => 'cards' in zone), false);
});
