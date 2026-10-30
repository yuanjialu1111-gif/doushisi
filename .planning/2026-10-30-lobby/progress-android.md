# 安卓打包进度（android 子会话，2026-10-30）

状态：脚本和原生补丁已写完，离线能验证的都验证过了。还没装工具，没打出真包，也没上真机。

```
打包：基础 APK（只读）→ apktool 解包到 ~/.doushisi-android/work → 套清单模板 → client-native-patch
      → apktool 回包 → zipalign → apksigner 签名并校验 → 对齐和内容检查 → ~/.doushisi-android/out/*.apk + .json
启动：main.js → 3 秒内拿 /client/native/manifest.json → 比 APK 内置版新吗？
      ├ 否 / 超时 / 出错 ─────────────────────────→ 用内置 standalone-native.js
      └ 是 → 有本地缓存且哈希对 → 用缓存
             └ 否则 6 秒内下载 → sha256 对 → 写缓存后运行（抛错就删缓存，退回内置版）
```

## 交付文件
| 文件 | 作用 |
|---|---|
| `tools/android-tools-install.sh` | 把 JRE 21、apktool 3.0.3 和 build-tools 35 装到 `~/.doushisi-android`（版本固定，校验 sha256，不用 sudo）。安卓 SDK 许可要你在终端里自己点同意 |
| `tools/android-keygen.sh` | 生成 `~/.doushisi-signing/doushisi-release.jks`。只生成一次，已有就不覆盖；证书指纹存到 `.cert-sha256`，打包时会自动核对 |
| `tools/android-build.mjs` | 一条命令打包。versionCode 默认是基础包加 1（基础包现在是 4 / 4.0） |
| `tools/client-native-patch.mjs` | 原生补丁：AppActivity 转发选图结果、接管定位、加 FileProvider；把配置和内置脚本描述写进 main.js |
| `tools/android-native-adapter.mjs` | 生成 `client/public/native/{standalone-native.js,manifest.json}`；加 `--check` 只校验不写 |
| `tools/android-selftest.mjs` | 离线自测，只需要 Node |
| `client/android/native/StandaloneMedia.smali`、`StandaloneMediaTask.smali`、`StandaloneLocation.smali`（新增 requestPermission）、`client/android/res/xml/standalone_media_paths.xml` | 选图和定位的原生代码 |
| `AndroidManifest.xml` | 清单模板：加了 FileProvider，不申请 CAMERA 权限；正式包不带 AcceptanceReceiver |
| `assets/main.js` | 热更新加载器，含纯 JS 写的 SHA-256 |
| `client/public/native/*` | 当前 version 1793388491，sha256 `e8b20ec3…ce4bc4`（主会话 M4 改完后重新生成；以后每改 standalone.js 都要重跑生成器） |

## JS 和原生的调用约定
- **选图**：`jsb.reflection.callStaticMethod('net/doushisi/standalone/StandaloneMedia', 'pick', '(Ljava/lang/String;)V', 'album' 或 'camera')`
- **选图回调**：每次 pick 只回调一次，在 GL 线程上调 `window.StandaloneNative.onImage(base64Jpeg, error)`。
  - 成功：error 是空字符串；图片是 JPEG，最长边不超过 512，质量 85，已去掉 EXIF。
  - 失败：base64Jpeg 是空字符串，error 是 `cancelled`、`permission` 或 `failed`。
- **定位**：`callStaticMethod('net/doushisi/standalone/StandaloneLocation', 'requestPermission', '()V')`。它先切到 UI 线程，没授权就弹授权框，已授权就开始监听。读坐标仍用 `AppActivity.getLatitude()` / `getLongitude()`，返回字符串，拿不到时是 `"0.0"`。
- **能力探测**：先判断 `window.STANDALONE_CONFIG && window.STANDALONE_CONFIG.nativeApi >= 1`，成立才调上面两个。旧 APK 里没有这两个类，直接调会报错。
- **脚本来源**：`window.STANDALONE_NATIVE_SOURCE = { kind: 'bundled' | 'cache' | 'hot', version, sha256, reason }`
- **清单格式**：`{ "version": 整数, "sha256": "64 位十六进制", "path": "/client/native/standalone-native.js" }`。服务器把 `client/public` 挂在 `/client/` 下（`apps/server/src/app.ts:345`），所以不用改服务器。
- **部署**：每次改完 standalone.js，先跑生成器，再把 `client/public/native/` 跟着发布。不发也不会出错，手机会继续用 APK 内置的那版。

