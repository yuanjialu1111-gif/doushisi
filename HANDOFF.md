# 当前任务（2026-10-30，新会话追加；下方原交接说明未改动）

- **任务**：大厅公开桌 + 首次上传头像昵称 + 附近桌子（R1–R11）。
- **状态**：M0–M6 都已在本机提交（main，没有推送，也没有部署）。全量测试 750 项通过，typecheck、build、红线扫描都通过；安卓离线自测 300 项通过。逐页自检时修了大厅在 16:10 和 4:3 窗口下被切的问题。待确认 3 条用户回「1B 2B 3B」，已改完并复测（退大厅桌回列表、公开房房主查门槛、接入层测试 18 项全过）。还没做：安卓真机打包和验证（命令由用户运行）。
- **下一步**：用户要上线时，先确认域名（APK 的 `--api-base` 要用 https），再写发布脚本，由用户点运行。
- **关键文件**：`docs/plan/验收清单.md`（AC→证据）、`docs/本地演示.md`、`.planning/2026-10-30-lobby/progress-android.md`（安卓打包命令和约定）。
- **注意**：改 `client/public/standalone.js` 后要跑 `node tools/android-native-adapter.mjs`，重新生成 `client/public/native/`。

---

# 斗十四源码交接说明

整理日期：2026-10-16。此包是原工作目录的**源码副本**，不含线上/本机数据，也不是正式成品或已通过真机验收的发布包。

## 从哪里开始

- `apps/server/src/`：服务端、房间、账本和原协议接口；`apps/server/migrations/` 为数据库迁移。
- `apps/admin/src/`：管理端源码。
- `packages/rules/src/`、`packages/protocol/src/`：地区规则与协议；各自的 `test/` 为单元测试。
- `client/public/`：可恢复的 Cocos 客户端资源、原编译脚本及独立版接入层；`client/android/native/` 是 Android Smali 补丁。
- `tools/`：构建、客户端恢复、Android 打包和验收脚本；`deploy/`、`compose.yaml` 为部署材料。
- `docs/rules/`：规则书；根目录 `README.zh-CN.md`、`IMPLEMENTATION-UPDATE.md` 为历史实施记录，内有整理时已过时的地址、哈希和阶段统计，不应直接当成当前环境状态。

## 首次构建

需要 Node.js 24+、pnpm 11.19.0（见 `package.json`），以及与目标环境匹配的数据库。解压后在根目录执行：

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

配置从 `.env.example` 开始，**不要复制旧环境账号或数据库**。独立的运行/迁移和 Android 签名要求请看 `README.zh-CN.md`、`client/README.md` 和相应脚本。Android 重建还需原 APK 或独立获得的 Apktool 解包工程、Java 17、Apktool、Android SDK 与自己的签名密钥；本包没有原 Creator 编辑器工程、原 Java 源码、原服务器源码或签名材料。

## 交付范围和状态

已排除 `.local/`、`apps/server/.local/`、`node_modules/`、构建 `dist/`、本机 Node 运行时、旧 `verification/` 与 `client/validation/` 截图日志、`work/`、APK、APK 签名旁文件及恢复工程压缩包。`client/public/assets/` 保留原客户端资源，接收方应确认其合法使用与再分发权限。部分脚本仍引用原工作区路径、局域网地址或本机工具链，需要在新机器上重新配置。

**当前未通过正式交付门槛。** 之前的自动化通过记录不代表本包已重新构建或测试；原工作记录显示两台不同实体 Android 手机的本地验收和正式生产报告仍缺失，模拟器不能代替真机。解压后的 `pnpm build` 会重新生成 `dist/`，并应以新生成的校验和测试报告为准。不要将此源码包描述为原始游戏完整工程或发布就绪版本。
