# 中转站面板（aiapi）说明

Surge 模块 `surge/modules/aiapi.sgmodule`（脚本 `surge/scripts/aiapi_relay.js`）的配置与读法。
参数默认值见模块的 `#!arguments-desc`；Scripting 小组件版见 `scripting/aiapi/README.md`。

## 站点写法

`cch_endpoints` 一站一条、竖线分隔：`名称@地址=凭据[:模式][:优先级]`，模式省略即 `user`。

| 模式 | 凭据 | 显示 |
| --- | --- | --- |
| `admin` | CCH 管理员令牌 | 本站各上游余额，按厂商归并 |
| `user` / `cookie` / `login` | API Key / `auth-token` / API Key（自动换会话） | 该站账户余额 |
| `cchp` | CCHP 管理令牌 | 各 provider 余额、今日用量与健康度 |
| `cmdcode` | CommandCode API Key | 5H / W / M 剩余限额 |

余额源切到 CCHP 时，用 CCHP 条目**替换**原来的主站 admin 条目，两条同时保留会出现重复行：

```text
CCHP@cchp.example.com=<管理令牌>:cchp|Clouder@cc2.example.tech=<用户 Key>:user|CommandCode@api.commandcode.ai=<Key>:cmdcode:5
```

Clouder 的余额仍由它自己的 CCH 站点提供；Mi（miapi）不展示；CCHP 里没有任何启用 key 的 provider 不显示。

## 单账户余额

`aiapi_cchp_single_account` 默认开启：每个 provider 只刷新一把代表 key，只显示这把 key 所在账户的金额。
一个 provider 挂多个上游账户时会少算；需要合计时设为 `false`，改为逐把 key 刷新并按账户合计。该开关只影响面板与日报。

## 排序

行序按优先级升序（数值越小越靠前，可写小数）。站点末尾手写的 `:优先级` 最优先；没写时 CCHP 行取该 provider 启用 key 的最小优先级，
admin 行取上游自己的优先级，其他站点按域名或名称匹配 CCHP provider / CCH 厂商沿用其优先级。没有优先级的行排在后面，按 `CommandCode → Clouder → Kcne → Air` 兜底
（按名称前缀，不在表里的排最后），同档再按名称与配置顺序；余额不参与排序。优先级每轮从 CCHP 实取，key 启停当轮生效。

## CommandCode 两行

```text
CommandCode · 100.0% · 3.1s
5H 68.00% · W 59.00% · M 57.14%
```

第 1 行是站名、24 小时成功率与首字延迟 P50，取自 CCHP 的 provider 健康数据（按域名匹配，没有 CCHP 条目时只显示站名）。
第 2 行是 5 小时窗口、周窗口与月度的**剩余**比例；窗口不限量时写「不限」。`M` 按 `cch_cmdcode_month_cap`（默认 70 美元，按自己的套餐改）折算，
上限填错时显示剩余金额 `M $…`。任一项剩余 ≤20% 图标变黄、≤5% 变红。限额按 `cch_quota_interval` 秒缓存。

## 底部提示

| 提示 | 含义 |
| --- | --- |
| ⚠️ 余额未刷新，来自服务端缓存 | 上游复查全部失败或超时，显示的是 CCHP 上次保存的值 |
| ⚠️ 部分余额未刷新 | 部分 provider 没刷到，其余已是最新 |
| ⚠️ CCHP 余额来自缓存 | CCHP 列表请求本身失败，显示上次成功的快照 |
| ⚠️ 部分余额较旧 | 有 provider 的余额超过 24 小时没更新 |
| ⚠️ 单账户余额不可用 | 单账户模式下认不出代表 key 所在的账户，该 provider 不显示金额 |
| ⚠️ 限额来自缓存 | CommandCode 取数失败，显示上次的限额 |
| ⚠️ 部分请求超时 | 27 秒预算用完，已拿到的数据照常显示 |
| ⚠️ 部分排序信息缺失 | 本轮没取全 key 列表，行序退回兜底顺序 |
| ⚠️ 额度来自缓存 | 打开 `cch_show_limits` 后，供应商限额取数失败，显示的是缓存 |
