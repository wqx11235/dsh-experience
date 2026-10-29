<!-- date: 2026-10-29; source: dsh-experience 架构说明 -->
# 架构与决定性机制

> 这份插件值得保留的不是"又一个 markdown 搜索器"，而是下面八条链路。改代码前先确认你改的是哪一条；任何一条断了，经验库就退化成"一堆文档"。

## 0. 数据流总览

```
经验文件(.md) ──walk()──> index（内存）
      │                     │
      │                     ├─ search(): 分区/签名/2-gram/别名 → 两段重排
      │                     ├─ gaps: signatureFreq × resolveMap × entryCovered
      │                     └─ panel: catalog / 正文分节 / 候选
      │
tools/result ──失败──> inbox（候选）+ fixes（修复证据）
      │                     │
      └─ 同工具成功 ────────┘
                            └─ autoDraft(): 签名复发 ≥3 → .drafts/auto-<sig>.md
                                  └─ experience_promote → 正式条目 → rebuild → 覆盖验证
```

## 1. 索引：3 秒对齐磁盘

- `walk()` 递归收集 `.md`，**跳过 `.` 开头的目录与文件**（`.drafts/`、`.meta.json`、`.drafts/archive/` 都是工作数据，不进索引）。
- `computeStamp()` 把「相对路径 + mtime」拼成签名，`ctx.interval(POLL_MS=3000)` 检测到变化就 `rebuild()`。
- `rebuild()` 同时算出：分区文本（`zoneText`）、front-matter（`parseMeta`）、分类目录（`catalog`）、近似条目（`similarMap`）、断链警告（`checkLinks`）。
- **别改坏的地方**：`checkLinks()` 必须归一化 `..`，否则正确的跨目录链接会被判死链。

## 2. 检索打分：分三步，别混

1. **粗排**（每个条目）：标题 +20 / 正文 +10（按 token）；中文 2-gram 兜底 +8（按覆盖率）；「诊断关键词」+8、「避坑」+5；全 token 命中 +30；错误签名 `weight*8`；复发热度 `repeatBoost()`（上限 12）；解法关联 `min(12, net*4)`；`severity: critical` +25；最后乘置信度 `0.5 + conf*0.5`。
2. **去重降权**：`similarMap` 里后一名 ×0.6，重排一次。
3. **精确重排**：top15 再按「整句命中 +40」与「标题覆盖率」调整，截断返回。

- 别名（`ALIASES`）以半权追加，只影响召回，不改变主 token 排序。
- 所有 `SIGNATURES` 正则**必须带 `i`**：查询已小写化，否则签名加权、复发统计、推送账本会同时静默失效。

## 3. 读 → 解法关联（read-as-click）

`search()` 命中已知签名时记 `lastSearch={sigId, rels}`；10 分钟内 `experience_read` 读到其中一条 → `resolveMap[sigId][rel].count++`，并把 `pendingRead` 记为一次**可证伪的猜解**：同签名在窗口内真实复发 → `miss++`，加分按 `count - miss` 结算。
这是"检索是否真的解决问题"的唯一信号，不要用"又搜了一次"替代。

## 4. 采集：问题与解法一起留

- 失败判据是 `result.isError === true` 或 `result.value.ok === false`——**没有 `ok` 字段**，写成 `result.ok` 会永远不触发。
- 每条候选带 `tool / query / turn / step / repeat`；同 `kind+message` 只累加 `repeat`。
- 同工具在 30 分钟内成功 → 成功调用参数写进 `meta.fixes[]` 并回填候选的 `fix`：这是"怎么修好的"那一半。
- **失败分类**（`classifyFailure`）先于入库：`usage`（先读后改、old_string、offset、参数缺失…）与 `config`（缺密钥、4xx）不进草稿、不算缺口；只有 `knowledge` 才可能变条目。

## 5. 缺口 → 条目：闭环的最后一米

- `gapsData()` 三个输入：`signatureFreq`（复发）、`resolveMap`（已确认解法）、`entryCovered`（库内是否真有条目写了这个签名）。
- **`entryCovered` 必须传 `{ id, sample }` 对象**：`libraryCoversSignature` 首行 `if (!sig.id) return false`，传原始 freq 记录会让覆盖判定永远为假。
- `drafts` 列表：解析 `.drafts/*.md`，签名来自 `auto-<sigId>.md` 文件名或 `source:` 里的「签名 x」；`promotable = knowledge 且未覆盖`。
- `experience_promote`：校验分类 → 模板（front-matter 第 1 行）→ shingle-Jaccard 查重（≥45% 拒绝，`force` 跳过）→ 落盘 → 分类 README 插行 → 删草稿 → `rebuild()` → 返回 `signatureCovered`。
- 签名 sample 会自动写进「诊断关键词」，否则覆盖判定（测正则，不测 id）仍为假；缺省值由 `SIGNATURE_SAMPLE` 提供。
- `prune` 把「已覆盖 / usage / config」的候选移入 `meta.inboxArchive`（上限 300），把废草稿移入 `.drafts/archive/`——**归档，不删除**。

## 6. 主动推送：pull → push

`ctx.on('tools/post-execute', ...)`：先 `await next()` 放行，再对失败做一次 **quiet** 检索（不动统计/热度/草稿），分数过阈值就追加一条 `additionalContexts` 通知。
- 消息契约：`UserMessage` 必须有 `id/role/content/source`，且 `source.kind` 必须是插件自有值（如 `'dsh-experience'`）；通用 `'plugin'` 会被 v4 契约拒收。
- 去噪：同「工具 + 错误原文」只推一次；`experience_*` 自身失败不推；阈值按 `meta.suggest` 的采纳率自适应。

## 7. 面板

客户端 bundle 是**经典脚本 factory 形式**（`window.__ModuleLoader__.load`），不是 ESM；写成 ESM 会报 `Cannot use import statement outside a module` 并连带 web boot 失败。
面板只做五件事：按库浏览、结构化正文（分区卡片 + 避坑复制）、检索、缺口/待认领、候选池。样式只用 `--dsw-alias-*` 主题变量。

## 8. 持久化与迁移

- `.meta.json`：统计、置信度、verify 结果、候选、签名热度、草稿登记、解法关联、未命中、建议账本、归档。
- 新增 `meta.*` 字段一律在 `loadMeta()` 里 `||= {}` 初始化。
- 工具返回值里**不要出现 `undefined` 属性**：DSH 视为 non-lossless JSON，整条结果报错。
- host 级插件改动需要**重启宿主**；面板改动刷新页面即可。

## 库根与首次播种

- 优先级：`config.experienceRoot` → `DSH_EXPERIENCE_ROOT` → `~/.dsh/experience`。
- 首次启动若库根没有 `.md`，把包内 `library/` 复制过去；已有库不覆盖；`config.seed: false` 可关闭。
