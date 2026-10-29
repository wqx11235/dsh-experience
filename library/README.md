<!-- date: 2026-10-29; source: dsh-experience starter library -->
# 经验库 · 起步库

> 这是 `dsh-experience` 自带的一份**通用经验库**，安装后首次启动会复制到
> `~/.dsh/experience`（可用 `config.experienceRoot` 或 `DSH_EXPERIENCE_ROOT` 改）。
> 复制之后再也不会被升级覆盖——它是你的库，随便改。

## 一条经验长什么样

每个文件自包含，固定四节：

```markdown
<!-- date: 2026-10-29; source: 一句话来源 -->
# 一句话标题（供索引，写清"什么场景 + 什么结论"）

> 一句话概述：这是什么问题、谁会遇到。

## 症状
可观察现象，尽量给报错原文 / HTTP 状态 / 文件名。

## 原因
根因链，精确到机制，而不是"配置不对"。

## 避坑（可复制）
能直接执行的命令 / 配置 / 代码。

## 诊断关键词
每行一个词或短语：报错原文、命令名、服务名、关键变量名。
```

- front-matter 必须是**第 1 行**（插件只读第一个 `<!-- -->`）。
- 「诊断关键词」是检索加权最高的一节（+8）；「避坑」次之（+5）。
- 可选字段：`severity: critical`（排序提权 + 面板标最高危险）、`dshVersion:`（跨版本锚定）、`verify: path <p>` / `verify: url <u>`（每 4 小时校验，失效打标）。

## 起步库收录了什么

| 分类 | 条目 | 为什么值得先读 |
| --- | --- | --- |
| `00-global` | 文件与检索工具的用法纪律 | `edit` 前必须 `read`、`old_string` 要唯一——候选池里最多的一类噪声 |
| `01-plugin-development` | 动态插件 vs 常驻插件 / 常驻三件套 / client bundle 格式 / loader 解析不到自定义包 / 无损 JSON 输出契约 | 写 DSH 插件最先撞上的五个坑 |
| `01-plugin-development` | 经验库检索与采集机制 | 这套库自己的打分与闭环，改之前先读 |
| `02-configuration` | Profile 目录结构与 patch 层 | bundle / patch / profile 三层怎么叠加 |
| `03-filesystem-and-sandbox` | 提权 justification 用中文写 | 弹窗里给用户看的那句话就是它 |
| `04-diagnosis-methodology` | 升级运行库后页面加载失败的连锁故障 / headless 前端冒烟 | "后端 200 ≠ 前端能用"的两个实证 |
| `06-shell-tooling` | `.cmd`/`.bat` 里写非 ASCII 会崩启动器 | Windows 上最贵的一次静默故障 |
| `07-web-frontend` | `.hidden` 与内联 style 的优先级 | 用 JS 改 `style.display` 为什么没反应 |

## 怎么让它长大

1. **先搜**：`experience_search` / 面板搜索。没命中就继续干活。
2. **出错时**：插件会自动把命中条目的「症状 + 避坑」推进对话；工具失败同时进候选池。
3. **收尾时**：`experience_gaps` 看缺口与待认领草稿 → `experience_promote` 一条命令入库（自动套模板、查重、同步分类 README、验证覆盖）。
4. **别手抄**：从候选/草稿入库用工具；手写就按上面的模板。

## 隐私

这份起步库是为公开发布整理的**通用**经验，已通过构建期隐私闸门（无绝对路径、无账号/邮箱、无个人与私有项目信息）。你的本地库不会被上传，插件也没有任何联网上报逻辑。
