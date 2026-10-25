/* 中转站看板 · 数据层
   从 Surge 模块 aiapi_relay.js 移植：CCH / CCHP / CommandCode 三种取数方式，
   归一成一张按优先级排序的余额表，供 index.tsx / widget.tsx / intent.tsx 共用。

   Storage 是运行时全局（本脚本私有域），不需要 import。 */

import { fetch } from "scripting"

/* ── 类型 ── */

export type SiteMode = "cchp" | "admin" | "user" | "login" | "cookie" | "cmdcode"

export type Site = {
  id: string
  name: string
  base: string
  mode: SiteMode
  credential: string
  priority: number | null
  enabled: boolean
}

export type Options = {
  /* CommandCode 套餐月度上限（USD），默认 70 */
  monthCap: number
  /* App 内最多显示多少行 */
  maxRows: number
}

export type RowLimit = {
  label: string
  /* 剩余比例 0–1；不限量或查不到时为 null */
  ratio: number | null
  text: string
}

export type Row = {
  key: string
  name: string
  site: string
  /* 归一成 USD 的金额，仅用于合计与排序；查不到为 null */
  amount: number | null
  currency: string
  amountText: string
  /* 详细指标：健康、限额、今日用量等，按重要度排序 */
  metrics: string[]
  detail: string
  /* 剩余比例 0–1，用于着色；没有额度概念时为 null */
  ratio: number | null
  /* 近 24h 成功率 0–1，没有数据为 null */
  health: number | null
  /* 近 24h 首字延迟（毫秒） */
  ttftMs: number | null
  /* CommandCode 的 5H / W / M 三个限额 */
  limits: RowLimit[]
  priority: number | null
  seq: number
  kind: "balance" | "limit"
  /* 站点取数失败：只占一行提示，没有金额与指标 */
  failed: boolean
}

export type Usage = {
  site: string
  requests: number
  successRate: number | null
  ttftMs: number | null
}

export type PanelData = {
  rows: Row[]
  usage: Usage[]
  notices: string[]
  errors: { site: string; message: string }[]
  updatedAt: number
  elapsedMs: number
  fromCache: boolean
}

/* 站点自己查出的上游优先级，用于给别的站点（例如提供 Clouder 余额的 CCH 站）排位 */
type PriorityHint = { host: string; names: string[]; priority: number }

type Outcome = {
  rows: Row[]
  usage: Usage | null
  notices: string[]
  error: string | null
  hints?: PriorityHint[]
}

type HttpResult = {
  status: number
  body: any
  text: string
  headers: any
  timedOut: boolean
}

type Budget = { deadline: number }

type Session = { value: string; expiresAt: number }

/* ── 配置 ── */

const STORE_SITES = "relay.sites.v2"
const STORE_OPTS = "relay.opts.v1"
const STORE_CACHE = "relay.panel.v1"

const DEFAULT_OPTIONS: Options = { monthCap: 70, maxRows: 10 }

const MODES: SiteMode[] = ["cchp", "admin", "user", "login", "cookie", "cmdcode"]

export const MODE_LABELS: [SiteMode, string][] = [
  ["cchp", "CCHP 管理令牌"],
  ["admin", "CCH 管理员密钥"],
  ["user", "CCH API Key"],
  ["login", "CCH API Key（自动登录）"],
  ["cookie", "CCH 会话 Cookie"],
  ["cmdcode", "CommandCode Key"],
]

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function normalizeSite(raw: any): Site | null {
  if (!raw || typeof raw !== "object") return null
  const base = normalizeBase(String(raw.base || ""))
  if (!base) return null
  const mode: SiteMode = MODES.indexOf(raw.mode) >= 0 ? raw.mode : "cchp"
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : makeId(),
    name: String(raw.name || "").trim() || base.replace(/^https?:\/\//i, ""),
    base,
    mode,
    credential: String(raw.credential || ""),
    priority: numeric(raw.priority),
    enabled: raw.enabled === false ? false : true,
  }
}

export function readSites(): Site[] {
  try {
    const stored = Storage.get<any>(STORE_SITES)
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored
    if (Array.isArray(parsed)) {
      const sites = parsed.map(normalizeSite).filter((site): site is Site => !!site)
      if (sites.length) return sites
    }
  } catch (_) {}
  return []
}

export function writeSites(sites: Site[]): void {
  try {
    Storage.set(STORE_SITES, JSON.stringify(sites))
  } catch (_) {}
}

export function readOptions(): Options {
  try {
    const stored = Storage.get<any>(STORE_OPTS)
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored
    if (parsed && typeof parsed === "object") {
      const monthCap = numeric(parsed.monthCap)
      const maxRows = numeric(parsed.maxRows)
      return {
        monthCap: monthCap !== null && monthCap > 0 ? monthCap : DEFAULT_OPTIONS.monthCap,
        maxRows: maxRows !== null ? Math.min(20, Math.max(3, Math.round(maxRows))) : DEFAULT_OPTIONS.maxRows,
      }
    }
  } catch (_) {}
  return { ...DEFAULT_OPTIONS }
}

export function writeOptions(options: Options): void {
  try {
    Storage.set(STORE_OPTS, JSON.stringify(options))
  } catch (_) {}
}

/* ── 解析 Surge 的 cch_endpoints 写法 ──
   名称@地址=凭据[:模式][:优先级]，多个站点用竖线分隔；模式省略即 user。 */

