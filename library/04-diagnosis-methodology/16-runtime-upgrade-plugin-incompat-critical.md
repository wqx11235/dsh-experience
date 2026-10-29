<!-- date: 2026-09-10（2026-09-28 增补案例③④）; source: harness 崩溃复盘四例（0.1.1→0.1.2 模块表变严；0.1.2→0.1.5 服务 inject 校验变严；0.1.6→0.1.7-rc.2 服务被移除 + 运行期会话格式）; severity: critical; dshVersion: 0.1.7-rc.2 -->
# ⚠ 最高危险：升级运行库后页面 `Failed to load plugins` / 大量插件 pending（插件报错 ≠ 插件问题）

> harness 能启动、3080 也在监听，但页面停在 `Failed to load plugins`，或列出**一长串 pending**，错误指向某个第三方插件。
> **危险等级：最高（critical）**——整站不可用；但根因**不在那些插件**，通常**只有一个真凶**。
> 四个已实测案例：**① 0.1.1-rc.2 → 0.1.2-rc.1**（模块表变严，`dsh-deepread` 崩）；**② 0.1.2-rc.1 → 0.1.5-rc.1**（服务 inject 校验变严，`dsh-pocket` 崩，连带 31 个 pending）；**③ 0.1.6 → 0.1.7-rc.2**（服务 `settingsScope` 被移除/改名，26 个 pending）；**④ 同一次升级的运行期契约**（会话消息 `source` 旧格式被 V4 拒收，不在启动期暴露）。
> 与 `13-dsh-upgrade-0111-vision-model.md`（升到 0.1.1-rc.2）是同一族：**升级路径 + 连锁启动坑**。

## 症状

- 页面 `Failed to load plugins`，错误点名一个插件（案例①：`dsh-deepread`）。
- 报错原文：

```text
failed to import loader entry d129e4cd (dsh-deepread): client-modules:
require("@deepseek-ai/dsh-client-runtime/client") missed the module table —
not a platform seed word, not a materialized module, and no registered
package factory (a build-time externals drift, or a dynamic dependency that
did not arrive)
```

- 案例②的表现**不同**：`web boot: 31 entries did not activate`，31 行全是
  `pending (waiting for service: sessions / fileUpload / uiSession / uiWorkspace)`。
- 日志/终端看起来正常，端口 `LISTENING`，但页面就是加载不出插件。

## 原因

1. 运行库从 **0.1.1-rc.2 → 0.1.2-rc.1** 后，`client-modules` 的模块表构建**变严**：被 `require` 的包必须**预先注册 factory**（`dsh.client.inject` 声明），否则直接抛 `missed the module table`。
2. 按旧 API 打包的第三方插件（`dsh-deepread`）在严格校验下 bootstrap 即崩 → 整棵插件树加载失败 → 页面停在错误屏。
3. 判据（决定性证据）：**同一插件在旧运行库下完全正常**——切回 `dsh-runtime-0111` 后 📖「打开精读助手」按钮出现、console 零错误。→ 插件没问题，变的是运行库。

### 案例②（2026-09-10）：0.1.2-rc.1 → **0.1.5-rc.1**，31 个 pending

- **现象更具误导性**：页面不点名插件，而是 `web boot: 31 entries did not activate`，31 行全是
  `pending (waiting for service: sessions / fileUpload / uiWorkspace)` —— **极易误判成"31 个插件都要修"或"sessions 服务挂了"**。
- **真凶只有一个**：完整启动日志深处那条**不是 pending、而是直接 throw** 的记录：
  ```text
  Error: dsh: plugin tree failed to load: failed to apply loader entry dsh-pocket (dsh-pocket):
  cannot get property "webServer" without inject
  ```
  它一崩，插件树整体加载失败，所有依赖 `sessions` 的插件集体 pending。
