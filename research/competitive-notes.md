# 竞品笔记：经验库 / 记忆类插件（2026-11-07）

> 数据来源：awesome-dsh-plugin 目录（当日快照）+ 各仓库 README（GitHub API 拉取）。
> 目的：找出「经验库」这一层还缺什么，哪些能学、哪些不能学（我们的红线：不联网、不调模型、本地纯文件）。

## 一、同类插件地图

| 插件 | 定位 | 它做得比我们好的地方 |
| --- | --- | --- |
| `hindsight#coding-agents`（Vectorize，目录 5.9w★） | 长期记忆系统 | 知识页（knowledge pages）、深度反思、按仓库隔离的 memory bank；系统提示层自动召回 |
| `memsearch#MemSearch`（Zilliz） | 共享 markdown 记忆 | **turn/end 自动捕获**成 `memory/YYYY-MM-DD.md`；`agent/pre-step` 召回提示；维护任务（PROJECT.md/USER.md/memory-to-skill）；技能审阅面板 |
| `ReMe#dsh`（AgentScope） | 个人知识库 | 已完成对话 **auto_memory** 沉淀 + 每日 **auto_dream** 整合；只注入「使用指引」，不塞历史，避免历史被当新指令 |
| `MemOS#memos-local-plugin` | 本地分层记忆 | **L1 轨迹 / L2 策略 / L3 世界模型 / Skill 四级**；步级+任务级反馈，高价值模式结晶成技能；三级检索器 |
| `OpenViking#dsh-memory-plugin` | 记忆与画像注入 | **pre-step 注入用 user 消息而不是 system prompt**（preset persona 会整段覆盖 system prompt）；召回只由用户真实输入触发；MCP 挂工具面 |
| `graph-memory` | 图记忆 | **TASK/SKILL/EVENT 类型节点 + 指回原始问答**；实测 20 轮上下文 token −80%；先量化再宣称 |
| `dsh-mnemon` | 跨 Agent 记忆 | 运行时记忆（USER.md/MEMORY.md 每轮注入）+ 项目文档（按需搜）+ 记忆空间；技能可演化但**必须人工 Adopt**，带 backtest |
| `MisakaNet` | 失败恢复记忆 | **公开检索基准**：267 query，BM25 R@1 0.21 vs 语义 0.446；指出「只有当词法没命中才走语义」是错的（**gate 改 fuse**） |
| `deja-vu#extensions/dsh` | 读其它 agent 会话 | 会话级工具：`deja_fix`（同一错误这台机器上次怎么修）、`deja_how`（真实调用命令）、`deja_blame`（文件历史）；**文件被读/改后主动给历史** |
| `dsh-memory-evolve` | 全能记忆工作台 | 多项目并行、待办、书签分支、会话评审、无限画板 |

## 二、他们共同做对、而我们没有的

### 1）召回时机：从「出错才推」升级为「开口前递一次」
- OpenViking / memsearch / deja-vu 都在 **agent/pre-step**（新用户输入）时做一次轻量召回；deja-vu 还额外挂在「读/写某个文件之后」「命令失败之后」。
- 我们现在只在 **工具失败后** 主动推送。用户正常提问时，agent 仍要自己想起来搜。
- 关键细节（OpenViking 的教训）：注入必须用 **source 归属的 user 消息**，不能写 system prompt——带 `complete: true` 的 preset 会把 system prompt 整段覆盖，记忆静默失效。我们已经在用 `source.kind='dsh-experience'`，这条路是通的。
- 去噪规则也现成：只由「用户真实输入」构建查询，排除插件注入与工具结果；批次里没有用户输入就不发检索。

### 2）捕获范围：只收工具报错 → 应该收「一轮里解决了什么」
- ReMe / memsearch / MemOS 都在 **turn 结束**时沉淀：用户问题 + 助手结论 + 工具调用，落成当天日记，再做日/周期整合。
- 我们只抓 `tools/result` 失败；**同一轮里失败→成功的修复证据只用于草稿，不成条目**。
- 可零模型实现：轮结束时若本回合有「失败后同工具成功」，生成一条 `solved` 候选（症状=错误原文，避坑=成功参数），进 inbox 等确认。

### 3）分层与整合：L1 日记 → L2 经验 → L3 世界模型
- MemOS 四级、ReMe 的 auto_dream、memsearch 的 maintenance：原始记录 -> 归纳 -> 稳定知识。
- 我们是「文件 + 草稿」两层，没有周期性整合：近重复条目只会被 `similarMap` 降权，不会被合并或升级。
- 零模型可做：定时把 `similarMap ≥ 阈值` 的条目生成「合并候选」，人工确认后合并（保留来源链接）。

