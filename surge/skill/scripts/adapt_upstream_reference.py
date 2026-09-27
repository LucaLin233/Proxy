#!/usr/bin/env python3
"""Apply Minis transport notes to an upstream Surge command reference.

Two distinct paths:

* official raw text (sha256 in REVIEWED_SHA256) -> the §1 adaptation block is
  applied; this is the only input the update transaction may import;
* an already-adapted product (sha256 in ADAPTED_SHA256) -> independent idempotent
  path: running this script on such a file is a no-op normalization, never a new
  official import. The update transaction rejects those inputs fail-closed.

Importable: `import`ing this module must not execute anything; the hash sets and
`adapt_text()` are the API used by `scripts/update_upstream.py`.
"""
from pathlib import Path
import sys

import hashlib

# Reviewed official baselines: raw, unadapted official text only. An unknown
# upstream revision requires reviewing the raw diff and updating this set; never
# silently discard new CLI options.
REVIEWED_SHA256 = {
    '66f0b248fa7f696ea5f9b8511729f6c82a25c3bee23a6f5305ce4bdf6b64df4b',
}

# Already-adapted products are NOT official raw text and must never be added to
# REVIEWED_SHA256. They are recognized here only so that re-running the adapter on
# an installed adaptation is an idempotent no-op instead of a false
# "unreviewed upstream reference" failure. This set is the marker the update
# transaction uses to refuse an adapted product as an official import.
ADAPTED_SHA256 = {
    # Provided/installed adapted products, oldest first.
    '5331f03b90a1d6b21e406057b48364499b7b7a43697f566746e1ec6a0170c51f',
    '334747c73b439f65533846c0b27636948cf5a64900a71e90d7bda495559018c3',
    # Superseded shipped products: the adapter regenerates the current §1 preface
    # (including the §1.2 execution-priority block) from these.
    '515303de1d9b925fe77fe8d3a8abf6fc24a4b42e01488e59baef0a5bb98c7901',
    # Current shipped product: the adapter is a byte-identical no-op on it.
    'd3163362737811035c5e32df531630abd1913998cdfcdad554235329007234fe',
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

执行前查 [platform-compatibility.md](platform-compatibility.md) 的唯一协议门槛表（`rule`/`dns`/`http probe`/`security ban`、`geoip` 与性能/规则使用/虚拟 IP dump、`vmnet`、`plugin`、`restart-engine` 的最低协议与平台限制）；不满足或未知时不得直接执行，本文件不复述第二份表。`surge-cli --raw version` 可读当前平台与 Controller Protocol；历史验证结论与日期同样只在该表维护。

**兼容性表是执行判据**：本文件 §2 起官方正文中出现的协议号或版本语句（例如 §3.0 标题的 `controller protocol ≥24`）是上游历史文字，仅作说明，不作为执行判据；门槛与平台限制一律以该表为准。

### 1.2 Minis execution priority over the upstream recommendations

**本地执行优先级**：本节（§1 前言）优先于本文件 §2 起官方正文中的**操作建议**；`SKILL.md` 的引擎状态预检、`--raw` 优先与最小读取边界，以及 [diagnostics.md](diagnostics.md) 的按需工作流是本地执行判据。官方 §5「Practical Recommendations for AI Agents」中与本节直接冲突的两条建议一律按本节执行：

1. **默认输出形式以 `--raw` 为准。** §5 建议「默认用 rendered 输出，除文档中缺失字段外不要传 `--raw`」在本客户端不适用：`--raw` 是 Controller 原始响应，也是自动化判读与验证的依据；human-readable 格式化只是可选呈现。
2. **修改前不默认收集 `dump policy`／`dump profile`，一律按需。** §5 建议「每次修改设置前同时收集 `environment`、`dump policy` 与 `dump profile`」不采用：仅在当前任务确实需要策略组／`lineHash` 或 profile 内容时才读取，不作为每次修改的前置步骤或基线。其中 `dump profile` 可能含节点、订阅 URL 与隐私数据，**仅在确有必要时读取，并遵守最小读取边界**（只取所需字段、脱敏后引用、不写入支持包）。

本节只覆盖官方正文中的**操作建议**；官方 §2 起的历史命令语义与协议号／版本说明仍按既有口径处理（即上一段：仅作说明，不作执行判据），§2 起的正文文字保持原样，本文件不复述第二份协议表。

### 1.3 Basic format

```bash
surge-cli [--remote host:port] [--password-stdin] [--raw] <command> [args...]
```

Executable location in Minis:

```bash
/usr/local/bin/surge-cli
```

- `--raw`: output raw JSON (recommended for agents).
- `--remote` / `-r`: connect to another Controller; the Minis default is `127.0.0.1:6170`.
- Authentication comes from `--password-stdin` or the Minis environment variable `SURGE_API_KEY`; the Minis implementation is non-interactive and never prompts. Never put the password in `--remote`; the Minis CLI does not use password files. Credential precedence and transport: [controller-cli.md](controller-cli.md); security rules: [../SKILL.md](../SKILL.md) §3.
- `--check <path>` / `-c <path>`: upload the explicitly named UTF-8 profile to Surge's official beta validation service (`https://services.nssurge.com/v1/config/validate`). This is remote validation, not the bundled macOS local parser. The CLI never uploads the active profile automatically; warn about profile secrets and redact a copy first when appropriate.
- `--help` / `-h`: print help.
- If no command is provided, the Minis implementation prints help rather than entering an interactive terminal.
- Command keywords are handled by the connected Controller.

'''

ENVELOPE_MARKERS = ("### 1.2 Response envelope", "### 1.3 Response envelope",
                    "### 1.4 Response envelope")


def adapt_text(text):
    """Return `text` with the Minis §1 adaptation applied (official body untouched)."""
    start = text.index("## 1. CLI Usage")
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

    # The upstream baseline includes a full profile dump, which may expose proxy
    # addresses or subscription URLs. Keep it opt-in in the Minis reference.
    text = text.replace(
        "Before mutating settings, collect context with `environment`, `dump policy`, and `dump profile`.",
        "Before mutating settings, collect context with `status`, `environment`, and `dump policy`. Run `dump profile` only when necessary and treat its output as sensitive.",
    )
    # `<nil>` must stay shell-quoted, otherwise the shell eats it as redirection.
    text = text.replace(
        'surge-cli set AutoPolicyGroupOverride.Streaming=<nil>',
        "surge-cli set 'AutoPolicyGroupOverride.Streaming=<nil>'",
    )
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
    if kind == 'adapted':
        # Independent idempotent path: an already-adapted product is normalized in
        # place and is never recorded as new official raw text.
        pass
    text = adapt_text(raw.decode('utf-8'))
    path.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    main()
