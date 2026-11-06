// DeepSeek 余额 · 小组件视图（widget.tsx / preview.tsx 共用）
// 视觉沿用「中转站看板」「服务器监控」：双色柔光渐变底、渐变图标徽章、半透明圆角卡片。
// 余额没有套餐额度，所以不画水位线；进度条改成「赠送 / 充值」的余额构成条。三个尺寸各一套布局。
import { Button, HStack, Image, Rectangle, Spacer, Text, VStack, Widget, ZStack, gradient } from "scripting"
import { DeepSeekMark } from "./dsbrand"
import { DeepSeekRefreshIntent } from "./app_intents"
import {
  formatAmount,
  formatClock,
  formatMoney,
  formatSpendAmount,
  lowBalanceOf,
  shareText,
  statusText,
  symbolOf,
} from "./core"
import type { PanelData, PanelStatus } from "./core"

const INK: any = { light: "#0B0B0F", dark: "#F5F5F7" }
const SOFT: any = { light: "#3F3F46", dark: "#D5D5DC" }
const MUTED: any = { light: "#82828C", dark: "#9A9AA6" }
const ACCENT: any = { light: "#3D5AFE", dark: "#8FA2FF" }
const LOW_INK: any = { light: "#C4170C", dark: "#FF6961" }
const BRAND = "#4D6BFE"
const GREEN = "#30D158"
const AMBER = "#FF9F0A"
const RED = "#FF453A"
const GREY = "#8E8E93"

