# APK Protocol Compatibility

Build with `pnpm --filter @dss/protocol build`; tests run with `pnpm --filter @dss/protocol test`.

```ts
import { decodeFrame, encodeFrame, assertCommandBody, MSGEvent } from '@dss/protocol';
const request = decodeFrame(incomingBytes);
assertCommandBody(request);
const response = encodeFrame(
  { cmd: MSGEvent.HWResponseRegister, uid: accountId },
  { hwResponseRegister: { result: 0 } },
);
```

`decodeFrame(Uint8Array | ArrayBuffer)` returns `{ head, cmd, data }`. Long integers become decimal strings, enums remain numbers, unset fields are omitted. `encodeFrame(head, data)` adds channel 1 and protocol version 1 unless explicitly overridden, preserving all original field numbers. `proto` exposes the 165 original message/enum definitions; message codecs have `create`, `fromObject`, `encode`, `decode`, `verify`, and `toObject` methods. Use `expectedBodyField(cmd)` to resolve the original message-body field. Several names differ from the command's spelling, so lowercasing the command name is unsafe.

The body validator must run before dispatch. It rejects missing, mismatched, and multiple requests. This package contains original types for all commands; server handlers must allowlist the retained operations and authorize every request. In particular, exposing a codec does not authorize matchmaking, buying items, or deleting records.

Raw original `goldNum` is int64 and cannot represent fractions. Exact decimal balances require a separately specified extension and client changes; do not silently round decimal balances into that field. Original `basicTimes` is integer tenths (1 means 0.1 score), not an int64 bean balance.

The independently specified heartbeat fixture, bounds checks, int64 roundtrip, and original registration/create request tests are static compatibility verification. No live original-server packet capture or APK runtime interchange has been verified.

To reproduce extraction, run `node packages/protocol/tools/extract-apk.mjs <path-to-main-index.js>` from the workspace root after installing dependencies. This uses an AST to isolate the protobuf module and command map; it never executes the whole APK.
