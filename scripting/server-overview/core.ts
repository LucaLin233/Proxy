/* 服务器监控 · 数据层
   移植自 Surge 脚本 surge/scripts/server_overview.js：
   - AWS Lightsail：GetInstances / GetBundles / GetInstanceMetricData，按「区域 + 套餐」聚合当月流量
   - Peekabo：服务器当月流量与到期时间
   SigV4 用纯 TS 实现 SHA-256 / HMAC-SHA256，不依赖运行时的加密库。
   Storage 是运行时全局（本脚本私有域），不需要 import。 */

import { fetch } from "scripting"

/* ── 类型 ── */

export type IpMode = "full" | "mask" | "hide"

export type Config = {
  awsKeyId: string
  awsSecret: string
  /* 多个区域用逗号 / 分号 / 竖线分隔 */
  regions: string
  ipMode: IpMode
  peekaboToken: string
  peekaboId: string
  /* 是否取「今日」流量：多一轮接口，关掉能快一半 */
  showToday: boolean
  /* App 内最多显示多少组 */
  maxRows: number
}

export type ServerInstance = {
  name: string
  ip: string
  usedBytes: number
}

export type GroupRow = {
  key: string
  region: string
  regionName: string
  bundleId: string
  quotaBytes: number
  usedBytes: number
  todayBytes: number
  /* 已用比例 0–1；配额未知时为 0 */
  percent: number
  instances: ServerInstance[]
}

export type PeekaboData = {
  ok: boolean
  used: number
  total: number
  percent: number
  expireAt: number
  daysLeft: number
  error: string
}

export type PanelError = { source: "Lightsail" | "Peekabo"; message: string }

export type ServerData = {
  groups: GroupRow[]
  peekabo: PeekaboData | null
  errors: PanelError[]
  updatedAt: number
  elapsedMs: number
  fromCache: boolean
  /* 这次取数失败、退回上一次缓存 */
  stale: boolean
  /* 是否至少配置了一侧（AWS / Peekabo） */
  configured: boolean
}

type HttpResult = {
  status: number
  text: string
  timedOut: boolean
}

type Budget<T> =
  | { ok: true; value: T; ms: number }
  | { ok: false; value: any; ms: number }

/* ── 配置 ── */

const STORE_CONFIG = "server.config.v1"
const STORE_CACHE = "server.panel.v1"
const STORE_BUNDLE = "server.bundles.v1"

export const DEFAULT_CONFIG: Config = {
  awsKeyId: "",
  awsSecret: "",
  regions: "ap-east-1|ap-northeast-1",
  ipMode: "mask",
  peekaboToken: "",
  peekaboId: "",
  showToday: true,
  maxRows: 8,
}

const IP_MODES: IpMode[] = ["full", "mask", "hide"]

function normalizeIpMode(raw: any): IpMode {
  const text = String(raw || "mask").trim().toLowerCase()
  return (IP_MODES as string[]).indexOf(text) >= 0 ? (text as IpMode) : "mask"
}

export function readConfig(): Config {
  try {
    const stored = Storage.get<any>(STORE_CONFIG)
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored
    if (parsed && typeof parsed === "object") {
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        ipMode: normalizeIpMode(parsed.ipMode),
        showToday: parsed.showToday !== false,
      }
    }
  } catch (_) {}
  return { ...DEFAULT_CONFIG }
}

export function writeConfig(config: Config): void {
  try {
    Storage.set(STORE_CONFIG, JSON.stringify({ ...config, ipMode: normalizeIpMode(config.ipMode) }))
  } catch (_) {}
}

