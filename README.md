<!-- date: 2026-11-19; source: dsh-experience v0.2.0 —— idf 词频权重 + token 预算 -->
# dsh-experience

> 给 DeepSeek Harness 的**自学习经验库**：把踩过的坑变成可检索的本地知识，在错误发生的那一刻自动递到 agent 面前，并在收尾时把"问题"变成"条目"。
> Self-learning experience library for DeepSeek Harness: local, indexed markdown knowledge that is retrieved at the moment of failure and closed into new entries afterwards.

没有模型调用、没有向量库、没有联网上报。检索是纯本地打分，索引每 3 秒跟磁盘对齐。
**插入是预算制的**：失败时只递一条经验里可执行的那半（避坑），不带症状（报错原文就在紧邻的工具结果里），同一条目 30 分钟内只展开一次，每小时有字符上限。

<p align="center">
  <img src="assets/demo.gif" alt="dsh-experience 演示" width="860">
</p>

<p align="center">
  <a href="https://github.com/wqx11235/dsh-experience/releases/latest">▶ 45 秒完整演示（1080p，中英字幕）</a>
</p>

## 为什么不是"再写一段提示词"

提示词解决"agent 该怎么做"，解决不了"同一台机器上的同一个报错又出现一次"。经验库补的是后者：
**错误签名 → 命中已有条目 → 当场注入症状与避坑 → 解决后把缺的那条补齐。**

## 决定性机制（改任何一处都要先读）

| 机制 | 作用 | 代码 |
| --- | --- | --- |
| **分区加权检索** | 标题/正文命中之外，命中「诊断关键词」+8、「避坑」+5；中文按 2-gram 兜底；别名半权扩展 | `search()` / `zoneText()` / `ALIASES` |
| **idf 词频权重** | 每篇都出现的词（`error` / `配置` / `路径`）降权到 0.55，只出现一次的升到 1.35；签名与 2-gram 不乘 | `idfWeight()` / `tokenDf` |
| **错误签名路由** | `ERR_MODULE_NOT_FOUND`、`EPERM`、`fetch failed`、`Error NNN` 等签名给专属加权，并记录复发频率 | `SIGNATURES` / `signatureWeight()` / `repeatBoost()` |
| **精确重排与去重** | top15 用整句命中/标题覆盖率重排；近似条目后一名 ×0.6；`severity: critical` 提权 | `similarMap` / `search()` 尾部 |
| **read-as-click 闭环** | "按签名搜 → 读命中条目"记为解法（`resolveMap`）；同签名短时间内真实复发则记 miss 降权 | `noteRead()` / `pendingRead` |
| **失败采集 + 修复证据** | `tools/result` 的 `isError`（或 `value.ok === false`）进候选；同工具 30 分钟内成功调用参数回填为"修复证据" | `tools/result` 监听 |
| **缺口 → 条目闭环** | 复发但无解法的签名 + 未命中查询 + 待认领草稿 → `experience_promote` 一条命令入库（套模板/查重/同步分类 README/删草稿/重建索引/返回覆盖结果） | `lib/promote.js` / `promote()` |
| **主动推送** | 工具失败时自动检索，命中分数过阈值就把该条目的「避坑」注入本轮对话（**不注入症状**——报错原文就在紧邻的失败结果里）；按采纳率自适应阈值 | `tools/post-execute` |
| **token 预算** | 同一条目 30 分钟内只展开一次；每小时 4000 字符封顶后只给标题+路径；`experience_ask` 首条全额、后续压缩。实测 24 次失败注入省 57%、`ask` 省 32% | `relSurfaced` / `SURFACE_BUDGET` / `ASK_CHARS` |
| **开口前召回** | 每轮第一步用用户原话做一次 quiet 检索，命中够强就注入一条「可能相关」提示；同一会话同一条目只提示一次 | `agent/pre-step` |
| **召回反馈** | 只有被真的读回才算采纳；低采纳条目自动抬高自己的阈值；同一条目跨会话 7 天冷却 | `preStat()` / `preThreshold()` |
| **失败→修复起草** | 同工具先失败、后成功时，把报错原文与成功参数自动起草成待认领条目 | `draftSolved()` |
| **队列收口** | 草稿 14 天未认领自动归档（不删除）；「待办」页一键认领/归档、缺口与未命中同页处理 | `ageDrafts()` / `/experience/drafts/*` |
| **融合排序** | 词法分与中文 2-gram 分始终 RRF 融合，不再只在零命中时才走模糊 | `search()` 融合段 |
| **范围** | front-matter `scope:`：同 scope 加权、异 scope 降权；`experience_search` 可传 `scope` | `search(..., scope)` |
| **面板** | 左侧插件栏入口 + 整页视图：左栏按库/主题导航，右栏概览、结构化正文（避坑一键复制）、搜索命中、缺口与待认领、候选池 | `client.js` |

