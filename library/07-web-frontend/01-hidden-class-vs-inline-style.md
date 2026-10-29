<!-- date: 2026-08-18; source: dsh-experience starter library -->
# `.hidden{display:none !important}` 下 JS 改 `style.display` 无效 → 用 classList.toggle('hidden')

> 原生 JS 做标签页/面板切换时,元素带 `hidden` 工具类(`display:none !important`),JS 里写 `el.style.display=''` 想显示它,结果纹丝不动——`!important` 优先级压过内联样式。任何写原生 JS/CSS 的人都会踩。

## 症状

- 点击标签按钮,面板/区域不切换,视觉上完全没变化。
- F12 检查元素:class 里仍有 `hidden`,或 `display:none` 仍然生效。
- 同一套代码里有些元素切换正常、有些不正常——区别只在 HTML 是否写了 `hidden` 类。

## 原因

- CSS 里工具类通常是 `.hidden { display: none !important; }`,`!important` 使该声明优先级高于任何非 important 来源,包括**内联样式** `style.display`。
- JS 的 `el.style.display = ''` 只是移除内联声明,元素仍命中 `.hidden` 规则 → 依旧 `display:none`。
- 首次"看起来正常"是因为元素初始没有 `hidden` 类(纯靠内联 display 切换),一旦 HTML 带 `hidden` 类就翻车,行为不一致。

## 避坑(可复制)

```js
// ❌ 无效:元素带 .hidden 类时
el.style.display = '';

// ✅ 有效:统一用 classList 切换工具类
el.classList.toggle('hidden', !visible);
// 或
el.classList.remove('hidden');   // 显示
el.classList.add('hidden');      // 隐藏
```

- 项目内**约定一种方式**:要么全部用工具类 + `classList.toggle`,要么全部用内联 `style.display`(此时工具类不要带 `!important`)。
- 排查顺序:元素切不动 → 先看 HTML 里有没有 `hidden` 类 → 再看 CSS 里该规则是否带 `!important` → 最后才怀疑 JS 逻辑。

## 诊断关键词

- hidden important
- display none important
- classList.toggle hidden
- style.display 不生效
- 标签页切换无效
