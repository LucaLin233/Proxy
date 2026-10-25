// AI 中转站 · 桌面小组件（数据层与 index.tsx 共用 aiapi.core.ts）
import { HStack, Spacer, Text, VStack, Widget } from "scripting"
import { formatClock, loadPanelSites, readSites, toMessage } from "./aiapi.core"
import type { PanelData, PanelRow } from "./aiapi.core"

const INK: any = { light: "#101014", dark: "#f5f5f7" }
const MUTED: any = { light: "#8a8a8e", dark: "#9a9a9e" }
const GREEN = "#30d158"
const AMBER = "#ff9f0a"
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

/* 按实际高度分配行数：带明细的行按 1.55 行计，留出底部余量 */
function fit(rows: PanelRow[]): { shown: PanelRow[]; hidden: number } {
  const budget = Math.max(2.2, (boxHeight() - 42) / 20)
  const shown: PanelRow[] = []
  let used = 0
  for (const row of rows) {
    const cost = row.detail ? 1.55 : 1
    if (used + cost > budget) break
    shown.push(row)
    used += cost
  }
  return { shown, hidden: rows.length - shown.length }
}

function dotColor(row: PanelRow): string {
  if (row.amount) return GREEN
  return BLUE
}

function Row({ row }: { row: PanelRow }) {
  return (
    <HStack alignment="center" spacing={7}>
      <Text font={7} foregroundStyle={dotColor(row) as any}>●</Text>
      <VStack alignment="leading" spacing={0}>
        <Text font={12} fontWeight="semibold" foregroundStyle={INK}>{row.name}</Text>
        {row.detail ? <Text font={9} foregroundStyle={MUTED}>{row.detail}</Text> : null}
      </VStack>
      <Spacer />
      {row.amount ? <Text font={13} fontWeight="semibold" foregroundStyle={INK}>{row.amount}</Text> : null}
    </HStack>
  )
}

function WidgetView({ data, message }: { data: PanelData | null; message: string }) {
  const packed = data ? fit(data.rows) : { shown: [], hidden: 0 }
  return (
    <VStack alignment="leading" spacing={5} padding={{ top: 11, bottom: 11, leading: 14, trailing: 14 }}>
      <HStack alignment="center" spacing={5}>
        <Text font={11} fontWeight="bold" foregroundStyle={INK}>API 中转站</Text>
        <Spacer />
        {data ? <Text font={9} foregroundStyle={MUTED}>{formatClock(data.updatedAt)}</Text> : null}
      </HStack>
      {message ? <Text font={10} foregroundStyle={MUTED}>{message}</Text> : null}
      {packed.shown.map((row) => <Row key={`${row.name}-${row.seq}`} row={row} />)}
      {packed.hidden > 0 ? <Text font={9} foregroundStyle={MUTED}>{`+${packed.hidden} 个上游未显示`}</Text> : null}
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
