// 服务器监控 · App 内设置页（数据层在 core.ts）
import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Picker,
  Script,
  Section,
  SecureField,
  Text,
  TextField,
  Toggle,
  VStack,
  Widget,
  useState,
} from "scripting"
import {
  REFRESH_CHOICES,
  clampRefreshMinutes,
  clearPanelCache,
  lightsailReady,
  parseSurgeArguments,
  peekaboReady,
  readConfig,
  surgeArgumentsOf,
  writeConfig,
} from "./core"
import type { Config, IpMode } from "./core"

const MUTED: any = { light: "#6B6B70", dark: "#9A9AA0" }

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

function refreshLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours} 小时` : `${minutes} 分钟`
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
    onSave({
      ...draft,
      awsKeyId: draft.awsKeyId.trim(),
      awsSecret: draft.awsSecret.trim(),
      regions: draft.regions.trim() || "ap-east-1|ap-northeast-1",
      peekaboToken: draft.peekaboToken.trim(),
      peekaboId: draft.peekaboId.trim(),
      refreshMinutes: clampRefreshMinutes(draft.refreshMinutes),
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

        <Section header={<Text>显示</Text>} footer={<Text>IP 脱敏只影响 IPv4；今日流量要多查一轮接口，关掉刷新更快。</Text>}>
          <Picker title="IP 显示" value={draft.ipMode} onChanged={(value: any) => patch({ ipMode: value as IpMode })}>
            {IP_LABELS.map(([value, label]) => <Text key={value} tag={value}>{label}</Text>)}
          </Picker>
          <Toggle value={draft.showToday} onChanged={(value: boolean) => patch({ showToday: value })}>
            <Text>显示今日流量</Text>
          </Toggle>
        </Section>

        <Section header={<Text>刷新</Text>}>
          <Picker
            title="小组件刷新间隔"
            value={String(draft.refreshMinutes)}
            onChanged={(value: any) => patch({ refreshMinutes: clampRefreshMinutes(value) })}
          >
            {REFRESH_CHOICES.map((minutes) => (
              <Text key={String(minutes)} tag={String(minutes)}>{refreshLabel(minutes)}</Text>
            ))}
          </Picker>
          <Text font={12} foregroundStyle={MUTED}>
            默认 30 分钟；到点后小组件会自动重取流量。可选 15 分钟到 12 小时。
          </Text>
          <Text font={12} foregroundStyle={MUTED}>
            iOS 会按电量、使用频率和小组件个数节流，实际刷新可能比设定更晚；想立即取一次，用小组件右上角的刷新按钮。
          </Text>
        </Section>

        <Section header={<Text>从 Surge 导入</Text>}>
          <VStack alignment="leading" spacing={4}>
            <Text font={12} fontWeight="medium" foregroundStyle={MUTED}>argument</Text>
            <TextField
              label={<Text>argument</Text>}
              value={bulk}
              onChanged={(value: string) => setBulk(value)}
              prompt="lightsail_ak=…&lightsail_sk=…"
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
                await Pasteboard.setItems([{ "public.plain-text": surgeArgumentsOf(draft) } as Pasteboard.Item])
                setHint("已复制，可以粘回 Surge 模块")
              } catch (_) {
                setHint("复制失败")
              }
            }}
          />
        </Section>

        <Section header={<Text>说明</Text>}>
          <Text font={12} foregroundStyle={MUTED}>
            这里只保存参数，不取数；流量与到期时间都在桌面小组件里查看。保存后会清掉旧缓存、按新间隔重取，并关闭此页。
          </Text>
        </Section>
      </Form>
    </NavigationStack>
  )
}

/* ── 入口 ── */

function App() {
  const [config] = useState<Config>(readConfig())

  const finish = () => {
    try { Script.exit() } catch (_) {}
  }

  return (
    <SettingsScreen
      config={config}
      onCancel={finish}
      onSave={(next) => {
        writeConfig(next)
        /* 参数或间隔变了就让下次时间线重新取数，而不是继续用旧缓存 */
        clearPanelCache()
        try { Widget.reloadAll() } catch (_) {}
        finish()
      }}
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
