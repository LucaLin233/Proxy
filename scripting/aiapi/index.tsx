// AI 中转站概览 · 界面（数据层在 aiapi.core.ts）
import {
  Button,
  Form,
  HStack,
  NavigationStack,
  Picker,
  Script,
  Section,
  SecureField,
  Text,
  TextField,
  VStack,
  Widget,
  useEffect,
  useState,
} from "scripting"
import { compose, fetchSite, readSites, sitesToConfig, toMessage, writeSites } from "./aiapi.core"
import type { PanelRow, Site, SiteMode, SiteResult } from "./aiapi.core"

const MODE_LABELS: [SiteMode, string][] = [
  ["cchp", "CCHP 管理令牌"],
  ["admin", "CCH 管理密钥"],
  ["user", "CCH Key"],
  ["login", "CCH Key（自动登录）"],
  ["cookie", "CCH 会话 Cookie"],
  ["cmdcode", "CommandCode Key"],
]

function modeLabel(mode: SiteMode): string {
  const hit = MODE_LABELS.filter(([value]) => value === mode)[0]
  return hit ? hit[1] : mode
}

function formatClock(value: number): string {
  const date = new Date(value)
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/* ── 面板 ── */

function Row({ row }: { row: PanelRow }) {
  return (
    <VStack alignment="leading" spacing={2}>
      <Text font={16} fontWeight="semibold">{row.amount ? `${row.name}  ${row.amount}` : row.name}</Text>
      {row.detail ? <Text font={12}>{row.detail}</Text> : null}
    </VStack>
  )
}

function PanelView({
  sites,
  results,
  pending,
  startedAt,
  onRefresh,
  onSettings,
  onClose,
}: {
  sites: Site[]
  results: SiteResult[]
  pending: number
  startedAt: number
  onRefresh: () => void
  onSettings: () => void
  onClose: () => void
}) {
  const data = results.length ? compose(results, startedAt) : null

  return (
    <NavigationStack>
      <VStack alignment="leading" spacing={10} navigationTitle="API 中转站概览">
        <HStack spacing={12}>
          <Button title="刷新" action={onRefresh} />
          <Button title="设置" action={onSettings} />
          <Button title="关闭" action={onClose} />
        </HStack>
        {pending > 0 ? <Text font={12}>{`正在获取…（还剩 ${pending} 个站点）`}</Text> : null}
        {pending === 0 && data ? <Text font={12}>{`更新于 ${formatClock(data.updatedAt)} · ${(data.elapsedMs / 1000).toFixed(1)}s`}</Text> : null}
        {pending === 0 && data && data.rows.length === 0 ? <Text font={14}>未获取到余额</Text> : null}
        {data ? data.rows.map((row) => <Row key={`${row.name}-${row.seq}`} row={row} />) : null}
        {data ? data.usage.map((line) => <Text key={line} font={12}>{line}</Text>) : null}
        {data ? data.notices.map((line) => <Text key={line} font={12}>{line}</Text>) : null}
        {sites.length === 0 ? <Text font={14}>还没有站点，点「设置」添加。</Text> : null}
      </VStack>
    </NavigationStack>
  )
}

/* ── 设置（原生表单） ── */

function SiteSection({
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
    <Section header={<Text>{`站点 ${index + 1}`}</Text>}>
      <TextField title="名称" value={site.name} onChanged={(value) => onChange({ name: value })} prompt="CCHP" />
      <TextField title="地址" value={site.base} onChanged={(value) => onChange({ base: value.trim() })} prompt="https://example.com" />
      <Picker title="模式" value={site.mode} onChanged={(value) => onChange({ mode: value as SiteMode })}>
        {MODE_LABELS.map(([value, label]) => <Text key={value} tag={value}>{label}</Text>)}
      </Picker>
      <SecureField
        title="凭据"
        value={site.credential}
        onChanged={(value) => onChange({ credential: value })}
        prompt={site.mode === "cchp" ? "CCHP 管理令牌" : site.mode === "cmdcode" ? "CommandCode API Key" : "API Key 或会话 Cookie"}
      />
      <TextField
        title="优先级"
        value={site.priority === null ? "" : String(site.priority)}
        onChanged={(value) => {
          const trimmed = value.trim()
          onChange({ priority: trimmed === "" ? null : Number(trimmed.replace(/[^0-9-]/g, "")) || 0 })
        }}
        prompt="可选，数字越小越靠前"
      />
      <Button title="删除此站点" action={onDelete} />
    </Section>
  )
}

function SettingsView({
  draft,
  onSave,
  onCancel,
  canCancel,
}: {
  draft: Site[]
  onSave: (sites: Site[]) => void
  onCancel: () => void
  canCancel: boolean
}) {
  const [list, setList] = useState<Site[]>(draft)

  const update = (index: number, patch: Partial<Site>) => {
    setList(list.map((site, i) => (i === index ? { ...site, ...patch } : site)))
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="站点配置"
        toolbar={{
          cancellationAction: <Button title={canCancel ? "取消" : "关闭"} action={onCancel} />,
          confirmationAction: <Button title="保存" action={() => onSave(list)} />,
        }}
      >
        {list.map((site, index) => (
          <SiteSection
            key={index}
            site={site}
            index={index}
            onChange={(patch) => update(index, patch)}
            onDelete={() => setList(list.filter((_, i) => i !== index))}
          />
        ))}
        <Section>
          <Button
            title="添加站点"
            action={() => setList([...list, { name: "新站点", base: "https://", credential: "", mode: "cchp", priority: null }])}
          />
          <Text font={12}>地址留空或无效的站点会被忽略；写入后仍可用原来的文本配置在别处导入。</Text>
        </Section>
      </Form>
    </NavigationStack>
  )
}

/* ── 入口 ── */

function App() {
  const [initialSites] = useState<Site[]>(readSites())
  const [sites, setSites] = useState<Site[]>(initialSites)
  const [draft, setDraft] = useState<Site[]>(initialSites)
  const [results, setResults] = useState<SiteResult[]>([])
  const [pending, setPending] = useState<number>(0)
  const [startedAt, setStartedAt] = useState<number>(0)
  const [screen, setScreen] = useState<string>(initialSites.length ? "panel" : "settings")
  const [nonce, setNonce] = useState<number>(0)

  useEffect(() => {
    if (!sites.length) {
      setPending(0)
      return
    }
    let alive = true
    const start = Date.now()
    let done = 0
    setResults([])
    setStartedAt(start)
    setPending(sites.length)

    const collected: SiteResult[] = []
    sites.forEach((site) => {
      fetchSite(site)
        .then(
          (value) => value,
          (error) => ({
            site,
            error: new Error(toMessage(error)),
            rows: [],
            usage: "",
            notices: [],
          } as SiteResult)
        )
        .then((value) => {
          if (!alive) return
          done += 1
          collected.push(value)
          setResults(collected.slice())
          setPending(sites.length - done)
          if (done === sites.length) {
            try {
              if (Widget && typeof Widget.reloadAll === "function") Widget.reloadAll()
            } catch (_) {}
          }
        })
    })

    return () => {
      alive = false
    }
  }, [sites, nonce])

  if (screen === "settings") {
    return (
      <SettingsView
        draft={draft}
        canCancel={sites.length > 0}
        onCancel={() => setScreen(sites.length ? "panel" : "panel")}
        onSave={(next) => {
          const cleaned = next.filter((site) => site.base.indexOf("http") === 0)
          writeSites(cleaned)
          setDraft(cleaned)
          setSites(cleaned)
          setScreen("panel")
        }}
      />
    )
  }

  return (
    <PanelView
      sites={sites}
      results={results}
      pending={pending}
      startedAt={startedAt}
      onRefresh={() => setNonce(nonce + 1)}
      onSettings={() => {
        setDraft(sites)
        setScreen("settings")
      }}
      onClose={() => Script.exit()}
    />
  )
}

async function run() {
  await Navigation.present(<App />)
  Script.exit()
}

run().catch((error) => {
  console.error(toMessage(error))
})
