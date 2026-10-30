# Surge 官方资料路由与配置手册入口

按**平台与版本**取证顺序取源；只取当前问题需要的页面，优先 Markdown 端点（`….md` 或 `/llms.txt`）。用户提供的 `llms.txt` 若存在，先读它——它是路由文件，不是文档正文。

## 取证顺序

0. 入口发现（仅当不知道该查哪一份时）：读官方统一入口 [nssurge.com/llms.txt](https://nssurge.com/llms.txt)，按其分流取下列各项——**它是路由文件、不含文档正文**，不替代 1–5 的顺序，也不强制每次先读；根入口改版或失效时降级到下列子入口，不猜新 URL。
1. 平台发布说明：iOS 稳定版变化读 [Surge iOS Release Notes](https://kb.nssurge.com/surge-knowledge-base/zh/release-notes/surge-ios.md)；仅 beta 出现的问题读 [iOS TestFlight 说明](https://kb.nssurge.com/surge-knowledge-base/zh/faq/ios-testflight.md)。
2. 规范性语法与行为以 [Surge Manual](https://manual.nssurge.com/llms.txt) 为准。
3. 明确问 Mac 版本时才读 [Mac release/beta appcast](https://nssurge.com/mac/latest/appcast-signed-beta.xml)。**Mac appcast 不是 iOS-only 能力的权威**：仅在 macOS 分支、或另有官方来源证明共享内核变化适用于 iOS 时使用。
4. 用户工作流与排障读 [Surge Knowledge Base](https://kb.nssurge.com/llms.txt)。
5. 官方 CLI 变更另见 [Surge CLI 更新概览](https://nssurge.com/blog/surge-cli-updates/) 与 [Beta 公告频道](https://t.me/SurgeTestFlight)。

- 同一 iOS 版本上发布说明与手册冲突时，以发布说明为准并说明差异；只有 Mac 发布说明记录的能力，无 iOS／共享内核证据不得断言 iOS 支持。
- 版本敏感或易误读的结论记录来源 URL；页面失效时从手册首页或侧栏目录重新定位，不猜 URL，也不用搜索引擎摘要代替官方正文。

## 配置手册入口

以下路径均相对 `https://manual.nssurge.com/`：

- 平台差异／快速上手：`getting-started/platform-differences.md`、`getting-started/quick-start.md`
- Profile：`profile/format.md`、`profile/general.md`、`profile/module.md`、`profile/managed-profile.md`、`profile/keystore.md`、`profile/requirement.md`（iOS 5.22.0 / Mac 6.9.0 起支持 `DEVICE_NAME`）
- 规则：`rules/overview.md`、`rules/domain.md`、`rules/ip.md`、`rules/protocol-and-network.md`、`rules/logical.md`、`rules/ruleset.md`
- 策略与协议：`policies/overview.md`、`policies/parameters.md`（含 `underlying-proxy` 代理链）、`policies/tls.md`、`policies/udp.md`、`policies/http.md`、`policies/socks5.md`、`policies/shadowsocks.md`、`policies/snell.md`、`policies/vmess.md`、`policies/trojan.md`、`policies/tuic.md`、`policies/hysteria2.md`、`policies/wireguard.md`、`policies/tailscale.md`
- 策略组：`policy-groups/overview.md`、`policy-groups/select.md`、`policy-groups/url-test.md`、`policy-groups/smart.md`、`policy-groups/policy-including.md`、`policy-groups/parameters.md`
- DNS／HTTP／脚本：`dns/overview.md`、`http/overview.md`、`http/mitm.md`、`http/url-rewrite.md`、`scripting/overview.md`、`scripting/api.md`
- 工具与远程控制（同基址）：<https://manual.nssurge.com/tools/cli.md>、<https://manual.nssurge.com/tools/http-api.md>、<https://manual.nssurge.com/tools/dashboard.md>、<https://manual.nssurge.com/tools/testing.md>、<https://manual.nssurge.com/tools/url-scheme.md>

### 正式版 5.22.0 Profile 变化

- `#!REQUIREMENT` 官方变量含 `DEVICE_NAME`（iOS 5.22.0+ / Mac 6.9.0+）：用户设置的设备名，Privacy Mode 下读取结果可能被遮蔽。
- `#include` 可与 section 内普通内容混排；多个或混合 include 因写回目标不明确，在 UI 中只读。
- `[Ruleset *]`、`[WireGuard *]`、`[Tailscale *]` detached sections 支持通配 include。
- inline Ruleset 可引用其他 inline Ruleset，也可引用外部 `RULE-SET`／`DOMAIN-SET`；循环引用被拒绝并给出引用链。
- Event scripts 新增 `engine-started` 与 `profile-reloaded` 事件。

具体语法以对应官方手册正文和 `surge-cli --check` 结果为准，不据发布说明猜测格式。

### 本地校验

- 装有 Mac 时可用官方本地解析器：`/Applications/Surge.app/Contents/Applications/surge-cli --check /path/to/profile.conf`。
- Minis/iSH 无本地解析器：`surge-cli --check <path>` 走官方 beta HTTPS 校验服务（上传显式指定的文件）；上传与脱敏要求见 [../SKILL.md](../SKILL.md) §3 与 [controller-cli.md](controller-cli.md)。
- 校验副本不得把真实密码、PSK、订阅 URL、API Key 或其他凭据复制到不受控位置；优先用占位值验证结构。

相关本地资源：命令语法见 `command-reference.md`；按需诊断见 `diagnostics.md`；协议门槛与平台限制见 `platform-compatibility.md`（**唯一执行判据**）。
