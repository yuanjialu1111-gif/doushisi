# 原聊天消息与播放核验

2026-09-08。原界面、文案、素材和动画沿用 APK；本次修复自建服务端的消息解释与客户端异步生命周期，没有新增收费。

## 原页面契约

| 原功能 | 请求字段 | 允许值 | 原消费方式 |
| --- | --- | --- | --- |
| 快捷语音 | `ctype=1, mutualFaceId` | 整数 0 至 11 | 原文气泡与男女本地 `gameChat_n` |
| 普通表情 | `ctype=2, message` | `res_dss_chat_0` 至 `res_dss_chat_14` | 原 Spine `animation`，首轮完成隐藏 |
| 互动表情 | `ctype=3, mutualFaceId, mutualFaceToUid` | 编号 2 至 12，目标是同房已占用座位 | 原 prefab 移动到目标，播放动画后销毁 |

来源是原提取的 `CommonFaceController.js:52`、`CommonPlayerInfoController.js:39`、`FrameConfig.js:22`、`dss_gameController.js:838` 与 `dss_playerController.js:1086`，均位于 `outputs/apk-deep-analysis/modules/`。原互动 prefab 直接按钮为 `btn_1` 至 `btn_11`，控制器把后缀加一；嵌套的 `btn_0` 是装饰，不能作为额外入口。素材编号 1 虽存在，当前原 UI 不发送。

字段 `mutualFaceToUid` 名称含 UID，但控制器将它用作座位索引。服务端检查目标属于当前房间，并采用已登录连接的身份作为发送人；客户端伪造 frame UID 无效。服务端只广播规范字段，不照搬请求中的附带数据。未入房、已关闭房间、空座位、未知类型与非法素材名均拒绝。

兼容请求 `ctype=5/quickVoiceId` 会转换为原消费端能处理的 `ctype=1/mutualFaceId`；兼容的 `ctype=2/faceId` 转成原素材名。普通文字 JSON 聊天不是原快捷语音按钮。原语音录制类型 4 不在本次保留的快捷语音功能内。

## 异步生命周期

普通表情资源返回时核对请求次序、玩家模型和节点有效性，防止旧加载覆盖新表情。互动资源加载与移动结束时均核对房间、源玩家、目标玩家及其模型；目标离席或换座后取消动画并清理节点。完成回调不会重复销毁已销毁节点。

## 验证

`apps/server/test/original-wire.test.ts`通过真实 HWFR WebSocket 检查三类消息、边界、伪造身份、空座位、未入房和余额不变。`node --test tools/client-chat-lifecycle-test.mjs`包含5项检查，覆盖乱序加载、错误加载、退房、换座、延时回调与只清理一次。

`node tools/client-chat-validate.cjs`连接本机服务，使用两个原 Cocos 浏览器客户端调用原按钮处理器。需要 `PLAYWRIGHT_MODULE` 指向 Playwright Core，且安装 Microsoft Edge。它检查：

- 12条快捷语音的男女24段音频路径、有效时长、实际播放时钟和原文气泡；性别切换使用接收端受控资料。
- 15个普通表情的 Spine 轨道时间推进与首轮结束隐藏。
- 11个互动表情的原音效、起点、移动、目标位置、动画轨道时间推进及结束后销毁。
- 两种分辨率截图、页面异常以及发送者豆子余额不变。

报告和截图保存在 `client/validation/chat-fixtures/`。这是等待房间中的原客户端与自建服务验证；原按钮处理器调用不等于逐个屏幕坐标点击，浏览器音频播放也不等于 Android 扬声器验收。尚未将这些结果作为真实地方对局或完整原版 UI 对照通过的依据。
