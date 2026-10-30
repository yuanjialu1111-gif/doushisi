# D03 牌堆、王/癞子与张数：静态 APK 复核

日期：2026-09-09。状态：**证据不足，D03 继续未定稿。**

这份独立记录只重查用户提供 APK 和工作区已有的本地研究材料。没有执行原 Cocos 模块、连接原服务器、使用外部网页或修改玩法引擎、规则定义和开房配置。

## 可复核的事实

| 证据 | 原始位置 | 能确定的内容 | 不能确定的内容 |
| --- | --- | --- | --- |
| 扑克牌 SpriteAtlas | `work/apk/assets/assets/dss/import/7c/7c953d7a-1743-4d67-afb2-3c28aa7df5db.json` | 资源名有 `101–113`、`201–213`、`301–313`、`401–413`，即四组各 13 张的**牌面资源**；另有 `1001`、`1002`、`1003`、`1004`、`1007`、`1012` 六个特殊数字资源名。 | 资源名和图片数量不等于实体牌张数；同一资源可绘制多张牌，且牌背、条件替换图均不能计为实体牌。 |
| 特殊编码与显示 | `work/apk/assets/assets/dss/index.js`，`dss_gameController.getValue`，第 488–489 行；`dss_tools.getCard`，第 4432–4435 行 | 客户端把 `1001/1002/1003` 显示/整理为特殊值，并在盐津四彩二精开启时把输入 `107/207/307/407` 的**显示资源**替换为 `1004`。 | 它不说明 `1001–1003` 在每个地区的实体数量、是否进牌堆或任何计点、万能和判胡规则；`1004` 的存在不表示增加实体牌。 |
| 火十四开房文案 | `work/apk/assets/assets/main/index.js`，`FrameGameConfig`，第 2235–2280 行；已提取副本 `outputs/apk-deep-analysis/modules/main/FrameGameConfig.js:327–372` | 原 UI 显示“一副牌：6个10，6个7（4个7加大小王），6个4”和“两副牌：8个10，12个7（8个7加4个大小王），8个4”；“白皮”开关说明为“白皮当癞子可以替换成任意牌”。 | 文案没有枚举完整牌堆，不能据此推导 52、59、62、109 等总张数，也不能确认白皮的实体数量和所有玩法中的作用。 |
| 服务器下发计数 | `outputs/apk-deep-analysis/modules/dss/dss_gameModel.js:64–72`、`:154–163`；`work/apk/assets/assets/main/index.js:23351–23380` | 协议 `CardInfo` 有 `cardValue` 和 `num`；游戏开始/重连时客户端将服务端下发的 `cardInfo` 写入 `tipsCards`，用于剩余牌提示。 | 当前没有原服务端对局包，因此没有实际 `cardInfo` 值、完整牌堆或重复数可恢复。 |

`1001/1002/1003` 的图像身份（黑色 Joker、红色 Joker、印有“花牌”的面）已由已有的本地卡面裁剪研究直接查看，见 [研究记录](../research-chat-followup/README.md) 与 [卡面拼图](../research-chat-followup/card-resources.png)。该研究同样明确：视觉资源不构成实体牌数证据。

## 对 D03 的结论

静态包可以证明客户端具备 52 种普通牌面的显示资源、若干特殊牌面资源，以及个别玩法的王/白皮/7 相关开房文案。它不能证明“普通底牌每种恰好一张”、王和额外 7 的每种数量，或任何地区的完整发牌牌堆。

因此，以下内容仍是候选方案，不能写入原版一致规则或启动对应玩法引擎：

- `52` 张普通实体牌的基线；
- 雅安默认 `6` 王、`8` 个 7 推出总数 `62` 张；
- `1001/1002/1003` 在所有玩法中分别固定为小王、大王、白皮，或它们的重复数量；
- Sprite `1004/1007/1012` 代表额外实体牌。

下一条能决定 D03 的证据需要来自原服务端可读规则实现，或至少一局原服务器完整起手/牌流消息（含 `GameStart.cardInfo`、发牌、剩余牌、动作和结束数据），并标明具体开房配置。没有这些证据时，应保持 `runtimeEngineEntries` 为空并拒绝真正开局。

## 复现

在共享工作区根目录执行：

```powershell
node outputs/doushisi/docs/rules/research-d03/verify-d03-evidence.mjs
```

输出的 [evidence-verification.json](evidence-verification.json) 记录已校验的 SHA-256、原文锚点的行号和 UTF-8 字节偏移、牌面资源列表和非结论。脚本只读静态文件；原 APK 仍在默认路径时会一并重算它的 SHA-256。若 APK 位于别处，可传入：

```powershell
$env:D03_APK_PATH = 'X:/path/to/original.apk'
node outputs/doushisi/docs/rules/research-d03/verify-d03-evidence.mjs
```

当前复核结果：52 个普通牌面资源、59 个数字命名资源、8 个静态原文锚点全部通过；没有得到可定稿的实体牌堆定义。
