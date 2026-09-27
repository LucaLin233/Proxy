# Surge 按需诊断

仅在实际排查对应功能时读取；先按入口完成引擎状态预检（[../SKILL.md](../SKILL.md) §2）。命令语法、key-path 与响应字段以 [command-reference.md](command-reference.md) 为准，本文件不重抄命令目录；协议门槛与平台限制以 [platform-compatibility.md](platform-compatibility.md) 唯一表为执行判据。这里是 Surge 特有行为，不以其他代理软件语法替代。

### 流量与多帧输出

- `http probe <url> [policy]` 会发送真实 HEAD 请求；DNS、节点、带宽与加密 benchmark 测试同样会产生真实流量或负载。只在任务需要时执行，执行前确认目标与影响。
- `diagnostics`、各 `watch`、带宽与加密 benchmark 持续输出 JSON Lines：按对应 `hasMore=false` 或结束载荷处理，不能拿首帧当最终结果；长期订阅限时后停止。

### 路由与 DNS

```sh
surge-cli --raw rule match example.com
surge-cli --raw rule explain https://example.com
surge-cli --raw dns trace example.com
surge-cli --raw geoip 1.1.1.1
```

- `rule match`：快速查看命中规则和最终策略。
- `rule explain`：查看完整策略组决策路径；回答“为什么这样走”时优先使用。

需要改变路由才能验证、且用户授权时，优先考虑临时规则而非改 Profile；临时规则立即生效并优先于 Profile 规则。先列出已有规则，记录本次新增项。

```sh
surge-cli rule temp list
# 确认 Proxy 存在且获准测试后再添加：
surge-cli rule temp add "DOMAIN-SUFFIX,example.com,Proxy"
surge-cli rule temp list
```

`rule temp flush` 会清空全部临时规则，禁止当作本次测试的常规清理。只移除本次新增规则；具体标识与 remove 参数先核对 [命令参考](command-reference.md) 及返回结果，不能猜索引或清除用户既有规则。

### 性能与隧道

```sh
surge-cli --raw dump performance
surge-cli --raw dump rule-usage
surge-cli --raw benchmark rule-matching
surge-cli --raw benchmark encryption 25
```

`dump policy`、`dump performance`、`dump rule-usage` 与各 benchmark 一律按需读取，不作为每次任务的前置或基线。`benchmark encryption` 测量 Surge 所在设备的本地加密性能，不是网络带宽。

排查 Tailscale/WireGuard 时，先从 `dump policy` 找到 `lineHash`，再读取运行时状态：

```sh
surge-cli --raw proxy-runtime-status <line-hash>
```

优先检查握手、底层策略、Tailscale 会话、Exit Node、DERP 和 peer path，不要先做宽泛日志搜索。
