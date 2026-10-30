# 本地交付状态

> **历史记录。** 本文主体记录2026-09-30的只读审计，不表示当前状态。最新状态见[README](../README.md)和本文顶部“2026-10-03当前状态”。

## 2026-10-03 当前状态

当前稳定事实为21/21配置、21个生产注册引擎、189/189完整房间矩阵、302/302发布测试、21/21规则书approved和13项PostgreSQL原始检查通过。当前服务为`http://192.168.1.17:3000/client/`，后台为`/admin/`；正式APK为`client/android/doushisi.apk`，SHA-256为`0dff70d0b2cfc20a4cdc1fdc93b05e72177282211f5be4cc3cb657b7086f8187`；releaseSubject为`320d23884f2db1d234305e077cf9b2c3275d9ef262e79a1fa5153b6ef869c595`。稳定性验收为20客户端、7220.0241978秒、9960局，0故障、0账错、0状态丢失，动作P95为240.4244毫秒，发牌P95为283.8327毫秒。UI、账目、网络、恢复、完整房间、稳定性和PostgreSQL报告均已重新生成并绑定当前releaseSubject。`node tools/check-rulebook.mjs`当前通过；`coverage.json`中的`fullRoomVerifiedConfigurations`仍为0，是研究索引字段，不能手工改成21。

`localReady=false`、`releaseReady=false`，当前唯一自动化阻塞是`local-native.json`：需要两台不同实体Android手机，模拟器不算，且不得使用ADB reverse/forward。ADB当前未列出任何设备；在真机报告通过前，正式生产报告也不能生成，`node tools/package-production-acceptance.mjs .`会因`LOCAL_NATIVE_APK_MISMATCH`失败。

当前本地服务状态为`stopped`。按现有约束未擅自启动或重启；真机验收前需由电脑所有者运行`pnpm local:start`恢复`http://192.168.1.17:3000`。

审计日期：2026-09-30。以下内容为历史审计，只记录可由当时仓库内JSON和文件状态直接支持的事实。

## 2026-09-30 历史结论

最终交付尚未完成。`verification/local-readiness.json`（生成于2026-09-30T15:34:31.551Z）当前为：

- `releaseReady=false`、`localReady=false`。
- 21项配置已注册，21项运行时引擎已核验。
- 当前共8项阻塞：1项 `STALE_BUILD`，7项 `ACCEPTANCE_STALE_OR_INVALID`。
- 受影响的旧报告为 `local-ui.json`、`local-accounting.json`、`local-native.json`、`local-network.json`、`local-recovery.json`、`local-stability.json`、`local-completed-games.json`。

因此，当前不能表述为“仅缺真机”。源码指纹已经变化，必须先对当前源码重新构建，再重新生成所有验收报告；旧报告即使内容通过，也不能作为最终交付证据。

## 已核验的规则材料

2026-09-30只读审计确认 `docs/rules/release` 下21个配置目录齐全，每项目录包含 `rulebook.json`、`cases.json`、`approval.json`、`manifest.json`。核对结果：

- 21/21 的规则书为 `schemaVersion=1`、`status=approved`、`basis=user-approved`。
- 21/21 的 `variantKey` 与目录编号一致，`ruleVersion` 在规则书、案例、批准记录和清单间一致。
- 21/21 的 `cases.rulebookDigest` 与对应规则书 SHA-256 一致。
- 21/21 的批准记录包含 `kind=user-rule-approval`、`ruleVersion`、`variantKey`、非空 `statement`、非空 `evidenceReference`、可解析的 `recordedAt`。
- 21/21 的清单中规则书与案例路径、SHA-256 和 `generatedAt` 可核对。

这证明发布规则书与参考案例材料通过发布审计，不证明真机、稳定性或最终发行验收已经完成。

