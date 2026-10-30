# 最终交付检查清单

审计日期：2026-10-03。本清单只列最终交付必须包含的内容、证据绑定要求和当前完成状态。任何一项未完成，都不得宣称最终交付完成。

## 一、最终必须包含的产物

### 1. 21项规则书

必须包含 `4,5,6,7,8,9,10,11,12,14,15,16,19,20,21,22,23,24,25,26,27` 各 `:0` 配置，共21项。

每项至少包含：

- `rulebook.json`：`schemaVersion=1`、`status=approved`、`basis`、`variantKey`、`ruleVersion`、批准记录描述和覆盖范围。
- `cases.json`：参考案例、覆盖项、`ruleVersion`、`rulebookDigest`。
- `approval.json`：`kind`、`ruleVersion`、`variantKey`、`statement`、`evidenceReference`、`recordedAt`。
- `manifest.json`：规则书和案例路径、SHA-256、`generatedAt`。

当前状态：21/21目录与四类文件齐全，关键字段和摘要一致，21/21规则书为approved。`node tools/check-rulebook.mjs`当前通过，输出21配置、21 approved rulebooks、21 registered runtime engines、170 links、11 source hashes；历史源哈希漂移已修复，最终发布仍以最终运行结果为准。`coverage.json`中的`fullRoomVerifiedConfigurations`仍为0，这是研究索引字段，不能手工改成21；当前189/189自动完整房间结果由`verification/local-completed-games.json`单独证明。

### 2. Windows 运行包

必须提供可独立启动的Windows本地包，包含运行所需运行时、服务端二进制、后台与客户端静态资源、启动/停止脚本、状态检查、备份与隔离恢复入口。

包内必须携带最终构建清单和源码/二进制指纹，且与最终验收报告绑定的 releaseSubject 一致。

当前状态：Windows启动、停止、备份和隔离恢复工具已在本地运行环境使用。最终Windows运行包必须在两台实体手机真机验收完成后生成并绑定最终构建，因此当前仍不能宣称交付完成。

### 3. 正式 APK

必须使用项目既有签名密钥构建正式APK，服务地址与最终局域网配置一致，不得用验收版或旧地址包冒充正式包。

当前状态：正式APK为`client/android/doushisi.apk`，SHA-256为`0dff70d0b2cfc20a4cdc1fdc93b05e72177282211f5be4cc3cb657b7086f8187`，当前releaseSubject为`320d23884f2db1d234305e077cf9b2c3275d9ef262e79a1fa5153b6ef869c595`。APK已生成，但仍需由两台实体手机完成绑定该哈希的正式验收。

### 4. 测试报告

至少必须包含：

- 类型检查与项目测试结果。
- 21项规则案例与发布审计结果。
- 21项配置的完整房间矩阵结果。
- 账目、恢复、界面、网络验收结果。
- 20客户端至少7200秒稳定性验收结果。
- 两台实体Android真机验收结果。

当前状态：302/302发布测试通过；21/21配置和21个生产注册引擎已验证；189/189完整房间矩阵通过；UI、账目、网络、恢复、完整房间和稳定性报告均绑定当前releaseSubject`320d23884f2db1d234305e077cf9b2c3275d9ef262e79a1fa5153b6ef869c595`；13项PostgreSQL原始检查通过。当前稳定性验收为20客户端、7220.0241978秒、9960局、0故障、0账错、0状态丢失，动作P95为240.4244毫秒，发牌P95为283.8327毫秒。

### 5. 真机验收报告

必须使用至少两台实体Android手机，与服务器处于同一Wi-Fi，不依赖ADB reverse/forward，覆盖注册、豆子充值、创建/加入、完整对局、结算、托管、重连、动画回放、大厅定位（「附近」只显示档位；房内不再用 GPS）、快捷语音和局域网直连。

当前状态：`verification/local-native.json`仍为旧构建的失败报告，`devices=[]`，失败代码`DEVICE_NOT_AUTHORIZED`，且其APK哈希与当前正式APK不一致。ADB当前未列出任何设备，无法执行要求两个不同设备序列号的预检。自动化报告已全部重新生成并绑定当前releaseSubject；真机验收仍需两台不同实体Android手机，模拟器不算。

