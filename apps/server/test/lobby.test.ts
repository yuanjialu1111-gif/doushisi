import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';
import { createConfiguredEngineRegistry } from '../src/runtime-engines.js';
import { SYSTEM_ACCOUNT_ID } from '../src/rooms.js';

interface State { players: EnginePlayer[] }

// 只验证大厅、补桌、清座和记账，不代表任何地方玩法。每局一个动作就结算。
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'lobby-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'test-only-lobby-fixture' },
  create(input) {
    // 和真引擎一样要求「房主」在座：系统桌房主不入座时要换成 1 号座位。
    assert.ok(input.players.some(player => player.userId === input.ownerUserId), 'owner must be seated');
    return { players: input.players } satisfies State;
  },
  apply(raw) {
    const state = raw as State;
    const settlement = state.players.map((player, index) => ({ userId: player.userId, amount: index === 0 ? '1' : '-1' }));
    return { snapshot: state, events: [], confirmedScores: [{ eventId: 'terminal', postings: settlement }], settlement };
  },
  view() { return {}; },
};

const template = (overrides: Record<string, unknown> = {}) => ({
  variantKey: '4:0', options: { baseBeans: '1', playerNum: 2, gameNum: 4 }, standingEmpty: 2, thresholdMultiplier: 10,
  idleClearMinutes: 10, enabled: true, sortOrder: 1, ...overrides,
});

async function setup(engines: EngineRegistry = new EngineRegistry([fixture]), testDeals = false) {
  const db = await openDatabase(); await migrate(db);
  const created = await createApp(db, { staticFiles: false, engines, scheduler: false, rateLimit: false, testDeals });
  const { app, auth, ledger } = created;
  const beans = await auth.create('lobby_beans_admin', 'test-password-only', 'beans_admin');
  const beansHeaders = { authorization: `Bearer ${(await auth.login(beans.username, 'test-password-only', true)).token}` };
  const player = async (username: string, balance: string) => {
    const actor = await auth.create(username, 'test-password-only', 'player', username.slice(-6));
    if (balance !== '0') await ledger.adjust(beans, actor.id, balance, 'lobby fixture funding', `lobby-credit-${actor.id}`);
    const token = (await auth.login(username, 'test-password-only')).token;
    return { actor, headers: { authorization: `Bearer ${token}` } };
  };
  const close = async () => { await app.close(); await db.close(); };
  return { ...created, db, beans, beansHeaders, player, close };
}

const tablesOf = async (ctx: Awaited<ReturnType<typeof setup>>, headers: Record<string, string>, query = '') => {
  const response = await ctx.app.inject({ method: 'GET', url: `/api/lobby/tables${query}`, headers });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
};

