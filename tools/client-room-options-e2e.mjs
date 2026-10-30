import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Browser-level coverage for the standalone-only room fields.  The original
// compiled controller remains responsible for creating a room; this script
// drives that controller and inspects the V2 extension it actually sends.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(project, 'client/validation');
const base = process.env.CLIENT_URL || 'http://127.0.0.1:3000/client/';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const report = {
  schemaVersion: 1,
  base,
  at: new Date().toISOString(),
  steps: [],
  errors: [],
};
const exactBaseBeans = '9'.repeat(80) + '.123456789012';

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
let page;
let activeRoomId;

async function register() {
  page = await browser.newPage({ viewport: { width: 1334, height: 750 } });
  page.on('pageerror', error => report.errors.push(error.stack));
  await page.goto(base);
  await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
  const credentials = {
    username: `room_options_${Date.now()}_${randomBytes(6).toString('hex')}`,
    password: randomBytes(18).toString('base64url'),
  };
  await page.evaluate(({ username, password }) => {
    const controller = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
    controller.onClick_accuountregbtn();
    controller.views['accountReg/accountid/editbox'].getComponent(cc.EditBox).string = username;
    controller.views['accountReg/passworld1/editbox'].getComponent(cc.EditBox).string = password;
    controller.views['accountReg/passworld2/editbox'].getComponent(cc.EditBox).string = password;
    controller.onClick_regbtn();
  }, credentials);
  await page.waitForFunction(() => cc.mm.uimanager.getWindow('HallUI'));
  assert.equal(await page.evaluate(() => cc.mm.framemodel.goldNum), '0');
  report.steps.push({ action: 'register', username: credentials.username, initialBeans: '0' });
}

async function installObservers() {
  await page.evaluate(() => {
    window.__roomOptionsValidation = { prompts: [], createCalls: [], v2Creates: [] };
    const ui = cc.mm.uimanager;
    const prompt = ui.showTextPrompt;
    ui.showTextPrompt = function (message) {
      window.__roomOptionsValidation.prompts.push(String(message));
      return prompt.apply(this, arguments);
    };
    const request = cc.mm.hallserver.requestCreateRoom;
    cc.mm.hallserver.requestCreateRoom = function (rules, areaType) {
      window.__roomOptionsValidation.createCalls.push({
        areaType: Number(areaType),
        rules: JSON.parse(JSON.stringify(rules || {})),
      });
      return request.apply(this, arguments);
    };
    const append = Standalone.appendWireRequest;
    Standalone.appendWireRequest = function (body, command) {
      const encoded = append.apply(this, arguments);
      if (command === 3) {
        const extension = Standalone.applyWireExtension(encoded, {});
        window.__roomOptionsValidation.v2Creates.push(extension?.createRoom ?? null);
      }
      return encoded;
    };
  });
}

async function openCreateRoom() {
  await page.evaluate(() => cc.mm.uimanager.getWindow('HallUI').onClickCreateRoomBtn());
  await page.waitForFunction(() => cc.mm.uimanager.getWindow('CreateRoomUI'));
}

async function selectArea(areaType) {
  await page.evaluate(areaType => {
    const controller = cc.mm.uimanager.getWindow('CreateRoomUI');
    const game = controller._gameBtns.find(button => Number(button.data?.gameId) === Number(areaType));
    if (!game) throw new Error(`Missing retained game configuration ${areaType}`);
    controller.onClickGameBtn({ node: game });
    // The validation runs in a headless browser with no physical GPS provider.
    // This is the original off setting and does not affect the manual controls.
    controller._rules.openGps = false;
  }, areaType);
  await page.waitForFunction(areaType => {
    const controller = cc.mm.uimanager.getWindow('CreateRoomUI');
    return controller && Number(controller._areaType) === areaType;
  }, areaType);
}

async function readForm() {
  return page.evaluate(() => {
    const controller = cc.mm.uimanager.getWindow('CreateRoomUI');
    const content = controller._scrollview.content;
    const baseRow = content.getChildByName('standalone-baseBeans');
    const playerRow = content.getChildByName('standalone-playerNum');
    const text = node => node?.getComponent?.(cc.Label)?.string ?? null;
    const edit = controller._standaloneBaseBeansInput;
    const display = edit?.string ? edit.textLabel?.node : edit?.placeholderLabel?.node;
    const playerItems = controller._standalonePlayerNumItems || [];
    return {
      areaType: Number(controller._areaType),
      base: {
        visible: !!baseRow,
        label: text(baseRow?.getChildByName('label')),
        value: edit?.string ?? null,
        display: text(display),
        maxLength: edit?.maxLength ?? null,
      },
      players: {
        visible: !!playerRow,
        label: text(playerRow?.getChildByName('label')),
        values: playerItems.map(item => item._standalonePlayerValue),
        checked: playerItems.map(item => !!item.getChildByName('toggle')?.getComponent(cc.Toggle)?.isChecked),
        selected: controller._rules.playerNum ?? null,
      },
      promptCount: window.__roomOptionsValidation.prompts.length,
      createCallCount: window.__roomOptionsValidation.createCalls.length,
    };
  });
}

