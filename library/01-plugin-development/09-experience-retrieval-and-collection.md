<!-- date: 2026-09-08; source: dsh-experience starter library -->
# 指南：经验库检索与问题采集机制（可调参数与闭环）

> 读完这一篇就能理解 `dsh-experience` 插件的检索打分链路与错误采集链路，并知道改哪个常量调优。
> 写/改经验库插件、排查"检索不准"或"错误没被采集"时读这个。

## 检索打分链路（`search()`，按顺序叠加）

| 信号 | 分值 | 位置 |
| --- | --- | --- |
| 标题/路径命中 | +20 | 每个 token |
| 正文命中 | +10 | 每个 token |
| CJK 2-gram 命中 | +8（部分命中按比例） | token 无整串命中时兜底 |
| **A1 分区命中**：命中 `## 诊断关键词` | +8 | 报错场景判别力最高 |
| **A1 分区命中**：命中 `## 避坑` | +5 | |
| 全部主 token 命中 | +30 | 整串匹配奖励 |
| **A1 错误签名** `SIGNATURES` | `weight*8`（2~3） | 报错原文自动加权 |
| **重复犯错热度** `signatureFreq` | `repeatBoost()`，上限 12 | 同签名反复搜 → 递增，随时间衰减 |
| **B4 解法关联** `resolveMap` | `min(12, count*4)` | 该签名曾被"读到哪份经验"解决过 |
| 置信度乘子 | `× (0.5 + conf*0.5)` | `confidenceOf()`，被 flag 降权 |

之后：**A2** 近似重复降权（`similarMap`，后一名 ×0.6）→ **A4** 两级重排（top15 加"整句命中 +40 / 标题覆盖率"）→ 截断。

- **A3 别名**：`ALIASES` 里每个主 token 追加同义词，权重 0.5（如 重启→restart/reload）。
- 调优常量：`SIG_BOOST_CAP=12`、`repeatBoost` 的 recency 公式、`ALIASES`、`SIGNATURES`、A2 的 `0.6`、A4 的 `40 / 0.6`、分区权重 `8/5`。

## 问题采集链路

1. **B1 采集源**：`ctx.on('tools/result', (exec, result) => …)` 的 `result` 是 `{ isError, content, error?, value? }` ——**没有 `ok` 字段**。失败要判 `result.isError === true`（抛错/注册期错误，如 `ToolOutputError: value is not lossless JSON`），或工具自己返回的 `result.value.ok === false`。写成 `result.ok === false` 会**永远不触发**（本库曾因此漏采）。
2. **B2 上下文**：每条 inbox 记录带 `tool / query(lastQuery) / turn / step / repeat`；同一 `kind+message` 复发只累加 `repeat` 而不是丢弃。
3. **B3 复发自动草稿**：同一签名 `signatureFreq` 复发 ≥ `AUTO_DRAFT_AT`(3) → 自动写 `.drafts/auto-<sigId>.md`（预填签名/查询/诊断关键词，标"待确认"），每个签名只生成一次（`meta.drafted`）。
4. **B4 闭环**：`search` 记 `lastSearch={sigId, rels}`；10 分钟内 `experience_read` 读到该次命中之一 → `meta.resolveMap[sigId][rel]++`（read-as-click），下次同签名直接给这份经验加权。
   - **⚠ 顺序不能省（2026-09-10 实测）**：解法关联**只在「按签名检索 → 紧接着读它返回的条目」这个序列里记录**。直接 `experience_read` 一个早已在库里的条目（没有前置签名检索，或读的不是那次检索的命中项）**不会**被记为解法 → 面板会一直把该签名标成"无解法"，看着像"库里缺条目"，其实条目早就在、只是没被认领。**消解缺口的正确姿势**：`experience_search <错误签名原文>` → 确认命中列表里有目标条目 → `experience_read` 它 → 复查 `GET /experience/gaps`（应从 `resolvers:0, gap:true` 变为 `resolvers:1, gap:false`）。

## 避坑（可复制）

```js
// 采集工具失败：用 isError，不是 ok
ctx.on('tools/result', (exec, result) => {
  if (result && result.isError === true) { /* result.error.message */ }
  else if (result && result.value && result.value.ok === false) { /* 工具自报失败 */ }
})
// 返回给模型的值里绝不能有 undefined 属性（详见 08 篇）
```

- `.drafts/` 与 `.meta.json` 属工作数据：`walk()` 已跳过 `.` 开头的目录/文件，不会被索引。
- 新增 meta 字段（`signatureFreq` / `drafted` / `resolveMap` / `missed`）都要在 `loadMeta()` 里 `||= {}` 初始化。
- 改完 `index.js` 需重启宿主才生效（host 级插件不热更）。

