#!/usr/bin/env node
// Patches an apktool-decoded Doushisi APK into the standalone client.
//
//   node tools/client-native-patch.mjs <decodedDir> <apiBase> [--ws-url=<ws(s)://...>] [--acceptance]
//
// Works on the original APK and on an already patched one (every step is idempotent).
// - JS: bundles, assets/main.js from the root assets/main.js template (build config + bundled
//   adapter descriptor), assets/standalone-native.js = client/public/native/standalone-native.js
//   (regenerated from client/public/standalone.js, the same bytes the server hot-updates with).
// - Smali: AppActivity stubs/forwards, StandaloneLocation, StandaloneMedia(+Task).
// - Manifest: FileProvider for camera shots, AcceptanceReceiver only in acceptance builds.
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncNativeAdapter } from './android-native-adapter.mjs';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MEDIA_AUTHORITY = 'net.doushisi.standalone.standalonemedia';
export const MEDIA_PATHS_RESOURCE = 'standalone_media_paths';
// Bumped whenever the APK gains native entry points the JS adapter may call:
//   1 = StandaloneMedia.pick + StandaloneLocation.requestPermission
export const NATIVE_API = 1;
export const PLACEHOLDERS = {
  config: 'null /* @standalone-build-config */',
  bundled: 'null /* @standalone-bundled-adapter */',
  acceptance: '/* @standalone-acceptance */',
};
const SUPPORT_FILE_PROVIDER = 'android/support/v4/content/FileProvider';
const ANDROIDX_FILE_PROVIDER = 'androidx/core/content/FileProvider';
const ORIGINAL_UPDATE = 'if (cc.sys.isBrowser) this.schedule(this.progressUpdate.bind(this), .02); else {';
const PATCHED_UPDATE = 'if (window.Standalone) this.schedule(this.progressUpdate.bind(this), .02); else {';

