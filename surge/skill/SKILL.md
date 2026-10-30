---
name: luno-surge
description: 在 Minis/iSH 中创建、审查、解释、修复和诊断 Surge。覆盖 iOS（默认）与 macOS 的 profile、module、rule、policy、DNS、MITM、Rewrite、脚本，以及通过 Surge CLI/External Controller 执行状态检查、规则解释、连接诊断、临时规则、Tailscale/WireGuard、VMNET 和性能排障。用户提供配置、日志、报错、截图，或要求实际查看/控制 Surge 时使用。
compatibility: Minis/iSH with Python 3; Surge iOS or macOS; runtime control requires External Controller or HTTP API
metadata:
  upstream: Surge for macOS 6.10.0 (12480) bundled Skill，已按 Minis/iOS 适配
  controller_protocol: 25
---

# Surge（iOS-first）

默认 iOS；仅用户明确提到 Mac、给出 Mac-only 证据或要求跨平台配置时，才进入 macOS/shared 分支。

## 1. 任务路由

1. 先读用户给的配置／模块／日志／截图，保留原顺序、注释、策略名与资源 URL。
2. 配置走「配置工作流」，状态／规则／DNS／连接／性能／隧道走「CLI 工作流」；两者相关时先只读检查 → 最小修改 → 立即复验。
3. 版本／平台／语义敏感问题查官方资料（按需读 `references/official-sources.md`，不一次加载全部参考），不照搬其他代理客户端语法、不猜字段或版本能力。

## 2. 引擎状态预检（防误判 Suspend）

依赖 Surge 联网／代理／DNS／脚本／API 的任务，先查当前实例（`surge-cli --raw status`／`--raw environment`）；EOF／超时后重新检查，不沿用历史状态；切策略／模块／功能前先确认目标存在，纯文档阅读不需连接。

- Controller/HTTP API 能响应不等于引擎在正常处理流量：留意 Suspend 与引擎异常，不假设均有同名暂停字段；不足以确认时标为未确认，请用户看 Surge 界面的 Suspend 与 VPN/引擎状态。
- EOF／超时不能证明已暂停或节点／凭据／目标故障；不为排障擅自恢复、重启、换模式或换实例——授权后重读状态再重试，仍失败再查路由、DNS、节点与目标。不把全量 `dump policy`、日志或 Profile 当前置或基线。

## 3. 安全与平台边界

- 不编造节点、策略名、证书、凭据、订阅 URL 或 Controller 返回。
- Controller 密码与 HTTP API Key 是同一凭据，只从环境变量 `SURGE_API_KEY`（或 `--password-stdin`）取，禁止写入参数、文件、日志或回复；本客户端非交互，不读凭据文件、不在 TTY 下补取密码。缺失时给设置入口，不让用户在聊天中发送密码：
  `[设置 SURGE_API_KEY](minis://settings/environments?create_key=SURGE_API_KEY&create_value=&create_note=Surge%20External%20Controller%20%2F%20HTTP%20API%20key)`
- 凭据优先顺序与传输见 `references/controller-cli.md`，`X-Key` 与远程明文风险见 `references/http-api.md`。
- 含节点／订阅 URL／隐私数据的 `dump profile`、请求正文与日志：按需读取、脱敏引用、不写入支持包。启用 MITM、Rewrite、脚本、抓包或远程控制前说明影响，hostname 禁止默认 `*`。
- 执行 `stop`、`restart-engine`、切换/更新 profile、批量终止连接、改变模式或策略前**再次确认**（比 `luno-core` 的同批授权更严：即使整批已获批，这一步仍单独确认）；`reload` 与 `restart-engine` 不等价（后者完整重启引擎、关连接、清缓存与临时规则，须单独授权），`stop` 须用户明确要求。门槛见 `references/platform-compatibility.md` 唯一表。
- 临时规则立即生效、优先于 Profile 规则；`rule temp flush` 清空全部临时规则，**禁止当作本次测试的默认清理**（见 `references/diagnostics.md`）。
- `http probe` 发真实 HEAD 请求，DNS／节点／带宽／加密 benchmark 产生真实流量或负载，仅按需执行；`watch`／`diagnostics`／benchmark 持续输出 JSON Lines，须限流读至 `hasMore=false`、长期订阅限时后停止，不能拿首帧当最终结果。`--check` 走联网上传（官方校验服务），不得自动上传当前 Profile，上传前告知用户、必要时先验证脱敏副本。
- `policy-descriptor` 含密码/PSK，与接口认证是两回事：只经 stdin 或 `--descriptor-file -` 送入，不落盘、不写入配置、不读凭据文件；`SURGE_API_KEY` 只作认证。
- iOS 不假设 Mac 文件系统与 Gateway/System Proxy/Enhanced Mode；shared profile 用 `#!IOS-ONLY`、`#!MACOS-ONLY`、`#!TVOS-ONLY` 隔离。

