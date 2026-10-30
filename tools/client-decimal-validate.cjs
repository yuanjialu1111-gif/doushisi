const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const { randomBytes } = require('node:crypto');
const { writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const output = path.resolve(__dirname, '../client/validation/decimal-fixtures');
async function api(route, token, payload) {
  const response = await fetch(base + '/api' + route, { method: payload ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
(async () => {
  await mkdir(output, { recursive: true });
  const players = [];
  for (let index = 0; index < 3; index++) {
    const credentials = { username: `decimal_${Date.now()}_${index}`, password: randomBytes(18).toString('base64url') };
    await api('/auth/register', null, credentials);
    const session = await api('/auth/login', null, credentials);
    players.push({ ...credentials, token: session.token });
  }
  const room = await api('/rooms', players[0].token, { variantKey: '4:0', options: { baseBeans: '0.1', gameNum: 4, playerNum: 3 } });
  for (const player of players.slice(1)) await api('/rooms/join', player.token, { code: room.code });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = { at: new Date().toISOString(), fixtureOnly: true, scope: 'Controlled original Cocos UI with local fixture scores. No game, settlement, original-server comparison or native acceptance is claimed.', views: [], errors: [], requestsOutsideServer: [] };
  try {
    for (const viewport of [{ width: 1334, height: 750 }, { width: 844, height: 390 }]) {
      const page = await browser.newPage({ viewport });
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('request', request => { if (!request.url().startsWith(base + '/')) report.requestsOutsideServer.push(request.url()); });
      await page.goto(base + '/client/');
      await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('LoginUI')?.getComponent('LoginUIController')?.views.accountLogin.active);
      await page.evaluate(({ username, password }) => {
        const controller = cc.director.getScene().getChildByName('LoginUI').getComponent('LoginUIController');
        controller.views['accountLogin/accountid/editbox'].getComponent(cc.EditBox).string = username;
        controller.views['accountLogin/passworld/editbox'].getComponent(cc.EditBox).string = password;
        controller.onClick_toGame();
      }, players[0]);
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('dss_game')?.model.selfSeat === 1);
      await page.waitForFunction(() => !!cc.mm.uimanager.getWindow('CommonPlayUI'));
      await page.evaluate(() => cc.mm.uimanager.getWindow('CommonPlayUI').close());
      await page.waitForFunction(() => !cc.mm.uimanager.getWindow('CommonPlayUI'));
      const fixture = await page.evaluate(() => {
        const game = cc.mm.uimanager.getWindow('dss_game');
        const controllers = Object.values(game.players).filter(player => player?._model);
        const labels = [];
        controllers.forEach((player, index) => {
          player._model.score = ['0.1', '-0.25', '9999.123456789012'][index];
          player.updateScore();
          if (index === 0) player._noticeScoreChange({ scoreChange: '0.2' });
          labels.push({ seat: player._model.seatIndex, score: player._model.score, roundBeanDelta: player._model.roundBeanDelta || '0' });
        });
        const members = Object.values(game.model.players);
        window.decimalFixture = { roomId: 123456, creatorUid: members[0].uid, round: 1, allRound: 4, dealerSeat: 1, xiaoSeat: 0, basicTimes: '0.1', isHuang: false, againUsers: [], userScoreInfo: members.map((member, index) => ({ ...member, nick: ['Fixture A', 'Fixture B', 'Fixture C'][index], score: ['9.9', '10', '-19.9'][index], changeScore: ['0.125', '-0.125', '0'][index], picUrl: '', headType: 0 })), smallResult: { userBrand: members.map(() => ({ tilesOnHand: [101, 113], huCard: 0, colInfo: [], protectCards: [], cardType: [], scoreInfo: [], fanNum: 1, pointNum: 20 })) } };
        return labels;
      });
      // A score-change animation is this round's bean delta.  It must not mutate
      // the wallet-derived seat balance; that happens only after settlement.
      assert.ok(fixture.some(player => player.score === '0.1' && player.roundBeanDelta === '0.2'), JSON.stringify(fixture));
      await page.waitForFunction(() => {
        const scoreValues = new Set(cc.director.getScene().getComponentsInChildren(cc.Label).map(label => label.string));
        const animationVisible = Object.values(cc.mm.uimanager.getWindow('dss_game').players).some(player => (player?.scoreEffect?.children || []).some(node => node.getComponent(cc.Label)?.string === '+0.2豆'));
        return ['0.1', '-0.25', '9999.123456789012'].every(value => scoreValues.has(value)) && animationVisible;
      }, null, { timeout: 5000 });
      const tableLabels = await page.evaluate(() => cc.director.getScene().getComponentsInChildren(cc.Label).filter(label => ['0.1', '-0.25', '9999.123456789012'].includes(label.string)).map(label => ({ value: label.string, fontSize: label.fontSize, actualFontSize: label.actualFontSize, font: label.font?.name, fontConfigSize: label.font?._fntConfig?.fontSize, width: label.node.width, height: label.node.height, scale: [label.node.scaleX, label.node.scaleY], bounds: label.node._standaloneScoreBounds })));
      assert.deepEqual(new Set(tableLabels.map(label => label.value)), new Set(['0.1', '-0.25', '9999.123456789012']));
      assert.ok(tableLabels.filter(label => label.value !== '9999.123456789012').every(label => label.fontSize === label.actualFontSize), 'Ordinary decimals must retain original font size');
      const animation = await page.evaluate(() => Object.values(cc.mm.uimanager.getWindow('dss_game').players).flatMap(player => (player?.scoreEffect?.children || []).map(node => {
        const label = node.getComponent(cc.Label);
        return { string: label?.string, font: label?.font?.name, decimal: !!label?.font?._fntConfig?.fontDefDictionary[46], size: [node.width, node.height] };
      })));
      assert.ok(animation.some(label => label.string === '+0.2豆' && label.decimal), JSON.stringify(animation));
      await page.screenshot({ path: path.join(output, `table-${viewport.width}.png`) });
      await page.evaluate(() => cc.mm.uimanager.showWindow(cc.mm.config.dss, 'dss_settle_UI', window.decimalFixture));
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('dss_settle_UI')?.views.center.children.length === 3);
      await page.waitForTimeout(150);
      const smallResult = await page.evaluate(() => cc.mm.uimanager.getWindow('dss_settle_UI').views.center.children.map(node => ['winscoreLabel', 'losescoreLabel'].map(name => {
        const child = node.getChildByName(name), label = child.getComponent(cc.Label);
        return { active: child.active, string: label.string, font: label.font?.name, width: child.width, height: child.height, actualFontSize: label.actualFontSize };
      }).find(label => label.active)));
      assert.deepEqual(smallResult.map(label => label.string).sort(), ['-0.125', '0', '0.125']);
      await page.screenshot({ path: path.join(output, `small-result-${viewport.width}.png`) });
      await page.evaluate(() => { cc.mm.uimanager.getWindow('dss_settle_UI').close(); cc.mm.uimanager.showWindow(cc.mm.config.resources, 'CommonBigResult', window.decimalFixture); });
      await page.waitForFunction(() => cc.mm.uimanager.getWindow('CommonBigResult')?.views.players.children.length === 3);
      await page.waitForTimeout(100);
      const bigResult = await page.evaluate(() => {
        const controller = cc.mm.uimanager.getWindow('CommonBigResult');
        return { maximum: controller._bigScore, labels: controller.views.players.children.map(node => ({ winner: node.getChildByName('bigwin').active, score: ['winscore', 'losescore'].map(name => node.getChildByName(name)).filter(child => child.active).map(child => child.getComponent(cc.Label).string) })) };
      });
      assert.equal(bigResult.maximum, '10');
      assert.equal(bigResult.labels.filter(player => player.winner).length, 1);
      assert.deepEqual(bigResult.labels.find(player => player.winner).score, ['+10豆']);
      await page.screenshot({ path: path.join(output, `big-result-${viewport.width}.png`) });
      await page.evaluate(() => { cc.mm.uimanager.getWindow('CommonBigResult').close(); cc.mm.uimanager.showWindow(cc.mm.config.hall, 'HallRecordUI'); });
      await page.waitForFunction(() => !!cc.mm.uimanager.getWindow('HallRecordUI'));
      await page.waitForTimeout(250);
      await page.evaluate(() => cc.mm.uimanager.getWindow('HallRecordUI').loadGameConfig({ recordInfo: [{ date: '2026-09-08 12:00', roomId: 123456, recordId: 'fixture-display', round: 1, userInfo: window.decimalFixture.userScoreInfo }] }));
      const records = await page.evaluate(() => {
        const controller = cc.mm.uimanager.getWindow('HallRecordUI');
        return controller.views['root/rightNode/scrollview/view/content'].children[0].getChildByName('menber').children.filter(node => node.getChildByName('score')).map(node => node.getChildByName('score').getComponent(cc.Label).string);
      });
      assert.deepEqual(records, ['+9.9豆', '+10豆', '-19.9豆']);
      await page.screenshot({ path: path.join(output, `records-${viewport.width}.png`) });
      await page.evaluate(() => cc.mm.uimanager.getWindow('HallRecordUI').close());
      const fontPixels = await page.evaluate(async () => {
        const bundle = cc.assetManager.getBundle('dss');
        const names = ['dds_win_score', 'dds_lose_score'];
        const fonts = await Promise.all(names.map(name => new Promise((resolve, reject) => bundle.load('res/fonts/' + name, cc.BitmapFont, (error, font) => error ? reject(error) : resolve(font)))));
        return fonts.map((font, index) => {
          const glyph = font._fntConfig.fontDefDictionary[46].rect;
          const frame = font.spriteFrame, atlas = frame.getTexture().getHtmlElementObj();
          const canvas = document.createElement('canvas');
          canvas.width = glyph.width; canvas.height = glyph.height;
          const context = canvas.getContext('2d');
          context.drawImage(atlas, frame.getRect().x + glyph.x, frame.getRect().y + glyph.y, glyph.width, glyph.height, 0, 0, glyph.width, glyph.height);
          const pixels = context.getImageData(0, 0, glyph.width, glyph.height).data;
          let visible = 0;
          for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] > 32) visible++;
          const node = new cc.Node('decimal-font-fixture-' + index), label = node.addComponent(cc.Label);
          label.font = font; label.fontSize = 64; label.lineHeight = 74; label.string = index ? '-0.125' : '+0.125';
          node.y = index ? -80 : 80;
          node.zIndex = 999;
          cc.mm.uimanager.getWindow('dss_game').node.addChild(node);
          return { font: font.name, visiblePixels: visible, totalPixels: glyph.width * glyph.height };
        });
      });
      assert.ok(fontPixels.every(font => font.visiblePixels > 20), 'The generated decimal glyph must have visible original pixels');
      const networkPolicy = await page.evaluate(() => {
        const node = new cc.Node('webview-network-fixture'), web = node.addComponent(cc.WebView);
        web.url = 'http://dssshare.lanrendapai.cn:8019/public/yinsitiaokuan';
        const originalWebViewBlocked = web.url === 'about:blank';
        node.destroy();
        return { originalWebViewBlocked, contentSecurityPolicy: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content };
      });
      assert.equal(networkPolicy.originalWebViewBlocked, true);
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(output, `decimal-fonts-${viewport.width}.png`) });
      const stats = await sharp(path.join(output, `table-${viewport.width}.png`)).stats();
      assert.ok(stats.channels.some(channel => channel.stdev > 20), 'Blank original table canvas');
      report.views.push({ viewport, arithmetic: fixture, tableLabels, animation, smallResult, bigResult, records, fontPixels, networkPolicy, canvasStandardDeviation: stats.channels.map(channel => channel.stdev) });
      await page.close();
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.requestsOutsideServer, []);
    report.passed = true;
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, fixtureOnly: true, viewports: report.views.length, errors: report.errors }));
  } finally {
    await browser.close();
    for (const player of [...players].reverse()) await api(`/rooms/${room.id}/leave`, player.token, {}).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
