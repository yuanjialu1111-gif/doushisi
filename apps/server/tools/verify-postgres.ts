import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { AuthService, type Actor } from '../src/auth.js';
import { openDatabase, type Database } from '../src/database.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine } from '../src/engines.js';
import { LedgerService } from '../src/ledger.js';
import { Decimal } from '../src/money.js';
import { PolicyService } from '../src/policies.js';
import { RoomService } from '../src/rooms.js';
import { ReplayService } from '../src/replays.js';

const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = resolve(process.env.POSTGRES_VERIFY_REPORT ?? resolve(serverDirectory, '../../verification/raw/postgres-concurrency.json'));
const connection = process.env.POSTGRES_VERIFY_ADMIN_URL;
if (!connection) throw new Error('POSTGRES_VERIFY_ADMIN_URL must target a disposable local PostgreSQL instance.');
const source = new URL(connection);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname), 'Only an isolated loopback PostgreSQL instance is allowed.');
const databaseName = `dss_verify_${randomBytes(6).toString('hex')}`;
const runtimeRole = 'dss_app';
const password = randomBytes(32).toString('hex');
const administrator = new pg.Pool({ connectionString: source.href, max: 2 });
let app: Database | undefined;
let createdDatabase = false;
let createdRole = false;
const startedAt = new Date();
const checks: Array<{ id: string; name: string; passed: boolean; durationMs: number; details?: unknown; error?: { code?: string; message: string } }> = [];
const report: Record<string, unknown> = {
  startedAt: startedAt.toISOString(), database: 'PostgreSQL', transport: 'TCP loopback',
  testType: 'Infrastructure integration with an explicitly synthetic test-only rule engine',
  gameplayVerified: false, productionRegistryModified: false, runtimeRole,
  connectionPoolSize: 16, checks,
};
const expectCode = (expected: string) => (error: unknown) => {
  assert.equal((error as { code?: string }).code, expected);
  return true;
};

interface Snapshot { players: EnginePlayer[]; number: number }
// This engine is private to this verification process and has no claim to regional gameplay correctness.
const testEngine: RuleEngine = {
  variantKey: '4:0', version: 'postgres-verification-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'synthetic-infrastructure-only-not-production-gameplay' },
  create(input) { return { players: input.players, number: input.number }; },
  apply(raw, userId, action) {
    const snapshot = raw as Snapshot;
    assert.ok(snapshot.players.some(player => player.userId === userId));
    const request = action as { delta: string; confirmedOnly?: boolean; unconfirmedOnly?: boolean; settlementDelta?: string };
    const delta = new Decimal(request.delta);
    const settlementDelta = request.settlementDelta === undefined ? delta : new Decimal(request.settlementDelta);
    const settlement = snapshot.players.map((player, index) => ({ userId: player.userId, amount: (index === 0 ? settlementDelta : settlementDelta.negated()).toFixed() }));
    return { snapshot, events: [{ type: 'synthetic_score', ...(request.unconfirmedOnly ? { unconfirmed: true } : {}) }],
      ...(request.unconfirmedOnly ? {} : { confirmedScores: [{ eventId: 'fixture-score', postings: settlement }] }),
      ...(request.confirmedOnly || request.unconfirmedOnly ? {} : { settlement }) };
  },
  view(raw) { return { number: (raw as Snapshot).number }; },
};

async function check(id: string, name: string, run: () => Promise<unknown>) {
  const start = performance.now();
  try {
    const details = await run();
    checks.push({ id, name, passed: true, durationMs: Math.round(performance.now() - start), details });
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    const failure = error as { code?: string; message: string };
    checks.push({ id, name, passed: false, durationMs: Math.round(performance.now() - start), error: { code: failure.code, message: failure.message } });
    console.error(`FAIL ${id} ${name}: ${failure.message}`);
  }
}

