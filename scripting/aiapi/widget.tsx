// AI 中转站 · 桌面小组件（数据层与 index.tsx 共用 aiapi.core.ts）
import { HStack, Spacer, Text, VStack, Widget } from "scripting"
import { formatClock, loadPanelSites, readSites, toMessage } from "./aiapi.core"
import type { PanelData, PanelRow } from "./aiapi.core"

/* 3.2.x 的 family 是 small/medium/large，老文档写过 systemSmall，两种都兼容 */
function rowLimit(): number {
  let family = "medium"
  try {
    family = String((Widget as any).family || "medium").toLowerCase()
  } catch (_) {}
  if (family.indexOf("small") >= 0) return 3
  if (family.indexOf("large") >= 0) return 9
  return 5
}

function Row({ row }: { row: PanelRow }) {
  return (
    <HStack spacing={6}>
      <Text font={12} fontWeight="semibold">{row.name}</Text>
      <Spacer />
      <Text font={12}>{row.amount}</Text>
    </HStack>
  )
}

function WidgetView({ data, message }: { data: PanelData | null; message: string }) {
  const limit = rowLimit()
  return (
    <VStack alignment="leading" spacing={4}>
      <Text font={11} fontWeight="bold">API 中转站</Text>
      {message ? <Text font={10}>{message}</Text> : null}
      {data ? data.rows.slice(0, limit).map((row) => <Row key={`${row.name}-${row.seq}`} row={row} />) : null}
      {data ? <Text font={9}>{`更新 ${formatClock(data.updatedAt)}`}</Text> : null}
    </VStack>
  )
}

async function run() {
  const sites = readSites()
  if (!sites.length) {
    Widget.present(<WidgetView data={null} message="未配置：先在主脚本里添加站点" />)
    return
  }
  try {
    const data = await loadPanelSites(sites)
    Widget.present(<WidgetView data={data} message="" />)
  } catch (error) {
    Widget.present(<WidgetView data={null} message={`❌ ${toMessage(error)}`} />)
  }
}

run()
