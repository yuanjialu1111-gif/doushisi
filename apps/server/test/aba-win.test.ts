import test from 'node:test';
import assert from 'node:assert/strict';
import { ABA_INDEPENDENT_VERSIONS, getDefaultOptions } from '@dss/rules';
import { evaluateAbaWin, type AbaHand, type AbaWinContext } from '../src/game/aba-win.js';

function rulesFor(variantKey: keyof typeof ABA_INDEPENDENT_VERSIONS, overrides: Record<string, unknown> = {}) {
  return { ...getDefaultOptions(variantKey), ...overrides, aba: { rulesVersion: ABA_INDEPENDENT_VERSIONS[variantKey] } };
}
function rules(overrides: Record<string, unknown> = {}) { return rulesFor('9:0', overrides); }
function hand(codes: number[], bonus: number[] = [], melds: AbaHand['melds'] = []): AbaHand {
  let id = 0;
  const cards = (values: number[]) => values.map(code => ({ id: `aba-${++id}`, code }));
  return { concealed: cards(codes), melds: melds.map(meld => ({ kind: meld.kind,
    cards: meld.cards.map(card => ({ id: `aba-${++id}`, code: card.code })) })), bonus: cards(bonus) };
}
function context(overrides: Partial<AbaWinContext> = {}): AbaWinContext {
  return { winnerSeat: 1, dealerSeat: 1, source: 'flip', sourceSeat: 1, incomingCardId: null,
    discardCount: 0, ...overrides };
}
const incoming = (state: AbaHand) => state.concealed[0]!.id;

test('Aba structure score combines red pairs, melds and bonus faces before the threshold', () => {
  const plain = hand([110, 204, 305, 109, 201, 213, 206, 208]);
  const low = evaluateAbaWin(plain, context({ incomingCardId: incoming(plain) }), rules());
  assert.equal(low.status, 'not-winning');
  const withBonus = evaluateAbaWin({ ...hand([110, 204, 305, 109, 201, 213, 206, 208], [1003, 1003]),
    concealed: plain.concealed }, context({ incomingCardId: incoming(plain) }), rules());
  assert.equal(withBonus.status, 'winning');
  if (withBonus.status === 'winning') assert.ok(withBonus.structureScore >= 300);
});

test('Aba package switches add fan only when their exact conditions hold', () => {
  const state = hand([110, 204, 309, 205, 201, 213],
    [1003, 1003], [{ kind: 'peng', cards: [{ id: 'x1', code: 102 }, { id: 'x2', code: 202 }, { id: 'x3', code: 302 }] }]);
  const result = evaluateAbaWin(state, context({ incomingCardId: incoming(state), source: 'discard', sourceSeat: 1,
    discardCount: 1 }), rules({ huRedScore: 300, diHu: 1, jiaFan_258: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') {
    assert.ok(result.items.some(item => item.pattern === 'diHu'));
    assert.ok(result.items.some(item => item.pattern === 'jiaFan258Peng'));
  }
});

test('Aba haidilao adds one fan only on the final ordinary flip', () => {
  const state = hand([110, 204, 309, 205, 201, 213], [1001, 1002],
    [{ kind: 'peng', cards: [{ id: 'm1', code: 102 }, { id: 'm2', code: 202 }, { id: 'm3', code: 302 }] }]);
  const on = evaluateAbaWin(state, context({ incomingCardId: incoming(state), source: 'flip', deckEmpty: true }),
    rules({ huRedScore: 300, haiDiLao: 1 }), '9:0');
  assert.equal(on.status, 'winning');
  if (on.status === 'winning') assert.ok(on.items.some(item => item.pattern === 'haiDiLao'));
  const off = evaluateAbaWin(state, context({ incomingCardId: incoming(state), source: 'flip', deckEmpty: false }),
    rules({ huRedScore: 300, haiDiLao: 1 }), '9:0');
  assert.equal(off.status, 'winning');
  if (off.status === 'winning') assert.ok(!off.items.some(item => item.pattern === 'haiDiLao'));
});

test('Aba rejects malformed pack cards and only 11:0 accepts external white-face modes', () => {
  const state = hand([110, 204, 305, 109, 201, 213, 206, 208]);
  for (const variantKey of ['9:0', '10:0', '12:0'] as const) for (const baipiType of [2, 3]) {
    assert.throws(() => evaluateAbaWin(state, context({ incomingCardId: incoming(state) }),
      rulesFor(variantKey, { baipiType }), variantKey), { code: 'INVALID_ROOM_OPTIONS' });
  }
  assert.throws(() => evaluateAbaWin(state, context({ incomingCardId: incoming(state) }), rules({ baipiType: 9 })),
    { code: 'INVALID_ROOM_OPTIONS' });
  const duplicate = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  duplicate.concealed[1]!.id = duplicate.concealed[0]!.id;
  assert.throws(() => evaluateAbaWin(duplicate, context({ incomingCardId: duplicate.concealed[0]!.id }), rules()),
    { code: 'INVALID_ABA_HAND' });
  const specialInHand = hand([110, 204, 309, 205, 1001, 213, 206, 208]);
  assert.equal(evaluateAbaWin(specialInHand, context({ incomingCardId: incoming(specialInHand) }), rules()).reason,
    'special-card-in-hand');
  const whiteInHand = hand([110, 204, 309, 205, 1003, 213, 206, 208]);
  assert.equal(evaluateAbaWin(whiteInHand, context({ incomingCardId: incoming(whiteInHand) }), rules()).reason,
    'special-card-in-hand');
  assert.throws(() => evaluateAbaWin(state, context({ incomingCardId: incoming(state),
    wildcards: [{ cardId: 'external-white', code: 1003 }] }), rules()), { code: 'INVALID_ABA_HAND' });
});

test('Aba v1 counts white faces only in the bonus zone', () => {
  const state = hand([110, 204, 305, 109, 201, 213, 206, 208], [1003]);
  const result = evaluateAbaWin(state, context({ incomingCardId: incoming(state) }), rules({ huRedScore: 300 }));
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') assert.ok(result.structureScore >= 300);
});

test('Aba white-face winning source must be declared', () => {
  const state = hand([110, 204, 305, 109, 201, 213, 206, 208]);
  assert.throws(() => evaluateAbaWin(state, context({ source: 'white', sourceSeat: 2, incomingCardId: 'white-1' }), rules()),
    { code: 'INVALID_RULE_FACTS' });
});

test('Aba score ratio keeps the /100 and 0.8 factors exact', () => {
  const state = hand([110, 204, 309, 205, 201, 213], [1003, 1003],
    [{ kind: 'peng', cards: [{ id: 'm1', code: 102 }, { id: 'm2', code: 202 }, { id: 'm3', code: 302 }] }]);
  const result = evaluateAbaWin(state, context({ incomingCardId: incoming(state), source: 'discard', sourceSeat: 1,
    discardCount: 1 }), rules({ huRedScore: 300, diHu: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status === 'winning') {
    assert.equal(result.structureScore, 430);
    assert.equal(result.totalFan, 1);
    assert.deepEqual(result.scoreRatio, { numerator: '6880', denominator: '1000' });
    assert.equal(Number(result.scoreRatio.numerator) / Number(result.scoreRatio.denominator), 6.88);
  }
});
