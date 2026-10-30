#!/usr/bin/env python3
"""Apply Minis transport notes to an upstream Surge command reference.

Two distinct paths:

* official raw text (sha256 in REVIEWED_SHA256) -> the §1 adaptation block is
  applied; this is the only input the update transaction may import;
* an already-adapted product (sha256 in ADAPTED_SHA256) -> independent idempotent
  path: running this script on the **current** product is a byte-identical no-op;
  an older product is normalized forward to the current §1 preface and rewrites.
  Either way it is never a new official import — the update transaction rejects
  those inputs fail-closed.

Importable: `import`ing this module must not execute anything; the hash sets and
`adapt_text()` are the API used by `scripts/update_upstream.py`.
"""
from pathlib import Path
import sys

import hashlib
import re

# Reviewed official baselines: raw, unadapted official text only. An unknown
# upstream revision requires reviewing the raw diff and updating this set; never
# silently discard new CLI options.
REVIEWED_SHA256 = {
    # Surge for macOS 6.9.0 (12250), reviewed 2026-09-02.
    '66f0b248fa7f696ea5f9b8511729f6c82a25c3bee23a6f5305ce4bdf6b64df4b',
    # Surge for macOS 6.10.0 (12480), reviewed 2026-10-11: new `lsp` command in
    # §1.1; the §2 tables change `proxy-runtime-status` to accept a policy name and
    # state that `dump policy` no longer prints the line-hash; `test-policy-udp`
    # gains a note about peer-to-peer Tailscale/WireGuard policies. Every
    # adaptation target below was re-checked against this revision.
    '42a0509642641dfc9cf70001997a26c4241f9d72df5c136141d763c695cd51ea',
}

# Already-adapted products are NOT official raw text and must never be added to
# REVIEWED_SHA256. They are recognized so that re-running the adapter takes the
# normalization path for an installed adaptation instead of failing with a false
# "unreviewed upstream reference": only the **current** product is byte-identical,
# older ones normalize forward (and their normalization outputs are listed here too).
# This set is the marker the update transaction uses to refuse an adapted product as
# an official import.
ADAPTED_SHA256 = {
    # Provided/installed adapted products, oldest first.
    '5331f03b90a1d6b21e406057b48364499b7b7a43697f566746e1ec6a0170c51f',
    '334747c73b439f65533846c0b27636948cf5a64900a71e90d7bda495559018c3',
    # Superseded shipped products: the adapter regenerates the current §1 preface
    # (including the §1.2 execution-priority block) from these.
    '515303de1d9b925fe77fe8d3a8abf6fc24a4b42e01488e59baef0a5bb98c7901',
    # Previously shipped product, kept so a stale installed adaptation is still
    # classified as adapted (not as an "unreviewed upstream reference"); re-running
    # the adapter on it regenerates the trimmed 2026-10-11 §1 block.
    'd3163362737811035c5e32df531630abd1913998cdfcdad554235329007234fe',
    # Superseded shipped product (2026-10-11 §1 trim, pre-6.10.0): kept so a stale
    # installed adaptation is never mistaken for unreviewed raw text. Re-running the
    # adapter on it is **not** a byte-identical no-op — it upgrades three things: the §1
    # preface (adds the `lsp` bullet, rewords §1.2), the envelope heading number, and the
    # §5 profile-collection sentence that this revision now rewrites.
    '5538a3ed0b010a958f4ca4ceb6d5700a152837429445a41a1d04cd9ccfe298b4',
    # 6.10.0-sync product as first produced in this session (superseded by the wording fix
    # that follows; never deployed). Kept so the entry can regenerate it in place.
    '34309dfb3c4e1129afdfb13ca4dfe4afbd76057546f69100eb3c5829ba855167',
    # Normalization output of the pre-6.10.0 deployed product (`5538a3ed…`): current §1
    # preface and rewrites on top of the older upstream body. Registered so that running
    # the entry twice on an installed older product stays possible — the first run
    # normalizes, the second must be a no-op (2026-10-11 first-review F2: an unregistered
    # normalization output made the second run refuse the file it had just written).
    '1085f42a12ffdff913ea6c817c5efa6308bace52cd5808faa82c1f84d6d89fba',
    # 2026-10-11 产物，2026-10-21 措辞修复后被取代；保留以便已装旧产物归一化前进。
    '48a99818a4c55698628542da447b45be05ec503872ac578c080621cfe8d77b9f',
    # 2026-10-21 shipped product（--raw 措辞修复：客户端脱敏、非服务端原文）；对它是逐字节 no-op。
    '8fd1defde65d83662f193d872e94af4c9afdc3a94be0c7ab3796444b68f32721',
}

