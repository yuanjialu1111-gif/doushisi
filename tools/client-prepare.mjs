import { cp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { commandBodyFields } from '../packages/protocol/src/body-fields.ts';
import { clientEdition } from '../packages/rules/src/edition.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(project, '../..');
const source = resolve(process.argv[2] || join(workspace, 'work/apk/assets'));
const engine = resolve(process.argv[3] || join(workspace, 'work/client-build/cocos-engine-2.4.7/bin/cocos2d-js.js'));
const target = join(project, 'client/public');
await mkdir(target, { recursive: true });
await writeFile(join(target, 'edition-config.js'), 'window.STANDALONE_EDITION = ' + JSON.stringify(clientEdition) + ';\n');
for (const bundle of ['main', 'internal', 'resources', 'hall', 'dss']) {
  await cp(join(source, 'assets', bundle), join(target, 'assets', bundle), { recursive: true });
}
// Cocos resolves these raw assets while loading the browser bundle. Keep them locally so
// startup never falls back to the retired service; the standalone adapter still disables
// the original hot-update flow and only permits requests to the self-hosted origin.
await cp(join(source, 'assets/main/native'), join(target, 'assets/main/native'), { recursive: true });
await cp(join(source, 'src/assets'), join(target, 'src/assets'), { recursive: true });
await copyFile(engine, join(target, 'cocos2d-js.js'));
await copyFile(join(project, 'apps/server/node_modules/decimal.js/decimal.js'), join(target, 'decimal.js'));
const settings = (await readFile(join(source, 'src/settings.js'), 'utf8')).replace('platform:"android"', 'platform:"web-mobile"');
await writeFile(join(target, 'src/settings.js'), settings);
const boot = await readFile(join(source, 'main.js'), 'utf8');
await writeFile(join(target, 'main.js'), boot.slice(boot.indexOf('window.boot = function')));

function exactlyOnce(sourceText, original, replacement) {
  if (sourceText.split(original).length !== 2) throw new Error('Source fingerprint mismatch: ' + original.slice(0, 100));
  return sourceText.replace(original, replacement);
}

function replaceCount(sourceText, original, replacement, count) {
  if (sourceText.split(original).length !== count + 1) throw new Error('Source fingerprint count mismatch: ' + original.slice(0, 100));
  return sourceText.split(original).join(replacement);
}

let main = (await readFile(join(source, 'assets/main/index.js'), 'utf8')).replace(/\r\n/g, '\n');
main = exactlyOnce(main, 'http_server: "http://192.168.2.235:9001/",', 'http_server: window.Standalone.config.apiBase + "/",');
main = exactlyOnce(main, 'ws_server: "ws://d14api.handka.com:8002",', 'ws_server: window.Standalone.config.wsUrl,');
main = exactlyOnce(main, 'cc.mm.gameconfig = c;', 'cc.mm.gameconfig = c;\nwindow.Standalone.installApp(cc.mm);');
main = exactlyOnce(main, 'this.views.userreg.active = !!r;\n}\n},', 'this.views.userreg.active = !!r;\n}\nwindow.Standalone.login(this);\n},');
main = exactlyOnce(main, 'onClick_closeAccount: function() {\nthis.views.accountLogin.active = !1;\nthis.views.wxlogin.active = !0;\n}', 'onClick_closeAccount: function() {\nwindow.Standalone.login(this);\n}');
main = exactlyOnce(main, 'cc.sys.localStorage.setItem("PASSWORD_ID", this._password);', 'cc.sys.localStorage.removeItem("PASSWORD_ID");');
main = exactlyOnce(main, 'cc.sys.localStorage.setItem("GAME_TOKEN", e.token);', 'cc.sys.localStorage.setItem("GAME_TOKEN", e.token);\ncc.sys.localStorage.setItem("Game_Last_Login_time", Date.now());\nif (cc.mm.server._account) cc.sys.localStorage.setItem("ACCOUNT_ID", cc.mm.server._account);');
main = exactlyOnce(main, 'cc.sys.openURL("https://appdown.weitianwlkj.com/62OrIO");', 'cc.sys.openURL("about:blank");');
main = exactlyOnce(main, '"http://dssshare.lanrendapai.cn:8019/public/yinsitiaokuan"', 'window.Standalone.config.apiBase + "/client/privacy.html"');
main = exactlyOnce(main, '"http://dssshare.lanrendapai.cn:8019/public/yonghuxieyi"', 'window.Standalone.config.apiBase + "/client/terms.html"');
main = exactlyOnce(main, 'console.log(JSON.stringify(e.toJSON()));', '/* Sensitive protocol bodies must not enter the console. */');
main = exactlyOnce(main, 'c.channelId = 1;', 'o = window.Standalone.appendWireRequest(o, a);\nc.channelId = 1;\nc.protoVersion = 2;');
main = exactlyOnce(main, 'var i = t.huinan.server.proto.MsgData.decode(r);\ne = null;\nconsole.log(i);', 'var i = t.huinan.server.proto.MsgData.decode(r);\nvar extension = window.Standalone.applyWireExtension(r, i, true);\ne = null;');
main = exactlyOnce(main, 'cmd: o.cmd,\ndata: i', 'cmd: o.cmd,\ndata: i,\nextension: extension');
main = exactlyOnce(main, 'var a = cc.mm.netTools.receive(e.data), t = a.data[a.data.msgUnion];', 'var a = cc.mm.netTools.receive(e.data), t = a.data[a.data.msgUnion];\nwindow.Standalone.receiveWireMessage(a.extension);');
main = exactlyOnce(main, 't.result && 1 != t.result && cc.sys.isBrowser', '!(a.extension && a.extension.error) && t.result && 1 != t.result && cc.sys.isBrowser');
main = exactlyOnce(main, 'this._msgActList.length = 0;\ncc.warn("清空消息");', 'this._msgActList.length = 0;\nwindow.Standalone.resetWireSession();\ncc.warn("清空消息");');
main = exactlyOnce(main, 'body: t,\ncode: a.cmd', 'body: t,\ncode: a.cmd,\nextension: a.extension');
main = exactlyOnce(main, 'cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + a, e.body, a);', 'if (window.Standalone.distributeWireMessage(e)) { cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + a, e.body, a); if (window.StandaloneReplay) StandaloneReplay.didDispatch(); }');
main = exactlyOnce(main, 'cc.mm.hallserver.requestUrlInfo();\ncc.mm.hallserver.requestHeadInfo();', 'if (window.StandaloneReplay && StandaloneReplay.active() && !e.tableId) { StandaloneReplay.reauthenticated(e.token); return; }\ncc.mm.hallserver.requestUrlInfo();\ncc.mm.hallserver.requestHeadInfo();');
main = exactlyOnce(main, 'this._ws.send(cc.mm.netTools.pack(e, a, t, this._deviceId));', 'try { this._ws.send(cc.mm.netTools.pack(e, a, t, this._deviceId)); } catch (error) { if (window.Standalone.wireSendFailure(a)) return; throw error; }');
main = exactlyOnce(main, 'send: function(e, a, t) {\nvoid 0 === t', 'send: function(e, a, t) {\nif (window.StandaloneReplay && StandaloneReplay.blocks(a)) return;\nvoid 0 === t');
main = exactlyOnce(main, 'pack: function(e, a, r, n) {', 'replayPacket: function(packet) {\nvar field = ' + JSON.stringify(commandBodyFields) + '[packet.command];\nif (!field) throw new Error("Unknown replay packet");\nvar envelope = {}; envelope[field] = packet.body;\nvar decoded = t.huinan.server.proto.MsgData.fromObject(envelope);\nvar extension = protobuf.Writer.create().uint32((60000 << 3) | 2).string(JSON.stringify({version:2,decimalFields:packet.decimalFields})).finish();\nwindow.Standalone.applyWireExtension(extension, decoded, true);\nreturn {code:packet.command, body:decoded[field]};\n},\npack: function(e, a, r, n) {');
main = exactlyOnce(main, 'onHeartBeat: function() {\nvar e = new t.huinan.server.proto.MsgData();', 'onHeartBeat: function() {\nwindow.Standalone.wireHeartbeat();\nvar e = new t.huinan.server.proto.MsgData();');
main = exactlyOnce(main, 'var c = e.model.players[o + 1], i = cc.instantiate(this.views["root/headBase"]);', 'var c = e.model.getPlayerByUid(n[o].uid);\nif (!c) { this.players.push(null); continue; }\nvar i = cc.instantiate(this.views["root/headBase"]);');
main = exactlyOnce(main, 'this.players[t].getChildByName("agree").getComponent(cc.Label).string = 1 === a[t].state ? "同意" : "未表决";', 'if (!this.players[t]) continue;\nthis.players[t].getChildByName("agree").getComponent(cc.Label).string = 1 === a[t].state ? "同意" : "未表决";');
main = exactlyOnce(main, 'reLoad: function(e) {\nif (Array.isArray(e.location))', 'reLoad: function(e) {\nfor (var key in this.views) if (/^view\\/[1-4]-[1-4]$/.test(key)) this.views[key].getComponent(cc.Label).string = "";\nif (Array.isArray(e.location))');
main = exactlyOnce(main, 'for (var r = 1; r <= Object.keys(e.players).length; r++) e.players[r] && cc.mm.uitools.loadRemote(e.players[r].picUrl, this.views["view/pos" + r]);', 'for (var r = 1; r <= 4; r++) {\nvar head = this.views["view/pos" + r];\nhead.active = !!e.players[r];\nif (e.players[r]) cc.mm.uitools.loadRemote(e.players[r].picUrl, head);\n}');
main = exactlyOnce(main, 'e.userScoreInfo[a].score > this._bigScore', 'window.Standalone.compareAmount(e.userScoreInfo[a].score, this._bigScore) > 0');
main = exactlyOnce(main, 'this._bigScore > 0 && this._bigScore == a.score', 'window.Standalone.compareAmount(this._bigScore, 0) > 0 && window.Standalone.compareAmount(this._bigScore, a.score) === 0');
main = exactlyOnce(main, 's.getComponent(cc.Label).string = a.score;', 'window.Standalone.beanAmountLabel(s, a.score, true);');
main = exactlyOnce(main, 's.active = !0;\ne.getChildByName("bigwin")', 'e.getChildByName("winscore").active = window.Standalone.compareAmount(a.score, 0) > 0;\ne.getChildByName("losescore").active = window.Standalone.compareAmount(a.score, 0) <= 0;\ne.getChildByName("bigwin")');
main = exactlyOnce(main, 't = e.goldNum - cc.mm.framemodel.goldNum;', 't = window.Standalone.subtractAmount(e.goldNum, cc.mm.framemodel.goldNum);');
main = exactlyOnce(main, 't += "积分: " + this.body.userScoreInfo[r].score + "\\n";', 't += "豆子: " + window.Standalone.signedAmount(this.body.userScoreInfo[r].score) + "\\n";');
main = exactlyOnce(main, 'getBasicTimes: function() {\nswitch (cc.mm.hallserver.mLastRoomParam.areaType) {\ncase r.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZYAY:\ncase r.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDXJ:\nreturn 1;\n\ncase r.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YHGY:\ncase r.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_PSHSS:\nreturn cc.mm.hallserver.mLastRoomParam.basicTimes / 10;\n}\nreturn 1;\n},', 'getBasicTimes: function() {\nvar standaloneBase = cc.mm.hallserver.mLastRoomParam.baseBeans;\nif (typeof standaloneBase === "string" && standaloneBase.length) return standaloneBase;\nswitch (cc.mm.hallserver.mLastRoomParam.areaType) {\ncase r.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZYAY:\ncase r.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDXJ:\nreturn 1;\n\ncase r.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YHGY:\ncase r.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_PSHSS:\nreturn cc.mm.hallserver.mLastRoomParam.basicTimes / 10;\n}\nreturn 1;\n},');
main = exactlyOnce(main, 'return {code:packet.command, body:decoded[field]};', 'if (packet.roomOptions && decoded[field].tableInfo) window.Standalone.restoreReplayRoomOptions(packet.roomOptions, decoded[field].tableInfo);\nreturn {code:packet.command, body:decoded[field]};');
const ruleSummaryStart = main.indexOf('CommonPlayUIController: [ function(');
const ruleSummaryEnd = main.indexOf('CommonRePlayController: [ function(', ruleSummaryStart);
let ruleSummary = main.slice(ruleSummaryStart, ruleSummaryEnd);
ruleSummary = exactlyOnce(ruleSummary, 'e.yifupai || (t += "两副牌、");', 'if ((e.areaType === 2 || e.areaType === 3) && !e.yifupai) t += "两副牌、";');
ruleSummary = replaceCount(ruleSummary, 'return t.substring(0, t.length - 1);', 't += window.Standalone.qionglaiRuleSummary(e);\nreturn t.substring(0, t.length - 1);', 2);
main = main.slice(0, ruleSummaryStart) + ruleSummary + main.slice(ruleSummaryEnd);
const replayStart = main.indexOf('CommonRePlayController: [ function(');
const replayEnd = main.indexOf('CommonSelectPayUIController: [ function(', replayStart);
if (replayStart < 0 || replayEnd < 0) throw new Error('Missing original replay controller');
let replay = main.slice(replayStart, replayEnd);
replay = exactlyOnce(replay, 'reLoad: function(e) {', 'reLoad: function(e) {\nif (window.StandaloneReplay && StandaloneReplay.attach(this, e)) return;');
for (const [method, action, parameter] of [['continue', 'continue', ''], ['onSlider_progress', 'seek', 'e'], ['onClick_replay', 'restart', ''], ['onClick_tohall', 'home', ''], ['onClick_houtui', 'slower', ''], ['onClick_bofang', 'toggle', ''], ['onClick_kuaijin', 'faster', '']]) {
  const signature = method + ': function(' + parameter + ') {';
  replay = exactlyOnce(replay, signature, signature + '\nif (window.StandaloneReplay && StandaloneReplay.handle(this, "' + action + '"' + (parameter ? ', ' + parameter : '') + ')) return;');
}
main = main.slice(0, replayStart) + replay + main.slice(replayEnd);
await writeFile(join(target, 'assets/main/index.js'), main);
let hall = (await readFile(join(source, 'assets/hall/index.js'), 'utf8')).replace(/\r\n/g, '\n');
hall = exactlyOnce(hall, 'cc.sys.openURL("https://jzyx.ink/pF2mZ3");', 'cc.sys.openURL("about:blank");');
hall = exactlyOnce(hall, 'cc.mm.gameserver.copyRoomLogic();', 'cc.mm.gameserver.copyRoomLogic();\nwindow.Standalone.hall(this);\nthis.schedule(function () { window.Standalone.hall(this); }, 0.1);');
hall = exactlyOnce(hall, 'onComplete: function(e, t) {\nvar i = cc.assetManager.getBundle(cc.mm.config.hall);', 'onComplete: function(e, t) {\nif (e || !Array.isArray(t)) {\nconsole.error("Hall resource loading failed", e && e.message);\nthis._retryCount = (this._retryCount || 0) + 1;\nif (this._retryCount <= 2) setTimeout(this.loadRes.bind(this), 250);\nelse cc.mm.uimanager.showTextPrompt("大厅资源加载失败，请重新启动。");\nreturn;\n}\nthis._retryCount = 0;\nvar i = cc.assetManager.getBundle(cc.mm.config.hall);');
hall = replaceCount(hall, 'a.getChildByName("score").getComponent(cc.Label).string = n[o].score;', 'window.Standalone.beanAmountLabel(a.getChildByName("score"), n[o].score, true);', 2);
hall = exactlyOnce(hall, 'this.views["hallcoin/label"].getComponent(cc.Label).string = cc.mm.gamefunc.numformat(cc.mm.framemodel.goldNum);', 'window.Standalone.scoreLabel(this.views["hallcoin/label"], cc.mm.framemodel.goldNum);');
hall = exactlyOnce(hall, 'cc.mm.hallserver.requestAllFriend();\n},', 'cc.mm.hallserver.requestAllFriend();\nwindow.Standalone.friends(this);\n},');
hall = exactlyOnce(hall, '_ntfFriends: function(e) {\nvar t = this;\nif (!e.gradeInfo.length)', '_ntfFriends: function(e) {\nwindow.Standalone.renderFriends(this, e);\nreturn;\nvar t = this;\nif (!e.gradeInfo.length)');
hall = exactlyOnce(hall, 'cc.mm.uitools.addBtnLister(this.views.hallcoin, this.onClickHallCoinBtn.bind(this), this);', '/* Account bean balance is informational; the retired store action is intentionally unbound. */');
hall = exactlyOnce(hall, 'if (101 != cc.mm.framemodel.areaType[i])', 'if (window.Standalone.supportsArea(cc.mm.framemodel.areaType[i]))');
hall = exactlyOnce(hall, 'if (cc.mm.framemodel.shiName.includes("雅安") && this._areaType < 500)', 'if (false)');
hall = exactlyOnce(hall, 'this._rules = {};\nvar s = JSON.parse(JSON.stringify(e.node.data.rule));', 'this._rules = {};\nthis.toggles = {};\nvar s = JSON.parse(JSON.stringify(e.node.data.rule));');
hall = exactlyOnce(hall, 'h[u].default = this._rules[h[u].value];', 'if (Object.prototype.hasOwnProperty.call(this._rules, h[u].value)) h[u].default = this._rules[h[u].value];');
hall = exactlyOnce(hall, 'this.views["games/game_type_5/haoyou"], this.onClickCreateRoomBtn.bind(this, "雅安红二十")', 'this.views["games/game_type_5/haoyou"], function () { this.onClickCreateRoomBtn(cc.mm.framemodel.shiName === "雅安市" ? "雅安红二十" : "安岳斗十四"); }.bind(this)');
hall = exactlyOnce(hall, 'cc.mm.hallserver.requestCreateRoom(e._rules, e._areaType);', 'if (!window.Standalone.createRoom(e, e._rules, e._areaType)) return;');
hall = exactlyOnce(hall, 'cc.mm.hallserver.requestCreateRoom(this._rules, this._areaType);', 'if (!window.Standalone.createRoom(this, this._rules, this._areaType)) return;');
hall = exactlyOnce(hall, 'this._rules.yifupai = "勾鱼两副牌" !== e.node.data.name;\ncc.sys.localStorage.setItem("GAME_LAST_COME", e.node.data.name);\nthis.changeCost();', 'this._rules.yifupai = "勾鱼两副牌" !== e.node.data.name;\ncc.sys.localStorage.setItem("GAME_LAST_COME", e.node.data.name);\nthis.changeCost();\nwindow.Standalone.createRoomOptions(this);');
await writeFile(join(target, 'assets/hall/index.js'), hall);
let dss = (await readFile(join(source, 'assets/dss/index.js'), 'utf8')).replace(/\r\n/g, '\n');
dss = exactlyOnce(dss, 'e.yifupai || (i += "两副牌、");', 'if ((e.areaType === 2 || e.areaType === 3) && !e.yifupai) i += "两副牌、";');
dss = exactlyOnce(dss, 'return i.substring(0, i.length - 1);', 'i += window.Standalone.qionglaiRuleSummary(e);\nreturn i.substring(0, i.length - 1);');
dss = exactlyOnce(dss, 'getBasicTimes: function() {\nswitch (this.model.areaType)', 'getBasicTimes: function() {\nif (typeof cc.mm.hallserver.mLastRoomParam.baseBeans === "string") return cc.mm.hallserver.mLastRoomParam.baseBeans;\nswitch (this.model.areaType)');
dss = exactlyOnce(dss, 'onShowFace: function(e) {\nvar t = this;', 'onShowFace: function(e) {\nvar t = this, faceModel = this._model, faceGeneration = (this._standaloneFaceGeneration || 0) + 1;\nthis._standaloneFaceGeneration = faceGeneration;');
dss = exactlyOnce(dss, 'cc.loader.loadRes("faces/" + e.message, sp.SkeletonData, function(e, i) {\nvar s = t.node.getChildByName("face").getComponent(sp.Skeleton);', 'cc.loader.loadRes("faces/" + e.message, sp.SkeletonData, function(e, i) {\nif (e || !i || !cc.isValid(t.node) || t._model !== faceModel || t._standaloneFaceGeneration !== faceGeneration) return;\nvar faceNode = t.node.getChildByName("face");\nif (!cc.isValid(faceNode)) return;\nvar s = faceNode.getComponent(sp.Skeleton);');
dss = exactlyOnce(dss, '_moveEffect: function(e, t, i) {\nvar s = this;', '_moveEffect: function(e, t, i) {\nvar s = this, effectModel = this.model, effectSource = this.players[e], effectTarget = this.players[t], sourceModel = effectSource && effectSource._model, targetModel = effectTarget && effectTarget._model;\nfunction effectIsCurrent() { return cc.isValid(s.node, true) && s.model === effectModel && cc.isValid(effectSource, true) && cc.isValid(effectTarget, true) && s.players[e] === effectSource && s.players[t] === effectTarget && effectSource._model === sourceModel && effectTarget._model === targetModel; }');
dss = exactlyOnce(dss, 'cc.loader.loadRes("prefab/com_prop_" + i, cc.Prefab, function(a, n) {\nvar r = cc.instantiate(n);', 'cc.loader.loadRes("prefab/com_prop_" + i, cc.Prefab, function(a, n) {\nif (a || !n || !effectIsCurrent()) return;\nvar r = cc.instantiate(n);');
dss = exactlyOnce(dss, 'c.setAnimation(1, "animation", !1);', 'if (!cc.isValid(r, true)) return;\nif (!effectIsCurrent()) { r.removeFromParent(!0); r.destroy(); return; }\nc.setAnimation(1, "animation", !1);');
dss = exactlyOnce(dss, 'c.setCompleteListener(function() {\nr.removeFromParent(!0);\nr.destroy();', 'c.setCompleteListener(function() {\nif (!cc.isValid(r, true)) return;\nr.removeFromParent(!0);\nr.destroy();');
dss = exactlyOnce(dss, 'this.model.location = e.distInfo;', 'this.model.location = e.distInfo;\nvar locationWindow = cc.mm.uimanager.getWindow("LocationUI");\nif (locationWindow) locationWindow.reLoad(this.model);');
dss = exactlyOnce(dss, 'case cc.mm.msgEvent.HWNotifyAuto:\nthis.auto = !0;', 'case cc.mm.msgEvent.HWNotifyAuto:\nif (!this.isSelf()) return;\nthis.auto = !0;');
dss = exactlyOnce(dss, 'case cc.mm.msgEvent.HWResponseCancelAuto:\nthis.auto = !1;', 'case cc.mm.msgEvent.HWResponseCancelAuto:\nif (!this.isSelf()) return;\nthis.auto = !1;');
dss = exactlyOnce(dss, 'replayShowCard: function() {\nif (this.handNode && this.handNodebg) {', 'replayShowCard: function() {\nif (this.handNode && this.handNodebg) {\nif (window.StandaloneReplay && StandaloneReplay.active() && !this._model.isSelf() && this._model.hand_cards.length < this._model.holdlen) { this.handNode.removeAllChildren(true); this.handNodebg.active = false; return; }');
dss = exactlyOnce(dss, 'start: function() {\nif (cc.mm.gameserver.isReplay())', 'start: function() {\nwindow.Standalone.table(this);\nthis.schedule(function () { window.Standalone.table(this); }, 0.1);\nif (cc.mm.gameserver.isReplay())');
dss = exactlyOnce(dss, 'var t = n.huinan.server.proto.ENRoomType;\nif (this.model.roomType !== t.EN_ROOM_TYPE_FRIEND) for (var i = 0; i < this.model.playerNum; i++) {\nvar s, a;\nif ((null == (s = this.model) ? void 0 : null == (a = s.players[i]) ? void 0 : a.uid) == e.uid) {\nthis.model.players[i].score = e.goldNum;\nthis.players[this.model.players[i].showSeat] && this.players[this.model.players[i].showSeat].updateScore();\n}\n}', 'for (var i = 0; i < this.model.playerNum; i++) {\nvar s, a;\nif ((null == (s = this.model) ? void 0 : null == (a = s.players[i]) ? void 0 : a.uid) == e.uid) {\nthis.model.players[i].score = e.goldNum;\nthis.players[this.model.players[i].showSeat] && this.players[this.model.players[i].showSeat].updateScore();\n}\n}');
dss = exactlyOnce(dss, 'if (cc.mm.gameserver.room_data.roomType != c.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND) if (this._model) {\nif (e.uid == this._model.uid) {\nthis._model.score = e.goldNum;\nthis.views["scoreNode/label"].getComponent(cc.Label).string = cc.mm.gamefunc.numformat(this._model.score);\nthis._shopShowTime = !1;\n}\n} else if (e.uid == cc.mm.framemodel.uid) {\nthis.views["scoreNode/label"].getComponent(cc.Label).string = cc.mm.gamefunc.numformat(e.goldNum);\nthis._shopShowTime = !1;\n}', 'if (this._model && e.uid == this._model.uid) {\nthis._model.score = e.goldNum;\nthis.updateScore();\nthis._shopShowTime = !1;\n} else if (e.uid == cc.mm.framemodel.uid) {\nwindow.Standalone.scoreLabel(this.views["scoreNode/label"], e.goldNum);\nthis._shopShowTime = !1;\n}');
dss = exactlyOnce(dss, 'this.views["buttom/scoreNode/doudou"].active = cc.mm.gameserver.room_data.roomType !== t.EN_ROOM_TYPE_FRIEND;\nthis.views["buttom/scoreNode/score"].active = cc.mm.gameserver.room_data.roomType === t.EN_ROOM_TYPE_FRIEND;', 'this.views["buttom/scoreNode/doudou"].active = true;\nthis.views["buttom/scoreNode/score"].active = false;');
dss = exactlyOnce(dss, 't.getChildByName("scoreNode").getChildByName(a ? "gy_fen" : "gy_dou").active = !0;\nthis.views["buttom/scoreNode/doudou"].active = cc.mm.gameserver.room_data.roomType !== s.EN_ROOM_TYPE_FRIEND;', 't.getChildByName("scoreNode").getChildByName("gy_dou").active = true;\nt.getChildByName("scoreNode").getChildByName("gy_fen").active = false;\nthis.views["buttom/scoreNode/doudou"].active = true;\nthis.views["buttom/scoreNode/score"].active = false;');
dss = exactlyOnce(dss, 'this._model.score += e.scoreChange;\nthis.updateScore();', 'this._model.roundBeanDelta = window.Standalone.addAmount(this._model.roundBeanDelta || "0", e.scoreChange);');
dss = exactlyOnce(dss, 's.addComponent(cc.Label).string = e.scoreChange > 0 ? "+" + e.scoreChange : e.scoreChange;', 's.addComponent(cc.Label); /* Bean change text is rendered after font and bounds are configured. */');
dss = exactlyOnce(dss, 's.getComponent(cc.Label).lineHeight = 40;', 's.getComponent(cc.Label).lineHeight = 40;\ns.setContentSize(200, 50);\nwindow.Standalone.beanAmountLabel(s, e.scoreChange, true);');
dss = exactlyOnce(dss, 'this.views["buttom/scoreNode/label"].getComponent(cc.Label).string = cc.mm.gamefunc.numformat(e.score);', 'window.Standalone.scoreLabel(this.views["buttom/scoreNode/label"], e.score);');
dss = replaceCount(dss, 'this.views["scoreNode/label"].getComponent(cc.Label).string = cc.mm.gamefunc.numformat(this._model.score);', 'window.Standalone.scoreLabel(this.views["scoreNode/label"], this._model.score);', 2);
dss = exactlyOnce(dss, 'a.getComponent(cc.Label).string = cc.mm.gamefunc.numformat(s);', 'window.Standalone.scoreLabel(a, s);');
dss = exactlyOnce(dss, 'var s = i.changeScore, a = s > 0 ? t : e;', 'var s = i.changeScore, positiveScore = window.Standalone.compareAmount(s, 0) > 0, a = positiveScore ? t : e;\ne.active = !positiveScore;\nt.active = positiveScore;');
dss = exactlyOnce(dss, 'return e.basicTimes / 10;', 'return window.Standalone.divideAmount(e.basicTimes, 10);');
dss = exactlyOnce(dss, 't.scoreNum && t.scoreNum >= 0 ? e.getChildByName("winscoreLabel").getComponent(cc.Label).string = "+" + cc.mm.gamefunc.numformat(t.scoreNum) : t.scoreNum && t.scoreNum < 0 && (e.getChildByName("losescoreLabel").getComponent(cc.Label).string = "" + cc.mm.gamefunc.numformat(t.scoreNum));', 'var positiveScore = window.Standalone.compareAmount(t.scoreNum, 0) >= 0;\ne.getChildByName("winscoreLabel").active = positiveScore;\ne.getChildByName("losescoreLabel").active = !positiveScore;\nwindow.Standalone.beanAmountLabel(e.getChildByName(positiveScore ? "winscoreLabel" : "losescoreLabel"), t.scoreNum, true);');
dss = exactlyOnce(dss, 'i += "积分: " + this.body.userScoreInfo[s].score + "\\n";', 'i += "豆子: " + window.Standalone.signedAmount(this.body.userScoreInfo[s].score) + "\\n";');
await writeFile(join(target, 'assets/dss/index.js'), dss);

// Reuse the rounded end of the original minus so the missing decimal keeps its exact color and texture.
const decimalFonts = [];
for (const id of ['3e26a673-2e91-4cb3-9f86-e2a0396e7fa5', '47abc047-115e-4b58-ad87-56b8da3b7cdf']) {
  const path = join(target, 'assets/dss/import', id.slice(0, 2), id + '.json');
  const data = JSON.parse(await readFile(path, 'utf8'));
  const font = data[5][0][3], dictionary = font.fontDefDictionary;
  if (dictionary[46] || !dictionary[45] || !dictionary[48]) throw new Error('Unexpected original score font');
  const donor = dictionary[45].rect, zero = dictionary[48], size = Math.min(donor.height, 14);
  dictionary[46] = { xOffset: 2, yOffset: zero.yOffset + zero.rect.height - donor.height, xAdvance: size + 4, rect: { x: donor.x, y: donor.y, width: size, height: donor.height } };
  await writeFile(path, JSON.stringify(data));
  decimalFonts.push({ id, atlas: font.atlasName, glyph: dictionary[46], pixels: 'Unmodified original minus glyph crop' });
}
await writeFile(join(project, 'client/decimal-font-manifest.json'), JSON.stringify(decimalFonts, null, 2) + '\n');

const report = { engine: 'Cocos Creator 2.4.7', source, bundles: ['main', 'internal', 'resources', 'hall', 'dss'], sourceMainSha256: createHash('sha256').update(await readFile(join(source, 'assets/main/index.js'))).digest('hex'), engineSha256: createHash('sha256').update(await readFile(engine)).digest('hex'), recoveredAt: new Date().toISOString(), note: 'Compiled scene and prefab recovery. This is not the missing original Creator editor source project.' };
await writeFile(join(project, 'client/recovery-manifest.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Recovered original Cocos bundles into ' + target);
