# 本地局域网运行

本机是自建服务器。电脑运行时，同一私有网络的手机可访问绑定地址；不提供公网连接。当前21个生产注册引擎、189/189完整房间矩阵和302/302发布测试已通过，但最终交付仍需两台不同实体Android手机完成真机验收，模拟器不算。

## 日常使用

初次配置在工程根目录运行 `pwsh -NoProfile -File tools/local-run.ps1 -Action configure -Address 192.168.1.17`。脚本核对网卡归属与私有网络，只允许本地子网访问3000端口。3001控制端口仅绑定127.0.0.1并验证本机随机令牌。不会改变网卡信任级别。

运行 `tools/local-shortcuts.ps1` 生成工程目录中的启动、停止、备份快捷方式。启动使用编译后的服务端，后台运行，不依赖Codex或开发终端。`tools/local-run.ps1 -Action status` 查询实际进程；若端口被其他服务占用，明确停止启动，不自动杀进程。

本机接口：`http://192.168.1.17:3000/client/`；后台为同一地址的`/admin/`。当前正式APK为`client/android/doushisi.apk`，SHA-256为`0dff70d0b2cfc20a4cdc1fdc93b05e72177282211f5be4cc3cb657b7086f8187`，releaseSubject为`320d23884f2db1d234305e077cf9b2c3275d9ef262e79a1fa5153b6ef869c595`。APK必须按相同地址构建；只有同网段手机可直连。路由器应为这台电脑保留此地址。地址变化后重新configure并用既有签名重建APK，不能继续使用绑定旧地址的APK。

正式APK的SHA-256是releaseSubject的组成部分，因此只要重建APK，subject就会变化，全部7份subject绑定报告（`local-ui.json`、`local-accounting.json`、`local-network.json`、`local-recovery.json`、`local-completed-games.json`、`local-stability.json`、`local-native.json`）都必须重新生成。正确顺序是先冻结APK与构建，再依次重跑自动化验收，最后做真机验收；不要用旧报告配新APK。

## 数据与备份

现有数据目录默认为`apps/server/.local/database`，不会重新执行空库示例初始化。两个管理员沿用原账号，密码不进入APK。独立运行包不附带本机账号凭据或数据；在新目录启动前应通过备份恢复现有数据，或用服务端管理员初始化工具创建独立管理员。导出包没有源码和pnpm，不能把源码工程里的`pnpm local:setup`当成包内命令。

启动前保存一次迁移前备份；每日北京时间03:00归档，离线错过时下次启动补做。最近14份保存在`.local/backups`，`latest.json`保存归档、日期、大小和哈希。这里包含私有账号和对局数据，请由电脑所有者保管；同磁盘备份不能抵御整盘损坏。

手动备份要求服务已运行：`tools/local-run.ps1 -Action backup`。PGlite通过数据目录快照API导出，不在写入中的数据库目录上直接复制文件。备份归档旁必须有同名`.tgz.json` sidecar；缺少sidecar时恢复会拒绝执行。

恢复步骤：先正常stop，再执行`tools/local-run.ps1 -Action restore -Archive <完整tgz路径>`，且归档与同名`.tgz.json` sidecar必须同时存在。脚本验证哈希，在全新隔离目录还原并核对钱包与账本总额、账目等式、迁移版本、账号/事件/牌局数量；通过后保存旧配置，改用验证后的数据目录。原目录不删除、不覆盖；未注册旧规则引擎时，不宣称已验证旧牌局重放。

恢复错误会保留原配置。回退时停止服务，恢复`.local/lan-config.json.*.previous`的相应配置并切回配套的旧程序版本，再start。程序更新不得覆盖原目录中的数据或签名凭据。

导出包不携带本机账号凭据、签名材料或现有数据目录。首次启动先在导出包根目录执行 `pwsh -NoProfile -File tools/local-run.ps1 -Action configure -Address <本机局域网地址>`，再执行 `pwsh -NoProfile -File tools/local-run.ps1 -Action start`。需要恢复既有数据时，新包仍要先configure生成配置；然后在start前执行 `pwsh -NoProfile -File tools/local-run.ps1 -Action restore -Archive <完整备份路径>`，最后start；归档旁同样必须有同名`.tgz.json` sidecar。没有备份而要新建独立环境时，不使用pnpm。先configure，再在包根目录运行：

```powershell
$env:LOCAL_DATABASE_DIR = Join-Path $PWD 'apps\server\.local\database'
.\runtime\node.exe apps/server/dist/local-setup.js
Remove-Item Env:LOCAL_DATABASE_DIR
```

新导出包执行configure时默认把服务数据目录设为`apps/server/.local/database`，因此上面的初始化命令显式设置`LOCAL_DATABASE_DIR`，确保初始化和随后start使用同一个库；`local-setup.js`自身在未设置该变量时默认使用包内`.local/database`。工具会创建空库、两个本地管理员和四个验证玩家，凭据写入包根目录的`.local/local-access.json`；遇到已有账号会拒绝重复初始化。初始化完成后再start。

## 验收边界

`pnpm local:check`检查本地验收；`pnpm release:check`保留正式发布检查。两者都要求真实规则和引擎，本地检查另外要求两个真实安卓设备、全部配置完整房间、20客户端两小时实际对局、无ADB局域网运行和恢复证据。待验收项保持失败，不能用启动截图代替完整对局。这些命令只在带源码和依赖的工程中运行；导出包内没有pnpm。

