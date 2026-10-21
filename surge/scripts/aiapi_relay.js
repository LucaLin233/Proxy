/* AI 中转站面板与日报：
   - 面板（mode=panel，默认）：各 CCH / CCHP 站点的余额，合并成一个列表
   - 日报（mode=daily）：每天 23:50 推送同一条列表
   余额从两处取：CCH 的 admin 模式一次拿到本站各上游余额（CCH 用各上游自己的密钥查），
   user/cookie/login 模式取该站账户余额；CCHP 的 cchp 模式按组织取各 provider 余额，
   并用其 key 优先级排序（Clouder 的余额仍由 CCH 站点提供）。面板只显示余额。
   参数用 cch_*，模块级用 aiapi_* */

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
const CCH_ENDPOINTS = String(ARGS.cch_endpoints || "").trim();
const CCH_ADMIN_MAX = intArg(ARGS.cch_admin_max, 8, 1, 20);
const CCH_ROW_WIDTH = intArg(ARGS.cch_row_width, 38, 20, 60);
const CCH_QUOTA_CACHE_SECONDS = intArg(ARGS.cch_quota_interval, 300, 60, 3600);
/* 供应商限额（5 小时/日/周/月用量）与上游余额是两回事，默认只展示余额 */
const CCH_SHOW_LIMITS = boolArg(ARGS.cch_show_limits, false);

function intArg(value, fallback, min, max) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (text === "") return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/* 开关参数：留空用默认值，只有明确的真/假写法才覆盖 */
function boolArg(value, fallback) {
  const text = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  if (text === "") return fallback;
  if (text === "true" || text === "1" || text === "yes" || text === "on") return true;
  if (text === "false" || text === "0" || text === "no" || text === "off") return false;
  return fallback;
}

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

/* CCH 上游余额按上游原生币种展示，不做汇率换算（换算需要实时汇率，会对不上上游账单） */
function cchMoney(currency, value) {
  const code = String(currency || "").trim().toUpperCase();
  const symbol = currencySymbol(code);
  const text = formatAmount(value);
  if (symbol) return `${symbol}${text}`;
  return code ? `${text} ${code}` : text;
}

function formatTime() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

/* ── CCH：各上游余额（限额可选） ── */

const CCH_MODES = ["user", "cookie", "admin", "login", "cchp"];
/* CCH 单次批量查询余额的供应商上限 */
const CCH_BALANCE_MAX_IDS = 50;
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
    /* 末尾可选的优先级：名称@地址=凭据:模式:优先级，用于把该站排进上游列表的正确位置 */
    let priority = null;
    let colon = right.lastIndexOf(":");
    if (colon > 0) {
      const tail = right.slice(colon + 1).replace(/[\s\[\]]/g, "");
      if (/^\d+(\.\d+)?$/.test(tail)) {
        priority = Number(tail);
        right = right.slice(0, colon).replace(/[\s\[\]]+$/, "");
      }
    }

    colon = right.lastIndexOf(":");
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
    list.push({ name: label || host, base, credential: right, mode, priority });
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
  return { name: base.replace(/^https?:\/\//i, ""), base, credential, mode, priority: null };
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

async function fetchCchUserSite(site, headers) {
  const response = await request("get", `${site.base}/api/v1/me/quota`, headers);
  checkStatus(response, site.mode === "user" ? "Key" : "会话");
  const quota = unwrap(parseBody(response));
  return { kind: "user", total: cchTotalQuota(quota) };
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

/* 供应商清单：余额要按 id 查询，故每次刷新都取（CCH 侧只是一次数据库查询） */
async function fetchCchProviderList(site, headers) {
  const response = await request("get", `${site.base}/api/v1/providers`, headers);
  checkStatus(response, "管理员令牌");
  const items = parseBody(response).items;
  return Array.isArray(items) ? items : [];
}

function balanceCacheKey(base, ids) {
  return `cch_balance_${hashString(`${base}|${ids.join(",")}`)}`;
}

function readBalanceCache(base, ids) {
  try {
    const raw = $persistentStore.read(balanceCacheKey(base, ids));
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (!cache || cache.version !== 1 || !Array.isArray(cache.items)) return null;
    if (Date.now() - Number(cache.updatedAt || 0) > CCH_QUOTA_CACHE_SECONDS * 1000) return null;
    return cache.items;
  } catch (_) { return null; }
}

function writeBalanceCache(base, ids, items) {
  try {
    $persistentStore.write(
      JSON.stringify({ version: 1, updatedAt: Date.now(), items }),
      balanceCacheKey(base, ids)
    );
  } catch (_) {}
  return items;
}

/* 上游余额：CCH 用各上游自己保存的密钥查询，面板只读结果，不接触上游密钥。
   失败返回 null（区别于“查到了但没有余额”），调用方据此区分展示。 */
async function fetchCchBalances(site, headers, list) {
  const ids = list
    .map((item) => Number(item.id))
    .filter((id) => Number.isFinite(id))
    .slice(0, CCH_BALANCE_MAX_IDS);
  if (!ids.length) return [];
  const cached = readBalanceCache(site.base, ids);
  if (cached) return cached;
  try {
    const response = await request(
      "post",
      `${site.base}/api/v1/providers/balances:batch`,
      headers,
      { providerIds: ids, refresh: false }
    );
    if (response.status !== 200) return null;
    const items = parseBody(response).items;
    return writeBalanceCache(site.base, ids, Array.isArray(items) ? items : []);
  } catch (_) {
    return null;
  }
}

async function fetchCchAdminQuota(site, headers, list) {
  const cache = readQuotaCache(site.base);
  if (cache && Date.now() - Number(cache.updatedAt || 0) < CCH_QUOTA_CACHE_SECONDS * 1000) {
    return { data: cache, stale: false };
  }
  try {
    /* 额度用量是独立端点，失败时降级为“未设置限额”，不影响余额与监控展示 */
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
      };
    });

    return { data: writeQuotaCache(site.base, { total: list.length, providers }), stale: false };
  } catch (error) {
    if (cache) return { data: cache, stale: true };
    throw error;
  }
}

