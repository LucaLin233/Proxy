// 仅供本地预览排版：
// scripting-ts preview_ui preview.tsx --props '{"variant":"medium"}'
import { VStack } from "scripting"
import { DeepSeekWidget } from "./views"
import type { PanelData } from "./core"
import type { DeepSeekConfig } from "./config"

const config: DeepSeekConfig = {
  apiKey: "preview",
  available: 86.42,
  currency: "CNY",
  granted: 10,
  toppedUp: 76.42,
  lastCheck: Date.now(),
  lastOk: Date.now(),
  lastError: "",
  refreshMinutes: 15,
  lowBalance: 10,
}

function sample(patch?: Partial<PanelData>): PanelData {
  return {
    config,
    info: { currency: "CNY", total: 86.42, granted: 10, toppedUp: 76.42 },
    extra: [],
    status: "online",
    error: "",
    updatedAt: Date.now(),
    checkedAt: Date.now(),
    fromCache: false,
    todaySpend: 1.23,
    weekSpend: 8.76,
    todayChecks: 7,
    ...patch,
  }
}

function Card({ width, height, children }: { width: number; height: number; children: any }) {
  return (
    <VStack frame={{ width, height }} clipShape={{ type: "rect", cornerRadius: 22 }}>
      {children}
    </VStack>
  )
}

export default function Preview(props: { variant?: string }) {
  const variant = props.variant || "medium"
  return (
    <VStack spacing={12} padding={12} background="#000000">
      {variant === "small" ? (
        <VStack spacing={12}>
          <Card width={158} height={158}>
            <DeepSeekWidget data={sample()} widgetSizeHint="systemSmall" heightOverride={158} widthOverride={158} />
          </Card>
          <Card width={158} height={158}>
            <DeepSeekWidget
              data={sample({ status: "offline", fromCache: true, error: "网络错误：The request timed out." })}
              widgetSizeHint="systemSmall"
              heightOverride={158}
              widthOverride={158}
            />
          </Card>
        </VStack>
      ) : null}
      {variant === "medium" ? (
        <VStack spacing={12}>
          <Card width={340} height={158}>
            <DeepSeekWidget data={sample()} widgetSizeHint="systemMedium" heightOverride={158} widthOverride={340} />
          </Card>
          <Card width={340} height={158}>
            <DeepSeekWidget
              data={sample({
                status: "debt",
                config: { ...config, available: 0, granted: 0, toppedUp: 0 },
                info: { currency: "CNY", total: 0, granted: 0, toppedUp: 0 },
              })}
              widgetSizeHint="systemMedium"
              heightOverride={158}
              widthOverride={340}
            />
          </Card>
        </VStack>
      ) : null}
      {variant === "large" ? (
        <VStack spacing={12}>
          <Card width={340} height={340}>
            <DeepSeekWidget data={sample()} widgetSizeHint="systemLarge" heightOverride={340} widthOverride={340} />
          </Card>
          <Card width={340} height={340}>
            <DeepSeekWidget
              data={sample({
                status: "offline",
                fromCache: true,
                error: "网络错误：The request timed out.",
              })}
              widgetSizeHint="systemLarge"
              heightOverride={340}
              widthOverride={340}
            />
          </Card>
        </VStack>
      ) : null}
      {variant === "empty" ? (
        <Card width={340} height={158}>
          <DeepSeekWidget data={null} widgetSizeHint="systemMedium" heightOverride={158} widthOverride={340} />
        </Card>
      ) : null}
      {variant === "low" ? (
        <VStack spacing={12}>
          <Card width={340} height={158}>
            <DeepSeekWidget
              data={sample({
                config: { ...config, available: 5.2, granted: 1, toppedUp: 4.2 },
                info: { currency: "CNY", total: 5.2, granted: 1, toppedUp: 4.2 },
              })}
              widgetSizeHint="systemMedium"
              heightOverride={158}
              widthOverride={340}
            />
          </Card>
          <Card width={158} height={158}>
            <DeepSeekWidget
              data={sample({
                config: { ...config, available: 5.2, granted: 1, toppedUp: 4.2 },
                info: { currency: "CNY", total: 5.2, granted: 1, toppedUp: 4.2 },
              })}
              widgetSizeHint="systemSmall"
              heightOverride={158}
              widthOverride={158}
            />
          </Card>
        </VStack>
      ) : null}
    </VStack>
  )
}
