# 平台与协议差异

本表是协议门槛与平台限制的**唯一执行判据**，也是历史验证结论的唯一出处；其他文件（`SKILL.md`、`controller-cli.md`、`command-reference.md` 的官方正文等）中出现的协议号或版本语句若与本表冲突，以本表为准（那些属上游历史文字，仅作说明）。

以下是已验证版本快照，不代表当前运行版本。能力异常时读取 `version`，核对平台和 Controller Protocol。

### Plugin System（macOS only）

Protocol ≥24 的在线插件管理仅限 macOS：`plugin list|info|parameters|load-unpacked|configure|enable|disable|select|uninstall`。本版本的 `plugin install` 尚未开放；`plugin validate|pack` 是官方 macOS CLI 的本地离线工具，不是 Controller 命令，因此 Minis/iSH 客户端不实现这两个子命令。配置插件前先用 `parameters` 读取 schema，API Key 等敏感参数不得出现在回复、日志或公开包中。完整格式见 [plugin-authoring.md](plugin-authoring.md)。

### VMNET（macOS only）

Protocol 23 新增：

```sh
surge-cli --raw vmnet status
surge-cli --raw vmnet arp
surge-cli --raw vmnet ndp
surge-cli --raw vmnet ra
```

用于排查 macOS Enhanced/Gateway Mode 的接口、ARP/NDP 邻居和 IPv6 RA 接管。Surge iOS 返回 `Unsupported command` 属正常平台限制。

## 已知兼容性

- `rule`、`dns`、`http probe`、`security ban` 需要 Controller Protocol ≥20。
- `geoip`、性能/规则使用/虚拟 IP dump、规则匹配 benchmark 需要 ≥22。
- `vmnet` 需要 ≥23，且仅限 macOS。
- `plugin` 在线命令需要 ≥24 且仅限 macOS；iOS 返回 `Unknown command`。
- `restart-engine` 需要 ≥24；它与差量 `reload` 不同，会关闭连接并清除缓存和临时规则。
- 后续复测：Controller build **3852**（Surge iOS 5.102.0，2026-09-27）——`scripts/acceptance.sh --controller` 与 `--network` 两档只读验收**全部通过**（Controller 握手与能力、`status`／`summary`／`dump performance`／`rule match`／`rule temp list`／`feature list`／`module list`／`watch speed` 首帧、Prometheus metrics、官方 profile 校验服务上传合成无秘密 profile、`dns lookup`），全程未改 Surge 设置。该结论**只覆盖只读路径**：`restart-engine`、切换 profile 等变更类操作未在 3852 上复测，仍按 3830／3822 的记录。
- 历史逐项验证（2026-09-02 记录）：正式版 Surge iOS 5.22.0（Controller 内部版本 5.102.0 build 3830）/ Controller Protocol 25 —— 认证、CRLF 文本命令、JSON Lines 响应及 `restart-engine` 的逐项结论来自该 build。
- 后续复测：同一 5.22.0 / Protocol 25 的 Controller build 3842（2026-09-15）复测了认证与只读命令；`restart-engine` 未在该 build 上复测，其结论仍按 3830 与下面 3822 的记录。
- `reload` 与 `restart-engine` 的明确差异最初在 Controller build 3822 上验证（关闭连接、清除缓存与临时规则）。
- Protocol 25 仍兼容旧 JSON `argv` 请求，但本客户端已对齐正式版 Surge Mac 6.9.0 build 12250 的文本编码。以上均为有日期的历史结论，不声明当前运行版本。
- 遇到 `Unknown command` 或能力异常时，先运行 `surge-cli --raw version` 核对 Surge、Core、平台和 Controller Protocol。
