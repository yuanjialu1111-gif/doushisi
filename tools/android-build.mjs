#!/usr/bin/env node
// One-command Android build on macOS:
//   decode base APK -> manifest template -> client-native-patch -> apktool build -> zipalign
//   -> apksigner sign (key in ~/.doushisi-signing) -> apksigner verify -> alignment/content checks
//
//   node tools/android-build.mjs --api-base https://game.example.com
//        [--base <apk>] [--ws-url wss://game.example.com/ws/original] [--out <dir>]
//        [--version-code N] [--version-name X] [--keystore <jks>] [--key-alias doushisi]
//        [--expect-cert <sha256>]
//
// Tools come from tools/android-tools-install.sh (~/.doushisi-android/toolchain.env) or from
// DOUSHISI_JAVA_HOME / DOUSHISI_APKTOOL_JAR / DOUSHISI_BUILD_TOOLS. The keystore password comes from
// DOUSHISI_KEYSTORE_PASSWORD (passed to apksigner by name only) or apksigner's own prompt.
// The base APK is only read; all intermediate files live in ~/.doushisi-android/work.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { MEDIA_AUTHORITY, normalizeApiBase, patchDecodedApk } from './client-native-patch.mjs';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const INSTALL_SCRIPT = join(PROJECT_ROOT, 'tools/android-tools-install.sh');
export const KEYGEN_SCRIPT = join(PROJECT_ROOT, 'tools/android-keygen.sh');
export const TOOL_HOME = resolve(process.env.DOUSHISI_ANDROID_HOME || join(homedir(), '.doushisi-android'));
export const SIGNING_HOME = resolve(process.env.DOUSHISI_SIGNING_HOME || join(homedir(), '.doushisi-signing'));
export const DEFAULT_KEYSTORE = join(SIGNING_HOME, 'doushisi-release.jks');
export const CERT_DIGEST_FILE = join(SIGNING_HOME, 'doushisi-release.cert-sha256');

class BuildError extends Error {}
const fail = message => { throw new BuildError(message); };
const isInside = (parent, child) => {
  const relation = relative(resolve(parent), resolve(child));
  return relation === '' || (!relation.startsWith('..') && !relation.startsWith(sep) && !/^[A-Za-z]:/.test(relation));
};

// ---------- arguments ----------

export function parseArguments(argv) {
  const options = { keyAlias: 'doushisi' };
  const names = {
    '--base': 'base', '--api-base': 'apiBase', '--ws-url': 'wsUrl', '--out': 'out',
    '--version-code': 'versionCode', '--version-name': 'versionName', '--keystore': 'keystore',
    '--key-alias': 'keyAlias', '--expect-cert': 'expectCert',
  };
  for (let index = 0; index < argv.length; index += 1) {
    let argument = argv[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    let value;
    const equals = argument.indexOf('=');
    if (argument.startsWith('--') && equals > 0) { value = argument.slice(equals + 1); argument = argument.slice(0, equals); }
    const key = names[argument];
    if (!key) fail(`未知参数 ${argument}（--help 查看用法）`);
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) fail(`${argument} 缺少取值`);
      index += 1;
    }
    options[key] = value;
  }
  if (options.versionCode !== undefined) {
    if (!/^\d+$/.test(options.versionCode) || Number(options.versionCode) < 1 || Number(options.versionCode) > 2100000000) fail('--version-code 必须是 1 到 2100000000 的整数');
    options.versionCode = Number(options.versionCode);
  }
  if (options.versionName !== undefined && !/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/.test(options.versionName)) fail('--version-name 只能用字母、数字和 . _ -');
  if (options.expectCert !== undefined) {
    options.expectCert = options.expectCert.replace(/:/g, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(options.expectCert)) fail('--expect-cert 必须是 64 位十六进制 SHA-256');
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(options.keyAlias)) fail('--key-alias 格式不对');
  return options;
}

