<!-- date: 2026-10-29; source: dsh-experience 公开发布的隐私闸门 -->
# 隐私：公开库是怎么来的

> 原则：**私有库不出机器。** 公开的 `library/` 是"白名单 + 脱敏 + 双重闸门"的产物，不是手工拷贝。

## 威胁模型（我们在防什么）

| 风险 | 例子 | 处置 |
| --- | --- | --- |
| 绝对路径泄露机器结构 | `D:\work\project\...`、`C:\Users\<name>` | 全局脱敏为 `<workspace>` / `<home>` |
| 账号与联系方式 | GitHub 用户名、邮箱、QQ/群号 | 脱敏为 `<owner>` / `<email>`，账号类数字进闸门规则 |
| 个人与私有项目 | 人设称呼、私有插件、私有项目名 | 白名单只挑通用条目；命中的私有词直接替换/剔除 |
| 密钥 | `sk-`、`ghp_`、长 Bearer | 闸门硬失败 |
| 机器特有状态被当通用结论 | "本机装了 X 所以只需…" | 删白名单；必要时改写成条件句 |

注意：**"不泄露"不等于"没有信息量"**。公开条目可以保留真实的验证结论（版本、报错原文、命令），但必须去掉"只有作者这台机器才成立"的前提。

## 构建管线

```
私有库（仅本机）                  仓库
experience/*.md  ──允许清单──>  tools/public-entries.txt
                ──脱敏──>       tools/build-library.mjs
                ──逐文件修补──>  tools/library-tweaks.json
                ──闸门──>        tools/privacy-rules.mjs（泄漏）+ 死链检查
                                     │
                                     └──> library/（提交、审查、发布）
```

```sh
# 重建公开库（需要本机私有库路径）
DSH_EXPERIENCE_SOURCE=/path/to/private/experience node tools/build-library.mjs

# CI / 发布前：只做闸门，不重建
node tools/privacy-rules.mjs library
node test/linkcheck.mjs library
```

构建输出会列出每个文件的处理（`local-machine`、`dropped-links:9` 等）与闸门结果。**任一泄漏或死链 → 构建失败**，不会产出"半成品库"。

## 闸门规则（`tools/privacy-rules.mjs`）

| 规则 | 匹配 |
| --- | --- |
| `abs-path` | 任意盘符绝对路径（`X:\...`） |
| `home-user` / `unix-home` | `C:\Users\<name>`、`/home/<name>` |
| `email` | 邮箱 |
| `secret` | `sk-…`、`ghp_…`、长 Bearer |
| `account-id` | `QQ/群号/账号/uid` 后跟 6–12 位数字 |
| 本机私有词 | 工作区名、私有插件名、人设称呼、作者账号——写在 **`tools/private-terms.local.json`**（已 gitignore），构建与闸门运行时自动追加 |

规则分为两层：
- **公开层**（仓库里能看到）：任何机器都适用的通用规则；
- **本机层**（只在你的机器上）：`tools/private-terms.local.json`，形如 `{ "redactions": [...], "denylist": [...] }`，模板见 `tools/local-terms.example.json`。

这样公开仓库本身不含私有词，本机构建仍然会脱敏并拦截。

## 审查清单（每次重建公开库后）

1. `git diff library/` 逐条看：新增/修改的段落有没有机器特有的前提、私有项目名、内部链接。
2. 搜索 `本机`、`我们`、`公司`、`学校` 等第一人称/组织词，改成条件句。
3. 确认所有跨条目链接仍指向已收录的条目（构建会自动把未收录条目降级为纯文本）。
4. 跑 `node tools/privacy-rules.mjs library` 与 `node test/linkcheck.mjs library`，必须 0 命中。
5. 前端面板会显示索引一致性警告；公开库必须 0 warnings。

## 本地库与公开库的关系

- 本地库（默认 `~/.dsh/experience`）是**用户数据**，插件升级不覆盖、不上传。
- 公开库是**包内只读样本**，首次安装被复制一份到库根；之后两者独立演化。
- 想让自己的库也公开：把条目加进 `tools/public-entries.txt`，按上面的清单审一遍，重建即可。