export function regionsOf(config: Config): string[] {
  return String(config.regions || "")
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function lightsailReady(config: Config): boolean {
  return Boolean(String(config.awsKeyId || "").trim() && String(config.awsSecret || "").trim())
}

export function peekaboReady(config: Config): boolean {
  return Boolean(String(config.peekaboToken || "").trim() && String(config.peekaboId || "").trim())
}

/* 把 Surge 模块的 argument="…" 整段或裸参数解析成配置补丁 */
export function parseSurgeArguments(input: string): Partial<Config> {
  const text = String(input || "")
  const quoted = text.match(/argument\s*=\s*"([^"]*)"/i)
  const source = quoted ? quoted[1] : text
  const args: Record<string, string> = {}
  for (const pair of source.replace(/[\r\n]+/g, "&").split("&")) {
    const index = pair.indexOf("=")
    if (index < 0) continue
    const key = safeDecode(pair.slice(0, index)).trim()
    if (key) args[key] = safeDecode(pair.slice(index + 1)).trim()
  }

  const patch: Partial<Config> = {}
  if (args.lightsail_ak !== undefined) patch.awsKeyId = args.lightsail_ak
  if (args.lightsail_sk !== undefined) patch.awsSecret = args.lightsail_sk
  if (args.lightsail_region !== undefined) patch.regions = args.lightsail_region
  if (args.lightsail_ip_mode !== undefined) patch.ipMode = normalizeIpMode(args.lightsail_ip_mode)
  if (args.peekabo_id !== undefined) patch.peekaboId = args.peekabo_id
  if (args.peekabo_token !== undefined) patch.peekaboToken = args.peekabo_token
  return patch
}

/* 反向导出成 Surge 模块参数，方便粘回模块 */
export function surgeArgumentsOf(config: Config): string {
  return [
    `lightsail_ak=${encodeURIComponent(config.awsKeyId)}`,
    `lightsail_sk=${encodeURIComponent(config.awsSecret)}`,
    `lightsail_region=${encodeURIComponent(config.regions)}`,
    `lightsail_ip_mode=${config.ipMode}`,
    `peekabo_id=${encodeURIComponent(config.peekaboId)}`,
    `peekabo_token=${encodeURIComponent(config.peekaboToken)}`,
  ].join("&")
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch (_) { return value }
}

/* ── 格式化 ── */

const BYTES_PER_GB = 1024 ** 3
const BYTES_PER_TB = 1024 ** 4

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "N/A"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  const digits = value >= 100 || index === 0 ? 0 : 2
  return `${value.toFixed(digits)} ${units[index]}`
}

export function percentText(ratio: number | null, digits = 1): string {
  if (ratio === null || !Number.isFinite(ratio)) return "--"
  return `${(ratio * 100).toFixed(digits)}%`
}

/* 紧凑的一对：统一单位，避免两遍写单位占宽度 */
export function formatPair(usedBytes: number, quotaBytes: number): string {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
    return `${formatBytes(usedBytes)} / 未知`
  }
  const tb = quotaBytes >= BYTES_PER_TB
  const unit = tb ? BYTES_PER_TB : BYTES_PER_GB
  const label = tb ? "TB" : "GB"
  const used = usedBytes / unit
  const quota = quotaBytes / unit
  const digits = quota >= 100 ? 0 : quota >= 10 ? 1 : 2
  return `${used.toFixed(digits)} / ${quota.toFixed(digits)} ${label}`
}

