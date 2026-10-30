import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultOptions, PUJIANG_INDEPENDENT_VERSION } from '@dss/rules';
import { evaluatePujiangWin, type PujiangHand, type PujiangWinContext } from '../src/game/pujiang-win.js';

function rules(overrides: Record<string, unknown> = {}) {
  const base = { ...getDefaultOptions('7:0'), maxFan: 99, chengFan: 0, ...overrides };
  return { ...base, pujiang: { rulesVersion: PUJIANG_INDEPENDENT_VERSION } };
}
function hand(codes: number[], bonus: number[] = []): PujiangHand {
  let id = 0;
  const cards = (values: number[]) => values.map(code => ({ id: `pj-${++id}`, code }));
  return { concealed: cards(codes), melds: [], bonus: cards(bonus) };
}
function context(overrides: Partial<PujiangWinContext> = {}): PujiangWinContext {
  return { winnerSeat: 1, dealerSeat: 1, source: 'flip', sourceSeat: 1, incomingCardId: null,
    discardCount: 0, ...overrides };
}
const incoming = (state: PujiangHand) => state.concealed[0]!.id;

test('Pujiang red20 applies the package-backed three-fan qia20', () => {
  const state = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const result = evaluatePujiangWin(state, context({ incomingCardId: incoming(state) }), rules());
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.equal(result.redPoints, 20);
  assert.deepEqual(Object.fromEntries(result.items.map(item => [item.pattern, item.fan])), { qia20: 3 });
  assert.equal(result.scoreUnits, '4');
});

test('Pujiang four-pairs adds anDui plus dragons and excludes the same quads from siGuiYi', () => {
  const state = hand([105, 205, 305, 405, 109, 209, 309, 409]);
  const result = evaluatePujiangWin(state, context({ incomingCardId: incoming(state) }), rules({ anDui: 1, siGuiYi: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.deepEqual(Object.fromEntries(result.items.map(item => [item.pattern, item.fan])), { anDui: 3, dragon: 6 });
});

test('Pujiang plain-hu needs the player own flip and is never added on top of scored fan', () => {
  const plain = hand([110, 104, 305, 109, 201, 213, 206, 208]);
  const off = evaluatePujiangWin(plain, context({ incomingCardId: incoming(plain) }), rules({ keSuHu: 0 }));
  assert.equal(off.status, 'not-winning');
  const own = evaluatePujiangWin(plain, context({ incomingCardId: incoming(plain) }), rules({ keSuHu: 1 }));
  assert.equal(own.status, 'winning');
  if (own.status === 'winning') assert.deepEqual(own.items.map(item => item.pattern), ['keSuHu']);
  const other = evaluatePujiangWin(plain, context({ incomingCardId: incoming(plain), source: 'discard', sourceSeat: 2 }),
    rules({ keSuHu: 1 }));
  assert.equal(other.status, 'not-winning');
  const scored = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const withPlain = evaluatePujiangWin(scored, context({ incomingCardId: incoming(scored) }), rules({ keSuHu: 1 }));
  assert.equal(withPlain.status, 'winning');
  if (withPlain.status === 'winning') assert.ok(!withPlain.items.some(item => item.pattern === 'keSuHu'));
});

test('Pujiang rejects royal cards in hand, duplicate copies and foreign rule versions', () => {
  const royalInHand = hand([110, 204, 309, 205, 101, 413, 206, 1001]);
  assert.equal(evaluatePujiangWin(royalInHand, context({ incomingCardId: incoming(royalInHand) }), rules()).status, 'not-winning');
  const duplicate = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  duplicate.concealed[1]!.id = duplicate.concealed[0]!.id;
  assert.throws(() => evaluatePujiangWin(duplicate, context({ incomingCardId: duplicate.concealed[0]!.id }), rules()),
    { code: 'INVALID_PUJIANG_HAND' });
  assert.throws(() => evaluatePujiangWin(hand([110, 204, 309, 205, 101, 413, 206, 408]),
    context({ incomingCardId: 'missing' }), { ...rules(), pujiang: {} }), { code: 'PUJIANG_RULES_VERSION_REQUIRED' });
});

