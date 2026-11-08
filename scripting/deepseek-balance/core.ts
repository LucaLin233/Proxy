// DeepSeek 余额 · 数据层
// 取数 → 记录消耗 → 生成小组件 / App 共用的 PanelData；在调用方给的缓存窗口内复用，避免同一次刷新重复打接口。
import { fetchBalance } from "./api"
import type { BalanceInfo } from "./api"
import {
  applyBalance,
  loadConfig,
  loadUsage,
  markFailure,
  pickPrimary,
  saveConfig,
} from "./config"
import type { DeepSeekConfig } from "./config"

export type PanelStatus = "online" | "offline" | "debt" | "unset"

export type PanelData = {
  config: DeepSeekConfig
  /** 主币种余额；失败时用上一次成功的数据补齐 */
  info: BalanceInfo | null
  /** 其他币种的余额（DeepSeek 通常只返回 CNY） */
  extra: BalanceInfo[]
  status: PanelStatus
  error: string
  /** 最近一次成功取数时间（头部时钟） */
  updatedAt: number
  /** 本次检查时间（缓存 TTL 用） */
  checkedAt: number
  fromCache: boolean
  todaySpend: number
  weekSpend: number
  todayChecks: number
}

const STORE_CACHE = "deepseek.panel.v2"
const CACHE_TTL = 90 * 1000

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function infoFromConfig(config: DeepSeekConfig): BalanceInfo {
  return {
    currency: config.currency || "CNY",
    total: config.available,
    granted: config.granted,
    toppedUp: config.toppedUp,
  }
}

function makePanel(
  config: DeepSeekConfig,
  info: BalanceInfo | null,
  extra: BalanceInfo[],
  status: PanelStatus,
  error: string,
  updatedAt: number,
  checkedAt: number,
  fromCache: boolean,
): PanelData {
  const usage = loadUsage()
  const dayStart = startOfDay(checkedAt)
  const weekStart = checkedAt - 7 * 24 * 60 * 60 * 1000
  let todaySpend = 0
  let weekSpend = 0
  let todayChecks = 0
  for (const entry of usage) {
    if (entry.t >= weekStart) weekSpend += entry.spend
    if (entry.t >= dayStart) {
      todaySpend += entry.spend
      todayChecks += 1
    }
  }
  return {
    config,
    info,
    extra,
    status,
    error,
    updatedAt,
    checkedAt,
    fromCache,
    todaySpend: Math.round(todaySpend * 100) / 100,
    weekSpend: Math.round(weekSpend * 100) / 100,
    todayChecks,
  }
}

function readCache(): PanelData | null {
  try {
    const stored: any = Storage.get(STORE_CACHE)
    const parsed: any = typeof stored === "string" ? JSON.parse(stored) : stored
    if (!parsed || typeof parsed !== "object") return null
    if (!parsed.config || typeof parsed.config !== "object") return null
    if (!parsed.checkedAt) return null
    return parsed as PanelData
  } catch (_) {
    return null
  }
}

function writeCache(data: PanelData) {
  try {
    Storage.set(STORE_CACHE, JSON.stringify(data))
  } catch (_) {}
}

export function clearPanelCache() {
  try {
    Storage.remove(STORE_CACHE)
  } catch (_) {}
}

/** 打开 App 时先用上一次成功的数据垫底，避免白屏等接口 */
export function initialPanel(): PanelData {
  const config = loadConfig()
  if (!config.apiKey) return makePanel(config, null, [], "unset", "", 0, Date.now(), false)
  const info = config.lastOk > 0 ? infoFromConfig(config) : null
  const status: PanelStatus = config.lastError ? "offline" : info ? "online" : "unset"
  return makePanel(config, info, [], status, config.lastError, config.lastOk, Date.now(), true)
}

/**
 * 拉取余额。force = true 时绕过缓存（App 里手动刷新）；cacheMs 由调用方按刷新间隔传入。
 * 失败不会清空最后一次成功余额：小组件和 App 都会显示上次数据 + 失联状态。
 */
export async function loadPanel(force: boolean, cacheMs: number = CACHE_TTL): Promise<PanelData> {
  let config = loadConfig()
  if (!config.apiKey) {
    const panel = makePanel(config, null, [], "unset", "", 0, Date.now(), false)
    writeCache(panel)
    return panel
  }

  if (!force) {
    const cached = readCache()
    if (cached && Date.now() - cached.checkedAt < Math.max(0, cacheMs)) {
      return { ...cached, fromCache: true }
    }
  }

  const now = Date.now()
  const result = await fetchBalance(config.apiKey)

  if (result.ok) {
    /* api.ts 只在 infos 非空时返回 ok */
    const primary = pickPrimary(result.infos) as BalanceInfo
    config = applyBalance(config, result.infos, now)
    saveConfig(config)
    const extra = result.infos.filter((item) => item !== primary)
    const status: PanelStatus = !result.isAvailable || primary.total <= 0 ? "debt" : "online"
    const panel = makePanel(config, primary, extra, status, "", now, now, false)
    writeCache(panel)
    return panel
  }

  config = markFailure(config, result.error, now)
  saveConfig(config)
  const cached = readCache()
  const fallback = config.lastOk > 0
    ? infoFromConfig(config)
    : cached && cached.info
      ? cached.info
      : null
  const panel = makePanel(
    config,
    fallback,
    cached ? cached.extra : [],
    "offline",
    result.error,
    config.lastOk || (cached ? cached.updatedAt : 0),
    now,
    true,
  )
  writeCache(panel)
  return panel
}

/* ── 展示格式 ── */

/** 低余额标红阈值；旧缓存没有这个字段时按默认 10 处理，0 表示关闭。 */
export function lowBalanceOf(config: DeepSeekConfig): number {
  const n = Number(config.lowBalance)
  return Number.isFinite(n) ? Math.max(0, n) : 10
}

export function isLowBalance(config: DeepSeekConfig, total: number): boolean {
  const threshold = lowBalanceOf(config)
  return threshold > 0 && total < threshold
}

export function symbolOf(currency: string): string {
  const code = String(currency || "").toUpperCase()
  if (code === "CNY" || code === "RMB") return "¥"
  if (code === "USD") return "$"
  if (code === "EUR") return "€"
  return code ? `${code} ` : "¥"
}

export function formatMoney(value: number): string {
  const n = Number.isFinite(value) ? value : 0
  const abs = Math.abs(n)
  if (abs >= 100000) {
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
  }
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatAmount(currency: string, value: number): string {
  return symbolOf(currency) + formatMoney(value)
}

/** 消耗金额：0 不带负号，避免出现 -¥0.00 */
export function formatSpendAmount(currency: string, value: number): string {
  if (!(value > 0)) return formatAmount(currency, 0)
  return `-${formatAmount(currency, value)}`
}

export function formatClock(t: number): string {
  if (!t) return "--:--"
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

export function formatDate(t: number): string {
  if (!t) return "—"
  const d = new Date(t)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 占比文案：非零但不足 1% 显示 <1%，超过 99% 但未满显示 >99%，避免出现「0% / 100%」的误导。 */
export function shareText(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—"
  const pct = clamp01(ratio) * 100
  if (pct > 0 && pct < 0.5) return "<1%"
  if (pct > 99.5 && pct < 100) return ">99%"
  return `${Math.round(pct)}%`
}

export function statusText(status: PanelStatus): string {
  if (status === "online") return "在线"
  if (status === "debt") return "欠费"
  if (status === "offline") return "失联"
  return "未配置"
}
