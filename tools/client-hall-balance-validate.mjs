import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAcceptanceBindings } from './build-fingerprint.mjs';

const bindings = readAcceptanceBindings();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(project, 'client/validation');
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3000/client/';
const account = process.env.CLIENT_TEST_ACCOUNT
  ? JSON.parse(process.env.CLIENT_TEST_ACCOUNT)
  : JSON.parse(await readFile(join(project, '.local/local-access.json'), 'utf8')).players[0];
const report = { schemaVersion: 1, ...bindings, base, at: new Date().toISOString(), views: [], screenshots: [], errors: [] };
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  for (const viewport of [{ width: 1334, height: 750 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => report.errors.push(error.stack || error.message));
    await page.goto(base);
    await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
    await page.evaluate(({ username, password }) => {
      const login = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
      login.views['accountLogin/accountid/editbox'].getComponent(cc.EditBox).string = username;
      login.views['accountLogin/passworld/editbox'].getComponent(cc.EditBox).string = password;
      login.onClick_toGame();
    }, account);
    await page.waitForFunction(() => !!cc.mm?.uimanager?.getWindow('HallUI'));
    await page.waitForTimeout(250);

    const before = await page.evaluate(() => {
      const hall = cc.mm.uimanager.getWindow('HallUI');
      const coin = hall.views.hallcoin;
      const panel = coin.getChildByName('standaloneBeanBalance');
      const value = panel && panel.getChildByName('beanValue');
      const world = coin.convertToWorldSpaceAR(cc.v2(0, 0));
      const canvas = document.querySelector('canvas').getBoundingClientRect();
      return {
        originalLabelActive: hall.views['hallcoin/label'].active,
        buttonEnabled: coin.getComponent(cc.Button).enabled,
        buttonInteractable: coin.getComponent(cc.Button).interactable,
        hasBeanTextLayer: !!panel?.getChildByName('beanName'),
        panel: panel && { width: panel.width, height: panel.height, anchor: [panel.anchorX, panel.anchorY], position: [panel.x, panel.y] },
        value: value && { text: value.getComponent(cc.Label).string, anchor: [value.anchorX, value.anchorY], position: [value.x, value.y] },
        pointer: {
          x: canvas.left + world.x / cc.winSize.width * canvas.width,
          y: canvas.top + (cc.winSize.height - world.y) / cc.winSize.height * canvas.height,
        },
      };
    });

    assert.equal(before.originalLabelActive, false);
    assert.equal(before.buttonEnabled, false);
    assert.equal(before.buttonInteractable, false);
    assert.equal(before.hasBeanTextLayer, false);
    assert.deepEqual(before.panel.anchor, [0, 0.5]);
    assert.equal(before.panel.width, 156);
    assert.deepEqual(before.value.anchor, [1, 0.5]);
    assert.equal(before.value.position[1], 0);

    await page.mouse.click(before.pointer.x, before.pointer.y);
    await page.waitForTimeout(150);
    const afterPhysicalClick = await page.evaluate(() => {
      const hall = cc.mm.uimanager.getWindow('HallUI');
      return { hall: !!hall, normalBackground: hall.views.hallbg.active, shopBackground: hall.views.hall_bg_shop.active, shopWindow: !!cc.mm.uimanager.getWindow('HallShopUI') };
    });
    assert.deepEqual(afterPhysicalClick, { hall: true, normalBackground: true, shopBackground: false, shopWindow: false });

    // Exercise the recovery guard too: even a stale callback from an old scene
    // must not leave the hall on a retired-store background.
    const afterStaleCallback = await page.evaluate(() => {
      const hall = cc.mm.uimanager.getWindow('HallUI');
      hall.onClickHallCoinBtn();
      return { normalBackground: hall.views.hallbg.active, shopBackground: hall.views.hall_bg_shop.active, shopWindow: !!cc.mm.uimanager.getWindow('HallShopUI') };
    });
    assert.deepEqual(afterStaleCallback, { normalBackground: true, shopBackground: false, shopWindow: false });

    const image = join(output, `hall-balance-${viewport.width}.png`);
    const png = await page.screenshot({ path: image });
    const screenshot = { path: `client/validation/hall-balance-${viewport.width}.png`, sha256: createHash('sha256').update(png).digest('hex') };
    report.screenshots.push(screenshot);
    report.views.push({ viewport, before, afterPhysicalClick, afterStaleCallback, image, screenshot });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack || String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(join(output, 'hall-balance-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