export function parseEndpoints(input: string): Site[] {
  const sites: Site[] = []
  for (const chunk of String(input || "").split("|")) {
    const item = chunk.trim()
    if (!item) continue
    const eq = item.indexOf("=")
    if (eq < 0) continue
    const left = item.slice(0, eq).trim()
    let right = item.slice(eq + 1).trim()
    if (!left || !right) continue

    let priority: number | null = null
    let colon = right.lastIndexOf(":")
    if (colon > 0) {
      const tail = right.slice(colon + 1).replace(/[\s\[\]]/g, "")
      if (/^\d+(\.\d+)?$/.test(tail)) {
        priority = Number(tail)
        right = right.slice(0, colon).replace(/[\s\[\]]+$/, "")
      }
    }

    let mode: SiteMode = "user"
    colon = right.lastIndexOf(":")
    if (colon > 0) {
      /* 容错 [:admin]、:admin] 这类写法 */
      const suffix = right.slice(colon + 1).replace(/[\s\[\]]/g, "").toLowerCase()
      if (MODES.indexOf(suffix as SiteMode) >= 0) {
        mode = suffix as SiteMode
        right = right.slice(0, colon).replace(/[\s\[\]]+$/, "")
      }
    }
    if (!right) continue

    const at = left.indexOf("@")
    const label = at >= 0 ? left.slice(0, at).trim() : ""
    const host = at >= 0 ? left.slice(at + 1).trim() : left
    const base = normalizeBase(host)
    if (!base) continue

    sites.push({
      id: makeId(),
      name: label || base.replace(/^https?:\/\//i, ""),
      base,
      mode,
      credential: right,
      priority,
      enabled: true,
    })
  }
  return sites
}

/* 反向导出：设置页可以复制回 Surge 模块里用 */
export function sitesToEndpoints(sites: Site[]): string {
  return sites
    .map((site) => {
      const tail = site.priority === null ? site.mode : `${site.mode}:${site.priority}`
      return `${site.name}@${site.base}=${site.credential}:${tail}`
    })
    .join(" | ")
}

/* ── 基础工具 ── */

export function numeric(value: any): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function num(value: any): number {
  const parsed = numeric(value)
  return parsed === null ? 0 : parsed
}

function formatAmount(value: number): string {
  const abs = Math.abs(value)
  if (abs === 0) return "0.00"
  if (abs >= 0.1) return value.toFixed(2)
  if (abs >= 0.01) return value.toFixed(3)
  return value.toFixed(4)
}

export function money(value: number | null): string {
  return value === null ? "-" : `$${formatAmount(value)}`
}

/* 限额用的紧凑金额：$12.3M / $12k / $1234 / $56 */
export function compactMoney(value: number | null): string {
  if (value === null) return "-"
  const abs = Math.abs(value)
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`
  if (abs >= 1e4) return `$${Math.round(value / 1e3)}k`
  if (abs >= 100) return `$${Math.round(value)}`
  return `$${value.toFixed(1).replace(/\.0$/, "")}`
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", CNY: "¥", RMB: "¥", EUR: "€", GBP: "£", JPY: "¥", HKD: "HK$",
}

export function moneyOf(unit: string, value: number): string {
  const code = String(unit || "").trim().toUpperCase()
  const symbol = CURRENCY_SYMBOLS[code]
  return symbol ? `${symbol}${formatAmount(value)}` : `${formatAmount(value)} ${code}`
}

export function percent(ratio: number | null, digits = 0): string {
  if (ratio === null) return "-"
  return `${(ratio * 100).toFixed(digits)}%`
}

export function formatClock(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeBase(raw: string): string {
  let base = String(raw || "").trim()
  if (!base) return ""
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`
  return base.replace(/\/+$/, "")
}

/* 品牌取名称第一段：Kcne-Astra → Kcne、Miapi-DS → Miapi */
function brandOf(name: string): string {
  const text = String(name || "").trim()
  const head = text.split(/[-_\s]/)[0].trim()
  return head || text
}

function hostOf(url: string): string {
  const text = String(url || "").trim()
  const match = /^(?:https?:\/\/)?([^/?#]+)/i.exec(text)
  return (match ? match[1] : text).toLowerCase()
}

/* 域名比对键：去协议、端口、路径与开头的 www./api. */
function hostKey(value: string): string {
  let text = String(value || "").trim().toLowerCase()
  if (!text) return ""
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
  text = text.replace(/[?#].*$/, "").replace(/\/.*$/, "")
  const at = text.lastIndexOf("@")
  if (at >= 0) text = text.slice(at + 1)
  text = text.replace(/:\d+$/, "")
  return text.replace(/^(?:www\.|api\.)+/, "")
}

function hash(value: string): string {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function unwrap(json: any): any {
  if (json && typeof json === "object" && json.data && typeof json.data === "object") return json.data
  return json || {}
}

/* ── HTTP ── */

async function request(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body?: any,
  timeoutMs = 15000
): Promise<HttpResult> {
  const init: any = { method, headers: { ...headers } }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers["Content-Type"] = "application/json"
  }

  let timer: any = null
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(1000, timeoutMs))
  })

  const task = fetch(url, init).then(
    async (response: any) => {
      const text = await response.text()
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch (_) { parsed = null }
      const result: HttpResult = {
        status: Number(response.status) || 0,
        body: parsed,
        text,
        headers: response.headers || null,
        timedOut: false,
      }
      return result
    },
    (error: any) => ({ error })
  )

  const settled: any = await Promise.race([task, timeout])
  if (timer !== null) clearTimeout(timer)
  if (settled === null) return { status: 0, body: null, text: "", headers: null, timedOut: true }
  if (settled && settled.error) {
    const message = String(settled.error.message || settled.error)
    if (/abort|timeout|timed out/i.test(message)) {
      return { status: 0, body: null, text: "", headers: null, timedOut: true }
    }
    throw new Error(message)
  }
  return settled as HttpResult
}

function problemCode(body: any): string {
  return body && body.errorCode ? `（${body.errorCode}）` : ""
}

function checkStatus(result: HttpResult, label: string): void {
  if (result.status === 200) return
  if (result.timedOut) throw new Error(`${label}请求超时`)
  if (result.status === 401) throw new Error(`${label}被拒${problemCode(result.body)}`)
  if (result.status === 403) throw new Error("无权限，请检查令牌权限")
  if (result.status === 404) throw new Error("接口不存在，请检查地址与版本")
  throw new Error(`${label} HTTP ${result.status}`)
}

function beginBudget(ms: number): Budget {
  return { deadline: Date.now() + Math.max(3000, ms) }
}

function budgetLeft(budget: Budget): number {
  return budget.deadline - Date.now()
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners: Promise<void>[] = []
  const count = Math.max(1, Math.min(limit, items.length))
  for (let i = 0; i < count; i++) {
    runners.push((async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        results[index] = await worker(items[index])
      }
    })())
  }
  await Promise.all(runners)
  return results
}

