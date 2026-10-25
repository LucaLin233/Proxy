// AI 中转站 · 数据层（index.tsx 与 widget.tsx 共用）
// 3.2.x 的 Keychain / Storage 是运行时全局，不是模块导出

declare const Keychain: any
declare const Storage: any

/* ── 基础工具 ── */

type SiteMode = "cchp" | "admin" | "user" | "login" | "cookie" | "cmdcode"

type Site = {
  name: string
  base: string
  credential: string
  mode: SiteMode
  priority: number | null
}

type PanelRow = {
  name: string
  amount: string
  detail: string
  priority: number | null
  seq: number
}

type PanelData = {
  rows: PanelRow[]
  usage: string[]
  notices: string[]
  updatedAt: number
  elapsedMs: number
}

type SiteResult = {
  site: Site
  error: Error | null
  rows: PanelRow[]
  usage: string
  notices: string[]
}

const CURRENCY: Record<string, string> = {
  USD: "$",
  CNY: "¥",
  RMB: "¥",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
}

const MODES: string[] = ["cchp", "admin", "user", "cookie", "login", "cmdcode"]

function numeric(value: any): number | null {
  if (value === null || value === undefined) return null
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

function money(value: number | null): string {
  return value === null ? "-" : `$${formatAmount(value)}`
}

function moneyOf(unit: string, value: number): string {
  const code = String(unit || "").trim().toUpperCase()
  const symbol = CURRENCY[code] ?? ""
  const text = formatAmount(value)
  return symbol ? `${symbol}${text}` : `${text} ${code}`
}

function formatClock(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/* 品牌取名称第一段：Kcne-Astra → Kcne */
function brand(name: string): string {
  const text = String(name || "").trim()
  const head = text.split(/[-_\s]/)[0].trim()
  return head || text
}

function normalizeBase(raw: string): string {
  let base = String(raw || "").trim()
  if (!base) return ""
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`
  return base.replace(/\/+$/, "")
}

/* 与 Surge 模块同一套写法，复用时不需要重新排版 */
function parseSites(input: string): Site[] {
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
        right = right.slice(0, colon).trim()
      }
    }

    let mode: SiteMode = "user"
    colon = right.lastIndexOf(":")
    if (colon > 0) {
      const suffix = right.slice(colon + 1).replace(/[\s\[\]]/g, "").toLowerCase()
      if (MODES.indexOf(suffix) >= 0) {
        mode = suffix as SiteMode
        right = right.slice(0, colon).trim()
      }
    }
    if (!right) continue

    const at = left.indexOf("@")
    const label = at >= 0 ? left.slice(0, at).trim() : ""
    const host = at >= 0 ? left.slice(at + 1).trim() : left
    const base = normalizeBase(host)
    if (!base) continue
    sites.push({ name: label || host, base, credential: right, mode, priority })
  }
  return sites
}

/* ── HTTP ── */

type HttpResult = { status: number; body: any; timedOut: boolean }

const HAS_TIMERS = typeof setTimeout === "function"

function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!HAS_TIMERS) return promise
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`${label} 超过 ${Math.round(ms / 1000)} 秒未返回`))
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        ;(clearTimeout as any)(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        ;(clearTimeout as any)(timer)
        reject(error)
      }
    )
  })
}

async function httpJson(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body?: any,
  timeout = 12
): Promise<HttpResult> {
  const init: any = { method, headers: { ...headers }, timeout: Math.max(1, Math.round(timeout)) }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers["Content-Type"] = "application/json"
  }
  try {
    let target: any = url
    let options: any = init
    if (typeof Request !== "undefined" && Request) {
      try {
        target = new Request(url, init)
        options = undefined
      } catch (_) {
        target = url
        options = init
      }
    }
    const response = await raceTimeout(fetch(target, options), timeout * 1000 + 3000, "请求")
    let parsed: any = null
    try {
      parsed = await raceTimeout(response.json(), 8000, "读取响应")
    } catch (_) {
      parsed = null
    }
    return { status: response.status, body: parsed, timedOut: false }
  } catch (error: any) {
    const message = String((error && error.message) || error)
    if (/abort|timeout|timed out/i.test(message)) return { status: 0, body: null, timedOut: true }
    throw new Error(message)
  }
}

/* 接口可能直接返回对象，也可能包一层 data */
function unwrap(json: any): any {
  if (json && typeof json === "object" && json.data && typeof json.data === "object") return json.data
  return json || {}
}

function ensure(result: HttpResult, label: string) {
  if (result.status === 200) return
  if (result.timedOut) {
    const error: any = new Error(`${label} 请求超时`)
    error.code = "timeout"
    throw error
  }
  if (result.status === 401) throw new Error(`${label}被拒（401，令牌可能已过期）`)
  if (result.status === 403) throw new Error("无权限，请检查令牌权限（403）")
  if (result.status === 404) throw new Error("接口不存在，请检查地址与版本（404）")
  throw new Error(`${label} HTTP ${result.status}`)
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners: Promise<void>[] = []
  const count = Math.max(1, Math.min(limit, items.length))
  for (let index = 0; index < count; index++) {
    runners.push((async () => {
      while (true) {
        const current = next
        next += 1
        if (current >= items.length) return
        results[current] = await worker(items[current])
      }
    })())
  }
  await Promise.all(runners)
  return results
}

/* ── CCHP ── */

type CchpProvider = {
  id: string
  name: string
  slug: string
  host: string
  status: string
  balance: any
  keyIds: string[]
  priority: number | null
}

function cchpHidden(provider: CchpProvider): boolean {
  if (brand(provider.name).toLowerCase() === "mi") return true
  return String(provider.slug || "").toLowerCase().indexOf("miapi") >= 0
}

function readCchpProviders(body: any): CchpProvider[] {
  const list = unwrap(body).providers
  if (!Array.isArray(list)) throw new Error("返回缺少 providers")
  const providers: CchpProvider[] = []
  for (const item of list) {
    const provider: CchpProvider = {
      id: String((item && item.id) || ""),
      name: String((item && item.name) || ""),
      slug: String((item && item.slug) || ""),
      host: String((item && item.website_url) || ""),
      status: String((item && item.balance && item.balance.status) || ""),
      balance: item && typeof item.balance === "object" ? item.balance : null,
      keyIds: [],
      priority: null,
    }
    if (!cchpHidden(provider)) providers.push(provider)
  }
  return providers
}

function isActiveKey(key: any): boolean {
  return String((key && key.status) || "").toLowerCase() === "active"
}

/* 单账户模式：active key 去重升序取第一把作为代表 key */
function representativeKey(keyIds: string[]): string {
  const unique: Record<string, boolean> = {}
  for (const id of keyIds) if (id) unique[id] = true
  const sorted = Object.keys(unique).sort()
  return sorted.length ? sorted[0] : ""
}

/* CCHP 把每把 key 的上游读数按真实账户归入 accounts；同一账户两把 key 读数不一致会被拆成两条并重复相加。
   单账户拓扑下一个 provider 只展示代表 key 命中的那个账户，找不到唯一账户就不显示金额。 */
function singleAccountView(balance: any, keyId: string): { balance: any; unavailable: boolean } {
  const source = balance && typeof balance === "object" ? balance : {}
  const accounts: any[] = Array.isArray(source.accounts) ? source.accounts : []
  let account: any = null
  if (keyId) {
    const matched = accounts.filter((item) => Array.isArray(item && item.key_ids)
      && item.key_ids.some((id: any) => String(id) === keyId))
    if (matched.length === 1) account = matched[0]
  }
  if (!account && accounts.length === 1) account = accounts[0]
  if (!account) {
    return {
      balance: { status: source.status, totals: [], total_usd: null, unlimited: false },
      unavailable: true,
    }
  }
  const amount = numeric(account.amount)
  const unit = String(account.unit || "USD").trim().toUpperCase() || "USD"
  return {
    balance: {
      status: source.status,
      totals: [{ unit, amount }],
      total_usd: unit === "USD" ? amount : null,
      unlimited: account.unlimited === true,
    },
    unavailable: false,
  }
}

/* totals 可能多币种并列，不做汇率换算 */
function amountParts(balance: any): string[] {
  const totals: any[] = Array.isArray(balance && balance.totals) ? balance.totals : []
  const parts: string[] = []
  for (const total of totals) {
    const amount = numeric(total && total.amount)
    if (amount === null) continue
    const unit = String((total && total.unit) || "USD").trim().toUpperCase() || "USD"
    parts.push(moneyOf(unit, amount))
  }
  return parts
}

function isClouder(name: string): boolean {
  return brand(name).toLowerCase() === "clouder"
}

function isUnsupported(status: string): boolean {
  return String(status || "").trim().toLowerCase() === "unsupported"
}

async function fetchCchp(site: Site): Promise<SiteResult> {
  const headers = { Authorization: `Bearer ${site.credential}` }
  const notices: string[] = []
  const usageLines: string[] = []

  const org = await httpJson("GET", `${site.base}/api/account/org-tree`, headers)
  ensure(org, "管理令牌")
  const orgId = String(unwrap(org.body).root ? unwrap(org.body).root.id : "")
  if (!orgId) throw new Error("返回缺少组织 ID")

  let list = await httpJson("GET", `${site.base}/api/account/orgs/${orgId}/providers`, headers)
  ensure(list, "管理令牌")
  let providers = readCchpProviders(list.body)
  let stale = false

  /* key 优先级 + active key 列表，最多 5 个请求在途 */
  const keyInfo = await mapLimit(providers, 5, async (provider) => {
    try {
      const response = await httpJson(
        "GET",
        `${site.base}/api/account/orgs/${orgId}/providers/${encodeURIComponent(provider.id)}/keys`,
        headers
      )
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      const keys: any[] = Array.isArray(unwrap(response.body).keys) ? unwrap(response.body).keys : []
      const active = keys.filter(isActiveKey)
      const pool = active.length ? active : keys
      let best: number | null = null
      for (const key of pool) {
        const priority = numeric(key && key.priority)
        if (priority !== null && (best === null || priority < best)) best = priority
      }
      return { priority: best, keyIds: active.map((key) => String(key.id || "")).filter(Boolean) }
    } catch (_) {
      return { priority: null as number | null, keyIds: [] as string[] }
    }
  })
  const infoById = new Map<string, { priority: number | null; keyIds: string[] }>()
  providers.forEach((provider, index) => {
    provider.priority = keyInfo[index].priority
    provider.keyIds = keyInfo[index].keyIds
    infoById.set(provider.id, keyInfo[index])
  })

  /* 实时刷新：单账户模式每个可见 provider 只刷代表 key；Clouder 由 CCH 站点提供，unsupported 没有账户 */
  const targets: { id: string; keyId: string }[] = []
  let total = 0
  for (const provider of providers) {
    if (isClouder(provider.name) || isUnsupported(provider.status)) continue
    total += 1
    const keyId = representativeKey(provider.keyIds)
    if (keyId) targets.push({ id: provider.id, keyId })
  }
  let ok = 0
  let timedOut = false
  let refetchFailed = false
  await mapLimit(targets, 5, async (target) => {
    try {
      const response = await httpJson(
        "GET",
        `${site.base}/api/account/orgs/${orgId}/providers/${encodeURIComponent(target.id)}`
          + `/keys/${encodeURIComponent(target.keyId)}/balance?refresh=true`,
        headers
      )
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      const body = unwrap(response.body)
      if (body && body.error) throw new Error("上游查询失败")
      ok += 1
    } catch (error: any) {
      if (error && error.code === "timeout") timedOut = true
    }
  })

  if (ok > 0) {
    try {
      const refreshed = await httpJson("GET", `${site.base}/api/account/orgs/${orgId}/providers`, headers)
      ensure(refreshed, "管理令牌")
      providers = readCchpProviders(refreshed.body)
      /* 重取后 provider 集合可能变化，key 信息按 id 回填 */
      providers.forEach((provider) => {
        const previous = infoById.get(provider.id)
        if (previous) {
          provider.priority = previous.priority
          provider.keyIds = previous.keyIds
        }
      })
    } catch (_) {
      stale = true
      refetchFailed = true
    }
  }
  if (total > 0 && ok === 0) {
    stale = true
    notices.push("⚠️ 余额未刷新，来自服务端缓存")
  } else if (total > 0 && ok < total) {
    stale = true
    notices.push("⚠️ 部分余额未刷新")
  }
  if (refetchFailed) notices.push("⚠️ 重取列表超时，显示的是刷新前数值")

  /* 今日用量与健康：失败只丢这两块 */
  let summary: any = null
  let health: Map<string, any> | null = null
  try {
    const response = await httpJson("GET", `${site.base}/api/account/usage/summary`, headers)
    if (response.status === 200) summary = unwrap(response.body).today || null
  } catch (_) {}
  try {
    const response = await httpJson(
      "GET",
      `${site.base}/api/account/usage/provider-health?since=24h&limit=50`,
      headers
    )
    if (response.status === 200) {
      const rows = unwrap(response.body).rows
      if (Array.isArray(rows)) {
        health = new Map<string, any>()
        for (const row of rows) {
          const id = String((row && row.providerId) || "")
          if (id) health.set(id, row)
        }
      }
    }
  } catch (_) {}

  /* 行：只显示 status=ok 且有金额（或不限量）的 provider */
  const rows: PanelRow[] = []
  let singleAccountUnavailable = false
  for (const provider of providers) {
    if (isClouder(provider.name)) continue
    let balance = provider.balance
    if (!isUnsupported(provider.status)) {
      const view = singleAccountView(balance, representativeKey(provider.keyIds))
      balance = view.balance
      if (view.unavailable) singleAccountUnavailable = true
    }
    const status = String((balance && balance.status) || "").toLowerCase()
    if (status !== "ok") continue
    const unlimited = balance && balance.unlimited === true
    const totalUsd = numeric(balance && balance.total_usd)
    const parts = amountParts(balance)
    if (!unlimited && !parts.length && totalUsd === null) continue
    const amountText = unlimited ? "不限量" : parts.length ? parts.join(" + ") : money(totalUsd)

    const detailParts: string[] = []
    const healthRow = health ? health.get(provider.id) : null
    if (healthRow && num(healthRow.requests) > 0) {
      const rate = numeric(healthRow.successRate)
      const ttft = numeric(healthRow.ttftP50Ms)
      if (rate !== null) detailParts.push(`${(rate * 100).toFixed(1)}%`)
      if (ttft !== null && rate !== null) detailParts.push(`${(ttft / 1000).toFixed(1)}s`)
    }

    rows.push({
      name: brand(provider.name),
      amount: amountText,
      detail: detailParts.join(" · "),
      priority: provider.priority,
      seq: rows.length,
    })
  }
  if (singleAccountUnavailable) notices.push("⚠️ 单账户余额不可用")

  const requests = numeric(summary && summary.requests)
  if (requests !== null && requests > 0) {
    const bits: string[] = [`今日 ${Math.round(requests)} 次`]
    const rate = numeric(summary.successRate)
    if (rate !== null) bits.push(`${(rate * 100).toFixed(1)}%`)
    const ttft = numeric(summary.avgTtftMs)
    if (ttft !== null) bits.push(`首字 ${(ttft / 1000).toFixed(1)}s`)
    usageLines.push(bits.join(" · "))
  }
  if (timedOut) notices.push("⚠️ 部分请求超时")

  return { site, error: null, rows, usage: usageLines.join(""), notices }
}

/* ── CCH admin：上游余额按厂商归并 ── */

type CchProvider = {
  id: string
  name: string
  vendorId: number | null
  url: string
  enabled: boolean
  priority: number | null
}

type Vendor = { name: string; domain: string }

function hostOf(url: string): string {
  const text = String(url || "").trim()
  if (!text) return ""
  try {
    const parsed = new URL(text)
    return parsed.host
  } catch (_) {
    return text.replace(/^https?:\/\//i, "").split("/")[0]
  }
}

function readCchProviders(body: any): CchProvider[] {
  const items: any[] = Array.isArray(unwrap(body).items) ? unwrap(body).items : []
  const providers: CchProvider[] = []
  for (const item of items) {
    if (!item) continue
    const vendorId = numeric(item.providerVendorId)
    providers.push({
      id: String(item.id || ""),
      name: String(item.name || ""),
      vendorId,
      url: String(item.url || ""),
      enabled: item.isEnabled !== false,
      priority: numeric(item.priority),
    })
  }
  return providers
}

function readVendors(body: any): Map<number, Vendor> {
  const map = new Map<number, Vendor>()
  const items: any[] = Array.isArray(unwrap(body).items) ? unwrap(body).items : []
  for (const item of items) {
    const id = numeric(item && item.id)
    if (id === null) continue
    map.set(id, {
      name: String((item && item.displayName) || "").trim(),
      domain: String((item && item.websiteDomain) || "").trim().toLowerCase(),
    })
  }
  return map
}

async function fetchCchAdmin(site: Site): Promise<SiteResult> {
  const headers = { Authorization: `Bearer ${site.credential}` }
  const notices: string[] = []

  const listResponse = await httpJson("GET", `${site.base}/api/v1/providers`, headers)
  ensure(listResponse, "管理员令牌")
  const providers = readCchProviders(listResponse.body)

  let vendors = new Map<number, Vendor>()
  try {
    const vendorResponse = await httpJson("GET", `${site.base}/api/v1/provider-vendors`, headers)
    if (vendorResponse.status === 200) vendors = readVendors(vendorResponse.body)
  } catch (_) {}

  const ignored = ["clouder", "miapi"]
  const targets = providers.filter((provider) => {
    if (!provider.enabled) return false
    const vendor = provider.vendorId === null ? null : vendors.get(provider.vendorId)
    return ignored.indexOf(brand(provider.name).toLowerCase()) < 0
      && ignored.indexOf(brand(vendor ? vendor.name : "").toLowerCase()) < 0
  })

  let balances: any[] = []
  if (targets.length) {
    const ids = targets.map((provider) => Number(provider.id)).filter((id) => Number.isFinite(id)).slice(0, 50)
    try {
      const response = await httpJson(
        "POST",
        `${site.base}/api/v1/providers/balances:batch`,
        headers,
        { providerIds: ids, refresh: false }
      )
      if (response.status === 200) {
        const items = unwrap(response.body).items
        if (Array.isArray(items)) balances = items
      } else {
        notices.push("⚠️ 上游余额查询失败")
      }
    } catch (_) {
      notices.push("⚠️ 上游余额查询超时")
    }
  }

  const byId = new Map<string, CchProvider>()
  for (const provider of targets) byId.set(provider.id, provider)

  /* 归并键：优先厂商，没有厂商信息时退回官网主机名 */
  const groups = new Map<string, { label: string; domain: string; priority: number | null; amount: number | null; unlimited: boolean; currency: string; brands: Record<string, boolean> }>()
  const brandsByKey = new Map<string, Record<string, boolean>>()
  for (const provider of targets) {
    const key = provider.vendorId !== null ? `v${provider.vendorId}` : `h${hostOf(provider.url)}`
    let record = brandsByKey.get(key)
    if (!record) {
      record = {}
      brandsByKey.set(key, record)
    }
    record[brand(provider.name)] = true
  }
  for (const snapshot of balances) {
    if (String((snapshot && snapshot.status) || "") !== "ok") continue
    const provider = byId.get(String((snapshot && snapshot.providerId) || ""))
    if (!provider) continue
    const key = provider.vendorId !== null ? `v${provider.vendorId}` : `h${hostOf(provider.url)}`
    let group = groups.get(key)
    if (!group) {
      const vendor = provider.vendorId === null ? null : vendors.get(provider.vendorId)
      const brands = Object.keys(brandsByKey.get(key) || {})
      group = {
        label: brands.length === 1 ? brands[0] : (vendor && vendor.name) || hostOf(provider.url),
        domain: (vendor && vendor.domain) || hostOf(provider.url),
        priority: provider.priority,
        amount: null,
        unlimited: false,
        currency: "USD",
        brands: {},
      }
      groups.set(key, group)
    }
    if (provider.priority !== null && (group.priority === null || provider.priority < group.priority)) {
      group.priority = provider.priority
    }
    group.currency = String((snapshot && snapshot.currency) || "").toUpperCase() || "USD"
    if (snapshot && snapshot.unlimited) group.unlimited = true
    const amount = numeric(snapshot && snapshot.balance)
    if (amount !== null && (group.amount === null || amount < group.amount)) group.amount = amount
  }

  const labelCount: Record<string, number> = {}
  for (const group of Array.from(groups.values())) {
    labelCount[group.label] = (labelCount[group.label] || 0) + 1
  }

  const rows: PanelRow[] = []
  for (const group of Array.from(groups.values())) {
    if (group.amount === null && !group.unlimited) continue
    const label = labelCount[group.label] > 1 && group.domain ? `${group.label}（${group.domain}）` : group.label
    rows.push({
      name: label,
      amount: group.unlimited ? "不限量" : moneyOf(group.currency, group.amount === null ? 0 : group.amount),
      detail: "",
      priority: group.priority,
      seq: rows.length,
    })
  }

  return { site, error: null, rows, usage: "", notices }
}

/* ── CCH user：账户余额 ── */

async function fetchQuotaWith(site: Site, headers: Record<string, string>, label: string): Promise<SiteResult> {
  const response = await httpJson("GET", `${site.base}/api/v1/me/quota`, headers)
  ensure(response, label)
  const quota = unwrap(response.body)

  const keyLimit = numeric(quota.keyLimitTotalUsd)
  const userLimit = numeric(quota.userLimitTotalUsd)
  let total: { limit: number; used: number } | null = null
  if (keyLimit !== null && keyLimit > 0) total = { limit: keyLimit, used: num(quota.keyCurrentTotalUsd) }
  else if (userLimit !== null && userLimit > 0) total = { limit: userLimit, used: num(quota.userCurrentTotalUsd) }

  const rows: PanelRow[] = []
  if (total) {
    rows.push({
      name: site.name,
      amount: money(total.limit - total.used),
      detail: `已用 ${money(total.used)} / ${money(total.limit)}`,
      priority: site.priority,
      seq: 0,
    })
  }
  return { site, error: null, rows, usage: "", notices: total ? [] : ["⚠️ 未设置总额度"] }
}

function fetchCchUser(site: Site): Promise<SiteResult> {
  return fetchQuotaWith(site, { "X-API-Key": site.credential }, "Key")
}

/* cookie 模式：直接把会话 auth-token 当凭据 */
function fetchCchCookie(site: Site): Promise<SiteResult> {
  return fetchQuotaWith(site, { Accept: "application/json", Cookie: `auth-token=${site.credential}` }, "会话")
}

/* login 模式：用 API Key 换会话 Cookie，缓存到 Storage，过期或被拒时重新登录一次 */
function sessionKey(base: string): string {
  return `cch_session_${base}`
}

function readSession(base: string): string {
  try {
    if (typeof Storage === "undefined" || !Storage) return ""
    const raw = Storage.get(sessionKey(base))
    if (!raw) return ""
    const cache = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!cache || typeof cache.token !== "string") return ""
    return Number(cache.expiresAt || 0) > Date.now() ? cache.token : ""
  } catch (_) {
    return ""
  }
}

function writeSession(base: string, token: string, maxAge: number | null) {
  try {
    if (typeof Storage === "undefined" || !Storage) return
    const ttl = typeof maxAge === "number" && maxAge > 0 ? maxAge : 6 * 24 * 3600
    Storage.set(sessionKey(base), JSON.stringify({ version: 1, token, expiresAt: Date.now() + ttl * 1000 }))
  } catch (_) {}
}

async function loginWithKey(base: string, credential: string): Promise<{ token: string; maxAge: number | null }> {
  let response: Response
  try {
    response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ key: credential }),
      timeout: 12,
    })
  } catch (error: any) {
    const message = String((error && error.message) || error)
    throw new Error(/abort|timeout/i.test(message) ? "登录超时" : message)
  }
  if (response.status === 401) throw new Error("Key 无效或已过期")
  if (response.status === 429) throw new Error("登录过于频繁，稍后重试")
  if (response.status !== 200) throw new Error(`登录失败（HTTP ${response.status}）`)
  const raw = response.headers.get("set-cookie") || ""
  const match = /auth-token=([^;,\s]+)/.exec(raw)
  if (!match) throw new Error("登录成功但未取到会话 Cookie")
  const ttl = /max-age=(\d+)/i.exec(raw)
  return { token: match[1], maxAge: ttl ? Number(ttl[1]) : null }
}

async function fetchCchLogin(site: Site): Promise<SiteResult> {
  const cached = readSession(site.base)
  if (cached) {
    try {
      return await fetchQuotaWith(site, { Accept: "application/json", Cookie: `auth-token=${cached}` }, "会话")
    } catch (_) {}
  }
  const session = await loginWithKey(site.base, site.credential)
  writeSession(site.base, session.token, session.maxAge)
  return fetchQuotaWith(site, { Accept: "application/json", Cookie: `auth-token=${session.token}` }, "会话")
}

/* ── CommandCode：5H / 周 / 月剩余额度 ── */

const CMDCODE_MONTH_CAP = 70
const CMDCODE_WINDOWS: [string, string, string[]][] = [
  ["fiveHour", "5H", ["fiveHour", "five_hour", "five_hours", "5h"]],
  ["weekly", "W", ["weekly", "week", "sevenDay", "7d"]],
]

function pickNumber(source: any, keys: string[]): number | null {
  if (!source || typeof source !== "object") return null
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = source[key]
    return typeof value === "number" && Number.isFinite(value) ? value : null
  }
  return null
}

function pickWindow(source: any, aliases: string[]): any {
  if (!source || typeof source !== "object") return null
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, alias)) {
      const value = source[alias]
      return value && typeof value === "object" ? value : null
    }
  }
  return null
}

function cmdcodePercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`
}

async function fetchCmdcode(site: Site): Promise<SiteResult> {
  const headers = { Authorization: `Bearer ${site.credential}` }
  const who = await httpJson("GET", `${site.base}/alpha/whoami?limits=1`, headers)
  ensure(who, "CommandCode")
  const orgId = String((unwrap(who.body).org && unwrap(who.body).org.id) || "")
  const creditsResponse = await httpJson(
    "GET",
    `${site.base}/alpha/billing/credits${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`,
    headers
  )
  ensure(creditsResponse, "CommandCode")
  const body = unwrap(creditsResponse.body)
  const credits = body && body.credits && typeof body.credits === "object" ? body.credits : (body || {})
  const limits = (credits.windowLimits || credits.window_limits
    || (body && (body.windowLimits || body.window_limits)) || {}) as any
  const flag = typeof limits.limited === "boolean" ? limits.limited
    : typeof credits.limited === "boolean" ? credits.limited : null
  const unlimited = flag === false

  const parts: string[] = []
  for (const [key, label, aliases] of CMDCODE_WINDOWS) {
    if (unlimited) {
      parts.push(`${label} 不限`)
      continue
    }
    const window = pickWindow(limits, aliases)
    if (!window) continue
    const used = pickNumber(window, ["used", "current", "spent"])
    const cap = pickNumber(window, ["cap", "limit", "max", "total"])
    if (used === null || cap === null || cap <= 0) continue
    parts.push(`${label} ${cmdcodePercent(Math.min(1, Math.max(0, (cap - used) / cap)))}`)
  }
  if (!unlimited) {
    const monthly = pickNumber(credits, ["monthlyCredits"])
    if (monthly !== null) {
      parts.push(`M ${cmdcodePercent(Math.min(1, Math.max(0, monthly / CMDCODE_MONTH_CAP)))}`)
    } else {
      const purchased = pickNumber(credits, ["purchasedCredits"])
      const free = pickNumber(credits, ["freeCredits"])
      const remaining = (purchased === null ? 0 : purchased) + (free === null ? 0 : free)
      if (purchased !== null || free !== null) parts.push(`M $${remaining.toFixed(1)}`)
    }
  }
  if (!parts.length) throw new Error("credits 里没有可展示的额度")

  return {
    site,
    error: null,
    rows: [{ name: site.name, amount: "", detail: parts.join(" · "), priority: site.priority, seq: 0 }],
    usage: "",
    notices: [],
  }
}

/* ── 站点分发与合并 ── */

async function fetchSite(site: Site): Promise<SiteResult> {
  if (site.mode === "cchp") return fetchCchp(site)
  if (site.mode === "admin") return fetchCchAdmin(site)
  if (site.mode === "cmdcode") return fetchCmdcode(site)
  if (site.mode === "login") return fetchCchLogin(site)
  if (site.mode === "cookie") return fetchCchCookie(site)
  return fetchCchUser(site)
}

function compareRows(left: PanelRow, right: PanelRow): number {
  const a = left.priority === null ? Infinity : left.priority
  const b = right.priority === null ? Infinity : right.priority
  if (a !== b) return a - b
  const leftName = left.name.toLowerCase()
  const rightName = right.name.toLowerCase()
  if (leftName !== rightName) return leftName < rightName ? -1 : 1
  return left.seq - right.seq
}

function compose(results: SiteResult[], startedAt: number): PanelData {
  const rows: PanelRow[] = []
  const usage: string[] = []
  const notices: string[] = []
  let seq = 0
  const multiSite = results.length > 1

  for (const result of results) {
    if (result.error) {
      notices.push(`⚠️ ${result.site.name}：${result.error.message}`)
      continue
    }
    for (const row of result.rows) {
      rows.push({ ...row, seq })
      seq += 1
    }
    if (result.usage) usage.push(multiSite ? `${result.site.name} · ${result.usage}` : result.usage)
    for (const notice of result.notices) if (notices.indexOf(notice) < 0) notices.push(notice)
  }

  rows.sort(compareRows)
  const cap = 12
  if (rows.length > cap) notices.push(`另有 ${rows.length - cap} 个上游`)

  return {
    rows: rows.slice(0, cap),
    usage,
    notices,
    updatedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
  }
}


/* ── 配置读写：Keychain → Storage，谁是全局就用谁 ── */

const CFG_KEY = "endpoints"
const SITES_KEY = "sites_v1"

function readRaw(key: string): any {
  try {
    if (typeof Keychain !== "undefined" && Keychain) {
      const value = Keychain.get(key)
      if (value) return value
    }
  } catch (_) {}
  try {
    if (typeof Storage !== "undefined" && Storage) {
      const value = Storage.get(key)
      if (value) return value
    }
  } catch (_) {}
  return null
}

function writeRaw(key: string, value: any): boolean {
  try {
    if (typeof Keychain !== "undefined" && Keychain) {
      Keychain.set(key, value)
      return true
    }
  } catch (_) {}
  try {
    if (typeof Storage !== "undefined" && Storage) {
      Storage.set(key, value)
      return true
    }
  } catch (_) {}
  return false
}

function readStored(): string {
  const value = readRaw(CFG_KEY)
  return value === null || value === undefined ? "" : String(value)
}

function writeStored(value: string): boolean {
  return writeRaw(CFG_KEY, value)
}

/* ── 结构化站点：JSON 存 sites_v1，同时写回文本形式兼容旧读取 ── */

function sitesToConfig(sites: Site[]): string {
  return sites
    .map((site) => {
      const suffix = site.priority === null ? site.mode : `${site.mode}:${site.priority}`
      return `${site.name}@${site.base}=${site.credential}:${suffix}`
    })
    .join(" | ")
}

function normalizeSite(raw: any): Site | null {
  if (!raw || typeof raw !== "object") return null
  const base = typeof raw.base === "string" ? raw.base.trim().replace(/\/+$/, "") : ""
  if (!base) return null
  const mode = MODES.indexOf(raw.mode) >= 0 ? (raw.mode as SiteMode) : "cchp"
  const priority = typeof raw.priority === "number" && isFinite(raw.priority) ? raw.priority : null
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : base.replace(/^https?:\/\//, ""),
    base,
    credential: typeof raw.credential === "string" ? raw.credential : "",
    mode,
    priority,
  }
}

function readSites(): Site[] {
  try {
    const raw = readRaw(SITES_KEY)
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
      if (Array.isArray(parsed)) {
        const sites = parsed.map(normalizeSite).filter((site): site is Site => !!site)
        if (sites.length) return sites
      }
    }
  } catch (_) {}
  return parseSites(readStored())
}

function writeSites(sites: Site[]): boolean {
  const stored = writeRaw(SITES_KEY, JSON.stringify(sites))
  writeStored(sitesToConfig(sites))
  return stored
}

function hasStore(): boolean {
  return (typeof Keychain !== "undefined" && !!Keychain)
    || (typeof Storage !== "undefined" && !!Storage)
}

const INITIAL_CONFIG = readStored()

function toMessage(error: any): string {
  if (!error) return "未知错误"
  if (typeof error === "string") return error
  return String(error.message || error)
}

async function loadPanelSites(sites: Site[]): Promise<PanelData> {
  const started = Date.now()
  if (!sites.length) throw new Error("还没有配置站点")
  const results = await Promise.all(sites.map((site) => fetchSite(site).then(
    (value) => value,
    (error) => ({
      site,
      error: new Error(toMessage(error)),
      rows: [] as PanelRow[],
      usage: "",
      notices: [] as string[],
    } as SiteResult)
  )))
  return compose(results, started)
}


export {
  CFG_KEY,
  loadPanelSites,
  SITES_KEY,
  INITIAL_CONFIG,
  compose,
  fetchSite,
  formatClock,
  hasStore,
  loadPanel,
  parseSites,
  readSites,
  readStored,
  sitesToConfig,
  toMessage,
  writeSites,
  writeStored,
}
export type { PanelData, PanelRow, Site, SiteResult }
