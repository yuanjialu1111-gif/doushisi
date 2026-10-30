# 部署、备份与恢复

本文件描述已实现的运维流程。它不代表地方规则、完整对局、200 人容量或生产环境已经验收。当前 Windows 机器没有可用 Docker，Docker 镜像构建、Linux 定时容器和隔离网络仍须在目标 Linux 主机验收；真实 PostgreSQL 的导出恢复验证单独记录在 `deploy/verification/postgres-backup-restore.json`。

## 服务与凭据

生产环境使用 Linux、Docker Engine 和 Docker Compose v2。PostgreSQL 17 不发布任何宿主机端口。应用只发布 `127.0.0.1:3000`，应由主机 HTTPS/WSS 反向代理转发；玩家 APK 使用对应的公开 HTTPS/WSS 地址。

在主机上的 `.env` 配置独立随机值 `POSTGRES_PASSWORD`、`DSS_APP_PASSWORD`、`DSS_BACKUP_PASSWORD`、`ADMIN_ORIGIN`。数据库密码采用随机字母数字，避免现有数据库 URL 处理中的转义歧义。`.env` 权限设为 600，禁止提交版本库。不要把含展开凭据的 `docker compose config` 输出、环境转储、数据库连接串或签名私钥放入工单和日志。`docker compose config --quiet` 可检查配置而不输出值。

`dss_migrator` 负责数据库初始化和迁移；`dss_app` 是受限应用角色。新增 `dss_backup` 只获得 `pg_read_all_data`，可读取表和序列用于备份，没有修改余额、DDL、删账或创建角色权限。备份容器没有宿主机 Docker socket，运行用户为 `postgres`，根文件系统只读。

首次部署：

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

已有数据卷不会重新执行初始化脚本。补上 `DSS_BACKUP_PASSWORD` 后，在维护窗口更新数据库容器的环境并配置备份角色，然后启动备份服务：

```sh
docker compose up -d database
docker compose exec -T database sh /operations/configure-backup-role.sh
docker compose up --build -d backup
```

上面的数据库容器更新可能短暂中断连接，先通知在线房间并安排维护时间。角色配置脚本使用 psql 环境变量读取口令，不把口令放在命令参数里，也不输出口令。轮换备份密码时重复该流程并重建备份容器。

## 每日备份

`backup` 服务默认在每天 UTC 19:00，即北京时间次日 03:00，执行 PostgreSQL 自定义格式完整备份。`BACKUP_UTC_TIME=HH:MM` 可修改时间；没有任何成功备份或错过当日时段时，启动后立即补备份。失败后每 15 分钟重试，直到成功。容器调度采用 UTC，不受夏令时影响。

每份备份包含三个文件：

- `dss-<UTC时间>-<随机值>.dump`：`pg_dump --format=custom`，压缩级别 6。
- 同名 `.dump.sha256`：SHA-256 校验和。
- 同名 `.dump.json`：数据库版本、备份时间、大小和摘要，不包含密码。

先写 `.partial` 临时文件，导出和 `pg_restore --list` 成功后计算摘要，再生成最后的 JSON 提交标记。备份和恢复程序只选择完整的三件套。单次 PostgreSQL 命令最多执行 10 分钟，失败的临时文件会移除；保留策略只在新备份成功后运行。

默认保留最近 14 份完整备份，使用 `BACKUP_RETENTION_COUNT` 调整，范围 1 至 3650。手工备份也占用保留数量，因此这是份数而非天数。最新完成的备份始终保留。备份文件位于独立 `backups` 卷中，不在数据库数据卷内。

立即备份并可选导出到主机上的全新目录：

```sh
sh tools/backup.sh
sh tools/backup.sh /secure/exports/doushisi-20260908
```

导出目录必须为绝对路径且不存在，脚本拒绝覆盖已有文件。宿主机上的备份权限由 `umask 077` 控制。导出后，在该目录中运行 `sha256sum --check *.sha256`。不要把备份目录通过 HTTP 提供下载。

Docker 命名卷仍在本机磁盘上；主机和磁盘同时损坏时，它不能替代异地副本。将导出的完整三件套加密后传输到独立存储，传输完成后在目标端再次核验摘要，并单独保留签名密钥和部署配置的加密备份。当前实现是每天一次逻辑快照，最坏数据恢复点可能回退近 24 小时，不提供 WAL 归档或按时间点恢复。

## 失败观察

容器标准输出是结构化状态日志；日志轮换为 5 个文件、每个最多 10 MB。敏感 libpq 错误、SQL 和数据库连接参数不会原样输出。

```sh
docker compose logs --since 48h backup
docker compose exec -T backup node /operations/backup-cli.mjs health
docker compose exec -T backup node -e 'process.stdout.write(require("fs").readFileSync("/backups/latest-status.json","utf8"))'
```

最新失败、超过 26 小时没有成功备份、备份超过 12 分钟仍处于执行状态，或最新备份文件缺失，健康检查都返回非零。Docker 健康状态本身不会发送通知，也不会自动重启容器；主机监控应同时监控服务不存在、容器退出、unhealthy、磁盘余量及异地复制失败。

