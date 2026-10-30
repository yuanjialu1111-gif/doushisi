# GitHub规则源码复核

复核日期：2026-09-08。当前结论仍是：**没有已核实、可授权直接使用且覆盖全部28份配置的公开完整引擎**。不据宣传中的玩法名称填充任何已完成规则标记。

后续已通过GitHub API成功读取下述两份`app.zip`，不再属于“下载未读”。cs版127项、qqq版75项，脚本带`YXGAME`封装头，仍未读到可验证的目标玩法算法。完整补查见[研究更新](RESEARCH-UPDATE.md)和[逐文件读取记录](github-blob-review.json)。下节保留此前raw域名超时记录，不能与后续API读取结果混淆。

## 本轮读取与重试

- 重读本地锁定提交 `qmcloud/chess@5f2d792775ca40e6d86c85b5c29f431e133cdb79` 的完整路径树：668条，含24个ZIP，未见仓库根LICENSE/COPYING/NOTICE。
- 优先复核 `98k房卡/web/cs/file/src/app.zip` 与 `98k房卡/web/qqq/file/src/app.zip`，同时重读README和C#工程清单。使用PowerShell 7重复运行 `pwsh -NoProfile -File tools/research-rule-sources.ps1`；逐请求结果和内容哈希见 [机器记录](github-recheck.json)。
- 本轮Node访问raw.githubusercontent.com的README以及github.com的ZIP路径均在15秒内超时，curl复试同样超时。后续PowerShell逐项结果以机器记录为准，失败记录不能解释成“文件不存在”。
- 即使ZIP能列目录，也不据此宣称包内没有混淆、字节码或嵌套的规则代码。脚本只读文本或ZIP目录，不执行下载的JS/Lua/C#/二进制，不解压到项目源码。

## 已有代码与许可证证据

| 仓库及固定提交 | 实际核实内容 | 对当前规则的结论 |
| --- | --- | --- |
| [qmcloud/chess](https://github.com/qmcloud/chess/tree/5f2d792775ca40e6d86c85b5c29f431e133cdb79) | 原树主要含README/下载线索和ASP.NET后台；宣传表出现斗十四，但根许可缺失且README提商业授权 | ZIP未完整读到之前不能认定包含或不包含目标引擎；当前不直接复制 |
| [huff7/card-games](https://github.com/huff7/card-games/tree/7c0ae0f9ffed225dece801d5d2ed3478ac784e50) | 上轮核实C++子游戏目录；根MIT，移动端和原UI目录占位 | 已检查目录不包含目标全量玩法，不作为完整后端 |
| [yuanmadiddai/games](https://github.com/yuanmadiddai/games/tree/e7ef158cf79e1a0d824c349d2be786be52b138b7) | 上轮核实部分C++子游戏/数据库/网站文件；根MIT并有其他源码收费文字 | 宣传列表不等于公开源码范围 |
| [yuanfengyun/qipai](https://github.com/yuanfengyun/qipai/tree/b982f7010209dea6fe4c5a2f268459d3f1fa0514) | 上轮读取跑胡子Lua与C判胡文件，核心包含123/2710组合；检查树未发现许可证 | 算法思路有参考意义，不能当斗十四凑14算法，也不能未确认许可就直接移植 |
| [colyseus/colyseus](https://github.com/colyseus/colyseus/tree/1c8cff6b081051f1685139ee5eeb3fc0769cdfd8) | 上轮读取TypeScript房间/重连/协议，MIT | 只有通用房间能力，不补齐地方判胡、记分或豆子账本 |

其余仓库的本轮结论沿用已保存的源文件与固定提交报告，未声称今天重新成功下载所有文件。具体已读代码路径和原限制见 [完整上一轮报告](../../../github-source-review.md)。当前工程已采用自己的原协议网关，不因发现通用框架而迁移架构。

## 对定稿的影响

没有新增的可靠服务端源码可以消除D03/D04/D05/D11等基础缺口。规则书中的数值和术语提案仅供明确批准，不是从GitHub恢复的原规则。今后发现可用候选时，必须固定提交、逐文件检查牌堆/动作/胡型/计分与许可证，再以同一组手牌算例比较，不能单凭同名直接替换已冻结规则版本。
