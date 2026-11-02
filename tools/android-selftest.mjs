#!/usr/bin/env node
// Offline self-test for the Android packaging pieces. Needs only Node (no apktool, SDK or Java).
//
//   node tools/android-selftest.mjs
//
// 1. Pure-JS SHA-256 / UTF-8 in assets/main.js against known vectors and node:crypto.
// 2. Hot-update loader in assets/main.js, run in a simulated JSB (fileUtils, XHR, virtual timers).
// 3. Adapter generator (tools/android-native-adapter.mjs) on the real tree and on a scratch copy.
// 4. tools/client-native-patch.mjs on two synthetic apktool trees, each patched twice.
// 5. Smali lint: registers, invoke arity, labels, try/catch, move-result, constants, cross refs.
// 6. Zip alignment checks (synthetic zips + the base APK, read in memory only).
// 7. Read-only checks against the base APK: classes.dex references, binary manifest.
// 8. android-build.mjs helpers and the JS <-> native contract.
// Scratch files go to a new folder under the OS temp directory and are deleted afterwards
// (keep them with DOUSHISI_SELFTEST_KEEP=1). The project itself is never written to.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { deflateRawSync } from 'node:zlib';

import { buildConfig, MEDIA_AUTHORITY, NATIVE_API, patchDecodedApk, renderBootScript } from './client-native-patch.mjs';
import { buildNativeAdapter, hardcodedAddresses, NATIVE_ADAPTER_PATH, nativeAdapterFrom, validateManifest, verifyNativeAdapter, writeNativeAdapter } from './android-native-adapter.mjs';
import { applyVersion, checkAbis, checkAlignment, manifestFromTemplate, parseArguments, readVersion, readZipEntries, readZipEntry } from './android-build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_APK = join(ROOT, '线上部署包/doushisi.apk');
const BOM = String.fromCharCode(0xfeff);
const CJK = '斗十四';
const ASTRAL = String.fromCodePoint(0x1f004, 0x1f600);
const ORIGINAL_UPDATE = 'if (cc.sys.isBrowser) this.schedule(this.progressUpdate.bind(this), .02); else {';
const PATCHED_UPDATE = 'if (window.Standalone) this.schedule(this.progressUpdate.bind(this), .02); else {';

const sha256 = value => createHash('sha256').update(typeof value === 'string' ? Buffer.from(value, 'utf8') : value).digest('hex');
const read = path => readFileSync(join(ROOT, path), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;
const TEMP = mkdtempSync(join(process.env.DOUSHISI_SELFTEST_TMP || tmpdir(), 'doushisi-android-selftest-'));

let passed = 0;
const failures = [];
const notes = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; return true; }
  const line = `${name}${detail ? ' -- ' + String(detail).slice(0, 600) : ''}`;
  failures.push(line);
  console.log(`  FAIL ${line}`);
  return false;
}
function note(text) { notes.push(text); console.log(`  NOTE ${text}`); }
async function section(title, body) {
  console.log(`\n== ${title}`);
  const failedBefore = failures.length;
  const passedBefore = passed;
  try { await body(); } catch (error) { check(`${title}: unexpected exception`, false, (error && error.stack) || String(error)); }
  const failed = failures.length - failedBefore;
  console.log(`  ${failed ? 'FAILED' : 'ok'}: ${passed - passedBefore} passed${failed ? `, ${failed} failed` : ''}`);
}
const throwsMatching = (fn, pattern) => { try { fn(); return false; } catch (error) { return pattern.test(String(error && error.message)); } };
function writeFile(root, path, text) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

// ---------------------------------------------------------------- 1. SHA-256

function loadBootModule(source) {
  const context = vm.createContext({ console: { log() {} } });
  context.window = {};
  vm.runInContext(source, context, { filename: 'assets/main.js' });
  return context.window.StandaloneNativeBoot;
}

await section('1. Pure-JS SHA-256 / UTF-8 (assets/main.js)', () => {
  const boot = loadBootModule(read('assets/main.js'));
  check('StandaloneNativeBoot is exported', boot && typeof boot.sha256Hex === 'function' && typeof boot.start === 'function');
  const known = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu', 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
    ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ];
  for (const [text, expected] of known) {
    check(`FIPS vector (${text.length} chars) pure JS`, boot.sha256Hex(text) === expected);
    check(`FIPS vector (${text.length} chars) node:crypto`, sha256(text) === expected);
  }
  const samples = [
    CJK, ASTRAL, CJK + ASTRAL + 'abc', String.fromCharCode(0),
    String.fromCharCode(0x7f, 0x80, 0x7ff, 0x800, 0xfffd, 0xffff),
    String.fromCharCode(0xd800), 'x' + String.fromCharCode(0xdc00) + 'y', 'a' + String.fromCharCode(0xd83c),
    String.fromCharCode(0xdbff, 0xdbff, 0xdfff), String.fromCharCode(0xdfff, 0xd800),
  ];
  for (let length = 0; length <= 130; length += 1) samples.push('a'.repeat(length), '中'.repeat(length % 60), ASTRAL.repeat(length % 20));
  let seed = 0x2545f491;
  const random = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  for (let sample = 0; sample < 400; sample += 1) {
    const units = [];
    const length = Math.floor(random() * 300);
    for (let index = 0; index < length; index += 1) {
      const pick = random();
      if (pick < 0.4) units.push(0x20 + Math.floor(random() * 0x5f));
      else if (pick < 0.55) units.push(0x80 + Math.floor(random() * 0x780));
      else if (pick < 0.75) units.push(0x4e00 + Math.floor(random() * 0x5000));
      else if (pick < 0.9) { const code = 0x10000 + Math.floor(random() * 0xfffff); units.push(0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)); }
      else units.push(0xd800 + Math.floor(random() * 0x800));
    }
    samples.push(String.fromCharCode(...units));
  }
  let utf8Mismatch = 0;
  let hashMismatch = 0;
  for (const text of samples) {
    if (!Buffer.from(boot.utf8Bytes(text)).equals(Buffer.from(text, 'utf8'))) utf8Mismatch += 1;
    if (boot.sha256Hex(text) !== sha256(text)) hashMismatch += 1;
  }
  check(`UTF-8 bytes equal Buffer.from for ${samples.length} strings (lone surrogates -> U+FFFD)`, utf8Mismatch === 0, `${utf8Mismatch} mismatches`);
  check(`SHA-256 equals node:crypto for ${samples.length} strings (block boundaries 55/56/63/64/65..., CJK, emoji, fuzz)`, hashMismatch === 0, `${hashMismatch} mismatches`);
  const adapterPath = join(ROOT, 'client/public/native/standalone-native.js');
  if (existsSync(adapterPath)) {
    const manifest = JSON.parse(read('client/public/native/manifest.json'));
    const text = readFileSync(adapterPath, 'utf8');
    const started = performance.now();
    const pure = boot.sha256Hex(text);
    const elapsed = performance.now() - started;
    check('real adapter: pure-JS hash = manifest sha256 = file sha256', pure === manifest.sha256 && sha256(readFileSync(adapterPath)) === manifest.sha256, `${pure} / ${manifest.sha256}`);
    note(`pure-JS SHA-256 of the ${Buffer.byteLength(text)} byte adapter: ${elapsed.toFixed(1)} ms in Node (expect a few times slower on a phone)`);
  }
  check('apiOrigin keeps http(s) origins only', boot.apiOrigin({ apiBase: 'https://a.test/' }) === 'https://a.test' && boot.apiOrigin({ apiBase: 'https://a.test/x' }) === null
    && boot.apiOrigin({ apiBase: 'ftp://a.test' }) === null && boot.apiOrigin({ apiBase: 'https://u@a.test' }) === null && boot.apiOrigin(null) === null && boot.apiOrigin({ apiBase: 'http://10.0.2.2:3000' }) === 'http://10.0.2.2:3000');
  const valid = { version: 5, sha256: 'a'.repeat(64), path: NATIVE_ADAPTER_PATH };
  check('parseManifest accepts a valid manifest', JSON.stringify(boot.parseManifest(JSON.stringify(valid))) === JSON.stringify(valid));
  for (const [label, value] of [
    ['negative version', { ...valid, version: -1 }], ['fractional version', { ...valid, version: 1.5 }], ['string version', { ...valid, version: '5' }],
    ['short sha', { ...valid, sha256: 'a'.repeat(63) }], ['non-hex sha', { ...valid, sha256: 'g'.repeat(64) }],
    ['path traversal', { ...valid, path: '/client/native/../x.js' }], ['absolute URL', { ...valid, path: 'https://evil.invalid/x.js' }],
    ['other folder', { ...valid, path: '/client/x.js' }], ['not .js', { ...valid, path: '/client/native/x.json' }], ['hidden file', { ...valid, path: '/client/native/.x.js' }],
  ]) check(`parseManifest rejects ${label}`, boot.parseManifest(JSON.stringify(value)) === null);
});

// ---------------------------------------------------------------- 2. loader simulation

const API = 'https://api.test.invalid';
const MANIFEST_ROUTE = '/client/native/manifest.json';
const SCRIPT_ROUTE = NATIVE_ADAPTER_PATH;
const WRITABLE = '/data/user/0/net.doushisi.standalone/files/';
const CACHE_JS = WRITABLE + 'standalone-native/adapter.js';
const CACHE_META = WRITABLE + 'standalone-native/adapter.json';
const BUNDLED_CODE = "window.Standalone = { from: 'bundled', isolateStorage: function () { window.__isolated = (window.__isolated || 0) + 1; } };\n";
const HOT_CODE = "window.Standalone = { from: 'hot', isolateStorage: function () { window.__isolated = (window.__isolated || 0) + 1; } };\nwindow.__hotMark = '" + CJK + ASTRAL + "';\n";
const THROWING_CODE = "window.__partial = true;\nthrow new Error('boom');\n";
const BUNDLED = { version: 100, sha256: sha256(BUNDLED_CODE) };
const manifestFor = (code, version = 200, extra = {}) => JSON.stringify({ version, sha256: sha256(code), path: SCRIPT_ROUTE, ...extra });

