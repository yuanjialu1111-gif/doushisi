import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveApiBase, deriveClientUrl } from './resolve-api-base.mjs';

// Run after manually creating an Android Qionglai room with 0.125 base,
// two players and only the heaven/earth switch disabled. This verifies
// cross-client frozen options, not any regional gameplay.
const code = process.argv[2];
assert.match(code ?? '', /^\d{6}$/);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientUrl = process.env.CLIENT_URL || deriveClientUrl(await resolveApiBase({
  environmentValue: process.env.DOUSHISI_API_BASE,
  runtimePath: join(root, '.local/runtime.json'),
}));
const output = join(root, 'client/validation/regional');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exec = promisify(execFile);
const adb = (...args) => exec(process.env.ADB || 'D:/leidian/LDPlayer14/adb.exe',
  ['-s', process.env.ADB_DEVICE || 'emulator-5554', ...args], { windowsHide: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1334, height: 750 } });
const report = { at: new Date().toISOString(), scope: 'Android-created Qionglai waiting room, browser join and reload only',
  roomCode: code, physical: false, gameplay: false, errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
await mkdir(output, { recursive: true });
const snapshot = () => page.evaluate(() => {
  const table = cc.mm.hallserver.mLastRoomParam, controller = cc.mm.uimanager.getWindow('dss_game');
  return { roomCode: String(table.roomId), baseBeans: table.baseBeans, qionglai: table.qionglai,
    seat: controller.model.selfSeat, summary: controller.getRule() };
});
try {
  await page.goto(clientUrl);
  await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
  await page.evaluate(({ username, password }) => {
    const login = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
    login.onClick_accuountregbtn();
    login.views['accountReg/accountid/editbox'].getComponent(cc.EditBox).string = username;
    for (const key of ['accountReg/passworld1/editbox', 'accountReg/passworld2/editbox']) login.views[key].getComponent(cc.EditBox).string = password;
    login.onClick_regbtn();
  }, { username: 'native_peer_' + randomBytes(8).toString('hex'), password: randomBytes(18).toString('hex') });
  await page.waitForFunction(() => !!cc.mm.uimanager.getWindow('HallUI'));
  await page.evaluate(roomCode => cc.mm.hallserver.requestJoinRoom(Number(roomCode)), code);
  await page.waitForFunction(() => window.cc?.mm?.uimanager?.getWindow('dss_game')?.model?.selfSeat === 2);
  report.joined = await snapshot();
  assert.equal(report.joined.roomCode, code);
  assert.equal(report.joined.baseBeans, '0.125');
  assert.deepEqual(report.joined.qionglai, { version: 'qionglai-additions-v1',
    qlTianDiHu: 0, qlHongHeiHu: 1, qlHongHei50: 1 });
  assert.ok(report.joined.summary.includes('红胡黑胡') && report.joined.summary.includes('红50黑50'));
  assert.ok(!report.joined.summary.includes('天地胡') && !report.joined.summary.includes('两副牌'));
  await page.reload();
  await page.waitForFunction(() => window.cc?.mm?.uimanager?.getWindow('dss_game')?.model?.selfSeat === 2);
  report.reloaded = await snapshot();
  assert.deepEqual(report.reloaded, report.joined);
  await page.screenshot({ path: join(output, 'native-peer-browser.png') });
  await adb('shell', 'screencap', '-p', '/sdcard/dou14-regional-peer.png');
  await adb('pull', '/sdcard/dou14-regional-peer.png', join(output, 'native-peer-table.png'));
  report.adbReverse = (await adb('reverse', '--list')).stdout.trim();
  assert.equal(report.adbReverse, '');
  report.apkSha256 = createHash('sha256').update(await readFile(join(root, 'client/android/doushisi.apk'))).digest('hex');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack || String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(join(output, 'native-peer-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