export function normalizeApiBase(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error(`apiBase is not a valid URL: ${value}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('apiBase must use http or https.');
  if (url.username || url.password) throw new Error('apiBase must not contain credentials.');
  if (url.search || url.hash) throw new Error('apiBase must not contain a query or fragment.');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('apiBase must be an origin without a path, e.g. https://game.example.com');
  return url.origin;
}

export function defaultWsUrl(apiBase) {
  return apiBase.replace(/^http/, 'ws') + '/ws/original';
}

export function normalizeWsUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error(`wsUrl is not a valid URL: ${value}`); }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('wsUrl must use ws or wss.');
  if (url.username || url.password || url.search || url.hash) throw new Error('wsUrl must not contain credentials, a query or a fragment.');
  return url.href.replace(/\/$/, '');
}

export function buildConfig(apiBase, wsUrl) {
  const base = normalizeApiBase(apiBase);
  return {
    apiBase: base,
    wsUrl: wsUrl ? normalizeWsUrl(wsUrl) : defaultWsUrl(base),
    protocolVersion: 2,
    storageNamespace: 'doushisi-standalone-v1:',
    nativeApi: NATIVE_API,
  };
}

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`${label}: marker not found: ${needle}`);
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`${label}: marker occurs more than once: ${needle}`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

// assets/main.js for the APK. JSON is a valid JS expression; U+2028/2029 are escaped for old engines.
export function renderBootScript(template, { config, bundled, acceptanceScript = '' }) {
  const json = value => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  let boot = template.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  boot = replaceOnce(boot, PLACEHOLDERS.config, json(config), 'assets/main.js');
  boot = replaceOnce(boot, PLACEHOLDERS.bundled, json({ version: bundled.version, sha256: bundled.sha256 }), 'assets/main.js');
  const hookLine = boot.match(/^([ \t]*)\/\* @standalone-acceptance \*\/[ \t]*\n/m);
  if (!hookLine || boot.split(PLACEHOLDERS.acceptance).length !== 2) throw new Error('assets/main.js: acceptance marker must occur exactly once on its own line.');
  const indent = hookLine[1];
  const inlined = acceptanceScript
    ? indent + acceptanceScript.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n+$/, '').replace(/\n/g, '\n' + indent) + '\n'
    : '';
  return boot.replace(hookLine[0], () => inlined);
}

// ---------- smali helpers ----------

export function smaliRoots(decoded) {
  return readdirSync(decoded, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^smali(_classes\d+)?$/.test(entry.name))
    .map(entry => join(decoded, entry.name))
    .sort();
}

export function findSmaliClass(decoded, internalName) {
  for (const root of smaliRoots(decoded)) {
    const path = join(root, internalName + '.smali');
    if (existsSync(path)) return { root, path };
  }
  return null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Locates ".method <modifiers> name(descriptor)" regardless of modifiers.
export function findMethod(smali, nameAndDescriptor) {
  const pattern = new RegExp('^\\.method[^\\n]*[ ]' + escapeRegExp(nameAndDescriptor) + '[ \\t]*$', 'm');
  const match = pattern.exec(smali);
  if (!match) return null;
  const start = match.index;
  const endMarker = smali.indexOf('\n.end method', start);
  if (endMarker < 0) throw new Error(`Unterminated smali method ${nameAndDescriptor}`);
  const end = endMarker + '\n.end method'.length;
  return { start, end, declaration: match[0], body: smali.slice(start + match[0].length, endMarker) };
}

export function replaceMethodBody(smali, nameAndDescriptor, body) {
  const method = findMethod(smali, nameAndDescriptor);
  if (!method) throw new Error(`Missing AppActivity method ${nameAndDescriptor}`);
  return smali.slice(0, method.start) + method.declaration + '\n' + body + '\n.end method' + smali.slice(method.end);
}

export function upsertMethod(smali, nameAndDescriptor, declaration, body) {
  if (findMethod(smali, nameAndDescriptor)) return replaceMethodBody(smali, nameAndDescriptor, body);
  return smali.replace(/\n*$/, '\n\n') + declaration + '\n' + body + '\n.end method\n';
}

// Inserts lines right after the .locals/.registers directive of a method.
export function insertAtMethodStart(smali, nameAndDescriptor, lines) {
  const method = findMethod(smali, nameAndDescriptor);
  if (!method) throw new Error(`Missing method ${nameAndDescriptor}`);
  const directive = /^[ \t]*\.(locals|registers)[ \t]+\d+[ \t]*$/m.exec(method.body);
  if (!directive) throw new Error(`${nameAndDescriptor} has no .locals/.registers directive`);
  const insertAt = method.start + method.declaration.length + directive.index + directive[0].length;
  return smali.slice(0, insertAt) + '\n' + lines + smali.slice(insertAt);
}

const MEDIA_ACTIVITY_RESULT = 'invoke-static/range {p0 .. p3}, Lnet/doushisi/standalone/StandaloneMedia;->onActivityResult(Landroid/app/Activity;IILandroid/content/Intent;)V';
const LOCATION_STOP = 'invoke-static {p0}, Lnet/doushisi/standalone/StandaloneLocation;->stop(Landroid/content/Context;)V';

export function patchAppActivity(source) {
  let activity = source.replace(/\r\n/g, '\n');
  const superMatch = /^\.super (L[^;\s]+;)/m.exec(activity);
  if (!superMatch) throw new Error('AppActivity has no .super line');
  const superClass = superMatch[1];

  activity = replaceMethodBody(activity, 'onCreate(Landroid/os/Bundle;)V', `    .locals 1
    invoke-super {p0, p1}, ${superClass}->onCreate(Landroid/os/Bundle;)V
    sput-object p0, Lorg/cocos2dx/javascript/AppActivity;->that:Lorg/cocos2dx/javascript/AppActivity;
    invoke-static {}, Lorg/cocos2dx/javascript/SDKWrapper;->getInstance()Lorg/cocos2dx/javascript/SDKWrapper;
    move-result-object v0
    invoke-virtual {v0, p0}, Lorg/cocos2dx/javascript/SDKWrapper;->init(Landroid/content/Context;)V
    return-void`);
  for (const method of [
    'wx_login()V',
    'initLocationOption()V',
    'postException(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V',
    'aliPay(Ljava/lang/String;)V',
    'wxPay(Ljava/lang/String;)V',
    'playAd()V',
    'loadAd(Ljava/lang/String;)V',
    'shareFriend(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V',
    'shareFriendText(Ljava/lang/String;)V',
    'sharePYQ(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V',
    'shareScreenshot(Ljava/lang/String;II)V',
  ]) activity = replaceMethodBody(activity, method, '    .locals 0\n    return-void');
  activity = replaceMethodBody(activity, 'isShowAd()I', '    .locals 1\n    const/4 v0, 0x0\n    return v0');

  // Media permission results first; everything else keeps the location behaviour.
  activity = upsertMethod(activity, 'onRequestPermissionsResult(I[Ljava/lang/String;[I)V',
    '.method public onRequestPermissionsResult(I[Ljava/lang/String;[I)V', `    .locals 1
    invoke-super {p0, p1, p2, p3}, ${superClass}->onRequestPermissionsResult(I[Ljava/lang/String;[I)V
    invoke-static {p0, p1, p2, p3}, Lnet/doushisi/standalone/StandaloneMedia;->onRequestPermissionsResult(Landroid/app/Activity;I[Ljava/lang/String;[I)Z
    move-result v0
    if-nez v0, :media_handled
    invoke-static {p0}, Lnet/doushisi/standalone/StandaloneLocation;->start(Landroid/content/Context;)V
    :media_handled
    return-void`);

  activity = replaceMethodBody(activity, 'requestLocation()V', `    .locals 4
    sget-object v0, Lorg/cocos2dx/javascript/AppActivity;->that:Lorg/cocos2dx/javascript/AppActivity;
    if-eqz v0, :done
    const-string v1, "android.permission.ACCESS_COARSE_LOCATION"
    invoke-virtual {v0, v1}, Landroid/content/Context;->checkSelfPermission(Ljava/lang/String;)I
    move-result v2
    if-eqz v2, :start
    const-string v2, "android.permission.ACCESS_FINE_LOCATION"
    filled-new-array {v1, v2}, [Ljava/lang/String;
    move-result-object v1
    const/4 v3, 0x1
    invoke-static {v0, v1, v3}, Landroid/support/v4/app/ActivityCompat;->requestPermissions(Landroid/app/Activity;[Ljava/lang/String;I)V
    return-void
    :start
    invoke-static {v0}, Lnet/doushisi/standalone/StandaloneLocation;->start(Landroid/content/Context;)V
    :done
    return-void`);

  for (const axis of ['Latitude', 'Longitude']) {
    activity = replaceMethodBody(activity, `get${axis}()Ljava/lang/String;`, `    .locals 4
    :try_start_0
    sget-object v0, Lorg/cocos2dx/javascript/AppActivity;->that:Lorg/cocos2dx/javascript/AppActivity;
    invoke-static {v0}, Lnet/doushisi/standalone/StandaloneLocation;->getLatest(Landroid/content/Context;)Landroid/location/Location;
    move-result-object v1
    if-eqz v1, :no_location
    invoke-virtual {v1}, Landroid/location/Location;->get${axis}()D
    move-result-wide v2
    invoke-static {v2, v3}, Ljava/lang/Double;->toString(D)Ljava/lang/String;
    move-result-object v0
    return-object v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :location_error
    :location_error
    move-exception v0
    :no_location
    const-string v0, "0.0"
    return-object v0`);
  }

  // onDestroy: stop location updates before the super call (once).
  const destroy = findMethod(activity, 'onDestroy()V');
  if (!destroy) throw new Error('Missing AppActivity method onDestroy()V');
  if (!destroy.body.includes('StandaloneLocation;->stop(')) {
    const superCall = new RegExp('^([ \\t]*)invoke-super \\{p0\\}, ' + escapeRegExp(superClass) + '->onDestroy\\(\\)V', 'm');
    const bodyStart = destroy.start + destroy.declaration.length;
    const body = destroy.body;
    const call = superCall.exec(body);
    if (!call) throw new Error('AppActivity.onDestroy has no invoke-super onDestroy call');
    const patchedBody = body.slice(0, call.index) + call[1] + LOCATION_STOP + '\n' + body.slice(call.index);
    activity = activity.slice(0, bodyStart) + patchedBody + activity.slice(bodyStart + body.length);
  }

  // onActivityResult: forward to StandaloneMedia first (once); add the override when missing.
  const result = findMethod(activity, 'onActivityResult(IILandroid/content/Intent;)V');
  if (!result) {
    activity = activity.replace(/\n*$/, '\n\n') + `.method protected onActivityResult(IILandroid/content/Intent;)V
    .locals 0
    ${MEDIA_ACTIVITY_RESULT}
    invoke-super {p0, p1, p2, p3}, ${superClass}->onActivityResult(IILandroid/content/Intent;)V
    return-void
.end method
`;
  } else if (!result.body.includes('StandaloneMedia;->onActivityResult(')) {
    activity = insertAtMethodStart(activity, 'onActivityResult(IILandroid/content/Intent;)V', '    ' + MEDIA_ACTIVITY_RESULT);
  }
  return activity;
}

// ---------- manifest helpers (apktool text manifest) ----------

export function providerElement(providerClass) {
  return `    <provider android:authorities="${MEDIA_AUTHORITY}" android:exported="false" android:grantUriPermissions="true" android:name="${providerClass}">
      <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/${MEDIA_PATHS_RESOURCE}" />
    </provider>
`;
}

const ACCEPTANCE_RECEIVER = `    <receiver android:exported="true" android:name="net.doushisi.standalone.AcceptanceReceiver">
      <intent-filter>
        <action android:name="net.doushisi.standalone.ACCEPTANCE" />
      </intent-filter>
    </receiver>
`;

function removeElements(xml, tag, predicate) {
  const pattern = new RegExp(`[ \\t]*<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)[ \\t]*\\n?`, 'g');
  return xml.replace(pattern, element => (predicate(element) ? '' : element));
}

export function patchManifest(source, { providerClass, acceptance }) {
  let xml = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!/<application\b/.test(xml) || !xml.includes('</application>')) throw new Error('AndroidManifest.xml has no <application> element');
  if (!xml.includes('android:name="org.cocos2dx.javascript.AppActivity"')) throw new Error('AndroidManifest.xml does not declare org.cocos2dx.javascript.AppActivity');
  xml = removeElements(xml, 'provider', element => element.includes(MEDIA_AUTHORITY));
  xml = removeElements(xml, 'receiver', element => element.includes('net.doushisi.standalone.AcceptanceReceiver'));
  const insert = providerElement(providerClass) + (acceptance ? ACCEPTANCE_RECEIVER : '');
  xml = xml.replace(/([ \t]*)<\/application>/, (match, indent) => insert + indent + '</application>');
  return xml;
}

function assertInside(root, path) {
  const relation = relative(resolve(root), resolve(path));
  if (!relation || relation.startsWith('..') || relation.includes(`..${sep}`) || resolve(path) === resolve(root)) {
    throw new Error(`Refusing to modify outside the decoded APK: ${path}`);
  }
}

// ---------- main patch ----------

export async function patchDecodedApk(target, { apiBase, wsUrl, acceptance = false, project = PROJECT_ROOT, writePublicAdapter = true, log = console.log } = {}) {
  const decoded = resolve(target);
  for (const required of ['AndroidManifest.xml', 'apktool.yml', 'assets']) {
    if (!existsSync(join(decoded, required))) throw new Error(`${decoded} is not an apktool-decoded APK (missing ${required})`);
  }
  const config = buildConfig(apiBase, wsUrl);
  const assets = join(decoded, 'assets');

  // 1. Plain scripts and Cocos bundles.
  for (const file of ['standalone-replay.js', 'decimal.js', 'edition-config.js']) {
    await cp(join(project, 'client/public', file), join(assets, file));
  }
  for (const bundle of ['main', 'hall', 'resources', 'internal', 'dss']) {
    const destination = join(assets, 'assets', bundle);
    assertInside(decoded, destination);
    await rm(destination, { recursive: true, force: true });
    await cp(join(project, 'client/public/assets', bundle), destination, { recursive: true });
  }
  for (const bundle of ['mj', 'bzp']) {
    const removed = join(assets, 'assets', bundle);
    assertInside(decoded, removed);
    await rm(removed, { recursive: true, force: true });
  }
  const mainBundle = join(assets, 'assets/main/index.js');
  let compiled = await readFile(mainBundle, 'utf8');
  if (!compiled.includes(PATCHED_UPDATE)) {
    if (!compiled.includes(ORIGINAL_UPDATE)) throw new Error('Unexpected update controller in assets/main/index.js');
    compiled = compiled.replace(ORIGINAL_UPDATE, PATCHED_UPDATE);
    await writeFile(mainBundle, compiled);
  }

  // 2. Adapter: identical bytes in the APK and in client/public/native (hot update source).
  const adapter = syncNativeAdapter(project, { write: writePublicAdapter });
  for (const value of [config.apiBase, config.wsUrl]) {
    if (adapter.content.includes(value)) throw new Error(`standalone-native.js must not contain ${value}`);
  }
  await writeFile(join(assets, 'standalone-native.js'), adapter.content);

  // 3. Boot script with build config and bundled adapter descriptor.
  let acceptanceScript = '';
  const acceptanceAsset = join(assets, 'standalone-acceptance.js');
  if (acceptance) {
    acceptanceScript = await readFile(join(project, 'tools/acceptance-client-adapter.js'), 'utf8');
    await writeFile(acceptanceAsset, acceptanceScript);
  } else {
    await rm(acceptanceAsset, { force: true });
  }
  const template = await readFile(join(project, 'assets/main.js'), 'utf8');
  await writeFile(join(assets, 'main.js'), renderBootScript(template, { config, bundled: adapter, acceptanceScript }));

  // 4. Smali.
  const activityClass = findSmaliClass(decoded, 'org/cocos2dx/javascript/AppActivity');
  if (!activityClass) throw new Error('AppActivity.smali not found in any smali directory');
  await writeFile(activityClass.path, patchAppActivity(await readFile(activityClass.path, 'utf8')));
  let providerDescriptor = null;
  if (findSmaliClass(decoded, SUPPORT_FILE_PROVIDER)) providerDescriptor = SUPPORT_FILE_PROVIDER;
  else if (findSmaliClass(decoded, ANDROIDX_FILE_PROVIDER)) providerDescriptor = ANDROIDX_FILE_PROVIDER;
  else throw new Error('No FileProvider class (support v4 or androidx) in the decoded APK; camera capture cannot be wired.');
  const nativeDir = join(activityClass.root, 'net/doushisi/standalone');
  await mkdir(nativeDir, { recursive: true });
  for (const root of smaliRoots(decoded)) {
    for (const name of ['StandaloneLocation', 'StandaloneMedia', 'StandaloneMediaTask', 'AcceptanceReceiver']) {
      const stale = join(root, 'net/doushisi/standalone', name + '.smali');
      if (root !== activityClass.root && existsSync(stale)) { assertInside(decoded, stale); await rm(stale, { force: true }); }
    }
  }
  await cp(join(project, 'client/android/native/StandaloneLocation.smali'), join(nativeDir, 'StandaloneLocation.smali'));
  await cp(join(project, 'client/android/native/StandaloneMediaTask.smali'), join(nativeDir, 'StandaloneMediaTask.smali'));
  let media = await readFile(join(project, 'client/android/native/StandaloneMedia.smali'), 'utf8');
  if (!media.includes(`"${MEDIA_AUTHORITY}"`)) throw new Error('StandaloneMedia.smali authority does not match the manifest provider');
  if (providerDescriptor !== SUPPORT_FILE_PROVIDER) media = media.split(`L${SUPPORT_FILE_PROVIDER};`).join(`L${providerDescriptor};`);
  await writeFile(join(nativeDir, 'StandaloneMedia.smali'), media);
  const receiverSmali = join(nativeDir, 'AcceptanceReceiver.smali');
  if (acceptance) await cp(join(project, 'client/android/native/AcceptanceReceiver.smali'), receiverSmali);
  else await rm(receiverSmali, { force: true });

  // 5. Resources and manifest.
  await mkdir(join(decoded, 'res/xml'), { recursive: true });
  await cp(join(project, 'client/android/res/xml', MEDIA_PATHS_RESOURCE + '.xml'), join(decoded, 'res/xml', MEDIA_PATHS_RESOURCE + '.xml'));
  const manifestPath = join(decoded, 'AndroidManifest.xml');
  const providerClass = providerDescriptor.replace(/\//g, '.');
  await writeFile(manifestPath, patchManifest(await readFile(manifestPath, 'utf8'), { providerClass, acceptance }));

  // 6. Misc outputs kept for existing tools (local-evidence.mjs reads native-config.json).
  await writeFile(join(assets, 'project.json'), JSON.stringify({ serviceClassPath: [] }, null, 2));
  await mkdir(join(project, 'client/android'), { recursive: true });
  await writeFile(join(project, 'client/android/native-config.json'), JSON.stringify(config, null, 2));

  log(`Patched ${decoded}`);
  log(`  config        ${JSON.stringify(config)}`);
  log(`  adapter       v${adapter.version} sha256 ${adapter.sha256}${adapter.changed ? ' (client/public/native updated)' : ''}`);
  log(`  smali root    ${relative(decoded, activityClass.root)}; FileProvider ${providerClass}`);
  log(`  acceptance    ${acceptance ? 'included' : 'stripped'}`);
  return { config, adapter: { version: adapter.version, sha256: adapter.sha256, bytes: adapter.bytes }, smaliRoot: activityClass.root, providerClass };
}

function parseArguments(argv) {
  const positional = [];
  const options = { acceptance: false, wsUrl: undefined };
  for (const argument of argv) {
    if (argument === '--acceptance') options.acceptance = true;
    else if (argument.startsWith('--ws-url=')) options.wsUrl = argument.slice('--ws-url='.length);
    else if (argument.startsWith('--')) throw new Error(`Unknown option ${argument}`);
    else positional.push(argument);
  }
  if (positional.length < 1 || positional.length > 2) {
    throw new Error('Usage: node tools/client-native-patch.mjs <decodedDir> <apiBase> [--ws-url=<ws(s)://...>] [--acceptance]');
  }
  return { target: positional[0], apiBase: positional[1] || 'http://127.0.0.1:3000', ...options };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const { target, ...options } = parseArguments(process.argv.slice(2));
    await patchDecodedApk(target, options);
    console.log('Native resources, JSB startup, media picker and original SDK initialization patched.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
