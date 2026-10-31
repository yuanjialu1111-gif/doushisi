import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/database.js';
import { AuthService } from '../src/auth.js';
import { LedgerService } from '../src/ledger.js';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

test('migrations are repeatable and ledger history cannot be rewritten', async () => {
  const db = await openDatabase();
  try {
    await migrate(db);
    await migrate(db);
    const auth = new AuthService(db);
    const admin = await auth.create('beans_test', 'test-password-only', 'beans_admin');
    const player = await auth.create('player_test', 'test-password-only');
    const ledger = new LedgerService(db);
    await ledger.adjust(admin, player.id, '0.1', 'test credit', 'test-credit-0001');
    assert.equal(await ledger.balance(player.id), '0.1');
    await assert.rejects(db.query('UPDATE ledger_entries SET amount=10'), /append-only/);
    await assert.rejects(db.query('DELETE FROM ledger_operations'), /append-only/);
    assert.equal(await ledger.balance(player.id), '0.1');
  } finally { await db.close(); }
});

test('version one databases upgrade in place without altering historical ledger rows', async () => {
  const db = await openDatabase();
  try {
    await db.exec(await readFile(new URL('../migrations/001-initial.sql', import.meta.url), 'utf8'));
    await db.exec('CREATE TABLE schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); INSERT INTO schema_migrations(version) VALUES(1)');
    const auth = new AuthService(db);
    const admin = await auth.create('beans_upgrade', 'test-password-only', 'beans_admin');
    const player = await auth.create('player_upgrade', 'test-password-only');
    const operation = randomUUID();
    const entry = randomUUID();
    await db.query("INSERT INTO ledger_operations(id,request_key,request_hash,kind,actor_id,reason) VALUES($1,'upgrade-credit','existing-hash','admin_add',$2,'pre-upgrade credit')", [operation, admin.id]);
    await db.query("INSERT INTO ledger_entries(id,operation_id,user_id,amount,balance_before,balance_after) VALUES($1,$2,$3,2.125,0,2.125)", [entry, operation, player.id]);
    await db.query('UPDATE wallets SET balance=2.125 WHERE user_id=$1', [player.id]);
    const original = (await db.query('SELECT * FROM ledger_entries WHERE id=$1', [entry])).rows[0];
    const historicalRoom = randomUUID();
    const historicalRound = randomUUID();
    await db.query("INSERT INTO rooms(id,code,owner_id,variant_key,rule_version,rules,player_count,rounds,fee_mode,state,current_round,fee_charged) VALUES($1,'654321',$2,'2:0','historical-v1','{}',2,4,'aa','closed',1,true)", [historicalRoom, player.id]);
    await db.query('INSERT INTO room_members(room_id,user_id,seat,score) VALUES($1,$2,1,0)', [historicalRoom, player.id]);
    await db.query("INSERT INTO rounds(id,room_id,number,state,snapshot,policy_snapshot,results,settled_at) VALUES($1,$2,1,'settled',$3,'{}',$4,now())", [historicalRound, historicalRoom, JSON.stringify({ historical: true }), JSON.stringify([{ userId: player.id, amount: '0.125' }])]);
    const historical = (await db.query('SELECT state,snapshot,results,settled_at FROM rounds WHERE id=$1', [historicalRound])).rows[0];
    await migrate(db);
    await migrate(db);
    const ledger = new LedgerService(db);
    await ledger.adjust(admin, player.id, '-0.125', 'linked after upgrade', 'upgrade-correction', entry);
    assert.equal(await ledger.balance(player.id), '2');
    assert.deepEqual((await db.query('SELECT * FROM ledger_entries WHERE id=$1', [entry])).rows[0], original);
    assert.deepEqual((await db.query('SELECT state,snapshot,results,settled_at FROM rounds WHERE id=$1', [historicalRound])).rows[0], historical);
    assert.equal((await db.query('SELECT scoring_version FROM rounds WHERE id=$1', [historicalRound])).rows[0]!.scoring_version, 0);
    assert.deepEqual((await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(row => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.equal((await db.query('SELECT next_round_context FROM rounds WHERE id=$1', [historicalRound])).rows[0]!.next_round_context, null);
  } finally { await db.close(); }
});

test('room score removal refuses a legacy aggregate that cannot be proved by immutable settlements', async () => {
  const db = await openDatabase();
  try {
    const migrations = ['001-initial.sql', '002-linked-adjustments.sql', '003-replay-origins.sql', '004-confirmed-round-scores.sql', '005-round-state-versions.sql', '006-engine-interaction-deadlines.sql'];
    await db.exec('CREATE TABLE schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const [index, file] of migrations.entries()) {
      await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
      await db.query('INSERT INTO schema_migrations(version) VALUES($1)', [index + 1]);
    }
    const auth = new AuthService(db);
    const player = await auth.create('score_mismatch_player', 'test-password-only');
    const roomId = randomUUID();
    await db.query("INSERT INTO rooms(id,code,owner_id,variant_key,rule_version,rules,player_count,rounds,fee_mode,state) VALUES($1,'765432',$2,'2:0','legacy','{}',2,4,'aa','closed')", [roomId, player.id]);
    await db.query('INSERT INTO room_members(room_id,user_id,seat,score) VALUES($1,$2,1,0.125)', [roomId, player.id]);
    await assert.rejects(migrate(db), /Cannot remove room_members\.score/);
    assert.equal((await db.query('SELECT score::text FROM room_members WHERE room_id=$1', [roomId])).rows[0]!.score, '0.125');
    assert.deepEqual((await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(row => row.version), [1, 2, 3, 4, 5, 6]);
  } finally { await db.close(); }
});
