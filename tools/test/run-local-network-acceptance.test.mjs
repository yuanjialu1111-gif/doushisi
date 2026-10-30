import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AuthService } from '../../apps/server/src/auth.ts';
import { migrate, openDatabase } from '../../apps/server/src/database.ts';
import { freeLoopbackPort, healthUnavailable, stopServer, waitForHealth } from '../run-local-recovery.mjs';
import { runAcceptance, runProbe } from '../run-local-network.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Boots the real server entry against a throwaway PGlite directory on a loopback port. */
async function bootServer({ data, port, controlPort, runId }) {
  const require = createRequire(join(root, 'apps/server/package.json'));
  const loader = pathToFileURL(require.resolve('tsx/esm')).href;
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), LOCAL_DATABASE_DIR: data,
    ACCEPTANCE_ISOLATED_DATABASE: 'true', ACCEPTANCE_RUN_ID: runId, LOCAL_BACKUP_DIR: join(data, '..', 'backups'),
    DSS_LOCAL_CONTROL_TOKEN: 'net-' + runId, DSS_LOCAL_STATE_FILE: join(data, '..', 'runtime.json'),
    DSS_LOCAL_CONTROL_PORT: String(controlPort), DSS_LOCAL_API_BASE: 'http://127.0.0.1:' + port };
  delete env.DATABASE_URL;
  const child = spawn(process.execPath, ['--import', loader, join(root, 'apps/server/src/main.ts')],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

test('acceptance mutates only after a real isolated server publishes the matching run ID', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dss-network-acceptance-'));
  const data = join(directory, 'data');
  const runId = 'network-acceptance-test';
  const admin = { username: 'netacceptadmin', password: 'netacceptadminpassword' };
  const port = await freeLoopbackPort();
  const controlPort = await freeLoopbackPort();
  const apiBase = 'http://127.0.0.1:' + port;
  const seed = await openDatabase(undefined, data);
  try {
    await migrate(seed);
    await new AuthService(seed).create(admin.username, admin.password, 'beans_admin', 'Network admin');
  } finally { await seed.close(); }

  const child = await bootServer({ data, port, controlPort, runId });
  const previousUser = process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_USERNAME;
  const previousPassword = process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_PASSWORD;
  process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_USERNAME = admin.username;
  process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_PASSWORD = admin.password;
  try {
    const health = await waitForHealth(apiBase);
    assert.equal(health.isolatedDatabase, true);
    assert.equal(health.acceptanceRunId, runId);

    // The read-only probe must not mutate anything.
    const probe = await runProbe({ apiBase });
    assert.equal(probe.mode, 'probe');
    assert.deepEqual(probe.checks.map(check => check.id), ['old-domains-blocked', 'update-path']);
    assert.equal(probe.requests.every(exchange => exchange.request.method === 'GET'), true);

    // A wrong run ID must fail closed before any registration/funding/room call.
    await assert.rejects(runAcceptance({ apiBase, acceptanceRunId: 'wrong-run-id' }), /acceptanceRunId/);

    const result = await runAcceptance({ apiBase, acceptanceRunId: runId });
    assert.match(result.subjectSha256, /^[0-9a-f]{64}$/);
    assert.ok(result.roomId);
    const ids = result.checks.map(check => check.id);
    for (const id of ['old-domains-blocked', 'gameplay', 'reconnect', 'update-path']) assert.ok(ids.includes(id), 'missing check ' + id);
  } finally {
    if (previousUser === undefined) delete process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_USERNAME; else process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_USERNAME = previousUser;
    if (previousPassword === undefined) delete process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_PASSWORD; else process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_PASSWORD = previousPassword;
    try { await stopServer(child, controlPort, 'net-' + runId); } catch { child.kill(); }
    assert.equal(await healthUnavailable(apiBase), true, 'acceptance server must stop cleanly');
    await rm(directory, { recursive: true, force: true });
  }
});
