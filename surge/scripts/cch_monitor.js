/* CCH 面板（多站点）：每个站点可分别使用用户 Key、会话 Cookie 或管理员令牌。
   - user   ：普通用户 Key，走 /api/v1/me/quota，展示总额度与并发 session
   - cookie ：站点只认会话时，用浏览器 auth-token，端点同上
   - admin  ：管理员令牌，走 /api/v1/providers + limit-usage:batch + dashboard/overview，
              展示各供应商限额占用、并发上限与全站调用监控 */

const ARGS = parseArgs($argument || "");
const RAW_ENDPOINTS = String(ARGS.cch_endpoints || "").trim();
const ADMIN_MAX = intArg(ARGS.cch_admin_max, 4, 1, 20);
const QUOTA_CACHE_SECONDS = intArg(ARGS.cch_quota_interval, 300, 60, 3600);
/* 面板一行可容纳的半角宽度，超出部分由 layoutRows 自动换行 */
const PANEL_ROW_WIDTH = intArg(ARGS.cch_row_width, 34, 20, 60);
const PANEL_TITLE = "CCH";
const PANEL_ICON = String(ARGS.cch_icon || "chart.bar.fill").trim() || "chart.bar.fill";
const iconColorRaw = String(ARGS.cch_icon_color || "").trim();
const PANEL_ICON_COLOR = /^[0-9a-fA-F]{6}$/.test(iconColorRaw) ? `#${iconColorRaw}` : "#34C759";
const WARN_ICON_COLOR = "#F59E0B";
const DANGER_ICON_COLOR = "#EF4444";
const ERROR_ICON = "exclamationmark.triangle.fill";
const MAX_SITES = 5;
const MODES = ["user", "cookie", "admin"];
const WINDOWS = [
  ["cost5h", "5 小时"],
  ["costDaily", "日"],
  ["costWeekly", "周"],
  ["costMonthly", "月"],
  ["limitTotalUsd", "总额"],
];

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function parseArgs(input) {
  const output = {};
  for (const pair of String(input).split("&")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const key = safeDecode(pair.slice(0, index)).trim();
    if (key) output[key] = safeDecode(pair.slice(index + 1)).trim();
  }
  return output;
}

/* 参数留空时 Number("") 为 0，会静默把上限压成最小值，故空值按未配置处理 */
function intArg(value, fallback, min, max) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (text === "") return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeBaseUrl(value) {
  let base = String(value || "").trim();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base.replace(/\/+$/, "");
}

/* null 与 0 必须区分：未返回的字段不能当成 0 展示或判断 */
function numeric(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function num(value) {
  const parsed = numeric(value);
  return parsed === null ? 0 : parsed;
}

/* 站点写法：名称@地址=凭据[:模式]，多个站点用竖线分隔；模式省略即 user */
function parseEndpoints(input) {
  const list = [];
  for (const chunk of String(input).split("|")) {
    const item = chunk.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    if (eq < 0) continue;
    const left = item.slice(0, eq).trim();
    let right = item.slice(eq + 1).trim();
    if (!left || !right) continue;
    let mode = "user";
    const colon = right.lastIndexOf(":");
    if (colon > 0) {
      /* 容错：模式写成 :admin，也接受文档里表示可选的方括号（[:admin]、:admin]） */
      const suffix = right.slice(colon + 1).replace(/[\s\[\]]/g, "").toLowerCase();
      if (MODES.indexOf(suffix) >= 0) {
        mode = suffix;
        right = right.slice(0, colon).replace(/[\s\[\]]+$/, "");
      }
    }
    if (!right) continue;
    const at = left.indexOf("@");
    const label = at >= 0 ? left.slice(0, at).trim() : "";
    const host = at >= 0 ? left.slice(at + 1).trim() : left;
    const base = normalizeBaseUrl(host);
    if (!base) continue;
    list.push({ name: label || host, base, credential: right, mode });
  }
  return list;
}

/* 兼容旧的单站点参数 cch_url / cch_api_key / cch_auth */
function legacySite() {
  const base = normalizeBaseUrl(ARGS.cch_url);
  const credential = String(ARGS.cch_api_key || "").trim();
  if (!base || !credential) return null;
  const raw = String(ARGS.cch_auth || "api_key").trim().toLowerCase();
  const mode = raw === "cookie" ? "cookie" : raw === "admin" ? "admin" : "user";
  return { name: base.replace(/^https?:\/\//i, ""), base, credential, mode };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const options = { url, headers, timeout: 15000 };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    $httpClient[method](options, (error, response, data) => {
      if (error) return reject(new Error(String(error)));
      resolve({ status: Number((response && response.status) || 0), body: data });
    });
  });
}

