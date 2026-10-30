import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proto } from '../packages/protocol/src/generated.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages/protocol/package.json'));
const { parse } = require('@babel/parser');
const sourcePath = '../apk-deep-analysis/modules/main/NetTools.js';
const source = await readFile(join(root, sourcePath), 'utf8');
let receive;
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node.type === 'ObjectProperty' && node.key.name === 'receive' && node.value.type === 'FunctionExpression') receive = source.slice(node.value.start, node.value.end);
  for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) walk(value);
}
walk(parse(source));
assert.ok(receive, 'Original receiver must be extracted, not reimplemented as the expected result');
const records = [], rawChecks = [];
const directory = join(root, 'docs/rules/original-room-samples');
for (const name of (await readdir(directory)).filter(name => name.endsWith('.json')).sort()) {
  const bytes = await readFile(join(directory, name));
  const sample = JSON.parse(bytes);
  const report = sample.report;
  assert.equal(report.started, false);
  assert.equal(report.completedRounds, 0);
  assert.equal(report.closed, true);
  assert.ok(report.actions.some(action => action.player === 'B' && action.action === 'join' && action.result === 1));
  const table = report.actions.find(action => action.player === 'A' && action.action === 'enter').tableInfo;
  const ready = report.actions.find(action => action.action === 'ready');
  assert.equal(ready.result, proto.ENMessageError.CODE_CREATE_ROOM_FREE_VIDEO_NO);
  assert.deepEqual(ready.showType, [21, 10]);
  records.push({ file: name, sha256: createHash('sha256').update(bytes).digest('hex'), ...report.case,
    readyResult: ready.result, readyLeftCardNum: ready.leftCardNum, basicTimes: table.basicTimes,
    originalHeaven: table.tianHu, originalEarth: table.diHu, originalAllColors: table.quanHongHei });
  for (const observation of sample.observations.filter(item => item.originalWireBase64)) {
    const packet = Buffer.from(observation.originalWireBase64, 'base64');
    const result = vm.runInNewContext(`(${receive})(bytes)`, {
      bytes: new Uint8Array(packet), Uint8Array, DataView, cc: { mm: { config: { defaultByte: 4 } } },
      t: { huinan: { server: { proto } } }, console: { log() {} },
    }, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
    assert.equal(result.cmd, 9);
    assert.equal(result.data.hwResponseReadyForGame.result, 1020);
    assert.equal(result.data.hwResponseReadyForGame.leftCardNum, ready.leftCardNum);
    assert.equal(packet.readUInt32BE(0), packet.length);
    assert.equal(packet.toString('ascii', 4, 8), 'HNFR');
    rawChecks.push({ file: name, command: result.cmd, leftCardNum: ready.leftCardNum,
      packetSha256: createHash('sha256').update(packet).digest('hex'), parsedByOriginalReceiver: true });
  }
}
assert.equal(new Set(records.map(record => JSON.stringify([record.gameId, record.wangNum, record.qiWangNum]))).size, 8);
assert.ok(rawChecks.length >= 3);
const report = { at: new Date().toISOString(), scope: 'Original waiting-room observations and original receiver checks only',
  sourcePath, sourceSha256: createHash('sha256').update(source).digest('hex'),
  samples: records.length, distinctOptions: 8, completedGames: 0, gameplayVerified: false, records, rawChecks, passed: true };
await writeFile(join(root, 'docs/rules/original-service-evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, samples: report.samples, distinctOptions: 8, originalReceiverChecks: rawChecks.length, completedGames: 0 }));