## 2026-10-03 当前验收状态

21/21配置、21个生产注册引擎、21/21规则书approved、189/189完整房间矩阵、302/302发布测试和13项PostgreSQL检查均已通过。当前稳定性验收为20客户端、7220.0241978秒、9960局、0故障、0账错、0状态丢失，动作P95为240.4244毫秒，发牌P95为283.8327毫秒。当前releaseSubject为`320d23884f2db1d234305e077cf9b2c3275d9ef262e79a1fa5153b6ef869c595`，UI、账目、网络、恢复、完整房间、稳定性和PostgreSQL报告均已重新生成并绑定该主体。`localReady`与`releaseReady`仍为false。

当前`local-native.json`和`local-native-preflight.json`都是旧一批未通过报告；真机验收仍缺少至少两台不同实体Android手机。ADB当前未列出任何设备，预检要求显式提供两个不同的设备序列号，因此不能生成绑定当前APK的报告。真机验收要求同Wi-Fi且不使用ADB reverse/forward，并完成注册、豆子充值、创建/加入、完整对局、结算、托管、重连、动画回放、定位和快捷语音。模拟器或`physical:false`报告不能满足。

正式验收命令必须显式传入APK路径并安装APK：

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

先用 `-Stage preflight` 做预检，确认两台设备已授权、互为不同实体机型且未使用ADB转发；预检通过后再执行上面的正式验收。预检只写入`local-native-preflight.json`，不会归档、删除或覆盖已有的`local-native.json`，因此正式验收通过后仍可安全重跑预检。最终APK或设备状态发生变化后必须重跑预检，打包会校验这两个报告是否绑定当前releaseSubject。模拟器、单机、浏览器、`physical:false`、合成的JSON和`adb reverse/forward`都不能替代这一步。

PostgreSQL并发验收同样绑定当前releaseSubject，源码或规则证据变化后必须重跑：

```powershell
pwsh -NoProfile -File apps/server/tools/verify-postgres-windows.ps1
```

该脚本默认读取`work/postgres/runtime/pgsql`，写入`verification/postgres-concurrency.json`和`verification/raw/postgres-concurrency.json`，共13项检查。

`pnpm android:release:build`的默认输出名不是正式APK。需要重建时显式传入：

```powershell
pwsh -NoProfile -File tools/client-native-release-build.ps1 `
  -OutputApk (Join-Path $PWD 'client/android/doushisi.apk') `
  -OutputIdsig (Join-Path $PWD 'client/android/doushisi.apk.idsig')
```

## 正式交付顺序

真机验收通过后，严格按以下顺序执行；任何一步失败都先修复再从头核对该步骤：

1. `pnpm local:check`
2. `node tools/package-production-acceptance.mjs .`
3. `pnpm release:check`
4. `node tools/print-source-fingerprint.mjs --subject`，确认仍为`320d23884f2db1d234305e077cf9b2c3275d9ef262e79a1fa5153b6ef869c595`
5. 再运行一次`pnpm local:check`
6. `pwsh -NoProfile -File tools/package-local.ps1 -Destination <全新且不存在的绝对目录>`
7. 在导出包中复验`configure`或`restore`、启动、停止、状态、备份和隔离恢复

第2步会写入`verification/production-acceptance.json`，把本机验收报告固化为正式验收清单；第6步会校验该清单、正式APK哈希、构建清单和当前releaseSubject。不要使用`-AllowIncomplete`作为正式交付路径。

Android构建报告已由打包脚本做独立产物绑定：正式APK必须匹配`local-native.json.apkSha256`且路径为`client/android/doushisi.apk`，驱动APK必须匹配`local-native.json.driverApkSha256`；两份报告还会重算APK与idsig哈希，并核对签名证书及v2/v3/v4。出现不匹配时必须修复产物或报告，不能用`-AllowIncomplete`绕过。

## 2026-09-26 历史验收待办

当时已通过发布审计的自动化报告为`local-ui.json`、`local-accounting.json`、`local-network.json`、`local-recovery.json`。完整房间矩阵由`pnpm acceptance:complete-rooms`生成`local-completed-games.json`；固定运行器在每个房间完成后清理隔离数据库，并让报告绑定当时构建subject。

截至2026-10-03，该项已经完成：`local-stability.json`已以20客户端实际运行7220.0241978秒、完成9960局，记录动作P95为240.4244毫秒、发牌P95为283.8327毫秒，并保持零账目错误和零状态丢失。

仍需人工完成的验收：

1. `local-native.json`：至少两台实体Android手机，同Wi-Fi且不使用ADB转发；完成注册、豆子充值、创建/加入、完整对局、结算、托管、重连、动画回放、定位和快捷语音。模拟器或`physical:false`报告不能满足。
当前仍待完成的是`local-native.json`真机验收；在真机报告通过前，`node tools/package-production-acceptance.mjs .`会因`LOCAL_NATIVE_APK_MISMATCH`失败，正式生产报告尚不能生成，`local-native-preflight.json`也需在设备连接后绑定当前主体重跑。完成前不得把`localReady`或`releaseReady`改为true，也不得用合成报告替代。
