/* AI 中转站面板与日报：
   - 面板（mode=panel，默认）：Sub2API 各站余额 + CCH 各站额度与并发，合并成一个面板
   - 日报（mode=daily）：一条通知汇报 Sub2API 余额、CCH 额度、DeepSeek 余额
   参数按上游分组：sub2api_* / cch_* 各自独立，模块级用 aiapi_* */

const ARGS = parseArgs($argument || "");
const IS_DAILY = String(ARGS.mode || "panel").trim().toLowerCase() === "daily";

const PANEL_TITLE = "API 中转站概览";
const PANEL_ICON = String(ARGS.aiapi_icon || "dollarsign.circle").trim() || "dollarsign.circle";
const iconColorRaw = String(ARGS.aiapi_icon_color || "").trim();
const PANEL_ICON_COLOR = /^[0-9a-fA-F]{6}$/.test(iconColorRaw) ? `#${iconColorRaw}` : "#5B8DEF";
const PANEL_WARN_COLOR = "#F59E0B";
const PANEL_DANGER_COLOR = "#EF4444";
const ERROR_ICON = "exclamationmark.triangle.fill";

/* ── 参数 ── */
const SUB2API_ENDPOINTS = String(ARGS.sub2api_endpoints || "").trim();
const SUB2API_MAX_SITES = 5;
const CCH_ENDPOINTS = String(ARGS.cch_endpoints || "").trim();
const CCH_ADMIN_MAX = intArg(ARGS.cch_admin_max, 4, 1, 20);
const CCH_ROW_WIDTH = intArg(ARGS.cch_row_width, 38, 20, 60);
const CCH_QUOTA_CACHE_SECONDS = intArg(ARGS.cch_quota_interval, 300, 60, 3600);
const DEEPSEEK_KEY = String(ARGS.deepseek_key || "").trim();

/* 参数留空时 Number("") 为 0，会静默关闭提醒，故空值按未配置处理 */
function numberArg(value, fallback) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (text === "") return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function intArg(value, fallback, min, max) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (text === "") return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

const SUB2API_WARN_BALANCE = numberArg(ARGS.sub2api_warn_balance, 1);
const SUB2API_NOTIFY_BALANCE = numberArg(ARGS.sub2api_notify_balance, 1);
const DEEPSEEK_WARN_BALANCE = numberArg(ARGS.deepseek_warn_balance, 5);
const DEEPSEEK_NOTIFY_BALANCE = numberArg(ARGS.deepseek_notify_balance, 5);

/* ── 通用工具 ── */
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

function formatTime() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function todayLocal() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeBaseUrl(value) {
  let base = String(value || "").trim();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base.replace(/\/+$/, "");
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
      resolve({
        status: Number((response && response.status) || 0),
        headers: (response && response.headers) || null,
        body: data,
      });
    });
  });
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

function finish(content, icon = PANEL_ICON, iconColor = PANEL_ICON_COLOR) {
  $done({ title: PANEL_TITLE, content, icon, "icon-color": iconColor });
}

function fail(message) {
  finish(`❌ ${message}`, ERROR_ICON, PANEL_DANGER_COLOR);
}

/* ── Sub2API：各站余额 ── */

const SUB2API_CACHE_KEY = "aiapi_relay_cache";
const SUB2API_CACHE_TTL_MS = 24 * 3600 * 1000;

/* 站点写法：host=key 或 名称@host=key，多个站点用竖线分隔 */
function parseSub2Sites(input) {
  const list = [];
  for (const chunk of String(input).split("|")) {
    const item = chunk.trim();
    if (!item) continue;
    const split = item.indexOf("=");
    if (split < 0) continue;
    const left = item.slice(0, split).trim();
    const key = item.slice(split + 1).trim();
    if (!left || !key) continue;
    const at = left.indexOf("@");
    const label = at >= 0 ? left.slice(0, at).trim() : "";
    const host = at >= 0 ? left.slice(at + 1).trim() : left;
    if (!host) continue;
    list.push({ name: label || host, host, key });
  }
  return list;
}

