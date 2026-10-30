import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';

interface State { players: EnginePlayer[] }

// This fixture covers API projection and accounting only. It is not a regional rule engine.
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'records-api-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'test-only-records-api-projection' },
  create(input) { return { players: input.players } satisfies State; },
  apply(raw) {
    const state = raw as State;
    const settlement = state.players.map((player, index) => ({ userId: player.userId, amount: index === 0 ? '0.125' : '-0.125' }));
    return { snapshot: state, events: [], confirmedScores: [{ eventId: 'terminal', postings: settlement }], settlement };
  },
  view() { return {}; },
};

test('records API is bean-first and exposes score only as a room-bean compatibility alias', async () => {
  const db = await openDatabase();
  await migrate(db);
  const { app, auth, ledger, rooms } = await createApp(db, { staticFiles: false, engines: new EngineRegistry([fixture]), scheduler: false });
  try {
    const beans = await auth.create('records_api_beans', 'test-password-only', 'beans_admin');
    const players = await Promise.all(['records_api_first', 'records_api_second'].map(username => auth.create(username, 'test-password-only')));
    for (const player of players) await ledger.adjust(beans, player.id, '10', 'records API fixture funding', `records-api-credit-${player.id}`);

    const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4, useCardType: 2 });
    await rooms.join(players[1]!, room.code);
    await rooms.ready(players[0]!, room.id, true);
    const started = await rooms.ready(players[1]!, room.id, true);
    await rooms.action(players[0]!, room.id, 'records-api-settlement', { type: 'settle' }, started.stateVersion!, started.roundId!);

    // This deliberately separates the wallet from the room total. A later admin
    // adjustment must refresh beanBalance without rewriting the historical room delta.
    await ledger.adjust(beans, players[0]!.id, '1', 'records API balance separation', 'records-api-topup');
    const session = await auth.login(players[0]!.username, 'test-password-only');
    const headers = { authorization: `Bearer ${session.token}` };

    const list = await app.inject({ method: 'GET', url: '/api/records?page=1', headers });
    assert.equal(list.statusCode, 200);
    const record = list.json().records.find((entry: { id: string }) => entry.id === room.id);
    assert.ok(record);
    assert.equal(record.beanBalance, '10.125');
    assert.equal(record.roomBeanDelta, '0.125');
    assert.equal(record.score, record.roomBeanDelta);
    assert.notEqual(record.score, record.beanBalance);
    assert.equal(Object.hasOwn(record, 'goldNum'), false);
    assert.equal(Object.hasOwn(record, 'changeScore'), false);

    const detail = await app.inject({ method: 'GET', url: `/api/records/${room.id}`, headers });
    assert.equal(detail.statusCode, 200);
    const round = detail.json().rounds[0];
    assert.ok(round);
    assert.equal(Object.hasOwn(round, 'score'), false);
    assert.deepEqual(Object.fromEntries(round.roundBeanDelta.map((posting: { userId: string; amount: string }) => [posting.userId, posting.amount])), {
      [players[0]!.id]: '0.125', [players[1]!.id]: '-0.125',
    });
  } finally { await app.close(); await db.close(); }
});
