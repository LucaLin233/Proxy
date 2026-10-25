// 中转站看板 · 小组件视图（widget.tsx 与预览共用）
// 每个服务商：名称、余额、近 24h 成功率与首字延迟；CommandCode 显示 5H / W / M 三个限额。
// 行与行之间用弹性间距铺满整个小组件，行数少时也不会全部挤在顶部。
import { Button, HStack, Image, Rectangle, Spacer, Text, VStack, Widget, ZStack, gradient } from "scripting"
import { formatClock, percent } from "./relay.core"
import type { PanelData, Row, RowLimit } from "./relay.core"
import { RelayRefreshIntent } from "./app_intents"

const INK: any = { light: "#0B0B0F", dark: "#F5F5F7" }
const SOFT: any = { light: "#3F3F46", dark: "#D5D5DC" }
const MUTED: any = { light: "#82828C", dark: "#9A9AA6" }
const ICON: any = { light: "#4C9BFF", dark: "#7FB6FF" }
const GREEN = "#30D158"
const AMBER = "#FF9F0A"
const RED = "#FF453A"
const GREY = "#8E8E93"

function ratioTone(ratio: number | null): string[] {
  if (ratio === null) return [GREY, GREY]
  if (ratio <= 0.1) return ["#FF7C6E", RED]
  if (ratio <= 0.3) return ["#FFC15C", AMBER]
  return ["#67E39A", GREEN]
}

function healthTone(rate: number): string {
  if (rate >= 0.95) return GREEN
  if (rate >= 0.85) return AMBER
  return RED
}

function amountTone(row: Row): any {
  const value = row.amount
  if (value !== null && value < 10) return RED
  return INK
}

/* 余额进度条按「还剩多少额度」上色，和限额条保持一致 */
function barTone(row: Row): string[] {
  if (row.ratio === null) return ["#67E39A", GREEN]
  return ratioTone(row.ratio)
}

function displayHeight(family: string): number {
  const large = family.indexOf("large") >= 0
  const expected = large ? 345 : family.indexOf("small") >= 0 ? 158 : 155
  try {
    const value = Number((Widget as any).displaySize && (Widget as any).displaySize.height)
    if (!isFinite(value) || value < 80) return expected
    /* displaySize 偶尔会报出错的高度，按尺寸给一个合理区间 */
    if (large && value < 260) return expected
    if (!large && value > 260) return expected
    return value
  } catch (_) {}
  return expected
}

function Badge({ size }: { size: number }) {
  return (
    <Image
      systemName="chart.line.uptrend.xyaxis"
      font={size * 0.5}
      foregroundStyle="#FFFFFF"
      frame={{ width: size, height: size }}
      background={{ gradient: ["#6BB6FF", "#0A6CF5"], startPoint: "top", endPoint: "bottom" }}
      clipShape={{ type: "rect", cornerRadius: size * 0.28 }}
      shadow={{ color: "rgba(10,108,245,0.32)", radius: 4, x: 0, y: 2 }}
    />
  )
}

/* 限额胶囊：标签 + 迷你进度条 + 百分比；没有比例（不限 / 只给金额）时不画条 */
function LimitPill({ label, ratio, text, small, large, barWidth }: {
  label: string
  ratio: number | null
  text: string
  small: boolean
  large: boolean
  barWidth: number
}) {
  const tones = ratio === null ? null : ratioTone(ratio)
  const tint: any = tones ? tones[1] : GREY
  /* 浅色背景上同色系文字对比度不够，浅色模式用压深的同色 */
  const ink: any = ratio === null
    ? MUTED
    : {
        light: ratio <= 0.1 ? "#C4170C" : ratio <= 0.3 ? "#9A5B00" : "#137A3A",
        dark: tones ? tones[1] : GREY,
      }
  const value = ratio === null ? text : percent(ratio, 0)

  return (
    <HStack
      spacing={small ? 1.5 : 2.5}
      alignment="center"
      padding={{ horizontal: small ? 3.5 : large ? 6 : 4, vertical: small ? 1 : large ? 2.5 : 1.5 }}
      background={{ light: { color: tint, opacity: 0.10 }, dark: { color: tint, opacity: 0.20 } }}
      clipShape={{ type: "capsule", style: "continuous" }}
      fixedSize={{ horizontal: true, vertical: false }}
    >
      <Text font={small ? 6 : large ? 8 : 7} fontWeight="semibold" foregroundStyle={MUTED} lineLimit={1}>{label}</Text>
      {barWidth > 0 && tones
        ? <Bar ratio={ratio as number} width={barWidth} height={small ? 3 : large ? 3.5 : 3} tone={tones} />
        : null}
      <Text
        font={small ? 7.5 : large ? 9.5 : 8.5}
        fontWeight="bold"
        monospacedDigit
        foregroundStyle={ink}
        lineLimit={1}
      >
        {value}
      </Text>
    </HStack>
  )
}

