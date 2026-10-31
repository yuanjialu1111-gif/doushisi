import { encodeFixtureFrame as encodeFrame } from './fixture-options.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { decodeFrame, type DecodedFrame } from '@dss/protocol';
import { clientEdition, isVisibleVariant, supportsNewRoom, RETAINED_VARIANT_KEYS } from '@dss/rules';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { EngineRegistry, type RuleEngine } from '../src/engines.js';
import { ProfileService } from '../src/profile.js';
import { registerOriginalProtocol } from '../src/original-wire.js';

// 第二轮 S1：去地区，只留新津斗十四。
async function wireClient(url: string) {
  const socket = new WebSocket(url);
  const inbox: DecodedFrame[] = [];
  socket.on('message', bytes => { inbox.push(decodeFrame(bytes as Buffer)); });
  await once(socket, 'open');
  async function request(command: number, body: Record<string, unknown>, response: number): Promise<DecodedFrame> {
    const start = inbox.length;
    socket.send(encodeFrame({ cmd: command, protoVersion: 2 }, body));
    return new Promise((resolve, reject) => {
      const find = () => inbox.slice(start).find(value => value.cmd === response);
      const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error(`No wire message ${response}`)); }, 5000);
      const listener = () => { const value = find(); if (value) { clearTimeout(timeout); socket.off('message', listener); resolve(value); } };
      socket.on('message', listener); listener();
    });
  }
  async function close() { if (socket.readyState !== WebSocket.CLOSED) { socket.close(); await once(socket, 'close'); } }
  return { request, close };
}

test('S1-AC1 S1-AC3 登录一律是新津：库里存过彭山、眉山也一样，地区列表只有新津，选别的地区不生效', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const policies = new PolicyService(db);
  await registerOriginalProtocol(app, { db, auth, ledger: new LedgerService(db), policies, rooms: new RoomService(db, new EngineRegistry(), policies),
    profiles: new ProfileService(db), markOnline() {} });
  const address = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const clients: Awaited<ReturnType<typeof wireClient>>[] = [];
  t.after(async () => { for (const client of clients) await client.close(); await app.close(); await db.close(); });

  const login = async (username: string) => {
    const client = await wireClient(address); clients.push(client);
    const session = await auth.login(username, 'test-password-only');
    return { client, reply: (await client.request(1, { hwRequestGameLogin: { token: session.token } }, 2)).data.hwResponseGameLogin as any };
  };
  const pengshan = await auth.create('region_pengshan', 'test-password-only');
  const meishan = await auth.create('region_meishan', 'test-password-only');
  // original_protocol_regions 由协议层第一次启动时建表；老玩家的记录留着不删。
  await login('region_pengshan');
  await db.query("INSERT INTO original_protocol_regions(user_id,shi_name,xian_name) VALUES($1,'眉山','彭山'),($2,'眉山','其他区域')", [pengshan.id, meishan.id]);

  for (const username of ['region_pengshan', 'region_meishan']) {
    const { client, reply } = await login(username);
    assert.equal(reply.shiName, '成都市', username);
    assert.equal(reply.xianName, '新津', username);
    assert.ok(reply.areaType.length > 0, '有玩法编号，原版不会弹出选地区');
    const regions = (await client.request(49, { hwRequestRegion: {} }, 50)).data.hwResponseRegion as any;
    assert.deepEqual(regions.shiInfo.map((city: any) => [city.shiName, city.xianInfo.map((county: any) => county.xianName)]), [['成都市', ['新津']]]);
    const chosen = (await client.request(51, { hwRequestRegionChoice: { shiName: '眉山', xianName: '彭山' } }, 52)).data.hwResponseRegionChoice as any;
    assert.equal(chosen.result, 1);
  }
  const again = await login('region_pengshan');
  assert.equal(again.reply.xianName, '新津');
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM original_protocol_regions')).rows[0]!.count, 2, '老值不删');
});

