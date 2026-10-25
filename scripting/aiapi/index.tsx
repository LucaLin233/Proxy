// 中转站看板 · App 内页面（数据层在 relay.core.ts）
import {
  Button,
  Form,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Picker,
  Rectangle,
  Script,
  Section,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  Widget,
  ZStack,
  useEffect,
  useState,
} from "scripting"
import {
  MODE_LABELS,
  formatClock,
  loadPanel,
  parseEndpoints,
  percent,
  readOptions,
  readSites,
  sitesToEndpoints,
  writeOptions,
  writeSites,
} from "./relay.core"
import type { Options, PanelData, RowLimit, Site, SiteMode } from "./relay.core"

const MUTED: any = { light: "#6B6B70", dark: "#9A9AA0" }
const RED = "#FF453A"

declare const Clipboard: any

function messageOf(error: any): string {
  if (!error) return "未知错误"
  if (typeof error === "string") return error
  return String(error.message || error)
}

function newSite(): Site {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: "新站点",
    base: "https://",
    mode: "cchp",
    credential: "",
    priority: null,
    enabled: true,
  }
}

const LIMIT_BAR = 46

function ratioInk(ratio: number | null): any {
  if (ratio === null) return MUTED
  if (ratio <= 0.1) return { light: "#C4170C", dark: "#FF6961" }
  if (ratio <= 0.3) return { light: "#9A5B00", dark: "#FFD60A" }
  return { light: "#137A3A", dark: "#32D74B" }
}

function ratioFill(ratio: number): any {
  if (ratio <= 0.1) return "#FF453A"
  if (ratio <= 0.3) return "#FF9F0A"
  return "#30D158"
}

function LimitBar({ ratio }: { ratio: number | null }) {
  if (ratio === null) return null
  const filled = Math.max(4, Math.round(LIMIT_BAR * Math.max(0, Math.min(1, ratio))))
  return (
    <ZStack alignment="leading" frame={{ width: LIMIT_BAR, height: 4 }}>
      <Rectangle
        fill={{ light: { color: "#000000", opacity: 0.10 }, dark: { color: "#FFFFFF", opacity: 0.18 } }}
        frame={{ width: LIMIT_BAR, height: 4 }}
        clipShape={{ type: "capsule", style: "continuous" }}
      />
      <Rectangle
        fill={ratioFill(ratio)}
        frame={{ width: filled, height: 4 }}
        clipShape={{ type: "capsule", style: "continuous" }}
      />
    </ZStack>
  )
}

/* App 内面板的限额行：标签 + 小进度条 + 百分比 */
function LimitStrip({ limits }: { limits: RowLimit[] }) {
  return (
    <HStack spacing={14} alignment="center">
      {limits.map((item) => (
        <HStack key={item.label} spacing={5} alignment="center">
          <Text font={11} fontWeight="medium" foregroundStyle={MUTED} lineLimit={1}>{item.label}</Text>
          <LimitBar ratio={item.ratio} />
          <Text
            font={12}
            fontWeight="semibold"
            monospacedDigit
            foregroundStyle={ratioInk(item.ratio)}
            lineLimit={1}
          >
            {item.ratio === null ? item.text : percent(item.ratio, 0)}
          </Text>
        </HStack>
      ))}
    </HStack>
  )
}

/* ── 面板 ── */