async function createWithCurrentForm() {
  return page.evaluate(() => {
    const controller = cc.mm.uimanager.getWindow('CreateRoomUI');
    controller.onClickCreateRoom();
    return {
      prompts: [...window.__roomOptionsValidation.prompts],
      createCalls: window.__roomOptionsValidation.createCalls.length,
      v2Creates: [...window.__roomOptionsValidation.v2Creates],
    };
  });
}

async function setBaseBeans(value) {
  await page.evaluate(value => {
    const controller = cc.mm.uimanager.getWindow('CreateRoomUI');
    const edit = controller._standaloneBaseBeansInput;
    if (!edit) throw new Error('Manual base input is missing');
    edit.string = value;
    edit.node.emit('text-changed');
  }, value);
}

async function selectManualPlayerNum(value) {
  return page.evaluate(value => {
    const controller = cc.mm.uimanager.getWindow('CreateRoomUI');
    const item = (controller._standalonePlayerNumItems || []).find(node => node._standalonePlayerValue === value);
    if (!item) throw new Error(`Missing manual ${value}-player option`);
    item.emit('click');
    return {
      selected: controller._rules.playerNum,
      checked: controller._standalonePlayerNumItems.map(node => !!node.getChildByName('toggle')?.getComponent(cc.Toggle)?.isChecked),
    };
  }, value);
}

async function roomSnapshot() {
  return page.evaluate(async () => {
    const controller = cc.mm.uimanager.getWindow('dss_game');
    const token = cc.sys.localStorage.getItem('GAME_TOKEN');
    const response = await fetch(Standalone.config.apiBase + '/api/me', { headers: { authorization: 'Bearer ' + token } });
    if (!response.ok) throw new Error(`Could not read waiting room (${response.status})`);
    const me = await response.json();
    const table = controller?.model?.tableInfo || cc.mm.gameserver.room_data || {};
    return {
      roomId: controller?.model?.roomId ?? table.roomId,
      tableInfo: {
        roomId: table.roomId,
        playerNum: table.playerNum,
        baseBeans: table.baseBeans,
        baseBeansSource: table.baseBeansSource,
        playerNumSource: table.playerNumSource,
      },
      serverRoom: me.room && {
        id: me.room.id,
        code: me.room.code,
        state: me.room.state,
        baseBeans: me.room.baseBeans,
        baseBeansSource: me.room.baseBeansSource,
        playerCount: me.room.playerCount,
        playerNumSource: me.room.playerNumSource,
      },
      v2Creates: [...window.__roomOptionsValidation.v2Creates],
    };
  });
}