- **判据（同机同版本的一死一活对照）**：`dsh-experience`（`inject: ['timer','webServer']` + `ctx.get('webServer')`）**毫发无伤**，只有 `dsh-pocket 2.10.3` 崩 → 是它的写法没跟上 0.1.5 的 inject 契约，机制细节见
  `../01-plugin-development/12-dsh-015-inject-contract.md`。
- **处置**：作者**当天**已发适配版（2.10.4 / 2.10.5）→ 升级 `dsh-pocket` 即修复，**无需改任何源码**。
  （该插件已于 2026-09-10 由用户卸载；本案例作为"**升级后插件不兼容**"的诊断范式保留。）
- **口诀**：**一长串 pending = 一个真凶**；"集体等同一个服务"就去查**谁提供这个服务**，顺着提供者往上找，比逐个检查等待者快得多。

### 案例③（2026-09-28）：0.1.6 → **0.1.7-rc.2**，26 个 pending，真凶是「服务被**删掉/改名**」

- **现象**：页面 `web boot: 26 entries did not activate`，26 行全在等
  `layout / shortcuts / uiWorkspace / settingsScope`；其中 `dsh-image-gen` / `dsh-vision-router` /
  `@linxin666/dsh-remote-web-ui` 三条卡在**同一个** `settingsScope`，`dsh-univer-office` 是 `failed`。
- **浏览器 Console 里的数字小得多**：`web boot: 4 entries did not activate`。
  **页面那 26 行是"汇总清单"（把受连累的等待者全列出来），Console 才是"真节点清单"**
  —— 从 4 条一眼看出"3 个插件等同一个服务"。
- **根因（本次最高效的一步）**：在运行库里全量搜 `settingsScope` → **0 处**，该服务在新版里彻底不存在了
  （新版改由 `dsh-client-ui-settings` 提供 `settingsSchema` / `configForms`，由 `dsh-settings` 提供
  `settingsController`）。**用旧名字的插件永远等不到服务。**
- **处置（本次是"升级"而不是"停用"）**：先按各插件的 `peerDependencies` 判断作者是否已适配
  —— 四个都含 `0.1.7-rc.*` → 全部升级即修复，页面完整渲染、26 条 pending 全消失：

  | 插件 | 旧 → 新 |
  | --- | --- |
  | `dsh-vision-router` | 2.1.4 → 2.2.5 |
  | `dsh-univer-office` | 0.3.2 → 0.3.5 |
  | `dsh-image-gen` | 0.5.1 → 0.7.0 |
  | `@linxin666/dsh-remote-web-ui` | 0.3.22 → 0.4.3 |

  > 改 profile `package.json` 版本号时注意：**`0.x` 的 `^` 范围不会自动跨大版本**，必须显式改。
  > 另可解开插件代码确认它是否已把硬依赖改成可选注入（`ctx.inject(["settingsScope"], …)`，
  > 服务不存在时优雅跳过）—— 这是"作者已适配"的第二个证据。

### 案例④（2026-09-28，同一次升级的另一种契约变更）：**运行期数据格式**被拒

- 案例①②③都是**启动期**故障（模块表 / 服务）；同一次升级还带来**运行期**故障：
  插件写入会话的消息 `source` 用旧格式，被 V4 格式拒收 →
  `format v4 message requires a producer-owned source kind`，**某一轮对话跑完之后**失败。
- 契约与修复写法：`../01-plugin-development/15-session-message-source-v4.md`；
  定位时踩的"代码里有 ≠ 就是它"的坑（先误删 `dsh-vision-router`，报错一字未变）：
  `23-code-smell-is-not-the-culprit.md`。
- **口诀**：升级后要查**两类**契约 —— **启动期**的（服务名 / 模块表，看页面与浏览器 Console）
  和**运行期**的（写入数据的格式，看会话文件与运行时报错）。

## 排查方法（可复用）