# Section 1.1 keeps a single pointer to the platform/protocol table instead of a
# second copy of it; the new 1.2 block states the local execution priority that
# overrides the upstream §5 recommendations (--raw by default; no default
# `dump policy`/`dump profile` collection, sensitive `dump profile` on demand only);
# the basic-format block follows the new package and carries the non-interactive
# Minis credential wording.
REPLACEMENT = '''## 1. CLI Usage

> Minis adaptation: this command catalog is synchronized from the Surge-bundled Skill. In Minis, `/usr/local/bin/surge-cli` connects directly to Surge iOS External Controller. Use this section's adapted invocation rules; the remaining command semantics are upstream documentation and platform restrictions still apply.

### 1.1 Controller protocol requirements

执行前查 [platform-compatibility.md](platform-compatibility.md) 的唯一协议门槛表（`rule`/`dns`/`http probe`/`security ban`、`geoip` 与性能/规则使用/虚拟 IP dump、`vmnet`、`plugin`、`restart-engine` 的最低协议与平台限制）；不满足或未知时不得执行，本文件不复述第二份表。`surge-cli --raw version` 可读当前平台与 Controller Protocol。**该表是执行判据**：本文件 §2 起官方正文中出现的协议号或版本语句（例如 §3.0 标题的 `controller protocol ≥24`）是上游历史文字，仅作说明。

### 1.2 Minis execution priority over the upstream recommendations

本节（§1 前言）优先于 §2 起官方正文中的**操作建议**；`SKILL.md` 的引擎状态预检、`--raw` 优先与最小读取边界，以及 [diagnostics.md](diagnostics.md) 的按需工作流是本地执行判据。官方 §5「Practical Recommendations for AI Agents」中与本节直接冲突的两条一律按本节执行：

1. **默认输出形式以 `--raw` 为准**：§5 建议「默认用 rendered 输出、除缺失字段外不要传 `--raw`」在本客户端不适用——`--raw` 是自动化判读的结构化输出依据，内容经客户端脱敏、**不是服务端原文**，human-readable 只是可选呈现。
2. **修改前不默认收集 `dump policy`／`dump profile`，一律按需**：§5 建议「修改设置前同时收集 `environment`、`dump policy` 与 `dump profile`」不采用——仅在任务确实需要策略组、代理运行时状态或 profile 内容时读取（`dump policy` 给策略名，`line-hash` 要从 `policy-group list`／`dump policy-group-sub-policies` 取）。`dump profile` 可能含节点、订阅 URL 与隐私数据，**仅在确有必要时按最小读取边界读取**（只取所需字段、脱敏引用、不写入支持包）。

§2 起正文除 §4 的 `<nil>` 示例加引号与 §5 的一处按需收集改写外保持官方原样；本节只覆盖其中的操作建议，历史命令语义与协议号仍仅作说明。

### 1.3 Basic format

```bash
surge-cli [--remote host:port] [--password-stdin] [--raw] <command> [args...]
```

- 可执行位置：`/usr/local/bin/surge-cli`。
- `--raw`：输出结构化 JSON（agent 推荐）；内容经客户端脱敏，非服务端原文。
- `--remote`／`-r`：连其他 Controller；Minis 默认 `127.0.0.1:6170`。
- 认证取 `--password-stdin` 或 Minis 环境变量 `SURGE_API_KEY`；Minis 实现非交互、从不提示，不用密码文件，不把密码放进 `--remote`。凭据优先级与传输见 [controller-cli.md](controller-cli.md)；安全规则见 [../SKILL.md](../SKILL.md) §3。
- `--check <path>`／`-c <path>`：把显式指定的 UTF-8 profile 上传到官方 beta 校验服务（`https://services.nssurge.com/v1/config/validate`），是远程校验、非自带 macOS 本地解析器；CLI 绝不自动上传活动 profile，必要时先脱敏副本。
- `lsp [--stdio]`（官方 6.10.0+）：编辑器用的**离线** stdio 语言服务器——本客户端不实现，也不得当作 Controller 命令转发；它需要真正的 LSP 客户端，不能当一次性校验命令（一次性校验用 `--check`），不与 `--remote`／认证参数同用。官方 VS Code 扩展 Surge Language Support 需 Surge Mac 6.10.0+，与 iOS 端无关。
- `--help`／`-h`：打印帮助；无命令时打印帮助而非进入交互终端。
- 命令关键字由所连 Controller 处理。

'''

