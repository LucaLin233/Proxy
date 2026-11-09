# 中转站看板 · Scripting（含桌面小组件）

Surge 脚本 `surge/scripts/aiapi_relay.js` 的 Scripting 版：桌面小组件逐个服务商显示余额、24 小时成功率与首字延迟，
CommandCode 显示 5H / W / M 剩余限额。

## 文件

```
中转站看板/
├── script.json     # 项目清单
├── index.tsx       # App 内设置页（不取数）
├── relay.core.ts   # 数据层：CCH / CCHP / CommandCode 取数、排序、缓存
├── views.tsx       # 小组件视图
├── widget.tsx      # 桌面小组件入口
├── app_intents.tsx # 小组件刷新按钮
└── preview.tsx     # 本地排版预览（开发用）
```

## 配置

打开脚本进入「中转站设置」，只改参数、不取数；刷新数据用小组件右上角的按钮
（第一次点没有反应时，删掉小组件重新添加一次）。

- **从 Surge 导入**：粘贴模块参数 `cch_endpoints` 整段，点「解析并替换上方站点」后保存。
  写法与 Surge 相同：`名称@地址=凭据[:模式][:优先级] | …`，模式省略即 `user`。
- **手动添加**：填名称、地址、模式和凭据（`cchp` 管理令牌、`admin` 管理员密钥、`user` / `login` API Key、
  `cookie` 填 `auth-token`、`cmdcode` 填 CommandCode Key）。「排序」可选，数值越小越靠前，留空按 CCHP 自动匹配。
  地址或凭据为空的站点不会保存。
- **刷新间隔**：默认 15 分钟，可选 15 分钟到 12 小时，iOS 可能延后。保存后旧缓存作废。
- **导出**：「复制当前配置为 cch_endpoints」把含凭据的整段配置复制到本机剪贴板（不随接力同步），10 分钟后系统自动清除，用于粘回 Surge。

凭据保存在 Scripting 的 Storage（本脚本私有域）。

## 读法

取数、排序和「⚠️」提示的含义同 Surge 面板，见 [docs/aiapi-panel.md](../../docs/aiapi-panel.md)。
金额低于 $10 标红；CommandCode 限额条剩余 >30% 绿、10–30% 橙、<10% 红。
头部红色数字是取数失败的站点数，橙色 ⚠ 数字是降级提示数，时间后的「缓存」表示用的是缓存数据。
与 Surge 版的区别：没有合计余额和日报，单账户模式恒开（没有 `aiapi_cchp_single_account`），不展示供应商限额。

## 同步清单

两边手工维护、不共享代码，改动以下规则时两边都要改：

- `cch_endpoints` 的写法与解析；
- 兜底顺序：这里的 `ROW_ORDER` 与 Surge 的 `PANEL_ROW_ORDER`；
- CCHP 可见性、代表 key 与单账户投影、Mi（miapi）隐藏规则；
- CommandCode 限额的字段兼容与剩余比例算法。