test('S1-AC2 S1-AC4 界面只显示新津，服务端仍接受原来全部玩法', () => {
  assert.deepEqual(clientEdition.visibleGameIds, [4]);
  assert.equal(isVisibleVariant('4:0'), true);
  assert.equal(isVisibleVariant('8:0'), false);
  assert.equal(RETAINED_VARIANT_KEYS.length, 21);
  for (const key of RETAINED_VARIANT_KEYS) assert.equal(supportsNewRoom(key), true, key);
});

const fixture = (variantKey: string): RuleEngine => ({
  variantKey, version: 'single-variant-fixture-v1', evidence: { status: 'verified', referenceDigest: 'test-only-single-variant' },
  create(input) { return { players: input.players }; },
  apply(raw) { return { snapshot: raw, events: [], confirmedScores: [], settlement: [] }; },
  view() { return {}; },
});

test('S1-AC5 后台大厅桌模板只能用新津；其他玩法的老模板只能停用，不再补桌，大厅也看不到', async t => {
  const db = await openDatabase(); await migrate(db);
  const { app, auth, lobby } = await createApp(db, { staticFiles: false, engines: new EngineRegistry([fixture('4:0'), fixture('5:0')]), scheduler: false, rateLimit: false });
  t.after(async () => { await app.close(); await db.close(); });
  await auth.create('single_beans', 'test-password-only', 'beans_admin');
  const headers = { authorization: `Bearer ${(await auth.login('single_beans', 'test-password-only', true)).token}` };
  const player = await auth.create('single_player', 'test-password-only', 'player');
  const playerHeaders = { authorization: `Bearer ${(await auth.login(player.username, 'test-password-only')).token}` };
  const body = (variantKey: string, enabled = true) => ({ variantKey, options: { baseBeans: '1', playerNum: 2, gameNum: 4 }, standingEmpty: 2,
    thresholdMultiplier: 10, idleClearMinutes: 10, enabled, sortOrder: 1 });

  const listed = (await app.inject({ method: 'GET', url: '/api/admin/lobby-templates', headers })).json();
  assert.deepEqual(listed.variants.map((variant: any) => variant.key), ['4:0']);
  const hidden = await app.inject({ method: 'POST', url: '/api/admin/lobby-templates', headers, payload: body('5:0') });
  assert.equal(hidden.statusCode, 400);
  assert.equal(hidden.json().error.code, 'VARIANT_HIDDEN');

  // 测试服上已有的其他玩法模板（迁移不动它们）：还在库里、仍是启用状态。
  const legacyId = '00000000-0000-4000-8000-0000000005a0';
  await db.query(`INSERT INTO lobby_templates(id,variant_key,options,standing_empty,threshold_multiplier,idle_clear_minutes,enabled,sort_order)
    VALUES($1,'5:0',$2,3,10,10,true,0)`, [legacyId, JSON.stringify({ baseBeans: '1', playerNum: 2, gameNum: 4 })]);
  const xinjin = (await app.inject({ method: 'POST', url: '/api/admin/lobby-templates', headers, payload: body('4:0') })).json();
  await lobby.maintain();
  const open = (await db.query("SELECT variant_key,COUNT(*)::int AS count FROM rooms WHERE state='waiting' GROUP BY variant_key")).rows;
  assert.deepEqual(open, [{ variant_key: '4:0', count: 2 }]);
  const tables = (await app.inject({ method: 'GET', url: '/api/lobby/tables', headers: playerHeaders })).json();
  assert.ok(tables.tables.every((table: any) => table.variantKey === '4:0'));
  assert.deepEqual(tables.variants.map((variant: any) => variant.key), ['4:0']);
  assert.equal((await app.inject({ method: 'GET', url: '/api/lobby/tables?variant=5:0', headers: playerHeaders })).json().tables.length, 0);

  const enable = await app.inject({ method: 'PUT', url: `/api/admin/lobby-templates/${legacyId}`, headers, payload: body('5:0', true) });
  assert.equal(enable.json().error.code, 'VARIANT_HIDDEN');
  const disable = await app.inject({ method: 'PUT', url: `/api/admin/lobby-templates/${legacyId}`, headers, payload: body('5:0', false) });
  assert.equal(disable.statusCode, 200, disable.body);
  assert.ok(xinjin.id);
});