ENVELOPE_MARKERS = ("### 1.2 Response envelope", "### 1.3 Response envelope",
                    "### 1.4 Response envelope")

# Upstream §5 tells agents to collect `dump profile` before every mutation; the local
# reference keeps that opt-in. The upstream wording wraps across lines and has changed
# wording once already, so the target is matched on a whitespace-tolerant pattern and a
# miss is a hard error - a silent no-op would leave the upstream recommendation in the
# shipped reference while §1.2 claims the opposite.
RAW_PROFILE_SENTENCE = re.compile(
    r'before\s+mutating settings, also collect relevant context with\s+'
    r'`environment`,\s+`dump policy`, and\s+`dump profile`\.')
PROFILE_SENTENCE_ADAPTED = (
    'before\n'
    '   mutating settings, also collect context with `status`, `environment`, and\n'
    '   `dump policy`; run `dump profile` only when necessary and treat its output\n'
    '   as sensitive.')
# `<nil>` must stay shell-quoted, otherwise the shell eats it as redirection.
NIL_UNQUOTED = 'surge-cli set AutoPolicyGroupOverride.Streaming=<nil>'
NIL_QUOTED = "surge-cli set 'AutoPolicyGroupOverride.Streaming=<nil>'"
LSP_MARKER = '`lsp [--stdio]`'


def _adapt_pair(text, raw_pattern, adapted_text, label):
    """Enforce the per-target contract: exactly one of the two forms, never both.

    Accepts `(raw=1, adapted=0)` -> rewrite, or `(raw=0, adapted=1)` -> already adapted.
    Every other combination is an error: a text that carries the upstream wording *and*
    the adapted wording, neither of them, or a duplicate of either is not a clean official
    raw text nor a clean product. Existence-only checks would let a mixed input through
    with the upstream wording surviving.
    """
    raw_hits = len(re.findall(raw_pattern, text))
    adapted_hits = text.count(adapted_text)
    if (raw_hits, adapted_hits) not in ((1, 0), (0, 1)):
        raise SystemExit(
            'Adaptation target ' + label + ': expected exactly one form (raw=1/adapted=0 or '
            'raw=0/adapted=1), found raw=' + str(raw_hits) + ' adapted=' + str(adapted_hits)
            + '. Review the input and update the adapter before staging; nothing was written.')
    if raw_hits == 0:
        return text
    return re.sub(raw_pattern, lambda _m: adapted_text, text, count=1)


