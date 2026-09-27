# Upstream Source and Synchronization

## Maintenance scripts

执行安装、验收、打包或上游同步前先读本节；完成后按「Acceptance」核对再交付。

| 脚本 | 用途 | 备注 |
|---|---|---|
| `scripts/install.sh` | 安装本 Skill 到目标环境（symlink `/usr/local/bin/surge-cli`） | 默认凭据路径是环境变量 `SURGE_API_KEY` |
| `scripts/acceptance.sh` | 只读验收：默认 `--offline` 语法/本地链接，`--controller` 查询实例，`--network` 追加合成无秘密 Profile 上传与 DNS 请求 | 不产生写操作、不改 Surge 设置 |
| `scripts/package_release.py` | 打包分享（扫描并过滤敏感内容） | 禁止打包凭据、profile、抓包、请求正文、数据库与运行输出 |
| `scripts/sync_upstream.sh` | 上游快照入口：无参数或 `prepare` 只暂存，`apply <dir>` 才写活动文件 | 同步后**人工合并**，不盲目覆盖本 `SKILL.md` |
| `scripts/update_upstream.py` | 事务实现（raw/staged/review.diff/transaction/backup、内容与模式的 before/after 校验、显式 apply、按原模式恢复） | `sync_upstream.sh` 的代理目标；`--source` 只做结构检查（五个官方文件路径须齐全）＋命令参考哈希检查（须 ∈ 已审原文集合），其余四文件需人工核对；已适配/未知原文 fail-closed |
| `scripts/adapt_upstream_reference.py` | 把官方 `command-reference.md` 适配为 Minis 调用规则（§1.1 协议门槛、§1.2 执行优先级、§1.3 基本格式） | 只对已审阅的官方原文哈希放行；已适配成品走独立幂等路径，未知原文 fail-closed |
| `scripts/surge_cli.py` | External Controller 客户端（含官方 HTTPS `--check` 回退） | 非交互，凭据只来自 `SURGE_API_KEY` 或 `--password-stdin` |
| `scripts/surge_ios.py` | localhost HTTP API 回退客户端 | 同机 `127.0.0.1:6171`，`X-Key` 取自 `SURGE_API_KEY` |
| `scripts/test_policy_descriptor.py` | 经 `/v1/scripting/evaluate` 测试未配置节点，不改 Profile | 描述符经 stdin／`--descriptor-file -` 送入 |

## Historical validated baseline

The entries below record the 2026-09-02 validation, not the current runtime. After a staged update, `upstream-manifest.json` is authoritative for imported source/version/hash provenance; it does not claim runtime validation. That manifest is written by the update transaction after a real official import — it is intentionally absent until such an import has been performed.

Synchronized from the Surge Skill bundled on the user's Mac mini on 2026-09-02:

- SSH source alias: `macmini` (synchronization only; never a runtime dependency)
- Source directory: `/Applications/Surge.app/Contents/Resources/Skills/surge/`
- Surge for macOS: `6.9.0` (`12250`, formal release; bundled Skill files unchanged from build 12130)
- Core: `6009000`
- Controller Protocol: `25`
- Upstream `SKILL.md`: `904a33f378a45d89e945f470c446f5511d156c977d248f40a7652342ed121f05`
- Upstream `references/command-reference.md` before Minis invocation adaptation: `66f0b248fa7f696ea5f9b8511729f6c82a25c3bee23a6f5305ce4bdf6b64df4b`
- Upstream `references/plugin-authoring.md`: `d41b905588c8a941e5c208854f76b05b8a395f981a6027ba758a8b9ee4ac7193`
- `agents/openai.yaml`: `ef5cdcb1edd583d4b673774aa1e3b1c153b83df23cf1105191e8aac4d09912b1`
- `assets/logo.png`: `6e8ba4a6ee0ac71c7c03e4a5c7ee457d2f782abe71542e9819dc35443fb1d6f9`

The exact official `SKILL.md` snapshot is retained as `upstream-SKILL.md`. The local `SKILL.md` merges its operational guidance with Minis/iOS transport, credential, privacy, and safety rules. The command reference is copied from upstream and automatically receives a small Minis-specific invocation preface (§1.1 protocol thresholds, §1.2 local execution priority, §1.3 basic format); §2 onward stays the official text verbatim. §1.2 states that the local execution priority — `--raw` as the default output form, and no default `dump policy`/`dump profile` collection before a change (sensitive `dump profile` only when necessary, under the minimal-read boundary) — overrides the conflicting operational advice in the official §5, while the historical command semantics and protocol/version statements in §2 onward remain informational only. The update transaction retains the official raw text separately as `upstream-command-reference.md`. Both `upstream-manifest.json` and that retained raw text are produced only by a real official import and are intentionally absent until one has been performed.