// earlyTimers：模拟 JSB 的 setTimeout 两边时钟不一致、下一帧（16 ms）就触发（10-31 真机实况）。
function simulateBoot(script, { routes = {}, files = {}, writeOk = true, earlyTimers = false } = {}) {
  const state = { now: 0, timers: [], nextId: 1, requests: [], required: [], bootCalls: 0, bootAt: null, aborted: 0, dirs: new Set(), files: new Map(Object.entries(files)) };
  const context = vm.createContext({});
  const win = {};
  Object.defineProperty(win, 'boot', {
    configurable: true,
    get: () => () => { state.bootCalls += 1; if (state.bootAt === null) state.bootAt = state.now; },
    set: () => {},
  });
  context.window = win;
  context.console = { log() {} };
  const schedule = (fn, ms) => { const id = state.nextId++; state.timers.push({ id, at: state.now + Math.max(0, Number(ms) || 0), fn }); return id; };
  context.setTimeout = (fn, ms) => schedule(fn, earlyTimers ? Math.min(16, Number(ms) || 0) : ms);
  context.Date = class extends Date { static now() { return state.now; } };
  context.clearTimeout = id => { state.timers = state.timers.filter(timer => timer.id !== id); };
  context.cc = { macro: {} };
  context.CC_PHYSICS_BUILTIN = false;
  context.CC_PHYSICS_CANNON = false;
  context.jsb = {
    fileUtils: {
      getWritablePath: () => WRITABLE,
      isFileExist: path => state.files.has(path),
      getStringFromFile: path => state.files.get(path) || '',
      writeStringToFile: (text, path) => { if (!writeOk) return false; state.files.set(path, String(text)); return true; },
      isDirectoryExist: path => state.dirs.has(path),
      createDirectory: path => { state.dirs.add(path); return true; },
      removeFile: path => state.files.delete(path),
    },
  };
  context.XMLHttpRequest = class {
    open(method, url) { this.method = method; this.url = url; this.readyState = 1; }
    abort() { this.aborted = true; state.aborted += 1; }
    send() {
      state.requests.push(this.url);
      const route = routes[new URL(this.url).pathname] || { status: 404, body: 'not found' };
      if (route.never) return;
      // Replies even after abort(): the loader must ignore late answers on its own.
      schedule(() => {
        if (route.error === 'network') { if (this.onerror) this.onerror(); return; }
        this.readyState = 4;
        this.status = route.status === undefined ? 200 : route.status;
        this.responseText = route.body === undefined ? '' : route.body;
        if (this.onreadystatechange) this.onreadystatechange();
      }, route.delay === undefined ? 20 : route.delay);
    }
  };
  win.jsb = context.jsb; // in JSB, window is the global object, so window.jsb === jsb
  context.require = name => {
    state.required.push(name);
    if (name === 'standalone-native.js') vm.runInContext(BUNDLED_CODE, context, { filename: name });
  };
  vm.runInContext(script, context, { filename: 'main.js' });
  while (state.timers.length && state.now <= 120000) {
    state.timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const timer = state.timers.shift();
    state.now = timer.at;
    timer.fn();
  }
  return { ...state, win, source: win.STANDALONE_NATIVE_SOURCE || {} };
}

function expectBoot(name, result, expected) {
  const { source } = result;
  if (expected.kind) check(`${name}: kind=${expected.kind}`, source.kind === expected.kind, JSON.stringify(source));
  if (expected.reason !== undefined) check(`${name}: reason=${expected.reason || '(none)'}`, source.reason === expected.reason, JSON.stringify(source));
  // 热更新失败时加载器会多发一条 ?fallback=<原因> 的清单请求（只为进访问日志），不算进加载流程的请求数。
  const reports = result.requests.filter(url => url.includes('?fallback='));
  const loads = result.requests.filter(url => !url.includes('?fallback='));
  if (expected.requests !== undefined) check(`${name}: ${expected.requests} request(s)`, loads.length === expected.requests, result.requests.join(' '));
  const shouldReport = source.kind === 'bundled' && /^(manifest-|script-|sha256-|hot-)/.test(source.reason || '');
  check(`${name}: ${shouldReport ? 'reports fallback reason once' : 'no fallback report'}`, shouldReport
    ? reports.length === 1 && reports[0].includes('?fallback=' + encodeURIComponent(source.reason) + '&from=') : reports.length === 0, reports.join(' '));
  check(`${name}: boot() runs exactly once`, result.bootCalls === 1, String(result.bootCalls));
  check(`${name}: isolateStorage() once`, result.win.__isolated === 1, String(result.win.__isolated));
  const bundledRuns = result.required.filter(name => name === 'standalone-native.js').length;
  const standalone = result.win.Standalone || {};
  if (source.kind === 'bundled') check(`${name}: bundled adapter defined window.Standalone`, bundledRuns === 1 && standalone.from === 'bundled');
  else check(`${name}: hot adapter defined window.Standalone, bundled not loaded`, bundledRuns === 0 && standalone.from === 'hot');
  check(`${name}: replay/decimal/edition loaded`, ['decimal.js', 'edition-config.js', 'standalone-replay.js'].every(file => result.required.includes(file)));
}

await section('2. Hot-update loader (simulated JSB)', () => {
  const template = read('assets/main.js');
  const script = renderBootScript(template, { config: buildConfig(API), bundled: BUNDLED });
  const okManifest = { status: 200, body: manifestFor(HOT_CODE) };
  const hotScript = { status: 200, body: HOT_CODE };
  const scenarios = [
    { name: 'new version downloaded', routes: { [MANIFEST_ROUTE]: okManifest, [SCRIPT_ROUTE]: hotScript }, expect: { kind: 'hot', reason: '', requests: 2 },
      more: r => [
        ['cache holds the verified script', r.files.get(CACHE_JS) === HOT_CODE],
        ['cache meta records version + sha256', (() => { try { const meta = JSON.parse(r.files.get(CACHE_META)); return meta.version === 200 && meta.sha256 === sha256(HOT_CODE); } catch { return false; } })()],
        ['cache folder created', r.dirs.has(WRITABLE + 'standalone-native/')],
        ['manifest URL', r.requests[0].startsWith(`${API}${MANIFEST_ROUTE}?ts=`)],
        ['script URL carries sha256', r.requests[1] === `${API}${SCRIPT_ROUTE}?sha256=${sha256(HOT_CODE)}`],
        ['multi-byte text survives', r.win.__hotMark === CJK + ASTRAL],
        ['STANDALONE_CONFIG.nativeApi', r.win.STANDALONE_CONFIG && r.win.STANDALONE_CONFIG.nativeApi === NATIVE_API],
      ] },
    { name: 'verified cache used without download', files: { [CACHE_JS]: HOT_CODE }, routes: { [MANIFEST_ROUTE]: okManifest, [SCRIPT_ROUTE]: { status: 500 } }, expect: { kind: 'cache', reason: '', requests: 1 } },
    { name: 'tampered cache ignored and replaced', files: { [CACHE_JS]: HOT_CODE + '//tampered' }, routes: { [MANIFEST_ROUTE]: okManifest, [SCRIPT_ROUTE]: hotScript }, expect: { kind: 'hot', requests: 2 },
      more: r => [['cache rewritten', r.files.get(CACHE_JS) === HOT_CODE]] },
    { name: 'server copy equals bundled', routes: { [MANIFEST_ROUTE]: { status: 200, body: manifestFor(BUNDLED_CODE, 300) } }, expect: { kind: 'bundled', reason: 'up-to-date', requests: 1 } },
    { name: 'server version not newer', routes: { [MANIFEST_ROUTE]: { status: 200, body: manifestFor(HOT_CODE, 100) } }, expect: { kind: 'bundled', reason: 'server-older', requests: 1 } },
    { name: 'downloaded bytes fail sha256', routes: { [MANIFEST_ROUTE]: okManifest, [SCRIPT_ROUTE]: { status: 200, body: HOT_CODE + ' ' } }, expect: { kind: 'bundled', reason: 'sha256-mismatch', requests: 2 },
      more: r => [['nothing cached', !r.files.has(CACHE_JS)]] },
    { name: 'manifest late (9 s)', routes: { [MANIFEST_ROUTE]: { ...okManifest, delay: 9000 } }, expect: { kind: 'bundled', reason: 'manifest-timeout', requests: 1 },
      more: r => [['boots at 8000 ms', r.bootAt === 8000], ['request aborted', r.aborted >= 1]] },
    { name: 'manifest never answers', routes: { [MANIFEST_ROUTE]: { never: true } }, expect: { kind: 'bundled', reason: 'manifest-timeout', requests: 1 }, more: r => [['boots at 8000 ms', r.bootAt === 8000]] },
    { name: 'manifest network error', routes: { [MANIFEST_ROUTE]: { error: 'network' } }, expect: { kind: 'bundled', reason: 'manifest-network' } },
    { name: 'manifest 404', routes: {}, expect: { kind: 'bundled', reason: 'manifest-http-404' } },
    { name: 'manifest not JSON', routes: { [MANIFEST_ROUTE]: { status: 200, body: '<html>' } }, expect: { kind: 'bundled', reason: 'manifest-invalid' } },
    { name: 'manifest path escapes /client/native', routes: { [MANIFEST_ROUTE]: { status: 200, body: manifestFor(HOT_CODE, 200, { path: '/client/native/../../x.js' }) } }, expect: { kind: 'bundled', reason: 'manifest-invalid', requests: 1 } },
    { name: 'manifest points at another host', routes: { [MANIFEST_ROUTE]: { status: 200, body: manifestFor(HOT_CODE, 200, { path: 'https://evil.invalid/x.js' }) } }, expect: { kind: 'bundled', reason: 'manifest-invalid', requests: 1 } },
    { name: 'manifest with uppercase sha256', routes: { [MANIFEST_ROUTE]: { status: 200, body: JSON.stringify({ version: 200, sha256: sha256(HOT_CODE).toUpperCase(), path: SCRIPT_ROUTE }) }, [SCRIPT_ROUTE]: hotScript }, expect: { kind: 'hot', requests: 2 } },
    { name: 'script late (7 s)', routes: { [MANIFEST_ROUTE]: okManifest, [SCRIPT_ROUTE]: { ...hotScript, delay: 7000 } }, expect: { kind: 'bundled', reason: 'script-timeout', requests: 2 }, more: r => [['boots at 6020 ms', r.bootAt === 6020]] },
    { name: 'script 500', routes: { [MANIFEST_ROUTE]: okManifest, [SCRIPT_ROUTE]: { status: 500, body: '' } }, expect: { kind: 'bundled', reason: 'script-http-500' } },
    { name: 'downloaded script throws', routes: { [MANIFEST_ROUTE]: { status: 200, body: manifestFor(THROWING_CODE) }, [SCRIPT_ROUTE]: { status: 200, body: THROWING_CODE } }, expect: { kind: 'bundled', reason: 'hot-error', requests: 2 },
      more: r => [['cache dropped', !r.files.has(CACHE_JS) && !r.files.has(CACHE_META)]] },
    { name: 'cached script throws', files: { [CACHE_JS]: THROWING_CODE, [CACHE_META]: '{}' }, routes: { [MANIFEST_ROUTE]: { status: 200, body: manifestFor(THROWING_CODE) } }, expect: { kind: 'bundled', reason: 'hot-error', requests: 1 },
      more: r => [['cache dropped', !r.files.has(CACHE_JS) && !r.files.has(CACHE_META)]] },
    { name: 'cache not writable', writeOk: false, routes: { [MANIFEST_ROUTE]: okManifest, [SCRIPT_ROUTE]: hotScript }, expect: { kind: 'hot', requests: 2 }, more: r => [['nothing cached', !r.files.has(CACHE_JS)]] },
    { name: 'engine timers fire early, manifest at 1.2 s', earlyTimers: true, routes: { [MANIFEST_ROUTE]: { ...okManifest, delay: 1200 }, [SCRIPT_ROUTE]: hotScript }, expect: { kind: 'hot', reason: '', requests: 2 } },
    { name: 'engine timers fire early, manifest never answers', earlyTimers: true, routes: { [MANIFEST_ROUTE]: { never: true } }, expect: { kind: 'bundled', reason: 'manifest-timeout', requests: 1 }, more: r => [['still boots at about 8 s', r.bootAt >= 8000 && r.bootAt < 8100]] },
    { name: 'slowest successful start', routes: { [MANIFEST_ROUTE]: { ...okManifest, delay: 7999 }, [SCRIPT_ROUTE]: { ...hotScript, delay: 5999 } }, expect: { kind: 'hot' }, more: r => [['boots at 13998 ms', r.bootAt === 13998]] },
  ];
  for (const scenario of scenarios) {
    const result = simulateBoot(script, scenario);
    expectBoot(scenario.name, result, scenario.expect);
    for (const [label, ok] of scenario.more ? scenario.more(result) : []) check(`${scenario.name}: ${label}`, ok);
  }
  const noConfig = simulateBoot(renderBootScript(template, { config: null, bundled: BUNDLED }));
  expectBoot('no build config', noConfig, { kind: 'bundled', reason: 'no-config', requests: 0 });
  check('no build config: boots synchronously', noConfig.bootAt === 0);
  const plainHttp = simulateBoot(renderBootScript(template, { config: { apiBase: 'http://10.0.2.2:3000' }, bundled: BUNDLED }));
  expectBoot('plain http build config', plainHttp, { kind: 'bundled', reason: 'insecure-origin', requests: 0 });
  note('worst cases: manifest unreachable -> boot after 8.0 s; new version on a slow link -> up to 14.0 s (8 s manifest + 6 s script)');
  note('a hot script that throws half way has already run its first statements before the bundled copy runs (window.__partial in the test)');
});