/* 兼容 host 传域名、带 scheme 或已含 /v1 的写法 */
function usageURL(host) {
  let base = String(host || "").trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, "");
  if (!/\/v\d+$/i.test(base)) base += "/v1";
  return `${base}/usage`;
}

async function fetchSub2Site(site) {
  try {
    const response = await request("get", usageURL(site.host), {
      Accept: "application/json",
      Authorization: `Bearer ${site.key}`,
    });
    if (response.status === 401 || response.status === 403) return { site, ok: false, error: "Key 无效" };
    if (response.status === 429) return { site, ok: false, error: "请求频繁" };
    if (response.status === 404) return { site, ok: false, error: "接口不存在" };
    if (response.status !== 200) return { site, ok: false, error: `HTTP ${response.status}` };
    let json;
    try { json = JSON.parse(response.body); }
    catch (_) { return { site, ok: false, error: "响应异常" }; }
    if (!json || typeof json !== "object") return { site, ok: false, error: "响应异常" };
    return { site, ok: true, data: json };
  } catch (error) {
    const text = String((error && error.message) || error);
    return { site, ok: false, error: /timeout|timed out/i.test(text) ? "超时" : "连接失败" };
  }
}

function summaryText(json) {
  const quota = json.quota;
  if (quota) {
    const limit = numeric(quota.limit);
    const remaining = numeric(quota.remaining);
    if (limit !== null && limit > 0 && remaining !== null) return `余额 ${money(remaining)} / ${money(limit)}`;
  }
  if (json.subscription) {
    const remaining = numeric(json.remaining);
    if (remaining !== null && remaining >= 0) return `剩余 ${money(remaining)}`;
    return "无周期限额";
  }
  const balance = numeric(json.balance);
  if (balance !== null) return `余额 ${money(balance)}`;
  const remaining = numeric(json.remaining);
  if (remaining !== null && remaining >= 0) return `余额 ${money(remaining)}`;
  return "无余额字段";
}

function expirySuffix(json) {
  const days = numeric(json.days_until_expiry);
  if (days === null) return "";
  if (days <= 0) return " · 已到期";
  if (days <= 30) return ` · 剩 ${days} 天`;
  return "";
}

/* 面板字体为比例字体，空格无法对齐，统一用分隔点 */
function sub2Lines(results) {
  return results.map((item) => {
    const name = String(item.site.name);
    if (!item.ok) return `${name} · ❌ ${item.error}`;
    return `${name} · ${summaryText(item.data)}${expirySuffix(item.data)}`;
  });
}

function sub2HealthRatio(results) {
  let min = null;
  for (const item of results) {
    if (!item.ok || !item.data || !item.data.quota) continue;
    const limit = numeric(item.data.quota.limit);
    const remaining = numeric(item.data.quota.remaining);
    if (limit === null || limit <= 0 || remaining === null) continue;
    const ratio = remaining / limit;
    if (min === null || ratio < min) min = ratio;
  }
  return min;
}

function sub2HealthRisk(results) {
  const ratio = sub2HealthRatio(results);
  if (ratio === null) return 0;
  if (ratio <= 0.1) return 2;
  if (ratio <= 0.3) return 1;
  return 0;
}

function sub2LowBalanceItems(results, threshold) {
  if (threshold <= 0) return [];
  const hits = [];
  for (const item of results) {
    if (!item.ok || !item.data) continue;
    let amount = null;
    if (item.data.quota) amount = numeric(item.data.quota.remaining);
    else if (item.data.balance !== undefined) amount = numeric(item.data.balance);
    else amount = numeric(item.data.remaining);
    if (amount !== null && amount < threshold) hits.push(`${item.site.name} ${money(amount)}`);
  }
  return hits;
}

