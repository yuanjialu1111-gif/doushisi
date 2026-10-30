const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const { randomBytes } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const output = path.resolve(__dirname, '../client/validation/location-fixtures');
async function api(route, token, payload) {
  const response = await fetch(base + '/api' + route, { method: payload ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
(async () => {
  await mkdir(output, { recursive: true });
  const players = [];
  let room, browser;
  const report = { at: new Date().toISOString(), passed: false, scope: 'Controlled original Cocos GPS window; no real coordinates or completed gameplay.', cases: [], errors: [] };
  try {
    for (let index = 0; index < 3; index++) {
      const credentials = { username: `loc_${randomBytes(8).toString('hex')}`, password: randomBytes(18).toString('base64url') };
      await api('/auth/register', null, credentials);
      const session = await api('/auth/login', null, credentials);
      players.push({ ...credentials, token: session.token });
    }
    room = await api('/rooms', players[0].token, { variantKey: '4:0', options: { baseBeans: '0.1', gameNum: 4, playerNum: 4 } });
    await api('/rooms/join', players[1].token, { code: room.code });
    await api('/rooms/join', players[2].token, { code: room.code });
    await api(`/rooms/${room.id}/leave`, players[1].token, {});
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const viewport of [{ width: 1334, height: 750 }, { width: 844, height: 390 }]) {
      const page = await browser.newPage({ viewport });
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(base + '/client/');
      await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
      await page.evaluate(({ username, password }) => {
        const controller = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
        controller.views['accountLogin/accountid/editbox'].getComponent(cc.EditBox).string = username;
        controller.views['accountLogin/passworld/editbox'].getComponent(cc.EditBox).string = password;
        controller.onClick_toGame();
      }, players[0]);
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game')?.model.players[3]);
      await page.waitForFunction(() => !cc.mm.uimanager.windows.CommonPlayUI || cc.mm.uimanager.getWindow('CommonPlayUI'));
      await page.evaluate(() => {
        if (cc.mm.uimanager.getWindow('CommonPlayUI')) cc.mm.uimanager.closewindow('CommonPlayUI');
        const model = cc.mm.uimanager.getWindow('dss_game').model;
        model.location = [{ seatIndex_1: 1, seatIndex_2: 3, distance: 111195 }];
        cc.mm.uimanager.showWindow(cc.mm.config.resources, 'LocationUI', model);
      });
      await page.waitForFunction(() => {
        const view = cc.mm.uimanager.getWindow('LocationUI');
        return view?.views['view/1-3'].getComponent(cc.Label).string === cc.mm.gamefunc.kmUnit(111195) && Math.abs(view.views.view.scaleX - 1) < 0.001;
      });
      await page.waitForFunction(() => [1, 3].every(seat => cc.mm.uimanager.getWindow('LocationUI').views['view/pos' + seat].getComponent(cc.Sprite).spriteFrame?.getOriginalSize().width === 128));
      const state = await page.evaluate(() => {
        const view = cc.mm.uimanager.getWindow('LocationUI');
        return { occupied: [1, 2, 3, 4].filter(seat => view.views['view/pos' + seat].active), text: view.views['view/1-3'].getComponent(cc.Label).string };
      });
      assert.deepEqual(state.occupied, [1, 3]);
      const initialImage = path.join(output, `distance-${viewport.width}.png`);
      await page.screenshot({ path: initialImage });
      const pixels = await sharp(initialImage).stats();
      assert.ok(pixels.channels.slice(0, 3).some(channel => channel.stdev > 20), 'Original scene is nonblank');
      await page.evaluate(() => cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyLocation, { distInfo: [] }));
      await page.waitForFunction(() => {
        const view = cc.mm.uimanager.getWindow('LocationUI');
        return Object.keys(view.views).filter(key => /^view\/[1-4]-[1-4]$/.test(key)).every(key => view.views[key].getComponent(cc.Label).string === '');
      });
      await page.screenshot({ path: path.join(output, `unavailable-${viewport.width}.png`) });
      await page.evaluate(() => cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyLocation, { distInfo: [{ seatIndex_1: 1, seatIndex_2: 3, distance: 0 }] }));
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('LocationUI').views['view/1-3'].getComponent(cc.Label).string === cc.mm.gamefunc.kmUnit(0));
      await page.evaluate(() => cc.mm.uimanager.getWindow('LocationUI').close());
      await page.waitForFunction(() => !cc.mm.uimanager.getWindow('LocationUI'));
      await page.evaluate(() => {
        cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyLocation, { distInfo: [] });
        cc.mm.uimanager.showWindow(cc.mm.config.resources, 'LocationUI', cc.mm.uimanager.getWindow('dss_game').model);
      });
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('LocationUI')?.views['view/1-3'].getComponent(cc.Label).string === '');
      report.cases.push({ viewport, ...state, clearedWhileOpen: true, zeroDistanceRestored: true, reopenedWithoutStaleText: true, nonblank: true });
      await page.close();
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } finally {
    if (browser) await browser.close();
    if (room) await api(`/rooms/${room.id}/leave`, players[0].token, {});
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report));
})().catch(error => { console.error(error); process.exitCode = 1; });
