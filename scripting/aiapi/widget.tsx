// AI 中转站 · 桌面小组件（数据层与 index.tsx 共用 aiapi.core.ts）
import { HStack, Link, Script, Spacer, Text, VStack, Widget } from "scripting"
import { formatClock, loadPanelSites, readSites, toMessage } from "./aiapi.core"
import type { PanelData, PanelRow } from "./aiapi.core"

const INK: any = { light: "#1c1c1e", dark: "#f2f2f7" }
const MUTED: any = { light: "#8a8a8e", dark: "#9a9a9e" }

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

/* 按实际高度算能放几行：带明细的行按 1.7 行计 */
function fit(rows: PanelRow[]): { shown: PanelRow[]; hidden: number } {
  const budget = Math.max(2.4, (boxHeight() - 46) / 20)
  const shown: PanelRow[] = []
  let used = 0
  for (const row of rows) {
    const cost = row.detail ? 1.7 : 1
    if (used + cost > budget) break
    shown.push(row)
    used += cost
  }
  return { shown, hidden: rows.length - shown.length }
}

function openURL(): string {
  try {
    const api: any = Script as any
    if (api && typeof api.createOpenURLScheme === "function") {
      return api.createOpenURLScheme(api.name || "aiapi")
    }
  } catch (_) {}
  return ""
}

function Row({ row }: { row: PanelRow }) {
  return (
    <HStack alignment="firstTextBaseline" spacing={6}>
      <VStack alignment="leading" spacing={0}>
        <Text font={12} fontWeight="semibold" foregroundStyle={INK}>{row.name}</Text>
        {row.detail ? <Text font={9} foregroundStyle={MUTED}>{row.detail}</Text> : null}
      </VStack>
      <Spacer />
      {row.amount ? <Text font={12} fontWeight="semibold" foregroundStyle={INK}>{row.amount}</Text> : null}
    </HStack>
  )
}

function WidgetView({ data, message }: { data: PanelData | null; message: string }) {
  const packed = data ? fit(data.rows) : { shown: [], hidden: 0 }
  return (
    <VStack alignment="leading" spacing={4} padding={{ top: 10, bottom: 10, leading: 14, trailing: 14 }}>
      <HStack alignment="center" spacing={4}>
        <Text font={11} fontWeight="bold" foregroundStyle={INK}>API 中转站</Text>
        <Spacer />
        {data ? <Text font={9} foregroundStyle={MUTED}>{formatClock(data.updatedAt)}</Text> : null}
      </HStack>
      {message ? <Text font={10} foregroundStyle={MUTED}>{message}</Text> : null}
      {packed.shown.map((row) => <Row key={`${row.name}-${row.seq}`} row={row} />)}
      {packed.hidden > 0 ? <Text font={9} foregroundStyle={MUTED}>{`另有 ${packed.hidden} 项`}</Text> : null}
    </VStack>
  )
}

function present(content: any) {
  const url = openURL()
  if (!url) {
    Widget.present(content)
    return
  }
  try {
    Widget.present(<Link url={url}>{content}</Link>)
  } catch (_) {
    Widget.present(content)
  }
}

async function run() {
  const sites = readSites()
  if (!sites.length) {
    present(<WidgetView data={null} message="未配置：点开添加站点" />)
    return
  }
  try {
    const data = await loadPanelSites(sites)
    present(<WidgetView data={data} message="" />)
  } catch (error) {
    present(<WidgetView data={null} message={`❌ ${toMessage(error)}`} />)
  }
}

run()
