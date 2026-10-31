/* AI 中转站面板与日报：
   - 面板（mode=panel，默认）：各 CCH / CCHP 站点的余额，合并成一个列表
   - 日报（mode=daily）：每天 23:50 推送同一条列表
   余额从两处取：CCH 的 admin 模式一次拿到本站各上游余额（CCH 用各上游自己的密钥查），
   user/cookie/login 模式取该站账户余额；CCHP 的 cchp 模式按组织取各 provider 余额，
   并用其 key 优先级排序（Clouder 的余额仍由 CCH 站点提供）。面板与日报显示余额、今日用量与供应商健康。
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
/* 额度缓存秒数：模块默认传 600；直接调用脚本且未传 cch_quota_interval 时回退 300 */
const CCH_QUOTA_CACHE_SECONDS = intArg(ARGS.cch_quota_interval, 300, 60, 3600);
/* 月度额度上限（USD）：官方 GOAT 套餐每月 70；填非法值（≤0/非数字）时 M 段回退成剩余金额 */
const CMDCODE_MONTH_CAP = monthCapArg(ARGS.cch_cmdcode_month_cap, 70);
/* 供应商限额（5 小时/日/周/月用量）与上游余额是两回事，默认只展示余额 */
const CCH_SHOW_LIMITS = boolArg(ARGS.cch_show_limits, false);
/* 用户拓扑是一个 provider 一个上游账户；CCHP 的 balance.accounts 按真实账户分行，
   同一账户读数不一致时会被拆成两条、totals 相加双计，默认只刷一把代表 key、只显示单账户金额 */
const CCHP_SINGLE_ACCOUNT = boolArg(ARGS.aiapi_cchp_single_account, true);

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

/* 月度上限参数：留空按默认套餐价；明确填了非法值（≤0/非数字）时返回 null，让 M 段回退成剩余金额 */
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

/* 截短到指定显示宽度，末尾加省略号；已经放得下就原样返回 */
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

/* 单行收尾：各变体都放不下时按剩余宽度截短首字段（名称），必要时从尾部舍弃字段，
   保证 measure(join(" · ")) <= budget；连一个字段都放不下时硬截断 */
