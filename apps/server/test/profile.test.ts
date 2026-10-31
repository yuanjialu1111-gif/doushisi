import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { DEFAULT_AVATAR_URL } from '../src/avatars.js';

const PASSWORD = 'test-password-only';
const MARKER = 'GPS-MARKER-30.6598N-104.0657E';

async function photo(color: string, withMetadata = false) {
  const image = sharp({ create: { width: 900, height: 600, channels: 3, background: color } });
  // 模拟手机照片：带 EXIF（含能识别出来的标记文字），服务端必须把它去掉（R9 AC1）。
  return (withMetadata ? image.withExif({ IFD0: { ImageDescription: MARKER, Copyright: MARKER } }) : image).jpeg().toBuffer();
}

async function setup(profileRequired = true) {
  const db = await openDatabase();
  await migrate(db);
  const created = await createApp(db, { staticFiles: false, scheduler: false, profileRequired });
  const player = async (username: string) => {
    const user = await created.auth.create(username, PASSWORD);
    const session = await created.auth.login(username, PASSWORD);
    return { user, headers: { authorization: `Bearer ${session.token}` } };
  };
  const upload = (headers: Record<string, string>, body: Buffer, type = 'image/jpeg') =>
    created.app.inject({ method: 'POST', url: '/api/me/avatar', headers: { ...headers, 'content-type': type }, payload: body });
  const save = (headers: Record<string, string>, payload: Record<string, unknown>) =>
    created.app.inject({ method: 'PUT', url: '/api/me/profile', headers, payload });
  const profile = async (headers: Record<string, string>) => (await created.app.inject({ method: 'GET', url: '/api/me/profile', headers })).json();
  return { ...created, db, player, upload, save, profile };
}

async function complete(ctx: Awaited<ReturnType<typeof setup>>, headers: Record<string, string>, nickname: string, color = '#3366cc') {
  assert.equal((await ctx.upload(headers, await photo(color))).statusCode, 200);
  const saved = await ctx.save(headers, { nickname, sex: 1 });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().complete, true);
}

test('R6 AC1/AC2: an account without a profile cannot create or join rooms until avatar, nickname and sex are set', async () => {
  const ctx = await setup();
  try {
    const first = await ctx.player('profile_gate_first');
    const view = await ctx.profile(first.headers);
    assert.equal(view.complete, false);
    assert.deepEqual(view.needs, { avatar: true, nickname: true, sex: true });
    assert.equal(view.avatarUrl, DEFAULT_AVATAR_URL);

    const blocked = await ctx.app.inject({ method: 'POST', url: '/api/rooms', headers: first.headers, payload: { variantKey: '4:0', options: {} } });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error.code, 'PROFILE_REQUIRED');

    // 只填昵称和性别、不传头像，仍然不算完成（不给预设头像）。
    assert.equal((await ctx.save(first.headers, { nickname: '张三丰', sex: 2 })).json().complete, false);
    assert.equal((await ctx.upload(first.headers, await photo('#cc3333'))).statusCode, 200);
    const done = await ctx.profile(first.headers);
    assert.equal(done.complete, true);
    assert.equal(done.sex, 2);
    assert.match(done.avatarUrl, /^\/media\/avatars\/[0-9a-f-]{36}-[0-9a-f]{32}\.jpg$/);

    const joinBlocked = await ctx.app.inject({ method: 'POST', url: '/api/rooms/join', headers: (await ctx.player('profile_gate_second')).headers, payload: { code: '123456' } });
    assert.equal(joinBlocked.json().error.code, 'PROFILE_REQUIRED');
  } finally { await ctx.app.close(); }
});

test('R6 AC3: nickname length, uniqueness and sensitive words are rejected with a reason', async () => {
  const ctx = await setup();
  try {
    const first = await ctx.player('nickname_rules_first');
    const second = await ctx.player('nickname_rules_second');
    for (const nickname of ['张', '一二三四五六七八', '   ', '😀😀']) {
      const response = await ctx.save(first.headers, { nickname });
      assert.equal(response.statusCode, 400, nickname);
      assert.equal(response.json().error.code, 'INVALID_NICKNAME');
      assert.ok(response.json().error.message.length > 0);
    }
    const sensitive = await ctx.save(first.headers, { nickname: '加V信 官方号' });
    assert.equal(sensitive.json().error.code, 'INVALID_NICKNAME');

    await complete(ctx, first.headers, 'Lucky七');
    // 不区分大小写算重名。
    assert.equal((await ctx.upload(second.headers, await photo('#22aa22'))).statusCode, 200);
    const taken = await ctx.save(second.headers, { nickname: 'lucky七', sex: 1 });
    assert.equal(taken.statusCode, 409);
    assert.equal(taken.json().error.code, 'NICKNAME_TAKEN');
    assert.equal((await ctx.profile(second.headers)).complete, false);

    const invalidSex = await ctx.save(second.headers, { sex: 3 });
    assert.equal(invalidSex.json().error.code, 'INVALID_SEX');
  } finally { await ctx.app.close(); }
});

