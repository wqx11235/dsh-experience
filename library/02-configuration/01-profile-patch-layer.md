<!-- date: 2026-08-15; source: dsh-experience starter library -->
# Profile 目录结构与 Patch 层规则

## 目录布局

```
~/.dsh/                          ← DSH_HOME
├── cordis.patch.yml             ← home 层补丁（应用于所有 profile；该环境当前不存在）
├── profiles/
│   ├── node_modules/            ← 共享模块回退层（healProfilesModuleFallback 维护）
│   └── <profile>/               ← 如 web（dsh web 默认 profile）
│       ├── package.json         ← dsh.profile.bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
│       ├── cordis.yml           ← ⚠️ 自动重写的空根 entry list，**不要编辑**
│       ├── cordis.patch.yml     ← ✅ 用户补丁层（编辑这里）
│       ├── pnpm-workspace.yaml
│       └── node_modules/        ← profile 专属依赖（自定义包放这里）
```

## Patch 规则

- 补丁是**顶层 YAML 数组**：id-targeted config 覆盖、`disabled`、`insert` 列表。
- 行 name 解析基准 = profile 目录（`baseUrl`）。
- 生效顺序：bundle 层（dsh-base → dsh-web-app）→ profile `cordis.patch.yml` → home 层 → `--patch` 覆盖。
- **编辑 `cordis.patch.yml`，不是 `cordis.yml`**（后者每次启动被重写为固定空根，避免 loader 写回烘焙重复行）。

## 热重载（HMR）行为

- `watchUserPatches` 通过 HMR 监视 `cordis.patch.yml`，变化时重新应用补丁层。
- **触发条件 = patch 解析后的结构变化**（增删行、改 config）；**只改注释不触发**。
- 可靠的手动触发方式：先写 `[]`，等 3–5s，再写回完整内容（「删行→加行」两轮）。
- 已知缺陷：热重载卸载不彻底，旧路由可能残留导致重载后 duplicate 冲突（表现为部分路由 200/部分 404）——**最终以重启验证为准**。

## 挂载自定义插件的行

```yaml
- insert:
    - id: my-plugin
      name: 'dsh-my-plugin'       # 裸包名；勿用相对路径（会破坏 client bundle URL）
```

## 相关坑

- 自定义包 host 端不加载 → `01-plugin-development/04-loader-resolution-pitfall.md`（junction 方案）。
- 写这些文件需要文件沙箱放行 → `03-filesystem-and-sandbox/`。
