import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAcceptanceBindings } from './build-fingerprint.mjs';

const bindings = readAcceptanceBindings();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(project, 'client/validation');
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3000/client/';
const report = { schemaVersion: 1, ...bindings, base, at: new Date().toISOString(), steps: [], scenarios: [], screenshots: [], errors: [] };
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
await mkdir(output, { recursive: true });

async function observe(page) {
  await page.evaluate(() => {
    window.__wireErrors = [];
    const protocolError = Standalone.protocolError;
    Standalone.protocolError = function (error, command) {
      window.__wireErrors.push({ error, command });
      return protocolError.apply(this, arguments);
    };
    window.__wireRequests = []; window.__wireAcks = []; window.__wireSnapshots = 0;
    const append = Standalone.appendWireRequest, receive = Standalone.receiveWireMessage, distribute = Standalone.distributeWireMessage;
    Standalone.appendWireRequest = function (body, command) {
      const bytes = append.apply(this, arguments);
      if ([23, 53, 121, 125].includes(command)) window.__wireRequests.push({ command, request: this.applyWireExtension(bytes, {}).request });
      return bytes;
    };
    Standalone.receiveWireMessage = function (extension) {
      if (extension?.ack) window.__wireAcks.push(extension.ack.commandId);
      return receive.apply(this, arguments);
    };
    Standalone.distributeWireMessage = function (message) {
      const result = distribute.apply(this, arguments);
      if (message.code === 48 && result) window.__wireSnapshots++;
      return result;
    };
  });
}

async function register(viewport, suffix) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', error => report.errors.push(error.stack));
  await page.goto(base);
  await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
  await observe(page);
  const credentials = { username: `ui_${Date.now()}_${suffix}`, password: randomBytes(18).toString('base64url') };
  await page.evaluate(({ username, password }) => {
    const c = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
    c.onClick_accuountregbtn();
    c.views['accountReg/accountid/editbox'].getComponent(cc.EditBox).string = username;
    c.views['accountReg/passworld1/editbox'].getComponent(cc.EditBox).string = password;
    c.views['accountReg/passworld2/editbox'].getComponent(cc.EditBox).string = password;
    c.onClick_regbtn();
  }, credentials);
  await page.waitForFunction(() => cc.mm.uimanager.getWindow('HallUI'));
  assert.equal(await page.evaluate(() => cc.mm.framemodel.goldNum), '0');
  report.steps.push({ action: 'register', username: credentials.username, initialBalance: '0', viewport });
  return page;
}

async function roomState(page) {
  return page.evaluate(() => {
    const controller = cc.mm.uimanager.getWindow('dss_game');
    const model = controller.model;
    return {
      roomId: model.roomId, selfSeat: model.selfSeat, round: model.numofgames,
      players: Object.values(model.players).map(p => ({ seat: p.seatIndex, showSeat: p.showSeat, uid: p.uid, nickname: p.nick, score: String(p.score), ready: p.isReady })),
      removed: ['qifu-button', 'qifu-dikuang', 'buchongdou', 'invateBtn'].every(key => !controller.views[key].activeInHierarchy),
      exact: cc.mm.gamefunc.numformat('9007199254740993.125'),
    };
  });
}

async function screenshot(page, name) {
  const png = await page.screenshot({ path: join(output, name + '.png') });
  const pixels = await page.evaluate(async data => {
    const image = new Image(); image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set(); let opaque = 0;
    for (let i = 0; i < pixels.length; i += 64) { colors.add((pixels[i] >> 4) * 256 + (pixels[i + 1] >> 4) * 16 + (pixels[i + 2] >> 4)); if (pixels[i + 3]) opaque++; }
    return { width: image.width, height: image.height, quantizedColors: colors.size, opaqueSamples: opaque };
  }, png.toString('base64'));
  assert.ok(pixels.quantizedColors > 100 && pixels.opaqueSamples > 1000, 'Original canvas must render visible content');
  const descriptor = { path: `client/validation/${name}.png`, name, sha256: createHash('sha256').update(png).digest('hex'), ...pixels };
  report.screenshots.push(descriptor);
  return descriptor;
}

