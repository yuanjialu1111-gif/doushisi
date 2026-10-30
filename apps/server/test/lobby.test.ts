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

async function setup(engines: EngineRegistry = new EngineRegistry([fixture])) {
  const db = await openDatabase(); await migrate(db);
  const created = await createApp(db, { staticFiles: false, engines, scheduler: false, rateLimit: false });
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
  assert.deepEqual(listing.variants, [{ key: '4:0', name: '新津斗十四' }]);
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

test('R2 AC3/R5 AC1: a full system table plays its rounds with AA fees, closes, and the lobby is back to empty tables', async t => {
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
  const fees = (await ctx.db.query("SELECT e.user_id,e.amount::text FROM ledger_entries e JOIN ledger_operations o ON o.id=e.operation_id WHERE o.kind='room_fee' AND o.room_id=$1 ORDER BY e.user_id", [joined.id])).rows;
  assert.deepEqual(fees.map(fee => fee.amount).sort(), ['-1', '-1']);
  await ctx.lobby.maintain();
  const listing = await tablesOf(ctx, a.headers);
  assert.equal(listing.tables.length, 1);
  assert.equal(listing.tables[0].seats.length, 0);
  assert.notEqual(listing.tables[0].code, code);
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
  const notPlayable = await post(template({ variantKey: '5:0' }));
  assert.equal(notPlayable.json().error.code, 'VARIANT_NOT_PLAYABLE');
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
