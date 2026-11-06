# DeepSeek 余额 · Scripting（含桌面小组件）

显示 DeepSeek 的可用余额、赠送 / 充值构成，以及今日、近 7 天的消耗。
DeepSeek 是按量计费、没有套餐额度，所以**不画水位线 / 额度进度条**；进度条改为「赠送 / 充值」的余额构成条。

## 文件

```
DeepSeek 余额/
├── script.json      # 项目清单
├── index.tsx        # App 内页面：余额、构成、消耗、设置
├── config.ts        # 配置、App Group 存储、采样记录
├── api.ts           # GET https://api.deepseek.com/user/balance
├── core.ts          # 取数、缓存、消耗统计、格式化
├── views.tsx        # 小 / 中 / 大号小组件视图
├── widget.tsx       # 桌面小组件入口
├── app_intents.tsx  # 刷新按钮的 AppIntent
├── preview.tsx      # 本地排版预览（开发用，不影响运行）
└── dsbrand.tsx      # DeepSeek 鲸鱼 logo（Canvas 重绘）
```

## 配置

打开脚本 → 「设置」：

- **API Key**：`sk-` 开头的 DeepSeek Key，只保存在本机 App Group 的 `deepseek/config.json`，仅用于查询余额。
  旧版「DeepSeek 小组件」也用同一个文件，装过旧版的话不用重新填 Key。
- **刷新周期**：15 / 30 分钟，1 / 2 / 3 / 6 / 12 小时，默认 15 分钟。小组件按这个周期请求新时间线，iOS 可能因省电延后。
- **低余额阈值**：默认 10，低于这个金额时 App 和小组件的余额标红；填 0 关闭。
- **清除消耗记录**：两次点击确认；只清 `usage.json`，不影响 Key 和余额。

## 数据来源

`GET https://api.deepseek.com/user/balance`，响应里的 `balance_infos[]` 按币种返回
`total_balance / granted_balance / topped_up_balance`。优先显示 CNY，其他币种在 App 里单列。

每次刷新对比上一次余额：

- 余额下降 → 记录一笔消耗；
- 余额上涨（充值 / 退款）→ 记 0，并自动更新赠送 / 充值构成；
- 取数失败 → 保留上一次成功余额，标「失联 / 缓存」，不会把余额清零；
- 采样记录保留最近 30 天、最多 2000 条。

## 小组件

- **小号**：单行头部（标题 + 币种胶囊 + 刷新），余额 + 构成条 + 赠送 / 充值金额，底部一条胶囊显示今日 / 近 7 天消耗。
- **中号**：上方余额主卡（含构成条、「赠 x% · 充 y%」），下方三张卡：赠送、充值、今日消耗。
- **大号**：更大的余额主卡 + 2×2 卡片：赠送 / 充值（带占比条）、今日消耗、近 7 天。大号卡片上排是标签和说明，下排是大金额（约 30pt），占比条贴底；金额按卡片宽度自动缩放。
- 头部有刷新按钮：清掉面板缓存并 `Widget.reloadAll()`，等效于 App 里的「刷新」。
- 取数失败时主卡改用红色底，显示「失联」，头部出现红色感叹号和「缓存」胶囊；小号只保留正文里的「失联」。
- 背景是浅蓝渐变，右上蓝光、左下青光、中间一层很淡的品牌蓝柔光；卡片使用半透明纵向渐变，深色模式自动切换。
- 余额低于「低余额阈值」时，主卡金额和货币符号一起标红（默认低于 10）。

小组件按设置页的间隔请求新时间线（默认 15 分钟，可选 15 分钟–12 小时），下一次时间线锚定在「数据时间 + 间隔」，不会因为系统提前唤醒而把节奏拖后。
同一份数据在间隔内复用缓存（最多提前 1 分钟失效，所以到点会真的重新取数），避免系统提前唤醒时重复打接口；小组件的刷新按钮会清缓存并绕过它。

## 验证

```bash
scripting-ts project "DeepSeek 余额" --screenshot --timeout 20
scripting-ts widget "DeepSeek 余额" --family systemSmall --screenshot
scripting-ts widget "DeepSeek 余额" --family systemMedium --screenshot
scripting-ts widget "DeepSeek 余额" --family systemLarge --screenshot
scripting-ts preview_ui preview.tsx --props '{"variant":"low"}' --screenshot
```

接口错误路径已验证：空 Key、非 `sk-` 前缀、无效 `sk-` Key（401）。
成功响应结构按 DeepSeek 官方文档实现；填入真实 Key 后第一次刷新即可看到实际余额。
