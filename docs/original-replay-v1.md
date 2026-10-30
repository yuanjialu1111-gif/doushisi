# Original Replay Version 1 Contract

HWRequestPlayBack (305) still takes the round's numeric wire recordId.
HWResponsePlayBack (306) returns result=1 and field 60000 contains:

```ts
replay: { version: 1, roomId: string, roundId: string, manifestUrl: string }
```

The manifest URL is `/api/records/{roomId}/replay/{roundId}/original`.
Both HTTP endpoints require `Authorization: Bearer {player session token}`.
Only a participating player can read a settled round; administrator roles cannot.
The viewer must not belong to any non-closed room. Waiting, playing and
between_rounds all count as live rooms, matching RoomService.current. A live room
returns HTTP 409 REPLAY_WHILE_IN_ROOM from the manifest and page endpoints; 305
returns failed 306 with that extension error and no replay reference. Authorization
is rechecked after verification, and cached pages obey the same restriction.
Another participant's live room does not block the current viewer.

```ts
interface Packet {
  command: number;
  body: Record<string, unknown>;
  decimalFields: { path: (string | number)[]; value: string }[];
}
interface Frame {
  index: number; // zero is the complete initial snapshot
  sequence: string;
  stateVersion: number;
  at: string;
  autoPlay: boolean; // viewing player only
  snapshot: Packet; // command 48, complete viewer-specific room snapshot
  packets: Packet[]; // ordered messages for advancing from the preceding frame
}
interface Manifest {
  version: 1;
  roomId: string;
  roundId: string;
  variantKey: string;
  ruleVersion: string;
  number: number;
  endReason: 'completed' | 'dissolved';
  digest: string; // SHA-256 of this viewer's verified replay
  frameCount: number;
  framesUrl: string; // manifestUrl + '/frames'
  initial: Frame;
  limits: { maxPageFrames: 50; maxPageBytes: 1048576 };
}
interface Page {
  version: 1;
  digest: string;
  frameCount: number;
  offset: number;
  nextOffset: number | null;
  frames: Frame[];
}
```

GET framesUrl with `?offset=1&limit=50&digest={manifest.digest}` to advance.
Offset can address any frame directly for seeking. The response may contain fewer
than limit frames to respect the byte limit. Use nextOffset, never assume a full
page. At offset=frameCount, frames is empty and nextOffset is null. Digest mismatch
returns HTTP 409 REPLAY_VERSION_CONFLICT; reload the manifest.

Apply each packet's decimalFields to its corresponding decoded original message.
Packet bodies are normalized protobuf JSON: omitted default values and empty
arrays must be restored with the original message type's `fromObject` method
before dispatch, then apply decimalFields. Paths include the original MsgData
body field (for example hwResponseEnterTableFinish), as in live protocol v2.
Snapshot 48 restores a frame directly; packets play only while advancing one
frame. Initial frame packets is empty because its snapshot already includes the
initial deal. Playback dispatch must not update the live room cursor or submit
live commands. The client uses autoPlay to restore only the viewer's local mode.

After dispatching snapshot 48 and creating its player models, enqueue a local 123
packet with an empty body when frame.autoPlay is true, or a local 126 packet with
result=1 when it is false. False must be restored explicitly when seeking back
from a true frame. Use the same replay generation and ordered dispatch queue;
never send request 121/125 over the live socket. The patched player model must
retain its isSelf guard because these original messages have no seat identity.
Ordinary frame playback already includes the viewer's own 123/126 transitions;
other players' autoplay events have no such packet and cannot change this flag.

The server checks room membership when replay data is requested. A room joined
later from another session is a subsequent state change; the client must still
end replay if it receives a new live-room cursor, and discard queued replay
messages using the replay generation guard.

Limits: 10001 frames, 262144 bytes per frame, 24 MiB per verified viewer replay,
50 frames and 1 MiB per HTTP page. The manifest contains only frame zero; field
60000 never contains the frames. Raw action bodies, other users' hidden cards,
deck state and deal policy are never returned.

The server is implemented and isolated end-to-end tests cover 305/306, manifest,
multi-page playback, arbitrary seeking, process scores, own and other autoplay,
earlier-round scores, unanimous dissolution, projection mismatch, access denial,
stale digests and byte limits. No regional production engine or original adapter
is registered by this work. Native UI playback still requires client integration
and verified regional adapters.

Verification compares rebuilt notifications for every seat to the immutable
archive before returning the viewing seat's packets. It also checks original
request decoding and archived action replies. Room snapshots are reconstructed
with the frozen adapter, earlier round results and durable confirmed scores;
historical profiles are not available, so nickname/default avatar use current
account display data. The manifest digest changes if those display data change.

Verified projections are cached for 30 seconds with a 32 MiB total limit and four
concurrent rebuilds. Membership and settled-state authorization are checked again
for every page, including cache hits. HTTP responses use private, no-store.

The shared replay reader now orders events by numeric database sequence. Its
previous text-alias ordering could place sequence 10 before sequence 2.

Validation: all 70 server tests pass, including eight original-replay checks;
server TypeScript type checking passes. Tests use isolated databases and synthetic
adapters. The local service was subsequently rebuilt and restarted with these endpoints.

The recovered client was then rebuilt and installed on the local emulator. A
client passed 38 isolated replay tests plus a controlled browser projection at
1334x750 and 844x390. The fixture is synthetic and does not qualify any of the
27 regional rule engines for production play.
Follow-up validation adds a live-room regression across waiting/playing/between
states and cached pages. The combined original replay/wire suite passes all 12
checks after this restriction.
