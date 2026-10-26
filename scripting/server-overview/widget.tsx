// 服务器监控 · 桌面小组件入口
import { Widget } from "scripting"
import { emptyData, lightsailReady, loadPanel, peekaboReady, readConfig } from "./core"
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
    /* 5 分钟内复用上次结果：桌面连续刷新时不重复打 AWS 接口 */
    const data = await loadPanel(config, 5 * 60 * 1000)
    Widget.present(
      <ServerWidget data={data} config={config} widgetSizeHint={family} />,
      { policy: "after", date: new Date(Date.now() + 30 * 60 * 1000) }
    )
  } catch (error) {
    Widget.present(
      <ServerWidget data={null} config={config} widgetSizeHint={family} message={`❌ ${messageOf(error)}`} />
    )
  }
}

run()
