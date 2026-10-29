<!-- date: 2026-08-24; source: dsh-experience starter library -->
# 坑：agent 工具返回值必须是无损 JSON，`undefined` 属性整体报错

> 任何 Harness 插件里用 `defineTool` 注册的 agent 工具，其 `execute` 返回值里只要**存在、但值为 `undefined` 的属性**，整棵结果都会被判为无损校验失败，报 `value is not lossless JSON`。
> 写插件工具（尤其返回结构里带"可选字段"）的人会遇到。

## 症状

- 调用某个 agent 工具连续返回：`tool "experience_search" returned invalid output: value is not lossless JSON`。
- 不是查询内容问题，不是某条数据特殊，而是**只要工具返回了命中结果就稳定复现**；空结果（无命中）反而正常。
- 现象上"从会话内看不出原因，无法修复"——因为它发生在宿主侧工具结果物化阶段，报错被吞成一句 `INVALID_TOOL_OUTPUT`。

## 原因

- DSH 的 `@deepseek-ai/dsh-tools` 对每个工具 `execute` 的返回值先做**无损 JSON 快照校验**：`snapshotToolValue()` → `snapshotJsonValue(candidate)`（来自 `@deepseek-ai/dsh-session`）。若返回 `undefined`，则抛 `ToolOutputError(toolName, ["value is not lossless JSON"])`，code `INVALID_TOOL_OUTPUT`。
- 无损边界（`isJsonValue`/`walkJsonValue`）对**自身可枚举字符串键**逐个取值并递归校验；任何值为 `undefined`、`NaN`/`Infinity`、`-0`、函数、符号键、稀疏数组、循环引用、非 plain 原型对象（`Date`/`Map`/类实例）都会让整棵树判为不通过。
- 本次 `dsh-experience` 的 `enrichHit()` 恒返回 `{ ..., stale, date, dshVersion, verified }`，这四个字段无值时被算成 `undefined` 且键仍存在 → 只要 `search` 命中，`execute` 返回的 `hits` 数组里每个元素都带 `undefined` 属性 → 整棵返回值不通过。
- `JSON.stringify` 会**丢弃** `undefined` 属性，所以直觉"能序列化"；但 DSH 的校验比 `JSON.stringify` 更严格——它认为"键存在但值为 `undefined`"就是有损，所以 `JSON.parse(JSON.stringify(x))` 不严格等于 `x`。

## 避坑（可复制）

```js
// 错误：可选字段恒赋 undefined —— 校验必败
return { ok: true, hits: hits.map(h => ({
  rel: h.rel, readCount: h.readCount || 0,
  stale: h.stale || undefined,       // ❌ 键存在，值为 undefined
  date: h.date || undefined,         // ❌
})) }

// 正确：只写入有值的键，值为 undefined 时直接省略
function enrichHit(hit) {
  const out = { rel: hit.rel, readCount: hit.readCount || 0 }
  if (hit.stale !== undefined) out.stale = hit.stale   // 只在该有值时才出现
  if (hit.date) out.date = hit.date
  return out
}
return { ok: true, hits: hits.map(enrichHit) }
```

- 校验遵循：**"键必须要么不存在、要么是合法 JSON 值"**，不要用"赋 `undefined` 表示缺省"的写法。
- 数值字段注意 `NaN`/`Infinity`/`-0` 同样会让整棵树失败（`Number.isFinite` 且排除 `-0`）。
- 排查这类错误：看工具 body 返回的对象里有哪些键每次都被赋 `undefined`；用 `snapshotJsonValue`/`isJsonValue`（`@deepseek-ai/dsh-session`）单测该返回值即可复现。
- 改完插件 `index.js` 后，宿主需**重启**（或 reload 该插件）才生效；仅改文件不会热更新 host 端已缓存的模块。

## 诊断关键词

- value is not lossless JSON
- INVALID_TOOL_OUTPUT
- ToolOutputError
- returned invalid output
- snapshotJsonValue
- isJsonValue
- 无损 JSON
- undefined 属性
- enrichHit
