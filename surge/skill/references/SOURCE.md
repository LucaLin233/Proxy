# 上游来源、同步与打包

执行安装、验收、打包或上游同步前先读本文件。运行架构（传输、参数转换、凭据优先级、远程差异）见 `references/controller-cli.md`；`/v1/*` 回退见 `references/http-api.md`。

## 脚本清单

| 脚本 | 用途与关键约束 |
|---|---|
| `scripts/install.sh` | 安装到目标环境（symlink 默认 `/usr/local/bin/surge-cli`，`SURGE_CLI_LINK` 可覆盖）；建链后跑 `acceptance.sh --installed`，不通过即报错并非零退出；默认凭据路径 `SURGE_API_KEY` |
| `scripts/acceptance.sh` | 只读验收：`--offline` 默认（语法＋本地链接）、`--installed`（离线档＋PATH 安装点核验）、`--controller` 查实例、`--network` 追加合成无秘密 Profile 上传与 DNS；不改设置 |
| `scripts/package_release.py` | 打包分享（过滤敏感内容）；禁止打包凭据、profile、抓包、请求正文、数据库与运行输出 |
| `scripts/sync_upstream.sh` | 上游快照入口：无参数或 `prepare` 只暂存、`apply <dir>` 才写；同步后**人工合并**，不盲目覆盖 `SKILL.md` |
| `scripts/update_upstream.py` | 事务实现（raw／staged／review.diff／transaction／backup，内容与模式校验，显式 apply，按原模式恢复）；见下门禁 |
| `scripts/adapt_upstream_reference.py` | 把官方 `command-reference.md` 适配为 Minis 调用规则（§1.1–§1.3）；只放行已审阅原文哈希，已适配成品走独立路径（当前产物逐字节 no-op，旧产物归一升级；归一结果未登记即拒写），未知原文 fail-closed |
| `scripts/surge_cli.py` | External Controller 客户端（含官方 HTTPS `--check`）；非交互，凭据只来自 `SURGE_API_KEY`／`--password-stdin` |
| `scripts/surge_ios.py` | localhost HTTP API 回退客户端；同机 `127.0.0.1:6171`，`X-Key` 取 `SURGE_API_KEY` |
| `scripts/test_policy_descriptor.py` | 经 `/v1/scripting/evaluate` 测未配置节点，不改 Profile；描述符经 stdin／`--descriptor-file -` 送入 |

同步时必须保留：上列脚本、`references/controller-cli.md`、`references/http-api.md`、`references/diagnostics.md`、`references/platform-compatibility.md`、`references/SOURCE.md`（本文件不被自动重写，须人工比对合并）及 `SKILL.md` 覆盖层（永不整体覆盖为 macOS 版）。同目录的 `upstream-command-reference.md` 与 `upstream-manifest.json` 由导入事务生成，随包保留、**不作加载资源**（正文不引用它们的内容）。凭据、profile、请求正文与任何秘密不得同步进技能目录。

**安装点是包外状态**：在 Minis 安装、技能目录改名或迁移后，须重跑 `sh scripts/install.sh`，再执行安装态验收 `sh scripts/acceptance.sh --installed`。该档先跑离线检查，再核验 PATH 中 `surge-cli` 存在、可执行，且真实目标（realpath）等于**本包**的 `scripts/surge_cli.py`；链接缺失、断链、目标不符或不可执行均非零退出。`--offline` 只查包内语法与相对链接、不读宿主安装点，**不能**用来判断安装是否仍然有效（2026-10-30：技能目录改名后 `/usr/local/bin/surge-cli` 悬空，`--offline` 仍 PASS）。

## 官方文件来源与哈希

**当前基线：Surge for macOS `6.10.0`（`12480`），2026-10-11 导入**（Controller Protocol `25`）。历史基线 `6.9.0`（`12250`，2026-09-02 核对）的哈希在括注中作对照，不作现值。