/* 取出 CCH problem+json 里的 errorCode，便于区分“没带凭据”与“凭据无效” */
function problemCode(body) {
  try {
    const json = JSON.parse(body);
    return json && json.errorCode ? `（${json.errorCode}）` : "";
  } catch (_) { return ""; }
}

function checkStatus(response, label) {
  if (response.status === 401) throw new Error(`${label}被拒${problemCode(response.body)}`);
  if (response.status === 403) throw new Error("无权限，请检查令牌权限");
  if (response.status === 404) throw new Error("接口不存在，请检查地址与版本");
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  return response;
}

function parseBody(response) {
  try { return JSON.parse(response.body); }
  catch (_) { throw new Error("API 响应解析失败"); }
}

/* 返回值可能是 {data:{...}} 包装或直接对象 */
function unwrap(json) {
  if (json && typeof json.data === "object" && json.data) return json.data;
  return json || {};
}

function readQuotaCache(base) {
  try {
    const raw = $persistentStore.read(`cch_quota_${hashString(base)}`);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    return cache && cache.version === 1 && Array.isArray(cache.providers) ? cache : null;
  } catch (_) { return null; }
}

function writeQuotaCache(base, payload) {
  const cache = { version: 1, updatedAt: Date.now(), total: payload.total, providers: payload.providers };
  try { $persistentStore.write(JSON.stringify(cache), `cch_quota_${hashString(base)}`); } catch (_) {}
  return cache;
}

/* ---------- 用户视角：总额度与并发 session ---------- */

/* 总额度：优先 Key 级，其次用户级 */
function totalQuota(quota) {
  const candidates = [
    numeric(quota.keyLimitTotalUsd),
    numeric(quota.userLimitTotalUsd),
  ];
  let limit = null;
  for (const value of candidates) {
    if (value !== null && value > 0) { limit = value; break; }
  }
  if (limit === null) return null;
  const keyUsed = numeric(quota.keyCurrentTotalUsd);
  const userUsed = numeric(quota.userCurrentTotalUsd);
  const used = keyUsed !== null ? keyUsed : userUsed;
  return { limit, used: used === null ? 0 : used };
}

/* 并发 session：优先 Key 级上限，其次用户级 */
function concurrency(quota) {
  let limit = null;
  for (const value of [numeric(quota.keyLimitConcurrentSessions), numeric(quota.userLimitConcurrentSessions)]) {
    if (value !== null && value > 0) { limit = value; break; }
  }
  const keyCurrent = numeric(quota.keyCurrentConcurrentSessions);
  const userCurrent = numeric(quota.userCurrentConcurrentSessions);
  const current = keyCurrent !== null ? keyCurrent : userCurrent;
  if (limit === null && current === null) return null;
  return { limit, current: current === null ? 0 : current };
}

async function fetchUserSite(site, headers) {
  const response = await request("get", `${site.base}/api/v1/me/quota`, headers);
  checkStatus(response, site.mode === "cookie" ? "会话" : "Key");
  const quota = unwrap(parseBody(response));
  return { kind: "user", total: totalQuota(quota), session: concurrency(quota) };
}

/* ---------- 管理员视角：供应商限额 + 全站监控 ---------- */

