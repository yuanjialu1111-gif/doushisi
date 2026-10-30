# PostgreSQL 并发验证

此专项直接连接 PostgreSQL，使用生产迁移脚本创建表和授予 `dss_app` 权限。规则引擎是测试脚本内的合成夹具，仅验证事务、房间和权限，不证明任何斗十四地方玩法正确。

## Windows 隔离运行

需要已安装项目依赖、Node.js 24、PowerShell 7，以及解压后的 PostgreSQL 17 Windows 二进制。已验证的官方分发地址为：

https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip

从项目根目录运行：

```powershell
./apps/server/tools/verify-postgres-windows.ps1 -RuntimeDirectory 'C:/path/to/pgsql' -WorkDirectory 'C:/path/to/temporary-postgres'
```

脚本为每次运行创建独立集群和随机密码，自动选择空闲端口，只监听 `127.0.0.1`。检查完成后删除测试数据库和测试角色，停止临时 PostgreSQL。集群和日志保留在指定临时目录供排查，口令临时文件会删除。默认报告为 `verification/postgres-concurrency.json`，可使用 `-ReportPath` 覆盖。

当前工作区已下载并解压运行时，可不传参数直接运行该脚本。未修改系统 PostgreSQL 安装或正在运行的应用数据库。

## 已有隔离 PostgreSQL

仅允许连接回环地址上的专用临时实例；实例中若已存在 `dss_app`，脚本拒绝执行。不得指向生产实例。

```powershell
$env:POSTGRES_VERIFY_ADMIN_URL = 'postgresql://postgres:temporary-password@127.0.0.1:55432/postgres'
pnpm --filter @dss/server exec tsx tools/verify-postgres.ts
Remove-Item Env:POSTGRES_VERIFY_ADMIN_URL
```

此方式只清理测试数据库和角色，不负责停止外部启动的 PostgreSQL。报告不会包含数据库口令或连接串。

## 检查内容

- 64 个相同请求编号只记账一次，修改参数后拒绝复用。
- 128 个并发精确小数增减无丢失更新；20 个竞争扣豆请求不能扣至负数。
- 80 个人工调整与 16 个重复小局结算请求并发，结算只执行一次且对局分数守恒。
- AA 和房主承担两种模式分别竞争开局，房费只扣一次，下一局不再扣费。
- 32 个相同策略版本的竞争修改仅接受一个。
- 使用实际部署迁移授予的应用权限，拒绝历史表的修改、删除、清空及关闭触发器，拒绝创建表和角色。
- 最终核对每个用户余额等于全部不可变账目金额之和。

真实并发通过 16 条连接的 PostgreSQL 连接池执行。它不是 200 人完整对局容量测试，也不验证 APK 界面。
