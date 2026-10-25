// AI 中转站 · 桌面小组件（数据层与 index.tsx 共用 aiapi.core.ts）
import { HStack, Link, Script, Spacer, Text, VStack, Widget } from "scripting"
import { formatClock, loadPanelSites, readSites, toMessage } from "./aiapi.core"
import type { PanelData, PanelRow } from "./aiapi.core"

const MUTED = { light: "#6b6b6b", dark: "#a0a0a0" }

/* 3.2.x 的 family 是 small/medium/large，老文档写过 systemSmall，两种都兼容 */
function rowLimit(): number {
  let family = "medium"
  try {
    family = String((Widget as any).family || "medium").toLowerCase()
  } catch (_) {}
  if (family.indexOf("small") >= 0) return 3
  if (family.indexOf("large") >= 0) return 8
  return 5
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
    <HStack spacing={6}>
      <VStack alignment="leading" spacing={0}>
        <Text font={12} fontWeight="semibold">{row.name}</Text>
        {row.detail ? <Text font={9} foregroundStyle={MUTED}>{row.detail}</Text> : null}
      </VStack>
      <Spacer />
      {row.amount ? <Text font={12} fontWeight="medium">{row.amount}</Text> : null}
    </HStack>
  )
}

function Header({ data }: { data: PanelData | null }) {
  return (
    <HStack spacing={4}>
      <Text font={13} fontWeight="bold">API 中转站</Text>
      <Spacer />
      {data ? <Text font={9} foregroundStyle={MUTED}>{formatClock(data.updatedAt)}</Text> : null}
    </HStack>
  )
}

function WidgetView({ data, message }: { data: PanelData | null; message: string }) {
  const limit = rowLimit()
  const rows = data ? data.rows.slice(0, limit) : []
  const hidden = data && data.rows.length > limit ? data.rows.length - limit : 0

  return (
    <VStack alignment="leading" spacing={5} padding={12}>
      <Header data={data} />
      {message ? <Text font={10} foregroundStyle={MUTED}>{message}</Text> : null}
      {rows.map((row) => <Row key={`${row.name}-${row.seq}`} row={row} />)}
      {hidden > 0 ? <Text font={9} foregroundStyle={MUTED}>{`另有 ${hidden} 项`}</Text> : null}
      {data && data.usage.length ? <Text font={9} foregroundStyle={MUTED}>{data.usage[0]}</Text> : null}
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