function Limits({ limits, small, large, barWidth }: {
  limits: RowLimit[]
  small: boolean
  large: boolean
  barWidth: number
}) {
  return (
    <HStack spacing={small ? 3 : 4} alignment="center">
      {limits.map((item) => (
        <LimitPill
          key={item.label}
          label={item.label}
          ratio={item.ratio}
          text={item.text}
          small={small}
          large={large}
          barWidth={barWidth}
        />
      ))}
    </HStack>
  )
}

function Bar({ ratio, width, height = 3.5, tone }: {
  ratio: number
  width: number
  height?: number
  tone: any[]
}) {
  const span = Math.max(0, Math.min(1, ratio))
  const filled = Math.max(height + 2, Math.round(width * span))
  return (
    <ZStack alignment="leading" frame={{ width, height }}>
      <Rectangle
        fill={{ light: { color: "#0A0A14", opacity: 0.08 }, dark: { color: "#FFFFFF", opacity: 0.18 } }}
        frame={{ width, height }}
        clipShape={{ type: "capsule", style: "continuous" }}
      />
      <Rectangle
        fill={gradient("linear", { colors: tone, startPoint: "leading", endPoint: "trailing" })}
        frame={{ width: filled, height }}
        clipShape={{ type: "capsule", style: "continuous" }}
      />
    </ZStack>
  )
}

function Health({ row, small }: { row: Row; small: boolean }) {
  return (
    <HStack spacing={3.5} alignment="center">
      <Text font={6.5} fontWeight="medium" foregroundStyle={MUTED}>24h</Text>
      <Text font={5} foregroundStyle={healthTone(row.health as number) as any}>●</Text>
      <Text font={small ? 7.5 : 8.5} fontWeight="medium" monospacedDigit foregroundStyle={SOFT}>
        {percent(row.health as number, 1)}
      </Text>
      {row.ttftMs !== null
        ? <Text font={small ? 7.5 : 8.5} foregroundStyle={MUTED}>·</Text>
        : null}
      {row.ttftMs !== null
        ? <Text font={small ? 7.5 : 8.5} monospacedDigit foregroundStyle={MUTED}>
            {`${(row.ttftMs / 1000).toFixed(1)}s`}
          </Text>
        : null}
    </HStack>
  )
}

