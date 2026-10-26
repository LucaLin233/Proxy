// 服务器监控 · 小组件视图（widget.tsx 与 preview.tsx 共用）
// 每个 Lightsail「区域 + 套餐」一行：地区、IP、当月流量 / 配额、占比与进度条；
// Peekabo 单独一行：当月流量 + 到期剩余。行高按可用高度均分，不会全挤在顶部。
import { Button, HStack, Image, Rectangle, Spacer, Text, VStack, Widget, ZStack, gradient } from "scripting"
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

type Row = {
  key: string
  title: string
  note: string
  ratio: number | null
  percent: string
  detail: string
  short: string
  meta: string
  failed: boolean
  error: string
  peekabo: boolean
}

function toneOf(ratio: number | null): { fill: any; ink: any } {
  if (ratio === null) return { fill: GREY_FILL, ink: MUTED }
  if (ratio >= 0.9) return { fill: RED_FILL, ink: { light: "#C4170C", dark: RED } }
  if (ratio >= 0.7) return { fill: AMBER_FILL, ink: { light: "#9A5B00", dark: AMBER } }
  return { fill: GREEN_FILL, ink: { light: "#137A3A", dark: GREEN } }
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
}

function metricsOf(small: boolean, large: boolean): Metrics {
  if (small) {
    return {
      pad: 11, title: 10.5, note: 7, meta: 7.5, percent: 12.5, badge: 17, corner: 5,
      width: 158, height: 158, rowMin: 25, denseH: 20, denseMax: 22, normalMax: 28, barH: 4,
    }
  }
  if (large) {
    return {
      pad: 15, title: 13.5, note: 9, meta: 9.5, percent: 15.5, badge: 24, corner: 7,
      width: 345, height: 345, rowMin: 44, denseH: 20, denseMax: 38, normalMax: 58, barH: 5,
    }
  }
  return {
    pad: 12, title: 12, note: 8.5, meta: 8.5, percent: 13.5, badge: 21, corner: 6,
    width: 329, height: 155, rowMin: 30, denseH: 17, denseMax: 20, normalMax: 34, barH: 4,
  }
}

