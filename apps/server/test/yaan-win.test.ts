import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeYaanOptions, getDefaultOptions, YAAN_INDEPENDENT_VERSION } from '@dss/rules';
import { evaluateYaanWin, type YaanHand, type YaanWinContext } from '../src/game/yaan-win.js';

function rules(wangNum = 3, qiWangNum = 0, overrides: Record<string, unknown> = {}) {
  const base = { ...getDefaultOptions('6:0'), wangNum, qiWangNum, ...overrides };
  return { ...base, yaan: { rulesVersion: YAAN_INDEPENDENT_VERSION } };
}
function hand(codes: number[], bonus: number[] = [], melds: YaanHand['melds'] = []): YaanHand {
  let id = 0;
  const cards = (values: number[]) => values.map(code => ({ id: `yaan-${++id}`, code }));
  return { concealed: cards(codes), melds: melds.map(meld => ({ kind: meld.kind,
    cards: cards(meld.cards.map(card => card.code)) })), bonus: cards(bonus) };
}
function context(overrides: Partial<YaanWinContext> = {}): YaanWinContext {
  return { winnerSeat: 1, dealerSeat: 1, source: 'flip', sourceSeat: 1, incomingCardId: null,
    discardCount: 0, ...overrides };
}
function incoming(current: YaanHand) { return current.concealed[0]!.id; }

test('Yaan ordinary four-group win with real red20 resolves through the source-backed scorer', () => {
  const current = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const result = evaluateYaanWin(current, context({ incomingCardId: incoming(current) }), rules(3, 0));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.equal(result.redPoints, 20);
  assert.equal(result.facts.usedWildcards, 0);
  assert.deepEqual(result.facts.concealedGroups.flat().sort(), current.concealed.map(card => card.id).sort());
  assert.equal(result.scoring.status, 'scored');
  if (result.scoring.status === 'scored') { assert.equal(result.scoring.totalFan, '1'); assert.equal(result.scoring.scoreUnits, '2'); }
});

test('Yaan wildcard can substitute a missing face but contributes no red points', () => {
  // Replace black6 with a wild 7; real red remains 20.
  const current = hand([110, 204, 309, 205, 101, 413, 207, 408]);
  const result = evaluateYaanWin(current, context({ incomingCardId: incoming(current) }), rules(3, 4));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.equal(result.facts.usedWildcards, 1);
  assert.deepEqual(result.facts.wildcardUses, [{ cardId: current.concealed[6]!.id, code: 406 }]);
  assert.equal(result.redPoints, 20);
});

test('Yaan four-pairs wildcard records the natural face it replaces', () => {
  // Three natural pairs and one missing 4 completes with the wild 7; red remains above 20.
  const current = hand([110, 210, 103, 203, 101, 201, 106, 407]);
  const result = evaluateYaanWin(current, context({ incomingCardId: incoming(current) }), rules(3, 4, { anDui: 1 }));
  assert.equal(result.status, 'winning');
  if (result.status !== 'winning') return;
  assert.deepEqual(result.facts.concealedFourPairs, { dragons: 0 });
  assert.deepEqual(result.facts.wildcardUses, [{ cardId: current.concealed[7]!.id, code: 106 }]);
});

test('Yaan rejects a short hand, insufficient red points and malformed physical copies', () => {
  assert.throws(() => evaluateYaanWin(hand([110, 204, 309, 205, 101, 413, 206]), context({ incomingCardId: 'missing' }),
    rules(3, 0)), { code: 'INVALID_YAAN_HAND' });
  // Same four-group shape, but replace red10 with black10: red 10 is below the 20 threshold.
  const low = hand([210, 204, 309, 205, 301, 413, 206, 408]);
  const result = evaluateYaanWin(low, context({ incomingCardId: incoming(low), sourceSeat: 2 }), rules(3, 0));
  assert.equal(result.status, 'not-winning');
  if (result.status === 'not-winning') assert.equal(result.reason, 'points');
  const duplicate = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  duplicate.concealed[1]!.id = duplicate.concealed[0]!.id;
  assert.throws(() => evaluateYaanWin(duplicate, context({ incomingCardId: duplicate.concealed[0]!.id }), rules(3, 0)),
    { code: 'INVALID_YAAN_HAND' });
});

test('Yaan seven-king option changes only card roles and keeps the pack versioned', () => {
  const state = hand([110, 204, 309, 205, 101, 413, 207, 408]);
  const withSeven = evaluateYaanWin(state, context({ incomingCardId: incoming(state) }), rules(3, 4));
  const withoutSeven = evaluateYaanWin(state, context({ incomingCardId: incoming(state) }), rules(3, 0));
  assert.equal(withSeven.status, 'winning');
  assert.ok(withoutSeven.status === 'winning' || withoutSeven.status === 'not-winning');
  if (withSeven.status === 'winning') assert.equal(withSeven.facts.usedWildcards, 1);
  assert.throws(() => evaluateYaanWin(state, context({ incomingCardId: incoming(state) }), { ...rules(3, 4), yaan: {} }),
    { code: 'YAAN_RULES_VERSION_REQUIRED' });
});