function RowView({ row, small, large, dense }: {
  row: Row
  small: boolean
  large: boolean
  dense: boolean
}) {
  const nameSize = small ? 11 : large ? 13.5 : 12
  const amountSize = small ? 12 : large ? 15.5 : 13.5
  const metaSize = small ? 7.5 : large ? 9.5 : 8.5
  const barWidth = small ? 42 : large ? 66 : 56
  const inline = row.metrics.join(" · ")

  /* 紧凑模式单行；其余尺寸限额行也排成两行，给小进度条留出宽度 */
  if (dense) {
    return (
      <HStack spacing={4} alignment="center" frame={{ maxWidth: 9999 }}>
        <Text font={nameSize} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.name}</Text>
        {!row.limits.length && inline
          ? <Text font={small ? 7.5 : 8} foregroundStyle={MUTED} lineLimit={1}>{inline}</Text>
          : null}
        <Spacer />
        {row.failed
          ? <Text font={8} fontWeight="semibold" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
          : null}
        {row.limits.length
          ? <Limits limits={row.limits} small={small} large={large} barWidth={12} />
          : null}
        {row.amountText
          ? <Text
              font={amountSize}
              fontWeight="bold"
              fontDesign="rounded"
              monospacedDigit
              foregroundStyle={amountTone(row)}
              lineLimit={1}
            >
              {row.amountText}
            </Text>
          : null}
      </HStack>
    )
  }

  const showHealth = row.health !== null
  const extra = showHealth || row.limits.length
    ? ""
    : row.metrics.filter((line) => line !== row.amountText).join(" · ")
  const hasBar = row.ratio !== null && row.kind !== "limit"

  return (
    <VStack alignment="leading" spacing={small ? 1 : large ? 3 : 2} frame={{ maxWidth: 9999 }}>
      <HStack spacing={5} alignment="firstTextBaseline" frame={{ maxWidth: 9999 }}>
        <Text font={nameSize} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.name}</Text>
        <Spacer />
        {row.amountText
          ? <Text
              font={amountSize}
              fontWeight="bold"
              fontDesign="rounded"
              monospacedDigit
              foregroundStyle={amountTone(row)}
              lineLimit={1}
            >
              {row.amountText}
            </Text>
          : null}
      </HStack>
      {row.failed || showHealth || extra || row.limits.length || hasBar ? (
        <HStack spacing={5} alignment="center" frame={{ maxWidth: 9999 }}>
          {row.failed
            ? <Text font={metaSize} fontWeight="medium" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
            : showHealth
              ? <Health row={row} small={small} />
              : extra
                ? <Text font={metaSize} foregroundStyle={MUTED} lineLimit={1}>{extra}</Text>
                : hasBar
                  ? <Text font={metaSize} foregroundStyle={MUTED} lineLimit={1}>
                      {`剩余 ${percent(row.ratio as number, 0)}`}
                    </Text>
                  : null}
          {row.limits.length && !small
            ? <Text font={large ? 8 : 7.5} fontWeight="medium" foregroundStyle={MUTED} lineLimit={1}>剩余</Text>
            : null}
          {row.limits.length ? <Limits limits={row.limits} small={small} large={large} barWidth={small ? 0 : large ? 28 : 18} /> : null}
          <Spacer />
          {hasBar ? <Bar ratio={row.ratio as number} width={barWidth} tone={barTone(row)} /> : null}
        </HStack>
      ) : null}
    </VStack>
  )
}

function Placeholder({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <VStack spacing={6} alignment="center" frame={{ maxWidth: 9999, maxHeight: 9999 }}>
      <Image systemName={icon} font={24} foregroundStyle={ICON} />
      <Text font={10.5} fontWeight="semibold" foregroundStyle={INK}>{title}</Text>
      <Text font={8} foregroundStyle={MUTED}>{hint}</Text>
    </VStack>
  )
}