export function formatClock(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatDate(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatMonthDay(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatRemaining(milliseconds: number): string {
  if (milliseconds <= 0) return "已到期"
  const totalMinutes = Math.floor(milliseconds / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${Math.max(1, minutes)} 分钟`
}

export function daysLeft(expireAt: number): number {
  return Math.max(0, Math.ceil((expireAt - Date.now()) / 86400000))
}

export function maskIp(ip: string): string {
  const parts = String(ip || "").split(".")
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : String(ip || "")
}

/* Lightsail 区域中文名（未收录的回退显示区域代码） */
const REGION_NAMES: Record<string, string> = {
  "us-east-1": "弗吉尼亚北部",
  "us-east-2": "俄亥俄",
  "us-west-1": "加州北部",
  "us-west-2": "俄勒冈",
  "ca-central-1": "加拿大中部",
  "sa-east-1": "圣保罗",
  "eu-west-1": "爱尔兰",
  "eu-west-2": "伦敦",
  "eu-west-3": "巴黎",
  "eu-central-1": "法兰克福",
  "eu-north-1": "斯德哥尔摩",
  "eu-south-2": "西班牙",
  "ap-east-1": "香港",
  "ap-northeast-1": "东京",
  "ap-northeast-2": "首尔",
  "ap-northeast-3": "大阪",
  "ap-south-1": "孟买",
  "ap-southeast-1": "新加坡",
  "ap-southeast-2": "悉尼",
  "ap-southeast-3": "雅加达",
  "ap-southeast-5": "吉隆坡",
}

export function regionLabel(region: string): string {
  return REGION_NAMES[region] || region
}

/* ── HTTP ── */

async function request(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body?: string,
  timeoutMs = 12000,
  budgetMs = 0
): Promise<HttpResult> {
  const init: any = { method, headers: { ...headers } }
  if (body !== undefined) init.body = body

  const limit = Math.max(1000, budgetMs > 0 ? Math.min(timeoutMs, budgetMs) : timeoutMs)
  let timer: any = null
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), limit)
  })
  const task = fetch(url, init).then(
    async (response: any) => ({
      status: Number(response.status) || 0,
      text: await response.text(),
      timedOut: false,
    }),
    (error: any) => ({ error })
  )

  const settled: any = await Promise.race([task, timeout])
  if (timer !== null) clearTimeout(timer)
  if (settled === null) return { status: 0, text: "", timedOut: true }
  if (settled.error) {
    const message = String(settled.error.message || settled.error)
    if (/abort|timeout|timed out/i.test(message)) return { status: 0, text: "", timedOut: true }
    throw new Error(message)
  }
  return settled as HttpResult
}

function httpGet(url: string, headers: Record<string, string>, timeoutMs = 8000, budgetMs = 0): Promise<HttpResult> {
  return request("GET", url, headers, undefined, timeoutMs, budgetMs)
}

function httpPost(url: string, headers: Record<string, string>, body: string, timeoutMs = 12000, budgetMs = 0): Promise<HttpResult> {
  return request("POST", url, headers, body, timeoutMs, budgetMs)
}

function messageOf(error: any): string {
  if (!error) return "未知错误"
  if (typeof error === "string") return error
  return String(error.message || error)
}

/* ── SigV4：SHA-256 / HMAC-SHA256 ── */

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0
}

export function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = []
  for (let i = 0; i < input.length; i++) {
    let code = input.codePointAt(i) as number
    if (code > 0xffff) i++
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  return Uint8Array.from(bytes)
}

export function sha256Bytes(input: Uint8Array): Uint8Array {
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const length = input.length
  const padded = new Uint8Array((Math.floor((length + 9) / 64) + 1) * 64)
  padded.set(input)
  padded[length] = 0x80
  const bitLength = length * 8
  const view = new DataView(padded.buffer as ArrayBuffer)
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(padded.length - 4, bitLength >>> 0)

  const words = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t++) words[t] = view.getUint32(offset + t * 4)
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(words[t - 15], 7) ^ rotr(words[t - 15], 18) ^ (words[t - 15] >>> 3)
      const s1 = rotr(words[t - 2], 17) ^ rotr(words[t - 2], 19) ^ (words[t - 2] >>> 10)
      words[t] = (words[t - 16] + s0 + words[t - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = state
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + SHA_K[t] + words[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    const round = [a, b, c, d, e, f, g, h]
    for (let i = 0; i < 8; i++) state[i] = (state[i] + round[i]) >>> 0
  }

  const output = new Uint8Array(32)
  const outputView = new DataView(output.buffer as ArrayBuffer)
  state.forEach((value, index) => outputView.setUint32(index * 4, value))
  return output
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function sha256Hex(input: string): string {
  return toHex(sha256Bytes(utf8Bytes(input)))
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length)
  merged.set(left)
  merged.set(right, left.length)
  return merged
}

export function hmacSha256(key: Uint8Array | string, message: Uint8Array | string): Uint8Array {
  const keyBytes = typeof key === "string" ? utf8Bytes(key) : key
  let normalized = keyBytes
  if (normalized.length > 64) normalized = sha256Bytes(normalized)
  const block = new Uint8Array(64)
  block.set(normalized)
  const inner = new Uint8Array(64)
  const outer = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36
    outer[i] = block[i] ^ 0x5c
  }
  const messageBytes = typeof message === "string" ? utf8Bytes(message) : message
  return sha256Bytes(concatBytes(outer, sha256Bytes(concatBytes(inner, messageBytes))))
}

function amzDateNow(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")
}

export function buildAuthorization(
  method: string,
  host: string,
  target: string,
  body: string,
  region: string,
  accessKey: string,
  secretKey: string,
  amzDate: string
): string {
  const dateStamp = amzDate.slice(0, 8)
  const canonicalHeaders =
    "content-type:application/x-amz-json-1.1\n" +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target"
  const canonicalRequest = [method, "/", "", canonicalHeaders, signedHeaders, sha256Hex(body)].join("\n")
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n")
  const signingKey = hmacSha256(
    hmacSha256(
      hmacSha256(hmacSha256(utf8Bytes(`AWS4${secretKey}`), dateStamp), region),
      SERVICE
    ),
    "aws4_request"
  )
  const signature = toHex(hmacSha256(signingKey, stringToSign))
  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

/* ── Lightsail ── */

const SERVICE = "lightsail"
const TARGET_PREFIX = "Lightsail_20161128."
const LIGHTSAIL_BUDGET_MS = 15000
const PEEKABO_BUDGET_MS = 8000

function awsError(result: HttpResult): string {
  let type = ""
  let message = ""
  try {
    const json = JSON.parse(result.text)
    type = String(json.__type || json.code || "")
    message = String(json.Message || json.message || "")
  } catch (_) {}
  const short = type.split("#").pop() || ""
  const hints: Record<string, string> = {
    AccessDeniedException: "密钥没有 Lightsail 只读权限",
    InvalidClientTokenId: "AWS Access Key 无效",
    SignatureDoesNotMatch: "Secret Key 不匹配",
    UnrecognizedClientException: "AWS 密钥无法识别",
    ThrottlingException: "AWS 限流，请稍后再试",
    InvalidInputException: "参数不合法",
  }
  const hint = hints[short] || short || (result.timedOut ? "请求超时" : `HTTP ${result.status}`)
  return message ? `${hint}：${message}` : hint
}

function lightsail<T>(
  config: Config,
  region: string,
  action: string,
  params: Record<string, any>,
  budgetMs = 0
): Promise<T> {
  const host = `lightsail.${region}.amazonaws.com`
  const target = `${TARGET_PREFIX}${action}`
  const body = JSON.stringify(params || {})
  const amzDate = amzDateNow()
  const authorization = buildAuthorization(
    "POST", host, target, body, region,
    String(config.awsKeyId).trim(), String(config.awsSecret).trim(), amzDate
  )
  return httpPost(
    `https://${host}/`,
    {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      "Authorization": authorization,
    },
    body,
    12000,
    budgetMs
  ).then((response) => {
    if (response.status !== 200) throw new Error(awsError(response))
    try {
      return JSON.parse(response.text) as T
    } catch (_) {
      throw new Error("响应解析失败")
    }
  })
}

function monthStartEpoch(): number {
  const now = new Date()
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000)
}

/* 今日按北京时间日切 */
function todayStartEpoch(): number {
  const now = new Date()
  const beijing = new Date(now.getTime() + 8 * 3600 * 1000)
  const dayStart = Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate())
  return Math.floor((dayStart - 8 * 3600 * 1000) / 1000)
}

/* period 不能大于查询窗口，月初窗口不足一天时按窗口收缩 */
function metricPeriod(startEpoch: number, endEpoch: number): number {
  const window = endEpoch - startEpoch
  if (window >= 86400) return 86400
  return Math.max(60, Math.floor(window / 60) * 60)
}

async function getInstances(config: Config, region: string, budgetMs: number): Promise<any[]> {
  const response = await lightsail<any>(config, region, "GetInstances", {}, budgetMs)
  return response.instances || []
}

async function getMetricSum(
  config: Config,
  region: string,
  instanceName: string,
  metricName: string,
  startEpoch: number,
  budgetMs: number
): Promise<number> {
  const endEpoch = Math.floor(Date.now() / 1000)
  const response = await lightsail<any>(config, region, "GetInstanceMetricData", {
    instanceName,
    metricName,
    period: metricPeriod(startEpoch, endEpoch),
    startTime: startEpoch,
    endTime: endEpoch,
    unit: "Bytes",
    statistics: ["Sum"],
  }, budgetMs)
  return (response.metricData || []).reduce((total: number, point: any) => total + (point.sum || 0), 0)
}

function readSlot<T>(key: string, maxAgeMs = 0): T | null {
  try {
    const raw = Storage.get<any>(key)
    if (!raw) return null
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== "object") return null
    if (maxAgeMs > 0 && Date.now() - Number(parsed.at || 0) > maxAgeMs) return null
    return parsed.value as T
  } catch (_) {
    return null
  }
}

