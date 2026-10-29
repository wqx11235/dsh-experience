<!-- date: 2026-09-09; source: dsh-experience starter library -->
# ⚠ 最高危险：`.cmd`/`.bat` 里写非 ASCII（中文注释）→ 启动器整个崩、harness 打不开

> 双击桌面快捷方式没反应 / 窗口一闪而过，或"只改了一句注释"后 harness 起不来。
> 这类故障**直接让 harness 无法启动**，而触发动作小到容易被忽略 → **危险等级：最高（critical）**。
> 与 `03-ps51-utf8-script-and-dead-proxy.md` 同源（脚本文件编码 vs 解释器默认编码错配），但后果更严重：`.ps1` 只是脚本自己报错，`.cmd` 是**整个启动器挂掉**。

## 症状

- 桌面快捷方式 `DeepSeek Harness.lnk` 双击无反应（或终端窗口一闪而过），但 `.lnk` 的 TargetPath / WorkingDir / IconLocation **完全正常**。
- 手动执行 launcher 的 `.cmd` 也异常；"逻辑明明没改"却打不开。
- `file "DeepSeek Harness.cmd"` 显示 `Unicode text, UTF-8 text`（正常应为 `DOS batch file, ASCII text, with CRLF line terminators`）。

## 原因

1. **cmd.exe 按系统 ANSI 代码页解码 `.cmd/.bat` 字节流**（简体中文 = GBK）。
2. 编辑器与 agent 的 `write`/`edit` 工具默认存 **UTF-8 无 BOM**；注释里一旦出现中文 / 长破折号 `—` / 中文引号 `「」`，就变成多字节 UTF-8 字节。
3. 这些字节被 GBK 解码成乱码，**乱码字节会吃掉引号与命令边界** → 语法崩、脚本提前终止。
4. 于是"只加了一句中文注释" = 把文件从「能安全解析的批处理」变成「cmd 无法解析的文本」。故障现场就是：**快捷方式没坏、启动逻辑没坏，坏的是文件编码。**

## 预防方案（可复制）

### 1) 硬规则：`.cmd`/`.bat` 只允许 **ASCII + CRLF**
- 注释一律英文；中文说明写到独立的 `.md`。
- 行尾统一 **CRLF**（不要 LF-only），**不要 BOM**。
- 改完**立即自检**，别只看内容"看起来对"。

### 2) 自检脚本（用 Node 写，避开 `.ps1` 自身的编码坑）
```js
// tools/check-cmd-encoding.mjs <file.cmd> [...]  —— 退出码非 0 = 不合格
import { readFileSync } from 'node:fs'
let bad = 0
for (const f of process.argv.slice(2)) {
  const b = readFileSync(f)
  let nonAscii = 0
  for (const x of b) if (x > 0x7f) nonAscii++
  const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
  const hasCR = b.includes(0x0d), hasLF = b.includes(0x0a)
  const crlf = hasCR && hasLF
  const ok = nonAscii === 0 && crlf && !bom
  if (!ok) bad++
  console.log((ok ? 'OK   ' : 'FAIL ') + f + '  nonAscii=' + nonAscii + ' crlf=' + crlf + ' bom=' + bom)
}
process.exit(bad ? 1 : 0)
```

### 3) 修复手法
1. 把所有非 ASCII（中文、`—`、`「」`）替换成英文 ASCII；
2. 行尾统一 CRLF；
3. 再跑自检；
4. **双击快捷方式实测**（不要只看文件内容）。

### 4) 兜底与设计约束
- 改动前留备份：`launcher\DeepSeek Harness.cmd.bak-<时间戳>`。
- **启动器保持薄**：只做"解析 bin 路径 + `start`"，复杂逻辑放 `.mjs`（Node）或遵守各自编码规则的脚本里。
- 同类高危文件一并纳入门禁：`launcher\*.cmd`、`tools\restart-dsh-web.cmd` 等（本库曾发现 `restart-dsh-web.cmd` 虽纯 ASCII 但**行尾是 LF-only**，属同族隐患）。

## 诊断关键词

- 快捷方式双击没反应 / 窗口一闪而过 / harness 打不开
- cmd UTF-8 中文注释 / ANSI GBK 解码 / 乱码吃掉引号
- `Unicode text, UTF-8 text` vs `ASCII text, with CRLF line terminators`
- .cmd 必须 ASCII + CRLF / LF-only .cmd / BOM
- check-cmd-encoding / 启动器崩溃
