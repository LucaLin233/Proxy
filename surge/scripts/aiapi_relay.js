/* AI 中转站面板（mode=panel，默认）与日报（mode=daily，每天 23:50 推送同一列表）。
   CCH admin 列本站各上游余额，user/cookie/login 取账户余额，CCHP 按组织取 provider 余额并按 key 优先级排序，
   cmdcode 读 CommandCode 限额。参数用 cch_*，模块级用 aiapi_* */

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
/* 额度缓存秒数：模块默认传 600；直接调用脚本且未传 cch_quota_interval 时回退 300 */
const CCH_QUOTA_CACHE_SECONDS = intArg(ARGS.cch_quota_interval, 300, 60, 3600);
/* 月度额度上限（USD），默认 70；填非法值时 M 段回退成剩余金额 */
const CMDCODE_MONTH_CAP = monthCapArg(ARGS.cch_cmdcode_month_cap, 70);
/* 供应商限额（5 小时/日/周/月）默认不展示 */
const CCH_SHOW_LIMITS = boolArg(ARGS.cch_show_limits, false);
/* 一个 provider 对应一个上游账户：默认只刷代表 key、只显示该账户金额，
   避免同一账户被拆成两条后 totals 双计 */
const CCHP_SINGLE_ACCOUNT = boolArg(ARGS.aiapi_cchp_single_account, true);

function intArg(value, fallback, min, max) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (text === "") return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function boolArg(value, fallback) {
  const text = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  if (text === "") return fallback;
  if (text === "true" || text === "1" || text === "yes" || text === "on") return true;
  if (text === "false" || text === "0" || text === "no" || text === "off") return false;
  return fallback;
}

function monthCapArg(value, fallback) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (text === "") return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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

/* 按上游原币种展示，不做汇率换算 */
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

function truncateToWidth(text, budget) {
  const source = String(text);
  if (budget <= 0) return "";
  if (measure(source) <= budget) return source;
  if (budget <= 1) return "…";
  let out = "";
  for (const char of source) {
    if (measure(`${out}${char}…`) > budget) break;
    out += char;
  }
  /* 截断点正好落在分隔符上时先收干净，避免出现「 + …」 */
  out = out.replace(/[\s·+]+$/, "");
  return `${out}…`;
}

/* 单行收尾：先从尾部舍字段并截短名称，保证 measure(join(" · ")) <= budget */
function fitRowWidth(parts, budget) {
  const list = parts.map((part) => String(part === undefined || part === null ? "" : part))
    .filter((part) => part !== "");
  if (!list.length) return [];
  if (measure(list.join(" · ")) <= budget) return list;
  const name = list[0];
  for (let count = list.length - 1; count >= 1; count--) {
    const rest = list.slice(1, count + 1);
    const room = budget - measure(rest.join(" · ")) - 3;
    if (room >= 2) return [truncateToWidth(name, room)].concat(rest);
  }
  return [truncateToWidth(list.join(" · "), budget)];
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/* ── 凭据指纹：SHA-256（纯 JS）。FNV-1a 只有 32 位，可能让不同凭据撞到同一缓存键；
   调用方取前 32 位十六进制，原始凭据不落盘 ── */
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_INIT = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function utf8Bytes(text) {
  const bytes = [];
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  return bytes;
}

function sha256Hex(text) {
  const bytes = utf8Bytes(text);
  /* 补位：0x80 + 若干 0 + 64bit 比特长度；块数按「长度 + 8 + 1」向上取整 */
  const blocks = ((bytes.length + 8) >> 6) + 1;
  const words = [];
  for (let i = 0; i < blocks * 16; i++) words.push(0);
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  }
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
  const bits = bytes.length * 8;
  words[blocks * 16 - 1] = bits >>> 0;
  words[blocks * 16 - 2] = Math.floor(bits / 0x100000000) >>> 0;

  let h0 = SHA256_INIT[0], h1 = SHA256_INIT[1], h2 = SHA256_INIT[2], h3 = SHA256_INIT[3];
  let h4 = SHA256_INIT[4], h5 = SHA256_INIT[5], h6 = SHA256_INIT[6], h7 = SHA256_INIT[7];
  const w = [];
  for (let block = 0; block < blocks; block++) {
    for (let i = 0; i < 16; i++) w[i] = words[block * 16 + i] | 0;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25))
        + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22))
        + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("");
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

/* 诊断日志只在异常路径打一行摘要 */
function cchpLog(message) {
  try {
    if (typeof console !== "undefined" && console.log) console.log(`[aiapi] ${message}`);
  } catch (_) {}
}

/* ── CCH：各上游余额（限额可选） ── */

const CCH_MODES = ["user", "cookie", "admin", "login", "cchp", "cmdcode"];
const CCH_BALANCE_MAX_IDS = 50;
const CCH_WINDOWS = [
  ["cost5h", "5 小时"],
  ["costDaily", "日"],
  ["costWeekly", "周"],
  ["costMonthly", "月"],
  ["limitTotalUsd", "总额"],
];

/* problem+json 的 errorCode 能区分「没带凭据」与「凭据无效」 */
function problemCode(body) {
  try {
    const json = JSON.parse(body);
    return json && json.errorCode ? `（${json.errorCode}）` : "";
  } catch (_) { return ""; }
}