- `SKILL.md`（官方原文）：`968519d259272362f32a245365edf5c021b81584b56cf7169ba5529f8308dcdf`（6.9.0：`904a33f3…`）→ 本地留存 `references/upstream-SKILL.md`
- `references/command-reference.md`（**适配前**原文）：`42a0509642641dfc9cf70001997a26c4241f9d72df5c136141d763c695cd51ea`（6.9.0：`66f0b248…`）→ 原文另存同目录的 `upstream-command-reference.md`；活动文件 `references/command-reference.md` 是它的**适配副本**
- `references/plugin-authoring.md`：`d41b905588c8a941e5c208854f76b05b8a395f981a6027ba758a8b9ee4ac7193`（与 6.9.0 逐字节相同）
- `agents/openai.yaml`：官方 `ef5cdcb1edd583d4b673774aa1e3b1c153b83df23cf1105191e8aac4d09912b1`（与 6.9.0 同）；本地是**改过的版本**（去掉图标两行），哈希不一致，`apply` 不覆盖，须人工比对
- `assets/logo.png`：官方 `6e8ba4a6ee0ac71c7c03e4a5c7ee457d2f782abe71542e9819dc35443fb1d6f9`（与 6.9.0 同）；**官方图标本地不保留**——2026-10-11 已从本技能删除，2026-10-11 导入时也未回写，只留哈希与暂存证据

来源／版本／逐文件哈希的机器记录见同目录的 `upstream-manifest.json`；每次导入另留 `raw/`、`staged/`、`review.diff` 与 `transaction.json` 于 `/var/minis/shared/surge-updates/<时间戳>/`。

### 取源方式（本对象的官方上游＝官方 Mac 应用包，非 GitHub 仓库）

官方 Agent Skill **只随 Surge Mac 应用包分发**：手册 `manual.nssurge.com/tools/cli.html` 的 Agent Skill 段给出的安装来源是应用内 `/Applications/Surge.app/Contents/Resources/Skills/surge/`，**没有独立的技能下载链接**。因此本技能「有没有上游更新」不看仓库，看官方 Mac 发行版：

1. **官方包直链**（首选，本机可用）：`https://dl.nssurge.com/mac/v6/Surge-<版本>-<build>-<hash>.zip`。本次来源即 `Surge-6.10.0-12480-acfa4a1d42c11a4b6b8ec2c235b479f6.zip`（47,973,109 B，`Content-Type: application/zip`，响应 `Last-Modified: Thu, 08 Oct 2026 15:01:20 GMT`）。取源后**先核包身份**——`Surge.app/Contents/Info.plist` 的 `CFBundleIdentifier` = `com.nssurge.surge-mac`、`CFBundleShortVersionString`、`CFBundleVersion`，并确认包内含 `_CodeSignature` 条目；**签名条目存在不等于签名验证通过**，不得写成已验签。再解出 `Surge.app/Contents/Resources/Skills/surge/` 的五个文件。
2. **版本与 build 变化**：官方 Mac appcast `https://nssurge.com/mac/latest/appcast-signed-beta.xml`（官方统一入口 `https://nssurge.com/llms.txt` 也分流到此）覆盖「最新版本／近期变化／beta」；下载响应头 `Last-Modified` 给构建日期。
3. **备用**：从装有 Surge Mac 的机器直接导出该目录五文件（经用户当次指定且已获准的 Mac 目标走 SSH；目标由运行时给定，本技能不缓存主机名或别名）。

校验判据：五文件逐个核 sha256，与本节表及同目录的 `upstream-manifest.json` 对照；**只有** `references/command-reference.md` 的**原文**哈希在适配器 `REVIEWED_SHA256` 内才可导入。

`references/command-reference.md` 是上游原文加 Minis 调用前言的**适配副本**（§1.1 协议门槛、§1.2 本地执行优先级、§1.3 基本格式），§2 起除 §4 的 `<nil>` 示例加引号与 §5 的一处按需收集改写外保持官方文字原样；`§1.2` 的本地执行优先级（默认 `--raw`、修改前不默认收集 `dump policy`/`dump profile`，敏感 `dump profile` 仅在必要时按最小读取边界取）优先于官方 §5 的操作建议，§2 起的历史命令语义与协议号仅作说明。

