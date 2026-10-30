import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { MSGEvent, encodeFrame, decodeFrame, expectedBodyField, proto } from '../packages/protocol/dist/index.js';
import { originalCatalogue } from '../packages/rules/src/original-catalogue.ts';

// The user's test account only; this probe never matches public opponents,
// tops up currency, spoofs an existing account, or dumps authentication data.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/server/package.json'));
const WebSocket = require('ws');
const originalConfig = await readFile(join(root, '../apk-deep-analysis/modules/main/FrameConfig.js'), 'utf8');
const endpoint = originalConfig.match(/ws_server:\s*"([^"]+)"/)?.[1];
if (!endpoint) throw new Error('Original service endpoint missing');
const privateDir = join(root, '.local/original-service-test');
await mkdir(privateDir, { recursive: true });
const shortCredentials = process.argv.includes('--short');
const accountPath = join(privateDir, shortCredentials ? 'account-short.json' : 'account.json');
let account;
try { account = JSON.parse(await readFile(accountPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  account = { username: 'dss' + randomBytes(shortCredentials ? 3 : 5).toString('hex'), password: randomBytes(shortCredentials ? 6 : 10).toString('hex'),
    deviceId: randomUUID(), registered: false };
  await writeFile(accountPath, JSON.stringify(account), { mode: 0o600 });
}
const report = { at: new Date().toISOString(), endpoint, originalVersionName: '4.0', accountLength: account.username.length,
  passwordLength: account.password.length, scope: 'Original service connection and dedicated test account only; no completed game',
  messages: [], connected: false, registered: account.registered, loggedIn: false };
const socket = new WebSocket(endpoint, { handshakeTimeout: 7000, maxPayload: 1024 * 1024 });
const inbox = [];
socket.on('message', bytes => {
  try {
    let payload = bytes;
    // Research-only compatibility: the original receiver reads but ignores the
    // outer length. Do not change the independent service's strict decoder.
    const declaredLength = bytes.length >= 4 ? bytes.readUInt32BE(0) : null;
    const magic = bytes.length >= 8 ? bytes.toString('ascii', 4, 8) : '';
    if (bytes.length >= 16 && declaredLength === bytes.length && ['HWFR', 'HNFR'].includes(magic)) {
      payload = Buffer.from(bytes);
      payload.writeUInt32BE(bytes.length - 4, 0);
      payload.write('HWFR', 4, 4, 'ascii');
    }
    const frame = decodeFrame(payload);
    inbox.push(frame);
    report.messages.push({ command: frame.cmd, fields: Object.keys(frame.data),
      bytes: bytes.length, declaredLength, magic, sha256: createHash('sha256').update(bytes).digest('hex') });
  } catch (error) { report.messages.push({ decodeError: error.code || error.message, bytes: bytes.length,
    declaredLength: bytes.length >= 4 ? bytes.readUInt32BE(0) : null, framingPrefix: bytes.subarray(0, 12).toString('hex') }); }
});
socket.on('error', () => {});
async function request(name, body, responseName) {
  const from = inbox.length, command = MSGEvent[name], response = MSGEvent[responseName];
  socket.send(encodeFrame({ cmd: command, uid: account.uid || '', channelId: 1, protoVersion: 0, deviceId: account.deviceId,
    deviceName: 'Android', osv: 'android_4.0' }, { [expectedBodyField(command)]: body }));
  const frame = await new Promise((resolve, reject) => {
    const check = () => {
      const result = inbox.slice(from).find(frame => frame.cmd === response);
      if (result) { clearTimeout(timer); socket.off('message', check); resolve(result); }
    };
    const timer = setTimeout(() => { socket.off('message', check); reject(new Error(responseName + ' timed out')); }, 7000);
    socket.on('message', check); check();
  });
  const result = frame.data[expectedBodyField(response)];
  return proto[responseName].toObject(proto[responseName].fromObject(result), { defaults: true, longs: String, enums: Number });
}
try {
  await once(socket, 'open');
  report.connected = true;
  if (!account.registered) {
    const registration = await request('HWRequestRegister', { account: account.username, password: account.password }, 'HWResponseRegister');
    report.registrationResult = registration.result;
    if (registration.result === 1) {
      account.registered = true;
      await writeFile(accountPath, JSON.stringify(account), { mode: 0o600 });
      report.registered = true;
    }
  }
  if (account.registered || report.registrationResult !== undefined) {
    const login = await request('HWRequestGameLogin', { account: account.username, password: account.password,
      playerType: 1, isApp: true }, 'HWResponseGameLogin');
    report.loggedIn = Boolean(login.state && login.uid);
    report.login = { state: login.state, hasUserId: Boolean(login.uid), roomCardNum: login.roomCardNum,
      goldNum: login.goldNum, availableGameIds: login.areaType, requiresUpdate: login.mustUpdate,
      identityPrompt: login.isShowSmrz && !login.isSmrz, freeCreateRoomTimes: login.freeCreateRoomTimes,
      freeVideoHallTimes: login.freeVideoHallTimes, currentRoomId: login.tableId };
    if (report.loggedIn) {
      account.token = login.token;
      account.uid = login.uid;
      await writeFile(accountPath, JSON.stringify(account), { mode: 0o600 });
      if (process.argv.includes('--create-room')) {
        const regions = await request('HWRequestRegion', {}, 'HWResponseRegion');
        report.regions = { result: regions.result, choices: (regions.shiInfo || []).map(region => ({
          name: region.shiName, counties: region.xianInfo.map(county => ({ name: county.xianName, gameIds: county.areaType })),
        })) };
        const choice = await request('HWRequestRegionChoice', { shiName: '成都市', xianName: '邛崃' }, 'HWResponseRegionChoice');
        report.regionChoice = { result: choice.result, gameIds: choice.areaType };
        if (login.tableId) {
          report.room = { alreadyExists: true, roomId: login.tableId };
        } else if (choice.result === 1) {
          const original = originalCatalogue['8'][0];
          const options = {};
          for (const group of Object.values(original.rule)) {
            if (group.multiple) for (const option of group.config) options[option.value] = Boolean(option.default);
            else options[group.param] = group.config.find(option => option.default).value;
          }
          const created = await request('HWRequestCreateTable', { ...options, areaType: 8, playerNum: 2, openGps: false }, 'HWResponseCreateTable');
          report.room = { result: created.result, tableInfo: created.tableInfo };
          if (created.result === 1 && created.tableInfo?.roomId) {
            account.roomId = created.tableInfo.roomId;
            await writeFile(accountPath, JSON.stringify(account), { mode: 0o600 });
          }
        }
      }
    }
  }
} catch (error) {
  report.error = error.code || error.message;
} finally {
  socket.terminate();
  const target = join(root, 'docs/rules/original-service-probe.json');
  await writeFile(target, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
