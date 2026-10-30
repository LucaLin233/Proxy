# Surge iOS HTTP API 参考

官方手册：<https://manual.nssurge.com/tools/http-api.html>。需 Surge iOS 4.4.0+；每请求带 `X-Key`；GET 用查询参数、POST 用 JSON 体；响应除注明外为 JSON。

## 引擎状态预检

依赖 Surge 联网的任务（含本回退）先按 [../SKILL.md](../SKILL.md) §2 预检。HTTP 特有判读：API 能响应不等于引擎在正常处理流量；Suspend 时内层 `$httpClient` 探针可能返回 `EOF`/超时，意外 EOF/超时后重新预检，不沿用历史状态。

## iOS 端点

**Features**：`GET|POST /v1/features/{mitm,capture,rewrite,scripting}`（mitm 返回 `{"enabled":true}`）

**Outbound 与策略**：`GET|POST /v1/outbound`（`direct`/`proxy`/`rule`）、`/v1/outbound/global`（`{"policy":"ProxyA"}`）、`GET /v1/policies`、`/v1/policies/detail?policy_name=…`、`POST /v1/policies/test`（`{"policy_names":[…],"url":"http://bing.com"}`）、`GET /v1/policy_groups`、`/v1/policy_groups/test_results`、`/v1/policy_groups/select?group_name=…`、`POST /v1/policy_groups/select`（`{"group_name":…,"policy":…}`）、`POST /v1/policy_groups/test`（`{"group_name":…}`）

**请求**：`GET /v1/requests/recent`、`/v1/requests/active`、`POST /v1/requests/kill`（`{"id":100}`）

**Profile／DNS／模块**：`GET /v1/profiles/current?sensitive=0`、`POST /v1/profiles/reload`、`POST /v1/dns/flush`、`GET /v1/dns`、`POST /v1/test/dns_delay`、`GET /v1/modules`、`POST /v1/modules`（module 名到布尔值）

**脚本**：`GET /v1/scripting`、`POST /v1/scripting/evaluate`（`script_text`、`mock_type`、`timeout`）、`POST /v1/scripting/cron/evaluate`（`{"script_name":"script1"}`）

**其他**：`POST /v1/stop`、`GET /v1/events`、`/v1/rules`、`/v1/traffic`、`POST /v1/log/level`（`{"level":"verbose"}`）、`GET /v1/mitm/ca`（DER 证书，非 JSON）

**macOS-only，iOS Skill 不用**：`system_proxy`、`enhanced_mode`、profile 列出/切换/检查、设备管理相关端点。

## 用 `policy-descriptor` 测未配置节点

`POST /v1/policies/test` 只接受已配置策略名。要不动 Profile 探新节点，可执行一个 cron 脚本，其 `$httpClient` 请求带一条完整 Surge 策略行作 `policy-descriptor`（**优先于** `policy`）。

用自带助手；描述符含密码/PSK，默认形式经 stdin 送一行（`--descriptor-file -`），不落盘、不进 shell history、不写入 Profile：

```sh
python3 /var/minis/skills/luno-surge/scripts/test_policy_descriptor.py \
  --descriptor-file - --url http://checkip.amazonaws.com
```

描述符仅引用任务已授权且执行环境已注入的指定变量，经 stdin 送入；缺失即停，不接受聊天粘贴作秘密来源，不读凭据文件、不落盘。`--descriptor-file <path>` 是脚本能力，不是助手获准的来源。

助手只从 `SURGE_API_KEY` 读 key，调 `/v1/scripting/evaluate`，报告探针状态、响应体、延迟与错误且**不打印描述符**。指向用户指定的活动 Mac/iOS 实例用 `SURGE_HTTP_API_BASE=http://<trusted-host>:6171`，不静默换主机。明文 HTTP 会把 API key 与描述符暴露到网络，远程使用限可信局域网或改 HTTPS。解释探针失败前先套用上节预检——Suspend 是通用网络诊断考量，非 `policy-descriptor` 专属限制。

## Metrics（iOS 5.22.0+）

`GET /v1/metrics` 是 Prometheus 文本输出，**不是 JSON**，仍需 `X-Key`；用助手避免在 curl 命令里打印 key：

```sh
python3 /var/minis/skills/luno-surge/scripts/surge_ios.py metrics
```

历史观察：正式版 iOS 5.22.0 build 3830 曾验证暴露 build 信息、uptime、内存、活动请求/DNS 缓存/封禁计量与按接口/策略流量计数器（2026-09-02 记录，非当前版本声明）。官方手册确认 HTTP Controller 路由是 `/v1/metrics`，裸 `/metrics` 不是 API 路由；流量计数器在引擎重启时归零，PromQL `rate()`／`increase()` 可处理重置；Prometheus 通常无法加 `X-Key`，实际抓取可用 `x-key` 查询参数传递——该 key 不得进入聊天、日志或共享配置。

本参考曾于 2026-09-02 对照官方手册与 iOS 5.22.0 build 3830 刷新（历史记录）；增改端点前先查官方 URL。