const USAGE = `用法：
  node ${join(PROJECT_ROOT, 'tools/android-build.mjs')} --api-base https://<域名> \\
       [--base <基础 APK，默认 线上部署包/doushisi.apk>] [--ws-url wss://<域名>/ws/original] \\
       [--out <输出目录，默认 ~/.doushisi-android/out>] [--version-code N] [--version-name X] \\
       [--keystore <jks>] [--key-alias doushisi] [--expect-cert <证书 SHA-256>]
apiBase 也可用环境变量 DOUSHISI_API_BASE；签名密码用 DOUSHISI_KEYSTORE_PASSWORD，未设置时 apksigner 会当场询问。`;

// ---------- tools ----------

export function readToolchainEnv(path = join(TOOL_HOME, 'toolchain.env')) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function canRun(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return result.status === 0 ? `${result.stdout}${result.stderr}`.trim() : null;
}

export function discoverTools(environment = process.env) {
  const fromFile = readToolchainEnv();
  const pick = name => environment[name] || fromFile[name] || '';
  const javaHome = pick('DOUSHISI_JAVA_HOME');
  const apktoolJar = pick('DOUSHISI_APKTOOL_JAR');
  const buildTools = pick('DOUSHISI_BUILD_TOOLS');
  const missing = [];
  const java = javaHome ? join(javaHome, 'bin/java') : '';
  const javaVersion = java && existsSync(java) ? canRun(java, ['-version']) : null;
  if (!javaVersion) missing.push(`Java 运行时（DOUSHISI_JAVA_HOME=${javaHome || '未设置'}）`);
  if (!apktoolJar || !existsSync(apktoolJar)) missing.push(`apktool（DOUSHISI_APKTOOL_JAR=${apktoolJar || '未设置'}）`);
  const apksignerJar = buildTools ? join(buildTools, 'lib/apksigner.jar') : '';
  const zipalign = buildTools ? join(buildTools, 'zipalign') : '';
  if (!apksignerJar || !existsSync(apksignerJar)) missing.push(`build-tools 的 apksigner（DOUSHISI_BUILD_TOOLS=${buildTools || '未设置'}）`);
  if (missing.length) {
    fail(`缺少打包工具：\n  - ${missing.join('\n  - ')}\n请先运行安装脚本（只装到 ~/.doushisi-android，不用 sudo）：\n  bash ${INSTALL_SCRIPT}`);
  }
  return { javaHome, java, javaVersion: javaVersion.split('\n')[0], apktoolJar, apksignerJar, zipalign: existsSync(zipalign) ? zipalign : null, buildTools };
}

function run(label, command, args, { capture = false, env = process.env } = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { encoding: 'utf8', env, stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) fail(`${label} 无法启动：${result.error.message}`);
  if (capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0) fail(`${label} 失败（退出码 ${result.status}）`);
  return result;
}

// ---------- zip inspection (APK) ----------

export function readZipEntries(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) fail('APK 不是有效的 zip（找不到中央目录）');
  const count = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  if (pointer === 0xffffffff || count === 0xffff) fail('不支持 zip64 APK');
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) fail('APK 中央目录损坏');
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const size = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) fail(`APK 本地文件头损坏：${name}`);
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    entries.push({ name, method, compressedSize, size, localOffset, dataOffset });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(buffer, entry) {
  const raw = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  fail(`不支持的压缩方式 ${entry.method}：${entry.name}`);
}

// Android R+ (targetSdk >= 30) refuses resources.arsc that is compressed or not 4-byte aligned.
export function checkAlignment(entries) {
  const errors = [];
  const warnings = [];
  const arsc = entries.find(entry => entry.name === 'resources.arsc');
  if (!arsc) errors.push('缺少 resources.arsc');
  else if (arsc.method !== 0) errors.push('resources.arsc 被压缩了（targetSdk>=30 安装会失败）');
  for (const entry of entries) {
    if (entry.method !== 0) continue;
    if (entry.dataOffset % 4 !== 0) errors.push(`未 4 字节对齐：${entry.name} @${entry.dataOffset}`);
    if (entry.name.endsWith('.so') && entry.dataOffset % 4096 !== 0) warnings.push(`未压缩的 ${entry.name} 未按 4096 对齐（extractNativeLibs=true 时不影响安装）`);
  }
  return { errors, warnings };
}

// ---------- manifest / apktool.yml ----------

const attribute = (tag, name) => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
};

