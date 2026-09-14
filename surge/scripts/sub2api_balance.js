/* Sub2API 余额面板（多站点聚合）：一行一个站点，展示余额/额度与到期时间。 */

const ARGS = parseArgs($argument || "");
const TITLE = String(ARGS.sub2api_title || "API 中转站").trim() || "API 中转站";
const RAW_ENDPOINTS = String(ARGS.sub2api_endpoints || "").trim();
const PANEL_ICON = String(ARGS.sub2api_icon || "dollarsign.circle").trim() || "dollarsign.circle";
const iconColorRaw = String(ARGS.sub2api_icon_color || "").trim();
const PANEL_ICON_COLOR = /^[0-9a-fA-F]{6}$/.test(iconColorRaw) ? `#${iconColorRaw}` : "#5B8DEF";
const WARN_ICON_COLOR = "#F59E0B";
const DANGER_ICON_COLOR = "#EF4444";
const ERROR_ICON = "exclamationmark.triangle.fill";

/* 参数留空时 Number("") 为 0，会静默关闭提醒，故空值按未配置处理 */
function numberArg(value, fallback) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (text === "") return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

const WARN_BALANCE = numberArg(ARGS.sub2api_warn_balance, 1);
const NOTIFY_BALANCE = numberArg(ARGS.sub2api_notify_balance, 1);
const MAX_SITES = 5;
const CACHE_KEY = "sub2api_balance_cache";
const CACHE_TTL_MS = 24 * 3600 * 1000;

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

/* 站点写法：host=key 或 名称@host=key，多个站点用竖线分隔 */
function parseEndpoints(input) {
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

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    $httpClient.get({ url, headers, timeout: 15000 }, (error, response, data) => {
      if (error) return reject(new Error(error));
      resolve({ status: response.status, body: data });
    });
  });
}

