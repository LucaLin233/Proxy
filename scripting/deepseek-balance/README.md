# DeepSeek 余额 · Scripting（含桌面小组件）

显示 DeepSeek 的可用余额、赠送 / 充值构成，以及今日、近 7 天的消耗。DeepSeek 按量计费，进度条表示「赠送 / 充值」构成，不是额度。

## 文件

```
DeepSeek 余额/
├── script.json      # 项目清单
├── index.tsx        # App 内页面：余额、构成、消耗、设置
├── config.ts        # 配置、App Group 存储、采样记录
├── api.ts           # GET https://api.deepseek.com/user/balance
├── core.ts          # 取数、缓存、消耗统计、格式化
├── views.tsx        # 小组件视图
├── widget.tsx       # 桌面小组件入口
├── app_intents.tsx  # 刷新按钮
├── preview.tsx      # 本地排版预览（开发用）
└── dsbrand.tsx      # DeepSeek logo
```

## 配置

打开脚本 → 「设置」：

- **API Key**：`sk-` 开头的 DeepSeek Key，保存在本机 App Group 的 `deepseek/config.json`；
  旧版「DeepSeek 小组件」用同一个文件，装过就不用重填。Key 以明文保存在该文件中，Scripting 的其他脚本也可访问此 App Group 目录，请只运行可信脚本。
- **刷新周期**：15 / 30 分钟，1 / 2 / 3 / 6 / 12 小时，默认 15 分钟，iOS 可能延后。
- **低余额阈值**：默认 10，低于它时余额标红；填 0 关闭。
- **清除消耗记录**：点两次确认，只清 `usage.json`。

## 数据与读法

余额来自 `balance_infos[]`，优先显示 CNY，其他币种在 App 里单列。每次刷新与上一次比较：余额下降记一笔消耗，
上涨（充值 / 退款）记 0；采样保留最近 30 天、最多 2000 条。
取数失败时保留上一次的余额，主卡标「失联」、头部标「缓存」。头部刷新按钮等同 App 里的「刷新」。

## 验证

```bash
scripting-ts project "DeepSeek 余额" --screenshot --timeout 20
scripting-ts widget "DeepSeek 余额" --family systemSmall --screenshot
scripting-ts widget "DeepSeek 余额" --family systemMedium --screenshot
scripting-ts widget "DeepSeek 余额" --family systemLarge --screenshot
scripting-ts preview_ui preview.tsx --props '{"variant":"low"}' --screenshot
```