function fitRowWidth(parts, budget) {
  const list = parts.map((part) => String(part === undefined || part === null ? "" : part))
    .filter((part) => part !== "");
  if (!list.length) return [];
  if (measure(list.join(" · ")) <= budget) return list;
  const name = list[0];
  /* 从尾部逐项舍弃，尽量保留名称与靠前的金额字段 */
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

/* ── 凭据指纹：SHA-256（纯 JS，无外部依赖） ──
   FNV-1a 32bit 只有 32 位，不同凭据会撞到同一指纹（换 key 却读到上一账户的限额），
   指纹改用 SHA-256；调用方只取前 32 个十六进制字符（128 bit）。原始凭据只参与哈希，不落盘 */
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

/* 字符串按 UTF-8 编码：凭据里可能有邮箱、中文备注 */
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

/* 诊断日志：只在异常路径记录摘要，正常刷新不刷屏；Surge 里可用 script-log 查看 */
function cchpLog(message) {
  try {
    if (typeof console !== "undefined" && console.log) console.log(`[aiapi] ${message}`);
  } catch (_) {}
}

/* ── CCH：各上游余额（限额可选） ── */

const CCH_MODES = ["user", "cookie", "admin", "login", "cchp", "cmdcode"];
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
  else if (site.mode === "admin" || site.mode === "cchp" || site.mode === "cmdcode") headers.Authorization = `Bearer ${site.credential}`;
  else headers["X-API-Key"] = site.credential;

  if (site.mode === "admin") return fetchCchAdminSite(site, headers);
  if (site.mode === "cmdcode") return fetchCommandCodeSite(site, headers);
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

/* 兜底展示顺序：只在行拿不到 CCH 优先级时使用（CCH user 站点、独立站点且未写 `:优先级`）。
   名称与 Scripting 版（scripting/aiapi/relay.core.ts 的 ROW_ORDER）一致，便于两边兜底结果相同。
   按名称前缀归类（Kcne-Astra → Kcne）；不在表里的行排最后。 */
const PANEL_ROW_ORDER = ["commandcode", "clouder", "kcne", "air"];

/* 名称在固定顺序里的档位；不在表里返回表长（排最后） */
function rowOrderRank(name) {
  const text = String(name || "").trim().toLowerCase();
  if (!text) return PANEL_ROW_ORDER.length;
  for (let index = 0; index < PANEL_ROW_ORDER.length; index += 1) {
    const token = PANEL_ROW_ORDER[index];
    if (text === token) return index;
    /* Kcne-Astra、SD 备用 这类同品牌的子项归到同一档 */
    if (text.startsWith(token) && /^[-_\s·]/.test(text.slice(token.length))) return index;
  }
  return PANEL_ROW_ORDER.length;
}

/* 排序：先按 CCH 优先级升序（数值越小越优先）；没有优先级的行（CCH user 站点、独立站点
   且未写 `:优先级`）一律排在有优先级的行之后，其间按写死的展示顺序兜底
   （CommandCode → Clouder → Kcne → SD → Air）；再按显示名（大小写不敏感）、插入序号。
   金额只用于展示，不参与排序——余额变化不会让行序跳动 */
function compareRows(a, b) {
  const leftPriority = numeric(a.priority);
  const rightPriority = numeric(b.priority);
  if (leftPriority !== null && rightPriority !== null) {
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  } else if (leftPriority !== rightPriority) {
    /* 只有一边有优先级：有优先级的排前面 */
    return leftPriority === null ? 1 : -1;
  } else {
    /* 两边都没有优先级：PANEL_ROW_ORDER 兜底 */
    const leftRank = rowOrderRank(a.name);
    const rightRank = rowOrderRank(b.name);
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  const leftName = String(a.name || "").toLowerCase();
  const rightName = String(b.name || "").toLowerCase();
  if (leftName !== rightName) {
    /* localeCompare 可用时按本地排序；它把不同字符串判成相等（返回 0）时再用码位兜底 */
    let order = 0;
    if (typeof leftName.localeCompare === "function") order = leftName.localeCompare(rightName);
    if (order) return order < 0 ? -1 : 1;
    return leftName < rightName ? -1 : 1;
  }

  const leftSeq = typeof a.seq === "number" ? a.seq : 0;
  const rightSeq = typeof b.seq === "number" ? b.seq : 0;
  return leftSeq - rightSeq;
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
    rows.push({ amount: group.amount, priority: group.priority, name: label, parts });
  }

  return rows;
}

/* ── CCHP：按 key 优先级排序的站点余额（Clouder 仍由 CCH 站点提供） ── */

/* 刷新余额时逐把 key 复查，最多 5 个请求在途 */
const CCHP_KEY_CONCURRENCY = 5;

/* keys/page 的单页上限；页数上限防止服务端游标不前进时卡在循环里 */
const CCHP_KEY_PAGE_LIMIT = 100;
const CCHP_KEY_PAGE_MAX = 10;

/* 模块 timeout=30 秒，而 CCHP 要串行跑 org-tree → providers → keys 分页，刷新阶段再逐把 key 复查、
   请求数按 key 放大，只限制派发仍可能在多轮在途请求上等满 30 秒
   （11 把 key × 12 秒、并发 5 约 36 秒）。$httpClient 没有超时参数、已发出的请求无法取消，
   所以 27 秒总预算同时限制派发与等待：到点停止等待并降级，晚到的响应丢弃。 */
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

/* allowStale=true 时忽略时效，用于请求失败后回退旧值（目前只有 provider 列表快照这么用） */
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

/* 只发一次 providers 列表请求；失败时由调用方决定是否回退上次快照 */
async function fetchCchpProviderList(site, orgId, headers) {
  const response = await cchpRequest("get", `${site.base}/api/account/orgs/${orgId}/providers`, headers);
  checkStatus(response, "管理令牌");
  const list = parseBody(response).providers;
  /* 200 但结构不对（网关错误页、字段改名）时不能当成空数组写缓存，否则会盖掉旧值 */
  if (!Array.isArray(list)) throw new Error("返回缺少 providers");
  return list.map((item) => ({
    id: String(item.id || ""),
    name: String(item.name || ""),
    /* 上游仓库名（如 miapi-ds）：判断是否需要展示 */
    slug: String(item.slug || ""),
    /* 官网地址：CCH 站点按域名匹配优先级时用 */
    host: String(item.website_url || ""),
    /* balance.accounts 会按 key 重复计数，只用 totals / total_usd */
    balance: item.balance && typeof item.balance === "object" ? item.balance : null,
  })).filter((provider) => !cchpHidden(provider));
}

/* 余额不再按 cch_quota_interval 缓存：每次刷新都请求列表，
   上次的列表快照只在这条请求本身失败时用来兜底（stale=true） */
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

/* 关闭单账户模式时实时刷新用全部 active key：同一上游账户常挂多把 key，只刷一把会让另一把停在旧值，
   CCHP 据此把同一账户拆成两条并重复计入总额 */
function cchpKeyIds(keys) {
  const list = Array.isArray(keys) ? keys : [];
  return list.filter((key) => String(key.status || "").toLowerCase() === "active"
    && String(key.id || "").trim()).map((key) => String(key.id));
}

/* 单账户模式的代表 key：active keyIds 去重后按字符串升序取第一；
   换 provider 开新账户的拓扑下，同一 provider 的其余 key 属于同一账户的重复读数 */
function cchpRepresentativeKey(keyIds) {
  const unique = new Set();
  for (const id of Array.isArray(keyIds) ? keyIds : []) {
    const text = String(id || "").trim();
    if (text) unique.add(text);
  }
  const sorted = Array.from(unique).sort();
  return sorted.length ? sorted[0] : "";
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

/* CCHP 1.0.12 起 /providers/{id}/keys 已移除（404）：改为一次分页接口取全量 key 再按 provider 分组。
   分页字段是 nextCursor（请求侧 after）；partial/preparing 表示服务端还没备齐，按「取数不完整」处理。 */
async function fetchCchpKeyPages(site, orgId, headers) {
  const keys = [];
  let cursor = "";
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
    /* 200 但结构不对（网关错误页、字段改名）不能当成没有 key，否则会把优先级刷成 null */
    if (!Array.isArray(list)) throw new Error("返回缺少 keys");
    for (const key of list) keys.push(key);
    if (body.partial === true || body.preparing === true) return { keys, complete: false };
    const next = String(body.nextCursor || "").trim();
    if (!next) return { keys, complete: true };
    cursor = next;
  }
  /* 页数用满还有游标：按不完整处理，避免游标不前进时死循环 */
  return { keys, complete: false };
}

/* 按 provider_id 分组，套用既有的 active 规则：priority 取 active key 最小值（无 active 取全部），
   keyIds 是全部 active key（单账户模式的代表 key 由 cchpRepresentativeKey 从这里挑） */
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

/* 优先级与 keyIds 每轮都实取 keys/page：key 的启停与优先级随时会变，缓存会让停用/新增的 key
   拖到过期才生效（可见性判据与实时刷新目标都依赖它）。
   分页取全（nextCursor 走完）才算「取数完整」：只有取全时才敢按「无 active key」隐藏行。
   取数失败或服务端返回 partial/preparing 时不隐藏任何行，priority 留空退回固定行序
   （由 compareRows 用 PANEL_ROW_ORDER 兜底），并保留「部分排序信息缺失」提示。 */
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
    /* 取不到 keys 只丢排序与 keyIds：余额行照常显示，也不会把 provider 当成已停用 */
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

/* 今日用量与供应商健康：只用于展示，失败或预算耗尽都静默降级，不写缓存 */
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
  /* 200 但结构不对时按失败处理，避免把空表当成“没有请求” */
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

/* 单个请求与剩余预算赛跑：超时（或失败）返回 null 并清掉 timer，
   另一项先返回的成功值照常保留 */
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

/* 带预算的请求包装：派发前看剩余预算，等待期与预算赛跑，到点抛 cchp_timeout 交给既有降级分支；
   原始错误原样抛出。已发出的请求无法取消，晚到的响应由这里的 then 接住丢弃，不会变成未捕获异常。 */
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

/* 两个端点互不依赖：并发取，各自受剩余预算封顶，任一失败或超时只丢该项 */
async function fetchCchpUsage(site, headers) {
  const left = cchpDeadlineAt - Date.now();
  if (cchpBudgetSpent() || !(left > 0)) return { summary: null, health: null };
  const results = await Promise.all([
    cchpWithin(left, fetchCchpSummary(site, headers)),
    cchpWithin(left, fetchCchpHealth(site, headers)),
  ]);
  return { summary: results[0], health: results[1] };
}

/* 余额实时化：关闭单账户模式时按 provider 的每把 active key 各触发一次上游复查（?refresh=true）。
   providers 由调用方附上 keyIds（来自 fetchCchpPriorities 的 key 列表）。
   同一上游账户常挂多把 key，只刷一把会让另一把停在旧值，CCHP 据此把同一账户拆成两条并
   重复计入总额，所以每把 key 都要刷，同一账户的读数才会一致。
   上游复查成功后服务端聚合（列表里的 total_usd / checked_at）会同步更新，调用方需再取一次列表。
   余额接口有频率限制：一次刷新对每把 active key 只发一次、失败不重试；Clouder 不刷新
   （它的余额由 CCH 站点提供），Mi 已在列表阶段排除。全部失败只降级，不抛错。
   total 是刷新目标数 + 没有 key 的可见 provider 数，ok 是成功刷新的目标数，ok < total 即刷新不全。
   CCHP_SINGLE_ACCOUNT 打开时一个 provider 只刷代表 key，total/ok 改为按 provider 计：
   其余 key 是主动跳过，不算部分刷新失败。 */
async function refreshCchpBalances(site, orgId, providers, headers) {
  /* Clouder 行由 CCH 提供，不算刷新目标；keys 取不全时没有 keyIds 的 provider 无法刷新，
     但按 provider 计入 total，由调用方按 ok < total 提示，而不是静默沿用旧值。
     已停用（无 active key）的 provider 不出行，也不再计未刷新目标 */
  /* unsupported（如 CommandCode）是「上游不支持查余额」，不是刷新失败：既没有账户也没有可刷的目标，
     计进 total 只会把正常状态算成未刷新，限额改由 cmdcode 站点展示 */
  const visible = providers.filter((provider) => !cchpIsClouder(provider.name)
    && !cchpUnsupported(provider.status)
    && !provider.noActiveKey);
  let total = 0;
  const targets = [];
  for (const provider of visible) {
    const keyIds = Array.isArray(provider.keyIds) ? provider.keyIds : [];
    if (CCHP_SINGLE_ACCOUNT) {
      /* 每个可见 provider 固定 1 个目标：有代表 key 才发请求，没有也计未完成 */
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
  /* 没有可刷新的目标（如只有 Clouder 或都缺 keyIds）：不必提示超时 */
  if (!targets.length) return { ok: 0, total, timedOut: false };
  /* 进入刷新阶段前先看预算：已被 keys 吃完就跳过，沿用首次列表值 */
  if (cchpBudgetSpent()) return { ok: 0, total, timedOut: true };
  let ok = 0;
  let timedOut = false;
  await mapLimit(targets, CCHP_KEY_CONCURRENCY, async (target) => {
    /* 刷新阶段每个请求派发前同样检查预算，剩下的 key 留给下一轮 */
    if (cchpBudgetSpent()) {
      timedOut = true;
      return;
    }
    try {
      const url = `${site.base}/api/account/orgs/${orgId}/providers/${encodeURIComponent(target.id)}`
        + `/keys/${encodeURIComponent(target.keyId)}/balance?refresh=true`;
      const response = await cchpRequest("get", url, headers);
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      /* 只关心是否成功；上游返回的明细不进面板，也不落缓存 */
      const body = parseBody(response);
      if (body && body.error) throw new Error("上游查询失败");
      ok += 1;
    } catch (error) { /* 单把 key 失败不影响其它 key；由调用方按 ok < total 标记降级 */
      /* 等待期撞上预算：和其它失败一样只降级，但要让调用方知道是超时不是拒绝 */
      if (error && error.code === "cchp_timeout") timedOut = true;
    }
  });
  return { ok, total, timedOut: timedOut || cchpBudgetSpent() };
}

async function fetchCchpSite(site, headers) {
  /* 从进入 CCHP 开始记总预算，后续每个请求派发前都检查 */
  cchpBeginBudget();
  const orgId = await fetchCchpOrgId(site, headers);
  const snapshot = await fetchCchpProviders(site, orgId, headers);
  const providers = snapshot.providers || [];
  const priorities = await fetchCchpPriorities(site, orgId, providers, headers);
  const priorityById = new Map(priorities.items.map((item) => [item.id, item.priority]));
  const keyIdsById = new Map(
    priorities.items.map((item) => [String(item.id), Array.isArray(item.keyIds) ? item.keyIds : []])
  );
  /* keys/page 取全，而该 provider 一把 active key 都没有（全部停用，或压根没建 key）：按已停用处理，不出行。
     Clouder 的余额由 CCH 站点提供，不受这条判据影响；keys/page 取不全时一律不隐藏任何行 */
  const noActiveKeyOf = (provider) => Boolean(priorities.keysComplete)
    && !(keyIdsById.get(String(provider.id)) || []).length
    && !cchpIsClouder(provider.name);
  /* 余额实时：先逐把 key 触发上游复查，再取一次聚合列表。
     列表本身失败回退旧快照时不再刷新；刷新不全（部分失败/缺 keyIds/被预算跳过）沿用首次列表值并标 balanceStale */
  let current = providers;
  let balanceStale = false;
  let balancePartial = false;
  let balanceTimedOut = false;
  /* 刷新本身不全且重取超时：超时提示已解释未刷新，不再重复 */
  let balanceSuppressStale = false;
  if (!snapshot.stale && providers.length) {
    const refresh = await refreshCchpBalances(
      site,
      orgId,
      providers.map((provider) => ({ id: provider.id, name: provider.name,
        status: provider.balance ? provider.balance.status : null,
        /* 已停用（无 active key）的 provider 不出行，也不再计未刷新目标 */
        noActiveKey: noActiveKeyOf(provider),
        keyIds: keyIdsById.get(String(provider.id)) || [] })),
      headers
    );
    if (refresh.timedOut) balanceTimedOut = true;
    if (refresh.ok < refresh.total) {
      balanceStale = true;
      /* 有成功也有失败：只提示「部分未刷新」，不谎称整块都来自缓存 */
      balancePartial = refresh.ok > 0;
    }
    /* 只要有成功就重取列表：部分失败时也要拿刷新后的聚合值 */
    if (refresh.ok > 0) {
      try {
        if (cchpBudgetSpent()) throw cchpTimeoutError();
        current = await fetchCchpProviderList(site, orgId, headers);
      } catch (error) {
        /* 重取失败：服务端聚合没拿到，仍显示首次列表值；预算耗尽也算超时 */
        if (error && error.code === "cchp_timeout") {
          balanceTimedOut = true;
          /* 刷新本身不全时，超时提示已解释；刷新全成功但重取失败仍要提示未刷新 */
          balanceSuppressStale = refresh.ok < refresh.total;
        }
        balanceStale = true;
        /* 重取失败意味着所有行都是首次列表值，不能再说「部分未刷新」 */
        balancePartial = false;
      }
    }
    writeCchpCache("balance", site.base, orgId, current);
  }
  /* 余额与优先级之后再取今日用量：失败或超预算只丢这块，不影响余额行 */
  const usage = await fetchCchpUsage(site, headers);
  /* 单账户视图只投影展示返回值，缓存里仍是原始快照；开关来回切换互不影响 */
  let singleAccountUnavailable = false;
  const displayProviders = current.map((provider) => {
    const noActiveKey = noActiveKeyOf(provider);
    let balance = provider.balance;
    /* Clouder 的余额行由 CCH 站点提供，投影会误判不可用；保持原样。
       unsupported 的 provider 本来就没有账户，投影只会造出「单账户余额不可用」；
       已停用（无 active key）的 provider 不出行，也不用再投影 */
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
      /* 无 active key：cchpRows 跳过该行 */
      noActiveKey,
      balance,
    };
  });
  return {
    kind: "cchp",
    stale: snapshot.stale,
    /* 单账户模式有 provider 找不到唯一账户：不显示金额，由调用方提示 */
    singleAccountUnavailable: Boolean(singleAccountUnavailable),
    /* 余额没刷新全：显示的是服务端缓存（聚合列表）里的值 */
    balanceStale: Boolean(balanceStale),
    /* 只有一部分 provider 刷新成功：提示部分未刷新，而不是整块未刷新 */
    balancePartial: Boolean(balancePartial),
    /* 刷新不全且重取超时：超时提示已解释，不再重复「余额未刷新」 */
    balanceSuppressStale: Boolean(balanceSuppressStale),
    /* 部分请求因总预算耗尽被跳过（含刷新阶段与重取列表）；priority 回退过旧值 / 回退后仍缺 */
    timedOut: Boolean(snapshot.timedOut || priorities.timedOut || balanceTimedOut),
    priorityMissing: Boolean(priorities.missing),
    /* 今日用量（today）与按 providerId 的健康数据；取不到为 null */
    summary: usage.summary,
    health: usage.health,
    /* 保留 id/name/host/priority：id 用于关联健康数据，其余供 cchSitePriorities 排序 */
    providers: displayProviders,
  };
}

/* 品牌取名称第一段：Clouder-Astra → Clouder */
function cchpIsClouder(name) {
  return providerBrand(name).toLowerCase() === "clouder";
}

/* 上游自报「不支持查余额」（CCHP 的 balance.status=unsupported）：不是刷新失败，也不该投影成单账户 */
function cchpUnsupported(status) {
  return String(status === undefined || status === null ? "" : status).trim().toLowerCase() === "unsupported";
}

/* 单账户展示投影：按代表 key 找 account，找不到再退回唯一的 account；
   多账户且无匹配即不可用，禁止回退 totals/total_usd 聚合值（那会把同一账户的重复读数相加）。
   只用于展示返回值，不写回 cchp_balance_* 缓存。 */
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

/* 成功率一位小数、TTFT P50 一位小数秒；缺行或 requests=0 不追加，单个字段缺失只省该段 */
function cchpHealthParts(data, provider) {
  const health = data.health && provider.id ? data.health.get(String(provider.id)) : null;
  if (!health) return [];
  const requests = numeric(health.requests);
  if (requests === null || requests <= 0) return [];
  const parts = [];
  const rate = numeric(health.successRate);
  const ttft = numeric(health.ttftP50Ms);
  /* 成功率是锚点：缺失时不追加（裸一个秒数看不出是什么），TTFT 缺失只加成功率 */
  if (rate === null) return parts;
  parts.push(`${(rate * 100).toFixed(1)}%`);
  if (ttft !== null) parts.push(`${(ttft / 1000).toFixed(1)}s`);
  return parts;
}

/* 域名比对键：小写，去协议、用户信息、路径、查询、片段、端口，再剥掉开头的 www. / api.；
   CCHP provider 的 website_url 与 CommandCode 站点地址写法不同，统一到这里再比 */
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

/* 限额行第 1 行的成功率/TTFT：按域名把本站对到 CCHP 的 provider，再取同一套健康数值。
   找不到 CCHP 结果、provider 或健康数据都返回空数组（只显示站名，不影响余额行） */
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

/* 供应商行必须一行内显示：超宽时依次省掉「余额」二字、舍弃 TTFT，最后只留余额 */
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
  /* 收尾：仍超宽就截短供应商名，保证单行 */
  return fitRowWidth([label, amountText], CCH_ROW_WIDTH);
}

/* 余额行：只显示 status=ok、有 active key（keys/page 取全时）且有数值（或 unlimited）的 provider；
   Clouder 由 CCH 站点提供 */
function cchpRows(data) {
  const rows = [];
  for (const provider of data.providers || []) {
    if (cchpIsClouder(provider.name)) continue;
    /* 已停用：keys/page 取全且该 provider 一把 active key 都没有（全部停用或未建 key） */
    if (provider.noActiveKey) continue;
    const balance = provider.balance || {};
    if (String(balance.status || "").toLowerCase() !== "ok") continue;
    const unlimited = balance.unlimited === true;
    /* total_usd 只用于金额展示与出行判断：不同币种的原值不能直接比较，金额不参与排序 */
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

/* 今日用量：summary 缺失或 requests=0 不占行；超宽时先截短/去掉站名前缀，
   再依次省首字、百分比，保证单行 */
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
  /* 带站名：前缀按剩余宽度截短；放不下时去掉站名，最后只留次数 */
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

/* 多个 CCHP 站点时前缀站名，避免分不清是哪家的用量 */
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

/* 行不显示时用警告色提示：状态非 ok，或既无金额也无不限量；
   上游自报 unsupported（如 CommandCode）是「查不了」而非「查坏了」，不据此提高风险 */
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
    /* 余额查不到的供应商按限额占一行；amount 留空只用于展示，不参与排序 */
    if (item.data.kind === "limits") {
      /* 第 2 行只放限额指标：没有可展示字段就整行不占位（由图标提示异常） */
      const metrics = cchLimitMetricsText(item.data, CCH_ROW_WIDTH);
      if (!metrics) continue;
      /* 第 1 行 = 站名 + CCHP 健康数据（按域名匹配不到就只显示站名） */
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
      /* 与 CCHP 行同一收尾：窄宽度下截短站名，不折行 */
      parts: fitRowWidth(
        [item.site.name, total ? `余额 ${money(amount)}` : "余额 未设置"],
        CCH_ROW_WIDTH
      ),
    });
  }

  /* 每行按收集顺序记插入序号：同优先级、同名的行靠它收尾，
     不依赖 Array.prototype.sort 对相等元素的稳定性 */
  rows.forEach((row, index) => { row.seq = index; });
  rows.sort(compareRows);

  if (rows.length) {
    /* 站名与金额固定同一行；金额放不下时自动落到下一行。
       限额行（kind=limits）有两行：row.extra 是只含指标的追加行 */
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

  /* CCHP 的余额可能来自旧缓存（列表请求本身失败），或实时刷新失败后仍是服务端缓存值，
     或上游太久没复查，底部给出提示 */
  const notices = [];
  const cchpItems = results.filter((item) => item.data && item.data.kind === "cchp");
  /* 超时会连带造成 priority 缺失，两者只提示一次；整站超时也要提示 */
  const cchpTimedOut = cchpItems.some((item) => item.data.timedOut)
    || results.some((item) => item.error && item.error.code === "cchp_timeout");
  if (cchpItems.some((item) => item.data.stale)) notices.push("⚠️ CCHP 余额来自缓存");
  else if (cchpItems.some((item) => item.data.balancePartial && !item.data.timedOut)) {
    /* 只有部分 provider 没刷到；这部分若已被超时提示解释，就不再重复 */
    notices.push("⚠️ 部分余额未刷新");
  } else if (cchpItems.some((item) => item.data.balanceStale && !item.data.balancePartial && !item.data.balanceSuppressStale)) {
    notices.push("⚠️ 余额未刷新，来自服务端缓存");
  }
  /* 单账户模式找不到唯一 account：该 provider 不显示金额，与余额刷新提示并列只出现一次 */
  if (cchpItems.some((item) => item.data.singleAccountUnavailable)) notices.push("⚠️ 单账户余额不可用");
  /* 限额站点取数失败时显示的是上次缓存，与余额缓存提示分开 */
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

  /* 限额站点：窗口与月度都按剩余比例着色——剩余 ≤5% 红、≤20% 黄（stale 至少黄）。
     1e-9 是给 3.5/70、14/70 这类边界值的浮点余量，避免算出来的 5.0000000000001% 被判成非红。
     limited=false 时窗口比率已在 cmdcodeWindow 里置空（不限量），但月度比率照常参与 */
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

/* ── CommandCode：余额查不到、只能读限额的站点 ── */

/* 上游契约（据 command-code CLI 1.88.0 反查）：/alpha/whoami?limits=1 取 org.id，
   再按 orgId 取 credits.windowLimits 与月度额度；金额单位为 USD，面板不做汇率换算。
   orgId 为 null（个人账户）时 credits 不带 orgId 参数。
   线上还见过 windowLimits 挂在 body 顶层、下划线命名、窗口键与 used/cap 换名：都按别名兼容，
   但 canonical 字段存在即不再回退别名（值非法按缺失处理），取不到时不影响原有结果。 */
const CMDCODE_WINDOWS = [
  ["fiveHour", "5H", ["fiveHour", "five_hour", "five_hours", "5h"]],
  ["weekly", "W", ["weekly", "week", "sevenDay", "7d"]],
];
/* windowLimits 的两种写法，按顺序在 credits、body 上各找一遍 */
const CMDCODE_LIMIT_HOLDERS = ["windowLimits", "window_limits"];
const CMDCODE_USED_KEYS = ["used", "current", "spent"];
const CMDCODE_CAP_KEYS = ["cap", "limit", "max", "total"];
/* 诊断每轮运行最多一条：多个 cmdcode 站点同时缺窗口时不重复刷屏 */
let cmdcodeMissingLogged = false;

/* 缓存按「站点地址 + 凭据指纹」分区：换 key 不会读到上一账户的限额。
   指纹取 SHA-256(`base|credential`) 的前 32 个十六进制字符（128 bit，生日界约 2^64，
   足够抗碰撞又不让键名冗长）；原始凭据只参与哈希，不落盘 */
function cmdcodeCacheKey(site) {
  return `cch_limits_v2_${sha256Hex(`${site.base}|${String(site.credential || "")}`).slice(0, 32)}`;
}

/* 缓存只存原始额度：cap 与 ratio 依赖运行参数 cch_cmdcode_month_cap，
   存进缓存后改上限会一直显示旧比例；读取时按当前参数重算，且不改写缓存对象 */
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
    /* remaining 只由三项原始额度相加得到，与 cap 无关，随缓存一起保存 */
    monthly: { monthly: monthly.monthly, purchased: monthly.purchased, free: monthly.free,
      remaining: monthly.remaining },
    stale: false,
  };
}

