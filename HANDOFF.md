# 当前任务（2026-10-31 第二轮：M0–M7 已全部做完，等用户验收）

- **任务**：去掉地区只留新津斗十四、大厅桌 A2 样式、好友（找朋友 / 申请 / 私聊 / 邀请入座）、「好友约局」改「进入大厅」、设置弹框位置、个人资料（真实数据 + 勋章）、新加 8 个互动表情。
- **状态**：M0–M7 都已在本机提交（main）：M0 38d223d、M1 60728eb、M2 4f0ceed、M3 dff2030、M4 7ae79de、M5 c19378e、M6 e64a878（互动表情 13–20：`tools/extra-art.mjs` 画图，`client/public/extra/emotes/`；服务端只转发给登录时声明 `extra-emotes-v1` 的连接；牌桌上看别人资料的对局数/胜局/胜率改成真实值），M7 收尾提交。全量测试、typecheck、build、红线扫描、安卓离线自测 301 项、接入层测试 18 项都通过。**没有推送、没有部署。**
- **待确认 16–19（10-31 已处理）**：16 好友申请加固定附言（迁移 013，接入层选择窗，本机浏览器走查过）；17A 不改；18、19 用户定保持现状。
- **下一步**：用户运行 `bash tools/release-test-server.sh` 把第二轮整体发到测试服 108（APK 不用换，接入层走热更新）；然后真机验收。
- **关键文件**：`docs/plan/验收清单.md`（第二轮一节：S1–S7 每条 AC 的证据）、`docs/plan/斗十四第二轮-开发计划.md`、`docs/plan/待确认.md`。
- **注意**：改 standalone.js 后跑 `node tools/android-native-adapter.mjs` 和 `node tools/client-adapter-test.mjs`（18 项）；新函数先 grep 有没有重名；PGlite 只有一个连接，事务里调别的服务要把 tx 传进去；加迁移要同步改 `apps/server/test/database.test.ts` 的版本列表（M3 漏过，M7 补上）。

# 上一轮任务（2026-10-30）

- **任务**：大厅公开桌 + 首次上传头像昵称 + 附近桌子（R1–R11）。
- **状态**：M0–M6 都已在本机提交（main，没有推送，也没有部署）。全量测试 750 项通过，typecheck、build、红线扫描都通过；安卓离线自测 300 项通过。逐页自检时修了大厅在 16:10 和 4:3 窗口下被切的问题。待确认 3 条用户回「1B 2B 3B」，已改完并复测（退大厅桌回列表、公开房房主查门槛、接入层测试 18 项全过）。安卓工具链和签名钥匙用户已装好。后端已发布到测试服 108：1a90325，批次 20261031T035621Z，8 项自检全过，发布后服务没有报错（DEC-20261030-测试服发布）。回滚命令：`bash tools/release-test-server.sh --rollback 20261031T035621Z`。
- **下一步**：
  - 后台已对公网开放（DEC-20261031-后台对公网开放，10-31 用户运行 `--gateway`，自检 5 项全过）：`https://108.186.180.130/admin/`。
  1. 真机测：10-31 已换上新 APK（4.0 版本号 5，新签名，连 108），下载地址 `https://108.186.180.130/doushisi.apk`，测试机先卸载旧版。旧包备份在服务器 `/opt/doushisi/release-backups/apk-20261031T043329Z/`。
- **关键文件**：`tools/release-test-server.sh`（用法写在文件头）、`docs/plan/验收清单.md`（AC→证据）、`.planning/2026-10-30-lobby/progress-android.md`（安卓打包命令和约定）。
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