/* 供应商限额：取各类窗口中使用率最高的一项；未设限额返回 null */
function providerQuota(usage) {
  let best = null;
  for (const pair of WINDOWS) {
    const window = usage && usage[pair[0]];
    const limit = numeric(window && window.limit);
    if (limit === null || limit <= 0) continue;
    const current = num(window && window.current);
    const ratio = current / limit;
    if (!best || ratio > best.ratio) best = { label: pair[1], limit, current, ratio };
  }
  return best;
}

/* 供应商并发上限：limit 为 0 表示不限，不展示 */
function providerConcurrency(usage) {
  const window = usage && usage.concurrentSessions;
  const limit = numeric(window && window.limit);
  if (limit === null || limit <= 0) return null;
  return { limit, current: num(window && window.current) };
}

async function fetchAdminQuota(site, headers) {
  const cache = readQuotaCache(site.base);
  if (cache && Date.now() - Number(cache.updatedAt || 0) < QUOTA_CACHE_SECONDS * 1000) {
    return { data: cache, stale: false };
  }
  try {
    const providersResponse = await request("get", `${site.base}/api/v1/providers`, headers);
    checkStatus(providersResponse, "管理员令牌");
    const items = parseBody(providersResponse).items;
    const list = Array.isArray(items) ? items : [];

    /* 额度用量是独立端点，失败时降级为“未设置限额”，不影响并发与监控展示 */
    const usageMap = new Map();
    const ids = list.map((item) => Number(item.id)).filter((id) => Number.isFinite(id));
    if (ids.length) {
      try {
        const usageResponse = await request("post", `${site.base}/api/v1/providers/limit-usage:batch`, headers, { providerIds: ids });
        if (usageResponse.status === 200) {
          const usageItems = parseBody(usageResponse).items;
          for (const item of Array.isArray(usageItems) ? usageItems : []) {
            usageMap.set(Number(item.id), item.usage);
          }
        }
      } catch (_) {}
    }

    const providers = list.map((item) => {
      const usage = usageMap.get(Number(item.id)) || null;
      return {
        name: String(item.name || `#${item.id}`),
        enabled: item.isEnabled !== false,
        quota: providerQuota(usage),
        concurrency: providerConcurrency(usage),
      };
    });

    return { data: writeQuotaCache(site.base, { total: list.length, providers }), stale: false };
  } catch (error) {
    if (cache) return { data: cache, stale: true };
    throw error;
  }
}

async function fetchOverview(site, headers) {
  try {
    const response = await request("get", `${site.base}/api/v1/dashboard/overview`, headers);
    if (response.status !== 200) return null;
    return unwrap(parseBody(response));
  } catch (_) { return null; }
}

async function fetchAdminSite(site, headers) {
  const quota = await fetchAdminQuota(site, headers);
  const overview = await fetchOverview(site, headers);
  return { kind: "admin", quota: quota.data, stale: quota.stale, overview };
}

async function fetchSite(site) {
  const headers = { Accept: "application/json" };
  if (site.mode === "cookie") headers.Cookie = `auth-token=${site.credential}`;
  else if (site.mode === "admin") headers.Authorization = `Bearer ${site.credential}`;
  else headers["X-API-Key"] = site.credential;

  if (site.mode === "admin") return fetchAdminSite(site, headers);
  return fetchUserSite(site, headers);
}

/* ---------- 展示 ---------- */

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  const abs = Math.abs(amount);
  if (abs === 0) return "0.00";
  if (abs >= 0.1) return amount.toFixed(2);
  if (abs >= 0.01) return amount.toFixed(3);
  return amount.toFixed(4);
}

