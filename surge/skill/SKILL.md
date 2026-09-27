---
name: surge
description: 在 Minis/iSH 中创建、审查、解释、修复和诊断 Surge。覆盖 iOS（默认）与 macOS 的 profile、module、rule、policy、DNS、MITM、Rewrite、脚本，以及通过 Surge CLI/External Controller 执行状态检查、规则解释、连接诊断、临时规则、Tailscale/WireGuard、VMNET 和性能排障。用户提供配置、日志、报错、截图，或要求实际查看/控制 Surge 时使用。
compatibility: Minis/iSH with Python 3; Surge iOS or macOS; runtime control requires External Controller or HTTP API
metadata:
  upstream: Surge for macOS 6.9.0 (12250) bundled Skill，已按 Minis/iOS 适配
  controller_protocol: 25
---

# Surge（iOS-first）

默认 iOS；只有用户明确提到 Mac、提供 Mac-only 证据，或要求跨平台配置时，才进入 macOS/shared 分支。

## 1. 任务路由

1. 先读用户提供的配置、模块、日志或截图，保留原顺序、注释、策略名和资源 URL。
2. 配置问题走「配置工作流」；状态、规则、DNS、连接、性能与隧道问题走「CLI 工作流」；两者相关时先只读检查 → 最小修改 → 立即复验。
3. 版本、平台或语义敏感问题查官方资料；按需读 `references/source-routing.md`，不要一次加载全部参考。
4. 基础网络知识不代替 Surge 专有语义：不照搬其他代理客户端的规则、代理参数或策略组语法；不确定时查对应官方正文，不猜字段、命令或版本能力。

## 2. 引擎状态预检（防误判 Suspend）

实际依赖 Surge 联网、代理、DNS、脚本或 API 的任务，先检查当前实例；意外 EOF 或超时后重新检查，不沿用历史状态。纯文档阅读不需连接：

```sh
surge-cli --raw status
surge-cli --raw environment
```

- Controller/HTTP API 能响应，不等于引擎在正常处理流量。留意 Suspend、停止或引擎异常，但不假设每个版本都有同名暂停字段。
- 输出不足以确认时，标为未确认，请用户查看 Surge 界面的 Suspend 与 VPN/引擎状态；EOF/超时本身不能证明已暂停，也不能证明节点、凭据或目标服务故障。
- 不为排障擅自恢复、重启、换模式或换实例。授权恢复后重读状态，再重试原操作；仍失败再查路由、DNS、节点和目标服务。
- 切换策略、模块或功能前先确认目标存在，按需读取相关列表；不把全量 `dump policy`、日志或 Profile 当每次任务的前置流程。

## 3. 安全与平台边界

- 不编造节点、策略名、证书、凭据、订阅 URL 或 Controller 返回。
- Controller 密码与 HTTP API Key 是同一个凭据，统一只从环境变量 `SURGE_API_KEY`（或 CLI 的 `--password-stdin`）获取——2026-09-15 由 `SURGE_CLI_PASSWORD` 与 `SURGE_HTTP_API_KEY` 合并而来，旧名可删除。禁止写入参数、文件、日志或回复。缺失时给设置入口，不要让用户在聊天中发送密码：
  `[设置 SURGE_API_KEY](minis://settings/environments?create_key=SURGE_API_KEY&create_value=&create_note=Surge%20External%20Controller%20%2F%20HTTP%20API%20key)`
