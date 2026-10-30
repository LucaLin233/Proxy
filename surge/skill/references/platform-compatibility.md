# 平台与协议差异

本表是协议门槛与平台限制的**唯一执行判据**，也是历史验证结论的唯一出处；其他文件（`SKILL.md`、`controller-cli.md`、`command-reference.md` 的官方正文等）中出现的协议号或版本语句若与本表冲突，以本表为准（那些属上游历史文字，仅作说明）。

以下是已验证版本快照，不代表当前运行版本。能力异常时读取 `version`，核对平台和 Controller Protocol。

### Plugin System（macOS only）

Protocol ≥24 的在线插件管理仅限 macOS：`plugin list|info|parameters|load-unpacked|configure|enable|disable|select|uninstall`。本版本的 `plugin install` 尚未开放；`plugin validate|pack` 是官方 macOS CLI 的本地离线工具，不是 Controller 命令，因此 Minis/iSH 客户端不实现这两个子命令。配置插件前先用 `parameters` 读取 schema，API Key 等敏感参数不得出现在回复、日志或公开包中。完整格式见 [plugin-authoring.md](plugin-authoring.md)。

引用上游插件示例时，不把 `insecure: true` 或命令行 `token=…` 当作本端默认：保持证书校验；密钥只用已授权注入变量经已核安全入口传递，无法避免进入参数/日志时暂停相关配置。

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

## CoreDevice/RSD 同机回环（第三方报告，非本机验收）
上游 ios-dev 报告 Surge iOS 5.23.0 可用，5.22.1 会静默丢弃 `[IP Rewrite]`，并以 ≥5.23.0 作为该方案门槛；勿混用 App 发行版本与 Controller 内部版本。上游所列验证环境为 iOS 27.0.1/27.1、Surge 5.23.0；其流程要求 Wi-Fi、已开启开发者模式及有效 RemotePairing 配对材料，同机只运行一个相应 NetworkExtension VPN；49152 是该上游握手实现固定的端口。当前版本、拓扑及前提未核对时不据此执行；不能外推其他系统、实现或全部服务端口。
来源：OpenMinis/MinisSkills@164395f193a56e3507ca98415383c7c16780da00，ios-dev/SKILL.md、ios-dev/references/loopback.md；2026-10-25 本地核对；许可文件 ios-dev/LICENSE 记载 MIT，README 标 Apache-2.0 的冲突未裁定；精选改写；在线可取性及本机行为未复核，分发前须裁定许可并保留适用通知。
