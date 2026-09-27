# Surge iOS HTTP API Reference

Official manual: <https://manual.nssurge.com/tools/http-api.html>

Requires Surge iOS 4.4.0+. Send `X-Key` on every request. GET uses query parameters; POST uses a JSON body; responses are JSON unless noted.

## Engine-state preflight

依赖 Surge 联网的任务（含本 HTTP API 回退）先按入口做引擎状态预检，见 [../SKILL.md](../SKILL.md) §2；不在此重复。HTTP 特有判读：HTTP API 能响应不等于引擎在正常处理流量，Suspend 时内层 `$httpClient` 探针可能返回 `EOF`/超时；意外 EOF/超时后重新预检，不沿用历史状态。

## iOS endpoints

### Features
- `GET|POST /v1/features/mitm` — `{ "enabled": true }`
- `GET|POST /v1/features/capture`
- `GET|POST /v1/features/rewrite`
- `GET|POST /v1/features/scripting`

### Outbound and policies
- `GET|POST /v1/outbound` — modes: `direct`, `proxy`, `rule`
- `GET|POST /v1/outbound/global` — `{ "policy": "ProxyA" }`
- `GET /v1/policies`
- `GET /v1/policies/detail?policy_name=...`
- `POST /v1/policies/test` — `{ "policy_names": [...], "url": "http://bing.com" }`
- `GET /v1/policy_groups`
- `GET /v1/policy_groups/test_results`
- `GET /v1/policy_groups/select?group_name=...`
- `POST /v1/policy_groups/select` — `{ "group_name": "GroupA", "policy": "ProxyA" }`
- `POST /v1/policy_groups/test` — `{ "group_name": "GroupA" }`

### Requests
- `GET /v1/requests/recent`
- `GET /v1/requests/active`
- `POST /v1/requests/kill` — `{ "id": 100 }`

### Profile, DNS, and modules
- `GET /v1/profiles/current?sensitive=0`
- `POST /v1/profiles/reload`
- `POST /v1/dns/flush`
- `GET /v1/dns`
- `POST /v1/test/dns_delay`
- `GET /v1/modules`
- `POST /v1/modules` — module-name-to-boolean map

### Scripting
- `GET /v1/scripting`
- `POST /v1/scripting/evaluate` — `script_text`, `mock_type`, `timeout`
- `POST /v1/scripting/cron/evaluate` — `{ "script_name": "script1" }`

### Test an unconfigured node with `policy-descriptor`

`POST /v1/policies/test` only accepts configured policy names. To probe a new node without editing or reloading the Profile, evaluate a cron script whose `$httpClient` request includes a complete Surge policy line as `policy-descriptor`. This option takes precedence over `policy`.

Use the bundled helper. The descriptor contains passwords/PSKs, so the default form feeds one line through stdin (`--descriptor-file -`); nothing is written to disk, to the shell history, or to the Profile:

```sh
# 默认形式：stdin 提供一行描述符，不落盘、不进 shell history、不写入配置。
python3 /var/minis/skills/surge/scripts/test_policy_descriptor.py \
  --descriptor-file - \
  --url http://checkip.amazonaws.com
```

That one line must come from a source the caller is already authorized to use (for example a user pasting into the terminal, or a controlled secret injection). This reference neither defines nor requires such a source, and the helper must not be pointed at a path of a file that already holds the descriptor.

File form (exception, not a default step): only when the caller already owns a descriptor file that it created and is authorized to use may `--descriptor-file <path>` or shell redirection be used. In that case the file must stay in the caller's own controlled directory with mode `0600`, and **its owner — the caller, not this skill and not the assistant — is responsible for deleting it after use**. Creating, copying, or retaining a secret file is never a default step; do not treat "write a file under `/tmp`, then delete it" as the normal flow.

The helper reads the API key only from `SURGE_API_KEY`, calls `/v1/scripting/evaluate`, and reports the probe status, response body, latency, and error without printing the descriptor. To use a user-specified active Mac/iOS Surge instance, set `SURGE_HTTP_API_BASE=http://<trusted-host>:6171`; do not silently switch to another host. Plain HTTP exposes the API key and the node descriptor to the network, so remote use must be limited to a trusted LAN or replaced with HTTPS where available.

Apply the engine-state preflight above before interpreting `$httpClient` probe failures; Suspend is a general networking diagnostic consideration, not a `policy-descriptor`-specific limitation.

### Metrics (iOS 5.22.0+)
- `GET /v1/metrics` — Prometheus text exposition; it is not JSON and still requires the `X-Key` header.

Use the helper instead of printing the API key in a curl command:

```sh
python3 /var/minis/skills/surge/scripts/surge_ios.py metrics
```

Historical observation: the formal iOS 5.22.0 build 3830 was verified to expose build info, uptime, memory, active request/DNS-cache/ban gauges, and per-interface/per-policy traffic counters (2026-09-02 record, not a current-version claim). The official manual confirms the HTTP Controller route is `/v1/metrics`; bare `/metrics` is not an API route.

The official manual notes that traffic counters reset when the engine restarts; PromQL `rate()` and `increase()` handle counter resets. Prometheus cannot normally add `X-Key`, so an actual scrape configuration may pass the API key as the `x-key` query parameter. Do not place that key in chat, logs, or a shared config file.

### Miscellaneous
- `POST /v1/stop`
- `GET /v1/events`
- `GET /v1/rules`
- `GET /v1/traffic`
- `POST /v1/log/level` — `{ "level": "verbose" }`
- `GET /v1/mitm/ca` — DER certificate, not JSON

## Excluded macOS-only endpoints

Do not use these for this iOS Skill: `system_proxy`, `enhanced_mode`, profile listing/switch/check, and device management endpoints documented as Mac Only.

This reference was refreshed against the official manual and Surge iOS 5.22.0 build 3830 on 2026-09-02 (historical record). Consult the official URL before adding or changing endpoints.