def adapt_text(text):
    """Return `text` with the Minis adaptation applied.

    Official text is preserved except: the §1 block (replaced by the local preface), the
    response-envelope heading number, and the two documented rewrites (the §4 `<nil>`
    example quoting, the §5 profile-collection sentence).

    Idempotent on the **current** product (byte-identical). An **older** adapted product is
    normalized forward to the current §1 preface and rewrites, so it may change — and
    `main()` refuses to write that normalization unless the result is itself a recognized
    product, rather than leaving an unclassifiable file behind. Every target must be either
    already applied or match exactly once, so a changed upstream wording fails loudly
    instead of leaving upstream guidance in place unreported.
    """
    try:
        start = text.index("## 1. CLI Usage")
    except ValueError:
        raise SystemExit('Cannot locate the §1 CLI Usage section in the command reference')
    end = -1
    for marker in ENVELOPE_MARKERS:
        try:
            end = text.index(marker, start)
            break
        except ValueError:
            pass
    if end < 0:
        raise SystemExit('Cannot locate the response-envelope section in the command reference')
    text = text[:start] + REPLACEMENT + text[end:]
    # The response-envelope heading follows the basic-format section, which now sits
    # after the §1.1 protocol block and the §1.2 execution-priority block, so it is 1.4.
    text = text.replace('### 1.2 Response envelope', '### 1.4 Response envelope')
    text = text.replace('### 1.3 Response envelope', '### 1.4 Response envelope')

    text = _adapt_pair(text, RAW_PROFILE_SENTENCE, PROFILE_SENTENCE_ADAPTED,
                       'upstream §5 profile-collection sentence')
    text = _adapt_pair(text, re.escape(NIL_UNQUOTED), NIL_QUOTED, 'upstream <nil> example')

    # Post-conditions hold on both the raw and the already-adapted path: every target ends
    # up in exactly the adapted form, and no upstream form may survive.
    if text.count('### 1.4 Response envelope') != 1:
        raise SystemExit('Post-condition failed: expected exactly one "### 1.4 Response envelope" heading')
    if re.search(RAW_PROFILE_SENTENCE, text):
        raise SystemExit('Post-condition failed: the upstream §5 sentence survived')
    for label, needle, expected in (('the §1.3 lsp bullet', LSP_MARKER, 1),
                                    ('the rewritten §5 sentence', PROFILE_SENTENCE_ADAPTED, 1),
                                    ('the quoted <nil> example', NIL_QUOTED, 1),
                                    ('the unquoted <nil> example', NIL_UNQUOTED, 0)):
        count = text.count(needle)
        if count != expected:
            raise SystemExit('Post-condition failed: ' + label + ' occurs ' + str(count)
                             + ' time(s), expected ' + str(expected))
    return text


def classify(digest):
    """Return 'raw', 'adapted' or 'unknown' for a sha256 hex digest."""
    if digest in ADAPTED_SHA256:
        return 'adapted'
    if digest in REVIEWED_SHA256:
        return 'raw'
    return 'unknown'


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        raise SystemExit('usage: adapt_upstream_reference.py <command-reference.md>')
    path = Path(argv[0])
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    kind = classify(digest)
    if kind == 'unknown':
        raise SystemExit('Unreviewed upstream reference: inspect raw diff and update reviewed baseline before adaptation')
    text = adapt_text(raw.decode('utf-8'))
    out = text.encode('utf-8')
    if kind == 'adapted' and out != raw:
        # Normalizing an older product must land on a recognized product. Writing a state
        # this entry itself rejects leaves the installed reference unusable on the next run
        # (observed 2026-10-11; fixed by registering the normalization output).
        new_digest = hashlib.sha256(out).hexdigest()
        if classify(new_digest) == 'unknown':
            raise SystemExit(
                'Refusing to write an unclassified state: normalizing ' + str(path) + ' would produce\n'
                'sha256=' + new_digest + ', which is neither a known adapted product nor official raw\n'
                'text. Review it and register that hash in ADAPTED_SHA256 first; the file is unchanged.')
    if out != raw:
        path.write_bytes(out)


if __name__ == '__main__':
    main()
