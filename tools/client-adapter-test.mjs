import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { clientEdition } from '../packages/rules/src/edition.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(project, 'apps/server/package.json'));
const Decimal = require('decimal.js');
const protobuf = require('protobufjs/minimal');
const source = await readFile(resolve(project, 'client/public/standalone.js'), 'utf8');
const dssSource = await readFile(resolve(project, 'client/public/assets/dss/index.js'), 'utf8');
const hallSource = await readFile(resolve(project, 'client/public/assets/hall/index.js'), 'utf8');
function adapter(native, nativeUrl, edition = clientEdition) {
  const outgoing = [];
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function (method, url) { outgoing.push(['xhr', url]); };
  function WebSocket(url) { outgoing.push(['ws', url]); }
  const context = { Decimal, protobuf, Uint8Array, XMLHttpRequest, WebSocket, STANDALONE_EDITION: edition, STANDALONE_CONFIG: { apiBase: 'https://game.example:443', wsUrl: 'wss://game.example/ws/original' } };
  if (!native) Object.assign(context, { URL, location: { href: 'https://game.example/client/' }, fetch: async url => { outgoing.push(['fetch', url]); }, navigator: { sendBeacon: url => { outgoing.push(['beacon', url]); return true; } } });
  else if (nativeUrl) context.URL = nativeUrl;
  context.window = context;
  vm.runInNewContext(source, context);
  return { context, outgoing, api: context.Standalone };
}

const roomState = { roomId: '7c96c284-4ae9-4d88-8b55-0f103596a5dc', roundId: 'b76a0717-153b-410a-8bb5-2e2027e3a345', stateVersion: 4 };
function requestExtension(api, command = 23, bytes = [8, 1]) {
  const body = api.appendWireRequest(Uint8Array.from(bytes), command);
  return api.applyWireExtension(body, {});
}
function responseExtension(extension) {
  return protobuf.Writer.create().uint32((60000 << 3) | 2).string(JSON.stringify(extension)).finish();
}
function deliver(api, state, code = 20) {
  return api.distributeWireMessage({ code, body: {}, extension: { version: 2, decimalFields: [], roomState: state } });
}
for (const native of [false, true]) {
  test((native ? 'JSB' : 'browser') + ': requests use delivered state, stable retries and correlated acknowledgements', () => {
    const { api } = adapter(native);
    assert.throws(() => requestExtension(api), /restored/);
    api.receiveWireMessage({ roomState });
    assert.throws(() => requestExtension(api), /restored/, 'queued state must not be used early');
    deliver(api, roomState);
    const first = requestExtension(api).request;
    assert.equal(first.roomId, roomState.roomId);
    assert.equal(first.expectedRoundId, roomState.roundId);
    assert.equal(first.expectedStateVersion, 4);
    assert.equal(requestExtension(api).request.commandId, first.commandId);
    api.receiveWireMessage({ ack: { commandId: 'wrong-command-id' } });
    assert.throws(() => requestExtension(api, 53), /awaiting/);
    api.receiveWireMessage({ ack: { commandId: first.commandId }, roomState: { ...roomState, stateVersion: 5 } });
    assert.equal(requestExtension(api).request.commandId, first.commandId, 'a duplicate visible action remains the same command after ack');
    api.receiveWireMessage({ ack: { commandId: first.commandId } });
    deliver(api, { ...roomState, stateVersion: 5 }, 24);
    assert.equal(requestExtension(api).request.expectedStateVersion, 4, 'a response cannot advance the animation cursor');
    api.receiveWireMessage({ ack: { commandId: first.commandId } });
    deliver(api, { ...roomState, stateVersion: 5 });
    const next = requestExtension(api).request;
    assert.notEqual(next.commandId, first.commandId);
    assert.equal(next.expectedStateVersion, 5);
    assert.equal(deliver(api, roomState), false, 'outdated queued state is rejected');
    api.resetWireSession();
    assert.throws(() => requestExtension(api), /restored/);
  });
}

test('waiting-room autoplay binds its room and permits a new toggle only after confirmation', () => {
  const { api } = adapter(true);
  deliver(api, { ...roomState, roundId: null, stateVersion: null }, 48);
  assert.throws(() => requestExtension(api), /restored/);
  const first = requestExtension(api, 121, []).request;
  assert.equal(first.roomId, roomState.roomId);
  assert.equal(first.expectedRoundId, undefined);
  assert.equal(requestExtension(api, 121, []).request.commandId, first.commandId);
  api.receiveWireMessage({ ack: { commandId: first.commandId } });
  const second = requestExtension(api, 125, []).request;
  assert.notEqual(second.commandId, first.commandId);
  deliver(api, { roomId: null, roundId: null, stateVersion: null }, 18);
  assert.throws(() => requestExtension(api, 121, []), /restored/);
});