**2026-09-27 合并来源**：非官方 Surge.app 更新，而是合并用户提供的**第三方同族包**（`surge-ios.zip`，sha256 `6c09613c22a6a0390198188b9e0247f90249d7e70757526fd4919f86ee910433`，frontmatter `name: surge-ios`）；其 `references/upstream-SKILL.md` 与上表快照逐字节相同（官方快照未变），包内只有一份已适配命令参考（`5331f03b…`），无官方原文。

**provenance 已闭合（2026-10-11）**：官方导入已在 `references/` 下写出 `upstream-command-reference.md`（官方原文逐字节副本）与 `upstream-manifest.json`（来源、版本、逐文件 sha256）。两者是**证据与门禁产物、不是可加载资源**：正文不引用、不写加载语句，只为下次比对与来源复核留存，登记时按包内文件登记而非加载边。五文件中仍有一份在本技能内非官方原件——`agents/openai.yaml`（本地改过的版本），导入时人工比对、`apply` 不覆盖；`references/command-reference.md` 与官方原文的差异只是 §1 适配前言加两处正文改写，原文已另存，可逐处复算。

## `--source` 门禁（不是来源或真实性认证）

门禁 = **结构检查 ＋ 命令参考哈希检查**。结构检查只看目录是否含五个官方文件路径 `SKILL.md`、`references/command-reference.md`、`references/plugin-authoring.md`、`agents/openai.yaml`、`assets/logo.png`（**只核存在性**；其余四个文件不由门禁校验，prepare 后须人工核对，目录名与 `--version` 标签都不能证明「官方」）。哈希检查要求 `references/command-reference.md` 的 sha256 ∈ 适配器 `REVIEWED_SHA256`（已审阅官方原文；当前两枚：`66f0b248…`＝6.9.0、`42a05096…`＝6.10.0）；已适配成品（`ADAPTED_SHA256`：历史条目 `5331f03b…`、`334747c7…`、`515303de…`、`d3163362…`、`5538a3ed…`，2026-10-11 起另含当前产物 `48a99818…` 与其前身 `34309dfb…`、以及部署中旧产物的**归一输出** `1085f42a…`）或未知哈希在暂存前即 fail-closed，活动树与暂存树不变。

禁止把本技能目录、合并候选树或已适配上游副本当作 `--source`。对已适配成品重跑适配器是**独立幂等路径**（直接调 `scripts/adapt_upstream_reference.py <file>`），不经过事务；已适配成品不得作为未来导入产物 `upstream-command-reference.md` 暂存，也不得记为 `upstream-manifest.json` 的 `raw_sha256`。**当前出厂产物**重跑是逐字节 no-op；已登记的旧产物会被**归一升级**（补齐 §1 前言与两处改写），其归一输出也登记在 `ADAPTED_SHA256` 内，故连跑两次可达稳态。归一结果若未被登记，脚本**拒绝写盘并保持文件原样**（不写出连入口自己都不认的状态），须先审阅并登记该哈希。

## 更新流程

规则候选须从独立克隆调用下列入口，CANDIDATE 必须是已核 origin 的独占候选根；不得从生效技能目录执行 apply。现有 prepare 固定写 `/var/minis/shared/surge-updates/`，不符合 FORGE 唯一工作根时不得派执行；交主助理另核该资产目录授权，apply 仅作用于候选。生效端更新统一走 `luno-sync` 发布窗口，不由上游导入脚本另开旁路。

先查官方发布说明与 Mac/iOS 差异，无变化即不改写客户端。取源首选官方包直链（见〈取源方式〉），备用是从装有 Surge Mac 的机器导出（`--host` 指向用户当次指定且已获准的 Mac 目标；本技能不提供默认主机）。

