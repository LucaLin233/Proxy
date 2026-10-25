// AI 中转站 · 桌面小组件（数据层与 index.tsx 共用 aiapi.core.ts）
import { HStack, Spacer, Text, VStack, Widget } from "scripting"
import { formatClock, loadPanelSites, readSites, toMessage } from "./aiapi.core"
import type { PanelData, PanelRow } from "./aiapi.core"

const INK: any = { light: "#101014", dark: "#f5f5f7" }
const MUTED: any = { light: "#8a8a8e", dark: "#9a9a9e" }
const GREEN = "#30d158"
const BLUE = "#0a84ff"

function family(): string {
  try {
    return String((Widget as any).family || "medium").toLowerCase()
  } catch (_) {}
  return "medium"
}

function boxHeight(): number {
  try {
    const size: any = (Widget as any).displaySize
    if (size && Number(size.height) > 60) return Number(size.height)
  } catch (_) {}
  const name = family()
  if (name.indexOf("small") >= 0) return 170
  if (name.indexOf("large") >= 0) return 380
  return 170
}

function money(row: PanelRow): number {
  if (!row.amount) return 0
  const hit = /([0-9]+(?:\.[0-9]+)?)/.exec(row.amount)
  return hit ? Number(hit[1]) : 0
}

function total(rows: PanelRow[]): number {
  let sum = 0
  for (const row of rows) sum += money(row)
  return sum
}

/* 单行制：容量按高度算，标题 + 合计 + 底部留白之外全部给列表 */
function capacity(): number {
  return Math.max(2, Math.floor((boxHeight() - 40) / 17))
}

function shortDetail(detail: string): string {
  return detail || ""
}

function Row({ row }: { row: PanelRow }) {
  const note = shortDetail(row.detail || "")
  return (
    <HStack alignment="center" spacing={6}>
      <Text font={8} foregroundStyle={(row.amount ? GREEN : BLUE) as any}>●</Text>
      <Text font={12} fontWeight="semibold" foregroundStyle={INK}>{row.name}</Text>
      {note && row.amount ? <Text font={9} foregroundStyle={MUTED}>{note}</Text> : null}
      <Spacer />
      {row.amount ? <Text font={12} fontWeight="semibold" foregroundStyle={INK}>{row.amount}</Text> : null}
      {!row.amount && note ? <Text font={10} foregroundStyle={MUTED}>{note}</Text> : null}
    </HStack>
  )
}

function WidgetView({ data, message }: { data: PanelData | null; message: string }) {
  const rows = data ? data.rows : []
  const limit = capacity()
  const shown = rows.slice(0, limit)
  const hidden = rows.length - shown.length

  return (
    <VStack alignment="leading" spacing={4} padding={{ top: 10, bottom: 10, leading: 13, trailing: 13 }}>
      <HStack alignment="center" spacing={4}>
        <Text font={11} fontWeight="bold" foregroundStyle={INK}>API 中转站</Text>
        <Spacer />
        {data ? <Text font={9} foregroundStyle={MUTED}>{formatClock(data.updatedAt)}</Text> : null}
      </HStack>
      {data && data.usage.length ? <Text font={11} foregroundStyle={INK}>{data.usage[0]}</Text> : null}
      {message ? <Text font={10} foregroundStyle={MUTED}>{message}</Text> : null}
      {shown.map((row) => <Row key={`${row.name}-${row.seq}`} row={row} />)}
      {hidden > 0 ? <Text font={9} foregroundStyle={MUTED}>{`+${hidden} 个上游未显示`}</Text> : null}
    </VStack>
  )
}

async function run() {
  const sites = readSites()
  if (!sites.length) {
    Widget.present(<WidgetView data={null} message="未配置：点开添加站点" />)
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
