# 中转站面板（aiapi）配置与行为说明

本文是 Surge 模块 `surge/modules/aiapi.sgmodule`（脚本 `surge/scripts/aiapi_relay.js`）的详细说明，从仓库首页 README 移来；
Scripting 小组件版见 `scripting/aiapi/README.md`。参数的逐项说明以模块里的 `#!arguments-desc` 为准。

`aiapi.sgmodule` 的 `cch_endpoints` 一站一条、竖线分隔，模式接在凭据后面（`:cchp` 即 CCHP 管理令牌）。
把余额源切到 CCHP 时，请用 CCHP 条目**替换**原来的主站 admin 条目，不要两条同时保留（同一个站会出现两行）：

```text
# 改前：CCH 主站 admin 条目
主站@cch.example.com=<管理员令牌>:admin|Clouder@cc2.example.tech=<用户 Key>:user

# 改后：CCHP 条目替换主站 admin，Clouder 仍保留 user 条目
CCHP@cchp.example.com=<管理令牌>:cchp|Clouder@cc2.example.tech=<用户 Key>:user
```

- Clouder 的余额仍由 CCH 站点（`user`/`cookie`/`login`）提供；**只有**站点名称等于 provider 名或品牌（如 `Clouder`），
  或站点域名与 provider 的 `website_url` 域名一致，才会沿用 CCHP 里该 provider 的 key 优先级；
  匹配不到就没有优先级（排在有优先级的行之后，按固定行序兜底），也可在站点末尾手写优先级（`=凭据:user:1`），
  手写值优先于自动匹配。
- 余额**默认只刷一把代表 key**：`aiapi_cchp_single_account` 默认开启，每个可见 provider 取 active `keyIds`
  去重后字符串升序第一把调 `?refresh=true`，面板只显示该 key 关联的 `balance.accounts` 单账户金额，
  不再把同一账户被拆出的两条 `totals` 相加。默认拓扑就是一个 provider 一个上游账户、新账户另开 provider。
  **风险**：默认开启，多账户 provider 只会显示一个账户（少算）；需要合计时显式设
  `aiapi_cchp_single_account=false`，恢复逐把 key 刷新与 `totals` 聚合。
  该开关只影响面板与日报展示，不修 CCHP 页面自身按账户相加的总额。
- 关闭单账户开关时余额**每次刷新都强制查上游**：对每个 provider 的每把 active key 各调一次 `?refresh=true` 复查
  （同一上游账户常挂多把 key，只刷一把会让另一把停在旧值，CCHP 据此把同一账户拆成两条并重复计入总额），再取一次列表拿服务端聚合值；
  Mi（`miapi`）与原 CCH 一致不展示，Clouder 不在此模式取余额也不刷新，只保留其 key 优先级参与排序。
- 单账户模式下找不到唯一账户（多账户且没有一条的 `key_ids` 含代表 key）的 provider 不显示金额，
  底部提示「⚠️ 单账户余额不可用」。
- 可见性：CCHP 分支在 `keys/page` **分页取全**的前提下，provider 若**没有任何 `status=active` 的 key**
  （全部停用，或压根没建 key）就按已停用处理，**不显示该行**（`cchpRows` 跳过，也不作为余额刷新目标）。
  `keys/page` 取不全（`partial`/`preparing`、页数用满）或请求失败时**不据此隐藏任何行**，只丢排序与 `keyIds`。
  Clouder 的余额由 CCH 站点提供，不受这条判据影响；Mi（`miapi`）的隐藏规则不变。
- 失败回退：全部刷新失败、被 27 秒预算跳过或在途请求被预算截断时，沿用列表里的服务端缓存值并提示「⚠️ 余额未刷新，来自服务端缓存」；
  只有部分 provider 没刷到时（如 `keys/page` 取不全、拿不到 `keyIds` 而无法刷新的），仍重取一次列表并提示「⚠️ 部分余额未刷新」，
  该提示与超时提示去重（超时优先）。
  只有列表请求本身失败才回退上次快照并提示「⚠️ CCHP 余额来自缓存」（两者不会同时出现）。
  上游余额接口有频率限制：一次刷新对每把 active key 各调一次、失败不重试。