## Local additions that must survive synchronization

- `scripts/surge_cli.py`: Linux/iSH implementation of External Controller protocol plus the explicit-file official HTTPS `--check` fallback.
- `scripts/surge_ios.py`: localhost HTTP API fallback.
- `scripts/test_policy_descriptor.py`: local helper for testing an unconfigured node through `/v1/scripting/evaluate` plus `$httpClient` `policy-descriptor`, without changing the Profile.
- `scripts/sync_upstream.sh`: prepare/apply entry point; no arguments means prepare only.
- `scripts/update_upstream.py`: staged import, provenance, drift checks and recoverable application (content + original mode). `apply` refuses a target file whose **mode** drifted since prepare, before it creates `backup/`; re-run prepare instead. The `--source` gate is a structural check (the five official file paths must exist) plus a command-reference hash check (must be in the adapter's reviewed raw set) — it does not verify the other four files, which need manual comparison, and it is not a source/authenticity certification. An already-adapted or unknown `references/command-reference.md` is refused fail-closed before staging.
- `scripts/adapt_upstream_reference.py`: adapts command-reference §1.1 (protocol thresholds), §1.2 (local execution priority over the upstream §5 recommendations) and §1.3 (basic format), keeps sensitive profile dumps opt-in, and shell-quotes the `<nil>` assignment example. The remaining upstream command semantics are preserved. Its reviewed-hash whitelist covers official raw text only; already-adapted products are recognized on a separate idempotency list and are never recorded as new official raw text.
- `scripts/install.sh`: installs the symlink; Minis environment variable `SURGE_API_KEY` is the default credential path.
- `scripts/acceptance.sh`: defaults to offline checks; `--controller` queries the local instance, `--network` additionally uploads a synthetic secret-free Profile and performs DNS requests.
- `references/controller-cli.md`: protocol, installation, credential precedence and remote-management notes.
- `references/http-api.md`: HTTP API fallback reference.
- `references/diagnostics.md`: task-specific routing, DNS, temporary-rule, performance and tunnel guidance; preserve on sync.
- `references/platform-compatibility.md`: platform limitations and the single historical protocol/version table; preserve on sync.
- `references/plugin-authoring.md`: exact official macOS plugin authoring guide, synchronized from upstream.
- `SKILL.md`: curated Minis overlay; never blindly overwrite with the macOS file.

Do not sync credential files, profiles, request bodies, API keys, Controller passwords, or any other secrets into the Skill directory.

## Packaging and delivery

- Build shareable archives only with `scripts/package_release.py` (excludes sensitive directories/suffixes, rejects symlinks, refuses an output path inside the skill directory). Its default output is the out-of-directory persistent path `/var/minis/shared/release/surge-skill-YYYYMMDD.zip`; an explicit path argument still overrides it, but never point it at `/var/minis/workspace` or `/tmp` (they do not survive across shell processes on this device), and never at a path inside the skill directory.
- Deliver to the LobeHub installation channel through a **private R2 bucket** with a short-lived (about 600 s) presigned ZIP URL. Do not publish the archive or a public object URL, and never store the presigned URL itself (it carries temporary credentials) in replies, logs or files.
- `lh skill install` only creates a new record: delete the same-named skill first (`lh skill delete <id> --yes`). The identifier is derived from the URL host+path, so reusing the same object key keeps it stable; it cannot be chosen.

## Update workflow

Check official release notes and relevant Mac/iOS differences first. No relevant change means no client rewrite. Reading the Mac source is an SSH task: follow the SSH skill and verify the host; never disable host-key checks.

```sh
# Prepare only; downloads five explicit official files, never changes active skill.
/var/minis/skills/surge/scripts/sync_upstream.sh prepare --host macmini
# After reviewing the returned directory's review.diff, raw/ and staged/:
/var/minis/skills/surge/scripts/sync_upstream.sh apply /var/minis/shared/surge-updates/TRANSACTION
```

No arguments also means prepare. The old positional alias syntax is removed. Local/offline fixtures use `prepare --source DIRECTORY --version LABEL`. The persistent transaction root is `/var/minis/shared/surge-updates/` (`/var/minis/workspace` does not survive across shell processes on this device).

`--source` 门禁 = **结构检查 ＋ 命令参考哈希检查**，不是五文件来源或真实性认证：目录必须包含五个官方文件路径 `SKILL.md`、`references/command-reference.md`、`references/plugin-authoring.md`、`agents/openai.yaml`、`assets/logo.png`，且只校验这些路径**存在**；`references/command-reference.md` 的 sha256 必须 ∈ 适配器 `REVIEWED_SHA256`（已审阅的官方原文，当前 `66f0b248…`）。其余四个文件（`SKILL.md`、`references/plugin-authoring.md`、`agents/openai.yaml`、`assets/logo.png`）的来源与内容**不由门禁校验**，prepare 后须人工核对；目录名与 `--version` 标签都不能证明「官方」。明确禁止把本技能目录、合并用的候选树或本次合并提供的已适配上游副本作为 `--source`。已适配成品（`ADAPTED_SHA256`，如 `5331f03b…`、`334747c7…`、`515303de…`、`d3163362…`）或未知哈希在暂存前即 fail-closed，活动树与暂存树都不变。Re-running the adapter on an already-adapted product is a **separate idempotent path**: call `scripts/adapt_upstream_reference.py <file>` directly; it never goes through the transaction, and an adapted product must never be staged as `references/upstream-command-reference.md` or recorded as `raw_sha256` in `upstream-manifest.json`. Only the **currently shipped** adapted product (`d3163362…`) is a byte-identical no-op; the older entries in `ADAPTED_SHA256` exist to avoid a false "unreviewed upstream reference" failure, and re-running the adapter on them regenerates the current §1 adaptation block (§1.1–§1.3, including the §1.2 execution-priority statement).

- Raw source and diff persist even if adaptation rejects a new official reference hash. Review changed CLI options/semantics, update the adapter and its reviewed hash, test it, then prepare again. Do not approve a hash without reviewing the text.
- Apply only within user-authorized update scope. Before it creates `backup/`, apply checks **both** content drift (active and staged hashes) and **mode drift** (`mode_of(target)` vs the mode recorded in `transaction.json` at prepare time); any mismatch stops the apply with nothing written, no `backup/` created and the active tree unchanged, and prepare must be re-run. It preserves local overlays, creates a persistent backup and writes `upstream-manifest.json` with source hashes/version and **runtime not tested** status. Official command-reference raw text is retained separately.
- `agents/openai.yaml` and `references/SOURCE.md` are not rewritten automatically: compare them by hand and merge only after review.
- Handled apply failures restore touched files (content **and** the original mode). A restore counts as complete only when both match: `transaction.json` records per file the `before`/`after` hashes and `mode` (the active file's mode at prepare time; `null` means the file did not exist and is created `0644`). Apply writes each file with its recorded mode, and `backup/` keeps the same modes for manual recovery. This is still not a filesystem-wide atomic transaction and not kill-proof: if interrupted with `state=applying`, inspect the transaction and restore every touched file from `backup/` together with its recorded mode (`transaction.json` → `files.<name>.mode`) before attempting another update. Remaining limitation: modes are recorded and restored only for the files listed in the transaction; files outside it are never touched. Do not run concurrent updates.
- Manually merge relevant new workflows into local references/entry; imported source versions must not replace historical **tested** baselines without corresponding evidence.
- Run `scripts/acceptance.sh` for offline syntax/links. Use `--controller` only for relevant integration checks after confirming the instance/engine; `--network` additionally sends DNS requests and uploads a synthetic no-secret Profile. No mode changes settings. `watch speed` is only a first-frame subscription smoke test, not full streaming validation.
- Transport/argument conversion changes need targeted fixtures and, when relevant, device tests. Restart, temporary-rule mutation and bandwidth tests remain separately authorized operations, never automatic acceptance steps.

No packaging step is part of updates. If the user later requests a shareable archive, handle it separately with explicit content and credential review, using `scripts/package_release.py`.

## Runtime architecture

The Minis CLI does not execute the macOS Mach-O binary and does not need SSH at runtime. It connects to Surge iOS External Controller (default `127.0.0.1:6170`) using:

1. password plus CRLF;
2. welcome JSON plus CRLF;
3. one textual command line plus CRLF (bare verb, each following argv item double-quoted);
4. one or more JSON Lines result/event frames.

Surge iOS Protocol 25 still accepts the legacy `{"argv":[...]}` request, but the formal Surge Mac 6.9.0 build 12250 CLI emits the textual format, which the Minis client now follows. Its bundled official Skill/reference files are byte-identical to those first synchronized from build 12130.

Because the Controller parses most command arguments, newly supported ordinary commands can generally be passed through without adding an HTTP endpoint mapping. The local client must still reproduce official CLI-side conversions (currently `summary`, `profile diff`, `rule temp`, `watch speed`, and script-file Base64/mock-type encoding). Online `plugin` operations are ordinary Controller commands on macOS; `plugin validate` and `plugin pack` are local macOS CLI tools and are not implemented in iSH. Human-readable formatters in `surge_cli.py` are optional; `--raw` is the authoritative Controller response.
