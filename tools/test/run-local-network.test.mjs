import assert from 'node:assert/strict';
import test from 'node:test';
import { baseUrl, websocketUrl, fundingAmount, redact, chooseAction, assertRoomCursor, assertAuthenticatedRoom, runProbe, runAcceptance, parseOptions, runNetwork } from '../run-local-network.mjs';

test('network probe never uses the retired LAN default', () => {
  assert.equal(baseUrl(), 'http://127.0.0.1:3000');
  assert.equal(websocketUrl('https://example.test:8443'), 'wss://example.test:8443/api/live');
});

test('evidence redaction removes credentials recursively', () => {
  const value = redact({ password: 'secret', token: 'secret', nested: [{ authorization: 'Bearer secret', ok: 1 }] });
  assert.deepEqual(value, { password: '[REDACTED]', token: '[REDACTED]', nested: [{ authorization: '[REDACTED]', ok: 1 }] });
  assert.equal(JSON.stringify(value).includes('secret'), false);
});

test('funding amount covers a real room fee and rejects invalid values', () => {
  assert.equal(fundingAmount(), '100');
  assert.equal(fundingAmount('12.345'), '12.345');
  assert.throws(() => fundingAmount('0'), /positive decimal/);
  assert.throws(() => fundingAmount('-1'), /positive decimal/);
});

test('legal action selection prefers a real protocol action', () => {
  assert.deepEqual(chooseAction({ legalActions: [{ type: 'discard', tile: 3 }, { type: 'pass' }] }), { type: 'discard', tile: 3 });
  assert.equal(chooseAction({ legalActions: [] }), null);
});

test('room cursor validation covers required state fields and rejects malformed views', () => {
  assert.doesNotThrow(() => assertRoomCursor({ stateVersion: 2, roundId: null }, 'room'));
  assert.throws(() => assertRoomCursor({ roundId: null }, 'room'), /stateVersion/);
  assert.throws(() => assertRoomCursor({ stateVersion: 2, roundId: 3 }, 'room'), /roundId/);
});

test('authenticated messages require an explicit room with the expected id', () => {
  assert.doesNotThrow(() => assertAuthenticatedRoom({ type: 'authenticated', room: { id: 'room-1' } }, 'room-1'));
  assert.throws(() => assertAuthenticatedRoom({ type: 'authenticated' }, 'room-1'), /include room/);
  assert.throws(() => assertAuthenticatedRoom({ type: 'authenticated', room: null }, 'room-1'), /include room/);
  assert.throws(() => assertAuthenticatedRoom({ type: 'authenticated', room: { id: 'room-2' } }, 'room-1'), /room id/);
});

test('CLI defaults to probe without a binding and to acceptance when a run ID is present', () => {
  assert.deepEqual(parseOptions([], {}), { mode: 'probe' });
  assert.deepEqual(parseOptions(['--probe'], { ACCEPTANCE_FRESH_RUN_ID: 'fresh-1' }), { mode: 'probe' });
  assert.deepEqual(parseOptions([], { ACCEPTANCE_FRESH_RUN_ID: 'fresh-1' }), { mode: 'acceptance' });
  assert.deepEqual(parseOptions([], { ACCEPTANCE_RUN_ID: 'run-1' }), { mode: 'acceptance' });
  assert.deepEqual(parseOptions(['--mode', 'acceptance', '--acceptance-run-id=ephemeral-1'], {}), { mode: 'acceptance', acceptanceRunId: 'ephemeral-1' });
  assert.deepEqual(parseOptions(['--acceptance', '--api-base', 'http://localhost:3000'], {}), { mode: 'acceptance', apiBase: 'http://localhost:3000' });
  assert.deepEqual(parseOptions(['--acceptance-run-id=ephemeral-1'], {}), { mode: 'acceptance', acceptanceRunId: 'ephemeral-1' });
  assert.throws(() => parseOptions(['--mode', 'unknown'], {}), /mode must/);
  assert.throws(() => parseOptions(['--acceptance-run-id'], {}), /Missing value/);
  assert.throws(() => parseOptions(['--unknown'], {}), /Unknown option/);
});

function stubHealth(t, health, status = 200) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options?.method ?? 'GET' });
    assert.equal(url, 'http://127.0.0.1:3000/health', 'only health may be fetched before acceptance is authorized');
    assert.equal(options?.method ?? 'GET', 'GET');
    return { status, text: async () => JSON.stringify(health) };
  });
  return calls;
}

test('explicit probe and default mode perform only GET health, even on a non-isolated database', async t => {
  const calls = stubHealth(t, { status: 'ok', isolatedDatabase: false });
  for (const run of [runProbe, runNetwork]) {
    const result = await run({ apiBase: 'http://127.0.0.1:3000/' });
    assert.equal(result.mode, 'probe');
    assert.equal(result.passed, true);
    assert.deepEqual(result.checks.map(check => check.id), ['old-domains-blocked', 'update-path']);
    assert.equal(result.requests.length, 1);
    assert.equal(result.requests[0].request.method, 'GET');
    assert.equal(result.requests[0].request.path, '/health');
    assert.equal(result.rawOutput, undefined, 'probe must not publish acceptance evidence');
  }
  assert.deepEqual(calls, Array.from({ length: 2 }, () => ({ url: 'http://127.0.0.1:3000/health', method: 'GET' })));
});

