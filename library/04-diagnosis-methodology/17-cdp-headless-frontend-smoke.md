<!-- date: 2026-09-09; source: dsh-experience starter library -->
# 用 headless Edge + CDP 做「前端冒烟」：后端 200 ≠ 前端能用

> 场景：升级 DSH 本体后要判断"页面到底能不能跑"。接口探针全 200、启动 html 里也能搜到插件名，
> 但前端可能整棵插件树加载失败（页面只剩错误屏）。该环境所有现成的浏览器自动化手段都不可用，
> 最后用 **headless Edge + CDP** 拿到决定性证据。

## 症状 / 障碍

想验证"新运行库下页面是否正常"，但三条路都不通：

| 手段 | 结果 |
| --- | --- |
| DSH 的 `browser-skill`（browser_* 工具） | 宿主日志 `bsk probe failed (spawn bsk ENOENT)`——`bsk` CLI 没装，工具只报安装指引 |
| Edge headless（沙箱内） | `crashpad_client_win.cc: OpenProcess: 拒绝访问 (0x5)`——浏览器根本起不来 |
| Edge headless（放宽沙箱后） | `--headless=new --dump-dom` 不支持（exit `0x80000003`）；`--headless=old --dump-dom` **不退出** → 超时被杀 |

## 可用方案（可复制）

**`--remote-debugging-port` + Node 全局 WebSocket 直连 CDP**，Edge 生命周期由自己控制：

```powershell
# 1) 先杀净残留 headless 进程（否则会连到旧 target，旧页面的错误污染报告！）
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like '*--headless*' } |
  ForEach-Object { taskkill /F /PID $_.ProcessId }

# 2) 启动 Edge 时【直接带上目标 URL】（不要启动后再 Page.navigate，否则页面加载两次、
#    第一次的错误会混进报告）。沙箱内起不来 → 需 sandbox_permissions: danger-full-access
$edge = '<edge-exe>'
Start-Process $edge -ArgumentList @(
  '--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port=9222',
  "--user-data-dir=<workspace>\.tmp-edge-cdp", $URL
) -WindowStyle Hidden
# 3) 等 9222 就绪 → 跑 Node 探针 → 同一条命令内杀 headless Edge
```

Node 探针要点（Node 22 自带全局 `WebSocket`，无需依赖）：

```js
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
const ws = new WebSocket(page.webSocketDebuggerUrl)
// 收 Runtime.exceptionThrown / Runtime.consoleAPICalled / Log.entryAdded / Network.loadingFailed
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable')
await sleep(30000)                                    // 让插件树跑完
const body = (await send('Runtime.evaluate', {
  expression: 'document.body ? document.body.innerText : ""', returnByValue: true,
})).result.result.value
// 判定：body.includes('Failed to load plugins') / body.includes('missed the module table')
```

**关键判据**：错误屏是**渲染出来的 DOM**，所以 `document.body.innerText` 里能直接读到
`Failed to load plugins` 和具体插件名；console 里能读到完整异常栈。

## 避坑

1. **必须 escalation**：沙箱内 Edge 的 crashpad 会被 `OpenProcess 0x5` 拒掉。
2. **启动就带 URL**，不要 `Page.navigate`（会双载，污染报告）。
3. **先杀净残留 headless Edge**：否则新探针可能连到旧 target，把上一轮的旧错误当成当前结果（本次踩过，差点误判）。
4. 清理时只杀 `CommandLine -like '*--headless*'` 的 Edge，**别 `taskkill /IM msedge.exe`**——会关掉用户正在用的浏览器。
5. 探针结论要**迭代**：停一个失败插件后重跑，往往暴露下一个（本次 3 轮才干净）。

## 诊断关键词

- `Failed to load plugins` / `missed the module table` / `did not activate`
- `bsk ENOENT` / `crashpad OpenProcess 0x5` / `--dump-dom 不退出`
- `--remote-debugging-port` / `Runtime.exceptionThrown` / `document.body.innerText`
- 后端 200 ≠ 前端能用 / 前端冒烟 / 插件树加载失败
