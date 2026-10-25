// AI 中转站概览 · 界面（数据层在 aiapi.core.ts）
import {
  Button,
  HStack,
  Navigation,
  NavigationStack,
  Script,
  ScrollView,
  Text,
  TextField,
  VStack,
  Widget,
  useEffect,
  useState,
} from "scripting"
import { INITIAL_CONFIG, hasStore, loadPanel, readStored, toMessage, writeStored } from "./aiapi.core"
import type { PanelData, PanelRow, SiteResult } from "./aiapi.core"
/* ── 界面 ── */

function SettingsView({
  draft,
  onDraft,
  notice,
  canCancel,
  onSave,
  onCancel,
}: {
  draft: string
  onDraft: (value: string) => void
  notice: string
  canCancel: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <NavigationStack>
      <ScrollView>
        <VStack alignment="leading" spacing={12} navigationTitle="站点配置">
          <Text font={12}>
            与 Surge 模块 cch_endpoints 同一写法：名称@地址=凭据:模式[:优先级]，多个站点用 | 分隔。
            支持 cchp / admin / user。
          </Text>
          <TextField
            title="cch_endpoints"
            value={draft}
            onChanged={onDraft}
            axis="vertical"
            prompt="CCHP@https://cchp.example.com=管理令牌:cchp"
          />
          {notice ? <Text font={12}>{notice}</Text> : null}
          <HStack spacing={12}>
            <Button title="保存" action={onSave} />
            {canCancel ? <Button title="取消" action={onCancel} /> : null}
          </HStack>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

function PanelView({
  data,
  busy,
  error,
  onRefresh,
  onSettings,
  onClose,
}: {
  data: PanelData | null
  busy: boolean
  error: string
  onRefresh: () => void
  onSettings: () => void
  onClose: () => void
}) {
  return (
    <NavigationStack>
      <ScrollView>
        <VStack alignment="leading" spacing={10} navigationTitle="API 中转站概览">
          <HStack spacing={12}>
            <Button title="刷新" action={onRefresh} />
            <Button title="设置" action={onSettings} />
            <Button title="关闭" action={onClose} />
          </HStack>

          {busy ? <Text font={12}>正在获取…</Text> : null}
          {error ? <Text font={14}>❌ {error}</Text> : null}
          {data ? <Text font={12}>{`更新于 ${formatClock(data.updatedAt)} · ${(data.elapsedMs / 1000).toFixed(1)}s`}</Text> : null}

          {data && data.rows.length === 0 ? <Text font={14}>未获取到余额</Text> : null}

          {data
            ? data.rows.map((row) => (
              <VStack key={`${row.name}-${row.seq}`} alignment="leading" spacing={2}>
                <Text font={16} fontWeight="semibold">{`${row.name}  ${row.amount}`}</Text>
                {row.detail ? <Text font={12}>{row.detail}</Text> : null}
              </VStack>
            ))
            : null}

          {data ? data.usage.map((line) => <Text key={line} font={12}>{line}</Text>) : null}
          {data ? data.notices.map((line) => <Text key={line} font={12}>{line}</Text>) : null}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

function App() {
  const [saved, setSaved] = useState<string>(INITIAL_CONFIG)
  const [draft, setDraft] = useState<string>(INITIAL_CONFIG)
  const [screen, setScreen] = useState<string>(INITIAL_CONFIG ? "panel" : "settings")
  const [data, setData] = useState<PanelData | null>(null)
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [notice, setNotice] = useState<string>(hasStore() ? "" : "当前版本找不到 Keychain/Storage，配置可能无法保存")
  const [nonce, setNonce] = useState<number>(0)

  useEffect(() => {
    if (!saved) return
    let alive = true
    setBusy(true)
    setError("")
    loadPanel(saved).then((value) => {
      if (!alive) return
      setData(value)
      setBusy(false)
      try { if (Widget && typeof Widget.reloadAll === "function") Widget.reloadAll() } catch (_) {}
    }).catch((failure) => {
      if (!alive) return
      setError(toMessage(failure))
      setBusy(false)
    })
    return () => { alive = false }
  }, [saved, nonce])

  if (screen === "settings") {
    return (
      <SettingsView
        draft={draft}
        onDraft={setDraft}
        notice={notice}
        canCancel={!!saved}
        onSave={() => {
          const value = draft.trim()
          if (!value) {
            setNotice("配置不能为空")
            return
          }
          if (!writeStored(value)) {
            setNotice("写入失败：这个版本没有可用的 Keychain/Storage")
            return
          }
          setNotice("")
          setSaved(value)
          setScreen("panel")
        }}
        onCancel={() => {
          setDraft(saved)
          setNotice("")
          setScreen("panel")
        }}
      />
    )
  }

  return (
    <PanelView
      data={data}
      busy={busy}
      error={error}
      onRefresh={() => setNonce(nonce + 1)}
      onSettings={() => { setDraft(saved); setScreen("settings") }}
      onClose={() => Script.exit()}
    />
  )
}

async function run() {
  await Navigation.present({ element: <App /> })
  Script.exit()
}

run().catch((error) => {
  console.error(toMessage(error))
})