test('R2/R1/R5: templates keep standing empty system tables, the lobby lists only public tables, and the threshold says how much is missing', async t => {
  const ctx = await setup(); t.after(ctx.close);
  const saved = await ctx.app.inject({ method: 'POST', url: '/api/admin/lobby-templates', headers: ctx.beansHeaders, payload: template() });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json().summary, { baseBeans: '1', playerNum: 2, rounds: 4 });

  await ctx.lobby.maintain();
  const rich = await ctx.player('lobby_rich_a', '100');
  let listing = await tablesOf(ctx, rich.headers);
  assert.equal(listing.tables.length, 2);
  assert.ok(listing.tables.every((table: any) => table.system && table.seats.length === 0 && table.threshold === '10' && table.state === 'waiting'));
  assert.deepEqual(listing.variants, [{ key: '4:0', name: '四川斗十四' }]);
  const systemRooms = (await ctx.db.query("SELECT owner_id,fee_mode FROM rooms WHERE lobby_template_id IS NOT NULL")).rows;
  assert.ok(systemRooms.every(room => room.owner_id === SYSTEM_ACCOUNT_ID && room.fee_mode === 'aa'));
  // 系统房主不在任何一桌的座位上。
  assert.equal((await ctx.db.query('SELECT COUNT(*)::int AS count FROM room_members WHERE user_id=$1', [SYSTEM_ACCOUNT_ID])).rows[0]!.count, 0);

  // R1 AC3：没勾公开的玩家房在大厅里看不到；R3/R5 AC1：公开的玩家房出现，并且强制 AA。
  const host = await ctx.player('lobby_private_host', '100');
  await ctx.rooms.create(host.actor, '4:0', { baseBeans: '3', playerNum: 2, gameNum: 4, useCardType: 1 });
  const publicHost = await ctx.player('lobby_public_host', '100');
  const publicRoom = await ctx.rooms.create(publicHost.actor, '4:0', { baseBeans: '2', playerNum: 2, gameNum: 4, useCardType: 1 }, undefined, 'public');
  assert.equal(publicRoom.feeMode, 'aa');
  assert.equal(publicRoom.rules.useCardType, 2);
  listing = await tablesOf(ctx, rich.headers);
  assert.equal(listing.tables.length, 3);
  const listedPublic = listing.tables.find((table: any) => table.code === publicRoom.code);
  assert.equal(listedPublic.system, false);
  assert.equal(listedPublic.threshold, '20');
  assert.deepEqual(listedPublic.seats.map((seat: any) => seat.nickname), ['c_host']);
  assert.match(listedPublic.seats[0].avatarUrl, /default-avatar/);
  // 有人的桌排在空桌前面。
  assert.equal(listing.tables[0].code, publicRoom.code);

  // R1 AC1：版本没变只回「没变」；有人坐下后版本变化，新的人和头像出现。
  const unchanged = await tablesOf(ctx, rich.headers, `?since=${listing.version}`);
  assert.deepEqual(unchanged, { version: listing.version, unchanged: true });
  const emptyCode = listing.tables.find((table: any) => table.system).code;
  await ctx.rooms.join(rich.actor, emptyCode);
  const changed = await tablesOf(ctx, rich.headers, `?since=${listing.version}`);
  assert.notEqual(changed.version, listing.version);
  assert.deepEqual(changed.tables.find((table: any) => table.code === emptyCode).seats.map((seat: any) => seat.seat), [1]);

  // R1 AC2：按玩法筛，没有桌子的玩法回空列表。
  assert.deepEqual((await tablesOf(ctx, rich.headers, '?variant=5:0')).tables, []);

  // R2 AC1：一张空桌被坐了，补桌后又有 2 张空桌。
  await ctx.lobby.maintain();
  listing = await tablesOf(ctx, rich.headers);
  assert.equal(listing.tables.filter((table: any) => table.system && table.seats.length === 0).length, 2);

  // R5 AC2：豆子不足门槛，入座被拒并提示还差多少。
  const poor = await ctx.player('lobby_poor', '4.5');
  const refused = await ctx.app.inject({ method: 'POST', url: '/api/rooms/join', headers: poor.headers, payload: { code: emptyCode } });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().error.code, 'BELOW_THRESHOLD');
  assert.equal(refused.json().error.message, '豆子不足：这桌至少要 10 豆，你还差 5.5 豆。');
  // 门槛只管公开桌，输房号进私人房照旧。
  const privateCode = (await ctx.db.query("SELECT code FROM rooms WHERE visibility='private'")).rows[0]!.code;
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/rooms/join', headers: poor.headers, payload: { code: privateCode } })).statusCode, 200);

  // R2 AC2：开局前离开，系统桌不关，只空出座位。
  const roomId = (await ctx.db.query('SELECT id FROM rooms WHERE code=$1', [emptyCode])).rows[0]!.id;
  await ctx.rooms.leave(rich.actor, roomId);
  assert.equal((await ctx.db.query('SELECT state FROM rooms WHERE id=$1', [roomId])).rows[0]!.state, 'waiting');
  // 又多出一张空桌，补桌把多的关掉，仍是 2 张。
  await ctx.lobby.maintain();
  listing = await tablesOf(ctx, rich.headers);
  assert.equal(listing.tables.filter((table: any) => table.system && table.seats.length === 0).length, 2);
});

test('第三轮 R5：一场打完同桌号开下一场，留座 15 秒，点继续认领座位、到时没点空出来，每场各扣一次 AA', async t => {
  const ctx = await setup(); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 1 }));
  await ctx.lobby.maintain();
  const [a, b] = [await ctx.player('lobby_round_a', '50'), await ctx.player('lobby_round_b', '50')];
  const code = (await tablesOf(ctx, a.headers)).tables[0].code;
  const joined = await ctx.rooms.join(a.actor, code);
  await ctx.rooms.join(b.actor, code);
  for (let round = 1; round <= 4; round++) {
    await ctx.rooms.ready(a.actor, joined.id, true);
    const started = await ctx.rooms.ready(b.actor, joined.id, true);
    assert.equal(started.currentRound, round);
    await ctx.rooms.action(a.actor, joined.id, `lobby-settle-${round}`, { type: 'settle' }, started.stateVersion!, started.roundId!);
  }
  assert.equal((await ctx.db.query('SELECT state FROM rooms WHERE id=$1', [joined.id])).rows[0]!.state, 'closed');
  // AA：4 局房费每人 1 豆，只扣一次。
  const feesOf = async (roomId: string) => (await ctx.db.query("SELECT e.amount::text FROM ledger_entries e JOIN ledger_operations o ON o.id=e.operation_id WHERE o.kind='room_fee' AND o.room_id=$1", [roomId])).rows.map(fee => fee.amount).sort();
  assert.deepEqual(await feesOf(joined.id), ['-1', '-1']);

  // 下一场：同桌号、第 2 场，两人的座位都留着，还算不上「在桌上」。
  const next = (await ctx.db.query("SELECT id,match_seq,previous_room_id FROM rooms WHERE code=$1 AND state <> 'closed'", [code])).rows[0]!;
  assert.deepEqual([next.match_seq, next.previous_room_id], [2, joined.id]);
  assert.equal((await ctx.db.query('SELECT COUNT(*)::int AS count FROM room_members WHERE room_id=$1 AND hold_until IS NOT NULL', [next.id])).rows[0]!.count, 2);
  assert.equal(await ctx.rooms.current(a.actor.id), null);
  const hold = (await ctx.app.inject({ method: 'GET', url: '/api/lobby/hold', headers: a.headers })).json().hold;
  assert.equal(hold.code, code); assert.equal(hold.matchSeq, 2); assert.equal(hold.enough, true);
  assert.ok(hold.seconds >= 14 && hold.seconds <= 17, String(hold.seconds));
  let listing = await tablesOf(ctx, a.headers);
  assert.equal(listing.tables.find((table: any) => table.code === code).matchSeq, 2);

  // a 点继续：座位不变；b 没点，到时空出来。
  const seatOf = async (userId: string) => (await ctx.db.query('SELECT seat FROM room_members WHERE room_id=$1 AND user_id=$2', [next.id, userId])).rows[0]?.seat;
  const seatA = await seatOf(a.actor.id);
  await ctx.rooms.join(a.actor, code);
  assert.equal(await seatOf(a.actor.id), seatA);
  assert.equal((await ctx.rooms.current(a.actor.id))!.id, next.id);
  await ctx.db.query("UPDATE room_members SET hold_until=now()-interval '1 second' WHERE user_id=$1", [b.actor.id]);
  await ctx.lobby.maintain();
  assert.equal(await seatOf(b.actor.id), undefined);
  listing = await tablesOf(ctx, a.headers);
  assert.equal(listing.tables.find((table: any) => table.code === code).seats.length, 1);
  // 有人坐的桌排在空桌前面；带上我的豆子给客户端比门槛。
  assert.equal(listing.tables[0].code, code);
  assert.match(listing.beans, /^\d+(\.\d+)?$/);

  // 别人补进来就开第 2 场，第 2 场再扣一次 AA。
  const c = await ctx.player('lobby_round_c', '50');
  await ctx.rooms.join(c.actor, code);
  await ctx.rooms.ready(a.actor, next.id, true);
  assert.equal((await ctx.rooms.ready(c.actor, next.id, true)).currentRound, 1);
  assert.deepEqual(await feesOf(next.id), ['-1', '-1']);
});

