// 中转站看板 · 小组件视图（widget.tsx 与预览共用）
// 中号 / 大号：CommandCode 排成一张通栏限额卡（5H / W / M 长进度条），
// 其余服务商排成两列卡片网格；小号仍保持单列紧凑列表。
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

/* 卡片 / 限额卡的底色与进度条轨道 */
const CARD_BG: any = {
  light: gradient("linear", {
    colors: ["rgba(10,10,20,0.065)", "rgba(10,10,20,0.035)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
  dark: gradient("linear", {
    colors: ["rgba(255,255,255,0.085)", "rgba(255,255,255,0.045)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
}
const HERO_BG: any = {
  light: gradient("linear", {
    colors: ["rgba(10,132,255,0.11)", "rgba(10,132,255,0.045)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
  dark: gradient("linear", {
    colors: ["rgba(127,182,255,0.17)", "rgba(127,182,255,0.075)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
}
const FAIL_BG: any = {
  light: { color: "#FF453A", opacity: 0.07 },
  dark: { color: "#FF453A", opacity: 0.13 },
}
const TRACK: any = {
  light: { color: "#0A0A14", opacity: 0.09 },
  dark: { color: "#FFFFFF", opacity: 0.18 },
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

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

function limitText(item: RowLimit): string {
  return item.ratio === null ? item.text : percent(item.ratio, 0)
}

function limitInk(item: RowLimit): any {
  if (item.ratio === null) return MUTED
  if (item.ratio <= 0.1) return { light: "#C4170C", dark: "#FF6961" }
  if (item.ratio <= 0.3) return { light: "#9A5B00", dark: "#FFD60A" }
  return { light: "#137A3A", dark: "#32D74B" }
}

function limitsSummary(row: Row): string {
  return row.limits.map((item) => `${item.label} ${limitText(item)}`).join(" · ")
}

/* displaySize 偶尔会报出屏幕尺寸或 0，宽高一起校验，异常时退回按尺寸估算 */
function boxSize(family: string, widthOverride?: number, heightOverride?: number): { width: number; height: number } {
  const small = family.indexOf("small") >= 0
  const large = family.indexOf("large") >= 0
  let width = small ? 158 : 340
  let height = large ? 345 : small ? 158 : 170
  try {
    const size: any = (Widget as any).displaySize
    const w = Number(size && size.width)
    const h = Number(size && size.height)
    const okW = isFinite(w) && w >= (small ? 120 : 240) && w <= (small ? 230 : 440)
    const okH = isFinite(h) && h >= 120 && h <= (large ? 440 : small ? 230 : 300)
    if (okW && okH) {
      width = w
      height = h
    }
  } catch (_) {}
  if (widthOverride && widthOverride > 80) width = widthOverride
  if (heightOverride && heightOverride > 80) height = heightOverride
  return { width, height }
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

function Bar({ ratio, width, height = 4, tone }: {
  ratio: number | null
  width: number
  height?: number
  tone: any[]
}) {
  const span = ratio === null ? 0 : clamp01(ratio)
  const filled = ratio === null ? 0 : Math.max(height + 2, Math.round(width * span))
  return (
    <ZStack alignment="leading" frame={{ width, height }}>
      <Rectangle
        fill={TRACK}
        frame={{ width, height }}
        clipShape={{ type: "capsule", style: "continuous" }}
      />
      {ratio === null
        ? null
        : <Rectangle
            fill={gradient("linear", { colors: tone, startPoint: "leading", endPoint: "trailing" })}
            frame={{ width: filled, height }}
            clipShape={{ type: "capsule", style: "continuous" }}
          />}
    </ZStack>
  )
}

/* 小号用的限额胶囊：标签 + 迷你进度条 + 百分比 */
function LimitPill({ label, ratio, text, small }: {
  label: string
  ratio: number | null
  text: string
  small: boolean
}) {
  const tones = ratio === null ? null : ratioTone(ratio)
  const tint: any = tones ? tones[1] : GREY
  const ink: any = ratio === null
    ? MUTED
    : {
        light: ratio <= 0.1 ? "#C4170C" : ratio <= 0.3 ? "#9A5B00" : "#137A3A",
        dark: tones ? tones[1] : GREY,
      }
  return (
    <HStack
      spacing={2}
      alignment="center"
      padding={{ horizontal: small ? 3 : 4, vertical: 1.5 }}
      background={{ light: { color: tint, opacity: 0.10 }, dark: { color: tint, opacity: 0.20 } }}
      clipShape={{ type: "capsule", style: "continuous" }}
      fixedSize={{ horizontal: true, vertical: false }}
    >
      <Text font={small ? 6 : 7} fontWeight="semibold" foregroundStyle={MUTED} lineLimit={1}>{label}</Text>
      {ratio === null || small
        ? null
        : <Bar ratio={ratio} width={14} height={3} tone={tones as string[]} />}
      <Text font={small ? 7.5 : 8.5} fontWeight="bold" monospacedDigit foregroundStyle={ink} lineLimit={1}>
        {ratio === null ? text : percent(ratio, 0)}
      </Text>
    </HStack>
  )
}

function Limits({ limits, small }: { limits: RowLimit[]; small: boolean }) {
  return (
    <HStack spacing={small ? 3 : 4} alignment="center">
      {limits.map((item) => (
        <LimitPill key={item.label} label={item.label} ratio={item.ratio} text={item.text} small={small} />
      ))}
    </HStack>
  )
}

function Health({ row, small }: { row: Row; small: boolean }) {
  return (
    <HStack spacing={3} alignment="center">
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

/* 小号：单列两行 */
function SmallRow({ row }: { row: Row }) {
  const nameSize = 11
  const amountSize = 13
  const metaSize = 7.5

  return (
    <VStack alignment="leading" spacing={1} frame={{ maxWidth: 9999 }}>
      <HStack spacing={4} alignment="firstTextBaseline" frame={{ maxWidth: 9999 }}>
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
      <HStack spacing={4} alignment="center" frame={{ maxWidth: 9999 }}>
        {row.failed
          ? <Text font={metaSize} fontWeight="medium" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
          : row.health !== null
            ? <Health row={row} small={true} />
            : row.limits.length
              ? <Limits limits={row.limits} small={true} />
              : <Text font={metaSize} foregroundStyle={MUTED} lineLimit={1}>
                  {row.metrics.filter((line) => line !== row.amountText).join(" · ") || row.site || "—"}
                </Text>}
        <Spacer />
        {row.limits.length && row.health !== null ? <Limits limits={row.limits} small={true} /> : null}
      </HStack>
    </VStack>
  )
}

/* CommandCode 限额卡：左侧名称，右侧三条通栏进度条 */
function LimitsHero({ row, width, large }: { row: Row; width: number; large: boolean }) {
  const padX = large ? 8 : 7
  const padY = large ? 5 : 3
  const nameW = large ? 96 : 88
  const labelW = 17
  const valueW = 31
  const gap = 5
  const barW = Math.max(40, width - padX * 2 - nameW - labelW - valueW - gap * 3)

  return (
    <HStack
      spacing={0}
      alignment="center"
      padding={{ horizontal: padX, vertical: padY }}
      frame={{ maxWidth: 9999 }}
      background={HERO_BG}
      clipShape={{ type: "rect", cornerRadius: 10 }}
    >
      <VStack alignment="leading" spacing={1} frame={{ width: nameW }} offset={{ x: 0, y: -1.5 }}>
        <Text
          font={large ? 12 : 10.5}
          fontWeight="semibold"
          foregroundStyle={INK}
          lineLimit={1}
        >
          {row.name}
        </Text>
        <Text font={large ? 7.5 : 6.5} foregroundStyle={MUTED} lineLimit={1}>剩余额度</Text>
      </VStack>
      <VStack alignment="leading" spacing={large ? 3.5 : 2} frame={{ maxWidth: 9999 }}>
        {row.limits.map((item) => (
          <HStack key={item.label} spacing={gap} alignment="center">
            <Text
              font={large ? 8.5 : 7.5}
              fontWeight="semibold"
              foregroundStyle={MUTED}
              frame={{ width: labelW }}
              lineLimit={1}
            >
              {item.label}
            </Text>
            <Bar
              ratio={item.ratio}
              width={barW}
              height={large ? 5.5 : 5}
              tone={ratioTone(item.ratio)}
            />
            <Text
              font={large ? 9.5 : 8.5}
              fontWeight="bold"
              monospacedDigit
              foregroundStyle={limitInk(item)}
              frame={{ width: valueW, alignment: "trailing" }}
              lineLimit={1}
            >
              {limitText(item)}
            </Text>
          </HStack>
        ))}
      </VStack>
    </HStack>
  )
}

/* 服务商卡片：名称 + 余额一行，第二行健康度 / 限额；余额字号随卡片高度放大 */
function ProviderCard({ row, width, height, rich }: {
  row: Row
  width: number
  height: number
  rich: boolean
}) {
  const tall = height >= 58
  const wide = width >= 250
  const nameSize = wide ? (tall ? 15 : height >= 48 ? 13.5 : height >= 38 ? 12 : 11) : 9.5
  /* 宽卡（大号单列）让金额占满右半边；窄的两列卡要和左侧名称 + 成功率共存于 ~146pt，
     按文字长度略降一号，保证名称和成功率都不被截断 */
  const narrowAmountBase = Math.min(20.5, Math.max(19, height * 0.5))
  const amountSize = wide
    ? Math.min(38, Math.max(22, height * 0.7))
    : narrowAmountBase - (row.amountText.length >= 8 ? 1.5 : 0)
  const metaSize = tall ? 9.5 : height >= 38 ? 8.5 : 7.5
  const padY = tall ? 3 : height >= 38 ? 2 : 1.5
  const bg = row.failed ? FAIL_BG : CARD_BG
  const radius = 10

  if (!rich) {
    return (
      <HStack
        spacing={2}
        alignment="center"
        padding={{ horizontal: 6 }}
        frame={{ width, height, alignment: "leading" }}
        background={bg}
        clipShape={{ type: "rect", cornerRadius: radius }}
      >
        <Text font={10} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.name}</Text>
        {row.health !== null
          ? <Text font={5.5} foregroundStyle={healthTone(row.health) as any}>●</Text>
          : null}
        {row.health !== null && row.name.length <= 8
          ? <Text font={7.5} monospacedDigit foregroundStyle={MUTED} lineLimit={1}>
              {percent(row.health, 0)}
            </Text>
          : null}
        <Spacer />
        {row.failed
          ? <Text font={7.5} fontWeight="semibold" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
          : row.amountText
            ? <Text
                font={12.5}
                fontWeight="bold"
                fontDesign="rounded"
                monospacedDigit
                foregroundStyle={amountTone(row)}
                lineLimit={1}
                fixedSize={{ horizontal: true, vertical: false }}
              >
                {row.amountText}
              </Text>
            : <Text font={7.5} foregroundStyle={MUTED} lineLimit={1}>限额</Text>}
      </HStack>
    )
  }

  const siteLabel = row.site && row.site.trim().toLowerCase() !== row.name.trim().toLowerCase() ? row.site : ""
  const meta: any = row.failed
    ? <Text font={metaSize} fontWeight="medium" foregroundStyle={RED} lineLimit={1}>取数失败</Text>
    : row.health !== null
      ? <HStack spacing={2.5} alignment="center">
          <Text font={metaSize * 0.62} foregroundStyle={healthTone(row.health) as any}>●</Text>
          <Text font={metaSize} fontWeight="medium" monospacedDigit foregroundStyle={SOFT}>
            {percent(row.health, 1)}
          </Text>
          {row.ttftMs !== null
            ? <Text font={metaSize} monospacedDigit foregroundStyle={MUTED}>
                {`· ${(row.ttftMs / 1000).toFixed(1)}s`}
              </Text>
            : null}
        </HStack>
      : row.limits.length
        ? <Text font={metaSize - 0.5} fontWeight="medium" foregroundStyle={MUTED} lineLimit={1}>
            {limitsSummary(row)}
          </Text>
        : siteLabel
          ? <Text font={metaSize} foregroundStyle={MUTED} lineLimit={1}>{siteLabel}</Text>
          : null

  if (wide) {
    return (
      <HStack
        spacing={6}
        alignment="center"
        padding={{ horizontal: 7, vertical: padY }}
        frame={{ width, height, alignment: "leading" }}
        background={bg}
        clipShape={{ type: "rect", cornerRadius: radius }}
      >
        <VStack
          alignment="leading"
          spacing={tall ? 3 : height >= 38 ? 2 : 1.5}
          offset={{ x: 0, y: -1.5 }}
        >
          <Text font={nameSize} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.name}</Text>
          {meta}
        </VStack>
        <Spacer />
        {row.amountText
          ? <Text
              font={amountSize}
              fontWeight="bold"
              fontDesign="rounded"
              monospacedDigit
              foregroundStyle={amountTone(row)}
              lineLimit={1}
              fixedSize={{ horizontal: true, vertical: false }}
            >
              {row.amountText}
            </Text>
          : null}
      </HStack>
    )
  }

  /* 窄卡：左列名称 + 成功率·响应时间，右侧大金额，两边各自垂直居中 */
  const narrowMeta: any = row.failed || row.health === null
    ? meta
    : <HStack spacing={1.5} alignment="center">
        <Text font={metaSize * 0.55} foregroundStyle={healthTone(row.health) as any}>●</Text>
        <Text font={metaSize} fontWeight="medium" monospacedDigit foregroundStyle={SOFT} lineLimit={1}>
          {row.health >= 0.9999 ? "100%" : percent(row.health, 1)}
        </Text>
        {row.ttftMs !== null
          ? <Text font={metaSize - 1} monospacedDigit foregroundStyle={MUTED} lineLimit={1}>
              {`· ${(row.ttftMs / 1000).toFixed(1)}s`}
            </Text>
          : null}
      </HStack>

  return (
    <HStack
      spacing={2.5}
      alignment="center"
      padding={{ horizontal: 3.5 }}
      frame={{ width, height, alignment: "leading" }}
      background={bg}
      clipShape={{ type: "rect", cornerRadius: radius }}
    >
      <VStack alignment="leading" spacing={height >= 38 ? 2 : 0.5} frame={{ maxWidth: 9999 }}>
        <Text font={nameSize} fontWeight="semibold" foregroundStyle={INK} lineLimit={1}>{row.name}</Text>
        {narrowMeta}
      </VStack>
      {row.amountText
        ? <Text
            font={amountSize}
            fontWeight="bold"
            fontDesign="rounded"
            monospacedDigit
            foregroundStyle={amountTone(row)}
            lineLimit={1}
            fixedSize={{ horizontal: true, vertical: false }}
          >
            {row.amountText}
          </Text>
        : null}
    </HStack>
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

function Header({ data, total, shown, small, large }: {
  data: PanelData | null
  total: number
  shown: number
  small: boolean
  large: boolean
}) {
  /* 标题与「N 个服务商」并成一行：省下一行高度给卡片 */
  const titleSize = small ? 9 : large ? 12.5 : 11
  const countSize = small ? 6 : large ? 8 : 7.5
  const countText = small
    ? (shown < total ? `${shown}/${total}` : `${total}`)
    : (shown < total ? `${shown}/${total} 个服务商` : `${total} 个服务商`)
  return (
    <HStack spacing={small ? 3 : 6} alignment="center" frame={{ maxWidth: 9999 }}>
      <Badge size={small ? 16 : large ? 24 : 20} />
      <Text font={titleSize} fontWeight="bold" foregroundStyle={INK} lineLimit={1}>中转站看板</Text>
      <Text
        font={countSize}
        fontWeight="medium"
        monospacedDigit
        foregroundStyle={MUTED}
        lineLimit={1}
        padding={{ horizontal: small ? 2.5 : 5, vertical: small ? 0.5 : 1.5 }}
        background={{ light: { color: "#0A0A14", opacity: 0.06 }, dark: { color: "#FFFFFF", opacity: 0.11 } }}
        clipShape={{ type: "capsule", style: "continuous" }}
      >
        {countText}
      </Text>
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
  )
}

export function PanelWidget({
  data,
  widgetSizeHint,
  message,
  heightOverride,
  widthOverride,
}: {
  data: PanelData | null
  widgetSizeHint: string
  message?: string
  /* 预览用：强制指定小组件尺寸，不依赖 Widget.displaySize */
  heightOverride?: number
  widthOverride?: number
}) {
  const hint = String(widgetSizeHint === undefined || widgetSizeHint === null ? "" : widgetSizeHint).toLowerCase()
  const small = hint.indexOf("small") >= 0
  const large = hint.indexOf("large") >= 0
  const rows = data ? data.rows : []

  const pad = small ? 11 : large ? 13 : 9
  const box = boxSize(hint, widthOverride, heightOverride)
  const boxWidth = box.width
  const boxHeight = box.height
  const contentW = Math.max(80, boxWidth - (pad + 2) * 2)
  const headerH = small ? 18 : large ? 24 : 20
  /* 不再画头部下方的渐变分隔线（圆角处看起来像一条莫名其妙的短线），只留间距 */
  const dividerH = small ? 5 : large ? 7 : 5
  /* 再留 2pt 余量：字体行高比估算略高，避免最后一行贴到底部 */
  const bodyAvail = Math.max(30, boxHeight - pad * 2 - headerH - dividerH - 2)

  /* CommandCode（第一个带限额的行）单独做成通栏卡，其余行进网格 */
  const hero = rows.find((row) => row.limits.length > 0) || null
  const rest = hero ? rows.filter((row) => row.key !== hero.key) : rows

  const largeHero = large
  /* 与 LimitsHero 实际尺寸一致：行高取文字行高，另加行间距 */
  const heroPadY = largeHero ? 5 : 3
  const heroRowH = largeHero ? 12.5 : 11
  const heroGapY = largeHero ? 3.5 : 2
  const heroH = hero
    ? heroPadY * 2 + heroRowH * Math.max(1, hero.limits.length) + heroGapY * Math.max(0, hero.limits.length - 1)
    : 0
  const gapY = largeHero ? 6 : 3
  const gridAvail = Math.max(0, bodyAvail - (hero ? heroH + gapY : 0))

  const gapX = largeHero ? 8 : 6
  /* 大号且服务商不多时用单列宽卡，把高度用满；多了再切两列网格 */
  const single = largeHero && rest.length > 0 && rest.length <= 4
  const cols = single || rest.length === 1 ? 1 : 2
  const cellW = (contentW - (cols - 1) * gapX) / cols
  const minRich = largeHero ? 34 : 26
  const minCompact = largeHero ? 21 : 18
  const maxCell = single ? 64 : largeHero ? 84 : 50
  const wantedRows = Math.ceil(rest.length / cols)

  let rich = true
  let gridRows = Math.min(wantedRows, Math.max(1, Math.floor((gridAvail + gapY) / (minRich + gapY))))
  if (gridRows < wantedRows) {
    rich = false
    gridRows = Math.min(wantedRows, Math.max(1, Math.floor((gridAvail + gapY) / (minCompact + gapY))))
  }
  const cellH = gridRows > 0
    ? Math.min(maxCell, Math.max(rich ? minRich : minCompact, (gridAvail - (gridRows - 1) * gapY) / gridRows))
    : 0
  const visibleRest = rest.slice(0, gridRows * cols)
  const smallCap = Math.max(1, Math.min(4, Math.floor(bodyAvail / 26)))
  const smallRows = rows.slice(0, smallCap)
  const shown = small ? smallRows.length : visibleRest.length + (hero ? 1 : 0)

  const cards: any[] = []
  for (let i = 0; i < visibleRest.length; i += cols) {
    const pair = visibleRest.slice(i, i + cols)
    cards.push(
      <HStack key={`g${i}`} spacing={gapX} alignment="top" frame={{ maxWidth: 9999 }}>
        {pair.map((row) => (
          <ProviderCard
            key={row.key}
            row={row}
            width={cellW}
            height={cellH}
            rich={rich}
          />
        ))}
        {pair.length < cols
          ? <Rectangle fill="rgba(0,0,0,0)" frame={{ width: cellW, height: cellH }} />
          : null}
      </HStack>
    )
  }

  const body: any[] = []
  if (message) {
    body.push(<Placeholder key="message" icon="exclamationmark.triangle" title="加载失败" hint={message} />)
  } else if (!rows.length) {
    body.push(<Placeholder key="empty" icon="square.grid.2x2" title="还没有配置站点" hint="打开脚本添加，或从 Surge 导入" />)
  } else if (small) {
    /* 小号：单列两行，最多 4 条；行高均分，避免名称被限额胶囊挤掉 */
    const slot = smallRows.length ? Math.min(27, bodyAvail / smallRows.length) : 0
    const extra = Math.max(0, bodyAvail - slot * smallRows.length)
    if (extra > 0.5) body.push(<Rectangle key="top" fill="rgba(0,0,0,0)" frame={{ height: extra / 2, maxWidth: 9999 }} />)
    smallRows.forEach((row) => {
      body.push(
        <VStack key={row.key} alignment="leading" spacing={0} frame={{ maxWidth: 9999, height: slot }}>
          <SmallRow row={row} />
        </VStack>
      )
    })
    if (extra > 0.5) body.push(<Rectangle key="bottom" fill="rgba(0,0,0,0)" frame={{ height: extra / 2, maxWidth: 9999 }} />)
  } else {
    const gridH = gridRows * cellH + Math.max(0, gridRows - 1) * gapY
    const slack = Math.max(0, gridAvail - gridH)
    if (slack > 0.5) body.push(<Rectangle key="padTop" fill="rgba(0,0,0,0)" frame={{ height: slack * 0.34, maxWidth: 9999 }} />)
    if (hero) body.push(<LimitsHero key="hero" row={hero} width={contentW} large={largeHero} />)
    if (hero && cards.length && gapY > 0) {
      body.push(<Rectangle key="heroGap" fill="rgba(0,0,0,0)" frame={{ height: gapY, maxWidth: 9999 }} />)
    }
    if (cards.length) {
      body.push(
        <VStack key="grid" alignment="leading" spacing={gapY} frame={{ maxWidth: 9999 }}>
          {cards}
        </VStack>
      )
    }
    if (slack > 0.5) body.push(<Rectangle key="padBottom" fill="rgba(0,0,0,0)" frame={{ height: slack * 0.66, maxWidth: 9999 }} />)
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
        <Header data={data} total={rows.length} shown={shown} small={small} large={large} />

        <Rectangle fill="rgba(0,0,0,0)" frame={{ height: dividerH, maxWidth: 9999 }} />

        {body}
      </VStack>
    </ZStack>
  )
}
