const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const output = path.resolve(__dirname, '../client/validation/replay-fixtures');

function makeReplay(uid) {
  const roomId = randomUUID(), roundId = randomUUID();
  const manifestUrl = `/api/records/${roomId}/replay/${roundId}/original`;
  const hand = [101, 113, 202, 212, 303, 311, 404, 410, 105, 109, 206, 208, 107];
  const users = [uid, '800002', '800003'].map((id, index) => ({ uid: id, nick: ['Replay A', 'Replay B', 'Replay C'][index], picUrl: '/client/standalone/default-avatar.png', seatIndex: index + 1, online: true, score: '0', sex: 0 }));
  function snapshot(index) {
    return { command: 48, body: { result: 1, tableInfo: { roomId: 123456, roomType: 100, areaType: 2, creatorUid: uid, playerNum: 3, gameNum: 4, useCardType: 2, basicTimes: 1, wangNum: 6 },
      userInfo: users, seatIndex: 1, tableState: 1, round: 1, leftCardNum: 21, gameStart: { round: 1, dealer: 1, leftTileNum: 21, seats: users.map((_, seat) => ({ seatIndex: seat + 1, tilesOnHand: seat ? [] : hand.slice(index >= 1 ? 1 : 0), tilesOnHandNum: seat ? 12 : index >= 1 ? 12 : 13, outCardsNo: seat || index < 2 ? [] : [101], redPoint: 21, blackPoint: 9, auto: false })) } }, decimalFields: users.map((_, index) => ({ path: ['hwResponseEnterTableFinish', 'userInfo', index, 'score'], value: index === 0 ? '0.125' : index === 1 ? '-0.125' : '0' })) };
  }
  const packets = [[], [{ command: 25, body: { action: { seatIndex: 1, actType: 3, destCard: 101, tilesOnHandNum: 12, redPoint: 20 } }, decimalFields: [] }],
    [{ command: 25, body: { action: { seatIndex: 1, actType: 1, destCard: 101, tilesOnHandNum: 12, redPoint: 20 } }, decimalFields: [] }],
    [{ command: 123, body: {}, decimalFields: [] }], [{ command: 126, body: { result: 1 }, decimalFields: [] }],
    [{ command: 32, body: {}, decimalFields: [] }]];
  const frames = packets.map((packets, index) => ({ index, sequence: String(index + 1), stateVersion: index, at: new Date(1788840000000 + index * 2000).toISOString(), autoPlay: index === 3, snapshot: snapshot(index), packets }));
  const digest = createHash('sha256').update(JSON.stringify(frames)).digest('hex');
  const manifest = { version: 1, roomId, roundId, variantKey: '2:0', ruleVersion: 'synthetic-ui-only-v1', number: 1, endReason: 'dissolved', digest, frameCount: frames.length, framesUrl: manifestUrl + '/frames', initial: frames[0], limits: { maxPageFrames: 50, maxPageBytes: 1048576 } };
  return { reference: { version: 1, roomId, roundId, manifestUrl }, manifest, frames };
}

