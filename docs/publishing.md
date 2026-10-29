<!-- date: 2026-10-29; source: dsh-experience 发布与上架流程 -->
# 发布与上架

目标：`github.com/<owner>/dsh-experience` 可安装 → 出现在 **awesome-dsh-plugin** 精选列表 → dshmarket / 宿主「插件 → 发现」搜得到。

## 0. 前置（缺一条会被 CI 或评审打回）

- [ ] 仓库公开，且**创建满 1 天**（PR 前几分钟建的仓库会被自动拒；只是过滤，不算评价，隔天重提即可）。
- [ ] `package.json` 里有 `dsh.bundle.patch`，仓库根有 `cordis.patch.yml`。
  - ⚠ 只有 `dsh.client` **不算可安装**，这是最常见的被拒原因。
- [ ] 仓库带 `dsh-plugin` topic。
- [ ] `README.md` + `LICENSE`（MIT）。
- [ ] 描述**属实**：写了几个工具、什么命令，评审会对着代码核。
- [ ] 分类选贴合功能的（本项目选 `memory`，不是"希望出现在哪"）。

## 1. 建仓库并推送

```sh
# 在项目目录
git init
git add -A
git commit -m "dsh-experience 0.1.0: self-learning experience library for DSH"
git branch -M main
git remote add origin https://github.com/<owner>/dsh-experience.git
git push -u origin main
```

仓库设置里补：About 简介、`dsh-plugin` topic、可选的 180×180 图标（market 卡片会回退到作者头像）。

> 当前机器直接 `git` 访问 GitHub 可能被 schannel/代理卡住（见经验库 `04-diagnosis-methodology` 的 GitHub 出口条目）；必要时用 GitHub 网页上传 / 或用可用的代理再推。

## 2. npm 发布（可选，但推荐）

没发 npm 也能从 GitHub 安装；发了 npm 之后市场能显示版本、下载量，安装命令也更短。

```sh
npm login            # 一次性
npm publish          # 包名 dsh-experience 若可用
```

发布前改版本号并跑：

```sh
node test/host-harness.mjs
node tools/privacy-rules.mjs library
node test/linkcheck.mjs library
```

## 3. 提交收录（一个 YAML 文件就是投稿）

仓库：`github.com/awesome-dsh-plugin/awesome-dsh-plugin`。**README 是生成的，不要手工编辑。**

新建 `data/plugins/<owner>__<repo>.yml`：

```yaml
url: https://github.com/<owner>/dsh-experience   # 必须与仓库完全一致
name: <owner>/dsh-experience
category: memory
description:
  en: 'Local-first experience library for DeepSeek Harness: indexed markdown knowledge with error-signature retrieval, failure capture, gap-to-entry closure, and a sidebar panel. Ships a sanitized starter library. No network access.'
  zh: '本地优先的经验库：给 DeepSeek Harness 的索引化 markdown 知识，支持错误签名检索、失败采集、缺口→条目闭环与侧边栏面板；自带脱敏起步库，不联网。'
```

规则：
- 描述含 `: `（冒号+空格）时**必须加引号**，否则 YAML 解析失败。
- 一个文件就是全部投稿；不要改生成的 README。
- 合并后 README 会在 main 上自动重建，站点与市场当日刷新。

## 4. 上架后

- 宿主 **插件 → 发现（Discover）→ 索引源**可加 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`（format 1 索引，分发在 npm，比站点快）。
- 市场对已收录条目的检查：仓库存在、活跃维护、`dsh.bundle` 仍在、描述未过期。
- 发版：`package.json` 版本 + GitHub tag + Release 说明；市场按 npm 版本或锁定 commit 检测更新。

## 5. 本项目的就绪状态

- [x] `dsh.bundle` + `cordis.patch.yml`（已去掉硬编码库路径）
- [x] MIT LICENSE
- [x] README（机制/安装/隐私/开发）
- [x] 公开起步库 + 隐私闸门 + 死链闸门
- [x] 无宿主集成测试（`test/host-harness.mjs`）
- [ ] GitHub 仓库创建与推送（需要账号操作）
- [ ] `dsh-plugin` topic
- [ ] awesome-dsh-plugin PR（仓库满 1 天后）
- [ ] npm 发布（可选）