test('Yaan exposed melds reduce the concealed requirement and remain part of red points', () => {
  // Concealed pair 10 + 4 completes the fourth group; exposed cards add 17 red.
  const source = hand([110, 206]);
  source.melds = [
    { kind: 'chi', cards: [{ id: 'm1', code: 101 }, { id: 'm2', code: 413 }] },
    { kind: 'chi', cards: [{ id: 'm3', code: 102 }, { id: 'm4', code: 112 }] },
    { kind: 'chi', cards: [{ id: 'm5', code: 103 }, { id: 'm6', code: 111 }] },
  ];
  const result = evaluateYaanWin(source, context({ incomingCardId: source.concealed[1]!.id }), rules(3, 0));
  const baseline = hand([101, 413, 102, 412, 103, 411, 104, 410]);
  const withoutMelds = evaluateYaanWin(baseline, context({ incomingCardId: baseline.concealed[7]!.id }), rules(3, 0));
  assert.equal(result.redPoints, 18);
  assert.equal(withoutMelds.redPoints, 10);
  assert.ok(result.redPoints > withoutMelds.redPoints);
});

test('Yaan win facts consume declared, gang and gold-hook context instead of fixing them false', () => {
  const declared = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const declaredResult = evaluateYaanWin(declared,
    context({ incomingCardId: incoming(declared), baoJiao: true }), rules(3, 0));
  assert.equal(declaredResult.status, 'winning');
  if (declaredResult.status === 'winning') assert.equal(declaredResult.facts.baoJiao, true);

  const gang = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const gangResult = evaluateYaanWin(gang,
    context({ incomingCardId: incoming(gang), source: 'replacement', sourceSeat: 1, afterGang: true }), rules(3, 0));
  assert.equal(gangResult.status, 'winning');
  if (gangResult.status === 'winning') assert.equal(gangResult.facts.gangHua, true);

  const gangPao = hand([110, 204, 309, 205, 101, 413, 206, 408]);
  const gangPaoResult = evaluateYaanWin(gangPao,
    context({ incomingCardId: incoming(gangPao), source: 'discard', sourceSeat: 2, discardCount: 2, afterGang: true }), rules(3, 0));
  assert.equal(gangPaoResult.status, 'winning');
  if (gangPaoResult.status === 'winning') assert.equal(gangPaoResult.facts.gangPao, true);

  const goldHook = hand([110, 204], [], [
    { kind: 'peng', cards: [{ id: 'g1', code: 101 }, { id: 'g2', code: 201 }, { id: 'g3', code: 301 }] },
    { kind: 'peng', cards: [{ id: 'g4', code: 102 }, { id: 'g5', code: 202 }, { id: 'g6', code: 302 }] },
    { kind: 'peng', cards: [{ id: 'g7', code: 103 }, { id: 'g8', code: 203 }, { id: 'g9', code: 303 }] },
  ]);
  const goldResult = evaluateYaanWin(goldHook,
    context({ incomingCardId: goldHook.concealed[0]!.id, source: 'discard', sourceSeat: 2, discardCount: 2 }), rules(3, 0));
  assert.equal(goldResult.status, 'winning');
  if (goldResult.status === 'winning') assert.equal(goldResult.facts.jinGouDiao, true);
});

test('Yaan gold hook requires two concealed cards to form a legal group', () => {
  const melds: YaanHand['melds'] = [
    { kind: 'peng', cards: [{ id: 'h1', code: 101 }, { id: 'h2', code: 201 }, { id: 'h3', code: 301 }] },
    { kind: 'peng', cards: [{ id: 'h4', code: 102 }, { id: 'h5', code: 202 }, { id: 'h6', code: 302 }] },
    { kind: 'peng', cards: [{ id: 'h7', code: 103 }, { id: 'h8', code: 203 }, { id: 'h9', code: 303 }] },
  ];
  const legal = hand([110, 204], [], melds);
  const illegal = hand([110, 205], [], melds.map(meld => ({ ...meld, cards: meld.cards.map(card => ({ ...card })) })));
  const legalResult = evaluateYaanWin(legal,
    context({ incomingCardId: incoming(legal), source: 'discard', sourceSeat: 2, discardCount: 2 }), rules(3, 0));
  const illegalResult = evaluateYaanWin(illegal,
    context({ incomingCardId: incoming(illegal), source: 'discard', sourceSeat: 2, discardCount: 2 }), rules(3, 0));
  assert.equal(legalResult.status, 'winning');
  assert.equal(illegalResult.status, 'not-winning');
  if (illegalResult.status === 'not-winning') assert.equal(illegalResult.reason, 'shape');
});

test('Yaan concealed four pairs consumes real dragons only when anDui is enabled', () => {
  const state = hand([105, 205, 305, 405, 109, 209, 309, 409]);
  const enabled = evaluateYaanWin(state, context({ incomingCardId: incoming(state) }), rules(3, 0, { anDui: 1 }));
  assert.equal(enabled.status, 'winning');
  if (enabled.status === 'winning') {
    assert.deepEqual(enabled.facts.concealedFourPairs, { dragons: 2 });
    assert.deepEqual(enabled.facts.concealedGroups.map(group => group.length), [2, 2, 2, 2]);
  }
  const disabled = evaluateYaanWin(state, context({ incomingCardId: incoming(state) }), rules(3, 0, { anDui: 0 }));
  assert.equal(disabled.status, 'winning');
  if (disabled.status === 'winning') assert.equal(disabled.facts.concealedFourPairs, null);
});
