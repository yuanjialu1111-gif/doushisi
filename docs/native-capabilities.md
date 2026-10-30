# 原生定位与快捷语音核验

本文只记录 APK 静态链路和设备检查方法，不把静态结果当成真实 GPS 定位或扬声器播放验收。原生 APK 的完整构建方法在 `client/README.md`。

## 定位链路

定位桥在 `client/android/native/StandaloneLocation.smali`，没有使用原 Baidu SDK：

1. `start(Context)` 分别为 `gps` 和 `network` 注册主线程 Looper 监听，间隔 5 秒。每个 provider 独立捕获异常，缺失 GPS 或近似定位权限不阻断网络定位注册。
2. `onLocationChanged(Location)` 不在应用内额外缓存坐标；`stop(Context)` 移除监听器。每次读取都经过系统权限与 provider 启用状态检查，撤销权限后不会复用应用内的精确定位缓存。
3. `AppActivity.getLatitude/getLongitude` 调用 `getLatest(Context)`，分别读取可用 provider 的系统 last-known location，按 `getElapsedRealtimeNanos()` 选择较新的结果；两者都不可用时返回 `0.0`。
4. AndroidManifest 保留 `ACCESS_FINE_LOCATION` 和 `ACCESS_COARSE_LOCATION`。首次申请同时提交两项权限以支持 Android 12+；用户仅授予粗略定位后可以继续使用系统提供的近似坐标。客户端进入房间仍沿用原消息的 `lat`/`lon` 字段。

`lat=0.0, lon=0.0` 是原协议“没有可用定位”的值。应用不能绕过用户权限；模拟器的 provider 存在也不等于取得了有效 fix。当前尚未定义 last-known location 的最大有效年龄，两种来源都没有新 fix 时仍可能返回较旧结果；生产环境还需核对隐私告知、系统定位开关和 GPS 超时策略。

静态检查：

```powershell
node tools/client-native-capabilities-static.mjs
```

它核对 `LocationManager` 的 GPS/network 注册、回调、解除监听、Activity 读取路径、权限和 Baidu 依赖残留，并检查原始 dss 音频包。指定恢复的 Apktool 目录和原 APK 资源目录：

```powershell
node tools/client-native-capabilities-static.mjs C:/path/to/work/client-native-build C:/path/to/work/apk/assets/assets
```

## 快捷语音链路

原 dss 脚本的 `dss_tools.playSound`、`playGameSound` 和玩家 `onShowText` 使用 `cc.mm.soundManager.playSound`，路径形如 `res/sound/man/Man_7`、`res/sound/chatwoman/gameChat_2` 和 `res/sound/games/dss_sounds_dapai`。这些资源在 APK 的 `assets/dss/native` 中，Cocos 资源配置在 `assets/dss/config.json`；它们不是旧服务器下载的语音。

原 protobuf 虽定义 `EN_CHAT_TYPE_QUICK_VOICE = 5` 和 `quickVoiceId`，但保留的原页面实际发送 `ctype=1, mutualFaceId=0..11`；接收端按此编号显示原文并播放本地男女音频。原 dss 控制器只消费类型 1、2、3，不消费类型 5。服务端现在接受原按钮消息，并把兼容类型 5 转换成类型 1；不能依据枚举名称推定原页面协议。完整字段与白名单见[聊天契约](original-chat-v1.md)。

静态脚本会检查本地 `res/sound` 播放调用、兼容 protobuf 字段、原始聊天语音数量、关键局内音效和 dss 包内不存在远程 URL。Cocos 原生音频文件按 UUID 存放，脚本通过 `dss/import/*.json` 的逻辑名到 UUID 映射核验资源，不要求文件名直接包含 `dss_sounds_*`。静态检查不能证明音频设备输出成功。`client/validation/chat-fixtures/report.json`另行记录两个浏览器原客户端通过自建 WebSocket 发送12条快捷语音、男女共24段本地音频的实际播放时钟；这仍不代表 Android 扬声器验收。

## 设备只读检查

Windows 没有 Docker 或真实物理设备时，只能先运行只读设备检查。脚本不安装 APK、不授予权限、不设置 mock location、不改网络：

```powershell
./tools/client-native-capabilities-device.ps1 -Adb 'D:/leidian/LDPlayer14/adb.exe' -Serial emulator-5554
```

可用已连接的 Android 设备，不传 `-Serial` 时使用 adb 当前选择。可用 `-ReportPath C:/secure/native-capabilities.json` 保存检查结果；报告不包含连接口令。

