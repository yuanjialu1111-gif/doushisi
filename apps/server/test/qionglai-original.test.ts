import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeQionglaiOptions, getDefaultOptions } from '@dss/rules';
import type { RoundInput, RuleEngine } from '../src/engines.js';
import { createQionglaiEngine, type QionglaiEngineSnapshot } from '../src/game/qionglai-engine.js';
import { createQionglaiOriginalAdapter } from '../src/game/qionglai-original.js';
import { qionglaiLegalActions } from '../src/game/qionglai-round.js';

function input(): RoundInput {
  const rules = { ...getDefaultOptions('8:0'), playerNum: 2, gameNum: 4, wangNum: 3, baseBeans: '0.125',
    chaJiao: 0, keSuHu: 1 };
  return { players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }], ownerUserId: 'a', number: 1,
    rules: { ...rules, qionglai: freezeQionglaiOptions(rules) },
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}
function engine() { return createQionglaiEngine('test-original-adapter', () => 0); }
function start(ruleEngine: RuleEngine = engine()) {
  return ruleEngine.create(input()) as QionglaiEngineSnapshot;
}
const adapter = () => createQionglaiOriginalAdapter();

test('enter and start notifications contain only the viewer hand and the physical remaining count', () => {
  const state = start();
  const enter = adapter().enter(state, 'b');
  const body = enter.body as any;
  assert.equal(body.seatIndex, 2);
  assert.equal(body.gameStart.dealer, 1);
  assert.equal(body.leftCardNum, state.cards.zones.find(zone => zone.id === 'deck')!.cards.length);
  assert.equal(body.gameStart.seats.length, 2);
  const self = body.gameStart.seats.find((seat: any) => seat.seatIndex === 2);
  assert.equal(self.tilesOnHandNum, 7);
  assert.equal(self.tilesOnHand.length, 7);
  const packet = adapter().notifications(state, [], 'b', 'start')[0]!;
  assert.equal(packet.command, 11);
  assert.equal((packet.body as any).dealer, 1);
});

test('face action resolves to a unique physical card and rejects an unavailable face', () => {
  const state = start();
  const engineInstance = engine();
  const view = engineInstance.view(state, 'a') as any;
  const discard = qionglaiLegalActions(state, 'a').find(action => action.type === 'discard')!;
  const face = state.cards.pack.find(card => card.id === (discard as any).cardId)!.code;
  const decoded = adapter().decodeAction!(23, { actType: 3, colType: 1, destCard: face, cards: [face] }, discard.decisionId);
  assert.deepEqual(adapter().resolveAction!(state, 'a', decoded), discard);
  const absent = [...Array(13).keys()].map(rank => 100 + rank + 1).find(code =>
    !state.cards.pack.some(card => card.code === code));
  if (absent) assert.throws(() => adapter().resolveAction!(state, 'a',
    adapter().decodeAction!(23, { actType: 3, destCard: absent, cards: [absent] }, discard.decisionId)),
  { code: 'INVALID_ACTION' });
  assert.ok(view.legalActions.some((action: any) => action.type === 'discard'));
  assert.ok(!view.legalActions.some((action: any) => action.type === 'begin' || action.type === 'draw'));
});

test('choice and next-operation notifications are decision-addressable and use original action enums', () => {
  const state = start();
  const packets = adapter().notifications(state, [], 'a', 'action');
  const choice = packets.find(packet => packet.command === 20);
  assert.ok(choice);
  const choices = (choice!.body as any).choices;
  assert.ok(choices.some((item: any) => item.actType === 3));
  assert.ok(choices.every((item: any) => item.seatIndex === 1));
  assert.equal(packets.some(packet => packet.command === 26), false);
});

