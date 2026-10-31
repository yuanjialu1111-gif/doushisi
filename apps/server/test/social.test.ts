import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { EngineRegistry } from '../src/engines.js';

// 第二轮 S3：加好友改成申请制。
async function setup() {
  const db = await openDatabase(); await migrate(db);
  const created = await createApp(db, { staticFiles: false, engines: new EngineRegistry([]), scheduler: false, rateLimit: false });
  const player = async (username: string, nickname = username.slice(-6), sex = 1) => {
    const user = await created.auth.create(username, 'test-password-only', 'player');
    await db.query("UPDATE accounts SET nickname=$2,sex=$3 WHERE id=$1", [user.id, nickname, sex]);
    const headers = { authorization: `Bearer ${(await created.auth.login(username, 'test-password-only')).token}` };
    return { id: user.id, headers, uid: await created.social.publicId(user.id) };
  };
  const call = async (method: 'GET' | 'POST', url: string, headers: Record<string, string>, payload?: unknown) => {
    const response = await created.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as any }) });
    return { status: response.statusCode, body: response.json() };
  };
  // 不走登录、直接写库的「路人」号，给好友上限用例凑人数。
  const filler = async (count: number) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const id = randomUUID(); ids.push(id);
      await db.query("INSERT INTO accounts(id,username,nickname,password_hash,role) VALUES($1,$2,$3,'x','player')", [id, `filler_${id.slice(0, 8)}`, `路人${index}`]);
    }
    return ids;
  };
  const setSettings = async (values: Record<string, number>) => {
    for (const [key, value] of Object.entries(values)) await db.query('INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [key, JSON.stringify(value)]);
    (created.settings as any).cache = null;
  };
  const playedTogether = async (ids: string[], daysAgo = 0) => {
    const roomId = randomUUID();
    await db.query(`INSERT INTO rooms(id,code,owner_id,variant_key,rule_version,rules,player_count,rounds,fee_mode,state,current_round,created_at)
      VALUES($1,'123456',$2,'4:0','v1','{}',$3,4,'aa','closed',4,now() - make_interval(days => $4))`, [roomId, ids[0], ids.length, daysAgo]);
    for (const [seat, id] of ids.entries()) await db.query('INSERT INTO room_members(room_id,user_id,seat) VALUES($1,$2,$3)', [roomId, id, seat]);
    return roomId;
  };
  return { ...created, db, player, call, filler, setSettings, playedTogether, close: async () => { await created.app.close(); await db.close(); } };
}