function writeSlot(key: string, value: any): void {
  try {
    Storage.set(key, JSON.stringify({ at: Date.now(), value }))
  } catch (_) {}
}

async function getBundleMap(config: Config, region: string, budgetMs: number): Promise<Record<string, number>> {
  const slot = `${STORE_BUNDLE}.${region}`
  const cached = readSlot<Record<string, number>>(slot, 24 * 3600 * 1000)
  if (cached) return cached

  const response = await lightsail<any>(config, region, "GetBundles", { includeInactive: true }, budgetMs)
  const map: Record<string, number> = {}
  ;(response.bundles || []).forEach((bundle: any) => {
    map[bundle.bundleId] = Number(bundle.transferPerMonthInGb) || 0
  })
  writeSlot(slot, map)
  return map
}

function ownQuotaGb(instance: any): number {
  const transfer = ((instance || {}).networking || {}).monthlyTransfer || {}
  const allocated = Number(transfer.gbPerMonthAllocated)
  return Number.isFinite(allocated) && allocated > 0 ? allocated : 0
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
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
        results[index] = await worker(items[index], index)
      }
    })())
  }
  await Promise.all(runners)
  return results
}

type Entry = {
  region: string
  instance: any
  inBytes: number
  outBytes: number
  todayBytes: number
}

