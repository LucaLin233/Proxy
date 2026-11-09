// 服务器监控 · 桌面小组件入口
import { Widget } from "scripting"
import { clampRefreshMinutes, emptyData, lightsailReady, loadPanel, peekaboReady, readConfig } from "./core"
import { ServerWidget } from "./views"

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
  const config = readConfig()

  if (!lightsailReady(config) && !peekaboReady(config)) {
    Widget.present(<ServerWidget data={emptyData()} config={config} widgetSizeHint={family} />)
    return
  }

  try {
    /* 刷新间隔来自设置页（默认 30 分钟）；间隔内复用上次结果，系统提前唤醒时不重复打 AWS 接口 */
    const refreshMs = clampRefreshMinutes(config.refreshMinutes) * 60 * 1000
    const cacheMs = Math.max(60 * 1000, refreshMs - 60 * 1000)
    const data = await loadPanel(config, cacheMs)
    /* 下一次时间线以「数据时间 + 间隔」为锚点（退回旧缓存时用本次尝试时间），系统提前唤醒时不会把节奏拖后 */
    const anchor = data.stale ? Date.now() : data.updatedAt
    const next = Math.max(Date.now() + 60 * 1000, anchor + refreshMs)
    Widget.present(
      <ServerWidget data={data} config={config} widgetSizeHint={family} />,
      { policy: "after", date: new Date(next) }
    )
  } catch (error) {
    Widget.present(
      <ServerWidget data={null} config={config} widgetSizeHint={family} message={`❌ ${messageOf(error)}`} />
    )
  }
}

run()
