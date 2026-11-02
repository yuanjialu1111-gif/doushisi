import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';
import { capLosses } from '../src/confirmed-scores.js';
import { beanUnits } from '../src/money.js';

interface State { players: EnginePlayer[] }

// 只验证结算封顶和豆子不够散桌，不代表任何地方玩法：1 号座位赢，其他人每人输 30 豆。
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'low-balance-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'test-only-low-balance-fixture' },
  create(input) { return { players: input.players } satisfies State; },
  apply(raw) {
    const state = raw as State;
    const losers = state.players.length - 1;
    const settlement = state.players.map((player, index) => ({ userId: player.userId, amount: index === 0 ? String(30 * losers) : '-30' }));
    return { snapshot: state, events: [], confirmedScores: [{ eventId: 'terminal', postings: settlement }], settlement };
  },
  view() { return {}; },
};

async function setup() {
  const db = await openDatabase(); await migrate(db);
  const created = await createApp(db, { staticFiles: false, engines: new EngineRegistry([fixture]), scheduler: false, rateLimit: false });
  const { app, auth, ledger } = created;
  const beans = await auth.create('low_beans_admin', 'test-password-only', 'beans_admin');
  const player = async (username: string, balance: string) => {
    const actor = await auth.create(username, 'test-password-only', 'player', username.slice(-6));
    await ledger.adjust(beans, actor.id, balance, 'low balance fixture funding', `low-credit-${actor.id}`);
    const token = (await auth.login(username, 'test-password-only')).token;
    return { actor, headers: { authorization: `Bearer ${token}` } };
  };
  const close = async () => { await app.close(); await db.close(); };
  return { ...created, db, beans, player, close };
}

const settlementOf = async (ctx: Awaited<ReturnType<typeof setup>>, roundId: string) => Object.fromEntries((await ctx.db.query(
  "SELECT e.user_id,e.amount::text FROM ledger_entries e JOIN ledger_operations o ON o.id=e.operation_id WHERE o.request_key=$1", [`settlement:${roundId}`])).rows
  .map(row => [row.user_id, row.amount]));

test('最多输光身上的豆子：扣不到的由赢家按赢的比例少拿，零头从赢得多的人开始少拿，本来没豆子的不扣', () => {
  const units = (entries: [string, string][]) => new Map(entries.map(([id, value]) => [id, beanUnits(value)]));
  // 一个赢家：b 只有 10，c 够，a 少拿 20。
  assert.deepEqual(capLosses([{ userId: 'a', amount: '60' }, { userId: 'b', amount: '-30' }, { userId: 'c', amount: '-30' }], units([['a', '0'], ['b', '10'], ['c', '100']])),
    [{ userId: 'a', amount: '40' }, { userId: 'b', amount: '-10' }, { userId: 'c', amount: '-30' }]);
  // 两个赢家按 2:1 少拿：差 3 豆，a 少 2、b 少 1。
  assert.deepEqual(capLosses([{ userId: 'a', amount: '4' }, { userId: 'b', amount: '2' }, { userId: 'c', amount: '-6' }], units([['c', '3']])),
    [{ userId: 'a', amount: '2' }, { userId: 'b', amount: '1' }, { userId: 'c', amount: '-3' }]);
  // 除不尽：差 1 个最小单位，赢得多的 a 少拿。
  const [a, b] = capLosses([{ userId: 'a', amount: '2' }, { userId: 'b', amount: '1' }, { userId: 'c', amount: '-3' }], new Map([['c', beanUnits('3') - 1n]]));
  assert.deepEqual([beanUnits(a!.amount), beanUnits(b!.amount)], [beanUnits('2') - 1n, beanUnits('1')]);
  // 已经是负数的不再扣，够输的不动。
  assert.deepEqual(capLosses([{ userId: 'a', amount: '5' }, { userId: 'b', amount: '-5' }], units([['b', '-51']])), [{ userId: 'a', amount: '0' }, { userId: 'b', amount: '0' }]);
  const enough = [{ userId: 'a', amount: '5' }, { userId: 'b', amount: '-5' }];
  assert.equal(capLosses(enough, units([['b', '5']])), enough);
});

