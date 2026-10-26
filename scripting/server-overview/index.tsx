// 服务器监控 · App 内页面（数据层在 core.ts）
import {
  Button,
  Form,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Picker,
  ProgressView,
  Script,
  Section,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  Widget,
  useEffect,
  useState,
} from "scripting"
import {
  daysLeft,
  formatBytes,
  formatClock,
  formatDate,
  lightsailReady,
  loadPanel,
  maskIp,
  parseSurgeArguments,
  peekaboReady,
  percentText,
  readConfig,
  surgeArgumentsOf,
  writeConfig,
} from "./core"
import type { Config, IpMode, ServerData } from "./core"

const MUTED: any = { light: "#6B6B70", dark: "#9A9AA0" }
const RED = "#FF453A"

declare const Clipboard: any

const IP_LABELS: [IpMode, string][] = [
  ["mask", "脱敏"],
  ["full", "完整"],
  ["hide", "隐藏"],
]

function messageOf(error: any): string {
  if (!error) return "未知错误"
  if (typeof error === "string") return error
  return String(error.message || error)
}

function ratioInk(ratio: number | null): any {
  if (ratio === null) return MUTED
  if (ratio >= 0.9) return { light: "#C4170C", dark: "#FF6961" }
  if (ratio >= 0.7) return { light: "#9A5B00", dark: "#FFD60A" }
  return { light: "#137A3A", dark: "#32D74B" }
}

function ratioTint(ratio: number | null): any {
  if (ratio === null) return "#8E8E93"
  if (ratio >= 0.9) return "#FF453A"
  if (ratio >= 0.7) return "#FF9F0A"
  return "#30D158"
}