当时`node tools/check-rulebook.mjs`未通过：`coverage.json`记录的`packages/rules/src/edition.ts`源哈希为`27ba00946509269b195660b722a84a972ea595a11a154fc0a1f1ca74fb9caae2`，当时文件实际哈希为`71314d82e36332be980b9f593189333bbdc1772619abcc62c28faf15050d6e7d`。该历史源漂移已修复，当前检查通过。

## 当前仍缺的交付证据

- 当前源码尚未重新构建，`verification/build-manifest.json` 与当前源码指纹不一致，导致全部验收报告被判定为旧构建。
- UI、账目、网络、恢复、完整房间和稳定性报告需要绑定当前 releaseSubject 后重新生成。
- `verification/local-native.json` 当前为失败报告，`devices=[]`，失败代码为 `DEVICE_NOT_AUTHORIZED`；没有两台实体Android设备的注册、豆子充值、创建/加入、完整对局、结算、托管、重连、动画回放、GPS、快捷语音和无ADB转发的原始证据。
- `verification/local-stability.json` 仍是2026-09-27旧报告，`subjectSha256` 与当前 releaseSubject 不一致，不能计入最终验收。
- 尚没有绑定最终正式APK SHA-256的两台实体真机验收报告。

自动截图、模拟器和 `physical:false` 记录不能替代实体真机验收。稳定性必须绑定最终源码构建，真机验收必须绑定最终APK哈希。

## 2026-09-30 历史 releaseSubject 参考

2026-09-30 只读检查得到：

- 当时源码指纹：`2d2b32f5e57f7380d4d567e7b7c1b2c25f47ba48f7d22ada92f76381cfc7c15b`
- 当时二进制指纹：`48c2acd988b37639085241c22f05f4c9fc7e62432a542a752ac2bb91335c5742`
- 当时`client/public`指纹：`8f581fcd7639575d832090324324f624afe75a550a0871d63a2766ed5f12567a`
- 当时`client/android/doushisi.apk` SHA-256：`2b9e670ebad021db07500b2a3d531f3d8016b1da1a07d1993d158ae0039d6552`
- 当时releaseSubject：`9bb84cdddbe0fd47f8785329c5bef6902ab92fb4014797c67b919a0bd41b7040`

上述值用于识别“当前源码/当前APK”和旧报告之间的偏差，不是最终验收通过凭证。最终报告必须重新生成并绑定最终构建。

## 接入两台实体手机后的步骤

1. 先对最终源码运行构建，固定最终 releaseSubject；正式APK必须使用项目既有签名密钥，地址与最终局域网配置一致。
2. 用USB连接两台实体Android手机，授权USB调试，确保两台手机与服务器在同一Wi-Fi，且不使用ADB reverse/forward。
3. 安装最终正式APK，确认 `adb devices -l` 同时显示两个非模拟器序列号。
4. 运行真机验收脚本：

   ```powershell
   pwsh -NoProfile -File tools/run-local-native-acceptance.ps1 `
     -DeviceA <手机A序列号> `
     -DeviceB <手机B序列号> `
     -Stage acceptance `
     -ApkPath client/android/doushisi.apk `
     -InstallApk
   ```

5. 只有十三项真机检查全部有原始证据、报告绑定最终APK SHA-256，并且稳定性报告绑定最终 releaseSubject，才可运行最终门禁：

   ```powershell
   pnpm local:check
   ```

6. 生成最终Windows包和APK后，重新核对包清单、APK哈希和验收报告绑定关系。

验收版APK的受控广播桥源码已放在 `tools/acceptance-client-adapter.js` 和 `client/android/native/AcceptanceReceiver.smali`，构建入口为 `tools/client-native-acceptance-build.ps1`。该构建仍需要现有签名密钥库的密码；没有正确密钥时，不得用不同签名覆盖正式APK。

## 不得声称的事项

- 不得声称 `pnpm local:check` 已通过。
- 不得把旧构建的报告视为当前通过。
- 不得用模拟器、自动截图或合成数据替代实体真机验收。
- 不得在最终APK哈希和最终 releaseSubject 绑定前宣称交付完成。
