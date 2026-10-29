<!-- date: 2026-08-15; source: dsh-experience starter library -->
# 动态插件 vs 常驻插件：先做决策

## 决策表

| 维度 | 动态插件（`cordis_define` + `cordis_run`） | 常驻插件（profile patch + 本地包） |
| --- | --- | --- |
| 生命周期 | 仅存在于当前进程；**DSH 重启即丢失** | 随 profile 启动自动加载，**重启不丢** |
| 适用场景 | 临时工具、调试、一次性扩展 | 用户长期使用的功能（桌宠、面板、工具） |
| Client 通信 | `host.call` RPC（harness 内置） | 自定义 HTTP 端点 + 浏览器 `fetch` |
| 代码形态 | JS 函数体字符串（`cordis_define`） | 本地 npm 包（`package.json` + `index.js` + `client.js`） |
| 生效方式 | 需用户逐次批准（approval） | 配置即生效，无需批准 |

## 决策规则

- **"用户希望一直有"的功能 → 直接常驻方案**，别先做动态版再迁移（迁移会重复踩坑）。
- 动态插件的优势是快（免建包、免配置），适合探索期原型；验证完想法后再常驻化。
- 动态插件在**当前进程内**调试很顺（`cordis_inspect_self` 可直接看诊断），常驻插件出问题要靠 HTTP 探测和浏览器 Console（见 `04-diagnosis-methodology/`）。

## 动态插件丢失时的表现

- `cordis_inspect_self` 返回 `no dynamic plugin "xxx" in this process — it may have been removed or lost on DSH restart`
- 页面上的效果（UI、路由）消失

这不是故障，是动态插件的固有生命周期。