test('rejected optimistic actions clear queued animations and request one authoritative snapshot', () => {
  const { api, context } = adapter(true);
  const sent = [], prompts = [], cleared = [];
  context.cc = { mm: {
    uimanager: { showTextPrompt: text => prompts.push(text) },
    server: { _msgActList: [{ code: 25 }], _colTime: 16, _lastStageTime: 99, _ws: { isConnent: () => true }, send: (...args) => sent.push(args) },
    gameserver: { room_data: { roomId: 654321 }, getLatitude: () => 0, getLongitude: () => 0 },
    notification: { emit: name => cleared.push(name) }, frametype: { MSG_CLEAR_OPERATOR: 'clear' }, framemodel: { uid: '100001' }, msgEvent: {},
  } };
  deliver(api, roomState);
  const first = requestExtension(api).request;
  api.receiveWireMessage({ ack: { commandId: first.commandId } });
  const failed = { code: 24, extension: { error: { code: 'STALE_STATE', message: 'stale' }, ack: { commandId: first.commandId } } };
  assert.equal(api.distributeWireMessage(failed), false);
  assert.equal(context.cc.mm.server._msgActList.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], 47);
  assert.equal(sent[0][0].hwRequestEnterTableFinish.roomId, 654321);
  assert.deepEqual(cleared, ['clear']);
  assert.throws(() => requestExtension(api), /restored/);
  api.distributeWireMessage(failed);
  assert.equal(sent.length, 1, 'one snapshot request while recovery is pending');
  deliver(api, { ...roomState, stateVersion: 6 }, 48);
  assert.equal(requestExtension(api).request.expectedStateVersion, 6);
});

test('malformed extension state or acknowledgement cannot enter the transport', () => {
  const { api } = adapter(true);
  for (const invalid of [{ ...roomState, stateVersion: 1.5 }, { ...roomState, roundId: null }, { ...roomState, roomId: '654321' }]) {
    const body = protobuf.Writer.create().uint32((60000 << 3) | 2).string(JSON.stringify({ version: 2, decimalFields: [], roomState: invalid })).finish();
    assert.throws(() => api.applyWireExtension(body, {}), /Invalid room state/);
  }
  const body = protobuf.Writer.create().uint32((60000 << 3) | 2).string(JSON.stringify({ version: 2, decimalFields: [], ack: { commandId: '../invalid' } })).finish();
  assert.throws(() => api.applyWireExtension(body, {}), /Invalid command acknowledgement/);
});