test('S3-AC1 按数字 ID 搜到头像、昵称、性别；搜不到回空；搜自己有标记', async () => {
  const ctx = await setup();
  try {
    const a = await ctx.player('social_search_a', '阿甲', 1);
    const b = await ctx.player('social_search_b', '阿乙', 2);
    const found = await ctx.call('GET', `/api/social/search?uid=${b.uid}`, a.headers);
    assert.equal(found.status, 200);
    assert.deepEqual({ uid: found.body.user.uid, nickname: found.body.user.nickname, sex: found.body.user.sex }, { uid: b.uid, nickname: '阿乙', sex: 2 });
    assert.match(found.body.user.avatarUrl, /^\//);
    assert.equal(found.body.user.isFriend, false);
    assert.equal(found.body.user.requested, false);
    assert.equal('id' in found.body.user, false, '不露账号 uuid');
    assert.equal((await ctx.call('GET', '/api/social/search?uid=99999999', a.headers)).body.user, null);
    assert.equal((await ctx.call('GET', '/api/social/search?uid=abc', a.headers)).body.user, null);
    assert.equal((await ctx.call('GET', `/api/social/search?uid=${a.uid}`, a.headers)).body.user.self, true);
    const mine = await ctx.call('GET', '/api/social/friends', a.headers);
    assert.equal(mine.body.myUid, a.uid);
  } finally { await ctx.close(); }
});

test('S3-AC2 申请要对方同意才成好友；拒绝后 24 小时内不能再申请；7 天没处理自动过期', async () => {
  const ctx = await setup();
  try {
    const a = await ctx.player('social_apply_a');
    const b = await ctx.player('social_apply_b');
    const c = await ctx.player('social_apply_c');
    const sent = await ctx.call('POST', '/api/social/requests', a.headers, { uid: b.uid });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal((await ctx.call('GET', '/api/social/friends', a.headers)).body.friends.length, 0, '对方没同意前不是好友');
    assert.equal((await ctx.call('POST', '/api/social/requests', a.headers, { uid: b.uid })).body.error.code, 'ALREADY_REQUESTED');
    assert.equal((await ctx.call('GET', `/api/social/search?uid=${b.uid}`, a.headers)).body.user.requested, true);
    assert.equal((await ctx.call('POST', '/api/social/requests', a.headers, { uid: a.uid })).body.error.code, 'CANNOT_ADD_SELF');

    const inbox = (await ctx.call('GET', '/api/social/requests', b.headers)).body;
    assert.equal(inbox.incoming.length, 1);
    assert.equal(inbox.incoming[0].user.uid, a.uid);
    assert.equal((await ctx.call('POST', `/api/social/requests/${inbox.incoming[0].id}/decide`, a.headers, { accept: true })).status, 404, '只有收到的人能处理');
    assert.equal((await ctx.call('POST', `/api/social/requests/${inbox.incoming[0].id}/decide`, b.headers, { accept: true })).body.status, 'accepted');
    assert.deepEqual((await ctx.call('GET', '/api/social/friends', a.headers)).body.friends.map((f: any) => f.uid), [b.uid]);
    assert.deepEqual((await ctx.call('GET', '/api/social/friends', b.headers)).body.friends.map((f: any) => f.uid), [a.uid]);
    assert.equal((await ctx.call('GET', '/api/social/requests', a.headers)).body.outgoing[0].status, 'accepted');
    assert.equal((await ctx.call('POST', '/api/social/requests', a.headers, { uid: b.uid })).body.error.code, 'ALREADY_FRIENDS');

    // 拒绝 → 24 小时冷却；冷却过了可以再申请。
    const toC = await ctx.call('POST', '/api/social/requests', a.headers, { uid: c.uid });
    assert.equal((await ctx.call('POST', `/api/social/requests/${toC.body.requestId}/decide`, c.headers, { accept: false })).body.status, 'rejected');
    assert.equal((await ctx.call('POST', '/api/social/requests', a.headers, { uid: c.uid })).body.error.code, 'REJECT_COOLDOWN');
    await ctx.db.query("UPDATE friend_requests SET decided_at=now() - interval '25 hours' WHERE id=$1", [toC.body.requestId]);
    const again = await ctx.call('POST', '/api/social/requests', a.headers, { uid: c.uid });
    assert.equal(again.status, 200, JSON.stringify(again.body));

    // 超过 7 天没人处理 → 过期：收件箱看不到、同意不了、可以重新申请。
    await ctx.db.query("UPDATE friend_requests SET created_at=now() - interval '8 days' WHERE id=$1", [again.body.requestId]);
    assert.equal((await ctx.call('GET', '/api/social/requests', c.headers)).body.incoming.length, 0);
    assert.equal((await ctx.call('POST', `/api/social/requests/${again.body.requestId}/decide`, c.headers, { accept: true })).body.error.code, 'REQUEST_HANDLED');
    assert.equal((await ctx.db.query('SELECT status FROM friend_requests WHERE id=$1', [again.body.requestId])).rows[0]!.status, 'expired');
    assert.equal((await ctx.call('POST', '/api/social/requests', a.headers, { uid: c.uid })).status, 200);

    // 对方已经申请过我，我再申请就直接成为好友。
    const d = await ctx.player('social_apply_d');
    await ctx.call('POST', '/api/social/requests', d.headers, { uid: c.uid });
    const mutual = await ctx.call('POST', '/api/social/requests', c.headers, { uid: d.uid });
    assert.equal(mutual.body.autoAccepted, true);
    assert.deepEqual((await ctx.call('GET', '/api/social/friends', d.headers)).body.friends.map((f: any) => f.uid), [c.uid]);
  } finally { await ctx.close(); }
});

test('S3-AC3 好友上限、每天申请数、每分钟搜索次数都按后台参数拦住', async () => {
  const ctx = await setup();
  try {
    await ctx.setSettings({ friendLimit: 10, dailyFriendRequests: 2, searchPerMinute: 3 });
    const a = await ctx.player('social_limit_a');
    const b = await ctx.player('social_limit_b');
    const c = await ctx.player('social_limit_c');
    const d = await ctx.player('social_limit_d');

    for (let index = 0; index < 3; index++) assert.equal((await ctx.call('GET', `/api/social/search?uid=${b.uid}`, a.headers)).status, 200);
    const limited = await ctx.call('GET', `/api/social/search?uid=${b.uid}`, a.headers);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'SEARCH_RATE_LIMITED');
    assert.equal((await ctx.call('GET', `/api/social/search?uid=${a.uid}`, b.headers)).status, 200, '按人计，不影响别人');

    assert.equal((await ctx.call('POST', '/api/social/requests', a.headers, { uid: b.uid })).status, 200);
    assert.equal((await ctx.call('POST', '/api/social/requests', a.headers, { uid: c.uid })).status, 200);
    const daily = await ctx.call('POST', '/api/social/requests', a.headers, { uid: d.uid });
    assert.equal(daily.body.error.code, 'DAILY_REQUEST_LIMIT');

    // b 的好友满 10 人：别人申请被拦，b 去同意也被拦。
    for (const id of await ctx.filler(10)) await ctx.db.query('INSERT INTO friends(user_id,friend_id) VALUES($1,$2),($2,$1)', [b.id, id]);
    assert.equal((await ctx.call('POST', '/api/social/requests', d.headers, { uid: b.uid })).body.error.code, 'TARGET_FRIEND_LIMIT');
    assert.equal((await ctx.call('POST', '/api/social/requests', b.headers, { uid: d.uid })).body.error.code, 'FRIEND_LIMIT');
    const pending = (await ctx.call('GET', '/api/social/requests', b.headers)).body.incoming[0];
    assert.equal((await ctx.call('POST', `/api/social/requests/${pending.id}/decide`, b.headers, { accept: true })).body.error.code, 'FRIEND_LIMIT');
    assert.equal((await ctx.call('GET', '/api/social/friends', a.headers)).body.friends.length, 0);
  } finally { await ctx.close(); }
});