test('第三轮 R5 AC2/AC3：打完一局有人豆子不够门槛整桌散、不留座，回大厅也坐不下；留座的人主动离开、全走光桌子变回空桌', async t => {
  const ctx = await setup(); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 1 }));
  await ctx.lobby.maintain();
  const [a, b] = [await ctx.player('lobby_poor_a', '11'), await ctx.player('lobby_poor_b', '50')];
  let code = (await tablesOf(ctx, a.headers)).tables[0].code;
  // b 坐 1 号（夹具里 1 号每局赢 1 豆），a 交 1 豆房费再输 1 局剩 9 豆，不够 10 豆门槛：4 局才打 1 局就散。
  await ctx.rooms.join(b.actor, code);
  const room = await ctx.rooms.join(a.actor, code);
  await ctx.rooms.ready(a.actor, room.id, true);
  const first = await ctx.rooms.ready(b.actor, room.id, true);
  await ctx.rooms.action(a.actor, room.id, 'lobby-poor-settle-1', { type: 'settle' }, first.stateVersion!, first.roundId!);
  assert.equal(await ctx.ledger.balance(a.actor.id), '9');
  assert.deepEqual(Object.values((await ctx.db.query('SELECT state,current_round FROM rooms WHERE id=$1', [room.id])).rows[0]!), ['closed', 1]);
  for (const someone of [a, b]) assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/lobby/hold', headers: someone.headers })).json().hold, null);
  await ctx.lobby.maintain();
  await assert.rejects(ctx.rooms.join(a.actor, (await tablesOf(ctx, a.headers)).tables[0].code), (error: any) => error.code === 'BELOW_THRESHOLD');

  // 豆子都够的两人打满 4 局，下一场留座；两人都点离开，桌子变回空桌。
  const [c, d] = [await ctx.player('lobby_full_c', '50'), await ctx.player('lobby_full_d', '50')];
  code = (await tablesOf(ctx, c.headers)).tables[0].code;
  const full = await ctx.rooms.join(c.actor, code);
  await ctx.rooms.join(d.actor, code);
  for (let round = 1; round <= 4; round++) {
    await ctx.rooms.ready(c.actor, full.id, true);
    const started = await ctx.rooms.ready(d.actor, full.id, true);
    await ctx.rooms.action(c.actor, full.id, `lobby-full-settle-${round}`, { type: 'settle' }, started.stateVersion!, started.roundId!);
  }
  const released = await ctx.app.inject({ method: 'POST', url: '/api/lobby/hold/release', headers: c.headers });
  assert.deepEqual(released.json(), { released: 1 });
  assert.deepEqual((await ctx.app.inject({ method: 'POST', url: '/api/lobby/hold/release', headers: d.headers })).json(), { released: 1 });
  await ctx.lobby.maintain();
  const listing = await tablesOf(ctx, d.headers);
  assert.equal(listing.tables.length, 1);
  assert.deepEqual([listing.tables[0].code, listing.tables[0].seats.length, listing.tables[0].matchSeq], [code, 0, 2]);
});