const CARD_BG: any = {
  light: gradient("linear", {
    colors: ["rgba(20,30,90,0.060)", "rgba(20,30,90,0.026)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
  dark: gradient("linear", {
    colors: ["rgba(255,255,255,0.090)", "rgba(255,255,255,0.038)"],
    startPoint: "top",
    endPoint: "bottom",
  }),
}
const HERO_BG: any = {
  light: gradient("linear", {
    colors: ["rgba(77,107,254,0.14)", "rgba(77,107,254,0.045)"],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  }),
  dark: gradient("linear", {
    colors: ["rgba(94,130,255,0.22)", "rgba(94,130,255,0.07)"],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  }),
}
const FAIL_BG: any = {
  light: { color: RED, opacity: 0.07 },
  dark: { color: RED, opacity: 0.14 },
}
const TRACK: any = {
  light: { color: "#0A0A14", opacity: 0.10 },
  dark: { color: "#FFFFFF", opacity: 0.18 },
}
const CHIP_BG: any = {
  light: { color: "#0A0A14", opacity: 0.065 },
  dark: { color: "#FFFFFF", opacity: 0.12 },
}
const SHARE_TONE: [string, string] = ["#8FA2FF", "#4D6BFE"]
const GRANT_TONE: [string, string] = ["#9DB4FF", "#4D6BFE"]
const TOPUP_TONE: [string, string] = ["#7FE7FF", "#22B8E6"]

const TONES: Record<string, [string, string]> = {
  green: ["#67E39A", "#2FB45A"],
  amber: ["#FFC15C", "#FF9F0A"],
  red: ["#FF7C6E", "#FF453A"],
  grey: ["#BDB5A8", "#8E8E93"],
  blue: ["#8FA2FF", "#4D6BFE"],
  cyan: ["#7FE7FF", "#22B8E6"],
}

function statusColor(status: PanelStatus): string {
  if (status === "online") return GREEN
  if (status === "debt" || status === "offline") return RED
  return GREY
}

/* displaySize 偶尔会报出屏幕尺寸或 0，宽高一起校验，异常时按尺寸估算 */
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

function moneySize(base: number, text: string): number {
  const len = text.length
  if (len >= 10) return base * 0.68
  if (len >= 8) return base * 0.82
  return base
}

/* 卡片内金额同时受字长与卡片宽度限制，避免长金额把旁边文字挤掉 */
function fitMoneySize(base: number, text: string, width: number): number {
  const fit = width / (Math.max(1, text.length) * 0.64)
  return Math.max(base * 0.62, Math.min(base, fit))
}

function amountInk(config: PanelData["config"], total: number): any {
  const threshold = lowBalanceOf(config)
  return threshold > 0 && total < threshold ? LOW_INK : INK
}

function Badge({ size }: { size: number }) {
  return (
    <ZStack
      frame={{ width: size, height: size }}
      background={{ gradient: ["#93A6FF", "#3D5AFE"], startPoint: "top", endPoint: "bottom" }}
      clipShape={{ type: "rect", cornerRadius: size * 0.29 }}
      shadow={{ color: "rgba(61,90,254,0.34)", radius: 5, x: 0, y: 2 }}
    >
      <DeepSeekMark size={size * 0.64} color="#FFFFFF" />
    </ZStack>
  )
}

function Bar({ ratio, width, height, tone }: {
  ratio: number | null
  width: number
  height: number
  tone: string
}) {
  const span = ratio === null ? 0 : Math.max(0, Math.min(1, ratio))
  const filled = ratio === null || span <= 0 ? 0 : Math.max(height + 1, Math.round(width * span))
  const fill = TONES[tone] || TONES.grey
  return (
    <ZStack alignment="leading" frame={{ width, height }}>
      <Rectangle
        fill={TRACK}
        frame={{ width, height }}
        clipShape={{ type: "capsule", style: "continuous" }}
      />
      {filled > 0
        ? <Rectangle
            fill={gradient("linear", { colors: fill as any, startPoint: "leading", endPoint: "trailing" })}
            frame={{ width: filled, height }}
            clipShape={{ type: "capsule", style: "continuous" }}
          />
        : null}
    </ZStack>
  )
}

function CompositionBar({ granted, toppedUp, width, height }: {
  granted: number
  toppedUp: number
  width: number
  height: number
}) {
  const grant = Math.max(0, granted)
  const topup = Math.max(0, toppedUp)
  const total = grant + topup
  const grantW = total > 0 ? Math.round(width * (grant / total)) : 0
  const topupW = total > 0 ? width - grantW : 0
  return (
    <ZStack alignment="leading" frame={{ width, height }}>
      <Rectangle
        fill={TRACK}
        frame={{ width, height }}
        clipShape={{ type: "capsule", style: "continuous" }}
      />
      {total > 0
        ? <HStack
            spacing={0}
            frame={{ width, height }}
            clipShape={{ type: "capsule", style: "continuous" }}
          >
            {grantW > 0
              ? <Rectangle
                  fill={gradient("linear", { colors: GRANT_TONE as any, startPoint: "leading", endPoint: "trailing" })}
                  frame={{ width: grantW, height }}
                />
              : null}
            {topupW > 0
              ? <Rectangle
                  fill={gradient("linear", { colors: TOPUP_TONE as any, startPoint: "leading", endPoint: "trailing" })}
                  frame={{ width: topupW, height }}
                />
              : null}
          </HStack>
        : null}
    </ZStack>
  )
}

function StatusPill({ status, large }: { status: PanelStatus; large: boolean }) {
  const color = statusColor(status)
  const font = large ? 9.5 : 7.5
  return (
    <HStack
      spacing={large ? 3 : 2}
      alignment="center"
      padding={{ horizontal: large ? 6 : 4.5, vertical: large ? 2.2 : 1.6 }}
      background={{ light: { color: color as any, opacity: 0.12 }, dark: { color: color as any, opacity: 0.20 } }}
      clipShape={{ type: "capsule", style: "continuous" }}
      fixedSize={{ horizontal: true, vertical: false }}
    >
      <Text font={font * 0.62} foregroundStyle={color as any}>●</Text>
      <Text font={font} fontWeight="semibold" foregroundStyle={color as any} lineLimit={1}>
        {statusText(status)}
      </Text>
    </HStack>
  )
}

function Header({ data, small, large }: { data: PanelData | null; small: boolean; large: boolean }) {
  const titleSize = small ? 10 : large ? 13.5 : 11.5
  const badgeSize = small ? 17 : large ? 24 : 20
  const chipSize = small ? 6 : large ? 8.5 : 7.5
  const currency = data ? data.config.currency || "CNY" : "CNY"

  return (
    <HStack spacing={small ? 3.5 : large ? 7 : 6} alignment="center" frame={{ maxWidth: 9999 }}>
      <Badge size={badgeSize} />
      <Text font={titleSize} fontWeight="bold" foregroundStyle={INK} lineLimit={1}>
        {small ? "DeepSeek" : "DeepSeek 余额"}
      </Text>
      {data && data.status !== "unset"
        ? <Text
            font={chipSize}
            fontWeight="medium"
            monospacedDigit
            foregroundStyle={MUTED}
            lineLimit={1}
            padding={{ horizontal: small ? 3 : large ? 5 : 4, vertical: small ? 0.8 : large ? 1.5 : 1 }}
            background={CHIP_BG}
            clipShape={{ type: "capsule", style: "continuous" }}
          >
            {currency}
          </Text>
        : null}
      <Spacer />
      {data && data.status === "offline" && !small
        ? <Image systemName="exclamationmark.triangle.fill" font={7.5} foregroundStyle={RED} />
        : null}
      {data && !small && data.updatedAt > 0
        ? <Text font={large ? 10.5 : 8.5} monospacedDigit foregroundStyle={MUTED}>
            {formatClock(data.updatedAt)}
          </Text>
        : null}
      {data && data.fromCache && data.status !== "online" && !small
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
      <Button intent={DeepSeekRefreshIntent()} buttonStyle="plain">
        <Image
          systemName="arrow.clockwise"
          font={small ? 7.5 : large ? 10.5 : 9.5}
          foregroundStyle={ACCENT}
          frame={{ width: small ? 17 : large ? 22 : 20, height: small ? 17 : large ? 22 : 20 }}
          background={{ light: { color: BRAND, opacity: 0.10 }, dark: { color: "#8FA2FF", opacity: 0.16 } }}
          clipShape={{ type: "capsule", style: "continuous" }}
        />
      </Button>
    </HStack>
  )
}

function HeroCard({ data, width, height, large }: {
  data: PanelData
  width: number
  height: number
  large: boolean
}) {
  const currency = data.info?.currency || data.config.currency || "CNY"
  const total = data.info ? data.info.total : data.config.available
  const money = formatMoney(total)
  const bg = data.status === "offline" ? FAIL_BG : HERO_BG
  const padX = large ? 13 : 9
  const padY = large ? 10 : 5
  const balanceSize = moneySize(large ? 44 : 27.5, money)
  const symbolSize = large ? 18 : 12
  const labelSize = large ? 10.5 : 8
  const metaSize = large ? 9.5 : 8
  const barH = large ? 6 : 4.5
  const grant = Math.max(0, data.config.granted)
  const topup = Math.max(0, data.config.toppedUp)
  const composition = grant + topup
  const share = composition > 0 ? grant / composition : 0
  const ink = amountInk(data.config, total)
  const compositionText = composition > 0
    ? `赠 ${shareText(share)} · 充 ${shareText(1 - share)}`
    : "暂无构成数据"

  return (
    <VStack
      alignment="leading"
      spacing={0}
      padding={{ horizontal: padX, vertical: padY }}
      frame={{ width, height, alignment: "leading" }}
      background={bg}
      clipShape={{ type: "rect", cornerRadius: large ? 14 : 11 }}
    >
      <HStack spacing={4} alignment="center" frame={{ maxWidth: 9999 }}>
        <Text font={labelSize} fontWeight="medium" foregroundStyle={MUTED} lineLimit={1}>可用余额</Text>
        <Spacer />
        <StatusPill status={data.status} large={large} />
      </HStack>

      <HStack spacing={large ? 3 : 2} alignment="firstTextBaseline" padding={{ top: large ? 1 : 0 }}>
        <Text font={symbolSize} fontWeight="bold" foregroundStyle={ink}>{symbolOf(currency)}</Text>
        <Text
          font={balanceSize}
          fontWeight="heavy"
          fontDesign="rounded"
          monospacedDigit
          foregroundStyle={ink}
          lineLimit={1}
        >
          {money}
        </Text>
      </HStack>

      <VStack padding={{ top: large ? 5 : 3 }} frame={{ maxWidth: 9999 }}>
        <CompositionBar granted={grant} toppedUp={topup} width={width - padX * 2} height={barH} />
      </VStack>

      <HStack spacing={4} alignment="center" padding={{ top: large ? 4 : 2.5 }} frame={{ maxWidth: 9999 }}>
        <Text font={metaSize} foregroundStyle={MUTED} lineLimit={1}>余额构成</Text>
        <Spacer />
        <Text font={metaSize + (large ? 0.5 : 0)} fontWeight="semibold" monospacedDigit foregroundStyle={ACCENT} lineLimit={1}>
          {compositionText}
        </Text>
      </HStack>
    </VStack>
  )
}

function StatCard({ label, value, note, ratio, tone, width, height }: {
  label: string
  value: string
  note?: string
  ratio?: number
  tone?: string
  width: number
  height: number
}) {
  /* 大号卡：上排标签 + 说明，下排大金额，占比条贴底。
     金额不再和说明竖着堆，卡高能被真正用满。 */
  if (height >= 60) {
    const padX = 10
    const valueSize = fitMoneySize(30, value, width - padX * 2)
    return (
      <VStack
        alignment="leading"
        spacing={0}
        padding={{ horizontal: padX, vertical: 7 }}
        frame={{ width, height, alignment: "leading" }}
        background={CARD_BG}
        clipShape={{ type: "rect", cornerRadius: 12 }}
      >
        <HStack spacing={4} alignment="center" frame={{ maxWidth: 9999 }}>
          <Text font={10.5} fontWeight="semibold" foregroundStyle={MUTED} lineLimit={1}>{label}</Text>
          <Spacer />
          {note ? <Text font={9.5} foregroundStyle={MUTED} lineLimit={1}>{note}</Text> : null}
        </HStack>
        <Spacer />
        <Text
          font={valueSize}
          fontWeight="bold"
          fontDesign="rounded"
          monospacedDigit
          foregroundStyle={INK}
          lineLimit={1}
        >
          {value}
        </Text>
        {ratio !== undefined
          ? <VStack padding={{ top: 4 }} frame={{ maxWidth: 9999 }}>
              <Bar ratio={ratio} width={width - padX * 2} height={4} tone={tone || "green"} />
            </VStack>
          : null}
      </VStack>
    )
  }

  const labelSize = 7
  const padX = 7
  const valueSize = fitMoneySize(13.5, value, width - padX * 2)
  const noteSize = 6
  const showNote = !!note && height >= 46
  return (
    <VStack
      alignment="leading"
      spacing={1}
      padding={{ horizontal: padX, vertical: 4 }}
      frame={{ width, height, alignment: "leading" }}
      background={CARD_BG}
      clipShape={{ type: "rect", cornerRadius: 9 }}
    >
      <Text font={labelSize} fontWeight="medium" foregroundStyle={MUTED} lineLimit={1}>{label}</Text>
      <Text
        font={valueSize}
        fontWeight="bold"
        fontDesign="rounded"
        monospacedDigit
        foregroundStyle={INK}
        lineLimit={1}
      >
        {value}
      </Text>
      {showNote ? <Text font={noteSize} foregroundStyle={MUTED} lineLimit={1}>{note}</Text> : null}
    </VStack>
  )
}

function Placeholder({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <VStack spacing={6} alignment="center" frame={{ maxWidth: 9999, maxHeight: 9999 }}>
      <Image systemName={icon} font={24} foregroundStyle={ACCENT} />
      <Text font={10.5} fontWeight="semibold" foregroundStyle={INK}>{title}</Text>
      <Text font={8} foregroundStyle={MUTED} lineLimit={2}>{hint}</Text>
    </VStack>
  )
}

function SmallBody({ data, width, height }: { data: PanelData; width: number; height: number }) {
  const currency = data.info?.currency || data.config.currency || "CNY"
  const total = data.info ? data.info.total : data.config.available
  const money = formatMoney(total)
  const balanceSize = fitMoneySize(31, money, width - 18)
  const ink = amountInk(data.config, total)
  const grant = Math.max(0, data.config.granted)
  const topup = Math.max(0, data.config.toppedUp)
  const showFooter = height >= 92
  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: 9999, height }}>
      <HStack spacing={4} alignment="center" frame={{ maxWidth: 9999 }}>
        <Text font={7.5} fontWeight="medium" foregroundStyle={MUTED} lineLimit={1}>可用余额</Text>
        <Spacer />
        <HStack spacing={2} alignment="center">
          <Text font={5} foregroundStyle={statusColor(data.status) as any}>●</Text>
          <Text font={7} fontWeight="medium" foregroundStyle={statusColor(data.status) as any} lineLimit={1}>
            {statusText(data.status)}
          </Text>
        </HStack>
      </HStack>

      <HStack spacing={2.5} alignment="firstTextBaseline" padding={{ top: 1 }}>
        <Text font={13} fontWeight="bold" foregroundStyle={ink}>{symbolOf(currency)}</Text>
        <Text font={balanceSize} fontWeight="heavy" fontDesign="rounded" monospacedDigit foregroundStyle={ink} lineLimit={1}>
          {money}
        </Text>
      </HStack>

      <VStack padding={{ top: 7 }} frame={{ maxWidth: 9999 }}>
        <CompositionBar granted={grant} toppedUp={topup} width={width} height={5.5} />
      </VStack>

      <HStack spacing={4} alignment="center" padding={{ top: 4 }} frame={{ maxWidth: 9999 }}>
        <Text font={7} foregroundStyle={MUTED} lineLimit={1}>{`赠送 ${formatAmount(currency, grant)}`}</Text>
        <Spacer />
        <Text font={7} foregroundStyle={MUTED} lineLimit={1}>{`充值 ${formatAmount(currency, topup)}`}</Text>
      </HStack>

      <Spacer />

      {showFooter
        ? <HStack
            spacing={4}
            alignment="center"
            padding={{ horizontal: 6, vertical: 3 }}
            frame={{ maxWidth: 9999 }}
            background={CHIP_BG}
            clipShape={{ type: "capsule", style: "continuous" }}
          >
            <Text font={6.3} foregroundStyle={MUTED} lineLimit={1}>今日</Text>
            <Text font={7.5} fontWeight="semibold" monospacedDigit foregroundStyle={SOFT} lineLimit={1}>
              {formatSpendAmount(currency, data.todaySpend)}
            </Text>
            <Spacer />
            <Text font={6.3} foregroundStyle={MUTED} lineLimit={1}>近 7 天</Text>
            <Text font={7.5} fontWeight="semibold" monospacedDigit foregroundStyle={SOFT} lineLimit={1}>
              {formatSpendAmount(currency, data.weekSpend)}
            </Text>
          </HStack>
        : null}
    </VStack>
  )
}

function MediumBody({ data, width, height }: { data: PanelData; width: number; height: number }) {
  const currency = data.info?.currency || data.config.currency || "CNY"
  const heroH = Math.min(72, Math.max(60, height - 42))
  const gap = 6
  const cardH = Math.max(26, height - heroH - gap)
  const cardW = (width - 12) / 3
  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: 9999, height }}>
      <HeroCard data={data} width={width} height={heroH} large={false} />
      <Rectangle fill="rgba(0,0,0,0)" frame={{ height: gap, maxWidth: 9999 }} />
      <HStack spacing={6} alignment="center" frame={{ maxWidth: 9999 }}>
        <StatCard
          label="赠送余额"
          value={formatAmount(currency, data.config.granted)}
          width={cardW}
          height={cardH}
        />
        <StatCard
          label="充值余额"
          value={formatAmount(currency, data.config.toppedUp)}
          width={cardW}
          height={cardH}
        />
        <StatCard
          label="今日消耗"
          value={formatSpendAmount(currency, data.todaySpend)}
          width={cardW}
          height={cardH}
        />
      </HStack>
    </VStack>
  )
}