## 4. 配置工作流

检查：section 与行语法、选项值、最低版本与平台限制、引用关系（策略、组成员、MITM/Rewrite/Script hostname、远程资源格式）、规则顺序与 `FINAL`、DNS 循环/绕过、模块 `%APPEND%`/`%INSERT%`、脚本 `$done()` 路径与无关数据收集。手册入口见 `references/official-sources.md`。

修改与验证：
- 只改必需内容、不改变原路由意图；返回完整文件或精确 patch 并标明插入位置；模块单一目的、可逆，说明覆盖/插入/追加行为与前置条件。
- 无 Controller 时：导入/应用 → 检查 parser warning → 复现 → 从请求查看器确认 matched rule 与 policy，并给出验证与回滚方法。
- 模块开发：参数统一 `<面板名>_` 前缀；`#!arguments` 逗号分隔、默认值不含逗号（多值用 `|`）、占位符 `{{{name}}}`。

## 5. CLI 工作流

Minis 默认经 `/usr/local/bin/surge-cli` 连同机 External Controller（默认端点取客户端同机默认，或用 `SURGE_CLI_REMOTE`／`--remote` 明确指定；见 `references/controller-cli.md`），除用户明确指定外不连外部主机；优先 `--raw`（客户端脱敏 JSON，非服务端原文；本定义覆盖包内参考的「原始」表述），读取按需（见 §2）。命令语法与 key-path 见 `references/command-reference.md`，路由／DNS／临时规则／性能／隧道判读见 `references/diagnostics.md`；`Unknown command`／`Unsupported command` 先查 `version` 与 `help <command>`，不把 Mac-only 命令当 iOS 通用能力。

- 调试路由优先用临时规则（`rule temp add|list|flush`，引擎停止后即失效；边界见 §3），不改 Profile；`set` 支持批量 key-path（`<nil>`／`(null)`＝null），变更前后读最窄相关状态；Tailscale/WireGuard 判读（`proxy-runtime-status` 优先传策略名、握手/Exit Node/DERP）见 `references/diagnostics.md`。
- macOS only：`vmnet status|arp|ndp|ra`（iOS 返回 `Unsupported command` 属正常）；Plugin 在线管理仅限 macOS，`plugin install` 未开放，`plugin validate|pack` 为官方本地工具。配置前先读 `parameters` schema；完整格式见 `references/plugin-authoring.md`。

## 6. 兼容性与回退

执行前按 `references/platform-compatibility.md` 的唯一协议门槛与历史版本表核对；**该表是执行判据**，不满足或未知时不得执行，本文件与官方正文的协议号均不作判据。异常先 `surge-cli --raw version`。

Controller 不可用或需要 `/v1/*`、Prometheus 指标时走 HTTP API 回退：先确认端点（默认取客户端同机默认；指向用户指定的活动实例时用 `SURGE_HTTP_API_BASE`，仅用户指定后才指向可信局域网实例）、认证与所需 `X-Key`；危险操作同样须再次确认（同 §2：比 `luno-core` 同批授权更严的额外确认；见 `references/http-api.md`、`scripts/surge_ios.py`）。测试未写入 Profile 的新节点用 `scripts/test_policy_descriptor.py`（不改配置；凭据边界见 §3）。

## 7. 维护与交付

- 安装／只读验收／打包／上游同步／模块推送的脚本清单与用法见 `references/SOURCE.md`：执行上述操作前先读该文件，同步后人工合并、不盲目覆盖本 `SKILL.md`；打包只用 `scripts/package_release.py`，禁止打包凭据、profile、抓包、请求正文、数据库与运行输出。
- 输出默认含**结论、修改/操作、验证、回滚/注意**；实际执行与仅建议的命令必须区分；规则推演不冒充端到端联网成功，版本快照不冒充当前版本实测。

## 参考按需加载

均在 `references/`（触发见对应小节）：`official-sources.md`、`command-reference.md`、`controller-cli.md`、`http-api.md`、`diagnostics.md`、`platform-compatibility.md`（**执行判据**）、`plugin-authoring.md`、`SOURCE.md`；`upstream-SKILL.md` **仅上游对照或官方导入审查时读取**。
