# Retained Regional Rule Catalogue

Build with `pnpm --filter @dss/rules build`; tests run with `pnpm --filter @dss/rules test`.

- `catalogue`: frozen 21-entry release scope with `key`, `gameId`, `configurationIndex`, `name`, `ruleVersion`, `evidenceStatus`, `gameplayReady`, and the original room config. `originalVariants` retains all 28 extracted configurations for audit.
- `getRoomSpec(key, region?)`: original labels/layout groups, normalized option `fields`, effective defaults, display aliases, and unresolved server-default fields.
- `getDefaultOptions(key, region?)`: a fresh complete option map; no unverified server defaults are filled.
- `validateRoomOptions(key, input, region?)`: returns a new validated map or throws `RuleValidationError` with `issues`; rejects missing fields, wrong types, extra fields, and evidenced incompatible option combinations.
- `resolveVariantKey(gameId, { yifupai?, processType? })`: distinguishes `2:0`/`2:1` and resolves Ya'an blood-battle as `101:0` while preserving the request's original area in the caller's room snapshot.
- `baseScoreDecimal(wireBasicTimes)`: exact conversion of the original integer tenths to decimal text.
- `ruleGaps` / `getRuleGaps(key)`: machine-readable release state, product-resolved inputs, and behavior blockers. `rule-gaps.json` is the exported review artifact.

UI options retain their exact original types: checkboxes use 0/1, the deck selector uses boolean, and choices use integers. A compatibility adapter must explicitly normalize decoded protobuf booleans to the corresponding option type and discard only known transport fields before calling strict validation. Do not submit the entire create message as a rule map, since it also contains fields for Mahjong and other removed variants.

Do not assume `playerNum` or `basicTimes` exists in every original configuration. IDs 14/15 omit player count; many variants omit base score. The local product resolves these inputs by requiring an explicit host choice: `playerNum` for 14/15 and positive `baseBeans` for every room. Those are product rules, not inferred original defaults.

Rule version is `apk-4.0-options-v1`. Persist the actual returned version on each room/replay. The 21 retained configurations have digest-bound, approved release rulebooks, and 21/21 are counted as `gameplayReady` because none is blocked by the rule-gap ledger. That count means "not blocked from opening by missing rule-gap evidence"; it is not the final physical-device completion result. Successful option validation still does not by itself authorize dealing or settlement, and `localReady`/`releaseReady` remain false until the two-phone acceptance is complete.