### 4）检索：我们也在犯 MisakaNet 指出的「gate 错误」
- 我们现在的中文 2-gram/别名模糊**只在精确命中为 0 时才跑**；只要有一个自信但错误的词法命中，模糊路径就被压住。
- MisakaNet 建议：CJK 场景直接 **RRF 融合**两份排名，而不是让一份给另一份把关。
- 更重要的：他们有 **公开基准**（267 query，R@1/R@5/no_match）。我们没有；「搜得准」目前只是主观感受。

### 5）范围（scope / bank）：全局库 vs 项目库
- hindsight 按仓库分 bank；dsh-mnemon 有「记忆空间」；deja-vu 按项目会话过滤。
- 我们一个库全局共用，跨项目经验会互相污染（例如某个项目的临时约定被当成通用规则）。
- 最低成本做法：front-matter 加 `scope:`，检索时同 scope 加权，其余仍可命中。

### 6）来源与可追溯
- graph-memory 的召回会带**原始问题与最终回答原文**；hindsight 有 knowledge page 与 reflection。
- 我们的条目只有 `<!-- date; source -->`，promote 之后与来源候选/会话断了线。可以在条目里写 `origin: <inbox id / session / turn>`，面板显示「这条是从哪次事故来的」。

### 7）人工闸门：自动可以提，不能自动改
- dsh-mnemon 的技能演化：后台生成草稿 + backtest，**必须用户点 Adopt** 才生效。
- 我们 promote 也需要人确认（方向一致）；但缺「合并/改写现有条目」的确认流，目前只能新建。

## 三、不能照搬的

| 他们的做法 | 为什么我们不能抄 |
| --- | --- |
| 每轮 LLM 摘要 / 抽取 | 违背「不调模型、不联网」；成本与隐私都不可控 |
| 向量库 + embedding 服务 | 增加运行时依赖与体积；可留作可选后端，不做默认 |
| 默认读其它 agent 的会话文件 | 隐私面太大；deja-vu 是明确选择了这个取舍，我们不该默认 |
| 全自动改写/合并经验 | 知识库最怕静默变味；必须人工确认 |
| 系统提示注入记忆 | preset `complete: true` 会覆盖，静默丢上下文；用 pre-step user 消息 |

## 四、建议的下一步（按投入产出）

### P0（小改动，直接提升「用得上」）
1. **pre-step 召回提示**：新用户输入 → quiet 检索 → topScore 过阈值且与上轮不重复时，注入一条 2 行提示（最多 3 个条目 + 一句"需要时 experience_read"）。阈值可复用 `SURFACE_MIN` 自适应账本。
2. **turn 结束捕获**：本回合存在「失败→成功」时生成 `solved` 候选；带上工具、错误原文、成功参数、会话/回合号。
3. **检索基准**：从 214 条目的标题/关键词造 150–250 条中文 query，测 R@1/R@5/no_match；把数字写进 README（像 MisakaNet 一样，包括没达标的项）。

### P1（中等改动）
4. **融合排序**：中文查询始终计算 bigram 分并与词法分 RRF 融合，去掉 "no-hit 才 fuzzy" 的闸门。
5. **scope 字段**：front-matter `scope:` + 检索同 scope 加权；面板可筛选。
6. **合并候选**：`similarMap ≥ 0.45` 的条目定期生成合并草稿，人工确认。
7. **来源链**：promote 时写 `origin:`，面板显示来源候选/会话；支持 `supersedes:` 交叉引用。

### P2（大改动，先评估）
8. **memory → skill 蒸馏**：把条目的「避坑」抽出成 SKILL 草稿（需要 skill 生态配合；参考 memsearch 的审阅面板）。
9. **类型化图节点**：TASK/SKILL/EVENT 指回原文；只有在检索确实需要跳转时再做。
10. **跨项目隔离**：按仓库根自动切库/分 bank（hindsight 模式），需要先解决迁移与共享。

## 五、可直接复用的设计细节

- `agent/pre-step` 里构建查询：**只取 user 角色且 `source.kind` 为空的输入**，排除注入与工具结果。
- 注入用 `{ role:'user', source:{ kind:'dsh-experience', form:'notice' } }`，带 `id`；同 key 去重。
- 召回提示要「能不说就不说」：deja-vu 的经验是 silence is the common case；阈值 + 每会话/每 N 轮限流。
- 周期任务用「到期状态机」（memsearch）：`min_interval_hours` + 只在启用时跑，避免每次启动都扫全库。
- 公开数字必须带方法和限制（MisakaNet 连「哪项没达标」都写），这比「更快更准」有说服力。

## 六、一句话结论

我们已经把「错误时刻的检索」和「缺口→条目」做成了闭环，这是差异点；但**召回时机太窄、捕获面太窄、没有整合与基准**。先补 pre-step 召回、turn 结束捕获、检索基准这三件，收益最大且不破坏「本地、零模型」的红线。
