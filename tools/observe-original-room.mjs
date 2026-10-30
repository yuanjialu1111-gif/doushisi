import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { MSGEvent, encodeFrame, decodeFrame, expectedBodyField, proto } from '../packages/protocol/dist/index.js';
import { originalCatalogue } from '../packages/rules/src/original-catalogue.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/server/package.json'));
const WebSocket = require('ws');
const config = await readFile(join(root, '../apk-deep-analysis/modules/main/FrameConfig.js'), 'utf8');
const endpoint = config.match(/ws_server:\s*"([^"]+)"/)[1];
const integerArgument = (name, fallback) => {
  const argument = process.argv.find(value => value.startsWith('--' + name + '='));
  if (!argument) return fallback;
  const value = Number(argument.split('=')[1]);
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('Invalid ' + name);
  return value;
};
const gameId = integerArgument('game', 8), wangNum = integerArgument('wang', null), qiWangNum = integerArgument('sevens', null);
if (![6, 8].includes(gameId)) throw new Error('This observation tool is scoped to Qionglai and Yaan');
for (const [key, value] of [['wangNum', wangNum], ['qiWangNum', qiWangNum]]) {
  if (value === null) continue;
  const group = Object.values(originalCatalogue[String(gameId)][0].rule).find(group => group.param === key);
  if (!group?.config.some(option => option.value === value)) throw new Error('Only original selectable options may be observed');
}
const privateDir = join(root, '.local/original-service-test');
const separateOutput = process.argv.find(value => value.startsWith('--output-dir='))?.slice('--output-dir='.length);
const evidenceDir = separateOutput ? resolve(separateOutput) : join(root, 'docs/rules/original-room-samples');
await mkdir(privateDir, { recursive: true });
const report = { at: new Date().toISOString(), endpoint, scope: 'Original server, own dedicated test accounts and private room only',
  case: { gameId, wangNum, qiWangNum, playerNum: 2 }, actions: [], started: false, completedRounds: 0, closed: false };