// ---------------------------------------------------------------- 3. generator

await section('3. Adapter generator (client/public/native)', () => {
  const verification = verifyNativeAdapter(ROOT);
  check('manifest.json describes standalone-native.js', verification.ok, verification.problems.join('; '));
  const built = buildNativeAdapter(ROOT);
  check('client/public/native is current with client/public/standalone.js', verification.fileSha256 === built.sha256, 'stale: run node tools/android-native-adapter.mjs');
  const source = read('client/public/standalone.js').replace(new RegExp('^' + BOM), '');
  check('adapter = standalone.js byte for byte (BOM stripped)', existsSync(join(ROOT, 'client/public/native/standalone-native.js')) && readFileSync(join(ROOT, 'client/public/native/standalone-native.js')).equals(Buffer.from(source, 'utf8')));
  check('standalone.js has no hardcoded server address', hardcodedAddresses(source).length === 0, hardcodedAddresses(source).join(', '));

  const project = join(TEMP, 'generator');
  const header = 'var config = window.STANDALONE_CONFIG;\n';
  writeFile(project, 'client/public/standalone.js', BOM + header + 'window.Standalone = {};\n');
  const first = writeNativeAdapter(project, buildNativeAdapter(project, { now: 1800000000000 }));
  check('first write: version = unix seconds', first.changed && first.version === 1800000000, JSON.stringify({ changed: first.changed, version: first.version }));
  check('first write: BOM stripped', !readFileSync(join(project, 'client/public/native/standalone-native.js'), 'utf8').startsWith(BOM));
  const second = writeNativeAdapter(project, buildNativeAdapter(project, { now: 1900000000000 }));
  check('unchanged source keeps version and files', !second.changed && second.version === 1800000000);
  writeFile(project, 'client/public/standalone.js', header + 'window.Standalone = { v: 2 };\n');
  const third = writeNativeAdapter(project, buildNativeAdapter(project, { now: 1700000000000 }));
  check('changed source with an older clock: version + 1', third.changed && third.version === 1800000001, String(third.version));
  writeFile(project, 'client/public/standalone.js', header + 'window.Standalone = { v: 3 };\n');
  const fourth = writeNativeAdapter(project, buildNativeAdapter(project, { now: 1950000000000 }));
  check('changed source: version = newer unix seconds', fourth.version === 1950000000, String(fourth.version));
  check('scratch copy verifies', verifyNativeAdapter(project).ok);
  writeFile(project, 'client/public/native/manifest.json', JSON.stringify({ ...fourth.manifest, sha256: 'b'.repeat(64) }));
  check('tampered manifest detected', !verifyNativeAdapter(project).ok);
  check('missing config line rejected', throwsMatching(() => nativeAdapterFrom('window.Standalone = {};'), /no longer contains/));
  check('hardcoded address rejected', throwsMatching(() => nativeAdapterFrom(header + "fetch('https://game.example.com/x');"), /hardcodes/));
  check('.invalid probe hosts allowed', hardcodedAddresses("new URL('https://standalone.invalid/'); 'wss://x.invalid:443/ws'").length === 0);
  check('validateManifest reports each problem', validateManifest({ version: -1, sha256: 'x', path: '/etc/x.js' }).length === 3);
});

// ---------------------------------------------------------------- smali lint

function stripComment(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted && char === '\\') { index += 1; continue; }
    if (char === '"') quoted = !quoted;
    else if (char === '#' && !quoted) return line.slice(0, index);
  }
  return line;
}

function parseDescriptor(descriptor) {
  const close = descriptor.indexOf(')');
  const params = [];
  let index = 1;
  while (index < close) {
    const start = index;
    while (descriptor[index] === '[') index += 1;
    index = descriptor[index] === 'L' ? descriptor.indexOf(';', index) + 1 : index + 1;
    params.push(descriptor.slice(start, index));
  }
  return { params, ret: descriptor.slice(close + 1) };
}
const wordsOf = type => (type === 'J' || type === 'D' ? 2 : 1);

function parseSmali(text, file) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cls = { file, name: null, superClass: null, interfaces: [], fields: new Map(), methods: [] };
  let method = null;
  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = stripComment(raw).trim();
    if (method) {
      if (trimmed === '.end method') { cls.methods.push(method); method = null; } else method.lines.push({ text: raw, line });
      return;
    }
    let match;
    if ((match = /^\.class\s+(?:[\w-]+\s+)*(L[^;\s]+;)$/.exec(trimmed))) cls.name = match[1];
    else if ((match = /^\.super\s+(L[^;\s]+;)$/.exec(trimmed))) cls.superClass = match[1];
    else if ((match = /^\.implements\s+(L[^;\s]+;)$/.exec(trimmed))) cls.interfaces.push(match[1]);
    else if ((match = /^\.field\s+((?:[\w-]+\s+)*)([^\s:]+):(\S+)/.exec(trimmed))) cls.fields.set(`${match[2]}:${match[3]}`, { static: /\bstatic\b/.test(match[1]) });
    else if ((match = /^\.method\s+((?:[\w-]+\s+)*)(\S+\(.*\)\S+)$/.exec(trimmed))) {
      const signature = match[2];
      const name = signature.slice(0, signature.indexOf('('));
      method = { signature, line, lines: [], static: /\bstatic\b/.test(match[1]), private: /\bprivate\b/.test(match[1]), constructor: name === '<init>' || name === '<clinit>' };
    }
  });
  if (method) cls.unterminated = method.signature;
  return cls;
}