/* 读到缓存后按当前 CMDCODE_MONTH_CAP 重新投影：窗口比率也由原始 used/cap 重算，
   返回新对象（缓存里的 data 保持原样） */
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

/* 有效期与其它额度缓存一致：模块默认 600 秒；直接调用脚本且未传 cch_quota_interval 时回退 300 秒。
   过期缓存仍返回，由调用方决定是否回退；fresh 与 stale 两条路径都走同一套重投影 */
function readCmdcodeCache(site) {
  try {
    const raw = $persistentStore.read(cmdcodeCacheKey(site));
    if (!raw) return null;
    const cache = JSON.parse(raw);
    /* v1 是上一版缓存：同样带原始额度，只是多了已算好的 cap/ratio；一并重投影，升级不丢缓存 */
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

/* 非 200 与传输失败一律抛错：由调用方回退缓存，或让该站点不占行（不写半截数据） */
async function cmdcodeGet(site, path, headers) {
  const response = await request("get", `${site.base}${path}`, headers);
  if (response.status !== 200) {
    cchpLog(`CommandCode ${String(path).split("?")[0]} HTTP ${response.status}`);
    throw new Error(`HTTP ${response.status}`);
  }
  return parseBody(response);
}

/* 三个指标统一显示「剩余」百分比：值 = 剩余 / 上限 = 100% − 已用%，clamp 到 0–1。
   limited=false 是不限量：历史 used/cap 不再代表当前用量，比率置空（窗口仍写「不限」）；
   上限缺失或为 0 时没有使用率可言，同样不能当成 100% */
function cmdcodeWindow(key, label, raw, unlimited) {
  const source = raw && typeof raw === "object" ? raw : {};
  const used = cmdcodePick(source, CMDCODE_USED_KEYS);
  const cap = cmdcodePick(source, CMDCODE_CAP_KEYS);
  const ratio = !unlimited && used !== null && cap !== null && cap > 0
    ? Math.min(1, Math.max(0, (cap - used) / cap))
    : null;
  return { key, label, used, cap, ratio };
}

/* 字段别名取值：canonical 字段只要存在就定了结果——值必须是有限 number，否则按缺失处理，
   不再回退后面的别名（数组/对象/布尔/空串/数字字符串都不是数值） */
function cmdcodePick(source, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return null;
}

/* 窗口对象：按属性存在性取第一个出现的键，值与类型都留给调用方判断（诊断要报原始类型）；
   存在即定案，值非法也不回退后面的别名 */
function cmdcodeFindWindow(source, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, alias)) return { alias, value: source[alias] };
  }
  return { alias: null, value: undefined };
}

