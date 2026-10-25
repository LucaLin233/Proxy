// 中转站看板 · 小组件按钮用的 AppIntent
// 点一下：清掉面板缓存，让小组件下次时间线重新取数
import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { clearPanelCache } from "./relay.core"

export const RelayRefreshIntent = AppIntentManager.register<void>({
  name: "RelayBoardRefresh",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    clearPanelCache()
    Widget.reloadAll()
  },
})