// Copies versionCode/versionName and <uses-sdk> from the decoded manifest into the template when
// apktool left them in the manifest (otherwise they live in apktool.yml).
export function manifestFromTemplate(template, decoded) {
  let xml = template.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const decodedRoot = /<manifest\b[^>]*>/.exec(decoded);
  const templateRoot = /<manifest\b[^>]*>/.exec(xml);
  if (!decodedRoot || !templateRoot) fail('AndroidManifest.xml 缺少 <manifest> 根元素');
  let root = templateRoot[0];
  for (const name of ['android:versionCode', 'android:versionName']) {
    const value = attribute(decodedRoot[0], name);
    if (value !== null && attribute(root, name) === null) root = root.replace(/\s*>$/, ` ${name}="${value}">`);
  }
  xml = xml.replace(templateRoot[0], () => root);
  const usesSdk = /^[ \t]*<uses-sdk\b[^>]*\/>[ \t]*$/m.exec(decoded);
  if (usesSdk && !/<uses-sdk\b/.test(xml)) xml = xml.replace(root, () => `${root}\n  ${usesSdk[0].trim()}`);
  return xml;
}

export function readVersion(apktoolYml, manifest) {
  const code = /^\s*versionCode:\s*'?(\d+)'?\s*$/m.exec(apktoolYml);
  const name = /^\s*versionName:\s*'?([^'\n]*?)'?\s*$/m.exec(apktoolYml);
  const manifestRoot = (/<manifest\b[^>]*>/.exec(manifest) || [''])[0];
  return {
    code: code ? Number(code[1]) : (attribute(manifestRoot, 'android:versionCode') !== null ? Number(attribute(manifestRoot, 'android:versionCode')) : null),
    name: name ? name[1] : attribute(manifestRoot, 'android:versionName'),
    inYml: Boolean(code),
  };
}

