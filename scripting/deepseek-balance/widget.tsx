// DeepSeek 余额 · 桌面小组件入口
import { Widget } from "scripting"
import { loadConfig } from "./config"
import { loadPanel } from "./core"
import { DeepSeekWidget } from "./views"

function familyOf(): string {
  try {
    const value: any = (Widget as any).family
    return typeof value === "string" && value ? value : "systemMedium"
  } catch (_) {
    return "systemMedium"
  }
}

function messageOf(error: any): string {
  if (!error) return "未知错误"
  if (typeof error === "string") return error
  return String(error.message || error)
}

async function run() {
  const family = familyOf()
  const config = loadConfig()
  const minutes = config.refreshMinutes || 15

  if (!config.apiKey) {
    Widget.present(<DeepSeekWidget data={null} widgetSizeHint={family} />)
    return
  }

  try {
    /* 间隔内复用上次结果，避免系统提前唤醒时重复打接口；到点前 1 分钟失效 */
    const refreshMs = Math.max(1, minutes) * 60 * 1000
    const cacheMs = Math.max(60 * 1000, refreshMs - 60 * 1000)
    const data = await loadPanel(false, cacheMs)
    /* 下一次时间线锚在「本次检查时间 + 间隔」，系统提前唤醒不会把节奏拖后 */
    const next = Math.max(Date.now() + 60 * 1000, data.checkedAt + refreshMs)
    Widget.present(
      <DeepSeekWidget data={data} widgetSizeHint={family} />,
      { policy: "after", date: new Date(next) },
    )
  } catch (error) {
    Widget.present(
      <DeepSeekWidget data={null} widgetSizeHint={family} message={`❌ ${messageOf(error)}`} />,
    )
  }
}

run()