test('server-frozen room options override local drafts only on matching room responses', () => {
  const { api, context } = adapter(true);
  const options = { baseBeans: '99999999999999999999999999999999999999999999999999999999999999999999999999.123456789012', baseBeansSource: 'manual', playerNum: 3, playerNumSource: 'manual' };
  context.cc = { mm: { hallserver: { mLastRoomParam: { roomId: 654321, playerNum: 2, baseBeans: 'client-draft' } } } };
  const decoded = { hwResponseCreateTable: { tableInfo: { roomId: 654321, playerNum: 3 } } };
  const extension = api.applyWireExtension(responseExtension({ version: 2, decimalFields: [], roomState: { ...roomState, roundId: null, stateVersion: null }, roomOptions: options }), decoded, true);
  assert.equal(decoded.hwResponseCreateTable.tableInfo.baseBeans, undefined, 'parsing alone cannot change room state');
  assert.equal(api.distributeWireMessage({ code: 4, body: decoded.hwResponseCreateTable, extension }), true);
  assert.equal(decoded.hwResponseCreateTable.tableInfo.baseBeans, options.baseBeans);
  assert.equal(decoded.hwResponseCreateTable.tableInfo.baseBeansSource, 'manual');
  assert.equal(decoded.hwResponseCreateTable.tableInfo.playerNumSource, 'manual');
  assert.equal(context.cc.mm.hallserver.mLastRoomParam.baseBeans, options.baseBeans);
  assert.equal(context.cc.mm.hallserver.mLastRoomParam.playerNum, 3);

  api.resetWireSession();
  const loginOptions = { baseBeans: '0.125', baseBeansSource: 'manual', playerNum: 3, playerNumSource: 'manual' };
  assert.equal(api.distributeWireMessage({ code: 2, body: { tableId: 654321 }, extension: { version: 2, decimalFields: [], roomState: { ...roomState, roundId: null, stateVersion: null }, roomOptions: loginOptions } }), true);
  const reconnectTable = { tableInfo: { roomId: 654321, playerNum: 3 } };
  assert.equal(api.distributeWireMessage({ code: 6, body: reconnectTable, extension: { version: 2, decimalFields: [], roomState: { ...roomState, roundId: null, stateVersion: null } } }), true);
  assert.equal(reconnectTable.tableInfo.baseBeans, '0.125', 'the validated login snapshot carries through to the matching enter response');

  const requestOnly = responseExtension({ version: 2, decimalFields: [], createRoom: { baseBeans: '0.125' } });
  assert.throws(() => api.applyWireExtension(requestOnly, {}, true), /Request-only protocol extension/);
  assert.throws(() => api.distributeWireMessage({ code: 50, body: {}, extension: { version: 2, decimalFields: [], roomState: { ...roomState, roundId: null, stateVersion: null }, roomOptions: loginOptions } }), /not valid for this response/);
  assert.throws(() => api.distributeWireMessage({ code: 4, body: { tableInfo: { roomId: 654321, playerNum: 2 } }, extension: { version: 2, decimalFields: [], roomState: { ...roomState, roundId: null, stateVersion: null }, roomOptions: loginOptions } }), /do not match the table/);
  assert.throws(() => api.applyWireExtension(responseExtension({ version: 2, decimalFields: [], roomOptions: { ...loginOptions, extra: true } }), {}, true), /Invalid frozen room options/);
});

test('V2 room creation metadata carries only required exact bean and player fields', () => {
  const { api, context } = adapter(true);
  const sent = [], prompts = [];
  context.cc = { mm: {
    hallserver: { requestCreateRoom: (...args) => { sent.push(args); return true; } },
    uimanager: { showTextPrompt: message => prompts.push(message) },
  } };
  function create(rules, areaType) {
    const result = api.createRoom({ _rules: rules }, rules, areaType);
    return result === false ? null : api.applyWireExtension(api.appendWireRequest(Uint8Array.from([8, 1]), 3), {});
  }
  const ordinary = create({ basicTimes: 1, playerNum: 4 }, 2);
  assert.equal(ordinary, null, 'removed original game cannot be created');
  const exact = '9'.repeat(80) + '.123456789012';
  const manualBase = create({ baseBeans: exact, playerNum: 4 }, 4);
  assert.equal(JSON.stringify(manualBase.createRoom), JSON.stringify({ baseBeans: exact }));
  const manualBoth = create({ baseBeans: '0.125', playerNum: 3 }, 14);
  assert.equal(JSON.stringify(manualBoth.createRoom), JSON.stringify({ baseBeans: '0.125', playerNum: 3 }));
  assert.equal(create({ baseBeans: '0.125' }, 14), null);
  assert.equal(create({ baseBeans: '0' }, 4), null);
  assert.deepEqual(prompts.slice(-2), ['请选择房间人数', '请输入正数底分（豆子）']);
  assert.equal(sent.length, 2, 'invalid room forms do not invoke the original create call');
});

test('Qionglai response and replay restore exact options; another region cannot accept the snapshot', () => {
  const { api } = adapter(true);
  // S1-AC2：开房列表只露新津斗十四；其他保留玩法的老房间、回放照常（下面邛崃回放仍能还原）。已移除的都不能开。
  assert.deepEqual(clientEdition.visibleGameIds, [4]);
  for (const id of clientEdition.gameIds) assert.equal(api.supportsArea(id), id === 4, String(id));
  for (const id of [2, 3, 13, 17, 18, 101]) assert.equal(api.supportsArea(id), false);
  // 旧安装包自带的配置没有 visibleGameIds，也只露新津。
  const { visibleGameIds, ...oldEdition } = clientEdition;
  assert.equal(adapter(true, undefined, oldEdition).api.supportsArea(8), false);
  assert.equal(adapter(true, undefined, oldEdition).api.supportsArea(4), true);
  const qionglai = { version: clientEdition.qionglaiVersion, qlTianDiHu: 0, qlHongHeiHu: 1, qlHongHei50: 1 };
  const options = { baseBeans: '0.125', baseBeansSource: 'manual', playerNum: 3, playerNumSource: 'original', qionglai };
  const table = { roomId: 654321, playerNum: 3, areaType: 8 };
  api.restoreReplayRoomOptions(options, table);
  assert.equal(table.qlTianDiHu, 0);
  assert.equal(table.qlHongHei50, 1);
  assert.equal(table.baseBeans, '0.125');
  assert.equal(api.qionglaiRuleSummary(table), '红胡黑胡、红50黑50、');
  assert.throws(() => api.restoreReplayRoomOptions(options, { roomId: 654321, playerNum: 3, areaType: 7 }), /another game/);
});

