# Original Rule Catalogue Attribution

The Chinese labels, option tooltips, layout metadata, and defaults in `src/original-catalogue.ts` are reproduced from the user-supplied APK `org.hwqp.cocos2d.sluggardRecreation` version 4.0, `FrameGameConfig` module. No license declaration was present in that module. They are not relicensed as original project code. The exact source hash is in `extraction-evidence.json`.

This package validates the room options exposed by that client. It is **not a game engine**. The 21 retained configurations have digest-bound, user-approved release rulebooks; the other 7 extracted configurations remain audit-only. Creating a valid option snapshot does not by itself authorize dealing or settlement: the backend must also honor the rule-gap ledger. Dynamic region options, product-resolved inputs, and behavior blockers are exposed through `getRuleGaps`.

`basicTimes` retains its original wire integer in tenths of a bean: `1` means `0.1`, `10` means `1`. `baseScoreDecimal()` returns the exact decimal text. This avoids silently changing the original protocol.