test('第三轮 R3：点哪个空位坐哪个，同一个座位只有一人坐上，另一人提示已被坐', async t => {
  const ctx = await setup(); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 1, options: { baseBeans: '1', playerNum: 4, gameNum: 4 } }));
  await ctx.lobby.maintain();
  const [a, b, poor] = [await ctx.player('lobby_sit_a', '50'), await ctx.player('lobby_sit_b', '50'), await ctx.player('lobby_sit_poor', '3')];
  const code = (await tablesOf(ctx, a.headers)).tables[0].code;
  const sit = (headers: Record<string, string>, seat: number) => ctx.app.inject({ method: 'POST', url: '/api/lobby/sit', headers, payload: { code, seat } });
  const [first, second] = await Promise.all([sit(a.headers, 3), sit(b.headers, 3)]);
  const codes = [first.statusCode, second.statusCode].sort();
  assert.deepEqual(codes, [200, 409]);
  const loser = first.statusCode === 409 ? first : second;
  assert.equal(loser.json().error.code, 'SEAT_TAKEN');
  assert.equal(loser.json().error.message, '这个座位刚被人坐了，换一个吧。');
  const seats = (await tablesOf(ctx, a.headers)).tables[0].seats;
  assert.deepEqual(seats.map((seat: any) => seat.seat), [3]);
  const below = await sit(poor.headers, 1);
  assert.equal(below.json().error.code, 'BELOW_THRESHOLD');
  assert.match(below.json().error.message, /还差 7 豆/);
  assert.equal((await sit(first.statusCode === 409 ? a.headers : b.headers, 5)).statusCode, 400);
});

test('第三轮 R1/R2：只留大厅时玩家开房、输房号、好友私聊都回不支持', async t => {
  const db = await openDatabase(); await migrate(db);
  const created = await createApp(db, { staticFiles: false, engines: new EngineRegistry([fixture]), scheduler: false, rateLimit: false, lobbyOnly: true });
  t.after(async () => { await created.app.close(); await db.close(); });
  await created.auth.create('lobby_only_player', 'test-password-only', 'player');
  const headers = { authorization: `Bearer ${(await created.auth.login('lobby_only_player', 'test-password-only')).token}` };
  for (const [method, url, payload] of [['POST', '/api/rooms', { variantKey: '4:0', options: {} }], ['POST', '/api/rooms/join', { code: '123456' }],
    ['GET', '/api/social/friends'], ['GET', '/api/social/pulse'], ['GET', '/api/friends']] as const) {
    const response = await created.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
    assert.equal(response.statusCode, 410, url);
    assert.equal(response.json().error.code, 'UNSUPPORTED_OPERATION');
  }
  assert.equal((await created.app.inject({ method: 'GET', url: '/api/lobby/tables', headers })).statusCode, 200);
});

test('R2 AC4: a seat idle past the limit is cleared without charging beans and the player is told', async t => {
  const ctx = await setup(); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 1, idleClearMinutes: 10 }));
  await ctx.lobby.maintain();
  const sitter = await ctx.player('lobby_idle_sitter', '50');
  const code = (await tablesOf(ctx, sitter.headers)).tables[0].code;
  const room = await ctx.rooms.join(sitter.actor, code);
  const notices: unknown[] = [];
  ctx.rooms.on('seatCleared', event => notices.push(event));
  await ctx.db.query("UPDATE room_members SET joined_at=now()-interval '9 minutes' WHERE user_id=$1", [sitter.actor.id]);
  await ctx.lobby.maintain();
  assert.equal(notices.length, 0, 'not cleared before the limit');
  await ctx.db.query("UPDATE room_members SET joined_at=now()-interval '11 minutes' WHERE user_id=$1", [sitter.actor.id]);
  await ctx.lobby.maintain();
  assert.deepEqual(notices, [{ roomId: room.id, userId: sitter.actor.id, idleMinutes: 10 }]);
  assert.equal(await ctx.rooms.current(sitter.actor.id), null);
  assert.equal(await ctx.ledger.balance(sitter.actor.id), '50');
  assert.equal((await ctx.db.query("SELECT COUNT(*)::int AS count FROM audit_events WHERE kind='lobby_seat_cleared' AND user_id=$1", [sitter.actor.id])).rows[0]!.count, 1);
  assert.equal((await ctx.db.query('SELECT state FROM rooms WHERE id=$1', [room.id])).rows[0]!.state, 'waiting');
});

test('R2 AC2: leaving a system table before play keeps it open, and a dissolve vote cannot close it', async t => {
  const ctx = await setup(); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 1 }));
  await ctx.lobby.maintain();
  const sitter = await ctx.player('lobby_leave_sitter', '50');
  const code = (await tablesOf(ctx, sitter.headers)).tables[0].code;
  const room = await ctx.rooms.join(sitter.actor, code);
  await assert.rejects(ctx.rooms.dissolve(sitter.actor, room.id, true), (error: any) => error.code === 'SYSTEM_ROOM_LEAVE');
  await ctx.rooms.leave(sitter.actor, room.id);
  assert.equal(await ctx.rooms.current(sitter.actor.id), null);
  assert.equal((await ctx.db.query('SELECT state FROM rooms WHERE id=$1', [room.id])).rows[0]!.state, 'waiting');
  assert.deepEqual((await tablesOf(ctx, sitter.headers)).tables.map((table: any) => table.code), [code]);
});

