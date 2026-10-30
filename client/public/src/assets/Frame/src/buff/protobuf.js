(function(undefined) {
"use strict";
(function(e, t) {
var r = function r(n) {
var i = t[n];
i || e[n][0].call(i = t[n] = {
exports: {}
}, r, i, i.exports);
return i.exports;
}(19);
r.util.global.protobuf = r;
"function" == typeof define && define.amd && define([ "long" ], function(e) {
if (e && e.isLong) {
r.util.Long = e;
r.configure();
}
return r;
});
"object" == typeof module && module && module.exports && (module.exports = r);
})({
1: [ function(e, t) {
t.exports = function(e, t) {
for (var r = new Array(arguments.length - 1), n = 0, i = 2, o = !0; i < arguments.length; ) r[n++] = arguments[i++];
return new Promise(function(i, s) {
r[n] = function(e) {
if (o) {
o = !1;
if (e) s(e); else {
for (var t = new Array(arguments.length - 1), r = 0; r < t.length; ) t[r++] = arguments[r];
i.apply(null, t);
}
}
};
try {
e.apply(t || null, r);
} catch (e) {
if (o) {
o = !1;
s(e);
}
}
});
};
}, {} ],
2: [ function(e, t, r) {
var n = r;
n.length = function(e) {
var t = e.length;
if (!t) return 0;
for (var r = 0; --t % 4 > 1 && "=" === e.charAt(t); ) ++r;
return Math.ceil(3 * e.length) / 4 - r;
};
for (var i = new Array(64), o = new Array(123), s = 0; s < 64; ) o[i[s] = s < 26 ? s + 65 : s < 52 ? s + 71 : s < 62 ? s - 4 : s - 59 | 43] = s++;
n.encode = function(e, t, r) {
for (var n, o = null, s = [], f = 0, a = 0; t < r; ) {
var u = e[t++];
switch (a) {
case 0:
s[f++] = i[u >> 2];
n = (3 & u) << 4;
a = 1;
break;

case 1:
s[f++] = i[n | u >> 4];
n = (15 & u) << 2;
a = 2;
break;

case 2:
s[f++] = i[n | u >> 6];
s[f++] = i[63 & u];
a = 0;
}
if (f > 8191) {
(o || (o = [])).push(String.fromCharCode.apply(String, s));
f = 0;
}
}
if (a) {
s[f++] = i[n];
s[f++] = 61;
1 === a && (s[f++] = 61);
}
if (o) {
f && o.push(String.fromCharCode.apply(String, s.slice(0, f)));
return o.join("");
}
return String.fromCharCode.apply(String, s.slice(0, f));
};
n.decode = function(e, t, r) {
for (var n, i = r, s = 0, f = 0; f < e.length; ) {
var a = e.charCodeAt(f++);
if (61 === a && s > 1) break;
if ((a = o[a]) === undefined) throw Error("invalid encoding");
switch (s) {
case 0:
n = a;
s = 1;
break;

case 1:
t[r++] = n << 2 | (48 & a) >> 4;
n = a;
s = 2;
break;

case 2:
t[r++] = (15 & n) << 4 | (60 & a) >> 2;
n = a;
s = 3;
break;

case 3:
t[r++] = (3 & n) << 6 | a;
s = 0;
}
}
if (1 === s) throw Error("invalid encoding");
return r - i;
};
n.test = function(e) {
return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(e);
};
}, {} ],
3: [ function(e, t) {
t.exports = r;
function r(e, t) {
if ("string" == typeof e) {
t = e;
e = undefined;
}
var n = [];
function i(e) {
if ("string" != typeof e) {
var t = o();
r.verbose && console.log("codegen: " + t);
t = "return " + t;
if (e) {
for (var s = Object.keys(e), f = new Array(s.length + 1), a = new Array(s.length), u = 0; u < s.length; ) {
f[u] = s[u];
a[u] = e[s[u++]];
}
f[u] = t;
return Function.apply(null, f).apply(null, a);
}
return Function(t)();
}
for (var l = new Array(arguments.length - 1), p = 0; p < l.length; ) l[p] = arguments[++p];
p = 0;
e = e.replace(/%([%dfijs])/g, function(e, t) {
var r = l[p++];
switch (t) {
case "d":
case "f":
return String(Number(r));

case "i":
return String(Math.floor(r));

case "j":
return JSON.stringify(r);

case "s":
return String(r);
}
return "%";
});
if (p !== l.length) throw Error("parameter count mismatch");
n.push(e);
return i;
}
function o(r) {
return "function " + (r || t || "") + "(" + (e && e.join(",") || "") + "){\n  " + n.join("\n  ") + "\n}";
}
i.toString = o;
return i;
}
r.verbose = !1;
}, {} ],
4: [ function(e, t) {
t.exports = r;
function r() {
this._listeners = {};
}
r.prototype.on = function(e, t, r) {
(this._listeners[e] || (this._listeners[e] = [])).push({
fn: t,
ctx: r || this
});
return this;
};
r.prototype.off = function(e, t) {
if (e === undefined) this._listeners = {}; else if (t === undefined) this._listeners[e] = []; else for (var r = this._listeners[e], n = 0; n < r.length; ) r[n].fn === t ? r.splice(n, 1) : ++n;
return this;
};
r.prototype.emit = function(e) {
var t = this._listeners[e];
if (t) {
for (var r = [], n = 1; n < arguments.length; ) r.push(arguments[n++]);
for (n = 0; n < t.length; ) t[n].fn.apply(t[n++].ctx, r);
}
return this;
};
}, {} ],
5: [ function(e, t) {
t.exports = i;
var r = e(1), n = e(7)("fs");
function i(e, t, o) {
if ("function" == typeof t) {
o = t;
t = {};
} else t || (t = {});
return o ? !t.xhr && n && n.readFile ? n.readFile(e, function(r, n) {
return r && "undefined" != typeof XMLHttpRequest ? i.xhr(e, t, o) : r ? o(r) : o(null, t.binary ? n : n.toString("utf8"));
}) : i.xhr(e, t, o) : r(i, this, e, t);
}
i.xhr = function(e, t, r) {
var n = new XMLHttpRequest();
n.onreadystatechange = function() {
if (4 !== n.readyState) return undefined;
if (0 !== n.status && 200 !== n.status) return r(Error("status " + n.status));
if (t.binary) {
var e = n.response;
if (!e) {
e = [];
for (var i = 0; i < n.responseText.length; ++i) e.push(255 & n.responseText.charCodeAt(i));
}
return r(null, "undefined" != typeof Uint8Array ? new Uint8Array(e) : e);
}
return r(null, n.responseText);
};
if (t.binary) {
"overrideMimeType" in n && n.overrideMimeType("text/plain; charset=x-user-defined");
n.responseType = "arraybuffer";
}
n.open("GET", e);
n.send();
};
}, {
1: 1,
7: 7
} ],
6: [ function(e, t) {
t.exports = r(r);
function r(e) {
"undefined" != typeof Float32Array ? function() {
var t = new Float32Array([ -0 ]), r = new Uint8Array(t.buffer), n = 128 === r[3];
function i(e, n, i) {
t[0] = e;
n[i] = r[0];
n[i + 1] = r[1];
n[i + 2] = r[2];
n[i + 3] = r[3];
}
function o(e, n, i) {
t[0] = e;
n[i] = r[3];
n[i + 1] = r[2];
n[i + 2] = r[1];
n[i + 3] = r[0];
}
e.writeFloatLE = n ? i : o;
e.writeFloatBE = n ? o : i;
function s(e, n) {
r[0] = e[n];
r[1] = e[n + 1];
r[2] = e[n + 2];
r[3] = e[n + 3];
return t[0];
}
function f(e, n) {
r[3] = e[n];
r[2] = e[n + 1];
r[1] = e[n + 2];
r[0] = e[n + 3];
return t[0];
}
e.readFloatLE = n ? s : f;
e.readFloatBE = n ? f : s;
}() : function() {
function t(e, t, r, n) {
var i = t < 0 ? 1 : 0;
i && (t = -t);
if (0 === t) e(1 / t > 0 ? 0 : 2147483648, r, n); else if (isNaN(t)) e(2143289344, r, n); else if (t > 34028234663852886e22) e((i << 31 | 2139095040) >>> 0, r, n); else if (t < 11754943508222875e-54) e((i << 31 | Math.round(t / 1401298464324817e-60)) >>> 0, r, n); else {
var o = Math.floor(Math.log(t) / Math.LN2);
e((i << 31 | o + 127 << 23 | 8388607 & Math.round(t * Math.pow(2, -o) * 8388608)) >>> 0, r, n);
}
}
e.writeFloatLE = t.bind(null, n);
e.writeFloatBE = t.bind(null, i);
function r(e, t, r) {
var n = e(t, r), i = 2 * (n >> 31) + 1, o = n >>> 23 & 255, s = 8388607 & n;
return 255 === o ? s ? NaN : Infinity * i : 0 === o ? 1401298464324817e-60 * i * s : i * Math.pow(2, o - 150) * (s + 8388608);
}
e.readFloatLE = r.bind(null, o);
e.readFloatBE = r.bind(null, s);
}();
"undefined" != typeof Float64Array ? function() {
var t = new Float64Array([ -0 ]), r = new Uint8Array(t.buffer), n = 128 === r[7];
function i(e, n, i) {
t[0] = e;
n[i] = r[0];
n[i + 1] = r[1];
n[i + 2] = r[2];
n[i + 3] = r[3];
n[i + 4] = r[4];
n[i + 5] = r[5];
n[i + 6] = r[6];
n[i + 7] = r[7];
}
function o(e, n, i) {
t[0] = e;
n[i] = r[7];
n[i + 1] = r[6];
n[i + 2] = r[5];
n[i + 3] = r[4];
n[i + 4] = r[3];
n[i + 5] = r[2];
n[i + 6] = r[1];
n[i + 7] = r[0];
}
e.writeDoubleLE = n ? i : o;
e.writeDoubleBE = n ? o : i;
function s(e, n) {
r[0] = e[n];
r[1] = e[n + 1];
r[2] = e[n + 2];
r[3] = e[n + 3];
r[4] = e[n + 4];
r[5] = e[n + 5];
r[6] = e[n + 6];
r[7] = e[n + 7];
return t[0];
}
function f(e, n) {
r[7] = e[n];
r[6] = e[n + 1];
r[5] = e[n + 2];
r[4] = e[n + 3];
r[3] = e[n + 4];
r[2] = e[n + 5];
r[1] = e[n + 6];
r[0] = e[n + 7];
return t[0];
}
e.readDoubleLE = n ? s : f;
e.readDoubleBE = n ? f : s;
}() : function() {
function t(e, t, r, n, i, o) {
var s = n < 0 ? 1 : 0;
s && (n = -n);
if (0 === n) {
e(0, i, o + t);
e(1 / n > 0 ? 0 : 2147483648, i, o + r);
} else if (isNaN(n)) {
e(0, i, o + t);
e(2146959360, i, o + r);
} else if (n > 17976931348623157e292) {
e(0, i, o + t);
e((s << 31 | 2146435072) >>> 0, i, o + r);
} else {
var f;
if (n < 22250738585072014e-324) {
e((f = n / 5e-324) >>> 0, i, o + t);
e((s << 31 | f / 4294967296) >>> 0, i, o + r);
} else {
var a = Math.floor(Math.log(n) / Math.LN2);
1024 === a && (a = 1023);
e(4503599627370496 * (f = n * Math.pow(2, -a)) >>> 0, i, o + t);
e((s << 31 | a + 1023 << 20 | 1048576 * f & 1048575) >>> 0, i, o + r);
}
}
}
e.writeDoubleLE = t.bind(null, n, 0, 4);
e.writeDoubleBE = t.bind(null, i, 4, 0);
function r(e, t, r, n, i) {
var o = e(n, i + t), s = e(n, i + r), f = 2 * (s >> 31) + 1, a = s >>> 20 & 2047, u = 4294967296 * (1048575 & s) + o;
return 2047 === a ? u ? NaN : Infinity * f : 0 === a ? 5e-324 * f * u : f * Math.pow(2, a - 1075) * (u + 4503599627370496);
}
e.readDoubleLE = r.bind(null, o, 0, 4);
e.readDoubleBE = r.bind(null, s, 4, 0);
}();
return e;
}
function n(e, t, r) {
t[r] = 255 & e;
t[r + 1] = e >>> 8 & 255;
t[r + 2] = e >>> 16 & 255;
t[r + 3] = e >>> 24;
}
function i(e, t, r) {
t[r] = e >>> 24;
t[r + 1] = e >>> 16 & 255;
t[r + 2] = e >>> 8 & 255;
t[r + 3] = 255 & e;
}
function o(e, t) {
return (e[t] | e[t + 1] << 8 | e[t + 2] << 16 | e[t + 3] << 24) >>> 0;
}
function s(e, t) {
return (e[t] << 24 | e[t + 1] << 16 | e[t + 2] << 8 | e[t + 3]) >>> 0;
}
}, {} ],
7: [ function(require, module, exports) {
module.exports = inquire;
function inquire(moduleName) {
try {
var mod = eval("quire".replace(/^/, "re"))(moduleName);
if (mod && (mod.length || Object.keys(mod).length)) return mod;
} catch (e) {}
return null;
}
}, {} ],
8: [ function(e, t, r) {
var n = r, i = n.isAbsolute = function(e) {
return /^(?:\/|\w+:)/.test(e);
}, o = n.normalize = function(e) {
var t = (e = e.replace(/\\/g, "/").replace(/\/{2,}/g, "/")).split("/"), r = i(e), n = "";
r && (n = t.shift() + "/");
for (var o = 0; o < t.length; ) ".." === t[o] ? o > 0 && ".." !== t[o - 1] ? t.splice(--o, 2) : r ? t.splice(o, 1) : ++o : "." === t[o] ? t.splice(o, 1) : ++o;
return n + t.join("/");
};
n.resolve = function(e, t, r) {
r || (t = o(t));
if (i(t)) return t;
r || (e = o(e));
return (e = e.replace(/(?:\/|^)[^/]+$/, "")).length ? o(e + "/" + t) : t;
};
}, {} ],
9: [ function(e, t) {
t.exports = function(e, t, r) {
var n = r || 8192, i = n >>> 1, o = null, s = n;
return function(r) {
if (r < 1 || r > i) return e(r);
if (s + r > n) {
o = e(n);
s = 0;
}
var f = t.call(o, s, s += r);
7 & s && (s = 1 + (7 | s));
return f;
};
};
}, {} ],
10: [ function(e, t, r) {
var n = r;
n.length = function(e) {
for (var t = 0, r = 0, n = 0; n < e.length; ++n) if ((r = e.charCodeAt(n)) < 128) t += 1; else if (r < 2048) t += 2; else if (55296 == (64512 & r) && 56320 == (64512 & e.charCodeAt(n + 1))) {
++n;
t += 4;
} else t += 3;
return t;
};
n.read = function(e, t, r) {
if (r - t < 1) return "";
for (var n, i = null, o = [], s = 0; t < r; ) {
if ((n = e[t++]) < 128) o[s++] = n; else if (n > 191 && n < 224) o[s++] = (31 & n) << 6 | 63 & e[t++]; else if (n > 239 && n < 365) {
n = ((7 & n) << 18 | (63 & e[t++]) << 12 | (63 & e[t++]) << 6 | 63 & e[t++]) - 65536;
o[s++] = 55296 + (n >> 10);
o[s++] = 56320 + (1023 & n);
} else o[s++] = (15 & n) << 12 | (63 & e[t++]) << 6 | 63 & e[t++];
if (s > 8191) {
(i || (i = [])).push(String.fromCharCode.apply(String, o));
s = 0;
}
}
if (i) {
s && i.push(String.fromCharCode.apply(String, o.slice(0, s)));
return i.join("");
}
return String.fromCharCode.apply(String, o.slice(0, s));
};
n.write = function(e, t, r) {
for (var n, i, o = r, s = 0; s < e.length; ++s) if ((n = e.charCodeAt(s)) < 128) t[r++] = n; else if (n < 2048) {
t[r++] = n >> 6 | 192;
t[r++] = 63 & n | 128;
} else if (55296 == (64512 & n) && 56320 == (64512 & (i = e.charCodeAt(s + 1)))) {
n = 65536 + ((1023 & n) << 10) + (1023 & i);
++s;
t[r++] = n >> 18 | 240;
t[r++] = n >> 12 & 63 | 128;
t[r++] = n >> 6 & 63 | 128;
t[r++] = 63 & n | 128;
} else {
t[r++] = n >> 12 | 224;
t[r++] = n >> 6 & 63 | 128;
t[r++] = 63 & n | 128;
}
return r - o;
};
}, {} ],
11: [ function(e, t) {
t.exports = i;
var r, n = /\/|\./;
function i(e, t) {
if (!n.test(e)) {
e = "google/protobuf/" + e + ".proto";
t = {
nested: {
google: {
nested: {
protobuf: {
nested: t
}
}
}
}
};
}
i[e] = t;
}
i("any", {
Any: {
fields: {
type_url: {
type: "string",
id: 1
},
value: {
type: "bytes",
id: 2
}
}
}
});
i("duration", {
Duration: r = {
fields: {
seconds: {
type: "int64",
id: 1
},
nanos: {
type: "int32",
id: 2
}
}
}
});
i("timestamp", {
Timestamp: r
});
i("empty", {
Empty: {
fields: {}
}
});
i("struct", {
Struct: {
fields: {
fields: {
keyType: "string",
type: "Value",
id: 1
}
}
},
Value: {
oneofs: {
kind: {
oneof: [ "nullValue", "numberValue", "stringValue", "boolValue", "structValue", "listValue" ]
}
},
fields: {
nullValue: {
type: "NullValue",
id: 1
},
numberValue: {
type: "double",
id: 2
},
stringValue: {
type: "string",
id: 3
},
boolValue: {
type: "bool",
id: 4
},
structValue: {
type: "Struct",
id: 5
},
listValue: {
type: "ListValue",
id: 6
}
}
},
NullValue: {
values: {
NULL_VALUE: 0
}
},
ListValue: {
fields: {
values: {
rule: "repeated",
type: "Value",
id: 1
}
}
}
});
i("wrappers", {
DoubleValue: {
fields: {
value: {
type: "double",
id: 1
}
}
},
FloatValue: {
fields: {
value: {
type: "float",
id: 1
}
}
},
Int64Value: {
fields: {
value: {
type: "int64",
id: 1
}
}
},
UInt64Value: {
fields: {
value: {
type: "uint64",
id: 1
}
}
},
Int32Value: {
fields: {
value: {
type: "int32",
id: 1
}
}
},
UInt32Value: {
fields: {
value: {
type: "uint32",
id: 1
}
}
},
BoolValue: {
fields: {
value: {
type: "bool",
id: 1
}
}
},
StringValue: {
fields: {
value: {
type: "string",
id: 1
}
}
},
BytesValue: {
fields: {
value: {
type: "bytes",
id: 1
}
}
}
});
i("field_mask", {
FieldMask: {
fields: {
paths: {
rule: "repeated",
type: "string",
id: 1
}
}
}
});
i.get = function(e) {
return i[e] || null;
};
}, {} ],
12: [ function(e, t, r) {
var n = r, i = e(15), o = e(37);
function s(e, t, r, n) {
if (t.resolvedType) if (t.resolvedType instanceof i) {
e("switch(d%s){", n);
for (var o = t.resolvedType.values, s = Object.keys(o), f = 0; f < s.length; ++f) {
t.repeated && o[s[f]] === t.typeDefault && e("default:");
e("case%j:", s[f])("case %i:", o[s[f]])("m%s=%j", n, o[s[f]])("break");
}
e("}");
} else e('if(typeof d%s!=="object")', n)("throw TypeError(%j)", t.fullName + ": object expected")("m%s=types[%i].fromObject(d%s)", n, r, n); else {
var a = !1;
switch (t.type) {
case "double":
case "float":
e("m%s=Number(d%s)", n, n);
break;

case "uint32":
case "fixed32":
e("m%s=d%s>>>0", n, n);
break;

case "int32":
case "sint32":
case "sfixed32":
e("m%s=d%s|0", n, n);
break;

case "uint64":
a = !0;

case "int64":
case "sint64":
case "fixed64":
case "sfixed64":
e("if(util.Long)")("(m%s=util.Long.fromValue(d%s)).unsigned=%j", n, n, a)('else if(typeof d%s==="string")', n)("m%s=parseInt(d%s,10)", n, n)('else if(typeof d%s==="number")', n)("m%s=d%s", n, n)('else if(typeof d%s==="object")', n)("m%s=new util.LongBits(d%s.low>>>0,d%s.high>>>0).toNumber(%s)", n, n, n, a ? "true" : "");
break;

case "bytes":
e('if(typeof d%s==="string")', n)("util.base64.decode(d%s,m%s=util.newBuffer(util.base64.length(d%s)),0)", n, n, n)("else if(d%s.length)", n)("m%s=d%s", n, n);
break;

case "string":
e("m%s=String(d%s)", n, n);
break;

case "bool":
e("m%s=Boolean(d%s)", n, n);
}
}
return e;
}
n.fromObject = function(e) {
var t = e.fieldsArray, r = o.codegen([ "d" ], e.name + "$fromObject")("if(d instanceof this.ctor)")("return d");
if (!t.length) return r("return new this.ctor");
r("var m=new this.ctor");
for (var n = 0; n < t.length; ++n) {
var f = t[n].resolve(), a = o.safeProp(f.name);
if (f.map) {
r("if(d%s){", a)('if(typeof d%s!=="object")', a)("throw TypeError(%j)", f.fullName + ": object expected")("m%s={}", a)("for(var ks=Object.keys(d%s),i=0;i<ks.length;++i){", a);
s(r, f, n, a + "[ks[i]]")("}")("}");
} else if (f.repeated) {
r("if(d%s){", a)("if(!Array.isArray(d%s))", a)("throw TypeError(%j)", f.fullName + ": array expected")("m%s=[]", a)("for(var i=0;i<d%s.length;++i){", a);
s(r, f, n, a + "[i]")("}")("}");
} else {
f.resolvedType instanceof i || r("if(d%s!=null){", a);
s(r, f, n, a);
f.resolvedType instanceof i || r("}");
}
}
return r("return m");
};
function f(e, t, r, n) {
if (t.resolvedType) t.resolvedType instanceof i ? e("d%s=o.enums===String?types[%i].values[m%s]:m%s", n, r, n, n) : e("d%s=types[%i].toObject(m%s,o)", n, r, n); else {
var o = !1;
switch (t.type) {
case "double":
case "float":
e("d%s=o.json&&!isFinite(m%s)?String(m%s):m%s", n, n, n, n);
break;

case "uint64":
o = !0;

case "int64":
case "sint64":
case "fixed64":
case "sfixed64":
e('if(typeof m%s==="number")', n)("d%s=o.longs===String?String(m%s):m%s", n, n, n)("else")("d%s=o.longs===String?util.Long.prototype.toString.call(m%s):o.longs===Number?new util.LongBits(m%s.low>>>0,m%s.high>>>0).toNumber(%s):m%s", n, n, n, n, o ? "true" : "", n);
break;

case "bytes":
e("d%s=o.bytes===String?util.base64.encode(m%s,0,m%s.length):o.bytes===Array?Array.prototype.slice.call(m%s):m%s", n, n, n, n, n);
break;

default:
e("d%s=m%s", n, n);
}
}
return e;
}
n.toObject = function(e) {
var t = e.fieldsArray.slice().sort(o.compareFieldsById);
if (!t.length) return o.codegen()("return {}");
for (var r = o.codegen([ "m", "o" ], e.name + "$toObject")("if(!o)")("o={}")("var d={}"), n = [], s = [], a = [], u = 0; u < t.length; ++u) t[u].partOf || (t[u].resolve().repeated ? n : t[u].map ? s : a).push(t[u]);
if (n.length) {
r("if(o.arrays||o.defaults){");
for (u = 0; u < n.length; ++u) r("d%s=[]", o.safeProp(n[u].name));
r("}");
}
if (s.length) {
r("if(o.objects||o.defaults){");
for (u = 0; u < s.length; ++u) r("d%s={}", o.safeProp(s[u].name));
r("}");
}
if (a.length) {
r("if(o.defaults){");
for (u = 0; u < a.length; ++u) {
var l = a[u], p = o.safeProp(l.name);
if (l.resolvedType instanceof i) r("d%s=o.enums===String?%j:%j", p, l.resolvedType.valuesById[l.typeDefault], l.typeDefault); else if (l.long) r("if(util.Long){")("var n=new util.Long(%i,%i,%j)", l.typeDefault.low, l.typeDefault.high, l.typeDefault.unsigned)("d%s=o.longs===String?n.toString():o.longs===Number?n.toNumber():n", p)("}else")("d%s=o.longs===String?%j:%i", p, l.typeDefault.toString(), l.typeDefault.toNumber()); else if (l.bytes) {
var c = "[" + Array.prototype.slice.call(l.typeDefault).join(",") + "]";
r("if(o.bytes===String)d%s=%j", p, String.fromCharCode.apply(String, l.typeDefault))("else{")("d%s=%s", p, c)("if(o.bytes!==Array)d%s=util.newBuffer(d%s)", p, p)("}");
} else r("d%s=%j", p, l.typeDefault);
}
r("}");
}
var h = !1;
for (u = 0; u < t.length; ++u) {
l = t[u];
var d = e._fieldsArray.indexOf(l);
p = o.safeProp(l.name);
if (l.map) {
if (!h) {
h = !0;
r("var ks2");
}
r("if(m%s&&(ks2=Object.keys(m%s)).length){", p, p)("d%s={}", p)("for(var j=0;j<ks2.length;++j){");
f(r, l, d, p + "[ks2[j]]")("}");
} else if (l.repeated) {
r("if(m%s&&m%s.length){", p, p)("d%s=[]", p)("for(var j=0;j<m%s.length;++j){", p);
f(r, l, d, p + "[j]")("}");
} else {
r("if(m%s!=null&&m.hasOwnProperty(%j)){", p, l.name);
f(r, l, d, p);
l.partOf && r("if(o.oneofs)")("d%s=%j", o.safeProp(l.partOf.name), l.name);
}
r("}");
}
return r("return d");
};
}, {
15: 15,
37: 37
} ],
13: [ function(e, t) {
t.exports = function(e) {
var t = i.codegen([ "r", "l" ], e.name + "$decode")("if(!(r instanceof Reader))")("r=Reader.create(r)")("var c=l===undefined?r.len:r.pos+l,m=new this.ctor" + (e.fieldsArray.filter(function(e) {
return e.map;
}).length ? ",k,value" : ""))("while(r.pos<c){")("var t=r.uint32()");
e.group && t("if((t&7)===4)")("break");
t("switch(t>>>3){");
for (var s = 0; s < e.fieldsArray.length; ++s) {
var f = e._fieldsArray[s].resolve(), a = f.resolvedType instanceof r ? "int32" : f.type, u = "m" + i.safeProp(f.name);
t("case %i:", f.id);
if (f.map) {
t("if(%s===util.emptyObject)", u)("%s={}", u)("var c2 = r.uint32()+r.pos");
n.defaults[f.keyType] !== undefined ? t("k=%j", n.defaults[f.keyType]) : t("k=null");
n.defaults[a] !== undefined ? t("value=%j", n.defaults[a]) : t("value=null");
t("while(r.pos<c2){")("var tag2=r.uint32()")("switch(tag2>>>3){")("case 1: k=r.%s(); break", f.keyType)("case 2:");
n.basic[a] === undefined ? t("value=types[%i].decode(r,r.uint32())", s) : t("value=r.%s()", a);
t("break")("default:")("r.skipType(tag2&7)")("break")("}")("}");
n.long[f.keyType] !== undefined ? t('%s[typeof k==="object"?util.longToHash(k):k]=value', u) : t("%s[k]=value", u);
} else if (f.repeated) {
t("if(!(%s&&%s.length))", u, u)("%s=[]", u);
n.packed[a] !== undefined && t("if((t&7)===2){")("var c2=r.uint32()+r.pos")("while(r.pos<c2)")("%s.push(r.%s())", u, a)("}else");
n.basic[a] === undefined ? t(f.resolvedType.group ? "%s.push(types[%i].decode(r))" : "%s.push(types[%i].decode(r,r.uint32()))", u, s) : t("%s.push(r.%s())", u, a);
} else n.basic[a] === undefined ? t(f.resolvedType.group ? "%s=types[%i].decode(r)" : "%s=types[%i].decode(r,r.uint32())", u, s) : t("%s=r.%s()", u, a);
t("break");
}
t("default:")("r.skipType(t&7)")("break")("}")("}");
for (s = 0; s < e._fieldsArray.length; ++s) {
var l = e._fieldsArray[s];
l.required && t("if(!m.hasOwnProperty(%j))", l.name)("throw util.ProtocolError(%j,{instance:m})", o(l));
}
return t("return m");
};
var r = e(15), n = e(36), i = e(37);
function o(e) {
return "missing required '" + e.name + "'";
}
}, {
15: 15,
36: 36,
37: 37
} ],
14: [ function(e, t) {
t.exports = function(e) {
for (var t, s = i.codegen([ "m", "w" ], e.name + "$encode")("if(!w)")("w=Writer.create()"), f = e.fieldsArray.slice().sort(i.compareFieldsById), a = 0; a < f.length; ++a) {
var u = f[a].resolve(), l = e._fieldsArray.indexOf(u), p = u.resolvedType instanceof r ? "int32" : u.type, c = n.basic[p];
t = "m" + i.safeProp(u.name);
if (u.map) {
s("if(%s!=null&&Object.hasOwnProperty.call(m,%j)){", t, u.name)("for(var ks=Object.keys(%s),i=0;i<ks.length;++i){", t)("w.uint32(%i).fork().uint32(%i).%s(ks[i])", (u.id << 3 | 2) >>> 0, 8 | n.mapKey[u.keyType], u.keyType);
c === undefined ? s("types[%i].encode(%s[ks[i]],w.uint32(18).fork()).ldelim().ldelim()", l, t) : s(".uint32(%i).%s(%s[ks[i]]).ldelim()", 16 | c, p, t);
s("}")("}");
} else if (u.repeated) {
s("if(%s!=null&&%s.length){", t, t);
if (u.packed && n.packed[p] !== undefined) s("w.uint32(%i).fork()", (u.id << 3 | 2) >>> 0)("for(var i=0;i<%s.length;++i)", t)("w.%s(%s[i])", p, t)("w.ldelim()"); else {
s("for(var i=0;i<%s.length;++i)", t);
c === undefined ? o(s, u, l, t + "[i]") : s("w.uint32(%i).%s(%s[i])", (u.id << 3 | c) >>> 0, p, t);
}
s("}");
} else {
u.optional && s("if(%s!=null&&Object.hasOwnProperty.call(m,%j))", t, u.name);
c === undefined ? o(s, u, l, t) : s("w.uint32(%i).%s(%s)", (u.id << 3 | c) >>> 0, p, t);
}
}
return s("return w");
};
var r = e(15), n = e(36), i = e(37);
function o(e, t, r, n) {
return t.resolvedType.group ? e("types[%i].encode(%s,w.uint32(%i)).uint32(%i)", r, n, (t.id << 3 | 3) >>> 0, (t.id << 3 | 4) >>> 0) : e("types[%i].encode(%s,w.uint32(%i).fork()).ldelim()", r, n, (t.id << 3 | 2) >>> 0);
}
}, {
15: 15,
36: 36,
37: 37
} ],
15: [ function(e, t) {
t.exports = o;
var r = e(24);
((o.prototype = Object.create(r.prototype)).constructor = o).className = "Enum";
var n = e(23), i = e(37);
function o(e, t, n, i, o) {
r.call(this, e, n);
if (t && "object" != typeof t) throw TypeError("values must be an object");
this.valuesById = {};
this.values = Object.create(this.valuesById);
this.comment = i;
this.comments = o || {};
this.reserved = undefined;
if (t) for (var s = Object.keys(t), f = 0; f < s.length; ++f) "number" == typeof t[s[f]] && (this.valuesById[this.values[s[f]] = t[s[f]]] = s[f]);
}
o.fromJSON = function(e, t) {
var r = new o(e, t.values, t.options, t.comment, t.comments);
r.reserved = t.reserved;
return r;
};
o.prototype.toJSON = function(e) {
var t = !!e && Boolean(e.keepComments);
return i.toObject([ "options", this.options, "values", this.values, "reserved", this.reserved && this.reserved.length ? this.reserved : undefined, "comment", t ? this.comment : undefined, "comments", t ? this.comments : undefined ]);
};
o.prototype.add = function(e, t, r) {
if (!i.isString(e)) throw TypeError("name must be a string");
if (!i.isInteger(t)) throw TypeError("id must be an integer");
if (this.values[e] !== undefined) throw Error("duplicate name '" + e + "' in " + this);
if (this.isReservedId(t)) throw Error("id " + t + " is reserved in " + this);
if (this.isReservedName(e)) throw Error("name '" + e + "' is reserved in " + this);
if (this.valuesById[t] !== undefined) {
if (!this.options || !this.options.allow_alias) throw Error("duplicate id " + t + " in " + this);
this.values[e] = t;
} else this.valuesById[this.values[e] = t] = e;
this.comments[e] = r || null;
return this;
};
o.prototype.remove = function(e) {
if (!i.isString(e)) throw TypeError("name must be a string");
var t = this.values[e];
if (null == t) throw Error("name '" + e + "' does not exist in " + this);
delete this.valuesById[t];
delete this.values[e];
delete this.comments[e];
return this;
};
o.prototype.isReservedId = function(e) {
return n.isReservedId(this.reserved, e);
};
o.prototype.isReservedName = function(e) {
return n.isReservedName(this.reserved, e);
};
}, {
23: 23,
24: 24,
37: 37
} ],
16: [ function(e, t) {
t.exports = a;
var r = e(24);
((a.prototype = Object.create(r.prototype)).constructor = a).className = "Field";
var n, i = e(15), o = e(36), s = e(37), f = /^required|optional|repeated$/;
a.fromJSON = function(e, t) {
return new a(e, t.id, t.type, t.rule, t.extend, t.options, t.comment);
};
function a(e, t, n, i, a, u, l) {
if (s.isObject(i)) {
l = a;
u = i;
i = a = undefined;
} else if (s.isObject(a)) {
l = u;
u = a;
a = undefined;
}
r.call(this, e, u);
if (!s.isInteger(t) || t < 0) throw TypeError("id must be a non-negative integer");
if (!s.isString(n)) throw TypeError("type must be a string");
if (i !== undefined && !f.test(i = i.toString().toLowerCase())) throw TypeError("rule must be a string rule");
if (a !== undefined && !s.isString(a)) throw TypeError("extend must be a string");
"proto3_optional" === i && (i = "optional");
this.rule = i && "optional" !== i ? i : undefined;
this.type = n;
this.id = t;
this.extend = a || undefined;
this.required = "required" === i;
this.optional = !this.required;
this.repeated = "repeated" === i;
this.map = !1;
this.message = null;
this.partOf = null;
this.typeDefault = null;
this.defaultValue = null;
this.long = !!s.Long && o.long[n] !== undefined;
this.bytes = "bytes" === n;
this.resolvedType = null;
this.extensionField = null;
this.declaringField = null;
this._packed = null;
this.comment = l;
}
Object.defineProperty(a.prototype, "packed", {
get: function() {
null === this._packed && (this._packed = !1 !== this.getOption("packed"));
return this._packed;
}
});
a.prototype.setOption = function(e, t, n) {
"packed" === e && (this._packed = null);
return r.prototype.setOption.call(this, e, t, n);
};
a.prototype.toJSON = function(e) {
var t = !!e && Boolean(e.keepComments);
return s.toObject([ "rule", "optional" !== this.rule && this.rule || undefined, "type", this.type, "id", this.id, "extend", this.extend, "options", this.options, "comment", t ? this.comment : undefined ]);
};
a.prototype.resolve = function() {
if (this.resolved) return this;
if ((this.typeDefault = o.defaults[this.type]) === undefined) {
this.resolvedType = (this.declaringField ? this.declaringField.parent : this.parent).lookupTypeOrEnum(this.type);
this.resolvedType instanceof n ? this.typeDefault = null : this.typeDefault = this.resolvedType.values[Object.keys(this.resolvedType.values)[0]];
}
if (this.options && null != this.options.default) {
this.typeDefault = this.options.default;
this.resolvedType instanceof i && "string" == typeof this.typeDefault && (this.typeDefault = this.resolvedType.values[this.typeDefault]);
}
if (this.options) {
!0 !== this.options.packed && (this.options.packed === undefined || !this.resolvedType || this.resolvedType instanceof i) || delete this.options.packed;
Object.keys(this.options).length || (this.options = undefined);
}
if (this.long) {
this.typeDefault = s.Long.fromNumber(this.typeDefault, "u" === this.type.charAt(0));
Object.freeze && Object.freeze(this.typeDefault);
} else if (this.bytes && "string" == typeof this.typeDefault) {
var e;
s.base64.test(this.typeDefault) ? s.base64.decode(this.typeDefault, e = s.newBuffer(s.base64.length(this.typeDefault)), 0) : s.utf8.write(this.typeDefault, e = s.newBuffer(s.utf8.length(this.typeDefault)), 0);
this.typeDefault = e;
}
this.map ? this.defaultValue = s.emptyObject : this.repeated ? this.defaultValue = s.emptyArray : this.defaultValue = this.typeDefault;
this.parent instanceof n && (this.parent.ctor.prototype[this.name] = this.defaultValue);
return r.prototype.resolve.call(this);
};
a.d = function(e, t, r, n) {
"function" == typeof t ? t = s.decorateType(t).name : t && "object" == typeof t && (t = s.decorateEnum(t).name);
return function(i, o) {
s.decorateType(i.constructor).add(new a(o, e, t, r, {
default: n
}));
};
};
a._configure = function(e) {
n = e;
};
}, {
15: 15,
24: 24,
36: 36,
37: 37
} ],
17: [ function(e, t) {
var r = t.exports = e(18);
r.build = "light";
r.load = function(e, t, n) {
if ("function" == typeof t) {
n = t;
t = new r.Root();
} else t || (t = new r.Root());
return t.load(e, n);
};
r.loadSync = function(e, t) {
t || (t = new r.Root());
return t.loadSync(e);
};
r.encoder = e(14);
r.decoder = e(13);
r.verifier = e(40);
r.converter = e(12);
r.ReflectionObject = e(24);
r.Namespace = e(23);
r.Root = e(29);
r.Enum = e(15);
r.Type = e(35);
r.Field = e(16);
r.OneOf = e(25);
r.MapField = e(20);
r.Service = e(33);
r.Method = e(22);
r.Message = e(21);
r.wrappers = e(41);
r.types = e(36);
r.util = e(37);
r.ReflectionObject._configure(r.Root);
r.Namespace._configure(r.Type, r.Service, r.Enum);
r.Root._configure(r.Type);
r.Field._configure(r.Type);
}, {
12: 12,
13: 13,
14: 14,
15: 15,
16: 16,
18: 18,
20: 20,
21: 21,
22: 22,
23: 23,
24: 24,
25: 25,
29: 29,
33: 33,
35: 35,
36: 36,
37: 37,
40: 40,
41: 41
} ],
18: [ function(e, t, r) {
var n = r;
n.build = "minimal";
n.Writer = e(42);
n.BufferWriter = e(43);
n.Reader = e(27);
n.BufferReader = e(28);
n.util = e(39);
n.rpc = e(31);
n.roots = e(30);
n.configure = i;
function i() {
n.util._configure();
n.Writer._configure(n.BufferWriter);
n.Reader._configure(n.BufferReader);
}
i();
}, {
27: 27,
28: 28,
30: 30,
31: 31,
39: 39,
42: 42,
43: 43
} ],
19: [ function(e, t) {
var r = t.exports = e(17);
r.build = "full";
r.tokenize = e(34);
r.parse = e(26);
r.common = e(11);
r.Root._configure(r.Type, r.parse, r.common);
}, {
11: 11,
17: 17,
26: 26,
34: 34
} ],
20: [ function(e, t) {
t.exports = o;
var r = e(16);
((o.prototype = Object.create(r.prototype)).constructor = o).className = "MapField";
var n = e(36), i = e(37);
function o(e, t, n, o, s, f) {
r.call(this, e, t, o, undefined, undefined, s, f);
if (!i.isString(n)) throw TypeError("keyType must be a string");
this.keyType = n;
this.resolvedKeyType = null;
this.map = !0;
}
o.fromJSON = function(e, t) {
return new o(e, t.id, t.keyType, t.type, t.options, t.comment);
};
o.prototype.toJSON = function(e) {
var t = !!e && Boolean(e.keepComments);
return i.toObject([ "keyType", this.keyType, "type", this.type, "id", this.id, "extend", this.extend, "options", this.options, "comment", t ? this.comment : undefined ]);
};
o.prototype.resolve = function() {
if (this.resolved) return this;
if (n.mapKey[this.keyType] === undefined) throw Error("invalid key type: " + this.keyType);
return r.prototype.resolve.call(this);
};
o.d = function(e, t, r) {
"function" == typeof r ? r = i.decorateType(r).name : r && "object" == typeof r && (r = i.decorateEnum(r).name);
return function(n, s) {
i.decorateType(n.constructor).add(new o(s, e, t, r));
};
};
}, {
16: 16,
36: 36,
37: 37
} ],
21: [ function(e, t) {
t.exports = n;
var r = e(39);
function n(e) {
if (e) for (var t = Object.keys(e), r = 0; r < t.length; ++r) this[t[r]] = e[t[r]];
}
n.create = function(e) {
return this.$type.create(e);
};
n.encode = function(e, t) {
return this.$type.encode(e, t);
};
n.encodeDelimited = function(e, t) {
return this.$type.encodeDelimited(e, t);
};
n.decode = function(e) {
return this.$type.decode(e);
};
n.decodeDelimited = function(e) {
return this.$type.decodeDelimited(e);
};
n.verify = function(e) {
return this.$type.verify(e);
};
n.fromObject = function(e) {
return this.$type.fromObject(e);
};
n.toObject = function(e, t) {
return this.$type.toObject(e, t);
};
n.prototype.toJSON = function() {
return this.$type.toObject(this, r.toJSONOptions);
};
}, {
39: 39
} ],
22: [ function(e, t) {
t.exports = i;
var r = e(24);
((i.prototype = Object.create(r.prototype)).constructor = i).className = "Method";
var n = e(37);
function i(e, t, i, o, s, f, a, u, l) {
if (n.isObject(s)) {
a = s;
s = f = undefined;
} else if (n.isObject(f)) {
a = f;
f = undefined;
}
if (t !== undefined && !n.isString(t)) throw TypeError("type must be a string");
if (!n.isString(i)) throw TypeError("requestType must be a string");
if (!n.isString(o)) throw TypeError("responseType must be a string");
r.call(this, e, a);
this.type = t || "rpc";
this.requestType = i;
this.requestStream = !!s || undefined;
this.responseType = o;
this.responseStream = !!f || undefined;
this.resolvedRequestType = null;
this.resolvedResponseType = null;
this.comment = u;
this.parsedOptions = l;
}
i.fromJSON = function(e, t) {
return new i(e, t.type, t.requestType, t.responseType, t.requestStream, t.responseStream, t.options, t.comment, t.parsedOptions);
};
i.prototype.toJSON = function(e) {
var t = !!e && Boolean(e.keepComments);
return n.toObject([ "type", "rpc" !== this.type && this.type || undefined, "requestType", this.requestType, "requestStream", this.requestStream, "responseType", this.responseType, "responseStream", this.responseStream, "options", this.options, "comment", t ? this.comment : undefined, "parsedOptions", this.parsedOptions ]);
};
i.prototype.resolve = function() {
if (this.resolved) return this;
this.resolvedRequestType = this.parent.lookupType(this.requestType);
this.resolvedResponseType = this.parent.lookupType(this.responseType);
return r.prototype.resolve.call(this);
};
}, {
24: 24,
37: 37
} ],
23: [ function(e, t) {
t.exports = u;
var r = e(24);
((u.prototype = Object.create(r.prototype)).constructor = u).className = "Namespace";
var n, i, o, s = e(16), f = e(37);
u.fromJSON = function(e, t) {
return new u(e, t.options).addJSON(t.nested);
};
function a(e, t) {
if (!e || !e.length) return undefined;
for (var r = {}, n = 0; n < e.length; ++n) r[e[n].name] = e[n].toJSON(t);
return r;
}
u.arrayToJSON = a;
u.isReservedId = function(e, t) {
if (e) for (var r = 0; r < e.length; ++r) if ("string" != typeof e[r] && e[r][0] <= t && e[r][1] > t) return !0;
return !1;
};
u.isReservedName = function(e, t) {
if (e) for (var r = 0; r < e.length; ++r) if (e[r] === t) return !0;
return !1;
};
function u(e, t) {
r.call(this, e, t);
this.nested = undefined;
this._nestedArray = null;
}
function l(e) {
e._nestedArray = null;
return e;
}
Object.defineProperty(u.prototype, "nestedArray", {
get: function() {
return this._nestedArray || (this._nestedArray = f.toArray(this.nested));
}
});
u.prototype.toJSON = function(e) {
return f.toObject([ "options", this.options, "nested", a(this.nestedArray, e) ]);
};
u.prototype.addJSON = function(e) {
if (e) for (var t, r = Object.keys(e), f = 0; f < r.length; ++f) {
t = e[r[f]];
this.add((t.fields !== undefined ? n.fromJSON : t.values !== undefined ? o.fromJSON : t.methods !== undefined ? i.fromJSON : t.id !== undefined ? s.fromJSON : u.fromJSON)(r[f], t));
}
return this;
};
u.prototype.get = function(e) {
return this.nested && this.nested[e] || null;
};
u.prototype.getEnum = function(e) {
if (this.nested && this.nested[e] instanceof o) return this.nested[e].values;
throw Error("no such enum: " + e);
};
u.prototype.add = function(e) {
if (!(e instanceof s && e.extend !== undefined || e instanceof n || e instanceof o || e instanceof i || e instanceof u)) throw TypeError("object must be a valid nested object");
if (this.nested) {
var t = this.get(e.name);
if (t) {
if (!(t instanceof u && e instanceof u) || t instanceof n || t instanceof i) throw Error("duplicate name '" + e.name + "' in " + this);
for (var r = t.nestedArray, f = 0; f < r.length; ++f) e.add(r[f]);
this.remove(t);
this.nested || (this.nested = {});
e.setOptions(t.options, !0);
}
} else this.nested = {};
this.nested[e.name] = e;
e.onAdd(this);
return l(this);
};
u.prototype.remove = function(e) {
if (!(e instanceof r)) throw TypeError("object must be a ReflectionObject");
if (e.parent !== this) throw Error(e + " is not a member of " + this);
delete this.nested[e.name];
Object.keys(this.nested).length || (this.nested = undefined);
e.onRemove(this);
return l(this);
};
u.prototype.define = function(e, t) {
if (f.isString(e)) e = e.split("."); else if (!Array.isArray(e)) throw TypeError("illegal path");
if (e && e.length && "" === e[0]) throw Error("path must be relative");
for (var r = this; e.length > 0; ) {
var n = e.shift();
if (r.nested && r.nested[n]) {
if (!((r = r.nested[n]) instanceof u)) throw Error("path conflicts with non-namespace objects");
} else r.add(r = new u(n));
}
t && r.addJSON(t);
return r;
};
u.prototype.resolveAll = function() {
for (var e = this.nestedArray, t = 0; t < e.length; ) e[t] instanceof u ? e[t++].resolveAll() : e[t++].resolve();
return this.resolve();
};
u.prototype.lookup = function(e, t, r) {
if ("boolean" == typeof t) {
r = t;
t = undefined;
} else t && !Array.isArray(t) && (t = [ t ]);
if (f.isString(e) && e.length) {
if ("." === e) return this.root;
e = e.split(".");
} else if (!e.length) return this;
if ("" === e[0]) return this.root.lookup(e.slice(1), t);
var n = this.get(e[0]);
if (n) {
if (1 === e.length) {
if (!t || t.indexOf(n.constructor) > -1) return n;
} else if (n instanceof u && (n = n.lookup(e.slice(1), t, !0))) return n;
} else for (var i = 0; i < this.nestedArray.length; ++i) if (this._nestedArray[i] instanceof u && (n = this._nestedArray[i].lookup(e, t, !0))) return n;
return null === this.parent || r ? null : this.parent.lookup(e, t);
};
u.prototype.lookupType = function(e) {
var t = this.lookup(e, [ n ]);
if (!t) throw Error("no such type: " + e);
return t;
};
u.prototype.lookupEnum = function(e) {
var t = this.lookup(e, [ o ]);
if (!t) throw Error("no such Enum '" + e + "' in " + this);
return t;
};
u.prototype.lookupTypeOrEnum = function(e) {
var t = this.lookup(e, [ n, o ]);
if (!t) throw Error("no such Type or Enum '" + e + "' in " + this);
return t;
};
u.prototype.lookupService = function(e) {
var t = this.lookup(e, [ i ]);
if (!t) throw Error("no such Service '" + e + "' in " + this);
return t;
};
u._configure = function(e, t, r) {
n = e;
i = t;
o = r;
};
}, {
16: 16,
24: 24,
37: 37
} ],
24: [ function(e, t) {
t.exports = i;
i.className = "ReflectionObject";
var r, n = e(37);
function i(e, t) {
if (!n.isString(e)) throw TypeError("name must be a string");
if (t && !n.isObject(t)) throw TypeError("options must be an object");
this.options = t;
this.parsedOptions = null;
this.name = e;
this.parent = null;
this.resolved = !1;
this.comment = null;
this.filename = null;
}
Object.defineProperties(i.prototype, {
root: {
get: function() {
for (var e = this; null !== e.parent; ) e = e.parent;
return e;
}
},
fullName: {
get: function() {
for (var e = [ this.name ], t = this.parent; t; ) {
e.unshift(t.name);
t = t.parent;
}
return e.join(".");
}
}
});
i.prototype.toJSON = function() {
throw Error();
};
i.prototype.onAdd = function(e) {
this.parent && this.parent !== e && this.parent.remove(this);
this.parent = e;
this.resolved = !1;
var t = e.root;
t instanceof r && t._handleAdd(this);
};
i.prototype.onRemove = function(e) {
var t = e.root;
t instanceof r && t._handleRemove(this);
this.parent = null;
this.resolved = !1;
};
i.prototype.resolve = function() {
if (this.resolved) return this;
this.root instanceof r && (this.resolved = !0);
return this;
};
i.prototype.getOption = function(e) {
return this.options ? this.options[e] : undefined;
};
i.prototype.setOption = function(e, t, r) {
r && this.options && this.options[e] !== undefined || ((this.options || (this.options = {}))[e] = t);
return this;
};
i.prototype.setParsedOption = function(e, t, r) {
this.parsedOptions || (this.parsedOptions = []);
var i = this.parsedOptions;
if (r) {
var o = i.find(function(t) {
return Object.prototype.hasOwnProperty.call(t, e);
});
if (o) {
var s = o[e];
n.setProperty(s, r, t);
} else {
(o = {})[e] = n.setProperty({}, r, t);
i.push(o);
}
} else {
var f = {};
f[e] = t;
i.push(f);
}
return this;
};
i.prototype.setOptions = function(e, t) {
if (e) for (var r = Object.keys(e), n = 0; n < r.length; ++n) this.setOption(r[n], e[r[n]], t);
return this;
};
i.prototype.toString = function() {
var e = this.constructor.className, t = this.fullName;
return t.length ? e + " " + t : e;
};
i._configure = function(e) {
r = e;
};
}, {
37: 37
} ],
25: [ function(e, t) {
t.exports = o;
var r = e(24);
((o.prototype = Object.create(r.prototype)).constructor = o).className = "OneOf";
var n = e(16), i = e(37);
function o(e, t, n, i) {
if (!Array.isArray(t)) {
n = t;
t = undefined;
}
r.call(this, e, n);
if (t !== undefined && !Array.isArray(t)) throw TypeError("fieldNames must be an Array");
this.oneof = t || [];
this.fieldsArray = [];
this.comment = i;
}
o.fromJSON = function(e, t) {
return new o(e, t.oneof, t.options, t.comment);
};
o.prototype.toJSON = function(e) {
var t = !!e && Boolean(e.keepComments);
return i.toObject([ "options", this.options, "oneof", this.oneof, "comment", t ? this.comment : undefined ]);
};
function s(e) {
if (e.parent) for (var t = 0; t < e.fieldsArray.length; ++t) e.fieldsArray[t].parent || e.parent.add(e.fieldsArray[t]);
}
o.prototype.add = function(e) {
if (!(e instanceof n)) throw TypeError("field must be a Field");
e.parent && e.parent !== this.parent && e.parent.remove(e);
this.oneof.push(e.name);
this.fieldsArray.push(e);
e.partOf = this;
s(this);
return this;
};
o.prototype.remove = function(e) {
if (!(e instanceof n)) throw TypeError("field must be a Field");
var t = this.fieldsArray.indexOf(e);
if (t < 0) throw Error(e + " is not a member of " + this);
this.fieldsArray.splice(t, 1);
(t = this.oneof.indexOf(e.name)) > -1 && this.oneof.splice(t, 1);
e.partOf = null;
return this;
};
o.prototype.onAdd = function(e) {
r.prototype.onAdd.call(this, e);
for (var t = 0; t < this.oneof.length; ++t) {
var n = e.get(this.oneof[t]);
if (n && !n.partOf) {
n.partOf = this;
this.fieldsArray.push(n);
}
}
s(this);
};
o.prototype.onRemove = function(e) {
for (var t, n = 0; n < this.fieldsArray.length; ++n) (t = this.fieldsArray[n]).parent && t.parent.remove(t);
r.prototype.onRemove.call(this, e);
};
o.d = function() {
for (var e = new Array(arguments.length), t = 0; t < arguments.length; ) e[t] = arguments[t++];
return function(t, r) {
i.decorateType(t.constructor).add(new o(r, e));
Object.defineProperty(t, r, {
get: i.oneOfGetter(e),
set: i.oneOfSetter(e)
});
};
};
}, {
16: 16,
24: 24,
37: 37
} ],
26: [ function(e, t) {
t.exports = j;
j.filename = null;
j.defaults = {
keepCase: !1
};
var r = e(34), n = e(29), i = e(35), o = e(16), s = e(20), f = e(25), a = e(15), u = e(33), l = e(22), p = e(36), c = e(37), h = /^[1-9][0-9]*$/, d = /^-?[1-9][0-9]*$/, y = /^0[x][0-9a-fA-F]+$/, m = /^-?0[x][0-9a-fA-F]+$/, v = /^0[0-7]+$/, g = /^-?0[0-7]+$/, b = /^(?![eE])[0-9]*(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?$/, w = /^[a-zA-Z_][a-zA-Z_0-9]*$/, O = /^(?:\.?[a-zA-Z_][a-zA-Z_0-9]*)(?:\.[a-zA-Z_][a-zA-Z_0-9]*)*$/, k = /^(?:\.[a-zA-Z_][a-zA-Z_0-9]*)+$/;
function j(e, t, A) {
if (!(t instanceof n)) {
A = t;
t = new n();
}
A || (A = j.defaults);
var x, _, S, T, N, E = A.preferTrailingComment || !1, B = r(e, A.alternateCommentMode || !1), I = B.next, R = B.push, D = B.peek, F = B.skip, L = B.cmnt, P = !0, $ = !1, J = t, C = A.keepCase ? function(e) {
return e;
} : c.camelCase;
function q(e, t, r) {
var n = j.filename;
r || (j.filename = null);
return Error("illegal " + (t || "token") + " '" + e + "' (" + (n ? n + ", " : "") + "line " + B.line + ")");
}
function z() {
var e, t = [];
do {
if ('"' !== (e = I()) && "'" !== e) throw q(e);
t.push(I());
F(e);
e = D();
} while ('"' === e || "'" === e);
return t.join("");
}
function V(e) {
var t = I();
switch (t) {
case "'":
case '"':
R(t);
return z();

case "true":
case "TRUE":
return !0;

case "false":
case "FALSE":
return !1;
}
try {
return U(t, !0);
} catch (r) {
if (e && O.test(t)) return t;
throw q(t, "value");
}
}
function M(e, t) {
var r, n;
do {
!t || '"' !== (r = D()) && "'" !== r ? e.push([ n = Z(I()), F("to", !0) ? Z(I()) : n ]) : e.push(z());
} while (F(",", !0));
F(";");
}
function U(e, t) {
var r = 1;
if ("-" === e.charAt(0)) {
r = -1;
e = e.substring(1);
}
switch (e) {
case "inf":
case "INF":
case "Inf":
return Infinity * r;

case "nan":
case "NAN":
case "Nan":
case "NaN":
return NaN;

case "0":
return 0;
}
if (h.test(e)) return r * parseInt(e, 10);
if (y.test(e)) return r * parseInt(e, 16);
if (v.test(e)) return r * parseInt(e, 8);
if (b.test(e)) return r * parseFloat(e);
throw q(e, "number", t);
}
function Z(e, t) {
switch (e) {
case "max":
case "MAX":
case "Max":
return 536870911;

case "0":
return 0;
}
if (!t && "-" === e.charAt(0)) throw q(e, "id");
if (d.test(e)) return parseInt(e, 10);
if (m.test(e)) return parseInt(e, 16);
if (g.test(e)) return parseInt(e, 8);
throw q(e, "id");
}
function H() {
if (x !== undefined) throw q("package");
x = I();
if (!O.test(x)) throw q(x, "name");
J = J.define(x);
F(";");
}
function W() {
var e, t = D();
switch (t) {
case "weak":
e = S || (S = []);
I();
break;

case "public":
I();

default:
e = _ || (_ = []);
}
t = z();
F(";");
e.push(t);
}
function K() {
F("=");
T = z();
if (!($ = "proto3" === T) && "proto2" !== T) throw q(T, "syntax");
F(";");
}
function G(e, t) {
switch (t) {
case "option":
oe(e, t);
F(";");
return !0;

case "message":
Q(e, t);
return !0;

case "enum":
ne(e, t);
return !0;

case "service":
le(e, t);
return !0;

case "extend":
ce(e, t);
return !0;
}
return !1;
}
function X(e, t, r) {
var n = B.line;
if (e) {
"string" != typeof e.comment && (e.comment = L());
e.filename = j.filename;
}
if (F("{", !0)) {
for (var i; "}" !== (i = I()); ) t(i);
F(";", !0);
} else {
r && r();
F(";");
e && ("string" != typeof e.comment || E) && (e.comment = L(n) || e.comment);
}
}
function Q(e, t) {
if (!w.test(t = I())) throw q(t, "type name");
var r = new i(t);
X(r, function(e) {
if (!G(r, e)) switch (e) {
case "map":
te(r);
break;

case "required":
case "repeated":
Y(r, e);
break;

case "optional":
Y(r, $ ? "proto3_optional" : "optional");
break;

case "oneof":
re(r, e);
break;

case "extensions":
M(r.extensions || (r.extensions = []));
break;

case "reserved":
M(r.reserved || (r.reserved = []), !0);
break;

default:
if (!$ || !O.test(e)) throw q(e);
R(e);
Y(r, "optional");
}
});
e.add(r);
}
function Y(e, t, r) {
var n = I();
if ("group" !== n) {
if (!O.test(n)) throw q(n, "type");
var i = I();
if (!w.test(i)) throw q(i, "name");
i = C(i);
F("=");
var s = new o(i, Z(I()), n, t, r);
X(s, function(e) {
if ("option" !== e) throw q(e);
oe(s, e);
F(";");
}, function() {
ue(s);
});
if ("proto3_optional" === t) {
var a = new f("_" + i);
s.setOption("proto3_optional", !0);
a.add(s);
e.add(a);
} else e.add(s);
$ || !s.repeated || p.packed[n] === undefined && p.basic[n] !== undefined || s.setOption("packed", !1, !0);
} else ee(e, t);
}
function ee(e, t) {
var r = I();
if (!w.test(r)) throw q(r, "name");
var n = c.lcFirst(r);
r === n && (r = c.ucFirst(r));
F("=");
var s = Z(I()), f = new i(r);
f.group = !0;
var a = new o(n, s, r, t);
a.filename = j.filename;
X(f, function(e) {
switch (e) {
case "option":
oe(f, e);
F(";");
break;

case "required":
case "repeated":
Y(f, e);
break;

case "optional":
Y(f, $ ? "proto3_optional" : "optional");
break;

default:
throw q(e);
}
});
e.add(f).add(a);
}
function te(e) {
F("<");
var t = I();
if (p.mapKey[t] === undefined) throw q(t, "type");
F(",");
var r = I();
if (!O.test(r)) throw q(r, "type");
F(">");
var n = I();
if (!w.test(n)) throw q(n, "name");
F("=");
var i = new s(C(n), Z(I()), t, r);
X(i, function(e) {
if ("option" !== e) throw q(e);
oe(i, e);
F(";");
}, function() {
ue(i);
});
e.add(i);
}
function re(e, t) {
if (!w.test(t = I())) throw q(t, "name");
var r = new f(C(t));
X(r, function(e) {
if ("option" === e) {
oe(r, e);
F(";");
} else {
R(e);
Y(r, "optional");
}
});
e.add(r);
}
function ne(e, t) {
if (!w.test(t = I())) throw q(t, "name");
var r = new a(t);
X(r, function(e) {
switch (e) {
case "option":
oe(r, e);
F(";");
break;

case "reserved":
M(r.reserved || (r.reserved = []), !0);
break;

default:
ie(r, e);
}
});
e.add(r);
}
function ie(e, t) {
if (!w.test(t)) throw q(t, "name");
F("=");
var r = Z(I(), !0), n = {};
X(n, function(e) {
if ("option" !== e) throw q(e);
oe(n, e);
F(";");
}, function() {
ue(n);
});
e.add(t, r, n.comment);
}
function oe(e, t) {
var r = F("(", !0);
if (!O.test(t = I())) throw q(t, "name");
var n, i = t, o = i;
if (r) {
F(")");
o = i = "(" + i + ")";
t = D();
if (k.test(t)) {
n = t.substr(1);
i += t;
I();
}
}
F("=");
ae(e, o, se(e, i), n);
}
function se(e, t) {
if (F("{", !0)) {
for (var r = {}; !F("}", !0); ) {
if (!w.test(N = I())) throw q(N, "name");
var n, i = N;
if ("{" === D()) n = se(e, t + "." + N); else {
F(":");
if ("{" === D()) n = se(e, t + "." + N); else {
n = V(!0);
fe(e, t + "." + N, n);
}
}
var o = r[i];
o && (n = [].concat(o).concat(n));
r[i] = n;
F(",", !0);
}
return r;
}
var s = V(!0);
fe(e, t, s);
return s;
}
function fe(e, t, r) {
e.setOption && e.setOption(t, r);
}
function ae(e, t, r, n) {
e.setParsedOption && e.setParsedOption(t, r, n);
}
function ue(e) {
if (F("[", !0)) {
do {
oe(e, "option");
} while (F(",", !0));
F("]");
}
return e;
}
function le(e, t) {
if (!w.test(t = I())) throw q(t, "service name");
var r = new u(t);
X(r, function(e) {
if (!G(r, e)) {
if ("rpc" !== e) throw q(e);
pe(r, e);
}
});
e.add(r);
}
function pe(e, t) {
var r = L(), n = t;
if (!w.test(t = I())) throw q(t, "name");
var i, o, s, f, a = t;
F("(");
F("stream", !0) && (o = !0);
if (!O.test(t = I())) throw q(t);
i = t;
F(")");
F("returns");
F("(");
F("stream", !0) && (f = !0);
if (!O.test(t = I())) throw q(t);
s = t;
F(")");
var u = new l(a, n, i, s, o, f);
u.comment = r;
X(u, function(e) {
if ("option" !== e) throw q(e);
oe(u, e);
F(";");
});
e.add(u);
}
function ce(e, t) {
if (!O.test(t = I())) throw q(t, "reference");
var r = t;
X(null, function(t) {
switch (t) {
case "required":
case "repeated":
Y(e, t, r);
break;

case "optional":
Y(e, $ ? "proto3_optional" : "optional", r);
break;

default:
if (!$ || !O.test(t)) throw q(t);
R(t);
Y(e, "optional", r);
}
});
}
for (;null !== (N = I()); ) switch (N) {
case "package":
if (!P) throw q(N);
H();
break;

case "import":
if (!P) throw q(N);
W();
break;

case "syntax":
if (!P) throw q(N);
K();
break;

case "option":
oe(J, N);
F(";");
break;

default:
if (G(J, N)) {
P = !1;
continue;
}
throw q(N);
}
j.filename = null;
return {
package: x,
imports: _,
weakImports: S,
syntax: T,
root: t
};
}
}, {
15: 15,
16: 16,
20: 20,
22: 22,
25: 25,
29: 29,
33: 33,
34: 34,
35: 35,
36: 36,
37: 37
} ],
27: [ function(e, t) {
t.exports = f;
var r, n = e(39), i = n.LongBits, o = n.utf8;
function s(e, t) {
return RangeError("index out of range: " + e.pos + " + " + (t || 1) + " > " + e.len);
}
function f(e) {
this.buf = e;
this.pos = 0;
this.len = e.length;
}
var a, u = "undefined" != typeof Uint8Array ? function(e) {
if (e instanceof Uint8Array || Array.isArray(e)) return new f(e);
throw Error("illegal buffer");
} : function(e) {
if (Array.isArray(e)) return new f(e);
throw Error("illegal buffer");
}, l = function() {
return n.Buffer ? function(e) {
return (f.create = function(e) {
return n.Buffer.isBuffer(e) ? new r(e) : u(e);
})(e);
} : u;
};
f.create = l();
f.prototype._slice = n.Array.prototype.subarray || n.Array.prototype.slice;
f.prototype.uint32 = (a = 4294967295, function() {
a = (127 & this.buf[this.pos]) >>> 0;
if (this.buf[this.pos++] < 128) return a;
a = (a | (127 & this.buf[this.pos]) << 7) >>> 0;
if (this.buf[this.pos++] < 128) return a;
a = (a | (127 & this.buf[this.pos]) << 14) >>> 0;
if (this.buf[this.pos++] < 128) return a;
a = (a | (127 & this.buf[this.pos]) << 21) >>> 0;
if (this.buf[this.pos++] < 128) return a;
a = (a | (15 & this.buf[this.pos]) << 28) >>> 0;
if (this.buf[this.pos++] < 128) return a;
if ((this.pos += 5) > this.len) {
this.pos = this.len;
throw s(this, 10);
}
return a;
});
f.prototype.int32 = function() {
return 0 | this.uint32();
};
f.prototype.sint32 = function() {
var e = this.uint32();
return e >>> 1 ^ -(1 & e) | 0;
};
function p() {
var e = new i(0, 0), t = 0;
if (!(this.len - this.pos > 4)) {
for (;t < 3; ++t) {
if (this.pos >= this.len) throw s(this);
e.lo = (e.lo | (127 & this.buf[this.pos]) << 7 * t) >>> 0;
if (this.buf[this.pos++] < 128) return e;
}
e.lo = (e.lo | (127 & this.buf[this.pos++]) << 7 * t) >>> 0;
return e;
}
for (;t < 4; ++t) {
e.lo = (e.lo | (127 & this.buf[this.pos]) << 7 * t) >>> 0;
if (this.buf[this.pos++] < 128) return e;
}
e.lo = (e.lo | (127 & this.buf[this.pos]) << 28) >>> 0;
e.hi = (e.hi | (127 & this.buf[this.pos]) >> 4) >>> 0;
if (this.buf[this.pos++] < 128) return e;
t = 0;
if (this.len - this.pos > 4) for (;t < 5; ++t) {
e.hi = (e.hi | (127 & this.buf[this.pos]) << 7 * t + 3) >>> 0;
if (this.buf[this.pos++] < 128) return e;
} else for (;t < 5; ++t) {
if (this.pos >= this.len) throw s(this);
e.hi = (e.hi | (127 & this.buf[this.pos]) << 7 * t + 3) >>> 0;
if (this.buf[this.pos++] < 128) return e;
}
throw Error("invalid varint encoding");
}
f.prototype.bool = function() {
return 0 !== this.uint32();
};
function c(e, t) {
return (e[t - 4] | e[t - 3] << 8 | e[t - 2] << 16 | e[t - 1] << 24) >>> 0;
}
f.prototype.fixed32 = function() {
if (this.pos + 4 > this.len) throw s(this, 4);
return c(this.buf, this.pos += 4);
};
f.prototype.sfixed32 = function() {
if (this.pos + 4 > this.len) throw s(this, 4);
return 0 | c(this.buf, this.pos += 4);
};
function h() {
if (this.pos + 8 > this.len) throw s(this, 8);
return new i(c(this.buf, this.pos += 4), c(this.buf, this.pos += 4));
}
f.prototype.float = function() {
if (this.pos + 4 > this.len) throw s(this, 4);
var e = n.float.readFloatLE(this.buf, this.pos);
this.pos += 4;
return e;
};
f.prototype.double = function() {
if (this.pos + 8 > this.len) throw s(this, 4);
var e = n.float.readDoubleLE(this.buf, this.pos);
this.pos += 8;
return e;
};
f.prototype.bytes = function() {
var e = this.uint32(), t = this.pos, r = this.pos + e;
if (r > this.len) throw s(this, e);
this.pos += e;
return Array.isArray(this.buf) ? this.buf.slice(t, r) : t === r ? new this.buf.constructor(0) : this._slice.call(this.buf, t, r);
};
f.prototype.string = function() {
var e = this.bytes();
return o.read(e, 0, e.length);
};
f.prototype.skip = function(e) {
if ("number" == typeof e) {
if (this.pos + e > this.len) throw s(this, e);
this.pos += e;
} else do {
if (this.pos >= this.len) throw s(this);
} while (128 & this.buf[this.pos++]);
return this;
};
f.prototype.skipType = function(e) {
switch (e) {
case 0:
this.skip();
break;

case 1:
this.skip(8);
break;

case 2:
this.skip(this.uint32());
break;

case 3:
for (;4 != (e = 7 & this.uint32()); ) this.skipType(e);
break;

case 5:
this.skip(4);
break;

default:
throw Error("invalid wire type " + e + " at offset " + this.pos);
}
return this;
};
f._configure = function(e) {
r = e;
f.create = l();
r._configure();
var t = n.Long ? "toLong" : "toNumber";
n.merge(f.prototype, {
int64: function() {
return p.call(this)[t](!1);
},
uint64: function() {
return p.call(this)[t](!0);
},
sint64: function() {
return p.call(this).zzDecode()[t](!1);
},
fixed64: function() {
return h.call(this)[t](!0);
},
sfixed64: function() {
return h.call(this)[t](!1);
}
});
};
}, {
39: 39
} ],
28: [ function(e, t) {
t.exports = i;
var r = e(27);
(i.prototype = Object.create(r.prototype)).constructor = i;
var n = e(39);
function i(e) {
r.call(this, e);
}
i._configure = function() {
n.Buffer && (i.prototype._slice = n.Buffer.prototype.slice);
};
i.prototype.string = function() {
var e = this.uint32();
return this.buf.utf8Slice ? this.buf.utf8Slice(this.pos, this.pos = Math.min(this.pos + e, this.len)) : this.buf.toString("utf-8", this.pos, this.pos = Math.min(this.pos + e, this.len));
};
i._configure();
}, {
27: 27,
39: 39
} ],
29: [ function(e, t) {
t.exports = l;
var r = e(23);
((l.prototype = Object.create(r.prototype)).constructor = l).className = "Root";
var n, i, o, s = e(16), f = e(15), a = e(25), u = e(37);
function l(e) {
r.call(this, "", e);
this.deferred = [];
this.files = [];
}
l.fromJSON = function(e, t) {
t || (t = new l());
e.options && t.setOptions(e.options);
return t.addJSON(e.nested);
};
l.prototype.resolvePath = u.path.resolve;
l.prototype.fetch = u.fetch;
function p() {}
l.prototype.load = function e(t, r, n) {
if ("function" == typeof r) {
n = r;
r = undefined;
}
var s = this;
if (!n) return u.asPromise(e, s, t, r);
var f = n === p;
function a(e, t) {
if (n) {
var r = n;
n = null;
if (f) throw e;
r(e, t);
}
}
function l(e) {
var t = e.lastIndexOf("google/protobuf/");
if (t > -1) {
var r = e.substring(t);
if (r in o) return r;
}
return null;
}
function c(e, t) {
try {
u.isString(t) && "{" === t.charAt(0) && (t = JSON.parse(t));
if (u.isString(t)) {
i.filename = e;
var n, o = i(t, s, r), p = 0;
if (o.imports) for (;p < o.imports.length; ++p) (n = l(o.imports[p]) || s.resolvePath(e, o.imports[p])) && h(n);
if (o.weakImports) for (p = 0; p < o.weakImports.length; ++p) (n = l(o.weakImports[p]) || s.resolvePath(e, o.weakImports[p])) && h(n, !0);
} else s.setOptions(t.options).addJSON(t.nested);
} catch (e) {
a(e);
}
f || d || a(null, s);
}
function h(e, t) {
if (!(s.files.indexOf(e) > -1)) {
s.files.push(e);
if (e in o) if (f) c(e, o[e]); else {
++d;
setTimeout(function() {
--d;
c(e, o[e]);
});
} else if (f) {
var r;
try {
r = u.fs.readFileSync(e).toString("utf8");
} catch (e) {
t || a(e);
return;
}
c(e, r);
} else {
++d;
s.fetch(e, function(r, i) {
--d;
n && (r ? t ? d || a(null, s) : a(r) : c(e, i));
});
}
}
}
var d = 0;
u.isString(t) && (t = [ t ]);
for (var y, m = 0; m < t.length; ++m) (y = s.resolvePath("", t[m])) && h(y);
if (f) return s;
d || a(null, s);
return undefined;
};
l.prototype.loadSync = function(e, t) {
if (!u.isNode) throw Error("not supported");
return this.load(e, t, p);
};
l.prototype.resolveAll = function() {
if (this.deferred.length) throw Error("unresolvable extensions: " + this.deferred.map(function(e) {
return "'extend " + e.extend + "' in " + e.parent.fullName;
}).join(", "));
return r.prototype.resolveAll.call(this);
};
var c = /^[A-Z]/;
function h(e, t) {
var r = t.parent.lookup(t.extend);
if (r) {
var n = new s(t.fullName, t.id, t.type, t.rule, undefined, t.options);
n.declaringField = t;
t.extensionField = n;
r.add(n);
return !0;
}
return !1;
}
l.prototype._handleAdd = function(e) {
if (e instanceof s) e.extend === undefined || e.extensionField || h(0, e) || this.deferred.push(e); else if (e instanceof f) c.test(e.name) && (e.parent[e.name] = e.values); else if (!(e instanceof a)) {
if (e instanceof n) for (var t = 0; t < this.deferred.length; ) h(0, this.deferred[t]) ? this.deferred.splice(t, 1) : ++t;
for (var r = 0; r < e.nestedArray.length; ++r) this._handleAdd(e._nestedArray[r]);
c.test(e.name) && (e.parent[e.name] = e);
}
};
l.prototype._handleRemove = function(e) {
if (e instanceof s) {
if (e.extend !== undefined) if (e.extensionField) {
e.extensionField.parent.remove(e.extensionField);
e.extensionField = null;
} else {
var t = this.deferred.indexOf(e);
t > -1 && this.deferred.splice(t, 1);
}
} else if (e instanceof f) c.test(e.name) && delete e.parent[e.name]; else if (e instanceof r) {
for (var n = 0; n < e.nestedArray.length; ++n) this._handleRemove(e._nestedArray[n]);
c.test(e.name) && delete e.parent[e.name];
}
};
l._configure = function(e, t, r) {
n = e;
i = t;
o = r;
};
}, {
15: 15,
16: 16,
23: 23,
25: 25,
37: 37
} ],
30: [ function(e, t) {
t.exports = {};
}, {} ],
31: [ function(e, t, r) {
r.Service = e(32);
}, {
32: 32
} ],
32: [ function(e, t) {
t.exports = n;
var r = e(39);
(n.prototype = Object.create(r.EventEmitter.prototype)).constructor = n;
function n(e, t, n) {
if ("function" != typeof e) throw TypeError("rpcImpl must be a function");
r.EventEmitter.call(this);
this.rpcImpl = e;
this.requestDelimited = Boolean(t);
this.responseDelimited = Boolean(n);
}
n.prototype.rpcCall = function e(t, n, i, o, s) {
if (!o) throw TypeError("request must be specified");
var f = this;
if (!s) return r.asPromise(e, f, t, n, i, o);
if (!f.rpcImpl) {
setTimeout(function() {
s(Error("already ended"));
}, 0);
return undefined;
}
try {
return f.rpcImpl(t, n[f.requestDelimited ? "encodeDelimited" : "encode"](o).finish(), function(e, r) {
if (e) {
f.emit("error", e, t);
return s(e);
}
if (null === r) {
f.end(!0);
return undefined;
}
if (!(r instanceof i)) try {
r = i[f.responseDelimited ? "decodeDelimited" : "decode"](r);
} catch (e) {
f.emit("error", e, t);
return s(e);
}
f.emit("data", r, t);
return s(null, r);
});
} catch (e) {
f.emit("error", e, t);
setTimeout(function() {
s(e);
}, 0);
return undefined;
}
};
n.prototype.end = function(e) {
if (this.rpcImpl) {
e || this.rpcImpl(null, null, null);
this.rpcImpl = null;
this.emit("end").off();
}
return this;
};
}, {
39: 39
} ],
33: [ function(e, t) {
t.exports = s;
var r = e(23);
((s.prototype = Object.create(r.prototype)).constructor = s).className = "Service";
var n = e(22), i = e(37), o = e(31);
function s(e, t) {
r.call(this, e, t);
this.methods = {};
this._methodsArray = null;
}
s.fromJSON = function(e, t) {
var r = new s(e, t.options);
if (t.methods) for (var i = Object.keys(t.methods), o = 0; o < i.length; ++o) r.add(n.fromJSON(i[o], t.methods[i[o]]));
t.nested && r.addJSON(t.nested);
r.comment = t.comment;
return r;
};
s.prototype.toJSON = function(e) {
var t = r.prototype.toJSON.call(this, e), n = !!e && Boolean(e.keepComments);
return i.toObject([ "options", t && t.options || undefined, "methods", r.arrayToJSON(this.methodsArray, e) || {}, "nested", t && t.nested || undefined, "comment", n ? this.comment : undefined ]);
};
Object.defineProperty(s.prototype, "methodsArray", {
get: function() {
return this._methodsArray || (this._methodsArray = i.toArray(this.methods));
}
});
function f(e) {
e._methodsArray = null;
return e;
}
s.prototype.get = function(e) {
return this.methods[e] || r.prototype.get.call(this, e);
};
s.prototype.resolveAll = function() {
for (var e = this.methodsArray, t = 0; t < e.length; ++t) e[t].resolve();
return r.prototype.resolve.call(this);
};
s.prototype.add = function(e) {
if (this.get(e.name)) throw Error("duplicate name '" + e.name + "' in " + this);
if (e instanceof n) {
this.methods[e.name] = e;
e.parent = this;
return f(this);
}
return r.prototype.add.call(this, e);
};
s.prototype.remove = function(e) {
if (e instanceof n) {
if (this.methods[e.name] !== e) throw Error(e + " is not a member of " + this);
delete this.methods[e.name];
e.parent = null;
return f(this);
}
return r.prototype.remove.call(this, e);
};
s.prototype.create = function(e, t, r) {
for (var n, s = new o.Service(e, t, r), f = 0; f < this.methodsArray.length; ++f) {
var a = i.lcFirst((n = this._methodsArray[f]).resolve().name).replace(/[^$\w_]/g, "");
s[a] = i.codegen([ "r", "c" ], i.isReserved(a) ? a + "_" : a)("return this.rpcCall(m,q,s,r,c)")({
m: n,
q: n.resolvedRequestType.ctor,
s: n.resolvedResponseType.ctor
});
}
return s;
};
}, {
22: 22,
23: 23,
31: 31,
37: 37
} ],
34: [ function(e, t) {
t.exports = c;
var r = /[\s{}=;:[\],'"()<>]/g, n = /(?:"([^"\\]*(?:\\.[^"\\]*)*)")/g, i = /(?:'([^'\\]*(?:\\.[^'\\]*)*)')/g, o = /^ *[*/]+ */, s = /^\s*\*?\/*/, f = /\n/g, a = /\s/, u = /\\(.?)/g, l = {
0: "\0",
r: "\r",
n: "\n",
t: "\t"
};
function p(e) {
return e.replace(u, function(e, t) {
switch (t) {
case "\\":
case "":
return t;

default:
return l[t] || "";
}
});
}
c.unescape = p;
function c(e, t) {
e = e.toString();
var u = 0, l = e.length, c = 1, h = null, d = null, y = 0, m = !1, v = !1, g = [], b = null;
function w(e) {
return Error("illegal " + e + " (line " + c + ")");
}
function O() {
var t = "'" === b ? i : n;
t.lastIndex = u - 1;
var r = t.exec(e);
if (!r) throw w("string");
u = t.lastIndex;
S(b);
b = null;
return p(r[1]);
}
function k(t) {
return e.charAt(t);
}
function j(r, n, i) {
h = e.charAt(r++);
y = c;
m = !1;
v = i;
var a, u = r - (t ? 2 : 3);
do {
if (--u < 0 || "\n" === (a = e.charAt(u))) {
m = !0;
break;
}
} while (" " === a || "\t" === a);
for (var l = e.substring(r, n).split(f), p = 0; p < l.length; ++p) l[p] = l[p].replace(t ? s : o, "").trim();
d = l.join("\n").trim();
}
function A(t) {
var r = x(t), n = e.substring(t, r);
return /^\s*\/{1,2}/.test(n);
}
function x(e) {
for (var t = e; t < l && "\n" !== k(t); ) t++;
return t;
}
function _() {
if (g.length > 0) return g.shift();
if (b) return O();
var n, i, o, s, f, p = 0 === u;
do {
if (u === l) return null;
n = !1;
for (;a.test(o = k(u)); ) {
if ("\n" === o) {
p = !0;
++c;
}
if (++u === l) return null;
}
if ("/" === k(u)) {
if (++u === l) throw w("comment");
if ("/" === k(u)) if (t) {
s = u;
f = !1;
if (A(u)) {
f = !0;
do {
if ((u = x(u)) === l) break;
u++;
} while (A(u));
} else u = Math.min(l, x(u) + 1);
f && j(s, u, p);
c++;
n = !0;
} else {
f = "/" === k(s = u + 1);
for (;"\n" !== k(++u); ) if (u === l) return null;
++u;
f && j(s, u - 1, p);
++c;
n = !0;
} else {
if ("*" !== (o = k(u))) return "/";
s = u + 1;
f = t || "*" === k(s);
do {
"\n" === o && ++c;
if (++u === l) throw w("comment");
i = o;
o = k(u);
} while ("*" !== i || "/" !== o);
++u;
f && j(s, u - 2, p);
n = !0;
}
}
} while (n);
var h = u;
r.lastIndex = 0;
if (!r.test(k(h++))) for (;h < l && !r.test(k(h)); ) ++h;
var d = e.substring(u, u = h);
'"' !== d && "'" !== d || (b = d);
return d;
}
function S(e) {
g.push(e);
}
function T() {
if (!g.length) {
var e = _();
if (null === e) return null;
S(e);
}
return g[0];
}
return Object.defineProperty({
next: _,
peek: T,
push: S,
skip: function(e, t) {
var r = T();
if (r === e) {
_();
return !0;
}
if (!t) throw w("token '" + r + "', '" + e + "' expected");
return !1;
},
cmnt: function(e) {
var r = null;
if (e === undefined) y === c - 1 && (t || "*" === h || m) && (r = v ? d : null); else {
y < e && T();
y !== e || m || !t && "/" !== h || (r = v ? null : d);
}
return r;
}
}, "line", {
get: function() {
return c;
}
});
}
}, {} ],
35: [ function(e, t) {
t.exports = v;
var r = e(23);
((v.prototype = Object.create(r.prototype)).constructor = v).className = "Type";
var n = e(15), i = e(25), o = e(16), s = e(20), f = e(33), a = e(21), u = e(27), l = e(42), p = e(37), c = e(14), h = e(13), d = e(40), y = e(12), m = e(41);
function v(e, t) {
r.call(this, e, t);
this.fields = {};
this.oneofs = undefined;
this.extensions = undefined;
this.reserved = undefined;
this.group = undefined;
this._fieldsById = null;
this._fieldsArray = null;
this._oneofsArray = null;
this._ctor = null;
}
Object.defineProperties(v.prototype, {
fieldsById: {
get: function() {
if (this._fieldsById) return this._fieldsById;
this._fieldsById = {};
for (var e = Object.keys(this.fields), t = 0; t < e.length; ++t) {
var r = this.fields[e[t]], n = r.id;
if (this._fieldsById[n]) throw Error("duplicate id " + n + " in " + this);
this._fieldsById[n] = r;
}
return this._fieldsById;
}
},
fieldsArray: {
get: function() {
return this._fieldsArray || (this._fieldsArray = p.toArray(this.fields));
}
},
oneofsArray: {
get: function() {
return this._oneofsArray || (this._oneofsArray = p.toArray(this.oneofs));
}
},
ctor: {
get: function() {
return this._ctor || (this.ctor = v.generateConstructor(this)());
},
set: function(e) {
var t = e.prototype;
if (!(t instanceof a)) {
(e.prototype = new a()).constructor = e;
p.merge(e.prototype, t);
}
e.$type = e.prototype.$type = this;
p.merge(e, a, !0);
this._ctor = e;
for (var r = 0; r < this.fieldsArray.length; ++r) this._fieldsArray[r].resolve();
var n = {};
for (r = 0; r < this.oneofsArray.length; ++r) n[this._oneofsArray[r].resolve().name] = {
get: p.oneOfGetter(this._oneofsArray[r].oneof),
set: p.oneOfSetter(this._oneofsArray[r].oneof)
};
r && Object.defineProperties(e.prototype, n);
}
}
});
v.generateConstructor = function(e) {
for (var t, r = p.codegen([ "p" ], e.name), n = 0; n < e.fieldsArray.length; ++n) (t = e._fieldsArray[n]).map ? r("this%s={}", p.safeProp(t.name)) : t.repeated && r("this%s=[]", p.safeProp(t.name));
return r("if(p)for(var ks=Object.keys(p),i=0;i<ks.length;++i)if(p[ks[i]]!=null)")("this[ks[i]]=p[ks[i]]");
};
function g(e) {
e._fieldsById = e._fieldsArray = e._oneofsArray = null;
delete e.encode;
delete e.decode;
delete e.verify;
return e;
}
v.fromJSON = function(e, t) {
var a = new v(e, t.options);
a.extensions = t.extensions;
a.reserved = t.reserved;
for (var u = Object.keys(t.fields), l = 0; l < u.length; ++l) a.add(("undefined" != typeof t.fields[u[l]].keyType ? s.fromJSON : o.fromJSON)(u[l], t.fields[u[l]]));
if (t.oneofs) for (u = Object.keys(t.oneofs), l = 0; l < u.length; ++l) a.add(i.fromJSON(u[l], t.oneofs[u[l]]));
if (t.nested) for (u = Object.keys(t.nested), l = 0; l < u.length; ++l) {
var p = t.nested[u[l]];
a.add((p.id !== undefined ? o.fromJSON : p.fields !== undefined ? v.fromJSON : p.values !== undefined ? n.fromJSON : p.methods !== undefined ? f.fromJSON : r.fromJSON)(u[l], p));
}
t.extensions && t.extensions.length && (a.extensions = t.extensions);
t.reserved && t.reserved.length && (a.reserved = t.reserved);
t.group && (a.group = !0);
t.comment && (a.comment = t.comment);
return a;
};
v.prototype.toJSON = function(e) {
var t = r.prototype.toJSON.call(this, e), n = !!e && Boolean(e.keepComments);
return p.toObject([ "options", t && t.options || undefined, "oneofs", r.arrayToJSON(this.oneofsArray, e), "fields", r.arrayToJSON(this.fieldsArray.filter(function(e) {
return !e.declaringField;
}), e) || {}, "extensions", this.extensions && this.extensions.length ? this.extensions : undefined, "reserved", this.reserved && this.reserved.length ? this.reserved : undefined, "group", this.group || undefined, "nested", t && t.nested || undefined, "comment", n ? this.comment : undefined ]);
};
v.prototype.resolveAll = function() {
for (var e = this.fieldsArray, t = 0; t < e.length; ) e[t++].resolve();
var n = this.oneofsArray;
t = 0;
for (;t < n.length; ) n[t++].resolve();
return r.prototype.resolveAll.call(this);
};
v.prototype.get = function(e) {
return this.fields[e] || this.oneofs && this.oneofs[e] || this.nested && this.nested[e] || null;
};
v.prototype.add = function(e) {
if (this.get(e.name)) throw Error("duplicate name '" + e.name + "' in " + this);
if (e instanceof o && e.extend === undefined) {
if (this._fieldsById ? this._fieldsById[e.id] : this.fieldsById[e.id]) throw Error("duplicate id " + e.id + " in " + this);
if (this.isReservedId(e.id)) throw Error("id " + e.id + " is reserved in " + this);
if (this.isReservedName(e.name)) throw Error("name '" + e.name + "' is reserved in " + this);
e.parent && e.parent.remove(e);
this.fields[e.name] = e;
e.message = this;
e.onAdd(this);
return g(this);
}
if (e instanceof i) {
this.oneofs || (this.oneofs = {});
this.oneofs[e.name] = e;
e.onAdd(this);
return g(this);
}
return r.prototype.add.call(this, e);
};
v.prototype.remove = function(e) {
if (e instanceof o && e.extend === undefined) {
if (!this.fields || this.fields[e.name] !== e) throw Error(e + " is not a member of " + this);
delete this.fields[e.name];
e.parent = null;
e.onRemove(this);
return g(this);
}
if (e instanceof i) {
if (!this.oneofs || this.oneofs[e.name] !== e) throw Error(e + " is not a member of " + this);
delete this.oneofs[e.name];
e.parent = null;
e.onRemove(this);
return g(this);
}
return r.prototype.remove.call(this, e);
};
v.prototype.isReservedId = function(e) {
return r.isReservedId(this.reserved, e);
};
v.prototype.isReservedName = function(e) {
return r.isReservedName(this.reserved, e);
};
v.prototype.create = function(e) {
return new this.ctor(e);
};
v.prototype.setup = function() {
for (var e = this.fullName, t = [], r = 0; r < this.fieldsArray.length; ++r) t.push(this._fieldsArray[r].resolve().resolvedType);
this.encode = c(this)({
Writer: l,
types: t,
util: p
});
this.decode = h(this)({
Reader: u,
types: t,
util: p
});
this.verify = d(this)({
types: t,
util: p
});
this.fromObject = y.fromObject(this)({
types: t,
util: p
});
this.toObject = y.toObject(this)({
types: t,
util: p
});
var n = m[e];
if (n) {
var i = Object.create(this);
i.fromObject = this.fromObject;
this.fromObject = n.fromObject.bind(i);
i.toObject = this.toObject;
this.toObject = n.toObject.bind(i);
}
return this;
};
v.prototype.encode = function(e, t) {
return this.setup().encode(e, t);
};
v.prototype.encodeDelimited = function(e, t) {
return this.encode(e, t && t.len ? t.fork() : t).ldelim();
};
v.prototype.decode = function(e, t) {
return this.setup().decode(e, t);
};
v.prototype.decodeDelimited = function(e) {
e instanceof u || (e = u.create(e));
return this.decode(e, e.uint32());
};
v.prototype.verify = function(e) {
return this.setup().verify(e);
};
v.prototype.fromObject = function(e) {
return this.setup().fromObject(e);
};
v.prototype.toObject = function(e, t) {
return this.setup().toObject(e, t);
};
v.d = function(e) {
return function(t) {
p.decorateType(t, e);
};
};
}, {
12: 12,
13: 13,
14: 14,
15: 15,
16: 16,
20: 20,
21: 21,
23: 23,
25: 25,
27: 27,
33: 33,
37: 37,
40: 40,
41: 41,
42: 42
} ],
36: [ function(e, t, r) {
var n = r, i = e(37), o = [ "double", "float", "int32", "uint32", "sint32", "fixed32", "sfixed32", "int64", "uint64", "sint64", "fixed64", "sfixed64", "bool", "string", "bytes" ];
function s(e, t) {
var r = 0, n = {};
t |= 0;
for (;r < e.length; ) n[o[r + t]] = e[r++];
return n;
}
n.basic = s([ 1, 5, 0, 0, 0, 5, 5, 0, 0, 0, 1, 1, 0, 2, 2 ]);
n.defaults = s([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, !1, "", i.emptyArray, null ]);
n.long = s([ 0, 0, 0, 1, 1 ], 7);
n.mapKey = s([ 0, 0, 0, 5, 5, 0, 0, 0, 1, 1, 0, 2 ], 2);
n.packed = s([ 1, 5, 0, 0, 0, 5, 5, 0, 0, 0, 1, 1, 0 ]);
}, {
37: 37
} ],
37: [ function(e, t) {
var r, n, i = t.exports = e(39), o = e(30);
i.codegen = e(3);
i.fetch = e(5);
i.path = e(8);
i.fs = i.inquire("fs");
i.toArray = function(e) {
if (e) {
for (var t = Object.keys(e), r = new Array(t.length), n = 0; n < t.length; ) r[n] = e[t[n++]];
return r;
}
return [];
};
i.toObject = function(e) {
for (var t = {}, r = 0; r < e.length; ) {
var n = e[r++], i = e[r++];
i !== undefined && (t[n] = i);
}
return t;
};
var s = /\\/g, f = /"/g;
i.isReserved = function(e) {
return /^(?:do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/.test(e);
};
i.safeProp = function(e) {
return !/^[$\w_]+$/.test(e) || i.isReserved(e) ? '["' + e.replace(s, "\\\\").replace(f, '\\"') + '"]' : "." + e;
};
i.ucFirst = function(e) {
return e.charAt(0).toUpperCase() + e.substring(1);
};
var a = /_([a-z])/g;
i.camelCase = function(e) {
return e.substring(0, 1) + e.substring(1).replace(a, function(e, t) {
return t.toUpperCase();
});
};
i.compareFieldsById = function(e, t) {
return e.id - t.id;
};
i.decorateType = function(t, n) {
if (t.$type) {
if (n && t.$type.name !== n) {
i.decorateRoot.remove(t.$type);
t.$type.name = n;
i.decorateRoot.add(t.$type);
}
return t.$type;
}
r || (r = e(35));
var o = new r(n || t.name);
i.decorateRoot.add(o);
o.ctor = t;
Object.defineProperty(t, "$type", {
value: o,
enumerable: !1
});
Object.defineProperty(t.prototype, "$type", {
value: o,
enumerable: !1
});
return o;
};
var u = 0;
i.decorateEnum = function(t) {
if (t.$type) return t.$type;
n || (n = e(15));
var r = new n("Enum" + u++, t);
i.decorateRoot.add(r);
Object.defineProperty(t, "$type", {
value: r,
enumerable: !1
});
return r;
};
i.setProperty = function(e, t, r) {
if ("object" != typeof e) throw TypeError("dst must be an object");
if (!t) throw TypeError("path must be specified");
return function e(t, r, n) {
var i = r.shift();
if (r.length > 0) t[i] = e(t[i] || {}, r, n); else {
var o = t[i];
o && (n = [].concat(o).concat(n));
t[i] = n;
}
return t;
}(e, t = t.split("."), r);
};
Object.defineProperty(i, "decorateRoot", {
get: function() {
return o.decorated || (o.decorated = new (e(29))());
}
});
}, {
15: 15,
29: 29,
3: 3,
30: 30,
35: 35,
39: 39,
5: 5,
8: 8
} ],
38: [ function(e, t) {
t.exports = n;
var r = e(39);
function n(e, t) {
this.lo = e >>> 0;
this.hi = t >>> 0;
}
var i = n.zero = new n(0, 0);
i.toNumber = function() {
return 0;
};
i.zzEncode = i.zzDecode = function() {
return this;
};
i.length = function() {
return 1;
};
var o = n.zeroHash = "\0\0\0\0\0\0\0\0";
n.fromNumber = function(e) {
if (0 === e) return i;
var t = e < 0;
t && (e = -e);
var r = e >>> 0, o = (e - r) / 4294967296 >>> 0;
if (t) {
o = ~o >>> 0;
r = ~r >>> 0;
if (++r > 4294967295) {
r = 0;
++o > 4294967295 && (o = 0);
}
}
return new n(r, o);
};
n.from = function(e) {
if ("number" == typeof e) return n.fromNumber(e);
if (r.isString(e)) {
if (!r.Long) return n.fromNumber(parseInt(e, 10));
e = r.Long.fromString(e);
}
return e.low || e.high ? new n(e.low >>> 0, e.high >>> 0) : i;
};
n.prototype.toNumber = function(e) {
if (!e && this.hi >>> 31) {
var t = 1 + ~this.lo >>> 0, r = ~this.hi >>> 0;
t || (r = r + 1 >>> 0);
return -(t + 4294967296 * r);
}
return this.lo + 4294967296 * this.hi;
};
n.prototype.toLong = function(e) {
return r.Long ? new r.Long(0 | this.lo, 0 | this.hi, Boolean(e)) : {
low: 0 | this.lo,
high: 0 | this.hi,
unsigned: Boolean(e)
};
};
var s = String.prototype.charCodeAt;
n.fromHash = function(e) {
return e === o ? i : new n((s.call(e, 0) | s.call(e, 1) << 8 | s.call(e, 2) << 16 | s.call(e, 3) << 24) >>> 0, (s.call(e, 4) | s.call(e, 5) << 8 | s.call(e, 6) << 16 | s.call(e, 7) << 24) >>> 0);
};
n.prototype.toHash = function() {
return String.fromCharCode(255 & this.lo, this.lo >>> 8 & 255, this.lo >>> 16 & 255, this.lo >>> 24, 255 & this.hi, this.hi >>> 8 & 255, this.hi >>> 16 & 255, this.hi >>> 24);
};
n.prototype.zzEncode = function() {
var e = this.hi >> 31;
this.hi = ((this.hi << 1 | this.lo >>> 31) ^ e) >>> 0;
this.lo = (this.lo << 1 ^ e) >>> 0;
return this;
};
n.prototype.zzDecode = function() {
var e = -(1 & this.lo);
this.lo = ((this.lo >>> 1 | this.hi << 31) ^ e) >>> 0;
this.hi = (this.hi >>> 1 ^ e) >>> 0;
return this;
};
n.prototype.length = function() {
var e = this.lo, t = (this.lo >>> 28 | this.hi << 4) >>> 0, r = this.hi >>> 24;
return 0 === r ? 0 === t ? e < 16384 ? e < 128 ? 1 : 2 : e < 2097152 ? 3 : 4 : t < 16384 ? t < 128 ? 5 : 6 : t < 2097152 ? 7 : 8 : r < 128 ? 9 : 10;
};
}, {
39: 39
} ],
39: [ function(e, t, r) {
var n = r;
n.asPromise = e(1);
n.base64 = e(2);
n.EventEmitter = e(4);
n.float = e(6);
n.inquire = e(7);
n.utf8 = e(10);
n.pool = e(9);
n.LongBits = e(38);
n.isNode = Boolean("undefined" != typeof global && global && global.process && global.process.versions && global.process.versions.node);
n.global = n.isNode && global || "undefined" != typeof window && window || "undefined" != typeof self && self || this;
n.emptyArray = Object.freeze ? Object.freeze([]) : [];
n.emptyObject = Object.freeze ? Object.freeze({}) : {};
n.isInteger = Number.isInteger || function(e) {
return "number" == typeof e && isFinite(e) && Math.floor(e) === e;
};
n.isString = function(e) {
return "string" == typeof e || e instanceof String;
};
n.isObject = function(e) {
return e && "object" == typeof e;
};
n.isset = n.isSet = function(e, t) {
var r = e[t];
return !(null == r || !e.hasOwnProperty(t)) && ("object" != typeof r || (Array.isArray(r) ? r.length : Object.keys(r).length) > 0);
};
n.Buffer = function() {
try {
var e = n.inquire("buffer").Buffer;
return e.prototype.utf8Write ? e : null;
} catch (e) {
return null;
}
}();
n._Buffer_from = null;
n._Buffer_allocUnsafe = null;
n.newBuffer = function(e) {
return "number" == typeof e ? n.Buffer ? n._Buffer_allocUnsafe(e) : new n.Array(e) : n.Buffer ? n._Buffer_from(e) : "undefined" == typeof Uint8Array ? e : new Uint8Array(e);
};
n.Array = "undefined" != typeof Uint8Array ? Uint8Array : Array;
n.Long = n.global.dcodeIO && n.global.dcodeIO.Long || n.global.Long || n.inquire("long");
n.key2Re = /^true|false|0|1$/;
n.key32Re = /^-?(?:0|[1-9][0-9]*)$/;
n.key64Re = /^(?:[\\x00-\\xff]{8}|-?(?:0|[1-9][0-9]*))$/;
n.longToHash = function(e) {
return e ? n.LongBits.from(e).toHash() : n.LongBits.zeroHash;
};
n.longFromHash = function(e, t) {
var r = n.LongBits.fromHash(e);
return n.Long ? n.Long.fromBits(r.lo, r.hi, t) : r.toNumber(Boolean(t));
};
function i(e, t, r) {
for (var n = Object.keys(t), i = 0; i < n.length; ++i) e[n[i]] !== undefined && r || (e[n[i]] = t[n[i]]);
return e;
}
n.merge = i;
n.lcFirst = function(e) {
return e.charAt(0).toLowerCase() + e.substring(1);
};
function o(e) {
function t(e, r) {
if (!(this instanceof t)) return new t(e, r);
Object.defineProperty(this, "message", {
get: function() {
return e;
}
});
Error.captureStackTrace ? Error.captureStackTrace(this, t) : Object.defineProperty(this, "stack", {
value: new Error().stack || ""
});
r && i(this, r);
}
(t.prototype = Object.create(Error.prototype)).constructor = t;
Object.defineProperty(t.prototype, "name", {
get: function() {
return e;
}
});
t.prototype.toString = function() {
return this.name + ": " + this.message;
};
return t;
}
n.newError = o;
n.ProtocolError = o("ProtocolError");
n.oneOfGetter = function(e) {
for (var t = {}, r = 0; r < e.length; ++r) t[e[r]] = 1;
return function() {
for (var e = Object.keys(this), r = e.length - 1; r > -1; --r) if (1 === t[e[r]] && this[e[r]] !== undefined && null !== this[e[r]]) return e[r];
};
};
n.oneOfSetter = function(e) {
return function(t) {
for (var r = 0; r < e.length; ++r) e[r] !== t && delete this[e[r]];
};
};
n.toJSONOptions = {
longs: String,
enums: String,
bytes: String,
json: !0
};
n._configure = function() {
var e = n.Buffer;
if (e) {
n._Buffer_from = e.from !== Uint8Array.from && e.from || function(t, r) {
return new e(t, r);
};
n._Buffer_allocUnsafe = e.allocUnsafe || function(t) {
return new e(t);
};
} else n._Buffer_from = n._Buffer_allocUnsafe = null;
};
}, {
1: 1,
10: 10,
2: 2,
38: 38,
4: 4,
6: 6,
7: 7,
9: 9
} ],
40: [ function(e, t) {
t.exports = function(e) {
var t = n.codegen([ "m" ], e.name + "$verify")('if(typeof m!=="object"||m===null)')("return%j", "object expected"), r = {};
e.oneofsArray.length && t("var p={}");
for (var f = 0; f < e.fieldsArray.length; ++f) {
var a = e._fieldsArray[f].resolve(), u = "m" + n.safeProp(a.name);
a.optional && t("if(%s!=null&&m.hasOwnProperty(%j)){", u, a.name);
if (a.map) {
t("if(!util.isObject(%s))", u)("return%j", i(a, "object"))("var k=Object.keys(%s)", u)("for(var i=0;i<k.length;++i){");
s(t, a, "k[i]");
o(t, a, f, u + "[k[i]]")("}");
} else if (a.repeated) {
t("if(!Array.isArray(%s))", u)("return%j", i(a, "array"))("for(var i=0;i<%s.length;++i){", u);
o(t, a, f, u + "[i]")("}");
} else {
if (a.partOf) {
var l = n.safeProp(a.partOf.name);
1 === r[a.partOf.name] && t("if(p%s===1)", l)("return%j", a.partOf.name + ": multiple values");
r[a.partOf.name] = 1;
t("p%s=1", l);
}
o(t, a, f, u);
}
a.optional && t("}");
}
return t("return null");
};
var r = e(15), n = e(37);
function i(e, t) {
return e.name + ": " + t + (e.repeated && "array" !== t ? "[]" : e.map && "object" !== t ? "{k:" + e.keyType + "}" : "") + " expected";
}
function o(e, t, n, o) {
if (t.resolvedType) if (t.resolvedType instanceof r) {
e("switch(%s){", o)("default:")("return%j", i(t, "enum value"));
for (var s = Object.keys(t.resolvedType.values), f = 0; f < s.length; ++f) e("case %i:", t.resolvedType.values[s[f]]);
e("break")("}");
} else e("{")("var e=types[%i].verify(%s);", n, o)("if(e)")("return%j+e", t.name + ".")("}"); else switch (t.type) {
case "int32":
case "uint32":
case "sint32":
case "fixed32":
case "sfixed32":
e("if(!util.isInteger(%s))", o)("return%j", i(t, "integer"));
break;

case "int64":
case "uint64":
case "sint64":
case "fixed64":
case "sfixed64":
e("if(!util.isInteger(%s)&&!(%s&&util.isInteger(%s.low)&&util.isInteger(%s.high)))", o, o, o, o)("return%j", i(t, "integer|Long"));
break;

case "float":
case "double":
e('if(typeof %s!=="number")', o)("return%j", i(t, "number"));
break;

case "bool":
e('if(typeof %s!=="boolean")', o)("return%j", i(t, "boolean"));
break;

case "string":
e("if(!util.isString(%s))", o)("return%j", i(t, "string"));
break;

case "bytes":
e('if(!(%s&&typeof %s.length==="number"||util.isString(%s)))', o, o, o)("return%j", i(t, "buffer"));
}
return e;
}
function s(e, t, r) {
switch (t.keyType) {
case "int32":
case "uint32":
case "sint32":
case "fixed32":
case "sfixed32":
e("if(!util.key32Re.test(%s))", r)("return%j", i(t, "integer key"));
break;

case "int64":
case "uint64":
case "sint64":
case "fixed64":
case "sfixed64":
e("if(!util.key64Re.test(%s))", r)("return%j", i(t, "integer|Long key"));
break;

case "bool":
e("if(!util.key2Re.test(%s))", r)("return%j", i(t, "boolean key"));
}
return e;
}
}, {
15: 15,
37: 37
} ],
41: [ function(e, t, r) {
var n = r, i = e(21);
n[".google.protobuf.Any"] = {
fromObject: function(e) {
if (e && e["@type"]) {
var t = e["@type"].substring(e["@type"].lastIndexOf("/") + 1), r = this.lookup(t);
if (r) {
var n = "." === e["@type"].charAt(0) ? e["@type"].substr(1) : e["@type"];
-1 === n.indexOf("/") && (n = "/" + n);
return this.create({
type_url: n,
value: r.encode(r.fromObject(e)).finish()
});
}
}
return this.fromObject(e);
},
toObject: function(e, t) {
var r = "", n = "";
if (t && t.json && e.type_url && e.value) {
n = e.type_url.substring(e.type_url.lastIndexOf("/") + 1);
r = e.type_url.substring(0, e.type_url.lastIndexOf("/") + 1);
var o = this.lookup(n);
o && (e = o.decode(e.value));
}
if (!(e instanceof this.ctor) && e instanceof i) {
var s = e.$type.toObject(e, t);
"" === r && (r = "type.googleapis.com/");
n = r + ("." === e.$type.fullName[0] ? e.$type.fullName.substr(1) : e.$type.fullName);
s["@type"] = n;
return s;
}
return this.toObject(e, t);
}
};
}, {
21: 21
} ],
42: [ function(e, t) {
t.exports = l;
var r, n = e(39), i = n.LongBits, o = n.base64, s = n.utf8;
function f(e, t, r) {
this.fn = e;
this.len = t;
this.next = undefined;
this.val = r;
}
function a() {}
function u(e) {
this.head = e.head;
this.tail = e.tail;
this.len = e.len;
this.next = e.states;
}
function l() {
this.len = 0;
this.head = new f(a, 0, 0);
this.tail = this.head;
this.states = null;
}
var p = function() {
return n.Buffer ? function() {
return (l.create = function() {
return new r();
})();
} : function() {
return new l();
};
};
l.create = p();
l.alloc = function(e) {
return new n.Array(e);
};
n.Array !== Array && (l.alloc = n.pool(l.alloc, n.Array.prototype.subarray));
l.prototype._push = function(e, t, r) {
this.tail = this.tail.next = new f(e, t, r);
this.len += t;
return this;
};
function c(e, t, r) {
t[r] = 255 & e;
}
function h(e, t) {
this.len = e;
this.next = undefined;
this.val = t;
}
h.prototype = Object.create(f.prototype);
h.prototype.fn = function(e, t, r) {
for (;e > 127; ) {
t[r++] = 127 & e | 128;
e >>>= 7;
}
t[r] = e;
};
l.prototype.uint32 = function(e) {
this.len += (this.tail = this.tail.next = new h((e >>>= 0) < 128 ? 1 : e < 16384 ? 2 : e < 2097152 ? 3 : e < 268435456 ? 4 : 5, e)).len;
return this;
};
l.prototype.int32 = function(e) {
return e < 0 ? this._push(d, 10, i.fromNumber(e)) : this.uint32(e);
};
l.prototype.sint32 = function(e) {
return this.uint32((e << 1 ^ e >> 31) >>> 0);
};
function d(e, t, r) {
for (;e.hi; ) {
t[r++] = 127 & e.lo | 128;
e.lo = (e.lo >>> 7 | e.hi << 25) >>> 0;
e.hi >>>= 7;
}
for (;e.lo > 127; ) {
t[r++] = 127 & e.lo | 128;
e.lo = e.lo >>> 7;
}
t[r++] = e.lo;
}
l.prototype.uint64 = function(e) {
var t = i.from(e);
return this._push(d, t.length(), t);
};
l.prototype.int64 = l.prototype.uint64;
l.prototype.sint64 = function(e) {
var t = i.from(e).zzEncode();
return this._push(d, t.length(), t);
};
l.prototype.bool = function(e) {
return this._push(c, 1, e ? 1 : 0);
};
function y(e, t, r) {
t[r] = 255 & e;
t[r + 1] = e >>> 8 & 255;
t[r + 2] = e >>> 16 & 255;
t[r + 3] = e >>> 24;
}
l.prototype.fixed32 = function(e) {
return this._push(y, 4, e >>> 0);
};
l.prototype.sfixed32 = l.prototype.fixed32;
l.prototype.fixed64 = function(e) {
var t = i.from(e);
return this._push(y, 4, t.lo)._push(y, 4, t.hi);
};
l.prototype.sfixed64 = l.prototype.fixed64;
l.prototype.float = function(e) {
return this._push(n.float.writeFloatLE, 4, e);
};
l.prototype.double = function(e) {
return this._push(n.float.writeDoubleLE, 8, e);
};
var m = n.Array.prototype.set ? function(e, t, r) {
t.set(e, r);
} : function(e, t, r) {
for (var n = 0; n < e.length; ++n) t[r + n] = e[n];
};
l.prototype.bytes = function(e) {
var t = e.length >>> 0;
if (!t) return this._push(c, 1, 0);
if (n.isString(e)) {
var r = l.alloc(t = o.length(e));
o.decode(e, r, 0);
e = r;
}
return this.uint32(t)._push(m, t, e);
};
l.prototype.string = function(e) {
var t = s.length(e);
return t ? this.uint32(t)._push(s.write, t, e) : this._push(c, 1, 0);
};
l.prototype.fork = function() {
this.states = new u(this);
this.head = this.tail = new f(a, 0, 0);
this.len = 0;
return this;
};
l.prototype.reset = function() {
if (this.states) {
this.head = this.states.head;
this.tail = this.states.tail;
this.len = this.states.len;
this.states = this.states.next;
} else {
this.head = this.tail = new f(a, 0, 0);
this.len = 0;
}
return this;
};
l.prototype.ldelim = function() {
var e = this.head, t = this.tail, r = this.len;
this.reset().uint32(r);
if (r) {
this.tail.next = e.next;
this.tail = t;
this.len += r;
}
return this;
};
l.prototype.finish = function() {
for (var e = this.head.next, t = this.constructor.alloc(this.len), r = 0; e; ) {
e.fn(e.val, t, r);
r += e.len;
e = e.next;
}
return t;
};
l._configure = function(e) {
r = e;
l.create = p();
r._configure();
};
}, {
39: 39
} ],
43: [ function(e, t) {
t.exports = i;
var r = e(42);
(i.prototype = Object.create(r.prototype)).constructor = i;
var n = e(39);
function i() {
r.call(this);
}
i._configure = function() {
i.alloc = n._Buffer_allocUnsafe;
i.writeBytesBuffer = n.Buffer && n.Buffer.prototype instanceof Uint8Array && "set" === n.Buffer.prototype.set.name ? function(e, t, r) {
t.set(e, r);
} : function(e, t, r) {
if (e.copy) e.copy(t, r, 0, e.length); else for (var n = 0; n < e.length; ) t[r++] = e[n++];
};
};
i.prototype.bytes = function(e) {
n.isString(e) && (e = n._Buffer_from(e, "base64"));
var t = e.length >>> 0;
this.uint32(t);
t && this._push(i.writeBytesBuffer, t, e);
return this;
};
function o(e, t, r) {
e.length < 40 ? n.utf8.write(e, t, r) : t.utf8Write ? t.utf8Write(e, r) : t.write(e, r);
}
i.prototype.string = function(e) {
var t = n.Buffer.byteLength(e);
this.uint32(t);
t && this._push(o, t, e);
return this;
};
i._configure();
}, {
39: 39,
42: 42
} ]
}, {});
})();