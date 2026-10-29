// 中转站看板 · App 内设置页（数据层在 relay.core.ts）
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
  Widget,
  useState,
} from "scripting"
import {
  MODE_LABELS,
  parseEndpoints,
  readOptions,
  readSites,
  sitesToEndpoints,
  writeOptions,
  writeSites,
} from "./relay.core"
import type { Options, Site, SiteMode } from "./relay.core"

const MUTED: any = { light: "#6B6B70", dark: "#9A9AA0" }

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
        prompt="可选，仅同一档位内生效"
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
        navigationTitle="中转站设置"
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

        <Section header={<Text>说明</Text>}>
          <Text font={12} foregroundStyle={MUTED}>
            这里只保存参数，不取数；余额、成功率与首字延迟都在桌面小组件里查看。保存后会自动刷新小组件并关闭此页。
          </Text>
        </Section>
      </Form>
    </NavigationStack>
  )
}

/* ── 入口 ── */

function App() {
  const [sites] = useState<Site[]>(readSites())
  const [options] = useState<Options>(readOptions())

  const finish = () => {
    try { Script.exit() } catch (_) {}
  }

  return (
    <SettingsScreen
      sites={sites}
      options={options}
      onCancel={finish}
      onSave={(nextSites, nextOptions) => {
        writeSites(nextSites)
        writeOptions(nextOptions)
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