test('R4: quick start joins the fullest affordable table, opens one from a template when none fits, and refuses when no tier is affordable', async t => {
  const ctx = await setup(); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 2, options: { baseBeans: '1', playerNum: 3, gameNum: 4 } }));
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 0, sortOrder: 2, options: { baseBeans: '5', playerNum: 3, gameNum: 4 } }));
  await ctx.lobby.maintain();
  const first = await ctx.player('lobby_quick_first', '100');
  const codes = (await tablesOf(ctx, first.headers)).tables.map((table: any) => table.code);
  await ctx.rooms.join(first.actor, codes[1]);

  // AC1：人最多的桌优先。
  const second = await ctx.player('lobby_quick_second', '100');
  const quick = await ctx.app.inject({ method: 'POST', url: '/api/lobby/quick-start', headers: second.headers, payload: { variant: '4:0' } });
  assert.equal(quick.statusCode, 200, quick.body);
  assert.deepEqual(quick.json(), { code: codes[1], joined: true });
  // 已经在桌上再点：回原桌。
  assert.deepEqual((await ctx.app.inject({ method: 'POST', url: '/api/lobby/quick-start', headers: second.headers, payload: {} })).json(), { code: codes[1], joined: false });

  // AC2：豆子哪一档都不够，提示豆子不足，不入座。
  const poor = await ctx.player('lobby_quick_poor', '3');
  const refused = await ctx.app.inject({ method: 'POST', url: '/api/lobby/quick-start', headers: poor.headers, payload: { variant: '4:0' } });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().error.code, 'BELOW_THRESHOLD');
  assert.match(refused.json().error.message, /^豆子不足：这个玩法最少要 10 豆才能入座，你还差 7 豆。$/);
  assert.equal(await ctx.rooms.current(poor.actor.id), null);

  // AC2：没有合适的桌就按模板开一张。把 1 豆档停用并把桌坐满，只剩 5 豆档（常驻 0 张）。
  await ctx.db.query("UPDATE lobby_templates SET enabled=false WHERE options->>'baseBeans'='1'");
  const third = await ctx.player('lobby_quick_third', '100');
  await ctx.rooms.join(third.actor, codes[1]);
  await ctx.lobby.maintain();
  const rich = await ctx.player('lobby_quick_rich', '100');
  const opened = (await ctx.app.inject({ method: 'POST', url: '/api/lobby/quick-start', headers: rich.headers, payload: { variant: '4:0' } })).json();
  assert.equal(opened.joined, true);
  const room = (await ctx.rooms.current(rich.actor.id))!;
  assert.equal(room.code, opened.code);
  // AC3：桌上的底分就是模板底分，结算用同一个值。
  assert.equal(room.baseBeans, '5');
  assert.equal(room.ownerId, SYSTEM_ACCOUNT_ID);

  // 不存在大厅桌的玩法。
  const none = await ctx.app.inject({ method: 'POST', url: '/api/lobby/quick-start', headers: poor.headers, payload: { variant: '5:0' } });
  assert.equal(none.json().error.code, 'LOBBY_EMPTY');
});

