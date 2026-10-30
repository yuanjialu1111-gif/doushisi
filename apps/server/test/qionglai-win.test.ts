import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freezeQionglaiOptions, getDefaultOptions, QIONGLAI_INDEPENDENT_VERSION } from '@dss/rules';
import { evaluateQionglaiWin, qionglaiWaits, type QionglaiHand, type QionglaiWinContext, type QionglaiMeld } from '../src/game/qionglai-win.js';
import { qionglaiWinPayments } from '../src/game/qionglai-payments.js';

interface Case {
  name: string; hand: number[]; melds?: { kind: QionglaiMeld['kind']; cards: number[] }[]; bonus?: number[];
  options?: Record<string, number>; source?: QionglaiWinContext['source']; winnerSeat?: number; sourceSeat?: number;
  discardCount?: number; red?: number; black?: number; reason?: string; fan?: number; capped?: number;
  units?: string; patterns?: Record<string, number>;
}
const fixture = JSON.parse(readFileSync(new URL('../../../docs/rules/cases/qionglai-win-v1.json', import.meta.url), 'utf8')) as {
  version: string; cases: Case[];
};
function make(f: Case) {
  let nextId = 0;
  const cards = (codes: number[]) => codes.map(code => ({ id: `fixture-${++nextId}`, code }));
  const hand: QionglaiHand = { concealed: cards(f.hand), melds: (f.melds ?? []).map(meld =>
    ({ kind: meld.kind, cards: cards(meld.cards) })), bonus: cards(f.bonus ?? []) };
  const context: QionglaiWinContext = { winnerSeat: f.winnerSeat ?? 1, dealerSeat: 1, source: f.source ?? 'flip',
    sourceSeat: f.source === 'original-hand' ? null : f.sourceSeat ?? 1,
    incomingCardId: f.source === 'original-hand' ? null : hand.concealed.at(-1)!.id,
    stealCount: hand.bonus.length, replacementCount: hand.bonus.length, discardCount: f.discardCount ?? 0 };
  const rules = { ...getDefaultOptions('8:0'), maxFan: 99, ...f.options, qionglai: freezeQionglaiOptions({}) };
  return { hand, context, rules };
}
for (const f of fixture.cases) test(`independent Qionglai hand: ${f.name}`, () => {
  const { hand, context, rules } = make(f);
  const before = structuredClone({ hand, context, rules });
  const win = evaluateQionglaiWin(hand, context, rules);
  assert.equal(win.version, fixture.version);
  assert.deepEqual({ hand, context, rules }, before);
  if (f.red !== undefined) assert.equal(win.redPoints, f.red);
  if (f.black !== undefined) assert.equal(win.blackPoints, f.black);
  if (f.reason) {
    assert.equal(win.status, 'not-winning');
    if (win.status === 'not-winning') assert.equal(win.reason, f.reason);
  } else {
    assert.equal(win.status, 'winning');
    if (win.status !== 'winning') return;
    assert.equal(win.totalFan, f.fan);
    assert.equal(win.cappedFan, f.capped ?? f.fan);
    assert.equal(win.scoreUnits, f.units);
    if (f.patterns) assert.deepEqual(Object.fromEntries(win.items.map(item => [item.pattern, item.fan])), f.patterns);
    assert.deepEqual(win.concealedGroups.flat().sort(), hand.concealed.map(card => card.id).sort());
  }
});