function readSub2Cache() {
  try {
    const raw = $persistentStore.read(SUB2API_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !cached.results) return null;
    if (Date.now() - Number(cached.at || 0) > SUB2API_CACHE_TTL_MS) return null;
    return cached;
  } catch (_) { return null; }
}

function writeSub2Cache(results) {
  try {
    const slim = results.map((item) => ({
      site: { name: item.site.name, host: item.site.host },
      ok: item.ok,
      error: item.error || null,
      data: item.data || null,
    }));
    $persistentStore.write(JSON.stringify({ at: Date.now(), results: slim }), SUB2API_CACHE_KEY);
  } catch (_) {}
}

function notifySub2LowBalance(results) {
  if (SUB2API_NOTIFY_BALANCE === 0) return;
  const hits = sub2LowBalanceItems(results, SUB2API_NOTIFY_BALANCE);
  if (!hits.length) return;
  const key = `aiapi_relay_notice_${todayLocal()}`;
  try {
    if ($persistentStore.read(key)) return;
    $notification.post(`${PANEL_TITLE} 余额提醒`, `低于 ${money(SUB2API_NOTIFY_BALANCE)}：${hits.join(" · ")}`, "请及时充值");
    $persistentStore.write("1", key);
  } catch (_) {}
}

/* ── CCH：各站额度与并发 ── */

const CCH_MODES = ["user", "cookie", "admin", "login"];
const CCH_WINDOWS = [
  ["cost5h", "5 小时"],
  ["costDaily", "日"],
  ["costWeekly", "周"],
  ["costMonthly", "月"],
  ["limitTotalUsd", "总额"],
];

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

