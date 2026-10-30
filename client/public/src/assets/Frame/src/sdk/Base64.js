(function(r) {
"use strict";
function e(r) {
var e, o, n, a, f, i, d, h = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=", C = "", c = 0;
r = t(r);
for (;c < r.length; ) {
a = (e = r.charCodeAt(c++)) >> 2;
f = (3 & e) << 4 | (o = r.charCodeAt(c++)) >> 4;
i = (15 & o) << 2 | (n = r.charCodeAt(c++)) >> 6;
d = 63 & n;
isNaN(o) ? i = d = 64 : isNaN(n) && (d = 64);
C = C + h.charAt(a) + h.charAt(f) + h.charAt(i) + h.charAt(d);
}
return C;
}
function o(r) {
var e, o, t, a, f, i, d = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=", h = "", C = 0;
r = r.replace(/[^A-Za-z0-9+/=]/g, "");
for (;C < r.length; ) {
e = d.indexOf(r.charAt(C++)) << 2 | (a = d.indexOf(r.charAt(C++))) >> 4;
o = (15 & a) << 4 | (f = d.indexOf(r.charAt(C++))) >> 2;
t = (3 & f) << 6 | (i = d.indexOf(r.charAt(C++)));
h += String.fromCharCode(e);
64 != f && (h += String.fromCharCode(o));
64 != i && (h += String.fromCharCode(t));
}
return n(h);
}
function t(r) {
r = r.replace(/rn/g, "n");
for (var e = "", o = 0; o < r.length; o++) {
var t = r.charCodeAt(o);
if (t < 128) e += String.fromCharCode(t); else if (t > 127 && t < 2048) {
e += String.fromCharCode(t >> 6 | 192);
e += String.fromCharCode(63 & t | 128);
} else {
e += String.fromCharCode(t >> 12 | 224);
e += String.fromCharCode(t >> 6 & 63 | 128);
e += String.fromCharCode(63 & t | 128);
}
}
return e;
}
function n(r) {
for (var e = "", o = 0, t = 0, n = 0, a = 0; o < r.length; ) if ((t = r.charCodeAt(o)) < 128) {
e += String.fromCharCode(t);
o++;
} else if (t > 191 && t < 224) {
n = r.charCodeAt(o + 1);
e += String.fromCharCode((31 & t) << 6 | 63 & n);
o += 2;
} else {
n = r.charCodeAt(o + 1);
a = r.charCodeAt(o + 2);
e += String.fromCharCode((15 & t) << 12 | (63 & n) << 6 | 63 & a);
o += 3;
}
return e;
}
function a(r, t) {
return "decode" == r ? o(t) : "encode" == r ? e(t) : t;
}
"function" == typeof define && define.amd ? define(function() {
return a;
}) : "object" == typeof module && module.exports ? module.exports = a : r.base64 = a;
})(this);