async function leaveWaitingRoom(roomId) {
  if (!roomId || !page || page.isClosed()) return;
  const result = await page.evaluate(async roomId => {
    const token = cc.sys.localStorage.getItem('GAME_TOKEN');
    const response = await fetch(`${Standalone.config.apiBase}/api/rooms/${roomId}/leave`, {
      method: 'POST', headers: { authorization: 'Bearer ' + token },
    });
    return { status: response.status, body: await response.json() };
  }, roomId);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

try {
  await register();
  await installObservers();
  await openCreateRoom();

  // Area 4 has no original basicTimes selector. It must add an empty required
  // base-beans input, and invalid attempts must stay in the form.
  await selectArea(4);
  const manualBaseForm = await readForm();
  assert.equal(manualBaseForm.areaType, 4);
  assert.equal(manualBaseForm.base.visible, true);
  assert.equal(manualBaseForm.base.label, '底分：');
  assert.equal(manualBaseForm.base.value, '');
  assert.equal(manualBaseForm.base.display, '请输入底分（豆子）');
  assert.equal(manualBaseForm.base.maxLength, 93);
  assert.equal(manualBaseForm.players.visible, false);
  report.steps.push({ action: 'area_4_shows_required_manual_base', form: manualBaseForm });

  const emptyAttempt = await createWithCurrentForm();
  assert.equal(emptyAttempt.createCalls, 0);
  assert.equal(emptyAttempt.v2Creates.length, 0);
  assert.equal(emptyAttempt.prompts.at(-1), '请输入正数底分（豆子）');
  report.steps.push({ action: 'area_4_empty_base_is_rejected', prompt: emptyAttempt.prompts.at(-1) });

  await setBaseBeans('0');
  assert.equal((await readForm()).base.display, '0');
  const zeroAttempt = await createWithCurrentForm();
  assert.equal(zeroAttempt.createCalls, 0);
  assert.equal(zeroAttempt.v2Creates.length, 0);
  assert.equal(zeroAttempt.prompts.at(-1), '请输入正数底分（豆子）');
  report.steps.push({ action: 'area_4_zero_base_is_rejected', prompt: zeroAttempt.prompts.at(-1) });

  await page.evaluate(() => cc.mm.uimanager.getWindow('CreateRoomUI')._standaloneBaseBeansInput.focus());
  await page.keyboard.press('Control+A');
  await page.keyboard.type('0.123456789012');
  await page.keyboard.press('Enter');
  await page.evaluate(() => cc.mm.uimanager.getWindow('CreateRoomUI')._standaloneBaseBeansInput.blur());
  await page.waitForTimeout(200);
  const typed = await page.evaluate(() => {
    const edit = cc.mm.uimanager.getWindow('CreateRoomUI')._standaloneBaseBeansInput;
    return { value: edit.string, rendered: edit.textLabel.string, visible: edit.textLabel.node.activeInHierarchy,
      placeholderVisible: edit.placeholderLabel.node.activeInHierarchy,
      hasOverlay: !!edit.node.getChildByName('baseBeansDisplay'), focused: edit.isFocused() };
  });
  assert.deepEqual(typed, { value: '0.123456789012', rendered: '0.123456789012',
    visible: true, placeholderVisible: false, hasOverlay: false, focused: false });
  report.steps.push({ action: 'keyboard_input_and_blur_use_bound_editbox_labels', ...typed });
  await page.screenshot({ path: join(output, 'manual-keyboard-blur.png') });

  // Area 14 needs both standalone inputs. Its manual player row has no
  // default and exposes exactly 2/3/4, then forwards both fields in V2.
  await selectArea(14);
  const manualBothForm = await readForm();
  assert.equal(manualBothForm.areaType, 14);
  assert.equal(manualBothForm.base.visible, true);
  assert.equal(manualBothForm.base.value, '');
  assert.equal(manualBothForm.base.display, '请输入底分（豆子）');
  assert.equal(manualBothForm.players.visible, true);
  assert.equal(manualBothForm.players.label, '人数');
  assert.deepEqual(manualBothForm.players.values, [2, 3, 4]);
  assert.deepEqual(manualBothForm.players.checked, [false, false, false]);
  assert.equal(manualBothForm.players.selected, null);
  const formScreenshot = join(output, 'manual-room-options-14.png');
  // Let the previous invalid-form toast finish so the image records the
  // controls themselves rather than a transient error layer.
  await page.waitForTimeout(1700);
  await page.screenshot({ path: formScreenshot });
  report.steps.push({ action: 'area_14_shows_required_manual_base_and_player_count', form: manualBothForm, screenshot: formScreenshot });

  await setBaseBeans('0.125');
  assert.equal((await readForm()).base.display, '0.125');
  await page.screenshot({ path: join(output, 'manual-room-options-filled-14.png') });
  const noPlayerAttempt = await createWithCurrentForm();
  assert.equal(noPlayerAttempt.createCalls, 0);
  assert.equal(noPlayerAttempt.v2Creates.length, 0);
  assert.equal(noPlayerAttempt.prompts.at(-1), '请选择房间人数');
  report.steps.push({ action: 'area_14_missing_player_count_is_rejected', prompt: noPlayerAttempt.prompts.at(-1) });

  const picked = await selectManualPlayerNum(3);
  assert.equal(picked.selected, 3);
  assert.deepEqual(picked.checked, [false, true, false]);
  await setBaseBeans(exactBaseBeans);
  await createWithCurrentForm();
  await page.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game')?.model?.selfSeat > 0, null, { timeout: 15000 });
  const waitingRoom = await roomSnapshot();
  activeRoomId = waitingRoom.serverRoom?.id;
  assert.equal(waitingRoom.serverRoom?.state, 'waiting');
  assert.equal(waitingRoom.serverRoom?.baseBeans, exactBaseBeans);
  assert.equal(waitingRoom.serverRoom?.baseBeansSource, 'manual');
  assert.equal(waitingRoom.serverRoom?.playerCount, 3);
  assert.equal(waitingRoom.serverRoom?.playerNumSource, 'manual');
  assert.deepEqual(waitingRoom.v2Creates.at(-1), { baseBeans: exactBaseBeans, playerNum: 3 });
  assert.equal(waitingRoom.tableInfo.baseBeans, exactBaseBeans);
  assert.equal(waitingRoom.tableInfo.baseBeansSource, 'manual');
  assert.equal(waitingRoom.tableInfo.playerNum, 3);
  assert.equal(waitingRoom.tableInfo.playerNumSource, 'manual');
  report.steps.push({ action: 'area_14_creates_waiting_room_with_frozen_v2_options', ...waitingRoom });
} catch (error) {
  report.errors.push(error.stack || String(error));
  process.exitCode = 1;
} finally {
  try {
    const cleanup = await leaveWaitingRoom(activeRoomId);
    if (cleanup) report.steps.push({ action: 'cleanup_unstarted_waiting_room', roomId: activeRoomId });
  }
  catch (error) { report.errors.push('Room cleanup failed: ' + (error.stack || error)); process.exitCode = 1; }
  await browser.close();
  await writeFile(join(output, 'manual-room-options-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