function LargeBody({ data, width, height }: { data: PanelData; width: number; height: number }) {
  const currency = data.info?.currency || data.config.currency || "CNY"
  const gap = 8
  const heroH = Math.min(118, Math.max(104, height * 0.42))
  const cardH = Math.max(58, (height - heroH - gap * 2) / 2)
  const cardW = (width - gap) / 2
  const totalComposition = data.config.granted + data.config.toppedUp
  const share = totalComposition > 0 ? data.config.granted / totalComposition : 0
  const grantedShare = shareText(totalComposition > 0 ? share : null)
  const toppedShare = shareText(totalComposition > 0 ? 1 - share : null)
  return (
    <VStack alignment="leading" spacing={0} frame={{ maxWidth: 9999, height }}>
      <HeroCard data={data} width={width} height={heroH} large={true} />
      <Rectangle fill="rgba(0,0,0,0)" frame={{ height: gap, maxWidth: 9999 }} />
      <HStack spacing={gap} alignment="top" frame={{ maxWidth: 9999 }}>
        <StatCard
          label="赠送余额"
          value={formatAmount(currency, data.config.granted)}
          note={`占总余额 ${grantedShare}`}
          ratio={totalComposition > 0 ? share : undefined}
          tone="blue"
          width={cardW}
          height={cardH}
        />
        <StatCard
          label="充值余额"
          value={formatAmount(currency, data.config.toppedUp)}
          note={`占总余额 ${toppedShare}`}
          ratio={totalComposition > 0 ? 1 - share : undefined}
          tone="cyan"
          width={cardW}
          height={cardH}
        />
      </HStack>
      <Rectangle fill="rgba(0,0,0,0)" frame={{ height: gap, maxWidth: 9999 }} />
      <HStack spacing={gap} alignment="top" frame={{ maxWidth: 9999 }}>
        <StatCard
          label="今日消耗"
          value={formatSpendAmount(currency, data.todaySpend)}
          note={`${data.todayChecks} 次刷新`}
          width={cardW}
          height={cardH}
        />
        <StatCard
          label="近 7 天"
          value={formatSpendAmount(currency, data.weekSpend)}
          note={`日均 ${formatAmount(currency, data.weekSpend / 7)}`}
          width={cardW}
          height={cardH}
        />
      </HStack>
    </VStack>
  )
}

