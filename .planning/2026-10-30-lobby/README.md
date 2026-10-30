# 并行开发契约：斗十四大厅改版（2026-10-30）

依据：`docs/requirements/斗十四大厅-需求简报.md`（R1–R11）、`docs/plan/斗十四大厅-开发计划.md`。

## 红线（每个子智能体都要守）

1. 不写真实密钥；签名钥匙只放 `~/.doushisi-signing/`，不进源码目录。
2. 不推送、不部署、不碰 git（主会话统一提交）。
3. 不读线上玩家数据，不连生产服务器。
4. 不手改 `client/public/assets/*/index.js`。
5. 玩家照片去掉附带信息（服务端已用 sharp 重新编码）。
6. 停进程只用 `kill <PID>`，只停自己起的进程。
7. 不扩大范围；不装依赖（npm/pnpm/brew 都不装）；只改 ownership.md 里归自己的文件。

## 接口契约

已实现（M1）：
- `GET /api/admin/users?query=&page=` → `{ users:[{id,username,nickname,avatarHash,avatarStatus,nicknameRejected,avatarUrl,balance,online}], total, page, pageSize }`
- `GET /api/admin/avatars?page=` → `{ items:[{userId,username,nickname,nicknameRejected,avatarHash,avatarStatus,uploadedAt,avatarUrl}], total, page, pageSize }`
- `POST /api/admin/users/:id/avatar-rejection` `{reason}` → `{ok:true}`（两种管理员都可）
- `POST /api/admin/users/:id/nickname-rejection` `{reason}` → `{ok:true}`
- 头像地址 `/media/avatars/<uuid>-<hash32>.jpg`，被驳回或不存在时 302 到默认灰头像。

M2 待实现（主会话写服务端，后台按此先做界面）：
- `GET /api/admin/lobby-templates`（仅 beans_admin）→
  `{ templates: Template[], variants: [{ key, name, defaults: object, needsBaseBeans: boolean, needsPlayerNum: boolean }] }`
- `Template = { id, variantKey, variantName, options, standingEmpty, thresholdMultiplier, idleClearMinutes, enabled, sortOrder, summary: { baseBeans: string, playerNum: number, rounds: number } | null, openTables: number, seatedPlayers: number, updatedAt }`
- `POST /api/admin/lobby-templates`、`PUT /api/admin/lobby-templates/:id`，body：
  `{ variantKey, options, standingEmpty, thresholdMultiplier, idleClearMinutes, enabled, sortOrder }`
  - `options` 与玩家开房 `POST /api/rooms` 的 options 同形；需要手填底分的玩法放 `options.baseBeans`（字符串），需要手选人数的放 `options.playerNum`。
  - 不提供删除，停用用 `enabled:false`。
  - 校验失败返回 `{code,message}`（400/409），界面直接显示 message。

## 业务暂定值（AI 暂定，后台可改）

| 项 | 值 |
|---|---|
| 常驻空桌 | 3 |
| 门槛倍数 | 10 |
| 清座时限 | 10 分钟 |
| 首个模板 | 新津斗十四 4 人 8 局 |
