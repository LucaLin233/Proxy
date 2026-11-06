// 服务器监控 · 小组件视图（widget.tsx 与 preview.tsx 共用）
// 视觉参考「中转站看板」：暖色渐变底 + 圆角卡片块。
// 中号：单列卡片；大号：最紧张的一项做成通栏主卡，其余按 2 列网格排列；
// 小号：保持紧凑列表，避免 158pt 见方被卡片挤碎。
import { Button, HStack, Image, Rectangle, RoundedRectangle, Spacer, Text, VStack, Widget, ZStack, gradient } from "scripting"
import {
  countInstances,
  formatBytes,
  formatClock,
  formatMonthDay,
  formatPair,
  maskIp,
  percentText,
} from "./core"
import type { Config, ServerData } from "./core"
import { ServerRefreshIntent } from "./app_intents"

const INK: any = { light: "#151210", dark: "#F8F4EE" }
const SOFT: any = { light: "#4B443C", dark: "#D9D2C8" }
const MUTED: any = { light: "#8B8175", dark: "#9E958A" }
const ACCENT: any = { light: "#D97706", dark: "#FFB340" }
const GREEN_FILL: [string, string] = ["#67E39A", "#2FB45A"]
const AMBER_FILL: [string, string] = ["#FFC15C", "#FF9F0A"]
const RED_FILL: [string, string] = ["#FF7C6E", "#FF453A"]
const GREY_FILL: [string, string] = ["#BDB5A8", "#8E8E93"]
const GREEN = "#30D158"
const AMBER = "#FF9F0A"
const RED = "#FF453A"
const GREY = "#8E8E93"

