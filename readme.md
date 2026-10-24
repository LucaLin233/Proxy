# Proxy Configs Collection

面向 Surge 与 Quantumult X 的模块、脚本、分流规则与图标集合，纯自用备份。

本仓库只做收集与整合，不维护上游脚本，也不保证可用性。所有文件按“原样”提供，使用前请自行阅读
文件内的说明与参数表。有同步需要请**自行同步，不要 fork**。

## 支持范围

- **Surge（iOS / macOS）**：模块 `surge/modules/*.sgmodule`、脚本 `surge/scripts/*.js`、分流规则 `surge/rules/*.list`；
- **Quantumult X**：重写 `quantumultx/apps_js.conf`；
- **Sub-Store**：`substore/rename.js`，节点名称与地区文案规范化脚本（同目录附测试）；
- **代理服务端**：`systemd/*.service` 单元模板（Snell、Hysteria2，Debian/Ubuntu）；
- **面板脚本**：需要较新的 Surge 版本（模块参数 `#!arguments` 需 Surge 5 及以上）；CCH、AWS Lightsail、Peekabo 面板还需要各自服务的 API Key 或 Token，仅保存在 Surge 本地模块参数中；
- 本仓库**不提供** Quantumult X 的完整配置文件，只提供重写与分流规则；
- 所有文件通过 `raw.githubusercontent.com` 直接引用，仓库不提供额外加速方式。

## 目录结构

```text
Proxy/
├── surge/
│   ├── modules/     Surge 模块（.sgmodule）
│   ├── scripts/     Surge 脚本（.js）
│   ├── rules/       分流规则（.list；legacy/ 为 2022 年遗留版本）
│   └── data/        Telegram MTProto DC 配置
├── quantumultx/     Quantumult X 重写
├── substore/        Sub-Store 脚本
├── icons/           策略组图标
├── docs/            README 引用的教程截图
├── other/           其他文件
├── systemd/         服务端 systemd 单元模板
├── readme.md
├── LICENSE          MIT
└── .gitattributes   统一 LF 换行
```

## 快速开始

### Surge 模块

在 Surge → 模块 → 从 URL 安装，填入对应模块的 raw 地址：

```text
https://raw.githubusercontent.com/LucaLin233/Proxy/main/surge/modules/<模块名>.sgmodule
```

`server`、`ai` 模块需要参数（API Key、Token、查询间隔等），安装时按提示填写；参数说明写在模块的
`#!arguments-desc` 中，安装界面可直接看到。只需要其中一类面板时，改装对应的那一个模块即可。

### Surge 分流规则

在配置文件的 `[Rule]` 段引用：

```text
RULE-SET,https://raw.githubusercontent.com/LucaLin233/Proxy/main/surge/rules/proxy.list,PROXY
RULE-SET,https://raw.githubusercontent.com/LucaLin233/Proxy/main/surge/rules/direct.list,DIRECT
```

`proxy.list`、`direct.list`、`cdn.list` 由自建合并服务按上游规则定期更新并自动提交，**不要手工
编辑**；其余 `.list` 为手工维护。

### Quantumult X

```text
JS 重写     https://raw.githubusercontent.com/LucaLin233/Proxy/main/quantumultx/apps_js.conf
```

JS 重写：在“重写 → 引用”中填入链接。

