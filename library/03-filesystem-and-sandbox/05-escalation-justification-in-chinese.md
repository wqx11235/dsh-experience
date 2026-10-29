<!-- date: 2026-09-09; source: dsh-experience starter library -->
# 提权弹窗里给用户看的那句话，就是 agent 填的 `justification`——用中文写

> 每次请求沙箱升级都会弹一个审批窗。弹窗里"为什么需要这个权限"的说明，**不是系统生成的，而是 agent 自己填的 `justification`**。
> 写中文，用户才知道自己在同意什么。谁遇到：任何在 `workspace-write` 下写 workspace 外文件、需要 escalation 的会话。

## 症状

- 审批弹窗只有英文说明（例如 `Fixing the live dsh-experience plugin's index.js in-place (it lives under the user profile, outside the session workspace)...`），用户看不懂自己在批准什么。
- 用户只能凭习惯点"同意"，无法判断这次到底给什么权限、动了哪些文件。

## 原因

1. `dsh-user-approval` 的请求**只携带 tool name + `reason` + 可选 call id**——其 README 原文：*"The request carries no tool arguments — an answerer sees the tool name, reason, and optional call id"*。
2. 这个 `reason` 的来源就是工具参数 **`justification`**。`dsh-tool-pwsh/README.zh.md` 对它的定义是：「必须与 `sandbox_permissions` 一同提供：**用一句话向用户解释**为何正是这条命令需要更宽的访问」。
3. 所以**弹窗里唯一由 agent 控制、且面向用户的文字，就是 `justification`**：它写什么语言，弹窗就是什么语言。

## 避坑（可复制）

```jsonc
// 请求提权时这样写（中文 · 一句话 · 说清"改什么 / 为什么必须在 workspace 外 / 不批准会怎样"）
{
  "sandbox_permissions": "danger-full-access",
  "justification": "把修好的 index.js 写回 ~/.dsh/profiles/web/node_modules/dsh-experience/——该插件目录在会话工作区之外，workspace-write 模式无法写入。"
}
```

- **一句话讲清三件事**：改哪个文件 / 为什么必须在 workspace 之外 / 不批准会卡住什么。不要写"需要更高权限"这种空话。
- **原文照抄**：路径、命令、报错原文保持原样，不翻译、不改写——用户要能对上号。
- 校验规则：`invalid justification: expected a non-empty sentence` ——必须是**非空的一句话**，不能省略、不能只写一个词。
- `justification` 只能与 `sandbox_permissions` 同时出现，且**只对刚被沙箱拒绝的那条命令原样重试一次**；被拒后停止，不得换法绕过。
- 语言跟随用户（该环境用户用中文 → 一律中文），与全局 `AGENTS.md` 的「沟通与思考：中文优先」一致。

## 诊断关键词

- 审批弹窗 / approval prompt / 提权 / escalation
- justification / sandbox_permissions / reason
- danger-full-access / workspace-write
- 弹窗英文看不懂 / 中文说明
- The request carries no tool arguments
- invalid justification: expected a non-empty sentence

## 使用情况差异（自动标注）

> 由候选自动整理流程写入：同类失败反复出现时，对比「本条目被用到的程度」与「失败复发程度」，用来判断这条经验是否真的生效。

- 2026-10-14：候选里同类失败累计 **1** 次；本条目被命中 2 次、被点开 0 次 → **只被命中、从未被点开**（摘要可能已够用，或条目太长）