function PanelScreen({
  data,
  loading,
  error,
  maxRows,
  onRefresh,
  onSettings,
}: {
  data: PanelData | null
  loading: boolean
  error: string
  maxRows: number
  onRefresh: () => void
  onSettings: () => void
}) {
  return (
    <NavigationStack>
      <List
        navigationTitle="中转站看板"
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

        <Section header={<Text>{loading ? "正在取数…" : data ? `${data.rows.length} 个服务商 · 更新于 ${formatClock(data.updatedAt)}${data.fromCache ? " · 缓存" : ""}` : "服务商"}</Text>}>
          {data && data.rows.length
            ? data.rows.slice(0, maxRows).map((row) => {
              const reason = row.failed
                ? (data.errors.find((item) => item.site === row.name) || { message: "" }).message
                : ""
              return (
                <VStack key={row.key} alignment="leading" spacing={4}>
                  <HStack alignment="firstTextBaseline" spacing={6}>
                    <Text font={16} fontWeight="semibold" lineLimit={1}>{row.name}</Text>
                    {row.site
                      ? <Text font={11} foregroundStyle={MUTED} lineLimit={1}>{row.site}</Text>
                      : null}
                    <Spacer />
                    {row.amountText
                      ? <Text font={16} fontWeight="medium" monospacedDigit>{row.amountText}</Text>
                      : null}
                  </HStack>
                  {row.failed
                    ? <Text font={12} foregroundStyle={RED}>{reason ? `取数失败：${reason}` : "取数失败"}</Text>
                    : row.limits.length
                      ? <LimitStrip limits={row.limits} />
                      : row.metrics.length
                        ? <Text font={12} foregroundStyle={MUTED}>{row.metrics.join(" · ")}</Text>
                        : null}
                </VStack>
              )
            })
            : <Text foregroundStyle={MUTED}>{loading ? "取数中…" : "未获取到余额"}</Text>}
        </Section>

        {data && data.usage.length ? (
          <Section header={<Text>今日用量</Text>}>
            {data.usage.map((item) => {
              const parts = [`今日 ${Math.round(item.requests)} 次`]
              if (item.successRate !== null) parts.push(`${(item.successRate * 100).toFixed(1)}%`)
              if (item.ttftMs !== null) parts.push(`首字 ${(item.ttftMs / 1000).toFixed(1)}s`)
              return <Text key={item.site} font={14}>{`${item.site} · ${parts.join(" · ")}`}</Text>
            })}
          </Section>
        ) : null}

        {data && (data.errors.length || data.notices.length) ? (
          <Section header={<Text>提示</Text>}>
            {data.errors.map((item) => (
              <Text key={`e-${item.site}`} font={12} foregroundStyle={RED}>{`❌ ${item.site}：${item.message}`}</Text>
            ))}
            {data.notices.map((note) => (
              <Text key={note} font={12} foregroundStyle={MUTED}>{note}</Text>
            ))}
          </Section>
        ) : null}

        <Section>
          <Button title="站点设置" action={onSettings} />
        </Section>
      </List>
    </NavigationStack>
  )
}

/* ── 设置 ── */

function SiteFields({
  site,
  index,
  onChange,
  onDelete,
}: {
  site: Site
  index: number
  onChange: (patch: Partial<Site>) => void
  onDelete: () => void
}) {
  return (
    <Section header={<Text>{`站点 ${index + 1}${site.enabled ? "" : "（已停用）"}`}</Text>}>
      <TextField title="名称" value={site.name} onChanged={(value: string) => onChange({ name: value })} prompt="CCHP" />
      <TextField
        title="地址"
        value={site.base}
        onChanged={(value: string) => onChange({ base: value.trim() })}
        prompt="https://example.com"
      />
      <Picker title="模式" value={site.mode} onChanged={(value: any) => onChange({ mode: value as SiteMode })}>
        {MODE_LABELS.map(([value, label]) => <Text key={value} tag={value}>{label}</Text>)}
      </Picker>
      <SecureField
        title="凭据"
        value={site.credential}
        onChanged={(value: string) => onChange({ credential: value })}
        prompt={site.mode === "cchp" ? "CCHP 管理令牌" : site.mode === "cmdcode" ? "CommandCode API Key" : "API Key 或会话 Cookie"}
      />
      <TextField
        title="排序"
        value={site.priority === null ? "" : String(site.priority)}
        onChanged={(value: string) => {
          const text = value.trim()
          onChange({ priority: text === "" ? null : Number(text.replace(/[^0-9.-]/g, "")) })
        }}
        prompt="可选，数字越小越靠前"
      />
      <Toggle value={site.enabled} onChanged={(value: boolean) => onChange({ enabled: value })}>
        <Text>启用</Text>
      </Toggle>
      <Button title="删除此站点" action={onDelete} />
    </Section>
  )
}

