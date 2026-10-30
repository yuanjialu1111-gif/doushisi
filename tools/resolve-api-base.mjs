import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_RUNTIME_PATH = '.local/runtime.json';

function fail(message) {
  const error = new Error(message);
  error.code = 'INVALID_API_BASE';
  throw error;
}

function normalizeApiBase(value, source) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${source} must contain a non-empty HTTP(S) URL.`);
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    fail(`${source} is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`${source} must use http or https.`);
  }
  if (!url.hostname) fail(`${source} must include a hostname.`);
  if (url.username || url.password) fail(`${source} must not contain credentials.`);
  if (url.search || url.hash) fail(`${source} must not contain a query or fragment.`);
  if (url.pathname !== '/' && url.pathname !== '') {
    fail(`${source} must not contain a path.`);
  }
  return `${url.protocol}//${url.host}`;
}

async function readRuntimeApiBase(runtimePath) {
  let text;
  try {
    text = await readFile(runtimePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') fail(`Runtime state is missing: ${runtimePath}`);
    fail(`Could not read runtime state ${runtimePath}: ${error.message}`);
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    fail(`Runtime state is not valid JSON: ${runtimePath}`);
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    fail(`Runtime state must be a JSON object: ${runtimePath}`);
  }
  return normalizeApiBase(state.apiBase, `Runtime state apiBase (${runtimePath})`);
}

export async function resolveApiBase({ explicitValue, environmentValue, runtimePath, cwd = process.cwd() } = {}) {
  if (explicitValue !== undefined && explicitValue !== null) {
    return normalizeApiBase(explicitValue, 'Explicit apiBase');
  }
  if (environmentValue !== undefined && environmentValue !== null) {
    return normalizeApiBase(environmentValue, 'DOUSHISI_API_BASE');
  }
  return readRuntimeApiBase(resolve(cwd, runtimePath || DEFAULT_RUNTIME_PATH));
}

export function deriveClientUrl(apiBase) {
  return normalizeApiBase(apiBase, 'apiBase').replace(/\/$/, '') + '/client/';
}

function readArguments(argv) {
  const result = { value: undefined, runtime: DEFAULT_RUNTIME_PATH, clientUrl: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--value' || argument === '--runtime') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) fail(`Missing value for ${argument}.`);
      result[argument === '--value' ? 'value' : 'runtime'] = value;
      index += 1;
    } else if (argument === '--client-url') {
      result.clientUrl = true;
    } else {
      fail(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const options = readArguments(process.argv.slice(2));
    const apiBase = await resolveApiBase({
      explicitValue: options.value,
      environmentValue: process.env.DOUSHISI_API_BASE,
      runtimePath: options.runtime,
    });
    process.stdout.write(options.clientUrl ? deriveClientUrl(apiBase) : apiBase);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
