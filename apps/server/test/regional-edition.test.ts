import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/database.js';
import { getDefaultOptions, RETAINED_GAME_IDS, QIONGLAI_PACK_VERSION, QIONGLAI_PACK_APPROVAL,
  QIONGLAI_INDEPENDENT_VERSION, QIONGLAI_INDEPENDENT_FANS, INDEPENDENT_APPROVAL_VERSION } from '@dss/rules';
import { createQionglaiCardState } from '../src/game/qionglai-pack.js';
import { decodeFrame } from '@dss/protocol';
import { decodeOriginalExtension, encodeOriginalResponse, type OriginalExtension } from '../src/original-wire.js';

test('21-game catalogue rejects removed creation, preserves old rooms, and freezes independently authorized Qionglai rules', async () => {
  const db = await openDatabase(); await migrate(db);
  const { app, auth, rooms, ledger } = await createApp(db, { staticFiles: false, scheduler: false });
  try {
    const owner = await auth.create('edition_owner', 'test-password-only');
    const guest = await auth.create('edition_guest', 'test-password-only');
    const session = await auth.login(owner.username, 'test-password-only');
    const headers = { authorization: 'Bearer ' + session.token };
    const games = (await app.inject({ method: 'GET', url: '/api/games', headers })).json().games;
    assert.deepEqual(games.map((game: { gameId: number }) => game.gameId), [...RETAINED_GAME_IDS]);
    for (const variantKey of ['2:0', '2:1', '3:0', '13:0', '17:0', '18:0', '101:0']) {
      const response = await app.inject({ method: 'POST', url: '/api/rooms', headers, payload: { variantKey, baseBeans: '0.1' } });
      assert.equal(response.json().error.code, 'GAME_REMOVED');
    }
    const legacyId = randomUUID();
    await db.query("INSERT INTO rooms(id,code,owner_id,variant_key,rule_version,rules,player_count,rounds,fee_mode,state) VALUES($1,'989898',$2,'2:0','legacy','{}',2,4,'aa','waiting')", [legacyId, owner.id]);
    await db.query('INSERT INTO room_members(room_id,user_id,seat) VALUES($1,$2,1)', [legacyId, owner.id]);
    assert.equal((await rooms.current(owner.id))!.variantKey, '2:0');
    await assert.rejects(rooms.join(guest, '989898'), { code: 'GAME_REMOVED' });
    await assert.rejects(rooms.ready(owner, legacyId, true), { code: 'GAME_REMOVED' });
    await rooms.leave(owner, legacyId);
    assert.equal((await rooms.view(legacyId, owner.id)).state, 'closed');
    assert.equal(await ledger.balance(owner.id), '0');

    const room = await rooms.create(owner, '8:0', { baseBeans: '0.125', qlTianDiHu: 0, playerNum: 2 });
    assert.deepEqual(room.rules.qionglai.fanTable, QIONGLAI_INDEPENDENT_FANS);
    assert.equal(room.rules.qionglai.fanVersion, QIONGLAI_INDEPENDENT_VERSION);
    assert.equal(room.rules.qionglai.fanStatus, 'independent-definition-authorized');
    assert.equal(room.rules.independentApproval.version, INDEPENDENT_APPROVAL_VERSION);
    assert.equal(room.rules.independentApproval.variantKey, '8:0');
    assert.equal(room.rules.qionglai.packVersion, QIONGLAI_PACK_VERSION);
    assert.equal(room.rules.qionglai.packSource, QIONGLAI_PACK_APPROVAL);
    assert.equal(room.rules.qionglai.qlTianDiHu, 0);
    assert.equal(room.rules.qionglai.qlHongHeiHu, 1);
    assert.equal(room.rules.qionglai.qlHongHei50, 1);
    assert.equal((await rooms.join(guest, room.code)).rules.qionglai.qlTianDiHu, 0);
    room.rules.qionglai.qlTianDiHu = 1;
    assert.equal((await rooms.current(owner.id))!.rules.qionglai.qlTianDiHu, 0);
    const beans = await auth.create('edition_beans', 'test-password-only', 'beans_admin');
    await ledger.adjust(beans, owner.id, '2', 'edition gameplay funding', 'edition-owner-funding');
    await ledger.adjust(beans, guest.id, '2', 'edition gameplay funding', 'edition-guest-funding');
    await rooms.ready(owner, room.id, true);
    const playing = await rooms.ready(guest, room.id, true);
    assert.equal(playing.state, 'playing');
    assert.equal((await rooms.current(owner.id))!.feeCharged, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM ledger_entries')).rows[0]!.n, 4);
  } finally { await app.close(); await db.close(); }
});

test('reading historical Qionglai rooms never backfills newly extracted fan values', async () => {
  const db = await openDatabase(); await migrate(db);
  const { app, auth, rooms } = await createApp(db, { staticFiles: false, scheduler: false });
  try {
    const owner = await auth.create('ql_historical', 'test-password-only');
    const room = await rooms.create(owner, '8:0', { baseBeans: '1', playerNum: 2 });
    const originalFrozenRules = structuredClone(room.rules);
    originalFrozenRules.qionglai.fanStatus = 'awaiting-user-confirmation';
    originalFrozenRules.qionglai.fanTable.redHu = null;
    originalFrozenRules.qionglai.fanTable.blackHu = null;
    delete originalFrozenRules.qionglai.fanVersion;
    delete originalFrozenRules.qionglai.fanSources;
    delete originalFrozenRules.qionglai.packVersion;
    delete originalFrozenRules.qionglai.packSource;
    delete originalFrozenRules.qionglai.rulesVersion;
    delete originalFrozenRules.independentApproval;
    await db.query('UPDATE rooms SET rules=$2 WHERE id=$1', [room.id, JSON.stringify(originalFrozenRules)]);
    assert.deepEqual((await rooms.view(room.id, owner.id)).rules, originalFrozenRules);
    assert.deepEqual((await rooms.current(owner.id))!.rules, originalFrozenRules);
    const persisted = (await db.query('SELECT rules FROM rooms WHERE id=$1', [room.id])).rows[0]!.rules;
    assert.deepEqual(typeof persisted === 'string' ? JSON.parse(persisted) : persisted, originalFrozenRules);
  } finally { await app.close(); await db.close(); }
});

test('all six approved Qionglai packs survive room persistence without enabling incomplete gameplay', async () => {
  const db = await openDatabase(); await migrate(db);
  const { app, auth, rooms } = await createApp(db, { staticFiles: false, scheduler: false });
  try {
    const owner = await auth.create('ql_pack_owner', 'test-password-only');
    for (const [wangNum, expectedTotal] of [[3, 55], [6, 58], [9, 61], [12, 64], [15, 67], [18, 70]]) {
      const room = await rooms.create(owner, '8:0', { baseBeans: '1', wangNum });
      const persisted = (await rooms.current(owner.id))!;
      assert.equal(persisted.rules.wangNum, wangNum);
      assert.equal(persisted.rules.qionglai.packSource, QIONGLAI_PACK_APPROVAL);
      const state = createQionglaiCardState(persisted.variantKey, persisted.rules, 'deck', [{ id: 'deck', visibility: 'hidden' }]);
      assert.equal(state.pack.length, expectedTotal);
      room.rules.wangNum = 3;
      room.rules.qionglai.packVersion = 'changed-client-copy';
      assert.equal((await rooms.current(owner.id))!.rules.qionglai.packVersion, QIONGLAI_PACK_VERSION);
      assert.equal((await rooms.current(owner.id))!.rules.wangNum, wangNum);
      assert.equal(persisted.feeCharged, false);
      await rooms.leave(owner, room.id);
    }
  } finally { await app.close(); await db.close(); }
});

test('Ya’an classic rooms retain original options and joins while blood-battle remains excluded', async () => {
  const db = await openDatabase(); await migrate(db);
  const { app, auth, rooms, ledger } = await createApp(db, { staticFiles: false, scheduler: false });
  try {
    const owner = await auth.create('yaan_owner', 'test-password-only');
    const guest = await auth.create('yaan_guest', 'test-password-only');
    const region = { shiName: '雅安市', xianName: '其他区域' };
    await assert.rejects(rooms.create(owner, '6:0', { baseBeans: '0.125', processType: 2 }, region), { code: 'GAME_REMOVED' });
    const room = await rooms.create(owner, '6:0', { baseBeans: '0.125', playerNum: 2 }, region);
    assert.equal(room.variantKey, '6:0');
    assert.equal(room.rules.processType, 1);
    assert.equal(room.rules.baseBeans, '0.125');
    assert.equal(room.rules.wangNum, getDefaultOptions('6:0', region).wangNum);
    assert.equal(room.rules.qiWangNum, getDefaultOptions('6:0', region).qiWangNum);
    assert.equal(room.rules.ziChi, getDefaultOptions('6:0', region).ziChi);
    assert.equal(room.rules.yaan.version, 'yaan-classic-additions-v1');
    assert.equal(room.rules.yaan.rulesVersion, 'yaan-independent-v1');
    assert.equal(room.rules.yaan.qiWangNum, room.rules.qiWangNum);
    assert.equal(room.rules.yaan.wangNum, room.rules.wangNum);
    assert.equal(room.rules.yaan.ziChi, room.rules.ziChi);
    assert.equal(room.rules.yaan.status, 'independent-definition-authorized');
    const persistedYaan = (await db.query('SELECT rules FROM rooms WHERE id=$1', [room.id])).rows[0]!.rules;
    persistedYaan.yaan.qiWangNum = 'changed-client-copy';
    assert.equal((await rooms.current(owner.id))!.rules.yaan.qiWangNum, room.rules.qiWangNum);
    assert.equal(room.rules.qionglai, undefined);
    assert.equal(room.rules.independentApproval.version, INDEPENDENT_APPROVAL_VERSION);
    assert.equal(room.rules.independentApproval.variantKey, '6:0');
    assert.equal((await rooms.join(guest, room.code)).variantKey, '6:0');
    const beans = await auth.create('yaan_beans', 'test-password-only', 'beans_admin');
    await ledger.adjust(beans, owner.id, '2', 'Yaan gameplay funding', 'yaan-owner-funding');
    await ledger.adjust(beans, guest.id, '2', 'Yaan gameplay funding', 'yaan-guest-funding');
    await rooms.ready(owner, room.id, true);
    const playing = await rooms.ready(guest, room.id, true);
    assert.equal(playing.state, 'playing');
    assert.equal((await rooms.current(owner.id))!.feeCharged, true);
    assert.equal(await ledger.balance(owner.id), '1');
    await rooms.dissolve(owner, room.id, true);
    await rooms.dissolve(guest, room.id, true);
  } finally { await app.close(); await db.close(); }
});

test('Xinjin rooms freeze the independent pack and rule version without enabling gameplay', async () => {
  const db = await openDatabase(); await migrate(db);
  const { app, auth, rooms, ledger } = await createApp(db, { staticFiles: false, scheduler: false });
  try {
    const owner = await auth.create('xinjin_owner', 'test-password-only');
    const room = await rooms.create(owner, '4:0', { ...getDefaultOptions('4:0'), baseBeans: '0.125', playerNum: 2, gameNum: 4 });
    assert.equal(room.rules.xinjin.version, 'xinjin-independent-v1');
    assert.equal(room.rules.xinjin.rulesVersion, 'xinjin-independent-v1');
    assert.equal(room.rules.xinjin.wangNum, 3);
    // 新津 v2 固定自己翻出的牌自己也能吃（开房选的「可吃上家」不再生效）。
    assert.equal(room.rules.xinjin.ziChi, 1);
    await rooms.ready(owner, room.id, true);
    assert.equal((await rooms.view(room.id, owner.id)).state, 'waiting');
    assert.equal(await ledger.balance(owner.id), '0');
    await rooms.leave(owner, room.id);
  } finally { await app.close(); await db.close(); }
});

test('Anyue rooms freeze the independent pack and rule version', async () => {
  const db = await openDatabase(); await migrate(db);
  const { app, auth, rooms, ledger } = await createApp(db, { staticFiles: false, scheduler: false });
  try {
    const owner = await auth.create('anyue_owner', 'test-password-only');
    const room = await rooms.create(owner, '5:0', { ...getDefaultOptions('5:0'), baseBeans: '0.125', playerNum: 2, gameNum: 4 });
    assert.equal(room.rules.anyue.version, 'anyue-independent-v1');
    assert.equal(room.rules.anyue.rulesVersion, 'anyue-independent-v1');
    assert.equal(room.rules.anyue.piaoType, 0);
    await rooms.ready(owner, room.id, true);
    assert.equal((await rooms.view(room.id, owner.id)).state, 'waiting');
    assert.equal(await ledger.balance(owner.id), '0');
    await rooms.leave(owner, room.id);
  } finally { await app.close(); await db.close(); }
});

test('Qionglai V2 options survive create, join, table entry and login; cross-region injection is refused', async () => {
  const db = await openDatabase(); await migrate(db);
  const { app, auth } = await createApp(db, { staticFiles: false, scheduler: false });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const sockets: WebSocket[] = [];
  async function client(token: string, modern = true) {
    const socket = new WebSocket(address.replace('http', 'ws') + '/ws/original');
    sockets.push(socket); await once(socket, 'open');
    function request(command: number, body: Record<string, unknown>, response: number, extension: Partial<OriginalExtension> = {}) {
      return new Promise<{ body: any; extension: OriginalExtension }>((resolve, reject) => {
        const handler = (packet: Buffer) => {
          const frame = decodeFrame(packet);
          if (frame.cmd !== response) return;
          clearTimeout(timer); socket.off('message', handler);
          resolve({ body: Object.values(frame.data).find(value => value && typeof value === 'object'), extension: decodeOriginalExtension(packet)! });
        };
        const timer = setTimeout(() => { socket.off('message', handler); reject(new Error('Missing response')); }, 4000);
        socket.on('message', handler);
        socket.send(encodeOriginalResponse(command, body, '', extension));
      });
    }
    const login = await request(1, { token }, 2, modern ? { capabilities: ['decision-window-v1', 'qionglai-additions-v1'] } : {});
    return { request, login };
  }
  try {
    const users = await Promise.all(['owner', 'guest', 'old'].map(suffix => auth.create('ql_wire_' + suffix, 'test-password-only')));
    const sessions = await Promise.all(users.map(user => auth.login(user.username, 'test-password-only')));
    const a = await client(sessions[0]!.token), b = await client(sessions[1]!.token), old = await client(sessions[2]!.token, false);
    const body = { ...getDefaultOptions('8:0'), areaType: 8, playerNum: 2 };
    const qionglai = { version: 'qionglai-additions-v1' as const, qlTianDiHu: 0 as const, qlHongHeiHu: 1 as const, qlHongHei50: 1 as const };
    assert.equal((await old.request(3, body, 4, { createRoom: { baseBeans: '0.125', qionglai } })).extension.error?.code, 'CLIENT_UPGRADE_REQUIRED');
    assert.equal((await a.request(3, { ...getDefaultOptions('4:0'), areaType: 4 }, 4, { createRoom: { baseBeans: '0.125', qionglai } })).extension.error?.code, 'INVALID_ROOM_OPTIONS');
    const created = await a.request(3, body, 4, { createRoom: { baseBeans: '0.125', qionglai } });
    assert.deepEqual(created.extension.roomOptions?.qionglai, qionglai);
    const code = created.body.tableInfo.roomId;
    assert.deepEqual((await b.request(5, { roomId: code }, 6)).extension.roomOptions?.qionglai, qionglai);
    assert.deepEqual((await b.request(47, { roomId: code }, 48)).extension.roomOptions?.qionglai, qionglai);
    assert.deepEqual((await client(sessions[1]!.token)).login.extension.roomOptions?.qionglai, qionglai);
    assert.equal((await old.request(5, { roomId: code }, 6)).extension.error?.code, 'CLIENT_UPGRADE_REQUIRED');
  } finally {
    for (const socket of sockets) { if (socket.readyState !== WebSocket.CLOSED) { socket.close(); await once(socket, 'close'); } }
    await app.close(); await db.close();
  }
});