test('friend-room bean notifications update balance without overwriting round deltas', () => {
  const tableStart = dssSource.indexOf('_ntfUserDataChange: function(e) {');
  const tableEnd = dssSource.indexOf('_ntfShowTgView: function(e) {', tableStart);
  const playerStart = dssSource.indexOf('_noticeUserDataChange: function(e) {');
  const playerEnd = dssSource.indexOf('_noticeAddGold: function(e) {', playerStart);
  const scoreStart = dssSource.indexOf('_noticeScoreChange: function(e) {');
  const scoreEnd = dssSource.indexOf('_noticeUserDataChange: function(e) {', scoreStart);
  assert.ok(tableStart >= 0 && tableEnd > tableStart && playerStart >= 0 && playerEnd > playerStart && scoreStart >= 0 && scoreEnd > scoreStart);
  const tableNotice = dssSource.slice(tableStart, tableEnd);
  const playerNotice = dssSource.slice(playerStart, playerEnd);
  const scoreNotice = dssSource.slice(scoreStart, scoreEnd);
  assert.match(tableNotice, /for \(var i = 0; i < this\.model\.playerNum; i\+\+\)/);
  const balanceLoop = tableNotice.split('9031 ==')[0];
  assert.doesNotMatch(balanceLoop, /roomType !== t\.EN_ROOM_TYPE_FRIEND/);
  assert.match(balanceLoop, /this\.model\.players\[i\]\.score = e\.goldNum;/);
  assert.match(playerNotice, /this\._model\.score = e\.goldNum;\nthis\.updateScore\(\);/);
  assert.doesNotMatch(playerNotice, /roomType != c\.huinan\.server\.proto\.ENRoomType\.EN_ROOM_TYPE_FRIEND/);
  assert.match(scoreNotice, /this\._model\.roundBeanDelta = window\.Standalone\.addAmount/);
  assert.doesNotMatch(scoreNotice, /this\._model\.score \+= e\.scoreChange/);
  assert.match(scoreNotice, /s\.addComponent\(cc\.Label\);/, 'the bean-change animation must create its label before formatting it');
});

test('hall bean balance retains the original left segment and cannot enter the retired store', () => {
  assert.match(source, /panel\.setAnchorPoint\(0, 0\.5\)/);
  assert.match(source, /panel\.setPosition\(-coin\.width \* coin\.anchorX, height \* \(0\.5 - coin\.anchorY\)\)/);
  assert.match(source, /value\.setPosition\(width - 14, 0\)/);
  assert.doesNotMatch(source, /nameLabel\.string = '豆子'/);
  assert.match(source, /button\.interactable = false; button\.enabled = false/);
  assert.match(source, /if \(hall && typeof hall\.showView === 'function'\) hall\.showView\(\)/);
  assert.doesNotMatch(hallSource, /this\.views\.hallcoin, this\.onClickHallCoinBtn\.bind\(this\)/);
  assert.match(hallSource, /retired store action is intentionally unbound/);
});