function checkStatus(response, label) {
  if (response.status === 401) {
    cchpLog(`${label} HTTP 401 ${problemCode(response.body)}`);
    throw new Error(`${label}被拒${problemCode(response.body)}`);
  }
  if (response.status === 403) {
    cchpLog(`${label} HTTP 403`);
    throw new Error("无权限，请检查令牌权限");
  }
  if (response.status === 404) {
    cchpLog(`${label} HTTP 404`);
    throw new Error("接口不存在，请检查地址与版本");
  }
  if (response.status !== 200) {
    cchpLog(`${label} HTTP ${response.status}`);
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
}

/* 站点写法：名称@地址=凭据[:模式][:优先级]，竖线分隔；模式省略即 user */
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
      /* 也接受文档里表示可选的方括号（[:admin]、:admin]） */
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

/* CCH 用各上游自己保存的密钥查询，面板不接触上游密钥。
   失败返回 null，以区别于「查到了但没有余额」 */
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
    /* 用量端点失败只降级为未设置限额 */
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

async function fetchCchLoginSite(site) {
  const cached = readSession(site.base);
  if (cached) {
    try {
      return await fetchCchUserSite(site, { Accept: "application/json", Cookie: `auth-token=${cached}` });
    } catch (_) {
    }
  }
  const session = await loginWithKey(site.base, site.credential);
  writeSession(site.base, session.token, session.maxAge);
  return fetchCchUserSite(site, { Accept: "application/json", Cookie: `auth-token=${session.token}` });
}

async function fetchCchSite(site) {
  const headers = { Accept: "application/json" };
  if (site.mode === "cookie") headers.Cookie = `auth-token=${site.credential}`;
  else if (site.mode === "admin" || site.mode === "cchp" || site.mode === "cmdcode") headers.Authorization = `Bearer ${site.credential}`;
  else headers["X-API-Key"] = site.credential;

  if (site.mode === "admin") return fetchCchAdminSite(site, headers);
  if (site.mode === "cmdcode") return fetchCommandCodeSite(site, headers);
  if (site.mode === "cchp") return fetchCchpSite(site, headers);
  if (site.mode === "login") return fetchCchLoginSite(site);
  return fetchCchUserSite(site, headers);
}

function formatUsagePercent(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

/* 同一上游常有多个供应商条目，按地址归并 */
function providerHost(url) {
  const text = String(url || "").trim();
  const match = /^(?:https?:\/\/)?([^/?#]+)/i.exec(text);
  return (match ? match[1] : text).toLowerCase();
}

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

/* 只查启用上游；Clouder 单独查询、Miapi 不限余额，都不从主 CCH 取 */
function cchBalanceProviders(providers, vendors) {
  const ignoredBrands = ["clouder", "miapi"];
  return providers.filter((provider) => {
    if (provider.isEnabled === false) return false;
    const vendor = vendors ? vendors.get(Number(provider.providerVendorId)) : null;
    return !ignoredBrands.includes(providerBrand(provider.name).toLowerCase())
      && !ignoredBrands.includes(providerBrand(vendor && vendor.name).toLowerCase());
  });
}

/* 厂商分组：显示名取供应商名的品牌部分，名称不一致才用厂商名；优先级取组内最小值 */
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

/* 兜底行序：只在行没有优先级时使用，与 scripting/aiapi/relay.core.ts 的 ROW_ORDER 保持一致；
   按名称前缀归类（Kcne-Astra → Kcne），不在表里的排最后 */
const PANEL_ROW_ORDER = ["commandcode", "clouder", "kcne", "air"];

function rowOrderRank(name) {
  const text = String(name || "").trim().toLowerCase();
  if (!text) return PANEL_ROW_ORDER.length;
  for (let index = 0; index < PANEL_ROW_ORDER.length; index += 1) {
    const token = PANEL_ROW_ORDER[index];
    if (text === token) return index;
    if (text.startsWith(token) && /^[-_\s·]/.test(text.slice(token.length))) return index;
  }
  return PANEL_ROW_ORDER.length;
}

/* 排序：优先级升序，没有优先级的排在后面并按 PANEL_ROW_ORDER 兜底；再按名称、插入序号。
   金额不参与排序，余额变化不会让行序跳动 */
function compareRows(a, b) {
  const leftPriority = numeric(a.priority);
  const rightPriority = numeric(b.priority);
  if (leftPriority !== null && rightPriority !== null) {
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  } else if (leftPriority !== rightPriority) {
    return leftPriority === null ? 1 : -1;
  } else {
    const leftRank = rowOrderRank(a.name);
    const rightRank = rowOrderRank(b.name);
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  const leftName = String(a.name || "").toLowerCase();
  const rightName = String(b.name || "").toLowerCase();
  if (leftName !== rightName) {
    /* localeCompare 判等时用码位兜底 */
    let order = 0;
    if (typeof leftName.localeCompare === "function") order = leftName.localeCompare(rightName);
    if (order) return order < 0 ? -1 : 1;
    return leftName < rightName ? -1 : 1;
  }

  const leftSeq = typeof a.seq === "number" ? a.seq : 0;
  const rightSeq = typeof b.seq === "number" ? b.seq : 0;
  return leftSeq - rightSeq;
}

/* 上游余额行：按厂商归并，取该厂商最低余额 */
function cchUpstreamRows(providers, balances, vendors) {
  providers = cchBalanceProviders(providers, vendors);
  const byId = new Map(providers.map((item) => [Number(item.id), item]));
  const info = cchGroupInfo(providers, vendors);
  const groups = new Map();

  for (const snapshot of Array.isArray(balances) ? balances : []) {
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

  /* 同名厂商用官网地址区分 */
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
    rows.push({ amount: group.amount, priority: group.priority, name: label, parts });
  }

  return rows;
}

/* ── CCHP：按 key 优先级排序的站点余额（Clouder 仍由 CCH 站点提供） ── */

const CCHP_KEY_CONCURRENCY = 5;

/* 页数上限防止服务端游标不前进时死循环 */
const CCHP_KEY_PAGE_LIMIT = 100;
const CCHP_KEY_PAGE_MAX = 10;

/* CCHP 要串行请求 org-tree → providers → keys 分页 → 逐把 key 复查，请求数随 key 放大。
   已发出的请求无法取消，所以 27 秒总预算（模块 timeout=30）同时限制派发与等待：
   到点即降级，晚到的响应丢弃 */
const CCHP_BUDGET_MS = 27000;
let cchpDeadlineAt = 0;

function cchpBeginBudget() {
  if (!cchpDeadlineAt) cchpDeadlineAt = Date.now() + CCHP_BUDGET_MS;
  return cchpDeadlineAt;
}

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

/* allowStale：请求失败后回退旧值 */
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
    const response = await cchpRequest("get", `${site.base}/api/account/org-tree`, headers);
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

/* Mi（miapi）与原 CCH 一致：不进余额行，也不查 keys / 刷新上游 */
function cchpHidden(provider) {
  if (!provider) return false;
  if (providerBrand(provider.name).toLowerCase() === "mi") return true;
  return String(provider.slug || "").trim().toLowerCase().includes("miapi");
}

async function fetchCchpProviderList(site, orgId, headers) {
  const response = await cchpRequest("get", `${site.base}/api/account/orgs/${orgId}/providers`, headers);
  checkStatus(response, "管理令牌");
  const list = parseBody(response).providers;
  /* 200 但结构不对（网关错误页、字段改名）不能当空数组写缓存，否则会盖掉旧值 */
  if (!Array.isArray(list)) throw new Error("返回缺少 providers");
  return list.map((item) => ({
    id: String(item.id || ""),
    name: String(item.name || ""),
    /* 上游仓库名（如 miapi-ds） */
    slug: String(item.slug || ""),
    /* 官网地址：CCH 站点按域名匹配优先级 */
    host: String(item.website_url || ""),
    /* balance.accounts 会按 key 重复计数，只用 totals / total_usd */
    balance: item.balance && typeof item.balance === "object" ? item.balance : null,
  })).filter((provider) => !cchpHidden(provider));
}

/* 每次刷新都请求列表；上次快照只在列表请求本身失败时兜底（stale=true） */
async function fetchCchpProviders(site, orgId, headers) {
  try {
    if (cchpBudgetSpent()) throw cchpTimeoutError();
    const providers = await fetchCchpProviderList(site, orgId, headers);
    return { providers: writeCchpCache("balance", site.base, orgId, providers), stale: false, timedOut: false };
  } catch (error) {
    cchpLog(`providers 请求失败，回退快照: ${(error && error.message) || error}`);
    const stale = readCchpCache("balance", site.base, orgId, true);
    if (stale) {
      return {
        providers: stale.items.filter((provider) => !cchpHidden(provider)),
        stale: true,
        timedOut: Boolean(error && error.code === "cchp_timeout"),
      };
    }
    throw error;
  }
}

/* 优先级取 active key 最小值；没有 active key 时取全部 key */
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

/* 关闭单账户模式时刷新全部 active key（原因见 refreshCchpBalances） */
function cchpKeyIds(keys) {
  const list = Array.isArray(keys) ? keys : [];
  return list.filter((key) => String(key.status || "").toLowerCase() === "active"
    && String(key.id || "").trim()).map((key) => String(key.id));
}

/* 代表 key：active keyIds 去重后按字符串升序取第一 */
function cchpRepresentativeKey(keyIds) {
  const unique = new Set();
  for (const id of Array.isArray(keyIds) ? keyIds : []) {
    const text = String(id || "").trim();
    if (text) unique.add(text);
  }
  const sorted = Array.from(unique).sort();
  return sorted.length ? sorted[0] : "";
}

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

/* CCHP 1.0.12 起 /providers/{id}/keys 已 404：改用分页接口取全量 key（nextCursor / after）；
   partial/preparing 表示服务端还没备齐，按取数不完整处理 */
async function fetchCchpKeyPages(site, orgId, headers) {
  const keys = [];
  let cursor = "";
  /* 游标重复或成环时结果不可信，按取数不完整处理 */
  const seen = new Set();
  for (let page = 0; page < CCHP_KEY_PAGE_MAX; page += 1) {
    if (cchpBudgetSpent()) throw cchpTimeoutError();
    const query = `limit=${CCHP_KEY_PAGE_LIMIT}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
    const response = await cchpRequest(
      "get",
      `${site.base}/api/account/orgs/${orgId}/providers/keys/page?${query}`,
      headers
    );
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const body = parseBody(response);
    const list = body.keys;
    /* 200 但缺 keys 不能当成没有 key */
    if (!Array.isArray(list)) throw new Error("返回缺少 keys");
    for (const key of list) keys.push(key);
    if (body.partial === true || body.preparing === true) return { keys, complete: false };
    const next = String(body.nextCursor || "").trim();
    if (!next) return { keys, complete: true };
    if (seen.has(next)) {
      cchpLog(`keys/page 游标未前进（重复或成环），本轮不据 key 隐藏行: ${next}`);
      return { keys, complete: false };
    }
    seen.add(next);
    cursor = next;
  }
  return { keys, complete: false };
}

function cchpPriorityItems(providers, keys) {
  const groups = new Map();
  for (const key of Array.isArray(keys) ? keys : []) {
    const id = String((key && key.provider_id) || "").trim();
    if (!id) continue;
    const list = groups.get(id);
    if (list) list.push(key);
    else groups.set(id, [key]);
  }
  return providers.map((provider) => {
    const list = groups.get(String(provider.id)) || [];
    return { id: provider.id, priority: cchpKeyPriority(list), keyIds: cchpKeyIds(list) };
  });
}

/* key 优先级与 keyIds 每轮实取，启停当轮生效。只有分页取全时才按「无 active key」隐藏行；
   取不全时不隐藏任何行，priority 留空、按 PANEL_ROW_ORDER 兜底，并提示「部分排序信息缺失」 */
async function fetchCchpPriorities(site, orgId, providers, headers) {
  let timedOut = false;
  try {
    const pages = await fetchCchpKeyPages(site, orgId, headers);
    if (pages.complete) {
      const items = cchpPriorityItems(providers, pages.keys);
      return {
        items,
        missing: items.some((item) => numeric(item.priority) === null),
        timedOut: false,
        keysComplete: true,
      };
    }
    cchpLog("keys/page 未就绪（partial/preparing 或页数用满），本轮不据 key 隐藏行");
  } catch (error) {
    if (error && error.code === "cchp_timeout") timedOut = true;
    cchpLog(`keys/page 请求失败，本轮不据 key 隐藏行: ${(error && error.message) || error}`);
  }
  const items = providers.map((provider) => ({ id: provider.id, priority: null, keyIds: [] }));
  return {
    items,
    missing: items.some((item) => numeric(item.priority) === null),
    timedOut,
    keysComplete: false,
  };
}

/* 今日用量与供应商健康只用于展示，失败或预算耗尽静默降级 */
async function fetchCchpSummary(site, headers) {
  const response = await request("get", `${site.base}/api/account/usage/summary`, headers);
  checkStatus(response, "管理令牌");
  const today = parseBody(response).today;
  if (!today || typeof today !== "object") throw new Error("返回缺少 today");
  return {
    requests: numeric(today.requests),
    successRate: numeric(today.successRate),
    avgTtftMs: numeric(today.avgTtftMs),
  };
}

async function fetchCchpHealth(site, headers) {
  const response = await request(
    "get",
    `${site.base}/api/account/usage/provider-health?since=24h&limit=50`,
    headers
  );
  checkStatus(response, "管理令牌");
  const rows = parseBody(response).rows;
  /* 200 但缺 rows 按失败处理，避免把空表当成没有请求 */
  if (!Array.isArray(rows)) throw new Error("返回缺少 rows");
  const map = new Map();
  for (const row of rows) {
    const id = String((row && row.providerId) || "").trim();
    if (!id) continue;
    map.set(id, {
      successRate: numeric(row.successRate),
      ttftP50Ms: numeric(row.ttftP50Ms),
      requests: numeric(row.requests),
    });
  }
  return map;
}

/* 与剩余预算赛跑：超时或失败返回 null */
function cchpWithin(leftMs, promise) {
  if (!(leftMs > 0)) return Promise.resolve(null);
  let timer = 0;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), leftMs);
  });
  const settled = promise.then(
    (value) => (value === undefined ? null : value),
    () => null
  );
  return Promise.race([settled, timeout]).then((value) => {
    clearTimeout(timer);
    return value === undefined ? null : value;
  });
}

/* 带预算的请求：到点抛 cchp_timeout 交给降级分支；晚到的响应在这里被接住丢弃，不会变成未捕获异常 */
async function cchpRequest(method, url, headers) {
  const left = cchpDeadlineAt - Date.now();
  if (!(left > 0)) throw cchpTimeoutError();
  const settled = await cchpWithin(left, request(method, url, headers).then(
    (value) => ({ value }),
    (error) => ({ error })
  ));
  if (settled === null) throw cchpTimeoutError();
  if (settled.error) throw settled.error;
  return settled.value;
}

async function fetchCchpUsage(site, headers) {
  const left = cchpDeadlineAt - Date.now();
  if (cchpBudgetSpent() || !(left > 0)) return { summary: null, health: null };
  const results = await Promise.all([
    cchpWithin(left, fetchCchpSummary(site, headers)),
    cchpWithin(left, fetchCchpHealth(site, headers)),
  ]);
  return { summary: results[0], health: results[1] };
}

/* 余额实时化：对目标 key 调 ?refresh=true，成功后调用方要再取一次列表拿服务端聚合值。
   关闭单账户模式时每把 active key 都刷：同一账户只刷一把，另一把会停在旧值，CCHP 会把它拆成两条并重复计入总额。
   余额接口有频率限制：每把 key 只发一次、失败不重试。ok < total 即刷新不全；单账户模式按 provider 计数 */
async function refreshCchpBalances(site, orgId, providers, headers) {
  /* Clouder 由 CCH 站点提供、unsupported 不支持查余额、无 active key 的不出行，三者都不算刷新目标；
     缺 keyIds 的可见 provider 仍计入 total，由调用方提示未刷新 */
  const visible = providers.filter((provider) => !cchpIsClouder(provider.name)
    && !cchpUnsupported(provider.status)
    && !provider.noActiveKey);
  let total = 0;
  const targets = [];
  for (const provider of visible) {
    const keyIds = Array.isArray(provider.keyIds) ? provider.keyIds : [];
    if (CCHP_SINGLE_ACCOUNT) {
      total += 1;
      const keyId = cchpRepresentativeKey(keyIds);
      if (keyId) targets.push({ id: provider.id, keyId });
      continue;
    }
    if (!keyIds.length) {
      total += 1;
      continue;
    }
    total += keyIds.length;
    for (const keyId of keyIds) targets.push({ id: provider.id, keyId });
  }
  if (!targets.length) return { ok: 0, total, timedOut: false };
  if (cchpBudgetSpent()) return { ok: 0, total, timedOut: true };
  let ok = 0;
  let timedOut = false;
  await mapLimit(targets, CCHP_KEY_CONCURRENCY, async (target) => {
    if (cchpBudgetSpent()) {
      timedOut = true;
      return;
    }
    try {
      const url = `${site.base}/api/account/orgs/${orgId}/providers/${encodeURIComponent(target.id)}`
        + `/keys/${encodeURIComponent(target.keyId)}/balance?refresh=true`;
      const response = await cchpRequest("get", url, headers);
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const body = parseBody(response);
      if (body && body.error) throw new Error("上游查询失败");
      ok += 1;
    } catch (error) { /* 单把 key 失败只降级；超时单独标记 */
      if (error && error.code === "cchp_timeout") timedOut = true;
    }
  });
  return { ok, total, timedOut: timedOut || cchpBudgetSpent() };
}

async function fetchCchpSite(site, headers) {
  cchpBeginBudget();
  const orgId = await fetchCchpOrgId(site, headers);
  const snapshot = await fetchCchpProviders(site, orgId, headers);
  const providers = snapshot.providers || [];
  const priorities = await fetchCchpPriorities(site, orgId, providers, headers);
  const priorityById = new Map(priorities.items.map((item) => [item.id, item.priority]));
  const keyIdsById = new Map(
    priorities.items.map((item) => [String(item.id), Array.isArray(item.keyIds) ? item.keyIds : []])
  );
  /* keys/page 取全且一把 active key 都没有：按已停用处理，不出行（Clouder 除外） */
  const noActiveKeyOf = (provider) => Boolean(priorities.keysComplete)
    && !(keyIdsById.get(String(provider.id)) || []).length
    && !cchpIsClouder(provider.name);
  /* 列表回退旧快照时不再刷新；刷新不全时沿用首次列表值并标 balanceStale */
  let current = providers;
  let balanceStale = false;
  let balancePartial = false;
  let balanceTimedOut = false;
  let balanceSuppressStale = false;
  if (!snapshot.stale && providers.length) {
    const refresh = await refreshCchpBalances(
      site,
      orgId,
      providers.map((provider) => ({ id: provider.id, name: provider.name,
        status: provider.balance ? provider.balance.status : null,
        noActiveKey: noActiveKeyOf(provider),
        keyIds: keyIdsById.get(String(provider.id)) || [] })),
      headers
    );
    if (refresh.timedOut) balanceTimedOut = true;
    if (refresh.ok < refresh.total) {
      balanceStale = true;
      /* 部分成功只提示「部分未刷新」 */
      balancePartial = refresh.ok > 0;
    }
    /* 只要有成功就重取列表，拿刷新后的聚合值 */
    if (refresh.ok > 0) {
      try {
        if (cchpBudgetSpent()) throw cchpTimeoutError();
        current = await fetchCchpProviderList(site, orgId, headers);
      } catch (error) {
        if (error && error.code === "cchp_timeout") {
          balanceTimedOut = true;
          /* 刷新本身不全时超时提示已能解释，不再重复「未刷新」 */
          balanceSuppressStale = refresh.ok < refresh.total;
        }
        balanceStale = true;
        balancePartial = false;
      }
    }
    writeCchpCache("balance", site.base, orgId, current);
  }
  const usage = await fetchCchpUsage(site, headers);
  /* 单账户投影只作用于展示，缓存里仍是原始快照 */
  let singleAccountUnavailable = false;
  const displayProviders = current.map((provider) => {
    const noActiveKey = noActiveKeyOf(provider);
    let balance = provider.balance;
    /* Clouder、unsupported、无 active key 的 provider 不投影 */
    if (!noActiveKey && CCHP_SINGLE_ACCOUNT && !cchpIsClouder(provider.name)
      && !cchpUnsupported(provider.balance && provider.balance.status)) {
      const view = cchpSingleAccountView(
        provider.balance,
        cchpRepresentativeKey(keyIdsById.get(String(provider.id)) || [])
      );
      balance = view.balance;
      if (view.unavailable) singleAccountUnavailable = true;
    }
    return {
      id: provider.id,
      name: provider.name,
      host: provider.host,
      priority: priorityById.has(provider.id) ? priorityById.get(provider.id) : null,
      noActiveKey,
      balance,
    };
  });
  return {
    kind: "cchp",
    stale: snapshot.stale,
    singleAccountUnavailable: Boolean(singleAccountUnavailable),
    balanceStale: Boolean(balanceStale),
    balancePartial: Boolean(balancePartial),
    /* 刷新不全且重取超时：只出超时提示 */
    balanceSuppressStale: Boolean(balanceSuppressStale),
    timedOut: Boolean(snapshot.timedOut || priorities.timedOut || balanceTimedOut),
    priorityMissing: Boolean(priorities.missing),
    summary: usage.summary,
    health: usage.health,
    /* id 关联健康数据，name/host/priority 供 cchSitePriorities 匹配 */
    providers: displayProviders,
  };
}

function cchpIsClouder(name) {
  return providerBrand(name).toLowerCase() === "clouder";
}

/* unsupported：上游不支持查余额，不是刷新失败 */
function cchpUnsupported(status) {
  return String(status === undefined || status === null ? "" : status).trim().toLowerCase() === "unsupported";
}

/* 单账户投影：按代表 key 找 account，否则退回唯一 account；多账户且无匹配即不可用，
   不回退 totals（会把同一账户的重复读数相加） */
function cchpSingleAccountView(balance, representativeKey) {
  const source = balance && typeof balance === "object" ? balance : {};
  const accounts = Array.isArray(source.accounts) ? source.accounts : [];
  let account = null;
  if (representativeKey) {
    const matched = accounts.filter((item) => Array.isArray(item && item.key_ids)
      && item.key_ids.some((id) => String(id) === representativeKey));
    if (matched.length === 1) account = matched[0];
  }
  if (!account && accounts.length === 1) account = accounts[0];
  if (!account) {
    return {
      balance: { status: source.status, totals: [], total_usd: null, unlimited: false },
      unavailable: true,
    };
  }
  const amount = numeric(account.amount);
  const unit = String(account.unit || "USD").trim().toUpperCase() || "USD";
  return {
    balance: {
      status: source.status,
      totals: [{ unit, amount }],
      total_usd: unit === "USD" ? amount : null,
      unlimited: account.unlimited === true,
      checked_at: account.checked_at,
      oldest_checked_at: account.checked_at,
    },
    unavailable: false,
  };
}

/* 多币种各按原单位拼接，不做汇率换算 */
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

/* 成功率一位小数、TTFT P50 一位小数秒；没有请求或缺成功率时不追加 */
function cchpHealthParts(data, provider) {
  const health = data.health && provider.id ? data.health.get(String(provider.id)) : null;
  if (!health) return [];
  const requests = numeric(health.requests);
  if (requests === null || requests <= 0) return [];
  const parts = [];
  const rate = numeric(health.successRate);
  const ttft = numeric(health.ttftP50Ms);
  if (rate === null) return parts;
  parts.push(`${(rate * 100).toFixed(1)}%`);
  if (ttft !== null) parts.push(`${(ttft / 1000).toFixed(1)}s`);
  return parts;
}

/* 域名比对键：去协议、用户信息、路径、端口与开头的 www./api.，让 website_url 与站点地址可比 */
function cchHostKey(value) {
  let text = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  if (!text) return "";
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  text = text.replace(/[?#].*$/, "").replace(/\/.*$/, "");
  const at = text.lastIndexOf("@");
  if (at >= 0) text = text.slice(at + 1);
  const ipv6 = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
  if (ipv6) text = ipv6[1];
  else text = text.replace(/:\d+$/, "");
  return text.replace(/^(?:www\.|api\.)+/, "");
}

/* 限额行第 1 行的成功率/TTFT：按域名对到 CCHP provider，取不到只显示站名 */
function cchpSiteHealthParts(site, results) {
  if (!site) return [];
  const key = cchHostKey(site.base);
  if (!key) return [];
  for (const item of Array.isArray(results) ? results : []) {
    if (!item || !item.data || item.data.kind !== "cchp") continue;
    for (const provider of Array.isArray(item.data.providers) ? item.data.providers : []) {
      if (!provider || cchHostKey(provider.host) !== key) continue;
      return cchpHealthParts(item.data, provider);
    }
  }
  return [];
}

/* 超宽时依次省掉「余额」二字、舍弃 TTFT，最后截短名称 */
function cchpRowParts(label, text, amountText, healthParts) {
  const full = healthParts;
  const rateOnly = healthParts.slice(0, 1);
  const variants = [];
  if (full.length) {
    variants.push([label, text].concat(full));
    if (amountText !== text) variants.push([label, amountText].concat(full));
    if (full.length > 1) {
      variants.push([label, text].concat(rateOnly));
      if (amountText !== text) variants.push([label, amountText].concat(rateOnly));
    }
  }
  variants.push([label, text]);
  variants.push([label, amountText]);
  for (const parts of variants) {
    if (measure(parts.join(" · ")) <= CCH_ROW_WIDTH) return parts;
  }
  return fitRowWidth([label, amountText], CCH_ROW_WIDTH);
}

/* 余额行：status=ok、未停用、有金额或不限量才出行；Clouder 由 CCH 站点提供 */
function cchpRows(data) {
  const rows = [];
  for (const provider of data.providers || []) {
    if (cchpIsClouder(provider.name)) continue;
    if (provider.noActiveKey) continue;
    const balance = provider.balance || {};
    if (String(balance.status || "").toLowerCase() !== "ok") continue;
    const unlimited = balance.unlimited === true;
    const totalUsd = numeric(balance.total_usd);
    const totals = cchpAmountParts(balance);
    if (!unlimited && !totals.length && totalUsd === null) continue;
    let amountText;
    if (unlimited) amountText = "不限量";
    else if (totals.length) amountText = totals.join(" + ");
    else amountText = money(totalUsd);
    const text = `余额 ${amountText}`;
    const label = providerBrand(provider.name);
    rows.push({
      amount: totalUsd,
      priority: provider.priority,
      name: label,
      parts: cchpRowParts(label, text, amountText, cchpHealthParts(data, provider)),
    });
  }
  return rows;
}

/* 今日用量：requests=0 不占行；超宽时依次截短站名前缀、省首字与百分比 */
function cchpUsageLine(summary, prefix) {
  const requests = numeric(summary && summary.requests);
  if (requests === null || requests <= 0) return "";
  const body = `今日 ${Math.round(requests)} 次`;
  const extras = [];
  const rate = numeric(summary.successRate);
  if (rate !== null) extras.push(`${(rate * 100).toFixed(1)}%`);
  const ttft = numeric(summary.avgTtftMs);
  if (ttft !== null) extras.push(`首字 ${(ttft / 1000).toFixed(1)}s`);
  const name = String(prefix || "").replace(/\s*·\s*$/, "");
  const tails = [];
  for (let count = extras.length; count >= 0; count--) {
    tails.push([body].concat(extras.slice(0, count)).join(" · "));
  }
  if (name) {
    for (const tail of tails) {
      const room = CCH_ROW_WIDTH - measure(tail) - 3;
      if (room < 2) continue;
      const line = `${truncateToWidth(name, room)} · ${tail}`;
      if (measure(line) <= CCH_ROW_WIDTH) return line;
    }
  }
  for (const tail of tails) {
    if (measure(tail) <= CCH_ROW_WIDTH) return tail;
  }
  return truncateToWidth(body, CCH_ROW_WIDTH);
}

/* 多个 CCHP 站点时前缀站名 */
function cchpUsageLines(results) {
  const sites = results.filter((item) => item.site && item.site.mode === "cchp");
  const lines = [];
  for (const item of sites) {
    if (!item.data || item.data.kind !== "cchp") continue;
    const line = cchpUsageLine(item.data.summary, sites.length > 1 ? `${item.site.name} · ` : "");
    if (line) lines.push(line);
  }
  return lines;
}

/* 行不显示时给警告色；unsupported 是「查不了」而非「查坏了」，不算异常 */
function cchpAbnormal(data) {
  for (const provider of data.providers || []) {
    if (cchpIsClouder(provider.name)) continue;
    const balance = provider.balance || {};
    if (cchpUnsupported(balance.status)) continue;
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

/* 站点优先级：显式写了就用；否则按域名、再按名称匹配 CCHP provider 或 CCH 厂商的最小优先级 */
function cchSitePriorities(results) {
  const byDomain = new Map();
  const byName = new Map();

  for (const item of results) {
    if (!item.data) continue;

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

/* 各站余额合成一张表 */
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
    if (item.data.kind === "limits") {
      /* 限额行分两行：第 1 行站名 + 健康数据，第 2 行只放指标；没有指标就不占行 */
      const metrics = cchLimitMetricsText(item.data, CCH_ROW_WIDTH);
      if (!metrics) continue;
      rows.push({
        amount: null,
        priority: cchSitePriority(item.site, priorities),
        name: item.site.name,
        parts: fitRowWidth([item.site.name].concat(cchpSiteHealthParts(item.site, results)), CCH_ROW_WIDTH),
        extra: [metrics],
      });
      continue;
    }
    const total = item.data.total;
    const amount = total ? total.limit - total.used : null;
    rows.push({
      amount,
      priority: cchSitePriority(item.site, priorities),
      name: item.site.name,
      parts: fitRowWidth(
        [item.site.name, total ? `余额 ${money(amount)}` : "余额 未设置"],
        CCH_ROW_WIDTH
      ),
    });
  }

  /* 插入序号兜底，不依赖 sort 的稳定性 */
  rows.forEach((row, index) => { row.seq = index; });
  rows.sort(compareRows);

  if (rows.length) {
    /* 限额行的 row.extra 是追加的指标行 */
    for (const row of rows.slice(0, CCH_ADMIN_MAX)) {
      if (wrap) {
        for (const line of layoutRows(row.parts, CCH_ROW_WIDTH)) lines.push(line);
        if (row.extra && row.extra.length) {
          for (const line of layoutRows(row.extra, CCH_ROW_WIDTH)) lines.push(line);
        }
      } else {
        lines.push(row.parts.join(" · "));
        if (row.extra && row.extra.length) lines.push(row.extra.join(" · "));
      }
    }
    if (rows.length > CCH_ADMIN_MAX) lines.push(`另有 ${rows.length - CCH_ADMIN_MAX} 个上游`);
  } else {
    lines.push("未获取到余额");
  }

  /* 供应商限额：多个 admin 站点时带站名 */
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

  const notices = [];
  const cchpItems = results.filter((item) => item.data && item.data.kind === "cchp");
  /* 超时会连带造成 priority 缺失，两者只提示一次 */
  const cchpTimedOut = cchpItems.some((item) => item.data.timedOut)
    || results.some((item) => item.error && item.error.code === "cchp_timeout");
  if (cchpItems.some((item) => item.data.stale)) notices.push("⚠️ CCHP 余额来自缓存");
  else if (cchpItems.some((item) => item.data.balancePartial && !item.data.timedOut)) {
    notices.push("⚠️ 部分余额未刷新");
  } else if (cchpItems.some((item) => item.data.balanceStale && !item.data.balancePartial && !item.data.balanceSuppressStale)) {
    notices.push("⚠️ 余额未刷新，来自服务端缓存");
  }
  if (cchpItems.some((item) => item.data.singleAccountUnavailable)) notices.push("⚠️ 单账户余额不可用");
  if (results.some((item) => item.data && item.data.kind === "limits" && item.data.stale)) {
    notices.push("⚠️ 限额来自缓存");
  }
  if (cchpItems.some((item) => cchpOld(item.data))) notices.push("⚠️ 部分余额较旧");
  if (cchpTimedOut) notices.push("⚠️ 部分请求超时");
  else if (cchpItems.some((item) => item.data.priorityMissing)) notices.push("⚠️ 部分排序信息缺失");
  if (notices.length) {
    lines.push("");
    for (const line of notices) lines.push(line);
  }
  return lines;
}

/* 供应商限额（cch_show_limits），按使用率从高到低 */
function cchLimitLines(data) {
  const lines = [];
  const providers = Array.isArray(data.quota && data.quota.providers) ? data.quota.providers : [];
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

  if (data.kind === "cchp") {
    let risk = 0;
    if (data.stale) risk = 1;
    if (data.timedOut || data.priorityMissing) risk = Math.max(risk, 1);
    if (cchpAbnormal(data)) risk = Math.max(risk, 1);
    return risk;
  }

  /* 限额站点：剩余 ≤5% 红、≤20% 黄（stale 至少黄）；1e-9 是边界值（如 3.5/70）的浮点余量 */
  if (data.kind === "limits") {
    const ratios = (Array.isArray(data.windows) ? data.windows : []).map((window) => window.ratio);
    ratios.push(data.monthly && typeof data.monthly === "object" ? numeric(data.monthly.ratio) : null);
    let risk = 0;
    for (const ratio of ratios) {
      if (ratio === null) continue;
      if (ratio <= 0.05 + 1e-9) risk = Math.max(risk, 2);
      else if (ratio <= 0.2 + 1e-9) risk = Math.max(risk, 1);
    }
    if (data.stale) risk = Math.max(risk, 1);
    return risk;
  }

  let risk = 0;
  /* 上游余额一条都查不到时给提示色 */
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

/* ── CommandCode：余额查不到、只能读限额的站点 ── */

/* 上游契约（据 command-code CLI 1.88.0）：whoami?limits=1 取 org.id，再按 orgId 取 credits
   （个人账户不带 orgId），金额 USD。字段按线上见过的写法兼容别名，但 canonical 字段存在即不回退别名 */
const CMDCODE_WINDOWS = [
  ["fiveHour", "5H", ["fiveHour", "five_hour", "five_hours", "5h"]],
  ["weekly", "W", ["weekly", "week", "sevenDay", "7d"]],
];
const CMDCODE_LIMIT_HOLDERS = ["windowLimits", "window_limits"];
const CMDCODE_USED_KEYS = ["used", "current", "spent"];
const CMDCODE_CAP_KEYS = ["cap", "limit", "max", "total"];
/* 诊断每轮最多一条 */
let cmdcodeMissingLogged = false;

/* 缓存按「站点 + 凭据指纹」分区：换 key 不会读到上一账户的限额 */
function cmdcodeCacheKey(site) {
  return `cch_limits_v2_${sha256Hex(`${site.base}|${String(site.credential || "")}`).slice(0, 32)}`;
}

/* 缓存只存原始额度：cap/ratio 读取时按当前 cch_cmdcode_month_cap 重算 */
function cmdcodeCacheData(limits) {
  const monthly = limits.monthly && typeof limits.monthly === "object" ? limits.monthly : {};
  return {
    kind: limits.kind,
    site: limits.site,
    plan: limits.plan,
    limited: limits.limited,
    windows: (Array.isArray(limits.windows) ? limits.windows : []).map((window) => ({
      key: window.key, label: window.label, used: window.used, cap: window.cap,
    })),
    monthly: { monthly: monthly.monthly, purchased: monthly.purchased, free: monthly.free,
      remaining: monthly.remaining },
    stale: false,
  };
}

function cmdcodeProject(data) {
  const source = data && typeof data === "object" ? data : {};
  const monthly = source.monthly && typeof source.monthly === "object" ? source.monthly : {};
  const unlimited = source.limited === false;
  return {
    kind: source.kind || "limits",
    site: source.site,
    plan: source.plan === undefined ? null : source.plan,
    limited: typeof source.limited === "boolean" ? source.limited : null,
    windows: (Array.isArray(source.windows) ? source.windows : []).map((window) =>
      cmdcodeWindow(window.key, window.label, window, unlimited)),
    monthly: cmdcodeMonthly({ monthlyCredits: monthly.monthly, purchasedCredits: monthly.purchased,
      freeCredits: monthly.free }),
    stale: source.stale === true,
  };
}

/* 过期缓存也返回，由调用方决定是否回退 */
function readCmdcodeCache(site) {
  try {
    const raw = $persistentStore.read(cmdcodeCacheKey(site));
    if (!raw) return null;
    const cache = JSON.parse(raw);
    /* v1 也带原始额度，一并重投影 */
    if (!cache || (cache.version !== 2 && cache.version !== 1) || !cache.data) return null;
    const fresh = Date.now() - Number(cache.updatedAt || 0) < CCH_QUOTA_CACHE_SECONDS * 1000;
    return { data: cmdcodeProject(cache.data), fresh };
  } catch (_) { return null; }
}

function writeCmdcodeCache(site, data) {
  try {
    $persistentStore.write(JSON.stringify({ version: 2, updatedAt: Date.now(), data: cmdcodeCacheData(data) }),
      cmdcodeCacheKey(site));
  } catch (_) {}
  return data;
}

/* 非 200 一律抛错，不写半截数据 */
async function cmdcodeGet(site, path, headers) {
  const response = await request("get", `${site.base}${path}`, headers);
  if (response.status !== 200) {
    cchpLog(`CommandCode ${String(path).split("?")[0]} HTTP ${response.status}`);
    throw new Error(`HTTP ${response.status}`);
  }
  return parseBody(response);
}

/* 剩余比例 = (cap − used) / cap；不限量或 cap 缺失/为 0 时为 null */
function cmdcodeWindow(key, label, raw, unlimited) {
  const source = raw && typeof raw === "object" ? raw : {};
  const used = cmdcodePick(source, CMDCODE_USED_KEYS);
  const cap = cmdcodePick(source, CMDCODE_CAP_KEYS);
  const ratio = !unlimited && used !== null && cap !== null && cap > 0
    ? Math.min(1, Math.max(0, (cap - used) / cap))
    : null;
  return { key, label, used, cap, ratio };
}

/* canonical 字段存在即定案：值不是有限 number 就按缺失处理，不回退别名 */
function cmdcodePick(source, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return null;
}

function cmdcodeFindWindow(source, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, alias)) return { alias, value: source[alias] };
  }
  return { alias: null, value: undefined };
}

function cmdcodeLimited(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return null;
}

/* 不限量时没有窗口数据也写「不限」；否则只保留真给了窗口对象的窗口 */
function cmdcodeWindows(windowLimits, limited) {
  const source = windowLimits && typeof windowLimits === "object" ? windowLimits : {};
  const flag = limited === undefined ? cmdcodeLimited(source.limited) : limited;
  const unlimited = flag === false;
  const windows = [];
  for (const pair of CMDCODE_WINDOWS) {
    const found = cmdcodeFindWindow(source, pair[2]);
    const present = found.value && typeof found.value === "object";
    if (!present && !unlimited) continue;
    windows.push(cmdcodeWindow(pair[0], pair[1], present ? found.value : null, unlimited));
  }
  return windows;
}

/* 依次找 credits/body 上的 windowLimits/window_limits，命中即定案 */
function cmdcodeWindowLimits(credits, body) {
  for (const holder of [credits, body]) {
    if (!holder || typeof holder !== "object") continue;
    for (const name of CMDCODE_LIMIT_HOLDERS) {
      if (!Object.prototype.hasOwnProperty.call(holder, name)) continue;
      const value = holder[name];
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
  }
  return {};
}

/* 月度：剩余金额 = 计划内 + 已购 + 赠送（三项全缺才算未知）。接口不返回本月已用，
   剩余比例只能按 monthlyCredits / cap 反推；cap 非法时回退成剩余金额 */
function cmdcodeMonthly(credits) {
  const monthly = numeric(credits.monthlyCredits);
  const purchased = numeric(credits.purchasedCredits);
  const free = numeric(credits.freeCredits);
  const remaining = monthly === null && purchased === null && free === null
    ? null
    : num(monthly) + num(purchased) + num(free);
  const cap = CMDCODE_MONTH_CAP;
  const ratio = monthly !== null && cap !== null && cap > 0
    ? Math.min(1, Math.max(0, monthly / cap))
    : null;
  return { remaining, monthly, purchased, free, cap, ratio };
}

/* 诊断只报字段名与类型：金额、凭据一律不进日志（线上排查用，不需要数值） */
function cmdcodeTypeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function cmdcodeKeyList(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "-";
  const keys = Object.keys(value);
  return keys.length ? `[${keys.join(",")}]` : "[]";
}

function cmdcodeFirstRaw(holders, name) {
  for (const holder of holders) {
    if (!holder || typeof holder !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(holder, name)) return holder[name];
  }
  return undefined;
}

/* limited 不为 false 却取不到任何窗口时记一行诊断：只含字段名与类型 */
function cmdcodeLogMissingWindows(limits, credits, body, windowLimits) {
  const windows = Array.isArray(limits && limits.windows) ? limits.windows : [];
  if (windows.length || (limits && limits.limited === false)) return;
  if (cmdcodeMissingLogged) return;
  const source = windowLimits && typeof windowLimits === "object" ? windowLimits : {};
  const holders = body && body !== credits ? [credits, body] : [credits];
  const planType = cmdcodeTypeName(cmdcodeFirstRaw(holders, "planId"));
  const limitedType = cmdcodeTypeName(cmdcodeFirstRaw([windowLimits, credits, body], "limited"));
  const shapes = CMDCODE_WINDOWS.map((pair) => {
    const found = cmdcodeFindWindow(source, pair[2]);
    return `${pair[0]}:${cmdcodeTypeName(found.value)}/${cmdcodeKeyList(found.value)}`;
  });
  cmdcodeMissingLogged = true;
  cchpLog(`CommandCode 限额字段缺失: plan=${planType} limited=${limitedType}`
    + ` credits=${cmdcodeKeyList(credits)} body=${cmdcodeKeyList(body)}`
    + ` windowLimits=${cmdcodeKeyList(windowLimits)}`
    + ` window=${shapes.join(" ")}`);
}

async function fetchCommandCodeLimits(site, headers) {
  const whoami = await cmdcodeGet(site, "/alpha/whoami?limits=1", headers);
  const org = whoami && whoami.org && typeof whoami.org === "object" ? whoami.org : null;
  const orgId = org && org.id ? String(org.id) : "";
  const body = await cmdcodeGet(
    site,
    `/alpha/billing/credits${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`,
    headers
  );
  /* 契约是 { credits: {...} }；直接给扁平对象时也认 */
  const credits = body && body.credits && typeof body.credits === "object" ? body.credits : (body || {});
  const windowLimits = cmdcodeWindowLimits(credits, body);
  const planId = String(credits.planId || (body && body.planId) || "").trim();
  let limited = cmdcodeLimited(windowLimits.limited);
  if (limited === null) limited = cmdcodeLimited(credits.limited);
  if (limited === null && body && body !== credits) limited = cmdcodeLimited(body.limited);
  const limits = {
    kind: "limits",
    site: { name: site.name },
    plan: planId || null,
    limited,
    windows: cmdcodeWindows(windowLimits, limited),
    monthly: cmdcodeMonthly(credits),
    stale: false,
  };
  cmdcodeLogMissingWindows(limits, credits, body, windowLimits);
  /* 200 但没有可展示字段：当成失败，不能覆盖上次有效缓存 */
  if (!cmdcodeDisplayable(limits)) throw new Error("credits 里没有任何可展示字段");
  return limits;
}

function cmdcodeDisplayable(limits) {
  if (numeric(limits && limits.monthly && limits.monthly.remaining) !== null) return true;
  if (limits && limits.limited === false) return true;
  return (Array.isArray(limits && limits.windows) ? limits.windows : [])
    .some((window) => window.ratio !== null);
}

/* 缓存有效期内不发请求；失败回退缓存并标 stale，没有缓存才抛错 */
async function fetchCommandCodeSite(site, headers) {
  const cached = readCmdcodeCache(site);
  if (cached && cached.fresh) return Object.assign({}, cached.data, { stale: false });
  try {
    return writeCmdcodeCache(site, await fetchCommandCodeLimits(site, headers));
  } catch (error) {
    cchpLog(`${site.name} 限额取数失败: ${(error && error.message) || error}`);
    if (cached) return Object.assign({}, cached.data, { stale: true });
    throw error;
  }
}

/* 紧凑金额：$12.3M / $12k / $1234 / $56 */
function cchLimitMoney(value) {
  const amount = numeric(value);
  if (amount === null) return "-";
  const abs = Math.abs(amount);
  if (abs >= 1e6) return `$${(amount / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1e4) return `$${Math.round(amount / 1e3)}k`;
  if (abs >= 100) return `$${Math.round(amount)}`;
  return `$${amount.toFixed(1).replace(/\.0$/, "")}`;
}

/* 百分比固定两位小数；风险色按原始 ratio */
function cmdcodePercent(ratio) {
  return `${(Number(ratio) * 100).toFixed(2)}%`;
}

/* 限额字段：limited=false 写「不限」；M 有上限写百分比，否则写剩余金额 */
function cchLimitFields(data, label) {
  const name = String(label || (data.site && data.site.name) || "CommandCode");
  const unlimited = data.limited === false;
  const windows = [];
  for (const window of Array.isArray(data.windows) ? data.windows : []) {
    if (unlimited) {
      windows.push({ label: window.label, value: "不限" });
      continue;
    }
    if (window.ratio === null) continue;
    windows.push({ label: window.label, value: cmdcodePercent(window.ratio) });
  }
  const monthly = data.monthly && typeof data.monthly === "object" ? data.monthly : {};
  const ratio = numeric(monthly.ratio);
  const remaining = numeric(monthly.remaining);
  let month = null;
  if (ratio !== null) month = cmdcodePercent(ratio);
  else if (remaining !== null) month = cchLimitMoney(remaining);
  return { name, windows, month };
}

/* 四种排法：完整 · 紧凑 · 紧凑空格 · 无分隔 */
function cchLimitMetrics(fields, spaced, separator) {
  const items = [];
  for (const window of fields.windows) {
    items.push(spaced ? `${window.label} ${window.value}` : `${window.label}${window.value}`);
  }
  if (fields.month !== null) items.push(spaced ? `M ${fields.month}` : `M${fields.month}`);
  return items.join(separator);
}

/* 站名 + 指标：放不下只截短站名；截完只剩省略号（或剩余不足 1 列）返回 null，
   由调用方整段去掉站名。返回前再量一次，绝不超宽（省略号本身按 2 列计） */
function cchLimitNamed(name, metrics, budget) {
  const line = `${name} · ${metrics}`;
  if (measure(line) <= budget) return line;
  const room = budget - measure(metrics) - 3;
  if (room < 1) return null;
  const short = truncateToWidth(name, room);
  if (!short || short === "…") return null;
  const truncated = `${short} · ${metrics}`;
  return measure(truncated) <= budget ? truncated : null;
}

/* 限额行：先压指标排法、再截短站名、最后才去掉站名——三项指标在能放下时一个不丢。
   百分比固定两位小数后完整排法要 45 列，默认 38 列改用「紧凑空格」保住完整站名：
   `CommandCode · 5H68.00% W59.00% M57.14%`（38 列）。
   通用 fitRowWidth 会从尾部丢字段（20–22 宽会丢月度），这里不交给它。
   金额已是紧凑档（$12345678 → $12.3M）；最紧排法仍超宽时截短收尾，
   绝不返回超过 budget 的行（cch_row_width 下限 20） */
function cchLimitRowParts(data, label, budget) {
  const width = Math.max(20, Number(budget) || 0);
  const fields = cchLimitFields(data, label);
  const wide = cchLimitMetrics(fields, true, " · ");
  /* 一个可展示字段都没有：返回空数组，不占行（由面板图标提示异常） */
  if (!wide) return [];
  const variants = [
    wide,
    cchLimitMetrics(fields, false, " · "),
    cchLimitMetrics(fields, false, " "),
    cchLimitMetrics(fields, false, ""),
  ];
  /* 完整站名优先：只压指标排法 */
  for (const metrics of variants) {
    const line = `${fields.name} · ${metrics}`;
    if (measure(line) <= width) return [line];
  }
  /* 站名确实放不下才截短（截完只剩省略号时返回 null） */
  for (const metrics of variants) {
    const line = cchLimitNamed(fields.name, metrics, width);
    if (line) return [line];
  }
  /* 站名连 1 列都放不下：整段去掉，指标仍从宽到窄挑第一种放得下的 */
  for (const metrics of variants) {
    if (measure(metrics) <= width) return [metrics];
  }
  /* 比最紧的排法还窄：只截短空格分隔的最紧排法，保证 measure(line) <= width */
  return [truncateToWidth(variants[2], width)];
}

/* 两行显示的第 2 行：从宽到窄取第一种放得下的排法，都放不下就截短最紧排法 */
function cchLimitMetricsText(data, budget) {
  const width = Math.max(20, Number(budget) || 0);
  const fields = cchLimitFields(data);
  const wide = cchLimitMetrics(fields, true, " · ");
  if (!wide) return "";
  const variants = [
    wide,
    cchLimitMetrics(fields, false, " · "),
    cchLimitMetrics(fields, false, " "),
    cchLimitMetrics(fields, false, ""),
  ];
  for (const metrics of variants) {
    if (measure(metrics) <= width) return metrics;
  }
  return truncateToWidth(variants[2], width);
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

/* 一个站点失败只影响它自己那行 */
async function fetchCchResults() {
  const sites = collectCchSites();
  return Promise.all(sites.map((site) => fetchCchSite(site).then(
    (data) => ({ site, data }),
    (error) => {
      cchpLog(`${site.name} 取数失败: ${(error && error.message) || error}`);
      return { site, error: error || new Error("请求失败") };
    }
  )));
}

/* ── 面板 ── */

async function runPanel() {
  const cchResults = await fetchCchResults();
  if (!cchResults.length) return finish("未配置", PANEL_ICON, "8E8E93");

  const lines = cchBalanceLines(cchResults, true);
  const usage = cchpUsageLines(cchResults);
  if (usage.length) {
    lines.push("");
    for (const line of usage) lines.push(line);
  }
  lines.push("");
  lines.push(`更新 ${formatTime()}`);

  /* 风险色取各站点最高值 */
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

  const body = ["【余额】"].concat(cchBalanceLines(cchResults, false));
  const usage = cchpUsageLines(cchResults);
  if (usage.length) {
    body.push("");
    for (const line of usage) body.push(line);
  }
  $notification.post(`${PANEL_TITLE} 日报`, `CCH ${cchResults.length}`, body.join("\n"));
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