test('公开桌打完一局有人豆子低于入座门槛：这局只扣到 0，房间直接散、不开下一场不留座，大家回大厅；回放照样对得上', async t => {
  const ctx = await setup(); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, { variantKey: '4:0', options: { baseBeans: '1', playerNum: 3, gameNum: 4 }, standingEmpty: 1, thresholdMultiplier: 10,
    idleClearMinutes: 10, enabled: true, sortOrder: 1 });
  await ctx.lobby.maintain();
  const [w, poor, rich] = [await ctx.player('low_win', '100'), await ctx.player('low_poor', '20'), await ctx.player('low_rich', '100')];
  const code = (await ctx.db.query("SELECT code FROM rooms WHERE lobby_template_id IS NOT NULL AND state='waiting'")).rows[0]!.code;
  const room = await ctx.rooms.join(w.actor, code);
  await ctx.rooms.join(poor.actor, code);
  await ctx.rooms.join(rich.actor, code);
  await ctx.rooms.ready(w.actor, room.id, true);
  await ctx.rooms.ready(poor.actor, room.id, true);
  const started = await ctx.rooms.ready(rich.actor, room.id, true);
  await ctx.rooms.action(w.actor, room.id, 'low-balance-settle-1', { type: 'settle' }, started.stateVersion!, started.roundId!);

  // 房费 AA 每人 1 豆，poor 剩 19 只输 19，赢家少拿 11。
  assert.deepEqual(await settlementOf(ctx, started.roundId!), { [w.actor.id]: '49', [poor.actor.id]: '-19', [rich.actor.id]: '-30' });
  assert.equal(await ctx.ledger.balance(poor.actor.id), '0');
  const results = (await ctx.db.query('SELECT results FROM rounds WHERE id=$1', [started.roundId])).rows[0]!.results;
  assert.deepEqual(Object.fromEntries(results.map((posting: any) => [posting.userId, posting.amount])), { [w.actor.id]: '49', [poor.actor.id]: '-19', [rich.actor.id]: '-30' });

  // 才打 1 局（共 4 局）就散：没有下一场、没人留座。
  const closed = (await ctx.db.query('SELECT state,current_round FROM rooms WHERE id=$1', [room.id])).rows[0]!;
  assert.deepEqual([closed.state, closed.current_round], ['closed', 1]);
  assert.equal((await ctx.db.query('SELECT COUNT(*)::int AS count FROM rooms WHERE previous_room_id=$1', [room.id])).rows[0]!.count, 0);
  for (const someone of [w, poor, rich]) {
    assert.equal(await ctx.rooms.current(someone.actor.id), null);
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/lobby/hold', headers: someone.headers })).json().hold, null);
  }
  const notice = (await ctx.db.query("SELECT payload FROM game_events WHERE room_id=$1 AND payload->>'type'='room_closed_low_balance'", [room.id])).rows[0]!.payload;
  assert.deepEqual(notice.userIds, [poor.actor.id]);
  assert.equal(notice.message, '「w_poor」豆子不到这桌的 10 豆，房间自动解散，大家回大厅重新找桌。');

  const replay = await ctx.app.inject({ method: 'GET', url: `/api/records/${room.id}/replay/${started.roundId}`, headers: w.headers });
  assert.equal(replay.statusCode, 200, replay.body);
});

test('豆子都够门槛就接着打下一局；私人房没有入座门槛，还有豆子就接着打，有人输光（0 豆）直接散（DEC-20261102-私人房输光散房）', async t => {
  const ctx = await setup(); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, { variantKey: '4:0', options: { baseBeans: '1', playerNum: 2, gameNum: 4 }, standingEmpty: 1, thresholdMultiplier: 10,
    idleClearMinutes: 10, enabled: true, sortOrder: 1 });
  await ctx.lobby.maintain();
  const [a, b] = [await ctx.player('low_ok_a', '100'), await ctx.player('low_ok_b', '100')];
  const code = (await ctx.db.query("SELECT code FROM rooms WHERE lobby_template_id IS NOT NULL AND state='waiting'")).rows[0]!.code;
  const room = await ctx.rooms.join(a.actor, code);
  await ctx.rooms.join(b.actor, code);
  await ctx.rooms.ready(a.actor, room.id, true);
  let started = await ctx.rooms.ready(b.actor, room.id, true);
  await ctx.rooms.action(a.actor, room.id, 'low-ok-settle-1', { type: 'settle' }, started.stateVersion!, started.roundId!);
  // b 剩 69，够 10 豆门槛。
  assert.equal((await ctx.db.query('SELECT state FROM rooms WHERE id=$1', [room.id])).rows[0]!.state, 'between_rounds');

  const [host, guest] = [await ctx.player('low_host', '100'), await ctx.player('low_guest', '10')];
  const own = await ctx.rooms.create(host.actor, '4:0', { baseBeans: '1', playerNum: 2, gameNum: 4, useCardType: 1 });
  await ctx.rooms.join(guest.actor, own.code);
  await ctx.rooms.ready(host.actor, own.id, true);
  started = await ctx.rooms.ready(guest.actor, own.id, true);
  // 房主付房费，guest 只有 10 豆：输 10 到 0，房主只赢 10；输光了下一局开不了，房间直接散。
  await ctx.rooms.action(host.actor, own.id, 'low-own-settle-1', { type: 'settle' }, started.stateVersion!, started.roundId!);
  assert.deepEqual(await settlementOf(ctx, started.roundId!), { [host.actor.id]: '10', [guest.actor.id]: '-10' });
  assert.deepEqual({ ...(await ctx.db.query('SELECT state,current_round FROM rooms WHERE id=$1', [own.id])).rows[0] }, { state: 'closed', current_round: 1 });
  const notice = (await ctx.db.query("SELECT payload FROM game_events WHERE room_id=$1 AND payload->>'type'='room_closed_low_balance'", [own.id])).rows[0]!.payload;
  assert.deepEqual(notice.userIds, [guest.actor.id]);
  assert.equal(notice.message, '「_guest」豆子输光了，下一局开不了，房间自动解散，看完结算回大厅。');
  assert.equal(await ctx.rooms.current(guest.actor.id), null);

  // 私人房输了还剩豆子：照常等下一局。
  const [host2, guest2] = [await ctx.player('low_host2', '100'), await ctx.player('low_guest2', '31')];
  const own2 = await ctx.rooms.create(host2.actor, '4:0', { baseBeans: '1', playerNum: 2, gameNum: 4, useCardType: 1 });
  await ctx.rooms.join(guest2.actor, own2.code);
  await ctx.rooms.ready(host2.actor, own2.id, true);
  started = await ctx.rooms.ready(guest2.actor, own2.id, true);
  await ctx.rooms.action(host2.actor, own2.id, 'low-own2-settle-1', { type: 'settle' }, started.stateVersion!, started.roundId!);
  assert.equal(await ctx.ledger.balance(guest2.actor.id), '1');
  assert.equal((await ctx.db.query('SELECT state FROM rooms WHERE id=$1', [own2.id])).rows[0]!.state, 'between_rounds');
});