1. **插件报错 ≠ 插件问题**：先问"它在别的环境也一样吗"。
2. **别修那 31 个 pending**：pending 是"等待依赖"，是**结果**不是原因；去完整日志里找那条**真正 throw** 的记录（`plugin tree failed to load` / `failed to apply loader entry`）。
3. **"集体等待同一个服务" → 查服务提供者**：顺着服务提供者往上找，比逐个检查等待者快得多。
4. **时间线排毒**：列出"上次能用"与"这次不能用"之间的**全部差异**（本次：插件 8-24 才装、运行库后来才升）。
5. **对比**：能用的插件与报错插件的写法差异（案例①是 `dsh.client.inject`、案例②是 `inject:` 声明）→ 强信号"问题不在插件"。
6. **读懂报错**：两例的报错都已写清机制（`missed the module table` 的解析顺序；`cannot get property X without inject` 的契约要求）。
7. **"为什么它以前能用"是钥匙**：以前/现在的差异就是根因所在。
8. **先查作者是否已适配**：框架升级后作者往往当天就发新版（本次 `dsh-pocket` 一天内 2.10.4 / 2.10.5），**优先升级而不是改源码**。
9. **页面数字 ≠ Console 数字**：页面 `web boot: 26 entries did not activate` 是**汇总清单**（受连累的等待者全被列出来），**浏览器 Console 才是真节点清单**（案例③只有 4 条）。**永远先找"真正 throw / 真正等不到"的那一条**，别去逐个修等待者。
10. **"多个插件等同一个服务" → 立刻去查这个服务还在不在**：在运行库里全量搜服务名，**命中 0 处本身就是答案**（服务被移除或改名）。案例③三个插件同等 `settingsScope`，一搜 0 处 → 根因瞬间明确，比逐个排查 26 个等待者快得多。
11. **判断"升级有没有用"：先看插件的 `peerDependencies`**（能**提前**避坑）：peer 范围含当前 dsh 版本 → 作者已适配，升级大概率修好；不含 → 还没跟上（升级没用，只能等作者 / 停用 / 回退）。案例③四个插件 peer 都含 `0.1.7-rc.*`，升级即修复；完整盘点脚本见 `../05-runtime-and-process/04-dsh-core-upgrade-playbook.md` 阶段 0b。

## 预防 / 处置

- **第一优先（用户策略，2026-09-09）：保证 harness 正常运行，停用不兼容的插件**，并给用户一份
  **停用清单**（插件 / 版本 / 报错 / 停用方式 / 恢复条件）。停用手段按**挂载方式**选：
  bundle 依赖 → 从 `dsh.profile.bundles` 移除（或 设置→插件→「插件清单（按来源）」→停用）；
  patch 手挂 → 从 `cordis.patch.yml` 删 `insert` 行；纯库依赖 → 不用管。
- **兜底（仅在宿主起不来 / 多插件连锁失败 / 停用后仍不可用）**：回退运行库——
  `launcher\DeepSeek Harness.cmd` 与 `restart-dsh-web.cmd` 的 `DSH_BIN` **两处都要改**
  （只改一处，一次重启就把回退悄悄撤销了：2026-09-09 踩到 restart 脚本仍指向崩溃版本，
  插件的"重启生效"按钮会直接把它装回来）。
- **长期**：等插件作者适配新版（或提 issue）；**直接改 `node_modules` 里第三方插件源码 = 临时补丁**，重装/更新会被覆盖，必须明确记录并接受被覆盖。
- **升级后要检查两类契约**：**启动期**的（服务名 / 模块表 → 看页面与浏览器 Console）与
  **运行期**的（写入数据的格式 → 看会话文件与运行时报错；案例④的 `format v4 message requires a producer-owned source kind`）。
- **本地 `private` 插件不会被升级修复**：它不在 npm 上，pnpm / "更新"都不管它 —— 这类插件的兼容问题
  **只能改源码**（案例④真凶 `dsh-experience` 就是这种）。改前备份、改后把改法写进经验库（重装会覆盖）。
- **不要用"删除大插件"来排除变量**：先做**零成本验证**（grep 现场数据 / 临时加日志 / 用运行时校验函数实测写法），
  再决定删不删 —— 案例④先误删了 `dsh-vision-router`，报错一字未变（见 `23-code-smell-is-not-the-culprit.md`）。
