import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETAINED_GAME_IDS } from '../packages/rules/src/edition.ts';
import { readAcceptanceBindings } from './build-fingerprint.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bindings = readAcceptanceBindings();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3000/client/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { schemaVersion: 1, ...bindings, at: new Date().toISOString(), scope: '21 regional room options and Qionglai frozen switches; no completed gameplay', views: [], screenshots: [], errors: [] };
assert.deepEqual([...RETAINED_GAME_IDS], [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
const output = join(root, 'client/validation/regional');
await mkdir(output, { recursive: true });
async function screenshot(page, name) {
  const png = await page.screenshot({ path: join(output, `${name}.png`) });
  const descriptor = { path: `client/validation/regional/${name}.png`, sha256: createHash('sha256').update(png).digest('hex') };
  report.screenshots.push(descriptor);
  return descriptor;
}
async function login(viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
  await page.evaluate(({ username, password }) => {
    const login = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
    login.onClick_accuountregbtn();
    login.views['accountReg/accountid/editbox'].getComponent(cc.EditBox).string = username;
    for (const path of ['accountReg/passworld1/editbox', 'accountReg/passworld2/editbox']) login.views[path].getComponent(cc.EditBox).string = password;
    login.onClick_regbtn();
  }, { username: 'region_' + randomBytes(8).toString('hex'), password: randomBytes(18).toString('hex') });
  await page.waitForFunction(() => !!cc.mm.uimanager.getWindow('HallUI'));
  return page;
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const token = cc.sys.localStorage.getItem('GAME_TOKEN');
    const me = await (await fetch(Standalone.config.apiBase + '/api/me', { headers: { authorization: 'Bearer ' + token } })).json();
    const table = cc.mm.hallserver.mLastRoomParam;
    return { room: me.room, table: { areaType: table.areaType, baseBeans: table.baseBeans, playerNum: table.playerNum,
      qionglai: table.qionglai }, summary: cc.mm.uimanager.getWindow('dss_game').getRule() };
  });
}
try {
  for (const viewport of [{ width: 1334, height: 750 }, { width: 844, height: 390 }]) {
    const host = await login(viewport), guest = await login(viewport);
    let roomId;
    try {
      await host.evaluate(() => cc.mm.uimanager.getWindow('HallUI').onClickCreateRoomBtn());
      await host.waitForFunction(() => !!cc.mm.uimanager.getWindow('CreateRoomUI'));
      const actualIds = await host.evaluate(() => cc.mm.uimanager.getWindow('CreateRoomUI')._gameBtns.map(node => node.data.gameId));
      assert.deepEqual(actualIds, [...RETAINED_GAME_IDS]);
      await host.evaluate(() => {
        const form = cc.mm.uimanager.getWindow('CreateRoomUI');
        const qionglai = form._gameBtns.find(node => Number(node.data?.gameId) === 8);
        if (!qionglai) throw new Error('Missing retained game configuration 8');
        form.onClickGameBtn({ node: qionglai });
        form.onClickToggle(form.toggles.playerNum.find(toggle => toggle.node.groupIndex === 2).node, 'playerNum');
        form._standaloneBaseBeansInput.string = '0.125';
        form._standaloneBaseBeansInput.node.emit('text-changed');
        form._scrollview.scrollToBottom(0);
      });
      await host.waitForTimeout(650);
      await host.evaluate(() => {
        const scroll = cc.mm.uimanager.getWindow('CreateRoomUI')._scrollview;
        scroll.stopAutoScroll();
        scroll.scrollToBottom(0);
      });
      await host.waitForTimeout(150);
      const form = await host.evaluate(() => {
        const form = cc.mm.uimanager.getWindow('CreateRoomUI');
        const labels = form._scrollview.content.getComponentsInChildren(cc.Label);
        const names = ['天地胡', '红胡黑胡', '红50黑50'];
        const rows = names.map(name => {
          const label = labels.find(label => label.string === name);
          const world = label.node.parent.convertToWorldSpaceAR(cc.v2(0, 0));
          const bounds = document.querySelector('canvas').getBoundingClientRect();
          return { name, checked: label.node.parent.getChildByName('toggle').getComponent(cc.Toggle).isChecked,
            x: bounds.x + world.x / cc.winSize.width * bounds.width,
            y: bounds.y + (cc.winSize.height - world.y) / cc.winSize.height * bounds.height };
        });
        return { options: rows, rules: { ...form._rules } };
      });
      assert.ok(form.options.every(option => option.checked));
      const capture = await screenshot(host, `qionglai-options-${viewport.width}`);
      await host.mouse.click(form.options[0].x, form.options[0].y);
      await host.waitForTimeout(100);
      assert.equal(await host.evaluate(() => !!cc.mm.uimanager.getWindow('CreateRoomUI')._rules.qlTianDiHu), false);
      await host.evaluate(() => cc.mm.uimanager.getWindow('CreateRoomUI').onClickCreateRoom());
      await host.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game')?.model?.selfSeat === 1);
      const created = await snapshot(host); roomId = created.room.id;
      await host.waitForFunction(() => {
        const controller = cc.mm.uimanager.getWindow('dss_game');
        const node = controller.views['buttom/scoreNode/doudou'];
        return node?._standaloneBeanIcon;
      });
      const beanIconsMatch = await host.evaluate(() => {
        const controller = cc.mm.uimanager.getWindow('dss_game');
        const bar = controller.views['buttom/scoreNode/doudou'];
        const icon = bar.getChildByName('standaloneBeanIcon');
        const self = icon.getComponent(cc.Sprite);
        const other = controller.node.getComponentsInChildren(cc.Sprite).find(sprite => sprite.node.name === 'gy_dou' && sprite.spriteFrame);
        const original = other.spriteFrame.getOriginalSize();
        return self.spriteFrame === other.spriteFrame && icon.height <= bar.height &&
          Math.abs(icon.width / icon.height - original.width / original.height) < 0.001 &&
          icon.width < bar.width / 2;
      });
      assert.equal(beanIconsMatch, true, 'self and other seats must use the original bean asset');
      assert.equal(created.room.variantKey, '8:0');
      assert.equal(created.room.rules.qionglai.qlTianDiHu, 0);
      assert.equal(created.room.rules.qionglai.qlHongHeiHu, 1);
      assert.equal(created.room.rules.qionglai.qlHongHei50, 1);
      assert.ok(created.summary.includes('红胡黑胡') && created.summary.includes('红50黑50'));
      assert.ok(!created.summary.includes('天地胡'));
      assert.ok(!created.summary.includes('两副牌'));
      const saved = await host.evaluate(() => JSON.parse(cc.sys.localStorage.getItem('game_last_room_data')));
      assert.equal(saved.gameid, 8);
      assert.equal(Number(saved.qlTianDiHu), 0);
      await guest.evaluate(code => cc.mm.hallserver.requestJoinRoom(code), Number(created.room.code));
      await guest.waitForFunction(() => window.cc?.mm?.uimanager?.getWindow('dss_game')?.model?.selfSeat === 2);
      const joined = await snapshot(guest);
      assert.deepEqual(joined.table.qionglai, created.table.qionglai);
      await guest.reload();
      await guest.waitForFunction(() => window.cc?.mm?.uimanager?.getWindow('dss_game')?.model?.selfSeat === 2);
      const restored = await snapshot(guest);
      assert.deepEqual(restored.table.qionglai, created.table.qionglai);
      assert.equal(restored.table.baseBeans, '0.125');
      report.views.push({ viewport, gameIds: actualIds, options: form.options, frozen: created.table, restored: restored.table, summary: restored.summary, beanIconsMatch, screenshot: capture.path, screenshotSha256: capture.sha256 });
    } finally {
      if (roomId) await host.evaluate(async id => {
        await fetch(Standalone.config.apiBase + '/api/rooms/' + id + '/leave', {
          method: 'POST', headers: { authorization: 'Bearer ' + cc.sys.localStorage.getItem('GAME_TOKEN') },
        });
      }, roomId);
      await host.close(); await guest.close();
    }
  }
  const yaanHost = await login({ width: 1334, height: 750 }), yaanGuest = await login({ width: 844, height: 390 });
  let yaanRoomId;
  try {
    await yaanHost.evaluate(() => cc.mm.uimanager.getWindow('HallUI').onClickChangeLocationBtn());
    await yaanHost.waitForFunction(() => cc.mm.uimanager.getWindow('HallMapUI')?._shengBtns?.length > 0);
    await yaanHost.evaluate(() => {
      const map = cc.mm.uimanager.getWindow('HallMapUI');
      const yaan = map._shengBtns.find(node => node.getChildByName('unsclect').getChildByName('game').getChildByName('label').getComponent(cc.Label).string === '雅安市');
      if (!yaan) throw new Error('Ya’an is missing from the server region choices');
      map.onClickShengBtn('雅安市', { node: yaan });
      map._xianString = '其他区域';
      map.onClickbackBtn();
    });
    await yaanHost.waitForFunction(() => cc.mm.framemodel.shiName === '雅安市');
    // Exercise the original reused hall entry, whose node number differs from the game ID.
    await yaanHost.waitForFunction(() => !cc.mm.uimanager.getWindow('HallMapUI'));
    const entryPoint = await yaanHost.evaluate(() => {
      const hall = cc.mm.uimanager.getWindow('HallUI');
      const node = hall.views['games/game_type_5/haoyou'];
      const position = node.convertToWorldSpaceAR(cc.v2(node.width * (0.5 - node.anchorX), node.height * (0.5 - node.anchorY)));
      const bounds = document.querySelector('canvas').getBoundingClientRect();
      return { x: bounds.x + position.x / cc.winSize.width * bounds.width,
        y: bounds.y + (cc.winSize.height - position.y) / cc.winSize.height * bounds.height };
    });
    await yaanHost.mouse.click(entryPoint.x, entryPoint.y);
    await yaanHost.waitForFunction(() => !!cc.mm.uimanager.getWindow('CreateRoomUI'));
    // The original hall entry opens the shared selector; the regional choice
    // is made in that list, preserving the existing flow.
    await yaanHost.evaluate(() => {
      const form = cc.mm.uimanager.getWindow('CreateRoomUI');
      const yaan = form._gameBtns.find(node => Number(node.data?.gameId) === 6);
      if (!yaan) throw new Error('Missing retained game configuration 6');
      form.onClickGameBtn({ node: yaan });
    });
    await yaanHost.waitForTimeout(700);
    const yaanForm = await yaanHost.evaluate(() => {
      const form = cc.mm.uimanager.getWindow('CreateRoomUI');
      return { gameId: form._areaType, ids: form._gameBtns.map(node => node.data.gameId),
        name: form._gameBtns.find(node => node.data.gameId === 6).data.name,
        base: form._standaloneBaseBeansInput.string,
        labels: form._scrollview.content.getComponentsInChildren(cc.Label).map(label => label.string) };
    });
    assert.deepEqual(yaanForm.ids, [...RETAINED_GAME_IDS]);
    assert.equal(yaanForm.name, '雅安红二十');
    assert.equal(yaanForm.base, '');
    assert.ok(!yaanForm.labels.some(label => /血战|天地胡|红胡黑胡/.test(label)));
    const yaanCapture = await screenshot(yaanHost, 'yaan-options-1334');
    await yaanHost.evaluate(() => {
      const form = cc.mm.uimanager.getWindow('CreateRoomUI');
      form.onClickToggle(form.toggles.playerNum.find(toggle => toggle.node.groupIndex === 2).node, 'playerNum');
      form._standaloneBaseBeansInput.string = '0.125';
      form._standaloneBaseBeansInput.node.emit('text-changed');
      form.onClickCreateRoom();
    });
    await yaanHost.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game')?.model?.selfSeat === 1);
    const created = await snapshot(yaanHost); yaanRoomId = created.room.id;
    assert.equal(created.room.variantKey, '6:0');
    assert.equal(created.room.rules.processType, 1);
    assert.equal(created.room.rules.baseBeans, '0.125');
    assert.equal(created.room.rules.qionglai, undefined);
    await yaanGuest.evaluate(code => cc.mm.hallserver.requestJoinRoom(code), Number(created.room.code));
    await yaanGuest.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game')?.model?.selfSeat === 2);
    await yaanGuest.reload();
    await yaanGuest.waitForFunction(() => window.cc?.mm?.uimanager?.getWindow('dss_game')?.model?.selfSeat === 2);
    const restored = await snapshot(yaanGuest);
    assert.equal(restored.room.variantKey, '6:0');
    assert.equal(restored.room.rules.processType, 1);
    assert.equal(restored.table.baseBeans, '0.125');
    report.yaan = { gameId: 6, name: yaanForm.name, ids: yaanForm.ids, originalHallEntry: true,
      bloodBattleHidden: true, baseBeans: restored.table.baseBeans, processType: restored.room.rules.processType,
      joinedAndReloaded: true, screenshot: yaanCapture.path, screenshotSha256: yaanCapture.sha256 };
  } finally {
    if (yaanRoomId) await yaanHost.evaluate(async id => {
      await fetch(Standalone.config.apiBase + '/api/rooms/' + id + '/leave', {
        method: 'POST', headers: { authorization: 'Bearer ' + cc.sys.localStorage.getItem('GAME_TOKEN') },
      });
    }, yaanRoomId);
    await yaanHost.close(); await yaanGuest.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) { report.errors.push(error.stack || String(error)); process.exitCode = 1; }
finally {
  await browser.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
