<!-- date: 2026-11-19; source: 通用记忆框架 / 记忆论文 / 编码 agent 记忆插件 三路调研（读 README 与论文原文） -->
# 记忆机制地图：还能从外面抄什么（2026-11-19）

> 上一篇 `competitive-notes.md`（2026-11-07）看的是 **DSH 生态里的同类插件**，结论是「召回时机太窄、捕获面太窄、没有整合与基准」。
> 那三条后来都落地了：`agent/pre-step` 召回提示、失败→成功 `solved` 捕获、`tools/eval-retrieval.mjs` 基准、bigram 始终 RRF 融合、`scope` 加权。
>
> 这一篇换视角：看**通用记忆框架 / 记忆论文 / 编码 agent 记忆插件**。它们绝大多数比我们重（每写一条调一次 LLM、必须有向量库、必须联网 key），所以不是照搬对象，而是**机制来源**。

## 零、先说结论

我们现在这套「错误驱动 + 确定性 + 文件即条目」在**召回时机**上已经做得比多数开源框架更克制：
渐进披露（pre-step 只给标题+路径，读了再展开）、每会话去重、per-entry 自适应阈值、跨会话冷却——这些是对的做法，别推翻。

真正缺的不是"存更多"，而是**知识的生命周期**：我们只有「新增」这一个动作。条目过时、被推翻、重复、太长，全靠人手工维护。外面这几家在这一段有成熟机制，而且**大部分能在纯本地零 LLM 下实现**。

## 一、读到的机制清单（11 家）

