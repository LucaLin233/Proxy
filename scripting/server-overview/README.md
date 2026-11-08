# 服务器监控 · Scripting（含桌面小组件）

这是 Surge 脚本 `surge/scripts/server_overview.js` 的 Scripting 版本。
它按「区域 + 套餐」显示 AWS Lightsail 当月流量与配额占比，另起一段显示 Peekabo 的当月流量与到期时间。
数据来自同一套接口，展示从 Surge 面板文本换成了桌面小组件。

## 文件

```
服务器监控/
├── script.json     # 项目清单
├── index.tsx       # App 内设置页：AWS / Peekabo 参数、Surge 导入/导出（不取数）
├── core.ts         # 数据层：SigV4、Lightsail、Peekabo、缓存
├── views.tsx       # 小组件视图
├── widget.tsx      # 桌面小组件入口
└── app_intents.tsx # 小组件刷新按钮的 AppIntent
```

## 配置

打开脚本会直接进入「服务器设置」。App 内只改参数，不取数。

- **AWS Lightsail**：填 Access Key、Secret Key 和区域（默认 `ap-east-1|ap-northeast-1`，逗号、分号、竖线都可以分隔）。
  密钥只需要三个只读权限：`lightsail:GetInstances`、`lightsail:GetBundles`、`lightsail:GetInstanceMetricData`。
- **Peekabo**：填 Server ID（控制面板 `/server/` 后面的内容）与 API Token。
- **IP 显示**：脱敏（`1.2.*.*`）、完整或隐藏，默认脱敏。
- **显示今日流量**：打开后会多查一轮今日的 `NetworkIn` / `NetworkOut`，关掉刷新更快。
- **刷新间隔**：小组件默认每 30 分钟重取一次，可选 15 分钟到 12 小时。间隔内复用同一份缓存；保存后会清掉旧缓存，下一次时间线立即按新配置取数。
- **从 Surge 导入**：把模块里 `argument="…"` 整段粘进来，点「解析并填入上方」即可。
  支持 `lightsail_ak`、`lightsail_sk`、`lightsail_region`、`lightsail_ip_mode`、`peekabo_id`、`peekabo_token`。
- **导出**：把当前配置复制成 Surge 模块参数。内容含密钥，所以只留在本机剪贴板（不经接力同步），10 分钟后由系统自动清除。

刷新间隔与「显示」里的开关只存在本机，不会写进 Surge 参数。只填 AWS 或只填 Peekabo 都能用，未配置的一侧会自动跳过。

## 数据与展示

| 来源 | 取数 | 展示 |
|---|---|---|
| Lightsail | `GetInstances` 后按 `region + bundleId` 分组；`GetInstanceMetricData` 取当月 `NetworkIn` / `NetworkOut` 的 Sum；`GetBundles` 补套餐流量（本地缓存 24 小时） | 地区、套餐、公网 IP、当月已用 / 配额与占比；打开「今日」后多一行今日流量 |
| Peekabo | `GET https://vf-hk.peekabo.io/api/server/{id}?state=true`（Bearer Token） | 当月已用 / 总量、占比、到期日期与剩余天数 |

- 配额优先用实例自己的 `networking.monthlyTransfer.gbPerMonthAllocated`，没有才查套餐表。
- 当月按 UTC 月初切分，今日按北京时间日切。
- 占比配色：≥90% 红、≥70% 橙、其余绿；配额未知时显示灰色轨道和 `--`。
- 单侧取数失败只影响自己那一段；两侧都失败且本地有旧数据时，退回上一次缓存并标「缓存」。
- 顶部红色 ⚠ 数字是错误条数，失败卡片会显示具体原因；小号没有空间，错误只体现在失败卡片和概要胶囊上。

## 小组件

- **小号**：最多 5 项，每个地区两行（名称 + 占比，下面一条进度条）；超过 4 项时收成紧凑行，不画卡片。
- **中号**：最多 5 项，每项一张半透明圆角卡。4–5 项时是单行（名称 · IP · 已用 / 配额 + 迷你进度条 + 占比），2–3 项时展开为「标题 / 通栏进度条 / 详情」。
- **大号**：最多 9 项。占比最高且 ≥50% 的一项做成通栏主卡（带「最紧张」胶囊，≥90% 时从琥珀色切到红色），其余按 2 列网格排列；最后一行只剩一张卡时拉成通栏，剩余不超过 4 项时改成单列通栏卡。卡片按可用高度撑满。
- 高度足够（≥84pt）的通栏卡显示四行：`名称 + IP` / 进度条 / `已用 / 配额` / `今日 · 地区代码`（Peekabo 为 `剩 N 天 · 到期日`）。
- 项目多到需要截断时优先丢掉最后一个地区，Peekabo 永远保留一个位置。
- 头部只有一行：`服务器概览` 标题 + 「N 组 · M 台」胶囊（截断时显示已显示/总数）；小号不显示时钟与缓存标记。
- 深色模式跟随系统：浅色是奶白底，深色是石墨底；Peekabo 卡片固定用青绿色底。

小组件按设置页的间隔请求新时间线，下一次时间线锚定在「数据时间 + 间隔」，系统提前唤醒时不会把节奏拖后。
两侧都失败、只能显示旧缓存时，改为从本次尝试时间起再等一个间隔，不会每分钟重取一次。
间隔内复用同一份缓存（最多提前 1 分钟失效，到点会真的重新取数）；保存设置和头部右上角的刷新按钮都会清掉缓存。
第一次使用刷新按钮如果没有反应，把小组件删掉重新添加一次即可。

## 与 Surge 脚本的差异

两个版本都是手工维护的，SigV4 签名、Lightsail 取数和 Peekabo 字段解析的改动需要两边一起改。

- 没有日报推送，也没有流量超限 / Peekabo 到期通知，只在小组件里用颜色和「剩 N 天」提示。
- 新增「今日流量」开关与失败时的缓存回退；Surge 面板模式不取今日数据。
- 地区没有中文名时回退显示区域代码，与 Surge 版一致。

## 注意

- 密钥保存在 Scripting 的 Storage（本脚本私有域）里，只在本机。
- 目前只对 IPv4 脱敏，IPv6 会原样显示，介意的话请选「隐藏」。
- 请求有预算：Lightsail 15 秒、Peekabo 8 秒；超时会显示失败原因或回退缓存。
