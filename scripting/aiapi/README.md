# AI 中转站概览 · Scripting App（含小组件）

把 Surge `aiapi` 模块面板的内容搬进 Scripting：余额、今日用量、供应商健康；同一份数据也上桌面小组件。

## 项目结构

```
AI 中转站/
├── script.json        # 项目清单（name / icon / color / version）
├── index.tsx          # 主页面：设置页 + 面板
├── aiapi.core.ts      # 数据层：CCHP / CCH admin / CCH user 取数、排序、提示
└── widget.tsx         # 桌面小组件
```

三个 `.ts/.tsx` 都在同一项目里，`index.tsx` 与 `widget.tsx` 通过 `./aiapi.core` 共用数据层（官方技能确认支持跨文件导入）。

## 安装

1. Scripting → 新建**脚本项目**（名字随意，本项目清单里叫「AI 中转站」）。
2. 新建 `script.json`、`index.tsx`、`aiapi.core.ts`、`widget.tsx` 四个文件，分别粘贴同目录文件内容。
3. 运行 `index.tsx`：没有配置时先显示**设置页**，把 Surge 模块的 `cch_endpoints` 粘贴进输入框，保存即开始取数。
4. 加桌面小组件：长按桌面 → 加 Scripting 小组件 → 编辑小组件 → 选本项目。中号显示 5 行，小号 3 行，大号 9 行。

## 关键 API（按官方技能 `scripting-app-development` 核对）

- `Storage` 是**运行时全局**（`Storage.get/set`），不是模块导出；`Keychain` 在 3.2.1 不一定存在。
  代码里先看 `Keychain` 再用 `Storage`，两者都没有时设置页会提示「配置可能无法保存」。
- 小组件：`Widget.present(<View />)` 之后执行上下文立即销毁，所有取数必须在 present 之前完成；不能用 hooks 维持状态。
- 面板每次刷新成功后会调 `Widget.reloadAll()`，桌面随之更新。

## 与 Surge 模块的差异

| 项目 | 模块 | 本脚本 |
|---|---|---|
| 模式 | user / cookie / admin / login / cchp / cmdcode | 全部六种，设置里用 Picker 选择 |
| Clouder / Mi | 分别由 CCH 站点提供 / 隐藏 | 相同 |
| 今日用量、健康 | 有 | 有 |
| 日报推送 | 有 | 无（脚本里查看） |
| cmdcode 月度上限 | 模块参数 `cch_cmdcode_month_cap`，默认 70 | 同默认 70，未做参数化 |
| 配置 | 模块参数 | 应用内设置页（存 Storage/Keychain） |

## 已验证 / 未验证

- 已验证：`index.tsx`、`widget.tsx` 均可编译（esbuild，多文件解析通过）；数据层对真实 CCHP 跑通（Kcne $21.24 / SD $16.00 / Air $2.46，今日 1265 次、首字 3.7 s，约 5 s）；Node 桩环境验证「无配置 → 设置页」「有配置 → 面板」「小组件未配置提示」三条路径不崩。
- 未验证：App 内真机渲染、`admin` / `user` 模式（无凭据）、小组件在各 family 下的实际排版。
