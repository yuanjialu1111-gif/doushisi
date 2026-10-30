import test from 'node:test';
import assert from 'node:assert/strict';
import { ABA_INDEPENDENT_VERSION, getDefaultOptions } from '@dss/rules';
import type { RoundInput } from '../src/engines.js';
import { abaLegalActions, applyAbaAction, createAbaRound } from '../src/game/aba-round.js';
import { createAbaCardState } from '../src/game/aba-pack.js';

function input(overrides: Record<string, unknown> = {}): RoundInput {
  const rules = { ...getDefaultOptions('9:0'), playerNum: 2, gameNum: 4, huRedScore: 300,
    baojiaoCondition: 1, baipiType: 1, maxFan: 99, baseBeans: '0.125', ...overrides };
  return { players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }], ownerUserId: 'a', number: 1,
    rules: { ...rules, aba: { rulesVersion: ABA_INDEPENDENT_VERSION } },
    policy: { selectedUserId: null, triggered: false, probability: '0', version: null } };
}
const pack = (round: RoundInput) => createAbaCardState('9:0', round.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]).pack;

test('Aba declare is a real locked wait action and cannot be re-declared', () => {
  const round = input();
  const physical = pack(round);
  const used = new Set<string>();
  const pick = (code: number) => {
    const card = physical.find(candidate => candidate.code === code && !used.has(candidate.id));
    assert.ok(card, `Fixture face unavailable: ${code}`); used.add(card.id); return card.id;
  };
  const dealerCodes = [110, 104, 109, 105, 201, 212, 206, 208];
  const opponentCodes = [301, 302, 303, 304, 305, 306, 307];
  const order = dealerCodes.slice(0, 7).flatMap((code, index) => [pick(code), pick(opponentCodes[index]!)]);
  order.push(pick(dealerCodes[7]!));
  order.push(...physical.filter(card => !used.has(card.id)).map(card => card.id));
  let state = createAbaRound(round, order);
  state = applyAbaAction(state, 'a', abaLegalActions(state, 'a').find(action => action.type === 'begin')!).snapshot as typeof state;
  const declaration = abaLegalActions(state, 'a').find(action => action.type === 'declare');
  assert.ok(declaration, 'A red-20-compatible paired hand must offer declare.');
  const next = applyAbaAction(state, 'a', declaration).snapshot as typeof state;
  assert.ok(next.players[0]!.declaredWaits!.length > 0);
  assert.equal(abaLegalActions(next, 'a').some(action => action.type === 'declare'), false);
});