test('pass and settlement notifications preserve exact player totals without hidden cards', () => {
  const engineInstance = engine();
  let state = start(engineInstance);
  const discard = qionglaiLegalActions(state, 'a').find(action => action.type === 'discard')!;
  const first = engineInstance.apply(state, 'a', discard);
  state = first.snapshot as QionglaiEngineSnapshot;
  if (state.phase === 'response') {
    const pass = qionglaiLegalActions(state, 'b').find(action => action.type === 'respond' && action.choiceId === null);
    if (pass) {
      const decoded = adapter().decodeAction!(23, { actType: 4, destCard: 0 }, pass.decisionId);
      assert.deepEqual(adapter().resolveAction!(state, 'b', decoded), pass);
      state = engineInstance.apply(state, 'b', pass).snapshot as QionglaiEngineSnapshot;
    }
  }
  const current = qionglaiLegalActions(state, 'a').find(action => action.type === 'discard') as any;
  if (current) {
    const finished = engineInstance.apply(state, 'a', { type: 'discard', cardId: current.cardId, decisionId: current.decisionId });
    state = finished.snapshot as QionglaiEngineSnapshot;
    if (state.outcome) {
      const packet = adapter().notifications(state, finished.events, 'a', 'action')
        .find(item => item.command === 28)!;
      assert.ok(packet);
      const scores = (packet.body as any).userScoreInfo;
      assert.deepEqual(scores.map((item: any) => item.uid).sort(), ['a', 'b']);
      assert.ok(scores.every((item: any) => typeof item.score === 'string'));
    }
  }
});

test('discard and meld events project the original action-flow commands before the next choice', () => {
  const state = start();
  const packet = adapter().notifications(state, [{ type: 'discard', userId: 'a', card: { code: 108 } }], 'b', 'action')[0]!;
  assert.equal(packet.command, 25);
  assert.deepEqual((packet.body as any).action, {
    seatIndex: 1, actType: 3, destCard: 108, destCardIsOwn: false, leftCardNum: 40, tilesOnHandNum: 7,
  });
  const meld = adapter().notifications(state, [{ type: 'meld', userId: 'a', kind: 'peng',
    cards: [{ code: 105 }, { code: 205 }, { code: 305 }] }], 'a', 'action')[0]!;
  assert.equal(meld.command, 25);
  assert.equal((meld.body as any).action.actType, 8);
  assert.deepEqual(((meld.body as any).action.colInfo[0]).cards, [105, 205, 305]);
});

test('replacement stays private and keeps the real card face for its owner', () => {
  const state = start();
  const card = state.cards.pack.find(item => item.code === 101)!;
  const events = [{ type: 'replacement', userId: 'a', card, remaining: 41 }];
  const owner = adapter().notifications(state, events, 'a', 'action').find(packet => packet.command === 27);
  assert.ok(owner);
  assert.equal((owner!.body as any).value, 101);
  assert.equal((owner!.body as any).isFanPai, false);
  assert.equal(adapter().notifications(state, events, 'b', 'action').some(packet => packet.command === 27), false);
});

test('enter projection keeps public reward cards visible to every seat', () => {
  const state = start();
  const snapshot = state as any;
  const ownBonus = snapshot.cards.zones.find((zone: any) => zone.id === 'bonus:a')!.cards;
  const seatA = adapter().enter(state, 'a').body as any;
  const seatBView = adapter().enter(state, 'b').body as any;
  const aFromA = seatA.gameStart.seats.find((seat: any) => seat.seatIndex === 1);
  const aFromB = seatBView.gameStart.seats.find((seat: any) => seat.seatIndex === 1);
  assert.deepEqual(aFromA.protectCards, ownBonus.map((id: string) =>
    snapshot.cards.pack.find((card: any) => card.id === id).code));
  assert.deepEqual(aFromB.protectCards, aFromA.protectCards);
});

test('settlement decimal fields target the exact userScoreInfo score and changeScore paths', () => {
  const state = start() as QionglaiEngineSnapshot & { outcome: unknown; phase: string };
  const payments = { transfers: [], postings: [
    { userId: 'a', amount: '0.125' },
    { userId: 'b', amount: '-0.125' },
  ] };
  state.outcome = { reason: 'hu', winners: [], payments, nextRoundContext: null };
  state.phase = 'finished';
  const packet = adapter().notifications(state, [{ type: 'round-ended' }], 'a', 'action')
    .find(item => item.command === 28)!;
  assert.ok(packet);
  assert.deepEqual(packet.decimalFields, [
    { path: ['hwNotifyGameOver', 'userScoreInfo', 0, 'score'], value: '0.125' },
    { path: ['hwNotifyGameOver', 'userScoreInfo', 0, 'changeScore'], value: '0.125' },
    { path: ['hwNotifyGameOver', 'userScoreInfo', 1, 'score'], value: '-0.125' },
    { path: ['hwNotifyGameOver', 'userScoreInfo', 1, 'changeScore'], value: '-0.125' },
  ]);
});