/* ── 行 ── */

function mkRow(input: {
  key: string
  name: string
  site: string
  amount?: number | null
  currency?: string
  amountText?: string
  detail?: string
  metrics?: string[]
  ratio?: number | null
  health?: number | null
  ttftMs?: number | null
  limits?: RowLimit[]
  priority?: number | null
  kind?: "balance" | "limit"
  failed?: boolean
}): Row {
  return {
    key: input.key,
    name: input.name,
    site: input.site,
    amount: input.amount === undefined ? null : input.amount,
    currency: input.currency || "USD",
    amountText: input.amountText || "",
    metrics: input.metrics || [],
    detail: input.detail || (input.metrics ? input.metrics.join(" · ") : ""),
    ratio: input.ratio === undefined ? null : input.ratio,
    health: input.health === undefined ? null : input.health,
    ttftMs: input.ttftMs === undefined ? null : input.ttftMs,
    limits: input.limits || [],
    priority: input.priority === undefined ? null : input.priority,
    seq: 0,
    kind: input.kind || "balance",
    failed: input.failed === true,
  }
}

/* ── CCH：账户额度（user / cookie / login） ── */

async function fetchCchQuota(
  site: Site,
  headers: Record<string, string>,
  label: string,
  timeoutMs: number
): Promise<Outcome> {
  const result = await request("GET", `${site.base}/api/v1/me/quota`, headers, undefined, timeoutMs)
  checkStatus(result, label)
  const quota = unwrap(result.body)

  const keyLimit = numeric(quota.keyLimitTotalUsd)
  const userLimit = numeric(quota.userLimitTotalUsd)
  let total: { limit: number; used: number } | null = null
  if (keyLimit !== null && keyLimit > 0) {
    total = { limit: keyLimit, used: num(quota.keyCurrentTotalUsd) }
  } else if (userLimit !== null && userLimit > 0) {
    total = { limit: userLimit, used: num(quota.userCurrentTotalUsd) }
  }

  if (!total) {
    return {
      rows: [mkRow({
        key: `${site.id}:quota`,
        name: site.name,
        site: site.name,
        amountText: "未设置",
        metrics: ["额度未设置"],
        priority: site.priority,
      })],
      usage: null,
      notices: [],
      error: null,
    }
  }

  const remaining = total.limit - total.used
  return {
    rows: [mkRow({
      key: `${site.id}:quota`,
      name: site.name,
      site: site.name,
      amount: remaining,
      amountText: money(remaining),
      metrics: [],
      ratio: total.limit > 0 ? remaining / total.limit : null,
      priority: site.priority,
    })],
    usage: null,
    notices: [],
    error: null,
  }
}

/* 会话 Cookie 名拆开拼，避免改动敏感字面量 */
const AUTH_COOKIE = "auth-" + "token"

function cookieHeader(value: string): Record<string, string> {
  return { Accept: "application/json", Cookie: AUTH_COOKIE + "=" + value }
}

/* login 模式：Key 换会话 Cookie，缓存到 Storage，被拒时重登一次 */
function sessionSlot(base: string): string {
  return `relay.session.${hash(base)}`
}

function readSession(base: string): string {
  try {
    const raw = Storage.get<any>(sessionSlot(base))
    const store: Session | null = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!store || typeof store.value !== "string") return ""
    return Number(store.expiresAt || 0) > Date.now() ? store.value : ""
  } catch (_) {
    return ""
  }
}

function writeSession(base: string, value: string, maxAge: number | null): void {
  const ttl = maxAge !== null && maxAge > 0 ? maxAge : 6 * 24 * 3600
  try {
    Storage.set(sessionSlot(base), JSON.stringify({ value, expiresAt: Date.now() + ttl * 1000 }))
  } catch (_) {}
}

async function loginWithKey(base: string, credential: string): Promise<Session> {
  const result = await request("POST", `${base}/api/auth/login`, { Accept: "application/json" }, { key: credential }, 15000)
  if (result.timedOut) throw new Error("登录超时")
  if (result.status === 401) throw new Error("Key 无效或已过期")
  if (result.status === 429) throw new Error("登录过于频繁，稍后重试")
  if (result.status !== 200) throw new Error(`登录失败（HTTP ${result.status}）`)

  let raw = ""
  try {
    if (result.headers && typeof result.headers.get === "function") {
      raw = String(result.headers.get("set-cookie") || result.headers.get("Set-Cookie") || "")
    }
  } catch (_) {}

  const match = new RegExp(AUTH_COOKIE + "=([^;,\\s]+)").exec(raw)
  if (!match) throw new Error("登录成功但未取到会话 Cookie")
  const ttl = /max-age=(\d+)/i.exec(raw)
  return { value: match[1], expiresAt: Date.now() + (ttl ? Number(ttl[1]) : 6 * 24 * 3600) * 1000 }
}

async function fetchCchLogin(site: Site): Promise<Outcome> {
  const cached = readSession(site.base)
  if (cached) {
    try {
      return await fetchCchQuota(site, cookieHeader(cached), "会话", 12000)
    } catch (_) {}
  }
  const session = await loginWithKey(site.base, site.credential)
  writeSession(site.base, session.value, null)
  return fetchCchQuota(site, cookieHeader(session.value), "会话", 12000)
}

/* ── CCH：admin 模式（各上游余额） ── */

const IGNORED_BRANDS = ["clouder", "miapi"]

