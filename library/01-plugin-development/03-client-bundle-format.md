<!-- date: 2026-08-15; source: dsh-experience starter library -->
# Client Bundle 格式与坑

浏览器端 UI 是**经典脚本（classic script）+ factory-form CJS**，通过 `window.__ModuleLoader__` 注册。

## 完整模板

```js
window.__ModuleLoader__.load({
  id: 'dsh-my-plugin',                          // ⚠️ 必须等于 patch 行 name（graph id）
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')                // react 在模块表里，可直接 require

    function MyComponent(props) {               // ⚠️ ctx 必须经 props 传入（见坑 5）
      var ctx = props.ctx
      React.useEffect(function () {
        return ctx.interval(function () {
          fetch('/my/endpoint').then(function (r) { return r.json() }).catch(function () {})
        }, 400)
      }, [])
      return React.createElement('div', null, 'hi')
    }

    exports.inject = ['timer']                  // 用 ctx.timeout/interval 必须声明（见坑 2）
    exports.apply = function (ctx) {
      var slots = ctx.get('slots')
      if (!slots) return
      slots.inject('shell.overlay', function () {
        return slots.register(
          { name: 'shell.overlay', id: 'my-plugin', order: 1000, label: '我的插件' },
          function () { return React.createElement(MyComponent, { ctx: ctx }) },
        )
      })
    }
    return module.exports
  },
})
```

## 硬性规则

1. **入口是 `window.__ModuleLoader__.load({ id, factory })`**；`id` 必须等于 patch 行 name（graph row id）。
2. **factory 内是 CJS 风格**：`require('react')` 拿 React（模块表 seed 词有 `react`、`react/jsx-runtime`、`react-dom` 等）。
3. **结尾 `return module.exports`**；导出 `apply` / `inject`（必要时 `Config`）。
4. **没有模块系统**：不要写 `import`/`export` 语句，全部用 `var`/`function`（现代语法如 `let`/箭头函数浏览器也支持，但保守写法最稳）。
5. **React 用 `React.createElement`**，不用 JSX。
6. `package.json` 必须声明 `dsh.client: { platform: "web" }` 且 `exports["./client"]` 指向 bundle 文件——client-modules 按此扫描并伺服 `/plugins/<id>/client.js`，内容 hash 成 rev。

## 常见症状

| 症状 | 原因 |
| --- | --- |
| `/plugins/<id>/client.js` 404 | graph id 与 bundle `load` 的 id 不一致（常见于 name 用了相对路径，见 loader 解析文档） |
| 页面无 UI，Console 报 `ctx is not defined` | 模块级组件引用 apply 作用域的 ctx（坑 5） |
| 渲染崩溃报 `service "timer" is not declared` | 缺 `inject: ['timer']`（坑 2） |
| 改了 bundle 页面没变化 | rev 变化需要**硬刷新（Ctrl+F5）**拿新 boot graph |

## 可用模块表种子词（已确认）

`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-web-react` 等（见 `packages/client/web/src/seed.ts` 的 `getStaticModules`）。
