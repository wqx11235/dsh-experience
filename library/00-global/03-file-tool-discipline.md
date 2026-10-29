<!-- date: 2026-09-10; source: dsh-experience starter library -->
# 文件与检索工具的用法纪律：edit 前必须 read、old_string 要唯一、grep 要收窄

> 经验库「候选」里堆积的 `tool-error`，绝大多数不是环境坏了，而是**用文件工具的姿势不对**。
> 一次写清，避免同一类失败反复进候选池（该环境曾积到 26 条）。

## 症状（真实报错原文，可直接检索）

| 报错原文 | 触发场景 |
| --- | --- |
| `edit requires reading "<path>" first — read the file, then retry` | 没先读就改；或**读过之后文件被改过**，观察状态已失效 |
| `file changed since it was read — re-read the file, then retry` | 同上（读完 → 文件被改动） |
| `cannot write "<path>": file no longer exists — re-read the file, then retry` | 写之前文件被删除/改名 |
| `old_string matched 38 times in "<path>"; provide a more specific old_string or set replace_all to true` | 替换目标不唯一 |
| `invalid arguments: missing required property "old_string"` | 参数漏填（长参数名尤其容易截断） |
| `read failed: offset must be a positive integer` | `offset` 传了 0 / 负数 / 字符串 |
| `grep failed: tool call timed out after 30000ms` | pattern/path 开太宽 |
| `grep produced more raw output than the subprocess seam retained within the 20000000-byte cap` | 命中过多，输出爆上限 |
| `cannot read "<path>": not found` | 路径写错（npx 缓存与 profile 是两套路径，最容易混） |
| `cannot read "<path>": not a regular file` | 把**目录**当文件读 → 先 `glob`/列目录，再读具体文件 |
| `cannot modify "<path>": file has not been read` | 与"requires reading first"同一件事的另一种措辞（`write`/`edit` 的"未观察"路径）。**2026-09-28 实测两个易踩来源**：① 用 `experience_read`（经验库插件工具）读的内容**不算"观察"**——只有 `read` 工具才算；② **会话恢复 / 中断后，之前累积的观察状态会失效**（同一会话里刚读过的文件也会被拒）→ 重新 `read` 一次再改即可 |
| `offset 742 is out of range for "<file>" (741 lines)` | `offset` 超过文件行数 → 先不带 offset 读一次看总行数，或从头读 |
| `tool call aborted` | 工具调用被**中断**（用户打断 / 宿主重启）——不是代码问题，重试即可 |
| `unknown job pwsh-5` | 背景任务 id 不存在（跨会话/重启后任务表丢失）→ 用 `job_list` 重新确认 id |
| `present accepts 1 to 8 files` | `present` 一次最多 8 个文件 → 拆成多次调用 |

## 原因

1. **fs-observation-policy**：`edit`/`write` 只能改"本会话已观察过"的文件；而**你的每一次修改都会让该文件的观察状态作废**——同一文件连改多处时，第二处起就必须重新读。
2. `old_string` 是**字面匹配**且默认要求**唯一**：多一个空格、少一个括号（本次实测：`secondary)')),` 抄成 `secondary)'),`）就是 matched=0；通用短句则是 matched=N。
3. `grep` 有 **30s 超时**与 **20MB 输出上限**，`path` 指到磁盘根或大目录必炸。
4. 这些失败**不改环境**（重试即可成功），代价是**往返轮次**；同类反复发生还会污染候选池、掩盖真故障。

## 避坑（可复制动作序列）

1. **改前先读**；同一文件多处改动，**每处之前重新读一次**——或者干脆用第 4 条的一次性脚本。
2. `old_string` **带上足够上下文**（含上一行的缩进特征最有用）；命中不唯一时**优先加长上下文**，不要图省事用 `replace_all`（除非确实要全改）。
   - ⚠ **缩进会造成"假的多处匹配"**（2026-09-10 实测）：用**带缩进**的片段做 `old_string` 时，**更深缩进的同一行会把它当子串包含**进去 —— 例如 `"          if (…)"`（10 空格）会同时命中 14 空格那处，于是 `matched=2` 而你确信只有一处。两种解法：① 需要唯一时，用 `\n` **锚定行首**再拼缩进；② 多处**目标一致**时，干脆去掉行首缩进用**纯子串全局替换**（`split(old).join(new)`）。
3. **grep 先收窄**：`path` 指到具体目录、`include` 限定扩展名；报超上限就换更精确的 pattern。
4. **同一文件多处改动 → 写一个 Node 脚本一次做完**（顺带绕开 PowerShell 传中文的编码坑）：

   ```js
   const edits = [{ name: '…', old: L(…), next: L(…) }, …]
   let t = readFileSync(p, 'utf8')
   const before = t
   for (const e of edits) {
     const n = t.split(e.old).length - 1
     if (n !== 1) { console.log('FAIL ' + e.name + ' matched=' + n); process.exit(2) }  // 不唯一 → 整体放弃
     t = t.replace(e.old, e.next)
   }
   writeFileSync(p, t)   // 只有全部通过才落盘
   ```
   唯一性校验 + **失败绝不写文件**，比 N 次 `edit` 更安全，且只需**一次**沙箱授权（改 workspace 外文件时尤其划算）。
5. 改 workspace 外文件仍需 escalation，写法见 [`../03-filesystem-and-sandbox/05-escalation-justification-in-chinese.md`](../03-filesystem-and-sandbox/05-escalation-justification-in-chinese.md)。

## 诊断关键词

- edit requires reading the file first
- read the file, then retry
- file changed since it was read
- file no longer exists
- old_string matched N times
- provide a more specific old_string
- missing required property "old_string"
- offset must be a positive integer
- grep timed out after 30000ms
- 20000000-byte cap
- 先读再改
- 唯一性校验
- 一次性补丁脚本

## 使用情况差异（自动标注）

> 由候选自动整理流程写入：同类失败反复出现时，对比「本条目被用到的程度」与「失败复发程度」，用来判断这条经验是否真的生效。

- 2026-10-14：候选里同类失败累计 **41** 次；本条目被命中 1 次、被点开 0 次 → **只被命中、从未被点开**（摘要可能已够用，或条目太长）
