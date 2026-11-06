// DeepSeek 余额接口（OpenAI 兼容）
// GET https://api.deepseek.com/user/balance
// Authorization: Bearer <api-key>
// 响应：
// {
//   "is_available": true,
//   "balance_infos": [
//     { "currency": "CNY", "total_balance": "110.00", "granted_balance": "10.00", "topped_up_balance": "100.00" }
//   ]
// }
import { fetch } from "scripting"

export type BalanceInfo = {
  currency: string
  total: number
  granted: number
  toppedUp: number
}

export type BalanceResult =
  | { ok: true; isAvailable: boolean; infos: BalanceInfo[] }
  | { ok: false; error: string }

function moneyOf(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function messageOf(status: number): string {
  if (status === 401) return "API Key 无效或已失效（401）"
  if (status === 403) return "这个 Key 没有余额查询权限（403）"
  if (status === 429) return "请求过于频繁，请稍后再试（429）"
  if (status >= 500) return `DeepSeek 服务暂时不可用（HTTP ${status}）`
  return `请求失败（HTTP ${status}）`
}

export async function fetchBalance(apiKey: string): Promise<BalanceResult> {
  const key = apiKey.trim()
  if (!key) return { ok: false, error: "请先填写 API Key" }
  if (!key.startsWith("sk-")) return { ok: false, error: "API Key 应以 sk- 开头" }

  try {
    const resp = await fetch("https://api.deepseek.com/user/balance", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    })
    if (!resp.ok) return { ok: false, error: messageOf(resp.status) }

    let body: any
    try {
      body = await resp.json()
    } catch (_) {
      return { ok: false, error: "接口返回的不是 JSON，可能被网关拦截了" }
    }

    const raw = Array.isArray(body?.balance_infos) ? body.balance_infos : []
    const infos: BalanceInfo[] = raw
      .filter((item: any) => item && item.currency !== undefined && item.total_balance !== undefined)
      .map((item: any) => ({
        currency: String(item.currency || "").toUpperCase(),
        total: moneyOf(item.total_balance),
        granted: moneyOf(item.granted_balance),
        toppedUp: moneyOf(item.topped_up_balance),
      }))

    if (!infos.length) return { ok: false, error: "响应里没有余额数据" }
    return { ok: true, isAvailable: body?.is_available !== false, infos }
  } catch (e: any) {
    const message = e && e.message ? String(e.message) : String(e)
    return { ok: false, error: `网络错误：${message}` }
  }
}