test('admin templates: Chinese validation messages, not-found code, role check, and rule changes replace untouched empty tables', async t => {
  const ctx = await setup(); t.after(ctx.close);
  const post = (payload: unknown, headers = ctx.beansHeaders) => ctx.app.inject({ method: 'POST', url: '/api/admin/lobby-templates', headers, payload });
  const bad = await post(template({ standingEmpty: 21 }));
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(bad.json().error, { code: 'INVALID_TEMPLATE', message: '常驻空桌要在 0–20 张之间。' });
  const noBase = await post(template({ options: { playerNum: 2, gameNum: 4 } }));
  assert.equal(noBase.json().error.message, '这个玩法要填正数底分；需要选人数的还要选 2、3 或 4 人。');
  // 第二轮只留新津（S1-AC5）：其他玩法先挡在「不显示」这一步。
  const notPlayable = await post(template({ variantKey: '5:0' }));
  assert.equal(notPlayable.json().error.code, 'VARIANT_HIDDEN');
  const missing = await ctx.app.inject({ method: 'PUT', url: '/api/admin/lobby-templates/00000000-0000-4000-8000-00000000abcd', headers: ctx.beansHeaders, payload: template() });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'TEMPLATE_NOT_FOUND');
  const deal = await ctx.auth.create('lobby_deal_admin', 'test-password-only', 'deal_admin');
  const dealHeaders = { authorization: `Bearer ${(await ctx.auth.login(deal.username, 'test-password-only', true)).token}` };
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/admin/lobby-templates', headers: dealHeaders })).statusCode, 403);

  const saved = (await post(template())).json();
  await ctx.lobby.maintain();
  const before = (await ctx.db.query("SELECT code FROM rooms WHERE state='waiting'")).rows.map(row => row.code).sort();
  const list = (await ctx.app.inject({ method: 'GET', url: '/api/admin/lobby-templates', headers: ctx.beansHeaders })).json();
  assert.deepEqual(list.templates.map((entry: any) => [entry.openTables, entry.seatedPlayers]), [[2, 0]]);
  assert.deepEqual(list.variants.map((variant: any) => variant.key), ['4:0']);
  assert.equal(list.variants[0].needsBaseBeans, true);
  // 后台表单只给人数、局数、王数三个中文单选，房费和 v2 固定玩法不给改（DEC-20261102-模板中文表单）。
  assert.deepEqual(list.variants[0].choices.map((choice: any) => [choice.label, choice.values.map((item: any) => item.label)]), [
    ['局数', ['4 局', '8 局', '12 局']], ['人数', ['2 人', '3 人', '4 人']], ['王数', ['3 个王', '5 个王', '6 个王', '9 个王']],
    ['翻法', ['跟斗翻', '梯坎翻']], ['封顶', ['不封顶', '3 番封顶', '4 番封顶', '5 番封顶']]]);
  assert.match(list.variants[0].fixedRules, /点炮包赔.*公开桌房费 AA/);
  assert.doesNotMatch(list.variants[0].fixedRules, /跟斗翻|不封顶/);
  const updated = await ctx.app.inject({ method: 'PUT', url: `/api/admin/lobby-templates/${saved.id}`, headers: ctx.beansHeaders,
    payload: template({ options: { baseBeans: '2', playerNum: 2, gameNum: 4 } }) });
  assert.equal(updated.statusCode, 200, updated.body);
  // 保存回来就已按新规则补好，后台列表不用等下一轮。
  assert.equal(updated.json().openTables, 2);
  await ctx.lobby.maintain();
  const after = (await ctx.db.query("SELECT code,rules->>'baseBeans' AS base FROM rooms WHERE state='waiting'")).rows;
  assert.equal(after.length, 2);
  assert.ok(after.every(row => row.base === '2' && !before.includes(row.code)));
  assert.equal((await ctx.db.query("SELECT COUNT(*)::int AS count FROM audit_events WHERE kind='lobby_template_saved'")).rows[0]!.count, 2);

  // 停用模板：空桌收掉，大厅里不再有它。
  await ctx.lobby.updateTemplate(ctx.beans, saved.id, template({ enabled: false }));
  await ctx.lobby.maintain();
  const player = await ctx.player('lobby_after_disable', '10');
  assert.deepEqual((await tablesOf(ctx, player.headers)).tables, []);
});

test('R10: nearby shows only bands and ranks for occupied tables, and nothing for players without a location', async t => {
  const ctx = await setup(); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 1 }));
  const [near, far, viewer, hidden] = [await ctx.player('lobby_geo_near', '50'), await ctx.player('lobby_geo_far', '50'),
    await ctx.player('lobby_geo_viewer', '50'), await ctx.player('lobby_geo_hidden', '50')];
  const nearRoom = await ctx.rooms.create(near.actor, '4:0', { baseBeans: '1', playerNum: 2, gameNum: 4 }, undefined, 'public');
  const farRoom = await ctx.rooms.create(far.actor, '4:0', { baseBeans: '1', playerNum: 2, gameNum: 4 }, undefined, 'public');
  await ctx.lobby.maintain();
  const locate = (headers: Record<string, string>, lat: number, lon: number) => ctx.app.inject({ method: 'POST', url: '/api/me/location', headers, payload: { lat, lon } });
  assert.equal((await locate(viewer.headers, 30.4, 103.82)).statusCode, 200);
  await locate(near.headers, 30.404, 103.82); // 约 0.45 公里
  await locate(far.headers, 30.67, 104.06); // 约 38 公里
  const listing = await tablesOf(ctx, viewer.headers);
  assert.equal(listing.hasLocation, true);
  const byCode = Object.fromEntries(listing.tables.map((table: any) => [table.code, table]));
  assert.deepEqual(byCode[nearRoom.code].nearby, { band: '1 公里内', rank: 1 });
  assert.deepEqual(byCode[farRoom.code].nearby, { band: '同城', rank: 2 });
  // 空桌不进附近；回包里没有米数和坐标。
  assert.ok(listing.tables.filter((table: any) => table.seats.length === 0).every((table: any) => table.nearby === undefined));
  assert.doesNotMatch(JSON.stringify(listing), /"lat"|"lon"|latitude|longitude|distance|30\.4|103\.8|km|米/);
  // 没给位置的人照常看全部，没有附近。
  const plain = await tablesOf(ctx, hidden.headers);
  assert.equal(plain.hasLocation, false);
  assert.equal(plain.tables.length, 3);
  assert.ok(plain.tables.every((table: any) => table.nearby === undefined));
  // 位置只能放请求体，坐标不合法被拒。
  assert.equal((await locate(viewer.headers, 91, 0)).statusCode, 400);
});

