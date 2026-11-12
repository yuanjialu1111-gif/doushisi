import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth.js';
import { openDatabase, migrate } from '../src/database.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';
import { requestHash } from '../src/ledger.js';

interface State { players: EnginePlayer[]; actions: number }
const fixture: RuleEngine = {
  variantKey: '4:0', version: 'action-version-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-action-version-tests-only' },
  create(input): State { return { players: input.players, actions: 0 }; },
  apply(raw, _userId, rawAction) {
    const state = raw as State;
    const action = rawAction as { finish?: boolean; invalid?: boolean };
    const settlement = state.players.map((player, index) => ({ userId: player.userId, amount: index ? '-0.125' : '0.125' }));
    return { snapshot: { ...state, actions: state.actions + 1 }, events: [],
      ...(action.invalid ? { settlement } : {}),
      ...(action.finish ? { confirmedScores: [{ eventId: 'finished:score', postings: settlement }], settlement } : {}) };
  },
  view(raw) { return { actions: (raw as State).actions }; },
};

test('JSON actions require the observed round and version without weakening command idempotence', async t => {
  const db = await openDatabase();
  await migrate(db);
  const services = await createApp(db, { staticFiles: false, engines: new EngineRegistry([fixture]) });
  const { app, rooms, auth, ledger, replays } = services;
  try {
    const admin = await auth.create('version_api_admin', 'test-password-only', 'beans_admin');
    const players = [await auth.create('version_api_first', 'test-password-only'), await auth.create('version_api_second', 'test-password-only')];
    for (const player of players) await ledger.adjust(admin, player.id, '10', 'version fixture funding', `version-funding-${player.id}`);
    const room = await rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4 });
    assert.equal(room.stateVersion, null);
    await rooms.join(players[1]!, room.code);
    await rooms.ready(players[0]!, room.id, true);
    const started = await rooms.ready(players[1]!, room.id, true);
    const roundId = started.roundId!;
    assert.equal(started.stateVersion, 0);
    const login = await auth.login(players[0]!.username, 'test-password-only');
    const post = (body: object) => app.inject({ method: 'POST', url: `/api/rooms/${room.id}/actions`,
      headers: { authorization: `Bearer ${login.token}` }, payload: body });
    const command = (commandId: string, action: object = {}, version = 0, expectedRoundId = roundId) => ({ commandId, action, expectedStateVersion: version, expectedRoundId });

    await t.test('missing, invalid or stale versions fail before snapshots, score history or wallets change', async () => {
      for (const [body, status, error] of [
        [{ commandId: 'api-missing-version', action: {}, expectedRoundId: roundId }, 400, 'STATE_VERSION_REQUIRED'],
        [{ commandId: 'api-missing-roundid', action: {}, expectedStateVersion: 0 }, 400, 'ROUND_ID_REQUIRED'],
        [{ ...command('api-fractional-version'), expectedStateVersion: 0.5 }, 400, 'INVALID_REQUEST'],
        [{ ...command('api-negative-version'), expectedStateVersion: -1 }, 400, 'INVALID_REQUEST'],
        [{ ...command('api-string-version'), expectedStateVersion: '0' }, 400, 'INVALID_REQUEST'],
        [{ ...command('api-invalid-roundid'), expectedRoundId: 'invalid' }, 400, 'INVALID_REQUEST'],
        [command('api-stale-first-version', {}, 1), 409, 'STATE_VERSION_CONFLICT'],
        [command('api-wrong-round-id', {}, 0, randomUUID()), 409, 'ROUND_VERSION_CONFLICT'],
      ] as const) {
        const response = await post(body);
        assert.equal(response.statusCode, status);
        assert.equal(response.json().error.code, error);
      }
      assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 0);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM game_events WHERE room_id=$1', [room.id])).rows[0]!.count, 1);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM round_score_events WHERE round_id=$1', [roundId])).rows[0]!.count, 0);
      assert.equal(await ledger.balance(players[0]!.id), '10');
      assert.equal(await ledger.balance(players[1]!.id), '10');
    });

    await t.test('competing new commands at one version have one winner and identical retries still succeed', async () => {
      const commands = Array.from({ length: 12 }, (_, index) => command(`api-competing-action-${index}`));
      const results = await Promise.all(commands.map(post));
      assert.equal(results.filter(response => response.statusCode === 200).length, 1);
      for (const response of results.filter(response => response.statusCode !== 200)) assert.equal(response.json().error.code, 'STATE_VERSION_CONFLICT');
      const accepted = commands[results.findIndex(response => response.statusCode === 200)]!;
      assert.equal((await post(accepted)).statusCode, 200);
      assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 1);
      assert.equal((await post({ ...accepted, expectedStateVersion: 1 })).json().error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await post({ ...accepted, expectedRoundId: randomUUID() })).json().error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await post({ ...accepted, action: { changed: true } })).json().error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await post({ commandId: accepted.commandId, action: accepted.action })).json().error.code, 'IDEMPOTENCY_CONFLICT');
      await assert.rejects(rooms.action(players[1]!, room.id, accepted.commandId, {}, 0, roundId), { code: 'IDEMPOTENCY_CONFLICT' });
      await assert.rejects(db.query('UPDATE rounds SET state_version=0 WHERE id=$1', [roundId]), /advance by one/);
      const recovery = await rooms.current(players[0]!.id);
      assert.equal(recovery!.stateVersion, 1);
      assert.deepEqual(recovery!.game, { actions: 1 });
    });

    await t.test('a rejected engine result rolls the version back; settlement and later-round retries never execute twice', async () => {
      const invalid = await post(command('api-invalid-engine-result', { invalid: true }, 1));
      assert.equal(invalid.statusCode, 500);
      assert.equal(invalid.json().error.code, 'INVALID_SETTLEMENT');
      assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 1);
      const finish = command('api-versioned-finish', { finish: true }, 1);
      const complete = await post(finish);
      assert.equal(complete.statusCode, 200);
      assert.equal(complete.json().state, 'between_rounds');
      assert.equal(complete.json().stateVersion, null);
      assert.equal((await post(finish)).statusCode, 200);
      assert.equal((await db.query('SELECT state_version FROM rounds WHERE id=$1', [roundId])).rows[0]!.state_version, 2);
      const recorded = await replays.read(players[0]!, room.id, roundId);
      assert.deepEqual(recorded.frames.map(frame => frame.stateVersion), [0, 1, 2]);
      assert.equal(await ledger.balance(players[0]!.id), '10.125');
      assert.equal(await ledger.balance(players[1]!.id), '9.875');
      await rooms.ready(players[0]!, room.id, true);
      const next = await rooms.ready(players[1]!, room.id, true);
      assert.equal(next.stateVersion, 0);
      assert.notEqual(next.roundId, roundId);
      assert.equal((await post(finish)).statusCode, 200);
      assert.equal((await post(command('api-cross-round-delay', {}, 0, roundId))).json().error.code, 'ROUND_VERSION_CONFLICT');
      assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 0);
      assert.equal((await post(command('api-new-round-action', {}, 0, next.roundId!))).statusCode, 200);
      assert.equal((await rooms.view(room.id, players[0]!.id)).stateVersion, 1);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id])).rows[0]!.count, 1);
    });
  } finally { await app.close(); await db.close(); }
});

