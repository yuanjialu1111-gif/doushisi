const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const { randomBytes } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const output = path.resolve(__dirname, '../client/validation');
async function api(route, token, payload) {
  const response = await fetch(base + '/api' + route, { method: payload ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
(async () => {
  const players = [];
  for (let index = 0; index < 3; index++) {
    const credentials = { username: `vote_${Date.now()}_${index}`, password: randomBytes(18).toString('base64url') };
    await api('/auth/register', null, credentials);
    const session = await api('/auth/login', null, credentials);
    players.push({ ...credentials, token: session.token });
  }
  const room = await api('/rooms', players[0].token, { variantKey: '4:0', options: { baseBeans: '0.1', gameNum: 4, playerNum: 4 } });
  await api('/rooms/join', players[1].token, { code: room.code });
  await api('/rooms/join', players[2].token, { code: room.code });
  await api(`/rooms/${room.id}/leave`, players[1].token, {});
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1334, height: 750 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/client/');
    await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
    await page.evaluate(({ username, password }) => {
      const controller = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
      controller.views['accountLogin/accountid/editbox'].getComponent(cc.EditBox).string = username;
      controller.views['accountLogin/passworld/editbox'].getComponent(cc.EditBox).string = password;
      controller.onClick_toGame();
    }, players[0]);
    await page.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game')?.model.selfSeat === 1);
    await api(`/rooms/${room.id}/dissolve`, players[2].token, { agree: true });
    await page.waitForFunction(() => cc.mm.uimanager.getWindow('CommonDissolve')?.players?.length === 2);
    const state = await page.evaluate(() => {
      const controller = cc.mm.uimanager.getWindow('CommonDissolve');
      return { members: Object.keys(cc.mm.uimanager.getWindow('dss_game').model.players), label: controller.views['root/userlabel'].getComponent(cc.Label).string, votes: controller.players.map(node => node.getChildByName('agree').getComponent(cc.Label).string) };
    });
    assert.deepEqual(state.members, ['1', '3']);
    assert.ok(state.label.includes(players[2].username));
    assert.deepEqual(state.votes, ['未表决', '同意']);
    await page.screenshot({ path: path.join(output, 'dissolve-noncontiguous-seats.png') });
    await api(`/rooms/${room.id}/dissolve`, players[0].token, { agree: false });
    await page.waitForFunction(() => !cc.mm.uimanager.getWindow('CommonDissolve'));
    assert.deepEqual(errors, []);
    const report = { at: new Date().toISOString(), passed: true, scope: 'Original dissolve UI with occupied seats 1 and 3; no gameplay started.', ...state, errors };
    await writeFile(path.join(output, 'dissolve-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await api(`/rooms/${room.id}/leave`, players[0].token, {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