### 6. 启动、停止、备份、恢复说明

必须说明Windows本地服务的启动、停止、状态检查、备份、恢复和隔离恢复流程，并保留现有账号与账目。

当前状态：文档和脚本已有基础说明，但最终Windows运行包尚未绑定最终构建，相关说明仍需在最终包上重新验证。

## 二、证据绑定规则

- 实体真机验收必须绑定最终APK哈希。报告中的 `apkSha256` 必须等于最终正式APK的 SHA-256，且设备安装的APK哈希必须与报告一致。
- 稳定性验收必须绑定最终源码构建。报告中的 `subjectSha256` 必须等于最终 releaseSubject。
- UI、账目、网络、恢复和完整房间报告同样必须绑定最终 releaseSubject；旧构建报告不能复用。
- 最终 releaseSubject 由源码、二进制、`client/public` 和正式APK共同决定。任何一项变化都会使旧报告失效。
- 模拟器、自动截图、`physical:false` 记录和合成数据不能替代实体真机验收。
- 备份恢复测试必须使用隔离数据或备份副本，不得对现有业务数据库执行破坏性测试。

## 三、当前尚未完成项

截至2026-10-03，当前未完成的门禁项目是：

1. 连接两台不同的实体Android手机，与服务器处于同一Wi-Fi，不使用`adb reverse/forward`，先运行预检，再完成十三项真机检查，并生成绑定正式APK哈希`0dff70d0b2cfc20a4cdc1fdc93b05e72177282211f5be4cc3cb657b7086f8187`和releaseSubject`320d23884f2db1d234305e077cf9b2c3275d9ef262e79a1fa5153b6ef869c595`的报告。
2. 真机报告通过后，生成正式生产报告（`original-ui-comparison.json`、`original-network-isolation.json`、`gameplay-capacity.json`、`postgres-concurrency.json`和`native-end-to-end.json`）。当前`node tools/package-production-acceptance.mjs .`会因`LOCAL_NATIVE_APK_MISMATCH`失败，不能绕过。
3. 真机报告和生产报告生成后，按正式流程运行最终`pnpm local:check`、`node tools/package-production-acceptance.mjs .`、`pnpm release:check`、再次`pnpm local:check`，再生成绑定最终构建的Windows运行包并在包上复核启动、停止、备份和隔离恢复说明。

正式验收命令必须显式传入APK路径并安装APK，例如：

```powershell
pnpm android:acceptance-driver:build
& '<ADB程序完整路径>' devices -l
pwsh -NoProfile -File tools/run-local-native-acceptance.ps1 `
  -DeviceA <手机A序列号> `
  -DeviceB <手机B序列号> `
  -Adb '<ADB程序完整路径>' `
  -ApiBase 'http://192.168.1.17:3000' `
  -ApkPath '<工程根目录>\client\android\doushisi.apk' `
  -Stage acceptance `
  -InstallApk
```

先用`-Stage preflight`预检，确认两台设备已授权、互为不同实体机型且未使用ADB转发；预检只写`local-native-preflight.json`，不会删除或覆盖已有的`local-native.json`。

正式交付顺序：`pnpm local:check` → `node tools/package-production-acceptance.mjs .` → `pnpm release:check` → 核对`node tools/print-source-fingerprint.mjs --subject`仍为当前releaseSubject → 再次`pnpm local:check` → `pwsh -NoProfile -File tools/package-local.ps1 -Destination <全新且不存在的绝对目录>`。导出包首次启动需先`configure`，再`restore`或`local:setup`。不得用`-AllowIncomplete`作为正式交付路径。

## 四、完成判定

只有同时满足以下条件，才可判定最终交付完成：

- 21项规则书齐全且发布审计通过。
- Windows运行包和正式APK均由最终构建生成，哈希与清单一致。
- 全部自动化验收报告绑定最终 releaseSubject。
- 稳定性报告满足至少7200秒、20客户端真实对局、账目错误为零、状态丢失为零。
- 两台实体Android真机报告绑定最终APK哈希，且十三项检查全部通过。
- `pnpm local:check` 通过。

在上述条件全部满足前，`releaseReady` 和 `localReady` 不得改为true，也不得对外宣称已具备最终发行条件。
