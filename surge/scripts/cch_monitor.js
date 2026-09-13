/* CCH 额度面板（普通用户视角）：展示总额度与并发 session 占用。 */

const ARGS = parseArgs($argument || "");
const API_KEY = String(ARGS.cch_api_key || "").trim();
const PANEL_TITLE = "CCH";
const PANEL_ICON = String(ARGS.cch_icon || "chart.bar.fill").trim() || "chart.bar.fill";
const iconColorRaw = String(ARGS.cch_icon_color || "").trim();
const PANEL_ICON_COLOR = /^[0-9a-fA-F]{6}$/.test(iconColorRaw) ? `#${iconColorRaw}` : "#34C759";
const WARN_ICON_COLOR = "#F59E0B";
const DANGER_ICON_COLOR = "#EF4444";
const ERROR_ICON = "exclamationmark.triangle.fill";

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

/* 兼容带 scheme 与不带 scheme 的写法，去掉末尾斜杠 */
function normalizeBaseUrl(value) {
  let base = String(value || "").trim();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base.replace(/\/+$/, "");
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    $httpClient.get({ url, headers, timeout: 15000 }, (error, response, data) => {
      if (error) return reject(new Error(error));
      resolve({ status: response.status, body: data });
    });
  });
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

function finish(content, icon = PANEL_ICON, iconColor = PANEL_ICON_COLOR) {
  $done({ title: PANEL_TITLE, content, icon, "icon-color": iconColor });
}

function fail(message) {
  finish(`❌ ${message}`, ERROR_ICON, DANGER_ICON_COLOR);
}

function numeric(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* 返回值可能是 {data:{...}} 包装或直接对象 */
function unwrap(json) {
  if (json && typeof json.data === "object" && json.data) return json.data;
  return json || {};
}

async function fetchQuota(base) {
  const response = await httpGet(`${base}/api/v1/me/quota`, {
    Accept: "application/json",
    "X-API-Key": API_KEY,
  });
  if (response.status === 401) throw new Error("API Key 无效");
  if (response.status === 403) throw new Error("无 read 权限，请检查 Key 权限");
  if (response.status === 404) throw new Error("接口不存在，请检查 CCH 地址与版本");
  if (response.status !== 200) throw new Error(`API 请求失败 (HTTP ${response.status})`);

  let json;
  try { json = JSON.parse(response.body); }
  catch (_) { throw new Error("API 响应解析失败"); }
  return unwrap(json);
}

/* 总额度：优先 Key 级，其次用户级 */
function totalQuota(quota) {
  const candidates = [
    ["key", numeric(quota.keyLimitTotalUsd), numeric(quota.keyCurrentTotalUsd)],
    ["user", numeric(quota.userLimitTotalUsd), numeric(quota.userCurrentTotalUsd)],
  ];
  for (const [, limit, used] of candidates) {
    if (limit !== null && limit > 0) return { limit, used: used === null ? 0 : used };
  }
  return null;
}

/* 并发 session：优先 Key 级，其次用户级 */
function concurrency(quota) {
  const candidates = [
    numeric(quota.keyLimitConcurrentSessions),
    numeric(quota.userLimitConcurrentSessions),
  ];
  let limit = null;
  for (const value of candidates) {
    if (value !== null && value > 0) { limit = value; break; }
  }
  const keyCurrent = numeric(quota.keyCurrentConcurrentSessions);
  const userCurrent = numeric(quota.userCurrentConcurrentSessions);
  const current = keyCurrent !== null ? keyCurrent : userCurrent;
  if (limit === null && current === null) return null;
  return { limit, current: current === null ? 0 : current };
}

function healthColor(quota) {
  const total = totalQuota(quota);
  if (!total || total.limit <= 0) return PANEL_ICON_COLOR;
  const ratio = Math.max(0, Math.min(1, (total.limit - total.used) / total.limit));
  if (ratio <= 0.1) return DANGER_ICON_COLOR;
  if (ratio <= 0.3) return WARN_ICON_COLOR;
  return PANEL_ICON_COLOR;
}

function renderPanel(quota) {
  const lines = [];

  const total = totalQuota(quota);
  if (total) {
    const remaining = total.limit - total.used;
    const percent = (Math.max(0, Math.min(1, remaining / total.limit)) * 100).toFixed(1);
    lines.push(`总额度 ${money(remaining)} / ${money(total.limit)} · ${percent}%`);
  } else {
    lines.push("总额度 未设置");
  }

  const session = concurrency(quota);
  if (session) {
    lines.push(session.limit === null ? `并发 ${session.current}` : `并发 ${session.current} / ${session.limit}`);
  } else {
    lines.push("并发 未设置");
  }

  lines.push(`更新 ${formatTime()}`);

  return lines.join("\n");
}

(async () => {
  try {
    const base = normalizeBaseUrl(ARGS.cch_url);
    if (!base) return finish("未配置", PANEL_ICON, "8E8E93");
    if (!API_KEY) return finish("未配置", PANEL_ICON, "8E8E93");

    const quota = await fetchQuota(base);
    finish(renderPanel(quota), PANEL_ICON, healthColor(quota));
  } catch (error) {
    fail(String((error && error.message) || error));
  }
})();
