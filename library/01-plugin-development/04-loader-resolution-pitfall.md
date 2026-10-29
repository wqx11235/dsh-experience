<!-- date: 2026-08-15; source: dsh-experience starter library -->
# 坑 3（最隐蔽）：Loader 解析不到自定义包

**症状**：重启后 host 端完全没加载（HTTP 路由 404 落回 SPA fallback），但 client 行在 boot graph 里正常（`/plugins/<id>/client.js` 200）。

## 原因

两条解析链解析起点不同：

| 消费者 | 解析方式 | 能找到 `profiles/<p>/node_modules`？ |
| --- | --- | --- |
| client-modules（client 行） | `createRequire(baseUrl)`，从 **profile 目录**解析 | ✅ |
| loader（host 插件行） | 依赖 `node-addon-require-builtin` 原生模块拿 Node 内部 loader；**该模块缺失时**回退为**裸 `import(包名)`**，从 **npx 缓存目录**向上解析 | ❌ → `ERR_MODULE_NOT_FOUND` |

shipped 插件（`@deepseek-ai/*`）恰好都在 npx 缓存里，所以看起来"别的插件都行，就我的不行"。**该环境缺 `node-addon-require-builtin`**（在 `<npm-cache>\_npx\<hash>\node_modules\@deepseek-ai\` 下找不到），因此**所有自定义包都会踩这个坑**——不只是你新写的那个。

## 诊断命令

```powershell
# workdir 必须是 npx 缓存里的 cordis-plugin-loader 目录
# （<npm-cache>\_npx\<hash>\node_modules\@deepseek-ai\cordis-plugin-loader）
node --input-type=module -e "try { await import('dsh-my-plugin'); console.log('RESOLVED') } catch(e) { console.log('ERR', e.code) }"
# 输出 ERR_MODULE_NOT_FOUND → 中招
# 对照：@deepseek-ai/dsh-base 应当 RESOLVED
```

## 修复：npx 缓存建 junction 指向 profile 里的真实包

```powershell
New-Item -ItemType Junction -Path "<npm-cache>\_npx\<hash>\node_modules\dsh-my-plugin" `
  -Target "C:\Users\<user>\.dsh\profiles\<profile>\node_modules\dsh-my-plugin"
```

- **单一来源**：以后改 profile 里的包文件即可，junction 跟随。
- **一次修好所有自定义包**（同环境的 `dsh-math-battle` 一并修复）。

## 为什么不能用相对路径 name 绕过

`name: './node_modules/dsh-my-plugin'` 看似能解析，但 **graph id = 行 name**，`/plugins/<id>/client.js` URL 里的 `./` 会被浏览器 URL 规范化消掉，路由取出的 id 对不上 → bundle 404。所以 **name 必须用干净的裸包名**，解析问题交给 junction。

## 已知限制

- junction 在 **npx 缓存被清理 / dsh 升级**后丢失，需重建（把命令存成脚本或记录在 `99-templates/`）。
- 根治方向：为该环境装上 `node-addon-require-builtin`（loader 即用 profile 目录解析，无需 junction）——未验证，可作为后续尝试。