- key 优先级与 `keyIds` **每轮实取** `keys/page`（按 `nextCursor` 分页取全）：key 启停后当轮即生效，
  没有 24 小时缓存、也没有旧缓存回退。取数失败或服务端返回 `partial`/`preparing`（还没备齐）时只丢排序与 `keyIds`：
  priority 为空，行序退回固定兜底，同时提示「⚠️ 部分排序信息缺失」，行本身照常显示。
  CCHP 需要串行多段请求，请求数还按 key 放大（每把 active key 各刷一次），
  所以 27 秒总预算同时限制**派发与等待**：到点不再派发新请求、也不再等在途请求（已发出的无法取消，
  晚到的响应直接丢弃），在模块 30 秒上限前降级（「⚠️ 部分请求超时」，与缺失提示合并只出现一次），
  已拿到的余额照常显示。例如 11 把 key × 12 秒、并发 5 约在 27 秒收尾，不会拖到 36 秒。
- 多币种：`totals` 里每种币种按原单位并列显示（如 `余额 $2.00 + ¥70.00`），不做汇率换算；金额只用于展示，不参与排序
  （`total_usd` 缺失只影响该行金额的取值，不会把它排到同优先级末尾）。
- 排序：**先按 CCH 优先级升序**（数值越小越靠前，即 CCHP 里各 provider 的 key 优先级；CCH 站点按域名/名称匹配到
  CCHP 的厂商时沿用同一数值）。优先级相同再按名称（大小写不敏感），最后按配置顺序；金额/余额不参与排序。
  没有优先级的行（CCH user 站点、匹配不到厂商的独立站点）排在有优先级的行之后，其间用兜底顺序
  `CommandCode → Clouder → Kcne → Air`（写死在 `aiapi_relay.js` 的 `PANEL_ROW_ORDER`，名称与 Scripting 版
  `scripting/aiapi/relay.core.ts` 的 `ROW_ORDER` 一致）；按名称前缀归类（`Kcne-Astra → Kcne`；`SD 备用` 这类不在表里的行排最后），
  大小写不敏感，不在表里的行排最后。站点末尾手写 `:优先级` 仍优先于自动匹配。
  该优先级来自 CCHP `keys/page`，每轮实取；失败或取数不完整时没有优先级，退回固定兜底。
- 功能摘要：余额 + 今日用量（次数/成功率/首字）+ 供应商健康（成功率/首字 P50），**不查供应商限额**。
- **CommandCode 限额行**（`cmdcode` 模式）：CommandCode 在 CCHP 里是 `balance.status=unsupported`（上游不支持查余额），
  用 `cmdcode` 条目直接读它的限额：`CommandCode@api.commandcode.ai=<CommandCode API Key>:cmdcode:5`，
  面板按**两行**显示（默认 38 宽）：

  ```
  CommandCode · 100.0% · 3.1s
  5H 68.00% · W 59.00% · M 57.14%
  ```

  第 1 行是站名 + 成功率 / TTFT：这两项取自 CCHP 的 **provider-health**，格式与 CCHP 余额行完全一致（成功率一位小数、
  TTFT 取 P50 一位小数秒）。`cmdcode` 站点与 CCHP 的 provider **按域名匹配**——小写、去掉协议/路径/查询/片段/端口/用户信息，
  再剥掉开头的 `www.` / `api.`，因此 `https://api.commandcode.ai` 与 `https://commandcode.ai` 视为同一家；
  查不到健康数据（没有 CCHP 条目、provider 无健康行或 requests=0）时第 1 行只显示站名。
  第 2 行只放限额指标、不带站名：三个百分比都是**剩余**比例 = 100% − 已用%，**百分比固定两位小数；着色仍按实际值**；
  站名取条目左侧名称，末尾 `5` 是优先级；标签固定为 `5H` / `W` / `M`，不随宽度变化。
  面板与日报都按两行输出；指标行一个可展示字段都没有时整行不占位（与原单行行为一致）。
- `cmdcode` 取数：`/alpha/whoami?limits=1` 取组织 ID，再取 `/alpha/billing/credits?orgId=`（个人账户不带 `orgId`），
  只打这两个端点，`subscriptions`/`usage` 不参与展示；字段缺失、非 200、超时都只降级，不中断面板。
