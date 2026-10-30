# 斗十四独立版工程

**当前是开发联调版本，尚未完成最终交付。** 新开房保留21项：20份斗十四地区配置及雅安红二十（6:0），包含邛崃；原28份配置仅作历史证据归档。当前稳定事实为21/21配置、21个生产注册引擎、189/189完整房间矩阵、299/299发布测试和21/21规则书approved；这证明的是按授权独立定义实现和可运行，不是与原服务器逐字节一致。

当前 `pnpm local:check` 的本地阻塞是两台不同实体 Android 手机完成真机验收，模拟器不算；正式发布还需生成四个生产报告并把Android构建报告绑定当前主体，`localReady`与`releaseReady`仍为false。完整房间矩阵已覆盖21项配置的2/3/4人及4/8/12局组合。历史阶段说明见[本轮实施进度](docs/implementation-progress-20260915.md)。

邛崃天地胡、红胡黑胡、红50黑50已接入原开房界面、服务端冻结、重连和回放投影，默认开启。保留配置均使用已批准的独立规则书；本轮仅做Windows局域网使用。

## 当前服务

服务地址：`http://192.168.1.17:3000/client/`；后台 `/admin/`。用 `tools/local-run.ps1` 启动、停止、查看状态、备份和隔离恢复。新账号0豆，所有余额、房费、管理员调整和结算均使用唯一豆子账本。手动备份要求服务运行；恢复要求`.tgz`和同名`.tgz.json`同时存在，并在`stop`后执行。导出包没有源码和pnpm，首次启动先执行 `configure` 再 `start`；新包恢复既有数据时仍要先 `configure`，再 `restore`，最后 `start`。没有备份时先configure，再把`LOCAL_DATABASE_DIR`指向新包configure默认使用的`apps/server/.local/database`，在包根目录运行 `.\runtime\node.exe apps/server/dist/local-setup.js` 初始化独立管理员和空库；`local-setup.js`未设置该变量时自身默认`.local/database`，凭据写入包内`.local/local-access.json`。

当前 releaseSubject：`53bdaf077c9d101ba7f8a3add8a2e3a6f06d3ddc6c3d8995a7a8dd8b0fef5c14`；正式 APK：`client/android/doushisi.apk`，SHA-256 `eb81fcdd088dbfc00275fe8a36912692b8a9534d51e36789f9ffae24b4522fe8`。不要使用`client/android/doushisi-acceptance.apk`代替。

新开房只允许21项清单；所有配置要求房主手填正数底分，汶川和茂县还须明确选择2/3/4人。房间冻结规则版本、底分和玩法选项，六位房号加入；不开放匹配和原服务器。

## 交付边界

[正式APK](client/android/doushisi.apk)、[恢复工程](client/android/recovered-apktool.zip)、[当前实现记录](IMPLEMENTATION-UPDATE.md)、[地区版验证](docs/regional-implementation-20260909.md)和[邛崃审定表](docs/rules/QIONGLAI-REVIEW.md)已更新。21/21配置、21个生产注册引擎、189/189完整房间矩阵、299/299发布测试、21/21规则书approved、13项PostgreSQL检查和当前稳定性验收均有通过证据；当前真机预检和验收报告仍为失败旧报告，四个正式生产报告也未生成，Android构建报告尚未绑定当前主体；两台不同实体Android手机真机验收完成并解决这些发布项前，不能标记为正式成品。