细节见 [`docs/architecture.md`](docs/architecture.md)；条目格式见 [`library/README.md`](library/README.md)。

## 检索质量（自测，不是碰运气）

```sh
node tools/eval-retrieval.mjs <库目录>
```

从条目自身造查询（标题 / 诊断关键词 / 正文首段 / 症状里的报错原文），测 R@1 / R@3 / R@5 / no-match。
本机 243 条经验、904 条查询实测：

| bucket | n | R@1 | R@5 | no-match |
| --- | ---: | ---: | ---: | ---: |
| 标题 | 243 | 100% | 100% | 0% |
| 诊断关键词 | 198 | 98.5% | 100% | 0% |
| 正文首段（近似自然语言提问） | 212 | 83.0% | 87.7% | 12.3% |
| 整行报错 | 125 | 94.4% | 99.2% | 0.8% |
| 报错片段 | 126 | 70.6% | 90.5% | 9.5% |
| **合计** | **904** | **90.8%** | **95.7%** | **4.3%** |

注意：查询由条目派生，分数偏乐观。真正贴近使用的两档是**正文首段**（描述现象，83.0%）与**报错片段**（70.6%），它们也是最弱的两档——标题的 100% 是自造查询的虚高，不能拿来自夸。

idf 的 A/B（`DSH_EXPERIENCE_NO_IDF=1` 可关）：合计 89.8% → 90.8%，正文首段 80.7% → 83.0%，整行报错 91.2% → 94.4%。`报错片段` 桶不变是数学决定的——单 token 查询下所有命中项乘同一系数，排序不可能变。

## 安装

```sh
# 从 GitHub 安装（当前主要方式）
dsh plugin --profile web add github:wqx11235/dsh-experience

# npm 发布后
dsh plugin --profile web add dsh-experience
```

官方桌面端请在应用的**设置 → 插件**里安装，不要用命令行改桌面 profile。

装完**重启宿主**（host 插件不热更），左侧插件栏出现「经验库」，点开是整页视图。

首次启动会把包内 `library/` 复制到库根；已有库不会被覆盖。

**兼容性**：`engines.dsh >= 0.1.7-rc.2`，不设上限（新版本优先）。已在 **0.1.7-rc.2** 与 **0.2.2-rc.1** 实测：工具注册、`/experience/*` 路由、侧栏面板、`agent/pre-step` 召回均正常，前端 0 运行时异常。

## 工具

| 工具 | 用途 |
| --- | --- |
| `experience_search` | 检索；支持空格分词、中文 2-gram、报错签名加权；返回摘要与元数据 |
| `experience_read` | 读全文；同时记录阅读次数与"解法关联" |
| `experience_ask` | 要结论而非文件列表：按 top 命中汇总「症状/原因/避坑」 |
| `experience_gaps` | 缺口清单：反复出现无解法的签名、待认领草稿、未命中查询 |
| `experience_promote` | 把草稿/签名/未命中查询写成正式条目；`dryRun: true` 先预览 |

