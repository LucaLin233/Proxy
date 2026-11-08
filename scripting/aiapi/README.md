# 中转站看板 · Scripting（含桌面小组件）

这是 Surge 模块 `surge/scripts/aiapi_relay.js` 的 Scripting 版本，把面板搬到了桌面小组件上。
它逐个服务商显示余额、健康度（24 小时成功率）与响应时间（首字 P50）；CommandCode 站点显示 5H / W / M 三个限额。
它不计算合计余额，也没有日报推送。

## 文件

```
中转站看板/
├── script.json     # 项目清单
├── index.tsx       # App 内设置页：站点参数、刷新间隔、Surge 导入/导出（不取数）
├── relay.core.ts   # 数据层：CCH / CCHP / CommandCode 取数、排序、缓存
├── views.tsx       # 小组件视图（widget.tsx 与 preview.tsx 共用）
├── widget.tsx      # 桌面小组件入口
├── app_intents.tsx # 小组件刷新按钮的 AppIntent
└── preview.tsx     # 本地排版预览（开发用，不影响运行）
```

## 配置

打开脚本会直接进入「中转站设置」。App 内只改参数，不取余额。

- **从 Surge 导入**：把模块参数里的 `cch_endpoints` 整段粘进来，点「解析并替换上方站点」，再保存即可。
  格式与 Surge 完全一致：`名称@地址=凭据[:模式][:优先级] | …`，模式省略时按 `user` 处理。
- **手动添加**：每个站点填名称、地址、模式和凭据。`cchp` 填管理令牌，`admin` 填管理员密钥，`user` 填 API Key，
  `login` 填 API Key（脚本会自动换成会话 Cookie），`cookie` 填 `auth-token`，`cmdcode` 填 CommandCode Key。
- **排序**：可选。填了数值就作为这一行的优先级（数值越小越靠前），优先于自动匹配；留空则按 CCHP 自动匹配。
- 每个站点可以单独停用；地址或凭据为空的站点不会保存。
- **刷新间隔**：小组件默认每 15 分钟重取一次余额，可选 15 分钟到 12 小时。保存后旧缓存会被清掉，下一次时间线立即按新配置取数。
- **导出**：「复制当前配置为 cch_endpoints」会把含凭据的整段配置放进剪贴板，方便粘回 Surge。
  它只留在本机剪贴板（不经接力同步到其他设备），10 分钟后由系统自动清除。

## 数据来源

| 模式 | 取数 | 展示 |
|---|---|---|
| `cchp` | 组织树 → provider 列表 → `providers/keys/page` 取全组织 key（优先级与 keyId）→ 代表 key 触发上游复查 → 重取列表；另取 24 小时 provider 健康 | 余额 + 成功率 + 首字延迟 |
| `admin` | `/api/v1/providers` + `/api/v1/provider-vendors` + `balances:batch`，按厂商归并取最低余额 | 厂商余额（Clouder / Miapi 不在此列） |
| `user` / `cookie` / `login` | `/api/v1/me/quota` 取余额，再取 `/api/v1/me/usage-logs/full` 最近 24 小时的 50 条日志 | 余额 + 成功率 + 首字 P50（没有日志时只显示余额） |
| `cmdcode` | `/alpha/whoami?limits=1` → `/alpha/billing/credits` | `5H` / `W` / `M` 三个剩余百分比 |

CCHP 的 key 列表每轮都从 `providers/keys/page` 实取（按 `nextCursor` 续页，最多 10 页），不缓存，停用或新增 key 在下一轮就生效。
取数完整时，没有任何 active key 的 provider（key 全部停用或还没建 key）不显示；
取数不完整时（请求失败、超时、`partial` / `preparing`、页数用满）不据此隐藏任何行，只是这一轮没有优先级，并提示「部分排序信息缺失」。
代表 key 取该 provider 的 active keyId；取不到时回退到 `provider.balance.keys[].key_id`，这条回退只用来挑代表 key，不用于判断可见性。
`balance.status=unsupported` 的 provider（如 CommandCode）不支持查余额，不会被拿去复查，它的限额请用 `cmdcode` 站点展示。

## 排序

- 第一键是优先级，升序；没有优先级的行排在有优先级的行后面。
- 优先级的来源：CCHP 行用 provider 下 active key 的最小 `priority`，CCH admin 行用上游自己的优先级；
  其他站点用手写的 `:优先级`（或设置页的「排序」），没写时按域名或名称匹配 CCHP provider 的优先级。