/* 站点写法：名称@地址=凭据[:模式]，多个站点用竖线分隔；模式省略即 user */
function parseCchSites(input) {
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
      if (CCH_MODES.indexOf(suffix) >= 0) {
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
function legacyCchSite() {
  const base = normalizeBaseUrl(ARGS.cch_url);
  const credential = String(ARGS.cch_api_key || "").trim();
  if (!base || !credential) return null;
  const raw = String(ARGS.cch_auth || "api_key").trim().toLowerCase();
  const mode = raw === "cookie" ? "cookie" : raw === "admin" ? "admin" : "user";
  return { name: base.replace(/^https?:\/\//i, ""), base, credential, mode };
}

/* 总额度：上限与已用必须取自同一层级，混用会把已用算成 0 */
function cchTotalQuota(quota) {
  const keyLimit = numeric(quota.keyLimitTotalUsd);
  if (keyLimit !== null && keyLimit > 0) {
    return { limit: keyLimit, used: num(quota.keyCurrentTotalUsd) };
  }
  const userLimit = numeric(quota.userLimitTotalUsd);
  if (userLimit !== null && userLimit > 0) {
    return { limit: userLimit, used: num(quota.userCurrentTotalUsd) };
  }
  return null;
}

/* 并发 session：上限与占用同样要求同源 */
function cchConcurrency(quota) {
  const keyLimit = numeric(quota.keyLimitConcurrentSessions);
  if (keyLimit !== null && keyLimit > 0) {
    return { limit: keyLimit, current: num(quota.keyCurrentConcurrentSessions) };
  }
  const userLimit = numeric(quota.userLimitConcurrentSessions);
  if (userLimit !== null && userLimit > 0) {
    return { limit: userLimit, current: num(quota.userCurrentConcurrentSessions) };
  }
  const keyCurrent = numeric(quota.keyCurrentConcurrentSessions);
  const userCurrent = numeric(quota.userCurrentConcurrentSessions);
  if (keyCurrent === null && userCurrent === null) return null;
  return { limit: null, current: keyCurrent !== null ? keyCurrent : userCurrent };
}

async function fetchCchUserSite(site, headers) {
  const response = await request("get", `${site.base}/api/v1/me/quota`, headers);
  checkStatus(response, site.mode === "user" ? "Key" : "会话");
  const quota = unwrap(parseBody(response));
  return { kind: "user", total: cchTotalQuota(quota), session: cchConcurrency(quota) };
}

/* 供应商限额：取各类窗口中使用率最高的一项；未设限额返回 null */
function cchProviderQuota(usage) {
  let best = null;
  for (const pair of CCH_WINDOWS) {
    const window = usage && usage[pair[0]];
    const limit = numeric(window && window.limit);
    if (limit === null || limit <= 0) continue;
    const current = num(window && window.current);
    const ratio = current / limit;
    if (!best || ratio > best.ratio) best = { limit, current, ratio };
  }
  return best;
}

/* 供应商并发上限：limit 为 0 表示不限，不展示 */
function cchProviderConcurrency(usage) {
  const window = usage && usage.concurrentSessions;
  const limit = numeric(window && window.limit);
  if (limit === null || limit <= 0) return null;
  return { limit, current: num(window && window.current) };
}

function quotaCacheKey(base) {
  return `cch_quota_${hashString(base)}`;
}

function readQuotaCache(base) {
  try {
    const raw = $persistentStore.read(quotaCacheKey(base));
    if (!raw) return null;
    const cache = JSON.parse(raw);
    return cache && cache.version === 1 && Array.isArray(cache.providers) ? cache : null;
  } catch (_) { return null; }
}

function writeQuotaCache(base, payload) {
  const cache = { version: 1, updatedAt: Date.now(), total: payload.total, providers: payload.providers };
  try { $persistentStore.write(JSON.stringify(cache), quotaCacheKey(base)); } catch (_) {}
  return cache;
}

async function fetchCchAdminQuota(site, headers) {
  const cache = readQuotaCache(site.base);
  if (cache && Date.now() - Number(cache.updatedAt || 0) < CCH_QUOTA_CACHE_SECONDS * 1000) {
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
        quota: cchProviderQuota(usage),
        concurrency: cchProviderConcurrency(usage),
      };
    });

    return { data: writeQuotaCache(site.base, { total: list.length, providers }), stale: false };
  } catch (error) {
    if (cache) return { data: cache, stale: true };
    throw error;
  }
}

async function fetchCchOverview(site, headers) {
  try {
    const response = await request("get", `${site.base}/api/v1/dashboard/overview`, headers);
    if (response.status !== 200) return null;
    return unwrap(parseBody(response));
  } catch (_) { return null; }
}

async function fetchCchAdminSite(site, headers) {
  const quota = await fetchCchAdminQuota(site, headers);
  const overview = await fetchCchOverview(site, headers);
  return { kind: "admin", quota: quota.data, stale: quota.stale, overview };
}

/* 自动登录：用 API Key 换取会话 Cookie */
function sessionStoreKey(base) {
  return `cch_session_${hashString(base)}`;
}

function readSession(base) {
  try {
    const raw = $persistentStore.read(sessionStoreKey(base));
    if (!raw) return "";
    const cache = JSON.parse(raw);
    if (!cache || cache.version !== 1 || typeof cache.token !== "string") return "";
    return Number(cache.expiresAt || 0) > Date.now() ? cache.token : "";
  } catch (_) { return ""; }
}

function writeSession(base, token, maxAgeSeconds) {
  /* Cookie 未给 Max-Age 时按 6 天保守缓存，留出余量 */
  const ttl = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ? maxAgeSeconds : 6 * 24 * 3600;
  try {
    $persistentStore.write(
      JSON.stringify({ version: 1, token, expiresAt: Date.now() + ttl * 1000 }),
      sessionStoreKey(base)
    );
  } catch (_) {}
}

/* 从响应头取 auth-token；Set-Cookie 可能被合并成一行 */
function extractSession(headers) {
  if (!headers) return null;
  const raw = headers["Set-Cookie"] || headers["set-cookie"];
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : String(raw).split(/,(?=\s*[A-Za-z0-9_.-]+=)/);
  for (const item of list) {
    const match = /(?:^|[;\s])auth-token=([^;,\s]+)/.exec(item);
    if (!match) continue;
    const ttl = /max-age=(\d+)/i.exec(item);
    return { token: match[1], maxAge: ttl ? Number(ttl[1]) : null };
  }
  return null;
}

async function loginWithKey(base, credential) {
  const response = await request("post", `${base}/api/auth/login`, { Accept: "application/json" }, { key: credential });
  if (response.status === 401) throw new Error("Key 无效或已过期");
  if (response.status === 429) throw new Error("登录过于频繁，稍后重试");
  if (response.status !== 200) throw new Error(`登录失败 (HTTP ${response.status})`);
  const session = extractSession(response.headers);
  if (!session) throw new Error("登录成功但未取到会话 Cookie");
  return session;
}

/* 优先用缓存会话，失效时用 Key 重新登录一次 */
async function fetchCchLoginSite(site) {
  const cached = readSession(site.base);
  if (cached) {
    try {
      return await fetchCchUserSite(site, { Accept: "application/json", Cookie: `auth-token=${cached}` });
    } catch (_) {
      /* 会话可能已过期，落到下面重新登录 */
    }
  }
  const session = await loginWithKey(site.base, site.credential);
  writeSession(site.base, session.token, session.maxAge);
  return fetchCchUserSite(site, { Accept: "application/json", Cookie: `auth-token=${session.token}` });
}

async function fetchCchSite(site) {
  const headers = { Accept: "application/json" };
  if (site.mode === "cookie") headers.Cookie = `auth-token=${site.credential}`;
  else if (site.mode === "admin") headers.Authorization = `Bearer ${site.credential}`;
  else headers["X-API-Key"] = site.credential;

  if (site.mode === "admin") return fetchCchAdminSite(site, headers);
  if (site.mode === "login") return fetchCchLoginSite(site);
  return fetchCchUserSite(site, headers);
}

/* 使用率保留一位小数，便于看出 68.2% 与 68% 的差别 */
function formatUsagePercent(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

/* CCH 站点始终带站名，方便与 Sub2API 站点并列时区分 */
function cchUserLines(site, data) {
  const prefix = `${site.name} · `;
  const parts = [];
  if (data.total) {
    /* 只展示剩余额度；上限与百分比不显示，风险色仍按剩余比例计算 */
    parts.push(`剩余 ${money(data.total.limit - data.total.used)}`);
  } else {
    parts.push("剩余 未设置");
  }

  const session = data.session;
  if (session) {
    /* limit 为 null 表示未设上限（CCH 里留空/0 即不限） */
    parts.push(session.limit === null ? `并发 ${session.current}/不限` : `并发 ${session.current}/${session.limit}`);
  } else {
    parts.push("并发 未设置");
  }

  return layoutRows(parts, Math.max(16, CCH_ROW_WIDTH - measure(prefix)))
    .map((row, index) => (index === 0 ? prefix + row : row));
}

function cchAdminLines(site, data) {
  const prefix = `${site.name} · `;
  const lines = [];
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
    const budget = Math.max(16, CCH_ROW_WIDTH - measure(prefix));
    for (const provider of limited.slice(0, CCH_ADMIN_MAX)) {
      const parts = [provider.quota ? `${provider.name} ${formatUsagePercent(provider.quota.ratio)}` : provider.name];
      if (provider.concurrency) parts.push(`并发 ${provider.concurrency.current}/${provider.concurrency.limit}`);
      if (provider.quota) parts.push(`额度 ${money(provider.quota.current)}/${money(provider.quota.limit)}`);
      for (const row of layoutRows(parts, budget)) lines.push(row);
    }
    if (limited.length > CCH_ADMIN_MAX) lines.push(`另有 ${limited.length - CCH_ADMIN_MAX} 个限额供应商`);
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

function formatDuration(milliseconds) {
  const number = Number(milliseconds);
  if (!Number.isFinite(number)) return "-";
  return number >= 1000 ? `${(number / 1000).toFixed(1)}s` : `${Math.round(number)}ms`;
}

/* 风险等级：0 正常、1 警告、2 危险 */
function cchRisk(data) {
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

/* ── DeepSeek：仅日报使用 ── */

const DEEPSEEK_URL = "https://api.deepseek.com/user/balance";
const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$" };

function currencySymbol(currency) {
  return CURRENCY_SYMBOLS[String(currency || "").toUpperCase()] || "";
}

function deepseekMoney(currency, value) {
  const amount = Number(value);
  const text = Number.isFinite(amount) ? amount.toFixed(2) : String(value);
  return `${currencySymbol(currency)}${text}`;
}

async function fetchDeepSeek() {
  if (!DEEPSEEK_KEY) return { ok: false, error: "未配置 Key" };
  try {
    const response = await request("get", DEEPSEEK_URL, {
      Accept: "application/json",
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    });
    if (response.status === 401 || response.status === 403) return { ok: false, error: "Key 无效或已失效" };
    if (response.status !== 200) return { ok: false, error: `HTTP ${response.status}` };
    let json;
    try { json = JSON.parse(response.body); }
    catch (_) { return { ok: false, error: "响应解析失败" }; }
    const infos = Array.isArray(json && json.balance_infos) ? json.balance_infos : [];
    if (!infos.length) return { ok: false, error: "未返回余额信息" };
    return { ok: true, json, infos };
  } catch (_) {
    return { ok: false, error: "连接失败" };
  }
}

/* DeepSeek 面板行：余额一行，低于阈值补一行提示 */
function deepseekPanelLines(result) {
  if (!result.ok) return [`DeepSeek · ❌ ${result.error}`];
  const lines = [];
  if (result.infos.length === 1) {
    const info = result.infos[0];
    lines.push(`DeepSeek · 余额 ${deepseekMoney(info.currency, info.total_balance)}`);
  } else {
    for (const info of result.infos) {
      lines.push(`DeepSeek · ${info.currency} 余额 ${deepseekMoney(info.currency, info.total_balance)}`);
    }
  }
  for (const info of result.infos) {
    const amount = Number(info.total_balance);
    if (DEEPSEEK_WARN_BALANCE > 0 && Number.isFinite(amount) && amount < DEEPSEEK_WARN_BALANCE) {
      lines.push(`⚠️ DeepSeek 余额低于 ${deepseekMoney(info.currency, DEEPSEEK_WARN_BALANCE)}`);
    }
  }
  return lines;
}

function deepseekLowRisk(result) {
  if (!result || !result.ok) return 0;
  for (const info of result.infos) {
    const amount = Number(info.total_balance);
    if (DEEPSEEK_WARN_BALANCE > 0 && Number.isFinite(amount) && amount < DEEPSEEK_WARN_BALANCE) return 1;
  }
  return 0;
}

/* 低余额通知按天去重，避免每次刷新都提醒 */
function notifyDeepSeekLowBalance(result) {
  if (!result || !result.ok || DEEPSEEK_NOTIFY_BALANCE === 0) return;
  const today = todayLocal();
  for (const info of result.infos) {
    const amount = Number(info.total_balance);
    if (!Number.isFinite(amount) || amount >= DEEPSEEK_NOTIFY_BALANCE) continue;
    const currency = String(info.currency || "").toUpperCase();
    const key = `deepseek_notice_${currency}_${today}`;
    try {
      if ($persistentStore.read(key)) continue;
      $notification.post(
        "DeepSeek 余额提醒",
        `${currency} 余额 ${deepseekMoney(currency, info.total_balance)}，低于 ${deepseekMoney(currency, DEEPSEEK_NOTIFY_BALANCE)}`,
        `充值余额：${deepseekMoney(currency, info.topped_up_balance)}`
      );
      $persistentStore.write("1", key);
    } catch (_) {}
  }
}

/* ── 取数 ── */

function collectCchSites() {
  let sites = parseCchSites(CCH_ENDPOINTS);
  if (!sites.length) {
    const legacy = legacyCchSite();
    if (legacy) sites = [legacy];
  }
  return sites;
}

async function collectPanelData() {
  const sub2Sites = parseSub2Sites(SUB2API_ENDPOINTS).slice(0, SUB2API_MAX_SITES);
  const sub2Dropped = Math.max(0, parseSub2Sites(SUB2API_ENDPOINTS).length - sub2Sites.length);
  const cchAll = collectCchSites();
  const cchDropped = Math.max(0, cchAll.length - 5);
  const cchSites = cchAll.slice(0, 5);

  const [sub2Results, cchResults, deepseek] = await Promise.all([
    sub2Sites.length ? Promise.all(sub2Sites.map((site) => fetchSub2Site(site))) : Promise.resolve([]),
    cchSites.length
      ? Promise.all(cchSites.map((site) => fetchCchSite(site).then(
        (data) => ({ site, data }),
        (error) => ({ site, error: error || new Error("请求失败") })
      )))
      : Promise.resolve([]),
    DEEPSEEK_KEY ? fetchDeepSeek() : Promise.resolve(null),
  ]);

  return { sub2Results, sub2Dropped, cchResults, cchDropped, deepseek };
}

/* ── 面板 ── */

async function runPanel() {
  const { sub2Results, sub2Dropped, cchResults, cchDropped, deepseek } = await collectPanelData();
  if (!sub2Results.length && !cchResults.length && !deepseek) return finish("未配置", PANEL_ICON, "8E8E93");

  const lines = [];
  /* 三类之间不留空行，保持整体统一；只有更新时间前留白 */
  const addBlock = (block) => {
    if (!block || !block.length) return;
    for (const line of block) lines.push(line);
  };

  if (sub2Results.length) {
    const block = [];
    const allFailed = sub2Results.every((item) => !item.ok);
    const cached = allFailed ? readSub2Cache() : null;
    if (cached) {
      /* 全部站点刷新失败时展示上次结果，并标明数据年龄 */
      const age = Math.max(0, Math.round((Date.now() - Number(cached.at || 0)) / 60000));
      block.push(`⚠️ 中转站刷新失败：${sub2Results[0].error}（缓存于 ${age} 分钟前）`);
      for (const line of sub2Lines(cached.results)) block.push(line);
    } else {
      for (const line of sub2Lines(sub2Results)) block.push(line);
      if (!allFailed) {
        writeSub2Cache(sub2Results);
        const hits = sub2LowBalanceItems(sub2Results, SUB2API_WARN_BALANCE);
        if (hits.length) block.push(`⚠️ 余额偏低：${hits.join(" · ")}`);
      }
    }
    if (sub2Dropped > 0) block.push(`另有 ${sub2Dropped} 个站点未显示`);
    addBlock(block);
  }

  const cchBlocks = cchResults.map((item) => (item.error
    ? [`${item.site.name} · ❌ ${String((item.error && item.error.message) || item.error)}`]
    : item.data.kind === "admin" ? cchAdminLines(item.site, item.data) : cchUserLines(item.site, item.data)));

  if (cchDropped > 0 && cchBlocks.length) cchBlocks[cchBlocks.length - 1].push(`另有 ${cchDropped} 个站点未显示`);
  for (const block of cchBlocks) addBlock(block);

  if (deepseek) addBlock(deepseekPanelLines(deepseek));

  lines.push("");
  lines.push(`更新 ${formatTime()}`);

  /* 风险色取各部分最高值 */
  let risk = sub2Results.every((item) => !item.ok) && sub2Results.length ? 1 : sub2HealthRisk(sub2Results);
  if (cchResults.some((item) => item.error)) risk = Math.max(risk, 1);
  for (const item of cchResults) if (item.data) risk = Math.max(risk, cchRisk(item.data));

  const cchFailed = cchResults.length > 0 && cchResults.every((item) => item.error);
  const sub2Failed = sub2Results.length > 0 && sub2Results.every((item) => !item.ok);
  if (cchFailed && sub2Failed) risk = 2;

  risk = Math.max(risk, deepseekLowRisk(deepseek));
  if (deepseek && !deepseek.ok && DEEPSEEK_KEY) risk = Math.max(risk, 1);

  if (!cchFailed || sub2Results.some((item) => item.ok)) notifySub2LowBalance(sub2Results);
  notifyDeepSeekLowBalance(deepseek);

  const color = risk >= 2 ? PANEL_DANGER_COLOR : risk >= 1 ? PANEL_WARN_COLOR : PANEL_ICON_COLOR;
  finish(lines.join("\n"), PANEL_ICON, color);
}

/* ── 日报 ── */

function cchDailyText(data) {
  if (data.kind === "admin") {
    const overview = data.overview || {};
    const parts = [];
    const concurrent = numeric(overview.concurrentSessions);
    if (concurrent !== null) parts.push(`并发 ${concurrent}`);
    const cost = numeric(overview.todayCost);
    if (cost !== null) parts.push(`今日 ${money(cost)}`);
    const errorRate = numeric(overview.todayErrorRate);
    if (errorRate !== null) parts.push(`错误 ${formatPercent(errorRate)}`);
    return parts.join(" · ");
  }
  const parts = [];
  if (data.total) parts.push(`剩余 ${money(data.total.limit - data.total.used)}`);
  const session = data.session;
  if (session) parts.push(session.limit === null ? `并发 ${session.current}/不限` : `并发 ${session.current}/${session.limit}`);
  return parts.join(" · ");
}

async function runDaily() {
  if (String(ARGS.aiapi_daily_notify || "false").trim().toLowerCase() !== "true") return $done();

  const sub2Sites = parseSub2Sites(SUB2API_ENDPOINTS).slice(0, SUB2API_MAX_SITES);
  const cchSites = collectCchSites().slice(0, 5);

  const [sub2Results, cchResults, deepseek] = await Promise.all([
    Promise.all(sub2Sites.map((site) => fetchSub2Site(site))),
    Promise.all(cchSites.map((site) => fetchCchSite(site).then(
      (data) => ({ site, data }),
      (error) => ({ site, error: error || new Error("请求失败") })
    ))),
    fetchDeepSeek(),
  ]);

  const sections = [];

  if (sub2Results.length) {
    sections.push(["【中转站】"].concat(sub2Results.map((item) => (item.ok
      ? `${item.site.name}：${summaryText(item.data)}${expirySuffix(item.data)}`
      : `${item.site.name}：❌ ${item.error}`))));
  }

  if (cchResults.length) {
    sections.push(["【CCH】"].concat(cchResults.map((item) => {
      if (item.error) return `${item.site.name}：❌ ${String((item.error && item.error.message) || item.error)}`;
      const text = cchDailyText(item.data);
      return `${item.site.name}：${text || "无数据"}`;
    })));
  }

  if (deepseek.ok) {
    sections.push(["【DeepSeek】"].concat(deepseek.infos.map(
      (info) => `${info.currency}：余额 ${deepseekMoney(info.currency, info.total_balance)}`
    )));
  } else if (DEEPSEEK_KEY) {
    sections.push(["【DeepSeek】", `❌ ${deepseek.error}`]);
  }

  if (!sections.length) return $done();

  const subtitle = `中转站 ${sub2Results.length} · CCH ${cchResults.length} · DeepSeek ${deepseek.ok ? deepseek.infos.length : 0}`;
  $notification.post(`${PANEL_TITLE} 日报`, subtitle, sections.map((block) => block.join("\n")).join("\n\n"));
  return $done();
}

(async () => {
  try {
    if (IS_DAILY) {
      await runDaily();
      return;
    }
    await runPanel();
  } catch (error) {
    fail(String((error && error.message) || error));
  }
})();