test('acceptance rejects missing, empty, whitespace, and non-string run IDs without any fetch', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('missing run ID must not reach the network'));
  const previous = process.env.LOCAL_ACCEPTANCE_RUN_ID;
  const legacy = process.env.DSS_ACCEPTANCE_RUN_ID;
  const acceptance = process.env.ACCEPTANCE_RUN_ID;
  const fresh = process.env.ACCEPTANCE_FRESH_RUN_ID;
  delete process.env.LOCAL_ACCEPTANCE_RUN_ID;
  delete process.env.DSS_ACCEPTANCE_RUN_ID;
  delete process.env.ACCEPTANCE_RUN_ID;
  delete process.env.ACCEPTANCE_FRESH_RUN_ID;
  try {
    for (const acceptanceRunId of [undefined, '', '  ', null, 42]) {
      await assert.rejects(runAcceptance({ acceptanceRunId }), /non-empty ephemeral run ID/);
    }
  } finally {
    if (previous === undefined) delete process.env.LOCAL_ACCEPTANCE_RUN_ID; else process.env.LOCAL_ACCEPTANCE_RUN_ID = previous;
    if (legacy === undefined) delete process.env.DSS_ACCEPTANCE_RUN_ID; else process.env.DSS_ACCEPTANCE_RUN_ID = legacy;
    if (acceptance === undefined) delete process.env.ACCEPTANCE_RUN_ID; else process.env.ACCEPTANCE_RUN_ID = acceptance;
    if (fresh === undefined) delete process.env.ACCEPTANCE_FRESH_RUN_ID; else process.env.ACCEPTANCE_FRESH_RUN_ID = fresh;
  }
});

for (const [label, health, status, expected] of [
  ['unhealthy service', { status: 'down', isolatedDatabase: true, acceptanceRunId: 'ephemeral-1' }, 200, /health.status/],
  ['HTTP failure', { status: 'ok', isolatedDatabase: true, acceptanceRunId: 'ephemeral-1' }, 503, /HTTP GET/],
  ['non-isolated database', { status: 'ok', isolatedDatabase: false, acceptanceRunId: 'ephemeral-1' }, 200, /isolatedDatabase/],
  ['missing isolation', { status: 'ok', acceptanceRunId: 'ephemeral-1' }, 200, /isolatedDatabase/],
  ['string isolation', { status: 'ok', isolatedDatabase: 'true', acceptanceRunId: 'ephemeral-1' }, 200, /isolatedDatabase/],
  ['mismatched run ID', { status: 'ok', isolatedDatabase: true, acceptanceRunId: 'other-run' }, 200, /acceptanceRunId/],
  ['missing run ID in health', { status: 'ok', isolatedDatabase: true }, 200, /acceptanceRunId/],
  ['null health', null, 200, /health.status/],
]) {
  test('acceptance fails closed for ' + label + ' before all mutations and authentication', async t => {
    const calls = stubHealth(t, health, status);
    await assert.rejects(runAcceptance({ apiBase: 'http://127.0.0.1:3000', acceptanceRunId: 'ephemeral-1' }), expected);
    assert.equal(calls.length, 1);
  });
}

test('matching isolated health permits registration only after GET health and supports env run ID', async t => {
  const calls = [];
  const stop = new Error('stop at first authorized mutation');
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options?.method ?? 'GET' });
    if (calls.length === 1) {
      assert.equal(url, 'http://127.0.0.1:3000/health');
      return { status: 200, text: async () => JSON.stringify({ status: 'ok', isolatedDatabase: true, acceptanceRunId: 'ephemeral-1' }) };
    }
    assert.equal(url, 'http://127.0.0.1:3000/api/auth/register');
    assert.equal(options.method, 'POST');
    throw stop;
  });
  const previous = process.env.LOCAL_ACCEPTANCE_RUN_ID;
  process.env.LOCAL_ACCEPTANCE_RUN_ID = 'ephemeral-1';
  try {
    await assert.rejects(runNetwork({ mode: 'acceptance', apiBase: 'http://127.0.0.1:3000' }), error => error === stop);
  } finally {
    if (previous === undefined) delete process.env.LOCAL_ACCEPTANCE_RUN_ID; else process.env.LOCAL_ACCEPTANCE_RUN_ID = previous;
  }
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST']);
});

test('matching isolated health supports the fresh-UI run ID binding', async t => {
  const calls = [];
  const stop = new Error('stop at first authorized mutation');
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options?.method ?? 'GET' });
    if (calls.length === 1) {
      assert.equal(url, 'http://127.0.0.1:3000/health');
      return { status: 200, text: async () => JSON.stringify({ status: 'ok', isolatedDatabase: true, acceptanceRunId: 'fresh-1' }) };
    }
    assert.equal(url, 'http://127.0.0.1:3000/api/auth/register');
    assert.equal(options.method, 'POST');
    throw stop;
  });
  const previous = process.env.ACCEPTANCE_FRESH_RUN_ID;
  process.env.ACCEPTANCE_FRESH_RUN_ID = 'fresh-1';
  try {
    await assert.rejects(runNetwork({ apiBase: 'http://127.0.0.1:3000' }), error => error === stop);
  } finally {
    if (previous === undefined) delete process.env.ACCEPTANCE_FRESH_RUN_ID; else process.env.ACCEPTANCE_FRESH_RUN_ID = previous;
  }
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST']);
});

