#!/usr/bin/env python3
"""Test one temporary Surge policy descriptor without changing the profile."""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request


def redact(text):
    """抹掉文本中的凭据值：认证字段、JSON/引号形式（含转义、单引号键、平面数组）、裸键值、token 前缀。"""
    text = str(text)
    auth = r"(?:authorization|proxy-authorization|auth|authz)"
    scheme = r"(?:bearer|basic|digest|negotiate|ntlm|aws4-hmac-sha256)"
    key = (r"(?:password|passwd|pwd|psk|username|user|private[-_]key|token|api[-_]?key"
           r"|x[-_]key|secret|credential)")
    dq = r'"(?:[^"\\]|\\.)*"'
    sq = r"'(?:[^'\\]|\\.)*'"
    # 1a) 认证字段的引号值（JSON/结构化形态；键与值之间允许换行缩进，覆盖多行 JSON）。
    #     双引号值与单引号值**分别**按各自引号的转义规则匹配——用一种引号的字符类排他，
    #     会让「双引号值里含单引号」这种合法 JSON 整个漏抹。
    text = re.sub(r'(?i)(?P<qk>["\']?)\b(?P<ak>' + auth + r')\b(?P=qk)'
                  r'(?P<sep>\s*[:=]\s*)(?P<val>' + dq + r'|' + sq + r')',
                  lambda m: '%s%s%s%s%s<redacted>%s' % (m.group('qk'), m.group('ak'), m.group('qk'),
                                                        m.group('sep'), m.group('val')[0], m.group('val')[0]),
                  text)
    # 1b) 认证字段带方案词（Bearer/Basic/Digest/...）→ 取该字段整行值，覆盖逗号多段与 Digest 参数
    text = re.sub(r'(?i)(?P<qk>["\']?)\b(?P<ak>' + auth + r')\b(?P=qk)'
                  r'(?P<sep>[ \t]*[:=][ \t]*)(?P<val>' + scheme + r'\b[^\n]*)',
                  lambda m: '%s%s%s%s"<redacted>"' % (m.group('qk'), m.group('ak'), m.group('qk'), m.group('sep')),
                  text)
    # 1c) 其余认证字段值：止于逗号/分号/换行/结构闭合符，不吞同一行的普通诊断字段（如 status=502）。
    #     值以抹除标记开头时只保留标记、丢弃其后残余——不能整段原样返回（那会把
    #     `Authorization:"<redacted>" <真实凭据>` 这类「标记 + 真值」原样放行）。
    def _auth_bare(m):
        for mk in ('"<redacted>"', "'<redacted>'"):
            if m.group('val').startswith(mk):
                return '%s%s%s%s%s' % (m.group('qk'), m.group('ak'), m.group('qk'), m.group('sep'), mk)
        return '%s%s%s%s"<redacted>"' % (m.group('qk'), m.group('ak'), m.group('qk'), m.group('sep'))
    text = re.sub(r'(?i)(?P<qk>["\']?)\b(?P<ak>' + auth + r')\b(?P=qk)'
                  r'(?P<sep>[ \t]*[:=][ \t]*)(?P<val>[^\n,;}\]]+)', _auth_bare, text)
    # 2) 敏感键的数组/对象值（如 {"token":["x"]}）：整段值替换
    text = re.sub(r'(?i)(?P<qk>["\']?)\b(?P<k>' + key + r')\b(?P=qk)(?P<sep>\s*:\s*)(\[[^\[\]]*\]|\{[^{}]*\})',
                  lambda m: '%s%s%s%s["<redacted>"]' % (m.group('qk'), m.group('k'), m.group('qk'), m.group('sep')),
                  text)
    # 3) 带引号的值（键可带引号，值支持转义引号）
    text = re.sub(r'(?i)(?P<qk>["\']?)\b(?P<k>' + key + r')\b(?P=qk)(?P<sep>\s*[:=]\s*)(?P<val>' + dq + '|' + sq + r')',
                  lambda m: '%s%s%s%s%s<redacted>%s' % (m.group('qk'), m.group('k'), m.group('qk'),
                                                        m.group('sep'), m.group('val')[0], m.group('val')[0]),
                  text)
    # 4) 裸值：以逗号/分号/空白为界
    text = re.sub(r"(?i)\b(" + key + r")\b\s*[:=]\s*[^\s,;]+", r"\1=<redacted>", text)
    # 5) 已知 token 前缀
    return re.sub(r"(?i)\b(sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}", "<redacted>", text)


def read_descriptor(path: str) -> str:
    if path == "-":
        raw = sys.stdin.read()
    else:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) != 1 or "=" not in lines[0]:
        raise ValueError("descriptor input must contain exactly one non-empty Surge policy line")
    return lines[0]


def main() -> int:
    p = argparse.ArgumentParser(
        description="Use /v1/scripting/evaluate + policy-descriptor to test an unconfigured node."
    )
    p.add_argument("--descriptor-file", default="-", help="one Surge policy line; default: stdin")
    p.add_argument(
        "--api-base",
        default=os.environ.get("SURGE_HTTP_API_BASE", "http://127.0.0.1:6171"),
        help="Surge HTTP API base URL (or set SURGE_HTTP_API_BASE)",
    )
    p.add_argument("--url", default="http://checkip.amazonaws.com", help="HTTP(S) probe URL")
    p.add_argument("--timeout", type=float, default=12, help="probe timeout in seconds")
    args = p.parse_args()

    api_key = os.environ.get("SURGE_API_KEY")
    if not api_key:
        p.error("SURGE_API_KEY is not set")
    if args.timeout <= 0:
        p.error("--timeout must be positive")

    try:
        descriptor = read_descriptor(args.descriptor_file)
    except (OSError, ValueError) as e:
        p.error(str(e))

    name = descriptor.split("=", 1)[0].strip()
    options = {
        "url": args.url,
        "timeout": args.timeout,
        "policy-descriptor": descriptor,
    }
    script = (
        "const started = Date.now();\n"
        f"$httpClient.get({json.dumps(options)}, (error, response, data) => {{\n"
        "  $done({error, status: response && response.status, data, "
        "latency: Date.now() - started});\n"
        "});"
    )
    body = json.dumps(
        {
            "script_text": script,
            "mock_type": "cron",
            "timeout": args.timeout + 3,
        }
    ).encode()
    endpoint = args.api_base.rstrip("/") + "/v1/scripting/evaluate"
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={"X-Key": api_key, "Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=args.timeout + 8) as response:
            payload = json.loads(response.read())
            result = payload.get("result", payload)
            output = {
                "node": name,
                "http_api_status": response.status,
                "result": result,
            }
            print(redact(json.dumps(output, ensure_ascii=False, indent=2)))
            failed = result.get("error") or not 200 <= int(result.get("status", 0)) < 400
            return 1 if failed else 0
    except urllib.error.HTTPError as e:
        detail = redact(e.read().decode("utf-8", "replace"))
        print(json.dumps({"node": name, "http_error": e.code, "detail": detail}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"node": name, "request_error": redact(str(e))}, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