try {
  const host = await register({ width: 1334, height: 750 }, 'a');
  const guest = await register({ width: 844, height: 390 }, 'b');
  await host.evaluate(() => cc.mm.uimanager.getWindow('HallUI').onClickCreateRoomBtn());
  await host.waitForFunction(() => cc.mm.uimanager.getWindow('CreateRoomUI'));
  await host.waitForFunction(() => {
    const controller = cc.mm.uimanager.getWindow('CreateRoomUI');
    const area = Number(controller?._areaType);
    return Number.isInteger(area) && area > 0 &&
      controller?._gameBtns?.some(button => Number(button.data?.gameId) === area && button.getChildByName('selectImg'));
  });
  await host.evaluate(() => {
    const c = cc.mm.uimanager.getWindow('CreateRoomUI');
    const area = Number(c._areaType);
    const game = c._gameBtns.find(button => Number(button.data?.gameId) === area);
    if (!game) throw new Error(`Missing selected game configuration ${area}; ids=` + c._gameBtns.map(button => button.data?.gameId).join(','));
    c.onClickGameBtn({ node: game });
    c.onClickToggle(c.toggles.playerNum.find(toggle => toggle.node.groupIndex === 2).node, 'playerNum');
    c._standaloneBaseBeansInput.string = '0.1';
    c._standaloneBaseBeansInput.node.emit('text-changed');
    c.onClickCreateRoom();
  });
  await host.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game')?.model?.selfSeat > 0);
  const roomId = (await roomState(host)).roomId;
  await guest.evaluate(() => cc.mm.uimanager.getWindow('HallUI').onClickJoinRoomBtn());
  await guest.waitForFunction(() => cc.mm.uimanager.getWindow('JoinRoomUI'));
  await guest.evaluate(roomId => {
    const c = cc.mm.uimanager.getWindow('JoinRoomUI');
    for (const digit of String(roomId)) {
      const button = c.views['root/outputNodes'].children.find(node => node.getChildByName('label').getComponent(cc.Label).string === digit);
      c.onClickOutputBtn({ node: button });
    }
  }, roomId);
  for (const page of [host, guest]) {
    await page.waitForFunction(() => { const c = cc.mm.uimanager.getWindow('dss_game'); return c?.model?.selfSeat > 0 && Object.keys(c.model.players).length === 2; });
    await page.waitForFunction(() => !cc.mm.uimanager.windows.CommonPlayUI || cc.mm.uimanager.getWindow('CommonPlayUI'));
    await page.evaluate(() => { if (cc.mm.uimanager.getWindow('CommonPlayUI')) cc.mm.uimanager.closewindow('CommonPlayUI'); });
  }
  const hostState = await roomState(host), guestState = await roomState(guest);
  assert.equal(hostState.selfSeat, 1); assert.equal(guestState.selfSeat, 2);
  assert.ok(hostState.removed && guestState.removed);
  assert.equal(hostState.exact, '9007199254740993.125');
  report.steps.push({ action: 'create_and_join_original_ui', host: hostState, guest: guestState });
  report.steps.push({ action: 'render', captures: [await screenshot(host, 'room-host-1334'), await screenshot(guest, 'room-guest-844')] });
  await host.evaluate(() => {
    cc.mm.server.send({ hwRequestAuto: {} }, cc.mm.msgEvent.HWRequestAuto);
  });
  await host.waitForFunction(() => {
    const request = window.__wireRequests.at(-1);
    return request?.command === 121 && window.__wireAcks.includes(request.request.commandId) &&
      cc.mm.uimanager.getWindow('dss_game').model.getSelf().auto;
  });
  const transport = await host.evaluate(() => ({ request: window.__wireRequests.at(-1), acks: window.__wireAcks,
    roomId: cc.mm.uimanager.getWindow('dss_game').model.roomId,
    auto: Object.values(cc.mm.uimanager.getWindow('dss_game').model.players).map(player => !!player.auto) }));
  assert.equal(transport.request.command, 121);
  assert.match(transport.request.request.roomId, /^[0-9a-f-]{36}$/);
  assert.ok(transport.acks.includes(transport.request.request.commandId));
  assert.equal(transport.roomId, roomId);
  assert.ok(transport.auto.some(value => value === true));
  await host.evaluate(() => cc.mm.uimanager.getWindow('dss_game').onClickCancelTgBtn());
  await host.waitForFunction(() => {
    const request = window.__wireRequests.at(-1);
    return request?.command === 125 && window.__wireAcks.includes(request.request.commandId) &&
      !cc.mm.uimanager.getWindow('dss_game').model.getSelf().auto;
  });
  report.steps.push({ action: 'versioned_original_autoplay_enable_cancel',
    commands: [121, 125], roomId, correlatedAck: true, restoredManual: true });
  await host.evaluate(() => cc.mm.uimanager.getWindow('dss_game').onClickReadyBtn());
  await host.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game').model.getSelf().isReady);
  await guest.evaluate(() => cc.mm.uimanager.getWindow('dss_game').onClickReadyBtn());
  await guest.waitForFunction(() => window.__wireErrors.some(item => item.error.code === 'INSUFFICIENT_BALANCE'));
  assert.equal((await roomState(host)).round, 0);
  const balance = await host.evaluate(async () => {
    const response = await fetch(Standalone.config.apiBase + '/api/me', { headers: { authorization: 'Bearer ' + cc.sys.localStorage.getItem('GAME_TOKEN') } });
    const body = await response.json();
    return { balance: body.balance, feeCharged: body.room.feeCharged, currentRound: body.room.currentRound };
  });
  assert.equal(balance.balance, '0'); assert.equal(balance.feeCharged, false); assert.equal(balance.currentRound, 0);
  report.steps.push({ action: 'zero_balance_start_rejected_without_fee', ...balance });
  await guest.reload();
  await guest.waitForFunction(() => cc.mm?.uimanager?.getWindow('dss_game')?.model?.selfSeat === 2);
  assert.equal((await roomState(guest)).roomId, roomId);
  report.steps.push({ action: 'reload_reconnect', ...(await roomState(guest)) });
  await host.evaluate(async () => {
    const headers = { authorization: 'Bearer ' + cc.sys.localStorage.getItem('GAME_TOKEN') };
    const me = await (await fetch(Standalone.config.apiBase + '/api/me', { headers })).json();
    const response = await fetch(Standalone.config.apiBase + '/api/rooms/' + me.room.id + '/leave', { method: 'POST', headers });
    if (!response.ok) throw new Error('Test room cleanup failed');
  });
  await guest.waitForFunction(() => cc.mm.uimanager.getWindow('HallUI'));
  report.steps.push({ action: 'host_closes_unstarted_room', balance: await guest.evaluate(() => cc.mm.framemodel.goldNum) });
  report.steps.push({ action: 'canvas_content_checked', note: 'Pixel checks cover original waiting screens; gameplay animations and original-version screenshot equivalence remain unverified.' });
  report.scenarios = report.steps;
} catch (error) {
  report.errors.push(error.stack);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(join(output, 'room-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