```sh
# ① 官方包直链取源（本机可用）：下载 → 核包身份 → 解出五文件 → 以本地目录暂存
#    目录须含 SKILL.md、references/command-reference.md、references/plugin-authoring.md、
#    agents/openai.yaml、assets/logo.png 五项
"$CANDIDATE/skills/luno-surge/scripts/sync_upstream.sh" prepare --source <解出的 surge 目录> --version "Surge for macOS <版本> (<build>)"
# ② 备用：从装有 Surge Mac 的机器 SSH 拉取（核主机、不关 host-key 检查）
"$CANDIDATE/skills/luno-surge/scripts/sync_upstream.sh" prepare --host <用户当次指定的 Mac 目标>
# ③ 审阅返回目录的 review.diff、raw/、staged/ 后再：
"$CANDIDATE/skills/luno-surge/scripts/sync_upstream.sh" apply /var/minis/shared/surge-updates/TRANSACTION
```

无参数即 prepare；旧的位置参数别名已移除；本地/离线夹具用 `prepare --source DIRECTORY --version LABEL`。事务根固定 `/var/minis/shared/surge-updates/`。

- 新参考哈希被拒时 raw 与 diff 仍留存：审阅 CLI 选项/语义、改适配器与已审阅哈希、测试后再 prepare；未审阅文字不得批准哈希。
- 只在授权范围内 apply：建 `backup/` 前同时校验**内容漂移**（活动与暂存哈希）与**模式漂移**（`mode_of(target)` vs prepare 记录），任一不符即停止（不写文件、不建 backup、活动树不变），须重跑 prepare。
- `agents/openai.yaml` 与 `references/SOURCE.md` 不被自动重写，须人工比对后合并；`assets/logo.png` 保留在结构门禁与 provenance 清单内，但**不在自动应用集合**：官方图标本地不保留，apply 不回写（`agents/openai.yaml` 已不引用它）。
- 受控失败恢复被触文件（内容**与**原模式）：`transaction.json` 逐文件记 before/after 哈希与 `mode`（prepare 时活动文件模式；`null`＝当时不存在、新建 `0644`）。这不是全文件系统原子事务、也不防 kill——若以 `state=applying` 被打断，先查事务、按 `backup/` 与记录 mode 逐文件恢复再重试。禁止并发更新。
- 把相关新工作流人工并入本地 references／入口；导入源版本不得替换历史**已验证**基线，除非有对应证据。
- 更新后跑 `scripts/acceptance.sh` 离线档；`--controller` 仅在确认实例/引擎后作相关集成检查，`--network` 追加 DNS 与合成无秘密 Profile 上传；各档都不改设置，`watch speed` 只是首帧订阅冒烟、非完整流式验证。
- 传输/参数转换变更需定向夹具，必要时设备测试。重启、临时规则变更与带宽测试始终是单独授权操作，绝不作为自动验收步骤。更新流程不含打包。

## 打包与投递

- 只用 `scripts/package_release.py` 生成分享包（排除敏感目录/后缀，拒绝符号链接，拒绝输出落在技能目录内）；默认输出到目录外持久路径 `/var/minis/shared/release/surge-skill-YYYYMMDD.zip`（显式路径仍可覆盖），**持久产物首选 `shared/` 下**。
- 归档条目落在 ZIP 根（无顶层目录），即 `lh skill install` 消费的布局；固定时间戳、按可执行位写 755/644，命中私钥块或 token 前缀即中止。向 LobeHub 投递走**私有 R2 桶**的短时（约 600 s）预签名 ZIP URL：不公开对象或对象 URL，URL 本身（含临时凭据）不得写入回复、日志或文件。
- 平台侧安装/更新与 identifier 语义见 `luno-lobehub`：`lh skill install` 不一律视为只新建、不把删除当更新前置，更新后须回读实际 ID。

- **公开分发镜像**：本技能另有一份公开安装副本——GitHub `LucaLin233/Proxy` 的 `surge/skill/`（源文件 ＋ 同目录 `surge-skill.zip`，安装与打包说明见该目录 `README.md`）。它只说明公开安装路径，不是当前 LobeHub 平台条目来源的证明，也不覆盖上面的私有包投递规则（R2 预签名 URL ＋ `lh skill install`）；更新公开副本须单独授权（公开仓库 PR/发布、按原打包器生成包），与本仓库同步授权不互相推出。公开副本内的第三方精选补充按用户已定处置：**保留并署名**，照录上游版权与许可通知、并列标注上游自身的标注不一致，**不宣称已解决**，也不再另设许可再裁定门槛。