## 验证结果（本机，2026-10-30）
- **语法和隐藏字符**：`node --check` 跑了 6 个 js/mjs，`bash -n` 跑了 2 个脚本，全部通过。U+FEFF / U+2028 / U+2029 扫描干净。
- **生成器校验**：`node tools/android-native-adapter.mjs --check` 结果 OK。主会话在这期间还在改 standalone.js，我重新生成了两次；它改完后还要再生成一次。
- **离线自测**：`node tools/android-selftest.mjs` **293 项通过，0 失败**。覆盖：
  - 纯 JS SHA-256 和 node:crypto 对拍：标准测试向量，包括 100 万个 a；另有 800 多条字符串，含中文、emoji、孤立代理字符、块边界长度和随机串。
  - 加载器模拟 21 种情形：新版下载、用缓存、缓存被改过、清单和内置版相同、服务器版本更旧、哈希不符；清单超时、不响应、断网、404、不是 JSON、路径越界、指向外域；脚本超时、返回 500；热脚本抛错；缓存写不进；最慢启动 8.998 秒；没有配置。
  - 生成器的版本号逻辑。
  - 补丁在两种合成解包树上各跑两遍：结果幂等；覆盖 androidx 和 smali_classes2；验收开关打开再关掉。
  - smali 逐条静态自查：寄存器范围、invoke 参数个数、4 位寄存器格式、标签、try/catch、move-result、常量范围、字段类型。另有 13 个故意写错的样例，全部被查出来。
  - 对照基础 APK 的 dex：所有引用都找得到，静态和实例一致；17 个 jsb.reflection 调用目标都是静态方法。
  - 基础 APK 的对齐检查通过。
- **没装工具时的表现**：直接跑 `android-build.mjs` 和 `android-keygen.sh`，都给出中文提示后退出，不建任何目录。

## 只能装好工具后或在真机上验证
- 打包环节：apktool 解包和回包、apksigner 签名和 verify、dex 真正过安卓校验（我的自查只是静态检查）。
- 选图：相册、相机、拒绝权限、中途取消。有的相机 APP 不认 EXTRA_OUTPUT，会回 `failed`。拍照回来时 Activity 可能已被系统回收重建，也要试。
- 定位：首次弹授权框、拒绝后的表现、经纬度能读回来。基础包 minSdk 是 26，用到的 API 23/24 接口没有兼容问题。
- 热更新：从服务器拿新版、断网启动用内置版、启动耗时（最坏约 9 秒）。
- 测试机要先卸载旧版一次，因为签名换成了自己的钥匙。

## 主会话集成（2026-10-30，已完成）
- standalone.js：原生定位改调 `StandaloneLocation.requestPermission`，选图和定位都先查 `nativeApi >= 1`（M4 提交 bcede2f）。
- main.js：**只有 https 服务器才热更新**，明文 http 包一律用内置版（reason `insecure-origin`），自测加了这一条，共 300 项通过。

## 原先需要主会话改 standalone.js 的三条（已做）
1. 原生定位改调 `StandaloneLocation.requestPermission ()V`。现在 `app.gameserver.requestLocation` 那段还是在 GL 线程上调 `AppActivity.requestLocation`，能用，但新入口会切到 UI 线程，更稳。
2. 调 `StandaloneMedia.pick` 或 `requestPermission` 之前，先判断 `STANDALONE_CONFIG.nativeApi >= 1`。
3. 改完 standalone.js 后跑一次 `node tools/android-native-adapter.mjs`。

## 注意
- edition-config、replay、decimal 不走热更新，改了要重新打 APK。
- 热脚本如果跑到一半抛错，前半段已经执行，之后内置版会再跑一遍。所以脚本开头不要有不能重复执行的副作用。
- 现网基础包里有一个**对外开放的 AcceptanceReceiver**；正式包会去掉它，只有加 `--acceptance` 才保留。
- 旧的 Windows PowerShell 打包流程会删掉 FileProvider，用那个流程打出来的包，相机选图会失败。根目录下的 `assets/standalone-native.js` 是旧文件，现在没有地方用它。
- **经度问题**：原生取坐标没问题，补丁后经纬度都从 StandaloneLocation.getLatest 读。错的是浏览器路径：`hall/index.js:768` 写的是 `cc.mm.gameserver.longitude = t.coords.locationIng`，属性名两边都拼错了，结果永远是 undefined。它只在浏览器里、并且开了 GPS 建房时才会执行。bundle 不能手改；standalone.js 浏览器分支自己写了 `game.locationIng`，不受影响。

## 需要你运行的命令（按顺序）
```bash
bash /Users/mac/Documents/Projects/斗十四/tools/android-tools-install.sh
bash /Users/mac/Documents/Projects/斗十四/tools/android-keygen.sh
node /Users/mac/Documents/Projects/斗十四/tools/android-native-adapter.mjs
node /Users/mac/Documents/Projects/斗十四/tools/android-selftest.mjs
node /Users/mac/Documents/Projects/斗十四/tools/android-build.mjs --base /Users/mac/Documents/Projects/斗十四/线上部署包/doushisi.apk --api-base https://<域名>
```
