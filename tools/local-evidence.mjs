import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const adb = process.env.ADB || 'D:/leidian/LDPlayer14/adb.exe';
const device = 'emulator-5554';
const config = JSON.parse(await readFile(join(root, 'client/android/native-config.json'), 'utf8'));
const status = await (await fetch(config.apiBase + '/health')).json();
const installed = execFileSync(adb, ['-s', device, 'shell', 'pm', 'path', 'net.doushisi.standalone'], { encoding: 'utf8', windowsHide: true }).trim().slice(8);
if (!/^\/data\/app\/[A-Za-z0-9._/~+=-]+\/base\.apk$/.test(installed)) throw new Error('Unexpected APK location.');
const installedHash = execFileSync(adb, ['-s', device, 'shell', 'sha256sum', installed], { encoding: 'utf8', windowsHide: true }).split(' ')[0];
const apkHash = hash(await readFile(join(root, 'client/android/doushisi.apk')));
const reverse = execFileSync(adb, ['-s', device, 'reverse', '--list'], { encoding: 'utf8', windowsHide: true }).trim();
const report = { schemaVersion: 1, at: new Date().toISOString(), scope: 'LAN startup and input smoke evidence only, not completed-game acceptance',
  apiBase: config.apiBase, health: status, device, physical: false, adbReverse: reverse,
  apkSha256: apkHash, installedApkSha256: installedHash,
  sourceAdapterSha256: hash(await readFile(join(root, 'client/public/standalone.js'))),
  connectedWithoutReverse: !reverse.includes('tcp:3000') && apkHash === installedHash && status.status === 'ok',
  evidence: [] };
for (const relative of ['client/validation/local-native-input-verified.png', 'client/validation/local-native-direct.png',
  'client/validation/manual-room-options-report.json', 'client/validation/room-report.json']) {
  const bytes = await readFile(join(root, relative));
  report.evidence.push({ path: relative, sha256: hash(bytes) });
}
await mkdir(join(root, 'verification'), { recursive: true });
await writeFile(join(root, 'verification/local-development-evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ connectedWithoutReverse: report.connectedWithoutReverse, apkHash, engineCount: status.ruleEnginesVerified }));
