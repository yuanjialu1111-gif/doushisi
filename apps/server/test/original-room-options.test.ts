import { supportsNewRoom } from '@dss/rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { decodeFrame, MSGEvent, type DecodedFrame } from '@dss/protocol';
import { getFixtureOptions as getDefaultOptions } from './fixture-options.js';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService } from '../src/auth.js';
import { LedgerService } from '../src/ledger.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { EngineRegistry } from '../src/engines.js';
import { decodeOriginalExtension, encodeOriginalResponse, registerOriginalProtocol, type OriginalExtension } from '../src/original-wire.js';

interface Received { frame: DecodedFrame; extension?: OriginalExtension }

async function connect(url: string) {
  const socket = new WebSocket(url);
  const inbox: Received[] = [];
  socket.on('message', bytes => {
    const packet = bytes as Buffer;
    inbox.push({ frame: decodeFrame(packet), extension: decodeOriginalExtension(packet) });
  });
  await once(socket, 'open');

  async function request(command: number, body: Record<string, unknown>, response: number, extension: Partial<OriginalExtension> = {}) {
    const start = inbox.length;
    const received = new Promise<Received>((resolve, reject) => {
      const listener = () => {
        const result = inbox.slice(start).find(item => item.frame.cmd === response);
        if (result) { clearTimeout(timeout); socket.off('message', listener); resolve(result); }
      };
      const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error(`No response for ${command}`)); }, 5000);
      socket.on('message', listener);
    });
    // The helper deliberately uses the production V2 envelope for requests too:
    // command-specific protobuf field selection is shared by requests and responses.
    socket.send(encodeOriginalResponse(command, body, '', { ...(command === 3 ? { createRoom: { baseBeans: '0.1' } } : {}), ...extension }));
    return received;
  }

  async function close() {
    if (socket.readyState !== WebSocket.CLOSED) { socket.close(); await once(socket, 'close'); }
  }
  return { request, close };
}

test('frozen room options are server-authored on create, enter, restore and in-room login', async t => {
  const db = await openDatabase(); await migrate(db);
  const app = Fastify(); await app.register(websocket);
  const auth = new AuthService(db); const ledger = new LedgerService(db); const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry(), policies);
  rooms.opensVariant = supportsNewRoom; // 其他地区代码留着不启用（DEC-20261101-四川斗十四），测试打开跑它的规则。
  await registerOriginalProtocol(app, { db, auth, ledger, policies, rooms, markOnline() {} });
  const url = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
  const clients: Awaited<ReturnType<typeof connect>>[] = [];
  t.after(async () => { for (const client of clients) await client.close(); await app.close(); await db.close(); });

  const [owner, guest, manualOwner, spoofed] = await Promise.all([
    auth.create('room_options_owner', 'test-password-only'),
    auth.create('room_options_guest', 'test-password-only'),
    auth.create('room_options_manual', 'test-password-only'),
    auth.create('room_options_spoofed', 'test-password-only'),
  ]);
  const [ownerSession, guestSession, manualSession, spoofedSession] = await Promise.all([
    auth.login(owner.username, 'test-password-only'), auth.login(guest.username, 'test-password-only'),
    auth.login(manualOwner.username, 'test-password-only'), auth.login(spoofed.username, 'test-password-only'),
  ]);
  const ownerClient = await connect(url); const guestClient = await connect(url); const manualClient = await connect(url); const spoofedClient = await connect(url);
  clients.push(ownerClient, guestClient, manualClient, spoofedClient);
  const ownerLogin = await ownerClient.request(MSGEvent.HWRequestGameLogin, { token: ownerSession.token }, MSGEvent.HWResponseGameLogin);
  await guestClient.request(MSGEvent.HWRequestGameLogin, { token: guestSession.token }, MSGEvent.HWResponseGameLogin);
  await manualClient.request(MSGEvent.HWRequestGameLogin, { token: manualSession.token }, MSGEvent.HWResponseGameLogin);
  await spoofedClient.request(MSGEvent.HWRequestGameLogin, { token: spoofedSession.token }, MSGEvent.HWResponseGameLogin);

  const created = await ownerClient.request(MSGEvent.HWRequestCreateTable, {
    ...getDefaultOptions('4:0'), areaType: 4, roomType: 100, playerNum: 2,
  }, MSGEvent.HWResponseCreateTable);
  const createdTable = created.frame.data.hwResponseCreateTable as any;
  const originalOptions = { baseBeans: '0.1', baseBeansSource: 'manual', playerNum: 2, playerNumSource: 'original' } as const;
  assert.deepEqual(created.extension!.roomOptions, originalOptions);
  assert.deepEqual(created.extension!.roomState, { roomId: created.extension!.roomState!.roomId, roundId: null, stateVersion: null });
  assert.equal(createdTable.tableInfo.playerNum, originalOptions.playerNum);

  const entered = await guestClient.request(MSGEvent.HWRequestEnterTable, { roomId: createdTable.tableInfo.roomId }, MSGEvent.HWResponseEnterTable);
  assert.deepEqual(entered.extension!.roomOptions, originalOptions);
  const restored = await ownerClient.request(MSGEvent.HWRequestEnterTableFinish, { roomId: createdTable.tableInfo.roomId }, MSGEvent.HWResponseEnterTableFinish);
  assert.deepEqual(restored.extension!.roomOptions, originalOptions);

  const reconnect = await connect(url); clients.push(reconnect);
  const resumed = await reconnect.request(MSGEvent.HWRequestGameLogin, { token: ownerSession.token }, MSGEvent.HWResponseGameLogin);
  assert.equal((resumed.frame.data.hwResponseGameLogin as any).uid, (ownerLogin.frame.data.hwResponseGameLogin as any).uid);
  assert.equal((resumed.frame.data.hwResponseGameLogin as any).tableId, createdTable.tableInfo.roomId);
  assert.deepEqual(resumed.extension!.roomOptions, originalOptions);

  const manual = await manualClient.request(MSGEvent.HWRequestCreateTable, {
    ...getDefaultOptions('14:0'), areaType: 14, roomType: 100,
  }, MSGEvent.HWResponseCreateTable, { createRoom: { baseBeans: '0.125', playerNum: 3 } });
  assert.deepEqual(manual.extension!.roomOptions, { baseBeans: '0.125', baseBeansSource: 'manual', playerNum: 3, playerNumSource: 'manual' });

  const rejected = await spoofedClient.request(MSGEvent.HWRequestCreateTable, {
    ...getDefaultOptions('4:0'), areaType: 4, roomType: 100, playerNum: 2,
  }, MSGEvent.HWResponseCreateTable, { roomOptions: originalOptions });
  assert.equal(rejected.extension!.error!.code, 'INVALID_EXTENSION');
  assert.equal((rejected.frame.data.hwResponseCreateTable as any).result, 2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM rooms WHERE owner_id=$1", [spoofed.id])).rows[0]!.n, 0);
});
