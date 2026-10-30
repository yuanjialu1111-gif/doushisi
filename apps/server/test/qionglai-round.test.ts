import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeQionglaiOptions, getDefaultOptions } from '@dss/rules';
import type { RoundInput, EngineResult } from '../src/engines.js';
import { createQionglaiCardState } from '../src/game/qionglai-pack.js';
import { moveCards } from '../src/game/cards.js';
import { shuffle } from '../src/policies.js';
import { createQionglaiRound, applyQionglaiAction, assertQionglaiRound, qionglaiLegalActions,
  viewQionglaiRound, qionglaiTimedAction, type QionglaiRound, type QionglaiAction } from '../src/game/qionglai-round.js';

const good = [110, 204, 309, 205, 101, 413, 206, 408];
const other = [102, 103, 104, 105, 106, 107, 108];
function input(count: number, options: Record<string, unknown> = {}): RoundInput {
  const rules = { ...getDefaultOptions('8:0'), playerNum: count, wangNum: 3, baseBeans: '0.125',
    chaJiao: 0, ...options };
  return { players: Array.from({ length: count }, (_, i) => ({ userId: String.fromCharCode(97 + i), seat: i + 1 })),
    ownerUserId: 'a', number: 1, rules: { ...rules, qionglai: freezeQionglaiOptions(rules) },
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}
function pack(i: RoundInput) {
  return createQionglaiCardState('8:0', i.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;
}
function make(hands: number[][], tail: number[] = [], options: Record<string, unknown> = {}) {
  const i = input(hands.length, options), physical = pack(i), used = new Set<string>();
  const id = (code: number) => {
    const c = physical.find(c => c.code === code && !used.has(c.id));
    assert.ok(c, `Fixture requests an unavailable face ${code}`); used.add(c.id); return c.id;
  };
  const deal = Array.from({ length: 7 }, (_, index) => hands.map(h => h[index]!)).flat();
  deal.push(hands[0]![7]!);
  const ordered = [...deal, ...tail].map(id);
  ordered.push(...physical.filter(c => !used.has(c.id)).map(c => c.id));
  return createQionglaiRound(i, ordered);
}
function zone(s: QionglaiRound, name: string) { return s.cards.zones.find(z => z.id === name)!.cards; }
function code(s: QionglaiRound, id: string) { return s.cards.pack.find(c => c.id === id)!.code; }
function action(s: QionglaiRound, id: string, type: QionglaiAction['type'], face?: number) {
  const a = qionglaiLegalActions(s, id).find(a => a.type === type && (face === undefined ||
    'cardId' in a && code(s, a.cardId) === face ||
    'cardIds' in a && a.cardIds.some(cid => code(s, cid) === face)));
  assert.ok(a, `Missing ${id} ${type} ${face ?? ''}, phase ${s.phase}`);
  return a;
}
function apply(s: QionglaiRound, id: string, a: QionglaiAction): QionglaiRound {
  const before = structuredClone(s);
  const result = applyQionglaiAction(s, id, a);
  assert.deepEqual(s, before, 'apply must not mutate an archived snapshot');
  assertQionglaiRound(result.snapshot as QionglaiRound);
  return result.snapshot as QionglaiRound;
}
function run(s: QionglaiRound, id: string, type: QionglaiAction['type'], face?: number) {
  return apply(s, id, action(s, id, type, face));
}
function reply(s: QionglaiRound, id: string, type: string | null) {
  const choiceId = type === null ? null : s.claims!.offers.find(o => o.userId === id && (o.action as { type: string }).type === type)?.id;
  assert.notEqual(choiceId, undefined, `Missing ${id} response ${type}`);
  return apply(s, id, { type: 'respond', decisionId: s.claims!.id, choiceId: choiceId! });
}
function allPass(s: QionglaiRound) {
  while (s.phase === 'response') {
    const p = s.players.find(p => qionglaiLegalActions(s, p.userId).length);
    assert.ok(p);
    s = reply(s, p.userId, null);
  }
  return s;
}
function drain(s: QionglaiRound) {
  const remaining = [...zone(s, 'deck')];
  if (remaining.length) s.cards = moveCards(s.cards, 'deck', 'discards', remaining);
  assertQionglaiRound(s);
  return s;
}

test('literal initial hand offers heaven before any steal, with exact final payment and no repeated settlement', () => {
  const s = make([good, other]);
  assert.deepEqual(s.players.map(p => zone(s, `hand:${p.userId}`).length), [8, 7]);
  assert.equal(zone(s, 'deck').length, 40);
  const result = applyQionglaiAction(s, 'a', action(s, 'a', 'hu'));
  const ended = result.snapshot as QionglaiRound;
  assert.equal(ended.outcome!.winners[0]!.win.totalFan, 6);
  assert.deepEqual(result.settlement, [{ userId: 'a', amount: '0.875' }, { userId: 'b', amount: '-0.875' }]);
  assert.deepEqual(result.confirmedScores![0]!.postings, result.settlement);
  assert.deepEqual(result.nextRoundContext, {
    version: s.version, completedRound: 1, nextDealerId: 'a', dealerRun: 2,
  });
  assert.equal(qionglaiTimedAction(ended, 'a'), null);
  assert.throws(() => applyQionglaiAction(ended, 'a', action(s, 'a', 'hu')), { code: 'STALE_CLAIM_WINDOW' });
});

test('initial reward chains keep every physical card, replace privately and cannot claim heaven afterwards', () => {
  const s = make([[1001, ...good.slice(1)], other], [1002, 110]);
  assert.ok(!qionglaiLegalActions(s, 'a').some(a => a.type === 'hu'));
  const next = run(s, 'a', 'begin');
  assert.deepEqual(zone(next, 'bonus:a').map(id => code(next, id)), [1001, 1002]);
  assert.deepEqual(next.counters, { steals: 2, replacements: 2, discards: 0 });
  assert.equal(zone(next, 'hand:a').length, 8);
  assert.equal(zone(next, 'deck').length, 38);
  assert.equal(next.source!.kind, 'replacement');
  const ended = run(next, 'a', 'hu');
  assert.equal(ended.outcome!.winners[0]!.win.totalFan, 5);
  assert.ok(!ended.outcome!.winners[0]!.win.items.some(item => item.pattern === 'tianHu'));
  assert.deepEqual(ended.outcome!.payments.postings, [{ userId: 'a', amount: '0.75' }, { userId: 'b', amount: '-0.75' }]);
});

test('chi is restricted to the next seat (or own flip) and does not invent a replacement', () => {
  let s = make([[105, 101, 102, 103, 104, 106, 107, 108],
    [209, 202, 203, 204, 205, 206, 207], [409, 302, 303, 304, 305, 306, 307]]);
  s = run(s, 'a', 'begin'); s = run(s, 'a', 'discard', 105);
  assert.ok(s.claims!.offers.some(o => o.userId === 'b' && (o.action as { type: string }).type === 'chi'));
  assert.ok(!s.claims!.offers.some(o => o.userId === 'c' && (o.action as { type: string }).type === 'chi'));
  const count = zone(s, 'deck').length;
  s = reply(s, 'b', 'chi');
  assert.equal(s.phase, 'discard'); assert.equal(s.activeId, 'b');
  assert.equal(zone(s, 'hand:b').length, 6); assert.equal(zone(s, 'deck').length, count);
  assert.deepEqual(s.players[1]!.melds.map(m => m.kind), ['chi']);
});

test('peng beats chi independent of response order, replaces one and survives serialized recovery', () => {
  let s = make([[105, 101, 102, 103, 104, 106, 107, 108],
    [209, 202, 203, 204, 205, 206, 207], [305, 405, 302, 303, 304, 306, 307]], [110]);
  s = run(s, 'a', 'begin'); s = run(s, 'a', 'discard', 105);
  const bFirst = reply(s, 'b', 'chi');
  assert.equal(bFirst.phase, 'response');
  assert.deepEqual(qionglaiLegalActions(bFirst, 'b'), []);
  const restored = JSON.parse(JSON.stringify(bFirst)) as QionglaiRound;
  const resolved = reply(restored, 'c', 'peng');
  assert.deepEqual(resolved, reply(reply(s, 'c', 'peng'), 'b', 'chi'));
  assert.equal(resolved.activeId, 'c'); assert.equal(resolved.phase, 'discard');
  assert.equal(zone(resolved, 'hand:c').length, 6);
  assert.equal(resolved.counters.replacements, 1);
  assert.equal(resolved.players[2]!.melds[0]!.kind, 'peng');
  assert.throws(() => applyQionglaiAction(resolved, 'b', {
    type: 'respond', choiceId: null, decisionId: s.claims!.id,
  }), { code: 'STALE_CLAIM_WINDOW' });
});

test('claimed gang replaces two cards and keeps all four in the public meld', () => {
  let s = make([[105, 101, 102, 103, 104, 106, 107, 108],
    [209, 202, 203, 204, 206, 207, 208], [205, 305, 405, 302, 303, 304, 306]], [110, 310]);
  s = run(s, 'a', 'begin'); s = run(s, 'a', 'discard', 105);
  s = reply(s, 'b', null); s = reply(s, 'c', 'gang');
  assert.equal(s.phase, 'discard'); assert.equal(s.activeId, 'c');
  assert.equal(s.counters.replacements, 2);
  assert.equal(zone(s, 'hand:c').length, 6);
  assert.deepEqual(zone(s, 'melds:c').map(id => code(s, id)).sort((a, b) => a - b), [105, 205, 305, 405]);
});

test('concealed tou then ba retains the old meld and restores the six-card target each time', () => {
  let s = make([[105, 205, 305, 101, 103, 106, 108, 110],
    [201, 202, 203, 204, 206, 207, 208]], [405, 302]);
  s = run(s, 'a', 'begin'); s = run(s, 'a', 'tou', 105);
  assert.equal(zone(s, 'hand:a').length, 6); assert.equal(s.counters.replacements, 1);
  s = run(s, 'a', 'ba', 405);
  assert.equal(s.players[0]!.melds.length, 1); assert.equal(s.players[0]!.melds[0]!.kind, 'ba');
  assert.equal(zone(s, 'hand:a').length, 6); assert.equal(s.counters.replacements, 2);
  assert.equal(zone(s, 'melds:a').length, 4);
});

test('concealed gang consumes four and restores only two, with finite exhaustion during replacement', () => {
  let s = make([[105, 205, 305, 405, 103, 106, 108, 110],
    [201, 202, 203, 204, 206, 207, 208]], [302, 303]);
  s = run(s, 'a', 'begin');
  const resolved = run(s, 'a', 'gang', 105);
  assert.equal(zone(resolved, 'hand:a').length, 6); assert.equal(resolved.counters.replacements, 2);
  const depleted = run(drain(s), 'a', 'gang', 105);
  assert.equal(depleted.phase, 'finished'); assert.equal(depleted.outcome!.reason, 'draw');
  assert.equal(zone(depleted, 'hand:a').length, 4);
  assert.ok(depleted.outcome!.payments.postings.every(p => p.amount === '0'));
});

test('two simultaneous Hu winners share one physical source and choose the nearest next dealer', () => {
  let s = make([[102, 103, 104, 105, 106, 107, 108, 408], good.slice(0, 7),
    [201, 213, 202, 412, 203, 411, 406]]);
  s = run(s, 'a', 'begin'); s = run(s, 'a', 'discard', 408);
  const reversed = reply(reply(s, 'c', 'hu'), 'b', 'hu');
  const ended = reply(reply(s, 'b', 'hu'), 'c', 'hu');
  assert.deepEqual(ended, reversed);
  assert.deepEqual(ended.outcome!.winners.map(w => w.userId), ['b', 'c']);
  assert.deepEqual(ended.outcome!.payments.postings, [
    { userId: 'a', amount: '-1.875' }, { userId: 'b', amount: '0.875' }, { userId: 'c', amount: '1' },
  ]);
  assert.equal(zone(ended, 'table').length, 1);
  assert.equal(zone(ended, 'hand:b').length, 7); assert.equal(zone(ended, 'hand:c').length, 7);
  assert.equal(ended.outcome!.nextRoundContext.nextDealerId, 'b');
  const i = input(3); i.number = 2; i.previousRoundContext = ended.outcome!.nextRoundContext;
  const next = createQionglaiRound(i, pack(i).map(c => c.id));
  assert.equal(next.dealerId, 'b'); assert.equal(next.dealerRun, 1);
  assert.deepEqual(next.players.map(p => zone(next, `hand:${p.userId}`).length), [7, 8, 7]);
  delete i.previousRoundContext;
  assert.throws(() => createQionglaiRound(i, pack(i).map(c => c.id)), { code: 'ROUND_CONTEXT_REQUIRED' });
});

test('public flips are not private draws, and unclaimed ordinary cards go to the discard zone', () => {
  let s = make([[101, 102, 103, 104, 105, 106, 107, 108],
    [201, 202, 203, 204, 205, 206, 207]], [309]);
  s = run(s, 'a', 'begin'); s = allPass(run(s, 'a', 'discard', 108));
  assert.equal(s.phase, 'draw'); assert.equal(s.activeId, 'b');
  s = run(s, 'b', 'draw');
  assert.equal(zone(s, 'table').map(id => code(s, id))[0], 309);
  const unchanged = zone(s, 'hand:b');
  s = allPass(s);
  assert.equal(s.phase, 'draw'); assert.equal(s.activeId, 'a');
  assert.deepEqual(zone(s, 'hand:b'), unchanged);
  assert.ok(zone(s, 'discards').some(id => code(s, id) === 309));
});

test('public flip win uses no earth fan and charges each non-winner one share', () => {
  let s = make([[102, 103, 104, 105, 106, 107, 108, 109], good.slice(0, 7)], [408]);
  s = run(s, 'a', 'begin'); s = allPass(run(s, 'a', 'discard', 102)); s = run(s, 'b', 'draw');
  if (qionglaiLegalActions(s, 'a').length) s = reply(s, 'a', null);
  s = reply(s, 'b', 'hu');
  assert.equal(s.outcome!.winners[0]!.win.totalFan, 3);
  assert.deepEqual(s.outcome!.payments.postings, [{ userId: 'a', amount: '-0.5' }, { userId: 'b', amount: '0.5' }]);
});

test('declaration freezes server-computed waits; a bonus cannot authorize changing the declared hand', () => {
  let s = make([[...good.slice(0, 7), 112], [103, 104, 105, 107, 108, 109, 111]], [212, 1001, 303]);
  s = run(s, 'a', 'begin'); s = run(s, 'a', 'declare', 112);
  assert.deepEqual(s.players[0]!.declared, [208, 408]);
  s = allPass(s); s = allPass(run(s, 'b', 'draw')); s = run(s, 'a', 'draw');
  const choices = qionglaiLegalActions(s, 'a');
  assert.equal(choices.length, 1); assert.equal(choices[0]!.type, 'discard');
  assert.ok('cardId' in choices[0]! && code(s, choices[0].cardId) === 303);
  s = apply(s, 'a', choices[0]!);
  assert.deepEqual(s.players[0]!.declared, [208, 408]);
  assert.deepEqual(zone(s, 'hand:a').map(id => code(s, id)), good.slice(0, 7));
});

test('legacy snapshots without declared bonus fields remain un-declared and valid', () => {
  const state = make([good, other]);
  const legacy = structuredClone(state) as QionglaiRound & { players: Array<Record<string, unknown>> };
  delete legacy.players[0]!.declaredBonusIds;
  delete legacy.players[0]!.declared;
  assert.doesNotThrow(() => assertQionglaiRound(legacy as QionglaiRound));

  const forged = structuredClone(legacy) as QionglaiRound & { players: Array<Record<string, unknown>> };
  forged.players[0]!.declaredBonusIds = [];
  forged.players[0]!.declared = null;
  assert.throws(() => assertQionglaiRound(forged as QionglaiRound), { code: 'INVALID_QIONGLAI_STATE' });
});

test('declaration respects include-winning-card versus already-red20 without trusting a client wait list', () => {
  const hands = [[110, 204, 309, 205, 201, 413, 206, 112], other];
  const can = run(make(hands, [], { baoJiaoYingbao: 0, keSuHu: 1 }), 'a', 'begin');
  assert.ok(qionglaiLegalActions(can, 'a').some(a => a.type === 'declare' && code(can, a.cardId) === 112));
  const cannot = run(make(hands, [], { baoJiaoYingbao: 1, keSuHu: 1 }), 'a', 'begin');
  assert.ok(!qionglaiLegalActions(cannot, 'a').some(a => a.type === 'declare' && code(cannot, a.cardId) === 112));
  assert.throws(() => applyQionglaiAction(can, 'a', { ...action(can, 'a', 'declare', 112), waits: [1001] }), { code: 'INVALID_ACTION' });
});

test('exhaustion checks called hands using neutral wins, ignores hidden depletion and retains the dealer', () => {
  for (const chaJiao of [0, 1]) {
    let s = make([[102, 103, 104, 105, 106, 107, 108, 112], good.slice(0, 7)], [], { chaJiao });
    s = run(s, 'a', 'begin'); s = allPass(run(s, 'a', 'discard', 112));
    s = run(drain(s), 'b', 'draw');
    assert.equal(s.outcome!.reason, 'draw');
    assert.deepEqual(s.outcome!.payments.postings, [
      { userId: 'a', amount: chaJiao ? '-0.5' : '0' }, { userId: 'b', amount: chaJiao ? '0.5' : '0' },
    ]);
    assert.equal(s.outcome!.nextRoundContext.nextDealerId, 'a');
    assert.equal(s.outcome!.nextRoundContext.dealerRun, 2);
  }
});

test('private views, legal choices and timing expose neither another hand nor the remaining order', () => {
  const s = make([good, other]);
  const before = structuredClone(s);
  const view = viewQionglaiRound(s, 'b');
  assert.equal(view.cards.find(z => z.id === 'hand:a')!.cards, undefined);
  assert.equal(view.cards.find(z => z.id === 'deck')!.cards, undefined);
  assert.deepEqual(view.legalActions, []);
  assert.throws(() => viewQionglaiRound(s, 'outsider'), { code: 'NOT_ROOM_MEMBER' });
  assert.equal(qionglaiTimedAction(s, 'a')!.action.type, 'hu');
  assert.equal(qionglaiTimedAction(s, 'a')!.delayMs, 30000);
  view.players[0]!.melds.push({ kind: 'chi', cardIds: ['tamper'] });
  assert.deepEqual(s, before);
  assert.throws(() => applyQionglaiAction(s, 'b', { ...action(s, 'a', 'begin') }), { code: 'INVALID_ACTION' });
});

for (const count of [2, 3, 4]) for (const wangNum of [3, 6, 9, 12, 15, 18]) {
  test(`finite deterministic round and replay: ${count} players, ${wangNum} rewards`, () => {
    const i = input(count, { wangNum, chaJiao: 1, keSuHu: 1 });
    let seed = count * 100 + wangNum;
    const order = shuffle(pack(i).map(c => c.id), max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; });
    let s = createQionglaiRound(i, order), steps = 0;
    while (s.phase !== 'finished') {
      assert.ok(steps++ < 500, 'Every draw must eventually consume the finite physical deck');
      const timed = s.players.map(p => qionglaiTimedAction(s, p.userId)).find(Boolean)!;
      assert.ok(timed);
      const before = JSON.parse(JSON.stringify(s)) as QionglaiRound;
      const one: EngineResult = applyQionglaiAction(s, timed.userId, timed.action);
      assert.deepEqual(one, applyQionglaiAction(before, timed.userId, timed.action));
      s = one.snapshot as QionglaiRound;
      assertQionglaiRound(s);
    }
    assert.ok(s.outcome);
    assert.equal(s.cards.pack.length, 52 + wangNum);
    assert.equal(s.cards.zones.reduce((n, z) => n + z.cards.length, 0), 52 + wangNum);
  });
}