async function fetchCchAdminSite(site, headers) {
  const list = await fetchCchProviderList(site, headers);
  /* 限额表默认不展示，也就没必要为它多打一次接口 */
  const quota = CCH_SHOW_LIMITS ? await fetchCchAdminQuota(site, headers, list) : null;
  const vendors = await fetchCchVendors(site, headers);
  const balances = await fetchCchBalances(site, headers, cchBalanceProviders(list, vendors));
  return {
    kind: "admin",
    providers: list,
    vendors,
    quota: quota ? quota.data : null,
    stale: quota ? quota.stale : false,
    balances,
  };
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
  else if (site.mode === "admin" || site.mode === "cchp") headers.Authorization = `Bearer ${site.credential}`;
  else headers["X-API-Key"] = site.credential;

  if (site.mode === "admin") return fetchCchAdminSite(site, headers);
  if (site.mode === "cchp") return fetchCchpSite(site, headers);
  if (site.mode === "login") return fetchCchLoginSite(site);
  return fetchCchUserSite(site, headers);
}

/* 使用率保留一位小数，便于看出 68.2% 与 68% 的差别 */
function formatUsagePercent(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

/* 上游地址：同一站点常有多把密钥、对应多个供应商条目，按地址归并才不重复 */
function providerHost(url) {
  const text = String(url || "").trim();
  const match = /^(?:https?:\/\/)?([^/?#]+)/i.exec(text);
  return (match ? match[1] : text).toLowerCase();
}

/* 上游厂商：CCH 按官网地址归并供应商，名称（Kcne、Clouder 等）取自这里 */
async function fetchCchVendors(site, headers) {
  try {
    const response = await request("get", `${site.base}/api/v1/provider-vendors`, headers);
    if (response.status !== 200) return new Map();
    const items = parseBody(response).items;
    const map = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const id = Number(item.id);
      if (!Number.isFinite(id)) continue;
      map.set(id, {
        name: String(item.displayName || "").trim(),
        domain: String(item.websiteDomain || "").trim().toLowerCase(),
      });
    }
    return map;
  } catch (_) {
    return new Map();
  }
}

/* 归并键：优先用厂商，没有厂商信息时退回官网地址 */
function providerGroupKey(provider) {
  const vendorId = Number(provider.providerVendorId);
  return Number.isFinite(vendorId) ? `v${vendorId}` : `h${providerHost(provider.url)}`;
}

function providerLabel(provider, vendors) {
  const vendor = vendors ? vendors.get(Number(provider.providerVendorId)) : null;
  return (vendor && vendor.name) || providerHost(provider.url);
}

/* 品牌名：供应商名去掉「-用途」后缀（Kcne-Astra → Kcne、Miapi-DS → Miapi） */
function providerBrand(name) {
  const text = String(name || "").trim();
  const cut = text.split(/[-_\s]/)[0].trim();
  return cut || text;
}

/* 只查启用上游的余额；Clouder 已单独查询，Miapi 不限余额，均不从主 CCH 获取。 */
function cchBalanceProviders(providers, vendors) {
  const ignoredBrands = ["clouder", "miapi"];
  return providers.filter((provider) => {
    if (provider.isEnabled === false) return false;
    const vendor = vendors ? vendors.get(Number(provider.providerVendorId)) : null;
    return !ignoredBrands.includes(providerBrand(provider.name).toLowerCase())
      && !ignoredBrands.includes(providerBrand(vendor && vendor.name).toLowerCase());
  });
}

/* 上游显示名取该厂商下各供应商名称的品牌；名称不一致时才退回 CCH 厂商名 */
/* 厂商分组信息：显示名取供应商名的品牌部分，优先级取组内最小值（CCH 里数值越小越优先） */
function cchGroupInfo(providers, vendors) {
  const groups = new Map();
  for (const provider of providers) {
    const key = providerGroupKey(provider);
    const priority = Number(provider.priority);
    let group = groups.get(key);
    if (!group) {
      group = { brands: new Set(), priority: null, sample: provider };
      groups.set(key, group);
    }
    group.brands.add(providerBrand(provider.name));
    if (Number.isFinite(priority) && (group.priority === null || priority < group.priority)) {
      group.priority = priority;
    }
  }

  const info = new Map();
  for (const [key, group] of groups) {
    info.set(key, {
      label: group.brands.size === 1
        ? Array.from(group.brands)[0]
        : providerLabel(group.sample, vendors),
      priority: group.priority,
    });
  }
  return info;
}

/* 排序：CCH 优先级升序（数值越小越优先），同级按余额升序；没有优先级的排最后 */
function compareRows(a, b) {
  const leftPriority = a.priority === null || a.priority === undefined ? Infinity : a.priority;
  const rightPriority = b.priority === null || b.priority === undefined ? Infinity : b.priority;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftAmount = a.amount === null ? Infinity : a.amount;
  const rightAmount = b.amount === null ? Infinity : b.amount;
  return leftAmount - rightAmount;
}

/* 上游余额行：按厂商归并，余额取该厂商最低值 */
function cchUpstreamRows(providers, balances, vendors) {
  providers = cchBalanceProviders(providers, vendors);
  const byId = new Map(providers.map((item) => [Number(item.id), item]));
  const info = cchGroupInfo(providers, vendors);
  const groups = new Map();

  for (const snapshot of Array.isArray(balances) ? balances : []) {
    /* 查不到余额的上游按原有方式单独配置，不在这里占行 */
    if (snapshot.status !== "ok") continue;
    const provider = byId.get(Number(snapshot.providerId));
    if (!provider) continue;

    const key = providerGroupKey(provider);
    let group = groups.get(key);
    if (!group) {
      const vendor = vendors ? vendors.get(Number(provider.providerVendorId)) : null;
      const meta = info.get(key);
      group = {
        label: (meta && meta.label) || providerLabel(provider, vendors),
        priority: meta ? meta.priority : null,
        domain: (vendor && vendor.domain) || providerHost(provider.url),
        currency: "USD",
        amount: null,
        unlimited: false,
      };
      groups.set(key, group);
    }

    group.currency = String(snapshot.currency || "").toUpperCase() || "USD";
    if (snapshot.unlimited) group.unlimited = true;
    const amount = numeric(snapshot.balance);
    if (amount !== null && (group.amount === null || amount < group.amount)) group.amount = amount;
  }

  /* 同名厂商（同一家在两个域名各有一条）用官网地址区分，避免看起来重复 */
  const labelCount = new Map();
  for (const group of groups.values()) {
    labelCount.set(group.label, (labelCount.get(group.label) || 0) + 1);
  }

  const rows = [];
  for (const group of groups.values()) {
    if (group.amount === null && !group.unlimited) continue;
    const label = labelCount.get(group.label) > 1 && group.domain
      ? `${group.label}（${group.domain}）`
      : group.label;
    const parts = [label];
    parts.push(group.unlimited ? "余额 不限量" : `余额 ${cchMoney(group.currency, group.amount)}`);
    rows.push({ amount: group.amount, priority: group.priority, parts });
  }

  rows.sort(compareRows);
  return rows;
}

/* ── CCHP：按 key 优先级排序的站点余额（Clouder 仍由 CCH 站点提供） ── */

/* CCHP 的 key 列表按 provider 逐个查，最多 5 个请求在途 */
const CCHP_KEY_CONCURRENCY = 5;

/* 模块 timeout=30 秒，而 CCHP 要串行跑 org-tree → providers → keys、keys 还要分批，
   累起来会直接把面板掐断（无输出）。$httpClient 没有超时参数、已发出的请求无法取消，
   只能按 27 秒总预算停止后续派发，把已拿到的余额先显示出来。 */
const CCHP_BUDGET_MS = 27000;
let cchpDeadlineAt = 0;

function cchpBeginBudget() {
  if (!cchpDeadlineAt) cchpDeadlineAt = Date.now() + CCHP_BUDGET_MS;
  return cchpDeadlineAt;
}

/* 每次派发请求前调用：预算耗尽就不发，调用方降级处理 */
function cchpBudgetSpent() {
  return cchpDeadlineAt > 0 && Date.now() >= cchpDeadlineAt;
}

function cchpTimeoutError() {
  const error = new Error("请求超时");
  error.code = "cchp_timeout";
  return error;
}

function cchpCacheKey(kind, base, orgId) {
  return `cchp_${kind}_${hashString(`${base}|${orgId}`)}`;
}

/* allowStale=true 时忽略时效，用于请求失败后回退旧值 */
function readCchpCache(kind, base, orgId, allowStale) {
  try {
    const raw = $persistentStore.read(cchpCacheKey(kind, base, orgId));
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (!cache || cache.version !== 1 || !Array.isArray(cache.items)) return null;
    const fresh = Date.now() - Number(cache.updatedAt || 0) < CCH_QUOTA_CACHE_SECONDS * 1000;
    if (!fresh && !allowStale) return null;
    return { items: cache.items, fresh };
  } catch (_) { return null; }
}

function writeCchpCache(kind, base, orgId, items) {
  try {
    $persistentStore.write(
      JSON.stringify({ version: 1, updatedAt: Date.now(), items }),
      cchpCacheKey(kind, base, orgId)
    );
  } catch (_) {}
  return items;
}

/* 组织树只用于取组织 ID，可缓存；失败时用旧 ID 继续查余额 */
function readCchpOrg(base, allowStale) {
  try {
    const raw = $persistentStore.read(`cchp_org_${hashString(base)}`);
    if (!raw) return "";
    const cache = JSON.parse(raw);
    if (!cache || cache.version !== 1 || !cache.orgId) return "";
    const fresh = Date.now() - Number(cache.updatedAt || 0) < CCH_QUOTA_CACHE_SECONDS * 1000;
    return fresh || allowStale ? String(cache.orgId) : "";
  } catch (_) { return ""; }
}

function writeCchpOrg(base, orgId) {
  try {
    $persistentStore.write(
      JSON.stringify({ version: 1, updatedAt: Date.now(), orgId }),
      `cchp_org_${hashString(base)}`
    );
  } catch (_) {}
}

async function fetchCchpOrgId(site, headers) {
  const cached = readCchpOrg(site.base, false);
  if (cached) return cached;
  try {
    if (cchpBudgetSpent()) throw cchpTimeoutError();
    const response = await request("get", `${site.base}/api/account/org-tree`, headers);
    checkStatus(response, "管理令牌");
    const root = parseBody(response).root;
    const orgId = String((root && root.id) || "").trim();
    if (!orgId) throw new Error("返回缺少组织 ID");
    writeCchpOrg(site.base, orgId);
    return orgId;
  } catch (error) {
    const stale = readCchpOrg(site.base, true);
    if (stale) return stale;
    throw error;
  }
}

/* 余额与优先级分开缓存：余额常变，优先级基本不变 */
async function fetchCchpProviders(site, orgId, headers) {
  const cached = readCchpCache("balance", site.base, orgId, false);
  if (cached) return { providers: cached.items, stale: false, timedOut: false };
  try {
    if (cchpBudgetSpent()) throw cchpTimeoutError();
    const response = await request("get", `${site.base}/api/account/orgs/${orgId}/providers`, headers);
    checkStatus(response, "管理令牌");
    const list = parseBody(response).providers;
    /* 200 但结构不对（网关错误页、字段改名）时不能当成空数组写缓存，否则会盖掉旧值 */
    if (!Array.isArray(list)) throw new Error("返回缺少 providers");
    const providers = list.map((item) => ({
      id: String(item.id || ""),
      name: String(item.name || ""),
      /* 官网地址：CCH 站点按域名匹配优先级时用 */
      host: String(item.website_url || ""),
      /* balance.accounts 会按 key 重复计数，只用 totals / total_usd */
      balance: item.balance && typeof item.balance === "object" ? item.balance : null,
    }));
    return { providers: writeCchpCache("balance", site.base, orgId, providers), stale: false, timedOut: false };
  } catch (error) {
    const stale = readCchpCache("balance", site.base, orgId, true);
    if (stale) {
      return { providers: stale.items, stale: true, timedOut: Boolean(error && error.code === "cchp_timeout") };
    }
    throw error;
  }
}

/* 优先级：active key 的最小值；没有 active key 时取全部 key 的最小值（仅作排序元数据） */
function cchpKeyPriority(keys) {
  const list = Array.isArray(keys) ? keys : [];
  const active = list.filter((key) => String(key.status || "").toLowerCase() === "active");
  const pool = active.length ? active : list;
  let best = null;
  for (const key of pool) {
    const priority = numeric(key.priority);
    if (priority !== null && (best === null || priority < best)) best = priority;
  }
  return best;
}

/* provider 可能不少，逐个查 key 时限制同时进行的请求数 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(run());
  await Promise.all(runners);
  return results;
}

/* 旧 priority 缓存按 provider ID 取用：请求失败时回退，缺旧值才算缺失 */
function cchpStalePriorities(site, orgId) {
  const stale = readCchpCache("priority", site.base, orgId, true);
  const map = new Map();
  for (const item of stale ? stale.items : []) {
    if (!item || item.id === undefined) continue;
    const priority = numeric(item.priority);
    if (priority !== null) map.set(String(item.id), priority);
  }
  return map;
}

async function fetchCchpPriorities(site, orgId, providers, headers) {
  const cached = readCchpCache("priority", site.base, orgId, false);
  if (cached) return { items: cached.items, missing: false, timedOut: false };
  let failed = false;
  let timedOut = false;
  /* 只有真正失败或被预算跳过的 provider 才回填旧值；成功返回空 keys 的保持 null */
  const failedIds = new Set();
  const items = await mapLimit(providers, CCHP_KEY_CONCURRENCY, async (provider) => {
    /* 预算耗尽就不再派发后续 key 请求，已发出的等它自己回来 */
    if (cchpBudgetSpent()) {
      timedOut = true;
      failed = true;
      failedIds.add(String(provider.id));
      return { id: provider.id, priority: null };
    }
    try {
      const response = await request(
        "get",
        `${site.base}/api/account/orgs/${orgId}/providers/${encodeURIComponent(provider.id)}/keys`,
        headers
      );
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      return { id: provider.id, priority: cchpKeyPriority(parseBody(response).keys) };
    } catch (error) {
      if (error && error.code === "cchp_timeout") timedOut = true;
      /* 单把 key 查不到只丢排序元数据，余额行照常显示 */
      failed = true;
      failedIds.add(String(provider.id));
      return { id: provider.id, priority: null };
    }
  });
  if (!failed) {
    return { items: writeCchpCache("priority", site.base, orgId, items), missing: false, timedOut: false };
  }
  /* 有失败：按 ID 用旧 priority 补，没有旧值才置 null；不写缓存，免得把缺失固化一轮 */
  const stale = cchpStalePriorities(site, orgId);
  let fellBack = false;
  const merged = items.map((item) => {
    if (numeric(item.priority) !== null) return item;
    /* 成功返回空 keys 的 provider 不属于失败集合，不回填旧值 */
    if (!failedIds.has(String(item.id))) return item;
    const old = stale.get(String(item.id));
    if (old === undefined) return { id: item.id, priority: null };
    fellBack = true;
    return { id: item.id, priority: old };
  });
  return { items: merged, missing: merged.some((item) => numeric(item.priority) === null), timedOut, fellBack };
}

async function fetchCchpSite(site, headers) {
  /* 从进入 CCHP 开始记总预算，后续每个请求派发前都检查 */
  cchpBeginBudget();
  const orgId = await fetchCchpOrgId(site, headers);
  const snapshot = await fetchCchpProviders(site, orgId, headers);
  const providers = snapshot.providers || [];
  const priorities = await fetchCchpPriorities(site, orgId, providers, headers);
  const priorityById = new Map(priorities.items.map((item) => [item.id, item.priority]));
  return {
    kind: "cchp",
    stale: snapshot.stale,
    /* 部分请求因总预算耗尽被跳过；priority 回退过旧值 / 回退后仍缺 */
    timedOut: Boolean(snapshot.timedOut || priorities.timedOut),
    priorityStale: Boolean(priorities.fellBack),
    priorityMissing: Boolean(priorities.missing),
    /* 保留 name/host/priority，供 cchSitePriorities 给 CCH 站点排序 */
    providers: providers.map((provider) => ({
      name: provider.name,
      host: provider.host,
      priority: priorityById.has(provider.id) ? priorityById.get(provider.id) : null,
      balance: provider.balance,
    })),
  };
}

/* 品牌取名称第一段：Clouder-Astra → Clouder */
function cchpIsClouder(name) {
  return providerBrand(name).toLowerCase() === "clouder";
}

/* totals 可能同时给多个币种，也可能同币种多条：各自按原单位拼接，不做汇率换算 */
function cchpAmountParts(balance) {
  const totals = Array.isArray(balance && balance.totals) ? balance.totals : [];
  const parts = [];
  for (const total of totals) {
    const amount = numeric(total && total.amount);
    if (amount === null) continue;
    const unit = String((total && total.unit) || "USD").trim().toUpperCase() || "USD";
    parts.push(cchMoney(unit, amount));
  }
  return parts;
}

/* 余额行：只显示 status=ok 且有数值（或 unlimited）的 provider；Clouder 由 CCH 站点提供 */
function cchpRows(data) {
  const rows = [];
  for (const provider of data.providers || []) {
    if (cchpIsClouder(provider.name)) continue;
    const balance = provider.balance || {};
    if (String(balance.status || "").toLowerCase() !== "ok") continue;
    const unlimited = balance.unlimited === true;
    /* 排序只用 total_usd：不同币种的原值不能直接比较，缺失时 amount=null 排最后 */
    const totalUsd = numeric(balance.total_usd);
    const totals = cchpAmountParts(balance);
    if (!unlimited && !totals.length && totalUsd === null) continue;
    let text;
    if (unlimited) text = "余额 不限量";
    else if (totals.length) text = `余额 ${totals.join(" + ")}`;
    else text = `余额 ${money(totalUsd)}`;
    rows.push({ amount: totalUsd, priority: provider.priority, parts: [providerBrand(provider.name), text] });
  }
  rows.sort(compareRows);
  return rows;
}

/* 行不显示时用警告色提示：状态非 ok，或既无金额也无不限量 */
function cchpAbnormal(data) {
  for (const provider of data.providers || []) {
    if (cchpIsClouder(provider.name)) continue;
    const balance = provider.balance || {};
    if (String(balance.status || "").toLowerCase() !== "ok") return true;
    const hasAmount = cchpAmountParts(balance).length > 0 || numeric(balance.total_usd) !== null;
    if (!hasAmount && balance.unlimited !== true) return true;
  }
  return false;
}

/* 显示中的余额超过 24 小时未复查时提示 */
function cchpOld(data) {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const provider of data.providers || []) {
    if (cchpIsClouder(provider.name)) continue;
    const balance = provider.balance || {};
    if (String(balance.status || "").toLowerCase() !== "ok") continue;
    const stamp = Date.parse(String(balance.oldest_checked_at || balance.checked_at || ""));
    if (Number.isFinite(stamp) && stamp < cutoff) return true;
  }
  return false;
}

/* 站点优先级：配置里显式写了就用它，否则按域名（其次名称）匹配主 CCH 里的厂商，
   取该厂商各供应商的最小优先级——查不到余额的站点靠这一步排进正确位置 */
function cchSitePriorities(results) {
  const byDomain = new Map();
  const byName = new Map();

  for (const item of results) {
    if (!item.data) continue;

    /* CCHP 的 provider 自带 key 优先级：Clouder 的 CCH 站点靠这里排回 1 */
    if (item.data.kind === "cchp") {
      for (const provider of item.data.providers || []) {
        const priority = numeric(provider.priority);
        if (priority === null) continue;
        const domain = providerHost(provider.host);
        if (domain && (byDomain.get(domain) === undefined || priority < byDomain.get(domain))) {
          byDomain.set(domain, priority);
        }
        for (const name of [provider.name, providerBrand(provider.name)]) {
          const key = String(name || "").trim().toLowerCase();
          if (key && (byName.get(key) === undefined || priority < byName.get(key))) {
            byName.set(key, priority);
          }
        }
      }
      continue;
    }

    if (item.data.kind !== "admin") continue;
    const vendors = item.data.vendors;
    for (const provider of item.data.providers || []) {
      const priority = Number(provider.priority);
      if (!Number.isFinite(priority)) continue;

      const vendor = vendors ? vendors.get(Number(provider.providerVendorId)) : null;
      const domain = (vendor && vendor.domain) || providerHost(provider.url);
      if (domain && (byDomain.get(domain) === undefined || priority < byDomain.get(domain))) {
        byDomain.set(domain, priority);
      }

      const name = vendor && vendor.name ? vendor.name.toLowerCase() : "";
      if (name && (byName.get(name) === undefined || priority < byName.get(name))) {
        byName.set(name, priority);
      }
    }
  }

  return { byDomain, byName };
}

function cchSitePriority(site, priorities) {
  if (site.priority !== null && site.priority !== undefined) return site.priority;
  const domain = providerHost(site.base);
  if (priorities.byDomain.has(domain)) return priorities.byDomain.get(domain);
  const name = String(site.name || "").toLowerCase();
  if (name && priorities.byName.has(name)) return priorities.byName.get(name);
  return null;
}

/* CCH / CCHP 各站余额合成一张表：admin 站点展开各上游，CCHP 站点展开各 provider，
   user/cookie/login 站点是该站账户余额 */
function cchBalanceLines(results, wrap) {
  const lines = [];
  const rows = [];
  const priorities = cchSitePriorities(results);

  for (const item of results) {
    /* 取数失败或查不到余额的都不占行，只由面板图标变色提示 */
    if (item.error) continue;
    if (item.data.kind === "admin") {
      for (const row of cchUpstreamRows(item.data.providers || [], item.data.balances, item.data.vendors)) {
        rows.push(row);
      }
      continue;
    }
    if (item.data.kind === "cchp") {
      for (const row of cchpRows(item.data)) rows.push(row);
      continue;
    }
    const total = item.data.total;
    const amount = total ? total.limit - total.used : null;
    rows.push({
      amount,
      priority: cchSitePriority(item.site, priorities),
      parts: [item.site.name, total ? `余额 ${money(amount)}` : "余额 未设置"],
    });
  }

  rows.sort(compareRows);

  if (rows.length) {
    /* 站名与金额固定同一行；金额放不下时自动落到下一行 */
    for (const row of rows.slice(0, CCH_ADMIN_MAX)) {
      if (wrap) {
        for (const line of layoutRows(row.parts, CCH_ROW_WIDTH)) lines.push(line);
      } else {
        lines.push(row.parts.join(" · "));
      }
    }
    if (rows.length > CCH_ADMIN_MAX) lines.push(`另有 ${rows.length - CCH_ADMIN_MAX} 个上游`);
  } else {
    lines.push("未获取到余额");
  }

  /* 限额取自 admin 站点，多个 admin 站点时带站名区分；与余额之间空一行 */
  const details = [];
  const admins = results.filter((item) => item.data && item.data.kind === "admin");
  for (const item of admins) {
    if (!CCH_SHOW_LIMITS) continue;
    const prefix = admins.length > 1 ? `${item.site.name} · ` : "";
    for (const line of cchLimitLines(item.data)) details.push(prefix + line);
  }
  if (details.length) {
    lines.push("");
    for (const line of details) lines.push(line);
  }

  /* CCHP 的余额可能来自旧缓存，或上游太久没复查，底部给出提示 */
  const notices = [];
  const cchpItems = results.filter((item) => item.data && item.data.kind === "cchp");
  if (cchpItems.some((item) => item.data.stale)) notices.push("⚠️ CCHP 余额来自缓存");
  if (cchpItems.some((item) => cchpOld(item.data))) notices.push("⚠️ 部分余额较旧");
  /* 超时会连带造成 priority 缺失，两者只提示一次；整站超时也要提示 */
  const cchpTimedOut = cchpItems.some((item) => item.data.timedOut)
    || results.some((item) => item.error && item.error.code === "cchp_timeout");
  if (cchpTimedOut) notices.push("⚠️ 部分请求超时");
  else if (cchpItems.some((item) => item.data.priorityMissing)) notices.push("⚠️ 部分排序信息缺失");
  if (notices.length) {
    lines.push("");
    for (const line of notices) lines.push(line);
  }
  return lines;
}

/* 供应商限额（5 小时/日/周/月用量），默认不展示 */
function cchLimitLines(data) {
  const lines = [];
  const providers = Array.isArray(data.quota && data.quota.providers) ? data.quota.providers : [];
  /* 只列设了限额的供应商，按使用率从高到低 */
  const limited = providers
    .filter((provider) => provider.quota)
    .sort((a, b) => {
      const left = a.quota ? a.quota.ratio : 0;
      const right = b.quota ? b.quota.ratio : 0;
      return right - left;
    });

  if (!limited.length) {
    lines.push("未设置供应商限额");
    return lines;
  }
  for (const provider of limited.slice(0, CCH_ADMIN_MAX)) {
    lines.push(`${provider.name} ${formatUsagePercent(provider.quota.ratio)} · 额度 ${money(provider.quota.current)}/${money(provider.quota.limit)}`);
  }
  if (limited.length > CCH_ADMIN_MAX) lines.push(`另有 ${limited.length - CCH_ADMIN_MAX} 个限额供应商`);
  if (data.stale) lines.push("⚠️ 额度来自缓存");
  return lines;
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

  /* CCHP：余额状态异常（行不显示）或用了旧缓存时给提示色 */
  if (data.kind === "cchp") {
    let risk = 0;
    if (data.stale) risk = 1;
    if (data.timedOut || data.priorityMissing) risk = Math.max(risk, 1);
    if (cchpAbnormal(data)) risk = Math.max(risk, 1);
    return risk;
  }

  let risk = 0;

  /* 余额一条都查不到时给个提示色：上游可能都换了密钥或都不可达 */
  if (Array.isArray(data.balances) && data.balances.length
    && data.balances.every((item) => item.status !== "ok")) {
    risk = Math.max(risk, 1);
  }

  const providers = Array.isArray(data.quota && data.quota.providers) ? data.quota.providers : [];
  for (const provider of providers) {
    if (!provider.quota) continue;
    if (provider.quota.ratio >= 0.95) risk = Math.max(risk, 2);
    else if (provider.quota.ratio >= 0.8) risk = Math.max(risk, 1);
  }
  if (data.stale) risk = Math.max(risk, 1);
  return risk;
}

/* ── 币种 ── */

const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

function currencySymbol(currency) {
  return CURRENCY_SYMBOLS[String(currency || "").toUpperCase()] || "";
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

/* 每个站点各自取数，一个站点失败只影响它自己那行 */
async function fetchCchResults() {
  const sites = collectCchSites();
  return Promise.all(sites.map((site) => fetchCchSite(site).then(
    (data) => ({ site, data }),
    (error) => ({ site, error: error || new Error("请求失败") })
  )));
}

/* ── 面板 ── */

async function runPanel() {
  const cchResults = await fetchCchResults();
  if (!cchResults.length) return finish("未配置", PANEL_ICON, "8E8E93");

  const lines = cchBalanceLines(cchResults, true);
  lines.push("");
  lines.push(`更新 ${formatTime()}`);

  /* 风险色取各站点最高值：站点取数失败或余额整体查不到都会变色 */
  let risk = 0;
  for (const item of cchResults) {
    if (item.error) risk = Math.max(risk, 1);
    else if (item.data) risk = Math.max(risk, cchRisk(item.data));
  }
  if (cchResults.every((item) => item.error)) risk = 2;

  const color = risk >= 2 ? PANEL_DANGER_COLOR : risk >= 1 ? PANEL_WARN_COLOR : PANEL_ICON_COLOR;
  finish(lines.join("\n"), PANEL_ICON, color);
}

/* ── 日报 ── */

async function runDaily() {
  const dailyFlag = String(ARGS.aiapi_daily_notify || "true").trim().toLowerCase();
  if (dailyFlag === "false" || dailyFlag === "0" || dailyFlag === "no" || dailyFlag === "off") return $done();

  const cchResults = await fetchCchResults();
  if (!cchResults.length) return $done();

  const body = ["【余额】"].concat(cchBalanceLines(cchResults, false)).join("\n");
  $notification.post(`${PANEL_TITLE} 日报`, `CCH ${cchResults.length}`, body);
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
