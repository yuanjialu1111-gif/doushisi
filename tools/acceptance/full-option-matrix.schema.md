# Full-Option Room Matrix Evidence Schema

`ROOM_MATRIX_MODE=full-options` writes a separate evidence pair and never overwrites the canonical
`local-completed-games.json` artifacts used by the default acceptance path.

## Artifacts

- Formal report: `verification/local-option-matrix.json`
- Formal raw report: `verification/raw/local-option-matrix.json`
- Smoke report: `verification/local-option-matrix-smoke.json`
- Smoke raw report: `verification/raw/local-option-matrix-smoke.json`

The formal run requires a fresh build manifest. Smoke runs may use a variant filter and are always
marked `smokeOnly: true` and `acceptanceEligible: false`.

## Report Contract

The report and raw report contain these fields:

- `schemaVersion`: currently `1`.
- `mode`: `full-options` or `full-options-smoke`.
- `smokeOnly`: boolean; formal evidence must be `false`.
- `acceptanceEligible`: boolean; formal evidence must be `true`.
- `subjectSha256`: the build subject digest observed before and after the run.
- `coverage`: counts and missing lists for single values, pairwise combinations, known conflicts,
  and explicit uncovered branches.
- `cases`: every executed case with its variant, kind, assignments, option readback result,
  settlement count, replay digest, and pass/fail state.
- `summary`: executed, valid, rejected, and passed case counts.
- `checks`: independently derived pass/fail checks for the coverage contract.

## Coverage Contract

- Every retained configuration has one executable case for every non-structural option value.
- `basicTimes` is probed at `0.1` and `1` for every retained configuration.
- Every pair of non-structural option fields has executable coverage, with invalid pairs recorded
  separately rather than silently skipped.
- Known conflicts include the 9:0 through 12:0 player-score combinations, 14:0 and 15:0 player
  counts, 24:0 `ownBaKeQiang` values, and the two Rongxian 20:0 conflicts.
- A valid case creates a real isolated room, completes exactly one settled round, reads the
  normalized options back, performs two independent replay rebuilds, and dissolves the room.
- A rejected case must fail `rooms.create()` with the expected conflict message.
- `3:0` eight-tens and `101:0` blood-battle routing are recorded as `outside-retained` uncovered
  branches because they have no runtime engine in the retained 21-configuration scope.

## Non-Goals

This matrix does not replace the canonical 189-cell player-count and round-count acceptance grid.
It proves option-value and pairwise creation/readback/settlement/replay behavior for the retained
configuration set without changing production engine code.
