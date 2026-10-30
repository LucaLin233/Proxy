#!/usr/bin/env python3
"""Test one temporary Surge policy descriptor without changing the profile."""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

# 脚本可能被 install.sh 以符号链接落到 PATH，故用 realpath 解析同级共享模块所在目录。
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _privacy import api_base_problem, dumps_redacted, redact_boundary  # noqa: E402


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """不跟随 3xx：默认 urlopen 会把 X-Key 原样转发到重定向目标（跨源泄漏认证头）。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _RedactingParser(argparse.ArgumentParser):
    """`error()` 先过输出边界再写 stderr。

    `--timeout password=<值>` 这类入参错误由 `argparse` 拼进消息，原样输出会把凭据值写进
    stderr；覆写 `error()` 使**所有**用法/取值错误同口径脱敏。
    """

    def error(self, message):
        super().error(redact_boundary(str(message)))


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
    p = _RedactingParser(
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
    # 与 HTTP 回退同口径的远端门禁：scheme／URL userinfo／非本机主机（须 SURGE_ALLOW_REMOTE=1）。
    # `--api-base` 此前只做 `rstrip`，与 `surge_ios.py` 的 `validate_base()` 不一致，
    # 会让探测脚本把 X-Key 与节点描述符发到未显式放行的远端。
    problem = api_base_problem(args.api_base, "--api-base", "SURGE_ALLOW_REMOTE")
    if problem:
        p.error(problem)

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
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=args.timeout + 8) as response:
            payload = json.loads(response.read())
            result = payload.get("result", payload)
            output = {
                "node": name,
                "http_api_status": response.status,
                "result": result,
            }
            print(dumps_redacted(output, indent=2))
            failed = result.get("error") or not 200 <= int(result.get("status", 0)) < 400
            return 1 if failed else 0
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        print(dumps_redacted({"node": name, "http_error": e.code, "detail": detail}))
    except Exception as e:
        print(dumps_redacted({"node": name, "request_error": str(e)}))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
