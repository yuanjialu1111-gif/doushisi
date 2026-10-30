# 当前实施状态

21/21 项保留配置已经具备 `status: approved`、`basis: user-approved` 的发布规则书，并且 21/21 个对应引擎已进入生产注册表。每项注册记录绑定发布规则书与参考用例摘要；旧研究索引、历史决策和未决研究仍保留在 [机器可读覆盖](coverage.json) 与 [历史决策登记](decisions.md) 中。

规则书批准、可开局判定和完整房间验收是三件不同的事。当前 21/21 项均未被规则缺口账本阻止开局。当前 `verification/local-readiness.json` 仍为 `localReady: false`、`releaseReady: false`，原因是当前源码对应的构建与本地验收证据已过期；因此 coverage 中每个 `implementation.fullRoomVerified` 仍为 `false`，`originalServerComparisons` 仍为 `0`。

- [发布规则书目录](release)
- [历史授权与范围](INDEPENDENT-APPROVAL.md)
- [历史决策登记](decisions.md)
- [机器可读状态](coverage.json)
- [本地验收状态](../../verification/local-readiness.json)

# 斗十四地区版规则书

当前保留 21 编号、21 份配置（含雅安红二十）。下表链接历史研究页，发布定义以对应 release rulebook 为准；历史提案、算例和未决研究不再表示当前定义未批准。

## 配置覆盖

| 配置 | 规则族 | 发布规则版本 | 当前状态 |
| --- | --- | --- | --- |
| [4:0 新津斗十四](variants/4-0.md) | 新津番数 | [xinjin-independent-v1](release/4-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [5:0 安岳斗十四](variants/5-0.md) | 安岳漂 | [anyue-independent-v1](release/5-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [6:0 雅安红二十](variants/6-0.md) | 雅安红二十 | [yaan-independent-v1](release/6-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [7:0 蒲江斗十四](variants/7-0.md) | 蒲江 | [pujiang-independent-v1](release/7-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [8:0 邛崃斗十四](variants/8-0.md) | 邛崃 | [qionglai-independent-v1](release/8-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [9:0 阿坝斗十四](variants/9-0.md) | 阿坝原编号9 | [aba-independent-v1](release/9-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [10:0 阿坝斗十四](variants/10-0.md) | 阿坝经典编号10 | [aba10-independent-v1](release/10-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [11:0 马尔康斗十四](variants/11-0.md) | 马尔康全兴 | [aba11-independent-v1](release/11-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [12:0 小金斗十四](variants/12-0.md) | 小金 | [aba12-independent-v1](release/12-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [14:0 汶川斗十四](variants/14-0.md) | 汶川 | [wenchuan-independent-v1](release/14-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [15:0 茂县斗十四](variants/15-0.md) | 茂县配置 | [maoxian-independent-v1](release/15-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [16:0 遂宁斗十四](variants/16-0.md) | 遂宁 | [suining-independent-v1](release/16-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [19:0 通江斗十四](variants/19-0.md) | 通江 | [tongjiang-independent-v1](release/19-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [20:0 荣县斗十四](variants/20-0.md) | 荣县小家 | [rongxian-independent-v1](release/20-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [21:0 越西斗十四](variants/21-0.md) | 越西 | [yuexi-independent-v1](release/21-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [22:0 盐津斗十四](variants/22-0.md) | 盐津彩电 | [yanjin-independent-v1](release/22-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [23:0 叙州斗十四](variants/23-0.md) | 叙州巴牌 | [xuzhou-independent-v1](release/23-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [24:0 雷波斗十四](variants/24-0.md) | 雷波抢巴 | [leibo-independent-v1](release/24-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [25:0 筠连斗十四](variants/25-0.md) | 筠连原分支 | [junlian25-independent-v1](release/25-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [26:0 甘洛斗十四](variants/26-0.md) | 甘洛敲数 | [ganluo-independent-v1](release/26-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |
| [27:0 筠连斗十四](variants/27-0.md) | 筠连听用分支 | [junlian27-independent-v1](release/27-0/rulebook.json) | 已批准 / 已注册 / 完整房间验收待当前主题 |

## 构建与检查

在工程目录运行 `node tools/generate-rulebook.mjs`。生成器只读取发布证据并写入 `docs/rules/README.md` 与 `docs/rules/coverage.json`；它不会改写历史研究页、发布文档或运行时注册表。运行 `node tools/check-rulebook.mjs` 检查 21 份 approved 文档、摘要绑定、生产/预览注册表隔离、summary 计数和历史研究保留字段。