/* null 与 0 必须区分：未返回的字段不能当成 0 展示或判断 */
function numeric(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function finish(content, icon = PANEL_ICON, iconColor = PANEL_ICON_COLOR) {
  $done({ title: TITLE, content, icon, "icon-color": iconColor });
}

function readCache() {
  try {
    const raw = $persistentStore.read(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !cached.results) return null;
    if (Date.now() - Number(cached.at || 0) > CACHE_TTL_MS) return null;
    return cached;
  } catch (_) { return null; }
}

function writeCache(results) {
  try {
    const slim = results.map((item) => ({
      site: { name: item.site.name, host: item.site.host },
      ok: item.ok,
      error: item.error || null,
      data: item.data || null,
    }));
    $persistentStore.write(JSON.stringify({ at: Date.now(), results: slim }), CACHE_KEY);
  } catch (_) {}
}

async function fetchSite(site) {
  try {
    const response = await httpGet(usageURL(site.host), {
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

function siteLine(result) {
  if (!result.ok) return `${result.site.name}  ❌ ${result.error}`;
  return `${result.site.name}  ${summaryText(result.data)}${expirySuffix(result.data)}`;
}

/* 面板字体为比例字体，空格无法对齐，统一用分隔点 */
function siteLines(results) {
  return results.map((item) => {
    const name = String(item.site.name);
    if (!item.ok) return `${name} · ❌ ${item.error}`;
    return `${name} · ${summaryText(item.data)}${expirySuffix(item.data)}`;
  });
}

/* 额度健康度：任一站点剩余比例过低即视为告警 */
function healthRatio(results) {
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

function healthColor(results) {
  const ratio = healthRatio(results);
  if (ratio === null) return PANEL_ICON_COLOR;
  if (ratio <= 0.1) return DANGER_ICON_COLOR;
  if (ratio <= 0.3) return WARN_ICON_COLOR;
  return PANEL_ICON_COLOR;
}

function lowBalanceSites(results) {
  if (WARN_BALANCE <= 0) return [];
  const hits = [];
  for (const item of results) {
    if (!item.ok || !item.data) continue;
    let amount = null;
    if (item.data.quota) amount = numeric(item.data.quota.remaining);
    else if (item.data.balance !== undefined) amount = numeric(item.data.balance);
    else amount = numeric(item.data.remaining);
    if (amount !== null && amount < WARN_BALANCE) hits.push(`${item.site.name} ${money(amount)}`);
  }
  return hits;
}

function renderPanel(results, extraLines) {
  const lines = siteLines(results);
  const hits = lowBalanceSites(results);
  if (hits.length) lines.push(`⚠️ 余额偏低：${hits.join(" · ")}`);
  if (extraLines && extraLines.length) for (const line of extraLines) lines.push(line);
  lines.push(`更新 ${formatTime()}`);
  return lines.join("\n");
}

function notifyLowBalance(results) {
  if (NOTIFY_BALANCE === 0) return;
  const hits = [];
  for (const item of results) {
    if (!item.ok || !item.data) continue;
    let amount = null;
    if (item.data.quota) amount = numeric(item.data.quota.remaining);
    else if (item.data.balance !== undefined) amount = numeric(item.data.balance);
    else amount = numeric(item.data.remaining);
    if (amount !== null && amount < NOTIFY_BALANCE) hits.push(`${item.site.name} ${money(amount)}`);
  }
  if (!hits.length) return;
  const key = `sub2api_balance_notice_${todayLocal()}`;
  try {
    if ($persistentStore.read(key)) return;
    $notification.post(`${TITLE} 余额提醒`, `低于 ${money(NOTIFY_BALANCE)}：${hits.join(" · ")}`, "请及时充值");
    $persistentStore.write("1", key);
  } catch (_) {}
}

(async () => {
  const mode = String(ARGS.mode || "panel").trim().toLowerCase();
  const isDaily = mode === "daily";
  const sites = parseEndpoints(RAW_ENDPOINTS);

  try {
    if (!sites.length) {
      if (isDaily) return $done();
      return finish("未配置", PANEL_ICON, "8E8E93");
    }
    if (isDaily && String(ARGS.sub2api_daily_notify || "false").trim().toLowerCase() !== "true") {
      return $done();
    }

    const selected = sites.slice(0, MAX_SITES);
    const overflow = sites.length - selected.length;
    const results = await Promise.all(selected.map((site) => fetchSite(site)));

    const allFailed = results.every((item) => !item.ok);
    if (allFailed) {
      const cached = readCache();
      const reason = results[0].error;
      if (!isDaily && cached) {
        const age = Math.max(0, Math.round((Date.now() - Number(cached.at || 0)) / 60000));
        return finish(
          `⚠️ 刷新失败：${reason}\n${renderPanel(cached.results, [])}\n（缓存于 ${age} 分钟前）`,
          ERROR_ICON,
          WARN_ICON_COLOR
        );
      }
      if (isDaily) {
        $notification.post(`${TITLE} 余额日报`, "查询失败", reason);
        return $done();
      }
      return finish(`❌ ${reason}`, ERROR_ICON, DANGER_ICON_COLOR);
    }

    writeCache(results);

    const extra = overflow > 0 ? [`（另有 ${overflow} 个站点未显示）`] : [];

    if (isDaily) {
      const body = results.map((item) => siteLine(item)).join("\n");
      $notification.post(`${TITLE} 余额日报`, `${results.length} 个站点`, body);
      return $done();
    }

    notifyLowBalance(results);
    finish(renderPanel(results, extra), PANEL_ICON, healthColor(results));
  } catch (error) {
    const message = String((error && error.message) || error);
    const cached = readCache();
    if (isDaily) {
      $notification.post(`${TITLE} 余额日报`, "查询失败", message);
      return $done();
    }
    if (cached) {
      const age = Math.max(0, Math.round((Date.now() - Number(cached.at || 0)) / 60000));
      return finish(
        `⚠️ 刷新失败：${message}\n${renderPanel(cached.results, [])}\n（缓存于 ${age} 分钟前）`,
        ERROR_ICON,
        WARN_ICON_COLOR
      );
    }
    finish(`❌ ${message}`, ERROR_ICON, DANGER_ICON_COLOR);
  }
})();
