import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(project, '../..');
const decoded = resolve(process.argv[2] || join(workspace, 'work/client-native-build'));
const originalAssets = resolve(process.argv[3] || join(workspace, 'work/apk/assets/assets'));
const report = { checkedAt: new Date().toISOString(), decoded, originalAssets, passed: false, gps: {}, voice: {}, warnings: [], failures: [] };
const check = (condition, message) => { if (!condition) report.failures.push(message); };
const text = async path => { try { return await readFile(path, 'utf8'); } catch { return ''; } };
async function files(directory) {
  const result = [];
  if (!existsSync(directory)) return result;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}

const locationSmali = await text(join(project, 'client/android/native/StandaloneLocation.smali'));
const activitySmali = await text(join(decoded, 'smali/org/cocos2dx/javascript/AppActivity.smali'));
const manifest = await text(join(decoded, 'AndroidManifest.xml'));
report.gps = {
  adapterPath: 'client/android/native/StandaloneLocation.smali',
  usesLocationManager: /Landroid\/location\/LocationManager;/.test(locationSmali),
  requestsGps: /const-string v0, "gps"\s+invoke-static[^\n]+->startProvider/.test(locationSmali),
  requestsNetwork: /const-string v0, "network"\s+invoke-static[^\n]+->startProvider/.test(locationSmali),
  isolatedProviderErrors: /\.method private static startProvider[\s\S]*?\.catch Ljava\/lang\/Exception;/.test(locationSmali),
  receivesLocationChanged: /onLocationChanged\(Landroid\/location\/Location;\)V/.test(locationSmali),
  removesUpdates: /removeUpdates\(Landroid\/location\/LocationListener;\)V/.test(locationSmali),
  activityReadsSystemLocation: (activitySmali.match(/StandaloneLocation;->getLatest/g) || []).length === 2,
  isolatedLastKnownErrors: /\.method private static lastKnown[\s\S]*?isProviderEnabled[\s\S]*?getLastKnownLocation[\s\S]*?\.catch Ljava\/lang\/Exception;/.test(locationSmali),
  noPrivateCoordinateCache: !locationSmali.includes('latest:Landroid/location/Location;'),
  requestsBothPermissions: /const-string v1, "android.permission.ACCESS_COARSE_LOCATION"[\s\S]*?const-string v2, "android.permission.ACCESS_FINE_LOCATION"[\s\S]*?filled-new-array \{v1, v2\}/.test(activitySmali),
  packagedBridgeMatchesSource: locationSmali === await text(join(decoded, 'smali/net/doushisi/standalone/StandaloneLocation.smali')),
  permissionFine: manifest.includes('android.permission.ACCESS_FINE_LOCATION'),
  permissionCoarse: manifest.includes('android.permission.ACCESS_COARSE_LOCATION'),
};
for (const [key, value] of Object.entries(report.gps)) if (key !== 'adapterPath') check(value, `GPS check failed: ${key}`);
check(!/Baidu|百度|ak=|api\.map\.baidu/.test(activitySmali + manifest), 'Native activity still contains a Baidu location dependency or key.');

const dssSource = await text(join(originalAssets, 'dss/index.js'));
const dssConfig = JSON.parse(await readFile(join(originalAssets, 'dss/config.json'), 'utf8'));
const soundPaths = Object.values(dssConfig.paths).map(value => value[0]).filter(path => path.startsWith('res/sound/'));
const dssFiles = await files(join(originalAssets, 'dss/native'));
const dssNativeFiles = new Set(dssFiles.map(path => path.replaceAll('\\\\', '/')));
const dssImportFiles = await files(join(originalAssets, 'dss/import'));
const dssImportText = await Promise.all(dssImportFiles.filter(path => path.endsWith('.json')).map(async path => ({ path, source: await text(path) })));
const localSoundNames = ['dss_sounds_start', 'dss_sounds_fapai', 'dss_sounds_dapai', 'dss_sounds_fanpai', 'dss_sounds_win', 'dss_sounds_bigwin', 'dss_sounds_lost', 'dss_sounds_hz'];
const chatVoiceNames = soundPaths.filter(path => /res\/sound\/chat(?:man|woman)\/gameChat_\d+$/.test(path));
report.voice = {
  dssSourcePath: 'work/apk/assets/assets/dss/index.js',
  localSoundCalls: (dssSource.match(/cc\.mm\.soundManager\.playSound\(cc\.mm\.config\.(?:dss|resources),/g) || []).length,
  localDssSoundPathCalls: (dssSource.match(/"res\/sound\//g) || []).length,
  protocolQuickVoiceEnum: /EN_CHAT_TYPE_QUICK_VOICE/.test(await text(join(originalAssets, 'main/index.js'))),
  protocolQuickVoiceField: /quickVoiceId/.test(await text(join(originalAssets, 'main/index.js'))),
  chatVoiceAssetCount: chatVoiceNames.length,
  chatVoiceAssetNames: chatVoiceNames.slice(0, 32),
  nativeSoundFileCount: dssFiles.filter(path => /\.(?:mp3|ogg|wav)$/i.test(path)).length,
  bundledLocalSounds: Object.fromEntries(localSoundNames.map(name => {
    const matches = dssImportText.filter(({ source }) => source.includes(`\"${name}\"`));
    const nativeAsset = matches.some(({ path }) => {
      const uuid = path.split(/[\\\\/]/).at(-1).replace(/\.json$/, '');
      const nativePath = join(originalAssets, 'dss/native', uuid.slice(0, 2), `${uuid}.mp3`).replaceAll('\\\\', '/');
      return dssNativeFiles.has(nativePath);
    });
    return [name, nativeAsset];
  })),
  remoteVoiceUrls: (dssSource.match(/https?:\/\/[^"'\s]+/g) || []).length,
};
check(report.voice.localSoundCalls > 0, 'No local Cocos sound playback calls found in dss bundle.');
check(report.voice.localDssSoundPathCalls > 0, 'No local dss res/sound playback paths found.');
check(report.voice.protocolQuickVoiceEnum && report.voice.protocolQuickVoiceField, 'Original quickVoiceId protobuf fields were not retained.');
check(report.voice.chatVoiceAssetCount >= 20, 'Expected original chat voice asset set is incomplete.');
check(report.voice.nativeSoundFileCount > 100, 'Original dss native sound resources are missing.');
for (const [name, present] of Object.entries(report.voice.bundledLocalSounds)) check(present, `Original local sound missing: ${name}`);
check(report.voice.remoteVoiceUrls === 0, 'dss bundle contains a remote voice URL.');

report.passed = report.failures.length === 0;
report.warnings.push('Static checks cannot prove location permissions were granted, a GPS fix was obtained, or audio was audible on a physical device.');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
