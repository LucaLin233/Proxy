// 中转站看板 · 桌面小组件入口
import { Widget } from "scripting"
import { loadPanel, readOptions, readSites } from "./relay.core"
import type { Options, Site } from "./relay.core"
import { PanelWidget } from "./views"

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

  let sites: Site[] = []
  let options: Options = { monthCap: 70, maxRows: 10, refreshMinutes: 15 }
  try {
    sites = readSites()
    options = readOptions()
  } catch (_) {}

  if (!sites.length) {
    Widget.present(<PanelWidget data={null} widgetSizeHint={family} message="未配置站点：打开脚本添加" />)
    return
  }

  /* 刷新间隔来自设置页（默认 15 分钟）；间隔内复用上次结果，避免系统提前唤醒时重复打接口 */
  const refreshMs = Math.max(1, options.refreshMinutes) * 60 * 1000
  const cacheMs = Math.max(60 * 1000, refreshMs - 60 * 1000)

  try {
    const data = await loadPanel(sites, options, cacheMs)
    /* 下一次时间线以「数据时间 + 间隔」为锚点：系统提前唤醒时不会把节奏拖后 */
    const next = Math.max(Date.now() + 60 * 1000, data.updatedAt + refreshMs)
    Widget.present(
      <PanelWidget data={data} widgetSizeHint={family} />,
      { policy: "after", date: new Date(next) }
    )
  } catch (error) {
    Widget.present(<PanelWidget data={null} widgetSizeHint={family} message={`❌ ${messageOf(error)}`} />)
  }
}

run()
