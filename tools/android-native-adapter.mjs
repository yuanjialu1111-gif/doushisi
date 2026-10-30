#!/usr/bin/env node
// Hot-update adapter generator for the Android client.
//
//   node tools/android-native-adapter.mjs           write client/public/native/{standalone-native.js,manifest.json}
//   node tools/android-native-adapter.mjs --check   exit 1 when those files are missing, stale or inconsistent
//
// The adapter is client/public/standalone.js byte for byte (minus a UTF-8 BOM). It reads
// window.STANDALONE_CONFIG, which assets/main.js fills at APK build time, so the same file is
// both the copy bundled into the APK and the copy the server hands out at /client/native/.
// manifest.json: { "version": <unix seconds, only bumped when sha256 changes>, "sha256": "<hex>",
//                  "path": "/client/native/standalone-native.js" }
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ADAPTER_SOURCE = 'client/public/standalone.js';
export const NATIVE_DIR = 'client/public/native';
export const ADAPTER_FILE = 'standalone-native.js';
export const MANIFEST_FILE = 'manifest.json';
export const NATIVE_ADAPTER_PATH = '/client/native/' + ADAPTER_FILE;
export const CONFIG_LINE = 'var config = window.STANDALONE_CONFIG;';
const SCRIPT_PATH = /^\/client\/native\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;

export function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

// Network addresses embedded in the adapter. Hosts under the reserved .invalid TLD are
// feature probes (new URL('https://standalone.invalid/')), not servers.
export function hardcodedAddresses(text) {
  const found = new Set();
  for (const match of text.matchAll(/\b(?:https?|wss?):\/\/([A-Za-z0-9.\-\[\]:]+)/g)) {
    const host = match[1].replace(/:\d+$/, '').toLowerCase();
    if (host === 'standalone.invalid' || host.endsWith('.invalid')) continue;
    found.add(match[0]);
  }
  return [...found];
}

export function nativeAdapterFrom(source) {
  const text = String(source).replace(/^\uFEFF/, '');
  if (!text.includes(CONFIG_LINE)) throw new Error(`${ADAPTER_SOURCE} no longer contains "${CONFIG_LINE}"; the native adapter would not read window.STANDALONE_CONFIG.`);
  const addresses = hardcodedAddresses(text);
  if (addresses.length) throw new Error(`${ADAPTER_SOURCE} hardcodes server addresses (${addresses.join(', ')}); use window.STANDALONE_CONFIG instead.`);
  return text;
}

export function readManifest(path) {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object') return null;
    return value;
  } catch {
    return null;
  }
}

export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object'];
  if (!Number.isSafeInteger(manifest.version) || manifest.version < 0) problems.push('version must be a non-negative integer');
  if (typeof manifest.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.sha256)) problems.push('sha256 must be 64 lowercase hex characters');
  if (typeof manifest.path !== 'string' || !SCRIPT_PATH.test(manifest.path)) problems.push('path must look like /client/native/<file>.js');
  return problems;
}

// Builds the adapter in memory. version is reused while sha256 is unchanged, otherwise it is the
// current unix time in seconds (and always above the previous version).
export function buildNativeAdapter(project = PROJECT_ROOT, { now = Date.now() } = {}) {
  const content = nativeAdapterFrom(readFileSync(join(project, ADAPTER_SOURCE), 'utf8'));
  const sha256 = sha256Hex(content);
  const previous = readManifest(join(project, NATIVE_DIR, MANIFEST_FILE));
  const previousVersion = previous && Number.isSafeInteger(previous.version) ? previous.version : 0;
  const unchanged = previous && previous.sha256 === sha256 && previousVersion > 0;
  const version = unchanged ? previousVersion : Math.max(Math.floor(now / 1000), previousVersion + 1);
  return {
    content,
    sha256,
    bytes: Buffer.byteLength(content, 'utf8'),
    version,
    manifest: { version, sha256, path: NATIVE_ADAPTER_PATH },
  };
}

