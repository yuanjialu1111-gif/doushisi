window.__require = function e(t, i, s) {
function a(n, r) {
if (!i[n]) {
if (!t[n]) {
var c = n.split("/");
c = c[c.length - 1];
if (!t[c]) {
var h = "function" == typeof __require && __require;
if (!r && h) return h(c, !0);
if (o) return o(c, !0);
throw new Error("Cannot find module '" + n + "'");
}
n = c;
}
var m = i[n] = {
exports: {}
};
t[n][0].call(m.exports, function(e) {
return a(t[n][1][e] || e);
}, m, m.exports, e, t, i, s);
}
return i[n].exports;
}
for (var o = "function" == typeof __require && __require, n = 0; n < s.length; n++) a(s[n]);
return a;
}({
dds_xiangqingController: [ function(e, t) {
"use strict";
cc._RF.push(t, "e70d8r4DFVJ7b6R0zYPFd3w", "dds_xiangqingController");
var i = e("UIController"), s = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
this.body = null;
},
reLoad: function(e) {
this.body = e;
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.close.bind(this), this);
},
start: function() {
1 == this.body.length && (this.views["view/Layout/pic-fenlan1"].height = 105.6);
this.refreshCell(this.views["view/Layout/pic-fenlan1"], this.body[0]);
this.refreshCell(this.views["view/Layout/pic-fenlan2"], this.body[1]);
this.refreshCell(this.views["view/Layout/pic-fenlan3"], this.body[2]);
},
refreshCell: function(e, t) {
e.active = !!t;
if (e.active) {
var i = e.getChildByName("head"), a = t.userHead_1.nick;
a = a.length > 4 ? a.substring(0, 4) + ".." : a;
i.getChildByName("nameLabel").getComponent(cc.Label).string = a;
cc.mm.uitools.loadRemote(t.userHead_1.picUrl, i.getChildByName("hall_head"));
cc.mm.uitools.changeHead(i.getChildByName("headcase"), t.userHead_1.headType);
i.getChildByName("fengding").active = t.fengDing;
i.getChildByName("pochan").active = !1;
var positiveScore = window.Standalone.compareAmount(t.scoreNum, 0) >= 0;
e.getChildByName("winscoreLabel").active = positiveScore;
e.getChildByName("losescoreLabel").active = !positiveScore;
window.Standalone.beanAmountLabel(e.getChildByName(positiveScore ? "winscoreLabel" : "losescoreLabel"), t.scoreNum, true);
for (var o = 0; o < t.userHead_2.length; o++) {
var n = cc.instantiate(i);
n.getChildByName("pochan").active = t.shuGuang;
n.getChildByName("fengding").active = !1;
e.getChildByName("handLayout").addChild(n);
var r = t.userHead_2[o].nick;
r = r.length > 4 ? r.substring(0, 4) + ".." : r;
n.getChildByName("nameLabel").getComponent(cc.Label).string = r;
cc.mm.uitools.loadRemote(t.userHead_2[o].picUrl, n.getChildByName("hall_head"));
cc.mm.uitools.changeHead(n.getChildByName("headcase"), t.userHead_2[o].headType);
}
s.huinan.server.proto.ENColType.EN_COL_TYPE_HU_NORMAL == t.colType ? e.getChildByName("label").getComponent(cc.Label).string = "胡" : s.huinan.server.proto.ENColType.EN_COL_TYPE_CHA_JIAO == t.colType ? e.getChildByName("label").getComponent(cc.Label).string = "查叫" : s.huinan.server.proto.ENColType.EN_COL_TYPE_HU_DIAN_PAO == t.colType ? e.getChildByName("label").getComponent(cc.Label).string = "点炮" : s.huinan.server.proto.ENColType.EN_COL_TYPE_HU_ZI_MO == t.colType && (e.getChildByName("label").getComponent(cc.Label).string = "自摸");
e.getChildByName("label").color = t.colType == s.huinan.server.proto.ENColType.EN_COL_TYPE_HU_DIAN_PAO ? cc.color(245, 47, 136) : cc.color(255, 80, 0);
e.getChildByName("fan").getChildByName("label").getComponent(cc.Label).string = t.huFanNum + "番";
}
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0
} ],
dss_cardController: [ function(e, t) {
"use strict";
cc._RF.push(t, "0015awpLdhI558sjgYxwBB/", "dss_cardController");
var i = e("dss_tools");
cc.Class({
extends: cc.Component,
properties: {
face: {
default: null,
type: cc.Sprite
},
num: {
default: null,
type: cc.Label
},
tip: {
default: null,
type: cc.Node
},
da: {
default: null,
type: cc.Node
},
duo: {
default: null,
type: cc.Node
},
bao: {
default: null,
type: cc.Node
}
},
onLoad: function() {
this.value = 0;
this.isUp = !1;
this.lastTime = 0;
this.isNotTouch = !1;
this.pckerWidth = 75;
this.mSprite = this.face;
},
setBaoVisible: function(e) {
this.bao.active = e;
},
setValue: function(e) {
this.value = e;
this.setSprite();
},
setSprite: function() {
this.mSprite.spriteFrame = i.getCard(this.value);
},
setWidth: function(e) {
this.node.width *= e;
this.node.height *= e;
this.face.node.width *= e;
this.face.node.height *= e;
},
select: function() {
if (!this.isNotTouch) {
this.node.y = 30;
this.isUp = !0;
}
},
setNum: function(e) {
this.num.node.active = e >= 0 && e < 2;
this.num.string = e;
},
showTip: function() {
this.tip.active = !0;
},
hideTip: function() {
this.tip.active = !1;
this.da.active = !1;
this.duo.active = !1;
},
unselect: function() {
this.node.y = 0;
this.isUp = !1;
},
setColor: function() {
this.isNotTouch = !0;
this.mSprite.node.color = cc.color(120, 120, 120);
},
unlock: function() {
this.isNotTouch = !1;
this.mSprite.node.color = cc.color(255, 255, 255);
},
getUnsclectPos: function() {
return cc.v2(this.node.x, 0);
},
touchCard: function(e, t) {
var i = this.node.x, s = this.node.x + this.pckerWidth + (t ? 100 : 0);
return !this.isNotTouch && i < e.x && s > e.x && this.node.height + 100 > e.y;
}
});
cc._RF.pop();
}, {
dss_tools: "dss_tools"
} ],
dss_evenType: [ function(e, t) {
"use strict";
cc._RF.push(t, "c71a3X6XUtGlbluHSXSop4k", "dss_evenType");
t.exports = {
DSS_UPDATA_SELF_DATA: "DSS_UPDATA_SELF_DATA",
DSS_SHOW_HAND_CARDS: "DSS_SHOW_HAND_CARDS",
DSS_ACTION_PLAY_CARD: "DSS_ACTION_PLAY_CARD",
DSS_ACTION_KOU_CARD: "DSS_ACTION_KOU_CARD",
DSS_ACTION_PLAYER_OUT_CARD: "DSS_ACTION_PLAYER_OUT_CARD",
DSS_ACTION_REMOVE_CARD: "DSS_ACTION_REMOVE_CARD",
DSS_REMOVE_HAND_CARDS: "DSS_REMOVE_HAND_CARDS",
DSS_SHOW_SIGNE_CARD: "DSS_SHOW_SIGNE_CARD",
DSS_REFRESH_CARD_LEFT: "DSS_REFRESH_CARD_LEFT",
DSS_SCORE_CHANGE: "DSS_SCORE_CHANGE",
DSS_WIN: "DSS_WIN"
};
cc._RF.pop();
}, {} ],
dss_gameController: [ function(e, t) {
"use strict";
cc._RF.push(t, "0f9c8jS0YZCzaOaLLLfkVNw", "dss_gameController");
var i = e("UIController"), s = e("dss_evenType"), a = e("dss_gameModel"), o = e("dss_tools"), n = e("../../../../Frame/src/buff/hw_msg").com, r = n.huinan.server.proto.ENAreaType, c = n.huinan.server.proto.ENActionType, h = n.huinan.server.proto.ENColType;
cc.Class({
extends: i,
onLoad: function() {
var e = this;
this._super();
this.players = {};
this.operatorList = {};
this.selectCards = [];
this.selectNodes = [];
this.select_num = 0;
this.frist_cards = [];
this.gangColList = {};
this.in_card = 0;
this.op_type = 0;
this._showIdx = 0;
this.arrows = [];
this.nodePool = new cc.NodePool();
this.model = new a();
this.mTips = null;
this.mHuEffects = [];
this.views.operate.addComponent("dss_selectController").setTip(this.node.getChildByName("tip"));
var t = n.huinan.server.proto.ENRoomType;
this.views["buttom/scoreNode/doudou"].active = true;
this.views["buttom/scoreNode/score"].active = false;
this.views["menunode/gy_btn_jsfj"].active = cc.mm.gameserver.room_data.roomType === t.EN_ROOM_TYPE_FRIEND;
this.views["menunode/gy_btn_tuichu"].active = cc.mm.gameserver.room_data.roomType !== t.EN_ROOM_TYPE_FRIEND;
this.views["menunode/gy_btn_tuoguan"].active = cc.mm.gameserver.room_data.roomType !== t.EN_ROOM_TYPE_FRIEND;
this.views.locationbtn.active = cc.mm.gameserver.room_data.roomType == t.EN_ROOM_TYPE_FRIEND;
this.views["buttom/blackNode"].active = cc.mm.gameserver.room_data.areaType == n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSGL || cc.mm.gameserver.room_data.areaType == n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20_XZ || cc.mm.gameserver.room_data.areaType == n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20;
this._noticeChangeDesk();
this.views.countbg.active = cc.mm.gameserver.room_data.roomType == t.EN_ROOM_TYPE_FRIEND;
this.node.runAction(cc.sequence(cc.delayTime(10), cc.callFunc(this.marqueeLogic.bind(this))));
this.views["qifu-button"].active = cc.mm.gameserver.isFree(cc.mm.gameserver.room_data.areaType) || cc.mm.gameserver.room_data.roomType !== t.EN_ROOM_TYPE_FRIEND;
this.views.buchongdou.active = this.views["qifu-button"].active;
this.views["buttom/dotNode/redpoint"].active = cc.mm.gameserver.room_data.areaType != n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZPC;
this.views["buttom/dotNode/pcct"].active = cc.mm.gameserver.room_data.areaType == n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZPC;
this.views["buttom/dotNode"].active = cc.mm.gameserver.room_data.areaType != n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZGRX;
this.views["buttom/dotNode"].active = this.views["buttom/dotNode"].active && cc.mm.gameserver.room_data.areaType != n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YBXZ;
(this.getAb(cc.mm.gameserver.room_data.areaType) || cc.mm.gameserver.room_data.areaType == n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZTJ || cc.mm.gameserver.room_data.areaType == n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_GY || cc.mm.gameserver.room_data.areaType == n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_SCSN) && cc.assetManager.getBundle(cc.mm.config.dss).load("res/images/doushisi-game-gy-di-fen", cc.SpriteFrame, function(t, i) {
cc.isValid(e.views["buttom/dotNode/redpoint"]) && (e.views["buttom/dotNode/redpoint"].getComponent(cc.Sprite).spriteFrame = i);
});
},
marqueeLogic: function() {
var e = this;
if (cc.mm.gameserver.notices.length) {
this._showIdx <= cc.mm.gameserver.notices.length && (this._showIdx = 0);
var t = cc.mm.gameserver.notices[this._showIdx];
this.views.common_marquee.active = !0;
this.views["common_marquee/mask/label"].x = 0;
this.views["common_marquee/mask/label"].getComponent(cc.Label).string = t.msg;
this.views["common_marquee/mask/label"].getComponent(cc.Label)._forceUpdateRenderData();
var i = cc.v2(this.views["common_marquee/mask"].width / 2 * -1 - this.views["common_marquee/mask/label"].width, 0);
this.views["common_marquee/mask/label"].runAction(cc.sequence(cc.moveTo(Math.abs(i.x) / 100, i), cc.callFunc(function() {
e.views.common_marquee.active = !1;
e.node.runAction(cc.sequence(cc.delayTime(t.intervalSecond), cc.callFunc(e.marqueeLogic.bind(e))));
})));
this._showIdx++;
} else this.node.runAction(cc.sequence(cc.delayTime(10), cc.callFunc(this.marqueeLogic.bind(this))));
},
_noticeChangeDesk: function() {
var e = this, t = cc.sys.localStorage.getItem("GAME_DESK_IDX");
t && t.length || (t = 0);
this.views.bgsprite.active = 10 != t;
this.views["shouye-bg"].active = 10 == t;
this.views.bgsprite.active && cc.assetManager.getBundle(cc.mm.config.dss).load("res/bgs/gy-bg-" + t, cc.SpriteFrame, function(t, i) {
cc.isValid(e.views.bgsprite) && i && (e.views.bgsprite.getComponent(cc.Sprite).spriteFrame = i);
});
this.changeClock(cc.mm.framemodel.headType, this.views.selfclock);
},
changeClock: function(e, t) {
if (t && cc.isValid(t)) {
var i = "frames/wk_images_time";
e == n.huinan.server.proto.ENHeadType.EN_HEAD_TYPE_YUAN_DAN ? i = "frames/yuandan-naozhong" : e == n.huinan.server.proto.ENHeadType.EN_HEAD_TYPE_CHUN_JIE && (i = "frames/chunjie-naozhong");
cc.loader.loadRes(i, cc.SpriteFrame, function(e, i) {
!e && cc.isValid(t) && (t.getComponent(cc.Sprite).spriteFrame = i);
});
} else cc.warn("切换闹钟失败");
},
start: function() {
window.Standalone.table(this);
this.schedule(function () { window.Standalone.table(this); }, 0.1);
if (cc.mm.gameserver.isReplay()) cc.mm.gameserver.startReplay(); else {
var e = new n.huinan.server.proto.MsgData();
e.hwRequestEnterTableFinish = new n.huinan.server.proto.HWRequestEnterTableFinish();
e.hwRequestEnterTableFinish.roomId = cc.mm.gameserver.room_data.roomId;
e.hwRequestEnterTableFinish.lat = cc.mm.gameserver.getLatitude();
e.hwRequestEnterTableFinish.lon = cc.mm.gameserver.getLongitude();
cc.mm.server.send(e, cc.mm.msgEvent.HWRequestEnterTableFinish, cc.mm.framemodel.uid);
}
},
addEvent: function() {
var e = this;
this.views["ntfOperate/actionBtn_hu"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_HU;
this.views["ntfOperate/actionBtn_gang"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_GANG;
this.views["ntfOperate/actionBtn_peng"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_PENG;
this.views["ntfOperate/actionBtn_chi"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_CHI;
this.views["ntfOperate/actionBtn_guo"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_GUO;
this.views["ntfOperate/actionBtn_bao"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_BAO_TING;
this.views["ntfOperate/actionBtn_tou"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_TOU;
this.views["ntfOperate/actionBtn_piao"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_PIAO;
this.views["ntfOperate/actionBtn_piao_guo"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_PIAO_GUO;
this.views["ntfOperate/actionBtn_dazhuang"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_DANG_ZHUANG;
this.views["ntfOperate/actionBtn_huan"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_HUAN_CARD;
this.views["ntfOperate/actionBtn_sha"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_PENG;
this.views["ntfOperate/actionBtn_chen"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_TOU;
this.views["ntfOperate/actionBtn_ba"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_GANG;
this.views["ntfOperate/actionBtn_dasha"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_GANG;
this.views["ntfOperate/actionBtn_dachen"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_GANG;
this.views["ntfOperate/actionBtn_dui"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_PENG;
this.views["ntfOperate/actionBtn_cheng"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_TOU;
this.views["ntfOperate/actionBtn_chuan"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_GANG;
this.views["ntfOperate/actionBtn_qiangpeng"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_PENG;
this.views["ntfOperate/actionBtn_ziqianghu"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_HU_ZI_QIANG;
this.views["ntfOperate/actionBtn_qianghu"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_HU_QIANG;
this.views["ntfOperate/actionBtn_qianggang"].groupIndex = n.huinan.server.proto.ENActionType.EN_ACTION_GANG;
cc.mm.uitools.addClickLister(this.views.hutip, this.onClickHutip.bind(this), this.onHideHuTip.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.menuBtn, this.onClickMenuBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.readyBtn, this.onClickReadyBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.invateBtn, this.onClickInvateBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["tg_bg/cancelTg"], this.onClickCancelTgBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.gy_btn_chat, this.onClickChatBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["menunode/gy_btn_guize"], this.onClickRuleBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["menunode/gy_btn_tuoguan"], this.onClickTGBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["menunode/gy_btn_set"], this.onClickSetBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["menunode/gy_btn_tuichu"], this.onClickExitBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["menunode/gy_btn_jsfj"], this.onClickDismissBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.locationbtn, this.onClickLocationBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_piao_guo"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_bao"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_hu"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_gang"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_tou"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_peng"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_chi"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_guo"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_piao"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_dazhuang"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_huan"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["sureTip/tipBtn_guo"], this.onClickTipGuo.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["sureTip/tipBtn_hu"], this.onClickTipHu.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.LeaveBtn, this.onClickLeave, this);
cc.mm.uitools.addBtnLister(this.views.changeBtn, this.onClickChangeDesk, this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_dui"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_cheng"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_chuan"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_ziqianghu"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_qianghu"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_qianggang"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_sha"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_dasha"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_dachen"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_chen"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_ba"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["ntfOperate/actionBtn_qiangpeng"], this.onClickOperator.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.buchongdou, this.onClickbuchongdou, this);
cc.mm.uitools.addBtnLister(this.views["select/actionBtn_tui"], this.onClickLastOperator.bind(this), this);
cc.mm.notification.on(s.DSS_UPDATA_SELF_DATA, this._noticeUpdataSelf.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MODEL_NOTICE_UPDATEROOM, this._noticeUpdateTableInfo.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MODEL_NOTICE_JOINGAME, this._ntfEnterRoom.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MODEL_NOTICE_EXITGAME, this._ntfExitRoom.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MODEL_NOTICE_LEFT_CARD, this._ntfUpdateLeftCard.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MODEL_NOTICE_COMMON_MSG, this._ntfCommonMsg.bind(this), this);
cc.mm.notification.on(s.DSS_ACTION_PLAY_CARD, this.onNoticePlayCard.bind(this), this);
cc.mm.notification.on(s.DSS_ACTION_PLAYER_OUT_CARD, this.onNoticeUserOutCard.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_CLEAR_ROOM, this._ntfClearData.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MODEL_NOTICE_SHOWTG, this._ntfShowTgView.bind(this), this);
cc.mm.notification.on("dss_hide_menu", this.onClickBgBtn.bind(this), this);
cc.mm.notification.on(s.DSS_WIN, this._noticeWin, this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseJiaoTishi, this._ntfResponseJiaoPai.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyLocation, this._ntfLcation.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyUserDataChange, this._ntfUserDataChange.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseReadyForGame, this._noticeCardLeft.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyGameStart, this._noticeTableInfo.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyChat, this._ntfPlayerChatMSg.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifySeatOperationChoice, this._ntfOperate.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyNextOperation, this._ntfUpdateLeftCard.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyPlayerDealCard, this._ntfUpdateLeftCard.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyDissolveTableOperation, this._ntfDissolve.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_CLEAR_OPERATOR, this._ntfClearOperator.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseHeadInfo, this._ntfHeadInfo.bind(this), this);
cc.mm.notification.on(s.DSS_REFRESH_CARD_LEFT, this.refreshCardLeft, this);
cc.mm.notification.on("clear_point_left_card", this.clear_point_left_card.bind(this), this);
cc.mm.notification.on("game_desk_update", this._noticeChangeDesk.bind(this), this);
cc.mm.notification.on("UPDATE_CLOCK_POS", this._noticeUpdateClockPos.bind(this), this);
cc.mm.notification.on("dss_select_card", this._noticeSelectCard.bind(this), this);
cc.mm.notification.on("dss_un_select_card", this._noticeUnSelectCard.bind(this), this);
cc.mm.notification.on("NOTICE_GAME_HU_TIP", this._noticeChangeTipBtn.bind(this), this);
cc.mm.notification.on("DSS_GAME_EFFECT_RAIN", this._noticeRain.bind(this), this);
cc.mm.notification.on("DSS_GAME_EFFECT_PENG", this._noticePeng.bind(this), this);
cc.mm.notification.on("DSS_SHOW_ZHUANG_SEAT", this._showZhuangAct.bind(this), this);
cc.mm.notification.on("DSS_REN_BLACK_RIVETY", this._noticeFiveTy.bind(this), this);
cc.mm.notification.on("DSS_YOU_CARD", this._noticeYouCardAct, this);
cc.mm.notification.on("DSS_HIDE_CHANGE_BTN", this._noticeHideChangeBtn, this);
this.views.hueffect.getComponent(sp.Skeleton).setCompleteListener(this._spineComplete.bind(this));
cc.mm.uitools.addBtnLister(this.views["qifu-button"], this.onClickQiFuBtn, this);
cc.mm.uitools.addBtnLister(this.views["qifu-dikuang/shilaiyunzhuan"], this.onClickSendQifuBtn.bind(this, 1), this);
cc.mm.uitools.addBtnLister(this.views["qifu-dikuang/caiyuangungun"], this.onClickSendQifuBtn.bind(this, 2), this);
cc.mm.uitools.addBtnLister(this.views["qifu-dikuang/shouqiquankai"], this.onClickSendQifuBtn.bind(this, 3), this);
cc.mm.uitools.addBtnLister(this.views["qifu-dikuang/shilaiyunzhuan1"], this.onClickSendQifuBtn.bind(this, 4), this);
cc.sys.isBrowser && cc.loader.loadRes("frames/dss_game_btn_fzfj", cc.SpriteFrame, function(t, i) {
e.views.invateBtn.getComponent(cc.Sprite).spriteFrame = i;
});
},
_ntfHeadInfo: function(e) {
this.players[0] && cc.mm.uitools.changeHead(this.players[0].views.headcase, e.headType);
},
scaleQiFu: function() {
this.views["qifu-dikuang"].getNumberOfRunningActions() || 0 == this.views["qifu-dikuang"].scaleX || this.views["qifu-dikuang"].runAction(cc.scaleTo(.1, 0, 1).easing(cc.easeBounceOut()));
},
onClickQiFuBtn: function() {
this.views["qifu-dikuang"].getNumberOfRunningActions() || (1 == this.views["qifu-dikuang"].scaleX ? this.views["qifu-dikuang"].runAction(cc.scaleTo(.1, 0, 1).easing(cc.easeBounceOut())) : this.views["qifu-dikuang"].runAction(cc.scaleTo(.1, 1, 1).easing(cc.easeBounceOut())));
},
onClickSendQifuBtn: function(e) {
var t = new n.huinan.server.proto.MsgData();
t.hwRequestQifu = new n.huinan.server.proto.HWRequestQiFu();
t.hwRequestQifu.qifuId = e;
cc.mm.server.send(t, cc.mm.msgEvent.HWRequestQiFu, cc.mm.framemodel.uid);
this.onClickQiFuBtn();
},
_noticeYouCardAct: function() {
var e = this;
this.views.youpai.active = !0;
this.views.youpai.stopAllActions();
this.views.youpai.runAction(cc.sequence(cc.delayTime(3.5), cc.callFunc(function() {
e.views.youpai.active = !1;
})));
},
onClickLocationBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "LocationUI", this.model);
},
_spineComplete: function() {
if (this.mHuEffects.length) {
var e = this.mHuEffects.shift(), t = this.getAnimation(e), i = this.views.hueffect.getComponent(sp.Skeleton);
i.skeletonData = cc.mm.dss.resmap.get(t.skin);
i.setAnimation(0, t.animation, !1);
} else this.views.hueffect.active = !1;
},
_noticeFiveTy: function(e) {
this.mHuEffects = e;
var t = this.mHuEffects.shift(), i = this.getAnimation(t);
this.views.hueffect.active = !0;
var s = this.views.hueffect.getComponent(sp.Skeleton);
s.skeletonData = cc.mm.dss.resmap.get(i.skin);
s.setAnimation(0, i.animation, !1);
this.views.hueffect.scale = [ "shilaiyunzhuan", "caiyuangungun", "hongyundangtou", "shouqiquankai" ].includes(t) ? 1 : cc.winSize.width / this.views.hueffect.width;
},
getAnimation: function(e) {
var t = e.split("_"), i = t[1] || "animation";
return {
skin: t[0],
animation: i
};
},
_showZhuangAct: function(e, t) {
var i = this.node.convertToNodeSpaceAR(e);
this.views.zhuangnode.active = !0;
this.views.zhuangnode.setPosition(cc.v2(0, 74));
this.views.zhuangnode.runAction(cc.sequence(cc.show(), cc.moveTo(.5, i), cc.callFunc(t), cc.hide()));
},
_noticeRain: function() {
this.views.xiayu.active = !0;
this.views.xiayu.getComponent(sp.Skeleton).setAnimation(0, "animation", !1);
},
_noticePeng: function() {
this.views.pengbei.active = !0;
var e = this.views.pengbei.getComponent(sp.Skeleton);
e.timeScale = 1.5;
e.setAnimation(0, "animation", !1);
},
_ntfLcation: function(e) {
this.model.location = e.distInfo;
var locationWindow = cc.mm.uimanager.getWindow("LocationUI");
if (locationWindow) locationWindow.reLoad(this.model);
},
_showSelectEffect: function(e, t, i) {
void 0 === i && (i = !0);
if (i) {
for (var s = 0; s < e.length; s++) if (cc.isValid(e[s])) {
var a = null;
this.nodePool.size() ? a = this.nodePool.get() : (a = cc.instantiate(this.views["jiantou-tishi"])).active = !0;
a.width = e[s].width;
a.height = e[s].height;
e[s].addChild(a);
this.arrows.push(a);
}
} else {
for (var o = 0; o < this.arrows.length; o++) this.nodePool.put(this.arrows[o]);
this.arrows.length = 0;
}
},
getValue: function(e) {
return 1001 == Number(e) ? 14 : 1002 == Number(e) ? 15 : 1003 == Number(e) ? 16 : Number(e) % 100;
},
getLeftCardNum: function(e) {
var t = this.getValue(Number(e));
t = 14 - t;
return this.getBaseLeftCardNum(t);
},
getTipLeftCardNum: function(e) {
var t = this.getValue(Number(e));
return this.getBaseLeftCardNum(t);
},
getBaseLeftCardNum: function(e) {
for (var t = this.model.tipsCards[e] || this.model.tipsCards[20], i = this.model.getSelf(), s = 0, a = 0; a < i.hand_cards.length; a++) e == this.getValue(i.hand_cards[a]) && s++;
for (var o = 0; o < i.protectCards.length; o++) e == this.getValue(i.protectCards[o]) && s++;
for (var n in this.players) {
var r, c, h, m, d, l = (null == (r = this.players[n]) ? void 0 : r.mCards) || [];
for (var _ in l) {
var u = Number(_);
Array.isArray(l[u]) && e == this.getValue(u) && (s += l[u].length);
}
null != (c = this.players[n]) && null != (h = c._model) && h.huCard && this.getValue(null == (m = this.players[n]) ? void 0 : null == (d = m._model) ? void 0 : d.huCard) == e && (s += 1);
}
return t - s <= 0 ? 0 : t - s;
},
_noticeSelectCard: function(e) {
if (!(e > 1e3)) for (var t = [ 100, 200, 300, 400 ], i = 0; i < 4; i++) if (cc.isValid(this.players[i])) for (var s = this.players[i].mCards, a = 14 - e % 100, o = 0; o < t.length; o++) {
var n = t[o] + a;
Array.isArray(s[n]) && this._showSelectEffect(s[n], 0 == i);
}
},
_noticeUnSelectCard: function() {
for (var e = 0; e < this.model.playerNum; e++) if (cc.isValid(this.players[e])) {
var t = this.players[e].mCards;
for (var i in t) Array.isArray(t[i]) && this._showSelectEffect(t[i], !1, !1);
}
},
_noticeCardLeft: function(e) {
if (1020 != e.result) {
this.views.readyBtn.active = !1;
this.views["card_left/cardnum"].getComponent(cc.Label).string = e.leftCardNum;
} else cc.mm.uimanager.showWindow(cc.mm.config.resources, "JoinFriendFail", e);
},
clear_point_left_card: function() {
this.views.hutip.active = !1;
this.views.playerState.active = !1;
this.views["buttom/blackNode/label"].getComponent(cc.Label).string = "0";
this.views["buttom/dotNode/label"].getComponent(cc.Label).string = "0";
this.views["card_left/cardnum"].getComponent(cc.Label).string = "0";
this.views.selfclock.active = !1;
this.unscheduleAllCallbacks();
},
_ntfClearData: function() {
this.restOperator();
this.model.clearData();
this.views.tg_bg.active = !1;
this.views.sureTip.active = !1;
this.views.ntfOperate.active = !1;
this.views.selfclock.active = !1;
this.views.roomid.active = !1;
this.views.LeaveBtn.active = !1;
this.views.changeBtn.active = !1;
for (var e = 0; e < this.arrows.length; e++) this.nodePool.put(this.arrows[e]);
this.arrows.length = 0;
},
_ntfClearOperator: function() {
this.views.sureTip.active = !1;
this.views.ntfOperate.active = !1;
this.views.select.active = !1;
},
onNoticePlayCard: function(e) {
e ? this._showPlayerState() : this.scheduleOnce(this._showPlayerState.bind(this), 10);
},
_noticeUpdateClockPos: function(e, t) {
var i = this;
if (e.isSelf()) {
this.views.selfclock.active = e.isOperator;
this.views.selfclock.stopAllActions();
if (e.isOperator) {
this.views.ntfOperate.getComponent(cc.Layout).updateLayout();
var s = this.views.ntfOperate.x - this.views.ntfOperate.width;
this.views.selfclock.x = s < -140 ? s - 100 : -140;
var a = t ? t.autoIntoSecond : 10;
this.views.selfclock.getChildByName("label").getComponent(cc.Label).string = a;
this.views.selfclock.runAction(cc.repeat(cc.sequence(cc.delayTime(1), cc.callFunc(function() {
a--;
i.views.selfclock.getChildByName("label").getComponent(cc.Label).string = a;
})), a));
}
}
},
_showPlayerState: function() {
this.views.playerState.active = !0;
},
onNoticeUserOutCard: function() {
this.views.playerState.active = !1;
this.unscheduleAllCallbacks();
},
onClickMenuBtn: function() {
if (!this.views.menunode.active) {
var e = n.huinan.server.proto.ENRoomType;
this.views["menunode/gy_btn_tuichu"].active = !this.model.getState() || cc.mm.gameserver.room_data.roomType != e.EN_ROOM_TYPE_FRIEND;
this.views["menunode/gy_btn_jsfj"].active = cc.mm.gameserver.room_data.roomType === e.EN_ROOM_TYPE_FRIEND && this.model.getState();
this.views.menunode.active = !0;
var t = cc.moveTo(.3, cc.v2(-cc.director.getWinSize().width / 2, 0)).easing(cc.easeCubicActionIn());
this.views.menunode.runAction(t);
if (cc.mm.gameserver.isReplay()) {
this.views["menunode/gy_btn_jsfj"].active = !1;
this.views["menunode/gy_btn_tuichu"].active = !0;
}
}
},
onClickBgBtn: function() {
var e = this;
if (this.views.menunode.active) {
var t = cc.moveTo(.3, cc.v2(-cc.director.getWinSize().width / 2 - this.views.menunode.width, 0)).easing(cc.easeCubicActionOut());
this.views.menunode.runAction(cc.sequence(t, cc.callFunc(function() {
e.views.menunode.active = !1;
})));
}
},
onClickChatBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonFace", this.model.getSelfSeat());
},
onClickInvateBtn: function() {
var e = this.getNameStr(), t = cc.mm.gameserver.shares[1].url, i = cc.mm.hallserver.mLastRoomParam, s = e + ",房间号：[" + cc.mm.gameserver.room_data.roomId + "] \n\n\n";
s += "局数: " + i.gameNum;
s += "人数: " + i.playerNum;
s += this.getRule();
s += "\n\n\n ->复制此消息后，打开游戏自动进入房间（注：无法自动进入，请安装最新版本）";
if (cc.sys.isNative && cc.sys.isMobile) {
var a = cc.mm.gameserver.getVersionCode();
if (cc.sys.os == cc.sys.OS_IOS) if (a <= 4) {
s = s.substring(e.length + 1);
jsb.reflection.callStaticMethod("AppController", "shareFriend:des:title:", t, s, e);
} else jsb.reflection.callStaticMethod("AppController", "shareFriendText:", s); else if (a <= 3) {
s = s.substring(e.length + 1);
jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "shareFriend", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V", t, s, e);
} else jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "shareFriendText", "(Ljava/lang/String;)V", s);
} else cc.mm.gameserver.setClipboard(s);
},
onClickCancelTgBtn: function() {
this.onClickBgBtn();
var e = new n.huinan.server.proto.MsgData();
e.hwRequestCancelAuto = new n.huinan.server.proto.HWRequestCancelAuto();
cc.mm.server.send(e, cc.mm.msgEvent.HWRequestCancelAuto, cc.mm.framemodel.uid);
},
onClickRuleBtn: function() {
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonPlayUI", this.model);
},
onClickExitBtn: function() {
console.log("onClickExitBtn");
this.onClickBgBtn();
if (cc.mm.gameserver.isReplay() || this.model.isCanExit()) {
cc.mm.gameserver.clear();
cc.mm.assets.loadBoot(cc.mm.config.hall, cc.mm.config.hallboot, function(e) {
cc.mm.framemodel.curgameid = 9999;
cc.mm.uimanager.showWindow(cc.mm.config.hall, e, {}, !0);
});
} else {
var e = new n.huinan.server.proto.MsgData();
e.hwRequestLogoutTable = new n.huinan.server.proto.HWRequestLogoutTable();
e.hwRequestLogoutTable.roomId = this.model.roomId;
cc.mm.server.send(e, cc.mm.msgEvent.HWRequestLogoutTable, cc.mm.framemodel.uid);
}
},
onClickTGBtn: function() {
this.onClickBgBtn();
if (this.model.getSelf().hand_cards.length) {
var e = new n.huinan.server.proto.MsgData();
if (this.views.tg_bg.active) {
e.hwRequestCancelAuto = new n.huinan.server.proto.HWRequestCancelAuto();
cc.mm.server.send(e, cc.mm.msgEvent.HWRequestCancelAuto, cc.mm.framemodel.uid);
} else {
e.hwRequestAuto = new n.huinan.server.proto.HWRequestAuto();
cc.mm.server.send(e, cc.mm.msgEvent.HWRequestAuto, cc.mm.framemodel.uid);
}
} else cc.mm.uimanager.showTextPrompt("游戏还没有开始..");
},
onClickSetBtn: function() {
console.log("onClickSetBtn");
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.resources, "HallSetUI");
},
onClickDismissBtn: function() {
console.log("onClickDismissBtn");
this.onClickBgBtn();
var e = new n.huinan.server.proto.MsgData();
e.hwRequestDissolveTable = new n.huinan.server.proto.HWRequestDissolveTable();
e.hwRequestDissolveTable.choice = !0;
e.hwRequestDissolveTable.roomId = this.model.roomId;
cc.mm.server.send(e, cc.mm.msgEvent.HWRequestDissolveTable, cc.mm.framemodel.uid);
},
onClickUserHead: function(e) {
var t = e.node.getComponent("dss_playerController");
t._model.isSelf() ? cc.mm.uimanager.showWindow(cc.mm.config.resources, "HallPersonUI") : cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonPlayerInfo", t._model);
},
onClickReadyBtn: function() {
var e = new n.huinan.server.proto.MsgData();
e.hwRequestReadyForGame = new n.huinan.server.proto.HWRequestReadyForGame();
e.hwRequestReadyForGame.state = !0;
cc.mm.server.send(e, cc.mm.msgEvent.HWRequestReadyForGame, cc.mm.framemodel.uid);
},
onClickPlayReady: function() {
this.onClickReadyBtn();
},
_noticeUpdataSelf: function(e) {
window.Standalone.scoreLabel(this.views["buttom/scoreNode/label"], e.score);
this.views["buttom/dotNode/label"].getComponent(cc.Label).string = e.points;
},
_ntfUserDataChange: function(e) {
for (var i = 0; i < this.model.playerNum; i++) {
var s, a;
if ((null == (s = this.model) ? void 0 : null == (a = s.players[i]) ? void 0 : a.uid) == e.uid) {
this.model.players[i].score = e.goldNum;
this.players[this.model.players[i].showSeat] && this.players[this.model.players[i].showSeat].updateScore();
}
}
9031 == e.changeType && (this.model.roomType !== t.EN_ROOM_TYPE_FRIEND ? cc.mm.hallserver.requestJoinAmuse(cc.mm.gameserver.getTable().roomType, cc.mm.gameserver.getTable().areaType, cc.mm.hallserver.mLastRoomParam.yifupai) : cc.mm.hallserver.requestContinueGame(cc.mm.againUsers));
},
_ntfShowTgView: function(e) {
this.views.tg_bg.active = e;
this.node.getChildByName("doushisi-dapai-tishi-shoujia-di").active = !1;
if (e) {
this.views["select/cards"].removeAllChildren(!0);
this.views.select.active = !1;
this.views.ntfOperate.active = !1;
this.views.sureTip.active = !1;
}
},
getRoomByType: function(e) {
for (var t = 0; t < cc.mm.config.roomConfig.length; t++) if (cc.mm.config.roomConfig[t].roomType == e) return cc.mm.config.roomConfig[t].scoreRate + "豆";
return "";
},
getNameStr: function() {
var e, t, i, s, a, o;
if ("其他区域" == cc.mm.gameserver.xianName && "成都市" == cc.mm.gameserver.shiName) return "成都斗十四";
switch (cc.mm.hallserver.mLastRoomParam.areaType) {
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZYAY:
return "安岳斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDXJ:
return "其他区域" == cc.mm.gameserver.xianName && "眉山" == cc.mm.gameserver.shiName ? "眉山斗十四" : "彭山" == cc.mm.gameserver.xianName ? "彭山斗十四" : "新津斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YHGY:
return cc.mm.hallserver.mLastRoomParam.yifupai ? "勾鱼一副牌" : "勾鱼两副牌";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_PSHSS:
return "沿河" == cc.mm.gameserver.xianName ? "沿河火十四" : "彭水火十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20:
return "汉源" == cc.mm.gameserver.xianName ? "汉源红二十" : "雅安红二十";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDPJ:
return "蒲江斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDQL:
return "邛崃斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_AB:
return "阿坝斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABJC:
return ("其他区域" == cc.mm.gameserver.xianName ? "阿坝" : cc.mm.gameserver.xianName) + "斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABMEK:
return "马尔康斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABXJ:
return "小金斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZPC:
return "平昌扯坨";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABWC:
return "汶川斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABMX:
return "阿坝斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_MJ_YAXZ:
return "雅安麻将";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_SCSN:
return null != (e = cc.mm.gameserver.xianName) && e.includes("射洪") ? "射洪斗十四" : "遂宁斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_GY:
return null != (t = cc.mm.gameserver.xianName) && t.includes("旺苍") ? "旺苍割胡" : "广元割胡";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZTJ:
return null != (i = cc.mm.gameserver.xianName) && i.includes("其他") ? "巴中斗十四" : "通江斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZGRX:
return null != (s = cc.mm.gameserver.xianName) && s.includes("其他") ? "自贡斗十四" : "荣县斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSYX:
return "越西斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZTYJ:
return null != (a = cc.mm.gameserver.xianName) && a.includes("其他") ? "昭通斗十四" : "盐津斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_GZLT:
return "理塘红斗";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YBXZ:
return null != (o = cc.mm.gameserver.xianName) && o.includes("其他") ? "宜宾斗十四" : "叙州斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_MJ_YAXZ:
return "雅安麻将";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_MJ_LFXZ:
return "两房麻将";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSLB:
return "雷波斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YBJL_TY:
return "筠连斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSGL:
return "甘洛斗十四";
}
return "";
},
getRule: function() {
var e = cc.mm.hallserver.mLastRoomParam, t = n.huinan.server.proto.ENAreaType, i = "场次规则: ", s = n.huinan.server.proto.ENRoomType;
cc.mm.gameserver.room_data.roomType == s.EN_ROOM_TYPE_FRIEND && (i += 1 == e.useCardType ? "房主、" : "AA、");
e.areaType != t.EN_AREA_TYPE_PKDDS_LSGL && e.areaType != t.EN_AREA_TYPE_PKDDS_YBJL_TY && e.areaType != t.EN_AREA_TYPE_PKDDS_ZTYJ && e.areaType != t.EN_AREA_TYPE_PKDDS_BZTJ && e.areaType != t.EN_AREA_TYPE_PKDDS_SCSN && e.areaType != t.EN_AREA_TYPE_PKDDS_GZLT && (i += 99 != e.maxFan ? e.maxFan + "番、" : "不封顶、");
e.wangNum && e.areaType != t.EN_AREA_TYPE_PKDDS_LSGL && e.areaType != t.EN_AREA_TYPE_PKDDS_YBJL_TY && e.areaType != t.EN_AREA_TYPE_PKDDS_LSLB && e.areaType != t.EN_AREA_TYPE_PKDDS_ZTYJ && e.areaType != t.EN_AREA_TYPE_PKDDS_YBXZ && e.areaType != t.EN_AREA_TYPE_PKDDS_ZGRX && (i += e.wangNum + "个王、");
e.wangNum && (e.areaType == t.EN_AREA_TYPE_PKDDS_YBJL_TY || e.areaType == t.EN_AREA_TYPE_PKDDS_ZGRX) && (i += e.wangNum + "个赖子、");
e.chaoFanJiaDi && e.areaType != t.EN_AREA_TYPE_PKDDS_LSGL && (i += "超番加底:" + e.chaoFanJiaDi + "、");
e.huRedScore && e.areaType != t.EN_AREA_TYPE_PKDDS_LSLB && e.areaType != t.EN_AREA_TYPE_PKDDS_ZTYJ && e.areaType != t.EN_AREA_TYPE_PKDDS_LSYX && e.areaType != t.EN_AREA_TYPE_PKDDS_GY && (i += "胡牌:" + e.huRedScore + "分、");
e.areaType == t.EN_AREA_TYPE_PKDDS_YAH20 && (i += "7当王:" + e.qiWangNum + "、");
e.areaType == t.EN_AREA_TYPE_PKDDS_YAH20 && (i += "吃牌:" + (e.ziChi ? "自摸自吃、" : "可吃上家、"));
e.areaType == t.EN_AREA_TYPE_PKDDS_ZYAY && (i += [ "不漂、", "必漂、", "选漂、" ][e.piaoType]);
e.areaType == t.EN_AREA_TYPE_PKDDS_ZGRX && (i += [ "不漂、", "必漂、", "随漂、" ][e.piaoType]);
if (e.areaType == t.EN_AREA_TYPE_PKDDS_CDPJ || e.areaType == t.EN_AREA_TYPE_PKDDS_CDQL) {
i += e.baoJiaoYingbao ? "已有红20报叫、" : "含胡牌红20报叫、";
i += e.chaJiao ? "黄庄查叫、" : "黄庄不查叫、";
}
if (e.baojiaoCondition > 0) {
var a = "";
switch (e.baojiaoCondition) {
case 1:
a += "比起胡分数少100分、";
break;

case 2:
a += "与起胡分数一样、";
break;

case 3:
a += "翻1番后达到起胡分数、";
}
i += a;
}
if (e.baipiType > 0 && e.areaType != t.EN_AREA_TYPE_PKDDS_GY) {
var o = "";
switch (e.baipiType) {
case 1:
o += "直接摸上手、";
break;

case 2:
o += "不伤手只能自己用、";
break;

case 3:
o += "不上手大家都可以用、";
}
i += o;
}
e.areaType == t.EN_AREA_TYPE_PKDDS_CDXJ ? i += e.chengFan ? "跟斗翻、" : "梯坎翻、" : e.areaType == t.EN_AREA_TYPE_PKDDS_YAH20 ? i += e.chengFan ? "滚滚翻、" : "梯坎翻、" : e.areaType == t.EN_AREA_TYPE_PKDDS_BZPC ? i += e.chengFan ? "滚翻（番相乘）、" : "梯翻（番相加）、" : e.areaType != t.EN_AREA_TYPE_PKDDS_LSGL && e.areaType != t.EN_AREA_TYPE_PKDDS_YBJL_TY && e.areaType != t.EN_AREA_TYPE_PKDDS_LSLB && e.areaType != t.EN_AREA_TYPE_PKDDS_YBXZ && e.areaType != t.EN_AREA_TYPE_PKDDS_ZTYJ && e.areaType != t.EN_AREA_TYPE_PKDDS_LSYX && e.areaType != t.EN_AREA_TYPE_PKDDS_ZGRX && e.areaType != t.EN_AREA_TYPE_PKDDS_BZTJ && e.areaType != t.EN_AREA_TYPE_PKDDS_GY && e.areaType != t.EN_AREA_TYPE_PKDDS_GZLT && e.areaType != t.EN_AREA_TYPE_PKDDS_SCSN && e.areaType != t.EN_AREA_TYPE_PKDDS_ABWC && e.areaType != t.EN_AREA_TYPE_PKDDS_ABMX && (i += e.chengFan ? "滚滚翻、" : "颗颗加、");
e.bage10tianhu && (i += "八个10天胡、");
e.jiaqiang && (i += "牌十加分、");
e.qige7 && (i += "七个七、");
if ((e.areaType === 2 || e.areaType === 3) && !e.yifupai) i += "两副牌、";
e.baipi && e.areaType == t.EN_AREA_TYPE_PKDDS_PSHSS && (i += "白皮、");
e.jiaDxh && (i += "加大小王花牌个1张、");
e.qiToWang && e.areaType != t.EN_AREA_TYPE_PKDDS_BZTJ && e.areaType != t.EN_AREA_TYPE_PKDDS_GY && e.areaType != t.EN_AREA_TYPE_PKDDS_YAH20 && !this.getAb(e.areaType) && (i += "七当王、");
e.anDui && e.areaType != t.EN_AREA_TYPE_PKDDS_LSGL && e.areaType != t.EN_AREA_TYPE_PKDDS_YAH20 && !this.getAb(e.areaType) && (i += "对子胡、");
e.dianpaoBaopei && !this.getAb(e.areaType) && e.areaType != t.EN_AREA_TYPE_PKDDS_GY && (i += "点炮包赔、");
e.zhuangJiadi && (i += "打庄算番、");
e.cheLong && !this.getAb(e.areaType) && e.areaType != t.EN_AREA_TYPE_PKDDS_GY && (i += "扯拢算番、");
e.chaJiao && (i += "黄庄查叫、");
e.hongHei_50 && e.areaType != t.EN_AREA_TYPE_PKDDS_GZLT && (i += "红50和黑50、");
e.jinGouDiao && !this.getAb(e.areaType) && (i += "金钩钓、");
e.gangHua && e.areaType != t.EN_AREA_TYPE_PKDDS_LSGL && e.areaType != t.EN_AREA_TYPE_PKDDS_SCSN && (i += "杠上花、");
e.gangPao && (i += "杠上炮、");
e.siGuiYi && e.areaType != t.EN_AREA_TYPE_PKDDS_LSGL && (i += "四归一、");
e.quanXing && (i += "全兴、");
e.haiDiLao && e.areaType != t.EN_AREA_TYPE_PKDDS_YBJL_TY && e.areaType != t.EN_AREA_TYPE_PKDDS_GZLT && (i += "海底捞、");
e.jiaFan_258 && (i += "258加番、");
e.doubleInOut && e.areaType != t.EN_AREA_TYPE_PKDDS_ABWC && (i += "双进双出、");
e.zha && (i += "炸、");
e.duiziShunzi && (i += "对子加顺子、");
e.guoZhuang && (i += "过庄、");
e.zimoJiafan && e.areaType != t.EN_AREA_TYPE_PKDDS_YBXZ && (i += e.areaType == t.EN_AREA_TYPE_PKDDS_ZTYJ ? "自摸加倍、" : "自摸算1番、");
e.quanDaXiaoLan && (i += "全大、全小、全烂3抽、");
e.qia25 && (i += "巧二十五两番、");
e.tingyongHuDaFan && (i += "彩电胡打和翻的牌、");
if (e.areaType == t.EN_AREA_TYPE_PKDDS_CDXJ) {
e.diHu && (i += "地胡3番、");
e.tianHu && (i += "天胡3番、");
e.qia20 && (i += "恰二十一番、");
e.baoJiao && (i += "报叫一番、");
e.anDui && (i += "暗四对、");
e.longDui && (i += "龙对、");
e.xiaoHu && (i += "五小、");
e.qia40 && (i += "红40、");
e.qia50 && (i += "红50、");
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_YAH20) {
e.qia20 && (i += "金二十一番、");
e.anDui && (i += "暗四对三番、");
e.baoJiao && (i += "报叫三番、");
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_CDPJ || e.areaType == t.EN_AREA_TYPE_PKDDS_CDQL) {
e.anDui && (i += "暗四对三番、");
e.qia20 && (i += "金二十三番、");
e.quanHongHei && (i += "全红3番、全黑4番、");
i += (e.keSuHu ? "可平胡" : "不可平胡") + "、";
} else if (this.getAb(e.areaType)) {
e.diHu && (i += "地胡算1番、");
e.cheLong && e.areaType != t.EN_AREA_TYPE_PKDDS_ABWC && (i += "碰凑胡算一番、");
e.cheLong && e.areaType == t.EN_AREA_TYPE_PKDDS_ABWC && (i += "扯凑胡算一番、");
e.jinGouDiao && (i += "大单调、");
e.qianfenJiafan && (i += "1000分以上加1番、");
i += e.hpToTingyong ? "白皮当听用、" : "不打听用、";
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_BZPC) i += e.zhuang8Xian7 ? "庄8坨闲7坨、" : "庄7坨闲6坨、"; else if (e.areaType == t.EN_AREA_TYPE_PKDDS_GZLT) {
e.qia20 && (i += "金二十3抽、");
e.qia50 && (i += "金五十10抽、");
1 == e.hongHei_50 && (i += "红五十5抽、");
e.haiDiLao && (i += "海底捞3抽、");
e.quanHongHei && (i += "全红、全黑3抽、");
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_GY) {
e.cheLong && (i += "碰凑胡算、");
e.baoJiao && (i += "报叫、");
e.tianHu && (i += "天胡2番、");
e.diHu && (i += "地胡1番、");
e.huRedScore && (i += e.huRedScore + "分起胡、");
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_LSYX) {
i += e.wangToTingyong ? "打赖子、" : "不打赖子、";
i += e.diHuChuDiyizhang ? "庄家打一张可胡、" : "";
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_ZTYJ) {
i += e.siCaiErJing ? "四彩二精、" : "大小王和白皮当彩电、";
i += "红" + e.huRedScore + "点起胡、";
e.quanHongHei && (i += "红黑红各两番、");
e.tianHu && (i += "天地胡各两番、");
e.daQuanHong && (i += "大全红、");
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_YBXZ) {
i += e.piaoType ? "漂一个" : "不漂、";
i += e.wangNum + "个赖子、";
i += e.baNoGuo ? "有巴必巴、" : "";
i += e.guoZhangNoCaozuo ? "过张不能吃碰、" : "";
i += e.gangDuoZhang ? "杠牌超过4张、" : "";
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_LSLB) {
e.quanHongHei && (i += "红黑胡各2番、");
e.tianHu && (i += "天地胡各2番、");
e.ownBaKeQiang && (i += "不能抢胡手上去巴的牌、");
i += e.wangNum + "个赖子、";
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_YBJL_TY) {
i += e.wangNum ? "白皮听用、" : "";
i += 21 == e.qiFanDianNum ? "21点算1番、" : "25点算1番、";
i += 6 == e.anDuiFanNum ? "明8暗6鸳10、" : "明15暗10鸳14、";
i += e.qia20 ? "巧20算4番、" : "";
i += e.da_7hong_7hei ? "7红7黑、" : "";
i += e.yiDianZhu ? "一点朱、" : "";
i += e.quanQiuRen ? "全求人、" : "";
i += e.menQing ? "门清、" : "";
i += e.siZhangLuoDi ? "四张落地、" : "";
i += e.luanHu ? "乱胡、" : "";
i += e.qiang_7Hu ? "抢7胡、" : "";
i += e.daShaQiangHu ? "大杀可胡、" : "";
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_LSGL) {
i += 99 != e.maxFan ? e.maxFan + "敲、" : "不封顶、";
i += 3 == e.wangNum ? "3个王（一副牌）、" : "6个王（两副牌）、";
e.chaoFanJiaDi && (i += "每敲加" + e.chaoFanJiaDi + "分、");
e.siGuiYi && (i += "四归一2敲、");
e.anDui && (i += "暗四对2敲、");
e.qia20 && (i += "金二十1敲、");
e.baoJiao && (i += "报叫2敲、");
e.gangHua && (i += "杠上花1敲、");
i += e.qiWangNum + "个七（" + e.qiWangNum / 4 + "副牌）、";
} else if (e.areaType == t.EN_AREA_TYPE_PKDDS_SCSN) {
i += e.ziChi ? "自摸自吃、" : "";
i += e.gangHua ? "杠上花两番、" : "";
i += e.diHu ? "地胡一番、" : "";
i += e.tianHu ? "天胡一番、" : "";
} else {
e.qia20 && (i += "恰二十、");
e.baoJiao && (i += "报叫、");
e.quanHongHei && (i += "全红、全黑3番、");
}
2 == e.processType && (i += "血战玩法、");
cc.mm.gameserver.room_data.roomType === n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND && (i += this.getBasicTimes() + "分、");
i += window.Standalone.qionglaiRuleSummary(e);
return i.substring(0, i.length - 1);
},
getBasicTimes: function() {
if (typeof cc.mm.hallserver.mLastRoomParam.baseBeans === "string") return cc.mm.hallserver.mLastRoomParam.baseBeans;
switch (this.model.areaType) {
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZYAY:
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDXJ:
return 1;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YHGY:
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_PSHSS:
return this.model.basicTimes / 10;
}
return 1;
},
_noticeUpdateTableInfo: function(e) {
var t = n.huinan.server.proto.ENRoomType;
if (e.roomType === t.EN_ROOM_TYPE_FRIEND) {
this.views["buttom/roomid"].active = !0;
var i = "<color=#ffffff>房间号: </c><color=#FFFA00>" + e.roomId + "</color>";
this.views["buttom/roomid/label"].getComponent(cc.RichText).string = i;
e.getSelf() && !cc.mm.gameserver.isReplay() && this.changeBtnsPos();
} else {
this.views["buttom/roomid"].active = !1;
this.views["buttom/type"].active = !0;
e.roomType === t.EN_ROOM_TYPE_JUNIOR ? this.views["buttom/type/richtext"].getComponent(cc.RichText).string = "<color=#ffffff>初级场  </c><color=#FFF600>" + this.getRoomByType(e.roomType) + "</color>" : e.roomType === t.EN_ROOM_TYPE_MIDDLE ? this.views["buttom/type/richtext"].getComponent(cc.RichText).string = "<color=#ffffff>中级场  </c><color=#FFF600>" + this.getRoomByType(e.roomType) + "</color>" : e.roomType === t.EN_ROOM_TYPE_SENIOR ? this.views["buttom/type/richtext"].getComponent(cc.RichText).string = "<color=#ffffff>高级场  </c><color=#FFF600>" + this.getRoomByType(e.roomType) + "</color>" : e.roomType === t.EN_ROOM_TYPE_DASHI && (this.views["buttom/type/richtext"].getComponent(cc.RichText).string = "<color=#ffffff>大师场  </c><color=#FFF600>" + this.getRoomByType(e.roomType) + "</color>");
this.views.readyBtn.active = !1;
}
this._ntfUpdateLeftCard(e);
},
_noticeTableInfo: function(e) {
this._ntfUpdateLeftCard(e);
var t = n.huinan.server.proto.ENRoomType;
if (cc.mm.gameserver.room_data.roomType === t.EN_ROOM_TYPE_FRIEND) this.views.invateBtn.active = !1; else {
this.views.roomid.active = !0;
var i = "<color=#ffffff>房间号: </c><color=#FFFA00>" + this.model.roomId + "</color>";
this.views["roomid/label"].getComponent(cc.RichText).string = i;
}
},
_ntfDissolve: function(e) {
cc.mm.uimanager.getWindow("CommonDissolve") ? cc.mm.uimanager.getWindow("CommonDissolve").updateDissolve(e) : cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonDissolve", {
msg: e,
model: this.model
});
},
_ntfCommonMsg: function(e) {
if (e.cmd === cc.mm.frametype.CHAT_TYPE_FACE) this.players[e.showSeat].onShowFace(e); else if (e.cmd === cc.mm.frametype.CHAT_TYPE_TEXT) this.players[e.showSeat].onShowText(e); else if (e.cmd === cc.mm.frametype.UPDATE_POINTS) {
this.views["buttom/dotNode/label"].getComponent(cc.Label).string = e.model.points;
this.views["buttom/blackNode/label"].getComponent(cc.Label).string = e.model.blackPoint;
} else e.cmd === cc.mm.frametype.CHAT_TYPE_ITEM && this._moveEffect(e.target, e.src, e.item);
},
_ntfPlayerChatMSg: function(e) {
if (this.model.isInGame && this.model.getPlayerByUid(e.uid)) if (e.ctype === n.huinan.server.proto.ENChatType.EN_CHAT_TYPE_MUTUAL_FACE && this.model.players[e.mutualFaceToUid]) {
var t, i;
this._moveEffect(null == (t = this.model.getPlayerByUid(e.uid)) ? void 0 : t.showSeat, null == (i = this.model.players[e.mutualFaceToUid]) ? void 0 : i.showSeat, e.mutualFaceId);
} else if (e.ctype === n.huinan.server.proto.ENChatType.EN_CHAT_TYPE_CHARACTER) {
var s, a;
null == (s = this.players[null == (a = this.model.getPlayerByUid(e.uid)) ? void 0 : a.showSeat]) || s.onShowText(e);
} else if (e.ctype === n.huinan.server.proto.ENChatType.EN_CHAT_TYPE_FACE) {
var o, r;
null == (o = this.players[null == (r = this.model.getPlayerByUid(e.uid)) ? void 0 : r.showSeat]) || o.onShowFace(e);
}
},
_ntfEnterRoom: function(e) {
if (cc.mm.gameserver.isReplay() && this.players[e.showSeat]) {
this.players[e.showSeat].setModel(e);
this.players[e.showSeat].reLoad();
} else {
this.views["palyers/hu" + e.showSeat].active = !1;
var t = cc.instantiate(o.getCard("dss_player"));
cc.mm.uitools.restNode(t);
this.views["palyers/pos" + e.showSeat].addChild(t);
cc.mm.uitools.addBtnLister(t, this.onClickUserHead.bind(this), this);
var i = t.getComponent("dss_playerController");
i.setFoldNode(this.views["palyers/fold" + e.showSeat], this.views.foldnode);
i.setDeskNode(this.views["palyers/desk" + e.showSeat]);
i.setReadyNode(this.views["palyers/ready" + e.showSeat]);
i.setOpenCardNode(this.views["palyers/open" + e.showSeat]);
i.setHuNode(this.views["palyers/hu" + e.showSeat]);
i.supplement = this.views["palyers/buchongtishi_" + e.showSeat];
i.giveUp = this.views["palyers/giveUp_" + e.showSeat];
i.scoreEffect = this.views["palyers/effectLabel" + e.showSeat];
e.showSeat && i.setHand(this.views["palyers/hand" + e.showSeat]);
e.showSeat && i.setHandBg(this.views["palyers/handbg_" + e.showSeat]);
i.setModel(e);
i.reLoad();
var s = n.huinan.server.proto.ENRoomType, a = cc.mm.gameserver.room_data.roomType === s.EN_ROOM_TYPE_FRIEND;
t.getChildByName("scoreNode").getChildByName("gy_dou").active = true;
t.getChildByName("scoreNode").getChildByName("gy_fen").active = false;
this.views["buttom/scoreNode/doudou"].active = true;
this.views["buttom/scoreNode/score"].active = false;
e.isSelf() && (this.views["buttom/dotNode/label"].getComponent(cc.Label).string = e.points);
this.players[e.showSeat] = i;
if (this.model.getSelf()) {
this.changeBtnsPos();
this.model.isStart || cc.mm.gameserver.room_data.roomType != s.EN_ROOM_TYPE_FRIEND || cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonPlayUI", this.model);
}
}
},
onClickbuchongdou: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "SupplementUI", !1);
},
changeBtnsPos: function(e) {
void 0 === e && (e = !1);
var t = n.huinan.server.proto.ENRoomType;
if (cc.mm.gameserver.room_data.roomType == t.EN_ROOM_TYPE_FRIEND) {
var i = this.model.getValidPlayer() == this.model.playerNum;
this.views.invateBtn.active = e || !i;
this.views.readyBtn.active = !this.model.getSelf().isReady && this.model.getSelf() && !this.model.getSelf().hand_cards.length;
}
},
_ntfUpdateLeftCard: function(e) {
var t = null == e.leftCardNum ? this.model.left_card_num : e.leftCardNum;
this.views["card_left/cardnum"].getComponent(cc.Label).string = t;
this.loadgetName();
if (n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND == cc.mm.gameserver.getTable().roomType) {
var i = "<color=#ffffff>局数:</color><color=#FFFA00>" + this.model.numofgames + "</c><color=#ffffff>/" + this.model.gameNum + "</color>";
this.views["countbg/gameNum"].getComponent(cc.RichText).string = i;
}
},
loadgetName: function() {
var e, t, i, s, a, o, r, c, h = this, m = "doushisi-game-bg-wenzi-chengdu";
switch (this.model.areaType) {
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZYAY:
m = "gy_bg-wenzi-anyue";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDXJ:
m = "其他区域" == cc.mm.gameserver.xianName && "眉山" == cc.mm.gameserver.shiName ? "doushisi-game-bg-wenzi-meishan" : "彭山" == cc.mm.gameserver.xianName ? "doushisi-game-bg-wenzi-pengshan" : "新津" != cc.mm.gameserver.xianName ? "doushisi-game-bg-wenzi-chengdu" : "gy_bg-wenzi-xinjin";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YHGY:
m = this.model.yifupai ? "gy_bg-wenzi-yifupai" : "gy_bg-wenzi-2fupai";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_PSHSS:
m = "沿河" == cc.mm.gameserver.xianName ? "bg-wenzi-yanhehuoshisi" : "gy_bg-wenzi-huoshisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20:
m = "汉源" == cc.mm.gameserver.xianName ? "bg-wenzi-hanyuanhongershi" : "bg-wenzi-yaanhongershi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDQL:
m = "bg-wenzi-gonglaidoushisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDPJ:
m = "bg-wenzi-pujiangdoushisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_AB:
m = "doushisi-game-bg-wenzi-aba";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABJC:
m = ((e = {
"理县": "doushisi-game-bg-wenzi-lixian",
"茂县": "doushisi-game-bg-wenzi-maoxian",
"松潘": "doushisi-game-bg-wenzi-songpan",
"九寨沟": "doushisi-game-bg-wenzi-jiuzhaigou",
"黑水": "doushisi-game-bg-wenzi-heishui",
"壤塘": "doushisi-game-bg-wenzi-rangtang",
"若尔盖": "doushisi-game-bg-wenzi-ruoergai",
"红原": "doushisi-game-bg-wenzi-hongyuan",
"阿坝": "doushisi-game-bg-wenzi-aba",
"金川": "doushisi-game-bg-wenzi-jinchuan",
"其他区域": "doushisi-game-bg-wenzi-aba"
})["理县"] = "doushisi-game-bg-wenzi-lixian", e["小金"] = "doushisi-game-bg-wenzi-xiaojin", 
e["马尔康"] = "doushisi-game-bg-wenzi-maerkang", e)[cc.mm.gameserver.xianName];
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABMEK:
m = "doushisi-game-bg-wenzi-maerkang";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABXJ:
m = "doushisi-game-bg-wenzi-xiaojin";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZPC:
m = "gy_bg-wenzi-pingchang";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABWC:
m = "doushisi-game-bg-wenzi-wenchuan";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABMX:
m = "doushisi-game-bg-wenzi-aba";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_SCSN:
m = null != (t = cc.mm.gameserver.xianName) && t.includes("射洪") ? "bg-wenzi-shehong" : "bg-wenzi-suining";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_GZLT:
m = "bg-wenzi-gonglaihongershi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_GY:
m = null != (i = cc.mm.gameserver.xianName) && i.includes("旺苍") ? "doushisi-game-bg-wenzi-wangcang" : "doushisi-game-bg-wenzi-guangyuan";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZTJ:
m = null != (s = cc.mm.gameserver.xianName) && s.includes("其他") ? "doushisi-game-bg-wenzi-bazhong" : "doushisi-game-bg-wenzi-tongjiang";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZGRX:
m = null != (a = cc.mm.gameserver.xianName) && a.includes("其他") ? "bg-wenzi-zigongdoushisi" : "bg-wenzi-rongxiandoushisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSYX:
m = null != (o = cc.mm.gameserver.xianName) && o.includes("其他") ? "bg-wenzi-liangshandoushisi" : "bg-wenzi-yuexidoushisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZTYJ:
m = null != (r = cc.mm.gameserver.xianName) && r.includes("其他") ? "bg-wenzi-zhaotongdoushisi" : "bg-wenzi-yanjindoushisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YBXZ:
m = null != (c = cc.mm.gameserver.xianName) && c.includes("其他") ? "bg-wenzi-yibindoushisi" : "bg-wenzi-xuzhoudoushisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSLB:
m = "bg-wenzi-leibodoushisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YBJL_TY:
m = "bg-wenzi-junliandoushisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSGL:
m = "bg-wenzi-ganluodoushisi";
break;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20_XZ:
m = "dss_game-images_wenzi-xuezhan";
break;

default:
m = "bg-wenzi-yaanhongershi";
}
cc.assetManager.getBundle(cc.mm.config.dss).load("res/frames/" + m, cc.SpriteFrame, function(e, t) {
t && cc.isValid(h.views.game_name_sprite) && (h.views.game_name_sprite.getComponent(cc.Sprite).spriteFrame = t);
});
},
_ntfExitRoom: function(e) {
this.players[e.showSeat]._model.isReady = !1;
this.players[e.showSeat].destroyModel();
if (!cc.mm.gameserver.isReplay()) {
this.players[e.showSeat].node.destroy();
delete this.players[e.showSeat];
this.model.getSelf() && this.changeBtnsPos(!0);
}
},
_ntfOperate: function(e) {
if (!this.views.tg_bg.active) {
this.operatorList = {};
this.gangColList = {};
for (var t = e.choices, i = 0; i < t.length; i++) {
if (this.operatorList[t[i].actType]) {
if (this.model.areaType == r.EN_AREA_TYPE_PKDDS_YBJL_TY) {
var s = this.operatorList[t[i].actType].colInfo;
Array.isArray(s) && Array.isArray(t[i].colInfo) && (this.operatorList[t[i].actType].colInfo = s.concat(t[i].colInfo));
}
} else this.operatorList[t[i].actType] = t[i];
if (t[i].actType == c.EN_ACTION_GANG) {
var a = t[i].colInfo[0];
this.gangColList[a.colType] = t[i];
}
}
this.views.ntfOperate.active = !0;
this.views["ntfOperate/actionBtn_qianggang"].active = !1;
this.views["ntfOperate/actionBtn_qiangpeng"].active = !1;
this.views["ntfOperate/actionBtn_bao"].active = this.operatorList[c.EN_ACTION_BAO_TING];
this.views["ntfOperate/actionBtn_hu"].active = this.operatorList[c.EN_ACTION_HU];
this.views["ntfOperate/actionBtn_gang"].active = this.operatorList[c.EN_ACTION_GANG];
this.views["ntfOperate/actionBtn_peng"].active = this.operatorList[c.EN_ACTION_PENG];
this.views["ntfOperate/actionBtn_chi"].active = this.operatorList[c.EN_ACTION_CHI];
this.views["ntfOperate/actionBtn_tou"].active = this.operatorList[c.EN_ACTION_TOU];
this.views["ntfOperate/actionBtn_piao"].active = this.operatorList[c.EN_ACTION_PIAO];
this.views["ntfOperate/actionBtn_piao_guo"].active = this.operatorList[c.EN_ACTION_PIAO_GUO];
this.views["ntfOperate/actionBtn_guo"].active = this.operatorList[c.EN_ACTION_GUO];
this.views["ntfOperate/actionBtn_dazhuang"].active = this.operatorList[c.EN_ACTION_DANG_ZHUANG];
this.views["ntfOperate/actionBtn_huan"].active = this.operatorList[c.EN_ACTION_HUAN_CARD];
this.views["ntfOperate/actionBtn_ziqianghu"].active = this.operatorList[c.EN_ACTION_HU_ZI_QIANG];
this.views["ntfOperate/actionBtn_qianghu"].active = this.operatorList[c.EN_ACTION_HU_QIANG];
if (this.model.areaType == r.EN_AREA_TYPE_PKDDS_ZTYJ) {
this.views["ntfOperate/actionBtn_peng"].active = !1;
this.views["ntfOperate/actionBtn_tou"].active = !1;
this.views["ntfOperate/actionBtn_gang"].active = !1;
this.views["ntfOperate/actionBtn_sha"].active = this.operatorList[c.EN_ACTION_PENG];
this.views["ntfOperate/actionBtn_chen"].active = this.operatorList[c.EN_ACTION_TOU];
this.views["ntfOperate/actionBtn_dachen"].active = this.gangColList[h.EN_COL_TYPE_GANG_AN];
this.views["ntfOperate/actionBtn_dasha"].active = this.gangColList[h.EN_COL_TYPE_GANG_MING];
this.views["ntfOperate/actionBtn_ba"].active = this.gangColList[h.EN_COL_TYPE_GANG_BA];
}
if (this.model.areaType == r.EN_AREA_TYPE_PKDDS_YBJL_TY && this.operatorList[c.EN_ACTION_GANG]) for (var o = 0; o < this.operatorList[c.EN_ACTION_GANG].colInfo.length; o++) this.operatorList[c.EN_ACTION_GANG].colInfo[o].showType === n.huinan.server.proto.ENShowType.EN_SHOW_ZI_QIANG && (this.views["ntfOperate/actionBtn_qianggang"].active = !0);
if (this.model.areaType == r.EN_AREA_TYPE_PKDDS_YBJL_TY && this.operatorList[c.EN_ACTION_PENG]) for (var m = 0; m < this.operatorList[c.EN_ACTION_PENG].colInfo.length; m++) this.operatorList[c.EN_ACTION_PENG].colInfo[m].showType === n.huinan.server.proto.ENShowType.EN_SHOW_ZI_QIANG && (this.views["ntfOperate/actionBtn_qiangpeng"].active = !0);
this.views["palyers/ready0"].active = !1;
this.views["palyers/ready1"].active = !1;
this.views["palyers/ready2"].active = !1;
this.views["palyers/ready3"].active = !1;
if (this.views.selfclock.active) {
this.views.ntfOperate.getComponent(cc.Layout).updateLayout();
var d = this.views.ntfOperate.x - this.views.ntfOperate.width;
this.views.selfclock.x = d < -140 ? d - 100 : -140;
}
}
},
deepClone: function(e) {
if ("object" != typeof e && "function" != typeof e) return e;
var t = Array.isArray(e) ? [] : {};
for (var i in e) e.hasOwnProperty(i) && (t[i] = "object" == typeof e[i] ? this.deepClone(e[i]) : e[i]);
return t;
},
onClickOperator: function(e) {
var t = e.node.groupIndex;
"actionBtn_dachen" == e.node.name ? this.operatorList[t] = this.gangColList[n.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_AN] : "actionBtn_dasha" == e.node.name ? this.gangColList[n.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_MING] : "actionBtn_ba" == e.node.name && this.gangColList[n.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_BA];
if (t === n.huinan.server.proto.ENActionType.EN_ACTION_CHI) this._ntfOperatorChi(t, this.operatorList[t]); else if (t === n.huinan.server.proto.ENActionType.EN_ACTION_TOU) this._ntfOperatorTou(t, this.operatorList[t]); else if (t === n.huinan.server.proto.ENActionType.EN_ACTION_GANG) if (this.model.areaType == r.EN_AREA_TYPE_PKDDS_YBJL_TY) {
var i = this.deepClone(this.operatorList[t]);
if ("actionBtn_qianggang" == e.node.name) for (var s = i.colInfo.length - 1; s >= 0; s--) i.colInfo[s].showType || cc.js.array.removeAt(i.colInfo, s); else for (var a = i.colInfo.length - 1; a >= 0; a--) i.colInfo[a].showType && cc.js.array.removeAt(i.colInfo, a);
this._ntfOperatorGang(t, i);
} else this._ntfOperatorGang(t, this.operatorList[t]); else if (t === n.huinan.server.proto.ENActionType.EN_ACTION_PENG) if (this.model.areaType == r.EN_AREA_TYPE_PKDDS_YBJL_TY) {
var o = this.deepClone(this.operatorList[t]);
if ("actionBtn_qiangpeng" == e.node.name) for (var h = o.colInfo.length - 1; h >= 0; h--) o.colInfo[h].showType || cc.js.array.removeAt(o.colInfo, h); else for (var m = o.colInfo.length - 1; m >= 0; m--) o.colInfo[m].showType && cc.js.array.removeAt(o.colInfo, m);
this._ntfOperatorPeng(t, o);
} else this._ntfOperatorPeng(t, this.operatorList[t]); else if (t === n.huinan.server.proto.ENActionType.EN_ACTION_GUO) {
var d = this.views["ntfOperate/actionBtn_hu"].groupIndex;
if (this.operatorList[d]) {
this.views.sureTip.active = !0;
this.views.ntfOperate.active = !1;
return;
}
var l = new n.huinan.server.proto.MsgData();
l.hwRequestDoAction = new n.huinan.server.proto.HWRequestDoAction();
l.hwRequestDoAction.seatIndex = this.model.getSelfSeat();
l.hwRequestDoAction.actType = t;
l.hwRequestDoAction.destCard = this.operatorList[t].destCard;
cc.mm.server.send(l, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
} else if (t === c.EN_ACTION_HU || t === c.EN_ACTION_HU_QIANG || t === c.EN_ACTION_HU_ZI_QIANG) {
var _ = new n.huinan.server.proto.MsgData();
_.hwRequestDoAction = new n.huinan.server.proto.HWRequestDoAction();
_.hwRequestDoAction.seatIndex = this.model.getSelfSeat();
_.hwRequestDoAction.actType = t;
_.hwRequestDoAction.destCard = this.operatorList[t].destCard;
this.operatorList[t].showType && (_.hwRequestDoAction.showType = this.operatorList[t].showType);
cc.mm.server.send(_, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
} else if (t === n.huinan.server.proto.ENActionType.EN_ACTION_BAO_TING) {
var u = new n.huinan.server.proto.MsgData();
u.hwRequestDoAction = new n.huinan.server.proto.HWRequestDoAction();
u.hwRequestDoAction.seatIndex = this.model.getSelfSeat();
u.hwRequestDoAction.actType = t;
u.hwRequestDoAction.destCard = this.operatorList[t].destCard;
cc.mm.server.send(u, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
} else if (t === n.huinan.server.proto.ENActionType.EN_ACTION_PIAO) {
var p = new n.huinan.server.proto.MsgData();
p.hwRequestPiao = new n.huinan.server.proto.HWRequestPiao();
p.hwRequestPiao.piaoStatus = 1;
cc.mm.server.send(p, cc.mm.msgEvent.HWRequestPiao, cc.mm.framemodel.uid);
} else if (t === n.huinan.server.proto.ENActionType.EN_ACTION_PIAO_GUO) {
var g = new n.huinan.server.proto.MsgData();
g.hwRequestPiao = new n.huinan.server.proto.HWRequestPiao();
g.hwRequestPiao.piaoStatus = 0;
cc.mm.server.send(g, cc.mm.msgEvent.HWRequestPiao, cc.mm.framemodel.uid);
} else if (t === n.huinan.server.proto.ENActionType.EN_ACTION_DANG_ZHUANG) {
var f = new n.huinan.server.proto.MsgData();
f.hwRequestDoAction = new n.huinan.server.proto.HWRequestDoAction();
f.hwRequestDoAction.seatIndex = this.model.getSelfSeat();
f.hwRequestDoAction.actType = t;
cc.mm.server.send(f, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
} else if (t == n.huinan.server.proto.ENActionType.EN_ACTION_HUAN_CARD) {
var v, E = (null == (v = this.operatorList[t]) ? void 0 : v.colInfo[0]) || {}, N = new n.huinan.server.proto.MsgData();
N.hwRequestDoAction = new n.huinan.server.proto.HWRequestDoAction();
N.hwRequestDoAction.seatIndex = this.model.getSelfSeat();
N.hwRequestDoAction.actType = t;
N.hwRequestDoAction.cards = E.cards;
N.hwRequestDoAction.addToId = E.addToId;
N.hwRequestDoAction.destCard = E.destCard;
N.hwRequestDoAction.colType = E.colType;
cc.mm.server.send(N, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
}
this.views.ntfOperate.active = !1;
},
onClickTipGuo: function() {
this.views.sureTip.active = !1;
this.views.ntfOperate.active = !0;
},
onClickTipHu: function() {
var e = n.huinan.server.proto.ENActionType.EN_ACTION_GUO, t = new n.huinan.server.proto.MsgData();
t.hwRequestDoAction = new n.huinan.server.proto.HWRequestDoAction();
t.hwRequestDoAction.seatIndex = this.model.getSelfSeat();
t.hwRequestDoAction.actType = e;
t.hwRequestDoAction.destCard = this.operatorList[e].destCard;
cc.mm.server.send(t, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
this.views.sureTip.active = !1;
this.views.ntfOperate.active = !1;
},
_ntfOperatorChi: function(e, t) {
this.select_num = 1;
this.in_card = t.destCard;
if (t.colInfo.length > 1) {
for (var i = [], s = 0; s < t.colInfo.length; s++) i.push(t.colInfo[s].cards[1]);
this._showSelectCards(t, i);
this.views["select/gy_word3"].active = !0;
} else {
var a = t.colInfo[0], o = new n.huinan.server.proto.MsgData();
o.hwRequestDoAction = new n.huinan.server.proto.HWRequestDoAction();
o.hwRequestDoAction.seatIndex = this.model.getSelfSeat();
o.hwRequestDoAction.actType = e;
o.hwRequestDoAction.colType = a.colType;
o.hwRequestDoAction.destCard = a.destCard;
o.hwRequestDoAction.addToId = a.addToId;
o.hwRequestDoAction.cards = a.cards;
cc.mm.server.send(o, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
}
},
_ntfOperatorGang: function(e, t) {
this._dealSelectLogic(e, t);
},
_ntfOperatorTou: function(e, t) {
console.log(t);
this._dealSelectLogic(e, t);
},
_ntfOperatorPeng: function(e, t) {
this._dealSelectLogic(e, t);
},
getCardNum: function(e, t) {
t.colType === n.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_BA ? this.select_num = 1 : t.colType === n.huinan.server.proto.ENColType.EN_COL_TYPE_PENG ? this.select_num = 2 : t.colType === n.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_MING ? this.select_num = 3 : t.colType === n.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_AN ? this.select_num = 4 : t.colType === n.huinan.server.proto.ENColType.EN_COL_TYPE_TOU ? this.select_num = 3 : t.colType === n.huinan.server.proto.ENColType.EN_COL_TYPE_CHI ? this.select_num = 2 : t.colType === n.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_WAN ? this.select_num = 4 : t.colType === n.huinan.server.proto.ENColType.EN_COL_TYPE_TOU_MO && (this.select_num = 2);
},
getAb: function(e) {
var t = n.huinan.server.proto.ENAreaType;
return e == t.EN_AREA_TYPE_PKDDS_AB || e == t.EN_AREA_TYPE_PKDDS_ABXJ || e == t.EN_AREA_TYPE_PKDDS_ABMEK || e == t.EN_AREA_TYPE_PKDDS_ABJC || e == t.EN_AREA_TYPE_PKDDS_ABWC || e == t.EN_AREA_TYPE_PKDDS_ABMX;
},
isTouThree: function(e) {
for (var t = 0; t < e.length; t++) {
if (1002 == e[t] || 1001 == e[t] || 1003 == e[t]) return !1;
if (7 == cc.mm.gamefunc.getCardValue(e[t])) return !1;
}
return !0;
},
_dealSelectLogic: function(e, t) {
var i = n.huinan.server.proto.ENActionType, s = n.huinan.server.proto.ENColType;
if (1 === t.colInfo.length) {
var a = t.colInfo[0];
this.in_card = a.destCard || 0;
var o = [];
this.getCardNum(e, a);
var c = (a.colType === s.EN_COL_TYPE_GANG_MING || a.colType === s.EN_COL_TYPE_GANG_WAN || a.colType === s.EN_COL_TYPE_GANG_KOU || a.colType === s.EN_COL_TYPE_GANG_BA || a.colType === s.EN_COL_TYPE_GANG_KOU_BA) && this.select_num == a.cards.length;
if (a.addToId || t.isColAllCard || c) this.select_num = a.cards.length; else {
a.isChoice && (this.select_num = 1);
a.colType == n.huinan.server.proto.ENColType.EN_COL_TYPE_TOU && 1 == a.cards.length && (this.select_num = 1);
a.isChoice || !this.getAb(this.model.areaType) || this.isTouThree(a.cards) || (this.select_num = a.cards.length);
if (1 !== a.cards.length) {
var h = cc.mm.gamefunc.getCardValue(a.destCard);
1003 != a.destCard || this.model.areaType != r.EN_AREA_TYPE_PKDDS_YHGY || this.model.yifupai || (h = 10);
o = this.model.areaType == r.EN_AREA_TYPE_PKDDS_YBJL_TY || this.model.areaType == r.EN_AREA_TYPE_PKDDS_LSLB || this.model.areaType == r.EN_AREA_TYPE_PKDDS_ZTYJ || this.model.areaType == r.EN_AREA_TYPE_PKDDS_LSYX && cc.mm.hallserver.mLastRoomParam.wangToTingyong ? a.cards : this.model.getSelf().selectSomeValue(h, this.model.areaType, this.model.yifupai);
if (a.cards.length != o.length && this.model.areaType == r.EN_AREA_TYPE_PKDDS_ZTYJ) {
for (var m = 0, d = 0; d < o.length; d++) o[d] > 1e3 && m++;
m > 2 && (o = a.cards);
}
0 === this.select_num && (o.length = 0);
}
}
if (a.cards.length === this.select_num) {
this.views.select.active = !1;
var l = new n.huinan.server.proto.MsgData();
l.hwRequestDoAction = new n.huinan.server.proto.HWRequestDoAction();
l.hwRequestDoAction.seatIndex = this.model.getSelfSeat();
l.hwRequestDoAction.actType = e;
l.hwRequestDoAction.colType = a.colType;
l.hwRequestDoAction.destCard = a.destCard;
l.hwRequestDoAction.addToId = a.addToId;
l.hwRequestDoAction.cards = a.cards;
l.hwRequestDoAction.destCardChange = a.destCardChange;
a.showType && (l.hwRequestDoAction.showType = a.showType);
cc.mm.server.send(l, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
} else {
this._showSelectCards(t.colInfo[0], o);
this.views["select/gy_word3"].active = !0;
}
} else {
for (var _ = [], u = [], p = 0; p < t.colInfo.length; p++) {
var g = cc.js.array.copy(t.colInfo[p].cards);
if (t.colInfo[p].destCardChange > 0) {
g.push(t.colInfo[p].destCardChange);
cc.js.array.remove(g, 1003);
}
var f = this.getAb(this.model.areaType) && e == i.EN_ACTION_TOU && !this.isTouThree(g);
if (!t.colInfo[p].addToId || f) _.push(g); else {
var v = this.model.players[t.colInfo[p].seatIndex].showSeat, E = this.players[v].getAddToIDCards(t.colInfo[p].addToId);
E.push(t.colInfo[p].destCard);
_.push(E);
}
u.push({
colInfo: [ t.colInfo[p] ]
});
}
this._showFristCards(_, u, e);
}
},
_showFristCards: function(e, t, i) {
this.views.select.active = !0;
this.views["select/cards"].removeAllChildren(!0);
for (var s = n.huinan.server.proto.ENColType, a = n.huinan.server.proto.ENActionType, r = 0; r < e.length; r++) {
var c, h, m = e[r], d = new cc.Node();
d.anchorX = 0;
d.addComponent(cc.Button);
var l = !1;
if (i == a.EN_ACTION_GANG && t[r] && Array.isArray(t[r].colInfo)) for (var _ = 0; _ < t[r].colInfo.length; _++) t[r].colInfo[_].colType == s.EN_COL_TYPE_GANG_BA && (l = !0);
for (var u = 0; u < m.length; u++) {
var p = o.getCard(m[u]), g = new cc.Node(m[u]);
g.anchorX = 0;
g.parent = d;
var f = g.addComponent(cc.Sprite);
f.sizeMode = cc.Sprite.SizeMode.CUSTOM;
g.width = 75;
g.height = 100;
f.spriteFrame = p;
g.x = 30 * u + 1;
g.y = -1;
d.width = g.x + 100;
u < 3 && l && m.length > 3 && (g.color = cc.color(120, 120, 120));
}
d.children.length > 1 && (d.width -= 20);
d.data = t[r];
d.parent = this.views["select/cards"];
d.groupIndex = i;
d.height = 100;
cc.mm.uitools.addBtnLister(d, this.onClickFristBtn.bind(this), this);
if ((!Array.isArray(t[r].colInfo) || !(null == (c = t[r]) ? void 0 : null == (h = c.colInfo[0]) ? void 0 : h.addToId)) && (i == a.EN_ACTION_GANG && m.length > 4 || i == a.EN_ACTION_TOU && m.length > 3)) {
var v = new cc.Node();
v.anchorX = 0;
var E = v.addComponent(cc.Sprite);
E.type = cc.Sprite.Type.SLICED;
E.sizeMode = cc.Sprite.SizeMode.CUSTOM;
v.width = d.width + 18;
v.height = d.height;
E.spriteFrame = cc.mm.dss.resmap.get("doushisi-game-tishi-pick-" + (i == a.EN_ACTION_GANG ? 4 : 3));
d.addChild(v);
}
}
this.views["select/cards"].getComponent(cc.Layout).updateLayout();
this.views.select.width = Math.max(400, this.views["select/cards"].width);
this.views["select/actionBtn_tui"].getComponent(cc.Widget).updateAlignment();
this.views["select/gy_word3"].active = !0;
},
onClickFristBtn: function(e) {
var t = e.node.groupIndex, i = e.node.data;
this.views["select/cards"].removeAllChildren(!0);
this._dealSelectLogic(t, i);
},
_showSelectCards: function(e, t) {
this.views.select.active = !0;
this.views["select/cards"].removeAllChildren(!0);
for (var i = 0; i < t.length; i++) {
var s = o.getCard(t[i]), a = new cc.Node(t[i]);
a.anchorX = 0;
a.parent = this.views["select/cards"];
a.addComponent(cc.Button);
var n = a.addComponent(cc.Sprite);
n.sizeMode = cc.Sprite.SizeMode.CUSTOM;
a.width = 75;
a.height = 100;
n.spriteFrame = s;
a.data = e.colInfo && e.colInfo.length ? e.colInfo[i] : e;
cc.mm.uitools.addBtnLister(a, this.onClickCardBtn.bind(this), this);
}
this.selectNodes.length = 0;
this.views["select/cards"].getComponent(cc.Layout).updateLayout();
this.views.select.width = Math.max(400, this.views["select/cards"].width);
this.views["select/actionBtn_tui"].getComponent(cc.Widget).updateAlignment();
},
onClickLastOperator: function() {
this.views["select/cards"].removeAllChildren(!0);
this.views.select.active = !1;
this.views.ntfOperate.active = !0;
this.views.sureTip.active = !1;
},
onClickCardBtn: function(e) {
var t = this.selectNodes.indexOf(e.node);
if (t >= 0) {
e.node.removeAllChildren(!0);
this.selectNodes.splice(t, 1);
} else {
cc.assetManager.getBundle(cc.mm.config.dss).load("res/images/dss_res_gou", cc.SpriteFrame, function(t, i) {
var s = cc.mm.uitools.createSprite(i, e.node);
s.x = e.node.width / 2;
s.y = -16;
});
this.selectNodes.push(e.node);
}
if (this.select_num === this.selectNodes.length) {
for (var i = 0; i < this.selectNodes.length; i++) this.selectCards.push(parseInt(this.selectNodes[i].name));
var s = e.node.data, a = new n.huinan.server.proto.MsgData();
a.hwRequestDoAction = new n.huinan.server.proto.HWRequestDoAction();
a.hwRequestDoAction.seatIndex = this.model.getSelfSeat();
a.hwRequestDoAction.actType = s.actType;
a.hwRequestDoAction.colType = s.colType;
a.hwRequestDoAction.destCard = s.destCard;
a.hwRequestDoAction.addToId = s.addToId;
a.hwRequestDoAction.destCardChange = s.destCardChange;
s.showType && (a.hwRequestDoAction.showType = s.showType);
var o = s.colType == n.huinan.server.proto.ENColType.EN_COL_TYPE_CHI || s.colType == n.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_WAN;
a.hwRequestDoAction.cards = o ? s.cards : this.selectCards;
cc.mm.server.send(a, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
this.selectNodes.length = 0;
this.restOperator();
}
},
restOperator: function() {
this.op_type = 0;
this.select_num = 0;
this.selectCards = [];
this.views["select/gy_word3"].active = !1;
this.views["select/cards"].removeAllChildren(!0);
this.views.select.active = !1;
},
_moveEffect: function(e, t, i) {
var s = this, effectModel = this.model, effectSource = this.players[e], effectTarget = this.players[t], sourceModel = effectSource && effectSource._model, targetModel = effectTarget && effectTarget._model;
function effectIsCurrent() { return cc.isValid(s.node, true) && s.model === effectModel && cc.isValid(effectSource, true) && cc.isValid(effectTarget, true) && s.players[e] === effectSource && s.players[t] === effectTarget && effectSource._model === sourceModel && effectTarget._model === targetModel; }
cc.loader.loadRes("prefab/com_prop_" + i, cc.Prefab, function(a, n) {
if (a || !n || !effectIsCurrent()) return;
var r = cc.instantiate(n);
r.setPosition(s.views["palyers/pos" + e].getPosition());
s.node.addChild(r);
o.playMagicFace(i);
var c = r.getComponent(sp.Skeleton);
r.runAction(cc.sequence(cc.moveTo(.5, s.views["palyers/pos" + t].getPosition()), cc.callFunc(function() {
if (!cc.isValid(r, true)) return;
if (!effectIsCurrent()) { r.removeFromParent(!0); r.destroy(); return; }
c.setAnimation(1, "animation", !1);
})));
c.setCompleteListener(function() {
if (!cc.isValid(r, true)) return;
r.removeFromParent(!0);
r.destroy();
});
});
},
getLeft: function(e) {
for (var t = 0, i = 0; i < 4; i++) if (cc.isValid(this.players[i])) {
var s, a, o = this.players[i].mCards;
for (var n in o) Array.isArray(o[n]) && e == n && (t += o[n].length);
(null == (s = this.players[i]) ? void 0 : null == (a = s._model) ? void 0 : a.huCard) == e && (t += 1);
}
for (var r = this.model.getSelf(), c = 0; c < r.hand_cards.length; c++) e == r.hand_cards[c] && t++;
for (var h = 0; h < r.protectCards.length; h++) e == r.protectCards[h] && t++;
return t;
},
onClickHutip: function() {
if (this.mTips) {
this.refreshCardLeft();
this.views.operate.getComponent("dss_selectController").addTipFan(null, this.mTips);
}
},
onHideHuTip: function() {
this.node.getChildByName("tip").active = !1;
},
_ntfResponseJiaoPai: function(e) {
this.mTips = e.huInfo;
this.views.hutip.active = this.mTips.length;
this.views.hutip.active && this.refreshCardLeft();
},
_noticeChangeTipBtn: function(e) {
this.mTips = e;
this.views.hutip.active = null != e;
this.views.hutip.active && this.refreshCardLeft();
},
refreshCardLeft: function() {
if (this.views.hutip.active) {
var e = 0, t = [];
for (var i in this.mTips) {
var s = this.mTips[i].huCard;
this.mTips[i].num - this.getLeft(s) && t.push(this.mTips[i]);
}
for (var a in t) e += t[a].num;
this.views["hutip/label"].getComponent(cc.Label).string = e;
}
},
onClickLeave: function() {
this.model.onChangeTable(1);
this.views.LeaveBtn.active = !1;
this.views.changeBtn.active = !1;
},
onClickChangeDesk: function() {
this.model.onChangeTable(2);
this.views.LeaveBtn.active = !1;
this.views.changeBtn.active = !1;
},
_noticeWin: function() {
if (cc.mm.gameserver.room_data.roomType != n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND && cc.mm.gameserver.getTable().areaType == r.EN_AREA_TYPE_PKDDS_YAH20_XZ) {
this.views.LeaveBtn.active = !0;
this.views.changeBtn.active = !0;
}
},
_noticeHideChangeBtn: function() {
this.views.LeaveBtn.active = !1;
this.views.changeBtn.active = !1;
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0,
dss_evenType: "dss_evenType",
dss_gameModel: "dss_gameModel",
dss_tools: "dss_tools"
} ],
dss_gameModel: [ function(e, t) {
"use strict";
cc._RF.push(t, "6af3a+XQpRGyaWPOuWLLVSy", "dss_gameModel");
var i, s = e("BaseModel"), a = e("dss_playerModel"), o = e("../../../../Frame/src/buff/hw_msg").com, n = e("dss_evenType");
cc.Class(((i = {
extends: s,
onInit: function() {
this.all_count = 0;
this.cur_count = 0;
this.roomId = 0;
this.playerNum = 0;
this.room_name = "";
this.roomType = 0;
this.game_rule = {};
this.state = 0;
this.operate = 0;
this.selfSeat = -1;
this.banker = 0;
this.players = {};
this.left_card_num = 0;
this.creatorUid = "";
this.gameNum = 0;
this.numofgames = 0;
this.amuse = 0;
this.dealer = 0;
this.bigRoomName = "";
this.areaType = 0;
this.notChu_10 = !1;
this.isInGame = !1;
this.xiaoSeat = -1;
this.isStart = !1;
this.tableInfo = null;
this.tipsCards = {};
this.location = [];
},
onEvent: function() {
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyScoreChangeTimely, this._noticeChangeTimely.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyLogoutTable, this.onLeaveRoom.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseEnterTableFinish, this.onTableInfo.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNottifyEnterTable, this.onJoinRoom.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyGameStart, this.onChangeDissolve.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseLogoutTable, this.onResponseLogout.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseChangeTable, this.onReponseChangeTable.bind(this), this);
cc.mm.notification.on("NOTICE_SHOW_GAME_RULE", this.showRule.bind(this), this);
cc.mm.uimanager.getWindow("dss_game").node.opacity = 0;
},
_noticeChangeTimely: function(e) {
for (var t = 0; t < e.scoreList.length; t++) this.players[e.scoreList[t].seatIndex] && this.players[e.scoreList[t].seatIndex].notification.emit(n.DSS_SCORE_CHANGE, e.scoreList[t]);
},
showRule: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonPlayUI", this);
},
onResponseLogout: function(e) {
if (1033 == e.result) cc.mm.uimanager.showTextPrompt("游戏正在进行中，不能退出"); else if (1031 == e.result || 1032 == e.result) {
cc.mm.gameserver.clear();
cc.mm.assets.loadBoot(cc.mm.config.hall, cc.mm.config.hallboot, function(e) {
cc.mm.framemodel.curgameid = 9999;
cc.mm.uimanager.showWindow(cc.mm.config.hall, e, {}, !0);
});
cc.log("异常退出房间");
}
},
onChangeDissolve: function(e) {
if (e.cardInfo) {
var t = e.cardInfo;
for (var i in t) this.tipsCards[t[i].cardValue] = t[i].num;
}
this.isStart = !0;
this.numofgames = e.round;
this.left_card_num = e.leftTileNum;
this.dealer = e.dealer;
cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_LEFT_CARD, e);
cc.mm.uimanager.closewindow("MarryUI");
cc.mm.uimanager.getWindow("dss_game").node.opacity = 255;
},
clearData: function() {
for (var e = 1; e <= 4; e++) this.players[e] && this.onExitRoom({
seatIndex: this.players[e].seatIndex
});
this.dealer = -1;
this.operate = -1;
this.isInGame = !1;
this.tipsCards = {};
},
getSelfSeat: function() {
if (this.selfSeat >= 0) return this.selfSeat;
for (var e in this.players) if (this.players[e] && this.players[e].uid == model.uid) {
this.selfSeat = e;
return e;
}
return 0;
},
isCanExit: function() {
return Object.keys(this.players).length <= 0;
},
getState: function() {
var e = this.numofgames > 1 || this.isStart;
for (var t in this.players) if (-1 != this.players[t].piaoStatus) {
e = !0;
break;
}
return e;
},
getValidPlayer: function() {
for (var e = 0, t = 1; t <= 4; t++) this.players[t] && e++;
return e;
},
_ntfCommonGamePush: function(e) {
console.log(e);
this.state = e.body.state;
this.numofgames = e.body.numofgames;
this.zhuang = e.body.zhuang;
},
_ntfCommonMsg: function(e) {
var t = {};
t.seat_index = e.seatIndex;
t.showSeat = this.players[e.seatIndex].showSeat;
t.face = e.body.face;
t.text = e.body.text;
t.cmd = e.cmd;
t.src = e.body.src ? this.players[e.body.src].showSeat : null;
t.target = e.body.target ? this.players[e.body.target].showSeat : null;
t.item = e.body.item;
cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_COMMON_MSG, t);
},
onTableInfo: function(e) {
console.log("进入房间");
if (e.tableInfo) {
e.showPipeiPic ? cc.mm.uimanager.showWindow(cc.mm.config.resources, cc.mm.dss.resmap.get("MarryUI"), {
cd: e.pipeiCd,
roomId: e.tableInfo.roomId
}) : cc.mm.uimanager.getWindow("dss_game").node.opacity = 255;
cc.mm.gameserver.shiName = e.shiName || cc.mm.framemodel.shiName;
cc.mm.gameserver.xianName = e.xianName || cc.mm.framemodel.xianName;
this.areaType = e.tableInfo.areaType;
cc.mm.notification.emit(cc.mm.frametype.NTF_CLEAR_ROOM);
cc.mm.notification.emit("NOTICE_GAME_HU_TIP", null);
this.tableInfo = e.tableInfo;
this.location = e.location;
this.isInGame = !0;
var t = e;
this.onParse(t.tableInfo);
this.state = t.tableState || 0;
this.numofgames = t.round;
this.left_card_num = t.leftCardNum;
this.isStart = 1 == t.tableState;
if (t.next) {
this.left_card_num = t.next.leftCardNum;
this.operate = t.next.seatIndex;
}
this.selfSeat = t.seatIndex;
cc.mm.hallserver.mLastRoomParam = t.tableInfo;
if (t.gameStart && t.gameStart.cardInfo) {
var i = t.gameStart.cardInfo;
for (var s in i) this.tipsCards[i[s].cardValue] = i[s].num;
}
for (var a = 0; a < t.userInfo.length; a++) {
var n = null;
if (t.gameStart) {
this.dealer = t.gameStart.dealer;
this.xiaoSeat = t.gameStart.xiaoSeat;
this.left_card_num = t.gameStart.leftTileNum;
n = t.gameStart.seats[a];
if (t.userInfo[a].seatIndex == t.seatIndex && n.auto) {
var r = new o.huinan.server.proto.MsgData();
r.hwRequestCancelAuto = new o.huinan.server.proto.HWRequestCancelAuto();
cc.mm.server.send(r, cc.mm.msgEvent.HWRequestCancelAuto, cc.mm.framemodel.uid);
}
this.isStart = !0;
}
this.onJoinRoom({
pbseat: n,
userInfo: t.userInfo[a]
});
}
cc.mm.gameserver.isReplay() && t.gameStart && this.onChangeDissolve(t.gameStart);
this.xiaoSeat = -1;
t.gameOver && cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyGameOver, t.gameOver, cc.mm.msgEvent.HWNotifyGameOver);
t.dissolveInfos && cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyDissolveTableOperation, t.dissolveInfos, cc.mm.msgEvent.HWNotifyDissolveTableOperation);
t.choice && cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifySeatOperationChoice, t.choice, cc.mm.msgEvent.HWNotifySeatOperationChoice);
t.deal && !t.deal.isShangShou && cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyPlayerDealCard, t.deal, cc.mm.msgEvent.HWNotifyPlayerDealCard);
t.location && cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyLocation, t.location);
t.stopAddGold && cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyAddGold, t.stopAddGold);
cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_UPDATEROOM, this);
} else cc.mm.assets.loadBoot(cc.mm.config.hall, cc.mm.config.hallboot, function(e) {
cc.mm.framemodel.curgameid = 9999;
cc.mm.uimanager.showWindow(cc.mm.config.hall, e, {}, !0);
});
},
getSelf: function() {
return this.players[this.getSelfSeat()];
},
onJoinRoom: function(e) {
if (this.isInGame) {
var t, i = e.userInfo;
if (!this.players[i.seatIndex] && this.getSelfSeat() > -1) {
var s = new a();
s.onParse(i);
s.setBanker(this.banker === i.seatIndex);
s.setShowIdx(this.playerNum, this.getSelfSeat());
s.fangzhu = s.uid == this.creatorUid;
s.isDealer = this.dealer == i.seatIndex;
s.isOperator = this.operate == i.seatIndex;
s.piaoStatus = i.piaoNum;
s.notChu_10 = this.notChu_10;
s.xiaoSeat = i.seatIndex == this.xiaoSeat;
s.gameModel = this;
if (e.pbseat) {
s.isReady = !1;
s.onParseCards(e.pbseat);
if (s.isSelf() && (s.jiaopai || s.baoTing)) {
var n = new o.huinan.server.proto.MsgData();
n.hwRequestJiaoTishi = new o.huinan.server.proto.HWRequestJiaoTishi();
cc.mm.server.send(n, cc.mm.msgEvent.HWRequestJiaoTishi, cc.mm.framemodel.uid);
}
}
this.players[s.seatIndex] = s;
cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_JOINGAME, s);
}
cc.mm.notification.emit("game_refresh_player_num", Object.keys(this.players).length < this.tableInfo.playerNum, null == (t = this.getPlayerByUid(cc.mm.framemodel.uid)) ? void 0 : t.isReady);
}
},
onExitRoom: function(e) {
var t;
if (this.isInGame && this.players[e.seatIndex]) {
cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_EXITGAME, this.players[e.seatIndex]);
delete this.players[e.seatIndex];
}
cc.mm.notification.emit("game_refresh_player_num", Object.keys(this.players).length < this.tableInfo.playerNum, null == (t = this.getPlayerByUid(cc.mm.framemodel.uid)) ? void 0 : t.isReady);
}
}).isCanExit = function() {
return Object.keys(this.players).length <= 0;
}, i.getPlayerByUid = function(e) {
for (var t in this.players) if (e == this.players[t].uid) return this.players[t];
return null;
}, i.onLeaveRoom = function(e) {
if (e.seatIndex === this.getSelfSeat()) {
delete this.players[e.seatIndex];
cc.mm.assets.loadBoot(cc.mm.config.hall, cc.mm.config.hallboot, function(e) {
cc.mm.framemodel.curgameid = 9999;
cc.mm.uimanager.showWindow(cc.mm.config.hall, e, {}, !0);
});
} else this.onExitRoom(e);
}, i.onReponseChangeTable = function(e) {
if (2 == e.seatType) {
cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyNextOperation, {
leftCardNum: 0
});
cc.mm.notification.emit(cc.mm.frametype.NTF_CLEAR_ROOM);
cc.mm.hallserver.requestJoinAmuse(cc.mm.gameserver.getTable().roomType, cc.mm.gameserver.getTable().areaType, cc.mm.hallserver.mLastRoomParam.yifupai);
cc.mm.notification.emit("clear_point_left_card", !1);
} else {
this.clearData();
cc.mm.gameserver.clear();
cc.mm.assets.loadBoot(cc.mm.config.hall, cc.mm.config.hallboot, function(e) {
cc.mm.framemodel.curgameid = 9999;
cc.mm.uimanager.showWindow(cc.mm.config.hall, e, {}, !0);
});
}
}, i.onChangeTable = function(e) {
var t = new o.huinan.server.proto.MsgData();
t.hwRequestChangeTable = new o.huinan.server.proto.HWRequestChangeTable();
t.hwRequestChangeTable.seatType = e;
cc.mm.server.send(t, cc.mm.msgEvent.HWRequestChangeTable, cc.mm.framemodel.uid);
}, i));
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
BaseModel: void 0,
dss_evenType: "dss_evenType",
dss_playerModel: "dss_playerModel"
} ],
dss_playerController: [ function(e, t) {
"use strict";
cc._RF.push(t, "2c01cynfXVJC6FZNk210GF3", "dss_playerController");
function i(e, t) {
var i = "undefined" != typeof Symbol && e[Symbol.iterator] || e["@@iterator"];
if (i) return (i = i.call(e)).next.bind(i);
if (Array.isArray(e) || (i = s(e)) || t && e && "number" == typeof e.length) {
i && (e = i);
var a = 0;
return function() {
return a >= e.length ? {
done: !0
} : {
done: !1,
value: e[a++]
};
};
}
throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function s(e, t) {
if (e) {
if ("string" == typeof e) return a(e, t);
var i = Object.prototype.toString.call(e).slice(8, -1);
"Object" === i && e.constructor && (i = e.constructor.name);
return "Map" === i || "Set" === i ? Array.from(e) : "Arguments" === i || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(i) ? a(e, t) : void 0;
}
}
function a(e, t) {
(null == t || t > e.length) && (t = e.length);
for (var i = 0, s = new Array(t); i < t; i++) s[i] = e[i];
return s;
}
var o = e("UIController"), n = e("dss_evenType"), r = e("dss_tools"), c = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: o,
properties: {
huSpriteFrames: {
default: [],
type: [ cc.SpriteFrame ]
},
dirSpriteFrames: {
default: [],
type: [ cc.SpriteFrame ]
},
typeSpriteFrames: {
default: [],
type: [ cc.SpriteFrame ]
},
winFont: {
default: null,
type: cc.Font
},
loseFont: {
default: null,
type: cc.Font
},
jiafenSpine: {
default: null,
type: sp.SkeletonData
},
jianfenSpine: {
default: null,
type: sp.SkeletonData
}
},
onLoad: function() {
this._super();
this._model = null;
this.foldNode = null;
this.deskNode = null;
this.readyState = null;
this.openCardNode = null;
this.handNode = null;
this.handNodebg = null;
this.foldFlag = null;
this.isFlag = !1;
this.op_cards = {};
this.opreators = [];
this.mCards = {};
this.mNumCards = {};
this.mHuEffect = null;
this.isOutCard = !1;
this.isLaunchAct = !1;
this.hasCards = null;
this.huNode = null;
this.supplement = null;
this.giveUp = null;
this._shopCd = 0;
this._shopShowTime = !1;
this.scoreEffect = null;
var e = this.node.getChildByName("face").getComponent(sp.Skeleton);
e.setCompleteListener(this._spineComplete.bind(this, e));
},
_spineComplete: function(e) {
e.node.active = !1;
},
setModel: function(e) {
this._model = e;
this._model.notification.on(cc.mm.msgEvent.HWNotifyReadyForGame, this._ntfReady.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWNotifyGameStart, this._ntfDealCards.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWNotifySeatOperationChoice, this._ntfPlayCard.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWNotifyActionFlow, this._ntfActionFlow.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWNotifyNextOperation, this._ntfChangeOpreate.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWNotifyPlayerDealCard, this._ntfOpenCard.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWNotifyGameOver, this._ntfWinner.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWResponseAuto, this._ntfTrust.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWResponseCancelAuto, this._ntfCancelTrust.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWNotifyIsOnline, this._onLine.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWNotifyAuto, this._ntfTrust.bind(this), this);
this._model.notification.on(cc.mm.msgEvent.HWNotifyPiao, this._ntfPiao.bind(this), this);
this._model.notification.on(n.DSS_SCORE_CHANGE, this._noticeScoreChange, this);
this._model.notification.on("CMD_ACTION_RES_" + cc.mm.frametype.CMD_ACTION_UPDATE_PLAYER, this._ntfUpdatePlayer.bind(this), this);
this._model.notification.on("CMD_ACTION_RES_" + cc.mm.frametype.CMD_ACTION_UPDATE_POINT, this._ntfUpdatePoints.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_CLEAR_PLAYER, this._ntfClearView.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyAddGold, this._noticeAddGold, this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyUserDataChange, this._noticeUserDataChange, this);
this._ntfReady();
this.stopAllActions();
},
_noticeScoreChange: function(e) {
var t = this;
this.scoreEffect.removeAllChildren(!0);
if (cc.mm.gameserver.room_data.roomType == c.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND) {
this._model.roundBeanDelta = window.Standalone.addAmount(this._model.roundBeanDelta || "0", e.scoreChange);
}
this.node.runAction(cc.sequence(cc.delayTime(1), cc.callFunc(function() {
var i = t.scoreEffect.getComponent(sp.Skeleton);
i.skeletonData = e.scoreChange >= 0 ? t.jiafenSpine : t.jianfenSpine;
i.setAnimation(0, 1 == t._model.showSeat || 4 == t._model.showSeat ? "zuo" : "you", !1);
var s = new cc.Node();
s.y = 20;
s.x = 1 == t._model.showSeat || 4 == t._model.showSeat ? -100 : 100;
s.addComponent(cc.Label); /* Bean change text is rendered after font and bounds are configured. */
s.getComponent(cc.Label).font = e.scoreChange > 0 ? t.winFont : t.loseFont;
s.getComponent(cc.Label).fontSize = 30;
s.getComponent(cc.Label).lineHeight = 40;
s.setContentSize(200, 50);
window.Standalone.beanAmountLabel(s, e.scoreChange, true);
t.scoreEffect.addChild(s);
s.runAction(cc.sequence(cc.moveTo(.5, cc.v2(0, 20)), cc.fadeOut(1.5), cc.removeSelf(!0)));
})));
},
_noticeUserDataChange: function(e) {
if (this._model && e.uid == this._model.uid) {
this._model.score = e.goldNum;
this.updateScore();
this._shopShowTime = !1;
} else if (e.uid == cc.mm.framemodel.uid) {
window.Standalone.scoreLabel(this.views["scoreNode/label"], e.goldNum);
this._shopShowTime = !1;
}
},
_noticeAddGold: function(e) {
for (var t = this, i = [], s = [], a = 0; a < e.addGoldList.length; a++) 0 == e.addGoldList[a].type ? i.push(e.addGoldList[a].seatIndex) : 2 == e.addGoldList[a].type && s.push(e.addGoldList[a].seatIndex);
this.supplement.active = i.includes(this._model.seatIndex);
this.giveUp.active = s.includes(this._model.seatIndex);
if (!this._shopShowTime) {
this._shopCd = e.cd;
this.supplement.getChildByName("label").getComponent(cc.Label).string = this._shopCd + "s";
this.supplement.runAction(cc.repeat(cc.sequence(cc.delayTime(1), cc.callFunc(function() {
t._shopCd--;
cc.isValid(t.supplement, !0) && (t.supplement.getChildByName("label").getComponent(cc.Label).string = t._shopCd + "s");
})), this._shopCd));
}
this._shopShowTime = this.supplement.active;
if (this._model.isSelf() && i.includes(this._model.seatIndex)) for (var o = 0; o < e.addGoldList.length; o++) if (0 == e.addGoldList[o].type && this._model.seatIndex == e.addGoldList[o].seatIndex) {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "SupplementUI", !0);
break;
}
},
destroyModel: function() {
this.stopAllActions();
this.handNodebg && (this.handNodebg.active = !1);
this.readyState.active = this._model.isReady;
this.views.xiaojiaFlag.active = !1;
cc.mm.notification.emit(n.DSS_ACTION_REMOVE_CARD);
this.op_cards = {};
this.mCards = {};
this.mNumCards = {};
this.isOutCard = !1;
this.isLaunchAct = !1;
this.opreators.length = 0;
this.giveUp.active = !1;
this.huNode && (this.huNode.active = !1);
cc.mm.notification.targetOff(this);
this._model.destroy();
},
stopAllActions: function() {
this.foldNode.removeAllChildren(!0);
this.deskNode.removeAllChildren(!0);
this.openCardNode.removeAllChildren(!0);
this.openCardNode.stopAllActions();
this.deskNode.stopAllActions();
this.foldNode.stopAllActions();
this.node.stopAllActions();
if (this.mHuEffect) {
this.mHuEffect.removeFromParent(!0);
this.mHuEffect.destroy();
this.mHuEffect = null;
}
},
_ntfClearView: function() {
this.isFlag = !1;
this.stopAllActions();
this.readyState.active = !1;
this.handNodebg && (this.handNodebg.active = !1);
this.views.headlight.active = !1;
this.views.effectNode.active = !1;
this.views.clock.active = !1;
this.views.clock.active = !1;
this._model.clearData();
this.views.poker.active = !1;
this.views.dss_zhuang.active = !1;
this.views["poker/label"].getComponent(cc.Label).string = 0;
this.huNode.active = !1;
this.huNode.getChildByName("card").getComponent(cc.Sprite).spriteFrame = null;
this.huNode.getChildByName("huOrder").getComponent(cc.Sprite).spriteFrame = null;
this.views.baoeffect.active = !1;
this.views["flags/bao"].active = !1;
this.views["flags/piao"].active = !1;
this.views["flags/dazhuang"].active = !1;
this.op_cards = {};
this.mCards = {};
this.mNumCards = {};
this.opreators.length = 0;
this.isOutCard = !1;
this.isLaunchAct = !1;
this._shopShowTime = !1;
this.giveUp.active = !1;
!this._model.isSelf() && this._ntfReady();
},
_ntfActionFlow: function(e) {
var t, i, s = e.action.actType, a = e.action.seatIndex === this._model.seatIndex;
switch (s) {
case c.huinan.server.proto.ENActionType.EN_ACTION_CHUPAI:
console.log("出牌");
var o = e.action.destCard;
this.isOutCard = !0;
!a && this.openCardNode.removeAllChildren(!0);
a && !this._model.isSelf() && this._openBigCard(o, !0);
if (a && this._model.isSelf() && (cc.mm.gameserver.isReplay() || this._model.auto)) {
this._model.auto && cc.mm.notification.emit("NOTICE_STATE_PLAY");
this._model.deathCard = [];
cc.mm.notification.emit(cc.mm.frametype.NTF_PLAY_BACK_OUT_CARD, o);
}
if (cc.mm.gameserver.isReplay() && !this._model.isSelf()) {
this._model.removeHands([ o ]);
this.showRemoveCards();
}
a || !this._model.isSelf() || cc.mm.gameserver.isReplay() || this._model.auto || cc.mm.notification.emit(n.DSS_ACTION_REMOVE_CARD);
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_UNKNOWN:
console.log("弃牌");
this.isOutCard = !0;
this._ntfFoldCard(e.action);
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_TOU:
console.log("偷牌");
if (a) {
this._model.protectCards = e.action.protectCard;
Array.isArray(e.action.protectCard) && e.action.protectCard.length && this._model.removeHands(e.action.useCard);
}
if (a && !this._model.isSelf()) {
var h = {
isFan: !1,
addToId: 100,
id: 100,
cards: this._model.protectCards
};
this._fixAddTo100(h);
}
this.isOutCard = !0;
e.action.colInfo.length ? this._ntfOperateCard(e.action.colInfo[0]) : a && this.showEffect(e.action);
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_CHI:
console.log("吃牌");
this.isOutCard = !0;
this._ntfOperateCard(e.action.colInfo[0]);
cc.mm.notification.emit(n.DSS_ACTION_REMOVE_CARD);
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_PENG:
console.log("碰牌");
this.isOutCard = !0;
this._ntfOperateCard(e.action.colInfo[0]);
cc.mm.notification.emit(n.DSS_ACTION_REMOVE_CARD);
a && cc.mm.notification.emit("DSS_GAME_EFFECT_PENG");
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_GANG:
console.log("杠牌");
this.isOutCard = !0;
if (a) {
var m = Array.isArray(this._model.protectCards) ? this._model.protectCards : [], d = Array.isArray(e.action.protectCard) ? e.action.protectCard : [];
cc.mm.gameserver.getTable().areaType == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YBJL_TY && e.action.colInfo.length && m.join("") != d.join("") && (e.action.colInfo[0].shuaxin = !0);
this._model.protectCards = e.action.protectCard;
Array.isArray(e.action.protectCard) && e.action.protectCard.length && e.action.protectCard.length && this._model.removeHands(e.action.useCard);
cc.mm.notification.emit("DSS_GAME_EFFECT_RAIN");
}
if (a && !this._model.isSelf()) {
var l = {
isFan: !1,
addToId: 100,
id: 100,
cards: this._model.protectCards
};
this._fixAddTo100(l);
}
e.action.colInfo.length ? this._ntfOperateCard(e.action.colInfo[0]) : a && this.showEffect(e.action);
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_BAO_TING:
console.log("听牌");
this._ntfBaoTip(e.action);
if (this._model.isSelf() && a) {
var _ = new c.huinan.server.proto.MsgData();
_.hwRequestJiaoTishi = new c.huinan.server.proto.HWRequestJiaoTishi();
cc.mm.server.send(_, cc.mm.msgEvent.HWRequestJiaoTishi, cc.mm.framemodel.uid);
}
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_HU:
console.log("胡牌");
this._ntfOperateCard(e.action);
this.views.clock.active = !1;
2 == (null == (t = cc.mm.hallserver.mLastRoomParam) ? void 0 : t.processType) && this.openCardNode.removeAllChildren(!0);
if (2 == (null == (i = cc.mm.hallserver.mLastRoomParam) ? void 0 : i.processType) && a) {
this._model.huCard = e.action.destCard;
this.showHuEffect();
var u = cc.mm.gameserver.getTable().areaType, p = [], g = u == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20 || u == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDPJ || u == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20_XZ || u == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDQL;
g && this._model.points >= 50 && p.push("hongwushi");
g && this._model.blackPoint >= 50 && p.push("heiwushi");
for (var f = 0; f < e.action.cardType.length; f++) p = this.addHuEffect(e.action.cardType[f], p, u);
p.length && cc.mm.notification.emit("DSS_REN_BLACK_RIVETY", p);
}
this._model.isSelf() && cc.mm.notification.emit(n.DSS_SHOW_HAND_CARDS, this._model, null);
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_HU_ZI_QIANG:
case c.huinan.server.proto.ENActionType.EN_ACTION_HU_QIANG:
console.log("胡牌");
this._ntfOperateCard(e.action);
this.views.clock.active = !1;
this._model.isSelf() && cc.mm.notification.emit(n.DSS_SHOW_HAND_CARDS, this._model, null);
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_KOU_FAN:
console.log("扣牌");
if (e.action.seatIndex > 0 && !a) break;
var v = e.action.colId, E = cc.mm.gameserver.getTable().areaType == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20 || cc.mm.gameserver.getTable().areaType == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20_XZ || cc.mm.gameserver.getTable().areaType == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDPJ || cc.mm.gameserver.getTable().areaType == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDQL;
for (var N in this.op_cards) if (cc.isValid(this.op_cards[N]) && (0 == v || v == parseInt(N))) {
if (E && 100 == parseInt(N)) continue;
for (var T = this.op_cards[N], A = 0; A < T.children.length; A++) {
if (T.children[A].name != T.children[A].data) {
T.children[A].getComponent(cc.Sprite).spriteFrame = r.getCard(T.children[A].data);
this.pushCardNode(T.children[A].data, T.children[A]);
}
T.children[A].color = cc.Color.WHITE;
}
}
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_DEAL:
cc.log("玩家摸牌 或者 翻牌");
e.action.dealCard && this._ntfOpenCard(e.action.dealCard);
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_DIAN_DENG:
if (this._model.isSelf() && a) {
var C = new c.huinan.server.proto.MsgData();
C.hwRequestJiaoTishi = new c.huinan.server.proto.HWRequestJiaoTishi();
cc.mm.server.send(C, cc.mm.msgEvent.HWRequestJiaoTishi, cc.mm.framemodel.uid);
}
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_DANG_ZHUANG:
console.log("当装");
if (a) {
this._model.isDaZhuang = e.action.dangZhuang;
this._model.isDealer = this._model.seatIndex == e.action.seatIndex;
this._model.isDealer && this.showZhuangAct();
}
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_KOU:
a && this._openBigCard(e.action.destCard, !1, !0);
a && this._model.removeHands([ e.action.destCard ]);
a && this.showRemoveCards();
a && this._model.isSelf() && cc.mm.notification.emit("NOTICE_STATE_PLAY");
break;

case c.huinan.server.proto.ENActionType.EN_ACTION_HUAN_CARD:
e.action.isProtect && a && (this._model.protectCards = e.action.protectCard);
this._actByHuan(e.action.colInfo[0], e.action.isProtect);
break;

default:
console.log("未知: " + s);
}
this._model.isSelf() && cc.mm.notification.emit(cc.mm.frametype.MSG_CLEAR_OPERATOR);
var y = cc.mm.gameserver.room_data.areaType == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZGRX || cc.mm.gameserver.room_data.areaType == c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YBXZ;
this._model.isSelf() && e.action.baoIndex == this._model.seatIndex && e.action.baoCard > 0 && y && cc.mm.notification.emit("DSS_YOU_CARD");
cc.mm.notification.emit(n.DSS_REFRESH_CARD_LEFT);
var S = c.huinan.server.proto.ENActionType;
if (![ S.EN_ACTION_CHUPAI, S.EN_ACTION_HU ].includes(s) && a && e.action.checkCardData && e.action.checkCardData.length) {
var D = JSON.parse(e.action.checkCardData);
this.hasCards = D[e.action.seatIndex];
if (this.foldNode._children.length != this.hasCards.ChuNoNum) {
cc.error("弃 出问题了");
cc.mm.server.closeServer();
return;
}
var P = 0, w = [];
for (var R in this.op_cards) if (100 != +R && !w.includes(this.op_cards[R])) {
P += this.op_cards[R]._children.length;
w.push(this.op_cards[R]);
}
if (P != this.hasCards.BaiNum) {
cc.error("操作 出问题了");
cc.mm.server.closeServer();
return;
}
if (this._model.isSelf() && this._model.hand_cards.length != this.hasCards.HoldNum) {
cc.error("自己 手牌 出问题了");
cc.mm.server.closeServer();
return;
}
if (!this._model.isSelf() && this._model.holdlen != this.hasCards.HoldNum) {
cc.error("手牌 出问题了");
cc.mm.server.closeServer();
return;
}
}
},
_actByHuan: function(e, t) {
if (this._model.seatIndex == e.seatIndex) {
if (!e.destCardIsOwn) {
this.openCardNode.removeAllChildren(!0);
this.openCardNode.stopAllActions();
}
e.destCardIsOwn && this._model.removeHands([ e.destCard ]);
var i = c.huinan.server.proto.ENActionType;
if (e.actType == i.EN_ACTION_GANG || e.actType == i.EN_ACTION_PENG) {
var s = e.huanCard[0];
this._model.pushCard(s);
this._model.pushCards.length = 0;
this._model.pushCards.push(s);
this._ntfDealCards(null);
if (t) {
var a = e.cards.length, o = this._getLastOpNode(100);
if (o) {
for (var n = a - 1; n >= 0; n--) o.children[n].removeFromParent(!0);
if (0 == o.children.length) {
cc.js.array.remove(this.opreators, o);
o.removeFromParent(!0);
o.destroy();
}
}
}
var h = this._model.isSelf() ? 100 : 0, m = this.openCardNode.convertToWorldSpaceAR(cc.v2(0, h)), d = this.deskNode.convertToNodeSpaceAR(m), l = this._addOpreateCard(e), _ = l.getPosition();
l.setScale(.5, .5);
l.data = _;
l.setPosition(d);
l.runAction(cc.sequence(cc.scaleTo(.15, 1.5, 1.5), cc.delayTime(.4), cc.spawn(cc.moveTo(.2, _), cc.scaleTo(.1, 1, 1))));
e.nowAct = i.EN_ACTION_HUAN_CARD;
this.showEffect(e);
return;
}
this._model.pushCard(e.cards[0]);
this._model.pushCards.length = 0;
this._model.pushCards.push(e.cards[0]);
this._ntfDealCards(null);
this.showEffect(e);
var u = this._getLastOpNode(e.addToId);
if (u) for (var p = 0; p < u.children.length; p++) if (e.cards.includes(u.children[p].data)) {
u.children[p].data = e.destCard;
u.children[p].getComponent(cc.Sprite).spriteFrame = r.getCard(e.destCard);
this.addTiFlag(u.children[p]);
return;
}
}
},
showZhuangAct: function() {
var e = this, t = this.views.dss_zhuang.parent.convertToWorldSpaceAR(this.views.dss_zhuang.getPosition());
cc.mm.notification.emit("DSS_SHOW_ZHUANG_SEAT", t, function() {
e.views.dss_zhuang.active = !0;
});
},
_fixAddTo100: function(e) {
var t = this._getLastOpNode(e.id);
if (Array.isArray(e.cards) && e.cards.length) {
t && t.removeAllChildren();
this._addOpreateCard(e);
} else if (t) {
delete this.op_cards[e.id];
cc.js.array.remove(this.opreators, t);
t.removeFromParent(!0);
t.destroy();
}
},
_ntfTrust: function() {
if (this._model.isSelf()) {
this.views.head_ytg.active = !0;
cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_SHOWTG, !0);
}
},
_ntfPiao: function() {
var e = this.views["flags/piao"].active;
this.views["flags/piao"].active = this._model.piaoStatus >= 1;
if (!e && this.views["flags/piao"].active) {
var t = this.views.effectNode.parent.parent.parent, i = cc.instantiate(this.views.effectNode);
i.active = !0;
i.scale = 1;
t.addChild(i);
i.setPosition(t.convertToNodeSpaceAR(this.views.effectNode.convertToWorldSpaceAR(cc.v2(0, 0))));
var s = i.getComponent(sp.Skeleton);
s.skeletonData = cc.mm.dss.resmap.get("piao");
s.timeScale = 1.3;
s.setAnimation(0, "animation", !1);
s.setCompleteListener(function() {
i.removeFromParent(!0);
i.destroy();
});
var a = this._model.isSelf() ? cc.mm.framemodel.sex : this._model.sex;
r.playOperator(a, c.huinan.server.proto.ENActionType.EN_ACTION_PIAO, null, null);
}
},
_ntfCancelTrust: function() {
if (this._model.isSelf()) {
this.views.head_ytg.active = !1;
cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_SHOWTG, !1);
}
},
_ntfUpdateHandCards: function(e) {
var t = this;
cc.mm.notification.emit(n.DSS_ACTION_PLAYER_OUT_CARD);
if ((e.body.auto || !this._model.isSelf() || this._model.seatIndex !== e.body.seatIndex) && this._model.seatIndex === e.body.seatIndex) {
r.playGameSound("dss_sounds_dapai");
var i = cc.mm.uitools.createSprite(r.getCard(e.body.cards[0]), this.openCardNode);
cc.mm.uitools.addFlag(cc.mm.config.dss, "res/images/res_dss_da", i);
i.scale = .5;
i.runAction(cc.sequence(cc.scaleTo(.1, 1, 1), cc.callFunc(function() {
r.playSound(t._model.isSelf() ? cc.mm.framemodel.sex : t._model.sex, e.body.cards[0]);
})));
}
},
_ntfBaoTip: function(e) {
if (e.seatIndex === this._model.seatIndex) {
r.playOperator(this._model.isSelf() ? cc.mm.framemodel.sex : this._model.sex, c.huinan.server.proto.ENActionType.EN_ACTION_BAO_TING, null, null);
this.views.effectNode.active = !0;
this.views.effectNode.getComponent(sp.Skeleton).setAnimation(0, r.getSkeletonnName(c.huinan.server.proto.ENActionType.EN_ACTION_BAO_TING), !1);
this.views["flags/bao"].active = e.seatIndex === this._model.seatIndex;
this.views.baoeffect.active = e.seatIndex === this._model.seatIndex;
this._model.isSelf() && cc.mm.notification.emit("GAME_EFFECT_BAO_TING");
this._model.baoTing = !0;
}
},
_ntfPlayCard: function(e) {
var t = e.choices;
if (this._model.isSelf()) {
for (var i = 0; i < t.length; i++) if (c.huinan.server.proto.ENActionType.EN_ACTION_CHUPAI === t[i].actType) {
var s = this._model.isDealer && this._model.isFirstCard && !this.foldNode._children.length;
cc.mm.notification.emit(n.DSS_ACTION_PLAY_CARD, s);
this._model.isFirstCard = !1;
} else c.huinan.server.proto.ENActionType.EN_ACTION_KOU === t[i].actType && cc.mm.notification.emit(n.DSS_ACTION_KOU_CARD);
t.length && t[0].seatIndex == this._model.seatIndex && cc.mm.notification.emit(n.DSS_ACTION_REMOVE_CARD);
cc.mm.notification.emit(n.DSS_REFRESH_CARD_LEFT);
}
},
_onLine: function() {
this.views.online.active = !this._model.online && !this._model.isSelf();
},
_ntfReady: function() {
this.readyState.active = this._model.isReady && 0 == this._model.holdlen;
this.views.head_ytg.active = this.auto;
this._model.isSelf() && this.auto && cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_SHOWTG, this);
},
_ntfDealCards: function(e) {
this._ntfZhuangFlag();
this.readyState.active = this._model.isReady && 0 == this._model.holdlen;
if (this._model.isLaunchAct) !this.isLaunchAct && this._launchCardAct(this._model.holdlen); else if (this._model.isSelf()) (null == e || !e.holdlen) && cc.mm.notification.emit(n.DSS_SHOW_HAND_CARDS, this._model, null); else {
this.views.poker.active = this._model.holdlen > 0;
this.views["poker/label"].getComponent(cc.Label).string = this._model.holdlen;
cc.mm.gameserver.isReplay() && this.replayShowCard();
}
},
_launchCardAct: function() {
this._model.isLaunchAct = !1;
var e = cc.mm.uimanager.getWindow("dss_game");
if (e) {
var t = this._model.isSelf(), i = e.views.card_left, s = this.node.parent.getPosition();
t && (s = cc.v2(0, -160));
for (var a = this._model.hand_cards, o = function(i, s) {
this.isLaunchAct = a.length == i + 1;
if (t) cc.mm.notification.emit(n.DSS_SHOW_SIGNE_CARD, s, this.isLaunchAct, this._model); else {
this.views.poker.active = !0;
this.views["poker/label"].getComponent(cc.Label).string = i + 1;
e.views["doushisi-dapai-tishi-shoujia-di"].active = !1;
}
}, c = 0; c < a.length; c++) {
var h = cc.mm.uitools.createSprite(r.getCard(0), i.parent);
h.getComponent(cc.Sprite).sizeMode = cc.Sprite.SizeMode.CUSTOM;
h.opacity = 0;
h.width = 77;
h.height = 100;
h.setPosition(i.getPosition());
h.runAction(cc.sequence(cc.delayTime(.1 * c), cc.fadeIn(.01), cc.moveTo(.15, s), cc.callFunc(o.bind(this, c, a[c])), cc.removeSelf()));
}
}
},
showRemoveCards: function() {
this._model.isSelf() && cc.mm.notification.emit(n.DSS_REMOVE_HAND_CARDS, null);
cc.mm.gameserver.isReplay() && this.replayShowCard();
},
replayShowCard: function() {
if (this.handNode && this.handNodebg) {
if (window.StandaloneReplay && StandaloneReplay.active() && !this._model.isSelf() && this._model.hand_cards.length < this._model.holdlen) { this.handNode.removeAllChildren(true); this.handNodebg.active = false; return; }
this.handNode.removeAllChildren(!0);
for (var e = this.cmatch_card(this._model.hand_cards), t = 0; t < e.length; t++) {
var i = cc.mm.uitools.createSprite(r.getCard(e[t]), this.handNode);
i.getComponent(cc.Sprite).sizeMode = cc.Sprite.SizeMode.CUSTOM;
i.width = 58;
i.height = 75;
if (1 === this._model.showSeat) {
i.x -= 35 + (t < 10 ? 35 * t : 35 * (t - 10));
i.y = t < 10 ? 0 : -40;
i.zIndex = t < 10 ? 100 - t : 110 - t;
}
}
this.handNodebg.active = !0;
1 === this._model.showSeat ? this.handNodebg.width = 35 * e.length + 24 : this.handNodebg.width = 33 * e.length + 24;
}
},
getValue: function(e) {
return 1001 == Number(e) ? 14 : 1002 == Number(e) ? 15 : 1003 == Number(e) ? 16 : Number(e) % 100;
},
cmatch_card: function(e) {
for (var t = new Map(), i = 0; i < e.length; i++) {
var s = this.getValue(e[i]);
t.has(s) || t.set(s, []);
t.get(s).push(e[i]);
}
for (var a = [], o = [], n = 0; n < 14; n++) if (t.has(n)) if (t.get(n).length > 1 || t.has(14 - n)) {
a = a.concat(t.get(n));
if (t.has(14 - n) && 7 != n) {
a = a.concat(t.get(14 - n));
t.delete(14 - n);
}
} else o = o.concat(t.get(n));
for (var r = [], c = 14; c < 17; c++) t.has(c) && (r = r.concat(t.get(c)));
return r.concat(a.concat(o));
},
_ntfFoldCard: function(e) {
var t = this;
if (e.seatIndex === this._model.seatIndex) {
var i = this._addFoldCard(e.destCard);
if (this.openCardNode.children.length > 0) {
i.active = !1;
var s = this.openCardNode.scale, a = this.openCardNode.getPosition(), o = i.convertToWorldSpaceAR(cc.v2(0, 0)), n = this.openCardNode.parent.convertToNodeSpaceAR(o), r = cc.v2((a.x + n.x) / 2, (a.y + n.y) / 2);
this.openCardNode.runAction(cc.sequence(cc.delayTime(.7), cc.spawn(cc.scaleTo(.15, .3), cc.fadeOut(.15), cc.moveTo(.15, r)), cc.callFunc(function() {
i.active = !0;
t.openCardNode.scale = s;
t.openCardNode.opacity = 255;
t.openCardNode.removeAllChildren(!0);
t.openCardNode.setPosition(a);
})));
}
}
},
_ntfUpdatePoints: function(e) {
this._model.seatIndex === e.seatIndex && this._model.isSelf() && cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_COMMON_MSG, {
cmd: cc.mm.frametype.UPDATE_POINTS,
model: e
});
},
_ntfUpdateDeskInfo: function(e) {
this._model.isSelf() && cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_LEFT_CARD, e.body);
},
_ntfOperateCard: function(e) {
var t = c.huinan.server.proto.ENActionType;
if (e.seatIndex === this._model.seatIndex && !this._getLastOpNode(e.id) && e.actType !== t.EN_ACTION_GUO && e.actType !== t.EN_ACTION_HU) {
var i = this._model.isSelf() ? 100 : 0, s = this.openCardNode.convertToWorldSpaceAR(cc.v2(0, i)), a = this.deskNode.convertToNodeSpaceAR(s), o = this._addOpreateCard(e), n = o.getPosition();
o.setScale(.5, .5);
o.data = n;
o.setPosition(a);
o.runAction(cc.sequence(cc.scaleTo(.15, 1.5, 1.5), cc.delayTime(.4), cc.spawn(cc.moveTo(.2, n), cc.scaleTo(.1, 1, 1))));
this._model.hand_cards.includes(e.destCard) && !e.destCardIsOwn && cc.js.array.remove(e.cards, e.destCard);
this._model.removeHands(e.cards);
(t.EN_ACTION_CHI == e.actType || e.shuaxin) && this.showRemoveCards();
}
this.showEffect(e);
},
showEffect: function(e) {
var t = this, i = c.huinan.server.proto.ENActionType, s = e.nowAct || e.actType;
if (e.seatIndex === this._model.seatIndex) {
r.playOperator(this._model.isSelf() ? cc.mm.framemodel.sex : this._model.sex, s, e.colType, cc.mm.gameserver.getTable().areaType);
if (s !== i.EN_ACTION_GUO) {
var a = this.views.effectNode.parent.parent.parent, o = cc.instantiate(this.views.effectNode);
o.active = !0;
o.scale = 1;
a.addChild(o);
o.setPosition(a.convertToNodeSpaceAR(this.views.effectNode.convertToWorldSpaceAR(cc.v2(0, 0))));
var h = o.getComponent(sp.Skeleton);
h.skeletonData = cc.mm.dss.resmap.get(r.getSkeletonnName(s, e.colType, cc.mm.gameserver.getTable().areaType));
h.timeScale = 1.3;
h.setAnimation(0, "animation", !1);
h.setCompleteListener(function() {
var a;
if (2 != (null == (a = cc.mm.hallserver.mLastRoomParam) ? void 0 : a.processType)) {
o.getChildByName("pinghu").active = s === i.EN_ACTION_HU && 2 != e.huType;
o.getChildByName("zimo").active = s === i.EN_ACTION_HU && 2 == e.huType;
}
if (s != i.EN_ACTION_HU) {
o.removeFromParent(!0);
o.destroy();
} else t.mHuEffect = o;
});
}
}
this.isOutCard && s !== i.EN_ACTION_GUO && s !== i.EN_ACTION_HU && this.openCardNode.removeAllChildren(!0);
if (3 == e.huType && s === i.EN_ACTION_HU && e.destIndex === this._model.seatIndex) {
var m;
if (2 != (null == (m = cc.mm.hallserver.mLastRoomParam) ? void 0 : m.processType)) if (this.openCardNode.children.length) {
var d = cc.instantiate(this.views["hu-dianpao"]);
d.active = !0;
d.x = 0;
d.y = 0;
this.openCardNode.addChild(d);
} else cc.mm.notification.emit("NOTICE_SEND_CARD_HU_ACTION", this.views["hu-dianpao"]);
}
s != i.EN_ACTION_HU && (e.seatIndex != this._model.seatIndex || s != i.EN_ACTION_TOU) && cc.mm.notification.emit(n.DSS_ACTION_REMOVE_CARD);
cc.mm.notification.emit(n.DSS_ACTION_PLAYER_OUT_CARD);
},
_openBigCard: function(e, t, i) {
var s = this;
void 0 === t && (t = !1);
void 0 === i && (i = !0);
var a = cc.mm.dss.resmap.get("0"), o = r.getCard(e), n = null;
(n = this.openCardNode.children.length > 0 ? this.openCardNode.children[0] : cc.mm.uitools.createSprite(a, this.openCardNode)).color = i ? cc.Color.WHITE : cc.color(120, 120, 120);
if (e) {
n.stopAllActions();
if (t) {
n.scale = .5;
n.getComponent(cc.Sprite).spriteFrame = o;
var c = this.node.convertToWorldSpaceAR(cc.v2(0, 0)), h = this.openCardNode.convertToNodeSpaceAR(c);
n.setPosition(h);
cc.mm.uitools.addFlag(cc.mm.config.dss, "res/images/res_dss_da", n);
r.playSound(this._model.isSelf() ? cc.mm.framemodel.sex : this._model.sex, e);
n.runAction(cc.spawn(cc.moveTo(.2, cc.v2(0, 0)), cc.scaleTo(.2, 1, 1)));
} else n.runAction(cc.sequence(cc.scaleTo(.15, 0, 1), cc.callFunc(function() {
n.getComponent(cc.Sprite).spriteFrame = o;
i && cc.mm.uitools.addFlag(cc.mm.config.dss, "res/images/gy_fan", n);
r.playSound(s._model.isSelf() ? cc.mm.framemodel.sex : s._model.sex, e);
}), cc.scaleTo(.15, 1, 1)));
}
},
_openBigCardCall: function(e, t) {
var i = this, s = cc.mm.dss.resmap.get("0"), a = r.getCard(e), o = null;
(o = this.openCardNode.children.length > 0 ? this.openCardNode.children[0] : cc.mm.uitools.createSprite(s, this.openCardNode)).color = cc.Color.WHITE;
if (e) {
o.stopAllActions();
o.runAction(cc.sequence(cc.scaleTo(.15, 0, 1), cc.callFunc(function() {
o.getComponent(cc.Sprite).spriteFrame = a;
cc.mm.uitools.addFlag(cc.mm.config.dss, "res/images/gy_fan", o);
r.playSound(i._model.isSelf() ? cc.mm.framemodel.sex : i._model.sex, e);
}), cc.scaleTo(.15, 1, 1), cc.callFunc(t)));
}
},
_ntfOpenCard: function(e) {
var t = this;
if (e.seatIndex === this._model.seatIndex) if (e.isShangShou) {
this._model.holdlen = e.tilesOnHandNum;
var i = null === e.isShua || void 0 === e.isShua || 1 == e.isShua;
this.views["poker/label"].getComponent(cc.Label).string = this._model.holdlen;
if (e.isFanPai) {
var s = this.openCardNode.scale;
this._openBigCardCall(e.value, function() {
t.openCardNode.scale = s;
t.openCardNode.opacity = 255;
if (t.openCardNode.children.length > 0) {
var a = t.openCardNode.children[0], o = t.node.convertToWorldSpaceAR(cc.v2(0, 0)), n = t.openCardNode.convertToNodeSpaceAR(o);
a.runAction(cc.sequence(cc.delayTime(1), cc.spawn(cc.moveTo(.2, n), cc.scaleTo(.2, .5, .5)), cc.callFunc(function() {
t.openCardNode.removeAllChildren(!0);
})));
}
t._model.pushCard(e.value);
i && t._ntfDealCards(null);
}.bind(this, e.value));
} else {
this._model.pushCard(e.value);
i && this._ntfDealCards(null);
}
} else if (e.isFanPai) {
!e.replay && r.playGameSound("dss_sounds_fanpai");
this._openBigCard(e.value, e.isChu);
cc.mm.notification.emit(n.DSS_ACTION_PLAYER_OUT_CARD);
cc.mm.notification.emit(n.DSS_ACTION_REMOVE_CARD);
} else if (!e.isShangShou) {
this._model.isSelf() && this._openBigCard(e.value, !1, !1);
!this._model.isSelf() && this._openBigCard(0, !1, !0);
cc.mm.notification.emit(n.DSS_ACTION_REMOVE_CARD);
}
},
_ntfWaitOperate: function(e) {
console.log("当前可以操作了 + " + JSON.stringify(e));
var t = this._model.isSelf() && e.body.op_list.length && e.body.op_list[0].op === cc.mm.frametype.OPERATOR_HAND_READY;
(e.body.seatIndex === this._model.seatIndex || t) && cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_OPREATE, e.body);
},
_ntfZhuangFlag: function() {
this.views.dss_zhuang.active = this._model.isDealer;
this.views.xiaojiaFlag.active = this._model.xiaoSeat;
},
_ntfUpdatePlayer: function(e) {
this._ntfDealCards(e);
e.seatIndex === this._model.seatIndex && this._model.isSelf() && cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_COMMON_MSG, {
cmd: cc.mm.frametype.UPDATE_POINTS,
model: e
});
},
_ntfChangeOpreate: function(e) {
var t = this;
this.views.headlight.active = this._model.isOperator;
cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_OPREATE, {
op_list: []
});
cc.mm.notification.emit("UPDATE_CLOCK_POS", this._model, e);
if (!this._model.isSelf()) {
this.views.clock.stopAllActions();
this.views.clock.active = this._model.isOperator;
this.views.clock.stopAllActions();
var i = e ? e.autoIntoSecond : 10;
this.views.clock.getChildByName("label").getComponent(cc.Label).string = i;
this.views.clock.runAction(cc.repeat(cc.sequence(cc.delayTime(1), cc.callFunc(function() {
i--;
t.views.clock.getChildByName("label").getComponent(cc.Label).string = i;
})), i));
}
},
updateScore: function() {
this._model.isSelf() ? cc.mm.notification.emit(n.DSS_UPDATA_SELF_DATA, this._model) : window.Standalone.scoreLabel(this.views["scoreNode/label"], this._model.score);
},
_ntfWinner: function(e) {
var t = e.userScoreInfo;
this._model.isReady = !1;
for (var i = 0; i < t.length; i++) if (this._model.seatIndex === t[i].seatIndex) {
this._model.score = t[i].score;
this.updateScore();
}
if (this._model.isSelf()) {
var s = [], a = c.huinan.server.proto.ENAreaType, o = cc.mm.gameserver.getTable().areaType, n = e.smallResult && e.smallResult.userBrand && (o == a.EN_AREA_TYPE_PKDDS_LSGL || o == a.EN_AREA_TYPE_PKDDS_YAH20 || o == a.EN_AREA_TYPE_PKDDS_YAH20_XZ || o == a.EN_AREA_TYPE_PKDDS_YBJL_TY);
if (e.smallResult) {
var r, h, m = (null == e ? void 0 : null == (r = e.smallResult) ? void 0 : r.userBrand) || [];
if (n) {
for (var d = c.huinan.server.proto.ENCardType, l = !1, _ = 0; _ < m.length; _++) {
var u, p;
null != (u = m[_]) && null != (p = u.cardType) && p.includes(d.EN_CARD_TYPE_CHAJIAO) && (l = !0);
}
for (var g = 0; g < m.length; g++) {
var f, v, E;
if (null != (f = m[g]) && f.huCard || l) {
(null == (v = m[g]) ? void 0 : v.pointNum) >= 50 && s.push("hongwushi");
(null == (E = m[g]) ? void 0 : E.blackPoint) >= 50 && s.push("heiwushi");
}
}
}
for (var N = 0; N < t.length; N++) if (t[N].changeScore > 0) for (var T = m[N].cardType, A = 0; A < T.length; A++) s = this.addHuEffect(T[A], s, o);
for (var C = !1, y = 0; y < m.length; y++) m[y].huCard > 0 && (C = !0);
C && 2 == (null == (h = cc.mm.hallserver.mLastRoomParam) ? void 0 : h.processType) && (s.length = 0);
}
var S = s.length ? 3 * s.length : 1.5;
s.length && cc.mm.notification.emit("DSS_REN_BLACK_RIVETY", s);
this.node.runAction(cc.sequence(cc.delayTime(S), cc.callFunc(function() {
e.smallResult ? cc.mm.uimanager.showWindow(cc.mm.config.dss, "dss_settle_UI", e) : cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonBigResult", e);
})));
cc.mm.uimanager.closewindow("CommonDissolve");
cc.mm.uimanager.closewindow("dss_playerInfo");
cc.mm.notification.emit("NOTICE_DSS_GAME_REVIEW");
}
},
addHuEffect: function(e, t, i) {
var s = c.huinan.server.proto.ENAreaType, a = c.huinan.server.proto.ENCardType;
a.EN_CARD_TYPE_QUANHEI == e ? s.EN_AREA_TYPE_PKDDS_BZPC == i ? t.push("heihu_heibatuo") : t.push("heihu_heihu") : a.EN_CARD_TYPE_QUANHONG == e ? t.push("honghu") : a.EN_CARD_TYPE_GANG_HUA == e ? t.push("gangshanghua_gangshanghua") : a.EN_CARD_TYPE_ANDUI == e ? t.push("duizihu") : a.EN_CARD_TYPE_CHELONG == e && s.EN_AREA_TYPE_PKDDS_ZYAY == i ? t.push("gangshanghua_chelong") : a.EN_CARD_TYPE_CHELONG != e || s.EN_AREA_TYPE_PKDDS_GY != i && s.EN_AREA_TYPE_PKDDS_ABWC != i ? a.EN_CARD_TYPE_CHELONG != e || s.EN_AREA_TYPE_PKDDS_ABJC != i && s.EN_AREA_TYPE_PKDDS_ABMEK != i ? a.EN_CARD_TYPE_CHELONG == e && s.EN_AREA_TYPE_PKDDS_BZPC == i ? t.push("gangshanghua_chexile") : a.EN_CARD_TYPE_HONG_HU != e || s.EN_AREA_TYPE_PKDDS_LSGL != i && s.EN_AREA_TYPE_PKDDS_LSLB != i && s.EN_AREA_TYPE_PKDDS_GZLT != i && s.EN_AREA_TYPE_PKDDS_ZTYJ != i && s.EN_AREA_TYPE_PKDDS_LSYX != i ? a.EN_CARD_TYPE_HEI_HU != e || s.EN_AREA_TYPE_PKDDS_LSGL != i && s.EN_AREA_TYPE_PKDDS_LSLB != i && s.EN_AREA_TYPE_PKDDS_GZLT != i && s.EN_AREA_TYPE_PKDDS_ZTYJ != i && s.EN_AREA_TYPE_PKDDS_LSYX != i ? e == a.EN_CARD_TYPE_DIHU ? t.push("dihu") : e == a.EN_CARD_TYPE_TIANHU ? t.push("tianhu") : e == a.EN_CARD_TYPE_QIA_20 ? t.push("jinershi") : e == a.EN_CARD_TYPE_SU_HU ? t.push("xiaohu_xiaohu") : e == a.EN_CARD_TYPE_QIAN_HU && (i == s.EN_AREA_TYPE_PKDDS_CDXJ ? t.push("dahu_wuxiao") : t.push("dahu")) : t.push("heihu_heihu") : t.push("honghu") : t.push("gangshanghua_pengcouhu") : t.push("gangshanghua_checouhu");
return t;
},
_getLastOpNode: function(e) {
return this.op_cards[e] || null;
},
_addOpreateCard: function(e) {
var t = this._getLastOpNode(e.addToId);
if (t) {
if (e.isFan) for (var s = 0; s < t.children.length; s++) {
if (t.children[s].name != t.children[s].data) {
var a;
t.children[s].getComponent(cc.Sprite).spriteFrame = r.getCard(t.children[s].data);
(null == (a = e.huanCard) ? void 0 : a.includes(t.children[s].data)) && this.addTiFlag(t.children[s]);
this.pushCardNode(t.children[s].data, t.children[s]);
}
t.children[s].color = cc.Color.WHITE;
}
} else {
(t = new cc.Node(e.id)).anchorX = "pos1" === this.node.parent.name || "pos2" === this.node.parent.name ? 1 : 0;
t.anchorY = "pos2" === this.node.parent.name ? 1 : 0;
t.height = 95;
var o = t.addComponent(cc.Layout);
o.spacingX = -45;
o.type = cc.Layout.Type.HORIZONTAL;
o.resizeMode = cc.Layout.ResizeMode.CONTAINER;
o.horizontalDirection = (this.node.parent.name, cc.Layout.HorizontalDirection.LEFT_TO_RIGHT);
this.deskNode.addChild(t);
this.opreators.push(t);
}
this.op_cards[e.id] = t;
var n = Array.isArray(e.cards) ? cc.js.array.copy(e.cards) : [];
if (e.destCardChange > 0 && e.destCardChange > 100) {
n.push(e.destCardChange);
cc.js.array.remove(n, 1003);
}
for (var c, h = i(n); !(c = h()).done; ) {
var m, d = c.value, l = d;
this._model.isSelf() || e.isFan || (l = 0);
var _ = cc.mm.uitools.createSprite(r.getCard(l), t, l);
_.getComponent(cc.Sprite).sizeMode = cc.Sprite.SizeMode.CUSTOM;
_.width = 77;
_.height = 100;
_.data = d;
_.y = 1 === t.anchorY ? _.height / 2 * -1 : _.height / 2;
_.color = this._model.isSelf() && !e.isFan ? cc.color(120, 120, 120) : cc.Color.WHITE;
(null == (m = e.huanCard) ? void 0 : m.includes(l)) && this.addTiFlag(_);
this.pushCardNode(l, _);
}
t.getComponent(cc.Layout).updateLayout();
this.updatePos();
return t;
},
addTiFlag: function(e) {
var t = new cc.Node();
t.anchorX = 0;
t.anchorY = 0;
t.addComponent(cc.Sprite).spriteFrame = cc.mm.dss.resmap.get("dou14-game-biaoqian-ti");
t.x = -.5 * e.width + 5;
t.y = -.5 * e.height + 5;
e.addChild(t);
e.y += 20;
e.stopAllActions();
e.runAction(cc.moveBy(.5, cc.v2(0, -20)));
},
updatePos: function() {
if (this.opreators.length >= 4) {
if (this.opreators[0].children.length + this.opreators[1].children.length < this.opreators[2].children.length + this.opreators[3].children.length) {
var e = this.opreators[2].children.length - this.opreators[0].children.length;
if (this.opreators[3].children.length - this.opreators[1].children.length > e) {
var t = this.opreators[3];
this.opreators[3] = this.opreators[1];
this.opreators[1] = t;
} else {
var i = this.opreators[2];
this.opreators[2] = this.opreators[0];
this.opreators[0] = i;
}
}
if (this.opreators[4] && this.opreators[5] && this.opreators[4].children.length < this.opreators[5].children.length) {
var s = this.opreators[4];
this.opreators[4] = this.opreators[5];
this.opreators[5] = s;
}
if (this.opreators[4] && this.opreators[0] && this.opreators[1]) {
var a = (this.opreators[0].width + this.opreators[1].width) * (this._model.isLeft() ? -1 : 1);
this.opreators[4].setPosition(cc.v2(a, 0));
this.opreators[4].zIndex = 2;
}
if (this.opreators[5] && this.opreators[2] && this.opreators[3]) {
var o = (this.opreators[2].width + this.opreators[3].width) * (this._model.isLeft() ? -1 : 1);
this.opreators[5].setPosition(cc.v2(o, 60));
this.opreators[5].zIndex = 1;
}
}
for (var n = this.opreators.length >= 2 ? 2 === this._model.showSeat ? -60 : 60 : 0, r = 0; r < this.opreators.length; r++) {
var c = this.opreators[r];
if (cc.isValid(c) && "cc.Node" == cc.js.getClassName(c)) {
c.stopAllActions();
c.setScale(1, 1);
if (c === this.opreators[1]) {
var h = this.opreators[0].width * (this._model.isLeft() ? -1 : 1);
c.setPosition(cc.v2(h, 0));
c.zIndex = 2;
} else if (c === this.opreators[2]) {
c.setPosition(cc.v2(0, n));
c.zIndex = 2 === this._model.showSeat ? 3 : 1;
} else if (c === this.opreators[3]) {
var m = this.opreators[2].width * (this._model.isLeft() ? -1 : 1);
c.setPosition(cc.v2(m, n));
c.zIndex = 2 === this._model.showSeat ? 3 : 1;
} else if (c === this.opreators[0]) {
c.setPosition(cc.v2(0, 0));
c.zIndex = 2;
} else if (c === this.opreators[4]) {
var d = (this.opreators[0].width + this.opreators[1].width) * (this._model.isLeft() ? -1 : 1);
c.setPosition(cc.v2(d, 0));
c.zIndex = 2;
} else if (c === this.opreators[5]) {
var l = (this.opreators[2].width + this.opreators[3].width) * (this._model.isLeft() ? -1 : 1);
c.setPosition(cc.v2(l, n));
c.zIndex = 1;
}
}
if (c.children.length >= 6) {
if (this.mNumCards[r] && cc.isValid(this.mNumCards[r])) {
this.mNumCards[r].removeFromParent(!0);
this.mNumCards[r].destroy();
}
var _ = c.children[c.children.length - 1], u = cc.instantiate(this.views.zhangshu);
u.active = !0;
u.x = _.width / 2 - u.width / 2;
u.y = _.height / 2 - u.height / 2;
u.getChildByName("label").getComponent(cc.Label).string = c.children.length + "张";
_.addChild(u);
this.mNumCards[r] = u;
}
}
},
getAddToIDCards: function(e) {
var t = this._getLastOpNode(e), i = [];
if (t) for (var s = 0; s < t.children.length; s++) i.push(t.children[s].data);
return i;
},
onShowOpreateCards: function() {
console.log("this._model.opreator_cards.length:" + this._model.opreator_cards.length);
for (var e = 0; e < this._model.opreator_cards.length; e++) this._addOpreateCard(this._model.opreator_cards[e]);
var t = {
isFan: !1,
addToId: 0,
id: 100,
cards: this._model.protectCards
};
!this._model.isSelf() && t.cards.length && this._addOpreateCard(t);
},
pushCardNode: function(e, t) {
e = Number(e);
this.mCards[e] || (this.mCards[e] = []);
this.mCards[e].includes(t) || this.mCards[e].push(t);
},
_addFoldCard: function(e) {
var t = cc.mm.uitools.createSprite(r.getCard(e), this.foldNode);
t.getComponent(cc.Sprite).sizeMode = cc.Sprite.SizeMode.CUSTOM;
t.width = 58;
t.height = 75;
this.pushCardNode(e, t);
if (0 !== this._model.showSeat && 1 !== this._model.showSeat || this.isFlag) {
if (2 === this._model.showSeat || 3 === this._model.showSeat) {
for (var i = 0; i < this.foldNode._children.length; i++) this.foldNode._children[i].removeAllChildren(!0);
var s = cc.instantiate(this.foldFlag);
s.active = !0;
s.setAnchorPoint(cc.v2(1, 1));
s.setPosition(cc.v2(t.width / 2, t.height / 2));
t.addChild(s);
}
} else {
var a = cc.instantiate(this.foldFlag);
a.active = !0;
a.setAnchorPoint(cc.v2(1, 1));
a.setPosition(cc.v2(t.width / 2, t.height / 2));
t.addChild(a);
}
var o = this.foldNode._children.length - 1;
if (1 === this._model.showSeat) {
t.x -= 35 + (o < 10 ? 35 * o : 35 * (o - 10));
t.y = o < 10 ? 0 : -40;
t.zIndex = o < 10 ? 100 - o : 110 - o;
this.isFlag = !0;
} else if (0 === this._model.showSeat) {
t.zIndex = 100 - o;
t.y = o < 10 ? -40 : 0;
t.x -= 35 + (o < 10 ? 35 * o : 35 * (o - 10));
this.isFlag = !0;
}
return t;
},
onShowFoldCards: function() {
for (var e = 0; e < this._model.fold_cards.length; e++) this._addFoldCard(this._model.fold_cards[e]);
},
onShowFace: function(e) {
var t = this, faceModel = this._model, faceGeneration = (this._standaloneFaceGeneration || 0) + 1;
this._standaloneFaceGeneration = faceGeneration;
cc.loader.loadRes("faces/" + e.message, sp.SkeletonData, function(e, i) {
if (e || !i || !cc.isValid(t.node) || t._model !== faceModel || t._standaloneFaceGeneration !== faceGeneration) return;
var faceNode = t.node.getChildByName("face");
if (!cc.isValid(faceNode)) return;
var s = faceNode.getComponent(sp.Skeleton);
s.node.active = !0;
s.skeletonData = i;
s.setSkin("default");
s.setAnimation(0, "animation", !0);
});
},
onShowText: function(e) {
var t = this, i = "chat_text";
"pos1" === this.node.parent.name && (i = "chat_text_left");
this.views[i].active = !0;
this.views[i].stopAllActions();
this.views[i].getChildByName("label").getComponent(cc.Label).string = cc.mm.config.chatText[e.mutualFaceId];
this.views[i].runAction(cc.sequence(cc.delayTime(2), cc.callFunc(function() {
t.views[i].active = !1;
})));
var s = "res/sound/" + ((this._model.isSelf() ? cc.mm.framemodel.sex : this._model.sex) ? "chatwoman" : "chatman") + "/gameChat_" + e.mutualFaceId;
cc.mm.soundManager.playSound(cc.mm.config.dss, s);
},
updateUI: function() {
var e;
if (this._model.isSelf()) {
this.views.nameLabel.active = !1;
this.views.scoreNode.active = !1;
this.views.poker.active = !1;
cc.mm.notification.emit(n.DSS_UPDATA_SELF_DATA, this._model);
} else {
var t = this._model.nick;
t = t.length > 4 ? t.substring(0, 4) + ".." : t;
this.views.nameLabel.getComponent(cc.Label).string = t;
window.Standalone.scoreLabel(this.views["scoreNode/label"], this._model.score);
this.views.poker.active = this._model.holdlen;
this.views["poker/label"].getComponent(cc.Label).string = this._model.holdlen;
}
cc.mm.uitools.loadRemote(this._model.picUrl, this.views.dss_initHead);
cc.mm.uitools.changeHead(this.views.headcase, this._model.headType);
2 == (null == (e = cc.mm.hallserver.mLastRoomParam) ? void 0 : e.processType) && this._model.huOrder > 0 && this.showHuEffect();
},
showHuEffect: function() {
this.huNode.active = !0;
this.huNode.getChildByName("huOrder").getComponent(cc.Sprite).spriteFrame = this.huSpriteFrames[this._model.huOrder - 1];
this.huNode.getChildByName("card").getComponent(cc.Sprite).spriteFrame = r.getCard(this._model.huCard);
var e = cc.mm.hallserver.mLastRoomParam.playerNum, t = {
seatIndex: this._model.seatIndex,
destIndex: this._model.huCardDestIndex
}, i = this.getOpAngle(t, this._model.showSeat, e);
this.huNode.getChildByName("dir").getComponent(cc.Sprite).spriteFrame = this.dirSpriteFrames[i];
this.huNode.getChildByName("classType").getComponent(cc.Sprite).spriteFrame = this.typeSpriteFrames[this._model.huCardStatus - 1];
},
getOpAngle: function(e, t, i) {
var s = cc.mm.gamefunc.getLocalIndex(i, e.destIndex, e.seatIndex);
return 4 == i ? 0 == t ? [ 0, 1, 2, 3 ][s] : 1 == t ? [ 1, 2, 3, 0 ][s] : 2 == t ? [ 2, 3, 0, 1 ][s] : [ 3, 0, 1, 2 ][s] : 3 != i ? 0 == t ? [ 0, 2, 2 ][s] : [ 2, 0, 0 ][s] : 0 == t ? [ 0, 1, 3, 3 ][s] : 1 == t ? [ 1, 3, 0, 0 ][s] : 3 == t ? [ 3, 0, 1, 1 ][s] : 1;
},
updatePokerPos: function() {
var e = this.openCardNode.getBoundingBoxToWorld();
this.node.convertToWorldSpace(cc.v2(e.x, e.y));
if ("pos1" === this.node.parent.name) {
this.views.poker.x = this.node.width / 2 - this.views.poker.width / 2 - 6;
this.views.effectNode.x = -307;
this.views.effectNode.y = -40;
this.views.flags.x = -65;
} else if ("pos2" === this.node.parent.name) {
this.views.poker.x = this.node.width / 2 - this.views.poker.width / 2 - 6;
this.views.poker.y = 10;
var t = cc.v2(cc.winSize.width / 2, cc.winSize.height - 2.5 * this.node.height);
this.views.effectNode.setPosition(this.node.convertToNodeSpaceAR(t));
this.views.chat_text.x = 40 - this.node.width;
this.views.chat_text.y = -this.node.height - 40;
this.views.clock.setPosition(cc.v2(90, -69));
this.views.flags.anchorY = 1;
this.views.flags.x = this.views.poker.x;
this.views.flags.y = -15;
} else if ("pos0" === this.node.parent.name) {
var i = cc.v2(cc.winSize.width / 2, cc.winSize.height / 2 - this.node.height / 2);
this.views.effectNode.setPosition(this.node.convertToNodeSpaceAR(cc.v2(i.x, i.y - 15)));
this.views.flags.anchorX = 0;
this.views.flags.anchorY = .5;
this.views.flags.y = -24;
this.views.flags.x = 40;
this.views.flags.height = 50;
this.views.flags.getComponent(cc.Layout).type = cc.Layout.Type.HORIZONTAL;
this.views.flags.getComponent(cc.Layout).updateLayout();
this.views["flags/bao"].y = 0;
this.views["flags/piao"].y = 0;
this.views["flags/dazhuang"].y = 0;
this.views.xiaojiaFlag.x = -this.views.xiaojiaFlag.x;
this.views.dss_zhuang.x = -this.views.dss_zhuang.x;
} else if ("pos3" === this.node.parent.name) {
this.views.chat_text.x = this.node.width;
this.views.chat_text.y = -this.node.height / 2;
this.views.xiaojiaFlag.x = -this.views.xiaojiaFlag.x;
this.views.dss_zhuang.x = -this.views.dss_zhuang.x;
this.views.effectNode.x = 307;
this.views.effectNode.y = -40;
}
this.views.clock.active = !1;
this.views.chat_text.active = !1;
this.views.effectNode.active = !1;
this.views.chat_text_left.active = !1;
this.views.dss_zhuang.active = this._model.isBanker;
this.views.left_fang.active = this._model.fangzhu && this._model.isLeft();
this.views.right_fang.active = this._model.fangzhu && !this._model.isLeft();
this.views["flags/bao"].active = this._model.baoTing;
this.views.baoeffect.active = this._model.baoTing;
this.views["flags/piao"].active = this._model.piaoStatus >= 1;
this.views["flags/dazhuang"].active = !1;
},
setHand: function(e) {
this.handNode = e;
},
setHandBg: function(e) {
this.handNodebg = e;
},
setHuNode: function(e) {
this.huNode = e;
},
setFoldNode: function(e, t) {
this.foldNode = e;
this.foldFlag = t;
},
setDeskNode: function(e) {
this.deskNode = e;
},
setReadyNode: function(e) {
this.readyState = e;
},
setOpenCardNode: function(e) {
this.openCardNode = e;
},
reLoad: function() {
this.stopAllActions();
this.updateUI();
this.updatePokerPos();
this._ntfReady();
this._onLine();
this._model.auto && this._ntfTrust();
this._ntfDealCards({
body: {
seatIndex: this._model.seatIndex
}
});
this.onShowFoldCards();
this._ntfChangeOpreate();
this.onShowOpreateCards();
Array.isArray(this._model.showCards) && this._model.showCards.length && this._ntfOpenCard({
body: {
seatIndex: this._model.seatIndex,
cards: this._model.showCards
}
});
console.log("this._model.userId: " + this._model.uid);
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0,
dss_evenType: "dss_evenType",
dss_tools: "dss_tools"
} ],
dss_playerModel: [ function(e, t) {
"use strict";
cc._RF.push(t, "945e8ZCfF5JF4d15g3gHWar", "dss_playerModel");
var i = e("BaseModel"), s = e("../../../../Frame/src/buff/hw_msg").com, a = e("dss_evenType");
cc.Class({
extends: i,
onInit: function() {
this._super();
this.uid = 0;
this.nick = "";
this.sex = 0;
this.picUrl = "";
this.user_ip = "";
this.user_lx = 0;
this.user_ly = 0;
this.isReady = !1;
this.online = !1;
this.seatIndex = 0;
this.coin = 0;
this.score = 0;
this.state = 0;
this.showSeat = 0;
this.holdlen = 0;
this.hand_cards = [];
this.protectCards = [];
this.opreator_cards = [];
this.fold_cards = [];
this.isOperator = !1;
this.isBanker = !1;
this.points = 0;
this.fangzhu = !1;
this.showCards = [];
this.cards = [];
this.auto = !1;
this.baoTing = !1;
this.piaoStatus = 0;
this.isDealer = !1;
this.notChu_10 = !1;
this.pushCards = [];
this.blackPoint = 0;
this.deathCard = [];
this.xiaoSeat = 0;
this.gameModel = null;
this.jiaopai = !1;
this.headType = 0;
this.weekCardDays = 0;
this.isFirstCard = !0;
this.isDaZhuang = !1;
this.isLaunchAct = !1;
this.huOrder = 0;
this.huCardDestIndex = -1;
this.huCardStatus = -1;
this.mTips = {};
},
onEvent: function() {
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseAuto, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyReadyForGame, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyGameStart, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifySeatOperationChoice, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyActionFlow, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyNextOperation, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyPlayerDealCard, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyGameOver, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseCancelAuto, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyAuto, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyIsOnline, this._onLine.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyPiao, this._onGameAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseDoAction, this._ntfDoAction.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseQiFu, this._responseQifu, this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyQiFu, this._noticeQifu, this);
},
_noticeQifu: function(e) {
for (var t = 0; t < e.qifuInfo.length; t++) if (e.qifuInfo[t].seatIndex == this.seatIndex) {
this.qifuId = e.qifuInfo[t].qifuId;
this.isSelf() && cc.mm.notification.emit("DSS_REN_BLACK_RIVETY", [ [ "shilaiyunzhuan", "caiyuangungun", "hongyundangtou", "shouqiquankai" ][this.qifuId - 1] ]);
}
},
_responseQifu: function(e) {
if (1014 == e.result) {
cc.sys.isNative && cc.mm.uimanager.showTextPrompt(cc.mm.frametype["CODE_ERROR_" + e.result]);
cc.mm.uimanager.showWindow(cc.mm.config.resources, "SupplementUI", !1);
}
},
_ntfDoAction: function(e) {
if (this.isSelf() && e.result == s.huinan.server.proto.ENMessageError.CODE_ACTION_CHU_DEATH_NO && e.action.actType == s.huinan.server.proto.ENActionType.EN_ACTION_CHUPAI) {
this.pushCard(e.action.destCard);
this.pushCards.push(e.action.destCard);
cc.mm.notification.emit(a.DSS_ACTION_REMOVE_CARD);
cc.mm.notification.emit(a.DSS_SHOW_HAND_CARDS, this, null);
cc.mm.notification.emit(a.DSS_ACTION_PLAY_CARD);
cc.mm.uimanager.showTextPrompt("该牌不能出");
}
cc.mm.notification.emit(a.DSS_REFRESH_CARD_LEFT);
},
game_holds_push: function(e) {
console.log(e);
},
_onLine: function(e, t) {
if (e.seatIndex === this.seatIndex) {
this.online = e.online;
this.notification.emit(t, e);
}
},
_onGameAction: function(e, t) {
switch (t) {
case cc.mm.msgEvent.HWNotifyReadyForGame:
e.seatIndex === this.seatIndex && (this.isReady = e.state);
break;

case cc.mm.msgEvent.HWNotifyGameStart:
cc.mm.notification.emit("NOTICE_GAME_HU_TIP", null);
this.xiaoSeat = this.seatIndex == e.xiaoSeat;
this.isLaunchAct = !0;
this._dealCards(e);
break;

case cc.mm.msgEvent.HWNotifyNextOperation:
this.isOperator = e.seatIndex === this.seatIndex;
break;

case cc.mm.msgEvent.HWNotifyActionFlow:
if (e.action.seatIndex === this.seatIndex && s.huinan.server.proto.ENActionType.EN_ACTION_KOU_FAN !== e.action.actType) {
if (s.huinan.server.proto.ENActionType.EN_ACTION_DEAL == e.action.actType && e.action.dealCard) {
this.holdlen = e.action.dealCard.tilesOnHandNum;
this.points = cc.js.isNumber(e.action.dealCard.redPoint) ? e.action.dealCard.redPoint : e.action.dealCard.pointNum;
this.blackPoint = e.action.dealCard.blackPoint;
this.pushCards.push(e.action.dealCard.value);
cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyPlayerDealCard, e.action.dealCard);
} else {
this.holdlen = e.action.tilesOnHandNum > 0 ? e.action.tilesOnHandNum : this.holdlen;
this.points = cc.js.isNumber(e.action.redPoint) ? e.action.redPoint : e.action.pointNum;
this.blackPoint = e.action.blackPoint;
}
if (s.huinan.server.proto.ENActionType.EN_ACTION_HU == e.action.actType) {
this.huOrder = e.action.huNumber;
this.huCard = e.action.destCard;
this.huCardDestIndex = e.action.destIndex;
this.huCardStatus = e.action.huCardStatus;
var i = this.seatIndex == e.action.seatIndex;
this.isSelf() && i && e.action.huNumber <= 2 && cc.mm.notification.emit(a.DSS_WIN);
}
this.notification.emit("CMD_ACTION_RES_" + cc.mm.frametype.CMD_ACTION_UPDATE_PLAYER, {
holdlen: this.holdlen,
seatIndex: this.seatIndex,
points: this.points
});
this.notification.emit("CMD_ACTION_RES_" + cc.mm.frametype.CMD_ACTION_UPDATE_POINT, {
holdlen: this.holdlen,
blackPoint: this.blackPoint,
seatIndex: this.seatIndex,
points: this.points
});
}
break;

case cc.mm.msgEvent.HWResponseAuto:
case cc.mm.msgEvent.HWNotifyAuto:
if (!this.isSelf()) return;
this.auto = !0;
break;

case cc.mm.msgEvent.HWResponseCancelAuto:
if (!this.isSelf()) return;
this.auto = !1;
break;

case cc.mm.msgEvent.HWNotifyPlayerDealCard:
if (e.seatIndex === this.seatIndex) {
this.points = e.redPoint || e.pointNum;
this.holdlen = e.tilesOnHandNum;
this.blackPoint = e.blackPoint;
this.pushCards.push(e.value);
this.notification.emit("CMD_ACTION_RES_" + cc.mm.frametype.CMD_ACTION_UPDATE_POINT, {
holdlen: this.holdlen,
seatIndex: this.seatIndex,
blackPoint: this.blackPoint,
points: this.points
});
}
break;

case cc.mm.msgEvent.HWNotifyPiao:
for (var o = 0; o < e.piaoInfo.length; o++) e.piaoInfo[o].seatIndex == this.seatIndex && (this.piaoStatus = e.piaoInfo[o].piaoStatus);
break;

case cc.mm.msgEvent.HWNotifySeatOperationChoice:
for (var n = e.choices, r = 0; r < n.length; r++) if (s.huinan.server.proto.ENActionType.EN_ACTION_CHUPAI === n[r].actType) {
cc.mm.notification.emit("NOTICE_GAME_HU_TIP", null);
this.deathCard = n[r].deathCard || [];
this.mTips = {};
for (var c = 0; c < n[r].jiaoTishi.length; c++) this.mTips[n[r].jiaoTishi[c].chuCard] = n[r].jiaoTishi[c].huInfo;
} else s.huinan.server.proto.ENActionType.EN_ACTION_KOU === n[r].actType ? this.deathCard = n[r].deathCard || [] : s.huinan.server.proto.ENActionType.EN_ACTION_PIAO == n[r].actType && (this.piaoStatus = -2);
if (this.isSelf()) {
cc.mm.uimanager.closewindow("MarryUI");
cc.mm.uimanager.getWindow("dss_game") && (cc.mm.uimanager.getWindow("dss_game").node.opacity = 255);
}
}
this.notification.emit(t, e);
},
_dealCards: function(e) {
for (var t = cc.mm.gameserver.room_data.areaType != s.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZPC, i = 0; i < e.seats.length; i++) if (e.seats[i].seatIndex === this.seatIndex) {
this.onParse(e.seats[i]);
this.isDealer = t ? e.dealer == this.seatIndex : e.dangZhuangFinish && e.dealer == this.seatIndex;
this.onParseCards(e.seats[i]);
this.holdlen = e.seats[i].tilesOnHandNum;
this.points = e.seats[i].redPoint;
}
this.isSelf() && cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_COMMON_MSG, {
cmd: cc.mm.frametype.UPDATE_POINTS,
model: this
});
},
setShowIdx: function(e, t) {
this.showSeat = cc.mm.gamefunc.getLocalIndex(e, this.seatIndex, t);
},
isSelf: function() {
return parseInt(this.uid) === parseInt(cc.mm.framemodel.uid);
},
onParseCards: function(e) {
this.pushCards = [];
this.holdlen = e.tilesOnHandNum || 0;
this.hand_cards = e.tilesOnHand || [];
this.protectCards = e.protectCards || [];
this.fold_cards = e.outCardsNo || [];
this.opreator_cards = e.outCol || [];
this.showCards = e.showCards || [];
this.auto = e.auto || !1;
this.points = e.redPoint || 0;
this.baoTing = e.baoTing || !1;
this.blackPoint = e.blackPoint;
this.jiaopai = e.jiaopai;
this.huOrder = e.huOrder;
this.huCard = e.huCard;
this.huCardDestIndex = e.huCardDestIndex;
this.huCardStatus = e.huCardStatus;
},
clearData: function() {
this.huCard = 0;
this.huOrder = 0;
this.holdlen = 0;
this.hand_cards = [];
this.protectCards = [];
this.opreator_cards = [];
this.fold_cards = [];
this.showCards = [];
this.state = 1;
this.jiaopai = !1;
this.isFirstCard = !0;
this.isDaZhuang = !1;
this.pushCards = [];
this.huCardDestIndex = -1;
this.huCardStatus = -1;
},
getOpcards: function(e, t) {
for (var i = 0; i < this.opreator_cards.length; i++) if (this.opreator_cards[i].type == e && cc.mm.gamefunc.getCardValue(this.opreator_cards[i].cards[0]) == t) return this.opreator_cards[i].cards;
return [];
},
selectSomeValue: function(e, t, i) {
void 0 === i && (i = !0);
for (var a = [], o = s.huinan.server.proto.ENAreaType, n = t == o.EN_AREA_TYPE_PKDDS_AB || t == o.EN_AREA_TYPE_PKDDS_ABXJ || t == o.EN_AREA_TYPE_PKDDS_ABMEK || t == o.EN_AREA_TYPE_PKDDS_ABJC, r = 0; r < this.hand_cards.length; r++) t == o.EN_AREA_TYPE_PKDDS_PSHSS && 1003 == this.hand_cards[r] || e === cc.mm.gamefunc.getCardValue(this.hand_cards[r]) ? a.push(this.hand_cards[r]) : t != o.EN_AREA_TYPE_PKDDS_YHGY || i || 10 != e || 1003 != this.hand_cards[r] ? n && 1003 == this.hand_cards[r] && a.push(this.hand_cards[r]) : a.push(this.hand_cards[r]);
for (var c = 0; c < this.protectCards.length; c++) t == o.EN_AREA_TYPE_PKDDS_PSHSS && 1003 == this.protectCards[c] || e === cc.mm.gamefunc.getCardValue(this.protectCards[c]) ? a.push(this.protectCards[c]) : t != o.EN_AREA_TYPE_PKDDS_YHGY || i || 10 != e || 1003 != this.hand_cards[c] || a.push(this.hand_cards[c]);
return a;
},
isLeft: function() {
return 1 === this.showSeat || 2 === this.showSeat;
},
setBanker: function(e) {
this.isBanker = e;
},
removeHands: function(e) {
for (var t = 0; t < e.length; t++) cc.mm.gamefunc.remove(this.hand_cards, e[t]);
},
pushCard: function(e) {
this.hand_cards.push(e);
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
BaseModel: void 0,
dss_evenType: "dss_evenType"
} ],
dss_selectController: [ function(e, t) {
"use strict";
cc._RF.push(t, "ba06fOug/hErbeJVkNU1ucs", "dss_selectController");
var i = e("UIController"), s = e("dss_evenType"), a = e("dss_tools"), o = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._isPlayState = !1;
this._lastCard = null;
this._width = 70;
this._cards = [];
this._playCard = null;
this._model = null;
this._lastPos = cc.Vec2.ZERO;
this._isMoveCard = !1;
this._tips = null;
this._isKoupai = !1;
this._that = this.node.parent.getComponent("dss_gameController");
this.schedule(this.updateCardNum.bind(this), .01);
},
setTip: function(e) {
this._tips = e;
},
addEvent: function() {
this.node.on(cc.Node.EventType.TOUCH_START, this.onTouchStart.bind(this), this);
this.node.on(cc.Node.EventType.TOUCH_MOVE, this.onTouchMove.bind(this), this);
this.node.on(cc.Node.EventType.TOUCH_END, this.onTouchEnd.bind(this), this);
this.node.on(cc.Node.EventType.TOUCH_CANCEL, this.onTouchCancel.bind(this), this);
cc.mm.notification.on(s.DSS_ACTION_KOU_CARD, this.onNoticeKouCard.bind(this), this);
cc.mm.notification.on(s.DSS_SHOW_HAND_CARDS, this.showHolds.bind(this), this);
cc.mm.notification.on(s.DSS_REMOVE_HAND_CARDS, this.removeCards.bind(this), this);
cc.mm.notification.on(s.DSS_ACTION_PLAY_CARD, this.onNoticePlayCard.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_CLEAR_ROOM, this.onClearCards.bind(this), this);
cc.mm.notification.on(s.DSS_ACTION_REMOVE_CARD, this.onNoticeRemoveCard.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_CLEAR_PLAYER, this.ntfClearCards.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_PLAY_BACK_OUT_CARD, this._ntfPlayBackCard.bind(this), this);
cc.mm.notification.on("NOTICE_SEND_CARD_HU_ACTION", this._noticeAddRedFlag.bind(this), this);
cc.mm.notification.on("NOTICE_UPDATE_LEFT_CARD", this.updatePos.bind(this), this);
cc.mm.notification.on("GAME_EFFECT_BAO_TING", this._noticeBao.bind(this), this);
cc.mm.notification.on("NOTICE_STATE_PLAY", this._onNoticeState.bind(this), this);
cc.mm.notification.on(s.DSS_SHOW_SIGNE_CARD, this._noticeSigneCard.bind(this), this);
cc.mm.notification.on("NOTICE_DSS_GAME_REVIEW", this._noticeReview.bind(this), this);
},
_noticeReview: function() {
this._isKoupai = !1;
this._isPlayState = !1;
},
_noticeBao: function() {
for (var e = 0; e < this._cards.length; e++) this._cards[e].setBaoVisible(!0);
},
onNoticeKouCard: function() {
this._isKoupai = !0;
this._isPlayState = !0;
this.changeUnlockState();
this.node.parent.getChildByName("doushisi-dapai-tishi-shoujia-di").active = !0;
},
onNoticePlayCard: function() {
this._isKoupai = !1;
this._isPlayState = !0;
this.changeUnlockState();
},
_onNoticeState: function() {
this._isPlayState = !1;
},
changeUnlockState: function() {
if (this._model) for (var e = 0; e < this._cards.length; e++) if (!this._model.protectCards.includes(this._cards[e].value)) {
this.getIsCanSend(this._cards[e].value) || Array.isArray(this._model.deathCard) && this._model.deathCard.includes(this._cards[e].value) ? this._cards[e].setColor() : this._cards[e].unlock();
null !== this.getTipValue(this._cards[e].value) ? this._cards[e].showTip(this.getTipValue(this._cards[e].value)) : this._cards[e].hideTip();
}
},
getTipValue: function(e) {
if (!this._model.mTips[e]) return null;
var t = this.getMaxZhang(), i = this.getSingeZhang(e);
if (this.isSomeZhang() && i == t) return 2;
for (var s = Object(this._model.mTips).length > 1 ? this.getMaxFan() : 0, a = 0; a < this._model.mTips[e].length; a++) if (s > 0 && s == this._model.mTips[e][a].fanNum) return 1;
return 0;
},
getSingeZhang: function(e) {
for (var t = [], i = this._model.mTips[e], s = 0; s < i.length; s++) i[s].huCard < 1e3 && !t.includes(this.getValue(i[s].huCard)) && t.push(i[s].huCard);
for (var a = 0, o = 0; o < t.length; o++) a += this._that.getTipLeftCardNum(t[o]);
for (var n = 0; n < this._model.mTips.length; n++) this._model.mTips[e][0].huCard > 1e3 && a++;
return Math.min(this._model.mTips[e].length, a);
},
getMaxFan: function() {
var e = 0;
for (var t in this._model.mTips) for (var i = 0; i < this._model.mTips[t].length; i++) e < this._model.mTips[t][i].fanNum && (e = this._model.mTips[t][i].fanNum);
return e;
},
getMaxZhang: function() {
var e = 0;
for (var t in this._model.mTips) {
var i = this.getSingeZhang(t);
e < i && (e = i);
}
return e;
},
isSomeZhang: function() {
var e = -1;
for (var t in this._model.mTips) {
var i = this.getSingeZhang(t);
if (e > -1 && e != i) return 1;
e = i;
}
return 0;
},
getAb: function() {
var e = cc.mm.gameserver.getTable().areaType, t = o.huinan.server.proto.ENAreaType;
return e == t.EN_AREA_TYPE_PKDDS_AB || e == t.EN_AREA_TYPE_PKDDS_ABXJ || e == t.EN_AREA_TYPE_PKDDS_ABMEK || e == t.EN_AREA_TYPE_PKDDS_ABJC;
},
ntfClearCards: function() {
this.onClearCards();
this.onNoticeRemoveCard();
this._lastCard = null;
},
_noticeSigneCard: function(e, t, i) {
var s = this;
this._model = i;
var o = cc.instantiate(cc.mm.dss.resmap.get("dss_card"));
o.anchorX = 0;
this.node.addChild(o);
var n = o.getComponent("dss_cardController");
n.setValue(e);
this._cards.push(n);
this.upadteWidth(this._cards.length);
for (var r = this._cards.length > 1 ? this._cards.length / 2 * this._width * -1 : -84, c = 0; c < this._cards.length; c++) this._cards[c].node.setPosition(cc.v2(r + c * this._width, 0));
a.playGameSound("dss_sounds_fapai");
if (t) {
for (var h = 0; h < this._cards.length; h++) this._cards[h].node.runAction(cc.moveTo(.1, cc.v2(0, 0)));
this.node.runAction(cc.sequence(cc.delayTime(.1), cc.callFunc(function() {
s._model.hand_cards = s.cmatch_card(s._model.hand_cards);
s.removeCards(e);
s.node.parent.getChildByName("doushisi-dapai-tishi-shoujia-di").active = s._isKoupai;
for (var t = 0; t < s._cards.length; t++) {
s._cards[t].node.stopAllActions();
s._cards[t].node.setPosition(cc.v2(0, 0));
s._cards[t].node.runAction(cc.moveTo(.1, cc.v2(r + t * s._width, 0)));
}
})));
}
},
isSomeCards: function() {
if (this._model.hand_cards.length != this._cards.length) return !1;
for (var e = 0; e < this._model.hand_cards.length; e++) {
if (!this._cards[e]) return !1;
if (this._cards[e].value != this._model.hand_cards[e]) return !1;
}
return !0;
},
removeCards: function() {
this._model.hand_cards = this.cmatch_card(this._model.hand_cards);
var e = this._model.hand_cards.length + this._model.protectCards.length;
if (!this.isSomeCards()) {
this.onClearCards();
this.upadteWidth(e);
for (var t = e > 1 ? e / 2 * this._width * -1 : -84, i = 0; i < this._model.protectCards.length; i++) {
var s = cc.instantiate(cc.mm.dss.resmap.get("dss_card"));
this.node.addChild(s);
var a = s.getComponent("dss_cardController");
a.setValue(this._model.protectCards[i]);
a.setColor();
this._cards.push(a);
}
for (var o = 0; o < this._model.hand_cards.length; o++) if (this.getIsCanSend(this._model.hand_cards[o])) {
var n = cc.instantiate(cc.mm.dss.resmap.get("dss_card"));
this.node.addChild(n);
var r = n.getComponent("dss_cardController");
r.setValue(this._model.hand_cards[o]);
r.setColor();
this._cards.push(r);
}
for (var c = 0; c < this._model.hand_cards.length; c++) if (!this.getIsCanSend(this._model.hand_cards[c])) {
var h = cc.instantiate(cc.mm.dss.resmap.get("dss_card"));
this.node.addChild(h);
var m = h.getComponent("dss_cardController");
m.setValue(this._model.hand_cards[c]);
this._cards.push(m);
}
for (var d = 0; d < this._cards.length; d++) {
this._cards[d].node.setPosition(cc.v2(t + d * this._width, 0));
this._cards[d].setBaoVisible(this._model.baoTing);
if (this._model.pushCards.includes(this._cards[d].value)) {
this._cards[d].node.y = 80;
this._cards[d].node.stopAllActions();
this._cards[d].node.runAction(cc.moveTo(.5, cc.v2(t + d * this._width, 0)));
cc.js.array.remove(this._model.pushCards, this._cards[d].value);
}
}
this._lastCard = null;
}
},
updateCardNum: function() {
for (var e = 0; e < this._cards.length; e++) {
var t = this.isShowCardNum(this._cards[e].value, this._cards) ? this._that.getLeftCardNum(this._cards[e].value) : 4;
this._cards[e].setNum(t);
}
},
isShowCardNum: function(e, t) {
if ((e = Number(e)) > 1e3 || this._that.mTips) return !1;
if (this._model && this._model.protectCards.includes(e)) return !1;
for (var i = this.getValue(e), s = 14 - i, a = new Map(), o = 0; o < t.length; o++) {
var n = this.getValue(t[o].value);
a.has(n) || a.set(n, []);
a.get(n).push(t[o].value);
}
if (!a.has(i)) return !1;
var r = a.get(i).length;
if (7 == i && a.has(i) && 1 == r) return !0;
if (a.has(s) && a.get(s).length < r) return a.get(i)[r - 1] == e;
if (a.has(i) && r > 1) return !1;
if (!a.has(s)) return !0;
for (var c = 0; c < this._model.protectCards.length; c++) if (this.getValue(this._model.protectCards[c]) == s) return !0;
return !1;
},
updatePos: function() {
for (var e = this._cards.length, t = e > 1 ? e / 2 * this._width * -1 : -84, i = 0; i < e; i++) {
this._cards[i].node.stopAllActions();
this._cards[i].node.runAction(cc.moveTo(.15, cc.v2(t + i * this._width, 0)));
this._model && null !== this.getTipValue(this._cards[i].value) ? this._cards[i].showTip(this.getTipValue(this._cards[i].value)) : this._cards[i].hideTip();
}
},
getIsCanSend: function(e) {
return !(cc.mm.hallserver.mLastRoomParam.areaType != o.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YHGY || cc.mm.hallserver.mLastRoomParam.yifupai || 1003 != e || !this._model.notChu_10) || this._model.notChu_10 && (110 == e || 210 == e || 310 == e || 410 == e);
},
onClearCards: function() {
for (var e = 0; e < this._cards.length; e++) if (this._cards[e].node) {
this._cards[e].node.removeFromParent(!0);
this._cards[e].node.destroy();
}
this._cards = [];
this._lastCard = null;
},
upadteWidth: function(e) {
this._width = e <= 7 ? 80 : 80 - 5 * (e - 7);
},
showHolds: function(e, t) {
this._model = e;
this.removeCards(t);
this.changeUnlockState();
},
_sortFn: function(e, t) {
var i = this.getValue(e.huCard), s = this.getValue(t.huCard);
return i == s ? e.huCard - t.huCard : i - s;
},
addTipFan: function(e, t) {
var i = [];
for (var s in t) {
var o = t[s].huCard;
t[s].num - this._that.getLeft(o) && i.push(t[s]);
}
this._tips.active = !0;
this._tips.getChildByName("Layout").removeAllChildren(!0);
i.sort(this._sortFn.bind(this));
var n = 0;
for (var r in i) {
var c = cc.instantiate(this._tips.getChildByName("card"));
c.active = !0;
c.getChildByName("label").getComponent(cc.Label).string = i[r].fanNum + "番";
this._tips.getChildByName("Layout").addChild(c);
var h = a.getCard(String(i[r].huCard)), m = cc.mm.uitools.createSprite(h, c);
m.width = 75;
m.height = 95;
m.x = 37;
n += i[r].num;
}
this._tips.x = (e ? e.node.x : 0) + 50;
this._tips.width = 75 * this._tips.getChildByName("Layout").children.length + 140;
this._tips.getChildByName("cardLayout").getChildByName("number").getComponent(cc.Label).string = n;
this._tips.getChildByName("cardLayout").getChildByName("number").getComponent(cc.Label)._forceUpdateRenderData();
this._tips.getChildByName("Layout").getComponent(cc.Widget).updateAlignment();
this._tips.getChildByName("label").getComponent(cc.Widget).updateAlignment();
this._tips.getChildByName("cardLayout").getComponent(cc.Layout).updateLayout();
this._tips.getChildByName("cardLayout").x = 24 - this._tips.width / 2 + this._tips.getChildByName("cardLayout").width / 2;
},
onNoticeRemoveCard: function() {
if (this._playCard) {
this._playCard.removeFromParent(!0);
this._playCard.destroy();
this._playCard = null;
}
},
_noticeAddRedFlag: function(e) {
if (this._playCard && cc.isValid(this._playCard)) {
var t = cc.instantiate(e);
t.active = !0;
t.scaleX = this._playCard.width / t.width;
t.scaleY = this._playCard.height / t.height;
t.x = this._playCard.width / 2;
t.y = this._playCard.height / 2 + 2;
this._playCard.addChild(t);
}
},
removeAction: function(e, t) {
if (cc.isValid(e)) {
this._playCard = e;
this._playCard.stopAllActions();
e.zIndex = 200;
a.playGameSound("dss_sounds_dapai");
cc.mm.uitools.addFlag(cc.mm.config.dss, "res/images/res_dss_da", e);
e.runAction(cc.sequence(cc.spawn(cc.scaleTo(.2, .8, .8), cc.moveTo(.2, cc.v2(-e.width / 2 + 20, 225))), cc.callFunc(function() {
a.playSound(cc.mm.framemodel.sex, t);
})));
cc.mm.notification.emit(s.DSS_ACTION_PLAYER_OUT_CARD);
}
},
onTouchStart: function(e) {
var t = e.getLocation();
t = this.node.convertToNodeSpaceAR(t);
var i = this.selectCard(t, this._cards);
cc.mm.notification.emit("dss_un_select_card");
if (i && Date.now() - i.lastTime < 300 && this._isPlayState && this._lastCard && this._lastCard === i && !this.getIsCanSend(i.value)) {
this._isPlayState = !1;
this.sendCard(this._lastCard);
this._lastCard = null;
} else {
this._lastCard && this._lastCard != i && cc.isValid(this._lastCard) && this._lastCard.isUp && this._lastCard.unselect();
this._lastCard = i;
i && cc.isValid(i) && (i.isUp ? i.unselect() : i.select());
this._isMoveCard = !1;
cc.isValid(i) && (this._lastPos = i.getUnsclectPos());
cc.mm.notification.emit("dss_hide_menu");
i && i.isUp && cc.mm.notification.emit("dss_select_card", i.value);
}
i && (i.lastTime = Date.now());
},
onTouchMove: function(e) {
if (cc.isValid(this._lastCard) && this._isPlayState) {
this._lastCard.node.x += e.touch.getDelta().x;
this._lastCard.node.y += e.touch.getDelta().y;
var t = e.touch.getLocation(), i = e.touch.getStartLocation();
(Math.abs(t.x - i.x) > 4 || Math.abs(t.y - i.y) > 4) && (this._isMoveCard = !0);
}
},
onTouchEnd: function() {
var e, t;
null == (e = this.node.parent) || null == (t = e.getComponent("dss_gameController")) || t.scaleQiFu();
if (cc.isValid(this._lastCard) && this._isMoveCard && this._lastCard.node.y < 200) {
this._tips.active = !1;
this._lastCard.node.setPosition(this._lastPos);
} else if (cc.isValid(this._lastCard) && this._isMoveCard && this._isPlayState && !this.getIsCanSend(this._lastCard.value)) {
this.sendCard(this._lastCard);
this._lastCard = null;
} else if (cc.isValid(this._lastCard) && this._lastCard.isUp && this._model.mTips[this._lastCard.value]) {
console.log("当前需要有胡牌提示");
this.addTipFan(this._lastCard, this._model.mTips[this._lastCard.value]);
} else this._tips.active = !1;
},
sendCard: function(e) {
this._tips.active = !1;
this._isPlayState = !1;
var t = o.huinan.server.proto.ENActionType, i = new o.huinan.server.proto.MsgData();
i.hwRequestDoAction = new o.huinan.server.proto.HWRequestDoAction();
i.hwRequestDoAction.seatIndex = this._model.seatIndex;
i.hwRequestDoAction.actType = this._isKoupai ? t.EN_ACTION_KOU : t.EN_ACTION_CHUPAI;
i.hwRequestDoAction.destCard = e.value;
cc.mm.server.send(i, cc.mm.msgEvent.HWRequestDoAction, cc.mm.framemodel.uid);
this._model.removeHands([ e.value ]);
e.setBaoVisible(!1);
this._model && this._model.mTips[e.value] ? cc.mm.notification.emit("NOTICE_GAME_HU_TIP", this._model.mTips[e.value]) : cc.mm.notification.emit("NOTICE_GAME_HU_TIP", null);
cc.mm.notification.emit("dss_un_select_card");
this.node.parent.getChildByName("doushisi-dapai-tishi-shoujia-di").active = !1;
this._model.deathCard = [];
this.removeCard(e);
this.removeAction(e.node, e.value);
this.updatePos();
this._model.mTips = {};
this.changeUnlockState();
if (this._model && this._model.baoTing) for (var s = 0; s < this._cards.length; s++) this._model.protectCards.includes(this._cards[s].value) || this._cards[s].unlock();
if (this._isKoupai) {
this._isKoupai = !1;
this.onNoticeRemoveCard();
}
},
_ntfPlayBackCard: function(e) {
for (var t = null, i = 0; i < this._cards.length; i++) if (this._cards[i].value == e) {
t = this._cards[i];
this._model.removeHands([ e ]);
this.removeCard(t);
this.removeAction(t.node, t.value);
this._model && this._model.mTips[e] ? cc.mm.notification.emit("NOTICE_GAME_HU_TIP", this._model.mTips[e]) : cc.mm.notification.emit("NOTICE_GAME_HU_TIP", null);
this._model.mTips = {};
this.updatePos();
this.changeUnlockState();
return;
}
},
onTouchCancel: function() {
cc.isValid(this._lastCard) && this._isMoveCard && this._lastCard.node.setPosition(this._lastPos);
},
getValue: function(e) {
return 1001 == Number(e) ? 14 : 1002 == Number(e) ? 15 : 1003 == Number(e) ? 16 : Number(e) % 100;
},
getColor: function(e) {
return parseInt((e - 1) / 13);
},
cmatch_card: function(e) {
for (var t = new Map(), i = 0; i < e.length; i++) {
var s = this.getValue(e[i]);
t.has(s) || t.set(s, []);
t.get(s).push(e[i]);
}
for (var a = [], o = [], n = 0; n < 14; n++) if (t.has(n)) if (t.get(n).length > 1 || t.has(14 - n)) {
a = a.concat(t.get(n));
if (t.has(14 - n) && 7 != n) {
a = a.concat(t.get(14 - n));
t.delete(14 - n);
}
} else o = o.concat(t.get(n));
for (var r = [], c = 14; c < 17; c++) t.has(c) && (r = r.concat(t.get(c)));
return r.concat(a.concat(o));
},
removeCard: function(e) {
for (var t = 0; t < this._cards.length; t++) if (this._cards[t] === e) {
e.setNum(10);
e.hideTip();
this._cards.splice(t, 1);
break;
}
},
selectCard: function(e, t) {
for (var i = 0; i < t.length; i++) if (t[i].touchCard(e, i === t.length - 1)) return t[i];
return null;
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0,
dss_evenType: "dss_evenType",
dss_tools: "dss_tools"
} ],
dss_settle_UIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "c1e30Md1EFH1qj9+bPwh+1d", "dss_settle_UIController");
function i(e, t) {
var i = "undefined" != typeof Symbol && e[Symbol.iterator] || e["@@iterator"];
if (i) return (i = i.call(e)).next.bind(i);
if (Array.isArray(e) || (i = s(e)) || t && e && "number" == typeof e.length) {
i && (e = i);
var a = 0;
return function() {
return a >= e.length ? {
done: !0
} : {
done: !1,
value: e[a++]
};
};
}
throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function s(e, t) {
if (e) {
if ("string" == typeof e) return a(e, t);
var i = Object.prototype.toString.call(e).slice(8, -1);
"Object" === i && e.constructor && (i = e.constructor.name);
return "Map" === i || "Set" === i ? Array.from(e) : "Arguments" === i || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(i) ? a(e, t) : void 0;
}
}
function a(e, t) {
(null == t || t > e.length) && (t = e.length);
for (var i = 0, s = new Array(t); i < t; i++) s[i] = e[i];
return s;
}
var o = e("UIController"), n = e("../../../../Frame/src/buff/hw_msg").com, r = n.huinan.server.proto.ENCardType;
cc.Class({
extends: o,
onLoad: function() {
var e = this;
this._super();
this.body = null;
cc.mm.notification.emit("DSS_HIDE_CHANGE_BTN");
cc.sys.isBrowser && cc.loader.loadRes("frames/dss_game_btn_fzzj", cc.SpriteFrame, function(t, i) {
e.views.gy_btn_fxzj.getComponent(cc.Sprite).spriteFrame = i;
});
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views.continue_btn, this.onClickContinue.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.gy_btn_jx, this.onClickContinue.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.exit_btn, this.onClickExitBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.gy_btn_fxzj, this.onClickShare.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.lookBtn, this.onClickLook.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.feedBtn, this.onClickFeed.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.rule, this.onClickRule.bind(this), this);
cc.mm.notification.on("NTF_CLOSE_SETTLE_WIN", this.close.bind(this), this);
var e = this.node.children;
this.views.touch_lock_btn.on(cc.Node.EventType.TOUCH_START, function() {
for (var t, s = i(e); !(t = s()).done; ) t.value.opacity = 0;
cc.mm.notification.emit(cc.mm.frametype.MODEL_NOTICE_SHOWTG, !1);
}, this);
this.views.touch_lock_btn.on(cc.Node.EventType.TOUCH_CANCEL, function() {
for (var t, s = i(e); !(t = s()).done; ) {
var a = t.value;
a.opacity = "mask" == a.name ? 180 : 255;
}
}, this);
this.views.touch_lock_btn.on(cc.Node.EventType.TOUCH_END, function() {
for (var t, s = i(e); !(t = s()).done; ) {
var a = t.value;
a.opacity = "mask" == a.name ? 180 : 255;
}
}, this);
var t = cc.sys.localStorage.getItem("PLAY_TIMES");
t && t.length ? cc.sys.localStorage.setItem("PLAY_TIMES", Number(t) + 1) : cc.sys.localStorage.setItem("PLAY_TIMES", 1);
},
onClickRule: function() {
cc.mm.notification.emit("NOTICE_SHOW_GAME_RULE");
},
onClickFeed: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "HallServiceUI");
},
reLoad: function(e) {
this.loadUI(e);
},
onClickLook: function() {
this.close();
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonBigResult", this.body);
},
getAb: function(e) {
var t = n.huinan.server.proto.ENAreaType;
return e == t.EN_AREA_TYPE_PKDDS_AB || e == t.EN_AREA_TYPE_PKDDS_ABXJ || e == t.EN_AREA_TYPE_PKDDS_ABMEK || e == t.EN_AREA_TYPE_PKDDS_ABJC;
},
isAreaCome: function(e) {
var t = n.huinan.server.proto.ENAreaType;
return !this.getAb(e) && e != t.EN_AREA_TYPE_PKDDS_BZTJ && e != t.EN_AREA_TYPE_PKDDS_GY && e != t.EN_AREA_TYPE_PKDDS_ABWC && e != t.EN_AREA_TYPE_PKDDS_SCSN && e != t.EN_AREA_TYPE_PKDDS_ZGRX && e != t.EN_AREA_TYPE_PKDDS_YBJL_TY && e != t.EN_AREA_TYPE_PKDDS_YBJL && e != t.EN_AREA_TYPE_PKDDS_LSGL && e != t.EN_AREA_TYPE_PKDDS_ZTYJ;
},
onClickXiangqing: function(e) {
cc.mm.uimanager.showWindow(cc.mm.config.dss, "dds_xiangqing", e);
},
loadUI: function(e) {
this.body = e;
this.bigRoomName = "friend";
for (var t = cc.mm.hallserver.mLastRoomParam.areaType, i = 0; i < e.userScoreInfo.length; i++) {
var s, a = cc.instantiate(this.views.items);
cc.mm.uitools.restNode(a);
this.views.center.addChild(a);
a.getChildByName("win_bg").active = e.userScoreInfo[i].changeScore > 0;
a.getChildByName("self_bg").active = e.userScoreInfo[i].uid == cc.mm.framemodel.uid;
a.getChildByName("win_bg").active || (a.zIndex = 10 + i);
var o = e.smallResult.userBrand[i].scoreInfo;
a.getChildByName("xiangqing").active = 2 == cc.mm.hallserver.mLastRoomParam.processType;
cc.mm.uitools.addBtnLister(a.getChildByName("xiangqing"), this.onClickXiangqing.bind(this, o), this);
a.getChildByName("cards").getChildByName("hand").getComponent(cc.Layout).spacingX = -45 * (1 - cc.winSize.width / 1334) - 45;
this.updateScore(a.getChildByName("losescoreLabel"), a.getChildByName("winscoreLabel"), e.userScoreInfo[i]);
this.updateHead(a.getChildByName("head"), e.userScoreInfo[i], e.dealerSeat);
this.updateHand(a.getChildByName("cards").getChildByName("hand"), e.smallResult.userBrand[i].tilesOnHand, e.smallResult.userBrand[i].huCard);
this.updateOpCard(a.getChildByName("cards").getChildByName("op"), e.smallResult.userBrand[i].colInfo);
a.getChildByName("head").getChildByName("xiaojia").active = e.xiaoSeat == e.userScoreInfo[i].seatIndex;
2 == (null == (s = cc.mm.hallserver.mLastRoomParam) ? void 0 : s.processType) && function() {
var t = a.getChildByName("head").getChildByName("huoder").getComponent(cc.Sprite), s = cc.assetManager.getBundle(cc.mm.config.dss), o = e.smallResult.userBrand[i].huOrder;
s.load("res/result/dou-dapai-pic-biapqian-" + o + "hu", cc.SpriteFrame, function(e, i) {
t.spriteFrame = i;
});
1 == o ? a.zIndex = 0 : 2 == o ? a.zIndex = 1 : 3 == o ? a.zIndex = 2 : a.getChildByName("win_bg").active ? a.zIndex = 3 : a.zIndex = 4;
}();
var c = e.smallResult.userBrand[i].protectCards;
if (Array.isArray(c) && c.length) {
var h = new cc.Node("200"), m = h.addComponent(cc.Layout);
m.type = cc.Layout.Type.HORIZONTAL;
m.resizeMode = cc.Layout.ResizeMode.CONTAINER;
m.spacingX = -45 * (1 - cc.winSize.width / 1334) - 45;
a.getChildByName("cards").getChildByName("op").addChild(h);
this.updateHand(h, c, null);
}
this.addHuFlag(a.getChildByName("types"), e.smallResult.userBrand[i].cardType);
var d = n.huinan.server.proto.ENAreaType, l = t == d.EN_AREA_TYPE_PKDDS_GZLT ? "抽" : "番";
t != d.EN_AREA_TYPE_PKDDS_YHGY && d.EN_AREA_TYPE_PKDDS_PSHSS != t || (l = "点");
var _ = e.smallResult.userBrand[i].chaoGuoFanNum || 0, u = 0 == _ && t == d.EN_AREA_TYPE_PKDDS_ZGRX;
if (t == d.EN_AREA_TYPE_PKDDS_CDXJ) {
var p = e.smallResult.userBrand[i].cardType;
if (p.includes(r.EN_CARD_TYPE_HONG40) || p.includes(r.EN_CARD_TYPE_HONG50)) {
var g = cc.instantiate(this.views["hong-dise"]);
g.active = !0;
g.getChildByName("label").getComponent(cc.Label).string = "红" + e.smallResult.userBrand[i].pointNum;
a.getChildByName("types").addChild(g);
}
}
if (e.userScoreInfo[i].changeScore > 0 && (this.isAreaCome(t) || u)) {
var f;
a.getChildByName("fan").active = 2 != (null == (f = cc.mm.hallserver.mLastRoomParam) ? void 0 : f.processType);
d.EN_AREA_TYPE_PKDDS_YHGY == t || d.EN_AREA_TYPE_PKDDS_PSHSS == t ? a.getChildByName("fan").getChildByName("label").getComponent(cc.Label).string = e.smallResult.userBrand[i].pointNum + l : a.getChildByName("fan").getChildByName("label").getComponent(cc.Label).string = e.smallResult.userBrand[i].fanNum + l;
if (t == d.EN_AREA_TYPE_PKDDS_YAH20 || t == d.EN_AREA_TYPE_PKDDS_YAH20_XZ) {
if (e.smallResult.userBrand[i].pointNum >= 50) {
var v = cc.instantiate(this.views["hong-dise"]);
v.active = !0;
v.getChildByName("label").getComponent(cc.Label).string = "红" + e.smallResult.userBrand[i].pointNum;
a.getChildByName("types").addChild(v);
}
if (e.smallResult.userBrand[i].blackPoint >= 50) {
var E = cc.instantiate(this.views["hei-dise"]);
E.active = !0;
E.getChildByName("label").getComponent(cc.Label).string = "黑" + e.smallResult.userBrand[i].blackPoint;
a.getChildByName("types").addChild(E);
}
} else if (cc.mm.gameserver.getTable().areaType == d.EN_AREA_TYPE_PKDDS_BZPC && e.smallResult.userBrand[i].pointNum >= 12) {
var N = cc.instantiate(this.views.tuo_dise);
N.active = !0;
N.getChildByName("label").getComponent(cc.Label).string = e.smallResult.userBrand[i].pointNum + "坨";
a.getChildByName("types").addChild(N);
}
} else if (e.userScoreInfo[i].changeScore > 0) {
a.getChildByName("fanScore").active = !0;
if (t == d.EN_AREA_TYPE_PKDDS_ZTYJ) {
a.getChildByName("fanScore").getChildByName("fan").getComponent(cc.Label).string = e.smallResult.userBrand[i].fanNum + l;
a.getChildByName("fanScore").getChildByName("score").getComponent(cc.Label).string = e.smallResult.userBrand[i].pointNum + "点";
} else if (t == d.EN_AREA_TYPE_PKDDS_LSGL) {
if (e.smallResult.userBrand[i].pointNum >= 50) {
var T = cc.instantiate(this.views["hong-dise"]);
T.active = !0;
T.getChildByName("label").getComponent(cc.Label).string = "红" + e.smallResult.userBrand[i].pointNum;
a.getChildByName("types").addChild(T);
}
if (e.smallResult.userBrand[i].blackPoint >= 50) {
var A = cc.instantiate(this.views["hei-dise"]);
A.active = !0;
A.getChildByName("label").getComponent(cc.Label).string = "黑" + e.smallResult.userBrand[i].blackPoint;
a.getChildByName("types").addChild(A);
}
var C = _ + e.smallResult.userBrand[i].fanNum + "敲";
a.getChildByName("fanScore").active = !1;
a.getChildByName("fan").active = !0;
a.getChildByName("fan").getChildByName("label").getComponent(cc.Label).string = C;
} else if (t == d.EN_AREA_TYPE_PKDDS_YBJL_TY || t == d.EN_AREA_TYPE_PKDDS_YBJL) {
var y, S, D = e.smallResult.userBrand[i], P = (null == (y = D.cardType) ? void 0 : y.includes(r.EN_CARD_TYPE_QUANHEI)) || (null == (S = D.cardType) ? void 0 : S.includes(r.EN_CARD_TYPE_7_GE_HEI)) ? "黑" + D.blackPoint : D.pointNum + "点";
a.getChildByName("fanScore").getChildByName("fan").getComponent(cc.Label).string = D.fanNum + l;
a.getChildByName("fanScore").getChildByName("score").getComponent(cc.Label).string = P;
} else if (t != d.EN_AREA_TYPE_PKDDS_ZGRX) {
a.getChildByName("fanScore").getChildByName("fan").getComponent(cc.Label).string = e.smallResult.userBrand[i].fanNum + l;
a.getChildByName("fanScore").getChildByName("score").getComponent(cc.Label).string = e.smallResult.userBrand[i].pointNum + "分";
} else {
a.getChildByName("fanScore").getChildByName("fan").getComponent(cc.Label).string = _ + "底";
a.getChildByName("fanScore").getChildByName("score").getComponent(cc.Label).string = e.smallResult.userBrand[i].fanNum + l;
}
}
}
var w = n.huinan.server.proto.ENAreaType;
this.views["windi/liuju"].active = e.isHuang;
this.views["windi/shengli"].active = !e.isHuang;
if (n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND == cc.mm.gameserver.getTable().roomType) {
this.views.exit_btn.active = !1;
this.views.gy_btn_fxzj.active = !0;
this.views.continue_btn.active = !0;
this.views["difen/label"].getComponent(cc.Label).string = "底分: " + this.getBasicTimes(e);
} else {
this.views.gy_btn_fxzj.active = !1;
this.views.exit_btn.active = !0;
this.views.continue_btn.active = !0;
this.views.exit_btn.x = this.views.gy_btn_fxzj.x;
this.views["difen/label"].getComponent(cc.Label).string = "底分: " + e.basicTimes;
}
this.views.continue_btn.active = n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND !== cc.mm.gameserver.getTable().roomType;
this.views.gy_btn_jx.active = n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND == cc.mm.gameserver.getTable().roomType;
this.views.label.active = n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND !== cc.mm.gameserver.getTable().roomType;
if (n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND == cc.mm.gameserver.getTable().roomType) {
cc.mm.uitools.labelSetString(this.views["count/label"], "局数: " + e.round + "/" + e.allRound);
this.views.lookBtn.active = e.round == e.allRound;
this.views.gy_btn_jx.active = e.round != e.allRound;
} else this.views.count.active = !1;
w.EN_AREA_TYPE_PKDDS_CDXJ == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=倍数相乘（跟斗翻）*底分" : w.EN_AREA_TYPE_PKDDS_ZYAY == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=倍数相乘（滚滚翻）*底分" : w.EN_AREA_TYPE_PKDDS_YAH20 == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=（1+所有番数之和）x底分" : w.EN_AREA_TYPE_PKDDS_CDPJ == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=（番数+1）*底分" : w.EN_AREA_TYPE_PKDDS_CDQL == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=（番数+1）*底分" : w.EN_AREA_TYPE_PKDDS_BZPC == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=2^（番数之和）*底分*0.8" : w.EN_AREA_TYPE_PKDDS_ABWC == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=分数x2^（番数之和）/100x底分" : w.EN_AREA_TYPE_PKDDS_SCSN == cc.mm.gameserver.getTable().areaType ? n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND == cc.mm.gameserver.getTable().roomType ? this.views.label.getComponent(cc.Label).string = "每家输分=手牌实际分数/100*2^（番数之和）" : this.views.label.getComponent(cc.Label).string = "每家输分=底分*手牌实际分数/100*2^（番数之和）" : w.EN_AREA_TYPE_PKDDS_GZLT == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=底分*（1+手上抽数）" : w.EN_AREA_TYPE_PKDDS_GY == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=（分数x2^番数之和）/100x底分" : w.EN_AREA_TYPE_PKDDS_BZTJ == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=（分数x2^番数）/100x底分" : w.EN_AREA_TYPE_PKDDS_ZGRX == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=2^(番数之和)x底分" : w.EN_AREA_TYPE_PKDDS_LSYX == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=底分X2^（番数之和）" : w.EN_AREA_TYPE_PKDDS_ZTYJ == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=（1+所有牌型番数+红点数加番）*自摸（2）*底分" : w.EN_AREA_TYPE_PKDDS_YBXZ == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=2^(番数之和)x底分" : w.EN_AREA_TYPE_PKDDS_LSLB == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家分数=底分*1*2^（番数之和）" : w.EN_AREA_TYPE_PKDDS_YBJL_TY == cc.mm.gameserver.getTable().areaType || w.EN_AREA_TYPE_PKDDS_YBJL == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家得分=（点数番+牌型番+1）*自摸（2倍）" : w.EN_AREA_TYPE_PKDDS_LSGL == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢每家豆豆=（封顶敲数（按滚翻计算）+超出封顶每敲加1分）*该场次每把豆豆消耗值" : w.EN_AREA_TYPE_PKDDS_YHGY == cc.mm.gameserver.getTable().areaType || w.EN_AREA_TYPE_PKDDS_PSHSS == cc.mm.gameserver.getTable().areaType ? this.views.label.getComponent(cc.Label).string = "赢家每家分数 = 点数 * 底分 * 系统倍数（0.2）" : this.views.label.getComponent(cc.Label).string = "赢每家得分=分数x2^（番数之和）/100x底分x0.8";
},
getBasicTimes: function(e) {
switch (cc.mm.gameserver.getTable().areaType) {
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZYAY:
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDXJ:
return 1;

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YHGY:
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_PSHSS:
return window.Standalone.divideAmount(e.basicTimes, 10);

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20:
default:
return 1;
}
return 1;
},
updateOpCard: function(e, t) {
for (var i = {}, s = 0; s < t.length; s++) {
var a = null;
if (t[s].addToId && e.getChildByName(t[s].addToId)) a = e.getChildByName(t[s].addToId); else {
var o = (a = new cc.Node(t[s].id)).addComponent(cc.Layout);
o.type = cc.Layout.Type.HORIZONTAL;
o.resizeMode = cc.Layout.ResizeMode.CONTAINER;
o.spacingX = -45 * (1 - cc.winSize.width / 1334) - 45;
e.addChild(a);
}
var n = cc.js.array.copy(t[s].cards);
if (t[s].destCardChange > 0 && t[s].destCardChange > 100) {
n.push(t[s].destCardChange);
cc.js.array.remove(n, 1003);
}
this.updateHand(a, n, null);
if (a.children.length >= 6) {
var r = t[s].addToId || t[s].id;
i[r] && (i[r].active = !1);
var c = a.children[a.children.length - 1], h = cc.instantiate(this.views.zhangshu);
h.active = !0;
h.x = c.width / 2 + 10;
h.y = c.height - h.height + 20;
h.getChildByName("label").getComponent(cc.Label).string = a.children.length + "张";
c.addChild(h);
i[r] = h;
}
}
},
cmatch_card: function(e) {
if (1 == e.length && (1007 == e[0] || 1012 == e[0])) return e;
for (var t = new Map(), i = 0; i < e.length; i++) {
var s = this.getValue(e[i]);
t.has(s) || t.set(s, []);
t.get(s).push(e[i]);
}
for (var a = [], o = [], n = 0; n < 14; n++) if (t.has(n)) if (t.get(n).length > 1 || t.has(14 - n)) {
a = a.concat(t.get(n));
if (t.has(14 - n) && 7 != n) {
a = a.concat(t.get(14 - n));
t.delete(14 - n);
}
} else o = o.concat(t.get(n));
for (var r = [], c = 14; c < 17; c++) t.has(c) && (r = r.concat(t.get(c)));
return r.concat(a.concat(o));
},
getValue: function(e) {
return cc.mm.gamefunc.getCardValue(e);
},
getColor: function(e) {
return parseInt((e - 1) / 13);
},
updateHand: function(e, t, i) {
if (i) {
cc.js.array.remove(t, i);
(t = this.cmatch_card(t)).push(i);
} else t = this.cmatch_card(t);
for (var s = 0; s < t.length; s++) {
var a = cc.instantiate(cc.mm.dss.resmap.get("dss_card"));
e.addChild(a);
cc.mm.uitools.restNode(a);
var o = a.getComponent("dss_cardController");
o.setValue(t[s]);
o.setWidth(.4);
a.y = -50;
if (i == t[s] && t.length - 1 == s) {
var n = cc.instantiate(this.views.huImg);
n.active = !0;
n.x = a.width / 2;
n.y = a.height / 2;
n.width = a.width;
n.height = a.height;
a.addChild(n);
}
}
},
updateScore: function(e, t, i) {
var s = i.changeScore, positiveScore = window.Standalone.compareAmount(s, 0) > 0, a = positiveScore ? t : e;
e.active = !positiveScore;
t.active = positiveScore;
window.Standalone.scoreLabel(a, s);
a.active = !0;
},
updateHead: function(e, t, i) {
var s = t.nick;
s = s.length > 4 ? s.substring(0, 4) + ".." : s;
e.getChildByName("gy_wo").active = t.uid == cc.mm.framemodel.uid;
e.getChildByName("nameLabel").getComponent(cc.Label).string = s;
e.parent.getChildByName("fending").active = t.isFengDing && !e.parent.getChildByName("xiangqing").active;
e.getChildByName("zhuang").active = t.seatIndex == i;
e.getChildByName("gy_pc").active = t.isShuGuang;
cc.mm.uitools.loadRemote(t.picUrl, e.getChildByName("hall_head"));
cc.mm.uitools.changeHead(e.getChildByName("headcase"), t.headType);
var a = e.parent.getChildByName("bs_help_js_fddi");
t.isFengDing && cc.mm.uitools.addBtnLister(e.parent.getChildByName("fending"), this.onClickFengDing.bind(this, a), this);
},
onClickFengDing: function(e) {
e.active = !e.active;
},
addHuFlag: function(e, t) {
for (var i = cc.assetManager.getBundle(cc.mm.config.dss), s = n.huinan.server.proto.ENAreaType, a = 0; a < t.length; a++) {
var o = t[a];
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_ZYAY && (o == r.EN_CARD_TYPE_TIANHU ? o = 200 : o == r.EN_CARD_TYPE_DIHU && (o = 300));
if (cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_CDXJ) if (o == r.EN_CARD_TYPE_QUANHONG) o = 600; else if (o == r.EN_CARD_TYPE_QUANHEI) o = 700; else if (o == r.EN_CARD_TYPE_QIAN_HU) o = 2700; else if (o == r.EN_CARD_TYPE_HONG40 || o == r.EN_CARD_TYPE_HONG50) continue;
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_YAH20 && (o == r.EN_CARD_TYPE_QIA_20 ? o = 900 : o == r.EN_CARD_TYPE_SI_GEN ? o = 800 : o == r.EN_CARD_TYPE_QUANHONG ? o = 600 : o == r.EN_CARD_TYPE_QUANHEI && (o = 700));
cc.mm.gameserver.getTable().areaType != s.EN_AREA_TYPE_PKDDS_CDQL && cc.mm.gameserver.getTable().areaType != s.EN_AREA_TYPE_PKDDS_CDPJ || (o == r.EN_CARD_TYPE_QUANHONG ? o = 600 : o == r.EN_CARD_TYPE_QUANHEI ? o = 700 : o == r.EN_CARD_TYPE_QIA_20 && (o = 900));
if (this.getAb(cc.mm.gameserver.getTable().areaType)) {
o == r.EN_CARD_TYPE_SI_GEN && (o = 800);
o == r.EN_CARD_TYPE_JINGOUDIAO && (o = 1100);
o == r.EN_CARD_TYPE_CHELONG && (o = 1e3);
o == r.EN_CARD_TYPE_DIHU && (o = 1200);
}
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_BZPC && (o == r.EN_CARD_TYPE_QUANHEI ? o = 1300 : o == r.EN_CARD_TYPE_SI_GEN ? o = 800 : o == r.EN_CARD_TYPE_CHELONG && (o = 1400));
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_ABWC && (o == r.EN_CARD_TYPE_QIAN_HU ? o = 1500 : o == r.EN_CARD_TYPE_SU_HU ? o = 1600 : o == r.EN_CARD_TYPE_CHELONG ? o = 1700 : o == r.EN_CARD_TYPE_SI_GEN && (o = 800));
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_SCSN && o == r.EN_CARD_TYPE_SU_HU && (o = 1800);
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_GZLT && (o == r.EN_CARD_TYPE_QIAN_HU ? o = 1900 : o == r.EN_CARD_TYPE_SU_HU ? o = 2e3 : o == r.EN_CARD_TYPE_QIA_20 ? o = 900 : o == r.EN_CARD_TYPE_HONG_HU ? o = 600 : o == r.EN_CARD_TYPE_HEI_HU && (o = 700));
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_GY && (o == r.EN_CARD_TYPE_SI_GEN ? o = 800 : o == r.EN_CARD_TYPE_CHELONG && (o = 1700));
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_ZGRX && (o == r.EN_CARD_TYPE_SI_GEN ? o = 800 : o == r.EN_CARD_TYPE_BAOZI && (o = 2100));
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_YBXZ && (o == r.EN_CARD_TYPE_SI_GEN ? o = 800 : o == r.EN_CARD_TYPE_BAOZI && (o = 2100));
cc.mm.gameserver.getTable().areaType != s.EN_AREA_TYPE_PKDDS_YBJL_TY && cc.mm.gameserver.getTable().areaType != s.EN_AREA_TYPE_PKDDS_YBJL || (o == r.EN_CARD_TYPE_QIA_20 ? o = 2200 : o == r.EN_CARD_TYPE_QUAN_LAN ? o = 2300 : o == r.EN_CARD_TYPE_ANDUI ? o = 2400 : o == r.EN_CARD_TYPE_QIAN_HU ? o = 2500 : o == r.EN_CARD_TYPE_QIANG_GAN_HU && (o = 2600));
cc.mm.gameserver.getTable().areaType == s.EN_AREA_TYPE_PKDDS_LSGL && (o == r.EN_CARD_TYPE_HONG_HU ? o = 600 : o == r.EN_CARD_TYPE_HEI_HU ? o = 700 : o == r.EN_CARD_TYPE_SI_GEN ? o = 800 : o == r.EN_CARD_TYPE_QIA_20 && (o = 900));
i.load("res/result/hutype_" + o, cc.SpriteFrame, function(t, i) {
if (i) {
var s = new cc.Node();
s.addComponent(cc.Sprite).spriteFrame = i;
e.addChild(s);
}
});
}
e.getComponent(cc.Layout).updateLayout();
},
onClickShare: function() {
if (cc.sys.isNative && cc.sys.os == cc.sys.OS_IOS) jsb.reflection.callStaticMethod("AppController", "shareScreenshot"); else if (cc.sys.isNative && cc.sys.os == cc.sys.OS_ANDROID) cc.mm.uitools.share_image(); else {
var e = new Date();
e.getFullYear(), e.getUTCMonth(), e.getUTCDate(), e.getHours(), e.getSeconds(), 
e.getMilliseconds();
for (var t = this.getNameStr() + "房间号：" + this.body.roomId + " " + this.body.round + "局", i = "======玩家战绩====== \n", s = 0; s < this.body.userScoreInfo.length; s++) {
i += "昵称: " + this.body.userScoreInfo[s].nick + "\n";
i += "ID: " + this.body.userScoreInfo[s].uid + "\n";
i += "豆子: " + window.Standalone.signedAmount(this.body.userScoreInfo[s].score) + "\n";
i += "-----------------------------\n";
}
cc.mm.gameserver.setClipboard("四川红二十\n" + t + "\n\n" + i);
}
},
onClickExitBtn: function() {
cc.mm.assets.loadScene(cc.mm.config.hall, cc.mm.config.hallboot, cc.mm.config.scenegame);
},
onClickContinue: function() {
if (n.huinan.server.proto.ENRoomType.EN_ROOM_TYPE_FRIEND !== cc.mm.gameserver.getTable().roomType) {
cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyNextOperation, {
leftCardNum: 0
});
cc.mm.notification.emit(cc.mm.frametype.NTF_CLEAR_ROOM);
cc.mm.hallserver.requestJoinAmuse(cc.mm.gameserver.getTable().roomType, cc.mm.gameserver.getTable().areaType, cc.mm.hallserver.mLastRoomParam.yifupai);
} else {
cc.mm.notification.emit(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyNextOperation, {
leftCardNum: 0
});
cc.mm.notification.emit(cc.mm.frametype.NTF_CLEAR_PLAYER);
cc.mm.notification.emit(cc.mm.frametype.MSG_CLEAR_OPERATOR);
var e = new n.huinan.server.proto.MsgData();
e.hwRequestReadyForGame = new n.huinan.server.proto.HWRequestReadyForGame();
e.hwRequestReadyForGame.state = !0;
cc.mm.server.send(e, cc.mm.msgEvent.HWRequestReadyForGame, cc.mm.framemodel.uid);
}
cc.mm.notification.emit("clear_point_left_card", !1);
this.close();
},
getNameStr: function() {
var e, t, i, s, a, o;
if ("其他区域" == cc.mm.gameserver.xianName && "成都市" == cc.mm.gameserver.shiName) return "成都斗十四";
switch (cc.mm.hallserver.mLastRoomParam.areaType) {
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZYAY:
return "安岳斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDXJ:
return "其他区域" == cc.mm.gameserver.xianName && "眉山" == cc.mm.gameserver.shiName ? "眉山斗十四" : "彭山" == cc.mm.gameserver.xianName ? "彭山斗十四" : "新津斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YHGY:
return cc.mm.hallserver.mLastRoomParam.yifupai ? "勾鱼一副牌" : "勾鱼两副牌";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_PSHSS:
return "火十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20:
return "汉源" == cc.mm.gameserver.xianName ? "汉源红二十" : "雅安红二十";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDPJ:
return "蒲江斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_CDQL:
return "邛崃斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_AB:
return "阿坝斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABJC:
return ("其他区域" == cc.mm.gameserver.xianName ? "阿坝" : cc.mm.gameserver.xianName) + "斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABMEK:
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABXJ:
return "阿坝斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZPC:
return "平昌扯坨";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABWC:
case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABMX:
return "阿坝斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_MJ_YAXZ:
return "雅安麻将";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_MJ_LFXZ:
return "两房麻将";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_SCSN:
return null != (e = cc.mm.gameserver.xianName) && e.includes("射洪") ? "射洪斗十四" : "遂宁斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_GY:
return null != (t = cc.mm.gameserver.xianName) && t.includes("旺苍") ? "旺苍割胡" : "广元割胡";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_BZTJ:
return null != (i = cc.mm.gameserver.xianName) && i.includes("其他") ? "巴中斗十四" : "通江斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_GZLT:
return "理塘红斗";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZGRX:
return null != (s = cc.mm.gameserver.xianName) && s.includes("其他") ? "自贡斗十四" : "荣县斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSYX:
return "越西斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZTYJ:
return null != (a = cc.mm.gameserver.xianName) && a.includes("其他") ? "昭通斗十四" : "盐津斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YBXZ:
return null != (o = cc.mm.gameserver.xianName) && o.includes("其他") ? "宜宾斗十四" : "叙州斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSLB:
return "雷波斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YBJL_TY:
return "筠连斗十四";

case n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_LSGL:
return "甘洛斗十四";
}
return "";
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0
} ],
dss_tools: [ function(e, t) {
"use strict";
cc._RF.push(t, "e7b3dJoN5RAXKGJMf+tDkau", "dss_tools");
var i = e("../../../../Frame/src/buff/hw_msg").com, s = {
playSound: function(e, t) {
var i = cc.mm.gamefunc.getCardValue(t);
1001 == t ? i = 14 : 1002 == t ? i = 15 : 1003 == t && (i = 16);
cc.mm.soundManager.playSound(cc.mm.config.dss, "res/sound/" + this.getFile(e) + i);
},
playGameSound: function(e) {
cc.mm.soundManager.playSound(cc.mm.config.dss, "res/sound/games/" + e);
},
playMagicFace: function(e) {
cc.mm.soundManager.playSound(cc.mm.config.resources, "sound/magicFace/game_magicFace_" + (e - 1));
},
getCard: function(e) {
var t = cc.mm.hallserver.mLastRoomParam.areaType, s = i.huinan.server.proto.ENAreaType, a = cc.mm.hallserver.mLastRoomParam.siCaiErJing;
return t != s.EN_AREA_TYPE_PKDDS_ZTYJ || !a || 107 != e && 207 != e && 307 != e && 407 != e ? cc.mm.dss.resmap.get(String(e)) : cc.mm.dss.resmap.get(String(1004));
},
playOperator: function(e, t, s, a) {
var o = "", n = a == i.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZTYJ;
t === i.huinan.server.proto.ENActionType.EN_ACTION_TOU ? o = n ? "chen" : "tou" : t === i.huinan.server.proto.ENActionType.EN_ACTION_HU ? o = "hu" : t === i.huinan.server.proto.ENActionType.EN_ACTION_GUO ? o = "guo" : t === i.huinan.server.proto.ENActionType.EN_ACTION_GANG ? o = n && s == i.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_BA ? "ba" : n && s == i.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_MING ? "dasha" : n && s == i.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_AN ? "dachen" : "gang" : t === i.huinan.server.proto.ENActionType.EN_ACTION_PENG ? o = n ? "sha" : "peng" : t === i.huinan.server.proto.ENActionType.EN_ACTION_CHI ? o = "chi" : t === i.huinan.server.proto.ENActionType.EN_ACTION_BAO_TING ? o = "ting" : t === i.huinan.server.proto.ENActionType.EN_ACTION_HUAN_CARD ? o = "ti" : t === i.huinan.server.proto.ENActionType.EN_ACTION_PIAO ? o = "piao" : t == i.huinan.server.proto.ENActionType.EN_ACTION_HU_ZI_QIANG ? o = "ziqiang" : t == i.huinan.server.proto.ENActionType.EN_ACTION_HU_QIANG && (o = "qianghu");
cc.mm.soundManager.playSound(cc.mm.config.dss, "res/sound/" + this.getFile(e, n) + o);
},
getFile: function(e) {
return (e ? "woman/Woman_" : "man/Man_") + (cc.mm.hallserver.mLastRoomParam.areaType == i.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZTYJ ? "sc_" : "");
},
getSkeletonnName: function(e, t, s) {
void 0 === t && (t = 0);
void 0 === s && (s = 0);
if (e === i.huinan.server.proto.ENActionType.EN_ACTION_GANG && s == i.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZTYJ) {
if (t == i.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_AN) return "dachen";
if (t == i.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_MING) return "dasha";
if (t == i.huinan.server.proto.ENColType.EN_COL_TYPE_GANG_BA) return "ba";
}
return e === i.huinan.server.proto.ENActionType.EN_ACTION_TOU ? s == i.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZTYJ ? "chen" : "tou" : e === i.huinan.server.proto.ENActionType.EN_ACTION_HU ? "hu" : e === i.huinan.server.proto.ENActionType.EN_ACTION_GANG ? "gang" : e === i.huinan.server.proto.ENActionType.EN_ACTION_PENG ? s == i.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZTYJ ? "sha" : "peng" : e === i.huinan.server.proto.ENActionType.EN_ACTION_CHI ? "chi" : e === i.huinan.server.proto.ENActionType.EN_ACTION_BAO_TING ? "bao" : e == i.huinan.server.proto.ENActionType.EN_ACTION_PIAO ? "piao" : e == i.huinan.server.proto.ENActionType.EN_ACTION_HUAN_CARD ? "ti" : null;
}
};
t.exports = s;
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0
} ],
dssboot: [ function(e, t) {
"use strict";
cc._RF.push(t, "1961eXKGyZKE7IAfXUhdOHs", "dssboot");
var i = {
init: function() {
cc.mm.dss = {};
cc.mm.dss.resmap = new Map();
this._loadedSuc = 0;
this._callback = null;
this._prefabList = [ "res/prefab/dss_game", "res/prefab/dss_player", "res/prefab/dss_card" ];
this._spines = [ "res/spines/dahu", "res/spines/xiaohu", "res/spines/jinershi", "res/spines/shilaiyunzhuan", "res/spines/caiyuangungun", "res/spines/hongyundangtou", "res/spines/shouqiquankai", "res/spines/dihu", "res/spines/tianhu", "res/spines/qianghu", "res/spines/ziqiang", "res/spines/dui", "res/spines/chuan", "res/spines/cheng", "res/spines/ti", "res/spines/chen", "res/spines/dachen", "res/spines/dasha", "res/spines/sha", "res/spines/ba", "res/spines/duizihu", "res/spines/gangshanghua", "res/spines/heihu", "res/spines/honghu", "res/spines/heiwushi", "res/spines/hongwushi", "res/spines/bao", "res/spines/chi", "res/spines/gang", "res/spines/hu", "res/spines/peng", "res/spines/piao", "res/spines/hu", "res/spines/tou" ];
console.log("dss boot init");
},
loadRes: function() {
var e = this, t = cc.assetManager.getBundle(cc.mm.config.dss);
t.load(this._prefabList, cc.Prefab, function(t, i) {
e._loadedSuc++;
e.setResMap(i);
});
t.loadDir("res/cards", cc.SpriteFrame, function(t, i) {
e._loadedSuc++;
e.setResMap(i);
});
t.load(this._spines, sp.SkeletonData, function(t, i) {
e._loadedSuc++;
e.setResMap(i);
});
cc.resources.load("prefab/MarryUI", cc.Prefab, function(t, i) {
e._loadedSuc++;
e.setResMap([ i ]);
});
},
setResMap: function(e) {
for (var t = 0; t < e.length; t++) cc.mm.dss.resmap.set(e[t].name, e[t]);
4 === this._loadedSuc && this._callback.call(this, cc.mm.dss.resmap.get("dss_game"));
},
setProgressCallback: function(e) {
this._callprogressback = e;
},
setFinishCallback: function(e) {
this._callback = e;
}
};
t.exports = i;
cc._RF.pop();
}, {} ]
}, {}, [ "dss_evenType", "dds_xiangqingController", "dss_cardController", "dss_gameController", "dss_playerController", "dss_selectController", "dss_settle_UIController", "dssboot", "dss_gameModel", "dss_playerModel", "dss_tools" ]);