function money(value) {
  return `$${formatAmount(value)}`;
}

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(number >= 10 ? 0 : 2)}%`;
}

/* 面板单行宽度估算：中日韩字符按两个半角计 */
function measure(text) {
  let width = 0;
  for (const char of String(text)) width += char.codePointAt(0) > 0x2000 ? 2 : 1;
  return width;
}

/* 按宽度拼行，放不下的片段自动另起一行 */
function layoutRows(parts, budget) {
  const rows = [];
  let row = "";
  for (const part of parts) {
    const candidate = row ? `${row} · ${part}` : part;
    if (row && measure(candidate) > budget) {
      rows.push(row);
      row = part;
    } else {
      row = candidate;
    }
  }
  if (row) rows.push(row);
  return rows;
}

/* 额度使用率保留一位小数，便于看出 68.2% 与 68% 的差别 */
function formatUsagePercent(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(milliseconds) {
  const number = Number(milliseconds);
  if (!Number.isFinite(number)) return "-";
  return number >= 1000 ? `${(number / 1000).toFixed(1)}s` : `${Math.round(number)}ms`;
}

function formatTime() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function finish(content, icon = PANEL_ICON, iconColor = PANEL_ICON_COLOR) {
  $done({ title: PANEL_TITLE, content, icon, "icon-color": iconColor });
}

function fail(message) {
  finish(`❌ ${message}`, ERROR_ICON, DANGER_ICON_COLOR);
}

function renderUserSite(site, data, showName) {
  const lines = [];
  const prefix = showName ? `${site.name} · ` : "";

  if (data.total) {
    const remaining = Math.max(0, data.total.limit - data.total.used);
    const amount = `额度 ${money(remaining)}/${money(data.total.limit)}`;
    const percent = (Math.max(0, Math.min(1, remaining / data.total.limit)) * 100).toFixed(1);
    const line = `${prefix}${amount} · ${percent}%`;
    lines.push(measure(line) <= PANEL_ROW_WIDTH ? line : `${prefix}${amount}`);
  } else {
    lines.push(`${prefix}额度 未设置`);
  }

  const session = data.session;
  if (session) {
    /* limit 为 null 表示未设上限（CCH 里留空/0 即不限） */
    lines.push(session.limit === null ? `并发 ${session.current}/不限` : `并发 ${session.current}/${session.limit}`);
  } else {
    lines.push("并发 未设置");
  }
  return lines;
}

function renderAdminSite(site, data, showName) {
  const lines = [];
  const prefix = showName ? `${site.name} · ` : "";
  const overview = data.overview || {};
  const providers = Array.isArray(data.quota && data.quota.providers) ? data.quota.providers : [];
  const total = Number(data.quota && data.quota.total);

  let header = `供应商 ${Number.isFinite(total) ? total : providers.length}`;
  const liveConcurrency = numeric(overview.concurrentSessions);
  if (liveConcurrency !== null) header += ` · 并发 ${liveConcurrency}`;
  lines.push(prefix + header);

  /* 只列设了限额或并发上限的供应商，按使用率从高到低 */
  const limited = providers
    .filter((provider) => provider.quota || provider.concurrency)
    .sort((a, b) => {
      const left = a.quota ? a.quota.ratio : 0;
      const right = b.quota ? b.quota.ratio : 0;
      return right - left;
    });

  if (!limited.length) {
    lines.push("未设置供应商限额");
  } else {
    /* 供应商名与使用率固定同一行；并发与金额放不下时自动落到下一行 */
    const budget = Math.max(16, PANEL_ROW_WIDTH - measure(prefix));
    for (const provider of limited.slice(0, ADMIN_MAX)) {
      const parts = [provider.quota ? `${provider.name} ${formatUsagePercent(provider.quota.ratio)}` : provider.name];
      if (provider.concurrency) parts.push(`并发 ${provider.concurrency.current}/${provider.concurrency.limit}`);
      if (provider.quota) parts.push(`额度 ${money(provider.quota.current)}/${money(provider.quota.limit)}`);
      for (const row of layoutRows(parts, budget)) lines.push(row);
    }
    if (limited.length > ADMIN_MAX) lines.push(`另有 ${limited.length - ADMIN_MAX} 个限额供应商`);
  }

  lines.push("");

  const requests = numeric(overview.todayRequests);
  const cost = numeric(overview.todayCost);
  if (requests !== null || cost !== null) {
    const head = [];
    if (requests !== null) head.push(`今日 ${formatInteger(requests)} 次`);
    if (cost !== null) head.push(money(cost));
    lines.push(head.join(" · "));
  }

  const errorRate = numeric(overview.todayErrorRate);
  const responseTime = numeric(overview.avgResponseTime);
  if (errorRate !== null || responseTime !== null) {
    const tail = [];
    if (errorRate !== null) tail.push(`错误 ${formatPercent(errorRate)}`);
    if (responseTime !== null) tail.push(`响应 ${formatDuration(responseTime)}`);
    lines.push(tail.join(" · "));
  }

  if (data.stale) lines.push("⚠️ 额度来自缓存");
  return lines;
}

/* 风险等级：0 正常、1 警告、2 危险；站点失败按警告处理 */
function siteRisk(data) {
  if (data.kind === "user") {
    if (data.total && data.total.limit > 0) {
      const ratio = (data.total.limit - data.total.used) / data.total.limit;
      if (ratio <= 0.1) return 2;
      if (ratio <= 0.3) return 1;
    }
    return 0;
  }

  let risk = 0;
  const errorRate = num(data.overview && data.overview.todayErrorRate);
  if (errorRate >= 10) risk = 2;
  else if (errorRate >= 5) risk = 1;

  const providers = Array.isArray(data.quota && data.quota.providers) ? data.quota.providers : [];
  for (const provider of providers) {
    if (!provider.quota) continue;
    if (provider.quota.ratio >= 0.95) risk = Math.max(risk, 2);
    else if (provider.quota.ratio >= 0.8) risk = Math.max(risk, 1);
  }
  if (data.stale) risk = Math.max(risk, 1);
  return risk;
}

(async () => {
  try {
    let sites = parseEndpoints(RAW_ENDPOINTS);
    if (!sites.length) {
      const legacy = legacySite();
      if (legacy) sites = [legacy];
    }
    if (!sites.length) return finish("未配置", PANEL_ICON, "8E8E93");
    const dropped = Math.max(0, sites.length - MAX_SITES);
    sites = sites.slice(0, MAX_SITES);

    const results = await Promise.all(sites.map((site) =>
      fetchSite(site).then(
        (data) => ({ site, data }),
        (error) => ({ site, error: error || new Error("请求失败") })
      )
    ));

    const succeeded = results.filter((item) => item.data);
    if (!succeeded.length) {
      const first = results[0];
      const detail = String((first.error && first.error.message) || first.error);
      return fail(sites.length > 1 ? `${first.site.name}\n${detail}` : detail);
    }

    /* 单站点时不加站名前缀，与旧配置的观感保持一致 */
    const showName = sites.length > 1;
    const blocks = results.map((item) => {
      if (item.error) {
        /* 站名与错误各占一行，避免单行折行 */
        return [`❌ ${item.site.name}`, String((item.error && item.error.message) || item.error)];
      }
      return item.data.kind === "admin"
        ? renderAdminSite(item.site, item.data, showName)
        : renderUserSite(item.site, item.data, showName);
    });

    const lines = [];
    blocks.forEach((block, index) => {
      if (index) lines.push("");
      for (const line of block) lines.push(line);
    });
    if (dropped) lines.push(`另有 ${dropped} 个站点未显示`);
    if (showName) lines.push("");
    lines.push(`更新 ${formatTime()}`);

    let risk = results.some((item) => item.error) ? 1 : 0;
    for (const item of succeeded) risk = Math.max(risk, siteRisk(item.data));

    finish(lines.join("\n"), PANEL_ICON, risk >= 2 ? DANGER_ICON_COLOR : risk >= 1 ? WARN_ICON_COLOR : PANEL_ICON_COLOR);
  } catch (error) {
    fail(String((error && error.message) || error));
  }
})();
