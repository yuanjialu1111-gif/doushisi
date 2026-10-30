import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readAcceptanceBindings } from './build-fingerprint.mjs';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bindings = readAcceptanceBindings();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3000/client/';
const account = process.env.CLIENT_TEST_ACCOUNT
  ? JSON.parse(process.env.CLIENT_TEST_ACCOUNT)
  : JSON.parse(await readFile(join(project, '.local/local-access.json'), 'utf8')).players[0];
const output = join(project, 'client/validation');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const report = { schemaVersion: 1, ...bindings, base, at: new Date().toISOString(), views: [], screenshots: [], errors: [] };
async function screenshot(page, name, options = {}) {
  const relative = `client/validation/${name}.png`;
  const png = await page.screenshot({ path: join(output, `${name}.png`), ...options });
  const descriptor = { path: relative, sha256: createHash('sha256').update(png).digest('hex') };
  report.screenshots.push(descriptor);
  return descriptor;
}
try {
  for (const viewport of [{ width: 1334, height: 750 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => report.errors.push(error.stack));
    await page.goto(base);
    await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
    await screenshot(page, `login-${viewport.width}`);
    const state = await page.evaluate(async ({ username, password }) => {
      window.__wireErrors = [];
      const oldError = Standalone.protocolError;
      Standalone.protocolError = function(error, command) { window.__wireErrors.push({error, command}); return oldError.apply(this, arguments); };
      const controller = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
      controller.views['accountLogin/accountid/editbox'].getComponent(cc.EditBox).string = username;
      controller.views['accountLogin/passworld/editbox'].getComponent(cc.EditBox).string = password;
      const result = { engine: cc.ENGINE_VERSION, wxLoginVisible: controller.views.wxlogin.active, exact: cc.mm.gamefunc.numformat('9007199254740993.125') };
      controller.onClick_toGame();
      return result;
    }, account);
    try { await page.waitForFunction(() => cc.mm.uimanager.getWindow('HallUI'), null, { timeout: 15000 }); }
    catch (error) {
      console.log(JSON.stringify(await page.evaluate(() => ({ wireErrors: window.__wireErrors, scene: cc.director.getScene().name, windows: Object.keys(cc.mm.uimanager.windows), connected: cc.mm.server._ws.isConnent(), selfClose: cc.mm.server.selfClose }))));
      await screenshot(page, 'login-failure');
      throw error;
    }
    await page.waitForTimeout(700);
    const hallFrame = await page.screenshot({ path: join(output, `hall-${viewport.width}.png`) });
    report.screenshots.push({ path: `client/validation/hall-${viewport.width}.png`, sha256: createHash('sha256').update(hallFrame).digest('hex') });
    await page.waitForTimeout(350);
    const nextHallFrame = await page.screenshot();
    state.hallAnimationChanged = createHash('sha256').update(hallFrame).digest('hex') !== createHash('sha256').update(nextHallFrame).digest('hex');
    if (!state.hallAnimationChanged) throw new Error('Original hall animation did not change the rendered frame');
    const hall = await page.evaluate(() => {
      const window = cc.mm.uimanager.getWindow('HallUI');
      const controller = window;
      return { balance: cc.mm.framemodel.goldNum, areaTypes: cc.mm.framemodel.areaType, visibleActions: Object.keys(controller.views).filter(key => controller.views[key].activeInHierarchy && controller.views[key].getComponent(cc.Button)).map(key => key), dimensions: { width: cc.winSize.width, height: cc.winSize.height } };
    });
    await page.evaluate(() => cc.mm.uimanager.getWindow('HallUI').onClickCreateRoomBtn());
    await page.waitForFunction(() => cc.mm.uimanager.getWindow('CreateRoomUI'));
    await page.waitForTimeout(500);
    await screenshot(page, `create-${viewport.width}`);
    report.views.push({ viewport, ...state, ...hall });
    await page.close();
  }
} catch (error) { report.errors.push(error.stack); throw error; }
finally {
  await browser.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (report.errors.length) process.exitCode = 1;