type Vendor = { name: string; domain: string }

async function fetchVendors(site: Site, headers: Record<string, string>, timeoutMs: number): Promise<Map<number, Vendor>> {
  const map = new Map<number, Vendor>()
  try {
    const result = await request("GET", `${site.base}/api/v1/provider-vendors`, headers, undefined, timeoutMs)
    if (result.status !== 200) return map
    const items = result.body ? result.body.items : null
    for (const item of Array.isArray(items) ? items : []) {
      const id = Number(item.id)
      if (!Number.isFinite(id)) continue
      map.set(id, {
        name: String(item.displayName || "").trim(),
        domain: String(item.websiteDomain || "").trim().toLowerCase(),
      })
    }
  } catch (_) {}
  return map
}

function isIgnoredProvider(provider: any, vendors: Map<number, Vendor>): boolean {
  const vendor = vendors.get(Number(provider.providerVendorId))
  const brand = brandOf(String(provider.name || "")).toLowerCase()
  const vendorBrand = vendor ? brandOf(vendor.name).toLowerCase() : ""
  return IGNORED_BRANDS.indexOf(brand) >= 0 || IGNORED_BRANDS.indexOf(vendorBrand) >= 0
}

async function fetchCchAdmin(site: Site, budget: Budget): Promise<Outcome> {
  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${site.credential}` }
  const slice = () => Math.min(15000, Math.max(4000, budgetLeft(budget)))

  const providersResult = await request("GET", `${site.base}/api/v1/providers`, headers, undefined, slice())
  checkStatus(providersResult, "管理员密钥")
  const items = providersResult.body ? providersResult.body.items : null
  const providers: any[] = Array.isArray(items) ? items : []

  const vendors = await fetchVendors(site, headers, slice())

  /* 只查启用上游的余额；Clouder 由 CCHP 提供、Miapi 不限余额，都跳过 */
  const target = providers.filter((provider) => provider.isEnabled !== false && !isIgnoredProvider(provider, vendors))
  const ids = target
    .map((provider) => Number(provider.id))
    .filter((id) => Number.isFinite(id))
    .slice(0, 50)

  let snapshots: any[] | null = []
  const notices: string[] = []
  if (ids.length) {
    try {
      const result = await request(
        "POST",
        `${site.base}/api/v1/providers/balances:batch`,
        headers,
        { providerIds: ids, refresh: false },
        slice()
      )
      const list = result.status === 200 && result.body ? result.body.items : null
      snapshots = Array.isArray(list) ? list : null
    } catch (_) {
      snapshots = null
    }
    if (snapshots === null) notices.push("⚠️ 上游余额查询失败")
  }

  /* 按厂商归并：同一家在不同域名的条目合并成一行，取最低余额 */
  type Group = { label: string; priority: number | null; currency: string; amount: number | null; unlimited: boolean; count: number }
  const byProviderId = new Map<number, any>()
  for (const provider of target) byProviderId.set(Number(provider.id), provider)

  const groupKey = (provider: any): string => {
    const vendorId = Number(provider.providerVendorId)
    return Number.isFinite(vendorId) ? `v${vendorId}` : `h${hostOf(provider.url)}`
  }

  const brands = new Map<string, Set<string>>()
  const sample = new Map<string, any>()
  for (const provider of target) {
    const key = groupKey(provider)
    if (!brands.has(key)) brands.set(key, new Set<string>())
    brands.get(key)!.add(brandOf(String(provider.name || "")))
    if (!sample.has(key)) sample.set(key, provider)
  }

  const groups = new Map<string, Group>()
  for (const provider of target) {
    const key = groupKey(provider)
    if (groups.has(key)) continue
    const set = brands.get(key)!
    const first = sample.get(key)!
    const vendor = vendors.get(Number(first.providerVendorId))
    groups.set(key, {
      label: set.size === 1 ? Array.from(set)[0] : (vendor && vendor.name) || hostOf(first.url),
      priority: null,
      currency: "USD",
      amount: null,
      unlimited: false,
      count: 0,
    })
  }

  for (const provider of target) {
    const group = groups.get(groupKey(provider))
    if (!group) continue
    group.count += 1
    const priority = numeric(provider.priority)
    if (priority !== null && (group.priority === null || priority < group.priority)) group.priority = priority
  }

  for (const snapshot of snapshots || []) {
    if (String(snapshot.status || "") !== "ok") continue
    const provider = byProviderId.get(Number(snapshot.providerId))
    if (!provider) continue
    const group = groups.get(groupKey(provider))
    if (!group) continue
    group.currency = String(snapshot.currency || "").toUpperCase() || "USD"
    if (snapshot.unlimited) group.unlimited = true
    const amount = numeric(snapshot.balance)
    if (amount !== null && (group.amount === null || amount < group.amount)) group.amount = amount
  }

  /* 同名厂商（同一家在两个域名各有一条）用域名区分 */
  const labelCount = new Map<string, number>()
  for (const group of groups.values()) labelCount.set(group.label, (labelCount.get(group.label) || 0) + 1)

  const rows: Row[] = []
  const hints: PriorityHint[] = []
  for (const [key, group] of groups) {
    if (!group.unlimited && group.amount === null) continue
    const first = sample.get(key)!
    const vendor = vendors.get(Number(first.providerVendorId))
    const name = (labelCount.get(group.label) || 0) > 1 ? `${group.label}·${hostOf(first.url)}` : group.label
    rows.push(mkRow({
      key: `${site.id}:${key}`,
      name,
      site: site.name,
      amount: group.currency === "USD" ? group.amount : null,
      currency: group.currency,
      amountText: group.unlimited ? "不限量" : moneyOf(group.currency, group.amount as number),
      metrics: [],
      priority: group.priority,
    }))
    if (group.priority !== null) {
      hints.push({
        host: (vendor && vendor.domain) || hostOf(first.url),
        names: [group.label, vendor ? vendor.name : ""],
        priority: group.priority,
      })
    }
  }

  return { rows, usage: null, notices, error: null, hints }
}

/* ── CommandCode：余额查不到，只能读 5H / 周 / 月额度 ── */

const CMDCODE_WINDOWS: [string, string, string[]][] = [
  ["fiveHour", "5H", ["fiveHour", "five_hour", "five_hours", "5h"]],
  ["weekly", "W", ["weekly", "week", "sevenDay", "7d"]],
]

function pickWindow(source: any, aliases: string[]): any {
  for (const alias of aliases) {
    if (source && Object.prototype.hasOwnProperty.call(source, alias)) return source[alias]
  }
  return null
}

function pickNumber(source: any, names: string[]): number | null {
  for (const name of names) {
    if (!source || !Object.prototype.hasOwnProperty.call(source, name)) continue
    const value = source[name]
    return typeof value === "number" && Number.isFinite(value) ? value : null
  }
  return null
}

function limitedFlag(value: any): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const text = value.trim().toLowerCase()
    if (text === "true") return true
    if (text === "false") return false
  }
  return null
}

async function fetchCommandCode(site: Site, options: Options, budget: Budget): Promise<Outcome> {
  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${site.credential}` }
  const slice = () => Math.min(15000, Math.max(4000, budgetLeft(budget)))

  const whoami = await request("GET", `${site.base}/alpha/whoami?limits=1`, headers, undefined, slice())
  checkStatus(whoami, "CommandCode")
  const org = whoami.body && whoami.body.org && typeof whoami.body.org === "object" ? whoami.body.org : null
  const orgId = org && org.id ? String(org.id) : ""

  const path = `/alpha/billing/credits${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`
  const result = await request("GET", `${site.base}${path}`, headers, undefined, slice())
  checkStatus(result, "CommandCode")

  const body = result.body || {}
  const credits = body.credits && typeof body.credits === "object" ? body.credits : body
  const limitHolders = ["windowLimits", "window_limits"]
  let windowLimits: any = {}
  for (const holder of [credits, body]) {
    let found = false
    for (const name of limitHolders) {
      if (!holder || !Object.prototype.hasOwnProperty.call(holder, name)) continue
      const value = holder[name]
      windowLimits = value && typeof value === "object" && !Array.isArray(value) ? value : {}
      found = true
      break
    }
    if (found) break
  }

  let limited = limitedFlag(windowLimits.limited)
  if (limited === null) limited = limitedFlag(credits.limited)
  if (limited === null && body !== credits) limited = limitedFlag(body.limited)
  const unlimited = limited === false

  const windows: { label: string; ratio: number | null; used: number | null; cap: number | null }[] = []
  for (const [key, label, aliases] of CMDCODE_WINDOWS) {
    const raw = pickWindow(windowLimits, aliases)
    const present = raw && typeof raw === "object"
    if (!present && !unlimited) continue
    const used = present ? pickNumber(raw, ["used", "current", "spent"]) : null
    const cap = present ? pickNumber(raw, ["cap", "limit", "max", "total"]) : null
    const ratio = !unlimited && used !== null && cap !== null && cap > 0
      ? Math.min(1, Math.max(0, (cap - used) / cap))
      : null
    windows.push({ label, ratio, used, cap })
  }

  const monthly = numeric(credits.monthlyCredits)
  const purchased = numeric(credits.purchasedCredits)
  const free = numeric(credits.freeCredits)
  const remaining = monthly === null && purchased === null && free === null
    ? null
    : num(monthly) + num(purchased) + num(free)
  const monthRatio = monthly !== null && options.monthCap > 0
    ? Math.min(1, Math.max(0, monthly / options.monthCap))
    : null

  const details: string[] = []
  for (const window of windows) {
    details.push(unlimited ? `${window.label} 不限` : window.ratio === null ? "" : `${window.label} ${percent(window.ratio, 2)}`)
  }
  if (monthRatio !== null) details.push(`M ${percent(monthRatio, 2)}`)
  else if (remaining !== null) details.push(`M ${compactMoney(remaining)}`)

  /* 小组件用：5H / W / M 三个限额，各带剩余比例 */
  const limits: RowLimit[] = windows.map((window) => ({
    label: window.label,
    ratio: window.ratio,
    text: unlimited ? "不限" : window.ratio === null ? "-" : percent(window.ratio, 1),
  }))
  if (monthRatio !== null || remaining !== null) {
    limits.push({
      label: "M",
      ratio: monthRatio,
      text: monthRatio !== null ? percent(monthRatio, 1) : compactMoney(remaining),
    })
  }

  if (remaining === null && !unlimited && windows.every((window) => window.ratio === null)) {
    throw new Error("credits 里没有可展示的额度字段")
  }

  return {
    rows: [mkRow({
      key: `${site.id}:cmdcode`,
      name: site.name,
      site: site.name,
      amount: null,
      amountText: "",
      metrics: details.filter((line) => line !== ""),
      ratio: monthRatio,
      limits,
      priority: site.priority,
      kind: "limit",
    })],
    usage: null,
    notices: [],
    error: null,
  }
}

