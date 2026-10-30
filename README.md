# Dou Shi Si Standalone

This is an implementation in progress, not a completed game release. New rooms support 21 configurations: 20 Dou14 regional games plus Ya'an red-twenty, including Qionglai. The original 28 configurations remain archived as historical evidence. All 21 configurations are implemented and production-registered, covered by 21/21 approved independent rulebooks, a 189/189 isolated completed-room matrix and 299/299 release tests. `pnpm local:check` still fails only because the physical-device acceptance report is failed or stale; `localReady` and `releaseReady` remain false, and the engines are not a claim of byte-for-byte equivalence with the retired original server.

Qionglai's three additional switches default on and are frozen at room creation and restored on reconnect. The retained independent definitions are approved; this does not claim original-server equivalence. Public deployment is deferred; this build targets Windows LAN operation.

## Run locally

Requires Node.js 24 and pnpm 11.19.0. Run `pnpm build`, then `pnpm local:start`. The service is available at `http://192.168.1.17:3000/client/`; the administrator panel is `/admin/`. Use `tools/local-run.ps1` for status, stop, backup and isolated restore. Manual backup requires the service to be running, and restore requires both the `.tgz` archive and its same-named `.tgz.json` sidecar; stop the service before restoring.

An exported package does not include this machine's credentials, source tree, or pnpm. For its first start, run `configure`, then `start`; to restore existing data in a new package, still run `configure` first, then `restore`, then `start`. Without a backup, run `configure` first, then initialise a separate empty database and local administrators from the package root. A fresh `configure` selects `apps/server/.local/database`, so set `LOCAL_DATABASE_DIR` to that path before running `.\runtime\node.exe apps/server/dist/local-setup.js`; without the variable the setup program itself defaults to `.local/database`. Credentials are written to `.local/local-access.json`.

Current release subject: `53bdaf077c9d101ba7f8a3add8a2e3a6f06d3ddc6c3d8995a7a8dd8b0fef5c14`. The formal APK is `client/android/doushisi.apk`, SHA-256 `eb81fcdd088dbfc00275fe8a36912692b8a9534d51e36789f9ffae24b4522fe8`. Do not substitute `client/android/doushisi-acceptance.apk`.

## Scope and accounting

Players use one bean balance. Registration starts at zero beans. The service keeps immutable ledger entries, exact decimal transfers and separate bean and dealing administrator roles. Players can still create rooms and join by a six-digit room code. The lobby (2026-10-30) also lists public tables: system tables kept open from admin templates, plus player rooms created with “公开到大厅”. Public tables are always AA and need beans of at least base × the template multiplier (default 10). Quick start seats the player at the fullest affordable table. A “nearby” tab shows distance bands only. Location is used only in the lobby; rooms never ask for it or show distances. First login requires an uploaded avatar, a nickname and a sex. The retired original services stay disabled.

All retained configurations require a positive manually entered base bean amount. Wenchuan and Maoxian require an explicit 2/3/4 player choice. Room options and the rules version are frozen for the room and replay.

## Current limitations

The current automatic evidence covers 21/21 approved configurations, 21 production-registered engines, 189/189 isolated completed-room combinations, 299/299 release tests, the 13 PostgreSQL checks, accounting, recovery, UI, network and the current stability run (20 clients, 7,233.677127 seconds, 10,440 completed games, action P95 226.57 ms, deal P95 275.32 ms, zero failures, ledger errors or state losses). The immediate acceptance blocker is two different physical Android phones on the same Wi-Fi: registration, bean credit, create/join, a completed round, settlement, auto-play, reconnect, animated replay, lobby location (nearby bands only; rooms no longer use GPS) and quick voice without `adb reverse`. Emulators do not count. The existing native preflight and acceptance reports are failed and stale. After phone acceptance, the four formal production reports, a fresh bound preflight report and Android build reports still need to be produced; packaging currently rejects the Android build reports because they lack a current-subject binding. `localReady` and `releaseReady` remain false until those items are resolved.

See [current implementation](IMPLEMENTATION-UPDATE.md), [regional record](docs/regional-implementation-20260909.md), and [Qionglai review](docs/rules/QIONGLAI-REVIEW.md).
