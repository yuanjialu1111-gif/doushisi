const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve, join } = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const sharp = require(process.env.SHARP_MODULE || 'sharp');

const project = resolve(__dirname, '..');
const output = join(project, 'client/validation/social-fixtures');
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3000/client/';
const report = { at: new Date().toISOString(), base, source: 'Controlled friend-list data in the original Cocos scene; not a completed regional game.', cases: [], errors: [], externalRequests: [] };

(async () => {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    for (const viewport of [{ width: 1334, height: 750 }, { width: 844, height: 390 }]) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(15000);
      page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
      page.on('pageerror', error => report.errors.push(error.stack));
      page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) report.externalRequests.push(request.url()); });
      const username = `social_${randomBytes(8).toString('hex')}`, password = randomBytes(24).toString('base64url');
      const response = await fetch(new URL('/api/auth/register', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      assert.equal(response.status, 200);
      await page.goto(base);
      await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
      await page.evaluate(({ username, password }) => {
        const controller = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
        controller.views['accountLogin/accountid/editbox'].getComponent(cc.EditBox).string = username;
        controller.views['accountLogin/passworld/editbox'].getComponent(cc.EditBox).string = password;
        controller.onClick_toGame();
      }, { username, password });
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('HallUI'));
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('HallUI').views['games/game_type_4/haoyou'].activeInHierarchy);
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('HallUI').views['hallHeadBtn/hallHead'].getComponent(cc.Sprite).spriteFrame?.getOriginalSize()?.width === 128);
      const coin = await page.evaluate(() => {
        const node = cc.mm.uimanager.getWindow('HallUI').views.hallcoin, frame = node.getComponent(cc.Sprite).spriteFrame;
        return { size: [node.width, node.height], rect: frame.getRect(), original: frame.getOriginalSize(), texture: frame.getTexture().url, removedTopup: !node.getComponent(cc.Sprite).enabled && node.getChildByName('standaloneBalanceBackground')?.width === 156 };
      });
      assert.equal(coin.removedTopup, true);
      assert.equal(await page.evaluate(() => {
        const views = cc.mm.uimanager.getWindow('HallUI').views;
        const nickname = views['hallHeadBtn/namelabel'].getBoundingBoxToWorld(), region = views.common_location.getBoundingBoxToWorld();
        return nickname.xMax < region.x;
      }), true, 'Long account names must fit before the region selector');
      await page.screenshot({ path: join(output, `hall-${viewport.width}.png`) });
      await page.evaluate(() => {
        // The backend protocol has separate integration tests. These fixtures exercise original layout updates only.
        cc.mm.hallserver.requestAllFriend = function () {};
        cc.mm.uimanager.showWindow(cc.mm.config.hall, 'FriendListUI');
      });
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('FriendListUI'));
      const fixture = [
        { uid: '900001', nick: '好友甲', picUrl: '/client/standalone/default-avatar.png', recordId: 800001, online: '在线', source: '同桌对局', headType: 0 },
        { uid: '900002', nick: '好友乙', picUrl: '/client/standalone/default-avatar.png', recordId: 800002, online: '离线中', source: '同桌对局', headType: 0 },
      ];
      await page.evaluate(friendAll => { const c = cc.mm.uimanager.getWindow('FriendListUI'); c._ntfFriends({ gradeInfo: [], friendAll }); c._ntfFriends({ gradeInfo: [], friendAll }); }, fixture);
      await page.waitForFunction(() => {
        const rows = Object.values(cc.mm.uimanager.getWindow('FriendListUI')._standaloneFriendRows);
        return rows.length === 2 && rows.every(row => {
          const size = row.getChildByName('hallHeadBtn').getChildByName('hallHead').getComponent(cc.Sprite).spriteFrame?.getOriginalSize();
          return size?.width === 128 && size?.height === 128;
        });
      }).catch(async error => {
        report.avatarDebug = await page.evaluate(() => {
          const c = cc.mm.uimanager.getWindow('FriendListUI');
          return Object.values(c._standaloneFriendRows).map(row => {
            const node = row.getChildByName('hallHeadBtn').getChildByName('hallHead'), texture = node.getComponent(cc.Sprite).spriteFrame?.getTexture();
            return { remote: node.remote, url: row._standalonePicUrl, textureKeys: texture && Object.keys(texture), texture: texture && { width: texture.width, height: texture.height, url: texture.url, nativeUrl: texture.nativeUrl } };
          });
        });
        await page.screenshot({ path: join(output, 'failure.png') });
        throw error;
      });
      const initial = await page.evaluate(() => {
        const c = cc.mm.uimanager.getWindow('FriendListUI');
        return { rows: c.views.scrollview.getComponent(cc.ScrollView).content.children.length, removed: ['baoshan-pic-chendi/baoshan-button-yaoqing', 'baoshan-pic-chendi/baoshan-button-zhaohui'].every(key => !c.views[key].activeInHierarchy) };
      });
      assert.equal(initial.rows, 2); assert.equal(initial.removed, true);
      fixture[1].online = '在线';
      const updated = await page.evaluate(friendAll => {
        const c = cc.mm.uimanager.getWindow('FriendListUI'), previous = c._standaloneFriendRows['900002'];
        c._ntfFriends({ gradeInfo: [], friendAll });
        return { reused: previous === c._standaloneFriendRows['900002'], state: previous.getChildByName('state').getComponent(cc.Label).string };
      }, fixture);
      assert.deepEqual(updated, { reused: true, state: '在线' });
      const name = `friends-${viewport.width}.png`, png = await page.screenshot({ path: join(output, name) });
      const stats = await sharp(png).stats();
      assert.ok(stats.entropy > 4, 'The Cocos canvas must contain visible scene content');
      await page.evaluate(() => { const c = cc.mm.uimanager.getWindow('FriendListUI'); c._ntfFriends({ gradeInfo: [], friendAll: [] }); });
      assert.equal(await page.evaluate(() => cc.mm.uimanager.getWindow('FriendListUI').views.scrollview.getComponent(cc.ScrollView).content.children.length), 0);
      report.cases.push({ viewport, coin, initial, updated, empty: true, screenshot: name, sha256: createHash('sha256').update(png).digest('hex'), entropy: stats.entropy });
      await page.close();
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
  } finally { await browser.close(); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
