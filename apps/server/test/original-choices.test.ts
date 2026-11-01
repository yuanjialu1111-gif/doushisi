import test from 'node:test';
import assert from 'node:assert/strict';
import { originalChoices, originalRequest } from '../src/game/original-choices.js';
import { clientRequests, overWire } from './original-client.js';

test('同一种吃、碰、杠合成一条选项，别人那张放第一，原版客户端每种组合都发得出', () => {
  const choices = originalChoices(2, [105, 209, 305, 403], [
    { kind: 'meld', column: { seatIndex: 2, actType: 9, colType: 8, cards: [105, 209] }, destCard: 209, incoming: 209 },
    { kind: 'meld', column: { seatIndex: 2, actType: 9, colType: 8, cards: [403, 211] }, destCard: 211, incoming: 211 },
    { kind: 'meld', column: { seatIndex: 2, actType: 8, colType: 7, cards: [305, 205, 105] }, destCard: 205, incoming: 205 },
    { kind: 'other', choice: { seatIndex: 2, actType: 4, destCard: 0 } },
    { kind: 'other', choice: { seatIndex: 2, actType: 4, destCard: 0 } },
  ]) as any[];
  assert.deepEqual(choices.map(choice => choice.actType), [9, 8, 4]);
  const chi = choices[0];
  assert.equal(chi.isColAllCard, true);
  assert.deepEqual(chi.colInfo.map((col: any) => col.cards), [[209, 105], [211, 403]]);
  assert.deepEqual(choices[1].colInfo[0].cards, [205, 305, 105]);
  assert.deepEqual(clientRequests(choices, []).map(overWire), [
    { seatIndex: 2, actType: 9, colType: 8, destCard: 209, cards: [209, 105] },
    { seatIndex: 2, actType: 9, colType: 8, destCard: 211, cards: [211, 403] },
    { seatIndex: 2, actType: 8, colType: 7, destCard: 205, cards: [205, 305, 105] },
    { seatIndex: 2, actType: 4, destCard: 0 },
  ]);
});

test('出牌、报叫各一条，deathCard 是手里这手不能打、不能报的牌', () => {
  const choices = originalChoices(1, [101, 101, 202, 303, 404], [
    { kind: 'discard', code: 101 }, { kind: 'discard', code: 202 }, { kind: 'discard', code: 101 },
    { kind: 'declare', code: 303 },
  ]) as any[];
  assert.deepEqual(choices, [
    { seatIndex: 1, actType: 3, destCard: 0, deathCard: [303, 404] },
    { seatIndex: 1, actType: 12, destCard: 0, deathCard: [101, 202, 404] },
  ]);
  assert.deepEqual(clientRequests(choices, [101, 101, 202, 303, 404]).map(request => [request.actType, request.destCard]),
    [[3, 101], [3, 202], [12, 303]]);
});

test('原版出牌、报叫请求只带牌面，按那张牌补成服务端核对的样子；其他动作原样', () => {
  assert.deepEqual(originalRequest(overWire({ seatIndex: 1, actType: 3, destCard: 108 })), { actType: 3, colType: 1, destCard: 108, cards: [108] });
  assert.deepEqual(originalRequest(overWire({ seatIndex: 1, actType: 12, destCard: 205 })), { actType: 12, colType: 1, destCard: 205, cards: [205] });
  assert.deepEqual(originalRequest({ actType: 3, colType: 1, destCard: 108, cards: [108] }), { actType: 3, colType: 1, destCard: 108, cards: [108] });
  assert.deepEqual(originalRequest(overWire({ seatIndex: 1, actType: 4 })), { actType: 4, colType: 0, destCard: 0, cards: [] });
  assert.deepEqual(originalRequest(overWire({ seatIndex: 1, actType: 9, colType: 8, destCard: 209, cards: [209, 105] })),
    { actType: 9, colType: 8, destCard: 209, cards: [209, 105] });
});
