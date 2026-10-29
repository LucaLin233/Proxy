// 仅供本地预览排版：scripting-ts preview_ui preview.tsx --props '{"variant":"medium"}'
import { VStack } from "scripting"
import { PanelWidget } from "./views"
import type { PanelData, Row } from "./relay.core"

function row(patch: Partial<Row> & { key: string; name: string }): Row {
  return {
    site: "CCHP",
    amount: null,
    currency: "USD",
    amountText: "",
    metrics: [],
    detail: "",
    ratio: null,
    health: null,
    ttftMs: null,
    limits: [],
    priority: null,
    seq: 0,
    kind: "balance",
    failed: false,
    ...patch,
  }
}

const commandCode = row({
  key: "cc",
  name: "CommandCode",
  site: "CommandCode",
  kind: "limit",
  limits: [
    { label: "5H", ratio: 0.95, text: "95%" },
    { label: "W", ratio: 0.66, text: "66%" },
    { label: "M", ratio: 0.83, text: "83%" },
  ],
})

const clouder = row({ key: "clouder", name: "Clouder", site: "Clouder", amountText: "$116.70", amount: 116.7, health: 1, ttftMs: 4019 })
const kcne = row({ key: "kcne", name: "Kcne", amountText: "$18.82", amount: 18.82, health: 1, ttftMs: 14200 })
const air = row({ key: "air", name: "Air", amountText: "$2.41", amount: 2.41, health: 0.982, ttftMs: 3100 })
const mirror = row({ key: "mirror", name: "AICodeMirror", amountText: "$8.20", amount: 8.2, health: 0.962, ttftMs: 4800 })
const packy = row({ key: "packy", name: "PackyCode", amountText: "$25.00", amount: 25, health: 0.74, ttftMs: 9200 })
const testRelay = row({ key: "test", name: "TestRelay", failed: true, site: "" })
const miapi = row({ key: "miapi", name: "Miapi", amountText: "$42.50", amount: 42.5, health: 0.998, ttftMs: 2100 })

const five: Row[] = [commandCode, clouder, kcne, air]
const nine: Row[] = [commandCode, clouder, kcne, air, mirror, packy, testRelay, miapi]
const twelve: Row[] = nine.concat([
  row({ key: "x1", name: "Nova", amountText: "$6.30", amount: 6.3, health: 0.91, ttftMs: 5200 }),
  row({ key: "x2", name: "Orbit", amountText: "$33.10", amount: 33.1, health: 0.99, ttftMs: 1900 }),
  row({ key: "x3", name: "Halo", amountText: "$12.00", amount: 12, health: 0.88, ttftMs: 7300 }),
])

function data(list: Row[]): PanelData {
  return { rows: list, usage: [], notices: [], errors: [], updatedAt: Date.now(), elapsedMs: 0, fromCache: false }
}

function Card({ width, height, children }: { width: number; height: number; children: any }) {
  return (
    <VStack frame={{ width, height }} clipShape={{ type: "rect", cornerRadius: 22 }}>
      {children}
    </VStack>
  )
}

export default function Preview(props: { variant?: string }) {
  const variant = props.variant || "medium"
  return (
    <VStack spacing={12} padding={12} background="#000000">
      {variant === "medium" ? (
        <VStack spacing={12}>
          <Card width={340} height={185}>
            <PanelWidget data={data(five)} widgetSizeHint="systemMedium" heightOverride={185} widthOverride={340} />
          </Card>
          <Card width={340} height={185}>
            <PanelWidget data={data(nine)} widgetSizeHint="systemMedium" heightOverride={185} widthOverride={340} />
          </Card>
        </VStack>
      ) : null}
      {variant === "medium158" ? (
        <VStack spacing={12}>
          <Card width={338} height={158}>
            <PanelWidget data={data(five)} widgetSizeHint="systemMedium" heightOverride={158} widthOverride={338} />
          </Card>
          <Card width={338} height={158}>
            <PanelWidget data={data(nine)} widgetSizeHint="systemMedium" heightOverride={158} widthOverride={338} />
          </Card>
        </VStack>
      ) : null}
      {variant === "large" ? (
        <VStack spacing={12}>
          <Card width={340} height={340}>
            <PanelWidget data={data(five)} widgetSizeHint="systemLarge" heightOverride={340} widthOverride={340} />
          </Card>
          <Card width={340} height={340}>
            <PanelWidget data={data(twelve)} widgetSizeHint="systemLarge" heightOverride={340} widthOverride={340} />
          </Card>
        </VStack>
      ) : null}
      {variant === "small" ? (
        <Card width={158} height={158}>
          <PanelWidget data={data(five)} widgetSizeHint="systemSmall" heightOverride={158} widthOverride={158} />
        </Card>
      ) : null}
    </VStack>
  )
}
