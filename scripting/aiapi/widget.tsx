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
  let options: Options = { monthCap: 70, maxRows: 10 }
  try {
    sites = readSites()
    options = readOptions()
  } catch (_) {}

  if (!sites.length) {
    Widget.present(<PanelWidget data={null} widgetSizeHint={family} message="未配置站点：打开脚本添加" />)
    return
  }

  try {
    /* 90 秒内复用上次结果：桌面连续刷新时不重复打接口 */
    const data = await loadPanel(sites, options, 90 * 1000)
    Widget.present(
      <PanelWidget data={data} widgetSizeHint={family} />,
      { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) }
    )
  } catch (error) {
    Widget.present(<PanelWidget data={null} widgetSizeHint={family} message={`❌ ${messageOf(error)}`} />)
  }
}

run()