## 主动推送 / 缺口清单 / 片段质量（2026-09-08 增补）

### ① 主动推送（pull → push）
工具失败时自动检索并把命中经验的「症状+避坑」注入对话，agent 不必"想起来"查库。
```js
ctx.on('tools/post-execute', async (exec, result, next) => {
  const downstream = await next()               // 先放行，再决定追加
  if (!result || result.isError !== true) return downstream
  const r = search(errorTextOf(result), 1, true) // quiet：只读，不动计数/签名热度/草稿
  if (!r.hits[0] || r.topScore < SURFACE_MIN) return downstream
  const notice = { id: crypto.randomUUID(), role: 'user',
    content: [{ type: 'text', text: '【经验库命中】…' }],
    source: { kind: 'dsh-experience', form: 'notice', summary: '…' } }
  return { ...(downstream || {}), additionalContexts: [notice, ...(downstream.additionalContexts || [])] }
})
```
- 契约：`tools/post-execute(exec, result, next)`，`result` 是 `ToolExecutionSuccess|ToolExecutionFailure`（`{ isError, error?, content, additionalContexts? }`）；返回 `{ ...downstream, additionalContexts: UserMessage[] }`。参考实现 `@deepseek-ai/dsh-repeat-tool-reminder`。
- `UserMessage` 要有 `id/role/content/source`；`source.kind` 必须是插件自有值（如 `'dsh-experience'`）——通用 `'plugin'` 会被 v4 会话消息契约拒收。
- 去噪：同 `工具+错误原文` 只推一次（`surfaced` Set，>200 清空）；`SURFACE_MIN` 阈值挡掉弱命中；`experience_*` 自身失败不推。
- `search(q, limit, quiet)`：quiet 模式跳过 `meta.search.total/signatureFreq/hitCount/autoDraft/lastSearch/saveMeta`，否则内部检索会污染统计。

### ② 缺口清单（`experience_gaps` + `GET /experience/gaps`）
用 `signatureFreq`（复发次数）× `resolveMap`（是否已有确认解法）× `entryCovered`（库内是否真有条目写了这个签名）算"最该补的经验"；`meta.missed` 记录未命中查询（`recordMiss`，去重+计次+上限 50，可用 `POST /experience/missed/dismiss` 清）。阈值 `GAP_MIN=2`。报告同时列出 `.drafts/` 里待认领的草稿，认领入口是 `experience_promote`（见 ⑧）。

### ③ 片段质量
`makeSnippet(text, idx, title)`：按**整行**取，命中落在 frontmatter/标题时向后找第一行有意义内容，并前缀 `[所在小节]`。
- 关键修复：`firstIdx` 必须只取**正文**偏移。原实现把标题命中的偏移当正文偏移用，片段会错位。

### ④ 捕获「解法」而不只是「问题」
inbox 只存错误文本，最有价值的一半（怎么修好的）会丢。做法：`tools/result` 里按工具名记住 pending 失败，同一工具在 `FIX_WINDOW_MS`(30min) 内**成功**就把成功调用的 `exec.arguments` 记为 `meta.fixes[]` 并回填到 inbox 项的 `item.fix`；`/experience/inbox/draft` 生成草稿时把它写进「避坑」。
- 注意 `addInbox()` 要 `return item`，否则拿不到 id 回填。

### ⑤ 诚实的负反馈
`resolveMap` 只加正分会让"读过的经验"永远占便宜。补：`noteRead` 记录 `meta.pendingRead={sigId,rel,ts}`；若**同一签名的错误**在 `RESOLVE_WINDOW_MS`(10min) 内再次真实发生（`tools/result` isError 且 `signatureWeight` 命中同一 id），给该条记 `miss`。加分改为 `net = count - miss`，`net>0` 才加分。
- 用"错误真的再次发生"而不是"又搜了一次"作判据，避免把正常复读误判成失败。

### ⑥ 危险等级（severity）
经验文件头写 `severity: critical`（`parseMeta` 自动解析），插件据此：
- 排序提权 `SEVERITY_BOOST = { critical: 25, high: 12 }`（**只对已命中条目加分**，不会把无关条目拉进来）；
- 检索结果与面板都打「⚠ 最高危险」标签（`enrichHit` 输出 `severity` → schema 声明 → 面板 `statusTags`/`catView`/详情页横幅）；
- `/experience/stats` 暴露 `criticalCount`。
- 注意：`enrichHit` 里仍然**只在该有值时写入** `out.severity`（写 `undefined` 会触发 08 篇那个 non-lossless 报错）。

