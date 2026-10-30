import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2]);
const apiBase = process.argv[3] || 'http://127.0.0.1:3000';
const acceptance = process.argv.includes('--acceptance');
const api = new URL(apiBase);
if (!['http:', 'https:'].includes(api.protocol)) throw new Error('Invalid API URL');
const config = { apiBase, wsUrl: apiBase.replace(/^http/, 'ws') + '/ws/original', protocolVersion: 2, storageNamespace: 'doushisi-standalone-v1:' };
const assets = join(target, 'assets');
await cp(join(project, 'client/public/standalone-replay.js'), join(assets, 'standalone-replay.js'));
await cp(join(project, 'client/public/decimal.js'), join(assets, 'decimal.js'));
await cp(join(project, 'client/public/edition-config.js'), join(assets, 'edition-config.js'));
for (const bundle of ['main', 'hall', 'resources', 'internal', 'dss']) await cp(join(project, 'client/public/assets', bundle), join(assets, 'assets', bundle), { recursive: true });
for (const bundle of ['mj', 'bzp']) {
  const removed = resolve(assets, 'assets', bundle);
  if (!removed.startsWith(resolve(target) + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) throw new Error('Removal outside decoded APK');
  await rm(removed, { recursive: true, force: true });
}
let compiled = await readFile(join(assets, 'assets/main/index.js'), 'utf8');
const originalUpdate = 'if (cc.sys.isBrowser) this.schedule(this.progressUpdate.bind(this), .02); else {';
if (!compiled.includes(originalUpdate)) throw new Error('Unexpected update controller');
compiled = compiled.replace(originalUpdate, 'if (window.Standalone) this.schedule(this.progressUpdate.bind(this), .02); else {');
await writeFile(join(assets, 'assets/main/index.js'), compiled);
const browserAdapter = await readFile(join(project, 'client/public/standalone.js'), 'utf8');
if (!browserAdapter.includes('var config = window.STANDALONE_CONFIG;')) throw new Error('Unexpected standalone adapter');
const nativeAdapter = browserAdapter.replace('var config = window.STANDALONE_CONFIG;', 'var config = ' + JSON.stringify(config) + ';');
await writeFile(join(assets, 'standalone-native.js'), nativeAdapter);
let boot = await readFile(join(project, 'client/public/main.js'), 'utf8');
boot = boot.replace('    window.boot();', "    require('decimal.js');\n    require('edition-config.js');\n    require('standalone-native.js');\n    require('standalone-replay.js');\n    window.Standalone.isolateStorage();\n    window.boot();");
if (acceptance) {
  const acceptanceAdapter = await readFile(join(project, 'tools/acceptance-client-adapter.js'), 'utf8');
  await writeFile(join(assets, 'standalone-acceptance.js'), acceptanceAdapter);
  boot = boot.replace("    window.Standalone.isolateStorage();\n    window.boot();",
    '    window.Standalone.isolateStorage();\n    ' + acceptanceAdapter.replace(/\r?\n/g, '\n    ') + '\n    window.boot();');
}
await writeFile(join(assets, 'main.js'), boot);
const activityPath = join(target, 'smali/org/cocos2dx/javascript/AppActivity.smali');
let activity = (await readFile(activityPath, 'utf8')).replace(/\r\n/g, '\n');
function replaceMethod(signature, body) {
  const start = activity.indexOf('.method ' + signature);
  if (start < 0) throw new Error('Missing activity method ' + signature);
  const end = activity.indexOf('.end method', start) + '.end method'.length;
  activity = activity.slice(0, start) + '.method ' + signature + '\n' + body + '\n.end method' + activity.slice(end);
}
replaceMethod('protected onCreate(Landroid/os/Bundle;)V', `    .locals 1
    invoke-super {p0, p1}, Lorg/cocos2dx/lib/Cocos2dxActivity;->onCreate(Landroid/os/Bundle;)V
    sput-object p0, Lorg/cocos2dx/javascript/AppActivity;->that:Lorg/cocos2dx/javascript/AppActivity;
    invoke-static {}, Lorg/cocos2dx/javascript/SDKWrapper;->getInstance()Lorg/cocos2dx/javascript/SDKWrapper;
    move-result-object v0
    invoke-virtual {v0, p0}, Lorg/cocos2dx/javascript/SDKWrapper;->init(Landroid/content/Context;)V
    return-void`);
for (const method of ['wx_login()V', 'initLocationOption()V']) {
  const declaration = method.startsWith('wx_') ? 'public static ' : 'private ';
  replaceMethod(declaration + method, '    .locals 0\n    return-void');
}
for (const signature of [
  'public static postException(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V',
  'public static aliPay(Ljava/lang/String;)V',
  'public static wxPay(Ljava/lang/String;)V',
  'public static playAd()V',
  'public loadAd(Ljava/lang/String;)V',
  'public static shareFriend(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V',
  'public static shareFriendText(Ljava/lang/String;)V',
  'public static sharePYQ(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V',
  'public static shareScreenshot(Ljava/lang/String;II)V'
]) replaceMethod(signature, '    .locals 0\n    return-void');
replaceMethod('public static isShowAd()I', '    .locals 1\n    const/4 v0, 0x0\n    return v0');
replaceMethod('public onRequestPermissionsResult(I[Ljava/lang/String;[I)V', `    .locals 0
    invoke-super {p0, p1, p2, p3}, Lorg/cocos2dx/lib/Cocos2dxActivity;->onRequestPermissionsResult(I[Ljava/lang/String;[I)V
    invoke-static {p0}, Lnet/doushisi/standalone/StandaloneLocation;->start(Landroid/content/Context;)V
    return-void`);
replaceMethod('public static requestLocation()V', `    .locals 4
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
activity = activity.replace('invoke-super {p0}, Lorg/cocos2dx/lib/Cocos2dxActivity;->onDestroy()V', 'invoke-static {p0}, Lnet/doushisi/standalone/StandaloneLocation;->stop(Landroid/content/Context;)V\n    invoke-super {p0}, Lorg/cocos2dx/lib/Cocos2dxActivity;->onDestroy()V');
for (const axis of ['Latitude', 'Longitude']) {
  replaceMethod('public static get' + axis + '()Ljava/lang/String;', `    .locals 4
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
await writeFile(activityPath, activity);
await mkdir(join(target, 'smali/net/doushisi/standalone'), { recursive: true });
await cp(join(project, 'client/android/native/StandaloneLocation.smali'), join(target, 'smali/net/doushisi/standalone/StandaloneLocation.smali'));
if (acceptance) {
  await cp(join(project, 'client/android/native/AcceptanceReceiver.smali'),
    join(target, 'smali/net/doushisi/standalone/AcceptanceReceiver.smali'));
}
await writeFile(join(assets, 'project.json'), JSON.stringify({ serviceClassPath: [] }, null, 2));
await mkdir(join(project, 'client/android'), { recursive: true });
await writeFile(join(project, 'client/android/native-config.json'), JSON.stringify(config, null, 2));
console.log('Native resources, JSB startup and original SDK initialization patched.');