const observations = [];
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/token|password|account|realName|realSfzh|picUrl|openId|refreshToken/i.test(key)).map(([key, item]) => [key, redact(item)]));
}
class Client {
  constructor(label, account, path) { this.label = label; this.account = account; this.path = path; this.inbox = []; }
  async connect() {
    this.socket = new WebSocket(endpoint, { handshakeTimeout: 7000 });
    this.socket.on('error', () => {});
    this.socket.on('message', bytes => {
      try {
        const payload = Buffer.from(bytes);
        if (payload.length >= 16 && payload.readUInt32BE(0) === payload.length &&
          ['HNFR', 'HWFR'].includes(payload.toString('ascii', 4, 8))) {
          payload.writeUInt32BE(payload.length - 4, 0); payload.write('HWFR', 4, 4, 'ascii');
        }
        const frame = decodeFrame(payload);
        this.inbox.push(frame);
        if (frame.cmd !== MSGEvent.HWResponseHeartBeat) observations.push({ at: new Date().toISOString(), player: this.label,
          command: frame.cmd, data: redact(frame.data),
          ...(frame.cmd === MSGEvent.HWResponseReadyForGame ? { originalWireBase64: bytes.toString('base64') } : {}) });
      } catch (error) { observations.push({ player: this.label, decodeError: error.code || error.message }); }
    });
    await once(this.socket, 'open');
    if (!this.account.registered) {
      const registered = await this.request('HWRequestRegister', { account: this.account.username, password: this.account.password }, 'HWResponseRegister');
      if (registered.result !== 1) throw new Error('Dedicated registration failed: ' + registered.result);
      this.account.registered = true;
      await this.save();
    }
    const login = await this.request('HWRequestGameLogin', { account: this.account.username, password: this.account.password,
      playerType: 1, isApp: true }, 'HWResponseGameLogin');
    if (!login.state || !login.uid) throw new Error('Dedicated login failed');
    this.account.uid = login.uid; this.currentRoom = login.tableId;
    await this.save();
    this.heartbeat = setInterval(() => this.send('HWRequestHeartBeat', {}), 5000);
    report.actions.push({ player: this.label, action: 'login', currentRoom: login.tableId, roomCards: login.roomCardNum, beans: login.goldNum });
  }
  save() { return writeFile(this.path, JSON.stringify(this.account), { mode: 0o600 }); }
  send(name, body) {
    const command = MSGEvent[name];
    this.socket.send(encodeFrame({ cmd: command, uid: this.account.uid || '', channelId: 1, protoVersion: 0,
      deviceId: this.account.deviceId, deviceName: 'Android', osv: 'android_4.0' }, { [expectedBodyField(command)]: body }));
  }
  wait(name, from = 0, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const frame = this.inbox.slice(from).find(frame => frame.cmd === MSGEvent[name]);
        if (frame) {
          clearTimeout(timer); this.socket.off('message', check);
          resolve(proto[name].toObject(proto[name].fromObject(frame.data[expectedBodyField(MSGEvent[name])]), { defaults: true, longs: String, enums: Number }));
        }
      };
      const timer = setTimeout(() => { this.socket.off('message', check); reject(new Error(name + ' timed out')); }, timeout);
      this.socket.on('message', check); check();
    });
  }
  request(name, body, response) { const from = this.inbox.length; this.send(name, body); return this.wait(response, from); }
  close() { clearInterval(this.heartbeat); this.socket?.terminate(); }
}
const hostPath = join(privateDir, 'account-short.json');
const host = new Client('A', JSON.parse(await readFile(hostPath, 'utf8')), hostPath);
const peerPath = join(privateDir, 'account-peer.json');
let peerAccount;
try { peerAccount = JSON.parse(await readFile(peerPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  peerAccount = { username: 'dss' + randomBytes(3).toString('hex'), password: randomBytes(6).toString('hex'),
    deviceId: randomUUID(), registered: false };
  await writeFile(peerPath, JSON.stringify(peerAccount), { mode: 0o600 });
}
const peer = new Client('B', peerAccount, peerPath);
let roomId, createdByThisRun = false;
try {
  await host.connect(); await peer.connect();
  if (host.currentRoom || peer.currentRoom) throw new Error('A dedicated account already has a room; existing rooms are left unchanged');
  roomId = host.currentRoom;
  if (!roomId) {
    const options = {};
    for (const group of Object.values(originalCatalogue[String(gameId)][0].rule)) {
      if (group.multiple) for (const option of group.config) options[option.value] = Boolean(option.default);
      else options[group.param] = group.config.find(option => option.default).value;
    }
    if (wangNum !== null) options.wangNum = wangNum;
    if (qiWangNum !== null) options.qiWangNum = qiWangNum;
    // Original two-player Yaan selection switches from self-only chi to previous-seat chi.
    if (gameId === 6) options.ziChi = false;
    report.requestedOptions = { ...options, areaType: gameId, playerNum: 2, openGps: false };
    const created = await host.request('HWRequestCreateTable', report.requestedOptions, 'HWResponseCreateTable');
    report.actions.push({ action: 'create', result: created.result });
    if (created.result !== 1) throw new Error('Original create rejected: ' + created.result);
    roomId = created.tableInfo.roomId;
    createdByThisRun = true;
  }
  report.roomId = roomId;
  if (peer.currentRoom && peer.currentRoom !== roomId) throw new Error('Peer already has a different room; do not disturb it');
  if (!peer.currentRoom) {
    const joined = await peer.request('HWRequestEnterTable', { roomId }, 'HWResponseEnterTable');
    report.actions.push({ player: 'B', action: 'join', result: joined.result });
    if (joined.result !== 1) throw new Error('Original join rejected: ' + joined.result);
  }
  for (const client of [host, peer]) {
    const entered = await client.request('HWRequestEnterTableFinish', { roomId }, 'HWResponseEnterTableFinish');
    if (entered.result !== 1) throw new Error('Original table entry rejected: ' + entered.result);
    if (entered.tableInfo.areaType !== gameId || wangNum !== null && entered.tableInfo.wangNum !== wangNum ||
      qiWangNum !== null && entered.tableInfo.qiWangNum !== qiWangNum) throw new Error('Existing room does not match requested observation case');
    report.actions.push({ player: client.label, action: 'enter', result: entered.result, seat: entered.seatIndex,
      tableInfo: entered.tableInfo, tableState: entered.tableState });
  }
  const startMark = host.inbox.length;
  for (const client of [host, peer]) {
    const ready = await client.request('HWRequestReadyForGame', { state: true }, 'HWResponseReadyForGame');
    report.actions.push({ player: client.label, action: 'ready', result: ready.result, state: ready.state,
      leftCardNum: ready.leftCardNum, showType: ready.showType });
    if (ready.result !== 1) throw new Error('Original ready rejected: ' + ready.result);
  }
  const start = await host.wait('HWNotifyGameStart', startMark, 15000);
  report.started = true;
  report.initial = { dealer: start.dealer, round: start.round, leftTileNum: start.leftTileNum,
    cardInfo: start.cardInfo, seats: start.seats };
  console.log(JSON.stringify({ event: 'original-round-started', roomId, dealer: start.dealer, leftTileNum: start.leftTileNum }));
  if (process.argv.includes('--autoplay')) {
    const overMark = host.inbox.length;
    for (const client of [host, peer]) {
      const auto = await client.request('HWRequestAuto', {}, 'HWResponseAuto');
      report.actions.push({ player: client.label, action: 'autoplay', result: auto.result });
    }
    const progress = setInterval(() => console.log(JSON.stringify({ event: 'observing-original-trustee', messages: observations.length })), 30000);
    try {
      const ended = await host.wait('HWNotifyGameOver', overMark, 180000);
      report.completedRounds = 1;
      report.result = ended;
    } finally { clearInterval(progress); }
  }
} catch (error) { report.error = error.message; }
finally {
  if (createdByThisRun && roomId && host.socket?.readyState === WebSocket.OPEN) {
    try {
      const from = host.inbox.length;
      const dissolve = await host.request('HWRequestDissolveTable', { roomId, choice: true }, 'HWResponseDissolveTable');
      report.actions.push({ player: 'A', action: 'dissolve', result: dissolve.result });
      if (peer.socket?.readyState === WebSocket.OPEN && peer.account.uid) {
        await peer.request('HWRequestDissolveTable', { roomId, choice: true }, 'HWResponseDissolveTable').catch(() => {});
      }
      report.closed = Boolean((await host.wait('HWNotifyDissolvedTable', from, 7000)).result);
    } catch (error) { report.cleanupError = error.message; }
  }
  host.close(); peer.close();
  report.messages = observations.length;
  const observation = JSON.stringify({ report, observations }, null, 2);
  await writeFile(join(privateDir, 'last-room-observation.json'), observation);
  await mkdir(evidenceDir, { recursive: true });
  const observationId = `${report.at.replace(/[:.]/g, '-')}-game${gameId}-wang${wangNum ?? 'default'}-sevens${qiWangNum ?? 'default'}`;
  await writeFile(join(evidenceDir, observationId + '.json'), observation);
  if (!separateOutput) await writeFile(join(root, 'docs/rules/original-room-observation.json'), JSON.stringify(redact(report), null, 2) + '\n');
  console.log(JSON.stringify({ at: report.at, case: report.case, roomId, started: report.started,
    completedRounds: report.completedRounds, closed: report.closed, error: report.error, cleanupError: report.cleanupError,
    actions: report.actions.map(action => ({ ...action, tableInfo: action.tableInfo && {
      areaType: action.tableInfo.areaType, playerNum: action.tableInfo.playerNum, wangNum: action.tableInfo.wangNum,
      qiWangNum: action.tableInfo.qiWangNum, basicTimes: action.tableInfo.basicTimes,
      tianHu: action.tableInfo.tianHu, diHu: action.tableInfo.diHu, quanHongHei: action.tableInfo.quanHongHei,
    } })), evidence: observationId + '.json' }, null, 2));
}