![](https://github.com/LucaLin233/Proxy/blob/main/docs/qx_rewrite_guide.png)

使用前建议先掌握 Quantumult X 的配置导入方式：

- [Quantumult X 教程](https://www.notion.so/Quantumult-X-1d32ddc6e61c4892ad2ec5ea47f00917)（懒人可直接看第五大点的配置导入）；
- [@KOP-XIAO 的懒人配置](https://raw.githubusercontent.com/KOP-XIAO/QuantumultX/master/QuantumultX_Profiles.conf)；
- [@limbopro 的节点筛选正则](https://limbopro.xyz/archives/11131.html)；
- 分流规则推荐 [@blackmatrix7 的规则仓库](https://github.com/blackmatrix7/ios_rule_script)。

上述 Cookie 类重写只用于自用抓取，请勿用于商业化或批量使用。

### Sub-Store

```text
https://raw.githubusercontent.com/LucaLin233/Proxy/main/substore/rename.js
```

脚本按国家/地区字典把节点名称统一为中文或英文短称，作为 Sub-Store 的“节点名称处理”脚本使用。

### 服务端 unit 模板

```bash
sudo cp systemd/snell.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now snell
```

`snell-tun.service` 与 `hysteria2-tun.service` 以 `tun` 用户运行，适合已配置好 TUN 转发的机器；
`snell.service` 以 `nobody` 运行。ExecStart 中的二进制与配置文件路径请按实际部署修改。

### 中转站面板（CCH / CCHP）

`aiapi.sgmodule` 的 `cch_endpoints` 一站一条、竖线分隔，模式接在凭据后面（`:cchp` 即 CCHP 管理令牌）。
把余额源切到 CCHP 时，请用 CCHP 条目**替换**原来的主站 admin 条目，不要两条同时保留（同一个站会出现两行）：

```text
# 改前：CCH 主站 admin 条目
主站@cch.example.com=<管理员令牌>:admin|Clouder@cc2.example.tech=<用户 Key>:user

# 改后：CCHP 条目替换主站 admin，Clouder 仍保留 user 条目
CCHP@cchp.example.com=<管理令牌>:cchp|Clouder@cc2.example.tech=<用户 Key>:user
```

- Clouder 的余额仍由 CCH 站点（`user`/`cookie`/`login`）提供；**只有**站点名称等于 provider 名或品牌（如 `Clouder`），
  或站点域名与 provider 的 `website_url` 域名一致，才会沿用 CCHP 里该 provider 的 key 优先级；两者都对不上时该站排到最后，
  可在站点末尾手写优先级（`=凭据:user:1`）兜底。
- 余额**默认只刷一把代表 key**：`aiapi_cchp_single_account` 默认开启，每个可见 provider 取 active `keyIds`
  去重后字符串升序第一把调 `?refresh=true`，面板只显示该 key 关联的 `balance.accounts` 单账户金额，
  不再把同一账户被拆出的两条 `totals` 相加。默认拓扑就是一个 provider 一个上游账户、新账户另开 provider。
  **风险**：默认开启，多账户 provider 只会显示一个账户（少算）；需要合计时显式设
  `aiapi_cchp_single_account=false`，恢复逐把 key 刷新与 `totals` 聚合。
  该开关只影响面板与日报展示，不修 CCHP 页面自身按账户相加的总额。
- 关闭单账户开关时余额**每次刷新都强制查上游**：对每个 provider 的每把 active key 各调一次 `?refresh=true` 复查
  （同一上游账户常挂多把 key，只刷一把会让另一把停在旧值，CCHP 据此把同一账户拆成两条并重复计入总额），再取一次列表拿服务端聚合值；
  Mi（`miapi`）与原 CCH 一致不展示，Clouder 不在此模式取余额也不刷新，只保留其 key 优先级用于排序。
- 单账户模式下找不到唯一账户（多账户且没有一条的 `key_ids` 含代表 key）的 provider 不显示金额，
  底部提示「⚠️ 单账户余额不可用」；没有 active key 的 provider 不刷新，但仍计 1 个未完成目标（「⚠️ 部分余额未刷新」）。
- 失败回退：全部刷新失败、被 27 秒预算跳过或在途请求被预算截断时，沿用列表里的服务端缓存值并提示「⚠️ 余额未刷新，来自服务端缓存」；
  只有部分 provider 没刷到时（含没有 active key、拿不到 keyIds 无法刷新的），仍重取一次列表并提示「⚠️ 部分余额未刷新」，
  该提示与超时提示去重（超时优先）。
  只有列表请求本身失败才回退上次快照并提示「⚠️ CCHP 余额来自缓存」（两者不会同时出现）。
  上游余额接口有频率限制：一次刷新对每把 active key 各调一次、失败不重试。
- key 优先级仍缓存 600 秒（受 `cch_quota_interval` 控制），按 provider ID 回退旧值，**没有旧值才**按缺失处理
  （「⚠️ 部分排序信息缺失」）。CCHP 需要串行多段请求，请求数还按 key 放大（每把 active key 各刷一次），
  所以 27 秒总预算同时限制**派发与等待**：到点不再派发新请求、也不再等在途请求（已发出的无法取消，
  晚到的响应直接丢弃），在模块 30 秒上限前降级（「⚠️ 部分请求超时」，与缺失提示合并只出现一次），
  已拿到的余额照常显示。例如 11 把 key × 12 秒、并发 5 约在 27 秒收尾，不会拖到 36 秒。
- 多币种：`totals` 里每种币种按原单位并列显示（如 `余额 $2.00 + ¥70.00`），不做汇率换算；排序只用 `total_usd`，
  该字段缺失时该行排在同优先级末尾。
- 功能摘要：余额 + 今日用量（次数/成功率/首字）+ 供应商健康（成功率/首字 P50），**不查供应商限额**。
- **CommandCode 限额行**（`cmdcode` 模式）：CommandCode 在 CCHP 里是 `balance.status=unsupported`（上游不支持查余额），
  用 `cmdcode` 条目直接读它的限额：`CommandCode@api.commandcode.ai=<CommandCode API Key>:cmdcode:5`，
  面板显示一行 `CommandCode · 5H 32% · W 41% · M 43%`（站名取条目左侧名称，末尾 `5` 是优先级；标签固定为 `5H` / `W` / `M`，不随宽度变化）。
- `cmdcode` 取数：`/alpha/whoami?limits=1` 取组织 ID，再取 `/alpha/billing/credits?orgId=`（个人账户不带 `orgId`），
  只打这两个端点，`subscriptions`/`usage` 不参与展示；字段缺失、非 200、超时都只降级，不中断面板。
- `cmdcode` 显示：百分比 = 窗口已用 / 上限（`windowLimits.fiveHour` / `weekly`）；`limited=false` 时该窗口写「不限」；
  `cap` 缺失或为 0 的窗口整段省略（不写 `0%`）。
  月度 `M` 按套餐上限折算使用率：`M% = clamp((cap - monthlyCredits) / cap, 0, 1)`，接口不返回本月已用，
  只能用「套餐价 − 计划内剩余额度」反推；`cap` 取 `cch_cmdcode_month_cap`（默认 70，即官方 GOAT 套餐月费 70 美元，
  按自己的套餐改即可）。`monthlyCredits` 缺失或 `cap` 非法（≤0/非数字）时该段回退成剩余金额 `M $剩余`，
  剩余 = `monthlyCredits + purchasedCredits + freeCredits`（金额格式：≥1e4 用 k、≥1e6 用 M，其余 ≥100 取整、否则一位小数并去掉尾部 `.0`）；
  三项全缺时省略该段，行内不出现「余额」二字。`M` 的使用率与两个窗口一样参与图标着色（≥80% 黄、≥95% 红）。
- `cmdcode` 宽度与缓存：宽度不够时**只压缩、不丢指标**。阶梯（每档都用脚本自身 `measure()` 判定）为
  `站名 · 5H 32% · W 41% · M 43%`（默认 38 宽即此格式，36 列）→ 站名 + 紧凑三项（`站名 · 5H32% · W41% · M43%`）
  → 站名 + 空格分隔（`站名 · 5H32% W41% M43%`）→ 去掉站名 + ` · `（`5H32% · W41% · M43%`）→ 去掉站名 + 空格分隔（`5H32% W41% M43%`）；
  站名放不下时只截短站名（如 `Comm… · 5H32% W41% M43%`），剩余不足 1 列（或截完只剩省略号）才整段去掉站名。
  三项指标（`5H`/`W`/`M`）在任何宽度下都完整：`cch_row_width` 下限 20 列，两个窗口 100% 且月度是 `$12345678` 这类长值时也不丢项
  （20 列会显示成 `5H100% W100% M$12.3M`）。最紧排法仍超宽时截短收尾，绝不返回超宽行；
  限额行不再走会从尾部丢字段的通用截断（旧实现在 20–22 列会丢掉月度）。
  限额缓存受 `cch_quota_interval` 控制（模块默认 600 秒；直接调用脚本且未传该参数时为 300 秒；
  按「站点地址 + 凭据指纹」分区，指纹是 `SHA-256(base|凭据)` 的前 32 位十六进制即 128 bit，原始凭据不落盘，换 key 不会读到上一账户的限额），
  有效期内不发请求；取数失败或响应里没有任何可展示字段时沿用上次缓存并提示「⚠️ 限额来自缓存」（图标至少黄色），
  没有缓存则本次不占行、只由图标提示；任一窗口或月度 ≥95% 红、≥80% 黄，`limited=false` 时窗口不再按历史 `used/cap` 着色，
  但月度比率照常参与（≥80% 黄、≥95% 红）。缓存只存原始额度，改 `cch_cmdcode_month_cap` 不需重新取数、显示即时重算。
- CCHP 里 `balance.status=unsupported` 的 provider（如 CommandCode）不再计入刷新目标、也不做单账户投影，
  因此不再出现「⚠️ 部分余额未刷新」「⚠️ 单账户余额不可用」，也不会仅因此让面板图标转黄；这类供应商请用 `cmdcode` 条目单独展示限额。

## 模块一览

| 模块 | 功能 | 参数 |
| --- | --- | --- |
| `surge_status.sgmodule` | Surge 运行时长与 MITM、Rewrite、Scripting 状态；点击面板可重载配置 | 不需要 |
| `server.sgmodule` | 服务器流量与到期（Lightsail + Peekabo 合并为一个面板） | 需要，见模块内 `#!arguments-desc` |
| `aiapi.sgmodule` | CCH / CCHP 站点余额，按优先级排序，Clouder 走 CCH | 需要，见模块内 `#!arguments-desc` |
| `app_js.sgmodule` | APP JS 重写合集：Netflix 评分与单集评分、淘票票豆瓣评分、TestFlight 账户管理、彩云天气 SVIP | 不需要 |
| `bilibili_cdn.sgmodule` | 哔哩哔哩 CDN 优化 | 不需要 |
| `block_startup.sgmodule` | 开屏与启动广告拦截 | 不需要 |
| `fuck_ad.sgmodule` | 常见 App 广告拦截（by ocd0711） | 不需要 |
| `get_wskey.sgmodule` | 京东 wskey 抓取；使用时先杀掉京东 App 后台再打开 | 不需要 |
| `tun_only.sgmodule` | 仅开启 TUN，便于配合其它工具调试 | 不需要 |

## 脚本一览

| 脚本 | 用途 | 来源 |
| --- | --- | --- |
| `aiapi_relay.js` | 中转站面板：CCH / CCHP 站点余额，按优先级排序，Clouder 走 CCH（CCH 的 admin 走 `/api/v1/providers/balances:batch` 列本站各上游，按厂商归并、名称取供应商名的品牌部分；user/cookie/login 走 `/api/v1/me/quota` 列账户余额；CCHP 的 cchp 走 `/api/account/orgs/{orgId}/providers` 取余额，每次刷新先按各 provider 的每把 active key 逐一调 `?refresh=true` 实时复查上游、再重取列表拿聚合值，并按 key 优先级排序），合并成一张表；同一脚本供 cron 日报推送同一列表 | 自建 |
| `server_overview.js` | 服务器概览：AWS Lightsail 各实例流量（SigV4 直连 CloudWatch 指标）+ Peekabo 流量与到期，合并显示；同一脚本供 cron 日报 | 自建 |
| `function.js` | Surge 运行时长与功能开关状态面板，点击重载配置 | 参考 chaizia/Profiles |
| `ip_check.js` | 当前节点详情面板 | 感谢 @congcong |
| `sub_info.js` | 订阅流量与到期信息面板 | 模板来自 @mieqq |
| `reload.js` | 配置重载面板 | Author: Pysta |
| `rename.js` | 节点名称按地区字典规范化 | 感谢 @bluman / @qwerzl |
| `stream_check.js` | 奈飞、油管解锁检测 | 上游通用脚本 |
| `stream_all.js` | 流媒体全量解锁检测 | 上游通用脚本 |

`server.sgmodule` 引用 `server_overview.js`，`aiapi.sgmodule` 引用 `aiapi_relay.js`，`surge_status.sgmodule` 引用 `function.js`；单独引用脚本时请与对应模块二选一，避免同一面板重复。

## 分流规则一览

| 规则 | 用途 | 维护方 |
| --- | --- | --- |
| `proxy.list` | 需要代理的域名合集（约 2 万条） | 合并服务自动提交 |
| `direct.list` | 直连域名合集（约 14 万条） | 合并服务自动提交 |
| `cdn.list` | CDN 优化分组 | 合并服务自动提交 |
| `telegram.list`、`telegram_ip.list`、`telegram_asn.list` | Telegram 分流（域名、IP、ASN） | 手工维护 |
| `apple_proxy.list`、`apple_proxy_rough.list`、`apple_download.list` | Apple 服务代理与下载直连 | 手工维护 |
| `emby_filter.list` | Emby 服务器分流（Surge 语法） | 手工维护 |
| `uahp_allinone.list` | 去广告与跟踪域名合集（Unbreak 等上游） | 手工维护 |
| `stream.list` | 流媒体域名 | 手工维护 |
| `lan.list`、`stun.list` | 局域网直连、STUN 协议 | 手工维护 |
| `legacy/proxy.list`、`legacy/direct.list` | 2022 年遗留版本，仅存档 | 不再维护 |

`surge/rules/emby_filter.list` 覆盖的 Emby 服务器：普拉斯 AGA（中国电信可直连）、CF 公益服
（需挂代理）、普拉斯备用服（4 个）、Exflux、Nexitally/AmyTelecom（共用，仅限美国特定节点）、
Skicat、Godetia（猫熊和 3DM）。

## 图标与文档

- `icons/`：策略组图标，可直接作为 `icon-url` 引用；
- `docs/`：README 引用的 Quantumult X 操作截图，`other/` 内为其它图片。

## 功能重叠与选择

| 想要的 | 用 | 不要同时用 |
| --- | --- | --- |
| 服务器流量面板 | `server.sgmodule` | 与单独引用 `server_overview.js` 二选一 |
| AI 余额与额度面板 | `aiapi.sgmodule` | 与单独引用 `aiapi_relay.js` 二选一 |
| Surge 运行状态面板 | `surge_status.sgmodule` | 与单独引用 `function.js` 二选一 |
| 只做 APP 重写 | `app_js.sgmodule` | 与本仓库其它重写模块重复的部分 |

## 高风险与注意事项

- 本仓库只搬运和整合，**不负责维护**上游脚本，也不保证任何脚本的可用性；
- 面板脚本需要填写自己的 API Key / Token，这些参数仅保存在本地模块中，请勿提交到公开仓库；
- 在 App 内抓取 Cookie 的重写仅限自用；账号、Cookie、Token、私钥一律不要粘贴到 issue 或仓库；
- 规则由合并服务自动写回，手工编辑会被下次更新覆盖；
- 部分脚本依赖 Surge 的 HTTP API 或系统版本，升级 Surge 后如有失效请以官方文档为准。

## 反馈与致谢

发现编写错误或有建议欢迎提 issue；**因个人使用方式不当导致的脚本不可用，不予处理**。

脚本引用与整合过程中参考过以下作者的工作：[@sunert](https://github.com/Sunert)、
[@age174](https://github.com/age174)（招招试药）、[@NobyDa](https://github.com/NobyDa)（京东多合一签到）、
[@blackmatrix7](https://github.com/blackmatrix7)（滴滴出行系列）。京东系列脚本可配合
[Hello World 的仓库](https://github.com/JDHelloWorld/jd_scripts) 使用。

特别感谢以下脚本作者，以及整合时参考的作者（排名不分先后，如有遗漏万分抱歉，请联系我加上）：

- **脚本**：[@NobyDa](https://github.com/NobyDa)、[@chavyleung](https://github.com/chavyleung)、[@Sunert](https://github.com/Sunert)、[@lxk0301](https://github.com/lxk0301)、[@blackmatrix7](https://github.com/blackmatrix7)、[@WowYiJiu](https://github.com/WowYiJiu)、[@zhiyi](https://github.com/Ariszy)、@ziye（防止大佬再被封，故不贴出）、[@age174](https://github.com/age174)、[@yangtingxiao](https://github.com/yangtingxiao)、[@ChuheGit](https://github.com/ChuheGit)、[@zZPiglet](https://github.com/zZPiglet)、[@whyour](https://github.com/whyour)、[@mieqq](https://github.com/mieqq)、@bluman / @qwerzl；
- **配置文件**：[@KOP-XIAO](https://github.com/KOP-XIAO)；
- **分流规则**：[@blackmatrix7](https://github.com/blackmatrix7)；
- **图标**：[@shoujiqiyuan](https://github.com/shoujiqiyuan)、[@erdongchanyo](https://github.com/erdongchanyo)、[@Orz-3](https://github.com/Orz-3)、[@ChuheGit](https://github.com/ChuheGit)、@ziye（防止大佬再被封，故不贴出）。

如果这里的说明和整合的脚本对你的使用有帮助，欢迎点个 Star，感激不尽 :gift_heart:

## 许可证与免责声明

本仓库采用 [MIT License](LICENSE)。

- LucaLin233 发布的本仓库中涉及的任何解锁和解密分析脚本仅用于资源共享和学习研究，不能保证其合法性、准确性、完整性和有效性，请根据情况自行判断；
- 间接使用脚本的任何用户，包括但不限于建立 VPS 或在某些行为违反国家/地区法律或相关法规的情况下进行传播，LucaLin233 对于由此引起的任何隐私泄漏或其他后果概不负责；
- 请勿将本仓库内的任何内容用于商业或非法目的，否则后果自负；
- 如果任何单位或个人认为该项目的脚本可能涉嫌侵犯其权利，则应及时通知并提供身份证明、所有权证明，我将在收到认证文件后删除相关脚本；
- LucaLin233 对任何本仓库中包含的脚本在使用中可能出现的问题概不负责，包括但不限于由任何脚本错误导致的任何损失或损害；
- 您必须在下载后的 24 小时内从计算机或手机中完全删除以上内容；
- 任何以任何方式查看此项目的人，或直接或间接使用该项目的任何脚本的使用者，都应仔细阅读此声明。LucaLin233 保留随时更改或补充此免责声明的权利。一旦使用并复制了本仓库相关脚本或其他内容，则视为您已接受此免责声明。