test('winning evaluator refuses impossible physical copies, malformed melds and historical rule versions', () => {
  const f = make(fixture.cases[0]!);
  const badId = structuredClone(f.hand);
  badId.concealed[1]!.id = badId.concealed[0]!.id;
  assert.throws(() => evaluateQionglaiWin(badId, f.context, f.rules), { code: 'INVALID_QIONGLAI_HAND' });
  const badFace = structuredClone(f.hand);
  badFace.concealed[1]!.code = badFace.concealed[0]!.code;
  assert.throws(() => evaluateQionglaiWin(badFace, f.context, f.rules), { code: 'INVALID_QIONGLAI_HAND' });
  const badMeld = make(fixture.cases.find(item => item.name === 'gold-hook-and-red55')!);
  badMeld.hand.melds[0]!.cards[0]!.code = 107;
  assert.throws(() => evaluateQionglaiWin(badMeld.hand, badMeld.context, badMeld.rules), { code: 'INVALID_QIONGLAI_HAND' });
  assert.throws(() => evaluateQionglaiWin(f.hand, f.context, { ...f.rules, qionglai: {} }),
    { code: 'QIONGLAI_RULES_VERSION_REQUIRED' });
  assert.throws(() => evaluateQionglaiWin(f.hand, { ...f.context, source: 'discard' }, f.rules), { code: 'INVALID_RULE_FACTS' });
  assert.throws(() => evaluateQionglaiWin(f.hand, { ...f.context, incomingCardId: 'missing' }, f.rules),
    { code: 'INVALID_RULE_FACTS' });
});

test('waits enumerate known-capacity complements without hidden deck data or reward-card substitutes', () => {
  const f = make(fixture.cases[0]!);
  f.hand.concealed.pop();
  const waits = qionglaiWaits(f.hand, f.context, f.rules);
  assert.deepEqual(waits.map(wait => wait.code), [208, 408]);
  assert.ok(waits.every(wait => wait.result.status === 'winning'));
  assert.throws(() => qionglaiWaits({ ...f.hand, concealed: [] }, f.context, f.rules), { code: 'INVALID_QIONGLAI_HAND' });
});

test('versioned payments distinguish discard liability from public flips, with simultaneous winners and exact pennies', () => {
  const f = make(fixture.cases[0]!);
  const win = evaluateQionglaiWin(f.hand, f.context, f.rules);
  assert.equal(win.status, 'winning');
  if (win.status !== 'winning') return;
  const players = ['a', 'b', 'c', 'd'];
  const amounts = (kind: 'discard' | 'flip') => qionglaiWinPayments(players,
    [{ userId: 'b', win }], { kind, userId: 'a' }, '0.125').postings;
  assert.deepEqual(amounts('discard'), [
    { userId: 'a', amount: '-0.5' }, { userId: 'b', amount: '0.5' }, { userId: 'c', amount: '0' }, { userId: 'd', amount: '0' },
  ]);
  assert.deepEqual(amounts('flip'), [
    { userId: 'a', amount: '-0.5' }, { userId: 'b', amount: '1.5' }, { userId: 'c', amount: '-0.5' }, { userId: 'd', amount: '-0.5' },
  ]);
  const simultaneous = qionglaiWinPayments(players, [{ userId: 'c', win }, { userId: 'b', win }],
    { kind: 'flip', userId: 'a' }, '0.000000000001');
  assert.deepEqual(simultaneous.postings, [
    { userId: 'a', amount: '-0.000000000008' }, { userId: 'b', amount: '0.000000000008' },
    { userId: 'c', amount: '0.000000000008' }, { userId: 'd', amount: '-0.000000000008' },
  ]);
  assert.equal(simultaneous.transfers.length, 4);
  assert.deepEqual(simultaneous, qionglaiWinPayments(players, [{ userId: 'b', win }, { userId: 'c', win }],
    { kind: 'flip', userId: 'a' }, '0.000000000001'));
  assert.throws(() => qionglaiWinPayments(players, [{ userId: 'a', win }], { kind: 'discard', userId: 'a' }, '1'),
    { code: 'INVALID_QIONGLAI_PAYMENT' });
  assert.throws(() => qionglaiWinPayments(players, [{ userId: 'b', win: { ...win, version: 'old' as typeof QIONGLAI_INDEPENDENT_VERSION } }],
    { kind: 'flip', userId: 'a' }, '1'), { code: 'INVALID_QIONGLAI_PAYMENT' });
});
