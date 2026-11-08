// DeepSeek 余额 · App 内页面（数据层在 core.ts）
import {
  Button,
  Form,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Picker,
  Script,
  Section,
  SecureField,
  Spacer,
  Text,
  TextField,
  VStack,
  Widget,
  useEffect,
  useState,
} from "scripting"
import {
  formatAmount,
  formatClock,
  formatDate,
  formatMoney,
  formatSpendAmount,
  isLowBalance,
  lowBalanceOf,
  shareText,
  statusText,
  symbolOf,
} from "./core"
import type { PanelData } from "./core"
import { REFRESH_CHOICES, clampRefreshMinutes, clearUsage, loadConfig, loadUsage, refreshLabel, saveConfig } from "./config"
import type { DeepSeekConfig } from "./config"
import { clearPanelCache, initialPanel, loadPanel } from "./core"

const MUTED: any = { light: "#6B6B70", dark: "#9A9AA0" }
const ACCENT: any = { light: "#3D5AFE", dark: "#8FA2FF" }
const INK: any = { light: "#0B0B0F", dark: "#F5F5F7" }
const RED = "#FF453A"

function messageOf(error: any): string {
  if (!error) return "未知错误"
  if (typeof error === "string") return error
  return String(error.message || error)
}

function statusInk(status: string): any {
  if (status === "online") return { light: "#137A3A", dark: "#32D74B" }
  if (status === "debt" || status === "offline") return RED
  return MUTED
}

function MiniStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <VStack alignment="leading" spacing={2} frame={{ maxWidth: 9999, alignment: "leading" }}>
      <Text font={11} foregroundStyle={MUTED} lineLimit={1}>{label}</Text>
      <Text font={15} fontWeight="semibold" fontDesign="rounded" monospacedDigit lineLimit={1}>{value}</Text>
      {note ? <Text font={10} foregroundStyle={MUTED} lineLimit={1}>{note}</Text> : null}
    </VStack>
  )
}

/* ── 面板 ── */

