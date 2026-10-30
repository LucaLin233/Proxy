# Minis Surge CLI

Surge `surge-cli --remote` 传输与命令行面的 Python 重实现，面向 iOS 上的 iSH/Minis。

## 传输（Protocol）

External Controller 是 CRLF 分隔的命令/结果流：

1. 客户端发密码＋CRLF；
2. 服务端回 welcome JSON＋CRLF；
3. 客户端发一行文本命令＋CRLF——动词裸写、其后的 argv 逐项双引号包裹，如 `rule "match" "example.com"`；
4. 服务端回一个结果 JSON 对象，或一串 JSON 事件对象。

Surge iOS Protocol 25 仍接受旧式 `{"argv":[...]}` JSON 请求，但正式版 Surge Mac 6.9.0 build 12250 CLI 用上述文本编码，Minis 客户端随其对齐。含 CR/LF 的参数本地拒绝；普通引号与反斜杠在引号字段内原样发送，与官方客户端一致。**逐版本证据与日期只存在于 `platform-compatibility.md` 的唯一表，该表是执行判据。**

不做 HTTP API 转换。Controller 自行解析多数命令参数，故普通命令随所连 Surge 版本；客户端另行复现官方 CLI 的已知本地转换：`summary`、`profile diff`、`rule temp`、`watch speed`、`script evaluate <file>`（含 mock-type 名到数字 ID）。macOS 上在线 `plugin` 操作是普通 Controller 命令；官方 CLI 的离线 `plugin validate`／`plugin pack` 依赖本地 macOS 工具，在 iSH 中**有意不可用**。`--raw` 返回经客户端脱敏的 Controller JSON（紧凑序列化），不保证与服务端原文逐字节一致。

## 安装与凭据优先级

`/usr/local/bin/surge-cli` 是指向 `scripts/surge_cli.py` 的符号链接；默认 Controller 为 `127.0.0.1:6170`（可用 `SURGE_CLI_REMOTE` 或 `--remote` 覆盖）。

凭据优先级：

1. `--password-stdin`
2. `SURGE_API_KEY` —— Minis 推荐；存于「设置 → 环境变量」

客户端非交互：不建、不读密码文件，不在 TTY 提示输入。`SURGE_API_KEY` 缺失时给 Minis 环境变量设置入口，不要让用户把密码发到聊天里。调用安全、危险操作再确认与数据最小化见 [../SKILL.md](../SKILL.md) §3；本文件只管 CLI 凭据优先级与传输。

## 远程管理差异

官方指南：[Surge Remote Management](https://kb.nssurge.com/surge-knowledge-base/guidelines/remote-management)（2026-09-26 审阅；加 `.md` 读 Markdown 源）。它写官方控制器，不假定每个特性在本实现中都存在。

- **Ponte 与远端 loopback**：有用户授权的 Ponte 通路时，`--remote <name>.sgponte:6170` 可达远端 Mac 的 loopback；其 External Controller 可仍绑 `127.0.0.1`，不为它放宽监听。Surge UI 的原生 Ponte 免密发现与此 CLI 的 host/port/password 连接是两回事，凭据处理不变。
- **iOS 可达性**：Surge iOS 不能作 Ponte 服务端；蜂窝网络下远程 External Controller 连接被拒，Wi-Fi 需开启 Allow Access From Wi-Fi。这些入站限制不能证明同机 Minis loopback 可用——看实际路径。
- **USB**：官方 Mac Dashboard 可管理 USB 连接的 iPhone/iPad（含走蜂窝时），本 CLI 不实现；不从通用能力表推断 USB 支持。
- **认证封禁**：30 秒内 10 次失败密码会临时封禁来源 IP 或本地进程；先停止反复认证、考虑封禁再诊断「服务已死」。`security ban` 的查看/清除语法见命令参考；清封禁不是自动的测试恢复步骤。
- **Ponte 与 HTTP API**：官方对比表把 HTTP API/Web Dashboard 标为不支持 Ponte。区分「原生远程管理集成」与「经已有 `.sgponte` 隧道访问 HTTP 端口」——该表不否定后者；核实际端点。
- **官方 vs Minis CLI**：Mac CLI 无命令时进交互模式，Minis 打印帮助。指南中的 Mac-only 能力（Gateway 设备、插件、无人值守升级）不是命令规范，也不是升级/重启的授权；远程功能缺失可能是版本不匹配或 Mac-only 能力而非传输故障，官方建议两端版本对齐（必要时同为 beta），先诊断不自动升级。

## 兼容性

多数命令透明转发；status、version、mode、features、策略组、rule match/explain、DNS lookup/trace、modules、GeoIP、performance 与 macOS VMNET 等常用命令有可读格式化，其余打印美化 JSON——脚本与精确 Controller 数据用 `--raw`。

- Protocol 23 新增 `vmnet status|arp|ndp|ra`（官方发布说明口径）：本客户端透传并可渲染，但 VMNET 后端仅 macOS，iOS 应答 `Unsupported command`。
- Protocol 24 引入 `restart-engine`；正式版 Surge iOS 5.22.0 保留该行为。与 `reload` 不同，它完整重启引擎、关闭活动连接、清除缓存与临时规则，走普通命令传输并可能在重启前/中返回 `{"result":"success"}`。不凭协议号推断发布说明之外的能力。
- 已验证 build 与逐项结论只维护在 `platform-compatibility.md` 的唯一历史表（执行判据），含 2026-09-15 于 build 3842 的认证/只读复测；`restart-engine` 未在该 build 复测，结论仍属更早的 build 记录。
- `--check <path>`／`-c <path>` 用 Surge 官方 beta HTTPS 校验服务（`https://services.nssurge.com/v1/config/validate`），因 iSH 无自带 macOS 本地解析器。只读显式指定的 UTF-8 文件，POST JSON `profile` 字段，按官方 CLI 打印 `OK` 或 `Failed: ...` 并以 0/1 退出。**这是上传**：绝不隐式替换或上传活动 profile；profile 可能含服务器地址、订阅 URL、用户名、密码、PSK 等秘密，先告警并在必要时脱敏。