/* ── CCHP：按组织取 provider 余额，并用 key 优先级排序 ── */

type CchpPriority = { id: string; priority: number | null; keyIds: string[] }

type CchpProvider = { id: string; name: string; host: string; balance: any }

function isClouder(name: string): boolean {
  return brandOf(name).toLowerCase() === "clouder"
}

function isUnsupported(status: any): boolean {
  return String(status === undefined || status === null ? "" : status).trim().toLowerCase() === "unsupported"
}

/* Mi（miapi）与原 CCH 一致：不进余额行 */
function cchpHidden(provider: any): boolean {
  if (!provider) return false
  if (brandOf(String(provider.name || "")).toLowerCase() === "mi") return true
  return String(provider.slug || "").trim().toLowerCase().indexOf("miapi") >= 0
}

function activeKeyIds(keys: any): string[] {
  const list = Array.isArray(keys) ? keys : []
  return list
    .filter((item) => String(item && item.status || "").toLowerCase() === "active" && String(item && item.id || "").trim())
    .map((item) => String(item.id))
}

function keyPriority(keys: any): number | null {
  const list = Array.isArray(keys) ? keys : []
  const active = list.filter((item) => String(item && item.status || "").toLowerCase() === "active")
  const pool = active.length ? active : list
  let best: number | null = null
  for (const item of pool) {
    const priority = numeric(item && item.priority)
    if (priority !== null && (best === null || priority < best)) best = priority
  }
  return best
}

