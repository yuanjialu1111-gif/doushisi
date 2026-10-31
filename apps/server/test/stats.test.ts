import { encodeFixtureFrame as encodeFrame } from './fixture-options.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { decodeFrame, MSGEvent, type DecodedFrame } from '@dss/protocol';
import { openDatabase, migrate } from '../src/database.js';
import { createApp } from '../src/app.js';
import { EngineRegistry, type EnginePlayer, type RuleEngine, type RoundInput } from '../src/engines.js';
import { winRate } from '../src/stats.js';

// 第二轮 S6：个人资料的真实战绩和勋章。
// 只测战绩和勋章的记账，不涉及任何地方玩法：一步就结算，delta 给第一个座位，其他座位记相反数。
interface Snapshot { players: EnginePlayer[]; number: number; finished: boolean }
const fixtureEngine: RuleEngine = {
  variantKey: '4:0', version: 'test-fixture-v1',
  evidence: { status: 'verified', referenceDigest: 'test-only-infrastructure-fixture-no-gameplay-evidence' },
  create(input: RoundInput): Snapshot { return { players: input.players, number: input.number, finished: false }; },
  apply(raw, _userId, rawAction) {
    const snapshot = raw as Snapshot; const delta = (rawAction as { delta: string }).delta;
    const settlement = snapshot.players.map((player, index) => ({ userId: player.userId, amount: index === 0 ? delta : delta.startsWith('-') ? delta.slice(1) : delta === '0' ? '0' : `-${delta}` }));
    return { snapshot: { ...snapshot, finished: true }, events: [{ type: 'settled' }], confirmedScores: [{ eventId: 'terminal-score', postings: settlement }], settlement };
  },
  view(raw, userId) { return { number: (raw as Snapshot).number, viewer: userId }; },
};