- 优先级相同或都缺失时，按 `relay.core.ts` 里的 `ROW_ORDER` 兜底：`CommandCode → Clouder → Kcne → Air`。
  先按行名、再按站点名匹配，按名称前缀归类（`Kcne-Astra` 算 `Kcne`），大小写不敏感；不在表里的行排在最后，同档内再按名称和采集顺序排。
- 优先级不做缓存：这一轮取不到就按兜底顺序排，下一轮取到后恢复。
- 取数失败的站点会保留一张红底「取数失败」卡片，永远排在最后，不会从列表里凭空消失。
- 中号和大号会把第一个带限额的站点（目前是 CommandCode）固定放在顶部通栏卡，其余行按上面的顺序排。

## 小组件

- **小号**：最多 4 个服务商，每条两行：第一行是名称和金额，第二行是健康度与延迟（CommandCode 显示 5H / W / M 文字胶囊）。
  放不下时，头部胶囊会显示「4/5」这样的已显示/总数。
- **中号**：CommandCode 是一张通栏限额卡（三条长进度条），其余服务商排成两列卡片网格；服务商多时自动切成单行紧凑卡片，最多约 9 个。
- **大号**：除顶部限额卡外的服务商不超过 4 个时，用单列宽卡把高度铺满；更多时切换成两列网格，最多约 12 个。
- 金额低于 $10 时标红，其余用正常文字色；只有 CommandCode 的限额条按剩余比例上色（>30% 绿、10–30% 橙、<10% 红）。
- 头部右上角的刷新按钮会清掉面板缓存并立即重载时间线，不用打开 App。第一次使用按钮如果没有反应，把小组件删掉重新添加一次即可。
- 头部的红色数字是取数失败的站点数，橙色 ⚠ 数字是降级提示数（例如余额来自缓存）；时间后面出现「缓存」表示本次用的是缓存数据。小号没有空间显示时间和缓存标记。
- 深色模式跟随系统，背景、文字和胶囊都使用动态颜色。

小组件按设置页的间隔请求新时间线，下一次时间线锚定在「数据时间 + 间隔」，系统提前唤醒时不会把节奏拖后。
间隔内会复用同一份缓存（最多提前 1 分钟失效，到点会真的重新取数），避免重复请求接口；刷新按钮会清缓存并绕过它。
iOS 会按电量和使用频率对小组件刷新节流，实际刷新可能晚于设定值；想要最新数据就点刷新按钮。

## 与 Surge 模块的关系

两个版本都是手工维护的，没有构建步骤，也不共享代码（Surge 脚本必须是能用 raw 链接直接加载的单文件）。
改动下面这些规则时，需要两边一起改：

- `cch_endpoints` 的写法与解析（模式、优先级、方括号容错）。
- 兜底顺序：这里的 `ROW_ORDER` 与 Surge 的 `PANEL_ROW_ORDER`。
- CCHP 可见性（只在 `keys/page` 取全时隐藏没有 active key 的 provider）、代表 key 与单账户投影、Mi（miapi）隐藏规则。
- CommandCode 限额的字段兼容与「剩余比例」算法。

目前有意保留的差异：

- 没有合计余额，也没有 23:50 的日报通知。
- CCH 管理站的「供应商限额」不展示；只有 CommandCode 显示三个限额。
- 单账户投影恒开：Surge 有 `aiapi_cchp_single_account` 开关，这里没有。
- 代表 key 取不到时，这里会回退到 `provider.balance.keys[].key_id`；Surge 只用 `keys/page` 的 active keyId。
- CCHP 一轮的时间预算约 24 秒（Surge 是 27 秒），超时就沿用服务端聚合值并给出提示。

## 注意

- 凭据保存在 Scripting 的 Storage（本脚本私有域）里，`login` 模式换来的会话 Cookie 也只存在本机。
- 会话 Cookie 与 CCHP 组织 ID 的缓存按「地址 + 凭据」区分，换 Key 后不会沿用上一个账户的数据。
- `login` 模式被拒时会自动用 Key 重新登录一次。
- 打开脚本只会进入设置页，不会取数；刷新数据请用小组件右上角的按钮。