test('state-version migration preserves historical actions and permits only identical legacy retries without version fields', async () => {
  const db = await openDatabase();
  let services: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    for (const name of ['001-initial.sql', '002-linked-adjustments.sql', '003-replay-origins.sql', '004-confirmed-round-scores.sql']) {
      await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.exec('CREATE TABLE schema_migrations(version integer PRIMARY KEY); INSERT INTO schema_migrations(version) VALUES(1),(2),(3),(4)');
    const auth = new AuthService(db);
    const players = [await auth.create('version_legacy_first', 'test-password-only'), await auth.create('version_legacy_second', 'test-password-only')];
    const roomId = randomUUID();
    const roundId = randomUUID();
    const state: State = { players: players.map((player, index) => ({ userId: player.id, seat: index + 1 })), actions: 0 };
    const action = { historical: true };
    const payload = { roundId, commandHash: requestHash({ userId: players[0]!.id, action }), action, events: [], confirmedScores: [], settlement: null };
    await db.query("INSERT INTO rooms(id,code,owner_id,variant_key,rule_version,rules,player_count,rounds,fee_mode,state,current_round,fee_charged) VALUES($1,'765432',$2,'4:0',$3,'{}',2,4,'aa','playing',1,true)", [roomId, players[0]!.id, fixture.version]);
    for (const [index, player] of players.entries()) await db.query('INSERT INTO room_members(room_id,user_id,seat) VALUES($1,$2,$3)', [roomId, player.id, index + 1]);
    await db.query("INSERT INTO rounds(id,room_id,number,state,snapshot,initial_snapshot,policy_snapshot) VALUES($1,$2,1,'playing',$3,$4,'{}')", [roundId, roomId, JSON.stringify({ ...state, actions: 1 }), JSON.stringify(state)]);
    await db.query('INSERT INTO game_events(room_id,sequence,actor_id,command_id,payload) VALUES($1,1,$2,$3,$4)', [roomId, players[0]!.id, 'legacy-action-once', JSON.stringify(payload)]);
    const before = (await db.query('SELECT * FROM game_events WHERE room_id=$1', [roomId])).rows[0];
    await migrate(db);
    await migrate(db);
    services = await createApp(db, { staticFiles: false, engines: new EngineRegistry([fixture]) });
    const { rooms, app, replays } = services;
    assert.equal((await rooms.view(roomId, players[0]!.id)).stateVersion, 1);
    const retry = await rooms.action(players[0]!, roomId, 'legacy-action-once', action);
    assert.equal(retry.stateVersion, 1);
    await assert.rejects(rooms.action(players[0]!, roomId, 'legacy-action-once', action, 0, roundId), { code: 'IDEMPOTENCY_CONFLICT' });
    await assert.rejects(rooms.action(players[0]!, roomId, 'legacy-new-no-version', action), { code: 'STATE_VERSION_REQUIRED' });
    const login = await services.auth.login(players[0]!.username, 'test-password-only');
    const response = await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/actions`, headers: { authorization: `Bearer ${login.token}` },
      payload: { commandId: 'legacy-action-once', action } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual((await db.query('SELECT * FROM game_events WHERE room_id=$1 AND sequence=1', [roomId])).rows[0], before);
    await rooms.action(players[0]!, roomId, 'legacy-next-valid-action', { finish: true }, 1, roundId);
    const replay = await replays.read(players[0]!, roomId, roundId);
    assert.deepEqual(replay.frames.map(frame => frame.stateVersion), [0, 1, 2]);
    assert.equal((await db.query('SELECT state_version FROM rounds WHERE id=$1', [roundId])).rows[0]!.state_version, 2);
  } finally { await services?.app.close(); await db.close(); }
});
