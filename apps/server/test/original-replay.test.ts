import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { decodeFrame, encodeFrame } from '@dss/protocol';
import { createApp } from '../src/app.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry, type RuleEngine, type EnginePlayer } from '../src/engines.js';
import { ReplayService } from '../src/replays.js';
import { decodeOriginalExtension } from '../src/original-wire.js';

interface State { players: EnginePlayer[]; hands: Record<string, number[]>; deck: number[]; actions: number; done: boolean }
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'original-replay-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-transport-replay-only' },
  create(input): State { return { players: input.players, hands: Object.fromEntries(input.players.map((player, index) => [player.userId, [707 + index]])), deck: [989898], actions: 0, done: false }; },
  apply(raw, _userId, rawAction) {
    const state = raw as State; const action = rawAction as { type: string };
    const postings = state.players.map((player, index) => ({ userId: player.userId, amount: index ? '-0.125' : '0.125' }));
    return { snapshot: { ...state, actions: state.actions + 1, done: action.type === 'finish' }, events: [{ deck: state.deck, secret: 'never-public' }],
      ...(state.actions === 0 ? { confirmedScores: [{ eventId: 'first-earned-score', postings }] } : {}),
      ...(action.type === 'finish' ? { settlement: postings } : {}) };
  },
  view(raw, userId) { const state = raw as State; return { hand: state.hands[userId], actions: state.actions, done: state.done }; },
  interactions: { legalActions: () => [{ type: 'move' }, { type: 'finish' }], deadlines: () => [], autoPlay: () => null },
  original: {
    decodeAction(_command, body) { return { type: body.actType === 9 ? 'finish' : 'move' }; },
    response(_command, _body, raw) { return { body: { result: 1, tilesOnHandNum: (raw as State).actions } }; },
    enter(raw, userId) {
      const state = raw as State;
      return { body: { tableState: state.done ? 0 : 1, gameStart: { round: 1, seats: state.players.map(player => ({ seatIndex: player.seat,
        tilesOnHand: player.userId === userId ? state.hands[userId] : [], tilesOnHandNum: 1 })) } } };
    },
    notifications(raw, _events, userId, phase) {
      const state = raw as State; const seatIndex = state.players.find(player => player.userId === userId)!.seat;
      if (phase === 'start') return [{ command: 11, body: { round: 1, seats: [{ seatIndex, tilesOnHand: state.hands[userId] }] } }];
      return [{ command: 25, body: { action: { seatIndex, destCard: state.hands[userId]![0] } } },
        ...(state.actions === 1 ? [{ command: 61, body: { scoreList: [{ seatIndex, score: '0' }] }, decimalFields: [{ path: ['hwNotifyScoreChangeTimely', 'scoreList', 0, 'score'], value: '0.125' }] }] : []),
        { command: state.done ? 28 : 26, body: {} }];
    },
  },
};

