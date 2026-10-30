# Original Protocol Attribution

`src/generated.js` is the isolated protobufjs-generated `hw_msg` module from the user-supplied APK, package `org.hwqp.cocos2d.sluggardRecreation`, version 4.0. `src/commands.ts` retains its original `MSGEvent` names and numeric identifiers. The upstream namespace `com.huinan.server.proto` is retained for wire compatibility. No license or copyright notice was present in the extracted module; extraction does not grant rights to the original application. It is not relicensed as original project code.

Extraction parses the bundle with Babel, selects only the generated codec, and removes Cocos registration and the shared protobuf root. It does not load the application or contact its servers. See `extraction-evidence.json` for source hash and locations. The generated module includes types used by removed game modes because removing message fields would break original field-number compatibility; their presence does not expose any server route.