`.backup-lock` 防止手工和定时任务并发写入。同一卷上的第二个任务会被拒绝。强制断电或 SIGKILL 可能留下锁：先停止 `backup` 服务，确认没有该服务的 `pg_dump` 进程，再用一次性维护容器仅删除 `/backups/.backup-lock` 以及同批次 `.partial` 文件。不要在任务执行期间清锁；不得执行卷级删除。正常停止有 11 分钟宽限期，让当前备份结束。

## 隔离恢复演练

每周和每次迁移后至少演练一次。设置独立的 `RESTORE_DRILL_PASSWORD`；不能复用生产数据库密码。`restore` profile 启动独立 PostgreSQL 数据卷和 `recovery` 内部网络。演练服务不连接应用使用的默认网络，不挂载生产数据卷，也不发布数据库端口。

```sh
docker compose --profile restore up -d restore-drill-database
docker compose --profile restore run --rm restore-drill
```

默认选最新完整备份。指定某份备份时仅提供备份文件名：

```sh
docker compose --profile restore run --rm restore-drill node /operations/backup-cli.mjs restore dss-20260908T190000Z-012345abcdef.dump
```

脚本先核对三件套、文件大小、SHA-256 和归档结构，再创建随机命名的 `dss_restore_<随机值>` 新库。它不接受指定目标库参数，不使用 `--clean`，不删除任何现有数据库，并拒绝生产 Compose 主机名 `database`、应用角色、迁移角色和备份角色。恢复使用 `--single-transaction --exit-on-error --no-owner --no-acl`，任何恢复错误都不会留下半套已提交表。

成功后核对迁移版本、账户数、钱包数、账目数、房间数、局次数、精确余额总计，以及每个钱包余额是否等于对应账目总和。还检查历史保护触发器已恢复。演练报告位于独立 `restore-reports` 卷，数据库保留供检查；失败报告标明新库是否已经创建。

```sh
docker compose --profile restore run --rm restore-drill node -e 'for (const f of require("fs").readdirSync("/reports")) console.log(f)'
docker compose --profile restore stop restore-drill-database
```

演练通过只能证明归档可读、数据和已检查的不变量可恢复，不能证明所有页面、重连、回放和地方规则正确。演练库没有恢复原始角色和授权；转为正式候选环境时必须重新创建 `dss_app` 和 `dss_backup`，以候选库的所有者身份运行应用迁移入口，恢复受限角色授权，然后检查实际应用权限。

## 故障切换与回退

恢复演练脚本不自动切换线上数据库。实际事故恢复采用以下步骤：

1. 停止新用户流量和应用写入，记录事故时间、最后成功备份时间、当前发布版本和数据库迁移版本。保留原数据库卷及日志；尚能读取时先额外导出事故现场备份。
2. 在独立候选环境恢复选定归档。核对报告中的数据与业务预期，检查管理员角色限制、钱包账目一致、历史禁止修改，以及旧房间和旧局次的规则版本。
3. 用与备份兼容的应用版本连接候选库，运行隔离登录、重连、战绩和回放检查。未核验的玩法不得借恢复过程开放。先完成签名、TLS 和客户端地址配置，再安排客户端连接。
4. 候选环境通过检查后，在维护窗口切换反向代理或应用连接配置。保持旧数据库为停止写入状态，记录切换点和新环境第一笔写入。逐步恢复流量并观察错误和账目。
5. 若切换后尚无业务写入，可将连接切回保留的原环境。若候选环境已有写入，不得直接切回丢弃这些账目；先停止流量，导出两边数据，按唯一操作编号和局次核对差异，完成受控修复后再决定使用哪个环境。账目纠错只能追加关联调整记录。

演练结束后可删除已确认不再需要的随机演练库，但必须核对完整库名和目标主机；脚本本身不执行这一步。不要使用 `docker compose down -v` 清理演练，它会影响整个项目中的数据卷。先停止演练服务，在 Docker 卷列表中核对只属于演练的卷名后再做定向清理。

## 本机真实 PostgreSQL 验证

从项目根目录运行：

```powershell
./tools/verify-backup-windows.ps1 -RuntimeDirectory C:/path/to/pgsql
```

脚本创建只监听 `127.0.0.1` 的临时 PostgreSQL 集群和随机口令，不重启本地应用服务。应用迁移用于建立测试结构，数据是明确标记的合成账目。验证结束后删除测试库和测试角色，停止临时 PostgreSQL，移除初始口令文件，保留本地证据。

该验证运行与容器相同的 `backup-lib.mjs`，检查只读账号备份、校验和、保留策略、失败状态、恢复后的精确大额小数和历史删除保护；另检查损坏归档在建库前被拒绝，以及脚本拒绝指向现有业务库。调度时刻通过函数测试验证，实际调度 CLI 也检查首次启动自动备份和日志不含口令，尚未声称已经在 Linux 连续运行满一天。

`tools/verify-backup-compose.mjs` 使用 `yaml` 解析器检查配置结构和隔离边界；可通过 `YAML_MODULE` 指向该模块。报告为 `deploy/verification/compose-static.json`。这不是 Docker Compose 本身的模型校验，不能替代目标机上的 `docker compose config --quiet`、镜像构建和完整恢复演练。