function SettingsScreen({
  sites,
  options,
  onSave,
  onCancel,
}: {
  sites: Site[]
  options: Options
  onSave: (sites: Site[], options: Options) => void
  onCancel: () => void
}) {
  const [list, setList] = useState<Site[]>(sites)
  const [opts, setOpts] = useState<Options>(options)
  const [bulk, setBulk] = useState<string>("")
  const [hint, setHint] = useState<string>("")

  const update = (index: number, patch: Partial<Site>) => {
    setList(list.map((site, i) => (i === index ? { ...site, ...patch } : site)))
  }

  const doImport = () => {
    const parsed = parseEndpoints(bulk)
    if (!parsed.length) {
      setHint("没有识别到站点：格式是 名称@地址=凭据[:模式]，多个站用 | 分隔")
      return
    }
    setList(parsed)
    setHint(`已解析 ${parsed.length} 个站点，保存后生效`)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="站点设置"
        toolbar={{
          cancellationAction: <Button title="取消" action={onCancel} />,
          confirmationAction: (
            <Button
              title="保存"
              action={() => {
                const cleaned = list
                  .filter((site) => /^https?:\/\//i.test(site.base) && site.credential.trim() !== "")
                  .map((site) => ({ ...site, name: site.name.trim() || site.base }))
                onSave(cleaned, opts)
              }}
            />
          ),
        }}
      >
        {list.map((site, index) => (
          <SiteFields
            key={site.id}
            site={site}
            index={index}
            onChange={(patch) => update(index, patch)}
            onDelete={() => setList(list.filter((_, i) => i !== index))}
          />
        ))}

        <Section>
          <Button title="添加站点" action={() => setList([...list, newSite()])} />
          <Text font={12} foregroundStyle={MUTED}>地址为空或凭据为空的站点不会保存。</Text>
        </Section>

        <Section header={<Text>从 Surge 导入</Text>}>
          <TextField
            title="cch_endpoints"
            value={bulk}
            onChanged={(value: string) => setBulk(value)}
            prompt="名称@地址=凭据:模式 | 名称@地址=凭据:cchp"
          />
          <Button title="解析并替换上方站点" action={doImport} />
          {hint ? <Text font={12} foregroundStyle={MUTED}>{hint}</Text> : null}
          <Text font={12} foregroundStyle={MUTED}>
            把 Surge 模块里的 cch_endpoints 整段粘进来即可；同时支持用 | 分隔多个站。
          </Text>
        </Section>

        <Section header={<Text>显示</Text>}>
          <TextField
            title="月度上限 (USD)"
            value={String(opts.monthCap)}
            onChanged={(value: string) => {
              const parsed = Number(value.replace(/[^0-9.]/g, ""))
              setOpts({ ...opts, monthCap: Number.isFinite(parsed) && parsed > 0 ? parsed : 70 })
            }}
            prompt="CommandCode 套餐价，默认 70"
          />
          <TextField
            title="列表行数"
            value={String(opts.maxRows)}
            onChanged={(value: string) => {
              const parsed = Number(value.replace(/[^0-9]/g, ""))
              setOpts({ ...opts, maxRows: Number.isFinite(parsed) && parsed >= 3 ? parsed : 10 })
            }}
            prompt="App 内最多显示多少行"
          />
        </Section>

        <Section header={<Text>导出</Text>}>
          <Button
            title="复制当前配置为 cch_endpoints"
            action={() => {
              try {
                Clipboard.copyText(sitesToEndpoints(list))
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
  const [sites, setSites] = useState<Site[]>(readSites())
  const [options] = useState<Options>(readOptions())
  const [data, setData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [screen, setScreen] = useState<string>(sites.length ? "panel" : "settings")
  const [nonce, setNonce] = useState<number>(0)

  useEffect(() => {
    if (!sites.length) {
      setData(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError("")
    loadPanel(sites, options, 0)
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
  }, [sites, options, nonce])

  if (screen === "settings") {
    return (
      <SettingsScreen
        sites={sites}
        options={options}
        onCancel={() => setScreen("panel")}
        onSave={(nextSites, nextOptions) => {
          writeSites(nextSites)
          writeOptions(nextOptions)
          setSites(nextSites)
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
      maxRows={options.maxRows}
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