/* 单账户模式的代表 key：active keyIds 去重后按字符串升序取第一 */
function representativeKey(ids: string[]): string {
  const unique: string[] = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const text = String(id || "").trim()
    if (text && unique.indexOf(text) < 0) unique.push(text)
  }
  unique.sort()
  return unique.length ? unique[0] : ""
}

function readSlot<T>(slot: string, maxAgeMs: number): T | null {
  try {
    const raw = Storage.get<any>(slot)
    const box = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!box || box.at === undefined) return null
    if (Date.now() - Number(box.at) > maxAgeMs) return null
    return box.value as T
  } catch (_) {
    return null
  }
}

function writeSlot(slot: string, value: any): void {
  try {
    Storage.set(slot, JSON.stringify({ at: Date.now(), value }))
  } catch (_) {}
}

function cchpProvider(raw: any): CchpProvider {
  return {
    id: String(raw && raw.id || ""),
    name: String(raw && raw.name || ""),
    host: String(raw && raw.website_url || ""),
    balance: raw && raw.balance && typeof raw.balance === "object" ? raw.balance : null,
  }
}

/* 单账户投影：按代表 key 找 account，找不到再退回唯一的 account；
   多账户且无匹配即不可用，不回退 totals（会把同一账户的重复读数相加） */
function singleAccountView(balance: any, repKey: string): { value: any; unavailable: boolean } {
  const source = balance && typeof balance === "object" ? balance : {}
  const accounts: any[] = Array.isArray(source.accounts) ? source.accounts : []
  let account: any = null
  if (repKey) {
    const matched = accounts.filter((item) => Array.isArray(item && item.key_ids)
      && item.key_ids.some((id: any) => String(id) === repKey))
    if (matched.length === 1) account = matched[0]
  }
  if (!account && accounts.length === 1) account = accounts[0]
  if (!account) {
    return { value: { status: source.status, totals: [], total_usd: null, unlimited: false }, unavailable: true }
  }
  const amount = numeric(account.amount)
  const unit = String(account.unit || "USD").trim().toUpperCase() || "USD"
  return {
    value: {
      status: source.status,
      totals: [{ unit, amount }],
      total_usd: unit === "USD" ? amount : null,
      unlimited: account.unlimited === true,
      checked_at: account.checked_at,
      oldest_checked_at: account.checked_at,
    },
    unavailable: false,
  }
}

/* totals 可能同时给多个币种：各按原币种显示，不做汇率换算 */
function amountParts(balance: any): string[] {
  const totals = Array.isArray(balance && balance.totals) ? balance.totals : []
  const parts: string[] = []
  for (const total of totals) {
    const amount = numeric(total && total.amount)
    if (amount === null) continue
    const unit = String(total && total.unit || "USD").trim().toUpperCase() || "USD"
    parts.push(moneyOf(unit, amount))
  }
  return parts
}

async function fetchCchpSummary(site: Site, headers: Record<string, string>, timeoutMs: number): Promise<Usage | null> {
  try {
    const result = await request("GET", `${site.base}/api/account/usage/summary`, headers, undefined, timeoutMs)
    if (result.status !== 200) return null
    const today = result.body ? result.body.today : null
    if (!today || typeof today !== "object") return null
    return {
      site: site.name,
      requests: num(today.requests),
      successRate: numeric(today.successRate),
      ttftMs: numeric(today.avgTtftMs),
    }
  } catch (_) {
    return null
  }
}

