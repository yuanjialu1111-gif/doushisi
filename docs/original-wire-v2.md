# Original HWFR version 2 contract

The frame and original protobuf message numbers remain unchanged. MsgData field
60000 is one length-delimited UTF-8 JSON object:

```ts
{
  version: 2,
  decimalFields: [],
  request?: {
    commandId: string,
    roomId: string, // UUID, not the six-digit display code
    expectedRoundId?: string,
    expectedStateVersion?: number
  },
  roomState?: {
    roomId: string | null,
    roundId: string | null,
    stateVersion: number | null
  },
  ack?: { commandId: string },
  error?: { code: string, message: string }
}
```

Client requests may send only version, an empty decimalFields array, and request.
Commands 23 (DoAction) and 53 (Piao) require all four request properties. Commands
121 (Auto) and 125 (CancelAuto) require commandId and roomId. A commandId is 8-100
ASCII letters, digits, underscores or hyphens; the scheduled- prefix is reserved.
The room UUID always comes from the server cursor. Header uid is never identity.

Responses acknowledge protected requests using ack.commandId. Failures echo a
valid request ID even when another request property is invalid. The response
roomState belongs to the authenticated player's current room, including when an
old accepted command is retried after that room ends. No current room means all
three cursor values are null. A waiting room has only a roomId.

The client updates roomState in ordered FrameServer dispatch, before the original
controller handles that message. Reconnection loads a fresh room snapshot. The
client never silently resends a stale action with a newer state version.

## Bean balance notifications

`wallets.balance` is the only player balance. Original `goldNum` remains a
compatibility field whose V2 `decimalFields` value is the exact bean balance.
After a committed administrator adjustment, first-round room fee, round
settlement, scheduled settlement, or unanimous-dissolution settlement, every
live original-protocol connection for the affected player receives
`HWNotifyUserDataChange` (46) with `uid`, `changeType: 0`, and exact
`goldNum`. The notification is emitted from persisted `balance_after` values,
not a client-supplied amount or an uncommitted read. Replayed ledger operations
and an unchanged connection balance do not create another notification.

The login reply is sent before a connection may receive an unsolicited balance
notification. A committed balance change that races login is held until after
that reply and then projected once. Heartbeats retain a read-based fallback for
changes made outside the local process.

Regional engines must explicitly provide an original-protocol adapter. Decoding
a wire action is a pure function of command and body, independent of the current
snapshot. Frozen room rule versions select the adapter for historical retries.
Missing adapters fail closed. Test adapters do not count as playable rule engines.

## Integration Status

Metadata validation, protected action routing, persisted original responses, and
viewer-specific reconnect adapter hooks are implemented. Viewer-specific ordered
game packets are archived with each accepted action/start and dispatched in event
order. Each connection tracks its own last event sequence. Reconnection takes a
room-locked snapshot and enters the same queue as room notifications, preventing
older animations from being delivered after the recovered snapshot.

Server type checking and all 62 server tests pass, including 7 new original-wire
checks covering malformed metadata, seat identity, stale states, idempotency,
packet order, Piao, self-only autoplay, reconnect and settlement retries. These
are synthetic transport fixtures. No regional production engine is registered.

An adapter's response is persisted in the immutable action event. Retrying an
accepted action returns that exact response even after settlement or another
round starts. The server cursor accompanying the response remains current.

## Adapter Boundary

`RuleEngine.original` is optional for existing archived engines and mandatory for
an original client to start play. It provides `decodeAction`, `response`, `enter`
and `notifications`. Notifications must put the original action/animation flow
before the next candidate operation messages. The server persists each viewer's
packet list separately; adapters must exclude other players' hidden cards.
Callbacks receive cloned data. Responses are generated inside the same
transaction as the action and rolled back if projection fails.

Automatic actions use the same notification hook. Replay animation projection,
regional packet contents and native animation/UI validation still depend on
verified regional adapters and remain unfinished. This interface does not claim
that the original APK can already play a complete regional game.