test('R2: a system table seated by four players starts its first round with the real engine although the system owner is not seated', async t => {
  const ctx = await setup(createConfiguredEngineRegistry()); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 1, options: { baseBeans: '1', playerNum: 4, gameNum: 8 } }));
  await ctx.lobby.maintain();
  const players = [];
  for (const name of ['a', 'b', 'c', 'd']) players.push(await ctx.player(`lobby_real_${name}`, '50'));
  const code = (await tablesOf(ctx, players[0]!.headers)).tables[0].code;
  let room;
  for (const player of players) room = await ctx.rooms.join(player.actor, code);
  for (const player of players) room = await ctx.rooms.ready(player.actor, room!.id, true);
  assert.equal(room!.state, 'playing');
  assert.equal(room!.currentRound, 1);
});

test('本机测试台：指定牌局只在打开时有；按场景发牌、请求的人当庄，只用一局', async t => {
  const closed = await setup(createConfiguredEngineRegistry()); t.after(closed.close);
  const outsider = await closed.player('lobby_dev_closed', '50');
  assert.equal((await closed.app.inject({ method: 'GET', url: '/api/dev/scenarios', headers: outsider.headers })).statusCode, 404);

  const ctx = await setup(createConfiguredEngineRegistry(), true); t.after(ctx.close);
  await ctx.lobby.createTemplate(ctx.beans, template({ standingEmpty: 1, options: { baseBeans: '1', playerNum: 4, gameNum: 8 } }));
  await ctx.lobby.maintain();
  const players = [];
  for (const name of ['a', 'b', 'c', 'd']) players.push(await ctx.player(`lobby_dev_${name}`, '50'));
  const listed = (await ctx.app.inject({ method: 'GET', url: '/api/dev/scenarios', headers: players[0]!.headers })).json();
  assert.equal(listed.length, 33);
  const code = (await tablesOf(ctx, players[0]!.headers)).tables[0].code;
  let room;
  for (const player of players) room = await ctx.rooms.join(player.actor, code);
  const deal = (headers: Record<string, string>, scenario: string) =>
    ctx.app.inject({ method: 'POST', url: '/api/dev/test-deal', headers, payload: { roomId: room!.id, scenario } });
  assert.equal((await deal(players[0]!.headers, 'nope')).statusCode, 404);
  assert.equal((await deal(outsider.headers, 'tianHu')).statusCode, 401);
  // 4 号请求、再由 1 号覆盖：庄家是最后请求的人。
  assert.equal((await deal(players[3]!.headers, 'diHu')).statusCode, 200);
  assert.equal((await deal(players[0]!.headers, 'tianHu')).statusCode, 200);
  for (const player of players) room = await ctx.rooms.ready(player.actor, room!.id, true);
  assert.equal(room!.state, 'playing');
  const snapshot = (await ctx.db.query("SELECT snapshot FROM rounds WHERE room_id=$1 AND state='playing'", [room!.id])).rows[0]!.snapshot;
  assert.equal(snapshot.dealerId, players[0]!.actor.id);
  const faces = (zone: string) => snapshot.cards.zones.find((item: any) => item.id === zone).cards
    .map((id: string) => snapshot.cards.pack.find((card: any) => card.id === id).code).sort();
  assert.deepEqual(faces(`hand:${players[0]!.actor.id}`), [101, 102, 103, 110, 213, 304, 311, 412]);
  assert.equal(ctx.rooms.testDeals.size, 0);
  assert.equal((await deal(players[0]!.headers, 'tianHu')).json().error.code, 'INVALID_ROOM_STATE');
});

test('S2-AC2 S2-AC3 大厅每个座位带昵称、性别、数字 ID；每张有人且有定位的桌都带档位，不带米数', async t => {
  const ctx = await setup(); t.after(ctx.close);
  const [girl, plain, viewer] = [await ctx.player('lobby_a2_girl', '50'), await ctx.player('lobby_a2_plain', '50'), await ctx.player('lobby_a2_viewer', '50')];
  // 原版客户端登录时分到数字 ID；这里直接写一条，和协议层登录的效果一样。
  await ctx.db.query("INSERT INTO original_protocol_ids(entity_kind,entity_id) VALUES('user',$1)", [girl.actor.id]);
  const uid = String((await ctx.db.query("SELECT wire_id FROM original_protocol_ids WHERE entity_kind='user' AND entity_id=$1", [girl.actor.id])).rows[0]!.wire_id);
  await ctx.db.query('UPDATE accounts SET sex=2 WHERE id=$1', [girl.actor.id]);
  const girlRoom = await ctx.rooms.create(girl.actor, '4:0', { baseBeans: '1', playerNum: 4, gameNum: 8 }, undefined, 'public');
  const plainRoom = await ctx.rooms.create(plain.actor, '4:0', { baseBeans: '2', playerNum: 4, gameNum: 8 }, undefined, 'public');
  const locate = (headers: Record<string, string>, lat: number, lon: number) => ctx.app.inject({ method: 'POST', url: '/api/me/location', headers, payload: { lat, lon } });
  await locate(viewer.headers, 30.4, 103.82);
  await locate(girl.headers, 30.43, 103.82); // 约 3.3 公里
  const byCode = Object.fromEntries((await tablesOf(ctx, viewer.headers)).tables.map((table: any) => [table.code, table]));
  assert.deepEqual(byCode[girlRoom.code].seats.map((seat: any) => [seat.nickname, seat.sex, seat.uid]), [[girl.actor.nickname, 2, uid]]);
  assert.match(uid, /^\d{6,}$/);
  assert.equal(byCode[girlRoom.code].nearby.band, '5 公里内');
  // 没设性别、还没进过游戏的人：性别 0、ID 空；桌上没人报位置就没有档位。
  assert.deepEqual(byCode[plainRoom.code].seats.map((seat: any) => [seat.sex, seat.uid]), [[0, null]]);
  assert.equal(byCode[plainRoom.code].nearby, undefined);
});