- `cmdcode` 显示：`5H` / `W` = 剩余 / 上限（`windowLimits.fiveHour` / `weekly`）；`limited=false` 时该窗口写「不限」；
  `cap` 缺失或为 0 的窗口整段省略（不写 `0%`）。
  字段名按线上见过的写法容错：`windowLimits` 可在 `credits` 上或响应顶层，也可写成 `window_limits`；
  窗口键认 `fiveHour` / `five_hour` / `five_hours` / `5h` 与 `weekly` / `week` / `sevenDay` / `7d`；
  已用认 `used` / `current` / `spent`，上限认 `cap` / `limit` / `max` / `total`（只认有限 number，
  数组/对象/布尔/空串/数字字符串都不算数值），`limited` 的布尔与 `"true"` / `"false"` 字符串都归一。
  canonical 字段存在即不再回退别名（值非法按缺失处理），别名只在 canonical 字段不存在时才用；
  `limited` 不为 false 却一个窗口都取不到时，诊断日志记一行：只含字段名与类型，不含任何响应值，
  每次刷新最多一条。
  月度 `M` 按套餐上限折算剩余比例：`M% = clamp(monthlyCredits / cap, 0, 1)`，即 100% − 已用%，接口不返回本月已用，
  只能用「套餐价 − 计划内剩余额度」反推；`cap` 取 `cch_cmdcode_month_cap`（默认 70，即官方 GOAT 套餐月费 70 美元，
  按自己的套餐改即可）。`monthlyCredits` 缺失或 `cap` 非法（≤0/非数字）时该段回退成剩余金额 `M $剩余`，
  剩余 = `monthlyCredits + purchasedCredits + freeCredits`（金额格式：≥1e4 用 k、≥1e6 用 M，其余 ≥100 取整、否则一位小数并去掉尾部 `.0`）；
  三项全缺时省略该段，行内不出现「余额」二字。`M` 与两个窗口一样按剩余比例参与图标着色：剩余 ≤5% 红、≤20% 黄。
- `cmdcode` 宽度与缓存：站名固定在第 1 行，宽度只压第 2 行的指标排法（**只压缩、不丢指标**，每档都用脚本自身 `measure()` 判定）：
  完整（`5H 85.77% · W 94.31% · M 97.15%`，31 列，默认 38 宽即此格式）
  → 紧凑（`5H85.77% · W94.31% · M97.15%`，28 列）
  → 紧凑空格（`5H85.77% W94.31% M97.15%`，24 列）
  → 无分隔（`5H85.77%W94.31%M97.15%`，22 列）。
  百分比固定两位小数后三项最紧 22 列：`cch_row_width` 下限 20 列，20–21 列物理上放不下三项，
  只截短最紧排法并收尾（`5H85.77% W94.31% M…`）；两个窗口都用满（`0.00%`）且月度回退成 `$1234` 这类金额时
  20 列仍三项齐全（`5H0.00%W0.00%M$1234`）。指标行不走会从尾部丢字段的通用截断（旧实现在 20–22 列会丢掉月度）。
  第 1 行（站名 + 成功率 + TTFT）放不下时用通用收尾：先截短站名（保留成功率与 TTFT），仍不够才从尾部舍掉 TTFT；
  `CommandCode` 只有 11 列，默认 38 宽下连同 `100.0% · 3.1s` 一共约 26 列，正常不会触发。
  最紧排法仍超宽时截短收尾，绝不返回超宽行。
  限额缓存受 `cch_quota_interval` 控制（模块默认 600 秒；直接调用脚本且未传该参数时为 300 秒；
  按「站点地址 + 凭据指纹」分区，指纹是 `SHA-256(base|凭据)` 的前 32 位十六进制即 128 bit，原始凭据不落盘，换 key 不会读到上一账户的限额），
  有效期内不发请求；取数失败或响应里没有任何可展示字段时沿用上次缓存并提示「⚠️ 限额来自缓存」（图标至少黄色），
  没有缓存则本次不占行、只由图标提示；任一窗口或月度剩余 ≤5% 红、≤20% 黄，`limited=false` 时窗口不再按历史 `used/cap` 着色，
  但月度剩余比例照常参与（≤20% 黄、≤5% 红）。缓存只存原始额度，改 `cch_cmdcode_month_cap` 不需重新取数、显示即时重算。
- CCHP 里 `balance.status=unsupported` 的 provider（如 CommandCode）不再计入刷新目标、也不做单账户投影，
  因此不再出现「⚠️ 部分余额未刷新」「⚠️ 单账户余额不可用」，也不会仅因此让面板图标转黄；这类供应商请用 `cmdcode` 条目单独展示限额。
