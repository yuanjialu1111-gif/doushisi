import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deriveClientUrl, resolveApiBase } from '../resolve-api-base.mjs';

async function fixture(apiBase = 'http://192.168.1.17:3000') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dss-api-base-'));
  const runtimePath = path.join(root, '.local', 'runtime.json');
  await mkdir(path.dirname(runtimePath), { recursive: true });
  await writeFile(runtimePath, JSON.stringify({ apiBase }));
  return { root, runtimePath };
}

test('explicit apiBase wins over environment and runtime state', async t => {
  const { root, runtimePath } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await resolveApiBase({
    explicitValue: 'https://explicit.example:8443/',
    environmentValue: 'http://environment.example:3000',
    runtimePath,
  }), 'https://explicit.example:8443');
});

test('environment apiBase wins over runtime state', async t => {
  const { root, runtimePath } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await resolveApiBase({
    environmentValue: 'http://environment.example:3000/',
    runtimePath,
  }), 'http://environment.example:3000');
});

test('runtime state apiBase is used when no override is supplied', async t => {
  const { root, runtimePath } = await fixture('http://192.168.1.17:3000/');
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await resolveApiBase({ runtimePath }), 'http://192.168.1.17:3000');
});

test('missing and invalid runtime state produce explicit errors', async t => {
  const { root, runtimePath } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(runtimePath);
  await assert.rejects(() => resolveApiBase({ runtimePath }), /Runtime state is missing/);
  await writeFile(runtimePath, '{not json');
  await assert.rejects(() => resolveApiBase({ runtimePath }), /not valid JSON/);
  await writeFile(runtimePath, JSON.stringify({ apiBase: 'file:///tmp/server' }));
  await assert.rejects(() => resolveApiBase({ runtimePath }), /must use http or https/);
});

test('explicit empty values are rejected instead of falling back', async t => {
  const { root, runtimePath } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => resolveApiBase({ explicitValue: '', runtimePath }), /non-empty/);
  await assert.rejects(() => resolveApiBase({ environmentValue: '   ', runtimePath }), /non-empty/);
});

test('client URL is derived from apiBase', async t => {
  const { root, runtimePath } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const apiBase = await resolveApiBase({ runtimePath });
  assert.equal(deriveClientUrl(apiBase), 'http://192.168.1.17:3000/client/');
});
