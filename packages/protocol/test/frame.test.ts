import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCommandBody, decodeFrame, encodeFrame, expectedBodyField, MAX_FRAME_BYTES, MSGEvent, proto } from '../src/index.js';

test('decodes an independently specified legacy heartbeat fixture', () => {
  // Original tags: MsgHead channelId=4, cmd=10; MsgData heartbeat=37.
  const packet = Buffer.from('0000001348574652000000042001502500000003aa0200', 'hex');
  const frame = decodeFrame(packet);
  assert.deepEqual(frame, { head: { channelId: 1, cmd: 37 }, cmd: 37, data: { hwRequestHeartBeat: {} } });
  assertCommandBody(frame);
});

test('encodes version one in the existing HWFR format', () => {
  const packet = encodeFrame({ cmd: 37 }, { hwRequestHeartBeat: {} });
  assert.equal(Buffer.from(packet).toString('hex'), '00000015485746520000000618012001502500000003aa0200');
});

test('original registration and room requests roundtrip without renumbering fields', () => {
  const register = { hwRequestRegister: { account: 'player100', password: 'test-password' } };
  assert.deepEqual(decodeFrame(encodeFrame({ cmd: MSGEvent.HWRequestRegister }, register)).data, register);
  const data = { hwRequestCreateTable: { roomType: 100, areaType: 6, gameNum: 4, playerNum: 3, useCardType: 2,
    basicTimes: 1, processType: 2, wangNum: 6, openGps: true, lat: 30.5, lon: 103.2 } };
  const frame = decodeFrame(encodeFrame({ cmd: MSGEvent.HWRequestCreateTable, uid: 'account-100' }, data));
  assert.deepEqual(frame.data, data);
  assert.equal(frame.head.uid, 'account-100');
  assertCommandBody(frame);
});

test('preserves int64 values outside JavaScript safe integers as decimal strings', () => {
  const data = { hwResponseGameLogin: { state: true, uid: 'u1', goldNum: '9007199254740993' } };
  const frame = decodeFrame(encodeFrame({ cmd: 2, serverTime: '9007199254740994' }, data));
  assert.deepEqual(frame.data, data);
  assert.equal(frame.head.serverTime, '9007199254740994');
});

test('retains original command/body spelling discrepancies', () => {
  assert.equal(expectedBodyField(MSGEvent.HWNottifyEnterTable), 'hwNotifyEnterTable');
  assert.equal(expectedBodyField(MSGEvent.HWRequestSetRoomCards), 'hwRequestSetRoomcards');
  assert.equal(expectedBodyField(MSGEvent.HWRequestQiFu), 'hwRequestQifu');
  assert.equal(expectedBodyField(MSGEvent.HWNotifyHaveEmail), 'hwNotifyEmail');
  for (const command of Object.values(MSGEvent)) assert.ok(expectedBodyField(command));
});

test('validates frame slices with nonzero byte offsets', () => {
  const frame = encodeFrame({ cmd: 37 }, { hwRequestHeartBeat: {} });
  const wrapped = Buffer.concat([Buffer.alloc(5), frame, Buffer.alloc(8)]);
  assert.equal(decodeFrame(wrapped.subarray(5, wrapped.length - 8)).cmd, 37);
});

test('rejects truncation, false lengths, invalid magic, invalid protobuf, and oversize', () => {
  const valid = encodeFrame({ cmd: 37 }, { hwRequestHeartBeat: {} });
  for (let size = 0; size < valid.length; size++) assert.throws(() => decodeFrame(valid.slice(0, size)));
  const corrupt = (offset: number, bytes: number[]) => { const packet = valid.slice(); packet.set(bytes, offset); return packet; };
  assert.throws(() => decodeFrame(corrupt(4, [0])), /magic/);
  assert.throws(() => decodeFrame(corrupt(8, [255, 255, 255, 255])), /Header/);
  assert.throws(() => decodeFrame(corrupt(18, [0, 0, 0, 99])), /Body length/);
  assert.throws(() => decodeFrame(corrupt(12, [255, 255, 255, 255, 255, 255])), /protobuf|range|index|varint/i);
  assert.throws(() => decodeFrame(new Uint8Array(MAX_FRAME_BYTES + 1)), /maximum/);
  assert.throws(() => decodeFrame(Buffer.concat([valid, valid])), /length/);
});

test('rejects command/body mismatch and multiple requests before dispatch', () => {
  const wrong = decodeFrame(encodeFrame({ cmd: 37 }, { hwRequestRegister: { account: 'a', password: 'b' } }));
  assert.throws(() => assertCommandBody(wrong), /matching/);
  const body = proto.MsgData!;
  const payload = body.encode(body.create({ hwRequestHeartBeat: {}, hwRequestRegister: { account: 'a' } })).finish();
  const packet = encodeFrame({ cmd: 37 }, { hwRequestHeartBeat: {} });
  const changed = new Uint8Array(packet.length - 3 + payload.length);
  changed.set(packet.subarray(0, 22));
  changed.set(payload, 22);
  const view = new DataView(changed.buffer);
  view.setUint32(0, changed.length - 4, false);
  view.setUint32(18, payload.length, false);
  assert.throws(() => assertCommandBody(decodeFrame(changed)), /exactly/);
});