/* limited 归一：布尔原样，字符串 "true"/"false"（大小写与空白不敏感）也认，其它值按缺失处理 */
function cmdcodeLimited(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return null;
}

/* limited=false 是「不限量」：上游没给窗口数据时也照样写「不限」；
   limited=true 或缺失时只保留真给了窗口对象的窗口，缺的窗口整段省略 */
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

/* windowLimits 的落点：credits.windowLimits → credits.window_limits → body.windowLimits → body.window_limits，
   按属性存在性取第一个命中的层：命中即定案（值是 null/非对象就给空对象），不再往低优先级找 */
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

/* 月度：剩余金额 = 计划内额度 + 已购 + 赠送；三项全缺才算未知（缺其中一项按 0 计，不能凭空少算）。
   剩余百分比按套餐上限折算：M% = clamp(monthlyCredits / cap, 0, 1)，即 100% − 已用%；
   接口不返回本月已用，只能用「套餐价 - 计划内剩余额度」反推，所以分子只取计划内额度，
   已购/赠送只进「剩余金额」、不由它们抬高剩余比例。monthlyCredits 缺失或 cap 非法
   （≤0/非数字）时不给比率，行内回退成剩余金额。 */
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

/* 键名列表（对象才有意义）：[a,b]；非对象/数组/空对象统一给 - 或 [] */
function cmdcodeKeyList(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "-";
  const keys = Object.keys(value);
  return keys.length ? `[${keys.join(",")}]` : "[]";
}