/* 卡片：中性半透明圆角底 + 很轻的纵向渐变，颜色只留给主卡和进度条 */
const CARD_BG: any = {
  light: gradient("linear", {
    colors: ["rgba(38,26,12,0.075)", "rgba(38,26,12,0.032)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
  dark: gradient("linear", {
    colors: ["rgba(255,238,218,0.115)", "rgba(255,238,218,0.052)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
}
/* 卡片描边：一条比背景亮 10% 的细线，深色下把卡从底上“托”起来 */
const CARD_EDGE: any = {
  light: { color: "#2A1C08", opacity: 0.12 },
  dark: { color: "#FFFFFF", opacity: 0.12 },
}
/* Peekabo 是订阅而不是流量组：用底部光斑同色的青绿，和其他卡分开 */
const PEEK_BG: any = {
  light: gradient("linear", {
    colors: ["rgba(22,150,140,0.075)", "rgba(22,150,140,0.028)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
  dark: gradient("linear", {
    colors: ["rgba(30,205,180,0.115)", "rgba(30,205,180,0.045)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
}
/* 主卡：琥珀渐变；占比 ≥ 90% 时换成红色渐变 */
const HERO_BG: any = {
  light: gradient("linear", {
    colors: ["rgba(255,159,10,0.20)", "rgba(255,149,0,0.055)"],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  }),
  dark: gradient("linear", {
    colors: ["rgba(255,159,10,0.24)", "rgba(255,149,0,0.075)"],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  }),
}
const HERO_HOT_BG: any = {
  light: gradient("linear", {
    colors: ["rgba(255,69,58,0.18)", "rgba(255,69,58,0.05)"],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  }),
  dark: gradient("linear", {
    colors: ["rgba(255,69,58,0.25)", "rgba(255,69,58,0.08)"],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  }),
}
const FAIL_BG: any = {
  light: { color: RED, opacity: 0.07 },
  dark: { color: RED, opacity: 0.14 },
}
const TRACK: any = {
  light: { color: "#1A130A", opacity: 0.10 },
  dark: { color: "#FFFFFF", opacity: 0.17 },
}
const CHIP_BG: any = {
  light: { color: "#151210", opacity: 0.065 },
  dark: { color: "#FFFFFF", opacity: 0.12 },
}

type Row = {
  key: string
  title: string
  note: string
  ratio: number | null
  percent: string
  detail: string
  short: string
  meta: string
  /* 大卡第二行补充：地区代码 / 到期信息 */
  sub: string
  failed: boolean
  error: string
  peekabo: boolean
}

function toneOf(ratio: number | null): { fill: any; ink: any } {
  if (ratio === null) return { fill: GREY_FILL, ink: MUTED }
  if (ratio >= 0.9) return { fill: RED_FILL, ink: { light: "#C4170C", dark: "#FF6961" } }
  if (ratio >= 0.7) return { fill: AMBER_FILL, ink: { light: "#9A5B00", dark: "#FFD60A" } }
  return { fill: GREEN_FILL, ink: { light: "#137A3A", dark: "#32D74B" } }
}

function buildRows(data: ServerData | null, config: Config): Row[] {
  if (!data) return []
  const rows: Row[] = []

  data.groups.forEach((group) => {
    const single = group.instances.length === 1 ? group.instances[0] : null
    let note = ""
    if (single) {
      if (single.ip && config.ipMode !== "hide") {
        note = config.ipMode === "mask" ? maskIp(single.ip) : single.ip
      }
    } else {
      note = `${group.instances.length} 台`
    }
    const known = group.quotaBytes > 0
    rows.push({
      key: group.key,
      title: group.regionName,
      note,
      ratio: known ? group.percent : null,
      percent: known ? percentText(group.percent, 1) : "--",
      detail: known ? `${formatBytes(group.usedBytes)} / ${formatBytes(group.quotaBytes)}` : `${formatBytes(group.usedBytes)} / 配额未知`,
      short: formatPair(group.usedBytes, group.quotaBytes),
      meta: config.showToday ? `今日 ${formatBytes(group.todayBytes)}` : "",
      sub: [config.showToday ? `今日 ${formatBytes(group.todayBytes)}` : "", group.region].filter(Boolean).join(" · "),
      failed: false,
      error: "",
      peekabo: false,
    })
  })

  if (data.peekabo) {
    const peekabo = data.peekabo
    if (peekabo.ok) {
      rows.push({
        key: "peekabo",
        title: "Peekabo",
        note: peekabo.daysLeft <= 0 ? "已到期" : `剩 ${peekabo.daysLeft} 天`,
        ratio: peekabo.percent,
        percent: percentText(peekabo.percent, 1),
        detail: `${formatBytes(peekabo.used)} / ${formatBytes(peekabo.total)}`,
        short: formatPair(peekabo.used, peekabo.total),
        meta: `${formatMonthDay(peekabo.expireAt)} 到期`,
        sub: [peekabo.daysLeft <= 0 ? "已到期" : `剩 ${peekabo.daysLeft} 天`, `${formatMonthDay(peekabo.expireAt)} 到期`].join(" · "),
        failed: false,
        error: "",
        peekabo: true,
      })
    } else {
      rows.push({
        key: "peekabo",
        title: "Peekabo",
        note: "",
        ratio: null,
        percent: "--",
        detail: "",
        short: "",
        meta: "",
        sub: "",
        failed: true,
        error: peekabo.error,
        peekabo: true,
      })
    }
  }

  data.errors
    .filter((item) => item.source === "Lightsail")
    .forEach((item) => {
      rows.push({
        key: `error.${item.source}`,
        title: item.source,
        note: "",
        ratio: null,
        percent: "--",
        detail: "",
        short: "",
        meta: "",
        sub: "",
        failed: true,
        error: item.message,
        peekabo: false,
      })
    })

  return rows
}

function estimateWidth(text: string, font: number): number {
  let width = 0
  for (const char of text) {
    width += /[\u3000-\u9fff]/.test(char) ? font : font * 0.6
  }
  return width
}

function displayWidth(small: boolean, large: boolean, expected: number): number {
  try {
    const value = Number((Widget as any).displaySize && (Widget as any).displaySize.width)
    if (!isFinite(value) || value < 100) return expected
    if (small && (value < 130 || value > 220)) return expected
    if (!small && !large && (value < 280 || value > 400)) return expected
    if (large && (value < 300 || value > 430)) return expected
    return value
  } catch (_) {}
  return expected
}

function displayHeight(small: boolean, large: boolean, expected: number): number {
  try {
    const value = Number((Widget as any).displaySize && (Widget as any).displaySize.height)
    if (!isFinite(value) || value < 80) return expected
    if (large && value < 260) return expected
    if (!large && value > 260) return expected
    return value
  } catch (_) {}
  return expected
}

type Metrics = {
  pad: number
  title: number
  note: number
  meta: number
  percent: number
  badge: number
  corner: number
  width: number
  height: number
  rowMin: number
  denseH: number
  denseMax: number
  normalMax: number
  barH: number
  headerH: number
  headerGap: number
}

function metricsOf(small: boolean, large: boolean): Metrics {
  if (small) {
    return {
      pad: 11, title: 10.5, note: 7, meta: 7.5, percent: 12.5, badge: 17, corner: 5,
      width: 158, height: 158, rowMin: 25, denseH: 20, denseMax: 22, normalMax: 28, barH: 4,
      headerH: 23, headerGap: 6,
    }
  }
  if (large) {
    return {
      pad: 14, title: 13.5, note: 9, meta: 9.5, percent: 15.5, badge: 24, corner: 7,
      width: 345, height: 345, rowMin: 44, denseH: 20, denseMax: 38, normalMax: 58, barH: 5,
      headerH: 28, headerGap: 7,
    }
  }
  return {
    pad: 11, title: 12, note: 8.5, meta: 8.5, percent: 13.5, badge: 20, corner: 6,
    width: 329, height: 155, rowMin: 30, denseH: 17, denseMax: 20, normalMax: 34, barH: 4,
    headerH: 22, headerGap: 5,
  }
}

/* 保留 Peekabo：项目多到要截断时丢掉最后一个地区，而不是到期信息 */
function pickRows(rows: Row[], cap: number): Row[] {
  if (rows.length <= cap) return rows.slice()
  const chosen = rows.slice(0, cap)
  const peekIndex = rows.findIndex((row) => row.peekabo)
  if (peekIndex >= cap) chosen[chosen.length - 1] = rows[peekIndex]
  return chosen
}

/* 大号主卡 / 中号高亮卡：只在占比真的偏高时出现，避免每张卡都是橙色 */
function hottest(rows: Row[]): Row | null {
  let best: Row | null = null
  for (const row of rows) {
    if (row.failed || row.ratio === null) continue
    if (!best || row.ratio > (best.ratio as number)) best = row
  }
  if (best && best.ratio !== null && best.ratio < 0.5) return null
  return best
}

function cardBg(row: Row, hot: boolean): any {
  if (row.failed) return FAIL_BG
  /* Peekabo 是订阅，用青绿底和服务商的流量卡分开 */
  if (row.peekabo) return PEEK_BG
  if (!hot) return CARD_BG
  return row.ratio !== null && row.ratio >= 0.9 ? HERO_HOT_BG : HERO_BG
}

/* 卡片边缘的一条细线；深色下让卡片和背景分层 */
function Edge({ radius }: { radius: number }) {
  return (
    <RoundedRectangle
      cornerRadius={radius}
      stroke={{ shapeStyle: CARD_EDGE, strokeStyle: { lineWidth: 0.7 } }}
    />
  )
}

function cardNote(row: Row): string {
  if (row.peekabo || row.failed) return ""
  return row.note
}

function cardDetail(row: Row): string {
  if (row.failed) return ""
  if (row.peekabo) return [row.short, row.note, row.meta].filter(Boolean).join(" · ")
  return [row.short, row.meta].filter(Boolean).join(" · ")
}

function Badge({ size }: { size: number }) {
  return (
    <Image
      systemName="server.rack"
      font={size * 0.48}
      foregroundStyle="#FFFFFF"
      frame={{ width: size, height: size }}
      background={{ gradient: ["#FFD08A", "#FF8A00"], startPoint: "top", endPoint: "bottom" }}
      clipShape={{ type: "rect", cornerRadius: size * 0.29 }}
      shadow={{ color: "rgba(255,138,0,0.32)", radius: 5, x: 0, y: 2 }}
    />
  )
}

function Bar({ ratio, width, height, tone, muted }: {
  ratio: number
  width: number
  height: number
  tone: any
  muted?: boolean
}) {
  const span = Math.max(0, Math.min(1, ratio))
  const filled = muted ? 0 : Math.max(height + 1, Math.round(width * span))
  return (
    <ZStack alignment="leading" frame={{ width, height }}>
      <Rectangle
        fill={TRACK}
        frame={{ width, height }}
        clipShape={{ type: "capsule", style: "continuous" }}
      />
      {filled > 0
        ? <Rectangle
            fill={gradient("linear", { colors: tone, startPoint: "leading", endPoint: "trailing" })}
            frame={{ width: filled, height }}
            clipShape={{ type: "capsule", style: "continuous" }}
          />
        : null}
    </ZStack>
  )
}

/* 小号 / 中号的行内容；大号走下面的 GridCard */
function RowView({ row, small, dense, barWidth }: {
  row: Row
  small: boolean
  dense: boolean
  barWidth: number
}) {
  const m = metricsOf(small, false)
  const tone = toneOf(row.ratio)
  const titleSize = dense ? m.title - (small ? 0 : 1) : m.title

  if (dense && small) {
    return (
      <VStack alignment="leading" spacing={1.5} frame={{ maxWidth: 9999 }}>
        <HStack spacing={4} alignment="center" frame={{ maxWidth: 9999 }}>
          <Text font={m.title} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.title}</Text>
          <Spacer />
          {row.failed
            ? <Text font={m.meta} fontWeight="semibold" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
            : <Text font={m.percent} fontWeight="bold" fontDesign="rounded" monospacedDigit foregroundStyle={tone.ink} lineLimit={1}>
                {row.percent}
              </Text>}
        </HStack>
        {!row.failed
          ? <Bar ratio={row.ratio === null ? 0 : row.ratio} width={barWidth} height={3.5} tone={tone.fill} muted={row.ratio === null} />
          : null}
      </VStack>
    )
  }

  if (dense) {
    const percentWidth = 44
    return (
      <HStack spacing={4} alignment="center" frame={{ maxWidth: 9999 }}>
        <Text font={titleSize} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.title}</Text>
        {row.note
          ? <Text font={m.note} foregroundStyle={MUTED} lineLimit={1}>{row.note}</Text>
          : null}
        {!row.failed && row.short
          ? <Text font={m.meta} monospacedDigit foregroundStyle={SOFT} lineLimit={1}>{`· ${row.short}`}</Text>
          : null}
        <Spacer />
        {row.failed
          ? <Text font={m.meta} fontWeight="semibold" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
          : null}
        {!row.failed
          ? <Bar ratio={row.ratio === null ? 0 : row.ratio} width={34} height={3.5} tone={tone.fill} muted={row.ratio === null} />
          : null}
        {!row.failed
          ? <Text
              font={m.percent - 1.5}
              fontWeight="bold"
              fontDesign="rounded"
              monospacedDigit
              foregroundStyle={tone.ink}
              lineLimit={1}
              frame={{ width: percentWidth, alignment: "trailing" }}
            >
              {row.percent}
            </Text>
          : null}
      </HStack>
    )
  }

  const metaText = row.failed
    ? ""
    : row.detail + (row.meta ? ` · ${row.meta}` : "")
  const textWidth = metaText ? estimateWidth(metaText, m.meta) : 0
  const resolvedBar = small ? barWidth : Math.max(30, barWidth - textWidth - 14)

  return (
    <VStack alignment="leading" spacing={2} frame={{ maxWidth: 9999 }}>
      <HStack spacing={4} alignment="firstTextBaseline" frame={{ maxWidth: 9999 }}>
        <Text font={m.title} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.title}</Text>
        {row.note ? <Text font={m.note} foregroundStyle={MUTED} lineLimit={1}>{row.note}</Text> : null}
        <Spacer />
        {row.failed
          ? <Text font={m.meta} fontWeight="semibold" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
          : <Text font={m.percent} fontWeight="bold" fontDesign="rounded" monospacedDigit foregroundStyle={tone.ink} lineLimit={1}>
              {row.percent}
            </Text>}
      </HStack>

      {row.failed
        ? <Text font={m.note} foregroundStyle={RED} lineLimit={1}>{row.error || "检查配置后刷新"}</Text>
        : <HStack spacing={6} alignment="center" frame={{ maxWidth: 9999 }}>
            <Bar ratio={row.ratio === null ? 0 : row.ratio} width={resolvedBar} height={m.barH} tone={tone.fill} muted={row.ratio === null} />
            <Spacer />
            {!small
              ? <Text font={m.meta} monospacedDigit foregroundStyle={SOFT} lineLimit={1}>{metaText}</Text>
              : null}
          </HStack>}
    </VStack>
  )
}

/* 中号非紧凑卡：标题行 + 通栏进度条 + 详情行，和尺寸更大的卡片保持同一套语言 */
function MediumRichCard({ row, width, height }: { row: Row; width: number; height: number }) {
  const m = metricsOf(false, false)
  const tone = toneOf(row.ratio)
  const tall = height >= 38
  const titleSize = tall ? 12 : 11.5
  const percentSize = tall ? 14 : 13.5
  const barH = tall ? 4 : 3.5
  const detailSize = tall ? 8.5 : 7.5
  const gap = tall ? 2 : 1
  const metaText = row.failed
    ? ""
    : row.detail + (row.meta ? ` · ${row.meta}` : "")

  return (
    <VStack alignment="leading" spacing={gap} frame={{ maxWidth: 9999 }}>
      <HStack spacing={4} alignment="center" frame={{ maxWidth: 9999 }}>
        <Text font={titleSize} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.title}</Text>
        {row.note ? <Text font={m.note} foregroundStyle={MUTED} lineLimit={1}>{row.note}</Text> : null}
        <Spacer />
        {row.failed
          ? <Text font={m.meta} fontWeight="semibold" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
          : <Text font={percentSize} fontWeight="bold" fontDesign="rounded" monospacedDigit foregroundStyle={tone.ink} lineLimit={1}>
              {row.percent}
            </Text>}
      </HStack>

      {row.failed
        ? <Text font={detailSize} foregroundStyle={RED} lineLimit={1}>{row.error || "检查配置后刷新"}</Text>
        : <VStack alignment="leading" spacing={gap} frame={{ maxWidth: 9999 }}>
            <Bar
              ratio={row.ratio === null ? 0 : row.ratio}
              width={width}
              height={barH}
              tone={tone.fill}
              muted={row.ratio === null}
            />
            <Text font={detailSize} monospacedDigit foregroundStyle={SOFT} lineLimit={1}>{metaText}</Text>
          </VStack>}
    </VStack>
  )
}

/* 大号主卡：通栏、琥珀/红色渐变，突出「最紧张」的一项 */
function FocusCard({ row, width, height }: { row: Row; width: number; height: number }) {
  const tone = toneOf(row.ratio)
  const bg = row.ratio !== null && row.ratio >= 0.9 ? HERO_HOT_BG : HERO_BG
  /* 主卡高度随行数变化：字也跟着放大，不能比下面的普通卡还小 */
  const roomy = height >= 84
  const titleSize = roomy ? 18 : 14.5
  const percentSize = roomy ? 32 : height >= 56 ? 22 : 18
  const barH = roomy ? 8 : 6
  const detailSize = roomy ? 10.5 : 9
  const spacing = roomy ? 4 : 3
  const pad = roomy ? 8 : 6

  return (
    <VStack
      alignment="leading"
      spacing={spacing}
      padding={{ horizontal: 10, vertical: pad }}
      frame={{ width, height, alignment: "leading" }}
      background={bg}
      clipShape={{ type: "rect", cornerRadius: 12 }}
      overlay={<Edge radius={12} />}
    >
      <HStack spacing={5} alignment="firstTextBaseline" frame={{ maxWidth: 9999 }}>
        <Text font={titleSize} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.title}</Text>
        {row.note ? <Text font={9} foregroundStyle={MUTED} lineLimit={1}>{row.note}</Text> : null}
        <Spacer />
        <Text
          font={6.5}
          fontWeight="bold"
          foregroundStyle={INK}
          padding={{ horizontal: 4, vertical: 1.5 }}
          background={{ light: { color: "#FFFFFF", opacity: 0.55 }, dark: { color: "#FFFFFF", opacity: 0.13 } }}
          clipShape={{ type: "capsule", style: "continuous" }}
        >
          最紧张
        </Text>
        <Text font={percentSize} fontWeight="bold" fontDesign="rounded" monospacedDigit foregroundStyle={tone.ink} lineLimit={1}>
          {row.percent}
        </Text>
      </HStack>

      <Bar
        ratio={row.ratio === null ? 0 : row.ratio}
        width={width - 20}
        height={barH}
        tone={tone.fill}
        muted={row.ratio === null}
      />

      {roomy
        ? <VStack alignment="leading" spacing={1} frame={{ maxWidth: 9999, alignment: "leading" }}>
            <Text font={detailSize} monospacedDigit foregroundStyle={SOFT} lineLimit={1}>{row.short || row.detail}</Text>
            {row.sub
              ? <Text font={detailSize - 1} foregroundStyle={MUTED} lineLimit={1}>{row.peekabo ? row.meta : row.sub}</Text>
              : null}
          </VStack>
        : <HStack spacing={4} frame={{ maxWidth: 9999 }}>
            <Text font={detailSize} monospacedDigit foregroundStyle={SOFT} lineLimit={1}>{row.detail}</Text>
            <Spacer />
            {row.meta
              ? <Text font={detailSize} foregroundStyle={MUTED} lineLimit={1}>{row.meta}</Text>
              : null}
          </HStack>}
    </VStack>
  )
}

/* 大号网格卡：名称 + 占比 + 进度条 + 已用 / 今日 */
function GridCard({ row, width, height, wide, big, compactFull }: {
  row: Row
  width: number
  height: number
  wide: boolean
  big?: boolean
  /* 两列网格里最后一张被拉成通栏的卡：字号要和旁边两列卡一致，不跟着放大 */
  compactFull?: boolean
}) {
  const tone = toneOf(row.ratio)
  const tall = height >= 60
  /* 大号只有 3–4 项时全宽卡片会拉到 80pt 以上：字号和留白跟着放大；两列窄卡不跟着放大 */
  const roomy = height >= 84 && !!wide && !compactFull
  const titleSize = big ? (roomy ? 17 : tall ? 15 : 13.5) : tall ? 13 : 12
  const noteSize = roomy ? 9.5 : tall ? 8.5 : 7.2
  const percentBase = big ? (roomy ? 30 : tall ? 21 : 15.5) : tall ? 18 : 14.5
  const detailSize = big ? (roomy ? 10 : tall ? 9 : 7.5) : tall ? 8.5 : 7.5
  const barH = big ? (roomy ? 7 : tall ? 6 : 5) : tall ? 5.5 : 4.5
  const padX = wide ? (big ? 10 : 9) : 7
  /* 窄卡上 100.0% 这种长数字会挤掉名称：按可用宽度收一点，再用 fixedSize 防止省略号 */
  const percentFit = (width - 2 * padX - 6) / (Math.max(4, row.percent.length) * 0.62)
  const percentSize = Math.max(11, Math.min(percentBase, percentFit))
  const padY = roomy ? 8 : height >= 64 ? 6 : height >= 52 ? 4 : 3
  const radius = wide ? 11 : 10
  const note = cardNote(row)
  /* 占比文字比 estimateWidth 估的宽（粗体圆角数字），留 1.35 余量；放不下就干脆不显示 IP，避免「34.20…」 */
  const noteFits = !!note && estimateWidth(row.title, titleSize) + estimateWidth(note, noteSize) + 3
    <= width - 2 * padX - estimateWidth(row.percent, percentSize) * 1.35 - 3

  if (row.failed) {
    return (
      <VStack
        alignment="leading"
        spacing={3}
        padding={{ horizontal: padX, vertical: padY }}
        frame={{ width, height, alignment: "leading" }}
        background={FAIL_BG}
        clipShape={{ type: "rect", cornerRadius: radius }}
        overlay={<Edge radius={radius} />}
      >
        <HStack spacing={4} frame={{ maxWidth: 9999 }}>
          <Text font={titleSize} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.title}</Text>
          <Spacer />
          <Text font={noteSize} fontWeight="semibold" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
        </HStack>
        <Text font={detailSize} foregroundStyle={RED} lineLimit={1}>{row.error || "检查配置后刷新"}</Text>
      </VStack>
    )
  }

  return (
    <VStack
      alignment="leading"
      spacing={roomy ? 3 : 2}
      padding={{ horizontal: padX, vertical: padY }}
      frame={{ width, height, alignment: roomy ? "center" : "leading" }}
      background={cardBg(row, false)}
      clipShape={{ type: "rect", cornerRadius: radius }}
      overlay={<Edge radius={radius} />}
    >
      <HStack spacing={3} frame={{ maxWidth: 9999 }}>
        <HStack spacing={3} frame={{ maxWidth: 9999, alignment: "leading" }}>
          <Text
            font={titleSize}
            fontWeight="semibold"
            foregroundStyle={INK}
            lineLimit={1}
            fixedSize={{ horizontal: true, vertical: false }}
          >
            {row.title}
          </Text>
          {noteFits
            ? <Text font={noteSize} foregroundStyle={MUTED} lineLimit={1}>{note}</Text>
            : null}
        </HStack>
        <Text
          font={percentSize}
          fontWeight="bold"
          fontDesign="rounded"
          monospacedDigit
          foregroundStyle={tone.ink}
          lineLimit={1}
          fixedSize={{ horizontal: true, vertical: false }}
        >
          {row.percent}
        </Text>
      </HStack>

      <Bar
        ratio={row.ratio === null ? 0 : row.ratio}
        width={width - 2 * padX}
        height={barH}
        tone={tone.fill}
        muted={row.ratio === null}
      />

      {roomy
        ? <VStack alignment="leading" spacing={1} frame={{ maxWidth: 9999, alignment: "leading" }}>
            <Text font={detailSize} monospacedDigit foregroundStyle={SOFT} lineLimit={1}>{row.short || cardDetail(row)}</Text>
            {row.sub
              ? <Text font={detailSize - 1} foregroundStyle={MUTED} lineLimit={1}>{row.sub}</Text>
              : null}
          </VStack>
        : <Text font={detailSize} monospacedDigit foregroundStyle={SOFT} lineLimit={1}>{cardDetail(row)}</Text>}
    </VStack>
  )
}

function Placeholder({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <VStack spacing={6} alignment="center" frame={{ maxWidth: 9999, maxHeight: 9999 }}>
      <Image systemName={icon} font={24} foregroundStyle={ACCENT} />
      <Text font={10.5} fontWeight="semibold" foregroundStyle={INK}>{title}</Text>
      <Text font={8} foregroundStyle={MUTED}>{hint}</Text>
    </VStack>
  )
}

function Header({ data, chip, compactChip, small, large }: {
  data: ServerData | null
  chip: string
  compactChip: string
  small: boolean
  large: boolean
}) {
  const titleSize = small ? 9 : large ? 12.5 : 11
  const badgeSize = small ? 17 : large ? 24 : 20
  const chipSize = small ? 6 : large ? 8 : 7.5
  const chipText = small ? compactChip : chip

  return (
    <HStack spacing={small ? 3 : large ? 7 : 6} alignment="center" frame={{ maxWidth: 9999 }}>
      <Badge size={badgeSize} />
      {/* 和中转站看板一致：标题与计数并成一行，小号省下的高度留给列表 */}
      <Text font={titleSize} fontWeight="bold" foregroundStyle={INK} lineLimit={1}>服务器概览</Text>
      {chipText
        ? <Text
            font={chipSize}
            fontWeight="medium"
            monospacedDigit
            foregroundStyle={MUTED}
            lineLimit={1}
            padding={{ horizontal: small ? 2.5 : large ? 5 : 4, vertical: small ? 0.5 : large ? 1.5 : 1 }}
            background={CHIP_BG}
            clipShape={{ type: "capsule", style: "continuous" }}
          >
            {chipText}
          </Text>
        : null}
      <Spacer />
      {data && data.errors.length > 0 && !small
        ? <HStack spacing={1.5} alignment="center">
            <Image systemName="exclamationmark.triangle.fill" font={7} foregroundStyle={RED} />
            <Text font={7} fontWeight="semibold" foregroundStyle={RED}>{data.errors.length}</Text>
          </HStack>
        : null}
      {data && !small
        ? <Text font={large ? 9.5 : 8.5} monospacedDigit foregroundStyle={MUTED}>
            {formatClock(data.updatedAt)}
          </Text>
        : null}
      {data && data.fromCache && !small
        ? <Text
            font={6.5}
            fontWeight="semibold"
            foregroundStyle={AMBER}
            padding={{ horizontal: 4, vertical: 1 }}
            background={{ light: { color: AMBER, opacity: 0.12 }, dark: { color: AMBER, opacity: 0.22 } }}
            clipShape={{ type: "capsule", style: "continuous" }}
          >
            缓存
          </Text>
        : null}
      <Button intent={ServerRefreshIntent()} buttonStyle="plain">
        <Image
          systemName="arrow.clockwise"
          font={small ? 7.5 : large ? 10.5 : 9.5}
          foregroundStyle={ACCENT}
          frame={{ width: small ? 17 : large ? 22 : 20, height: small ? 17 : large ? 22 : 20 }}
          background={{ light: { color: "#D97706", opacity: 0.10 }, dark: { color: "#FFB340", opacity: 0.16 } }}
          clipShape={{ type: "capsule", style: "continuous" }}
        />
      </Button>
    </HStack>
  )
}

export function ServerWidget({
  data,
  config,
  widgetSizeHint,
  message,
  heightOverride,
  widthOverride,
}: {
  data: ServerData | null
  config: Config
  widgetSizeHint: string
  message?: string
  /* 预览用：强制指定尺寸，不依赖 Widget.displaySize */
  heightOverride?: number
  widthOverride?: number
}) {
  const hint = String(widgetSizeHint === undefined || widgetSizeHint === null ? "" : widgetSizeHint).toLowerCase()
  const small = hint.indexOf("small") >= 0
  const large = hint.indexOf("large") >= 0
  const m = metricsOf(small, large)

  const boxW = widthOverride && widthOverride > 100 ? widthOverride : displayWidth(small, large, m.width)
  const boxH = heightOverride && heightOverride > 80 ? heightOverride : displayHeight(small, large, m.height)
  const contentW = boxW - 2 * (m.pad + 2)

  const rows = buildRows(data, config)
  const configured = data ? data.configured : false
  const visible = data ? rows.slice(0) : []

  const bodyAvail = Math.max(18, boxH - 2 * m.pad - m.headerH - m.headerGap)
  let shownCount = 0
  const body: any[] = []

  if (message) {
    body.push(<Placeholder key="message" icon="exclamationmark.triangle" title="加载失败" hint={message} />)
  } else if (!data || !configured) {
    body.push(<Placeholder key="empty" icon="server.rack" title="还没有配置服务器" hint="打开脚本填写 AWS / Peekabo" />)
  } else if (!visible.length) {
    body.push(<Placeholder key="none" icon="checkmark.shield" title="暂无服务器数据" hint="打开脚本点刷新" />)
  } else if (visible.length === 1 && visible[0].failed) {
    body.push(
      <Placeholder
        key="failed"
        icon="exclamationmark.triangle"
        title="取数失败"
        hint={`${visible[0].title}：${visible[0].error || "检查配置后刷新"}`}
      />
    )
  } else if (small) {
    /* ── 小号：紧凑列表，不用卡片 ── */
    let count = Math.min(visible.length, 5)
    let dense = count * m.rowMin > bodyAvail
    if (dense) {
      const denseCap = Math.max(1, Math.floor(bodyAvail / m.denseH))
      count = Math.min(count, denseCap)
    }
    const shown = pickRows(visible, count)
    shownCount = shown.length

    const slot = shown.length
      ? Math.min(dense ? m.denseMax : m.normalMax, bodyAvail / shown.length)
      : 0
    const extra = Math.max(0, bodyAvail - slot * shown.length)
    if (extra > 0.5) {
      body.push(<Rectangle key="top" fill="rgba(0,0,0,0)" frame={{ height: extra / 2, maxWidth: 9999 }} />)
    }
    shown.forEach((row) => {
      body.push(
        <VStack key={row.key} alignment="leading" spacing={0} frame={{ maxWidth: 9999, height: slot }}>
          <RowView row={row} small={true} dense={dense} barWidth={contentW} />
        </VStack>
      )
    })
    if (extra > 0.5) {
      body.push(<Rectangle key="bottom" fill="rgba(0,0,0,0)" frame={{ height: extra / 2, maxWidth: 9999 }} />)
    }
  } else if (large) {
    /* ── 大号：最紧张的一项做通栏主卡，其余 2 列网格 ── */
    const picked = pickRows(visible, 9)
    const hot = hottest(picked)
    const rest = hot ? picked.filter((row) => row.key !== hot.key) : picked
    const gapY = 6
    /* 主卡只比普通卡高一点：按行数均分高度，避免主卡 62、其余卡 100 的落差 */
    const heroH = hot
      ? (rest.length === 0
        ? Math.min(96, bodyAvail)
        : Math.min(96, Math.max(58, Math.round(((bodyAvail - gapY * rest.length) / (rest.length + 1)) * 1.12))))
      : 0
    const gridAvail = Math.max(0, bodyAvail - (heroH ? heroH + gapY : 0))
    const wideMode = rest.length > 0 && rest.length <= 4
    const cols = wideMode ? 1 : 2
    const gapX = 6
    const cellW = (contentW - gapX) / 2
    let rowCount = Math.ceil(rest.length / cols)
    /* 卡高不再封在 72：3 项时直接拉满，不留底部空白 */
    const maxCell = wideMode ? 122 : 92
    let cellH = rowCount > 0
      ? Math.min(maxCell, (gridAvail - (rowCount - 1) * gapY) / rowCount)
      : 0
    let shownRest = rest
    if (rowCount > 0 && cellH < 46) {
      rowCount = Math.max(1, Math.floor((gridAvail + gapY) / (46 + gapY)))
      shownRest = pickRows(rest, rowCount * cols)
      cellH = Math.min(maxCell, (gridAvail - (rowCount - 1) * gapY) / rowCount)
    }
    shownCount = (hot ? 1 : 0) + shownRest.length

    const cards: any[] = []
    if (wideMode) {
      shownRest.forEach((row) => {
        cards.push(<GridCard key={row.key} row={row} width={contentW} height={cellH} wide={true} big={true} />)
      })
    } else {
      for (let i = 0; i < shownRest.length; i += 2) {
        const pair = shownRest.slice(i, i + 2)
        if (pair.length === 1) {
          cards.push(<GridCard key={pair[0].key} row={pair[0]} width={contentW} height={cellH} wide={true} compactFull={true} />)
        } else {
          cards.push(
            <HStack key={`g${i}`} spacing={gapX} alignment="top" frame={{ maxWidth: 9999 }}>
              {pair.map((row) => (
                <GridCard key={row.key} row={row} width={cellW} height={cellH} wide={false} />
              ))}
            </HStack>
          )
        }
      }
    }

    const gridH = cards.length ? rowCount * cellH + Math.max(0, rowCount - 1) * gapY : 0
    const used = heroH + (heroH && gridH ? gapY : 0) + gridH
    const slack = Math.max(0, bodyAvail - used)
    if (slack > 0.5) {
      body.push(<Rectangle key="padTop" fill="rgba(0,0,0,0)" frame={{ height: slack * 0.5, maxWidth: 9999 }} />)
    }
    if (hot && heroH) {
      body.push(<FocusCard key="hero" row={hot} width={contentW} height={heroH} />)
    }
    if (hot && heroH && gridH) {
      body.push(<Rectangle key="heroGap" fill="rgba(0,0,0,0)" frame={{ height: gapY, maxWidth: 9999 }} />)
    }
    if (cards.length) {
      body.push(
        <VStack key="grid" alignment="leading" spacing={gapY} frame={{ maxWidth: 9999 }}>
          {cards}
        </VStack>
      )
    }
    if (slack > 0.5) {
      body.push(<Rectangle key="padBottom" fill="rgba(0,0,0,0)" frame={{ height: slack * 0.5, maxWidth: 9999 }} />)
    }
  } else {
    /* ── 中号：单列卡片，行高按数量自适应 ── */
    const picked = pickRows(visible, 5)
    const gap = 2.5
    const slot = Math.min(44, (bodyAvail - (picked.length - 1) * gap) / picked.length)
    const dense = slot < 29
    const hot = hottest(picked)
    const padX = 9
    shownCount = picked.length

    const extra = Math.max(0, bodyAvail - slot * picked.length - (picked.length - 1) * gap)
    if (extra > 0.5) {
      body.push(<Rectangle key="top" fill="rgba(0,0,0,0)" frame={{ height: extra / 2, maxWidth: 9999 }} />)
    }
    picked.forEach((row) => {
      body.push(
        <VStack
          key={row.key}
          alignment="leading"
          padding={{ horizontal: padX }}
          frame={{ maxWidth: 9999, height: slot }}
          background={cardBg(row, !!hot && hot.key === row.key)}
          clipShape={{ type: "rect", cornerRadius: 10 }}
          overlay={<Edge radius={10} />}
        >
          {dense || row.failed
            ? <RowView row={row} small={false} dense={dense} barWidth={contentW - 2 * padX} />
            : <MediumRichCard row={row} width={contentW - 2 * padX} height={slot} />}
        </VStack>
      )
      body.push(<Rectangle key={`gap.${row.key}`} fill="rgba(0,0,0,0)" frame={{ height: gap, maxWidth: 9999 }} />)
    })
    if (picked.length) body.pop()
    if (extra > 0.5) {
      body.push(<Rectangle key="bottom" fill="rgba(0,0,0,0)" frame={{ height: extra / 2, maxWidth: 9999 }} />)
    }
  }

  const summary = !data
    ? "未连接"
    : !configured
      ? "未配置"
      : shownCount > 0 && shownCount < visible.length
        ? `${shownCount}/${visible.length} 项`
        : data.groups.length
          ? `${data.groups.length} 组 · ${countInstances(data.groups)} 台`
          : data.peekabo && data.peekabo.ok
            ? "Peekabo"
            : data.errors.length
              ? "取数失败"
              : "暂无数据"

  return (
    <ZStack alignment="topLeading" clipped={true} frame={{ maxWidth: 9999, maxHeight: 9999 }}>
      <Rectangle
        fill={{
          light: gradient("linear", {
            colors: ["#FFFDFB", "#FFF2E2"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 },
          }),
          dark: gradient("linear", {
            colors: ["#1D1712", "#0A0705"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 },
          }),
        }}
      />
      <Rectangle
        fill={{
          light: gradient("radial", {
            colors: ["rgba(255,166,64,0.24)", "rgba(255,166,64,0)"],
            center: { x: 0.98, y: -0.04 },
            startRadius: 0,
            endRadius: 205,
          }),
          dark: gradient("radial", {
            colors: ["rgba(255,150,40,0.29)", "rgba(255,150,40,0)"],
            center: { x: 0.98, y: -0.04 },
            startRadius: 0,
            endRadius: 205,
          }),
        }}
      />
      <Rectangle
        fill={{
          light: gradient("radial", {
            colors: ["rgba(90,205,190,0.18)", "rgba(90,205,190,0)"],
            center: { x: 0.02, y: 1.02 },
            startRadius: 0,
            endRadius: 165,
          }),
          dark: gradient("radial", {
            colors: ["rgba(18,200,176,0.17)", "rgba(18,200,176,0)"],
            center: { x: 0.02, y: 1.02 },
            startRadius: 0,
            endRadius: 165,
          }),
        }}
      />

      <VStack
        alignment="leading"
        spacing={0}
        padding={{ top: m.pad, bottom: m.pad, leading: m.pad + 2, trailing: m.pad + 2 }}
        frame={{ maxWidth: 9999, maxHeight: 9999 }}
      >
        <Header
          data={data}
          chip={summary}
          compactChip={!data
            ? "—"
            : !configured
              ? "未配置"
              : shownCount > 0 && shownCount < visible.length
                ? `${shownCount}/${visible.length}`
                : data.groups.length
                  ? `${data.groups.length}组·${countInstances(data.groups)}台`
                  : data.peekabo && data.peekabo.ok
                    ? "Peekabo"
                    : data.errors.length
                      ? "失败"
                      : "—"}
          small={small}
          large={large}
        />

        <Rectangle fill="rgba(0,0,0,0)" frame={{ height: m.headerGap, maxWidth: 9999 }} />

        {body}
      </VStack>
    </ZStack>
  )
}