### ⑦ 主动建议账本与自适应阈值
`meta.suggest[sigId] = { pushed, adopted, failed, lastTs }`：推送时 `pushed++`；被推送条目随后被 `experience_read` → `adopted++`；同签名在窗口内**真实复发** → `failed++`。阈值按采纳率自适应：
```js
const eff = adopted / (adopted + failed + 1)
const minScore = Math.round(SURFACE_MIN * (1.2 - 0.6 * eff))   // 采纳率高 → 更容易推
```
`/experience/stats` 的 `suggest.adoptionRate` 是这套机制的可见指标。

## ⑧ 缺口 → 正式条目闭环（2026-10-28 增补）

改前循环断在最后一米：能采、能评分、能起草，但**草稿没有出口**，缺口判定也不看库内条目。现在：

| 环节 | 实现 | 备注 |
| --- | --- | --- |
| 覆盖判定 | `libraryCoversSignature({ id, sample })` | 只认已知签名；测试该签名的 `SIGNATURES` 正则是否出现在某条目的「诊断关键词」或全文 |
| 草稿可见 | `GET /experience/drafts`、`gapsData().drafts`、面板「已起稿 · 待认领」 | 解析 `.drafts/*.md`：签名来自文件名 `auto-<sigId>.md` 或 `source:` 里的「签名 x」；`promotable = knowledge 类 && 未被覆盖` |
| 认领入库 | `experience_promote` 工具 / `POST /experience/promote` | `promote()`：校验分类 → 套模板 → shingle-Jaccard 查重（≥45% 拒绝）→ 落盘 → 分类 README 插行 → 删草稿 → `rebuild()` → 返回 `signatureCovered` |
| 覆盖回写 | 把签名 sample 自动写进「诊断关键词」 | 否则 entryCovered 仍为 false：`SIGNATURES` 测的是正则，不是 id；`SIGNATURE_SAMPLE` 提供缺省报错原文 |
| 失败分类 | `lib/promote.js` 的 `classifyFailure()` | `usage`/`config` 不进草稿、不算缺口；面板打标签；`prune` 归档进 `meta.inboxArchive` |
| 未命中清理 | `POST /experience/missed/dismiss` | 无此接口前 `meta.missed` 只增不减，噪声会长期污染缺口报告 |

- **草稿归档**：`prune` 会把"已覆盖 / 用法类"的草稿移到 `.drafts/archive/`，不删除。
- **验证套路**：`experience_promote { dryRun:true }` 先看 markdown 与查重结果 → 真跑 → 再 `experience_gaps` 看该签名是否 `entryCovered:true`。
- **order 不能省**：promote 里 `await rebuild()` 必须在 `libraryCoversSignature()` 之前，否则拿到旧索引会误报"仍未覆盖"。

## 几个容易踩的实现细节

1. **`SIGNATURES` 的每条正则都必须带 `i`**：`search()` 传的是**已小写化**的查询，`/\bEPERM\b/`（无 `i`）永远匹配不到 → 该签名的加权、`signatureFreq`、`suggest` 全部静默失效。本库曾因此让 4 条签名（EPERM / JS error / Error NNN / service not declared）长期不生效。
2. **`checkLinks()` 必须归一化 `..`**：否则 `../06-shell-tooling/x.md` 这类**正确**的跨目录链接会被判成"引用不存在的文件"（本库曾误报 3 条）。
3. 新增 `meta.*` 字段一律在 `loadMeta()` 里 `||= {}` 初始化。
4. **覆盖检查必须传带 `id` 的对象**：`gapsData()` 曾把 `meta.signatureFreq[id]`（`{count,lastTs,sample}`）直接传给 `libraryCoversSignature`，函数首行 `if (!sig.id) return false` 让 `entryCovered` **永远 false**——"库里明明有解法却一直报缺口"。2026-10-28 修。
5. **写进 `.drafts/` 的东西必须有读取面**：没有列表接口/面板入口/认领工具时，草稿等于写进了黑洞（实测积了 56 份，最老的躺了 48 天）。
6. **不要把散文词挖进「诊断关键词」**：`promote` 曾从症状里自动抽英文词，`could / city / nearby` 全进了加权最高的那一节；关键词只该来自手填 + 报错原文 + 签名 id。

## 诊断关键词

- experience_search 不准 / 排序不对
- signatureFreq / resolveMap / repeatBoost / SIG_BOOST_CAP
- zoneText 分区加权 / 诊断关键词
- ALIASES 别名
- similarMap 去重降权
- tools/result isError 采集不到
- autoDraft / .drafts 自动草稿
- tools/post-execute / additionalContexts / 主动推送
- experience_gaps / 缺口清单 / meta.missed
- experience_promote / 认领草稿 / .drafts/archive
- entryCovered 永远 false / libraryCoversSignature 缺 id
- 用法类失败 usage class / classifyFailure
- makeSnippet 片段错位
