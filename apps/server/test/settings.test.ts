import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { EngineRegistry } from '../src/engines.js';

async function setup() {
  const db = await openDatabase(); await migrate(db);
  const created = await createApp(db, { staticFiles: false, engines: new EngineRegistry([]), scheduler: false, rateLimit: false });
  const login = async (username: string, role: 'player' | 'beans_admin' | 'deal_admin') => {
    await created.auth.create(username, 'test-password-only', role);
    return { authorization: `Bearer ${(await created.auth.login(username, 'test-password-only', role !== 'player')).token}` };
  };
  return { ...created, db, login };
}

test('M0 后台改参数立刻生效，越界和不认识的键被拒绝，改动记审计', async () => {
  const { app, db, settings, login } = await setup();
  try {
    const beans = await login('settings_beans', 'beans_admin');
    // 第三轮 R6：好友、私聊邀请的参数后台不再列出（库里的值留着），勋章参数整组去掉。
    const listed = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: beans })).json();
    assert.equal(listed.settings.length, 0);
    assert.equal((await settings.get()).friendLimit, 200);

    const saved = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: beans, payload: { values: { friendLimit: 150, inviteSeconds: 90 } } });
    assert.equal(saved.statusCode, 200);
    assert.equal((await settings.get()).friendLimit, 150);
    assert.equal((await settings.get()).inviteSeconds, 90);
    const audit = (await db.query("SELECT details FROM audit_events WHERE kind='settings_changed'")).rows;
    assert.equal(audit.length, 1);
    assert.deepEqual(audit[0]!.details.changes.friendLimit, { before: 200, after: 150 });

    for (const values of [{ friendLimit: 5 }, { friendLimit: 1.5 }, { friendLimit: '200' }, { unknownKey: 1 }, {}]) {
      const rejected = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: beans, payload: { values } });
      assert.equal(rejected.statusCode, 400, JSON.stringify(values));
    }
    assert.equal((await settings.get()).friendLimit, 150);
  } finally { await app.close(); await db.close(); }
});

test('M0 参数页只给豆子管理员', async () => {
  const { app, db, login } = await setup();
  try {
    for (const headers of [await login('settings_player', 'player'), await login('settings_deal', 'deal_admin')]) {
      assert.equal((await app.inject({ method: 'GET', url: '/api/admin/settings', headers })).statusCode, 403);
      assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: { values: { friendLimit: 300 } } })).statusCode, 403);
    }
  } finally { await app.close(); await db.close(); }
});

test('M0 库里存了越界旧值时按默认值读', async () => {
  const { app, db, settings } = await setup();
  try {
    await db.query("INSERT INTO app_settings(key,value) VALUES('friendLimit','99999'),('removedKey','1')");
    assert.equal((await settings.get()).friendLimit, 200);
  } finally { await app.close(); await db.close(); }
});