test('R8 AC2: after setup a nickname can change once per 30 days and the reply names the next date', async () => {
  const ctx = await setup();
  try {
    const first = await ctx.player('nickname_cooldown');
    await complete(ctx, first.headers, '初始名');
    // 首次设置不计入 30 天，第一次改名可以。
    assert.equal((await ctx.save(first.headers, { nickname: '第一次改' })).statusCode, 200);
    const again = await ctx.save(first.headers, { nickname: '第二次改' });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error.code, 'NICKNAME_COOLDOWN');
    assert.match(again.json().error.message, /\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2}/);
    assert.ok((await ctx.profile(first.headers)).nicknameChangeableAt);

    await ctx.db.query("UPDATE accounts SET nickname_changed_at=now()-interval '31 days' WHERE id=$1", [first.user.id]);
    assert.equal((await ctx.save(first.headers, { nickname: '第二次改' })).statusCode, 200);
    // 性别随时能改，不受昵称冷却影响。
    assert.equal((await ctx.save(first.headers, { sex: 2 })).json().sex, 2);
  } finally { await ctx.app.close(); }
});

test('R9 AC1: uploads are re-encoded to at most 256px JPEG without the original metadata', async () => {
  const ctx = await setup();
  try {
    const first = await ctx.player('avatar_strip');
    const original = await photo('#884422', true);
    assert.ok((await sharp(original).metadata()).exif, 'fixture must carry EXIF');
    assert.ok(original.includes(Buffer.from(MARKER)));

    const uploaded = await ctx.upload(first.headers, original);
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const fetched = await ctx.app.inject({ method: 'GET', url: uploaded.json().avatarUrl });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.headers['content-type'], 'image/jpeg');
    assert.match(String(fetched.headers['cache-control']), /immutable/);
    const bytes = fetched.rawPayload;
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.ok(meta.width! <= 256 && meta.height! <= 256);
    assert.equal(meta.exif, undefined);
    assert.equal(meta.icc, undefined);
    assert.equal(bytes.includes(Buffer.from(MARKER)), false);

    // PNG 和 WebP 也能传，统一转成 JPEG。
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#00000000' } }).png().toBuffer();
    assert.equal((await ctx.upload(first.headers, png, 'image/png')).statusCode, 200);
  } finally { await ctx.app.close(); }
});

test('R9 AC4: oversize or non-image uploads explain why and keep the previous avatar', async () => {
  const ctx = await setup();
  try {
    const first = await ctx.player('avatar_bad_input');
    await complete(ctx, first.headers, '坏图测试');
    const before = (await ctx.profile(first.headers)).avatarUrl;

    const text = await ctx.upload(first.headers, Buffer.from('not an image at all'), 'image/jpeg');
    assert.equal(text.statusCode, 400);
    assert.equal(text.json().error.code, 'AVATAR_NOT_IMAGE');
    const wrongType = await ctx.app.inject({ method: 'POST', url: '/api/me/avatar', headers: { ...first.headers, 'content-type': 'text/plain' }, payload: 'hello' });
    assert.ok([400, 415].includes(wrongType.statusCode));
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    assert.equal((await ctx.upload(first.headers, gif, 'image/jpeg')).json().error.code, 'AVATAR_NOT_IMAGE');
    const huge = await ctx.upload(first.headers, Buffer.alloc(5 * 1024 * 1024 + 1, 1));
    assert.equal(huge.statusCode, 413);
    assert.ok(huge.json().error.message);

    assert.equal((await ctx.profile(first.headers)).avatarUrl, before);
    assert.equal((await ctx.profile(first.headers)).complete, true);
  } finally { await ctx.app.close(); }
});

test('R9: upload limits count per account, so players behind the public gateway (all 127.0.0.1) do not share one quota', async () => {
  const ctx = await setup();
  try {
    const first = await ctx.player('avatar_limit_first');
    const second = await ctx.player('avatar_limit_second');
    // 第一个人用满 10 分钟 20 次（传文本会被拒收，但照样计次），第二个人仍然能传。
    for (let i = 0; i < 20; i++) assert.equal((await ctx.upload(first.headers, Buffer.from('x'), 'text/plain')).statusCode, 415);
    assert.equal((await ctx.upload(first.headers, await photo('#cc3333'))).statusCode, 429);
    assert.equal((await ctx.upload(second.headers, await photo('#33aa66'))).statusCode, 200);
    // 每次换一个假令牌也绕不过去：没登录的请求合用一个额度。
    const forged = (n: number) => ({ authorization: `Bearer ${'f'.repeat(40)}${n}` });
    for (let i = 0; i < 20; i++) assert.equal((await ctx.upload(forged(i), Buffer.from('x'))).statusCode, 401);
    assert.equal((await ctx.upload(forged(99), Buffer.from('x'))).statusCode, 429);
    assert.equal((await ctx.upload(second.headers, await photo('#3366cc'))).statusCode, 200);
  } finally { await ctx.app.close(); }
});