/* 第一个「存在该属性」的原始值（只看存在性，不看类型）：诊断只报它的类型，不报值 */
function cmdcodeFirstRaw(holders, name) {
  for (const holder of holders) {
    if (!holder || typeof holder !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(holder, name)) return holder[name];
  }
  return undefined;
}

/* limited 不为 false 却一个窗口都取不到时打一行：上游换了字段名、层级或命名风格，靠这行定位。
   只含字段名与类型名（plan/limited 也只报 number/string/object/null/undefined），
   不写任何响应值、金额与凭据；整轮运行最多一条（多个站点同时缺窗口不刷屏） */
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
  /* windowLimits 可能挂在 credits 或 body 上（驼峰/下划线两种写法都见过） */
  const windowLimits = cmdcodeWindowLimits(credits, body);
  const planId = String(credits.planId || (body && body.planId) || "").trim();
  /* limited 可能写在 windowLimits 里，也可能在 credits/body 顶层；"false"/"true" 字符串同样归一 */
  let limited = cmdcodeLimited(windowLimits.limited);
  if (limited === null) limited = cmdcodeLimited(credits.limited);
  if (limited === null && body && body !== credits) limited = cmdcodeLimited(body.limited);
  const limits = {
    kind: "limits",
    site: { name: site.name },
    /* 上游 planId 原样保留：面板不展示，不猜套餐名映射 */
    plan: planId || null,
    limited,
    windows: cmdcodeWindows(windowLimits, limited),
    monthly: cmdcodeMonthly(credits),
    stale: false,
  };
  cmdcodeLogMissingWindows(limits, credits, body, windowLimits);
  /* 200 但一个可展示字段都没有（credits 缺失/空对象/字段全缺）：当成取数失败，
     不能拿空响应覆盖上次有效缓存 */
  if (!cmdcodeDisplayable(limits)) throw new Error("credits 里没有任何可展示字段");
  return limits;
}