- **升级前**：先确认所有已装插件的 `dsh.client.inject` / `inject:` 依赖是否被新版支持；
  **升级后立刻用"新端点/新字段"探针验证**（别只看"端口在听"）。
- **新版鉴权**：若新版带浏览器会话 token，需用终端打印的带 token URL 访问，普通 URL 会 401
  （launcher 那条"端口已占用就直接开普通 URL"的捷径会因此失效，见
  `../02-configuration/07-dsh-012-browser-auth-gate.md`）。
- 改 launcher / 重启脚本时**同时遵守** [`../06-shell-tooling/05-cmd-batch-non-ascii-critical.md`](../06-shell-tooling/05-cmd-batch-non-ascii-critical.md)（`.cmd` 必须 ASCII + CRLF）——本次两个故障是连着的。

## 升级前/升级中的可执行清单（本次漏掉的那一步）

**后端 200 ≠ 前端能用。** 本次先用 3099 起新版本、探了 `/api/*` 和 `/dsh-market/registry` 都 200、
启动 html 里也搜到了插件名，就换到 3080 —— 结果前端崩。清单里少了"真开一次页面"。

1. **前端冒烟（必做）**：3099 起新版本 → 从 stdout 取带 token 的 URL（0.1.2 起有认证）→
   真开一次页面，确认浏览器 console **没有** `Failed to load plugins` / `missed the module table` / 大量 `pending`，
   且关键插件 UI（按钮/面板）**真的出现**，而不是只在 html 里搜到名字。
2. **盘点 peer**：列出所有声明 `dsh.client` / peer `@deepseek-ai/dsh-*` 的插件版本要求。
   同一版本对不同插件可能是**一好一坏**：该环境 `dsh-better-sidebar@0.18.0` 的 peer 正好要
   `^0.1.2-rc.1`（升级才对），而 `dsh-deepread` 没跟上（升级就崩）；
   0.1.5 时 `dsh-pocket ≤2.10.3` 崩、`dsh-experience` 正常。
3. **回退要连坐**：升级时为本版做的启动器改动要一起退（0.1.2 的 token 门在 0.1.1 不存在 →
   恢复 `--no-open`、由 launcher 自己开浏览器），见
   `../02-configuration/07-dsh-012-browser-auth-gate.md`。
4. **给更新入口加阻断**：对"已知没适配"的版本，在"检查更新/一键更新"处直接拦住并说明原因，
   避免误点再次崩（该环境 `dsh-core-update` 插件已内置 `KNOWN_BLOCKED` 表）。
5. 完整升级 SOP 与耗时复盘见
   `../05-runtime-and-process/04-dsh-core-upgrade-playbook.md`。

## 诊断关键词

- Failed to load plugins
- missed the module table / not a platform seed word / no registered package factory
- client-modules / dsh.client.inject / 运行库升级 / externals drift
- DSH_BIN 回退 / dsh-runtime-0111 / 0.1.2-rc.1 / 0.1.1-rc.2 / 0.1.5-rc.1 / 0.1.7-rc.2
- 插件报错 ≠ 插件问题 / 时间线排毒 / 对比法
- did not activate / web boot: N entries did not activate / waiting for service: sessions
- cannot get property "webServer" without inject / plugin tree failed to load / failed to apply loader entry
- dsh-pocket 2.10.3 / 连锁 pending / 一长串 pending 只有一个真凶
- settingsScope / settingsSchema / configForms / settingsController / 26 entries did not activate
- 页面汇总清单 vs 浏览器 Console / 服务全量搜索 0 命中 / 服务被移除或改名
- peerDependencies / peer 范围不含当前版本 / 0.x 的 ^ 不跨大版本
- producer-owned source kind / format v4 message requires a producer-owned source kind / 运行期契约
- 本地 private 插件不在 npm / 升级修不到本地插件 / 代码里有 ≠ 就是它