test('original replay uses authenticated paged viewer projections and verifies frozen notifications', async t => {
  const db = await openDatabase(); await migrate(db);
  const registry = new EngineRegistry([fixture]);
  const { app, auth, rooms, ledger, replays } = await createApp(db, { staticFiles: false, engines: registry, scheduler: false });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) { socket.close(); await once(socket, 'close'); } await app.close(); await db.close(); });
  const beans = await auth.create('original_replay_beans', 'test-password-only', 'beans_admin');
  const deal = await auth.create('original_replay_deal', 'test-password-only', 'deal_admin');
  const players = [];
  for (const name of ['first', 'second', 'outside']) players.push(await auth.create(`original_replay_${name}`, 'test-password-only'));
  for (const player of players) await ledger.adjust(beans, player.id, '20', 'original replay fixture', `original-replay-fund-${player.id}`);
  const sessions = [];
  for (const player of players) sessions.push(await auth.login(player.username, 'test-password-only'));
  const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
  await rooms.join(players[1]!, room.code); await rooms.ready(players[0]!, room.id, true);
  const started = await rooms.ready(players[1]!, room.id, true); const roundId = started.roundId!;
  const path = `/api/records/${room.id}/replay/${roundId}/original`;
  const get = (url: string, token = sessions[0]!.token) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  assert.equal((await get(path)).json().error.code, 'REPLAY_NOT_AVAILABLE');
  await rooms.action(players[0]!, room.id, 'original-replay-first-move', { type: 'move' }, 0, roundId);
  await rooms.setAutoPlay(players[0]!, room.id, true, 'original-replay-auto-on');
  await rooms.setAutoPlay(players[1]!, room.id, true, 'original-replay-other-on');
  await rooms.setAutoPlay(players[0]!, room.id, false, 'original-replay-auto-off');
  for (let version = 1; version <= 54; version++) await rooms.action(players[0]!, room.id, `original-replay-move-${version}`, { type: 'move' }, version, roundId);
  await rooms.originalAction(players[1]!, room.id, 'original-replay-finish', 23, { actType: 9 }, 55, roundId);
  const wireRound = (await db.query("INSERT INTO original_protocol_ids(entity_kind,entity_id) VALUES('round',$1) RETURNING wire_id", [roundId])).rows[0]!.wire_id;
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const socket = new WebSocket(address.replace('http', 'ws') + '/ws/original'); sockets.push(socket); await once(socket, 'open');
  const loginResponse = once(socket, 'message'); socket.send(encodeFrame({ cmd: 1, protoVersion: 2 }, { hwRequestGameLogin: { token: sessions[0]!.token } })); await loginResponse;
  const wireReplay = async () => {
    const response = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error('No original replay response.')); }, 3000);
      const listener = (bytes: Buffer) => {
        if (decodeFrame(bytes).cmd !== 306) return;
        clearTimeout(timeout); socket.off('message', listener); resolve(bytes);
      };
      socket.on('message', listener);
    });
    socket.send(encodeFrame({ cmd: 305, protoVersion: 2 }, { hwRequestPlayBack: { recordId: wireRound } }));
    const bytes = await response;
    return { bytes, decoded: decodeFrame(bytes), extension: decodeOriginalExtension(bytes)! };
  };
  let secondRoundId = '';

  await t.test('305 and HTTP reject waiting, playing and between-round membership, including cached pages', async () => {
    const assertBlocked = async () => {
      const denied = await wireReplay();
      assert.equal(denied.decoded.cmd, 306);
      assert.equal(denied.extension.error!.code, 'REPLAY_WHILE_IN_ROOM');
      assert.equal(denied.extension.replay, undefined);
      const manifest = await get(path);
      assert.equal(manifest.statusCode, 409); assert.equal(manifest.json().error.code, 'REPLAY_WHILE_IN_ROOM');
    };
    assert.equal((await rooms.current(players[0]!.id))!.state, 'between_rounds'); await assertBlocked();
    await rooms.ready(players[0]!, room.id, true); const second = await rooms.ready(players[1]!, room.id, true);
    secondRoundId = second.roundId!;
    assert.equal(second.state, 'playing'); await assertBlocked();
    await rooms.action(players[0]!, room.id, 'original-replay-second-score', { type: 'move' }, 0, secondRoundId);
    await rooms.dissolve(players[0]!, room.id, true); await rooms.dissolve(players[1]!, room.id, true);
    const manifest = (await get(path)).json();
    const framesUrl = `${manifest.framesUrl}?offset=0&limit=1&digest=${manifest.digest}`;
    assert.equal((await get(framesUrl)).statusCode, 200);
    const waiting = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
    assert.equal(waiting.state, 'waiting'); await assertBlocked();
    assert.equal((await get(framesUrl)).json().error.code, 'REPLAY_WHILE_IN_ROOM');
    await rooms.leave(players[0]!, waiting.id);
    assert.equal((await get(framesUrl)).statusCode, 200);
    assert.ok((await wireReplay()).extension.replay);
    // Another participant's live room must not prevent this viewer from replaying.
    const othersRoom = await rooms.create(players[1]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
    assert.equal((await get(path)).statusCode, 200);
    await rooms.leave(players[1]!, othersRoom.id);
  });

  await t.test('manifest and pages preserve scores, original packet order and recoverable snapshots', async () => {
    const response = await get(path); assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    const manifest = response.json();
    assert.equal(manifest.frameCount, 60); assert.equal(manifest.initial.index, 0);
    assert.deepEqual(manifest.initial.packets, []); assert.equal(manifest.initial.snapshot.command, 48);
    assert.equal(manifest.initial.snapshot.body.tableInfo.roomId, Number(room.code));
    assert.equal(manifest.initial.snapshot.body.userInfo.length, 2);
    assert.equal(manifest.initial.snapshot.decimalFields.find((field: any) => field.path.at(-1) === 'score').value, '0');
    const firstPage = (await get(`${manifest.framesUrl}?offset=1&limit=50&digest=${manifest.digest}`)).json();
    assert.equal(firstPage.frames.length, 50); assert.equal(firstPage.nextOffset, 51);
    const pageEnd = (await get(`${manifest.framesUrl}?offset=${firstPage.nextOffset}&limit=50&digest=${manifest.digest}`)).json();
    assert.equal(pageEnd.nextOffset, null);
    const frames = [manifest.initial, ...firstPage.frames, ...pageEnd.frames];
    assert.deepEqual(frames.map((frame: any) => frame.index), Array.from({ length: 60 }, (_, index) => index));
    assert.deepEqual(frames[1].packets.map((packet: any) => packet.command), [25, 61, 26]);
    assert.equal(frames[1].packets[1].decimalFields[0].value, '0.125');
    assert.equal(frames[1].snapshot.decimalFields.find((field: any) => field.path.at(-1) === 'score').value, '0.125');
    assert.equal(frames[2].autoPlay, true); assert.deepEqual(frames[2].packets.map((packet: any) => packet.command), [123]);
    assert.equal(frames[3].autoPlay, true); assert.deepEqual(frames[3].packets, []);
    assert.equal(frames[4].autoPlay, false); assert.equal(frames[4].packets[0].command, 126);
    const last = frames.at(-1); assert.equal(last.stateVersion, 56); assert.equal(last.packets.at(-1).command, 28);
    const seek = (await get(`${manifest.framesUrl}?offset=43&limit=1&digest=${manifest.digest}`)).json();
    assert.deepEqual(seek.frames[0], frames[43]);
    const empty = (await get(`${manifest.framesUrl}?offset=60&limit=1&digest=${manifest.digest}`)).json();
    assert.deepEqual(empty.frames, []); assert.equal(empty.nextOffset, null);
    const text = JSON.stringify(frames);
    for (const secret of ['"deck"', '"policy"', 'never-public', '"tilesOnHand":[708]', '"destCard":708']) assert.equal(text.includes(secret), false, secret);
    for (const frame of frames) assert.deepEqual(frame.snapshot.body.gameStart.seats[1].tilesOnHand ?? [], []);
    assert.ok(text.includes('"tilesOnHand":[707]'));
    const second = (await get(path, sessions[1]!.token)).json();
    assert.notEqual(second.digest, manifest.digest);
    assert.deepEqual(second.initial.snapshot.body.gameStart.seats[1].tilesOnHand, [708]);
    assert.deepEqual(second.initial.snapshot.body.gameStart.seats[0].tilesOnHand ?? [], []);
  });

  await t.test('every manifest and cached page request checks membership, role, session and bounds', async () => {
    const manifest = (await get(path)).json();
    const frames = `${manifest.framesUrl}?offset=0&limit=1&digest=${manifest.digest}`;
    assert.equal((await get(path, sessions[2]!.token)).statusCode, 403);
    assert.equal((await get(frames, sessions[2]!.token)).statusCode, 403);
    for (const admin of [beans, deal]) {
      const login = await auth.login(admin.username, 'test-password-only', true);
      assert.equal((await get(path, login.token)).statusCode, 403); assert.equal((await get(frames, login.token)).statusCode, 403);
    }
    assert.equal((await get(path, 'revoked-token')).statusCode, 401);
    assert.equal((await get(`${manifest.framesUrl}?offset=0&limit=51&digest=${manifest.digest}`)).statusCode, 400);
    assert.equal((await get(`${manifest.framesUrl}?offset=61&limit=1&digest=${manifest.digest}`)).statusCode, 400);
    assert.equal((await get(`${manifest.framesUrl}?offset=0&limit=1&digest=${'0'.repeat(64)}`)).json().error.code, 'REPLAY_VERSION_CONFLICT');
  });

  await t.test('HWFR 305 returns only the verified authenticated replay reference', async () => {
    const { bytes, decoded, extension } = await wireReplay();
    assert.equal(decoded.cmd, 306); assert.equal((decoded.data.hwResponsePlayBack as any).result, 1);
    assert.deepEqual(extension.replay, { version: 1, roomId: room.id, roundId, manifestUrl: path });
    assert.ok((bytes as Buffer).length < 1024); assert.equal(Object.hasOwn(decoded.data.hwResponsePlayBack as object, 'gameStart'), false);
  });

  await t.test('notification drift, response drift and missing adapters fail before any replay is returned', async () => {
    const drift = new ReplayService(db, new EngineRegistry([{ ...fixture, original: { ...fixture.original!, notifications: () => [] } }]));
    await assert.rejects(drift.originalManifest(players[0]!, room.id, roundId), { code: 'REPLAY_DIVERGED' });
    const responseDrift = new ReplayService(db, new EngineRegistry([{ ...fixture, original: { ...fixture.original!, response: () => ({ body: { result: 2 } }) } }]));
    await assert.rejects(responseDrift.originalManifest(players[0]!, room.id, roundId), { code: 'REPLAY_DIVERGED' });
    const missing = new ReplayService(db, new EngineRegistry([{ ...fixture, original: undefined }]));
    await assert.rejects(missing.originalManifest(players[0]!, room.id, roundId), { code: 'ORIGINAL_REPLAY_UNAVAILABLE' });
    registry.register({ ...fixture, version: 'original-replay-fixture-v2', apply() { throw new Error('New engine must never interpret an old replay'); } });
    assert.equal((await new ReplayService(db, registry).originalManifest(players[0]!, room.id, roundId)).ruleVersion, fixture.version);
  });

  await t.test('large frames are rejected and byte-limited pages can be shorter than their requested limit', async () => {
    const expanded = (count: number) => new ReplayService(db, new EngineRegistry([{ ...fixture, original: { ...fixture.original!, enter(raw, userId) {
      const projection = fixture.original!.enter(raw, userId);
      (projection.body.gameStart as any).seats[0].outCardsNo = Array(count).fill(1234);
      return projection;
    } } }]));
    await assert.rejects(expanded(60000).originalManifest(players[0]!, room.id, roundId), { code: 'REPLAY_TOO_LARGE' });
    const service = expanded(10000); const manifest = await service.originalManifest(players[0]!, room.id, roundId);
    const page = await service.originalPage(players[0]!, room.id, roundId, 0, 50, manifest.digest);
    assert.ok(page.frames.length > 0 && page.frames.length < 50); assert.equal(page.nextOffset, page.frames.length);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1048576);
  });

  await t.test('later-round snapshots use earlier results and unanimous dissolution retains confirmed scores', async () => {
    const manifest = await replays.originalManifest(players[0]!, room.id, secondRoundId);
    assert.equal(manifest.endReason, 'dissolved');
    const otherViewer = await replays.originalManifest(players[1]!, room.id, secondRoundId);
    assert.equal(otherViewer.initial.autoPlay, true);
    assert.deepEqual(otherViewer.initial.packets, []);
    assert.equal(manifest.initial.snapshot.decimalFields.find(field => field.path.at(-1) === 'score')!.value, '0.125');
    const page = await replays.originalPage(players[0]!, room.id, secondRoundId, 1, 50, manifest.digest);
    assert.equal(page.frames.at(-1)!.snapshot.decimalFields.find(field => field.path.at(-1) === 'score')!.value, '0.25');
    assert.equal(page.frames.at(-1)!.packets[0]!.command, 32);
    assert.equal(page.frames.at(-1)!.stateVersion, 1);
  });
});