- 凭据优先顺序与传输细节见 `references/controller-cli.md`；HTTP 独有的 `X-Key` 用法与远程明文风险见 `references/http-api.md`；凭据检查契约见 `references/SOURCE.md`。本客户端非交互：不读凭据文件，也不在 TTY 下补取密码。
- `dump profile`、`profile diff`、请求正文与日志可能含节点、订阅 URL 或隐私数据；仅在必要时读取，脱敏后引用，不写入支持包。
- 启用 MITM、Rewrite、脚本、抓包、LAN/远程控制前说明影响；MITM hostname 最小化，禁止默认 `*`。
- 执行 `stop`、`restart-engine`、切换/更新 profile、批量终止连接、改变模式或策略前，再次确认（`restart-engine` 的最低协议与平台限制见 `references/platform-compatibility.md` 唯一表）。
- `reload` 与 `restart-engine` 不等价：后者完整重启引擎、关闭活动连接并清除缓存与临时规则，须单独授权这些影响；`stop` 会关闭 Surge，须用户明确要求。
- 临时规则立即生效、优先于 Profile 规则；`rule temp flush` 会清空全部临时规则，禁止当作本次测试的默认清理（工作流、逐项移除与判读见 `references/diagnostics.md`）。
- `http probe` 会发真实 HEAD 请求；DNS、节点、带宽与加密 benchmark 测试也会产生真实流量或负载，仅按任务需要执行（流量语义与判读见 `references/diagnostics.md`）。
- `watch`、`diagnostics`、带宽与加密 benchmark 会持续输出 JSON Lines，不能拿首帧当最终结果（限流与结束条件见 `references/diagnostics.md`）。
- `--check <path>` / `-c <path>` 会把明确指定的 UTF-8 Profile 上传到 `https://services.nssurge.com/v1/config/validate`（联网，非本地解析器）；不得自动上传当前 Profile，上传前告知用户，必要时先验证脱敏副本。
- 描述符（`policy-descriptor`）含密码/PSK，与接口认证是两回事：经 stdin 或 `--descriptor-file -` 送入（不落盘、不写入配置、不读凭据文件），`SURGE_API_KEY` 只用于认证，不作描述符来源。用法见 `references/http-api.md` 与 `scripts/test_policy_descriptor.py`。
- iOS 不假设 Mac 文件系统、Gateway/System Proxy/Enhanced Mode；shared profile 用 `#!IOS-ONLY`、`#!MACOS-ONLY`、`#!TVOS-ONLY` 隔离差异。

## 4. 配置工作流

检查：核验 section、行语法、选项值、最低版本与平台限制，以及引用关系（规则策略、组成员、MITM/Rewrite/Script hostname、远程资源格式）；检查规则顺序与 `FINAL`、DNS 循环/绕过、模块 `%APPEND%`/`%INSERT%`、脚本全部 `$done()` 路径与无关数据收集。配置语法手册入口：`references/manual-index.md`。

修改与验证：
- 只改必需内容、不改变原路由意图；返回完整文件或精确 patch 并标明插入位置；模块保持单一目的、可逆，说明覆盖/插入/追加行为与 MITM、脚本等前置条件。
- 无 Controller 时：导入/应用 → 检查 parser warning → 复现问题 → 从请求查看器确认 matched rule 与 policy。
- 给出验证与回滚方法。
- 模块开发约定：参数统一 `<面板名>_` 前缀、下划线；`#!arguments` 逗号分隔，默认值不得含逗号（多值用 `|`），占位符 `{{{name}}}`。

## 5. CLI 工作流

Minis 默认通过 `/usr/local/bin/surge-cli` 连接 `127.0.0.1:6170`（同机 Surge External Controller）；除非用户明确指定，不连接外部主机。优先 `--raw`。以下读取按需执行（状态预检见 §2；`dump policy` 与任何全量 dump 一律按需，不作每次任务的前置或基线）：

```sh
surge-cli --raw version
surge-cli --raw status
surge-cli --raw environment
```

功能随平台与 Controller 版本变化；遇到 `Unknown command`/`Unsupported command` 先查 `version` 与 `help <command>`，门槛与历史结论见 `references/platform-compatibility.md`，不得把 Mac-only 命令当成 iOS 通用能力。Surge iOS（TestFlight）已在 App 内提供虚拟 Terminal；Minis 的 Python 客户端是非交互 External Controller 客户端。

诊断路由与命令语法、key-path、`<nil>`/JSON Lines 语义见 `references/command-reference.md`；常用入口：

```sh
surge-cli --raw rule match https://example.com    # 不产生真实连接
surge-cli --raw rule explain https://example.com  # 完整策略组决策链；回答“为什么这样走”优先
surge-cli --raw dns lookup example.com            # dns trace 为完整 resolver trace
surge-cli --raw geoip 1.1.1.1
surge-cli --raw dump policy                       # 按需：仅在需要策略组/lineHash 时读取，非基线
surge-cli profile diff
```