async function setup() {
  const db = await openDatabase(); await migrate(db);
  const created = await createApp(db, { staticFiles: false, engines: new EngineRegistry([fixtureEngine]), scheduler: false, rateLimit: false });
  const admin = await created.auth.create('beans_stats', 'test-password-only', 'beans_admin');
  const player = async (username: string) => {
    const user = await created.auth.create(username, 'test-password-only', 'player');
    await created.ledger.adjust(admin, user.id, '100', 'test opening balance', `${username}-opening`);
    const token = (await created.auth.login(username, 'test-password-only')).token;
    return { ...user, token, headers: { authorization: `Bearer ${token}` } };
  };
  const profile = async (headers: Record<string, string>) => {
    const response = await created.app.inject({ method: 'GET', url: '/api/me/profile-stats', headers });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const setSettings = async (values: Record<string, number>) => {
    for (const [key, value] of Object.entries(values)) await db.query('INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [key, JSON.stringify(value)]);
    (created.settings as any).cache = null;
  };
  // 两人开一桌，按给的 delta 一局一局打完（delta 记给 1 号座位）。
  const play = async (players: Awaited<ReturnType<typeof player>>[], deltas: string[]) => {
    const room = await created.rooms.create(players[0]!, '4:0', { baseBeans: '0.1', playerNum: 2, gameNum: 4, useCardType: 2 });
    await created.rooms.join(players[1]!, room.code);
    for (const delta of deltas) await next(players, room.id, delta);
    return room;
  };
  // 同一桌接着打下一局。
  let serial = 0;
  const next = async (players: Awaited<ReturnType<typeof player>>[], roomId: string, delta: string) => {
    await created.rooms.ready(players[0]!, roomId, true);
    const playing = await created.rooms.ready(players[1]!, roomId, true);
    await created.rooms.action(players[0]!, roomId, `stats-round-${++serial}`, { delta }, playing.stateVersion!, playing.roundId!);
  };
  return { db, created, admin, player, profile, setSettings, play, next };
}

test('S6-AC1 win rate rounds to a whole percent and is 0% before any round', () => {
  assert.equal(winRate(0, 0), '0%');
  assert.equal(winRate(3, 1), '33%');
  assert.equal(winRate(3, 2), '67%');
  assert.equal(winRate(8, 1), '13%');
  assert.equal(winRate(4, 4), '100%');
});

test('S6 profile stats and medals', async t => {
  const { db, created, admin, player, profile, setSettings, play, next } = await setup();
  t.after(async () => { await created.app.close(); await db.close(); });

  await t.test('S6-AC1 play 3 rounds win 1 shows 3 / 1 / 33%; a 0-score round counts as played but not won', async () => {
    const [a, b] = [await player('stats_a'), await player('stats_b')];
    const before = await profile(a.headers);
    assert.deepEqual([before.rounds, before.wins, before.winRate], [0, 0, '0%']);
    await play([a, b], ['0.1', '-0.1', '-0.1']);
    const mine = await profile(a.headers), theirs = await profile(b.headers);
    assert.deepEqual([mine.rounds, mine.wins, mine.winRate], [3, 1, '33%']);
    assert.deepEqual([theirs.rounds, theirs.wins, theirs.winRate], [3, 2, '67%']);
    // 同一桌第 4 局打平：局数加一，胜局不变。
    await next([a, b], (await db.query('SELECT id FROM rooms WHERE owner_id=$1', [a.id])).rows[0]!.id, '0');
    const after = await profile(a.headers);
    assert.deepEqual([after.rounds, after.wins, after.winRate], [4, 1, '25%']);
  });

  await t.test('S6-AC2 round medals light right after settlement from admin thresholds; unlit ones carry progress and a hint', async () => {
    await setSettings({ medalQiantuRounds: 2, medalBaishengWins: 100 });
    const [c, d] = [await player('stats_c'), await player('stats_d')];
    const room = await play([c, d], ['0.1']);
    const lit = async (id: string) => (await db.query('SELECT medal FROM account_medals WHERE account_id=$1 ORDER BY medal', [id])).rows.map(row => row.medal);
    assert.deepEqual(await lit(c.id), []);
    await next([c, d], room.id, '0.1');
    // 没打开资料、没重新登录，结算那一刻就点亮了。
    assert.deepEqual(await lit(c.id), ['qiantu']);
    assert.deepEqual(await lit(d.id), ['qiantu']);
    const view = await profile(c.headers);
    assert.equal(view.lit, 1);
    assert.deepEqual(view.medals.map((medal: any) => medal.key), ['qiantu', 'baisheng', 'qiansheng', 'fujia', 'baiwan', 'qianwan']);
    assert.deepEqual(view.medals.map((medal: any) => medal.name), ['前途无量', '百胜王', '千胜王', '富甲一方', '百万富翁', '千万富翁']);
    const baisheng = view.medals[1];
    assert.deepEqual([baisheng.lit, baisheng.value, baisheng.need, baisheng.hint, baisheng.unlockedAt], [false, 2, 100, '赢 100 局', null]);
    assert.ok(view.medals[0].unlockedAt);
    assert.equal(view.medals[5].hint, '豆子 1000 万');
  });

  await t.test('S6-AC2/AC3 raising beans to 10,000 lights 富甲一方 and deducting them again keeps it lit', async () => {
    const e = await player('stats_e');
    let view = await profile(e.headers);
    assert.deepEqual([view.beans, view.medals[3].lit, view.medals[3].value, view.medals[3].need, view.medals[3].hint], [100, false, 100, 10_000, '豆子 1 万']);
    await created.ledger.adjust(admin, e.id, '9900', 'medal test top up', 'stats-e-topup');
    view = await profile(e.headers);
    assert.deepEqual([view.beans, view.medals[3].lit, view.lit], [10_000, true, 1]);
    await created.ledger.adjust(admin, e.id, '-9950', 'medal test deduct', 'stats-e-deduct');
    view = await profile(e.headers);
    assert.deepEqual([view.beans, view.medals[3].lit, view.medals[3].value, view.lit], [50, true, 50, 1]);
    assert.equal(view.medals[4].lit, false);
  });

  await t.test('S6-AC1 the original login and head-info replies carry the real win rate', async () => {
    const [f, g] = [await player('stats_f'), await player('stats_g')];
    await play([f, g], ['0.1', '-0.1', '-0.1']);
    const address = (await created.app.listen({ host: '127.0.0.1', port: 0 })).replace('http', 'ws') + '/ws/original';
    const socket = new WebSocket(address);
    const inbox: DecodedFrame[] = [];
    socket.on('message', bytes => inbox.push(decodeFrame(bytes as Buffer)));
    await once(socket, 'open');
    const request = (command: number, body: Record<string, unknown>, response: number) => new Promise<any>((resolve, reject) => {
      const start = inbox.length; socket.send(encodeFrame({ cmd: command, protoVersion: 2 }, body));
      const timer = setInterval(() => { const found = inbox.slice(start).find(frame => frame.cmd === response); if (found) { clearInterval(timer); clearTimeout(limit); resolve(found.data); } }, 10);
      const limit = setTimeout(() => { clearInterval(timer); reject(new Error(`No wire message ${response}`)); }, 5000);
    });
    try {
      const login = (await request(MSGEvent.HWRequestGameLogin, { hwRequestGameLogin: { token: f.token } }, MSGEvent.HWResponseGameLogin)).hwResponseGameLogin;
      assert.equal(login.winRate, '33%');
      const head = (await request(MSGEvent.HWRequestHeadInfo, { hwRequestHeadInfo: {} }, MSGEvent.HWResponseHeadInfo)).hwResponseHeadInfo;
      assert.deepEqual([head.gameNum, head.winNum, head.winRate], [3, 1, '33%']);
    } finally { socket.close(); await once(socket, 'close'); }
  });
});