脚本只调用 `adb devices -l`、`dumpsys package net.doushisi.standalone`、`dumpsys location` 和 `dumpsys power`。需要人工核对：应用已安装、定位权限为 granted、GPS/network provider 存在且设备处于唤醒状态。权限未授予或 provider 关闭时，不能把返回的 `0.0` 当成通过。

## 实际设备验收步骤

1. 在测试账号登录后授予精确定位权限，打开系统定位；记录进入房间时的系统设置和服务端收到的坐标是否为非零合理值。测试日志不得记录账号密码。
2. 分别关闭 GPS、只保留网络定位、拒绝权限和断网，确认客户端不崩溃，服务端按约定处理缺失坐标；恢复权限后重新进入大厅，确认监听恢复、「附近」页签重新出现（2026-10-30 起房内不再定位）。
3. 让两名玩家进入同一房间，点击原定位入口，核对同桌位置展示和服务端房间成员，不把客户端显示文本当成权限证明。
4. 逐个使用原聊天面板中的快捷语音编号，分别测试男女本地音效、断网播放、后台恢复和音量为零；记录每个编号是否有可听输出。保留原快捷语音顺序和资源，不从网络补下载。
5. 强制停止、重启和断线重连后重复定位与语音检查。检查 logcat 中无 `SecurityException`、音频加载失败或未经允许的外部 URL。

当前限制：没有在本轮声称真实 GPS fix、物理设备定位精度、音频扬声器输出、每个语音编号覆盖或所有 Android 厂商兼容性已经通过。原始音频素材保留并由本地 Cocos 资源系统加载，不等于这些验收项已经完成。

本次已在 `emulator-5554` 执行只读检查，结果见 `client/validation/native-capabilities-device.json`。设备可用且 GPS provider 存在，但精确和粗略定位权限均未授予，network provider 未检出。报告的 `passed` 仅表示诊断命令成功、应用已安装且设备唤醒，不表示定位或语音功能通过验收。

## 模拟器定位桥验证

`client/validation/location-emulator.json` 绑定安装包 SHA-256 和定位桥源码哈希。八项设备 instrumentation 检查通过：全部拒绝权限、缺失 network 的 GPS、GPS 关闭后的 network、新 network 替换旧 GPS、新 GPS 替换旧 network、只授粗略权限、撤销全部权限、系统定位总开关关闭。已检查目标应用 UID 的监听注册，并实际读取 Android 返回的合成坐标；粗略权限场景接受系统模糊处理后的近似值。

重跑前安装当前游戏 APK，并使用与游戏一致的签名密钥。签名密码通过 `DOUSHISI_KEYSTORE_PASSWORD` 环境变量提供：

```powershell
./tools/client-location-emulator.ps1 `
  -JavaHome C:/path/to/java17 `
  -ApktoolJar C:/path/to/apktool.jar `
  -BuildTools C:/path/to/android-build-tools `
  -KeyStore C:/private/doushisi.jks
```

脚本只允许模拟器，要求初始没有 network provider 和已有 shell mock provider；安装临时测试 APK，在实际游戏 Activity 前台注入合成位置，用广播确认注入完成后读取坐标。结束后恢复权限、系统定位开关及 shell mock app-op，移除测试 provider 并卸载测试 APK，再读取状态核对恢复结果。测试程序不包含在交付游戏 APK 中。

这些结果不覆盖物理定位精度、权限弹窗操作、原协议房间坐标传输、语音输出或所有 Android 厂商兼容性，也不证明定位回调次数。完整游戏验收仍未完成。

## 失效定位与原窗口

原协议入桌和重入请求明确携带`lat=0, lon=0`时，服务端清除当前认证成员自己的房内定位缓存，向同桌广播剩余距离，再返回`GPS_REQUIRED`。后续省略坐标不能找回已失效的缓存；获得新定位后可重新入桌。兼容路径只允许现有成员在省略两个字段时沿用缓存。非法坐标、其他房间或伪造消息UID不会删除他人位置，也不新增成员或收费。`apps/server/test/original-wire.test.ts`包含这些回归场景。

原`LocationUI`每次刷新先清空已有距离，并只显示实际占用座位的头像；窗口打开时收到`HWNotifyLocation`立即刷新。`node tools/client-location-validate.cjs`使用与其他浏览器检查相同的`PLAYWRIGHT_MODULE`和`SHARP_MODULE`，验证两种分辨率下的失效清空、重新定位、再次打开及1/3号座位。截图和报告在`client/validation/location-fixtures/`，使用受控距离，不代表原版在线对局对照。
