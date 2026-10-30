import { proto as generatedProto } from './generated.js';
import { MSGEvent } from './commands.js';
import { commandBodyFields } from './body-fields.js';
export { MSGEvent } from './commands.js';
export { commandBodyFields } from './body-fields.js';

export interface ProtobufCodec {
  create(input?: Record<string, unknown>): Record<string, unknown>;
  fromObject(input: Record<string, unknown>): Record<string, unknown>;
  toObject(message: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;
  verify(message: Record<string, unknown>): string | null;
  encode(message: Record<string, unknown>): { finish(): Uint8Array };
  decode(bytes: Uint8Array): Record<string, unknown>;
}

export const proto = generatedProto as unknown as Record<string, ProtobufCodec>;
export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const commandNames: Readonly<Record<number, string>> = Object.freeze(Object.fromEntries(
  Object.entries(MSGEvent).map(([name, id]) => [id, name]),
));
export interface FrameHead {
  cmd: number;
  uid?: string;
  channelId?: number;
  protoVersion?: number;
  mainVersion?: number;
  subVersion?: number;
  deviceId?: string;
  deviceName?: string;
  macAddr?: string;
  os?: string;
  osv?: string;
  clientTime?: string;
  serverTime?: string;
}
export interface DecodedFrame {
  head: FrameHead;
  cmd: number;
  data: Record<string, unknown>;
}
export class ProtocolError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ProtocolError'; }
}

const headCodec = proto.MsgHead!;
const bodyCodec = proto.MsgData!;
const plainOptions = { longs: String, enums: Number, bytes: String, defaults: false };

function encodeMessage(codec: ProtobufCodec, value: Record<string, unknown>): Uint8Array {
  const message = codec.fromObject(value);
  const problem = codec.verify(message);
  if (problem) throw new ProtocolError('INVALID_PROTOBUF', problem);
  return codec.encode(message).finish();
}

/** Original layout: [BE length excluding itself][HWFR][BE head length][head][BE body length][body]. */
export function encodeFrame(head: FrameHead, data: Record<string, unknown>): Uint8Array {
  if (!Number.isInteger(head.cmd) || !commandNames[head.cmd]) throw new ProtocolError('UNKNOWN_COMMAND', 'Unknown command identifier');
  const header = encodeMessage(headCodec, { channelId: 1, protoVersion: PROTOCOL_VERSION, ...head });
  const body = encodeMessage(bodyCodec, data);
  const size = 16 + header.length + body.length;
  if (size > MAX_FRAME_BYTES) throw new ProtocolError('FRAME_TOO_LARGE', 'Frame exceeds maximum size');
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  view.setUint32(0, size - 4, false);
  result.set([72, 87, 70, 82], 4);
  view.setUint32(8, header.length, false);
  result.set(header, 12);
  view.setUint32(12 + header.length, body.length, false);
  result.set(body, 16 + header.length);
  return result;
}

export function decodeFrame(input: Uint8Array | ArrayBuffer): DecodedFrame {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 16) throw new ProtocolError('TRUNCATED_FRAME', 'Frame is shorter than its fixed fields');
  if (bytes.length > MAX_FRAME_BYTES) throw new ProtocolError('FRAME_TOO_LARGE', 'Frame exceeds maximum size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== bytes.length - 4) throw new ProtocolError('LENGTH_MISMATCH', 'Frame length does not match payload');
  if (view.getUint32(4, false) !== 0x48574652) throw new ProtocolError('BAD_MAGIC', 'Expected HWFR frame magic');
  const headLength = view.getUint32(8, false);
  if (headLength > bytes.length - 16) throw new ProtocolError('TRUNCATED_HEAD', 'Header extends past frame');
  const bodyOffset = 16 + headLength;
  const bodyLength = view.getUint32(12 + headLength, false);
  if (bodyLength !== bytes.length - bodyOffset) throw new ProtocolError('BODY_LENGTH_MISMATCH', 'Body length does not match remaining frame');
  try {
    const head = headCodec.toObject(headCodec.decode(bytes.subarray(12, 12 + headLength)), plainOptions) as unknown as FrameHead;
    const data = bodyCodec.toObject(bodyCodec.decode(bytes.subarray(bodyOffset)), plainOptions);
    if (!Number.isInteger(head.cmd) || !commandNames[head.cmd]) throw new ProtocolError('UNKNOWN_COMMAND', 'Unknown command identifier');
    return { head, cmd: head.cmd, data };
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError('INVALID_PROTOBUF', error instanceof Error ? error.message : 'Invalid protobuf payload');
  }
}

export function expectedBodyField(command: number): string | undefined {
  return commandBodyFields[command];
}

/** Call before dispatch so a command cannot carry a different request or several requests. */
export function assertCommandBody(frame: DecodedFrame): void {
  const expected = expectedBodyField(frame.cmd);
  const fields = Object.keys(frame.data);
  if (fields.length !== 1 || fields[0] !== expected) throw new ProtocolError('COMMAND_BODY_MISMATCH', 'Command must contain exactly its matching MsgData field');
}
