window.__require = function e(t, i, s) {
function n(a, c) {
if (!i[a]) {
if (!t[a]) {
var l = a.split("/");
l = l[l.length - 1];
if (!t[l]) {
var m = "function" == typeof __require && __require;
if (!c && m) return m(l, !0);
if (o) return o(l, !0);
throw new Error("Cannot find module '" + a + "'");
}
a = l;
}
var r = i[a] = {
exports: {}
};
t[a][0].call(r.exports, function(e) {
return n(t[a][1][e] || e);
}, r, r.exports, e, t, i, s);
}
return i[a].exports;
}
for (var o = "function" == typeof __require && __require, a = 0; a < s.length; a++) n(s[a]);
return n;
}({
ClubCreateUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "3611e6B+ahMSLUFWjyGXE7X", "ClubCreateUIController");
var i = e("UIController");
e("HallEventType");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/common_close"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["root/create_club_btns"], this.onClickCreateBtn.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_CREATE_CLUB, this._ntfCreateClub.bind(this), this);
},
onClickCreateBtn: function() {
var e = this.views["root/editbox"].getComponent(cc.EditBox).string;
"" !== e ? cc.mm.hallserver.requestCreateClub(encodeURIComponent(e), 2001) : cc.mm.uimanager.showTextPrompt("输入正确的亲友圈昵称");
},
_ntfCreateClub: function(e) {
if (e.errcode > 0) cc.mm.uimanager.showTextPrompt("创建亲友圈失败"); else {
cc.mm.uimanager.showTextPrompt("创建亲友圈成功");
cc.mm.hallserver.requestMyClub();
this.close();
}
}
});
cc._RF.pop();
}, {
HallEventType: "HallEventType",
UIController: void 0
} ],
ClubInfoUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "ed662kS5RNKbYPvK9ovPxb/", "ClubInfoUIController");
var i = e("UIController");
e("HallEventType");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this.club_data = null;
this.rules = {};
this.ruleid = null;
this.signalRule = null;
this.select_rule = null;
this.ruleBtns = {};
this.roomItems = {};
this.schedule(this.__updateClubRule.bind(this), 2);
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["down_btns/add_rule_btn"], this.onClickAddRuleBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.common_close, this.onClose.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["down_btns/club_log_btn"], this.onClickClubLogs.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["down_btns/menber_btn"], this.onClickClubMenber.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.removeClubBtn, this.onClickRemoveClub.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.updateClubBtn, this.onClickChangeNameClub.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.noticeClubBtn, this.onClickNoticeBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.exitClubBtn, this.onClickEXitBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.shareClubBtn, this.onClickShareBtn.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_ADD_CLUB_RULE, this._ntfAddClubRule.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_DEL_CLUB_RULE, this._ntfDelClubRule.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_EDIT_CLUB_RULE, this._ntfEditClubRule.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_GET_CLUB_RULE, this._ntfGetClubRule.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_GET_CLUB_ROOM_LIST, this._ntfRoomListClubRule.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_LOG_LIST, this._ntfClubGameLog.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_GET_CLUB_USER, this._ntfCulbUser.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_GET_CLUB_ADD_ROOM, this._ntfAddClubRoom.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_GET_UPDATE_CLUB_NOTICE, this._ntfUpdateClubNotice.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_UPDATE_SIGNAL_RULE, this._ntfUpdateSingalRule.bind(this), this);
},
_ntfUpdateSingalRule: function(e) {
for (var t in e.params.list) {
this.rules[t] = e.params.list[t];
for (var i in this.rules[t].showroominfo) {
var s = this.rules[t].showroominfo[i];
if (this.roomItems[i]) {
console.log("这里更新");
cc.mm.uitools.labelSetString(this.roomItems[i].getChildByName("count_label"), "人数:" + s.players_num);
} else this.__createRoomItem(s);
}
}
},
_ntfUpdateClubNotice: function(e) {
this.club_data.notice = base64("encode", e.params.notice);
},
_ntfClubGameLog: function() {},
_ntfAddClubRule: function(e) {
this.rules[e.params.ruleid] = {};
this.rules[e.params.ruleid].otherinfo = e.params.otherinfo;
this.rules[e.params.ruleid].rule = e.params.ruleinfo;
this.rules[e.params.ruleid].showroominfo = e.params.showroominfo;
this.__createSingelRule(e.params.ruleid, this.rules[e.params.ruleid]);
1 === Object.keys(this.ruleBtns).length && this.onClickRuleBtn({
node: this.ruleBtns[Object.keys(this.ruleBtns)[0]]
});
},
_ntfDelClubRule: function(e) {
this.ruleBtns[e.params.ruleid].removeFromParent(!0);
this.ruleBtns[e.params.ruleid].destroy();
delete this.ruleBtns[e.params.ruleid];
delete this.rules[e.params.ruleid];
e.params.ruleid === this.ruleid && 1 === Object.keys(this.ruleBtns).length && this.onClickRuleBtn({
node: this.ruleBtns[Object.keys(this.ruleBtns)[0]]
});
},
_ntfEditClubRule: function(e) {
this.rules[e.params.ruleid].rule = e.params.ruleinfo;
},
_ntfAddClubRoom: function(e) {
this.rules[e.params.ruleid].showroominfo[e.params.showroominfo.id] = e.params.showroominfo;
if (this.club_data.create_userid == cc.mm.framemodel.uid) {
var t = this.views["room_scroll/view/content"].getChildByName("create_room");
this.views["room_scroll/view/content"].removeChild(t, !0);
}
this.ruleid == e.params.ruleid && this.__createRoomItem(e.params.showroominfo);
if (this.club_data.create_userid == cc.mm.framemodel.uid) {
var i = cc.instantiate(this.views.create_room);
cc.mm.uitools.restNode(i);
this.views["room_scroll/view/content"].addChild(i);
cc.mm.uitools.addBtnLister(i, this.onClickCreateRoom.bind(this), this);
}
},
_ntfCulbUser: function(e) {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "ClubMenberUI", {
club: this.club_data,
msg: e
});
},
_ntfGetClubRule: function(e) {
this.views["scrollview/view/content"].removeAllChildren(!0);
this.select_rule = null;
this.rules = e.params.list || {};
for (var t in e.params.list) this.__createSingelRule(t, e.params.list[t]);
Object.keys(this.ruleBtns).length && this.onClickRuleBtn({
node: this.ruleBtns[Object.keys(this.ruleBtns)[0]]
});
},
__createSingelRule: function(e, t) {
var i = cc.instantiate(this.views.RuleItem);
cc.mm.uitools.restNode(i);
i.groupIndex = e;
var s = i.getChildByName("setBtn"), n = i.getChildByName("editBtn");
s.groupIndex = e;
n.groupIndex = e;
cc.mm.uitools.labelSetString(i.getChildByName("name_label"), base64("decode", t.otherinfo.rulename));
cc.mm.uitools.addBtnLister(s, this.onClickSetBtn.bind(this), this);
cc.mm.uitools.addBtnLister(n, this.onClickEditRule.bind(this), this);
cc.mm.uitools.addBtnLister(i, this.onClickRuleBtn.bind(this), this);
this.views["scrollview/view/content"].addChild(i);
this.ruleBtns[e] = i;
},
_ntfRoomListClubRule: function(e) {
this.views["room_scroll/view/content"].removeAllChildren(!0);
for (var t in e.dataList) this.__createRoomItem(e.dataList[t]);
if (this.club_data.create_userid == cc.mm.framemodel.uid) {
var i = cc.instantiate(this.views.create_room);
cc.mm.uitools.restNode(i);
this.views["room_scroll/view/content"].addChild(i);
cc.mm.uitools.addBtnLister(i, this.onClickCreateRoom.bind(this), this);
}
},
__createRoomItem: function(e) {
var t = cc.instantiate(this.views.roomItem);
cc.mm.uitools.restNode(t);
t.groupIndex = e.id;
this.views["room_scroll/view/content"].addChild(t);
cc.mm.uitools.labelSetString(t.getChildByName("count_label"), "人数:" + e.players_num);
cc.mm.uitools.addBtnLister(t, this.onClickRoomBtn.bind(this), this);
this.roomItems[e.id] = t;
},
onClickRoomBtn: function(e) {
cc.mm.hallserver.requestEnterClubRoom(this.club_data.clid, this.ruleid, e.node.groupIndex, this.rules[this.ruleid].rule, this.club_data.gameid);
},
onClose: function() {
this.close();
cc.mm.uimanager.visibleWindow("ClubUI");
},
reLoad: function(e) {
this.club_data = e;
cc.mm.uitools.labelSetString(this.views.culb_label, base64("decode", e.clname));
cc.mm.uitools.labelSetString(this.views.culb_id, "ID: " + e.clid);
cc.mm.hallserver.requestGetClubRule(e.clid, "");
this.views.updateClubBtn.active = this.club_data.create_userid == cc.mm.framemodel.uid;
this.views.removeClubBtn.active = this.club_data.create_userid == cc.mm.framemodel.uid;
this.views["down_btns/add_rule_btn"].active = this.club_data.create_userid == cc.mm.framemodel.uid;
this.views.exitClubBtn.active = this.club_data.create_userid != cc.mm.framemodel.uid;
},
onClickClubLogs: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "ClubRecordUI", {
club: this.club_data
});
},
onClickClubMenber: function() {
cc.mm.hallserver.requstClubUser(this.club_data.clid);
},
onClickRemoveClub: function() {
var e = this, t = {
title: "提示",
prompt: "您确定要解散亲友圈吗？",
sureCall: function() {
var t = e.club_data.clid;
cc.mm.hallserver.requestRemoveClub(e.club_data.clid);
e.close();
cc.mm.uimanager.visibleWindow("ClubUI");
cc.mm.notification.emit(cc.mm.frametype.NTF_CLUB_REMOVE_VIEW, t);
}
};
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonMsgUI", t);
},
onClickEXitBtn: function() {
var e = this, t = {
title: "提示",
prompt: "您确定要退出亲友圈吗？",
sureCall: function() {
var t = e.club_data.clid;
cc.mm.hallserver.requestExitClub(e.club_data.clid);
e.close();
cc.mm.uimanager.visibleWindow("ClubUI");
cc.mm.notification.emit(cc.mm.frametype.NTF_CLUB_REMOVE_VIEW, t);
}
};
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonMsgUI", t);
},
onClickCreateRoom: function() {
cc.mm.hallserver.requestAddClubShowRoom(this.club_data.clid, this.ruleid);
},
onClickRuleBtn: function(e) {
if (this.select_rule !== e.node) {
this.select_rule && (this.select_rule.getChildByName("club_select_rule").active = !1);
e.node.getChildByName("club_select_rule").active = !0;
this.signalRule = this.rules[e.node.groupIndex].showroominfo;
this.ruleid = e.node.groupIndex;
this._ntfRoomListClubRule({
dataList: this.signalRule
});
this._updateRule(this.rules[e.node.groupIndex].rule);
this.select_rule = e.node;
}
},
_updateRule: function(e) {
var t = this.views["down_btns/rule_box/label"], i = "规则: " + [ "", "房主均摊", "房主承担", "冠军承担" ][e.config_roomfree] + " " + e.config_count + "局 " + e.config_players + "人 ";
if (2001 == this.club_data.gameid) {
i += [ "", "梯坎翻", "跟斗翻" ][e.config_fan];
e.config_addKing && (i += " 加王花牌");
e.config_addSeven && (i += " 牌7当王");
e.config_TianHu && (i += " 天胡3翻");
e.config_DiHu && (i += " 地胡3翻");
e.config_BaoJiao && (i += " 报叫");
e.config_QiaErShi && (i += " 恰二十");
}
cc.mm.uitools.labelSetString(t, "游戏: 新津斗14 \n" + i);
},
onClickAddRuleBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "ClubRuleUI", {
club: this.club_data,
rule: null
});
},
onClickEditRule: function(e) {
var t = this, i = {
type: "edit",
title: "更新昵称",
warn: "输入正确的包间昵称",
prompt: "规则的昵称",
editSucCall: function(i) {
var s = t.rules[e.node.groupIndex].rule;
cc.mm.hallserver.requestEditClubRule(t.club_data.clid, t.ruleid, s, i);
}
};
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonEditUI", i);
},
onClickSetBtn: function(e) {
var t = this.rules[e.node.groupIndex].rule, i = this.rules[e.node.groupIndex].otherinfo.rulename;
cc.mm.uimanager.showWindow(cc.mm.config.hall, "ClubRuleUI", {
name: i,
club: this.club_data,
ruleid: e.node.groupIndex,
rule: t
});
},
onClickChangeNameClub: function() {
var e = this, t = {
type: "edit",
title: "更新昵称",
prompt: "亲友圈昵称",
warn: "输入正确的亲友圈昵称",
editSucCall: function(t) {
cc.mm.hallserver.requestUpdateClub(e.club_data.clid, encodeURIComponent(t));
}
};
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonEditUI", t);
},
onClickNoticeBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "ClubNoticeUI", {
club: this.club_data
});
},
onClickShareBtn: function() {},
__updateClubRule: function() {
this.ruleid && cc.mm.hallserver.requestUpdateSignalRule(this.club_data.clid, this.ruleid);
}
});
cc._RF.pop();
}, {
HallEventType: "HallEventType",
UIController: void 0
} ],
ClubJoinUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "31186N9/K9L0r0MF0KTDxB+", "ClubJoinUIController");
function i(e, t) {
var i = "undefined" != typeof Symbol && e[Symbol.iterator] || e["@@iterator"];
if (i) return (i = i.call(e)).next.bind(i);
if (Array.isArray(e) || (i = s(e)) || t && e && "number" == typeof e.length) {
i && (e = i);
var n = 0;
return function() {
return n >= e.length ? {
done: !0
} : {
done: !1,
value: e[n++]
};
};
}
throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function s(e, t) {
if (e) {
if ("string" == typeof e) return n(e, t);
var i = Object.prototype.toString.call(e).slice(8, -1);
"Object" === i && e.constructor && (i = e.constructor.name);
return "Map" === i || "Set" === i ? Array.from(e) : "Arguments" === i || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(i) ? n(e, t) : void 0;
}
}
function n(e, t) {
(null == t || t > e.length) && (t = e.length);
for (var i = 0, s = new Array(t); i < t; i++) s[i] = e[i];
return s;
}
var o = e("UIController");
cc.Class({
extends: o,
onLoad: function() {
this._super();
this.roomid = "";
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/common_close"], this.onClickbackBtn.bind(this), this);
for (var e, t = i(this.views["root/outputNodes"]._children); !(e = t()).done; ) {
var s = e.value;
cc.mm.uitools.addBtnLister(s, this.onClickOutputBtn.bind(this), this);
}
},
onClickbackBtn: function() {
this.close();
},
onClickOutputBtn: function(e) {
var t = e.node.getChildByName("label").getComponent(cc.Label).string;
if (isNaN(parseInt(t)) && "X" === t) {
console.log("这里是需要删除");
this.roomid.length && (this.roomid = this.roomid.substring(0, this.roomid.length - 1));
} else if (isNaN(parseInt(t)) && "X" !== t) {
console.log("这里是清除");
this.roomid = "";
} else {
console.log("这里是房间号");
this.roomid.length < this.views["root/inputNodes"].getChildrenCount() && (this.roomid = this.roomid.concat(t));
}
this.updateRoomText();
},
updateRoomText: function() {
console.log("房间号:" + this.roomid);
for (var e = 0; e < this.roomid.length; e++) this.views["root/inputNodes"]._children[e].getComponent(cc.Label).string = this.roomid[e];
for (var t = this.roomid.length; t < this.views["root/inputNodes"].getChildrenCount(); t++) this.views["root/inputNodes"]._children[t].getComponent(cc.Label).string = "";
6 === this.roomid.length && cc.mm.hallserver.requestJoinClub(this.roomid);
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
ClubMenberUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "68aeffX5hNHB4g81s2qHofN", "ClubMenberUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/common_close"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["root/requestBtn"], this.onTouchRequest.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_GET_CLUB_JOIN_USER_LIST, this._ntfResponseUerList.bind(this), this);
},
reLoad: function(e) {
this.club_data = e.club;
for (var t = 0; t < e.msg.dataList.length; t++) this.__createSingeMenber(e.msg.dataList[t]);
this.views["root/requestBtn"].active = parseInt(this.club_data.create_userid) === parseInt(cc.mm.framemodel.uid);
},
onClickRemoveUser: function(e) {
cc.mm.hallserver.requestRemoveUser(this.club_data.clid, e.node.data);
e.node.parent.removeFromParent(!0);
},
_ntfResponseUerList: function(e) {
this.views["root/request_list"].active = !0;
this.views["root/request_list/scrollview/view/content"].removeAllChildren(!0);
for (var t = 0; t < e.dataList.length; t++) {
var i = cc.instantiate(this.views["root/request_list/request_item"]);
cc.mm.uitools.restNode(i);
cc.mm.uitools.labelSetString(i.getChildByName("name_label"), e.dataList[t].name);
cc.mm.uitools.labelSetString(i.getChildByName("userid_label"), e.dataList[t].userid);
cc.mm.uitools.loadRemote(e.dataList[t].headimg, i.getChildByName("head"));
i.getChildByName("sureBtn").data = e.dataList[t];
i.getChildByName("cancelBtn").data = e.dataList[t];
cc.mm.uitools.addBtnLister(i.getChildByName("sureBtn"), this.onTouchRequestArgee.bind(this), this);
cc.mm.uitools.addBtnLister(i.getChildByName("cancelBtn"), this.onTouchRequestNotArgee.bind(this), this);
this.views["root/request_list/scrollview/view/content"].addChild(i);
}
},
__createSingeMenber: function(e) {
var t = cc.instantiate(this.views["root/menber_item"]);
cc.mm.uitools.restNode(t);
cc.mm.uitools.labelSetString(t.getChildByName("name_label"), e.name);
cc.mm.uitools.labelSetString(t.getChildByName("userid_label"), e.userid);
cc.mm.uitools.loadRemote(e.headimg, t.getChildByName("head"));
t.getChildByName("removeBtn").data = e.userid;
cc.mm.uitools.addBtnLister(t.getChildByName("removeBtn"), this.onClickRemoveUser.bind(this), this);
t.getChildByName("removeBtn").active = parseInt(this.club_data.create_userid) === parseInt(cc.mm.framemodel.uid) && parseInt(this.club_data.create_userid) !== parseInt(e.userid);
cc.mm.uitools.labelSetString(t.getChildByName("state_label"), parseInt(this.club_data.create_userid) === parseInt(e.userid) ? "管理" : "成员");
this.views["root/scrollview/view/content"].addChild(t);
},
onTouchRequestArgee: function(e) {
cc.mm.hallserver.requestCheckUserClub(this.club_data.clid, e.node.data.userid, 1);
this.__createSingeMenber(e.node.data);
e.node.getParent().removeFromParent(!0);
e.node.getParent().destroy();
},
onTouchRequestNotArgee: function(e) {
cc.mm.hallserver.requestCheckUserClub(this.club_data.clid, e.node.data.userid, 0);
e.node.getParent().removeFromParent(!0);
e.node.getParent().destroy();
},
onTouchRequest: function() {
this.views["root/request_list"].active = !this.views["root/request_list"].active;
this.views["root/request_list"].active && cc.mm.hallserver.requestJoinList(this.club_data.clid);
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
ClubNoticeUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "c92f4LsSUxAlrZ7Dii3LXes", "ClubNoticeUIController");
var i = e("UIController");
e("HallEventType");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this.club_data = null;
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/common_close"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["root/edit_msg_btns"], this.onClickCreateBtn.bind(this), this);
},
reLoad: function(e) {
this.club_data = e.club;
this.views["root/editbox"].getComponent(cc.EditBox).string = base64("decode", this.club_data.notice);
this.views["root/edit_msg_btns"].active = this.club_data.create_userid == cc.mm.framemodel.uid;
},
onClickCreateBtn: function() {
var e = this.views["root/editbox"].getComponent(cc.EditBox).string;
cc.mm.hallserver.requestUpdateClubNotice(this.club_data.clid, encodeURIComponent(e));
}
});
cc._RF.pop();
}, {
HallEventType: "HallEventType",
UIController: void 0
} ],
ClubRecordUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "fcca5K0lFxBQJybiLcqqc4r", "ClubRecordUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/common_close"], this.close.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_LOG_LIST, this._ntfGameLogList.bind(this), this);
},
reLoad: function(e) {
this.club_data = e.club;
cc.mm.hallserver.requestHistoryList(this.club_data.gameid, this.club_data.clid);
},
_ntfGameLogList: function(e) {
for (var t = 0; t < e.length; t++) this.__createSingeMenber(e[t]);
},
__createSingeMenber: function(e) {
var t = cc.instantiate(this.views["root/menber_item"]);
cc.mm.uitools.restNode(t);
cc.mm.uitools.labelSetString(t.getChildByName("time_label"), cc.mm.gamefunc.getTime(e.endtime));
cc.mm.uitools.labelSetString(t.getChildByName("room_label"), e.roomid);
cc.mm.uitools.labelSetString(t.getChildByName("count_label"), e.config_count);
cc.mm.uitools.labelSetString(t.getChildByName("score_label"), e.config_score);
t.getChildByName("removeBtn").data = e.userid;
cc.mm.uitools.addBtnLister(t.getChildByName("removeBtn"), this.onClickRemoveUser.bind(this), this);
this.views["root/scrollview/view/content"].addChild(t);
},
onTouchRequest: function() {
this.views["root/request_list"].active = !this.views["root/request_list"].active;
this.views["root/request_list"].active && cc.mm.hallserver.requestJoinList(this.club_data.clid);
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
ClubRuleUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "21020KVfZxIAY2CtTaXjsrE", "ClubRuleUIController");
var i = e("UIController");
e("HallEventType");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this.toggles = {};
this._rules = {};
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["hall_room_center/backBtn"], this.onClickbackBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hall_room_center/createroom"], this.onClickCreateRoom.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hall_room_center/helpBtn"], this.onClickHelpBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hall_room_center/delbtn"], this.onClickDelBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hall_room_center/editbtn"], this.onClickEditBtn.bind(this), this);
},
reLoad: function(e) {
console.log(e);
this.club_data = e.club;
this.rulename = e.name;
this.game_rules = e.rule ? e.rule : null;
this.ruleid = e.ruleid;
this.loadGameConfig(cc.mm.gameconfig[0].rule);
this.views["hall_room_center/createroom"].active = !e.rule;
this.views["hall_room_center/delbtn"].active = !this.views["hall_room_center/createroom"].active;
this.views["hall_room_center/editbtn"].active = !this.views["hall_room_center/createroom"].active;
},
onClickCreateRoom: function() {
var e = {};
for (var t in this._rules) this._rules[t] && (e[t] = this._rules[t]);
e.config_score = 1;
cc.mm.hallserver.requestAddClubRule(this.club_data.clid, e, "包间");
this.close();
},
onClickDelBtn: function() {
cc.mm.hallserver.requestDelClubRule(this.club_data.clid, this.ruleid);
this.close();
},
onClickEditBtn: function() {
var e = {};
for (var t in this._rules) this._rules[t] && (e[t] = this._rules[t]);
e.config_score = 1;
cc.mm.hallserver.requestEditClubRule(this.club_data.clid, this.ruleid, e, this.rulename);
this.close();
},
onClickbackBtn: function() {
this.close();
},
onClickHelpBtn: function() {},
loadGameConfig: function(e) {
this.views["hall_room_center/ruleNode/view/content"].removeAllChildren(!0);
for (var t in e) {
var i = cc.instantiate(this.views.ruleView);
cc.mm.uitools.restNode(i);
i.getChildByName("label").getComponent(cc.Label).string = e[t].name;
for (var s in e[t].config) {
var n = e[t].config[s], o = cc.instantiate(i.getChildByName("rules").getChildByName("item"));
cc.mm.uitools.restNode(o);
o.getChildByName("label").getComponent(cc.Label).string = n.name;
i.getChildByName("rules").addChild(o);
var a = new cc.Component.EventHandler();
a.target = this.node;
a.component = "ClubRuleUIController";
a.handler = "onClickToggle";
a.customEventData = e[t].multiple ? n.value : t;
o.getChildByName("toggle").getComponent(cc.Toggle).checkEvents.push(a);
if (this.game_rules) {
if (e[t].multiple) {
this._rules[n.value] = this.game_rules[n.value];
o.getChildByName("toggle").getComponent(cc.Toggle).isChecked = this.game_rules[n.value];
} else if (this.game_rules[t]) {
var c = this.game_rules[t] === n.value;
o.getChildByName("toggle").getComponent(cc.Toggle).isChecked = c;
this._rules[t] = n.value;
}
} else {
o.getChildByName("toggle").getComponent(cc.Toggle).isChecked = n.default;
e[t].multiple ? this._rules[n.value] = n.default : n.default && (this._rules[t] = n.value);
}
if (!e[t].multiple) {
this.toggles[t] || (this.toggles[t] = []);
o.getChildByName("toggle").groupIndex = n.value;
this.toggles[t].push(o.getChildByName("toggle").getComponent(cc.Toggle));
}
}
var l = Math.ceil(e[t].config.length / 3);
i.height = 60 * (l <= 0 ? 1 : l);
i.getChildByName("line").y = -1 * i.height;
this.views["hall_room_center/ruleNode/view/content"].addChild(i);
}
},
onClickToggle: function(e, t) {
if (this.toggles[t]) {
for (var i = 0; i < this.toggles[t].length; i++) e.node === this.toggles[t][i].node ? this.toggles[t][i].check() : this.toggles[t][i].uncheck();
this._rules[t] = e.node.groupIndex;
} else this._rules[t] = e.node.getComponent(cc.Toggle).isChecked;
}
});
cc._RF.pop();
}, {
HallEventType: "HallEventType",
UIController: void 0
} ],
ClubUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "86c0bMeFJlEBZtnuivyejxn", "ClubUIController");
var i = e("UIController"), s = e("HallEventType");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this.clubs = {};
cc.mm.hallserver.requestMyClub();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views.join_club_btn, this.onClickJoinBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.create_club_btn, this.onClickCreateBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.closeBtn, this.onClickbackBtn.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_MY_CLUB, this.loadUI.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_CLUB_REMOVE_VIEW, this._ntfClubRemove.bind(this), this);
},
onClickbackBtn: function() {
this.close();
cc.mm.notification.emit(s.HALL_NOTICE_SHOW_VIEW, this.node.name);
},
onClickJoinBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "ClubJoinUI");
},
onClickCreateBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "ClubCreateUI");
},
loadUI: function(e) {
this.views["club_list/view/content"].removeAllChildren(!0);
for (var t = 0; t < e.dataList.length; t++) {
var i = cc.instantiate(this.views.club_item);
cc.mm.uitools.restNode(i);
i.data = e.dataList[t];
i.getChildByName("club_label").getComponent(cc.Label).string = base64("decode", e.dataList[t].clname);
i.getChildByName("create_user_label").getComponent(cc.Label).string = "创建者: " + e.dataList[t].create_userid;
i.getChildByName("onlie_num_label").getComponent(cc.Label).string = "亲友圈人数: " + e.dataList[t].usernum;
i.getChildByName("club_id_label").getComponent(cc.Label).string = "亲友圈ID: " + e.dataList[t].clid;
this.views["club_list/view/content"].addChild(i);
cc.mm.uitools.addBtnLister(i, this.onClickClubBtn.bind(this), this);
this.clubs[e.dataList[t].clid] = i;
}
},
_ntfClubRemove: function(e) {
if (this.clubs[e]) {
this.clubs[e].removeFromParent(!0);
delete this.clubs[e];
}
},
onClickClubBtn: function(e) {
var t = e.node.data;
cc.mm.uimanager.showWindowHideLast(cc.mm.config.hall, "ClubInfoUI", "ClubUI", t);
}
});
cc._RF.pop();
}, {
HallEventType: "HallEventType",
UIController: void 0
} ],
CreateRoomUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "8cdbd/FXPVCp4TznPpFcRvF", "CreateRoomUIController");
var i = e("UIController"), s = e("HallEventType"), n = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._lastTouchBtn = null;
this._gameBtns = [];
this.toggles = {};
this._rules = {};
var e = cc.sys.localStorage.getItem("game_last_room_data");
null != e && e.length && (this._lastRoomData = JSON.parse(e));
this._areaType = 0;
this._scrollview = this.views["hall_room_center/left/ruleNode"].getComponent(cc.ScrollView);
this._scrollview.verticalScrollBar.enableAutoHide = !1;
this.loadGames();
this._tspx = null;
this.views["hall_room_center/games/qiehuan/label"].getComponent(cc.Label).string = cc.mm.gamefunc.replaceCity(cc.mm.framemodel.shiName) + "·" + cc.mm.gamefunc.replaceCity(cc.mm.framemodel.xianName);
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views.tipnode, this.onClickBgBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hall_room_center/games/backBtn"], this.onClickbackBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hall_room_center/left/createroom"], this.onClickCreateRoom.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hall_room_center/games/qiehuan"], this.onClickLoction.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hall_room_center/games/anniu-zhanji"], this.onClickRecord.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hall_room_center/left/joinbtn"], this.onClickJoinBtn.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_UPDATA_USER_INFO, this._ntfChangeLocation.bind(this), this);
},
_ntfChangeLocation: function(e) {
if (this._areaType != cc.mm.framemodel.areaType[0] || e) {
this.views["hall_room_center/games/qiehuan/label"].getComponent(cc.Label).string = cc.mm.gamefunc.replaceCity(cc.mm.framemodel.shiName) + "·" + cc.mm.gamefunc.replaceCity(cc.mm.framemodel.xianName);
this.views["hall_room_center/games/scrollview/view/content"].removeAllChildren(!0);
this._gameBtns.length = 0;
this._lastTouchBtn = null;
this.loadGames();
}
},
onClickLoction: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallMapUI");
},
onClickJoinBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "JoinRoomUI");
},
onClickRecord: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallRecordUI");
},
onClickCreateRoom: function() {
var e = this;
if (cc.sys.isBrowser && this._rules.openGps) navigator.geolocation.getCurrentPosition(function(t) {
cc.mm.gameserver.locationLat = t.coords.latitude;
cc.mm.gameserver.longitude = t.coords.locationIng;
if (!window.Standalone.createRoom(e, e._rules, e._areaType)) return;
e._rules.gameid = e._areaType;
cc.sys.localStorage.setItem("game_last_room_data", JSON.stringify(e._rules));
}, function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "LocationTip", null);
}); else {
if (!window.Standalone.createRoom(this, this._rules, this._areaType)) return;
this._rules.gameid = this._areaType;
cc.sys.localStorage.setItem("game_last_room_data", JSON.stringify(this._rules));
}
},
onClickbackBtn: function() {
this.close();
cc.mm.notification.emit(s.HALL_NOTICE_SHOW_VIEW, this.node.name);
},
onClickHelpBtn: function() {},
loadGames: function() {
for (var e = cc.sys.localStorage.getItem("GAME_LAST_COME"), t = 0, i = 0; i < cc.mm.framemodel.areaType.length; i++) if (window.Standalone.supportsArea(cc.mm.framemodel.areaType[i])) for (var s = cc.mm.gameconfig[cc.mm.framemodel.areaType[i]], o = 0; o < s.length; o++) {
var a = cc.instantiate(this.views.baseGameBtn);
cc.mm.uitools.restNode(a);
a.data = s[o];
a.groupIndex = parseInt(s[o].gameId);
a.getChildByName("label").getComponent(cc.Label).string = s[o].name;
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = s[o].name;
this.views["hall_room_center/games/scrollview/view/content"].addChild(a);
cc.mm.uitools.addBtnLister(a, this.onClickGameBtn.bind(this), this);
this._gameBtns.push(a);
e == s[o].name && (t = this._gameBtns.length - 1);
if (s[o].gameId < 500 && "其他区域" == cc.mm.framemodel.xianName && "成都市" == cc.mm.framemodel.shiName) {
a.getChildByName("label").getComponent(cc.Label).string = "成都斗十四";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "成都斗十四";
} else if (s[o].gameId < 500 && "射洪" == cc.mm.framemodel.xianName) {
a.getChildByName("label").getComponent(cc.Label).string = "射洪斗十四";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "射洪斗十四";
} else if (s[o].gameId < 500 && "其他区域" == cc.mm.framemodel.xianName && "巴中市" == cc.mm.framemodel.shiName) {
a.getChildByName("label").getComponent(cc.Label).string = "巴中斗十四";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "巴中斗十四";
} else if (s[o].gameId < 500 && "旺苍" == cc.mm.framemodel.xianName) {
a.getChildByName("label").getComponent(cc.Label).string = "旺苍割胡";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "旺苍割胡";
} else if (s[o].gameId < 500 && cc.mm.framemodel.xianName.includes("其他") && cc.mm.framemodel.shiName.includes("自贡")) {
a.getChildByName("label").getComponent(cc.Label).string = "自贡斗十四";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "自贡斗十四";
} else if (s[o].gameId < 500 && cc.mm.framemodel.xianName.includes("其他") && cc.mm.framemodel.shiName.includes("昭通")) {
a.getChildByName("label").getComponent(cc.Label).string = "昭通斗十四";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "昭通斗十四";
} else if (s[o].gameId < 500 && cc.mm.framemodel.xianName.includes("其他") && cc.mm.framemodel.shiName.includes("宜宾")) {
a.getChildByName("label").getComponent(cc.Label).string = "宜宾斗十四";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "宜宾斗十四";
} else if (n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABJC == +s[o].gameId) {
var c = "其他区域" == cc.mm.framemodel.xianName ? "阿坝" : cc.mm.framemodel.xianName;
a.getChildByName("label").getComponent(cc.Label).string = c + "斗十四";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = c + "斗十四";
} else if (s[o].gameId < 500 && "彭山" == cc.mm.framemodel.xianName) {
a.getChildByName("label").getComponent(cc.Label).string = "彭山斗十四";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "彭山斗十四";
} else if (s[o].gameId < 500 && "其他区域" == cc.mm.framemodel.xianName && "眉山" == cc.mm.framemodel.shiName) {
a.getChildByName("label").getComponent(cc.Label).string = "眉山斗十四";
a.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "眉山斗十四";
}
}
this.onClickGameBtn({
node: this._gameBtns[t]
});
this.changeCost();
},
onClickGameBtn: function(e) {
var t, i;
this._lastTouchBtn && (this._lastTouchBtn.getChildByName("selectImg").active = !1);
e.node.getChildByName("selectImg").active = !0;
this._lastTouchBtn = e.node;
this._areaType = e.node.data.gameId;
this._rules = {};
this.toggles = {};
var s = JSON.parse(JSON.stringify(e.node.data.rule));
if (null != (t = cc.mm.framemodel.xianName) && t.includes("汶川") || "茂县" == cc.mm.framemodel.xianName) {
var n = Object.keys(s);
s.config_tingyong = {
name: "听用",
multiple: 0,
maxCell: 3,
param: "hpToTingyong",
config: [ {
name: "不打听用",
value: 0,
default: 0
}, {
name: "白皮当听用",
value: 1,
default: 1
} ]
};
n.splice(n.length - 2, 0, "config_tingyong");
for (var o = {}, a = 0; a < n.length; a++) o[n[a]] = s[n[a]];
s = o;
}
if (false) {
var c = Object.keys(s);
s.config_hu = {
name: "胡牌:",
multiple: 0,
maxCell: 3,
param: "processType",
config: [ {
name: "经典玩法",
value: 1,
default: 1
}, {
name: "血战玩法",
value: 2,
default: 0
} ]
};
c.splice(c.length - 5, 0, "config_hu");
for (var l = {}, m = 0; m < c.length; m++) l[c[m]] = s[c[m]];
s = l;
}
if ((null == (i = this._lastRoomData) ? void 0 : i.gameid) == this._areaType) {
this._rules = this._lastRoomData;
for (var r in s) {
var h = s[r].config;
if (s[r].param) for (var d = 0; d < h.length; d++) h[d].default = h[d].value == this._rules[s[r].param]; else if ("config_playmethod" == r) for (var u = 0; u < h.length; u++) if (Object.prototype.hasOwnProperty.call(this._rules, h[u].value)) h[u].default = this._rules[h[u].value];
}
}
this.loadGameConfig(s);
this._rules.yifupai = "勾鱼两副牌" !== e.node.data.name;
cc.sys.localStorage.setItem("GAME_LAST_COME", e.node.data.name);
this.changeCost();
window.Standalone.createRoomOptions(this);
},
loadGameConfig: function(e) {
this._scrollview.content.removeAllChildren(!0);
for (var t in e) {
var i = cc.instantiate(this.views["hall_room_center/left/ruleNode/view/ruleView"]);
cc.mm.uitools.restNode(i);
i.getChildByName("label").getComponent(cc.Label).string = e[t].name;
var s = 0;
"config_chaofan" == t && (i.getChildByName("label").getComponent(cc.Label).horizontalAlign = cc.Label.HorizontalAlign.LEFT);
for (var n in e[t].config) {
var o = e[t].config[n], a = "config_playmethod" == t ? "item_type_2" : "item_type_1", c = cc.instantiate(i.getChildByName("rules").getChildByName(a));
cc.mm.uitools.restNode(c);
c.getChildByName("label").getComponent(cc.Label).string = o.name;
i.getChildByName("rules").addChild(c);
c.getChildByName("toggle").getComponent(cc.Toggle).isChecked = o.default;
c.getChildByName("wenhao").active = o.wenhao && o.wenhao.length;
c.getChildByName("wenhao").active && cc.mm.uitools.addBtnLister(c.getChildByName("wenhao"), this.onClickWenHao.bind(this, o.wenhao), this);
c.getChildByName("label").getComponent(cc.Label)._forceUpdateRenderData();
"bage10tianhu" == o.value && (this._tspx = c);
c.getChildByName("label").color = o.default ? cc.color(39, 160, 141) : cc.color(158, 138, 123);
var l = e[t].multiple ? o.value : e[t].param;
cc.mm.uitools.addBtnLister(c, this.onClickToggle.bind(this, c.getChildByName("toggle"), l), this);
e[t].multiple ? this._rules[o.value] = o.default : o.default && (this._rules[e[t].param] = o.value);
if (!e[t].multiple) {
this.toggles[e[t].param] || (this.toggles[e[t].param] = []);
c.getChildByName("toggle").groupIndex = o.value;
this.toggles[e[t].param].push(c.getChildByName("toggle").getComponent(cc.Toggle));
}
var m = c.getChildByName("label").width + c.getChildByName("toggle").width + 10;
c.getChildByName("wenhao").active && (m += c.getChildByName("wenhao").width + 10);
var r = e[t].offset ? e[t].offset : 3 == e[t].maxCell ? 220 : 200;
r *= cc.winSize.width / 1334;
c.x = s * r + m / 2;
if (++s > e[t].maxCell && s <= 2 * e[t].maxCell) {
c.y = -60;
c.x = (s - e[t].maxCell - 1) * r + m / 2;
} else if (s > 2 * e[t].maxCell && s <= 3 * e[t].maxCell) {
c.y = -120;
c.x = (s - 2 * e[t].maxCell - 1) * r + m / 2;
} else if (s > 3 * e[t].maxCell) {
c.y = -180;
c.x = (s - 3 * e[t].maxCell - 1) * r + m / 2;
}
}
var h = Math.ceil(e[t].config.length / e[t].maxCell);
i.height = 60 * (h <= 0 ? 1 : h);
i.getChildByName("line").y = i.getChildByName("line").y - 50 * h;
this._scrollview.content.addChild(i, 1, e[t].param);
}
this._scrollview.scrollToTop(.5, !0);
if (3 == this._areaType && this._tspx) {
this._tspx.active = !this._rules.yifupai;
this._rules.bage10tianhu = this._tspx.active;
}
},
onClickWenHao: function(e, t) {
var i = this;
this.views.tipnode.active = !0;
var s = t.node.convertToWorldSpaceAR(cc.Vec2.ZERO), n = this.node.convertToNodeSpaceAR(s);
if ("所有人均摊" == e || "由创建房间玩家一人承担" == e) if (this.views["tipnode/upTip"].active) this.views["tipnode/upTip"].runAction(cc.sequence(cc.scaleTo(.3, 0).easing(cc.easeBounceOut()), cc.callFunc(function() {
i.views["tipnode/upTip"].active = !1;
}))); else {
n.y -= 20;
this.views["tipnode/upTip/label"].getComponent(cc.Label).string = e;
this.views["tipnode/upTip"].setPosition(n);
this.views["tipnode/upTip"].active = !0;
this.views["tipnode/upTip"].scale = 0;
this.views["tipnode/upTip"].runAction(cc.scaleTo(.3, 1).easing(cc.easeBounceOut()));
} else if (s.x + this.views["tipnode/leftTip"].width + 50 < cc.winSize.width) if (this.views["tipnode/leftTip"].active) this.views["tipnode/leftTip"].runAction(cc.sequence(cc.scaleTo(.3, 0).easing(cc.easeBounceOut()), cc.callFunc(function() {
i.views["tipnode/leftTip"].active = !1;
}))); else {
n.x -= 40;
n.y += 20;
this.views["tipnode/leftTip/label"].getComponent(cc.Label).string = e;
this.views["tipnode/leftTip"].setPosition(n);
this.views["tipnode/leftTip"].active = !0;
this.views["tipnode/leftTip"].scale = 0;
this.views["tipnode/leftTip"].runAction(cc.scaleTo(.3, 1).easing(cc.easeBounceOut()));
} else {
this.views["tipnode/rightTip"].height = 104;
if (this.views["tipnode/rightTip"].active) this.views["tipnode/rightTip"].runAction(cc.sequence(cc.scaleTo(.3, 0).easing(cc.easeBounceOut()), cc.callFunc(function() {
i.views["tipnode/rightTip"].active = !1;
}))); else {
n.x += 20;
n.y += 20;
this.views["tipnode/rightTip/label"].getComponent(cc.Label).string = e;
this.views["tipnode/rightTip"].setPosition(n);
this.views["tipnode/rightTip"].active = !0;
this.views["tipnode/rightTip"].scale = 0;
this.views["tipnode/rightTip"].runAction(cc.scaleTo(.3, 1).easing(cc.easeBounceOut()));
this.views["tipnode/rightTip/label"].getComponent(cc.Label)._forceUpdateRenderData();
this.views["tipnode/rightTip"].height = Math.max(this.views["tipnode/rightTip/label"].height + 30, this.views["tipnode/rightTip"].height);
}
}
},
onClickBgBtn: function() {
var e = this;
this.views["tipnode/leftTip"].runAction(cc.sequence(cc.scaleTo(.3, 0).easing(cc.easeBounceOut()), cc.callFunc(function() {
e.views["tipnode/leftTip"].active = !1;
e.views.tipnode.active = !1;
})));
this.views["tipnode/rightTip"].runAction(cc.sequence(cc.scaleTo(.3, 0).easing(cc.easeBounceOut()), cc.callFunc(function() {
e.views["tipnode/rightTip"].active = !1;
e.views.tipnode.active = !1;
})));
this.views["tipnode/upTip"].runAction(cc.sequence(cc.scaleTo(.3, 0).easing(cc.easeBounceOut()), cc.callFunc(function() {
e.views["tipnode/upTip"].active = !1;
e.views.tipnode.active = !1;
})));
},
getAb: function(e) {
var t = n.huinan.server.proto.ENAreaType;
return e == t.EN_AREA_TYPE_PKDDS_AB || e == t.EN_AREA_TYPE_PKDDS_ABXJ || e == t.EN_AREA_TYPE_PKDDS_ABMEK || e == t.EN_AREA_TYPE_PKDDS_ABJC;
},
changeCost: function() {
if (cc.mm.gameserver.isFree(this._areaType)) {
this.views["hall_room_center/left/createroom/fire"].active = !0;
this.views["hall_room_center/left/createroom/ad"].active = !1;
this.views["hall_room_center/left/createroom/conume"].active = !1;
this.views["hall_room_center/left/createroom/dou-hall-pic-mianfei"].active = !0;
} else {
this.views["hall_room_center/left/createroom/dou-hall-pic-mianfei"].active = !1;
this.views["hall_room_center/left/createroom/conume"].active = !0;
this.views["hall_room_center/left/createroom/fire"].active = !1;
this.views["hall_room_center/left/createroom/ad"].active = !0;
2 == this._rules.useCardType ? this.views["hall_room_center/left/createroom/ad/label"].getComponent(cc.Label).string = this._rules.gameNum / 4 : this.views["hall_room_center/left/createroom/ad/label"].getComponent(cc.Label).string = this._rules.gameNum / 4 * (this._rules.playerNum || 3);
}
},
onClickToggle: function(e, t) {
if (this.toggles[t]) {
for (var i = 0; i < this.toggles[t].length; i++) if (e === this.toggles[t][i].node) {
this.toggles[t][i].check();
e.parent.getChildByName("label").color = cc.color(39, 160, 141);
} else {
this.toggles[t][i].uncheck();
this.toggles[t][i].node.parent.getChildByName("label").color = cc.color(158, 138, 123);
}
this._rules[t] = e.groupIndex;
"playerNum" != t || 6 != this._areaType && 4 != this._areaType || !Array.isArray(this.toggles.ziChi) || (3 == this._rules[t] ? this.onClickToggle(this.toggles.ziChi[0].node, "ziChi") : this.onClickToggle(this.toggles.ziChi[1].node, "ziChi"));
"playerNum" == t && this.getAb(this._areaType) && Array.isArray(this.toggles.huRedScore) && (3 == this._rules[t] ? this.onClickToggle(this.toggles.huRedScore[0].node, "huRedScore") : this.onClickToggle(this.toggles.huRedScore[1].node, "huRedScore"));
if (this._areaType == n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ZGRX) if ("maxFan" == t) {
99 == this._rules[t] && (this._rules.chaoFanJiaDi = 0);
this._scrollview.content.getChildByName("chaoFanJiaDi").active = 99 != this._rules[t];
} else if ("playerNum" == t) {
3 == this._rules[t] && (this._rules.daXiaoJia = 0);
this._scrollview.content.getChildByName("daXiaoJia").active = 3 != this._rules[t];
}
} else {
var s = e.getComponent(cc.Toggle).isChecked;
s ? e.getComponent(cc.Toggle).uncheck() : e.getComponent(cc.Toggle).check();
this._rules[t] = s ? 0 : 1;
e.parent.getChildByName("label").color = s ? cc.color(158, 138, 123) : cc.color(39, 160, 141);
}
if (3 == this._areaType && this._tspx) {
this._tspx.active = !this._rules.yifupai;
this._rules.bage10tianhu = this._tspx.active;
}
this.changeCost();
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
HallEventType: "HallEventType",
UIController: void 0
} ],
DoubleHolidayUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "d8894lZv95MooC/oFzTswCz", "DoubleHolidayUIController");
var i = e("UIController");
e("HallEventType"), e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/button-close"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/buyBtn2"], this.onClickbuyBtn2.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/buyBtn1"], this.onClickbuyBtn1.bind(this), this);
},
onClickbuyBtn1: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonSelectPayUI", {
id: 106
});
},
onClickbuyBtn2: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonSelectPayUI", {
id: 107
});
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
HallEventType: "HallEventType",
UIController: void 0
} ],
EventRecallResultUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "b474aUco5tAhLuxIC3pupWk", "EventRecallResultUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/togoBtn"], this.close.bind(this), this);
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
EventRecallUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "ac88fnrMPtKZaRr8UBWAZ8L", "EventRecallUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/togoBtn"], this.onClick_zhaohui.bind(this), this);
},
onClick_zhaohui: function() {
this.close();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "RecallFriend");
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
FriendListUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "3f1absfEuxIB4CcUVuiLueG", "FriendListUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
cc.mm.hallserver.requestAllFriend();
window.Standalone.friends(this);
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views.backBtn, this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["baoshan-pic-chendi/baoshan-button-yaoqing"], this.onClick_yaoqingckBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["baoshan-pic-chendi/baoshan-button-zhaohui"], this.onClick_zhaohui.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseGetFriends, this._ntfFriends.bind(this), this);
},
_ntfFriends: function(e) {
window.Standalone.renderFriends(this, e);
return;
var t = this;
if (!e.gradeInfo.length) {
this.views["baoshan-pic-chendi/baoshan-pic-tishi"].active = 0 == e.friendAll.length;
for (var i = function(i) {
var s = cc.instantiate(t.views.item);
s.active = !0;
t.views.scrollview.getComponent(cc.ScrollView).content.addChild(s);
s.getChildByName("idx").getComponent(cc.Label).string = e.friendAll[i].recordId;
s.getChildByName("laiyuan").getComponent(cc.Label).string = e.friendAll[i].source;
s.getChildByName("state").getComponent(cc.Label).string = e.friendAll[i].online;
2 != e.friendAll[i].online.length && (s.getChildByName("state").color = cc.color(175, 194, 214));
var n = s.getChildByName("hallHeadBtn");
cc.mm.uitools.changeHead(n.getChildByName("headcase"), e.friendAll[i].headType);
var o = e.friendAll[i].nick;
o = o.length > 4 ? o.substring(0, 4) + ".." : o;
n.getChildByName("namelabel").getComponent(cc.Label).string = o;
cc.mm.uitools.loadRemote(e.friendAll[i].picUrl, n.getChildByName("hallHead"));
s.getChildByName("kexuan").active = e.friendAll[i].keZhaohui;
s.getChildByName("bukexuan").active = !e.friendAll[i].keZhaohui;
cc.mm.uitools.addBtnLister(s.getChildByName("kexuan"), t.onClick_zhaohui.bind(t), t);
cc.loader.loadRes("frames/head_" + e.friendAll[i].maxGoldLevel, cc.SpriteFrame, function(e, t) {
e || cc.isValid(s.getChildByName("head_201")) && (s.getChildByName("head_201").getComponent(cc.Sprite).spriteFrame = t);
});
}, s = 0; s < e.friendAll.length; s++) i(s);
}
},
onClick_yaoqingckBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallFriendUI");
},
onClick_zhaohui: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "RecallFriend");
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
H5DownloadUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "e71a6adbxFJ17HKF8NxKsVB", "H5DownloadUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.close.bind(this), this);
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
HallActivityUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "50659dPdy9O47tLFsappxv5", "HallActivityUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this.loadUI();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["bg/closeBtn"], this.close.bind(this), this);
},
onClickShouQuanBtn: function() {},
loadUI: function() {}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
HallAmuseUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "2cb4ce3A+JNv4wo8FNqMl8w", "HallAmuseUIController");
var i = e("UIController"), s = e("HallEventType"), n = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._gameBtns = [];
this._lastTouchBtn = null;
this._areaType = 0;
this._yifupai = !1;
this._ntfChangeLocation(!0);
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["left/select_1"], this.onClickGotoGame.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["left/select_2"], this.onClickGotoGame.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["left/select_3"], this.onClickGotoGame.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["left/select_4"], this.onClickGotoGame.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.fireReward, this.onClickfireReward.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["games/qiehuan"], this.onClickLoction.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.backBtn, this.onClickbackBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["left/quick_start"], this.onClickQuickBtn.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_UPDATA_USER_INFO, this._ntfChangeLocation.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["left/createroom"], this.onClickCreateRoom.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["left/joinbtn"], this.onClickJoinBtn.bind(this), this);
},
start: function() {},
onClickCreateRoom: function() {
this.close();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "CreateRoomUI");
},
onClickJoinBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "JoinRoomUI");
},
onClickfireReward: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallTaskUI");
},
_ntfChangeLocation: function(e) {
if (e) {
this.views["games/qiehuan/label"].getComponent(cc.Label).string = cc.mm.gamefunc.replaceCity(cc.mm.framemodel.shiName) + "·" + cc.mm.gamefunc.replaceCity(cc.mm.framemodel.xianName);
this.views["games/scrollview/view/content"].removeAllChildren(!0);
this._gameBtns.length = 0;
this._lastTouchBtn = null;
this.loadGames();
this.changeCost();
}
},
changeCost: function() {
cc.mm.gameserver.isFree(this._areaType) ? this.views["left/createroom/dou-hall-pic-mianfei"].active = !0 : this.views["left/createroom/dou-hall-pic-mianfei"].active = !1;
},
onClickbackBtn: function() {
this.close();
cc.mm.notification.emit(s.HALL_NOTICE_SHOW_VIEW, this.node.name);
},
onClickLoction: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallMapUI");
},
loadGames: function() {
for (var e = 0, t = 0; t < cc.mm.framemodel.areaType.length; t++) for (var i = cc.mm.gameconfig[cc.mm.framemodel.areaType[t]], s = 0; s < i.length; s++) {
var o = cc.instantiate(this.views.baseGameBtn);
cc.mm.uitools.restNode(o);
o.data = i[s];
o.getChildByName("label").getComponent(cc.Label).string = i[s].name;
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = i[s].name;
this.views["games/scrollview/view/content"].addChild(o);
cc.mm.uitools.addBtnLister(o, this.onClickGameBtn.bind(this), this);
this._gameBtns.push(o);
cc.mm.gameserver.lastgame == i[s].name && (e = this._gameBtns.length - 1);
if ("红二十血战" != i[s].name) if (i[s].gameId < 500 && "其他区域" == cc.mm.framemodel.xianName && "成都市" == cc.mm.framemodel.shiName) {
o.getChildByName("label").getComponent(cc.Label).string = "成都斗十四";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "成都斗十四";
} else if (i[s].gameId < 101 && "射洪" == cc.mm.framemodel.xianName) {
o.getChildByName("label").getComponent(cc.Label).string = "射洪斗十四";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "射洪斗十四";
} else if (i[s].gameId < 101 && "其他区域" == cc.mm.framemodel.xianName && "巴中市" == cc.mm.framemodel.shiName) {
o.getChildByName("label").getComponent(cc.Label).string = "巴中斗十四";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "巴中斗十四";
} else if (i[s].gameId < 101 && "旺苍" == cc.mm.framemodel.xianName) {
o.getChildByName("label").getComponent(cc.Label).string = "旺苍割胡";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "旺苍割胡";
} else if (i[s].gameId < 101 && cc.mm.framemodel.xianName.includes("其他") && cc.mm.framemodel.shiName.includes("自贡")) {
o.getChildByName("label").getComponent(cc.Label).string = "自贡斗十四";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "自贡斗十四";
} else if (i[s].gameId < 101 && cc.mm.framemodel.xianName.includes("其他") && cc.mm.framemodel.shiName.includes("昭通")) {
o.getChildByName("label").getComponent(cc.Label).string = "昭通斗十四";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "昭通斗十四";
} else if (i[s].gameId < 101 && cc.mm.framemodel.xianName.includes("其他") && cc.mm.framemodel.shiName.includes("宜宾")) {
o.getChildByName("label").getComponent(cc.Label).string = "宜宾斗十四";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "宜宾斗十四";
} else if (n.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_ABJC == +i[s].gameId) {
var a = "其他区域" == cc.mm.framemodel.xianName ? "阿坝" : cc.mm.framemodel.xianName;
o.getChildByName("label").getComponent(cc.Label).string = a + "斗十四";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = a + "斗十四";
} else if (i[s].gameId < 101 && "彭山" == cc.mm.framemodel.xianName) {
o.getChildByName("label").getComponent(cc.Label).string = "彭山斗十四";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "彭山斗十四";
} else if (i[s].gameId < 101 && "其他区域" == cc.mm.framemodel.xianName && "眉山" == cc.mm.framemodel.shiName) {
o.getChildByName("label").getComponent(cc.Label).string = "眉山斗十四";
o.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "眉山斗十四";
}
}
cc.mm.gameserver.lastgame.includes("红二十") || !cc.mm.gameserver.lastgame.includes("血战") && !cc.mm.gameserver.lastgame.includes("麻将") ? cc.mm.gameserver.lastgame.includes("跑得快") && (e = this._gameBtns.length - 1) : e = this._gameBtns.length - 2;
this._gameBtns.length && this.onClickGameBtn({
node: this._gameBtns[e]
});
this._gameBtns.length || (Array.isArray(cc.mm.framemodel.areaType) && cc.mm.framemodel.areaType.length ? cc.mm.hallserver.requestGoldList(cc.mm.framemodel.areaType[0]) : cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallMapUI"));
},
onClickGotoGame: function(e) {
cc.mm.hallserver.requestJoinAmuse(e.node.data.roomType, this._areaType, this._yifupai);
},
onClickGameBtn: function(e) {
this._lastTouchBtn && (this._lastTouchBtn.getChildByName("selectImg").active = !1);
e.node.getChildByName("selectImg").active = !0;
this._lastTouchBtn = e.node;
this._areaType = e.node.data.gameId;
this._yifupai = "勾鱼两副牌" != e.node.data.name;
this.loadGameConfig(e.node.data);
this.changeCost();
},
onClickQuickBtn: function() {
this.onClickGotoGame({
node: this.views["left/select_1"]
});
},
loadGameConfig: function() {
for (var e = 0; e < cc.mm.config.roomConfig.length; e++) {
var t = this.views["left/select_" + (e + 1)], i = t.getChildByName("base_score"), s = t.getChildByName("label_start");
this.views["left/select_" + (e + 1)].data = cc.mm.config.roomConfig[e];
i.getComponent(cc.Label).string = cc.mm.config.roomConfig[e].scoreRate;
cc.mm.config.roomConfig[e].maxGold ? s.getComponent(cc.Label).string = "准入：" + cc.mm.gamefunc.numformat(cc.mm.config.roomConfig[e].minGold, 0) + "-" + cc.mm.gamefunc.numformat(cc.mm.config.roomConfig[e].maxGold, 0) : s.getComponent(cc.Label).string = "准入：" + cc.mm.gamefunc.numformat(cc.mm.config.roomConfig[e].minGold, 0);
}
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
HallEventType: "HallEventType",
UIController: void 0
} ],
HallAuthenticationController: [ function(e, t) {
"use strict";
cc._RF.push(t, "7432erO/UtNBYyPQupmQrhF", "HallAuthenticationController");
var i = e("UIController"), s = (e("HallEventType"), e("../../../../Frame/src/buff/hw_msg").com);
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/authBtn"], this.onClick_authBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.onClick_closeBtn.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseShiMing, this._ntfAuth.bind(this), this);
},
_ntfAuth: function(e) {
if (1 == e.result) {
cc.mm.framemodel.isSmrz = !0;
cc.mm.framemodel.realName = this.views["view/name_editbox"].getComponent(cc.EditBox).string;
cc.mm.framemodel.realSfzh = this.views["view/idcard_editbox"].getComponent(cc.EditBox).string;
cc.mm.uimanager.showTextPrompt("认证成功");
cc.mm.uimanager.closewindow("HallAuthentication");
if (this.GetAge(cc.mm.framemodel.realSfzh) < 18) {
var t = {
title: "提示",
prompt: "游戏不对未成年人开发，给你带来的不便敬请谅解，谢谢",
sureCall: function() {
cc.game.end();
},
showCancel: !1
};
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonMsgUI", t);
cc.mm.server.selfClose = !0;
cc.mm.server.closeServer();
}
this.close();
} else 1102 == e.result || 1105 == e.result ? cc.mm.uimanager.showTextPrompt(cc.mm.frametype["CODE_ERROR_" + e.result]) : cc.mm.uimanager.showTextPrompt("认证成功失败");
},
GetAge: function(e) {
var t = "", i = e.length;
18 == i ? t = e.substr(6, 4) + "/" + e.substr(10, 2) + "/" + e.substr(12, 2) : 15 == i && (t = "19" + e.substr(6, 2) + "/" + e.substr(8, 2) + "/" + e.substr(10, 2));
var s = new Date(t), n = new Date(), o = n.getFullYear() - s.getFullYear();
(n.getMonth() < s.getMonth() || n.getMonth() == s.getMonth() && n.getDate() < s.getDate()) && o--;
return o;
},
isChinese: function(e) {
for (var t = 0; t < e.length; t++) if (e.charCodeAt(t) <= 255) return !1;
return !0;
},
onClick_authBtn: function() {
var e = this.views["view/name_editbox"].getComponent(cc.EditBox).string, t = this.views["view/idcard_editbox"].getComponent(cc.EditBox).string;
if (this.isChinese(e)) if (this.isIdCard(t)) {
var i = new s.huinan.server.proto.MsgData();
i.hwRequestShiMing = new s.huinan.server.proto.HWRequestShiMing();
i.hwRequestShiMing.IDCard = t;
i.hwRequestShiMing.name = e;
cc.mm.server.send(i, cc.mm.msgEvent.HWRequestShiMing);
} else cc.mm.uimanager.showTextPrompt("身份证不合法"); else cc.mm.uimanager.showTextPrompt("姓名不合法");
},
onClick_closeBtn: function() {
this.close();
},
isIdCard: function(e) {
var t = [ 7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2 ], i = 0;
if (!/^[1-9]\d{5}(19\d{2}|[2-9]\d{3})((0\d)|(1[0-2]))(([0|1|2]\d)|3[0-1])(\d{4}|\d{3}X)$/i.test(e)) return !1;
var s = e.substr(6, 4), n = e.substr(10, 2), o = e.substr(12, 2);
if (e.substr(6, 8) != this.dateToString(new Date(s + "/" + n + "/" + o))) return !1;
for (var a = 0; a < e.length - 1; a++) i += e[a] * t[a];
var c = "10X98765432"[i % 11];
return e[e.length - 1].toUpperCase() == c;
},
dateToString: function(e) {
if (e instanceof Date) {
var t = e.getFullYear(), i = e.getMonth() + 1;
i = i < 10 ? "0" + i : i;
var s = e.getDate();
return "" + t + i + (s < 10 ? "0" + s : s);
}
return "";
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
HallEventType: "HallEventType",
UIController: void 0
} ],
HallConfirmController: [ function(e, t) {
"use strict";
cc._RF.push(t, "1c8c05DM+tCq6ldvGPC99HK", "HallConfirmController");
var i = e("UIController"), s = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._namestr = "";
this._idStr = "";
},
reLoad: function(e) {
this._namestr = e.name;
this._idStr = e.id;
this.views["view/nameLabel"].getComponent(cc.Label).string = "真实姓名：" + e.name;
this.views["view/IdLabel"].getComponent(cc.Label).string = "身份账号：" + e.id;
this.views["view/yearLabel"].getComponent(cc.Label).string = this.GetAge(e.id) < 18 ? "未成年" : "已成年";
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/surebtnBtn"], this.onClick_authBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/cancelbtn"], this.onClick_cancelbtn.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseShiMing, this._ntfAuth.bind(this), this);
},
_ntfAuth: function(e) {
if (1 == e.result) {
cc.mm.framemodel.isSmrz = !0;
cc.mm.framemodel.realName = this._namestr;
cc.mm.framemodel.realSfzh = this._idStr;
cc.mm.uimanager.showTextPrompt("认证成功");
cc.mm.uimanager.closewindow("HallAuthentication");
if (this.GetAge(this._idStr) < 18) {
var t = {
title: "提示",
prompt: "游戏不对未成年人开发，给你带来的不便敬请谅解，谢谢",
sureCall: function() {
cc.game.end();
},
showCancel: !1
};
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonMsgUI", t);
cc.mm.server.selfClose = !0;
cc.mm.server.closeServer();
}
this.close();
}
},
onClick_authBtn: function() {
var e = new s.huinan.server.proto.MsgData();
e.hwRequestShiMing = new s.huinan.server.proto.HWRequestShiMing();
e.hwRequestShiMing.IDCard = this._idStr;
e.hwRequestShiMing.name = this._namestr;
cc.mm.server.send(e, cc.mm.msgEvent.HWRequestShiMing);
},
onClick_cancelbtn: function() {
this.close();
},
GetAge: function(e) {
var t = "", i = e.length;
18 == i ? t = e.substr(6, 4) + "/" + e.substr(10, 2) + "/" + e.substr(12, 2) : 15 == i && (t = "19" + e.substr(6, 2) + "/" + e.substr(8, 2) + "/" + e.substr(10, 2));
var s = new Date(t), n = new Date(), o = n.getFullYear() - s.getFullYear();
(n.getMonth() < s.getMonth() || n.getMonth() == s.getMonth() && n.getDate() < s.getDate()) && o--;
return o;
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0
} ],
HallEventType: [ function(e, t) {
"use strict";
cc._RF.push(t, "c0e93SetmBLD7Tr0Ai0f1xf", "HallEventType");
t.exports = {
HALL_NOTICE_SHOW_VIEW: "HALL_SHOW_VIEW",
HALL_NOTICE_SHOW_COIN: "HALL_NOTICE_SHOW_COIN",
HALL_NOTICE_USER_DATA: "HALL_NOTICE_USER_DATA"
};
cc._RF.pop();
}, {} ],
HallExChangeUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "43b192lFsdJ1aZvrlh71b8s", "HallExChangeUIController");
var i = e("UIController"), s = e("HallEventType");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._gameBtns = [];
this._lastTouchBtn = null;
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views.closeBtn, this.onClickbackBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["toggleContainer/toggle1"], this.onClickGameBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["toggleContainer/toggle2"], this.onClickGameBtn.bind(this), this);
for (var e = 0; e < this.views.Items.childrenCount; e++) cc.mm.uitools.addBtnLister(this.views.Items.children[e], this.onClickItem.bind(this), this);
},
onClickbackBtn: function() {
this.close();
cc.mm.notification.emit(s.HALL_NOTICE_SHOW_VIEW, this.node.name);
},
onClickGameBtn: function(e) {
this.views.Items.active = "toggle1" === e.node.name;
this.views.scrollview.active = "toggle2" === e.node.name;
},
onClickItem: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallSureExchangeUI");
}
});
cc._RF.pop();
}, {
HallEventType: "HallEventType",
UIController: void 0
} ],
HallFriendUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "44054jBBuZNta4nNg3JHLq7", "HallFriendUIController");
var i = e("UIController"), s = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
cc.mm.hallserver.requestFriendList();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/shareWx"], this.onClickFriend.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/shareFriend"], this.onClickPYQ.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseGetFriends, this._ntfFriends.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseReceiveReward, this._ntfReward.bind(this), this);
},
_ntfFriends: function(e) {
for (var t = e.gradeInfo, i = 0; i < t.length; i++) this._updataItem(this.views["view/item" + i], t[i]);
},
_updataItem: function(e, t) {
e.getChildByName("menbertimes").getComponent(cc.Label).string = t.personNum;
e.getChildByName("number").getComponent(cc.Label).string = cc.mm.gamefunc.numformat(t.awardGoldNum, 0);
e.getChildByName("menber").getComponent(cc.Label).string = "(" + t.friendInfo.length + "/ " + t.personNum + ")";
for (var i = e.getChildByName("heads"), s = 0; s < t.personNum; s++) {
var n = cc.instantiate(this.views["view/hand"]);
cc.mm.uitools.restNode(n);
i.addChild(n);
t.friendInfo.length > s && t.friendInfo[s] && cc.mm.uitools.loadRemote(t.friendInfo[s].picUrl, n);
}
e.getChildByName("rewardBtn").active = 1 == t.status;
e.getChildByName("yilingqu").active = 2 == t.status;
e.getChildByName("weilingqu").active = 0 == t.status;
i.getComponent(cc.Layout).updateLayout();
cc.mm.uitools.addBtnLister(e.getChildByName("rewardBtn"), this.onClickReward.bind(this, t, e), this);
},
onClickReward: function(e, t) {
t.getChildByName("rewardBtn").active = !1;
t.getChildByName("yilingqu").active = !0;
t.getChildByName("weilingqu").active = !1;
cc.mm.hallserver.requestReward(s.huinan.server.proto.ENRewardType.EN_REWARD_TYPE_INVITE, e.gradeId);
},
_ntfReward: function(e) {
1 == e.result && e.rewardType == s.huinan.server.proto.ENRewardType.EN_REWARD_TYPE_INVITE && cc.mm.uimanager.showTextPrompt("领取成功");
},
onClickFriend: function() {
var e = cc.mm.gameserver.shares[1].content, t = cc.mm.gameserver.shares[1].url, i = cc.mm.gameserver.shares[1].title;
"彭山" == cc.mm.framemodel.xianName ? i = "全新彭山斗十四上线，一个人也能玩，好友房免费" : "其他区域" == cc.mm.framemodel.xianName && "眉山" == cc.mm.framemodel.shiName && (i = "全新眉山斗十四上线，一个人也能玩，好友房免费");
cc.sys.isNative && cc.sys.os == cc.sys.OS_IOS ? jsb.reflection.callStaticMethod("AppController", "shareFriend:des:title:", t, e, i) : cc.sys.isNative && cc.sys.os == cc.sys.OS_ANDROID && jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "shareFriend", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V", t, e, i);
},
onClickPYQ: function() {
var e = cc.mm.gameserver.shares[1].content, t = cc.mm.gameserver.shares[1].url, i = cc.mm.gameserver.shares[1].title;
"彭山" == cc.mm.framemodel.xianName ? i = "全新彭山斗十四上线，一个人也能玩，好友房免费" : "其他区域" == cc.mm.framemodel.xianName && "眉山" == cc.mm.framemodel.shiName && (i = "全新眉山斗十四上线，一个人也能玩，好友房免费");
cc.sys.isNative && cc.sys.os == cc.sys.OS_IOS ? jsb.reflection.callStaticMethod("AppController", "sharePYQ:des:title:", t, e, i) : cc.sys.isNative && cc.sys.os == cc.sys.OS_ANDROID && jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "sharePYQ", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V", t, e, i);
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0
} ],
HallHelpUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "98d65VArZVBI5SVNM7vTyAv", "HallHelpUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._gameBtns = [];
this._lastTouchBtn = null;
this.loadGames();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/closeBtn"], this.close.bind(this), this);
},
loadGames: function() {
for (var e = 0; e < cc.mm.framemodel.areaType.length; e++) for (var t = cc.mm.gameconfig[cc.mm.framemodel.areaType[e]], i = 0; i < t.length; i++) {
var s = cc.instantiate(this.views["root/baseGameBtn"]);
cc.mm.uitools.restNode(s);
s.data = t[i];
s.groupIndex = parseInt(t[i].gameId);
s.getChildByName("label").getComponent(cc.Label).string = t[i].name;
s.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = t[i].name;
this.views["root/games/scrollview/view/content"].addChild(s);
cc.mm.uitools.addBtnLister(s, this.onClickGameBtn.bind(this), this);
this._gameBtns.push(s);
}
this.onClickGameBtn({
node: this._gameBtns[0]
});
},
onClickGameBtn: function(e) {
this._lastTouchBtn && (this._lastTouchBtn.getChildByName("selectImg").active = !1);
e.node.getChildByName("selectImg").active = !0;
this._lastTouchBtn = e.node;
this.loadGameConfig(e.node.data);
},
loadGameConfig: function(e) {
this.views["root/rightNode/scrollview/view/content/item"].getComponent(cc.Label).string = e.name;
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
HallIAPUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "5f51aP7rZlH9IouhEWdgqBl", "HallIAPUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this.views["view/shouchongyouli"].getComponent(sp.Skeleton).addAnimation(0, "loop", !0);
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.onClose.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/btn-buy"], this.onClickBuyBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/reward"], this.onClickReward.bind(this), this);
},
onClickBuyBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonSelectPayUI", {
id: 103
});
},
onClose: function() {
this.close();
},
onClickReward: function() {}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
HallMapUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "5fb6eovUvVPPIl6IeSaJ0IY", "HallMapUIController");
var i = e("UIController");
e("HallEventType");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._lastshengBtn = null;
this._lastshiBtn = null;
this._shengBtns = [];
this._shiBtns = [];
this._shiString = "";
this._xianString = "";
cc.mm.hallserver.requestRegion();
this.views["view/backBtn"].active = "-" != cc.mm.framemodel.location;
},
addEvent: function() {
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseRegion, this._ntfLocationList.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/backBtn"], this.onClickbackBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.sureSelectBtn, this.onClickSelectBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/xiannode/qianlandi/backbtn"], this.onClickXianBackBtn.bind(this), this);
},
onClickXianBackBtn: function() {
this.views["view/shinode"].active = !0;
this.views["view/xiannode"].active = !1;
},
_ntfLocationList: function(e) {
var t = e.shiInfo;
this._shengBtns.length = 0;
for (var i = 0, s = 0; s < t.length; s++) {
var n = cc.instantiate(this.views.baseGameBtn);
cc.mm.uitools.restNode(n);
n.data = t[s].xianInfo;
n.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = cc.mm.gamefunc.replaceCity(t[s].shiName, " ");
n.getChildByName("unsclect").getChildByName("label").getComponent(cc.Label).string = cc.mm.gamefunc.replaceCity(t[s].shiName, " ");
n.getChildByName("selectImg").getChildByName("game").getChildByName("label").getComponent(cc.Label).string = t[s].title;
n.getChildByName("unsclect").getChildByName("game").getChildByName("label").getComponent(cc.Label).string = t[s].title;
this.views["view/shinode/view/content"].addChild(n);
cc.mm.uitools.addBtnLister(n, this.onClickShengBtn.bind(this, t[s].shiName), this);
this._shengBtns.push(n);
cc.mm.framemodel.shiName == t[s].shiName && (i = s);
}
if (this._shengBtns[i] && t[i].shiName) {
this._shengBtns[i].getChildByName("selectImg").active = !0;
this._shengBtns[i].getChildByName("unsclect").active = !1;
this._shiString = t[i].shiName;
this._lastshengBtn = this._shengBtns[i];
}
},
onClickbackBtn: function() {
if ((cc.mm.framemodel.shiName != this._shiString || cc.mm.framemodel.xianName != this._xianString) && "" != this._shiString && "" != this._xianString) {
cc.mm.hallserver.requestChangeLocation(this._shiString, this._xianString);
cc.mm.framemodel.location = cc.mm.gamefunc.replaceCity(this._shiString) + "-" + cc.mm.gamefunc.replaceCity(this._xianString);
cc.mm.framemodel.xianName = this._xianString;
cc.mm.framemodel.shiName = this._shiString;
cc.mm.notification.emit(cc.mm.frametype.NTF_UPDATA_USER_INFO, !0);
cc.mm.uimanager.showTextPrompt("已成功切换区域");
cc.mm.hallserver.requestUrlInfo();
}
cc.mm.framemodel.isShowSmrz && !cc.mm.framemodel.isSmrz && cc.mm.uimanager.showWindow(cc.mm.config.resources, "FangChenmiUI");
this.close();
},
onClickSelectBtn: function() {},
onClickShengBtn: function(e, t) {
if (this._lastshengBtn) {
this._lastshengBtn.getChildByName("selectImg").active = !1;
this._lastshengBtn.getChildByName("unsclect").active = !0;
}
t.node.getChildByName("selectImg").active = !0;
t.node.getChildByName("unsclect").active = !1;
this._shiString = e;
this._xianString = "";
this._lastshengBtn = t.node;
this.views["view/shinode"].active = !1;
this.views["view/xiannode"].active = !0;
this.loadShiConfig(t.node.data);
},
loadShiConfig: function(e) {
this.views["view/xiannode/view/content"].removeAllChildren(!0);
this._lastshiBtn = null;
this._shiBtns.length = 0;
for (var t = 0; t < e.length; t++) {
var i = cc.instantiate(this.views.locationBtn);
i.data = e[t].areaType;
cc.mm.uitools.restNode(i);
i.getChildByName("select").getChildByName("label").getComponent(cc.Label).string = e[t].xianName;
i.getChildByName("unselect").getChildByName("label").getComponent(cc.Label).string = e[t].xianName;
this.views["view/xiannode/view/content"].addChild(i);
this._shiBtns.push(i);
cc.mm.uitools.addBtnLister(i, this.onClickShiBtn.bind(this), this);
cc.mm.framemodel.shiName == this._shiString && cc.mm.framemodel.xianName == e[t].xianName && this.onClickShiBtn({
node: i,
isSelf: !0
});
}
},
onClickShiBtn: function(e) {
var t;
if (this._lastshiBtn) {
this._lastshiBtn.getChildByName("select").active = !1;
this._lastshiBtn.getChildByName("unselect").active = !0;
}
this._lastshiBtn = e.node;
e.node.getChildByName("select").active = !0;
e.node.getChildByName("unselect").active = !1;
this._xianString = e.node.getChildByName("select").getChildByName("label").getComponent(cc.Label).string;
(!e.isSelf && null != (t = this._xianString) && t.includes("其他") || cc.mm.framemodel.xianName != this._xianString) && this.onClickbackBtn();
}
});
cc._RF.pop();
}, {
HallEventType: "HallEventType",
UIController: void 0
} ],
HallMatchCGUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "6b828wp05ZKE50hr7HINZ4Z", "HallMatchCGUIController");
var i = e("UIController"), s = e("HallEventType");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views.backBtn, this.onClickbackBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.match_cg_btn_baoming, this.onClickBaoMingBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.match_cg_btn_freebaoming, this.onClickFreeBaoMingBtn.bind(this), this);
},
reLoad: function(e) {
this.loadUI(e);
this.data = e;
cc.mm.notification.emit(s.HALL_NOTICE_SHOW_COIN, !1);
},
onClickBaoMingBtn: function() {
cc.mm.hallserver.requestMatchSignUp(this.data.activity_type, this.data.activiteid, this.data.enroll_fee_type);
},
onClickFreeBaoMingBtn: function() {
cc.mm.hallserver.requestMatchSignUp(this.data.activity_type, this.data.activiteid, this.data.enroll_fee_type);
},
onClickbackBtn: function() {
this.close();
cc.mm.notification.emit(s.HALL_NOTICE_SHOW_COIN, !0);
cc.mm.uimanager.visibleWindow("HallMatchUI");
},
loadUI: function(e) {
var t = JSON.parse(e.comm_reward), i = Object.values(t).length;
for (var s in t) {
var n = cc.instantiate(this.views["progressBar/match_base"]);
cc.mm.uitools.restNode(n);
n.getChildByName("label").getComponent(cc.Label).string = t[s];
n.getChildByName("level").getComponent(cc.Label).string = "第" + s + "关";
n.setPosition(cc.v2(this.views.progressBar.width / i * s - 120, 107));
this.views.progressBar.addChild(n);
n.getChildByName("match_state_0").active = !0;
}
this.views["match_cg_btn_baoming/label"].getComponent(cc.Label).string = cc.mm.config.RES_TYPE[e.enroll_fee_type] + e.enroll_fee;
}
});
cc._RF.pop();
}, {
HallEventType: "HallEventType",
UIController: void 0
} ],
HallMatchUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "a180465SXNETJEEGxd1as8x", "HallMatchUIController");
var i = e("UIController"), s = e("HallEventType");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._gameBtns = [];
this._lastTouchBtn = null;
cc.mm.hallserver.requestActiveConfig();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views.backBtn, this.onClickbackBtn.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_RESPONSE_ACTIVE_LIST, this.ntfloadActiveConfig.bind(this), this);
},
onClickbackBtn: function() {
this.close();
cc.mm.notification.emit(s.HALL_NOTICE_SHOW_VIEW, this.node.name);
},
onClickGameBtn: function(e) {
this._lastTouchBtn && (this._lastTouchBtn.getChildByName("selectImg").active = !1);
e.node.getChildByName("selectImg").active = !0;
this._lastTouchBtn = e.node;
this.loadGameConfig(e.node.data);
},
ntfloadActiveConfig: function(e) {
var t = e.chuangguan;
for (var i in t) {
var s = cc.instantiate(this.views.match_btn_cgydd);
s.data = t[i];
cc.mm.uitools.restNode(s);
this.views["active_list/view/content"].addChild(s);
cc.mm.uitools.addBtnLister(s, this.onClickCGYDDBtn.bind(this), this);
}
},
onClickCGYDDBtn: function(e) {
cc.mm.uimanager.showWindowHideLast(cc.mm.config.hall, "HallMatchCGUI", "HallMatchUI", e.node.data);
}
});
cc._RF.pop();
}, {
HallEventType: "HallEventType",
UIController: void 0
} ],
HallMonthUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "48503yTKGtIvIU0Ml8IZ24+", "HallMonthUIController");
var i = e("UIController"), s = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/btn-buy"], this.onClickBuyMonthCard.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/btn-lingqu"], this.onClickRewardBtn.bind(this), this);
},
onClickRewardBtn: function() {
cc.mm.hallserver.requestReward(s.huinan.server.proto.ENRewardType.EN_REWARD_TYPE_MONTHCARD, 0);
},
onClickBuyMonthCard: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonSelectPayUI", {
id: 102
});
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0
} ],
HallMsgUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "ce049qS34lDAJbT0R84JaJg", "HallMsgUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._gameBtns = [];
this._lastTouchBtn = null;
this._data = {
systemEmail: {
name: "系统邮件",
type: 1,
list: []
}
};
this.loadGames();
cc.mm.hallserver.requestEmail();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/closeBtn"], this.onClickCloseBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["root/openMsg/btn_close"], this.closeOpenMsg.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseEmailList, this._ntfEmailList.bind(this), this);
},
onClickCloseBtn: function() {
this.close();
cc.mm.notification.targetOff(this);
cc.mm.hallserver.requestEmail();
},
_ntfEmailList: function(e) {
for (var t = e.email, i = 0; i < t.length; i++) this._data.systemEmail.list.push(t[i]);
this.onClickGameBtn({
node: this._gameBtns[0]
});
},
loadGames: function() {
for (var e in this._data) {
var t = cc.instantiate(this.views["root/baseGameBtn"]);
cc.mm.uitools.restNode(t);
t.data = this._data[e];
t.getChildByName("label").getComponent(cc.Label).string = this._data[e].name;
this.views["root/games/scrollview/view/content"].addChild(t);
cc.mm.uitools.addBtnLister(t, this.onClickGameBtn.bind(this), this);
this._gameBtns.push(t);
}
},
onClickGameBtn: function(e) {
this._lastTouchBtn && (this._lastTouchBtn.getChildByName("selectImg").active = !1);
e.node.getChildByName("selectImg").active = !0;
this._lastTouchBtn = e.node;
this.loadGameConfig(e.node.data);
},
loadGameConfig: function(e) {
this.views["root/rightNode/scrollview/view/content"].removeAllChildren(!0);
for (var t = 0; t < e.list.length; t++) {
var i = cc.instantiate(this.views["root/MsgItem"]);
i.data = e.list[t];
cc.mm.uitools.restNode(i);
i.getChildByName("name").getComponent(cc.Label).string = e.list[t].name;
i.getChildByName("secondLabel").getComponent(cc.Label).string = e.list[t].createTime;
e.list[t].isRead && (i.getChildByName("news_yyd").active = !0);
cc.mm.uitools.addBtnLister(i, this.onClickReadMsg.bind(this), this);
this.views["root/rightNode/scrollview/view/content"].addChild(i);
}
},
onClickReadMsg: function(e) {
var t = ("" + e.node.data.createTime).split(" ");
e.node.getChildByName("news_yyd").active = !0;
cc.mm.hallserver.reeustReadEmail(e.node.data.id);
this.views["root/openMsg"].active = !0;
this.views["root/openMsg"].getChildByName("name").getComponent(cc.Label).string = e.node.data.name;
this.views["root/openMsg"].getChildByName("dayLabel").getComponent(cc.Label).string = t[0];
this.views["root/openMsg"].getChildByName("secondLabel").getComponent(cc.Label).string = t[1];
this.views["root/openMsg"].getChildByName("content").getComponent(cc.RichText).string = e.node.data.content;
},
closeOpenMsg: function() {
this.views["root/openMsg"].active = !1;
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
HallRecordInfoUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "3855dgY+3pAlIwYOz6cJNwX", "HallRecordInfoUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
reLoad: function(e) {
this.data = e;
cc.mm.hallserver.requestGetTableLogList(e.recordId);
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["bg/closeBtn"], this.close.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseRecordDetail, this._ntfTableLogList.bind(this), this);
},
_ntfTableLogList: function(e) {
this.loadItem(e);
},
loadItem: function(e) {
this.views["bg/window_top/timeLabel"].getComponent(cc.Label).string = this.data.date;
this.views["bg/window_top/roomLabel"].getComponent(cc.Label).string = this.data.roomId;
for (var t = e.smallScore, i = 0; i < t.length; i++) {
var s = cc.instantiate(this.views["bg/Item"]);
cc.mm.uitools.restNode(s);
s.data = t[i];
s.getChildByName("count").getComponent(cc.Label).string = t[i].round;
s.getChildByName("code").getComponent(cc.Label).string = t[i].recordId;
cc.mm.uitools.addBtnLister(s.getChildByName("record_btn_fenxiang"), this.onClickShareBtn.bind(this), this);
cc.mm.uitools.addBtnLister(s.getChildByName("record_btn_huifang"), this.onClickHFBtn.bind(this), this);
this.views["bg/scrollview/view/content"].addChild(s);
for (var n = t[i].userScore, o = 0; o < n.length; o++) {
var a = cc.instantiate(s.getChildByName("item"));
a.active = !0;
s.getChildByName("menber").addChild(a);
var c = n[o].nick;
c = c.length > 4 ? c.substring(0, 4) : c;
a.getChildByName("name").getComponent(cc.Label).string = c;
window.Standalone.beanAmountLabel(a.getChildByName("score"), n[o].score, true);
n[o].score < 0 && (a.getChildByName("score").color = cc.color(30, 189, 193));
var l = cc.instantiate(s.getChildByName("line"));
l.active = !0;
s.getChildByName("menber").addChild(l);
}
}
},
onClickShareBtn: function() {},
onClickHFBtn: function(e) {
var t = e.node.getParent().data.recordId;
cc.mm.hallserver.requestGetRePlay(t);
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
HallRecordUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "b6504IAzsFOILqbv9IV9K/x", "HallRecordUIController");
var i = e("UIController"), s = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._gameBtns = [];
this._lastTouchBtn = null;
this._allCell = [];
this._selectCell = [];
this.loadGames();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/games/backBtn"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["root/record_btn_zhakan"], this.onClickRePlay.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["root/zhanji-anniu-shanchu"], this.onClickRemove.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseRecordList, this._ntfGameLogList.bind(this), this);
var e = new cc.Component.EventHandler();
e.target = this.node;
e.component = "HallRecordUIController";
e.handler = "onClickToggle";
this.views["root/toggle"].getComponent(cc.Toggle).checkEvents.push(e);
},
onClickToggle: function(e) {
for (var t = e.isChecked, i = this.views["root/rightNode/scrollview/view/content"].children, s = 0; s < i.length; s++) if (t) {
i[s].getChildByName("toggle").getComponent(cc.Toggle).check();
this._selectCell.push(i[s]);
} else i[s].getChildByName("toggle").getComponent(cc.Toggle).uncheck();
t || (this._selectCell.length = 0);
},
onMsgItemClickToggle: function(e) {
e.isChecked ? this._selectCell.push(e.node.parent) : cc.js.array.remove(this._selectCell, e.node.parent);
},
onClickRemove: function() {
if (this._selectCell.length) {
for (var e = [], t = 0; t < this._selectCell.length; t++) {
e.push(this._selectCell[t].data.recordId);
this._selectCell[t].removeFromParent(!0);
this._selectCell[t].destroy();
}
this._selectCell.length = 0;
var i = new s.huinan.server.proto.MsgData();
i.hwRequestRecordDelete = new s.huinan.server.proto.HWRequestRecordDelete();
i.hwRequestRecordDelete.recordId = e;
cc.mm.server.send(i, cc.mm.msgEvent.HWRequestRecordDelete, cc.mm.framemodel.uid);
}
},
_ntfGameLogList: function(e) {
this.loadGameConfig(e);
},
loadGames: function() {
for (var e = 0; e < cc.mm.framemodel.areaType.length; e++) for (var t = cc.mm.gameconfig[cc.mm.framemodel.areaType[e]], i = 0; i < t.length; i++) {
var s = cc.instantiate(this.views["root/baseGameBtn"]);
cc.mm.uitools.restNode(s);
s.data = t[i];
s.getChildByName("label").getComponent(cc.Label).string = t[i].name;
s.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = t[i].name;
this.views["root/games/scrollview/view/content"].addChild(s);
cc.mm.uitools.addBtnLister(s, this.onClickGameBtn.bind(this), this);
this._gameBtns.push(s);
if ("其他区域" == cc.mm.framemodel.xianName && "成都市" == cc.mm.framemodel.shiName) {
s.getChildByName("label").getComponent(cc.Label).string = "成都斗十四";
s.getChildByName("selectImg").getChildByName("label").getComponent(cc.Label).string = "成都斗十四";
}
}
this.onClickGameBtn({
node: this._gameBtns[0]
});
},
onClickGameBtn: function(e) {
this._lastTouchBtn && (this._lastTouchBtn.getChildByName("selectImg").active = !1);
e.node.getChildByName("selectImg").active = !0;
this._lastTouchBtn = e.node;
this._areaType = e.node.data.gameId;
cc.mm.hallserver.requestHistoryList(this._areaType);
this.views["root/toggle"].getComponent(cc.Toggle).uncheck();
},
loadGameConfig: function(e) {
this.views["root/rightNode/scrollview/view/content"].removeAllChildren(!0);
for (var t = e.recordInfo, i = 0; i < t.length; i++) {
var s = cc.instantiate(this.views["root/MsgItem"]);
s.data = t[i];
cc.mm.uitools.restNode(s);
s.getChildByName("time").getComponent(cc.Label).string = t[i].date;
s.getChildByName("roomid").getComponent(cc.Label).string = t[i].roomId;
s.getChildByName("count").getComponent(cc.Label).string = t[i].round;
cc.mm.uitools.addBtnLister(s, this.onClickReadMsg.bind(this), this);
this.views["root/rightNode/scrollview/view/content"].addChild(s);
this._allCell.push(s);
for (var n = t[i].userInfo, o = 0; o < n.length; o++) {
var a = cc.instantiate(s.getChildByName("item"));
a.active = !0;
s.getChildByName("menber").addChild(a);
var c = n[o].nick;
c = c.length > 4 ? c.substring(0, 4) : c;
a.getChildByName("name").getComponent(cc.Label).string = c;
window.Standalone.beanAmountLabel(a.getChildByName("score"), n[o].score, true);
n[o].score < 0 && (a.getChildByName("score").color = cc.color(30, 189, 193));
var l = cc.instantiate(s.getChildByName("line"));
l.active = !0;
s.getChildByName("menber").addChild(l);
}
var m = new cc.Component.EventHandler();
m.target = this.node;
m.component = "HallRecordUIController";
m.handler = "onMsgItemClickToggle";
s.getChildByName("toggle").getComponent(cc.Toggle).checkEvents.push(m);
}
},
onClickReadMsg: function(e) {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallRecordInfoUI", e.node.data);
},
onClickRePlay: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "RePlayUI");
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0
} ],
HallShareUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "f8e4c6Jxg1KB4jZHdHF3ZoO", "HallShareUIController");
var i = e("UIController");
e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
this.funName = "wechatFriend";
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/closeBtn"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["root/shareFriend"], this.onClickShareWx.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["root/shareWx"], this.onClickShareFriend.bind(this), this);
},
onClickShareWx: function() {
var e = cc.mm.gameserver.shares[1].content, t = cc.mm.gameserver.shares[1].url, i = cc.mm.gameserver.shares[1].title;
"彭山" == cc.mm.framemodel.xianName ? i = "全新彭山斗十四上线，一个人也能玩，好友房免费" : "其他区域" == cc.mm.framemodel.xianName && "眉山" == cc.mm.framemodel.shiName && (i = "全新眉山斗十四上线，一个人也能玩，好友房免费");
cc.sys.isNative && cc.sys.os == cc.sys.OS_IOS ? jsb.reflection.callStaticMethod("AppController", "sharePYQ:des:title:", t, e, i) : cc.sys.isNative && cc.sys.os == cc.sys.OS_ANDROID && jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "sharePYQ", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V", t, e, i);
},
onClickShareFriend: function() {
var e = cc.mm.gameserver.shares[1].content, t = cc.mm.gameserver.shares[1].url, i = cc.mm.gameserver.shares[1].title;
"彭山" == cc.mm.framemodel.xianName ? i = "全新彭山斗十四上线，一个人也能玩，好友房免费" : "其他区域" == cc.mm.framemodel.xianName && "眉山" == cc.mm.framemodel.shiName && (i = "全新眉山斗十四上线，一个人也能玩，好友房免费");
cc.sys.isNative && cc.sys.os == cc.sys.OS_IOS ? jsb.reflection.callStaticMethod("AppController", "shareFriend:des:title:", t, e, i) : cc.sys.isNative && cc.sys.os == cc.sys.OS_ANDROID && jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "shareFriend", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V", t, e, i);
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0
} ],
HallShopUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "02a9fvDmWtBu5iohbmoBmNp", "HallShopUIController");
var i = e("UIController"), s = e("HallEventType"), n = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._gameBtns = [];
this._openType = 0;
this._lastTouchBtn = null;
this._data = {
doudou: {
name: "游戏豆",
list: []
},
ads: {
name: "免广告",
list: []
}
};
var e = Math.max(cc.winSize.width / this.views.shop_hallbg.width, cc.winSize.height / this.views.shop_hallbg.height);
this.views.shop_hallbg.scale = e;
this.views.shop_hallbg.active = cc.mm.assets.getBundle() !== cc.mm.config.hall;
for (var t in this._data) {
var i = cc.instantiate(this.views.baseBtn);
cc.mm.uitools.restNode(i);
i.data = this._data[t];
i.getChildByName("Background").getChildByName("label").getComponent(cc.Label).string = this._data[t].name;
i.getChildByName("checkmark").getChildByName("label").getComponent(cc.Label).string = this._data[t].name;
this.views.toggleContainer.addChild(i);
cc.mm.uitools.addBtnLister(i, this.onClickGameBtn.bind(this), this);
this._gameBtns.push(i);
}
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views.closeBtn, this.onClickbackBtn.bind(this), this);
},
_ntfGoodsInfo: function(e) {
for (var t = 0; t < e.length; t++) 1 == e[t].type ? this._data.doudou.list.push(e[t]) : 3 == e[t].type && this._data.ads.list.push(e[t]);
this._gameBtns[this._openType].getComponent(cc.Toggle).check();
this.onClickGameBtn({
node: this._gameBtns[this._openType]
});
},
onClickbackBtn: function() {
this.close();
cc.mm.notification.emit(s.HALL_NOTICE_SHOW_VIEW, this.node.name);
var e = n.huinan.server.proto.ENRoomType;
cc.mm.assets.getBundle() !== cc.mm.config.hall && cc.mm.gameserver.room_data.roomType !== e.EN_ROOM_TYPE_FRIEND && cc.mm.assets.loadScene(cc.mm.config.hall, cc.mm.config.hallboot, cc.mm.config.scenegame);
},
reLoad: function(e) {
this._openType = e ? e.open : 0;
this._ntfGoodsInfo(cc.mm.config.goodsCnf);
},
onClickGameBtn: function(e) {
this.loadGameConfig(e.node.data);
},
loadGameConfig: function(e) {
var t = this;
this.views["scrollview/view/content"].removeAllChildren(!0);
if ("游戏豆" === e.name) {
var i = cc.instantiate(this.views.weekItem);
cc.mm.uitools.restNode(i);
i.data = {
id: 101
};
this.views["scrollview/view/content"].addChild(i);
cc.mm.uitools.addBtnLister(i, this.onClickItem.bind(this), this);
}
for (var s = function(i) {
var s = cc.instantiate(t.views.BaseItem);
cc.mm.uitools.restNode(s);
s.data = e.list[i];
s.getChildByName("numLabel").getComponent(cc.Label).string = e.list[i].name;
s.getChildByName("priceLabel").getComponent(cc.Label).string = "¥" + e.list[i].price;
e.list[i].describe && e.list[i].describe.length && cc.loader.loadRes("frames/" + e.list[i].describe, cc.SpriteFrame, function(e, t) {
s.getChildByName("shopImg").getComponent(cc.Sprite).spriteFrame = t;
});
cc.mm.uitools.addBtnLister(s, t.onClickItem.bind(t), t);
t.views["scrollview/view/content"].addChild(s);
if (e.list[i].presentCount) {
s.getChildByName("gift").active = !0;
s.getChildByName("gift").getChildByName("label").getComponent(cc.Label).string = "赠送" + cc.mm.gamefunc.numformat(e.list[i].presentCount, 0) + "豆";
}
}, n = 0; n < e.list.length; n++) s(n);
},
onClickItem: function(e) {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonSelectPayUI", e.node.data);
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
HallEventType: "HallEventType",
UIController: void 0
} ],
HallStatementUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "351f92/eOhEyooCwoHDyMJU", "HallStatementUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/closeBtn"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["root/surebtn"], this.close.bind(this), this);
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
HallSureExchangeUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "f54afCfb2dGDL2qBO1kLo2/", "HallSureExchangeUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/exchangeBtn"], this.close.bind(this), this);
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
HallTaskUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "bf469BJMRBCsYZn1XPhpac+", "HallTaskUIController");
var i = e("UIController"), s = e("HallEventType"), n = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
this._urls = {};
this.mreward = {};
cc.mm.hallserver.requestShowList();
},
addEvent: function() {
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseShowList, this._ntfResponseNotice.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.closeBtn, this.close.bind(this), this);
for (var e = this.views["scrollview/view/content"].children, t = 0; t < e.length; t++) cc.mm.uitools.addBtnLister(e[t], this.onClickTaskBtn.bind(this, e[t].name), this);
},
_ntfResponseNotice: function(e) {
for (var t = this.views["scrollview/view/content"], i = 0; i < e.showInfo.length; i++) {
var s = "ENRewardType_" + e.showInfo[i].showType;
t.getChildByName(s).active = !0;
this.mreward[e.showInfo[i].showType] = e.showInfo[i].restTimes;
}
this.views["scrollview/view/content/ENRewardType_4"].active = cc.sys.isNative;
},
onClickTaskBtn: function(e) {
if ("ENRewardType_6" == e) cc.mm.framemodel.weekCardDays > 0 ? cc.mm.hallserver.requestReward(n.huinan.server.proto.ENRewardType.EN_REWARD_TYPE_WEEKCARD, 0) : cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallWeekCardUI"); else if ("ENRewardType_7" == e) cc.mm.hallserver.requestReward(n.huinan.server.proto.ENRewardType.EN_REWARD_TYPE_MONTHCARD, 0); else if ("ENRewardType_4" == e) cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallFriendUI"); else if ("ENRewardType_2" == e) {
if (this.mreward[2] <= 0) {
cc.mm.uimanager.showTextPrompt("今天看广告次数已用完。");
return;
}
cc.mm.gameserver.playad(function(e) {
e && cc.mm.hallserver.requestReward(n.huinan.server.proto.ENRewardType.EN_REWARD_TYPE_ADVERT, 0, 1);
!e && cc.mm.uimanager.showTextPrompt("播放广告失败");
});
this.mreward[2] -= 1;
} else if ("ENRewardType_3" == e) {
if (this.mreward[3] <= 0) {
cc.mm.uimanager.showTextPrompt("今天看分享次数已用完。");
return;
}
cc.mm.gameserver.native_sharePYQ();
} else "ENRewardType_5" == e && cc.mm.uimanager.showWindow(cc.mm.config.hall, "RecallFriend");
},
close: function() {
this._super();
cc.mm.gameserver.sharePosType = 0;
cc.mm.gameserver.shareTime = 0;
cc.mm.gameserver.failShareTimes = 0;
cc.mm.notification.emit(s.HALL_NOTICE_SHOW_VIEW, this.node.name);
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
HallEventType: "HallEventType",
UIController: void 0
} ],
HallTipUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "1fed3CJmANFlY1nILOgmZTP", "HallTipUIController");
var i = e("UIController");
cc.Class({
extends: i,
onLoad: function() {
var e, t;
this._super();
this.loadRemote(cc.mm.framemodel.gzhPngUrl || cc.mm.framemodel.kfPngUrl);
this.views["view/openBtn"].active = 0 == (null == (e = cc.mm.framemodel.gzhJumpUrl) ? void 0 : e.length);
this.views["view/openKf"].active = (null == (t = cc.mm.framemodel.gzhJumpUrl) ? void 0 : t.length) > 0;
},
loadRemote: function(e) {
var t = this;
cc.assetManager.loadRemote(e, {
ext: ".png",
cacheEnabled: !0
}, function(i, s) {
i ? cc.isValid(t.views["view/sprite"]) && t.loadRemote(e) : cc.isValid(t.views["view/sprite"]) && (t.views["view/sprite"].getComponent(cc.Sprite).spriteFrame = new cc.SpriteFrame(s));
});
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/openKf"], this.onClickOpenUrl.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/openBtn"], this.onClickOpenUrl.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/btnClose"], this.closeBtn.bind(this), this);
},
onClickOpenUrl: function() {
cc.mm.framemodel.gzhJumpUrl ? cc.sys.openURL(cc.mm.framemodel.gzhJumpUrl) : cc.sys.isNative && cc.sys.os == cc.sys.OS_IOS && jsb.reflection.callStaticMethod("AppController", "shareScreenshot");
},
closeBtn: function() {
this.close();
var e = cc.mm.gameserver.getVersionCode();
cc.sys.os == cc.sys.OS_IOS ? +e <= 4 && cc.mm.uimanager.showWindow(cc.mm.config.resources, "BigUpdateUI") : e <= 3 && cc.mm.uimanager.showWindow(cc.mm.config.resources, "BigUpdateUI");
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
HallUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "cf2c52aIE1G6pGm3/rJ9bB8", "HallUIController");
function i(e, t) {
var i = "undefined" != typeof Symbol && e[Symbol.iterator] || e["@@iterator"];
if (i) return (i = i.call(e)).next.bind(i);
if (Array.isArray(e) || (i = s(e)) || t && e && "number" == typeof e.length) {
i && (e = i);
var n = 0;
return function() {
return n >= e.length ? {
done: !0
} : {
done: !1,
value: e[n++]
};
};
}
throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function s(e, t) {
if (e) {
if ("string" == typeof e) return n(e, t);
var i = Object.prototype.toString.call(e).slice(8, -1);
"Object" === i && e.constructor && (i = e.constructor.name);
return "Map" === i || "Set" === i ? Array.from(e) : "Arguments" === i || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(i) ? n(e, t) : void 0;
}
}
function n(e, t) {
(null == t || t > e.length) && (t = e.length);
for (var i = 0, s = new Array(t); i < t; i++) s[i] = e[i];
return s;
}
var o = e("UIController"), a = e("HallEventType"), c = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: o,
onLoad: function() {
this._super();
this._showIdx = 0;
this.loadUserInfo();
if (Array.isArray(cc.mm.framemodel.areaType) && cc.mm.framemodel.areaType.length) {
cc.mm.hallserver.requestGoldList(cc.mm.framemodel.areaType[0]);
cc.mm.framemodel.isShowSmrz && !cc.mm.framemodel.isSmrz && cc.mm.uimanager.showWindow(cc.mm.config.resources, "FangChenmiUI");
} else this.onClickChangeLocationBtn();
cc.mm.hallserver.requestHeadInfo();
cc.mm.hallserver.requestGoodsInfo();
cc.mm.hallserver.requestNotice();
cc.mm.hallserver.requestEmail();
this._openBtn = !1;
var e = Math.max(cc.winSize.width / this.views.hallbg.width, cc.winSize.height / this.views.hallbg.height);
this.views.hallbg.scale = e;
var t = Math.max(cc.winSize.width / this.views.hall_bg_shop.width, cc.winSize.height / this.views.hall_bg_shop.height);
this.views.hall_bg_shop.scale = t;
var i = Math.max(cc.winSize.width / this.views.hall_bg_room.width, cc.winSize.height / this.views.hall_bg_room.height);
this.views.hall_bg_room.scale = i;
this.mSelectUser = null;
this.mZhuang = null;
this.mIndex = 1;
this.scheduleOnce(this.marqueeLogic.bind(this), 10);
if (!cc.mm.gameserver.openTip) {
cc.mm.gameserver.openTip = !0;
if (cc.sys.isNative || cc.sys.isBrowser) if (cc.sys.os == cc.sys.OS_IOS || cc.sys.os == cc.sys.OS_OSX) cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallTipUI"); else {
var s = cc.mm.gameserver.getVersionCode();
cc.sys.os == cc.sys.OS_IOS ? +s <= 4 && cc.mm.uimanager.showWindow(cc.mm.config.resources, "BigUpdateUI") : +s <= 3 && cc.mm.uimanager.showWindow(cc.mm.config.resources, "BigUpdateUI");
} else {
var n = +cc.sys.localStorage.getItem("H5DownloadUI") + 1;
if (n < 5) {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "H5DownloadUI");
cc.sys.localStorage.setItem("H5DownloadUI", n);
}
}
cc.mm.framemodel.showZhaohuiHyhg && cc.mm.uimanager.showWindow(cc.mm.config.hall, "EventRecallResultUI");
}
cc.mm.gameserver.copyRoomLogic();
window.Standalone.hall(this);
this.schedule(function () { window.Standalone.hall(this); }, 0.1);
},
onSelectUser: function(e) {
this.mSelectUser && (this.mSelectUser.color = cc.color(255, 153, 153));
this.mSelectUser = e.node;
this.mSelectUser.color = cc.color(128, 249, 169);
},
onClickPocker: function(e) {
if (this.mSelectUser) {
var t = cc.instantiate(e.node);
t.x = 0;
t.y = 0;
this.mSelectUser.addChild(t);
cc.mm.uitools.addBtnLister(t, this.onClickCancel.bind(this), this);
}
},
onClickCancel: function(e) {
e.node.removeFromParent(!0);
},
onClickZhuang: function(e, t) {
this.mIndex = e;
this.mZhuang && (this.mZhuang.getComponent(cc.Button).interactable = !0);
t.node.getComponent(cc.Button).interactable = !1;
this.mZhuang = t.node;
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views.hallbg, this.onClickBgBtn.bind(this), this, !1);
cc.mm.uitools.addBtnLister(this.views.common_location, this.onClickChangeLocationBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.hallHeadBtn, this.onClickHeadtBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views.hall_dengluyouli, this.onClickFireReward.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["games/game_2/gouyu1"], this.onClickMatchBtn.bind(this, "勾鱼一副牌"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_2/gouyu2"], this.onClickMatchBtn.bind(this, "勾鱼两副牌"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_3/dou14"], this.onClickMatchBtn.bind(this, "火十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_4/dou14"], this.onClickMatchBtn.bind(this, "新津斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_5/dou14"], this.onClickMatchBtn.bind(this, "雅安红二十"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_7/dou14"], this.onClickMatchBtn.bind(this, "浦江斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_8/dou14"], this.onClickMatchBtn.bind(this, "邛崃斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_10/dou14"], this.onClickMatchBtn.bind(this, "阿坝斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_11/dou14"], this.onClickMatchBtn.bind(this, "马尔康斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_12/dou14"], this.onClickMatchBtn.bind(this, "小金斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_13/dou14"], this.onClickMatchBtn.bind(this, "平昌扯坨"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_14/dou14"], this.onClickMatchBtn.bind(this, "汶川斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_15/dou14"], this.onClickMatchBtn.bind(this, "茂县斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_16/dou14"], this.onClickMatchBtn.bind(this, "遂宁斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_17/dou14"], this.onClickMatchBtn.bind(this, "理塘红斗"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_18/dou14"], this.onClickMatchBtn.bind(this, "广元割胡"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_19/dou14"], this.onClickMatchBtn.bind(this, "通江斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_20/dou14"], this.onClickMatchBtn.bind(this, "荣县斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_21/dou14"], this.onClickMatchBtn.bind(this, "越西斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_22/dou14"], this.onClickMatchBtn.bind(this, "盐津斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_23/dou14"], this.onClickMatchBtn.bind(this, "徐州斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_24/dou14"], this.onClickMatchBtn.bind(this, "雷波斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_25/dou14"], this.onClickMatchBtn.bind(this, "筠连斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_26/dou14"], this.onClickMatchBtn.bind(this, "甘洛斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_27/dou14"], this.onClickMatchBtn.bind(this, "筠连斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_other/xuezhanmj"], this.onClickMatchBtn.bind(this, "雅安血战"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_other/paodekuai"], this.onClickMatchBtn.bind(this, "跑得快"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_2/paodekuai"], this.onClickMatchBtn.bind(this, "跑得快"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_other/xuezhan"], this.onClickMatchBtn.bind(this, "红二十血战"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_3/haoyou"], this.onClickCreateRoomBtn.bind(this, "火十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_4/haoyou"], this.onClickCreateRoomBtn.bind(this, "新津斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_5/haoyou"], function () { this.onClickCreateRoomBtn(cc.mm.framemodel.shiName === "雅安市" ? "雅安红二十" : "安岳斗十四"); }.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_7/haoyou"], this.onClickCreateRoomBtn.bind(this, "浦江斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_8/haoyou"], this.onClickCreateRoomBtn.bind(this, "邛崃斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_10/haoyou"], this.onClickCreateRoomBtn.bind(this, "阿坝斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_11/haoyou"], this.onClickCreateRoomBtn.bind(this, "马尔康斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_12/haoyou"], this.onClickCreateRoomBtn.bind(this, "小金斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_13/haoyou"], this.onClickCreateRoomBtn.bind(this, "平昌扯坨"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_14/haoyou"], this.onClickCreateRoomBtn.bind(this, "汶川斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_15/haoyou"], this.onClickCreateRoomBtn.bind(this, "茂县斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_16/haoyou"], this.onClickCreateRoomBtn.bind(this, "遂宁斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_17/haoyou"], this.onClickCreateRoomBtn.bind(this, "理塘红斗"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_18/haoyou"], this.onClickCreateRoomBtn.bind(this, "广元割胡"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_19/haoyou"], this.onClickCreateRoomBtn.bind(this, "通江斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_20/haoyou"], this.onClickCreateRoomBtn.bind(this, "荣县斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_21/haoyou"], this.onClickCreateRoomBtn.bind(this, "越西斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_22/haoyou"], this.onClickCreateRoomBtn.bind(this, "盐津斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_23/haoyou"], this.onClickCreateRoomBtn.bind(this, "徐州斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_24/haoyou"], this.onClickCreateRoomBtn.bind(this, "雷波斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_25/haoyou"], this.onClickCreateRoomBtn.bind(this, "筠连斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_26/haoyou"], this.onClickCreateRoomBtn.bind(this, "甘洛斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["games/game_type_27/haoyou"], this.onClickCreateRoomBtn.bind(this, "筠连斗十四"), this);
cc.mm.uitools.addBtnLister(this.views["hallDownBtns/hallActivityBtn"], this.onClickActivityBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hallDownBtns/btns/hallmensbtn"], this.onClickMenuBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hallDownBtns/btns/hall_mail_btn"], this.onClickNewsBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hallDownBtns/btns/hallshopbtn"], this.onClickShopBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hallDownBtns/btns/hallLiQuanpbtn"], this.onClickLiQuanBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hallDownBtns/btns/hall-button-zhanji"], this.onClickRecordBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["hallDownBtns/btns/hall-button-haoyou"], this.onClickFriendBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["leftBtns/appDown"], this.onClicAppDown.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["leftBtns/iapBtn"], this.onClickIap.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["leftBtns/monthBtn"], this.onClickMonth.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["leftBtns/weekBtn"], this.onClickWeek.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["leftBtns/dou-hall-pic-huodong-di"], this.onClickFriendBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["leftBtns/doubleholiday"], this.onClickdoubleholiday.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["menunode/hall_btn_set"], this.onClickSetBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["menunode/hall_btn_share"], this.onClickShareBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["menunode/hall_btn_service"], this.onClickServiceBtn.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["menunode/hall_btn_statement"], this.onClickStatementBtn.bind(this), this);
/* Account bean balance is informational; the retired store action is intentionally unbound. */
cc.mm.uitools.addBtnLister(this.views.hallads, this.onClickHallAdsBtn.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseHeadInfo, this._ntfHeadInfo.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWNotifyHaveEmail, this._ntfEmail.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseEmailList, this._ntfEmailList.bind(this), this);
cc.mm.notification.on(a.HALL_NOTICE_SHOW_VIEW, this.showView.bind(this), this);
cc.mm.notification.on(a.HALL_NOTICE_SHOW_COIN, this.hideCoinView.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.NTF_UPDATA_USER_INFO, this._ntfChangeUserData.bind(this), this);
this.views["leftBtns/appDown"].active = !1;
},
onClickFriendBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "FriendListUI");
},
onClickdoubleholiday: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "DoubleHolidayUI");
},
_ntfHeadInfo: function(e) {
cc.mm.uitools.changeHead(this.views["hallHeadBtn/headcase"], e.headType);
},
onClicAppDown: function() {
cc.sys.openURL("about:blank");
},
onClickBiSai: function() {
this._openBtn = !this._openBtn;
},
checkMoreGame: function() {
var e = 1280 + this.views.more_game.width + 100;
this.views.more_game.active = cc.winSize.width / 1280 > cc.winSize.height / 720 && cc.winSize.width > e;
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
e.scheduleOnce(e.marqueeLogic.bind(e), t.intervalSecond);
})));
this._showIdx++;
} else this.scheduleOnce(this.marqueeLogic.bind(this), 10);
},
_ntfChangeUserData: function() {
var e, t, i, s, n;
this.views["hallads/label"].getComponent(cc.Label).string = cc.mm.gamefunc.numformat(cc.mm.framemodel.freeVideoTimes);
window.Standalone.scoreLabel(this.views["hallcoin/label"], cc.mm.framemodel.goldNum);
this.views["hallHeadBtn/namelabel"].getComponent(cc.Label).string = cc.mm.framemodel.nick;
this.views["common_location/label"].getComponent(cc.Label).string = cc.mm.framemodel.location;
cc.mm.uitools.changeHead(this.views["hallHeadBtn/headcase"], cc.mm.framemodel.headType);
this.views["games/game_2"].active = !1;
this.views["games/game_type_3"].active = !1;
this.views["games/game_type_4"].active = !1;
this.views["games/game_type_5"].active = !1;
this.views["games/game_type_7"].active = !1;
this.views["games/game_type_8"].active = !1;
this.views["games/game_other"].active = !1;
this.views["games/game_type_10"].active = !1;
this.views["games/game_type_11"].active = !1;
this.views["games/game_type_12"].active = !1;
this.views["games/game_type_13"].active = !1;
this.views["games/game_type_14"].active = !1;
this.views["games/game_type_15"].active = !1;
this.views["games/game_type_16"].active = !1;
this.views["games/game_type_17"].active = !1;
this.views["games/game_type_18"].active = !1;
this.views["games/game_type_19"].active = !1;
this.views["games/game_type_20"].active = !1;
this.views["games/game_type_21"].active = !1;
this.views["games/game_type_22"].active = !1;
this.views["games/game_type_23"].active = !1;
this.views["games/game_type_24"].active = !1;
this.views["games/game_type_25"].active = !1;
this.views["games/game_type_26"].active = !1;
this.views["games/game_type_27"].active = !1;
if ("沿河" == cc.mm.framemodel.xianName) {
this.views["games/game_2"].active = !0;
this.views["games/game_type_3"].active = !0;
} else if ("新津" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_4"].active = !0;
} else if ("彭山" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_4"].active = !0;
} else if ("其他区域" == cc.mm.framemodel.xianName && "眉山" == cc.mm.framemodel.shiName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_4"].active = !0;
} else if ("蒲江" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_7"].active = !0;
} else if ("邛崃" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_8"].active = !0;
} else if ("安岳" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_4"].active = !0;
} else if ("彭水" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_3"].active = !0;
} else if ("其他区域" == cc.mm.framemodel.xianName && "成都市" == cc.mm.framemodel.shiName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_4"].active = !0;
} else if ("雅安市" == cc.mm.framemodel.shiName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_5"].active = !0;
this.views["games/game_type_5/dou14/hanyuan"].active = "汉源" == cc.mm.framemodel.xianName;
this.views["games/game_type_5/dou14/yanan"].active = "汉源" != cc.mm.framemodel.xianName;
} else if ("小金" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_12"].active = !0;
} else if ("马尔康" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_11"].active = !0;
} else if ("阿坝" != cc.mm.framemodel.shiName || "阿坝" != cc.mm.framemodel.xianName && "金川" != cc.mm.framemodel.xianName && "其他区域" != cc.mm.framemodel.xianName && ![ "理县", "茂县", "松潘", "九寨沟", "黑水", "壤塘", "若尔盖", "红原", "阿坝", "其他区域" ].includes(cc.mm.framemodel.xianName)) if ("巴中市" == cc.mm.framemodel.shiName && null != (e = cc.mm.framemodel.xianName) && e.includes("平昌")) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_13"].active = !0;
} else if ("汶川/九寨沟" == cc.mm.framemodel.xianName || "汶川" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_14"].active = !0;
} else if ("茂县" == cc.mm.framemodel.xianName) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_15"].active = !0;
} else if ("遂宁市" == cc.mm.framemodel.shiName) {
var o, a;
this.views["games/game_other"].active = !0;
this.views["games/game_type_16"].active = !0;
this.views["games/game_type_16/dou14/shehong"].active = null == (o = cc.mm.framemodel.xianName) ? void 0 : o.includes("射洪");
this.views["games/game_type_16/dou14/suining"].active = !(null != (a = cc.mm.framemodel.xianName) && a.includes("射洪"));
} else if (cc.mm.framemodel.shiName.includes("甘孜")) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_17"].active = !0;
} else if (cc.mm.framemodel.shiName.includes("广元")) {
var l, m;
this.views["games/game_other"].active = !0;
this.views["games/game_type_18"].active = !0;
this.views["games/game_type_18/dou14/wangcang"].active = null == (l = cc.mm.framemodel.xianName) ? void 0 : l.includes("旺苍");
this.views["games/game_type_18/dou14/guangyuan"].active = !(null != (m = cc.mm.framemodel.xianName) && m.includes("旺苍"));
} else if (null != (t = cc.mm.framemodel.xianName) && t.includes("通江")) {
var r, h;
this.views["games/game_other"].active = !0;
this.views["games/game_type_19"].active = !0;
this.views["games/game_type_19/dou14/bazhong"].active = null == (r = cc.mm.framemodel.xianName) ? void 0 : r.includes("其他");
this.views["games/game_type_19/dou14/tongjiang"].active = null == (h = cc.mm.framemodel.xianName) ? void 0 : h.includes("通江");
} else if (null != (i = cc.mm.framemodel.xianName) && i.includes("其他") && cc.mm.framemodel.shiName.includes("巴中")) {
var d, u;
this.views["games/game_other"].active = !0;
this.views["games/game_type_19"].active = !0;
this.views["games/game_type_19/dou14/bazhong"].active = null == (d = cc.mm.framemodel.xianName) ? void 0 : d.includes("其他");
this.views["games/game_type_19/dou14/tongjiang"].active = null == (u = cc.mm.framemodel.xianName) ? void 0 : u.includes("通江");
} else if (cc.mm.framemodel.shiName.includes("自贡")) {
var g, v;
this.views["games/game_other"].active = !0;
this.views["games/game_type_20"].active = !0;
this.views["games/game_type_20/dou14/zigong"].active = null == (g = cc.mm.framemodel.xianName) ? void 0 : g.includes("其他");
this.views["games/game_type_20/dou14/rongxian"].active = null == (v = cc.mm.framemodel.xianName) ? void 0 : v.includes("荣县");
} else if (!cc.mm.framemodel.shiName.includes("凉山") || cc.mm.framemodel.xianName.includes("雷波") || cc.mm.framemodel.xianName.includes("甘洛")) if (cc.mm.framemodel.shiName.includes("昭通")) {
var C, f;
this.views["games/game_other"].active = !0;
this.views["games/game_type_22"].active = !0;
this.views["games/game_type_22/dou14/yanjin"].active = null == (C = cc.mm.framemodel.xianName) ? void 0 : C.includes("盐津");
this.views["games/game_type_22/dou14/zhaotong"].active = null == (f = cc.mm.framemodel.xianName) ? void 0 : f.includes("其他");
} else if (!cc.mm.framemodel.shiName.includes("宜宾") || null != (s = cc.mm.framemodel.xianName) && s.includes("筠连")) {
if (cc.mm.framemodel.shiName.includes("宜宾") && null != (n = cc.mm.framemodel.xianName) && n.includes("筠连")) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_27"].active = !0;
} else if (cc.mm.framemodel.xianName.includes("雷波")) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_24"].active = !0;
} else if (cc.mm.framemodel.xianName.includes("甘洛")) {
this.views["games/game_other"].active = !0;
this.views["games/game_type_26"].active = !0;
}
} else {
var _, p;
this.views["games/game_other"].active = !0;
this.views["games/game_type_23"].active = !0;
this.views["games/game_type_23/dou14/xuzhou"].active = null == (_ = cc.mm.framemodel.xianName) ? void 0 : _.includes("叙州");
this.views["games/game_type_23/dou14/yibin"].active = null == (p = cc.mm.framemodel.xianName) ? void 0 : p.includes("其他");
} else {
var w, b;
this.views["games/game_other"].active = !0;
this.views["games/game_type_21"].active = !0;
this.views["games/game_type_21/dou14/liangshan"].active = null == (w = cc.mm.framemodel.xianName) ? void 0 : w.includes("其他");
this.views["games/game_type_21/dou14/yuexi"].active = null == (b = cc.mm.framemodel.xianName) ? void 0 : b.includes("越西");
} else {
this.views["games/game_other"].active = !0;
this.views["games/game_type_10"].active = !0;
this.views["games/game_type_10/dou14/jinchuan"].active = "金川" == cc.mm.framemodel.xianName;
this.views["games/game_type_10/dou14/aba"].active = "阿坝" == cc.mm.framemodel.xianName || "其他区域" == cc.mm.framemodel.xianName;
this.views["games/game_type_10/dou14/heishui"].active = "黑水" == cc.mm.framemodel.xianName;
this.views["games/game_type_10/dou14/hongyuan"].active = "红原" == cc.mm.framemodel.xianName;
this.views["games/game_type_10/dou14/jiuzhaigou"].active = "九寨沟" == cc.mm.framemodel.xianName;
this.views["games/game_type_10/dou14/lixian"].active = "理县" == cc.mm.framemodel.xianName;
this.views["games/game_type_10/dou14/rangtang"].active = "壤塘" == cc.mm.framemodel.xianName;
this.views["games/game_type_10/dou14/songpan"].active = "松潘" == cc.mm.framemodel.xianName;
this.views["games/game_type_10/dou14/ruoergai"].active = "若尔盖" == cc.mm.framemodel.xianName;
this.views["games/game_type_10/dou14/maoxian"].active = "茂县" == cc.mm.framemodel.xianName;
}
var B = "雅安市" == cc.mm.framemodel.shiName ? "yaan" : "liangfang";
this.views["games/game_other/xuezhanmj"].getComponent(sp.Skeleton).setAnimation(0, B, !0);
this.views["games/game_type_3/dou14/pengshui"].active = "彭水" == cc.mm.framemodel.xianName;
this.views["games/game_type_3/dou14/yanhe"].active = "沿河" == cc.mm.framemodel.xianName;
this.views["games/game_type_4/dou14/xinjing"].active = "新津" == cc.mm.framemodel.xianName;
this.views["games/game_type_4/dou14/anyue"].active = "安岳" == cc.mm.framemodel.xianName;
this.views["games/game_type_4/dou14/chengdu"].active = "其他区域" == cc.mm.framemodel.xianName && "眉山" != cc.mm.framemodel.shiName;
this.views["games/game_type_4/dou14/pengshan"].active = "彭山" == cc.mm.framemodel.xianName;
this.views["games/game_type_4/dou14/meishan"].active = "其他区域" == cc.mm.framemodel.xianName && "眉山" == cc.mm.framemodel.shiName;
this.views["leftBtns/iapBtn"].active = cc.mm.framemodel.showShouchong;
this.views["leftBtns/monthBtn"].active = cc.mm.framemodel.showMonthcard;
var y = cc.mm.framemodel.areaType.includes(c.huinan.server.proto.ENAreaType.EN_AREA_TYPE_PKDDS_YAH20_XZ);
this.views["games/game_other/xuezhan"].getComponent(cc.Button).interactable = y;
this.views["games/game_other/xuezhan/dou-hall-pic-suo"].active = !y;
},
loadUserInfo: function() {
this._ntfChangeUserData();
this.views["hallHeadBtn/useridlabel"].getComponent(cc.Label).string = "ID: " + cc.mm.framemodel.uid;
this.views["common_location/label"].getComponent(cc.Label).string = cc.mm.framemodel.location;
cc.mm.uitools.loadRemote(cc.mm.framemodel.picUrl, this.views["hallHeadBtn/hallHead"]);
},
hideView: function() {
for (var e, t = i(this.node.children); !(e = t()).done; ) {
var s = e.value;
"hallcoin" !== s.name && "hallads" !== s.name && "halldiamond" !== s.name && "hallbg" !== s.name && "menunode" !== s.name && "sound" !== s.name && (s.active = !1);
}
},
hideCoinView: function(e) {
this.views.hallcoin.active = e;
},
showView: function() {
if (!cc.mm.uimanager.getWindow("HallAmuseUI") && !cc.mm.uimanager.getWindow("CreateRoomUI")) {
for (var e, t = i(this.node.children); !(e = t()).done; ) {
var s = e.value;
"menunode" !== s.name && "sound" !== s.name && "hallads" != s.name && (s.active = !0);
}
this._openBtn = !1;
}
if (cc.mm.uimanager.getWindow("CreateRoomUI")) {
this.views.hallbg.active = !1;
this.views.hall_bg_shop.active = !1;
this.views.hall_bg_room.active = !0;
} else {
this.views.hallbg.active = !0;
this.views.hall_bg_shop.active = !1;
this.views.hall_bg_room.active = !1;
}
},
onClickActivityBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallActivityUI");
},
onClickHallCoinBtn: function() {
this.hideView();
this.views.hallbg.active = !1;
this.views.hall_bg_shop.active = !0;
this.views.hall_bg_room.active = !1;
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallShopUI");
},
onClickHallDiamondBtn: function() {
this.hideView();
this.views.hallbg.active = !1;
this.views.hall_bg_shop.active = !0;
this.views.hall_bg_room.active = !1;
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallShopUI", {
open: 1
});
this.onClickBgBtn();
},
onClickHallAdsBtn: function() {
this.hideView();
this.views.hallbg.active = !1;
this.views.hall_bg_shop.active = !0;
this.views.hall_bg_room.active = !1;
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallShopUI", {
open: 1
});
this.onClickBgBtn();
},
onClickCreateRoomBtn: function() {
this.hideView();
this.views.hallbg.active = !1;
this.views.hall_bg_shop.active = !1;
this.views.hall_bg_room.active = !0;
cc.mm.uimanager.showWindow(cc.mm.config.hall, "CreateRoomUI");
this.onClickBgBtn();
},
onClickJoinRoomBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "JoinRoomUI");
},
onClickBgBtn: function() {
var e = this;
if (this.views.menunode.active) {
var t = cc.scaleTo(.1, 1, 0).easing(cc.easeCubicActionOut());
this.views.menunode.runAction(cc.sequence(t, cc.callFunc(function() {
e.views.menunode.active = !1;
})));
}
},
onClickMenuBtn: function() {
if (!this.views.menunode.active) {
this.views.menunode.active = !0;
var e = cc.scaleTo(.1, 1, 1).easing(cc.easeCubicActionIn());
this.views.menunode.runAction(e);
}
},
onClickClubBtn: function() {
this.hideView();
this.hideCoinView(!1);
cc.mm.uimanager.showWindow(cc.mm.config.hall, "ClubUI");
},
onClickSetBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "HallSetUI");
this.onClickBgBtn();
},
onClickHelpBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallHelpUI");
this.onClickBgBtn();
},
_ntfEmail: function() {
this.views["hallDownBtns/btns/hall_mail_btn/hongdian"].active = !0;
},
_ntfEmailList: function(e) {
this.views["hallDownBtns/btns/hall_mail_btn/hongdian"].active = !1;
for (var t = 0; t < e.email.length; t++) if (!e.email[t].isRead) {
this.views["hallDownBtns/btns/hall_mail_btn/hongdian"].active = !0;
break;
}
},
onClickNewsBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallMsgUI");
this.onClickBgBtn();
},
onClickServiceBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallTipUI");
this.onClickBgBtn();
},
onClickStatementBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallStatementUI");
this.onClickBgBtn();
},
onClickShareBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallShareUI");
this.onClickBgBtn();
},
onClickRecordBtn: function() {
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallRecordUI");
this.onClickBgBtn();
},
onClickShopBtn: function() {
this.hideView();
this.views.hallbg.active = !1;
this.views.hall_bg_shop.active = !0;
this.views.hall_bg_room.active = !1;
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallShopUI");
this.onClickBgBtn();
},
onClickLiQuanBtn: function() {
this.hideView();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallExChangeUI");
},
onClickMatchBtn: function(e) {
this.hideView();
this.onClickBgBtn();
if ("雅安血战" == e && "雅安市" != cc.mm.framemodel.shiName) e = "两房血战"; else if ("遂宁斗十四" == e && "遂宁市" == cc.mm.framemodel.shiName) {
var t;
e = null != (t = cc.mm.framemodel.xianName) && t.includes("射洪") ? "射洪斗十四" : "遂宁斗十四";
}
cc.mm.gameserver.lastgame = e;
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallAmuseUI");
},
onClickGameRightBtn: function() {
this.hideView();
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallAmuseUI");
},
onClickGameLeftBtn: function() {
this.hideView();
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallAmuseUI");
},
onClickHeadtBtn: function() {
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.resources, "HallPersonUI");
},
onClickChangeLocationBtn: function() {
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallMapUI");
},
onClickFireReward: function() {
this.hideView();
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallTaskUI");
},
onClickMonth: function() {
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallMonthUI");
},
onClickIap: function() {
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallIAPUI");
},
onClickWeek: function() {
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallWeekCardUI");
},
onClickFriend: function() {
this.onClickBgBtn();
cc.mm.uimanager.showWindow(cc.mm.config.hall, "HallFriendUI");
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
HallEventType: "HallEventType",
UIController: void 0
} ],
HallWeekCardUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "ca860JADsVOiapK7/7Wpc0l", "HallWeekCardUIController");
var i = e("UIController"), s = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/btn-buy"], this.onClickBuy.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/btn-lingqu"], this.onClickReward.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/btn-close"], this.close.bind(this), this);
},
onClickBuy: function() {
cc.mm.uimanager.showWindow(cc.mm.config.resources, "CommonSelectPayUI", {
id: 101
});
},
onClickReward: function() {
cc.mm.hallserver.requestReward(s.huinan.server.proto.ENRewardType.EN_REWARD_TYPE_WEEKCARD, 0);
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0
} ],
JoinRoomUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "b61f9P67YZH7amhWt1b5EVp", "JoinRoomUIController");
function i(e, t) {
var i = "undefined" != typeof Symbol && e[Symbol.iterator] || e["@@iterator"];
if (i) return (i = i.call(e)).next.bind(i);
if (Array.isArray(e) || (i = s(e)) || t && e && "number" == typeof e.length) {
i && (e = i);
var n = 0;
return function() {
return n >= e.length ? {
done: !0
} : {
done: !1,
value: e[n++]
};
};
}
throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function s(e, t) {
if (e) {
if ("string" == typeof e) return n(e, t);
var i = Object.prototype.toString.call(e).slice(8, -1);
"Object" === i && e.constructor && (i = e.constructor.name);
return "Map" === i || "Set" === i ? Array.from(e) : "Arguments" === i || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(i) ? n(e, t) : void 0;
}
}
function n(e, t) {
(null == t || t > e.length) && (t = e.length);
for (var i = 0, s = new Array(t); i < t; i++) s[i] = e[i];
return s;
}
var o = e("UIController");
cc.Class({
extends: o,
onLoad: function() {
this._super();
this.roomid = "";
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/common_close"], this.onClickbackBtn.bind(this), this);
for (var e, t = i(this.views["root/outputNodes"]._children); !(e = t()).done; ) {
var s = e.value;
cc.mm.uitools.addBtnLister(s, this.onClickOutputBtn.bind(this), this);
}
},
onClickbackBtn: function() {
this.close();
},
onClickOutputBtn: function(e) {
var t = e.node.getChildByName("label").getComponent(cc.Label).string;
if (isNaN(parseInt(t)) && "X" === t) {
console.log("这里是需要删除");
this.roomid.length && (this.roomid = this.roomid.substring(0, this.roomid.length - 1));
} else if (isNaN(parseInt(t)) && "X" !== t) {
console.log("这里是清除");
this.roomid = "";
} else {
console.log("这里是房间号");
this.roomid.length < this.views["root/inputNodes"].getChildrenCount() && (this.roomid = this.roomid.concat(t));
}
this.updateRoomText();
},
updateRoomText: function() {
console.log("房间号:" + this.roomid);
for (var e = 0; e < this.roomid.length; e++) this.views["root/inputNodes"]._children[e].getChildByName("label").getComponent(cc.Label).string = this.roomid[e];
for (var t = this.roomid.length; t < this.views["root/inputNodes"].getChildrenCount(); t++) this.views["root/inputNodes"]._children[t].getChildByName("label").getComponent(cc.Label).string = "";
6 === this.roomid.length && cc.mm.hallserver.requestJoinRoom(this.roomid);
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
RePlayUIController: [ function(e, t) {
"use strict";
cc._RF.push(t, "b7389TFNKJNe7cwiT2+vrUF", "RePlayUIController");
function i(e, t) {
var i = "undefined" != typeof Symbol && e[Symbol.iterator] || e["@@iterator"];
if (i) return (i = i.call(e)).next.bind(i);
if (Array.isArray(e) || (i = s(e)) || t && e && "number" == typeof e.length) {
i && (e = i);
var n = 0;
return function() {
return n >= e.length ? {
done: !0
} : {
done: !1,
value: e[n++]
};
};
}
throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function s(e, t) {
if (e) {
if ("string" == typeof e) return n(e, t);
var i = Object.prototype.toString.call(e).slice(8, -1);
"Object" === i && e.constructor && (i = e.constructor.name);
return "Map" === i || "Set" === i ? Array.from(e) : "Arguments" === i || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(i) ? n(e, t) : void 0;
}
}
function n(e, t) {
(null == t || t > e.length) && (t = e.length);
for (var i = 0, s = new Array(t); i < t; i++) s[i] = e[i];
return s;
}
var o = e("UIController");
cc.Class({
extends: o,
onLoad: function() {
this._super();
this.roomid = "";
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["root/common_close"], this.onClickbackBtn.bind(this), this);
for (var e, t = i(this.views["root/outputNodes"]._children); !(e = t()).done; ) {
var s = e.value;
cc.mm.uitools.addBtnLister(s, this.onClickOutputBtn.bind(this), this);
}
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponsePlayBack, this._ntfGameReplayStart.bind(this), this);
},
onClickbackBtn: function() {
this.close();
},
onClickOutputBtn: function(e) {
var t = e.node.getChildByName("label").getComponent(cc.Label).string;
if (isNaN(parseInt(t)) && "X" === t) {
console.log("这里是需要删除");
this.updateRoomText();
} else if (isNaN(parseInt(t)) && "X" !== t) {
console.log("这里是清除");
this.views["root/input/label"].getComponent(cc.Label).string = "";
} else {
console.log("这里是房间号");
this.views["root/input/label"].getComponent(cc.Label).string += t;
}
},
updateRoomText: function() {
console.log("房间号:" + this.views["root/input/label"].getComponent(cc.Label).string);
cc.mm.hallserver.requestGetRePlay(this.views["root/input/label"].getComponent(cc.Label).string);
},
_ntfGameReplayStart: function(e) {
1 !== e.result && (this.views["root/input/label"].getComponent(cc.Label).string = "");
}
});
cc._RF.pop();
}, {
UIController: void 0
} ],
RecallFriendController: [ function(e, t) {
"use strict";
cc._RF.push(t, "953e35MYORAKJPKwD77g7vp", "RecallFriendController");
var i = e("UIController"), s = e("../../../../Frame/src/buff/hw_msg").com;
cc.Class({
extends: i,
onLoad: function() {
this._super();
cc.mm.hallserver.requestRecallFriendList();
},
addEvent: function() {
cc.mm.uitools.addBtnLister(this.views["view/closeBtn"], this.close.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/shareWx"], this.onClickFriend.bind(this), this);
cc.mm.uitools.addBtnLister(this.views["view/shareFriend"], this.onClickPYQ.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseGetFriends, this._ntfFriends.bind(this), this);
cc.mm.notification.on(cc.mm.frametype.MSG_NOTICE_CMD + cc.mm.msgEvent.HWResponseReceiveReward, this._ntfReward.bind(this), this);
},
_ntfFriends: function(e) {
for (var t = e.gradeInfo, i = 0; i < t.length; i++) this._updataItem(this.views["view/item" + i], t[i]);
},
_updataItem: function(e, t) {
e.getChildByName("menbertimes").getComponent(cc.Label).string = t.personNum;
e.getChildByName("number").getComponent(cc.Label).string = cc.mm.gamefunc.numformat(t.awardGoldNum, 0);
e.getChildByName("menber").getComponent(cc.Label).string = "(" + t.friendInfo.length + "/ " + t.personNum + ")";
for (var i = e.getChildByName("heads"), s = 0; s < t.personNum; s++) {
var n = cc.instantiate(this.views["view/hand"]);
cc.mm.uitools.restNode(n);
i.addChild(n);
t.friendInfo.length > s && t.friendInfo[s] && cc.mm.uitools.loadRemote(t.friendInfo[s].picUrl, n);
}
e.getChildByName("rewardBtn").active = 1 == t.status;
e.getChildByName("yilingqu").active = 2 == t.status;
e.getChildByName("weilingqu").active = 0 == t.status;
i.getComponent(cc.Layout).updateLayout();
cc.mm.uitools.addBtnLister(e.getChildByName("rewardBtn"), this.onClickReward.bind(this, t, e), this);
},
onClickReward: function(e, t) {
t.getChildByName("rewardBtn").active = !1;
t.getChildByName("yilingqu").active = !0;
t.getChildByName("weilingqu").active = !1;
cc.mm.hallserver.requestReward(s.huinan.server.proto.ENRewardType.EN_REWARD_TYPE_RECALL, e.gradeId);
},
_ntfReward: function(e) {
1 == e.result && e.rewardType == s.huinan.server.proto.ENRewardType.EN_REWARD_TYPE_RECALL && cc.mm.uimanager.showTextPrompt("领取成功");
},
onClickFriend: function() {
var e = cc.mm.gameserver.shares[2].content, t = cc.mm.gameserver.shares[2].url, i = cc.mm.gameserver.shares[2].title;
cc.sys.isNative && cc.sys.os == cc.sys.OS_IOS ? jsb.reflection.callStaticMethod("AppController", "shareFriend:des:title:", t, e, i) : cc.sys.isNative && cc.sys.os == cc.sys.OS_ANDROID && jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "shareFriend", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V", t, e, i);
},
onClickPYQ: function() {
var e = cc.mm.gameserver.shares[2].content, t = cc.mm.gameserver.shares[2].url, i = cc.mm.gameserver.shares[2].title;
cc.sys.isNative && cc.sys.os == cc.sys.OS_IOS ? jsb.reflection.callStaticMethod("AppController", "sharePYQ:des:title:", t, e, i) : cc.sys.isNative && cc.sys.os == cc.sys.OS_ANDROID && jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "sharePYQ", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V", t, e, i);
}
});
cc._RF.pop();
}, {
"../../../../Frame/src/buff/hw_msg": void 0,
UIController: void 0
} ],
hallboot: [ function(e, t) {
"use strict";
cc._RF.push(t, "2232eDQO1JOp5YdJBfwLFOz", "hallboot");
function i(e, t) {
var i = "undefined" != typeof Symbol && e[Symbol.iterator] || e["@@iterator"];
if (i) return (i = i.call(e)).next.bind(i);
if (Array.isArray(e) || (i = s(e)) || t && e && "number" == typeof e.length) {
i && (e = i);
var n = 0;
return function() {
return n >= e.length ? {
done: !0
} : {
done: !1,
value: e[n++]
};
};
}
throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function s(e, t) {
if (e) {
if ("string" == typeof e) return n(e, t);
var i = Object.prototype.toString.call(e).slice(8, -1);
"Object" === i && e.constructor && (i = e.constructor.name);
return "Map" === i || "Set" === i ? Array.from(e) : "Arguments" === i || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(i) ? n(e, t) : void 0;
}
}
function n(e, t) {
(null == t || t > e.length) && (t = e.length);
for (var i = 0, s = new Array(t); i < t; i++) s[i] = e[i];
return s;
}
var o = {
init: function() {
cc.mm.hall = {};
cc.mm.hall.resmap = {};
this._callback = null;
this._callprogressback = null;
this._loadList = [ "res/prefab/HallUI", "res/prefab/CreateRoomUI" ];
},
loadRes: function() {
cc.assetManager.getBundle(cc.mm.config.hall).load(this._loadList, this.onProgress.bind(this), this.onComplete.bind(this));
},
onProgress: function(e, t) {
this._callprogressback && this._callprogressback.call(this, e, t);
},
onComplete: function(e, t) {
if (e || !Array.isArray(t)) {
console.error("Hall resource loading failed", e && e.message);
this._retryCount = (this._retryCount || 0) + 1;
if (this._retryCount <= 2) setTimeout(this.loadRes.bind(this), 250);
else cc.mm.uimanager.showTextPrompt("大厅资源加载失败，请重新启动。");
return;
}
this._retryCount = 0;
var i = cc.assetManager.getBundle(cc.mm.config.hall);
this.setResMap(t, i);
this._callback.call(this, cc.mm.hall.resmap.HallUI);
},
setResMap: function(e, t) {
for (var s, n = i(e); !(s = n()).done; ) {
var o = s.value, a = t._config.assetInfos._map[o._uuid].path.split("/");
o.name = a[a.length - 1];
cc.mm.hall.resmap[o.name] = o;
}
},
setFinishCallback: function(e) {
this._callback = e;
},
setProgressCallback: function(e) {
this._callprogressback = e;
}
};
t.exports = o;
cc._RF.pop();
}, {} ]
}, {}, [ "HallEventType", "ClubCreateUIController", "ClubInfoUIController", "ClubJoinUIController", "ClubMenberUIController", "ClubNoticeUIController", "ClubRecordUIController", "ClubRuleUIController", "ClubUIController", "CreateRoomUIController", "DoubleHolidayUIController", "EventRecallResultUIController", "EventRecallUIController", "FriendListUIController", "H5DownloadUIController", "HallActivityUIController", "HallAmuseUIController", "HallAuthenticationController", "HallConfirmController", "HallExChangeUIController", "HallFriendUIController", "HallHelpUIController", "HallIAPUIController", "HallMapUIController", "HallMatchCGUIController", "HallMatchUIController", "HallMonthUIController", "HallMsgUIController", "HallRecordInfoUIController", "HallRecordUIController", "HallShareUIController", "HallShopUIController", "HallStatementUIController", "HallSureExchangeUIController", "HallTaskUIController", "HallTipUIController", "HallUIController", "HallWeekCardUIController", "JoinRoomUIController", "RePlayUIController", "RecallFriendController", "hallboot" ]);