## 模块推送

- **仅推自有仓库 `LucaLin233/Proxy`**（surge 模块源）；推送前加载 `luno-ops/references/github.md`，按其凭据流程操作——凭据不入命令行，用临时 git-cred-helper 从 `$GH_TOKEN` 读取、用后立即删除。
- 推送结果以 `gh api` 回读为准（raw CDN 缓存 2–7 分钟）；未回读即视为未完成。
- 本条只描述流程，**不构成推送授权**：推送与发布仍按〈安全与平台边界〉单独确认。

## 第三方精选补充（2026-10-25）
来源：OpenMinis/MinisSkills@164395f193a56e3507ca98415383c7c16780da00 的 coredevice-toolkit/references/SURGE_LOOPBACK.md、ios-dev/references/loopback.md 与 ios-dev/SKILL.md；补充同机回环兼容条件与分层诊断，为第三方精选改写，非 Surge.app 官方更新，不替换官方快照或哈希。2026-10-25 已核本地原文；在线可取性、当前设备行为未验证。许可文件根 LICENSE 与 ios-dev/LICENSE 记载 MIT，README 标 Apache-2.0；按用户已定保留并署名，照录通知、并列标注不一致，不宣称已解决，不另设许可裁定门槛。

## 第三方内容来源与许可通知

本技能的「同机回环兼容条件与分层诊断」部分为**改写**，非 Surge 官方内容：来源仓库 `OpenMinis/MinisSkills`，提交 `164395f193a56e3507ca98415383c7c16780da00`，涉及文件 `coredevice-toolkit/references/SURGE_LOOPBACK.md`、`ios-dev/references/loopback.md`、`ios-dev/SKILL.md`。本技能中的对应文字为精选改写，不是上游原文，也不代表 Surge 官方立场。

上游在该提交下的版权与许可通知原文如下（照录，未作改动；上游自身的许可标注彼此不一致，见下条，本技能不代为裁定）。

**（1）根 `LICENSE`（原文照录）**

MIT License

Copyright (c) 2026 OpenMinis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

**（2）`ios-dev/LICENSE`（原文照录）**

MIT License

Copyright (c) 2026 OpenMinis contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

This license covers the files in this directory written for this skill. It does
not cover the third-party software listed in THIRD_PARTY.md, which keeps its own
license.

Acknowledgements

This skill was developed by studying, and in places checking its behaviour against,
these open-source projects: xtool (Kabir Oberai, MIT), idevice (Jackson Coxson, MIT),
StikPair (StephenDev0, MIT Non-Commercial), LocalDevVPN, and the earlier
coredevice-toolkit in OpenMinis/MinisSkills (MIT). It relies at run time on
pymobiledevice3 and pmd-pytcp (GPL-3.0). No source code from the non-commercial
project is included here. Details, licences and exactly what was used for what
are in THIRD_PARTY.md.

**（3）上游标注不一致（照录，不裁定）**

上游 `README.md` 的 `## License` 节写 `[Apache License 2.0](LICENSE)`，而根 `LICENSE` 正文是 **MIT License**（`Copyright (c) 2026 OpenMinis`）；`ios-dev/LICENSE` 同为 MIT（`Copyright (c) 2026 OpenMinis contributors`），并在正文后附「本许可覆盖本目录为本技能编写的文件，不覆盖 `THIRD_PARTY.md` 所列第三方软件」及致谢段。三处不一致如实并列，**不替上游裁定适用许可，不宣称冲突已解决**；上述两段通知按 MIT 文本照录，本件不另附 Apache-2.0 全文。

以上原文于 2026-10-31 匿名只读、按该提交实取核对（根 `LICENSE` 1,066 B、`ios-dev/LICENSE` 1,770 B、`README.md` 7,014 B，均 HTTP 200）；未读 `THIRD_PARTY.md` 与 `ios-dev/THIRD_PARTY.md` 的第三方许可细则。
