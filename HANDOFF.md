# 当前任务（2026-10-30，新会话追加；下方原交接说明未改动）

- **任务**：大厅公开桌 + 首次上传头像昵称 + 附近桌子。
- **状态**：简报、计划都已确认（10-30）；M0 底座完成（迁移 010、系统账号 `system-lobby`、sharp、敏感词表 `apps/server/data/sensitive-words.txt`、红线扫描 `pnpm redline`），服务端 710 个测试全过。
- **下一步**：M1 资料与头像（R6–R9）：`profile.ts`、`avatars.ts`、6 处头像出口、接入层资料设置浮层。客户端改动只在 `standalone.js` 里做（原版 APK 资源不在本机，`client-prepare.mjs` 不能重跑）。
- **关键文件**：`docs/requirements/斗十四大厅-需求简报.md`（R1–R11）、`DECISIONS.md`、方案图 https://claude.ai/artifact/TF467m5uNcJYC55RvjwQNe

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