function buildGroups(entries: Entry[], bundleMap: Record<string, number>): GroupRow[] {
  const groups = new Map<string, GroupRow>()
  entries.forEach((entry) => {
    const { region, instance } = entry
    const key = `${region} · ${instance.bundleId}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        region,
        regionName: regionLabel(region),
        bundleId: String(instance.bundleId || ""),
        quotaBytes: 0,
        usedBytes: 0,
        todayBytes: 0,
        percent: 0,
        instances: [],
      }
      groups.set(key, group)
    }
    const quotaGb = ownQuotaGb(instance) || Number(bundleMap[instance.bundleId]) || 0
    group.quotaBytes += quotaGb * BYTES_PER_GB
    group.usedBytes += entry.inBytes + entry.outBytes
    group.todayBytes += entry.todayBytes || 0
    group.instances.push({
      name: String(instance.name || ""),
      ip: String(instance.publicIpAddress || "").trim(),
      usedBytes: entry.inBytes + entry.outBytes,
    })
  })

  return Array.from(groups.values()).map((group) => ({
    ...group,
    percent: group.quotaBytes > 0 ? group.usedBytes / group.quotaBytes : 0,
  }))
}

function sortGroups(groups: GroupRow[], regions: string[]): GroupRow[] {
  const rank = new Map<string, number>()
  regions.forEach((region, index) => rank.set(region, index))
  return groups.slice().sort((left, right) => {
    const a = rank.get(left.region)
    const b = rank.get(right.region)
    const ra = a === undefined ? 999 : a
    const rb = b === undefined ? 999 : b
    if (ra !== rb) return ra - rb
    return left.bundleId.localeCompare(right.bundleId)
  })
}

async function collectGroups(config: Config, budgetMs: number): Promise<GroupRow[]> {
  const regions = regionsOf(config)
  const entries: Entry[] = []
  const started = Date.now()

  for (const region of regions) {
    const left = budgetMs - (Date.now() - started)
    if (left < 1500) throw new Error("区域太多，请求超时")
    const instances = await getInstances(config, region, left)
    instances.forEach((instance) => entries.push({
      region,
      instance,
      inBytes: 0,
      outBytes: 0,
      todayBytes: 0,
    }))
  }
  if (!entries.length) return []

  let bundleMap: Record<string, number> = {}
  if (entries.some(({ instance }) => !ownQuotaGb(instance))) {
    try {
      bundleMap = await getBundleMap(config, regions[0], budgetMs)
    } catch (_) {
      bundleMap = {}
    }
  }

  const monthStart = monthStartEpoch()
  const todayStart = todayStartEpoch()
  const withToday = config.showToday !== false

  await mapLimit(entries, 3, async (entry) => {
    const left = budgetMs - (Date.now() - started)
    if (left < 1500) throw new Error("请求超时")
    const [inBytes, outBytes] = await Promise.all([
      getMetricSum(config, entry.region, entry.instance.name, "NetworkIn", monthStart, left),
      getMetricSum(config, entry.region, entry.instance.name, "NetworkOut", monthStart, left),
    ])
    entry.inBytes = inBytes
    entry.outBytes = outBytes
    if (!withToday) return
    try {
      const [todayIn, todayOut] = await Promise.all([
        getMetricSum(config, entry.region, entry.instance.name, "NetworkIn", todayStart, left),
        getMetricSum(config, entry.region, entry.instance.name, "NetworkOut", todayStart, left),
      ])
      entry.todayBytes = todayIn + todayOut
    } catch (_) {
      entry.todayBytes = 0
    }
  })

  return sortGroups(buildGroups(entries, bundleMap), regions)
}

/* ── Peekabo ── */

const PEEKABO_API = "https://vf-hk.peekabo.io/api/server"

function failedPeekabo(error: string): PeekaboData {
  return { ok: false, used: 0, total: 0, percent: 0, expireAt: 0, daysLeft: 0, error }
}

export async function fetchPeekabo(config: Config, budgetMs = PEEKABO_BUDGET_MS): Promise<PeekaboData> {
  const token = String(config.peekaboToken || "").trim()
  const id = String(config.peekaboId || "").trim()
  if (!token || !id) return failedPeekabo("未配置")

  let response: HttpResult
  try {
    response = await httpGet(
      `${PEEKABO_API}/${encodeURIComponent(id)}?state=true`,
      { Accept: "application/json", Authorization: `Bearer ${token}` },
      8000,
      budgetMs
    )
  } catch (error) {
    return failedPeekabo(/timeout|timed out/i.test(messageOf(error)) ? "连接超时" : "连接失败")
  }

  if (response.timedOut) return failedPeekabo("连接超时")
  if (response.status !== 200) return failedPeekabo(response.status === 401 ? "令牌无效" : `HTTP ${response.status}`)

  let json: any
  try {
    json = JSON.parse(response.text)
  } catch (_) {
    return failedPeekabo("响应解析失败")
  }

  const data = (json && json.data) || {}
  const used = Number(
    data && data.state && data.state.network && data.state.network.primary &&
    data.state.network.primary.traffic && data.state.network.primary.traffic.tx
  )
  const limitRaw = String((data.network && data.network.primary && data.network.primary.limit) || "").trim()
  const limitMatch = limitRaw.match(/^(\d+(?:\.\d+)?)\s*GB$/i)
  const total = limitMatch ? Number(limitMatch[1]) * BYTES_PER_GB : NaN
  const expireAt = Date.parse(data && data.currentMonthlyPeriod && data.currentMonthlyPeriod.end)

  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(total) || total <= 0 || !Number.isFinite(expireAt)) {
    return failedPeekabo("流量或到期信息不完整")
  }

  return {
    ok: true,
    used,
    total,
    percent: used / total,
    expireAt,
    daysLeft: daysLeft(expireAt),
    error: "",
  }
}

/* ── 面板 ── */

export function emptyData(): ServerData {
  return {
    groups: [],
    peekabo: null,
    errors: [],
    updatedAt: Date.now(),
    elapsedMs: 0,
    fromCache: false,
    stale: false,
    configured: false,
  }
}

export function clearPanelCache(): void {
  try { Storage.remove(STORE_CACHE) } catch (_) {}
}

function withBudget<T>(run: () => Promise<T>, ms: number): Promise<Budget<T>> {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const done = (ok: boolean, value: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve((ok ? { ok: true, value, ms: Date.now() - started } : { ok: false, value, ms: Date.now() - started }) as Budget<T>)
    }
    const timer = setTimeout(() => done(false, new Error("请求超时")), ms)
    run().then(
      (value) => done(true, value),
      (error) => done(false, error || new Error("查询失败"))
    )
  })
}

export async function loadPanel(config: Config, maxAgeMs = 0): Promise<ServerData> {
  const aws = lightsailReady(config)
  const peek = peekaboReady(config)
  if (!aws && !peek) return emptyData()

  const cached = readSlot<ServerData>(STORE_CACHE)
  if (cached && Array.isArray(cached.groups) && maxAgeMs > 0 && Date.now() - cached.updatedAt < maxAgeMs) {
    return { ...cached, fromCache: true }
  }

  const started = Date.now()
  const [lightResult, peekResult] = await Promise.all([
    aws
      ? withBudget(() => collectGroups(config, LIGHTSAIL_BUDGET_MS), LIGHTSAIL_BUDGET_MS + 1000)
      : Promise.resolve<Budget<GroupRow[]>>({ ok: false, value: new Error("未配置"), ms: 0 }),
    peek
      ? withBudget(() => fetchPeekabo(config), PEEKABO_BUDGET_MS + 1000)
      : Promise.resolve<Budget<PeekaboData>>({ ok: false, value: new Error("未配置"), ms: 0 }),
  ])

  const errors: PanelError[] = []
  let groups: GroupRow[] = []
  let peekabo: PeekaboData | null = null

  if (aws) {
    if (lightResult.ok) groups = lightResult.value
    else errors.push({ source: "Lightsail", message: messageOf(lightResult.value) })
  }
  if (peek) {
    peekabo = peekResult.ok ? peekResult.value : failedPeekabo(messageOf(peekResult.value))
    if (!peekabo.ok) errors.push({ source: "Peekabo", message: peekabo.error })
  }

  const elapsedMs = Date.now() - started
  const usable = groups.length > 0 || Boolean(peekabo && peekabo.ok)

  /* 两侧都没取到、又有旧数据：宁可显示旧数据也不要把整块清空 */
  if (!usable && cached && Array.isArray(cached.groups)) {
    return { ...cached, fromCache: true, stale: true, errors }
  }

  const data: ServerData = {
    groups,
    peekabo,
    errors,
    updatedAt: Date.now(),
    elapsedMs,
    fromCache: false,
    stale: false,
    configured: true,
  }
  if (usable) writeSlot(STORE_CACHE, data)
  return data
}

export function countInstances(groups: GroupRow[]): number {
  return groups.reduce((total, group) => total + group.instances.length, 0)
}

export function totalTraffic(groups: GroupRow[]): { used: number; quota: number } {
  return groups.reduce(
    (total, group) => ({
      used: total.used + group.usedBytes,
      quota: total.quota + group.quotaBytes,
    }),
    { used: 0, quota: 0 }
  )
}

/* 供预览 / 测试使用：把一组假数据灌进缓存，不碰真实配置 */
export function peekCache(): ServerData | null {
  return readSlot<ServerData>(STORE_CACHE)
}