test('manual base-bean input always renders an explicit placeholder and entered text', () => {
  assert.match(source, /edit\.textLabel = makeEditLabel\('TEXT_LABEL'/);
  assert.match(source, /edit\.placeholderLabel = makeEditLabel\('PLACEHOLDER_LABEL'/);
  assert.match(source, /edit\.placeholder = '请输入底分（豆子）'/);
  assert.doesNotMatch(source, /baseBeansDisplay/);
});

test('response window travels with rendered decisions and big balances retain the final decimal', () => {
  const { api } = adapter(true);
  api.distributeWireMessage({ code: 20, body: {}, extension: { version: 2, decimalFields: [], roomState, decisionId: 'response:one' } });
  assert.equal(requestExtension(api).request.decisionId, 'response:one');
  assert.equal(api.addAmount('1' + '0'.repeat(160), '0.000000000001'), '1' + '0'.repeat(160) + '.000000000001');
});

test('JSB URL shims with no origin parser still enforce the configured authority', () => {
  for (const shim of [function URL() {}, function URL() { throw new Error('Not implemented'); }]) {
    const { api, context, outgoing } = adapter(true, shim);
    new context.XMLHttpRequest().open('GET', 'https://game.example/health');
    new context.WebSocket('wss://game.example/ws/original');
    assert.equal(outgoing.length, 2);
    assert.equal(api.allowedRequest('https://game.example.evil.invalid/health', false), false);
    assert.throws(() => new context.XMLHttpRequest().open('GET', 'https://game.example@evil.invalid/health'), /External request blocked/);
  }
});
for (const native of [false, true]) {
  const platform = native ? 'JSB without DOM/URL/fetch' : 'browser';
  test(platform + ': exact score arithmetic and maximum-scale display', () => {
    const { api } = adapter(native);
    assert.equal(api.addAmount('0.1', '0.2'), '0.3');
    assert.equal(api.addAmount('99999999999999999999999.999999999999', '0.000000000001'), '100000000000000000000000');
    assert.equal(api.subtractAmount('0.1', '0.3'), '-0.2');
    assert.equal(api.amount('0.000000000001'), '0.000000000001');
    assert.equal(api.amount({ toString: () => '1234567890123456789' }), '1234567890123456789');
    assert.equal(api.compareAmount('10', '9.9'), 1);
    assert.equal(api.compareAmount('10.0', '10'), 0);
    assert.equal(api.signedAmount('-0.000'), '0');
    assert.equal(api.signedAmount('0.1'), '+0.1');
    assert.throws(() => api.amount('NaN'), /Invalid exact amount/);
    assert.throws(() => api.amount('0.0000000000001'), /Invalid exact amount/);
  });
  test(platform + ': original and obfuscated network destinations rejected before transport', async () => {
    const { context, api, outgoing } = adapter(native);
    const forbidden = ['https://game.example.evil.invalid/a', 'https://game.example@evil.invalid/a', 'http://game.example/a', 'http://d14api.handka.com:8002', '//evil.invalid/a', 'https://game.example\\@evil.invalid/a', 'file:///etc/passwd', 'data:text/plain,example', 'https://game.example:444/a'];
    for (const url of forbidden) {
      assert.equal(api.allowedRequest(url, false), false, url);
      assert.throws(() => new context.XMLHttpRequest().open('GET', url), /External request blocked/);
    }
    assert.throws(() => new context.WebSocket('wss://d14api.handka.com/ws'), /External request blocked/);
    assert.deepEqual(outgoing, []);
    new context.XMLHttpRequest().open('GET', 'https://game.example/health');
    new context.WebSocket('wss://game.example:443/ws/original');
    assert.equal(api.allowedRequest('assets/dss/config.json', false), true);
    assert.equal(outgoing.length, 2);
    if (!native) {
      await assert.rejects(context.fetch('https://evil.invalid/a'), /External request blocked/);
      assert.equal(context.navigator.sendBeacon('https://evil.invalid/a'), false);
      assert.equal(outgoing.length, 2);
    }
  });
}

test('original score fonts retain original glyphs and source decimal pixels', async () => {
  const manifest = JSON.parse(await readFile(resolve(project, 'client/decimal-font-manifest.json'), 'utf8'));
  assert.equal(manifest.length, 2);
  // 原版 APK 解包资源只在原开发机上（work/apk），本机没有。项目里存一份字体定义当基准：
  // 2026-10-30 由当时的补丁文件去掉「.」字形得到，用来防止以后改到「.」以外的字形。
  const originals = JSON.parse(await readFile(resolve(project, 'client/decimal-font-original.json'), 'utf8'));
  for (const entry of manifest) {
    const fontPath = `assets/dss/import/${entry.id.slice(0, 2)}/${entry.id}.json`;
    const original = originals[entry.id];
    const patched = JSON.parse(await readFile(resolve(project, 'client/public', fontPath), 'utf8'))[5][0][3];
    const point = patched.fontDefDictionary[46];
    assert.ok(point.rect.width > 0 && point.rect.height > 0);
    const donor = original.fontDefDictionary[45].rect;
    assert.ok(point.rect.x >= donor.x && point.rect.y >= donor.y);
    assert.ok(point.rect.x + point.rect.width <= donor.x + donor.width);
    assert.ok(point.rect.y + point.rect.height <= donor.y + donor.height);
    delete patched.fontDefDictionary[46];
    assert.deepEqual(patched, original);
  }
});