function PanelScreen({
  data,
  loading,
  error,
  onRefresh,
  onSettings,
}: {
  data: PanelData | null
  loading: boolean
  error: string
  onRefresh: () => void
  onSettings: () => void
}) {
  const config = data ? data.config : loadConfig()
  const info = data ? data.info : null
  const currency = info?.currency || config.currency || "CNY"
  const total = info ? info.total : config.available
  const status = data ? data.status : "unset"
  const grant = Math.max(0, config.granted)
  const topup = Math.max(0, config.toppedUp)
  const composition = grant + topup
  const grantRatio = composition > 0 ? grant / composition : null
  const topupRatio = grantRatio === null ? null : 1 - grantRatio
  const low = isLowBalance(config, total)

  return (
    <NavigationStack>
      <List
        navigationTitle="DeepSeek 余额"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={() => Script.exit()} />,
          confirmationAction: <Button title={loading ? "查询中…" : "刷新"} action={onRefresh} />,
        }}
      >
        {error ? (
          <Section header={<Text>错误</Text>}>
            <Text foregroundStyle={RED}>{error}</Text>
          </Section>
        ) : null}

        <Section
          header={
            <Text>
              {loading
                ? "正在查询余额…"
                : data && data.updatedAt > 0
                  ? `更新于 ${formatClock(data.updatedAt)}${data.fromCache && data.status !== "online" ? " · 缓存" : ""}`
                  : "余额"}
            </Text>
          }
        >
          <VStack alignment="leading" spacing={7}>
            <HStack alignment="firstTextBaseline" spacing={4}>
              <Text font={18} fontWeight="bold" foregroundStyle={low ? RED : ACCENT}>{symbolOf(currency)}</Text>
              <Text font={34} fontWeight="heavy" fontDesign="rounded" monospacedDigit foregroundStyle={low ? RED : INK} lineLimit={1}>
                {formatMoney(total)}
              </Text>
              <Spacer />
              <Text font={13} fontWeight="semibold" foregroundStyle={statusInk(status)}>{statusText(status)}</Text>
            </HStack>
            <HStack spacing={4}>
              <Text font={12} foregroundStyle={MUTED}>余额构成</Text>
              <Spacer />
              <Text font={12} fontWeight="semibold" foregroundStyle={ACCENT}>
                {grantRatio === null ? "暂无数据" : `赠 ${shareText(grantRatio)} · 充 ${shareText(topupRatio)}`}
              </Text>
            </HStack>
            {data && data.extra.length
              ? data.extra.map((item) => (
                  <Text key={item.currency} font={12} foregroundStyle={MUTED}>
                    {`另：${formatAmount(item.currency, item.total)}（${item.currency}）`}
                  </Text>
                ))
              : null}
          </VStack>
        </Section>

        <Section header={<Text>构成</Text>}>
          <HStack spacing={10} alignment="top" frame={{ maxWidth: 9999 }}>
            <MiniStat
              label="赠送余额"
              value={formatAmount(currency, grant)}
              note={grantRatio === null ? undefined : `占 ${shareText(grantRatio)}`}
            />
            <MiniStat
              label="充值余额"
              value={formatAmount(currency, topup)}
              note={topupRatio === null ? undefined : `占 ${shareText(topupRatio)}`}
            />
          </HStack>
        </Section>

        <Section header={<Text>消耗</Text>}>
          <HStack spacing={10} alignment="top" frame={{ maxWidth: 9999 }}>
            <MiniStat
              label="今日消耗"
              value={formatSpendAmount(currency, data ? data.todaySpend : 0)}
              note={data ? `${data.todayChecks} 次采样` : undefined}
            />
            <MiniStat
              label="近 7 天"
              value={formatSpendAmount(currency, data ? data.weekSpend : 0)}
              note={data ? `日均 ${formatAmount(currency, data.weekSpend / 7)}` : undefined}
            />
          </HStack>
        </Section>

        <Section header={<Text>状态</Text>}>
          <HStack spacing={4}>
            <Text font={14} foregroundStyle={MUTED}>刷新周期</Text>
            <Spacer />
            <Text font={14}>{refreshLabel(config.refreshMinutes)}</Text>
          </HStack>
          {lowBalanceOf(config) > 0
            ? <HStack spacing={4}>
                <Text font={14} foregroundStyle={MUTED}>低余额标红</Text>
                <Spacer />
                <Text font={14}>{`低于 ${formatAmount(currency, lowBalanceOf(config))}`}</Text>
              </HStack>
            : null}
          <HStack spacing={4}>
            <Text font={14} foregroundStyle={MUTED}>最近检查</Text>
            <Spacer />
            <Text font={14}>{config.lastCheck ? `${formatDate(config.lastCheck)} ${formatClock(config.lastCheck)}` : "—"}</Text>
          </HStack>
          {config.lastError ? <Text font={12} foregroundStyle={RED}>{`最近错误：${config.lastError}`}</Text> : null}
          <Text font={12} foregroundStyle={MUTED}>
            {`采样记录 ${loadUsage().length} 条，保留最近 30 天；充值不会算进消耗。`}
          </Text>
        </Section>

        <Section>
          <Button title="设置" action={onSettings} />
        </Section>
      </List>
    </NavigationStack>
  )
}

/* ── 设置 ── */