(async () => {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = { at: new Date().toISOString(), fixtureOnly: true, scope: 'Synthetic authenticated HTTP projections exercise retained original Cocos replay controls and animations. No production rules, real completed round or original-server comparison is claimed.', views: [], errors: [], outsideRequests: [] };
  try {
    for (const viewport of [{ width: 1334, height: 750 }, { width: 844, height: 390 }]) {
      const credentials = { username: `replay_${Date.now()}_${viewport.width}`, password: randomBytes(18).toString('base64url') };
      const registered = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
      assert.equal(registered.ok, true);
      const page = await browser.newPage({ viewport });
      page.on('pageerror', error => report.errors.push(error.stack));
      page.on('request', request => { if (!request.url().startsWith(base + '/')) report.outsideRequests.push(request.url()); });
      await page.goto(base + '/client/');
      await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
      await page.evaluate(credentials => {
        const controller = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
        controller.views['accountLogin/accountid/editbox'].getComponent(cc.EditBox).string = credentials.username;
        controller.views['accountLogin/passworld/editbox'].getComponent(cc.EditBox).string = credentials.password;
        controller.onClick_toGame();
      }, credentials);
      await page.waitForFunction(() => !!cc.mm.uimanager.getWindow('HallUI'));
      const replay = makeReplay(await page.evaluate(() => String(cc.mm.framemodel.uid)));
      const requests = [];
      await page.route(base + replay.reference.manifestUrl + '**', async route => {
        const request = route.request(), url = new URL(request.url());
        assert.match(request.headers().authorization || '', /^Bearer .+/);
        requests.push(url.pathname + url.search);
        const offset = Number(url.searchParams.get('offset'));
        const frames = replay.frames.slice(offset, offset + 2);
        const body = url.pathname.endsWith('/frames') ? { version: 1, digest: replay.manifest.digest, frameCount: replay.frames.length, offset, nextOffset: offset + frames.length < replay.frames.length ? offset + frames.length : null, frames } : replay.manifest;
        await route.fulfill({ json: body });
      });
      await page.evaluate(reference => {
        window.__replayWire = []; window.__replayPackets = [];
        const send = cc.mm.server._ws.send;
        cc.mm.server._ws.send = function (bytes) { window.__replayWire.push(Array.from(bytes)); return send.apply(this, arguments); };
        const distribute = Standalone.distributeWireMessage;
        Standalone.distributeWireMessage = function (message) { if (message.replayGeneration !== undefined) window.__replayPackets.push(message.code); return distribute.apply(this, arguments); };
        return StandaloneReplay.load(reference);
      }, replay.reference);
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('CommonRePlay')?._standaloneReplaySession?.controller && cc.mm.uimanager.getWindow('dss_game')?.model.getSelf()?.hand_cards.length === 13);
      await page.evaluate(() => cc.mm.uimanager.getWindow('CommonRePlay').onClick_bofang());
      await page.waitForTimeout(150);
      async function state() {
        return page.evaluate(() => {
          const controller = cc.mm.uimanager.getWindow('CommonRePlay'), game = cc.mm.uimanager.getWindow('dss_game');
          return { active: StandaloneReplay.active(), index: controller._standaloneReplaySession.index, playing: controller.isPlay, speed: controller.speed, progress: controller.views.slider.getComponent(cc.Slider).progress, hands: game.model.getSelf().hand_cards.slice(), auto: game.model.getSelf().auto, scores: Object.values(game.model.players).map(player => player.score), hiddenHands: Object.values(game.players).filter(player => player?._model && !player._model.isSelf()).map(player => ({ count: player._model.holdlen, private: player._model.hand_cards.length, backdrop: player.handNodebg?.active })), live: Standalone.hasLiveRoom() };
        });
      }
      const initial = await state();
      assert.equal(initial.playing, false); assert.equal(initial.live, false);
      assert.deepEqual(initial.scores, ['0.125', '-0.125', '0']);
      assert.ok(initial.hiddenHands.every(hand => hand.count === 12 && hand.private === 0 && hand.backdrop === false));
      await page.screenshot({ path: path.join(output, `initial-${viewport.width}.png`) });
      await page.waitForTimeout(2100);
      assert.equal((await state()).index, 0, 'Pause must stop progression');
      await page.evaluate(() => { const c = cc.mm.uimanager.getWindow('CommonRePlay'); c.onClick_kuaijin(); c.onClick_kuaijin(); c.onClick_houtui(); c.onClick_bofang(); c.continue(); });
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('CommonRePlay')._standaloneReplaySession.index === 1);
      await page.evaluate(() => cc.mm.uimanager.getWindow('CommonRePlay').onClick_bofang());
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game').model.getSelf().hand_cards.length === 12);
      await page.screenshot({ path: path.join(output, `moving-${viewport.width}.png`) });
      const advanced = await state(); assert.equal(advanced.speed, 2); assert.ok(!advanced.hands.includes(101));
      await page.evaluate(() => cc.mm.uimanager.getWindow('CommonRePlay').onSlider_progress({ progress: 0.6 }));
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('CommonRePlay')._standaloneReplaySession.index === 3);
      const seek = await state(); assert.equal(seek.auto, true); assert.equal(seek.playing, false);
      assert.equal(await page.evaluate(() => cc.mm.uimanager.getWindow('dss_game').views.tg_bg.active), false);
      await page.screenshot({ path: path.join(output, `seek-${viewport.width}.png`) });
      await page.evaluate(() => cc.mm.server.loginLogic());
      await page.waitForTimeout(600);
      assert.equal((await state()).index, 3, 'Reauthentication must preserve replay position');
      assert.equal((await state()).auto, true);
      await page.evaluate(() => cc.mm.uimanager.getWindow('CommonRePlay').onSlider_progress({ progress: 1 }));
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('CommonRePlay').views.replay.active);
      assert.equal((await state()).index, 5); assert.equal((await state()).auto, false);
      await page.screenshot({ path: path.join(output, `end-${viewport.width}.png`) });
      const blocked = await page.evaluate(() => {
        const before = window.__replayWire.length;
        for (const command of [23, 53, 121, 125, 29, 9, 39]) cc.mm.server.send({}, command, cc.mm.framemodel.uid);
        return window.__replayWire.length === before;
      });
      assert.equal(blocked, true);
      await page.evaluate(() => cc.mm.uimanager.getWindow('CommonRePlay').onClick_replay());
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('CommonRePlay')._standaloneReplaySession.index === 0);
      assert.equal((await state()).hands.length, 13);
      await page.evaluate(() => cc.mm.uimanager.getWindow('CommonRePlay').onClick_tohall());
      await page.waitForFunction(() => !!cc.mm.uimanager.getWindow('HallUI'));
      assert.equal(await page.evaluate(() => StandaloneReplay.active()), false);
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => !!cc.mm.uimanager.getWindow('HallUI')), true);
      const stats = await sharp(path.join(output, `initial-${viewport.width}.png`)).stats();
      assert.ok(stats.channels.some(channel => channel.stdev > 20));
      report.views.push({ viewport, initial, advanced, seek, blocked, requests, packets: await page.evaluate(() => window.__replayPackets), canvasStandardDeviation: stats.channels.map(channel => channel.stdev) });
      await page.close();
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.outsideRequests, []);
    report.passed = true;
  } finally {
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify({ passed: true, fixtureOnly: true, viewports: report.views.length }));
})().catch(error => { console.error(error); process.exitCode = 1; });
