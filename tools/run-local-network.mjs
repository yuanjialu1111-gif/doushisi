import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseSubject } from './build-fingerprint.mjs';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const WebSocket = require('ws');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'verification/local-network.json');
const rawOutput = join(root, 'verification/raw/local-network.json');

function baseUrl(value = process.env.LOCAL_ACCEPTANCE_API_BASE ?? process.env.DSS_LOCAL_NETWORK_API_BASE ?? 'http://127.0.0.1:3000') {
  const parsed = new URL(value);
  assert.ok(parsed.protocol === 'http:' || parsed.protocol === 'https:', 'API base must be HTTP(S)');
  return parsed.toString().replace(/\/$/, '');
}
function websocketUrl(apiBase) { return apiBase.replace(/^http/, 'ws') + '/api/live'; }
function acceptanceRunIdFromEnvironment(environment = process.env) {
  return environment.LOCAL_ACCEPTANCE_RUN_ID
    ?? environment.DSS_ACCEPTANCE_RUN_ID
    ?? environment.ACCEPTANCE_RUN_ID
    ?? environment.ACCEPTANCE_FRESH_RUN_ID;
}
function defaultMode(environment = process.env) {
  return acceptanceRunIdFromEnvironment(environment) === undefined ? 'probe' : 'acceptance';
}
function fundingAmount(value = process.env.LOCAL_ACCEPTANCE_FUNDING_AMOUNT ?? '100') {
  assert.match(value, /^\d+(?:\.\d{1,12})?$/, 'LOCAL_ACCEPTANCE_FUNDING_AMOUNT must be a positive decimal with at most 12 fractional digits');
  assert.ok(Number(value) > 0, 'LOCAL_ACCEPTANCE_FUNDING_AMOUNT must be a positive decimal with at most 12 fractional digits');
  return value;
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => /password|token|authorization|cookie/i.test(key) ? [key, '[REDACTED]'] : [key, redact(item)]));
}
function chooseAction(view) {
  const legal = Array.isArray(view?.legalActions) ? view.legalActions : [];
  return legal.find(action => action?.type === 'respond') ?? legal.find(action => action?.type === 'hu') ?? legal.find(action => action?.type === 'discard') ?? legal[0] ?? null;
}
function assertRoomCursor(view, label) {
  assert.ok(view && (typeof view.stateVersion === 'number' || view.stateVersion === null), label + ' must expose stateVersion');
  assert.ok(typeof view.roundId === 'string' || view.roundId === null, label + ' must expose roundId');
}
function assertAuthenticatedRoom(message, roomId, label = 'authenticated message') {
  assert.ok(message && typeof message === 'object', label + ' must be an object');
  assert.ok(message.room && typeof message.room === 'object', label + ' must include room');
  assert.equal(message.room.id, roomId, label + ' room id must match the active room');
}
async function request(client, path, { method = 'GET', body, expectedStatus = 200 } = {}) {
  const response = await fetch(client.baseUrl + path, { method, headers: { ...(client.token ? { Authorization: 'Bearer ' + client.token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  client.exchanges.push({ request: { method, path, body: redact(body) }, response: { status: response.status, body: redact(payload) } });
  assert.equal(response.status, expectedStatus, 'HTTP ' + method + ' ' + path + ': ' + response.status + ' ' + JSON.stringify(payload));
  return payload;
}
async function register(base, username, exchanges) {
  const response = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'network-probe-password', nickname: username }) });
  const payload = await response.json(); exchanges.push({ request: { method: 'POST', path: '/api/auth/register', body: redact({ username, password: 'network-probe-password', nickname: username }) }, response: { status: response.status, body: redact(payload) } });
  assert.equal(response.status, 200, 'register failed: ' + response.status);
  return payload;
}
function connect(client) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(websocketUrl(client.baseUrl));
    const timer = setTimeout(() => { socket.close(); rejectPromise(new Error('WS_AUTH_TIMEOUT')); }, 10000);
    const onMessage = raw => { let message; try { message = JSON.parse(raw.toString()); } catch { return; } if (message.type === 'authenticated') { client.exchanges.push({ request: { method: 'WS', path: '/api/live', body: { type: 'authenticate', token: '[REDACTED]' } }, response: { type: 'authenticated', body: redact(message) } }); clearTimeout(timer); socket.off('message', onMessage); client.socket = socket; resolvePromise(message); } if (message.type === 'error') { clearTimeout(timer); socket.close(); rejectPromise(new Error('WS_AUTH_' + message.code)); } };
    socket.on('message', onMessage); socket.once('error', error => { clearTimeout(timer); rejectPromise(error); }); socket.once('open', () => { client.exchanges.push({ request: { method: 'WS', path: '/api/live', body: { type: 'authenticate', token: '[REDACTED]' } } }); socket.send(JSON.stringify({ type: 'authenticate', token: client.token })); });
  });
}
async function close(client) {
  if (!client.socket || client.socket.readyState === WebSocket.CLOSED) return;
  const socket = client.socket; client.socket = null;
  await new Promise(resolvePromise => { socket.once('close', resolvePromise); socket.close(1000, 'network probe reconnect'); setTimeout(resolvePromise, 1500); });
}
async function readHealth(apiBase, exchanges) {
  const health = await request({ baseUrl: apiBase, exchanges }, '/health');
  assert.equal(health?.status, 'ok', 'health.status must be ok');
  return health;
}
async function nonMutatingChecks(apiBase) {
  const forbidden = ['d14api.handka.com', 'appdown.weitianwlkj.com', 'dssshare.lanrendapai.cn', '192.168.2.235:9001', 'jzyx.ink'];
  const bundle = await readFile(join(root, 'client/public/assets/main/index.js'), 'utf8'); const hall = await readFile(join(root, 'client/public/assets/hall/index.js'), 'utf8'); assert.ok(forbidden.every(value => !bundle.includes(value) && !hall.includes(value)));
  const runtime = await readFile(join(root, 'client/public/runtime-config.js'), 'utf8'); const location = new URL(apiBase); const sandbox = { location, window: {} }; vm.runInNewContext(runtime, sandbox); assert.equal(sandbox.window.STANDALONE_CONFIG.apiBase, apiBase);
  return [{ id: 'old-domains-blocked', passed: true, details: { checked: forbidden } }, { id: 'update-path', passed: true, details: { runtimeConfigUsesCurrentOrigin: true } }];
}
// A probe never authenticates, opens a WebSocket, or writes acceptance evidence.
async function runProbe({ apiBase = baseUrl() } = {}) {
  apiBase = baseUrl(apiBase);
  const exchanges = [];
  const health = await readHealth(apiBase, exchanges);
  const checks = await nonMutatingChecks(apiBase);
  return { mode: 'probe', passed: true, apiBase, health, requests: exchanges, checks };
}
async function runAcceptance({ apiBase = baseUrl(), acceptanceRunId = acceptanceRunIdFromEnvironment() } = {}) {
  assert.ok(typeof acceptanceRunId === 'string' && acceptanceRunId.trim().length > 0,
    'acceptanceRunId must be a non-empty ephemeral run ID supplied via option, LOCAL_ACCEPTANCE_RUN_ID, DSS_ACCEPTANCE_RUN_ID, ACCEPTANCE_RUN_ID, or ACCEPTANCE_FRESH_RUN_ID');
  apiBase = baseUrl(apiBase);
  const clients = []; const exchanges = [];
  // Fail closed before any registration, login, funding, room action, or WS auth.
  const health = await readHealth(apiBase, exchanges);
  assert.equal(health.isolatedDatabase, true, 'health.isolatedDatabase must be true');
  assert.equal(health.acceptanceRunId, acceptanceRunId, 'health.acceptanceRunId must match the supplied acceptanceRunId');
  const subjectBefore = await releaseSubject(root);
  const staticChecks = await nonMutatingChecks(apiBase);
  const usernameBase = 'net' + Date.now().toString(36) + process.pid.toString(36);
  for (const suffix of ['a', 'b']) {
    const username = usernameBase + suffix; const registered = await register(apiBase, username, exchanges);
    const response = await fetch(apiBase + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'network-probe-password' }) });
    const login = await response.json(); exchanges.push({ request: { method: 'POST', path: '/api/auth/login', body: redact({ username, password: 'network-probe-password' }) }, response: { status: response.status, body: redact(login) } }); assert.equal(response.status, 200, 'login failed: ' + response.status);
    clients.push({ baseUrl: apiBase, username, token: login.token, user: registered.user, exchanges, clientId: 'network-probe-' + suffix, socket: null });
  }
  const owner = clients[0]; const guest = clients[1];
  const adminUsername = process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_USERNAME ?? process.env.DSS_BEANS_ADMIN_USERNAME;
  const adminPassword = process.env.LOCAL_ACCEPTANCE_BEANS_ADMIN_PASSWORD ?? process.env.DSS_BEANS_ADMIN_PASSWORD;
  assert.ok(adminUsername && adminPassword, 'set LOCAL_ACCEPTANCE_BEANS_ADMIN_USERNAME/PASSWORD to fund acceptance players');
  const adminLoginResponse = await fetch(apiBase + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: adminUsername, password: adminPassword }) });
  const adminLogin = await adminLoginResponse.json(); exchanges.push({ request: { method: 'POST', path: '/api/admin/login', body: { username: '[REDACTED]', password: '[REDACTED]' } }, response: { status: adminLoginResponse.status, body: redact(adminLogin) } });
  assert.equal(adminLoginResponse.status, 200, 'admin login failed: ' + adminLoginResponse.status);
  const funding = fundingAmount();
  for (const client of clients) {
    const adjustment = await fetch(apiBase + '/api/admin/users/' + client.user.id + '/adjustments', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + adminLogin.token }, body: JSON.stringify({ amount: funding, reason: 'local network acceptance', requestId: 'network-fund-' + client.user.id }) });
    const adjustmentBody = await adjustment.json(); exchanges.push({ request: { method: 'POST', path: '/api/admin/users/' + client.user.id + '/adjustments', body: redact({ amount: funding, reason: 'local network acceptance', requestId: 'network-fund-' + client.user.id }), authorization: '[REDACTED]' }, response: { status: adjustment.status, body: redact(adjustmentBody) } });
    assert.equal(adjustment.status, 200, 'funding failed: ' + adjustment.status);
  }
  await request({ ...clients[0], token: 'invalid-token' }, '/api/me', { expectedStatus: 401 });
  const created = await request(owner, '/api/rooms', { method: 'POST', body: { variantKey: '6:0', options: { playerNum: 2, gameNum: 4 }, baseBeans: '0.001' } });
  assert.ok(created?.id && created?.code, 'room creation must return id and code');
  const joined = await request(guest, '/api/rooms/join', { method: 'POST', body: { code: created.code } });
  const roomId = created.id; const beforeReady = await request(owner, '/api/rooms/' + roomId); assertRoomCursor(beforeReady, 'initial room');
  const authBefore = await connect(owner); assert.equal(authBefore.type, 'authenticated'); assert.equal(authBefore.protocolVersion, 2); assertAuthenticatedRoom(authBefore, roomId, 'initial authentication'); await close(owner);
  const readyOne = await request(owner, '/api/rooms/' + roomId + '/ready', { method: 'POST', body: { ready: true } });
  const readyTwo = await request(guest, '/api/rooms/' + roomId + '/ready', { method: 'POST', body: { ready: true } });
  const memberViews = await Promise.all(clients.map(client => request(client, '/api/rooms/' + roomId))); memberViews.forEach((view, index) => assertRoomCursor(view, 'member ' + index));
  const selectedIndex = memberViews.findIndex(view => chooseAction(view)); assert.ok(selectedIndex >= 0, 'a member must expose a legal action');
  const selected = clients[selectedIndex]; const playing = memberViews[selectedIndex]; assert.equal(playing.state, 'playing'); assert.ok(playing.roundId);
  const action = chooseAction(playing);
  const actionResponse = await request(selected, '/api/rooms/' + roomId + '/actions', { method: 'POST', body: { commandId: 'network-' + randomUUID(), action, expectedStateVersion: playing.stateVersion, expectedRoundId: playing.roundId } });
  const afterAction = await request(selected, '/api/rooms/' + roomId); assertRoomCursor(afterAction, 'after action'); assert.equal(afterAction.roundId, playing.roundId, 'action must stay in the same round'); assert.ok(afterAction.stateVersion > playing.stateVersion, 'legal action must advance stateVersion');
  const beforeReconnect = await request(owner, '/api/rooms/' + roomId); const disconnectedAt = new Date().toISOString(); await close(owner); const authenticated = await connect(owner); const reconnectedAt = new Date().toISOString(); const afterReconnect = await request(owner, '/api/rooms/' + roomId);
  assert.equal(authenticated.type, 'authenticated'); assertAuthenticatedRoom(authenticated, roomId, 'reconnect authentication'); assert.equal(afterReconnect.stateVersion, beforeReconnect.stateVersion, 'reconnect must preserve exact stateVersion'); assert.equal(afterReconnect.roundId, beforeReconnect.roundId, 'reconnect must preserve exact roundId');
  const reconnect = { clientId: owner.clientId, clientIdSource: 'client-generated probe identifier; not server-issued', disconnectedAt, reconnectedAt, before: { stateVersion: beforeReconnect.stateVersion, roundId: beforeReconnect.roundId }, after: { stateVersion: afterReconnect.stateVersion, roundId: afterReconnect.roundId }, passed: true };
  await close(owner); await close(guest);
  const checks = [...staticChecks, { id: 'gameplay', passed: true, details: { health } }, { id: 'reconnect', passed: true, details: { websocketReachable: websocketUrl(apiBase), ...reconnect } }, { id: 'http-auth-room-action', passed: true, details: { roomId, stateVersionBefore: playing.stateVersion, stateVersionAfter: afterAction.stateVersion, roundId: playing.roundId } }, { id: 'websocket-authenticated-room', passed: true, details: { protocolVersion: authBefore.protocolVersion, roomId } }];
  const raw = { schemaVersion: 1, actual: true, subjectSha256: subjectBefore.sha256, apiBase, acceptanceRunId, isolatedDatabase: true, health, generatedAt: new Date().toISOString(), funding: { amount: funding, reason: 'local network acceptance' }, roomFee: { mode: created.feeMode, rounds: created.rounds, perPlayer: created.rounds / 4 }, requests: exchanges, samples: { room: { created: redact(created), joined: redact(joined), readyOne: redact(readyOne), readyTwo: redact(readyTwo), action: redact(actionResponse), before: redact(playing), after: redact(afterAction) }, reconnect }, checks };
  const rawBytes = Buffer.from(JSON.stringify(raw, null, 2) + '\n'); await mkdir(dirname(rawOutput), { recursive: true }); await writeFile(rawOutput, rawBytes);
  const subject = await releaseSubject(root); assert.equal(subject.sha256, subjectBefore.sha256, 'release subject changed during acceptance'); const rawSha256 = createHash('sha256').update(rawBytes).digest('hex'); const report = { schemaVersion: 1, passed: true, subjectSha256: subject.sha256, apiBase, health, requests: exchanges, samples: raw.samples, roomId, roundId: playing.roundId, stateVersion: { before: playing.stateVersion, after: afterAction.stateVersion }, checks, evidence: [{ path: 'verification/raw/local-network.json', sha256: rawSha256 }], generatedAt: new Date().toISOString() }; await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  return { output, rawOutput, checks, subjectSha256: subject.sha256, roomId, reconnect };
}
function parseOptions(args, environment = process.env) {
  const options = { mode: defaultMode(environment) };
  let modeSelected = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--probe' || argument === '--acceptance') { options.mode = argument.slice(2); modeSelected = true; continue; }
    const [flag, inline] = argument.split(/=(.*)/s);
    const key = { '--mode': 'mode', '--api-base': 'apiBase', '--acceptance-run-id': 'acceptanceRunId' }[flag];
    assert.ok(key, 'Unknown option: ' + argument);
    const value = inline ?? args[++index];
    assert.ok(value && !value.startsWith('--'), 'Missing value for ' + flag);
    options[key] = value;
    if (key === 'mode') modeSelected = true;
  }
  if (!modeSelected && options.acceptanceRunId !== undefined) options.mode = 'acceptance';
  assert.ok(options.mode === 'probe' || options.mode === 'acceptance', 'mode must be probe or acceptance');
  return options;
}
async function runNetwork({ mode = defaultMode(), ...options } = {}) {
  assert.ok(mode === 'probe' || mode === 'acceptance', 'mode must be probe or acceptance');
  return mode === 'probe' ? runProbe(options) : runAcceptance(options);
}
export { baseUrl, websocketUrl, fundingAmount, redact, chooseAction, assertRoomCursor, assertAuthenticatedRoom, runProbe, runAcceptance, parseOptions, runNetwork };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { console.log(JSON.stringify(await runNetwork(parseOptions(process.argv.slice(2))))); } catch (error) { console.error(JSON.stringify({ passed: false, code: error.code ?? error.name, message: error.message })); process.exitCode = 1; } }