| 项目 | 招牌机制 | 关键常量 / 原文依据 |
| --- | --- | --- |
| [Graphiti](https://github.com/getzep/graphiti)（Zep） | **双时态**：事实被 `invalid_at` 置失效而**不删除**，可回答"某时刻什么为真"；README 对比表写 "automatic fact invalidation with temporal history preserved" | 写入消解阈值：重复 0.7、矛盾 0.8；`add_episode` 增量入图不重算全图 |
| [mem0](https://github.com/mem0ai/mem0) | 2026 版改成 **ADD-only**，README 明写 "no UPDATE/DELETE, memories accumulate"；检索四路融合（semantic + BM25 + entity + temporal） | 单次 LLM 写路径；每查询约 7.0K token、p50 0.88s |
| [A-MEM](https://arxiv.org/abs/2502.12110) | Zettelkasten **原子笔记 + 自动双链 + 演化改旧笔记**；写入时 `s_nj = cos(e_n,e_j)` 取 top-k 邻居建边 | 邻居 k 扫 10/20/30/40/50，10 之后收益递减；每写一条约 1200 token |
| [MemoryOS](https://github.com/BAI-LAB/MemoryOS) | 三层 + **热度迁升**：`Heat = α·N_visit + β·L_interaction + γ·R_recency`，`R_recency = exp(-Δt/μ)` | α=β=γ=1，μ=1e7 秒，迁升阈值 τ=5；满 200 段淘汰 Heat 最低 |
| [Generative Agents](https://arxiv.org/abs/2304.03442) | 记忆流三维打分 `w_r·recency + w_rel·relevance + w_imp·importance`，各自 min-max 归一 | 源码 `gw = [0.5, 3, 2]`（recency/relevance/importance），`recency_decay = 0.99` |
| [HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG) | 图检索 **PPR**（damping 0.5）+ 节点特异性 `s_i = |P_i|^{-1}` | PPR 本体 0 次 LLM；`|P_i|^{-1}` 本质是本地 idf |
| [claude-mem](https://github.com/thedotmack/claude-mem) | 把 `PostToolUseFailure` 当独立事件源；注入三步**渐进披露**（索引 50–100 token → 详情 500–1000） | hook 全生命周期，SessionStart 只灌压缩索引 |
| [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | **superseded 语义**：旧记忆不删，标 superseded，默认检索隐藏、可显式取；`memory_bootstrap_profile` 按 token 预算拼上下文 | Apache-2.0，无 key 可用 |
| [basic-memory](https://github.com/basicmachines-co/basic-memory) | 写入端**物理分离**：`bm_write`（新）与 `bm_edit`（改）是两个工具 | AGPL-3.0；Markdown + front-matter + Relations 双链 |
| [engram](https://github.com/VictorBodnar/engram) | **注入与人工复核共用同一个 scorer**；`state/injected/{session}.json` 保证同会话不重复注入 | 纯整数打分 keyword +3 / title +2 / project +2；MIT，纯标准库 |
| [MemGPT/Letta](https://arxiv.org/abs/2310.08560) | 水位压缩：超窗口 **70%** 插 memory pressure 警告，超 **100%** 驱逐约 **50%** 并重写递归摘要 | 驱逐 ≠ 删除，recall 永久可检索 |

## 二、按「我们能抄、且零 LLM」筛出来的八条

### ① 条目级 idf（最便宜的一刀）— ✅ 2026-11-19 已实施
现状：`search()` 里每个 token 命中都是 +20 / +10，**没有任何词频惩罚**。所以「配置」「路径」「错误」「文件」这种在几十条经验里都出现的词，权重和「ERR_MODULE_NOT_FOUND」差不多，白送噪声。
抄法：建索引时统计 `df`（每个词/2-gram 出现在多少条目里），打分乘 `log(N / (1 + df))` 归一因子。HippoRAG 的 `|P_i|^{-1}` 是同一件事。
成本：索引期一次遍历，检索期一次查表。零依赖。
注意：`df` 统计要在 `rebuild()` 里跟 `docs` 一起建，且 `signatureWeight` 的高权重不要被 idf 削平——错误签名天然高频但是高信号，应绕开 idf（或给签名 token 固定权重）。

### ② 条目级时效（recency）与重要性（importance）
现状：只有 `repeatBoost()`（签名复发）与 `readCount`，没有"条目本身多久没被碰过"和"这条有多重"。
抄法：`importance = f(severity, readCount, resolveCount)`，`recency = 0.99^(天数)`（或 MemoryOS 的 `exp(-Δt/μ)`），作为乘子并入排序，权重小一点（别盖过文本相关性）。
⚠ 一个真实的坑：Generative Agents **源码**把 `last_accessed` 升序后第 i 个乘 `decay^i`，归一化后最老的反而最高分，与论文"越近越高"相反。抄的时候方向别抄反：最近 = 1，越久 ×decay。
成本：纯 CPU。

### ③ 双时态失效（invalid_at / supersedes）
现状：矛盾处理只写在 `CONTRIBUTING.md` 里——手工登记 `CONTRADICTIONS.md` + 两边交叉引用。**插件完全不知道**哪条被推翻了，检索照常给旧条目满权重。
抄法：
- front-matter 认 `invalid_at: 2026-11-19`、`supersedes: <path>`、`superseded_by: <path>`；
- `search()` 对 `invalid_at` 已过的条目 ×0.3 并打「已失效」标签（**不消失**，像 Graphiti/mcp-memory-service 那样保留证据链）；
- `experience_promote` 加 `supersedes` 参数：落新条目时**自动**给旧条目顶部加「⚠ 已被 <新条目> 取代（日期）」，正文不动；
- 面板列表默认折叠失效条目，可展开。
成本：`parseMeta` 加三个字段 + 排序乘子 + promote 一次写文件。零 LLM。
为什么这条值得先做：我们已经有 `CONTRADICTIONS.md` 的**制度**，缺的只是让机器也认这个字段。

### ④ 注入去重要按「条目」而不是按「错误原文」— ✅ 2026-11-19 已实施（并加了窗口预算）
先说准（第一版笔记这里我写错了）：注入**已经有**长度上限——`sectionOf(text, label, max = 300)` 每节 300 字，症状+避坑最多约 700 字符，比 mem0 的 `max_context_chars`（4000）保守得多。所以"注入太长"不是问题。
真正的缺口在**去重维度**：`surfaced` 的 key 是 `工具名 + 错误原文`（`index.js` 1881），所以同一个错误不会重复推，但**同一条经验被两种不同报错命中时，会整份再推一遍**；`surfaced` 超过 200 条就 `clear()`，清空后又从头推。
抄法：engram 的 `state/injected/{session}.json`——按 `session + rel` 记录已注入，同一会话同一条目只展开一次，第二次换成一行"同上（<rel>）"。再加一个进程级总预算（例如单会话注入累计 ≤ 3000 字符），防止长会话里一路堆提示。
成本：一个 Map + 两个常量。`pre-step` 那条路径已经按 `session + rel` 去重了（`preStepState`），失败注入照它抄即可，不必另起一套。

### ⑤ 给「修订」一条正规入口
现状要说准：`experience_promote` 的新建其实保护得不错——同名 `exists` 直接拒绝、Jaccard ≥45% 拦截、只有 `force:true` 才覆盖（`index.js` 1216–1228）。缺的不是防覆盖，是**没有"改已有条目"的正式路径**：想修订一条经验，只能手改文件，或者 force 整篇覆盖，于是"改了什么、为什么改、谁改的"全部丢失。
抄法：新增 `experience_amend`（只改指定小节，带 `reason`，把旧内容追加到文末「修订记录」而不是丢掉）+ `supersedes`（新建一条并把旧条目标失效，见 ③）。basic-memory 把 write / edit 拆成两个工具的意义就在这里：让"改"可审计。A-MEM 的教训：**可以改旧笔记，但必须留旧版，禁止静默覆盖手改**。
成本：中等，主要是参数、diff 与校验。

### ⑥ 合并候选（reflection 的零 LLM 版）
现状：`similarMap`（Jaccard ≥ 0.45）只用来**降权**，两条近似条目永远并存，谁也不升格。
抄法：定期（或 `GET /experience/similar`）把 ≥0.45 的成对条目生成一份 `.drafts/merge-<a>-<b>.md`：症状合并、避坑去重、两边「诊断关键词」取并集、正文保留 `origin` 两个链接。人确认后 `promote{satisfiesMerge:...}` 落一条新的、给两条旧的打 `superseded_by`。
这是 RAPTOR「聚类+摘要压成父节点」和 Generative Agents「reflection」在我们约束下的等价物——**只是摘要由人写，不由模型编**。
成本：中。价值在于库会「变短」而不是一直变长。

### ⑦ 评测要往难里走
现状：`tools/eval-retrieval.mjs` 从条目自身的标题/关键词/症状行造 query。这个方法公平、可复现，但**太容易**——标题查询本来就会命中标题。
抄法：加一组"真实查询"。素材库里本来就有，只是没拿来评测：`meta.missed`（未命中查询，去重计次）、`meta.inbox[].query`（每次工具失败前那次调用的查询）、面板手动录的难例。人工标注期望条目，单独算 R@1/R@5 与 no-match 率。改权重前后跑两套，只认难集不退化。
（注：`meta.search` 目前只存 `total` / `noMatch` 两个计数；`lastQuery` 是内存变量，进程重启即失，要做历史得先落盘。）
为什么：我们接下来要动 idf、recency、失效乘子，**没有难集就等于闭眼调参**。

### ⑧ 可选进阶：把已有的链接图当检索图
`checkLinks()` 已经在解析每条经验里的 `](xxx.md)` 相对链接，只是结果仅用于"引用不存在文件"的告警，这份图白算了。HippoRAG 的用法是：以命中条目为种子跑 PPR（damping 0.5，纯 CPU），把分数分给它的邻居，让"关联条目"也能浮上来。
收益不确定（我们的链接密度不高、多为目录式引用），所以放最后；先做 ① 的 idf，再决定这张图值不值得跑。**别为了图而引数据库**——邻接表在内存里就够了。

## 三、明确不抄的

| 做法 | 为什么不抄 |
| --- | --- |
| 每写一条调一次 LLM 抽取（mem0 / Graphiti / A-MEM 全这样） | 我们的红线是"不调模型、不联网"；而且经验库的写入本来就由人/agent 在会话里完成，抽取收益不如手工写准 |
| 向量库 + embedding 服务作为默认后端 | 增加运行时依赖与体积；bigram + idf + 分区加权在"报错原文"这种短查询上已经够用（这是 MisakaNet 用 267 query 实测过的：CJK 场景 fuse 优于 gate，我们已改成 fuse） |
| 全自动改写 / 合并经验 | 知识库最怕静默变味。自动可以**提议**，不能**改写**（A-MEM 的演化机制就是我们不敢默认开的那一类） |
| 按热度淘汰条目（MemoryOS 满 200 淘汰最低 Heat） | 宁可"标失效、可隐藏"，不要物理删除。经验库的旧条目是证据 |
| 每轮自动摘要成日记（claude-mem / ReMe 的 auto_dream） | 与 pre-step 召回重叠，且会与我们的"一坑一条、可手改"结构打架 |

## 四、建议的落地顺序

| 顺序 | 项 | 改动面 | 预期收益 | 状态 |
| --- | --- | --- | --- | --- |
| P0-1 | 条目级 idf | `rebuild()` + `search()` | 直接压掉万能词噪声，改动小、可量化（用现成 eval 对比） | ✅ 已做（全部 R@1 +1.0pp） |
| P0-2 | 注入按「条目」去重（rel 级 + 会话级） | 失败注入那一段 | 同一条经验不再被不同报错重复整份推一遍 | ✅ 已做（24 次失败省 57%） |
| P0-3 | 难集评测（真实查询集） | `tools/eval-retrieval.mjs` | 后面所有调参的前提 | ✅ 已做（symptom / prose 桶，暴露 prose 83% / error 70.6%） |
| P1-1 | 双时态失效字段 + 检索降权 + promote `supersedes` | `parseMeta` / `search` / `promote` / 面板 | 让"过时经验"从手工制度变成机器可执行 | 未做 |
| P1-2 | 条目级 recency × importance 乘子 | `search()` | 老而准的坑不该被新而泛的条目压住 | 未做 |
| P1-3 | 写入动作分离（amend / supersede） | 工具面 | 防覆盖，配合 P1-1 | 未做 |
| P2 | 合并候选草稿 | 新工具 + `.drafts` | 让库会变短 | 未做 |

## 五、可复用的实现清单（给动手那天看）

```js
// ① idf：rebuild() 里跟 docs 一起建
const df = new Map()                       // token -> 出现它的条目数
for (const it of items) for (const t of new Set(tokensOf(it))) df.set(t, (df.get(t) || 0) + 1)
const idf = (t) => Math.log(1 + items.length / (1 + (df.get(t) || 0)))
// 签名 token 绕开 idf：错误原文是高频但高信号，别削

// ② 时效（方向别抄反）
const recency = (ts, days) => Math.pow(0.99, Math.max(0, (Date.now() - ts) / 86400000))
// ③ 失效（不删，降权）
const dead = it.meta.invalid_at && Date.parse(it.meta.invalid_at) <= Date.now()
score = dead ? score * 0.3 : score
// ④ 注入去重：key 用 session+rel，不用 tool+errorText
const seen = injectedBySession.get(sessionId) || new Set()
if (seen.has(h.rel)) body = `【经验库 · 同前】${h.title}（${h.rel}）`
```

- `front-matter` 新字段都要进 `parseMeta()`，否则检索侧读不到（现有 `severity`/`verify`/`dshVersion` 就是这么读的）。
- 任何改动都要过 `npm test`（`test/run-all.mjs` 会跑 host-harness + linkcheck + eval-retrieval）。
- host 侧改动**必须重启 Harness** 才生效；面板改动刷新页面即可。

## 六、实测：改了什么、省了多少（2026-11-19）

### 6.1 检索基线（`tools/eval-retrieval.mjs`）

同一脚本跑两个库，新增 `symptom`（整行报错）与 `prose`（正文首段，不含标题词）两个更难的桶：

| 库 | query | title R@1 | keywords R@1 | prose R@1 | error R@1 | 全部 R@1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 公开起步库（12 条） | 34 | 100% | 100% | 100% | 100% | 100% |
| 私有库（243 条） | 904 | 100% | 98.5% | **83.0%** | **70.6%** | 90.8% |

三个读数：
1. **公开库 100% 没有信息量**——12 条、query 又从条目自己身上抽。只证明"没崩"。
2. 私有库的弱项精确落在 **`prose`（自然语言描述现象）与 `error`（贴报错原文）**——恰是真实使用场景。`prose` 桶 12.3% 完全没命中，`error` 桶 9.5%。
3. `title` / `keywords` 桶接近满分是**自造 query 的虚高**，不能拿来说"检索很准"。

### 6.2 idf 的 A/B（`DSH_EXPERIENCE_NO_IDF=1` 可关）

| 桶 | 关 idf | 开 idf | 变化 |
| --- | ---: | ---: | --- |
| prose R@1 | 80.7% | 83.0% | +2.3pp（no-match 14.2%→12.3%） |
| symptom R@1 | 91.2% | 94.4% | +3.2pp |
| error / title / keywords | 不变 | 不变 | — |
| 全部 R@1 | 89.8% | 90.8% | +1.0pp |

**为什么 `error` 桶完全不动**：它的 query 是单个代码片段（如 `ERR_MODULE_NOT_FOUND`），命中的每个条目都乘同一个 idf 系数，**相对顺序在数学上不可能变**。所以单 token 查询测不出 idf，只有多 token 的 `symptom` / `prose` 桶能。

### 6.3 token 成本（同一批失败序列，新旧对比）

| 场景 | 旧 | 新 | 省 |
| --- | ---: | ---: | --- |
| 24 次不同失败注入 | 14519 字符（≈10371 token） | 6246 字符（≈4461 token） | **57%** |
| 5 次同一错误 | 295 字符 | 291 字符 | 持平（旧版 tool+errorText 去重本来就管用） |
| `experience_ask`（20 query） | 1301 字符/次 | 887 字符/次 | **32%** |
| `experience_search` limit=5（20 query） | 875 字符/次 | 872 字符/次 | 0%（预算没触发） |
| 常驻工具 schema（每轮） | 627 token | 627 token | — |

- 57% 里约一半来自**窗口预算**（4000 字符/小时后只推一行），只有"一次会话里失败很多次"才吃到；单次首次注入省约 30%（去掉了 `症状` 行——报错原文就在紧邻的失败结果里，重复一遍纯属浪费）。
- `search` 的 0% 是**故意的**：5 条实测才 872 字符，而砍掉摘要会诱发 `experience_read`（单条全文约 3000 字符），反而更贵。预算只做防爆保险丝（`DSH_EXPERIENCE_SEARCH_CHARS`，默认 1200）。
- 常驻 schema 627 token/轮是这插件最稳的一笔固定开销，五个工具里 `experience_promote` 独占 441（参数多），但它值得——压描述会让 agent 传错参数。

### 6.4 落地清单（已改）

| 项 | 位置 | 开关 |
| --- | --- | --- |
| idf（df 表 + 权重 0.55~1.35） | `rebuild()` / `idfWeight()` / `search()` | `DSH_EXPERIENCE_NO_IDF=1` 关 |
| 注入：去掉症状行 | `tools/post-execute` | — |
| 注入：同条目 30 分钟内只展开一次 | 同上（`relSurfaced`） | — |
| 注入：窗口预算 4000 字符 | 同上（`surfaceChars`） | `DSH_EXPERIENCE_SURFACE_BUDGET` |
| search 输出预算（防爆） | `search()` 尾部 | `DSH_EXPERIENCE_SEARCH_CHARS` |
| ask 分层预算（200/300/400 → 压缩） | `experience_ask` | `DSH_EXPERIENCE_ASK_CHARS`（默认 2400） |
| 成本可见 | `GET /experience/stats` 的 `inject` 字段 | — |
| 评测：新增 symptom / prose 桶 | `tools/eval-retrieval.mjs` | — |


## 七、诊断关键词

- 记忆框架对比 mem0 graphiti cognee A-MEM MemoryOS HippoRAG
- 双时态 invalid_at supersedes 经验失效
- 记忆热度 Heat recency importance 衰减
- idf 词频 降权 PPR HippoRAG
- 注入去重 surfacing 上下文污染 token 预算
- 渐进披露 progressive disclosure
- 合并候选 reflection consolidation
- 检索评测 LoCoMo LongMemEval R@1