function ipText(ip: string, mode: IpMode): string {
  if (!ip) return "无公网 IP"
  if (mode === "hide") return "IP 已隐藏"
  return mode === "mask" ? maskIp(ip) : ip
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/* ── 面板 ── */

function PanelScreen({
  data,
  loading,
  error,
  config,
  onRefresh,
  onSettings,
}: {
  data: ServerData | null
  loading: boolean
  error: string
  config: Config
  onRefresh: () => void
  onSettings: () => void
}) {
  const groups = data ? data.groups.slice(0, config.maxRows) : []
  const hidden = data ? data.groups.length - groups.length : 0
  const peekabo = data ? data.peekabo : null

  return (
    <NavigationStack>
      <List
        navigationTitle="服务器监控"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={() => Script.exit()} />,
          confirmationAction: <Button title="刷新" action={onRefresh} />,
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
                ? "正在取数…"
                : data
                  ? `Lightsail · 更新于 ${formatClock(data.updatedAt)}${data.fromCache ? " · 缓存" : ""}`
                  : "Lightsail"}
            </Text>
          }
        >
          {groups.length
            ? groups.map((group) => {
                const known = group.quotaBytes > 0
                return (
                  <VStack key={group.key} alignment="leading" spacing={5}>
                    <HStack alignment="firstTextBaseline" spacing={6}>
                      <Text font={16} fontWeight="semibold" lineLimit={1}>{group.regionName}</Text>
                      <Text font={11} foregroundStyle={MUTED} lineLimit={1}>{group.bundleId}</Text>
                      <Spacer />
                      <Text
                        font={15}
                        fontWeight="bold"
                        fontDesign="rounded"
                        monospacedDigit
                        foregroundStyle={ratioInk(known ? group.percent : null)}
                      >
                        {known ? percentText(group.percent, 1) : "--"}
                      </Text>
                    </HStack>
                    <ProgressView
                      value={known ? clampRatio(group.percent) : 0}
                      total={1}
                      tint={ratioTint(known ? group.percent : null)}
                    />
                    <Text font={12} foregroundStyle={MUTED}>
                      {`${formatBytes(group.usedBytes)} / ${known ? formatBytes(group.quotaBytes) : "配额未知"}${config.showToday ? ` · 今日 ${formatBytes(group.todayBytes)}` : ""}`}
                    </Text>
                    {group.instances.map((instance) => (
                      <Text key={`${group.key}.${instance.name}`} font={11} foregroundStyle={MUTED} lineLimit={1}>
                        {`${instance.name} · ${ipText(instance.ip, config.ipMode)} · ${formatBytes(instance.usedBytes)}`}
                      </Text>
                    ))}
                  </VStack>
                )
              })
            : (
              <Text foregroundStyle={MUTED}>
                {loading ? "取数中…" : lightsailReady(config) ? "没有找到 Lightsail 实例" : "未配置 AWS 密钥"}
              </Text>
            )}
          {hidden > 0 ? <Text font={12} foregroundStyle={MUTED}>{`还有 ${hidden} 组未显示`}</Text> : null}
        </Section>

        {peekabo ? (
          <Section header={<Text>Peekabo</Text>}>
            {peekabo.ok ? (
              <VStack alignment="leading" spacing={5}>
                <HStack alignment="firstTextBaseline" spacing={6}>
                  <Text font={16} fontWeight="semibold">当月流量</Text>
                  <Spacer />
                  <Text font={15} fontWeight="bold" fontDesign="rounded" monospacedDigit foregroundStyle={ratioInk(peekabo.percent)}>
                    {percentText(peekabo.percent, 1)}
                  </Text>
                </HStack>
                <ProgressView value={clampRatio(peekabo.percent)} total={1} tint={ratioTint(peekabo.percent)} />
                <Text font={12} foregroundStyle={MUTED}>{`${formatBytes(peekabo.used)} / ${formatBytes(peekabo.total)}`}</Text>
                <HStack alignment="center" spacing={6}>
                  <Text font={12} foregroundStyle={MUTED}>{`到期 ${formatDate(peekabo.expireAt)}`}</Text>
                  <Spacer />
                  <Text
                    font={12}
                    fontWeight="semibold"
                    foregroundStyle={peekabo.daysLeft <= 3 ? RED : MUTED}
                  >
                    {peekabo.daysLeft <= 0 ? "已到期" : `剩 ${peekabo.daysLeft} 天`}
                  </Text>
                </HStack>
              </VStack>
            ) : (
              <Text foregroundStyle={RED}>{`❌ ${peekabo.error}`}</Text>
            )}
          </Section>
        ) : null}

        {data && data.errors.length ? (
          <Section header={<Text>提示</Text>}>
            {data.errors.map((item) => (
              <Text key={`${item.source}.${item.message}`} font={12} foregroundStyle={RED}>
                {`${item.source}：${item.message}`}
              </Text>
            ))}
            {data.stale ? <Text font={12} foregroundStyle={MUTED}>本次取数失败，上面显示的是上一次的缓存。</Text> : null}
          </Section>
        ) : null}

        <Section>
          <Button title="设置" action={onSettings} />
          <Text font={12} foregroundStyle={MUTED}>
            AWS 密钥只需要 lightsail:GetInstances / GetBundles / GetInstanceMetricData 三个只读权限。
          </Text>
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
  config: Config
  onSave: (next: Config) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Config>(config)
  const [bulk, setBulk] = useState<string>("")
  const [hint, setHint] = useState<string>("")

  const patch = (part: Partial<Config>) => setDraft({ ...draft, ...part })

  const doImport = () => {
    const parsed = parseSurgeArguments(bulk)
    const keys = Object.keys(parsed)
    if (!keys.length) {
      setHint("没有识别到参数：可以整段粘贴模块里的 argument=\"…\"")
      return
    }
    setDraft({ ...draft, ...parsed })
    setHint(`已填入 ${keys.length} 项，保存后生效`)
  }

  const save = () => {
    const rows = Math.max(3, Math.min(30, Math.round(Number(draft.maxRows) || 8)))
    onSave({
      ...draft,
      awsKeyId: draft.awsKeyId.trim(),
      awsSecret: draft.awsSecret.trim(),
      regions: draft.regions.trim() || "ap-east-1|ap-northeast-1",
      peekaboToken: draft.peekaboToken.trim(),
      peekaboId: draft.peekaboId.trim(),
      maxRows: rows,
    })
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="服务器设置"
        toolbar={{
          cancellationAction: <Button title="取消" action={onCancel} />,
          confirmationAction: <Button title="保存" action={save} />,
        }}
      >
        <Section
          header={<Text>AWS Lightsail</Text>}
          footer={<Text>{`当前：${lightsailReady(draft) ? "已配置" : "缺少 Access Key / Secret Key"} · 区域 ${draft.regions || "未填写"}`}</Text>}
        >
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>Access Key</Text>
            <TextField
              label={<Text>Access Key</Text>}
            value={draft.awsKeyId}
            onChanged={(value: string) => patch({ awsKeyId: value })}
            prompt="AKIA…"
            />
          </VStack>
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>Secret Key</Text>
            <SecureField
              label={<Text>Secret Key</Text>}
            value={draft.awsSecret}
            onChanged={(value: string) => patch({ awsSecret: value })}
            prompt="AWS 访问密钥的 Secret"
            />
          </VStack>
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>区域</Text>
            <TextField
              label={<Text>区域</Text>}
            value={draft.regions}
            onChanged={(value: string) => patch({ regions: value })}
            prompt="ap-east-1|ap-northeast-1"
            />
          </VStack>
          <Picker title="IP 显示" value={draft.ipMode} onChanged={(value: any) => patch({ ipMode: value as IpMode })}>
            {IP_LABELS.map(([value, label]) => <Text key={value} tag={value}>{label}</Text>)}
          </Picker>
          <Toggle value={draft.showToday} onChanged={(value: boolean) => patch({ showToday: value })}>
            <Text>显示今日流量</Text>
          </Toggle>
        </Section>

        <Section
          header={<Text>Peekabo</Text>}
          footer={<Text>{`当前：${peekaboReady(draft) ? "已配置" : "缺少 Server ID / Token"}；只填一侧也能用，另一侧会自动跳过。`}</Text>}
        >
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>Server ID</Text>
            <TextField
              label={<Text>Server ID</Text>}
            value={draft.peekaboId}
            onChanged={(value: string) => patch({ peekaboId: value })}
            prompt="控制面板 /server/ 后面的 ID"
            />
          </VStack>
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>API Token</Text>
            <SecureField
              label={<Text>API Token</Text>}
            value={draft.peekaboToken}
            onChanged={(value: string) => patch({ peekaboToken: value })}
            prompt="Peekabo 账户 → API"
            />
          </VStack>
        </Section>

        <Section header={<Text>显示</Text>}>
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>列表行数</Text>
            <TextField
              label={<Text>列表行数</Text>}
            value={String(draft.maxRows)}
            onChanged={(value: string) => {
              const parsed = Number(value.replace(/[^0-9]/g, ""))
              patch({ maxRows: Number.isFinite(parsed) && parsed > 0 ? parsed : 8 })
            }}
            prompt="App 内最多显示多少组，默认 8"
            />
          </VStack>
        </Section>

        <Section header={<Text>从 Surge 导入</Text>}>
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>argument</Text>
            <TextField
              label={<Text>argument</Text>}
            value={bulk}
            onChanged={(value: string) => setBulk(value)}
            prompt="lightsail_ak=…&amp;lightsail_sk=…"
            />
          </VStack>
          <Button title="解析并填入上方" action={doImport} />
          {hint ? <Text font={12} foregroundStyle={MUTED}>{hint}</Text> : null}
          <Text font={12} foregroundStyle={MUTED}>
            把模块里的 argument="…" 整段粘进来即可，支持 lightsail_ak / lightsail_sk / lightsail_region / lightsail_ip_mode / peekabo_id / peekabo_token。
          </Text>
        </Section>

        <Section header={<Text>导出</Text>}>
          <Button
            title="复制当前配置为 Surge 参数"
            action={async () => {
              try {
                await Clipboard.copyText(surgeArgumentsOf(draft))
                setHint("已复制，可以粘回 Surge 模块")
              } catch (_) {
                setHint("复制失败")
              }
            }}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}

/* ── 入口 ── */

function App() {
  const [config, setConfig] = useState<Config>(readConfig())
  const [data, setData] = useState<ServerData | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [nonce, setNonce] = useState<number>(0)
  const [screen, setScreen] = useState<string>(
    lightsailReady(config) || peekaboReady(config) ? "panel" : "settings"
  )

  useEffect(() => {
    if (!lightsailReady(config) && !peekaboReady(config)) {
      setData(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError("")
    loadPanel(config, 0)
      .then((value) => {
        if (!alive) return
        setData(value)
        setLoading(false)
        try { Widget.reloadAll() } catch (_) {}
      })
      .catch((reason) => {
        if (!alive) return
        setError(messageOf(reason))
        setLoading(false)
      })
    return () => { alive = false }
  }, [config, nonce])

  if (screen === "settings") {
    return (
      <SettingsScreen
        config={config}
        onCancel={() => setScreen("panel")}
        onSave={(next) => {
          writeConfig(next)
          setConfig(next)
          setScreen("panel")
          setNonce(nonce + 1)
          try { Widget.reloadAll() } catch (_) {}
        }}
      />
    )
  }

  return (
    <PanelScreen
      data={data}
      loading={loading}
      error={error}
      config={config}
      onRefresh={() => setNonce(nonce + 1)}
      onSettings={() => setScreen("settings")}
    />
  )
}

async function run() {
  await Navigation.present(<App />)
  Script.exit()
}

run().catch((error) => {
  console.error(messageOf(error))
})