test('S3-AC4 同桌打完不自动加好友，对方出现在最近同桌（7 天内、排除已是好友）', async () => {
  const ctx = await setup();
  try {
    const a = await ctx.player('social_recent_a');
    const b = await ctx.player('social_recent_b');
    const c = await ctx.player('social_recent_c');
    const old = await ctx.player('social_recent_old');
    await ctx.playedTogether([a.id, b.id, c.id]);
    await ctx.playedTogether([a.id, old.id], 9);
    assert.equal((await ctx.call('GET', '/api/social/friends', a.headers)).body.friends.length, 0);
    const recent = (await ctx.call('GET', '/api/social/recent', a.headers)).body.players;
    assert.deepEqual(new Set(recent.map((p: any) => p.uid)), new Set([b.uid, c.uid]), '9 天前的不算');
    assert.equal(recent.every((p: any) => p.requested === false), true);

    const sent = await ctx.call('POST', '/api/social/requests', a.headers, { uid: b.uid, source: 'recent' });
    assert.equal((await ctx.call('GET', '/api/social/recent', a.headers)).body.players.find((p: any) => p.uid === b.uid).requested, true);
    await ctx.call('POST', `/api/social/requests/${sent.body.requestId}/decide`, b.headers, { accept: true });
    assert.deepEqual((await ctx.call('GET', '/api/social/recent', a.headers)).body.players.map((p: any) => p.uid), [c.uid], '成了好友就不在最近同桌');
    assert.equal((await ctx.call('GET', '/api/social/friends', a.headers)).body.friends[0].source, 'recent');
  } finally { await ctx.close(); }
});

test('S3-AC5 老的同桌好友保留，来源显示同桌对局；好友列表带在线状态 离线 / 空闲 / 打牌中', async () => {
  const ctx = await setup();
  try {
    const a = await ctx.player('social_status_a');
    const idle = await ctx.player('social_status_idle');
    const busy = await ctx.player('social_status_busy');
    const away = await ctx.player('social_status_away');
    const roomId = await ctx.playedTogether([a.id, idle.id]);
    // 迁移前自动加的老好友：有首次同桌房间、没有来源。
    for (const friend of [idle, busy, away]) await ctx.db.query('INSERT INTO friends(user_id,friend_id,first_room_id) VALUES($1,$2,$3)', [a.id, friend.id, roomId]);
    const playing = await ctx.playedTogether([busy.id, away.id]);
    await ctx.db.query("UPDATE rooms SET state='playing',current_round=2 WHERE id=$1", [playing]);
    for (const friend of [idle, busy]) ctx.live.set(friend.id, new Set([{ close() {} } as any]));

    const list = (await ctx.call('GET', '/api/social/friends', a.headers)).body.friends;
    assert.deepEqual(list.map((f: any) => [f.uid, f.status]), [[idle.uid, 'idle'], [busy.uid, 'playing'], [away.uid, 'offline']]);
    assert.deepEqual(list[1].round, { current: 2, total: 4 });
    assert.equal(list.every((f: any) => f.source === 'table'), true);
    assert.equal(list[0].sex, 1);
  } finally { await ctx.close(); }
});