function Badge({ size }: { size: number }) {
  return (
    <Image
      systemName="server.rack"
      font={size * 0.48}
      foregroundStyle="#FFFFFF"
      frame={{ width: size, height: size }}
      background={{ gradient: ["#FFC46B", "#FF8A00"], startPoint: "top", endPoint: "bottom" }}
      clipShape={{ type: "rect", cornerRadius: size * 0.28 }}
      shadow={{ color: "rgba(255,138,0,0.30)", radius: 4, x: 0, y: 2 }}
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
        fill={{ light: { color: "#1A130A", opacity: 0.08 }, dark: { color: "#FFFFFF", opacity: 0.16 } }}
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

function RowView({ row, small, large, dense, barWidth }: {
  row: Row
  small: boolean
  large: boolean
  dense: boolean
  barWidth: number
}) {
  const m = metricsOf(small, large)
  const tone = toneOf(row.ratio)
  const titleSize = dense ? m.title - 1 : m.title

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
    const percentWidth = large ? 50 : 44
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
          ? <Bar ratio={row.ratio === null ? 0 : row.ratio} width={large ? 44 : 34} height={3.5} tone={tone.fill} muted={row.ratio === null} />
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

  if (large) {
    return (
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: 9999 }}>
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
          ? <Text font={m.note} foregroundStyle={RED} lineLimit={1}>{row.error || "请打开脚本查看原因"}</Text>
          : <Bar ratio={row.ratio === null ? 0 : row.ratio} width={barWidth} height={m.barH} tone={tone.fill} muted={row.ratio === null} />}
        {row.failed
          ? null
          : <Text font={m.meta} monospacedDigit foregroundStyle={SOFT} lineLimit={1}>{metaText}</Text>}
      </VStack>
    )
  }

  return (
    <VStack alignment="leading" spacing={small ? 2 : large ? 4 : 3} frame={{ maxWidth: 9999 }}>
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
        ? <Text font={m.note} foregroundStyle={RED} lineLimit={1}>{row.error || "请打开脚本查看原因"}</Text>
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

function Placeholder({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <VStack spacing={6} alignment="center" frame={{ maxWidth: 9999, maxHeight: 9999 }}>
      <Image systemName={icon} font={24} foregroundStyle={ACCENT} />
      <Text font={10.5} fontWeight="semibold" foregroundStyle={INK}>{title}</Text>
      <Text font={8} foregroundStyle={MUTED}>{hint}</Text>
    </VStack>
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

  const headerH = small ? 23 : large ? 33 : 25
  const available = Math.max(18, boxH - 2 * m.pad - headerH - (small ? 7 : 10))
  const cap = small ? 5 : large ? 7 : 5

  let count = Math.min(visible.length, cap)
  let dense = count * m.rowMin > available
  if (dense) {
    const denseCap = Math.max(1, Math.floor(available / m.denseH))
    count = Math.min(count, denseCap)
  }
  let shown = visible.slice(0, count)
  const peekIndex = visible.findIndex((row) => row.peekabo)
  if (peekIndex >= count && count > 0) {
    shown = visible.slice(0, count - 1).concat(visible[peekIndex])
  }
  const hidden = visible.length - shown.length

  const maxSlot = dense ? m.denseMax : m.normalMax
  const slot = shown.length ? Math.min(maxSlot, available / shown.length) : 0
  const extra = Math.max(0, available - slot * shown.length)
  const barWidth = contentW

  const subtitle = !data
    ? "未连接到服务器"
    : !configured
      ? "未配置"
      : hidden > 0
        ? `${shown.length}/${visible.length} 项`
        : data.groups.length
          ? `${data.groups.length} 组 · ${countInstances(data.groups)} 台`
          : data.peekabo && data.peekabo.ok
            ? "Peekabo"
            : data.errors.length
              ? "取数失败"
              : "暂无数据"

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
        hint={`${visible[0].title}：${visible[0].error || "请打开脚本查看原因"}`}
      />
    )
  } else {
    if (extra > 0.5) {
      body.push(<Rectangle key="top" fill="rgba(0,0,0,0)" frame={{ height: extra / 2, maxWidth: 9999 }} />)
    }
    shown.forEach((row) => {
      body.push(
        <VStack key={row.key} alignment="leading" spacing={0} frame={{ maxWidth: 9999, height: slot }}>
          <RowView row={row} small={small} large={large} dense={dense} barWidth={barWidth} />
        </VStack>
      )
    })
    if (extra > 0.5) {
      body.push(<Rectangle key="bottom" fill="rgba(0,0,0,0)" frame={{ height: extra / 2, maxWidth: 9999 }} />)
    }
  }

  return (
    <ZStack alignment="topLeading" clipped={true} frame={{ maxWidth: 9999, maxHeight: 9999 }}>
      <Rectangle
        fill={{
          light: gradient("linear", {
            colors: ["#FFFCF7", "#FFF2DF"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 },
          }),
          dark: gradient("linear", {
            colors: ["#1B1610", "#0B0907"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 },
          }),
        }}
      />
      <Rectangle
        fill={{
          light: gradient("radial", {
            colors: ["rgba(255,166,64,0.22)", "rgba(255,166,64,0)"],
            center: { x: 0.98, y: -0.04 },
            startRadius: 0,
            endRadius: 200,
          }),
          dark: gradient("radial", {
            colors: ["rgba(255,150,40,0.26)", "rgba(255,150,40,0)"],
            center: { x: 0.98, y: -0.04 },
            startRadius: 0,
            endRadius: 200,
          }),
        }}
      />
      <Rectangle
        fill={{
          light: gradient("radial", {
            colors: ["rgba(90,205,190,0.18)", "rgba(90,205,190,0)"],
            center: { x: 0.02, y: 1.02 },
            startRadius: 0,
            endRadius: 160,
          }),
          dark: gradient("radial", {
            colors: ["rgba(18,200,176,0.16)", "rgba(18,200,176,0)"],
            center: { x: 0.02, y: 1.02 },
            startRadius: 0,
            endRadius: 160,
          }),
        }}
      />

      <VStack
        alignment="leading"
        spacing={0}
        padding={{ top: m.pad, bottom: m.pad, leading: m.pad + 2, trailing: m.pad + 2 }}
        frame={{ maxWidth: 9999, maxHeight: 9999 }}
      >
        <HStack spacing={small ? 4 : large ? 7 : 6} alignment="center" frame={{ maxWidth: 9999 }}>
          <Badge size={m.badge} />
          <VStack alignment="leading" spacing={0}>
            <Text font={small ? 9.5 : large ? 12 : 10.5} fontWeight="bold" foregroundStyle={INK} lineLimit={1}>服务器概览</Text>
            <Text font={small ? 6.5 : large ? 8 : 7.5} foregroundStyle={MUTED} lineLimit={1}>{subtitle}</Text>
          </VStack>
          <Spacer />
          {data && data.errors.length > 0
            ? <HStack spacing={1.5} alignment="center">
                <Image systemName="exclamationmark.triangle.fill" font={7} foregroundStyle={RED} />
                <Text font={7} fontWeight="semibold" foregroundStyle={RED}>{data.errors.length}</Text>
              </HStack>
            : null}
          {data
            ? <Text font={small ? 7 : large ? 9.5 : 8.5} monospacedDigit foregroundStyle={MUTED}>
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

        <Rectangle
          fill={{
            light: gradient("linear", {
              colors: ["rgba(217,119,6,0.28)", "rgba(217,119,6,0.02)"],
              startPoint: "leading",
              endPoint: "trailing",
            }),
            dark: gradient("linear", {
              colors: ["rgba(255,190,110,0.30)", "rgba(255,190,110,0.02)"],
              startPoint: "leading",
              endPoint: "trailing",
            }),
          }}
          frame={{ height: 0.5, maxWidth: 9999 }}
          padding={{ top: small ? 6 : large ? 9 : 7 }}
        />

        {body}
      </VStack>
    </ZStack>
  )
}