function SettingsScreen({
  config,
  onSave,
  onCancel,
}: {
  config: DeepSeekConfig
  onSave: (next: DeepSeekConfig) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<DeepSeekConfig>(config)
  const [lowText, setLowText] = useState<string>(config.lowBalance > 0 ? String(config.lowBalance) : "")
  const [hint, setHint] = useState<string>("")
  const [confirmClear, setConfirmClear] = useState<boolean>(false)

  const patch = (part: Partial<DeepSeekConfig>) => setDraft({ ...draft, ...part })

  const save = () => {
    const minutes = clampRefreshMinutes(draft.refreshMinutes)
    onSave({
      ...draft,
      apiKey: draft.apiKey.trim(),
      currency: (draft.currency || "CNY").toUpperCase(),
      refreshMinutes: minutes,
      lowBalance: Math.max(0, Number(draft.lowBalance) || 0),
    })
  }

  const doClear = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      setHint("再点一次确认清除消耗记录（不可恢复）")
      return
    }
    clearUsage()
    setConfirmClear(false)
    setHint("已清除消耗记录，余额和 Key 不受影响")
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="DeepSeek 设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={onCancel} />,
          confirmationAction: <Button title="保存" action={save} />,
        }}
      >
        <Section
          header={<Text>DeepSeek API</Text>}
          footer={<Text>Key 只保存在本机 App Group，仅用于 api.deepseek.com 的余额查询；小组件与 App 共用同一份配置。</Text>}
        >
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>API Key</Text>
            <SecureField
              label={<Text>API Key</Text>}
              value={draft.apiKey}
              onChanged={(value: string) => patch({ apiKey: value })}
              prompt="sk-…"
            />
          </VStack>
          <Text font={12} foregroundStyle={MUTED}>
            {`当前：${draft.apiKey ? "已填写" : "未填写"} · 账号余额 ${formatAmount(draft.currency, draft.available)}`}
          </Text>
        </Section>

        <Section header={<Text>显示</Text>} footer={<Text>低于阈值的余额会在 App 和小组件里标红；填 0 关闭。</Text>}>
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>低余额阈值</Text>
            <TextField
              label={<Text>低余额阈值</Text>}
              value={lowText}
              onChanged={(value: string) => {
                setLowText(value)
                const parsed = Number(value.replace(/[^0-9.]/g, ""))
                patch({ lowBalance: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 })
              }}
              prompt="默认 10，0 关闭"
            />
          </VStack>
          <Text font={12} foregroundStyle={MUTED}>
            {lowBalanceOf(draft) > 0
              ? `当前：低于 ${formatAmount(draft.currency, lowBalanceOf(draft))} 标红`
              : "当前：不标红"}
          </Text>
        </Section>

        <Section header={<Text>自动刷新</Text>} footer={<Text>桌面小组件按这个周期请求新时间线；iOS 可能因省电延后，实际以系统调度为准。</Text>}>
          <Picker
            title="刷新周期"
            value={draft.refreshMinutes}
            onChanged={(value: any) => patch({ refreshMinutes: clampRefreshMinutes(value) })}
          >
            {REFRESH_CHOICES.map((minutes) => (
              <Text key={String(minutes)} tag={minutes}>{refreshLabel(minutes)}</Text>
            ))}
          </Picker>
          <Text font={12} foregroundStyle={MUTED}>
            默认 15 分钟，可选 15 分钟到 12 小时；保存后会清掉旧缓存并立即重取一次。
          </Text>
        </Section>

        <Section
          header={<Text>消耗记录</Text>}
          footer={<Text>每次余额下降记录一笔消耗，充值和退款记 0；记录保留最近 30 天，最多 2000 条。</Text>}
        >
          <HStack spacing={4}>
            <Text font={14} foregroundStyle={MUTED}>已记录</Text>
            <Spacer />
            <Text font={14}>{`${loadUsage().length} 条`}</Text>
          </HStack>
          <Button
            title={confirmClear ? "再点一次确认清除" : "清除消耗记录"}
            action={doClear}
          />
        </Section>

        {hint ? (
          <Section>
            <Text font={12} foregroundStyle={MUTED}>{hint}</Text>
          </Section>
        ) : null}
      </Form>
    </NavigationStack>
  )
}

/* ── 入口 ── */

function App() {
  const initial = loadConfig()
  const [config, setConfig] = useState<DeepSeekConfig>(initial)
  const [data, setData] = useState<PanelData | null>(initialPanel())
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [screen, setScreen] = useState<string>(initial.apiKey ? "panel" : "settings")

  const refresh = async (force: boolean) => {
    if (loading) return
    setLoading(true)
    setError("")
    try {
      const panel = await loadPanel(force)
      setData(panel)
      setConfig(panel.config)
      if (force) Widget.reloadAll()
    } catch (e: any) {
      setError(messageOf(e))
    }
    setLoading(false)
  }

  useEffect(() => {
    if (screen === "panel") refresh(false)
  }, [])

  const save = (next: DeepSeekConfig) => {
    saveConfig(next)
    clearPanelCache()
    setConfig(next)
    setScreen("panel")
    setData(null)
    Widget.reloadAll()
    refresh(true)
  }

  if (screen === "settings") {
    return (
      <SettingsScreen
        config={config}
        onSave={save}
        onCancel={() => {
          if (config.apiKey) {
            setScreen("panel")
          } else {
            Script.exit()
          }
        }}
      />
    )
  }

  return (
    <PanelScreen
      data={data}
      loading={loading}
      error={error}
      onRefresh={() => refresh(true)}
      onSettings={() => setScreen("settings")}
    />
  )
}

async function run() {
  await Navigation.present(<App />)
  Script.exit()
}

run()
