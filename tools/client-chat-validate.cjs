const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const { randomBytes } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const output = path.resolve(__dirname, '../client/validation/chat-fixtures');
async function api(route, token, payload) {
  const response = await fetch(base + '/api' + route, { method: payload ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
}
(async () => {
  await mkdir(output, { recursive: true });
  const players = [], pages = [];
  let browser, room;
  const report = { at: new Date().toISOString(), passed: false, scope: 'Two original Cocos browser clients and actual self-hosted WebSocket chat; gender selection on the viewer is controlled test data. Audio timing is browser playback, not Android speaker acceptance.', voices: [], expressions: [], interactions: [], errors: [] };
  try {
    for (let i = 0; i < 2; i++) {
      const credentials = { username: `chat_${randomBytes(8).toString('hex')}`, password: randomBytes(18).toString('base64url') };
      await api('/auth/register', null, credentials);
      const login = await api('/auth/login', null, credentials); players.push({ ...credentials, token: login.token });
    }
    room = await api('/rooms', players[0].token, { variantKey: '4:0', options: { baseBeans: '0.1', gameNum: 4, playerNum: 2 } });
    await api('/rooms/join', players[1].token, { code: room.code });
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    for (let i = 0; i < 2; i++) {
      const page = await browser.newPage({ viewport: i ? { width: 844, height: 390 } : { width: 1334, height: 750 } }); pages.push(page);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(base + '/client/');
      await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
      await page.evaluate(({ username, password }) => {
        const c = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
        c.views['accountLogin/accountid/editbox'].getComponent(cc.EditBox).string = username;
        c.views['accountLogin/passworld/editbox'].getComponent(cc.EditBox).string = password; c.onClick_toGame();
      }, players[i]);
      await page.waitForFunction(() => Object.keys(cc.mm.uimanager.getWindow('dss_game')?.model.players || {}).length === 2);
      await page.waitForFunction(() => !cc.mm.uimanager.windows.CommonPlayUI || cc.mm.uimanager.getWindow('CommonPlayUI'));
      await page.evaluate(() => {
        if (cc.mm.uimanager.getWindow('CommonPlayUI')) cc.mm.uimanager.closewindow('CommonPlayUI');
        window.chatProbe = { paths: [], played: [], interactions: [] };
        const sound = cc.mm.soundManager.playSound;
        cc.mm.soundManager.playSound = function(bundle, asset) { chatProbe.paths.push({ bundle, asset }); return sound.call(this, bundle, asset); };
        const play = cc.audioEngine.playEffect;
        cc.audioEngine.playEffect = function(clip, loop) { const id = play.call(this, clip, loop); chatProbe.played.push({ name: clip.name, id }); return id; };
        const game = cc.mm.uimanager.getWindow('dss_game'), addChild = game.node.addChild;
        game.node.addChild = function(node) {
          const result = addChild.apply(this, arguments);
          if (node.name.startsWith('com_prop_')) chatProbe.interactions.push({ node, start: { x: node.x, y: node.y } });
          return result;
        };
      });
    }
    const [sender, receiver] = pages;
    async function showChat() {
      await sender.evaluate(() => cc.mm.uimanager.showWindow(cc.mm.config.resources, 'CommonFace', cc.mm.uimanager.getWindow('dss_game').model.selfSeat));
      await sender.waitForFunction(() => cc.mm.uimanager.getWindow('CommonFace')?.items.length === 12);
    }
    async function expectAudio(asset, name, mark) {
      await receiver.waitForFunction(({ asset, name, mark }) => chatProbe.paths.some(row => row.asset === asset) && chatProbe.played.slice(mark).some(row => row.name === name && cc.audioEngine.getDuration(row.id) > 0 && cc.audioEngine.getCurrentTime(row.id) > 0.02), { asset, name, mark });
      return receiver.evaluate(({ name, mark }) => { const item = chatProbe.played.slice(mark).find(row => row.name === name); return { duration: cc.audioEngine.getDuration(item.id), elapsed: cc.audioEngine.getCurrentTime(item.id) }; }, { name, mark });
    }
    for (const sex of [0, 1]) for (let id = 0; id < 12; id++) {
      await receiver.evaluate(sex => { const game = cc.mm.uimanager.getWindow('dss_game'); game.model.players[1].sex = sex; }, sex);
      await showChat();
      const mark = await receiver.evaluate(() => chatProbe.played.length);
      await sender.evaluate(id => { const panel = cc.mm.uimanager.getWindow('CommonFace'); panel.onClickText({ node: panel.items[id] }); }, id);
      const asset = `res/sound/${sex ? 'chatwoman' : 'chatman'}/gameChat_${id}`;
      const audio = await expectAudio(asset, `gameChat_${id}`, mark);
      const phrase = await receiver.evaluate(id => {
        const game = cc.mm.uimanager.getWindow('dss_game'), player = game.players[game.model.players[1].showSeat];
        return { expected: cc.mm.config.chatText[id], visible: ['chat_text', 'chat_text_left'].filter(key => player.views[key].active).map(key => player.views[key].getChildByName('label').getComponent(cc.Label).string) };
      }, id);
      assert.ok(phrase.visible.includes(phrase.expected)); report.voices.push({ id, sex, asset, ...audio });
    }
    await receiver.screenshot({ path: path.join(output, 'quick-voice-mobile.png') });
    for (let id = 0; id < 15; id++) {
      await showChat();
      await sender.evaluate(id => { const panel = cc.mm.uimanager.getWindow('CommonFace'); panel.onShowFace(); panel.onClickFace({ node: panel.views['bg/face_layout'].children.find(node => node.name === 'res_dss_chat_' + id) }); }, id);
      await receiver.waitForFunction(id => {
        const game = cc.mm.uimanager.getWindow('dss_game'), player = game.players[game.model.players[1].showSeat];
        const skeleton = player.node.getChildByName('face').getComponent(sp.Skeleton);
        return skeleton.node.active && skeleton.skeletonData?.name === 'res_dss_chat_' + id && skeleton.getCurrent(0)?.trackTime > 0.05;
      }, id);
      if (id === 14) {
        await receiver.screenshot({ path: path.join(output, 'expression-mobile.png') });
        await sender.waitForFunction(id => {
          const game = cc.mm.uimanager.getWindow('dss_game'), skeleton = game.players[game.model.players[1].showSeat].node.getChildByName('face').getComponent(sp.Skeleton);
          return skeleton.node.active && skeleton.skeletonData?.name === 'res_dss_chat_' + id && skeleton.getCurrent(0)?.trackTime > 0.05;
        }, id);
        await sender.screenshot({ path: path.join(output, 'expression-desktop.png') });
      }
      await receiver.waitForFunction(() => {
        const game = cc.mm.uimanager.getWindow('dss_game'), player = game.players[game.model.players[1].showSeat];
        return !player.node.getChildByName('face').active;
      });
      report.expressions.push({ id, animationAdvanced: true, hiddenAfterFirstCycle: true });
    }
    for (let id = 2; id <= 12; id++) {
      await sender.evaluate(() => cc.mm.uimanager.showWindow(cc.mm.config.resources, 'CommonPlayerInfo', cc.mm.uimanager.getWindow('dss_game').model.players[2]));
      await sender.waitForFunction(() => cc.mm.uimanager.getWindow('CommonPlayerInfo'));
      const mark = await receiver.evaluate(() => chatProbe.played.length);
      const interactionMark = await receiver.evaluate(() => chatProbe.interactions.length);
      await sender.evaluate(id => {
        const panel = cc.mm.uimanager.getWindow('CommonPlayerInfo');
        panel.onClickItemBtn({ node: panel.views['root/items/view/content'].children.find(node => node.name === 'btn_' + (id - 1)) }); panel.close();
      }, id);
      const audio = await expectAudio(`sound/magicFace/game_magicFace_${id - 1}`, `game_magicFace_${id - 1}`, mark);
      await receiver.waitForFunction(mark => {
        const entry = chatProbe.interactions[mark];
        return entry && Math.hypot(entry.node.x - entry.start.x, entry.node.y - entry.start.y) > 5;
      }, interactionMark);
      await receiver.waitForFunction(mark => chatProbe.interactions[mark]?.node.getComponent(sp.Skeleton).getCurrent(1)?.trackTime > 0.05, interactionMark);
      const motion = await receiver.evaluate(mark => {
        const entry = chatProbe.interactions[mark], game = cc.mm.uimanager.getWindow('dss_game');
        const source = game.views['palyers/pos' + game.model.players[1].showSeat].getPosition();
        const target = game.views['palyers/pos' + game.model.players[2].showSeat].getPosition();
        return { name: entry.node.name, startError: Math.hypot(entry.start.x - source.x, entry.start.y - source.y), targetError: Math.hypot(entry.node.x - target.x, entry.node.y - target.y) };
      }, interactionMark);
      assert.equal(motion.name, 'com_prop_' + id); assert.ok(motion.startError < 1 && motion.targetError < 1);
      if (id === 2) await receiver.screenshot({ path: path.join(output, 'interaction-mobile.png') });
      await receiver.waitForFunction(mark => !cc.isValid(chatProbe.interactions[mark].node), interactionMark);
      report.interactions.push({ id, ...audio, ...motion, animationAdvanced: true, destroyedAfterAnimation: true });
    }
    const balance = await api('/me', players[0].token);
    assert.equal(balance.balance, '0');
    assert.deepEqual(report.errors, []); report.passed = true;
  } finally {
    if (browser) await browser.close();
    if (room) await api(`/rooms/${room.id}/leave`, players[0].token, {});
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed: report.passed, voices: report.voices.length, expressions: report.expressions.length, interactions: report.interactions.length, errors: report.errors }));
})().catch(error => { console.error(error); process.exitCode = 1; });