test('R9 AC2/AC3: admins can reject avatars and nicknames, with an audit trail and a forced redo', async () => {
  const ctx = await setup();
  try {
    const admin = await ctx.auth.create('profile_review_admin', PASSWORD, 'deal_admin');
    const adminHeaders = { authorization: `Bearer ${(await ctx.auth.login(admin.username, PASSWORD, true)).token}` };
    const first = await ctx.player('profile_reviewed');
    const image = await photo('#5500aa');
    assert.equal((await ctx.upload(first.headers, image)).statusCode, 200);
    assert.equal((await ctx.save(first.headers, { nickname: '待审核', sex: 1 })).json().complete, true);
    const activeUrl = (await ctx.profile(first.headers)).avatarUrl;

    const listed = await ctx.app.inject({ method: 'GET', url: '/api/admin/avatars?page=1', headers: adminHeaders });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().items[0].avatarUrl, activeUrl);
    // 玩家不能调审核接口。
    assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/admin/users/${first.user.id}/avatar-rejection`, headers: first.headers, payload: { reason: 'x' } })).statusCode, 403);

    const rejected = await ctx.app.inject({ method: 'POST', url: `/api/admin/users/${first.user.id}/avatar-rejection`, headers: adminHeaders, payload: { reason: '不是本人照片' } });
    assert.equal(rejected.statusCode, 200, rejected.body);
    const afterAvatar = await ctx.profile(first.headers);
    assert.equal(afterAvatar.avatarUrl, DEFAULT_AVATAR_URL);
    assert.equal(afterAvatar.avatarStatus, 'rejected');
    assert.equal(afterAvatar.complete, false);
    assert.equal(afterAvatar.needs.avatar, true);
    const oldLink = await ctx.app.inject({ method: 'GET', url: activeUrl });
    assert.equal(oldLink.statusCode, 302);
    assert.equal(oldLink.headers.location, DEFAULT_AVATAR_URL);
    assert.equal(oldLink.headers['cache-control'], 'no-store');
    // 同一张图不能原样再传回去。
    assert.equal((await ctx.upload(first.headers, image)).json().error.code, 'AVATAR_REJECTED_BEFORE');
    assert.equal((await ctx.upload(first.headers, await photo('#0055aa'))).statusCode, 200);
    assert.equal((await ctx.profile(first.headers)).complete, true);

    const nickname = await ctx.app.inject({ method: 'POST', url: `/api/admin/users/${first.user.id}/nickname-rejection`, headers: adminHeaders, payload: { reason: '含广告' } });
    assert.equal(nickname.statusCode, 200, nickname.body);
    const afterNickname = await ctx.profile(first.headers);
    assert.equal(afterNickname.complete, false);
    assert.equal(afterNickname.needs.nickname, true);
    // 被驳回后重填不受 30 天限制，也不开始计时之外的额外限制。
    assert.equal((await ctx.save(first.headers, { nickname: '重新起名' })).json().complete, true);

    const audits = (await ctx.db.query("SELECT kind,actor_id,details FROM audit_events WHERE kind IN ('avatar_rejected','nickname_rejected') ORDER BY created_at")).rows;
    assert.deepEqual(audits.map(row => row.kind), ['avatar_rejected', 'nickname_rejected']);
    assert.ok(audits.every(row => row.actor_id === admin.id));
    assert.equal(JSON.stringify(audits[0]!.details).includes('不是本人照片'), true);
  } finally { await ctx.app.close(); }
});

test('R7 AC1/AC2: avatars appear in the admin list, friends list and room view, and a new upload changes the URL', async () => {
  const ctx = await setup(false);
  try {
    const beans = await ctx.auth.create('profile_outlets_beans', PASSWORD, 'beans_admin');
    const beansHeaders = { authorization: `Bearer ${(await ctx.auth.login(beans.username, PASSWORD, true)).token}` };
    const first = await ctx.player('profile_outlets_first');
    await complete(ctx, first.headers, '头像甲', '#aa0000');
    const url = (await ctx.profile(first.headers)).avatarUrl;

    const users = (await ctx.app.inject({ method: 'GET', url: '/api/admin/users?query=profile_outlets_first&page=1', headers: beansHeaders })).json().users;
    assert.equal(users[0].avatarUrl, url);

    const room = await ctx.rooms.create(first.user, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4, useCardType: 2 });
    const view = await ctx.rooms.view(room.id, first.user.id);
    assert.equal(view.members[0]!.avatarUrl, url);
    assert.equal('avatarHash' in view.members[0]!, false);

    assert.equal((await ctx.upload(first.headers, await photo('#00aa00'))).statusCode, 200);
    const changed = (await ctx.profile(first.headers)).avatarUrl;
    assert.notEqual(changed, url);
    assert.equal((await ctx.rooms.view(room.id, first.user.id)).members[0]!.avatarUrl, changed);
  } finally { await ctx.app.close(); }
});
