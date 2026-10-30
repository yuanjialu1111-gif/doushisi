import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultOptions } from '@dss/rules';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';

test('linked corrections preserve original entries, permissions, and retry identity', async () => {
  const db = await openDatabase();
  await migrate(db);
  await migrate(db);
  const { app, auth, ledger } = await createApp(db, { staticFiles: false });
  try {
    const beans = await auth.create('beans_linked', 'test-password-only', 'beans_admin');
    const dealer = await auth.create('dealer_linked', 'test-password-only', 'deal_admin');
    const player = await auth.create('player_linked', 'test-password-only');
    const other = await auth.create('other_linked', 'test-password-only');
    const login = await auth.login(beans.username, 'test-password-only', true);
    const dealerLogin = await auth.login(dealer.username, 'test-password-only', true);
    const headers = { authorization: `Bearer ${login.token}` };
    await ledger.adjust(beans, player.id, '5.125', 'original credit', 'linked-original-credit');
    const original = (await db.query('SELECT * FROM ledger_entries WHERE user_id=$1', [player.id])).rows[0]!;
    const request = { amount: '-0.125', reason: 'correct original credit', requestId: 'linked-correction-01', referenceEntryId: original.id };
    const url = `/api/admin/users/${player.id}/adjustments`;
    const post = (payload: Record<string, unknown>, targetUrl = url) => app.inject({ method: 'POST', url: targetUrl, headers, payload });
    const results = await Promise.all(Array.from({ length: 8 }, () => post(request)));
    assert.ok(results.every(result => result.statusCode === 200));
    assert.equal(new Set(results.map(result => result.json().operationId)).size, 1);
    assert.equal(await ledger.balance(player.id), '5');
    assert.deepEqual((await db.query('SELECT * FROM ledger_entries WHERE id=$1', [original.id])).rows[0], original);
    const listing = await app.inject({ method: 'GET', url: `/api/admin/users/${player.id}/ledger`, headers });
    assert.equal(listing.json().balance, '5');
    assert.equal(listing.json().beanBalance, '5');
    assert.equal(listing.json().entries.find((entry: any) => entry.referenceEntryId)?.referenceEntryId, original.id);
    const playerLogin = await auth.login(player.username, 'test-password-only');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${playerLogin.token}` } });
    assert.equal(me.json().beanBalance, '5');
    assert.equal(me.json().balance, me.json().beanBalance);
    const users = await app.inject({ method: 'GET', url: '/api/admin/users?query=player_linked&page=1', headers });
    assert.equal(users.json().users[0].beanBalance, '5');
    assert.equal(users.json().users[0].balance, users.json().users[0].beanBalance);
    const manualBaseRoom = await app.inject({ method: 'POST', url: '/api/rooms', headers: { authorization: `Bearer ${playerLogin.token}` },
      payload: { variantKey: '4:0', options: getDefaultOptions('4:0'), baseBeans: '0.125' } });
    assert.equal(manualBaseRoom.statusCode, 200);
    assert.equal(manualBaseRoom.json().baseBeans, '0.125');
    assert.equal(manualBaseRoom.json().baseBeansSource, 'manual');
    assert.equal((await post({ ...request, referenceEntryId: undefined })).json().error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await post({ ...request, amount: '1', requestId: 'linked-wrong-player' }, `/api/admin/users/${other.id}/adjustments`)).json().error.code, 'INVALID_ADJUSTMENT_REFERENCE');
    assert.equal((await post({ ...request, amount: '-6', requestId: 'linked-under-zero' })).json().error.code, 'INSUFFICIENT_BALANCE');
    assert.equal((await app.inject({ method: 'POST', url, payload: request, headers: { authorization: `Bearer ${dealerLogin.token}` } })).statusCode, 403);
    assert.equal((await post({ ...request, referenceEntryId: 'invalid', requestId: 'linked-malformed' })).statusCode, 400);
    assert.equal(await ledger.balance(player.id), '5');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM ledger_operations WHERE reference_entry_id=$1', [original.id])).rows[0]!.count, 1);
    await assert.rejects(db.query('TRUNCATE ledger_entries CASCADE'), /append-only/);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM ledger_entries')).rows[0]!.count, 2);
  } finally { await app.close(); await db.close(); }
});

test('asset bursts do not exhaust API limits while account endpoints remain limited', async () => {
  const db = await openDatabase();
  await migrate(db);
  const { app } = await createApp(db, { staticFiles: false });
  app.get('/client/test-asset', async () => 'asset');
  try {
    await app.ready();
    for (let count = 0; count < 320; count++) {
      assert.equal((await app.inject('/client/test-asset')).statusCode, 200);
    }
    assert.equal((await app.inject('/api/me')).statusCode, 401);
    for (let count = 0; count < 15; count++) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/admin/login', payload: {} })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/login', payload: {} })).statusCode, 429);
  } finally { await app.close(); await db.close(); }
});