test('第三轮规则 v2：发布前开的新津空桌（v1）被收掉，按 v2 补开', async t => {
  const ctx = await setup(); t.after(ctx.close);
  const saved = await ctx.app.inject({ method: 'POST', url: '/api/admin/lobby-templates', headers: ctx.beansHeaders, payload: template() });
  assert.equal(saved.statusCode, 200, saved.body);
  await ctx.lobby.maintain();
  const rooms = async () => (await ctx.db.query("SELECT id,rules->'xinjin'->>'scoring' AS scoring FROM rooms WHERE state='waiting' ORDER BY created_at")).rows;
  const before = await rooms();
  assert.deepEqual(before.map(room => room.scoring), ['v2', 'v2']);
  await ctx.db.query("UPDATE rooms SET rules = rules #- '{xinjin,scoring}' WHERE id=$1", [before[0].id]);
  await ctx.lobby.maintain();
  const after = await rooms();
  assert.equal(after.length, 2);
  assert.ok(after.every(room => room.scoring === 'v2'));
  assert.ok(!after.some(room => room.id === before[0].id));
  // v2 的固定玩法后来改过（11-01 开了自己翻牌自己吃）：之前开的空桌也换掉。
  await ctx.db.query("UPDATE rooms SET rules = jsonb_set(rules, '{ziChi}', '0') WHERE id=$1", [after[0].id]);
  await ctx.lobby.maintain();
  const latest = await ctx.db.query("SELECT id,rules->>'ziChi' AS zi FROM rooms WHERE state='waiting'");
  assert.equal(latest.rows.length, 2);
  assert.ok(latest.rows.every(room => room.zi === '1' && room.id !== after[0].id));
});

test('翻法、封顶每张桌自己选：模板选了梯坎翻 4 番封顶，开出的桌照这个算、大厅显示王数和翻法；改了换桌；不在可选里报错（DEC-20261108-翻法封顶每桌选）', async t => {
  const ctx = await setup(); t.after(ctx.close);
  const post = (payload: unknown) => ctx.app.inject({ method: 'POST', url: '/api/admin/lobby-templates', headers: ctx.beansHeaders, payload });
  for (const bad of [{ maxFan: 6 }, { maxFan: 99, chengFan: 2 }]) {
    const refused = await post(template({ options: { baseBeans: '1', playerNum: 2, gameNum: 4, ...bad } }));
    assert.equal(refused.statusCode, 400, refused.body);
    assert.equal(refused.json().error.code, 'INVALID_TEMPLATE');
  }
  const saved = await post(template({ options: { baseBeans: '1', playerNum: 2, gameNum: 4, wangNum: 5, chengFan: 0, maxFan: 4 } }));
  assert.equal(saved.statusCode, 200, saved.body);
  await ctx.lobby.maintain();
  const rules = async () => (await ctx.db.query("SELECT id,(rules->>'chengFan')::int AS flip,(rules->>'maxFan')::int AS cap FROM rooms WHERE state='waiting' ORDER BY created_at")).rows;
  const first = await rules();
  assert.deepEqual(first.map(room => [room.flip, room.cap]), [[0, 4], [0, 4]]);
  const player = await ctx.player('lobby_fan_text', '10');
  const listed = (await tablesOf(ctx, player.headers)).tables;
  assert.deepEqual(listed.map((table: any) => [table.wangNum, table.fanText]), [[5, '梯坎翻、4 番封顶'], [5, '梯坎翻、4 番封顶']]);
  // 改回默认（不带这两项）：空桌换成跟斗翻、不封顶。
  await ctx.lobby.updateTemplate(ctx.beans, saved.json().id, template({ options: { baseBeans: '1', playerNum: 2, gameNum: 4, wangNum: 5 } }));
  await ctx.lobby.maintain();
  const second = await rules();
  assert.deepEqual(second.map(room => [room.flip, room.cap]), [[1, 99], [1, 99]]);
  assert.ok(!second.some(room => first.some(old => old.id === room.id)));
  // 没改的桌下一轮不再换。
  await ctx.lobby.maintain();
  assert.deepEqual((await rules()).map(room => room.id), second.map(room => room.id));
});