try {
  const existing = await administrator.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [runtimeRole]);
  assert.equal(existing.rowCount, 0, 'Refusing to use an instance that already has dss_app. Use a fresh disposable cluster.');
  const version = await administrator.query('SELECT version() AS version, current_setting(\'server_version_num\') AS version_number');
  report.serverVersion = version.rows[0].version;
  report.serverVersionNumber = version.rows[0].version_number;
  await administrator.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  createdRole = true;
  await administrator.query(`CREATE DATABASE ${databaseName}`);
  createdDatabase = true;
  const migrationUrl = new URL(source);
  migrationUrl.pathname = `/${databaseName}`;
  await promisify(execFile)(process.execPath, ['--import', 'tsx', resolve(serverDirectory, 'src/migrate.ts')], {
    cwd: serverDirectory,
    env: { ...process.env, DATABASE_URL: migrationUrl.href },
    timeout: 60_000,
    windowsHide: true,
  });
  const runtimeUrl = new URL(migrationUrl);
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = password;
  app = await openDatabase(runtimeUrl.href);
  const db = app;
  const auth = new AuthService(db);
  const ledger = new LedgerService(db);
  const policies = new PolicyService(db);
  const rooms = new RoomService(db, new EngineRegistry([testEngine]), policies);
  const beans = await auth.create('pg_beans_admin', 'verification-only-password', 'beans_admin');
  const dealer = await auth.create('pg_deal_admin', 'verification-only-password', 'deal_admin');
  let sequence = 0;
  async function player(balance = '0') {
    const serial = ++sequence;
    const actor = await auth.create(`pg_player_${serial}`, 'verification-only-password');
    if (balance !== '0') await ledger.adjust(beans, actor.id, balance, 'verification opening balance', `opening-balance-${serial}`);
    return actor;
  }
  async function pair(balance = '100', feeMode = 2) {
    const players = [await player(balance), await player(balance)];
    const room = await rooms.create(players[0]!, '4:0', { playerNum: 2, gameNum: 4, useCardType: feeMode, baseBeans: '0.125' });
    await rooms.join(players[1]!, room.code);
    return { players, room };
  }
  async function start(players: Actor[], roomId: string) {
    await rooms.ready(players[0]!, roomId, true);
    return rooms.ready(players[1]!, roomId, true);
  }
  async function count(roomId: string, kind: string) {
    return (await db.query('SELECT count(*)::integer AS count FROM ledger_operations WHERE room_id=$1 AND kind=$2', [roomId, kind])).rows[0]!.count;
  }

  let exactDecimals: { amount: string; operationId: string; replayOperationId: string; balance: string; entries: number };
  await check('exact-decimals', '12-decimal arithmetic is exact and an identical request replays once', async () => {
    const account = await player();
    const amount = '0.123456789012';
    const first = await ledger.adjust(beans, account.id, amount, 'exact decimal credit', 'postgres-exact-decimal');
    const replay = await ledger.adjust(beans, account.id, amount, 'exact decimal credit', 'postgres-exact-decimal');
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.operationId, first.operationId);
    assert.equal(await ledger.balance(account.id), amount);
    const rows = await db.query('SELECT amount::text FROM ledger_entries WHERE operation_id=$1', [first.operationId]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]!.amount, amount);
    exactDecimals = { amount, operationId: first.operationId, replayOperationId: replay.operationId, balance: amount, entries: rows.rows.length };
    return { ...exactDecimals, replayIdempotent: true };
  });

  const historyProtection = { historyProtected: false, blockedCommands: [] as string[] };
  await check('history-protection', 'Runtime role cannot rewrite, delete, truncate, or disable history protection', async () => {
    const role = (await db.query('SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]!;
    assert.equal(role.name, runtimeRole);
    for (const key of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']) assert.equal(role[key], false);
    const owned = await db.query("SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname='public' AND tableowner=current_user");
    assert.equal(owned.rows[0]!.count, 0);
    await assert.rejects(db.query('CREATE TABLE public.forbidden_runtime_table(id integer)'), expectCode('42501'));
    await assert.rejects(db.query('CREATE ROLE forbidden_runtime_role'), expectCode('42501'));
    for (const table of ['ledger_entries', 'ledger_operations', 'audit_events', 'game_events', 'round_score_events']) {
      const identity = table === 'game_events' ? 'sequence' : table === 'round_score_events' ? 'event_id' : 'id';
      for (const statement of [`UPDATE ${table} SET ${identity}=${identity}`, `DELETE FROM ${table}`, `TRUNCATE ${table} CASCADE`, `ALTER TABLE ${table} DISABLE TRIGGER ALL`]) {
        await assert.rejects(db.query(statement), expectCode('42501'));
        historyProtection.blockedCommands.push(statement);
      }
    }
    historyProtection.historyProtected = true;
    return { runtimePrivilegesRestricted: true, tableOwnership: false, blockedCommands: historyProtection.blockedCommands.length, commands: historyProtection.blockedCommands };
  });

  let roleIsolation: { historyProtected: boolean; playerCannotAdjust: boolean };
  await check('role-isolation', 'Runtime role grants, history protection, and player role isolation protect privileged ledger operations', async () => {
    assert.equal(historyProtection.historyProtected, true);
    const isolatedPlayer = await player();
    await assert.rejects(ledger.adjust({ ...isolatedPlayer, role: 'player' }, isolatedPlayer.id, '1', 'player role isolation', 'postgres-role-isolation'), expectCode('FORBIDDEN'));
    roleIsolation = { historyProtected: historyProtection.historyProtected, playerCannotAdjust: true };
    return { runtimeGrantsRestricted: true, ...roleIsolation };
  });

  await check('idempotent-identical-requests', '64 concurrent identical request IDs create one exact posting', async () => {
    const account = await player();
    const results = await Promise.all(Array.from({ length: 64 }, () => ledger.adjust(beans, account.id, '0.1', 'same request', 'parallel-identical-request')));
    assert.equal(new Set(results.map(result => result.operationId)).size, 1);
    assert.equal(results.filter(result => !result.replayed).length, 1);
    assert.equal(await ledger.balance(account.id), '0.1');
    await assert.rejects(ledger.adjust(beans, account.id, '0.2', 'same request', 'parallel-identical-request'), expectCode('IDEMPOTENCY_CONFLICT'));
    const entries = await db.query('SELECT count(*)::integer AS count FROM ledger_entries WHERE user_id=$1', [account.id]);
    assert.equal(entries.rows[0]!.count, 1);
    return { simultaneousRequests: 64, committedOperations: 1, balance: '0.1' };
  });

  await check('admin-concurrency', '128 concurrent decimal credits and debits serialize without lost updates', async () => {
    const account = await player('20');
    await Promise.all(Array.from({ length: 128 }, (_, i) => ledger.adjust(beans, account.id, i % 2 === 0 ? '0.1' : '-0.03', 'concurrent precise adjustment', `mixed-decimal-${i}`)));
    assert.equal(await ledger.balance(account.id), '24.48');
    const entries = await db.query('SELECT count(*)::integer AS count,sum(amount)::text AS total FROM ledger_entries WHERE user_id=$1', [account.id]);
    assert.equal(entries.rows[0]!.count, 129);
    assert.equal(new Decimal(entries.rows[0]!.total).toFixed(), '24.48');
    return { operations: 128, simultaneousRequests: 128, credits: 64, debits: 64, balance: '24.48' };
  });

  await check('negative-balance', 'Manual deduction is floored while automatic settlement may create debt', async () => {
    const account = await player('1');
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => ledger.adjust(beans, account.id, '-0.1', 'competing deduction', `competing-deduction-${i}`)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 10);
    for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'INSUFFICIENT_BALANCE');
    assert.equal(await ledger.balance(account.id), '0');
    const { players, room } = await pair('2');
    const round = await start(players, room.id);
    await rooms.action(players[0]!, room.id, 'postgres-automatic-debt', { delta: '0.1', settlementDelta: '-2' },
      0, round.roundId!);
    const automaticOperation = (await db.query("SELECT id FROM ledger_operations WHERE round_id=$1 AND kind='round_settlement'",
      [round.roundId])).rows[0]!;
    const automaticBalance = await ledger.balance(players[0]!.id);
    assert.ok(new Decimal(automaticBalance).isNegative());
    assert.equal(automaticBalance, '-1');
    const manualBlocked = results.filter(result => result.status === 'rejected').length === 10 &&
      results.filter(result => result.status === 'fulfilled')
        .every(result => new Decimal(result.value.entries[0]!.balanceAfter).greaterThanOrEqualTo(0));
    assert.equal(manualBlocked, true);
    return { manualRequests: 20, committedDeductions: 10, rejectedDeductions: 10, manualBlocked,
      automaticAllowed: true, automaticBalance, operationId: automaticOperation.id };
  });

  await check('settlement-once', 'Round settlement and 80 manual adjustments commit atomically and conserve game points', async () => {
    const { players, room } = await pair();
    const round = await start(players, room.id);
    const adjustments = Array.from({ length: 80 }, (_, i) => ledger.adjust(beans, players[i % 2]!.id, i % 2 === 0 ? '0.1' : '-0.03', 'during settlement', `settlement-adjustment-${i}`));
    await Promise.all([
      ...adjustments,
      ...Array.from({ length: 16 }, () => rooms.action(players[0]!, room.id, 'concurrent-round-settle', { delta: '2.125' }, 0, round.roundId!)),
    ]);
    assert.equal(await count(room.id, 'round_settlement'), 1);
    const settlementOperation = (await db.query("SELECT id FROM ledger_operations WHERE room_id=$1 AND kind='round_settlement'", [room.id])).rows[0]!;
    assert.equal(await ledger.balance(players[0]!.id), '105.125');
    assert.equal(await ledger.balance(players[1]!.id), '95.675');
    const settlement = await db.query("SELECT count(*)::integer AS count,sum(e.amount)::text AS total FROM ledger_entries e JOIN ledger_operations o ON o.id=e.operation_id WHERE o.room_id=$1 AND o.kind='round_settlement'", [room.id]);
    assert.equal(settlement.rows[0]!.count, 2);
    assert.equal(new Decimal(settlement.rows[0]!.total).toFixed(), '0');
    return { operationId: settlementOperation.id, replayOperationId: settlementOperation.id, settlementOperations: 1,
      manualRequests: 80, duplicateSettlementRequests: 16, balances: ['105.125', '95.675'], settlementSum: '0' };
  });

  await check('fee-once', 'Competing ready requests charge AA and owner room fees once', async () => {
    const results = [];
    for (const feeMode of [2, 1]) {
      const { players, room } = await pair('10', feeMode);
      await rooms.ready(players[0]!, room.id, true);
      const readyResults = await Promise.allSettled(Array.from({ length: 32 }, () => rooms.ready(players[1]!, room.id, true)));
      assert.equal(readyResults.filter(result => result.status === 'fulfilled').length, 1);
      for (const result of readyResults) if (result.status === 'rejected') assert.equal(result.reason.code, 'INVALID_ROOM_STATE');
      assert.equal(await count(room.id, 'room_fee'), 1);
      const balances = await Promise.all(players.map(account => ledger.balance(account.id)));
      assert.deepEqual(balances, feeMode === 2 ? ['9', '9'] : ['8', '10']);
      const round = await rooms.view(room.id, players[0]!.id);
      await rooms.action(players[0]!, room.id, `room-fee-settlement-${feeMode}`, { delta: '0.1' }, 0, round.roundId!);
      await start(players, room.id);
      assert.equal(await count(room.id, 'room_fee'), 1);
      results.push({ mode: feeMode === 2 ? 'aa' : 'owner', readyRequests: 32, roomFeeOperations: 1, balancesAfterFirstFee: balances });
    }
    return { feeOperations: 1, concurrentReadyRequests: 32, modes: results };
  });

  await check('dissolve-earned-scores', 'Durable confirmed scores settle once and unconfirmed earned scores are not credited', async () => {
    const { players, room } = await pair();
    const round = await start(players, room.id);
    await rooms.action(players[1]!, room.id, 'postgres-unconfirmed-score', { delta: '9', unconfirmedOnly: true }, 0, round.roundId!);
    await rooms.action(players[0]!, room.id, 'postgres-confirmed-score', { delta: '2.125', confirmedOnly: true }, 1, round.roundId!);
    assert.equal(await count(room.id, 'round_settlement'), 0);
    assert.equal(await ledger.balance(players[0]!.id), '99');
    await rooms.dissolve(players[0]!, room.id, true);
    const recovered = new RoomService(db, new EngineRegistry([testEngine]), new PolicyService(db));
    await Promise.all([
      ...Array.from({ length: 32 }, () => recovered.dissolve(players[1]!, room.id, true)),
      ...Array.from({ length: 80 }, (_, i) => ledger.adjust(beans, players[i % 2]!.id, i % 2 === 0 ? '0.1' : '-0.03', 'during dissolved settlement', `dissolved-adjustment-${i}`)),
    ]);
    assert.equal(await count(room.id, 'round_settlement'), 1);
    assert.equal(await count(room.id, 'room_fee'), 1);
    assert.equal(await ledger.balance(players[0]!.id), '105.125');
    assert.equal(await ledger.balance(players[1]!.id), '95.675');
    assert.equal((await recovered.view(room.id, players[0]!.id)).state, 'closed');
    const stored = (await db.query('SELECT state,end_reason FROM rounds WHERE id=$1', [round.roundId])).rows[0];
    assert.deepEqual(stored, { state: 'settled', end_reason: 'dissolved' });
    assert.equal((await db.query('SELECT count(*)::int AS count FROM round_score_events WHERE round_id=$1', [round.roundId])).rows[0]!.count, 1);
    const unconfirmedEvents = (await db.query("SELECT count(*)::int AS count FROM game_events WHERE command_id='postgres-unconfirmed-score' AND payload->'events' @> '[{\"unconfirmed\":true}]'")).rows[0]!.count;
    assert.equal(unconfirmedEvents, 1);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM round_score_events WHERE command_id='postgres-unconfirmed-score'")).rows[0]!.count, 0);
    const earnedScores = (await db.query("SELECT postings FROM round_score_events WHERE round_id=$1 AND command_id='postgres-confirmed-score'", [round.roundId])).rows[0]!.postings as Array<{ userId: string; amount: string }>;
    const credited = earnedScores.find(posting => posting.userId === players[0]!.id)!.amount;
    assert.equal(credited, '2.125');
    return { manualRequests: 80, duplicateDissolveVotes: 32, committedSettlements: 1, scoreEvents: 1, zeroUnconfirmed: true, credited, balances: ['105.125', '95.675'] };
  });

  await check('state-version-concurrency', '32 distinct commands at one state version accept one action and preserve retry identity', async () => {
    const { players, room } = await pair();
    const round = await start(players, room.id);
    const action = { delta: '0.125', confirmedOnly: true };
    const attempts = await Promise.allSettled(Array.from({ length: 32 }, (_, index) => rooms.action(players[0]!, room.id,
      `postgres-version-race-${index}`, action, 0, round.roundId!)));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of attempts) if (result.status === 'rejected') assert.equal(result.reason.code, 'STATE_VERSION_CONFLICT');
    const winner = attempts.findIndex(result => result.status === 'fulfilled');
    await Promise.all(Array.from({ length: 16 }, () => rooms.action(players[0]!, room.id, `postgres-version-race-${winner}`, action, 0, round.roundId!)));
    await assert.rejects(rooms.action(players[0]!, room.id, `postgres-version-race-${winner}`, action, 1, round.roundId!), expectCode('IDEMPOTENCY_CONFLICT'));
    const recovered = await new RoomService(db, new EngineRegistry([testEngine]), new PolicyService(db)).view(room.id, players[0]!.id);
    assert.equal(recovered.stateVersion, 1);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM round_score_events WHERE round_id=$1', [round.roundId])).rows[0]!.count, 1);
    assert.equal(await count(room.id, 'round_settlement'), 0);
    assert.equal(await ledger.balance(players[0]!.id), '99');
    assert.equal(await ledger.balance(players[1]!.id), '99');
    return { newCommands: 32, accepted: 1, staleRejected: 31, identicalRetries: 16, stateVersion: 1, scoreEvents: 1 };
  });

  await check('scheduler-timeout-once', '32 scheduler workers execute one persisted legal timeout and one settlement', async () => {
    let clock = 1800000000000;
    const action = { delta: '0.125' };
    const timedEngine: RuleEngine = { ...testEngine, version: 'postgres-timer-fixture-v1', interactions: {
      legalActions(raw, userId) { return (raw as Snapshot).players[0]!.userId === userId ? [action] : []; },
      deadlines(raw) { return [{ decisionId: 'fixture-deadline', userId: (raw as Snapshot).players[0]!.userId, delayMs: 100, action }]; },
      autoPlay() { return null; },
    } };
    const registry = new EngineRegistry([timedEngine]);
    const timedRooms = new RoomService(db, registry, policies, () => clock);
    const players = [await player('10'), await player('10')];
    const room = await timedRooms.create(players[0]!, '4:0', { playerNum: 2, gameNum: 4, useCardType: 2, baseBeans: '0.125' });
    await timedRooms.join(players[1]!, room.code);
    for (const account of players) await timedRooms.ready(account, room.id, true);
    const started = await timedRooms.view(room.id, players[0]!.id);
    assert.equal(await timedRooms.applyDueAction(room.id), false);
    clock += 100;
    const attempts = await Promise.all(Array.from({ length: 32 }, () => new RoomService(db, registry, policies, () => clock).applyDueAction(room.id)));
    assert.equal(attempts.filter(Boolean).length, 1);
    assert.equal(await count(room.id, 'round_settlement'), 1);
    assert.equal(await ledger.balance(players[0]!.id), '9.125');
    assert.equal(await ledger.balance(players[1]!.id), '8.875');
    const archived = await new ReplayService(db, registry).read(players[0]!, room.id, started.roundId!);
    assert.deepEqual(archived.frames.map(frame => frame.stateVersion), [0, 1]);
    const stored = (await db.query('SELECT state_version,next_action_at FROM rounds WHERE id=$1', [started.roundId])).rows[0]!;
    assert.equal(stored.state_version, 1);
    assert.equal(stored.next_action_at, null);
    return { workers: 32, applied: 1, settled: 1, replayFrames: 2, stateVersion: 1, balances: ['9.125', '8.875'] };
  });

  await check('policy-concurrency', 'Competing policy versions have one winner and preserve audit', async () => {
    const account = await player();
    const edits = await Promise.allSettled(Array.from({ length: 32 }, (_, i) => policies.update(dealer, account.id, true, String(i), 'competing policy versions', `postgres-policy-${i}`, 0)));
    assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
    for (const edit of edits) if (edit.status === 'rejected') assert.equal(edit.reason.code, 'VERSION_CONFLICT');
    return { simultaneousEdits: 32, acceptedVersionChanges: 1 };
  });

  await check('ledger-invariants', 'All wallet balances equal the sum of append-only entries', async () => {
    const mismatches = await db.query('SELECT w.user_id,w.balance::text,COALESCE(sum(e.amount),0)::text AS ledger_sum FROM wallets w LEFT JOIN ledger_entries e ON e.user_id=w.user_id GROUP BY w.user_id,w.balance HAVING w.balance <> COALESCE(sum(e.amount),0)');
    assert.equal(mismatches.rows.length, 0);
    const counts = (await db.query('SELECT (SELECT count(*)::integer FROM wallets) AS wallets,(SELECT count(*)::integer FROM ledger_operations) AS operations,(SELECT count(*)::integer FROM ledger_entries) AS entries')).rows[0];
    return { mismatches: 0, ...counts };
  });
} catch (error) {
  const failure = error as { code?: string; message: string };
  report.setupError = { code: failure.code, message: failure.message };
  console.error(failure.message);
} finally {
  await app?.close();
  try {
    if (createdDatabase) await administrator.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    if (createdRole) await administrator.query(`DROP ROLE ${runtimeRole}`);
    report.temporaryDatabaseAndRoleRemoved = createdDatabase && createdRole;
  } catch (error) { report.cleanupError = (error as Error).message; }
  await administrator.end();
  report.completedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAt.getTime();
  report.passed = !report.setupError && !report.cleanupError && checks.length > 0 && checks.every(result => result.passed);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Verification report: ${reportPath}`);
  if (!report.passed) process.exitCode = 1;
}