调试路由优先用引擎停止后即失效的临时规则（`rule temp add|list|flush`，影响边界见 §3），而不是改 Profile；具体命令与判读见 `references/diagnostics.md`。

变更、流与隧道：
- `set` 支持批量 key-path（`<nil>`/`(null)` 表示 null）；变更前后读取最窄相关状态。
- 多帧命令（`diagnostics`、各 `watch`、带宽与加密 benchmark）必须限流读至 `hasMore=false`，长期订阅限时后停止；判读见 `references/diagnostics.md`。
- Tailscale/WireGuard 隧道判读（含 `lineHash` 与 `proxy-runtime-status` 用法、握手/Exit Node/DERP 检查顺序）见 `references/diagnostics.md`。

平台限制（macOS only，最低协议与平台限制见 `references/platform-compatibility.md` 唯一表）：
- `vmnet status|arp|ndp|ra`：Enhanced/Gateway Mode 的接口、邻居与 IPv6 RA 接管诊断；iOS 返回 `Unsupported command` 属正常平台限制。
- Plugin 在线管理仅限 macOS；`plugin install` 未开放，`plugin validate|pack` 为官方本地工具（Minis/iSH 不实现）。配置前先读 `parameters` schema；API Key 等敏感参数不得出现在回复、日志或包中。完整格式：`references/plugin-authoring.md`。

## 6. 兼容性与回退

执行前先按 `references/platform-compatibility.md` 的唯一协议门槛与历史版本表核对（`rule`/`dns`/`http probe`/`security ban`、`geoip` 与性能/规则使用/虚拟 IP dump、`vmnet`、`plugin`、`restart-engine` 的最低协议与平台限制）；**该表是执行判据**，不满足或未知时不得直接执行，本文件与官方正文中的协议号均不作为判据。该表按日期分列已验证结论（3830 的逐项验证、3842 于 2026-09-15 的认证/只读复测、3822 的 `reload` 与 `restart-engine` 差异），本文件不复述版本表。异常先 `surge-cli --raw version` 核对平台与协议。

Controller 不可用、需要 `/v1/*` 接口或 Prometheus 指标时走 HTTP API 回退：先确认目标端点（默认本机 `127.0.0.1:6171`，仅在用户明确指定后才指向可信局域网实例）、认证方式与所需 `X-Key`，再执行；同样适用危险操作的再次确认，`stop` 需显式危险确认。用法与脚本见 `references/http-api.md` 与 `scripts/surge_ios.py`。

测试未写入 Profile 的新节点：用 `scripts/test_policy_descriptor.py`（经 `POST /v1/scripting/evaluate` 传 `policy-descriptor`，不改配置）。描述符凭据边界见 §3。本机 Surge 被 Suspend 时探针可能返回 `EOF`/超时——须先按 §2 预检，不能据此判定节点故障。

## 7. 维护与交付

- 安装、只读验收、打包分享与上游同步脚本清单及用法见 `references/SOURCE.md`；执行上述任一操作前先读该文件，同步后人工合并，不盲目覆盖本 `SKILL.md`。
- 禁止打包凭据、profile、抓包、请求正文、数据库与运行输出；打包只用 `scripts/package_release.py`。
- 模块推送（仅自有仓库 `LucaLin233/Proxy`）：凭据不入命令行；用临时 git-cred-helper 从 `$GH_TOKEN` 读取，用后立即删除；推送结果以 `gh api` 回读为准（raw CDN 缓存 2–7 分钟）。
- 输出默认含：**结论、修改/操作、验证、回滚/注意**；实际执行与仅建议的命令必须区分。规则推演不冒充端到端联网成功；只有版本快照时不冒充当前版本实测。

## 参考按需加载

`source-routing.md` 官方资料路由；`command-reference.md` 命令、key-path 与协议要求；`manual-index.md` 配置语法手册；`controller-cli.md` 客户端、凭据与远程管理；`http-api.md` HTTP API 回退；`diagnostics.md` 按需诊断工作流；`platform-compatibility.md` 协议门槛与历史版本；`plugin-authoring.md` Plugin 开发；`SOURCE.md` 上游同步与脚本清单；`upstream-SKILL.md` 上游快照。以上均在 `references/`。