HTTP 端点（面板同源使用）：`/experience/list`、`/search`、`/read`、`/gaps`、`/drafts`、`/promote`、`/inbox`、`/inbox/prune`、`/inbox/draft`、`/inbox/dismiss`、`/flag`、`/dedup`、`/stats`、`/missed/dismiss`、`/refresh`。

## 库根与配置

优先级：`config.experienceRoot` → 环境变量 `DSH_EXPERIENCE_ROOT` → `~/.dsh/experience`。

```yaml
# 在 profile 的 cordis.patch.yml 里按 id 覆盖（不要重复 insert）
- id: experience
  config:
    experienceRoot: '/absolute/path/to/experience'
    seed: false
```

环境变量（都是可选，用于调预算或做 A/B）：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `DSH_EXPERIENCE_ROOT` | `~/.dsh/experience` | 库根 |
| `DSH_EXPERIENCE_NO_IDF` | — | 设 `1` 关掉 idf 词频权重（A/B 用） |
| `DSH_EXPERIENCE_SURFACE_BUDGET` | `4000` | 失败注入的每小时字符预算，用完后只推标题+路径 |
| `DSH_EXPERIENCE_SEARCH_CHARS` | `1200` | `experience_search` 单次输出预算（只防爆） |
| `DSH_EXPERIENCE_ASK_CHARS` | `2400` | `experience_ask` 单次输出总预算 |
| `DSH_EXPERIENCE_PRE_MIN` / `_PRE_COOLDOWN_H` | `40` / `168` | 开口前召回的阈值与跨会话冷却 |

## 两条库的边界（不要混）

| | 私有库 | 公开起步库 |
| --- | --- | --- |
| 位置 | 你机器上的库根（默认 `~/.dsh/experience`） | 仓库 `library/` |
| 来源 | 你的使用积累 | 白名单 + 脱敏构建 |
| 谁写 | 运行时（采集 / 认领 / 归档） | 只有 `tools/build-library.mjs` |
| 是否发布 | **永不** | 随 npm/git 包 |
| 检查 | — | 隐私 + 死链 + 边界 |

- 公开库**只**从私有库按 `tools/public-entries.txt` 生成；运行时代码从不写 `library/`。
- 插件首次运行时把 `library/` 播种到**空的**库根；已有私有库不会被覆盖（`seed: false` 可关）。
- 包内 `cordis.patch.yml` 不写任何机器路径；私有库用 profile patch 的 `experienceRoot` 指过去。
- `node tools/check-boundaries.mjs` 断言两边不混（CI 每次跑）：公开库条目 = 白名单、仓库无 `.meta.json`/`.drafts`、无私有分类、patch 无绝对路径。

## 隐私

- 全部数据在本地；插件**没有任何网络请求**（唯一例外是你配置的 `verify: url` 校验）。
- 公开的起步库由构建期隐私闸门生成：只拷贝白名单条目，脱敏绝对路径/账号/邮箱/个人与私有项目信息，再跑泄漏扫描与死链扫描，任一命中即构建失败。见 [`docs/privacy.md`](docs/privacy.md)。
- 你的本地库不会随插件发布，也不会上传。

## 开发

```sh
node test/run-all.mjs                              # 集成测试 + 死链 + 隐私闸门
node test/host-harness.mjs                         # 无宿主集成测试（假 ctx + 真 defineTool schema）
node tools/build-library.mjs <私有库目录>          # 从私有库重建公开起步库
node tools/privacy-rules.mjs library               # 公开库隐私闸门
```

`test/host-harness.mjs` 会自行 stage 一份插件并注入 `@deepseek-ai/dsh-tools`，不需要真的起宿主。

## 发布到插件市场

收录流程（awesome-dsh-plugin 一个 YAML 文件就是一个投稿）见 [`docs/publishing.md`](docs/publishing.md)。

## License

MIT