export function applyVersion(apktoolYml, manifest, { code, name }) {
  let yml = apktoolYml;
  let xml = manifest;
  // Apktool 3 reads versionCode as a bare integer and rejects '5' (NumberFormatException); versionName may stay quoted.
  if (/^\s*versionCode:/m.test(yml)) yml = yml.replace(/^(\s*versionCode:\s*).*$/m, `$1${code}`);
  if (name !== undefined && /^\s*versionName:/m.test(yml)) yml = yml.replace(/^(\s*versionName:\s*).*$/m, `$1'${name}'`);
  xml = xml.replace(/(<manifest\b[^>]*\sandroid:versionCode=")[^"]*(")/, `$1${code}$2`);
  if (name !== undefined) xml = xml.replace(/(<manifest\b[^>]*\sandroid:versionName=")[^"]*(")/, `$1${name}$2`);
  return { yml, xml };
}

function findFiles(directory, predicate, found = []) {
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) findFiles(path, predicate, found);
    else if (predicate(path)) found.push(path);
  }
  return found;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function stamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// ---------- build ----------

export async function build(options) {
  const warnings = [];
  const apiBase = normalizeApiBase(options.apiBase || process.env.DOUSHISI_API_BASE || fail('缺少 --api-base（例如 --api-base https://game.example.com）'));
  if (apiBase.startsWith('http://')) warnings.push(`apiBase 是明文 http：${apiBase}`);
  const defaultBase = join(PROJECT_ROOT, '线上部署包/doushisi.apk');
  const base = resolve(options.base || defaultBase);
  if (!existsSync(base) || !statSync(base).isFile()) fail(`找不到基础 APK：${base}`);
  const out = resolve(options.out || join(TOOL_HOME, 'out'));
  if (isInside(PROJECT_ROOT, out) && !isInside(join(PROJECT_ROOT, '.local'), out) && !isInside(join(PROJECT_ROOT, '线上部署包'), out)) {
    fail(`输出目录在源码目录里：${out}\n请用源码目录外的位置（默认 ~/.doushisi-android/out），或 .local/ 下的目录。`);
  }
  if (isInside(PROJECT_ROOT, TOOL_HOME)) fail(`DOUSHISI_ANDROID_HOME 不能在源码目录里：${TOOL_HOME}`);
  const tools = discoverTools();
  console.log(`Java     ${tools.javaVersion}`);
  console.log(`apktool  ${tools.apktoolJar}`);
  console.log(`build    ${tools.buildTools}`);
  const keystore = resolve(options.keystore || DEFAULT_KEYSTORE);
  if (isInside(PROJECT_ROOT, keystore)) fail(`签名钥匙不能放在源码目录里：${keystore}`);
  if (!existsSync(keystore)) fail(`找不到签名钥匙：${keystore}\n请先生成（只生成一次，生成后备份）：\n  bash ${KEYGEN_SCRIPT}`);
  let expectedCert = options.expectCert || null;
  if (!expectedCert && existsSync(CERT_DIGEST_FILE) && keystore === DEFAULT_KEYSTORE) {
    const stored = readFileSync(CERT_DIGEST_FILE, 'utf8').trim().replace(/:/g, '').toLowerCase();
    if (/^[0-9a-f]{64}$/.test(stored)) expectedCert = stored;
  }

  const javaEnv = { ...process.env, JAVA_HOME: tools.javaHome, PATH: `${join(tools.javaHome, 'bin')}:${process.env.PATH || ''}` };
  const frameworkDir = join(TOOL_HOME, 'framework');
  const work = join(TOOL_HOME, 'work');
  const decoded = join(work, 'decoded');
  const unsigned = join(work, 'unsigned.apk');
  const aligned = join(work, 'aligned.apk');
  const signed = join(work, 'signed.apk');
  mkdirSync(work, { recursive: true });
  mkdirSync(frameworkDir, { recursive: true });
  if (!isInside(TOOL_HOME, decoded) || basename(decoded) !== 'decoded') fail('内部错误：解包目录位置不对');
  rmSync(decoded, { recursive: true, force: true });
  for (const stale of [unsigned, aligned, signed, `${signed}.idsig`]) rmSync(stale, { force: true });
  const baseSha256 = sha256File(base);

  // 1. Decode (read-only on the base APK).
  run('apktool 解包', tools.java, ['-jar', tools.apktoolJar, 'd', '-f', '--frame-path', frameworkDir, '-o', decoded, base], { env: javaEnv });

  // 2. Validate the decoded tree before replacing its manifest.
  const decodedManifestPath = join(decoded, 'AndroidManifest.xml');
  const decodedManifest = readFileSync(decodedManifestPath, 'utf8');
  if (!decodedManifest.includes('org.cocos2dx.javascript.AppActivity')) fail('基础 APK 不是斗十四 Cocos 包（清单里没有 AppActivity）');
  if (!findFiles(join(decoded, 'res'), path => /[\\/]mipmap[^\\/]*[\\/]ic_launcher\.[a-z]+$/.test(path)).length) fail('基础 APK 缺少 @mipmap/ic_launcher（清单模板引用了它）');
  if (!findFiles(join(decoded, 'res'), path => /[\\/]values[\\/]strings\.xml$/.test(path)).some(path => readFileSync(path, 'utf8').includes('name="app_name"'))) fail('基础 APK 缺少 @string/app_name（清单模板引用了它）');
  const ymlPath = join(decoded, 'apktool.yml');
  const yml = readFileSync(ymlPath, 'utf8');
  const baseVersion = readVersion(yml, decodedManifest);

  // 3. Manifest template (root AndroidManifest.xml), then 4. the shared patcher.
  const template = readFileSync(join(PROJECT_ROOT, 'AndroidManifest.xml'), 'utf8');
  writeFileSync(decodedManifestPath, manifestFromTemplate(template, decodedManifest));
  const patch = await patchDecodedApk(decoded, { apiBase, wsUrl: options.wsUrl, acceptance: false });

  // 5. Version.
  let versionCode = options.versionCode;
  if (versionCode === undefined) {
    if (baseVersion.code === null) { warnings.push('读不到基础包 versionCode，保持原样'); }
    else versionCode = baseVersion.code + 1;
  }
  const versionName = options.versionName;
  if (versionCode !== undefined) {
    const patchedManifest = readFileSync(decodedManifestPath, 'utf8');
    const applied = applyVersion(readFileSync(ymlPath, 'utf8'), patchedManifest, { code: versionCode, name: versionName });
    writeFileSync(ymlPath, applied.yml);
    writeFileSync(decodedManifestPath, applied.xml);
    const check = readVersion(applied.yml, applied.xml);
    if (check.code !== versionCode) warnings.push(`versionCode 没写进 apktool.yml/清单（apktool.yml 格式不认识），仍是 ${check.code}`);
  }
  const finalVersion = readVersion(readFileSync(ymlPath, 'utf8'), readFileSync(decodedManifestPath, 'utf8'));

  // 6. Pre-build sanity checks on the decoded tree.
  const patchedManifest = readFileSync(decodedManifestPath, 'utf8');
  if (!patchedManifest.includes(`android:authorities="${MEDIA_AUTHORITY}"`)) fail('清单里没有拍照用的 FileProvider');
  if (patchedManifest.includes('AcceptanceReceiver')) fail('正式包清单里不应有 AcceptanceReceiver');
  if (!existsSync(join(decoded, 'res/xml/standalone_media_paths.xml'))) fail('缺少 res/xml/standalone_media_paths.xml');
  if (findFiles(decoded, path => path.endsWith(`${sep}AcceptanceReceiver.smali`)).length) fail('正式包里不应有 AcceptanceReceiver.smali');

  // 7. Build, 8. align, 9. sign, 10. verify.
  run('apktool 回包', tools.java, ['-jar', tools.apktoolJar, 'b', '--frame-path', frameworkDir, '-o', unsigned, decoded], { env: javaEnv });
  let alignedInput = unsigned;
  // zipalign is a native binary (may need Rosetta); a launch error means "unusable", usage exit codes do not.
  const zipalignUsable = Boolean(tools.zipalign) && !spawnSync(tools.zipalign, [], { stdio: 'ignore' }).error;
  if (zipalignUsable) {
    run('zipalign 对齐', tools.zipalign, ['-f', '-p', '4', unsigned, aligned]);
    alignedInput = aligned;
  } else {
    warnings.push('zipalign 不可用，改由 apksigner 对齐（签名后仍会检查对齐）');
  }
  const signArgs = ['-jar', tools.apksignerJar, 'sign', '--ks', keystore, '--ks-key-alias', options.keyAlias];
  if (process.env.DOUSHISI_KEYSTORE_PASSWORD) signArgs.push('--ks-pass', 'env:DOUSHISI_KEYSTORE_PASSWORD');
  else console.log('\n未设置 DOUSHISI_KEYSTORE_PASSWORD，apksigner 会询问签名密码（输入不显示）。');
  signArgs.push('--out', signed, alignedInput);
  run('apksigner 签名', tools.java, signArgs, { env: javaEnv });
  const verify = run('apksigner 校验', tools.java, ['-jar', tools.apksignerJar, 'verify', '--verbose', '--print-certs', signed], { capture: true, env: javaEnv });
  const verifyText = `${verify.stdout}\n${verify.stderr}`;
  const scheme = version => new RegExp(`Verified using v${version} scheme[^:]*:\\s*true`).test(verifyText);
  if (!scheme(2) && !scheme(3)) fail('apksigner 没有报告 v2/v3 签名通过');
  const certMatch = /Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F:]+)/.exec(verifyText);
  const certSha256 = certMatch ? certMatch[1].replace(/:/g, '').toLowerCase() : null;
  if (!certSha256) fail('apksigner 输出里没有证书 SHA-256');
  if (expectedCert && certSha256 !== expectedCert) fail(`签名证书不对：得到 ${certSha256}，应为 ${expectedCert}`);
  if (!expectedCert) warnings.push('没有可对照的证书指纹（~/.doushisi-signing/doushisi-release.cert-sha256 或 --expect-cert）');

  // 11. Alignment and content checks on the signed APK.
  const apk = readFileSync(signed);
  const entries = readZipEntries(apk);
  const alignment = checkAlignment(entries);
  warnings.push(...alignment.warnings);
  if (alignment.errors.length) fail(`APK 对齐检查失败：\n  ${alignment.errors.join('\n  ')}`);
  const entry = name => entries.find(item => item.name === name) || fail(`APK 里缺少 ${name}`);
  const mainJs = readZipEntry(apk, entry('assets/main.js')).toString('utf8');
  const nativeJs = readZipEntry(apk, entry('assets/standalone-native.js'));
  const nativeSha = createHash('sha256').update(nativeJs).digest('hex');
  if (nativeSha !== patch.adapter.sha256) fail('APK 里的 standalone-native.js 和生成的热更新脚本不一致');
  if (!mainJs.includes(`"apiBase":"${apiBase}"`)) fail('APK 的 main.js 没有写入 apiBase');
  if (!mainJs.includes(`"sha256":"${nativeSha}"`)) fail('APK 的 main.js 记录的内置脚本哈希不对');
  if (/@standalone-(build-config|bundled-adapter|acceptance)/.test(mainJs)) fail('APK 的 main.js 还有未替换的占位符');
  entry('res/xml/standalone_media_paths.xml');
  const dexes = entries.filter(item => /^classes\d*\.dex$/.test(item.name)).map(item => readZipEntry(apk, item).toString('latin1'));
  if (!dexes.some(dex => dex.includes('Lnet/doushisi/standalone/StandaloneMedia;'))) fail('dex 里没有 StandaloneMedia');
  if (!dexes.some(dex => dex.includes('Lnet/doushisi/standalone/StandaloneMediaTask;'))) fail('dex 里没有 StandaloneMediaTask');
  if (!dexes.some(dex => dex.includes('requestPermission'))) fail('dex 里没有 StandaloneLocation.requestPermission');
  if (dexes.some(dex => dex.includes('AcceptanceReceiver'))) fail('正式包 dex 里不应有 AcceptanceReceiver');
  const binaryManifest = readZipEntry(apk, entry('AndroidManifest.xml'));
  if (!binaryManifest.includes(Buffer.from(MEDIA_AUTHORITY, 'utf16le')) && !binaryManifest.includes(Buffer.from(MEDIA_AUTHORITY, 'utf8'))) fail('二进制清单里没有 FileProvider authority');

  // 12. Outputs.
  mkdirSync(out, { recursive: true });
  const label = `doushisi-v${finalVersion.name || 'x'}-${finalVersion.code ?? 'x'}-${stamp()}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const outputApk = join(out, `${label}.apk`);
  copyFileSync(signed, outputApk);
  let outputIdsig = null;
  if (existsSync(`${signed}.idsig`)) { outputIdsig = `${outputApk}.idsig`; copyFileSync(`${signed}.idsig`, outputIdsig); }
  const report = {
    builtAt: new Date().toISOString(),
    base: { path: base, sha256: baseSha256, versionCode: baseVersion.code, versionName: baseVersion.name },
    apk: { path: outputApk, sha256: sha256File(outputApk), bytes: statSync(outputApk).size, versionCode: finalVersion.code, versionName: finalVersion.name },
    idsig: outputIdsig,
    certificateSha256: certSha256,
    certificateChecked: Boolean(expectedCert),
    config: patch.config,
    adapter: patch.adapter,
    fileProvider: patch.providerClass,
    tools: { java: tools.javaVersion, apktool: basename(tools.apktoolJar), buildTools: basename(tools.buildTools), zipalign: Boolean(tools.zipalign) },
    signatureSchemes: { v2: scheme(2), v3: scheme(3), v4: scheme(4) },
    warnings,
  };
  writeFileSync(join(out, `${label}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n完成：${outputApk}`);
  console.log(`  版本      ${finalVersion.name} (${finalVersion.code})`);
  console.log(`  证书      ${certSha256}${expectedCert ? '（已对照）' : ''}`);
  console.log(`  apiBase   ${patch.config.apiBase}`);
  console.log(`  内置脚本  v${patch.adapter.version} ${patch.adapter.sha256}`);
  for (const warning of warnings) console.log(`  注意      ${warning}`);
  console.log('测试机需先卸载旧版（签名换了），再安装这个 APK。');
  return report;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(USAGE);
    else await build(options);
  } catch (error) {
    console.error(`\n打包失败：${error.message}`);
    if (!(error instanceof BuildError) && process.env.DOUSHISI_DEBUG) console.error(error.stack);
    process.exitCode = 1;
  }
}