function writeAtomic(path, text) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, text);
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

// Re-reads the files on disk and checks that the manifest describes the adapter exactly.
export function verifyNativeAdapter(project = PROJECT_ROOT) {
  const directory = join(project, NATIVE_DIR);
  const adapterPath = join(directory, ADAPTER_FILE);
  const manifestPath = join(directory, MANIFEST_FILE);
  const problems = [];
  const manifest = readManifest(manifestPath);
  if (!manifest) problems.push(`${NATIVE_DIR}/${MANIFEST_FILE} is missing or not JSON`);
  else problems.push(...validateManifest(manifest));
  let actual = null;
  if (!existsSync(adapterPath)) problems.push(`${NATIVE_DIR}/${ADAPTER_FILE} is missing`);
  else actual = createHash('sha256').update(readFileSync(adapterPath)).digest('hex');
  if (manifest && actual && manifest.sha256 !== actual) problems.push(`manifest sha256 ${manifest.sha256} does not match ${ADAPTER_FILE} ${actual}`);
  if (manifest && manifest.path !== NATIVE_ADAPTER_PATH) problems.push(`manifest path ${manifest.path} is not ${NATIVE_ADAPTER_PATH}`);
  return { ok: problems.length === 0, problems, manifest, fileSha256: actual };
}

// Writes the adapter first and the manifest second, so a manifest never names bytes that are not
// on disk yet. Returns the build plus whether anything changed.
export function writeNativeAdapter(project = PROJECT_ROOT, built = buildNativeAdapter(project)) {
  const directory = join(project, NATIVE_DIR);
  mkdirSync(directory, { recursive: true });
  const adapterPath = join(directory, ADAPTER_FILE);
  const manifestPath = join(directory, MANIFEST_FILE);
  const manifestText = JSON.stringify(built.manifest, null, 2) + '\n';
  let changed = false;
  if (!existsSync(adapterPath) || !readFileSync(adapterPath).equals(Buffer.from(built.content, 'utf8'))) {
    writeAtomic(adapterPath, built.content);
    changed = true;
  }
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifestText) {
    writeAtomic(manifestPath, manifestText);
    changed = true;
  }
  const verification = verifyNativeAdapter(project);
  if (!verification.ok) throw new Error('Native adapter verification failed: ' + verification.problems.join('; '));
  if (verification.fileSha256 !== built.sha256) throw new Error('Native adapter on disk differs from the generated content.');
  return { ...built, changed };
}

// Used by tools/client-native-patch.mjs: the APK gets exactly the bytes the server will serve.
export function syncNativeAdapter(project = PROJECT_ROOT, { write = true } = {}) {
  const built = buildNativeAdapter(project);
  return write ? writeNativeAdapter(project, built) : { ...built, changed: false };
}

function main(argv) {
  const check = argv.includes('--check');
  for (const argument of argv) if (argument !== '--check') throw new Error(`Unknown argument: ${argument}`);
  if (check) {
    const built = buildNativeAdapter(PROJECT_ROOT);
    const verification = verifyNativeAdapter(PROJECT_ROOT);
    const problems = [...verification.problems];
    if (verification.ok && verification.fileSha256 !== built.sha256) problems.push(`${NATIVE_DIR}/${ADAPTER_FILE} is stale; run node tools/android-native-adapter.mjs`);
    if (problems.length) {
      for (const problem of problems) console.error('FAIL ' + problem);
      process.exitCode = 1;
      return;
    }
    console.log(`OK ${NATIVE_DIR} is current: version ${verification.manifest.version}, sha256 ${verification.manifest.sha256}`);
    return;
  }
  const result = writeNativeAdapter(PROJECT_ROOT);
  console.log(`${result.changed ? 'Wrote' : 'Unchanged'} ${NATIVE_DIR}/${ADAPTER_FILE} (${result.bytes} bytes) and ${MANIFEST_FILE}`);
  console.log(`version ${result.version}`);
  console.log(`sha256  ${result.sha256}`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