/* 至少一个能写进限额行的字段：不限量的窗口，或带比率/金额的窗口与月度 */
function cmdcodeDisplayable(limits) {
  if (numeric(limits && limits.monthly && limits.monthly.remaining) !== null) return true;
  if (limits && limits.limited === false) return true;
  return (Array.isArray(limits && limits.windows) ? limits.windows : [])
    .some((window) => window.ratio !== null);
}

/* 缓存有效期内不发请求；取数失败回退上次缓存并标 stale，没有缓存才抛错（该站点不占行，由面板图标提示） */
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

/* 金额：≥1e6 用 M（12345678 → $12.3M）、≥1e4 用 k（12345 → $12k），
   ≥100 取整（$1234），其余一位小数并去掉尾部 .0（56.0 → $56）；不用 cchMoney，它会固定两位小数 */
function cchLimitMoney(value) {
  const amount = numeric(value);
  if (amount === null) return "-";
  const abs = Math.abs(amount);
  if (abs >= 1e6) return `$${(amount / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1e4) return `$${Math.round(amount / 1e3)}k`;
  if (abs >= 100) return `$${Math.round(amount)}`;
  return `$${amount.toFixed(1).replace(/\.0$/, "")}`;
}

/* 百分比固定两位小数，与余额两位小数同一口径（0.8577 → 85.77%，满额 100.00%、清零 0.00%）。
   只影响显示精度，风险色仍按原始 ratio 判断（见 cchRisk） */
function cmdcodePercent(ratio) {
  return `${(Number(ratio) * 100).toFixed(2)}%`;
}

/* 限额行字段：只写 5H / W / 月度的剩余百分比，不出现「余额」二字；limited=false 时该窗口写「不限」。
   M 有可用上限时写剩余百分比，上限缺失/非法才回退成剩余金额 */
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

/* 三项指标（两个窗口 + 月度）的四种排法：完整 · 紧凑 · 紧凑空格 · 无分隔（最窄一档） */
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

/* 只输出指标、不含站名（两行显示的第 2 行）：同一套四种排法从宽到窄取第一种放得下的，
   都放不下时截短最紧排法；一个可展示字段都没有时返回空串，调用方整行不占位 */
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

/* 每个站点各自取数，一个站点失败只影响它自己那行 */
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