export function PanelWidget({
  data,
  widgetSizeHint,
  message,
  heightOverride,
}: {
  data: PanelData | null
  widgetSizeHint: string
  message?: string
  /* 预览用：强制指定小组件高度，不依赖 Widget.displaySize */
  heightOverride?: number
}) {
  const hint = String(widgetSizeHint === undefined || widgetSizeHint === null ? "" : widgetSizeHint).toLowerCase()
  const small = hint.indexOf("small") >= 0
  const large = hint.indexOf("large") >= 0
  const rows = data ? data.rows : []

  /* 两行放得下就用两行；放不下时压成一行，优先把服务商列全 */
  const pad = small ? 11 : large ? 15 : 12
  const boxHeight = heightOverride && heightOverride > 80 ? heightOverride : displayHeight(hint)
  const available = boxHeight - (small ? 46 : large ? 62 : 56)
  const detailCap = Math.max(1, Math.min(large ? 10 : 4, Math.floor(available / (small ? 25 : large ? 30 : 27))))
  const denseCap = Math.max(1, Math.min(large ? 14 : 7, Math.floor(available / (small ? 17 : large ? 20 : 16))))
  const dense = !small && rows.length > detailCap
  const limit = dense ? denseCap : Math.min(rows.length, detailCap)
  const shown = rows.slice(0, limit)
  const hidden = rows.length - shown.length

  /* 固定行高把内容均匀铺开，行数少时整体居中，不再全部挤在顶部 */
  const maxSlot = dense ? (small ? 18 : large ? 30 : 20) : (small ? 26 : large ? 54 : 30)
  const slot = shown.length ? Math.min(maxSlot, available / shown.length) : 0
  const extra = Math.max(0, available - slot * shown.length)

  const body: any[] = []
  if (message) {
    body.push(<Placeholder key="message" icon="exclamationmark.triangle" title="加载失败" hint={message} />)
  } else if (!rows.length) {
    body.push(<Placeholder key="empty" icon="square.grid.2x2" title="还没有配置站点" hint="打开脚本添加，或从 Surge 导入" />)
  } else {
    if (extra > 0.5) {
      body.push(<Rectangle key="top" fill="rgba(0,0,0,0)" frame={{ height: extra / 2, maxWidth: 9999 }} />)
    }
    shown.forEach((row) => {
      body.push(
        <VStack key={row.key} alignment="leading" spacing={0} frame={{ maxWidth: 9999, height: slot }}>
          <RowView row={row} small={small} large={large} dense={dense} />
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
            colors: ["#FFFFFF", "#EEF4FF"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 },
          }),
          dark: gradient("linear", {
            colors: ["#151A23", "#0B0E13"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 },
          }),
        }}
      />
      <Rectangle
        fill={{
          light: gradient("radial", {
            colors: ["rgba(96,166,255,0.22)", "rgba(96,166,255,0)"],
            center: { x: 0.98, y: -0.04 },
            startRadius: 0,
            endRadius: 200,
          }),
          dark: gradient("radial", {
            colors: ["rgba(56,120,255,0.30)", "rgba(56,120,255,0)"],
            center: { x: 0.98, y: -0.04 },
            startRadius: 0,
            endRadius: 200,
          }),
        }}
      />
      <Rectangle
        fill={{
          light: gradient("radial", {
            colors: ["rgba(120,225,205,0.20)", "rgba(120,225,205,0)"],
            center: { x: 0.02, y: 1.02 },
            startRadius: 0,
            endRadius: 160,
          }),
          dark: gradient("radial", {
            colors: ["rgba(18,200,176,0.18)", "rgba(18,200,176,0)"],
            center: { x: 0.02, y: 1.02 },
            startRadius: 0,
            endRadius: 160,
          }),
        }}
      />

      <VStack
        alignment="leading"
        spacing={0}
        padding={{ top: pad, bottom: pad, leading: pad + 2, trailing: pad + 2 }}
        frame={{ maxWidth: 9999, maxHeight: 9999 }}
      >
        <HStack spacing={6} alignment="center" frame={{ maxWidth: 9999 }}>
          <Badge size={small ? 18 : large ? 24 : 21} />
          <VStack alignment="leading" spacing={0}>
            <Text font={small ? 9.5 : large ? 12 : 10.5} fontWeight="bold" foregroundStyle={INK}>API 中转站</Text>
            <Text font={small ? 6.5 : large ? 8 : 7.5} foregroundStyle={MUTED}>{hidden > 0 ? `${shown.length}/${rows.length} 个服务商` : `${rows.length} 个服务商`}</Text>
          </VStack>
          <Spacer />
          {data && data.errors.length > 0
            ? <HStack spacing={2} alignment="center">
                <Image systemName="exclamationmark.triangle.fill" font={7} foregroundStyle={RED} />
                <Text font={7} fontWeight="semibold" foregroundStyle={RED}>{data.errors.length}</Text>
              </HStack>
            : null}
          {data && data.errors.length === 0 && data.notices.length > 0
            ? <HStack spacing={2} alignment="center">
                <Image systemName="exclamationmark.triangle.fill" font={7} foregroundStyle={AMBER} />
                <Text font={7} fontWeight="semibold" foregroundStyle={AMBER}>{data.notices.length}</Text>
              </HStack>
            : null}
          {data
            ? <Text font={small ? 7.5 : large ? 9.5 : 8.5} monospacedDigit foregroundStyle={MUTED}>
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
          <Button intent={RelayRefreshIntent()} buttonStyle="plain">
            <Image
              systemName="arrow.clockwise"
              font={small ? 8 : large ? 10.5 : 9.5}
              foregroundStyle={ICON}
              frame={{ width: small ? 18 : large ? 22 : 20, height: small ? 18 : large ? 22 : 20 }}
              background={{ light: { color: "#0A84FF", opacity: 0.10 }, dark: { color: "#7FB6FF", opacity: 0.16 } }}
              clipShape={{ type: "capsule", style: "continuous" }}
            />
          </Button>
        </HStack>

        <Rectangle
          fill={{
            light: gradient("linear", {
              colors: ["rgba(10,132,255,0.26)", "rgba(10,132,255,0.02)"],
              startPoint: "leading",
              endPoint: "trailing",
            }),
            dark: gradient("linear", {
              colors: ["rgba(130,190,255,0.30)", "rgba(130,190,255,0.02)"],
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
