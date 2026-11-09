# 服务器监控 · Scripting（含桌面小组件）

Surge 脚本 `surge/scripts/server_overview.js` 的 Scripting 版：按「区域 + 套餐」显示 AWS Lightsail 当月流量与配额占比，
另起一段显示 Peekabo 的当月流量与到期时间。

## 文件

```
服务器监控/
├── script.json     # 项目清单
├── index.tsx       # App 内设置页（不取数）
├── core.ts         # 数据层：SigV4、Lightsail、Peekabo、缓存
├── views.tsx       # 小组件视图
├── widget.tsx      # 桌面小组件入口
└── app_intents.tsx # 小组件刷新按钮
```

## 配置

打开脚本进入「服务器设置」，只改参数、不取数。只填 AWS 或只填 Peekabo 都能用。

- **AWS Lightsail**：Access Key、Secret Key 和区域（默认 `ap-east-1|ap-northeast-1`，逗号、分号、竖线分隔）。
  密钥只需 `lightsail:GetInstances`、`lightsail:GetBundles`、`lightsail:GetInstanceMetricData` 三个只读权限。
- **Peekabo**：Server ID（控制面板 `/server/` 后面的部分）与 API Token。
- **IP 显示**：脱敏（只处理 IPv4）、完整或隐藏，默认脱敏。
- **显示今日流量**：多查一轮今日流量，关掉刷新更快。
- **刷新间隔**：默认 30 分钟，可选 15 分钟到 12 小时，保存后旧缓存作废。
- **从 Surge 导入 / 导出**：粘贴模块的 `argument="…"` 整段，点「解析并填入上方」；导出把当前配置复制成同样的参数（含密钥）。
  支持 `lightsail_ak`、`lightsail_sk`、`lightsail_region`、`lightsail_ip_mode`、`peekabo_id`、`peekabo_token`；
  刷新间隔与显示开关只存本机。

密钥保存在 Scripting 的 Storage（本脚本私有域）。刷新按钮第一次点没有反应时，删掉小组件重新添加一次。

## 读法

- 占比 ≥90% 红、≥70% 橙，其余绿；配额未知时显示 `--`。
- 单侧取数失败只影响自己那一段，失败卡片显示原因；两侧都失败时显示上一次的数据并标「缓存」。

## 与 Surge 版的区别

没有日报和超限 / 到期通知；多了「今日流量」开关与失败时的缓存回退。
SigV4 签名、Lightsail 取数和 Peekabo 字段解析两边手工维护，改动时两边都要改。
