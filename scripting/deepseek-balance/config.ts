// DeepSeek 余额 · 配置与本地记录
// 配置沿用旧版「DeepSeek 小组件」的 deepseek/config.json，装过旧版的用户不用重新填 Key。
import type { BalanceInfo } from "./api"

export type DeepSeekConfig = {
  /** DeepSeek API Key（sk- 开头） */
  apiKey: string
  /** 最近一次成功查询到的可用余额 */
  available: number
  /** 币种（CNY / USD） */
  currency: string
  /** 赠送余额 */
  granted: number
  /** 充值余额 */
  toppedUp: number
  /** 最近一次查询时间 */
  lastCheck: number
  /** 最近一次成功查询时间 */
  lastOk: number
  /** 最近一次失败原因，成功时清空 */
  lastError: string
  /** 小组件自动刷新周期（分钟） */
  refreshMinutes: number
  /** 低于这个金额时余额标红；0 表示不标红 */
  lowBalance: number
}

export type UsageEntry = {
  /** 采样时间 */
  t: number
  /** 相比上次余额的消耗；充值为 0 */
  spend: number
  /** 采样时的余额 */
  balance: number
}

export const DEFAULT_CONFIG: DeepSeekConfig = {
  apiKey: "",
  available: 0,
  currency: "CNY",
  granted: 0,
  toppedUp: 0,
  lastCheck: 0,
  lastOk: 0,
  lastError: "",
  refreshMinutes: 15,
  lowBalance: 10,
}

/* 刷新间隔可选值（分钟）：与中转站看板一致，最短 15 分钟、最长 12 小时 */
export const REFRESH_CHOICES: number[] = [15, 30, 60, 120, 180, 360, 720]
export const REFRESH_MIN = 15
export const REFRESH_MAX = 720

export function clampRefreshMinutes(value: any): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.refreshMinutes
  return Math.min(REFRESH_MAX, Math.max(REFRESH_MIN, Math.round(n)))
}

export function refreshLabel(minutes: number): string {
  const n = clampRefreshMinutes(minutes)
  if (n < 60) return `${n} 分钟`
  const hours = n / 60
  return Number.isInteger(hours) ? `${hours} 小时` : `${n} 分钟`
}

// App Group Documents 目录 —— widget 环境也能读取
export const deepseekDir = FileManager.appGroupDocumentsDirectory + "/deepseek"
export const configPath = deepseekDir + "/config.json"
/** 新版的采样记录单独放一个文件，避免和旧版 history.json（纯数字数组）互相覆盖 */
export const usagePath = deepseekDir + "/usage.json"

function ensureDir() {
  if (!FileManager.existsSync(deepseekDir)) {
    FileManager.createDirectorySync(deepseekDir, true)
  }
}

function numberOr(value: any, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function loadConfig(): DeepSeekConfig {
  try {
    const raw = FileManager.readAsStringSync(configPath)
    const parsed: any = JSON.parse(raw)
    const merged: DeepSeekConfig = {
      ...DEFAULT_CONFIG,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    }
    merged.apiKey = String(merged.apiKey || "").trim()
    merged.available = numberOr(merged.available, 0)
    merged.currency = String(merged.currency || "CNY").toUpperCase()
    merged.granted = numberOr(merged.granted, 0)
    merged.toppedUp = numberOr(merged.toppedUp, 0)
    merged.lastCheck = numberOr(merged.lastCheck, 0)
    merged.lastOk = numberOr(merged.lastOk, 0)
    merged.lastError = String(merged.lastError || "")
    merged.refreshMinutes = clampRefreshMinutes(merged.refreshMinutes)
    merged.lowBalance = Math.max(0, numberOr(merged.lowBalance, DEFAULT_CONFIG.lowBalance))
    // DeepSeek 按量计费，没有套餐额度；旧版的 peak / refAmount 字段直接丢掉
    delete (merged as any).peak
    delete (merged as any).refAmount
    return merged
  } catch (_) {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: DeepSeekConfig) {
  ensureDir()
  FileManager.writeAsStringSync(configPath, JSON.stringify(config, null, 2))
}

export function loadUsage(): UsageEntry[] {
  try {
    const raw = FileManager.readAsStringSync(usagePath)
    const parsed: any = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const list: UsageEntry[] = []
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue
      const t = numberOr(item.t, 0)
      if (!t) continue
      list.push({
        t,
        spend: Math.max(0, numberOr(item.spend, 0)),
        balance: numberOr(item.balance, 0),
      })
    }
    list.sort((a, b) => a.t - b.t)
    return list
  } catch (_) {
    return []
  }
}

function saveUsage(list: UsageEntry[]) {
  ensureDir()
  FileManager.writeAsStringSync(usagePath, JSON.stringify(list))
}

export function appendUsage(entry: UsageEntry): UsageEntry[] {
  const list = loadUsage()
  list.push(entry)
  const cutoff = entry.t - 30 * 24 * 60 * 60 * 1000
  const pruned = list.filter((item) => item.t >= cutoff).slice(-2000)
  saveUsage(pruned)
  return pruned
}

export function clearUsage() {
  try {
    if (FileManager.existsSync(usagePath)) FileManager.removeSync(usagePath)
  } catch (_) {}
}

/** 主币种：优先 CNY，否则取第一个 */
export function pickPrimary(infos: BalanceInfo[]): BalanceInfo | null {
  if (!infos.length) return null
  const cny = infos.find((item) => item.currency.toUpperCase() === "CNY")
  return cny || infos[0]
}

/**
 * 余额快照：比较新旧余额记录消耗。
 * - 余额下降 → 记录本次消耗，水位线不动
 * - 余额上涨（充值/退款）→ 水位线抬到新余额，消耗记 0
 */
export function applyBalance(config: DeepSeekConfig, infos: BalanceInfo[], now: number): DeepSeekConfig {
  const primary = pickPrimary(infos)
  if (!primary) return config
  const prev = config.available
  const next = primary.total
  const spend = prev > 0 && next < prev ? Math.max(0, prev - next) : 0

  appendUsage({ t: now, spend: Math.round(spend * 100) / 100, balance: Math.round(next * 100) / 100 })

  return {
    ...config,
    available: next,
    currency: primary.currency || config.currency || "CNY",
    granted: primary.granted,
    toppedUp: primary.toppedUp,
    lastCheck: now,
    lastOk: now,
    lastError: "",
  }
}

export function markFailure(config: DeepSeekConfig, error: string, now: number): DeepSeekConfig {
  return { ...config, lastCheck: now, lastError: error }
}
