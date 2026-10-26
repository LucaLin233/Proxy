// 服务器监控 · 小组件刷新按钮用的 AppIntent
// 点一下：清掉面板缓存，让小组件下次时间线重新取数
import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { clearPanelCache } from "./core"

export const ServerRefreshIntent = AppIntentManager.register<void>({
  name: "ServerMonitorRefresh",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    clearPanelCache()
    Widget.reloadAll()
  },
})
