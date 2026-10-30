# admin 进度（2026-10-30）

状态：三项都做完，构建通过。没碰 git，没装依赖，没起服务（用的是已在跑的 127.0.0.1:3000）。

## 改了哪些文件

- `apps/admin/src/App.tsx`（366 → 539 行，新页面都留在这个文件里，因为 Modal、Pager、useResource 这些公共组件没有导出，拆文件就得先重构）
- `apps/admin/src/api.ts`：新增类型 `AvatarItem`、`LobbyVariant`、`LobbyTemplate`，给 `Player` 加了头像字段；新增 `mediaUrl()`、`isMissingEndpoint()`、`MISSING_ENDPOINT`；错误解析同时支持 `{error:{code,message}}` 和顶层 `{code,message}`
- `apps/admin/src/styles.css`：`select` 沿用 input 的样式；`.avatar img`；`.avatar-grid` 和 `.avatar-card`（只用了现有颜色）；手机宽度下导航按钮不折字；`.wallet-table` 手机布局适配新加的列；`.number-input` 单位不换行

## 每项功能在哪

1. **玩家列表**（`Wallets`）：第一列新加「头像」，显示缩略图，`avatarStatus==='rejected'` 时下面显示「已驳回」。用户列去掉了原来的首字占位，`nicknameRejected` 为真时显示「昵称已驳回」。操作列加了「驳回头像」「驳回昵称」两个按钮，没有可驳回的头像或昵称已经驳回过时按钮置灰（否则服务端会回 409 NOTHING_TO_REJECT）。驳回弹窗是 `Rejection`：原因先去掉首尾空格再算字数，必须 1–200 字，提交成功后刷新列表并弹出提示。
2. **头像审核页**（`AvatarReview`，导航「头像审核」，两种管理员都能看）：网格卡片显示头像、昵称、账号、上传时间、状态（使用中 / 已驳回）和「驳回头像」「驳回昵称」两个按钮，带分页。
3. **大厅桌模板页**（`LobbyTemplates` 加 `TemplateEditor`，导航「大厅桌模板」，只有豆子管理员能看到）：
   - 列表显示玩法、底分 / 人数 / 局数（summary 为 null 时显示「—」）、常驻空桌、门槛倍数、清座时限、状态、排序、当前桌况（几桌 · 几人），每行有「编辑」按钮。
   - 新建和编辑共用一个表单。玩法下拉选中后，options 预填该玩法的 `defaults`。底分输入框和 2/3/4 人选择直接写进 options JSON 里的 `baseBeans`（字符串）和 `playerNum`，管理员在 JSON 框里看到的就是实际提交的内容。JSON 解析失败会当场提示，并且不能保存。数字字段的默认值和范围：常驻空桌 3（0–20）、门槛倍数 10（1–1000）、清座时限 10 分钟（1–120），排序默认取现有最大值 +1。
   - 服务端返回的错误直接显示其 message。返回 404 且不带 `{error:{code}}`（就是 Fastify 的「路由不存在」）时，列表和保存都显示「服务端尚未提供该接口」，页面不会崩。
- 头像地址：`mediaUrl()` 只放行根相对路径（`/media/...`、`/client/...`）和 http(s) 地址，原样使用，跟 `/api/admin` 同源。图片加载失败时退回显示首字。

## 验证

- `pnpm --filter @doushisi/admin build`（tsc 加 vite）：通过。
- `tools/admin-validate.cjs` **没有跑**，原因有三：它写死用 `msedge` 启动，这台 Mac 只装了 Chrome；它把截图写到 `verification/`，这个目录不归我；它会真的给 player_one 加豆、改发牌策略。它依赖的选择器我都保留了：行内按钮「调整」「账目」名称精确不变，「策略审计」导航不变，390px 下不出现横向滚动。
- 改用临时脚本做了检查，脚本放在 `/private/tmp/claude-501/-Users-mac-Documents-Projects----/67ab40d4-468c-492d-baa5-b9bab90050d3/scratchpad/admin-check.cjs`：用 playwright-core 加本机 Chrome，连本地 3000 端口。结果 **ALL OK**，页面 0 报错。具体覆盖：
  - 豆子管理员：列表头像列和缩略图能加载；驳回弹窗的原因校验（空白不能提交、上限 200 字），点取消，没有真提交；390 和 360 宽度下不横向溢出；大厅桌模板页在真实 404 下显示「服务端尚未提供该接口」，「新建模板」按钮置灰。
  - 模板表单（拦截接口、用假数据）：预填 defaults；底分和人数写进 options；JSON 报错当场提示；常驻空桌超出范围有提示；切换到不需要底分的玩法后 options 重置、底分框消失；POST 的 body 符合契约；服务端 400 的 message 能显示；PUT 返回 404 时提示未提供接口。
  - 发牌管理员：导航只有「发牌策略」「策略审计」「头像审核」，头像审核页能正常加载。
  - 本地库里没有人上传过头像，所以审核网格和「已驳回」「昵称已驳回」标签是用假数据看的效果，截图正常。

## 对服务端接口的疑问和建议

1. **本地 `pnpm dev` 看不到头像**：`apps/admin/vite.config.ts` 只代理了 `/api`，`/media` 和默认头像的 `/client` 都没代理。这个文件不归我改，建议主会话在 proxy 里加上 `'/media'` 和 `'/client'`，都指向 `http://127.0.0.1:3000`。生产环境和直接访问 3000 端口都没问题。
2. **错误格式**：契约写的是 `{code,message}`，现有服务端实际回的是 `{error:{code,message}}`。前端两种都认，建议 M2 继续用 AppError（嵌套格式）。界面会直接显示 message，所以模板校验的 message 最好写中文。目前 zod 的 INVALID_REQUEST 和 `rooms.ts` 里开房校验（如 `Base beans must be positive.`）回的都是英文。
3. **PUT 找不到模板时**：请用 AppError 带上 code（比如 `TEMPLATE_NOT_FOUND`）返回 404。前端把「404 且没有 code」当成接口未提供，有 code 时才会显示 message。
4. **字段规则**：契约没写 `sortOrder` 的范围，前端暂时接受 ±999999 内的整数。`thresholdMultiplier` 前端按整数处理，如果服务端允许小数，请告诉我。
5. **options 里的 baseBeans**：玩法 `needsBaseBeans=false` 时，前端会拦住 options 里的 `baseBeans`，这跟 `rooms.ts` 开房时拒收这个字段一致。M2 校验模板时建议直接复用开房的那套校验。
6. **驳回入口**：`/api/admin/users` 只给 beans_admin 用，所以发牌管理员只能从「头像审核」页驳回，这符合需求。