const FOUR_BIT = /^(move(-object|-wide)?|array-length|neg-\w+|not-\w+|(int|long|float|double)-to-\w+|[\w-]+\/2addr|const\/4|instance-of|new-array|iget(-\w+)?|iput(-\w+)?|if-(eq|ne|lt|ge|gt|le)|[\w-]+\/lit16|filled-new-array)$/;
const FIELD_KIND = { '': /^[IF]$/, '-wide': /^[JD]$/, '-object': /^[L[]/, '-boolean': /^Z$/, '-byte': /^B$/, '-char': /^C$/, '-short': /^S$/ };
const scrub = args => args.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/L[^;\s]*;->[^\s,}]+/g, 'REF').replace(/\[*L[^;\s]*;/g, 'TYPE');
const literal = token => Number.parseInt(String(token).trim().replace(/[LlSsTt]$/, ''), undefined);

function lintClass(cls, problems, references) {
  const error = (line, message, signature = '') => problems.push(`${cls.file}:${line}${signature ? ' ' + signature : ''}: ${message}`);
  if (!cls.name) error(1, 'missing .class');
  if (!cls.superClass) error(1, 'missing .super');
  if (cls.unterminated) error(0, `method ${cls.unterminated} has no .end method`);
  const signatures = new Set();
  for (const method of cls.methods) {
    if (signatures.has(method.signature)) error(method.line, 'duplicate method', method.signature);
    signatures.add(method.signature);
    lintMethod(cls, method, (line, message) => error(line, message, method.signature), references);
  }
  for (const iface of cls.interfaces) {
    const required = { 'Ljava/lang/Runnable;': ['run()V'], 'Landroid/location/LocationListener;': ['onLocationChanged(Landroid/location/Location;)V', 'onProviderEnabled(Ljava/lang/String;)V', 'onProviderDisabled(Ljava/lang/String;)V', 'onStatusChanged(Ljava/lang/String;ILandroid/os/Bundle;)V'] }[iface] || [];
    for (const signature of required) {
      const method = cls.methods.find(candidate => candidate.signature === signature);
      if (!method || method.static || method.private) error(1, `${iface} needs a public instance ${signature}`);
    }
  }
}

function lintMethod(cls, method, error, references) {
  const { params, ret } = parseDescriptor(method.signature.slice(method.signature.indexOf('(')));
  const ins = params.reduce((sum, type) => sum + wordsOf(type), method.static ? 0 : 1);
  let locals = null;
  const items = [];
  let skipUntil = null;
  for (const { text, line } of method.lines) {
    const trimmed = stripComment(text).trim();
    if (!trimmed) continue;
    if (skipUntil) { if (trimmed === skipUntil) skipUntil = null; continue; }
    const block = /^\.(annotation|array-data|packed-switch|sparse-switch)\b/.exec(trimmed);
    if (block) { skipUntil = `.end ${block[1]}`; continue; }
    if (/^\.locals\s+\d+$/.test(trimmed)) { locals = Number(trimmed.split(/\s+/)[1]); continue; }
    if (/^\.registers\s+\d+$/.test(trimmed)) { locals = Number(trimmed.split(/\s+/)[1]) - ins; continue; }
    if (trimmed.startsWith(':')) { items.push({ kind: 'label', name: trimmed, line }); continue; }
    if (trimmed.startsWith('.catch')) { items.push({ kind: 'catch', text: trimmed, line }); continue; }
    if (trimmed.startsWith('.')) continue;
    const space = trimmed.search(/\s/);
    items.push({ kind: 'insn', op: space < 0 ? trimmed : trimmed.slice(0, space), args: space < 0 ? '' : trimmed.slice(space + 1).trim(), line });
  }
  if (locals === null || locals < 0) { error(method.line, 'missing or negative .locals/.registers'); return; }
  const total = locals + ins;
  if (total > 65535) error(method.line, 'too many registers');
  const absolute = (token, line) => {
    const number = Number(token.slice(1));
    if (token[0] === 'p') { if (number >= ins) error(line, `${token} out of range (${ins} parameter registers)`); return locals + number; }
    if (number >= total) error(line, `${token} out of range (${locals} locals + ${ins} parameters)`);
    return number;
  };

  const defined = new Map();
  items.forEach((item, index) => {
    if (item.kind !== 'label') return;
    if (defined.has(item.name)) error(item.line, `label ${item.name} defined twice`);
    defined.set(item.name, index);
  });
  const handlers = new Set();
  const branchTargets = new Set();
  for (const item of items) {
    if (item.kind === 'catch') {
      const labels = scrub(item.text).match(/:[\w$]+/g) || [];
      if (labels.length !== 3) { error(item.line, 'malformed .catch'); continue; }
      for (const label of labels) if (!defined.has(label)) error(item.line, `undefined label ${label}`);
      if (defined.has(labels[0]) && defined.has(labels[1]) && defined.get(labels[0]) >= defined.get(labels[1])) error(item.line, 'try start is not before try end');
      handlers.add(labels[2]);
    } else if (item.kind === 'insn' && /^(if-|goto)/.test(item.op)) {
      const label = (scrub(item.args).match(/:[\w$]+/g) || []).pop();
      if (!label || !defined.has(label)) error(item.line, `undefined branch target ${label}`);
      else branchTargets.add(label);
    }
  }

  let previous = null;
  let labelSince = false;
  items.forEach((item, index) => {
    if (item.kind === 'label') { labelSince = true; return; }
    if (item.kind !== 'insn') return;
    const { op, args, line } = item;
    const registers = (scrub(args).match(/\b[vp]\d+\b/g) || []).map(token => ({ token, index: absolute(token, line) }));
    item.registers = registers;
    const isInvoke = /^invoke-/.test(op);
    if (FOUR_BIT.test(op) || (isInvoke && !op.endsWith('/range'))) {
      for (const register of registers) if (register.index > 15) error(line, `${op} needs registers <= v15, got ${register.token} (= v${register.index})`);
    } else if (!isInvoke) {
      for (const register of registers) if (register.index > 255) error(line, `${op} needs registers <= v255, got ${register.token}`);
    }

    if (isInvoke) {
      const kind = op.replace(/^invoke-/, '').replace(/\/range$/, '');
      const target = /(L[^;\s]+;)->([^\s(]+)(\([^)]*\)\S+)/.exec(args);
      const list = /\{([^}]*)\}/.exec(args);
      if (!target || !list) { error(line, `cannot parse ${op}`); return; }
      const descriptor = parseDescriptor(target[3]);
      item.ret = descriptor.ret;
      const words = descriptor.params.reduce((sum, type) => sum + wordsOf(type), kind === 'static' ? 0 : 1);
      if (op.endsWith('/range')) {
        const range = /^([vp]\d+)\s*\.\.\s*([vp]\d+)$/.exec(list[1].trim());
        if (!range) error(line, 'malformed register range');
        else {
          const first = absolute(range[1], line);
          const last = absolute(range[2], line);
          if (last - first + 1 !== words) error(line, `${target[2]} takes ${words} register(s), range has ${last - first + 1}`);
        }
      } else {
        const tokens = list[1].trim() ? list[1].split(',').map(token => token.trim()) : [];
        if (tokens.length > 5) error(line, `${op} takes at most 5 registers; use /range`);
        if (tokens.length !== words) error(line, `${target[2]} takes ${words} register(s), got ${tokens.length}`);
        const indexes = tokens.map(token => absolute(token, line));
        let position = kind === 'static' ? 0 : 1;
        for (const type of descriptor.params) {
          if (wordsOf(type) === 2 && indexes[position + 1] !== indexes[position] + 1) error(line, `wide argument ${type} needs a register pair`);
          position += wordsOf(type);
        }
      }
      references.push({ kind: 'method', invoke: kind, cls: target[1], member: target[2] + target[3], line, file: cls.file });
    }

    if (/^move-result/.test(op)) {
      if (!previous || labelSince || !/^(invoke-|filled-new-array)/.test(previous.op)) error(line, `${op} must directly follow an invoke or filled-new-array`);
      else {
        const result = previous.op.startsWith('filled-new-array') ? '[' : previous.ret;
        const expected = result === 'V' ? null : /^[JD]$/.test(result) ? 'move-result-wide' : /^[L[]/.test(result) ? 'move-result-object' : 'move-result';
        if (op !== expected) error(line, `${op} after a call returning ${result}`);
        if (op === 'move-result-wide' && registers[0] && registers[0].index + 1 >= total) error(line, 'wide result needs two registers');
      }
    }
    if (op === 'move-exception') {
      const group = [];
      let back = index - 1;
      while (back >= 0 && items[back].kind !== 'insn') { if (items[back].kind === 'label') group.push(items[back].name); back -= 1; }
      if (!group.some(label => handlers.has(label))) error(line, 'move-exception is not at a catch handler');
      for (const label of group) if (branchTargets.has(label)) error(line, `move-exception reachable by a branch to ${label}`);
      if (back >= 0 && !/^(return|goto|throw)/.test(items[back].op)) error(line, `move-exception reachable by falling through from ${items[back].op}`);
    }
    if (op === 'new-instance') {
      const parts = /^([vp]\d+),\s*(L[^;\s]+;)$/.exec(args);
      if (parts) {
        const register = absolute(parts[1], line);
        const next = items.slice(index + 1).find(candidate => candidate.kind === 'insn' && (scrub(candidate.args).match(/\b[vp]\d+\b/g) || []).some(token => absolute(token, candidate.line) === register));
        const ok = next && next.op === 'invoke-direct' && next.args.includes(`${parts[2]}-><init>(`) && (scrub(next.args).match(/\b[vp]\d+\b/) || [])[0] && absolute(scrub(next.args).match(/\b[vp]\d+\b/)[0], next.line) === register;
        if (!ok) error(line, `new-instance ${parts[1]} is not initialised by the next use of that register`);
      }
    }
    const field = /^([is])(get|put)(-\w+)?$/.exec(op);
    if (field) {
      const ref = /(L[^;\s]+;)->([^\s:]+):(\S+)/.exec(args);
      if (!ref) error(line, `cannot parse ${op}`);
      else {
        const kindPattern = FIELD_KIND[field[3] || ''];
        if (!kindPattern || !kindPattern.test(ref[3])) error(line, `${op} on a ${ref[3]} field`);
        references.push({ kind: 'field', static: field[1] === 's', cls: ref[1], member: `${ref[2]}:${ref[3]}`, line, file: cls.file });
      }
    }
    const constant = /^const(\/4|\/16|\/high16|-wide\/16|-wide\/32)$/.exec(op);
    if (constant) {
      const value = literal(args.split(',').pop());
      const ok = Number.isFinite(value) && {
        '/4': value >= -8 && value <= 7,
        '/16': value >= -32768 && value <= 32767,
        '/high16': (value & 0xffff) === 0 && value >= -2147483648 && value <= 0xffff0000,
        '-wide/16': value >= -32768 && value <= 32767,
        '-wide/32': value >= -2147483648 && value <= 2147483647,
      }[constant[1]];
      if (!ok) error(line, `${op} literal out of range: ${args}`);
    }
    if (/\/lit8$/.test(op)) { const value = literal(args.split(',').pop()); if (!(value >= -128 && value <= 127)) error(line, `${op} literal out of range`); }
    if (/\/lit16$/.test(op)) { const value = literal(args.split(',').pop()); if (!(value >= -32768 && value <= 32767)) error(line, `${op} literal out of range`); }
    if (op === 'return-void' && ret !== 'V') error(line, `return-void in a method returning ${ret}`);
    if (op === 'return' && !/^[ZBSCIF]$/.test(ret)) error(line, `return in a method returning ${ret}`);
    if (op === 'return-wide' && !/^[JD]$/.test(ret)) error(line, `return-wide in a method returning ${ret}`);
    if (op === 'return-object' && !/^[L[]/.test(ret)) error(line, `return-object in a method returning ${ret}`);
    previous = item;
    labelSince = false;
  });
  const last = [...items].reverse().find(item => item.kind === 'insn');
  if (!last) error(method.line, 'empty method body');
  else if (!/^(return|goto|throw)/.test(last.op)) error(last.line, `code falls off the end after ${last.op}`);
}

function buildIndex(classes) {
  const index = new Map();
  for (const cls of classes) {
    if (!cls.name) continue;
    index.set(cls.name, { methods: new Map(cls.methods.map(method => [method.signature, method])), fields: cls.fields, superClass: cls.superClass });
  }
  return index;
}

function checkOwnReferences(references, index, problems, prefix = 'Lnet/doushisi/standalone/') {
  for (const ref of references) {
    if (!ref.cls.startsWith(prefix)) continue;
    const cls = index.get(ref.cls);
    const where = `${ref.file}:${ref.line}`;
    if (!cls) { problems.push(`${where}: unknown class ${ref.cls}`); continue; }
    if (ref.kind === 'field') {
      const field = cls.fields.get(ref.member);
      if (!field) problems.push(`${where}: missing field ${ref.cls}->${ref.member}`);
      else if (field.static !== ref.static) problems.push(`${where}: ${ref.static ? 's' : 'i'}get/put on ${field.static ? 'static' : 'instance'} field ${ref.member}`);
      continue;
    }
    const method = cls.methods.get(ref.member);
    if (!method) { problems.push(`${where}: missing method ${ref.cls}->${ref.member}`); continue; }
    const ok = {
      static: method.static,
      direct: !method.static && (method.constructor || method.private),
      virtual: !method.static && !method.private && !method.constructor,
      super: !method.static && !method.private,
      interface: !method.static,
    }[ref.invoke];
    if (!ok) problems.push(`${where}: invoke-${ref.invoke} does not match ${ref.cls}->${ref.member} (${method.static ? 'static' : 'instance'}${method.private ? ', private' : ''})`);
  }
}

// ---------------------------------------------------------------- dex + binary manifest (read-only)

function parseDex(buffer) {
  if (buffer.toString('latin1', 0, 4) !== 'dex\n') throw new Error('not a dex file');
  const u32 = offset => buffer.readUInt32LE(offset);
  const u16 = offset => buffer.readUInt16LE(offset);
  const uleb = state => { let result = 0; let shift = 0; let byte; do { byte = buffer[state.offset++]; result |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80); return result >>> 0; };
  const strings = new Map();
  const string = index => {
    if (!strings.has(index)) {
      const state = { offset: u32(u32(0x3c) + index * 4) };
      uleb(state);
      let end = state.offset;
      while (buffer[end] !== 0) end += 1;
      strings.set(index, buffer.toString('utf8', state.offset, end));
    }
    return strings.get(index);
  };
  const type = index => string(u32(u32(0x44) + index * 4));
  const proto = index => {
    const base = u32(0x4c) + index * 12;
    const list = u32(base + 8);
    let parameters = '';
    if (list) for (let item = 0; item < u32(list); item += 1) parameters += type(u16(list + 4 + item * 2));
    return `(${parameters})${type(u32(base + 4))}`;
  };
  const method = index => { const base = u32(0x5c) + index * 8; return `${type(u16(base))}->${string(u32(base + 4))}${proto(u16(base + 2))}`; };
  const field = index => { const base = u32(0x54) + index * 8; return `${type(u16(base))}->${string(u32(base + 4))}:${type(u16(base + 2))}`; };
  const methodIndex = new Map();
  for (let index = 0; index < u32(0x58); index += 1) methodIndex.set(method(index), index);
  const classes = new Map();
  for (let index = 0; index < u32(0x60); index += 1) {
    const base = u32(0x64) + index * 32;
    const superIndex = u32(base + 8);
    const info = { name: type(u32(base)), superClass: superIndex === 0xffffffff ? null : type(superIndex), methods: new Map(), fields: new Map(), code: new Map() };
    const data = u32(base + 24);
    if (data) {
      const state = { offset: data };
      const sizes = [uleb(state), uleb(state), uleb(state), uleb(state)];
      for (let list = 0; list < 2; list += 1) { let item = 0; for (let k = 0; k < sizes[list]; k += 1) { item += uleb(state); info.fields.set(field(item), uleb(state)); } }
      for (let list = 2; list < 4; list += 1) {
        let item = 0;
        for (let k = 0; k < sizes[list]; k += 1) { item += uleb(state); const signature = method(item); info.methods.set(signature, uleb(state)); info.code.set(signature, uleb(state)); }
      }
    }
    classes.set(info.name, info);
  }
  // True when the method's bytecode contains invoke-super(/range) of target (operand scan).
  const invokesSuper = (owner, signature, target) => {
    const info = classes.get(owner);
    const code = info && info.code.get(`${owner}->${signature}`);
    const wanted = methodIndex.get(target);
    if (!code || wanted === undefined) return false;
    const units = u32(code + 12);
    for (let unit = 0; unit + 1 < units; unit += 1) {
      const opcode = buffer[code + 16 + unit * 2];
      if ((opcode === 0x6f || opcode === 0x75) && u16(code + 16 + (unit + 1) * 2) === wanted) return true;
    }
    return false;
  };
  return { classes, methodIndex, invokesSuper };
}

function resolveInDex(dex, cls, member, isField) {
  const seen = new Set();
  let current = cls;
  while (current && !seen.has(current)) {
    seen.add(current);
    const info = dex.classes.get(current);
    if (!info) return { framework: current };
    const map = isField ? info.fields : info.methods;
    const key = `${current}->${member}`;
    if (map.has(key)) return { flags: map.get(key), owner: current };
    current = info.superClass;
  }
  return { missing: true };
}

function parseAxml(buffer) {
  const u16 = offset => buffer.readUInt16LE(offset);
  const u32 = offset => buffer.readUInt32LE(offset);
  if (u16(0) !== 0x0003) throw new Error('not a binary XML file');
  let strings = [];
  const elements = [];
  let offset = u16(2);
  while (offset + 8 <= buffer.length) {
    const type = u16(offset);
    const headerSize = u16(offset + 2);
    const size = u32(offset + 4);
    if (size < 8) break;
    if (type === 0x0001) {
      const stringCount = u32(offset + 8);
      const utf8 = (u32(offset + 16) & 0x100) !== 0;
      const stringsStart = u32(offset + 20);
      strings = [];
      for (let index = 0; index < stringCount; index += 1) {
        let pointer = offset + stringsStart + u32(offset + headerSize + index * 4);
        if (utf8) {
          if (buffer[pointer++] & 0x80) pointer += 1;
          let bytes = buffer[pointer++];
          if (bytes & 0x80) bytes = ((bytes & 0x7f) << 8) | buffer[pointer++];
          strings.push(buffer.toString('utf8', pointer, pointer + bytes));
        } else {
          let units = u16(pointer); pointer += 2;
          if (units & 0x8000) { units = ((units & 0x7fff) << 16) | u16(pointer); pointer += 2; }
          strings.push(buffer.toString('utf16le', pointer, pointer + units * 2));
        }
      }
    } else if (type === 0x0102) {
      const attributeStart = u16(offset + 24);
      const attributeSize = u16(offset + 26);
      const attributeCount = u16(offset + 28);
      const attributes = {};
      for (let index = 0; index < attributeCount; index += 1) {
        const at = offset + 16 + attributeStart + index * attributeSize;
        const raw = u32(at + 8);
        const dataType = buffer[at + 15];
        const data = u32(at + 16);
        let value;
        if (dataType === 0x03) value = strings[data];
        else if (dataType === 0x12) value = data !== 0;
        else if (dataType === 0x10) value = data | 0;
        else if (dataType === 0x11) value = '0x' + data.toString(16);
        else if (dataType === 0x01) value = '@0x' + data.toString(16);
        else value = raw !== 0xffffffff ? strings[raw] : data;
        attributes[strings[u32(at + 4)]] = value;
      }
      elements.push({ name: strings[u32(offset + 20)], attributes });
    }
    offset += size;
  }
  return elements;
}

let baseApk = null;
function loadBaseApk() {
  if (baseApk !== null) return baseApk;
  if (!existsSync(BASE_APK)) { baseApk = false; return baseApk; }
  const buffer = readFileSync(BASE_APK);
  const entries = readZipEntries(buffer);
  const entry = name => entries.find(candidate => candidate.name === name);
  const dexEntries = entries.filter(candidate => /^classes\d*\.dex$/.test(candidate.name));
  const dexes = dexEntries.map(candidate => parseDex(readZipEntry(buffer, candidate)));
  const dex = {
    classes: new Map(dexes.flatMap(item => [...item.classes])),
    invokesSuper: (...args) => dexes.some(item => item.invokesSuper(...args)),
  };
  baseApk = { entries, dex, dexNames: dexEntries.map(candidate => candidate.name), manifest: parseAxml(readZipEntry(buffer, entry('AndroidManifest.xml'))) };
  return baseApk;
}

// ---------------------------------------------------------------- 4. patch on synthetic trees

const STUB_METHODS = `
.method public static wx_login()V
    .locals 1
    const/4 v0, 0x0
    return-void
.end method

.method private initLocationOption()V
    .locals 0
    return-void
.end method

.method public static postException(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public static aliPay(Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public static wxPay(Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public static playAd()V
    .locals 0
    return-void
.end method

.method public loadAd(Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public static shareFriend(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public static shareFriendText(Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public static sharePYQ(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public static shareScreenshot(Ljava/lang/String;II)V
    .locals 0
    return-void
.end method

.method public static isShowAd()I
    .locals 1
    const/4 v0, 0x1
    return v0
.end method

.method public static requestLocation()V
    .locals 0
    return-void
.end method

.method public static getLatitude()Ljava/lang/String;
    .locals 1
    const-string v0, "1.0"
    return-object v0
.end method

.method public static getLongitude()Ljava/lang/String;
    .locals 1
    const-string v0, "2.0"
    return-object v0
.end method
`;

function appActivityStub({ withForwards }) {
  return `.class public Lorg/cocos2dx/javascript/AppActivity;
.super Lorg/cocos2dx/lib/Cocos2dxActivity;
.source "AppActivity.java"

.field public static that:Lorg/cocos2dx/javascript/AppActivity;

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Lorg/cocos2dx/lib/Cocos2dxActivity;-><init>()V
    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 1
    .param p1, "savedInstanceState"    # Landroid/os/Bundle;

    .line 50
    invoke-super {p0, p1}, Lorg/cocos2dx/lib/Cocos2dxActivity;->onCreate(Landroid/os/Bundle;)V
    return-void
.end method
${STUB_METHODS}
.method protected onDestroy()V
    .locals 1

    .line 200
    invoke-super {p0}, Lorg/cocos2dx/lib/Cocos2dxActivity;->onDestroy()V
    return-void
.end method
${withForwards ? `
.method protected onActivityResult(IILandroid/content/Intent;)V
    .locals 1
    .param p1, "requestCode"    # I
    .param p2, "resultCode"    # I
    .param p3, "data"    # Landroid/content/Intent;

    .line 120
    invoke-super {p0, p1, p2, p3}, Lorg/cocos2dx/lib/Cocos2dxActivity;->onActivityResult(IILandroid/content/Intent;)V
    return-void
.end method

.method public onRequestPermissionsResult(I[Ljava/lang/String;[I)V
    .locals 0
    return-void
.end method
` : ''}`;
}

function makeProject(dir) {
  const copy = path => { mkdirSync(dirname(join(dir, path)), { recursive: true }); cpSync(join(ROOT, path), join(dir, path)); };
  copy('assets/main.js');
  copy('client/public/standalone.js');
  for (const name of ['StandaloneLocation', 'StandaloneMedia', 'StandaloneMediaTask', 'AcceptanceReceiver']) copy(`client/android/native/${name}.smali`);
  copy('client/android/res/xml/standalone_media_paths.xml');
  writeFile(dir, 'client/public/standalone-replay.js', '// replay stub\n');
  writeFile(dir, 'client/public/decimal.js', '// decimal stub\n');
  writeFile(dir, 'client/public/edition-config.js', '// edition stub\n');
  for (const bundle of ['main', 'hall', 'resources', 'internal', 'dss']) writeFile(dir, `client/public/assets/${bundle}/index.js`, bundle === 'main' ? `// main\n${ORIGINAL_UPDATE}\n}\n` : `// ${bundle}\n`);
  writeFile(dir, 'tools/acceptance-client-adapter.js', '(function () {\n  window.__acceptance = true;\n})();\n');
}

function makeDecoded(dir, { activityRoot, withForwards, provider, staleRoot = null }) {
  writeFile(dir, 'AndroidManifest.xml', read('AndroidManifest.xml'));
  writeFile(dir, 'apktool.yml', "!!brut.androlib.meta.MetaInfo\napkFileName: doushisi.apk\nversionInfo:\n  versionCode: '120'\n  versionName: 1.2.0\n");
  writeFile(dir, 'assets/main.js', '// old boot\n');
  writeFile(dir, 'assets/assets/main/index.js', `// old main\n${ORIGINAL_UPDATE}\n`);
  writeFile(dir, 'assets/assets/mj/index.js', '// mj\n');
  writeFile(dir, 'assets/assets/bzp/index.js', '// bzp\n');
  writeFile(dir, `${activityRoot}/org/cocos2dx/javascript/AppActivity.smali`, appActivityStub({ withForwards }));
  const providerClass = provider === 'androidx' ? 'androidx/core/content/FileProvider' : 'android/support/v4/content/FileProvider';
  writeFile(dir, `smali/${providerClass}.smali`, `.class public L${providerClass};\n.super Landroid/content/ContentProvider;\n`);
  if (staleRoot) writeFile(dir, `${staleRoot}/net/doushisi/standalone/StandaloneMedia.smali`, '.class public final Lnet/doushisi/standalone/StandaloneMedia;\n.super Ljava/lang/Object;\n');
}

const snapshot = (dir, paths) => Object.fromEntries(paths.map(path => [path, existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : null]));
const patchedClasses = [];

await section('4. client-native-patch on synthetic apktool trees', async () => {
  const project = join(TEMP, 'project');
  makeProject(project);
  const quiet = () => {};

  // Variant A: like the base APK (smali/, support FileProvider, AppActivity without forwards first).
  const decodedA = join(TEMP, 'decoded-a');
  makeDecoded(decodedA, { activityRoot: 'smali', withForwards: false, provider: 'support' });
  const resultA = await patchDecodedApk(decodedA, { apiBase: API, project, log: quiet });
  const filesA = ['smali/org/cocos2dx/javascript/AppActivity.smali', 'AndroidManifest.xml', 'assets/main.js', 'assets/standalone-native.js', 'smali/net/doushisi/standalone/StandaloneMedia.smali', 'smali/net/doushisi/standalone/StandaloneMediaTask.smali', 'smali/net/doushisi/standalone/StandaloneLocation.smali', 'res/xml/standalone_media_paths.xml', 'assets/assets/main/index.js'];
  const firstA = snapshot(decodedA, filesA);
  await patchDecodedApk(decodedA, { apiBase: API, project, log: quiet });
  const secondA = snapshot(decodedA, filesA);
  for (const path of filesA) check(`A idempotent: ${path}`, firstA[path] !== null && firstA[path] === secondA[path]);
  const activityA = secondA['smali/org/cocos2dx/javascript/AppActivity.smali'];
  check('A: onActivityResult added with forward + super', count(activityA, 'StandaloneMedia;->onActivityResult(') === 1 && /\.method protected onActivityResult\(IILandroid\/content\/Intent;\)V[\s\S]*?invoke-super \{p0, p1, p2, p3\}, Lorg\/cocos2dx\/lib\/Cocos2dxActivity;->onActivityResult/.test(activityA));
  check('A: onRequestPermissionsResult added once, forwards to StandaloneMedia', count(activityA, '.method public onRequestPermissionsResult(I[Ljava/lang/String;[I)V') === 1 && count(activityA, 'StandaloneMedia;->onRequestPermissionsResult(') === 1);
  check('A: StandaloneLocation.stop before super.onDestroy, once', count(activityA, 'StandaloneLocation;->stop(') === 1 && /StandaloneLocation;->stop\(Landroid\/content\/Context;\)V\n\s*invoke-super \{p0\}, Lorg\/cocos2dx\/lib\/Cocos2dxActivity;->onDestroy/.test(activityA));
  const manifestA = secondA['AndroidManifest.xml'];
  check('A: exactly one media provider, support FileProvider', count(manifestA, MEDIA_AUTHORITY) === 1 && manifestA.includes('android:name="android.support.v4.content.FileProvider"'));
  check('A: no acceptance receiver', !manifestA.includes('AcceptanceReceiver') && !existsSync(join(decodedA, 'smali/net/doushisi/standalone/AcceptanceReceiver.smali')) && !existsSync(join(decodedA, 'assets/standalone-acceptance.js')));
  check('A: mj/bzp bundles removed', !existsSync(join(decodedA, 'assets/assets/mj')) && !existsSync(join(decodedA, 'assets/assets/bzp')));
  check('A: update controller patched once', count(secondA['assets/assets/main/index.js'], PATCHED_UPDATE) === 1 && !secondA['assets/assets/main/index.js'].includes(ORIGINAL_UPDATE));
  const bootA = secondA['assets/main.js'];
  check('A: main.js has no markers left', !bootA.includes('@standalone-build-config') && !bootA.includes('@standalone-bundled-adapter') && !bootA.includes('@standalone-acceptance'));
  check('A: main.js embeds the build config', bootA.includes(`window.STANDALONE_CONFIG = ${JSON.stringify(buildConfig(API))};`));
  check('A: main.js embeds the bundled adapter descriptor', bootA.includes(JSON.stringify({ version: resultA.adapter.version, sha256: resultA.adapter.sha256 })));
  check('A: bundled adapter = client/public/native copy', secondA['assets/standalone-native.js'] === readFileSync(join(project, 'client/public/native/standalone-native.js'), 'utf8') && sha256(secondA['assets/standalone-native.js']) === resultA.adapter.sha256);
  check('A: StandaloneMedia copied unchanged (support descriptor)', secondA['smali/net/doushisi/standalone/StandaloneMedia.smali'] === read('client/android/native/StandaloneMedia.smali'));
  const bootFile = join(TEMP, 'patched-main.js');
  writeFileSync(bootFile, bootA);
  const syntax = spawnSync(process.execPath, ['--check', bootFile], { encoding: 'utf8' });
  check('A: node --check on the patched main.js', syntax.status === 0, syntax.stderr);
  const upToDate = simulateBoot(bootA, { routes: { [MANIFEST_ROUTE]: { status: 200, body: JSON.stringify({ version: resultA.adapter.version, sha256: resultA.adapter.sha256, path: SCRIPT_ROUTE }) } } });
  expectBoot('A: patched main.js, server = bundled', upToDate, { kind: 'bundled', reason: 'up-to-date', requests: 1 });
  check('A: native-config.json written to the scratch project only', existsSync(join(project, 'client/android/native-config.json')));
  patchedClasses.push(parseSmali(activityA, 'patched-A/AppActivity.smali'));

  // Variant B: AppActivity in smali_classes2 with existing forwards, androidx FileProvider, stale copy elsewhere.
  const decodedB = join(TEMP, 'decoded-b');
  makeDecoded(decodedB, { activityRoot: 'smali_classes2', withForwards: true, provider: 'androidx', staleRoot: 'smali' });
  await patchDecodedApk(decodedB, { apiBase: API, project, acceptance: true, log: quiet });
  const mediaB = readFileSync(join(decodedB, 'smali_classes2/net/doushisi/standalone/StandaloneMedia.smali'), 'utf8');
  check('B: classes go next to AppActivity (smali_classes2)', existsSync(join(decodedB, 'smali_classes2/net/doushisi/standalone/StandaloneMediaTask.smali')));
  check('B: stale copy in another smali root removed', !existsSync(join(decodedB, 'smali/net/doushisi/standalone/StandaloneMedia.smali')));
  check('B: FileProvider descriptor rewritten to androidx', mediaB.includes('Landroidx/core/content/FileProvider;->getUriForFile') && !mediaB.includes('Landroid/support/v4/content/FileProvider;'));
  const manifestB = readFileSync(join(decodedB, 'AndroidManifest.xml'), 'utf8');
  check('B: manifest provider is androidx, receiver added for acceptance', manifestB.includes('android:name="androidx.core.content.FileProvider"') && count(manifestB, MEDIA_AUTHORITY) === 1 && count(manifestB, 'net.doushisi.standalone.AcceptanceReceiver') === 1);
  const bootB = readFileSync(join(decodedB, 'assets/main.js'), 'utf8');
  check('B: acceptance script inlined at the hook, indented', bootB.includes('        (function () {\n          window.__acceptance = true;\n        })();\n        window.boot();'));
  check('B: acceptance asset + receiver smali present', existsSync(join(decodedB, 'assets/standalone-acceptance.js')) && existsSync(join(decodedB, 'smali_classes2/net/doushisi/standalone/AcceptanceReceiver.smali')));
  const activityB1 = readFileSync(join(decodedB, 'smali_classes2/org/cocos2dx/javascript/AppActivity.smali'), 'utf8');
  check('B: forward inserted right after .locals of the existing onActivityResult', /\.method protected onActivityResult\(IILandroid\/content\/Intent;\)V\n    \.locals 1\n    invoke-static\/range \{p0 \.\. p3\}, Lnet\/doushisi\/standalone\/StandaloneMedia;->onActivityResult/.test(activityB1) && count(activityB1, 'StandaloneMedia;->onActivityResult(') === 1);
  check('B: existing onRequestPermissionsResult replaced, declaration kept', count(activityB1, '.method public onRequestPermissionsResult(I[Ljava/lang/String;[I)V') === 1 && activityB1.includes('StandaloneMedia;->onRequestPermissionsResult('));
  await patchDecodedApk(decodedB, { apiBase: API, project, acceptance: false, log: quiet });
  const manifestB2 = readFileSync(join(decodedB, 'AndroidManifest.xml'), 'utf8');
  const activityB2 = readFileSync(join(decodedB, 'smali_classes2/org/cocos2dx/javascript/AppActivity.smali'), 'utf8');
  check('B: non-acceptance rebuild strips receiver, asset and smali', !manifestB2.includes('AcceptanceReceiver') && !existsSync(join(decodedB, 'assets/standalone-acceptance.js')) && !existsSync(join(decodedB, 'smali_classes2/net/doushisi/standalone/AcceptanceReceiver.smali')));
  check('B: AppActivity unchanged by the second run', activityB1 === activityB2);
  check('B: acceptance hook gone from main.js', !readFileSync(join(decodedB, 'assets/main.js'), 'utf8').includes('__acceptance'));
  patchedClasses.push(parseSmali(activityB2, 'patched-B/AppActivity.smali'));

  // Refusals.
  const empty = join(TEMP, 'not-decoded');
  mkdirSync(empty, { recursive: true });
  await patchDecodedApk(empty, { apiBase: API, project, log: quiet }).then(() => check('refuses a folder that is not an apktool tree', false), error => check('refuses a folder that is not an apktool tree', /not an apktool-decoded APK/.test(error.message)));
  const decodedC = join(TEMP, 'decoded-c');
  makeDecoded(decodedC, { activityRoot: 'smali', withForwards: false, provider: 'support' });
  rmSync(join(decodedC, 'smali/android'), { recursive: true });
  await patchDecodedApk(decodedC, { apiBase: API, project, log: quiet }).then(() => check('refuses an APK without FileProvider', false), error => check('refuses an APK without FileProvider', /No FileProvider class/.test(error.message)));
  await patchDecodedApk(decodedC, { apiBase: 'https://api.test.invalid/path', project, log: quiet }).then(() => check('refuses an apiBase with a path', false), error => check('refuses an apiBase with a path', /origin without a path/.test(error.message)));
  check('renderBootScript refuses a template without markers', throwsMatching(() => renderBootScript('window.boot();', { config: {}, bundled: BUNDLED }), /marker not found/));
  check('renderBootScript refuses duplicated markers', throwsMatching(() => renderBootScript('null /* @standalone-build-config */ null /* @standalone-build-config */', { config: {}, bundled: BUNDLED }), /more than once/));
  const separators = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
  const rendered = renderBootScript(read('assets/main.js'), { config: { apiBase: API, note: separators }, bundled: BUNDLED });
  check('renderBootScript escapes U+2028/U+2029', !rendered.includes(separators[0]) && !rendered.includes(separators[1]) && rendered.includes('\\u2028\\u2029'));
});

// ---------------------------------------------------------------- 5. smali lint

await section('5. Smali lint + cross references', () => {
  const sources = ['StandaloneLocation', 'StandaloneMedia', 'StandaloneMediaTask', 'AcceptanceReceiver']
    .map(name => parseSmali(read(`client/android/native/${name}.smali`), `client/android/native/${name}.smali`));
  const classes = [...sources, ...patchedClasses];
  const problems = [];
  const references = [];
  for (const cls of classes) lintClass(cls, problems, references);
  const index = buildIndex(classes);
  checkOwnReferences(references, index, problems);
  const methodCount = classes.reduce((sum, cls) => sum + cls.methods.length, 0);
  check(`lint: ${classes.length} classes, ${methodCount} methods, ${references.length} references`, problems.length === 0, problems.join('\n    '));
  // The lint must catch real mistakes: each broken body below has to be reported.
  const broken = {
    'invoke with 6 registers': ['.locals 6', 'invoke-static {v0, v1, v2, v3, v4, v5}, Lx/Y;->f(IIIIII)V', 'return-void'],
    'register above v15 in a 4-bit op': ['.locals 17', 'iget v16, p0, Lx/Y;->a:I', 'return-void'],
    'parameter register out of range': ['.locals 0', 'move v0, p1', 'return-void'],
    'move-result not after invoke': ['.locals 1', 'const/4 v0, 0x1', 'move-result v0', 'return-void'],
    'move-result kind mismatch': ['.locals 1', 'invoke-static {}, Lx/Y;->f()I', 'move-result-object v0', 'return-void'],
    'const/4 out of range': ['.locals 1', 'const/4 v0, 0x9', 'return-void'],
    'falls off the end': ['.locals 1', 'const/4 v0, 0x1'],
    'undefined branch target': ['.locals 1', 'if-eqz v0, :nowhere', 'return-void'],
    'move-exception reachable by fall-through': ['.locals 1', ':a', 'invoke-static {}, Lx/Y;->f()V', ':b', '.catch Ljava/lang/Throwable; {:a .. :b} :h', 'nop', ':h', 'move-exception v0', 'return-void'],
    'new-instance not initialised': ['.locals 1', 'new-instance v0, Ljava/lang/Object;', 'return-void'],
    'wrong field op suffix': ['.locals 1', 'sget-object v0, Lx/Y;->a:I', 'return-void'],
    'wide argument not a pair': ['.locals 3', 'invoke-static {v0, v2}, Lx/Y;->f(J)V', 'return-void'],
    'return-void in a non-void method': ['.locals 0', 'return-void'],
  };
  for (const [label, body] of Object.entries(broken)) {
    const signature = label === 'return-void in a non-void method' ? 'f()I' : 'f()V';
    const text = `.class public Lnet/doushisi/standalone/Broken;\n.super Ljava/lang/Object;\n.method public ${signature}\n${body.map(line => '    ' + line).join('\n')}\n.end method\n`;
    const found = [];
    lintClass(parseSmali(text, 'broken.smali'), found, []);
    check(`lint catches: ${label}`, found.length > 0);
  }
  const ownProblems = [];
  checkOwnReferences([{ kind: 'field', static: true, cls: 'Lnet/doushisi/standalone/StandaloneMedia;', member: 'nope:I', line: 1, file: 'x' }, { kind: 'method', invoke: 'virtual', cls: 'Lnet/doushisi/standalone/StandaloneMedia;', member: 'pick(Ljava/lang/String;)V', line: 2, file: 'x' }], index, ownProblems);
  check('cross-reference check catches a missing field and a static method called virtually', ownProblems.length === 2, ownProblems.join('; '));

  const media = sources[1];
  const authority = /\.field public static final AUTHORITY:Ljava\/lang\/String; = "([^"]+)"/.exec(read('client/android/native/StandaloneMedia.smali'));
  check('StandaloneMedia.AUTHORITY = patch MEDIA_AUTHORITY = template provider', authority && authority[1] === MEDIA_AUTHORITY && read('AndroidManifest.xml').includes(`android:authorities="${MEDIA_AUTHORITY}"`) && count(read('client/android/native/StandaloneMedia.smali'), `"${MEDIA_AUTHORITY}"`) === 2);
  check('camera file folder matches res/xml cache-path', read('client/android/native/StandaloneMedia.smali').includes('const-string v2, "standalone-camera"') && /<cache-path name="standalone_camera" path="standalone-camera\/" \/>/.test(read('client/android/res/xml/standalone_media_paths.xml')));
  const entry = signature => media.methods.find(method => method.signature === signature);
  check('StandaloneMedia.pick(String) is public static', entry('pick(Ljava/lang/String;)V') && entry('pick(Ljava/lang/String;)V').static && !entry('pick(Ljava/lang/String;)V').private);
  const location = sources[0].methods.find(method => method.signature === 'requestPermission()V');
  check('StandaloneLocation.requestPermission() is public static', location && location.static && !location.private);

  const apk = loadBaseApk();
  if (!apk) { note('base APK missing: dex reference checks skipped'); return; }
  const dexProblems = [];
  let resolved = 0;
  let framework = 0;
  for (const ref of references) {
    if (ref.cls.startsWith('Lnet/doushisi/standalone/')) continue;
    const found = resolveInDex(apk.dex, ref.cls, ref.member, ref.kind === 'field');
    if (found.framework) { framework += 1; continue; }
    if (found.missing) { dexProblems.push(`${ref.file}:${ref.line} ${ref.cls}->${ref.member} not found in the base APK`); continue; }
    resolved += 1;
    const isStatic = (found.flags & 0x8) !== 0;
    const wantStatic = ref.kind === 'field' ? ref.static : ref.invoke === 'static';
    if (isStatic !== wantStatic) dexProblems.push(`${ref.file}:${ref.line} ${ref.cls}->${ref.member} is ${isStatic ? 'static' : 'instance'} in the base APK`);
  }
  check(`app-side references resolve in the base APK dex (${resolved} checked, ${framework} framework)`, dexProblems.length === 0, dexProblems.join('\n    '));
});

// ---------------------------------------------------------------- 6. zip alignment

function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = file.method === 8 ? deflateRawSync(file.data) : file.data;
    let pad = 0;
    if (file.align) {
      pad = (file.align - ((offset + 30 + name.length) % file.align)) % file.align;
      if (file.avoid && (offset + 30 + name.length + pad) % file.avoid === 0) pad += file.align;
    }
    if (file.misalign) pad += 1;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(file.method, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(pad, 28);
    parts.push(local, name, Buffer.alloc(pad), data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(file.method, 10);
    header.writeUInt32LE(data.length, 20); header.writeUInt32LE(file.data.length, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += 30 + name.length + pad + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

await section('6. Zip alignment checks', () => {
  const payload = Buffer.from('x'.repeat(5000));
  const good = makeZip([
    { name: 'AndroidManifest.xml', data: payload, method: 8 },
    { name: 'resources.arsc', data: payload, method: 0, align: 4 },
    { name: 'classes.dex', data: payload, method: 8 },
    { name: 'lib/arm64-v8a/libx.so', data: payload, method: 0, align: 4096 },
  ]);
  const entries = readZipEntries(good);
  const verdict = checkAlignment(entries);
  check('aligned zip: no errors, no warnings', verdict.errors.length === 0 && verdict.warnings.length === 0, JSON.stringify(verdict));
  check('readZipEntry round-trips stored and deflated entries', entries.every(entry => readZipEntry(good, entry).equals(payload)));
  const misaligned = checkAlignment(readZipEntries(makeZip([{ name: 'resources.arsc', data: payload, method: 0, align: 4, misalign: true }])));
  check('misaligned resources.arsc is an error', misaligned.errors.some(message => message.includes('resources.arsc')));
  const compressed = checkAlignment(readZipEntries(makeZip([{ name: 'resources.arsc', data: payload, method: 8 }])));
  check('compressed resources.arsc is an error', compressed.errors.some(message => message.includes('被压缩')));
  const missing = checkAlignment(readZipEntries(makeZip([{ name: 'classes.dex', data: payload, method: 8 }])));
  check('missing resources.arsc is an error', missing.errors.some(message => message.includes('缺少')));
  const soWarning = checkAlignment(readZipEntries(makeZip([{ name: 'resources.arsc', data: payload, method: 0, align: 4 }, { name: 'lib/x86/liby.so', data: payload, method: 0, align: 4, avoid: 4096 }])));
  check('checkAbis: arm64-v8a + armeabi-v7a only is clean', checkAbis(['lib/arm64-v8a/libcocos2djs.so', 'lib/armeabi-v7a/libcocos2djs.so', 'lib/arm64-v8a/liblocSDK8b.so']).length === 0);
  check('checkAbis: x86/x86_64 left in is a problem', checkAbis(['lib/arm64-v8a/libcocos2djs.so', 'lib/armeabi-v7a/libcocos2djs.so', 'lib/x86/libcocos2djs.so', 'lib/x86_64/liblocSDK8b.so']).length === 2);
  check('checkAbis: missing armeabi-v7a engine is a problem', checkAbis(['lib/arm64-v8a/libcocos2djs.so']).some(message => message.includes('armeabi-v7a')));
  check('stored .so off a 4096 boundary is a warning only', soWarning.errors.length === 0 && soWarning.warnings.length === 1, JSON.stringify(soWarning));
  const apk = loadBaseApk();
  if (!apk) { note('base APK missing: real alignment check skipped'); return; }
  const real = checkAlignment(apk.entries);
  check(`base APK (${apk.entries.length} entries) passes the alignment check`, real.errors.length === 0, real.errors.slice(0, 5).join('; '));
  if (real.warnings.length) note(`base APK alignment warnings: ${real.warnings.length}`);
});

// ---------------------------------------------------------------- 7. base APK facts

await section('7. Base APK (read in memory, never modified)', () => {
  const apk = loadBaseApk();
  if (!apk) { note(`base APK not found at ${BASE_APK}: skipped`); return; }
  const element = name => apk.manifest.filter(item => item.name === name);
  const root = element('manifest')[0] || { attributes: {} };
  const sdk = element('uses-sdk')[0] || { attributes: {} };
  const permissions = element('uses-permission').map(item => item.attributes.name);
  note(`package ${root.attributes.package}, versionCode ${root.attributes.versionCode}, versionName ${root.attributes.versionName}, minSdk ${sdk.attributes.minSdkVersion}, targetSdk ${sdk.attributes.targetSdkVersion}, dex ${apk.dexNames.join('+')}`);
  check('package is net.doushisi.standalone', root.attributes.package === 'net.doushisi.standalone', String(root.attributes.package));
  check('template declares no CAMERA permission (system camera needs none)', !read('AndroidManifest.xml').includes('android.permission.CAMERA'));
  note(`base APK permissions: ${permissions.map(name => String(name).replace('android.permission.', '')).join(', ')}`);
  const receivers = element('receiver').map(item => `${item.attributes.name}${item.attributes.exported === true ? ' (exported)' : ''}`);
  if (receivers.length) note(`base APK receivers: ${receivers.join(', ')} -- the new build only keeps AcceptanceReceiver with --acceptance`);
  const providers = element('provider').map(item => `${item.attributes.name} ${item.attributes.authorities}`);
  note(`base APK providers: ${providers.join(', ') || 'none'}`);

  const { dex } = apk;
  const activity = dex.classes.get('Lorg/cocos2dx/javascript/AppActivity;');
  check('AppActivity extends Cocos2dxActivity', activity && activity.superClass === 'Lorg/cocos2dx/lib/Cocos2dxActivity;');
  const flagsOf = signature => activity && activity.methods.get(`Lorg/cocos2dx/javascript/AppActivity;->${signature}`);
  const required = [
    ['onCreate(Landroid/os/Bundle;)V', false], ['wx_login()V'], ['initLocationOption()V'], ['postException(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V'],
    ['aliPay(Ljava/lang/String;)V'], ['wxPay(Ljava/lang/String;)V'], ['playAd()V'], ['loadAd(Ljava/lang/String;)V'],
    ['shareFriend(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V'], ['shareFriendText(Ljava/lang/String;)V'],
    ['sharePYQ(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V'], ['shareScreenshot(Ljava/lang/String;II)V'], ['isShowAd()I'],
    ['requestLocation()V', true], ['getLatitude()Ljava/lang/String;', true], ['getLongitude()Ljava/lang/String;', true], ['onDestroy()V', false],
  ];
  const missing = [];
  for (const [signature, mustBeStatic] of required) {
    const flags = flagsOf(signature);
    if (flags === undefined) missing.push(`${signature} missing`);
    else if (mustBeStatic !== undefined && ((flags & 0x8) !== 0) !== mustBeStatic) missing.push(`${signature} should be ${mustBeStatic ? 'static' : 'instance'}`);
  }
  check(`AppActivity has the ${required.length} methods patchAppActivity rewrites`, missing.length === 0, missing.join('; '));
  check('AppActivity.onDestroy calls super.onDestroy (patch anchor)', dex.invokesSuper('Lorg/cocos2dx/javascript/AppActivity;', 'onDestroy()V', 'Lorg/cocos2dx/lib/Cocos2dxActivity;->onDestroy()V'));
  check('AppActivity has a static "that" field', activity && ((activity.fields.get('Lorg/cocos2dx/javascript/AppActivity;->that:Lorg/cocos2dx/javascript/AppActivity;') ?? 0) & 0x8) !== 0);
  note(`AppActivity already overrides onActivityResult: ${flagsOf('onActivityResult(IILandroid/content/Intent;)V') !== undefined ? 'yes (forward inserted at its start)' : 'no (override added)'}; onRequestPermissionsResult: ${flagsOf('onRequestPermissionsResult(I[Ljava/lang/String;[I)V') !== undefined ? 'yes (body replaced)' : 'no (added)'}`);
  check('support FileProvider is in the APK', dex.classes.has('Landroid/support/v4/content/FileProvider;'));
  note(`already in the base APK: StandaloneLocation ${dex.classes.has('Lnet/doushisi/standalone/StandaloneLocation;') ? 'yes' : 'no'}, AcceptanceReceiver ${dex.classes.has('Lnet/doushisi/standalone/AcceptanceReceiver;') ? 'yes' : 'no'}, StandaloneMedia ${dex.classes.has('Lnet/doushisi/standalone/StandaloneMedia;') ? 'yes' : 'no'}`);

  // Every jsb.reflection call to Android in the JS the APK ships must hit a static method.
  const callPattern = /callStaticMethod\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3\s*,\s*(['"])([^'"]+)\5/g;
  const own = new Map(['StandaloneLocation', 'StandaloneMedia'].map(name => [`net/doushisi/standalone/${name}`, parseSmali(read(`client/android/native/${name}.smali`), name)]));
  const patchedActivity = patchedClasses[0];
  const unresolved = [];
  const seen = new Set();
  for (const file of ['client/public/standalone.js', 'client/public/assets/main/index.js', 'client/public/assets/hall/index.js', 'client/public/assets/dss/index.js']) {
    if (!existsSync(join(ROOT, file))) continue;
    for (const match of read(file).matchAll(callPattern)) {
      const [className, methodName, descriptor] = [match[2], match[4], match[6]];
      if (!className.includes('/')) continue;
      const key = `${className}.${methodName}${descriptor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let ok;
      if (own.has(className)) {
        const method = own.get(className).methods.find(candidate => candidate.signature === methodName + descriptor);
        ok = method && method.static && !method.private;
      } else {
        const flags = dex.classes.get(`L${className};`)?.methods.get(`L${className};->${methodName}${descriptor}`);
        ok = flags !== undefined && (flags & 0x8) !== 0;
        // Methods the patch rewrites (present in the stub) must stay static after patching.
        const patched = className === 'org/cocos2dx/javascript/AppActivity' && patchedActivity ? patchedActivity.methods.find(candidate => candidate.signature === methodName + descriptor) : null;
        if (ok && patched) ok = patched.static;
      }
      if (!ok) unresolved.push(`${file}: ${key}`);
    }
  }
  check(`all ${seen.size} jsb.reflection targets in standalone.js and the bundles are static methods of the patched APK`, unresolved.length === 0, unresolved.join('; '));
});

// ---------------------------------------------------------------- 8. build helpers + contract

await section('8. android-build helpers and the JS <-> native contract', () => {
  const decodedManifest = '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:versionCode="120" android:versionName="1.2.0" package="net.doushisi.standalone">\n  <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="30"/>\n  <application/>\n</manifest>\n';
  const merged = manifestFromTemplate(read('AndroidManifest.xml'), decodedManifest);
  check('manifestFromTemplate carries versionCode/versionName/uses-sdk into the template', merged.includes('android:versionCode="120"') && merged.includes('android:versionName="1.2.0"') && merged.includes('<uses-sdk android:minSdkVersion="21" android:targetSdkVersion="30"/>'));
  check('manifestFromTemplate keeps the template provider', count(merged, MEDIA_AUTHORITY) === 1);
  check('manifestFromTemplate leaves the template alone when apktool kept versions in apktool.yml', manifestFromTemplate(read('AndroidManifest.xml'), '<manifest package="net.doushisi.standalone">\n</manifest>') === read('AndroidManifest.xml').replace(new RegExp('^' + BOM), '').replace(/\r\n/g, '\n'));
  const yml = "apkFileName: doushisi.apk\nversionInfo:\n  versionCode: '120'\n  versionName: 1.2.0\n";
  const version = readVersion(yml, '<manifest>');
  check('readVersion from apktool.yml', version.code === 120 && version.name === '1.2.0' && version.inYml === true, JSON.stringify(version));
  const fromManifest = readVersion('apkFileName: x.apk\n', decodedManifest);
  check('readVersion falls back to the manifest', fromManifest.code === 120 && fromManifest.name === '1.2.0' && fromManifest.inYml === false, JSON.stringify(fromManifest));
  const applied = applyVersion(yml, decodedManifest, { code: 121, name: '1.2.1' });
  check('applyVersion updates apktool.yml and manifest', applied.yml.includes("versionCode: 121\n") && applied.yml.includes("versionName: '1.2.1'") && applied.xml.includes('android:versionCode="121"') && applied.xml.includes('android:versionName="1.2.1"'));
  // Apktool 3.0.3 writes `versionCode: 4` unquoted and fails to rebuild from `versionCode: '5'` (10-31).
  const apktool3 = applyVersion("versionInfo:\n  versionCode: 4\n  versionName: 4.0\n", '<manifest>', { code: 5 });
  check('applyVersion keeps versionCode a bare integer for Apktool 3', apktool3.yml === "versionInfo:\n  versionCode: 5\n  versionName: 4.0\n", JSON.stringify(apktool3.yml));
  const options = parseArguments(['--api-base', API, '--version-code=121', '--version-name', '1.2.1', '--expect-cert', 'AB:'.repeat(31) + 'AB']);
  check('parseArguments', options.apiBase === API && options.versionCode === 121 && options.versionName === '1.2.1' && options.expectCert === 'ab'.repeat(32) && options.keyAlias === 'doushisi');
  check('parseArguments rejects bad input', throwsMatching(() => parseArguments(['--version-code', '0']), /version-code/) && throwsMatching(() => parseArguments(['--expect-cert', 'zz']), /expect-cert/)
    && throwsMatching(() => parseArguments(['--bogus']), /未知参数/) && throwsMatching(() => parseArguments(['--api-base']), /缺少取值/));

  const standalone = read('client/public/standalone.js');
  const smali = read('client/android/native/StandaloneMedia.smali');
  check('standalone.js calls StandaloneMedia.pick(String)', standalone.includes("callStaticMethod('net/doushisi/standalone/StandaloneMedia', 'pick', '(Ljava/lang/String;)V'"));
  check('standalone.js defines window.StandaloneNative.onImage, which deliver() calls', /StandaloneNative/.test(standalone) && /onImage/.test(standalone) && smali.includes('window.StandaloneNative&&window.StandaloneNative.onImage&&window.StandaloneNative.onImage('));
  for (const word of ['cancelled', 'permission']) check(`error word "${word}" is produced natively and handled by standalone.js`, smali.includes(`const-string v1, "${word}"`) && standalone.includes(`'${word}'`));
  check('error word "failed" is produced natively (standalone.js treats any other error as a read failure)', smali.includes('const-string v1, "failed"'));
  if (!standalone.includes("'net/doushisi/standalone/StandaloneLocation', 'requestPermission'")) note('standalone.js does not call StandaloneLocation.requestPermission yet (main session change)');
  if (!/nativeApi/.test(standalone)) note('standalone.js does not check STANDALONE_CONFIG.nativeApi yet (main session change; old APKs have no StandaloneMedia)');
  const mainBundle = read('client/public/assets/main/index.js');
  check('client/public/assets/main/index.js has the update controller the patch rewrites', mainBundle.includes(ORIGINAL_UPDATE) || mainBundle.includes(PATCHED_UPDATE));
});

// ---------------------------------------------------------------- summary

if (process.env.DOUSHISI_SELFTEST_KEEP) console.log(`\nscratch kept: ${TEMP}`);
else rmSync(TEMP, { recursive: true, force: true });
console.log(`\n${failures.length ? 'FAILED' : 'PASSED'}: ${passed} checks passed, ${failures.length} failed${notes.length ? `, ${notes.length} notes` : ''}`);
if (failures.length) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