export function DeepSeekWidget({
  data,
  widgetSizeHint,
  message,
  heightOverride,
  widthOverride,
}: {
  data: PanelData | null
  widgetSizeHint: string
  message?: string
  /* 预览用：强制指定尺寸，不依赖 Widget.displaySize */
  heightOverride?: number
  widthOverride?: number
}) {
  const hint = String(widgetSizeHint === undefined || widgetSizeHint === null ? "" : widgetSizeHint).toLowerCase()
  const small = hint.indexOf("small") >= 0
  const large = hint.indexOf("large") >= 0
  const box = boxSize(hint, widthOverride, heightOverride)
  const pad = small ? 11 : large ? 14 : 11
  const contentW = Math.max(80, box.width - (pad + 2) * 2)
  const headerH = small ? 18 : large ? 28 : 22
  const headerGap = small ? 6 : large ? 7 : 5
  const bodyH = Math.max(30, box.height - pad * 2 - headerH - headerGap)

  let body: any
  if (message) {
    body = <Placeholder icon="exclamationmark.triangle" title="加载失败" hint={message} />
  } else if (!data || data.status === "unset") {
    body = <Placeholder icon="key.fill" title="还没有配置 DeepSeek" hint="打开脚本填写 API Key" />
  } else if (data.status === "offline" && data.updatedAt === 0) {
    body = <Placeholder icon="wifi.exclamationmark" title="取数失败" hint={data.error || "请打开脚本查看原因"} />
  } else if (small) {
    body = <SmallBody data={data} width={contentW} height={bodyH} />
  } else if (large) {
    body = <LargeBody data={data} width={contentW} height={bodyH} />
  } else {
    body = <MediumBody data={data} width={contentW} height={bodyH} />
  }

  return (
    <ZStack alignment="topLeading" clipped={true} frame={{ maxWidth: 9999, maxHeight: 9999 }}>
      <Rectangle
        fill={{
          light: gradient("linear", {
            colors: ["#FFFFFF", "#EDF4FF"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 },
          }),
          dark: gradient("linear", {
            colors: ["#141A23", "#0B0E13"],
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
            endRadius: 205,
          }),
          dark: gradient("radial", {
            colors: ["rgba(56,120,255,0.32)", "rgba(56,120,255,0)"],
            center: { x: 0.98, y: -0.04 },
            startRadius: 0,
            endRadius: 205,
          }),
        }}
      />
      <Rectangle
        fill={{
          light: gradient("radial", {
            colors: ["rgba(120,225,205,0.20)", "rgba(120,225,205,0)"],
            center: { x: 0.02, y: 1.02 },
            startRadius: 0,
            endRadius: 165,
          }),
          dark: gradient("radial", {
            colors: ["rgba(18,200,176,0.18)", "rgba(18,200,176,0)"],
            center: { x: 0.02, y: 1.02 },
            startRadius: 0,
            endRadius: 165,
          }),
        }}
      />
      <Rectangle
        fill={{
          light: gradient("radial", {
            colors: ["rgba(77,107,254,0.06)", "rgba(77,107,254,0)"],
            center: { x: 0.5, y: 0.52 },
            startRadius: 0,
            endRadius: 240,
          }),
          dark: gradient("radial", {
            colors: ["rgba(77,107,254,0.12)", "rgba(77,107,254,0)"],
            center: { x: 0.5, y: 0.52 },
            startRadius: 0,
            endRadius: 240,
          }),
        }}
      />

      <VStack
        alignment="leading"
        spacing={0}
        padding={{ top: pad, bottom: pad, leading: pad + 2, trailing: pad + 2 }}
        frame={{ maxWidth: 9999, maxHeight: 9999 }}
      >
        <Header data={data} small={small} large={large} />
        <Rectangle fill="rgba(0,0,0,0)" frame={{ height: headerGap, maxWidth: 9999 }} />
        {body}
      </VStack>
    </ZStack>
  )
}
