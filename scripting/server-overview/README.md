# 服务器监控 · Scripting（含桌面小组件）

把 Surge 模块 `surge/scripts/server_overview.js` 搬进 Scripting：
**按「区域 + 套餐」显示 AWS Lightsail 当月流量与配额占比**，另起一段显示 **Peekabo** 的当月流量与到期。
数据来自同一套接口，但展示从「Surge 面板文本」换成了可配置的桌面小组件。

## 文件

```
服务器监控/
├── script.json     # 项目清单
├── index.tsx       # App 内页面：Lightsail / Peekabo 明细 + 设置
├── core.ts         # 数据层：SigV4、Lightsail、Peekabo、缓存
├── views.tsx       # 小组件视图（widget.tsx 与 preview.tsx 共用）
├── widget.tsx      # 桌面小组件入口
├── app_intents.tsx # 小组件刷新按钮的 AppIntent
└── preview.tsx     # 本地排版预览（开发用，不影响运行）
```

## 配置

打开脚本 → 底部「设置」：

- **AWS Lightsail**：Access Key / Secret Key / 区域（`ap-east-1|ap-northeast-1`，逗号、分号、竖线都行）。
  密钥只需要三个只读权限：`lightsail:GetInstances`、`lightsail:GetBundles`、`lightsail:GetInstanceMetricData`。
- **Peekabo**：Server ID（控制面板 `/server/` 后面的内容）与 API Token。
- **IP 显示**：脱敏（`1.2.*.*`）/ 完整 / 隐藏，默认脱敏。
- **显示今日流量**：打开后会多查一轮今日的 `NetworkIn` / `NetworkOut`；关掉刷新更快。
- **从 Surge 导入**：把模块里 `argument="…"` 整段粘进来，点「解析并填入上方」即可。
  支持 `lightsail_ak` / `lightsail_sk` / `lightsail_region` / `lightsail_ip_mode` / `peekabo_id` / `peekabo_token`。
- **导出**：把当前配置复制回 Surge 模块参数，方便两边保持一致。

只填 AWS 或只填 Peekabo 都能用，未配置的一侧会自动跳过。

## 数据与展示

| 来源 | 取数 | 展示 |
|---|---|---|
| Lightsail | `GetInstances` → 按 `region + bundleId` 分组；`GetInstanceMetricData` 取当月 `NetworkIn` / `NetworkOut` 的 Sum；`GetBundles` 补套餐流量（本地缓存 24h） | 地区、套餐、公网 IP、当月已用 / 配额、占比；打开「今日」后多一行今日流量 |
| Peekabo | `GET https://vf-hk.peekabo.io/api/server/{id}?state=true`（Bearer Token） | 当月已用 / 总量、占比、到期日期与剩余天数 |

- 配额优先用实例自己的 `networking.monthlyTransfer.gbPerMonthAllocated`，没有才查套餐表。
- 当月按 UTC 月初切；今日按北京时间日切。
- 占比配色：≥90% 红、≥70% 橙、其余绿；配额未知时灰轨道 + `--`。
- 取数失败时：单侧失败只影响自己那一段；两侧都失败且本地有旧数据，就退回上一次缓存并标「缓存」。
- 顶部红 ⚠ 数字是错误条数；点进 App 能看到具体原因（例如 `Secret Key 不匹配`）。

## 小组件

- **小号**：最多 5 项，每个地区两行（名称 + 占比，下面一条进度条）；超过 4 项时自动收成紧凑行（保留名称、占比和进度条）。
- **中号**：最多 5 项；放不下时收成单行，单行包含「地区 · IP · 已用 / 配额 + 迷你进度条 + 占比」。
- **大号**：最多 7 项；空间够时每个地区三行（名称 + 占比 / 全宽进度条 / 已用 + 今日），放不下才收成单行。
- **Peekabo 永远保留一个位置**：项目多到要截断时，优先丢掉最后一个地区，而不是把到期信息挤掉。
- 头部有刷新按钮：清掉面板缓存 + `Widget.reloadAll()`，下一次时间线重新取数。
- 行高按可用高度均分并垂直居中；隐藏数量显示为 `5/8 项`。
- 深色模式跟随系统：暖色渐变背景 + 橙色徽章，浅色是奶白 / 深色是石墨。

小组件每 30 分钟请求一次新时间线；同一份数据 5 分钟内复用缓存，App 里点「刷新」会绕过缓存。
新增了 `app_intents.tsx`（清缓存 + `Widget.reloadAll()`），第一次用按钮时如果没反应，把小组件删掉重新添加一次即可。

## 与 Surge 脚本的差异

- 没有日报推送，也没有流量超限 / Peekabo 到期通知；只在面板里用颜色和「剩 N 天」提示。
- 不再请求 ip.zxinc.org / ip-api 做地理信息（原脚本也没把它画出来），省掉一轮网络。
- 地区没有中文名时回退显示区域代码（和原脚本一致）。
- 新增「今日流量」开关与缓存回退；原脚本面板模式不取今日数据。

## 注意

- 密钥存在 Scripting 的 Storage（本脚本私有域），只在本机。
- 目前只做 IPv4 脱敏；IPv6 会原样显示，建议用「隐藏」。
- 请求有预算：Lightsail 15 秒、Peekabo 8 秒；超时会显示失败原因或回退缓存。