async function fetchCchpHealth(
  site: Site,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Map<string, { successRate: number | null; ttftMs: number | null; requests: number | null }>> {
  const map = new Map<string, { successRate: number | null; ttftMs: number | null; requests: number | null }>()
  try {
    const result = await request(
      "GET",
      `${site.base}/api/account/usage/provider-health?since=24h&limit=50`,
      headers,
      undefined,
      timeoutMs
    )
    if (result.status !== 200) return map
    const rows = result.body ? result.body.rows : null
    if (!Array.isArray(rows)) return map
    for (const row of rows) {
      const id = String(row && row.providerId || "").trim()
      if (!id) continue
      map.set(id, {
        successRate: numeric(row.successRate),
        ttftMs: numeric(row.ttftP50Ms),
        requests: numeric(row.requests),
      })
    }
  } catch (_) {}
  return map
}

async function fetchCchp(site: Site, options: Options, budget: Budget): Promise<Outcome> {
  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${site.credential}` }
  const slice = (max = 15000) => Math.min(max, Math.max(3000, budgetLeft(budget)))
  const notices: string[] = []
  let timedOut = false

  const orgSlot = `relay.cchp.org.${hash(site.base)}`
  let orgId = readSlot<string>(orgSlot, 24 * 3600 * 1000) || ""
  if (!orgId) {
    const result = await request("GET", `${site.base}/api/account/org-tree`, headers, undefined, slice())
    checkStatus(result, "管理令牌")
    const root = result.body ? result.body.root : null
    orgId = String(root && root.id || "").trim()
    if (!orgId) throw new Error("返回缺少组织 ID")
    writeSlot(orgSlot, orgId)
  }

  const listSlot = `relay.cchp.list.${hash(site.base + "|" + orgId)}`
  let rawProviders: any[] = []
  let stale = false
  try {
    const result = await request(
      "GET",
      `${site.base}/api/account/orgs/${encodeURIComponent(orgId)}/providers`,
      headers,
      undefined,
      slice()
    )
    checkStatus(result, "管理令牌")
    const list = result.body ? result.body.providers : null
    if (!Array.isArray(list)) throw new Error("返回缺少 providers")
    rawProviders = list
    writeSlot(listSlot, list)
  } catch (error) {
    const cached = readSlot<any[]>(listSlot, 30 * 24 * 3600 * 1000)
    if (!cached) throw error
    rawProviders = cached
    stale = true
    notices.push("⚠️ 余额来自缓存")
  }

  let providers: CchpProvider[] = rawProviders.filter((item) => !cchpHidden(item)).map(cchpProvider)

  /* key 优先级：active key 的最小值，同时留下 active keyId 供实时刷新 */
  const prioSlot = `relay.cchp.prio.${hash(site.base + "|" + orgId)}`
  let priorities = readSlot<CchpPriority[]>(prioSlot, 10 * 60 * 1000)
  let priorityMissing = false
  if (!priorities || !priorities.every((item) => Array.isArray(item.keyIds))) {
    const items = await mapLimit(providers, 5, async (provider) => {
      if (budgetLeft(budget) < 1500) {
        timedOut = true
        return { id: provider.id, priority: null, keyIds: [] as string[] }
      }
      try {
        const result = await request(
          "GET",
          `${site.base}/api/account/orgs/${encodeURIComponent(orgId)}/providers/${encodeURIComponent(provider.id)}/keys`,
          headers,
          undefined,
          slice(10000)
        )
        if (result.status !== 200) throw new Error(`HTTP ${result.status}`)
        const keys = result.body ? result.body.keys : null
        return { id: provider.id, priority: keyPriority(keys), keyIds: activeKeyIds(keys) }
      } catch (_) {
        return { id: provider.id, priority: null, keyIds: [] as string[] }
      }
    })
    priorities = items
    priorityMissing = items.some((item) => item.priority === null)
    if (!timedOut) writeSlot(prioSlot, items)
  }

  const prioById = new Map<string, CchpPriority>()
  for (const item of priorities || []) prioById.set(item.id, item)

  /* 余额实时化：每个可见 provider 只刷代表 key，刷完重取一次聚合列表 */
  const targets: { id: string; keyId: string }[] = []
  for (const provider of providers) {
    if (isClouder(provider.name)) continue
    const item = prioById.get(provider.id)
    const keyId = representativeKey(item ? item.keyIds : [])
    if (keyId) targets.push({ id: provider.id, keyId })
  }

  let refreshed = 0
  if (targets.length && !stale && budgetLeft(budget) > 5000) {
    await mapLimit(targets, 4, async (target) => {
      if (budgetLeft(budget) < 2500) {
        timedOut = true
        return
      }
      try {
        const url = `${site.base}/api/account/orgs/${encodeURIComponent(orgId)}/providers/${encodeURIComponent(target.id)}`
          + `/keys/${encodeURIComponent(target.keyId)}/balance?refresh=true`
        const result = await request("GET", url, headers, undefined, slice(8000))
        if (result.status === 200 && !(result.body && result.body.error)) refreshed += 1
      } catch (_) {}
    })
  }

  if (refreshed > 0) {
    try {
      const result = await request(
        "GET",
        `${site.base}/api/account/orgs/${encodeURIComponent(orgId)}/providers`,
        headers,
        undefined,
        slice(10000)
      )
      if (result.status === 200 && result.body && Array.isArray(result.body.providers)) {
        const list: any[] = result.body.providers
        writeSlot(listSlot, list)
        providers = list.filter((item) => !cchpHidden(item)).map(cchpProvider)
      }
    } catch (_) {
      notices.push("⚠️ 余额未刷新，来自服务端缓存")
    }
  } else if (targets.length && !stale) {
    notices.push("⚠️ 余额未刷新，来自服务端缓存")
  }

  /* 今日用量与供应商健康：失败只丢这一块，不影响余额行 */
  let usage: Usage | null = null
  let health = new Map<string, { successRate: number | null; ttftMs: number | null; requests: number | null }>()
  if (budgetLeft(budget) > 2500) {
    const timeout = slice(9000)
    const pair = await Promise.all([
      fetchCchpSummary(site, headers, timeout),
      fetchCchpHealth(site, headers, timeout),
    ])
    usage = pair[0]
    health = pair[1]
  }

  const rows: Row[] = []
  const hints: PriorityHint[] = []
  let singleAccountUnavailable = false

  for (const provider of providers) {
    if (isClouder(provider.name)) continue
    const item = prioById.get(provider.id)
    const priority = item ? item.priority : null
    if (priority !== null) {
      hints.push({ host: provider.host, names: [provider.name, brandOf(provider.name)], priority })
    }

    const balance = provider.balance || {}
    if (String(balance.status || "").toLowerCase() !== "ok") continue
    if (isUnsupported(balance.status)) continue

    const view = singleAccountView(balance, representativeKey(item ? item.keyIds : []))
    if (view.unavailable) singleAccountUnavailable = true
    const source = view.value
    const unlimited = source.unlimited === true
    const parts = amountParts(source)
    const totalUsd = numeric(source.total_usd)
    if (!unlimited && !parts.length && totalUsd === null) continue

    const meta: string[] = []
    const healthInfo = health.get(provider.id)
    const healthRate = healthInfo && healthInfo.requests !== null && healthInfo.requests > 0
      ? healthInfo.successRate
      : null
    const healthTtft = healthRate === null || !healthInfo ? null : healthInfo.ttftMs
    if (healthRate !== null) {
      meta.push(percent(healthRate, 1))
      if (healthTtft !== null) meta.push(`${(healthTtft / 1000).toFixed(1)}s`)
    }

    rows.push(mkRow({
      key: `${site.id}:p:${provider.id}`,
      name: brandOf(provider.name),
      site: site.name,
      amount: totalUsd,
      amountText: unlimited ? "不限量" : parts.length ? parts.join(" + ") : money(totalUsd),
      metrics: meta,
      health: healthRate,
      ttftMs: healthTtft,
      priority,
    }))
  }

  if (singleAccountUnavailable) notices.push("⚠️ 单账户余额不可用")
  if (timedOut) notices.push("⚠️ 部分请求超时")
  else if (priorityMissing) notices.push("⚠️ 部分排序信息缺失")

  return { rows, usage, notices, error: null, hints }
}

/* ── 汇总 ── */

async function fetchSite(site: Site, options: Options): Promise<Outcome> {
  const budget = beginBudget(24000)
  if (site.mode === "admin") return fetchCchAdmin(site, budget)
  if (site.mode === "cmdcode") return fetchCommandCode(site, options, budget)
  if (site.mode === "cchp") return fetchCchp(site, options, budget)
  if (site.mode === "login") return fetchCchLogin(site)
  if (site.mode === "cookie") return fetchCchQuota(site, cookieHeader(site.credential), "会话", 15000)
  return fetchCchQuota(site, { Accept: "application/json", "X-API-Key": site.credential }, "Key", 15000)
}

function compareRows(left: Row, right: Row): number {
  /* 取数失败的站点排到最后，不按优先级插进来 */
  if (left.failed !== right.failed) return left.failed ? 1 : -1
  const a = left.priority === null ? Number.POSITIVE_INFINITY : left.priority
  const b = right.priority === null ? Number.POSITIVE_INFINITY : right.priority
  if (a !== b) return a - b
  const leftName = left.name.toLowerCase()
  const rightName = right.name.toLowerCase()
  if (leftName !== rightName) return leftName < rightName ? -1 : 1
  return left.seq - right.seq
}

function messageOf(error: any): string {
  if (!error) return "未知错误"
  if (typeof error === "string") return error
  return String(error.message || error)
}

export function emptyPanel(): PanelData {
  return {
    rows: [], usage: [], notices: [], errors: [],
    updatedAt: Date.now(), elapsedMs: 0, fromCache: false,
  }
}

/* 旧版本缓存里没有 health / ttftMs / limits，读回来时补全 */
function normalizeRow(row: Row): Row {
  return {
    ...row,
    health: typeof row.health === "number" ? row.health : null,
    ttftMs: typeof row.ttftMs === "number" ? row.ttftMs : null,
    limits: Array.isArray(row.limits) ? row.limits : [],
    failed: row.failed === true,
  }
}

export async function loadPanel(sites: Site[], options: Options, maxAgeMs = 0): Promise<PanelData> {
  const active = sites.filter((site) => site.enabled !== false && String(site.credential || "").trim() !== "")
  if (!active.length) return emptyPanel()

  if (maxAgeMs > 0) {
    const cached = readSlot<PanelData>(STORE_CACHE, maxAgeMs)
    if (cached && Array.isArray(cached.rows)) {
      return { ...cached, rows: cached.rows.map(normalizeRow), fromCache: true }
    }
  }

  const started = Date.now()
  const results = await Promise.all(active.map(async (site) => {
    try {
      return { site, outcome: await fetchSite(site, options) as Outcome | null, failure: "" }
    } catch (error) {
      return { site, outcome: null as Outcome | null, failure: messageOf(error) }
    }
  }))

  const rows: Row[] = []
  const usage: Usage[] = []
  const notices: string[] = []
  const errors: { site: string; message: string }[] = []
  const hints: PriorityHint[] = []
  const siteById = new Map<string, Site>()

  for (const item of results) {
    if (!item.outcome) {
      errors.push({ site: item.site.name, message: item.failure })
      siteById.set(item.site.id, item.site)
      /* 失败的站点保留一行，避免整行消失、列表跳动 */
      rows.push(mkRow({
        key: `${item.site.id}:failed`,
        name: item.site.name,
        site: "",
        priority: item.site.priority,
        failed: true,
      }))
      continue
    }
    siteById.set(item.site.id, item.site)
    for (const row of item.outcome.rows) rows.push({ ...row })
    if (item.outcome.usage) usage.push(item.outcome.usage)
    for (const note of item.outcome.notices) if (notices.indexOf(note) < 0) notices.push(note)
    for (const hint of item.outcome.hints || []) hints.push(hint)
  }

  /* 站点优先级：行内优先级 → 站点配置 → 其它站点查到的域名/名称优先级 */
  const hostPriority = new Map<string, number>()
  const namePriority = new Map<string, number>()
  for (const hint of hints) {
    const host = hostKey(hint.host)
    if (host && (hostPriority.get(host) === undefined || hint.priority < (hostPriority.get(host) as number))) {
      hostPriority.set(host, hint.priority)
    }
    for (const name of hint.names) {
      const text = String(name || "").trim().toLowerCase()
      if (text && (namePriority.get(text) === undefined || hint.priority < (namePriority.get(text) as number))) {
        namePriority.set(text, hint.priority)
      }
    }
  }

  for (const row of rows) {
    if (row.priority !== null) continue
    const id = row.key.split(":")[0]
    const site = siteById.get(id)
    if (!site) continue
    if (site.priority !== null) {
      row.priority = site.priority
      continue
    }
    const host = hostKey(site.base)
    if (host && hostPriority.has(host)) {
      row.priority = hostPriority.get(host) as number
      continue
    }
    const name = site.name.trim().toLowerCase()
    if (namePriority.has(name)) row.priority = namePriority.get(name) as number
  }

  rows.forEach((row, index) => { row.seq = index })
  rows.sort(compareRows)

  const data: PanelData = {
    rows,
    usage,
    notices,
    errors,
    updatedAt: Date.now(),
    elapsedMs: Date.now() - started,
    fromCache: false,
  }

  writeSlot(STORE_CACHE, data)
  return data
}
