#!/usr/bin/env python3
"""luno-surge 脚本共用的输出脱敏与出网凭据边界。

`surge_ios.py`（HTTP 回退）、`surge_cli.py`（Controller 客户端）、
`test_policy_descriptor.py`（描述符探测）三个入口共用本模块，避免各写一份实现。

两条路径分开处理：
  * `redact_obj(value)`：**结构化**结果（dict/list）按敏感键**递归整值替换**——命中键的整个值
    （含嵌套对象／数组／数组元素）替换为 `"<redacted>"`，不依赖值的文本形态；
  * `redact_text(text)`：**文本**路径（raw 输出、render 输出、错误、profile diff、`--check`
    校验服务返回等）逐条规则替换；
  * `redact(value)`：统一入口——dict/list 走结构化递归（字符串值在序列化前过输出边界），
    其余走输出边界入口（`redact_boundary()`）。

已知残余与边界（发布者登记 2026-10-12；**不宣称任意文本无秘密**；各项＝对象／理由／改判条件／责任人＝主助理／范围限定。**输出类条目未单列范围时，共用「仅作已授权投影后的诊断展示，不回导、不作保类型 API、路径执行、哈希验证或机器决策」**）：
  * **裸值逗号续段**：对象＝非 JSON 文本路径。敏感键的**无引号值**按逗号／分号／空白截断，续段可能原样保留
    （实测 `password=aaa,bbb` → `password=<redacted>,bbb`）——**输入无需自带 `<redacted>`**，普通含逗号的裸值即触发。
    理由＝闭合须改规范输出形，而模块规范输出本身含逗号分隔结构，需另行区分值边界与诊断字段，并重验既有正控、幂等与输出契约。
    改判条件＝真实来源出现此类携密续段，或规范输出契约变更。范围限定＝只作诊断纵深防护，不接收未投影的含秘密原文。
  * **长值形态**：对象＝**未命中敏感键及其他形态规则**的长串（`NAME=<40+ 字符>`，紧邻 `=`）不抹除；`NAME = …`（带空格）会抹。
    理由＝长不透明串规则前视排除 `=`，去掉前视无证据表明不扩大误抹。改判条件＝出现该形态的真实秘密，或得到不显著扩大误抹的收敛改法。
  * **长路径／文件名过抹**：对象＝`_BLOB`。理由＝保留长不透明串兜底，当前缺可靠的秘密／非秘密区分依据。
    改判条件＝实际定位受损，或出现可靠区分契约。范围限定＝诊断展示，**不用于路径执行、回导、哈希验证或机器决策**。
  * **数字形非代理行过抹**：对象＝`_PROXY_LINE_ANY`。理由＝保留「未列协议端口后整段隐藏」，暂不引入未经验证的协议判别。
    改判条件＝真实误判影响诊断，或取得可靠协议上下文契约。范围限定＝诊断展示，不据脱敏输出判断配置等价。
  * **分隔段扩展的过抹**：对象＝`_SEG_WORDS` 分隔段匹配。含敏感词段的非秘密元数据（`api_key_format`／`token_count`／
    `cookie_policy`／`signature_algorithm` 等）会被整值隐藏。理由＝分隔段扩展是真实凭据泄漏面的兜底，收窄需可靠上下文判据。
    改判条件＝出现真实误抹证据（诊断受损）。范围限定＝不用于配置等价、回导或机器决策。
  * **`_PEM_BLOCK` 隐藏 `PUBLIC KEY`**：对象＝`_PEM_BLOCK`。理由＝保留宽 `KEY` 块规则，以免漏掉非标准私钥块名。
    改判条件＝出现需保留公钥块的场景。
  * **未命中键名／形态的值**：对象＝未知短值与身份词（`_PLAIN_WORDS`）分隔段边界。理由＝模块不是秘密识别器，
    扩大通用键／值匹配会连坐普通字段（如 `USER_AGENT`）。改判条件＝实际来源出现未覆盖的秘密形态，或覆盖契约扩大。
    范围限定＝只接收已授权投影，输出兜底不替代读取关口。
  * **输入侧不做机械拦截**：对象＝模块整体。理由＝本模块只做输出边界，机器拦截需在命令与工具层。
    改判条件＝平台提供可配置的输出／命令拦截能力。范围限定＝**不得据此宣称「自由 Shell 已被机械限制」**。
  * **读取契约识别集边界**：对象＝`tests/test-redact.py` 的命令分类器与字段解析器（未识别形态返回 `OPAQUE` 并被跳过）。
    理由＝只验当前模板形态，不实现通用 Shell／SQL 解析器。改判条件＝模板新增未识别命令／包装／字段表达式，或将其用于实际命令强制拦截。
    范围限定＝离线模板契约，未识别形态须人工审 diff，不得称已程序化覆盖。
  * **跨行敏感容器整份 fail-closed**：对象＝文本路径中跨物理行的敏感容器。理由＝逐行规则无法可靠判断续行归属，保留整份隐藏以避免漏抹，代价是普通诊断字段一并丢失。
    改判条件＝诊断确受损，或取得经验证的跨行解析契约。范围限定＝诊断展示，不据输出判断配置等价、不回导、不作机器决策。
  * **模板自声明面**：对象＝读取契约测试从模板声明语提取的字段集合。理由＝声明面与模板同源，不具备独立授权判据，声明语变化仍须人工审核。
    改判条件＝声明字段或读取范围变化，或取得独立授权字段清单。范围限定＝离线模板契约，**不代表实际命令受机械拦截**；人工审 diff 必须核声明变化是否获授权。

敏感键集合沿用既有 `redact()` 的键组，并补两种形态：
  * **前缀驼峰**：`proxyPassword`／`apiKey`（前缀为字母数字串且后随大写字母）；
  * **复数**：`tokens`／`passwords`。
键组另含 `uuid`（TUIC v5 的用户标识、VMess 等以 `uuid=` 书写时）与 `auth-key`／`auth_key`
（Tailscale 登录密钥），2026-10-12 对照官方手册补入。
文本路径另补两类缺口：
  * Surge Profile **代理行**：`NAME = https, host, 443, user, <pass>`（凭据字段位置按协议类型表，
    兼容真实换行与其 JSON 转义形式 `\\n`，兼容 `git diff` 的 `+`／`-` 行首）；
  * **内层转义 JSON**：`{\"token\":\"X\"}`（键引号与值引号允许反斜杠转义）。

另导出出网凭据边界 `api_base_problem(base, label)`：scheme／URL userinfo／非本机主机三项统一
门禁，供 HTTP 回退与描述符探测共用。凭据只来自 `SURGE_API_KEY`／`--password-stdin`，故 URL
内嵌 userinfo 一律拒绝。
"""
import json
import os
import re
from urllib.parse import urlparse

REDACTED = "<redacted>"

_LOOPBACK = ("127.0.0.1", "localhost", "::1")

_AUTH = r"(?:authorization|proxy-authorization|auth|authz)"
_AUTH_SCHEMES = r"(?:bearer|basic|digest|negotiate|ntlm|aws4-hmac-sha256)"
# **凭据词**（可参与「分隔段」匹配，见下）。
_SEG_WORDS = (r"(?:password|passwd|pwd|psk|uuid|auth[-_]?key|private[-_]key"
              r"|token|api[-_]?key|x[-_]key|secret|credential|signature|sig"
              r"|access[-_]?key[-_]?id|base64|cookie)")
# **身份词**：只按**整键**命中，不参与分隔段匹配。`user`／`username` 属身份而非凭据，且既有正控
# `{"user-agent": "Surge/5.0"}`（`_SENSITIVE_KEY` 与文本路径两侧）要求该键名**输出不变**——
# 若让身份词也能吃 `-`／`_` 后缀，`USER_AGENT`／`user-agent` 会被连坐抹除（新增误抹，非加抹）。
# 代价（登记）：`DB_USER`／`USER_NAME` 一类「分隔段＋身份词」不抹除。
_PLAIN_WORDS = r"(?:username|user)"
_SENSITIVE = r"(?:" + _SEG_WORDS + r"|" + _PLAIN_WORDS + r")"

# 前缀驼峰：字母数字串后紧跟**大写**字母（即敏感词首字母）。两处 `(?-i:)` 关掉外层的
# IGNORECASE——否则 `[A-Z]` 退化成任意字母，前缀会把敏感词本身吃掉再回溯。
_CAMEL = r"(?:(?-i:[A-Za-z0-9]+)(?=(?-i:[A-Z])))?"
_PLURAL = r"s?"
# 结尾计数后缀（`token1`／`password2`／`api-key3`）：真实配置与合成夹具都会出现「同名键＋序号」，
# 不带后缀的键组会把这类键整体漏掉（2026-10-12 R1 第③类复现）。只收数字后缀、至多 3 位，
# 方向是**加抹**（更多键被判为敏感），不引入任何放行分支。
_KEYNUM = r"[0-9]{0,3}"
# **分隔段**（2026-10-12 R2，Fix B）：`_`／`-` 连接的键名段与敏感词**同权**——`POSTGRES_PASSWORD`
# 里的 `PASSWORD`、`AWS_SECRET_ACCESS_KEY` 里的 `SECRET`、`github_token` 里的 `token`、
# `MYSQL_ROOT_PASSWORD` 里的 `PASSWORD` 都算命中（真实事故形态：`env | grep -i postgres` 把
# `POSTGRES_PASSWORD` 带进会话；改前只有裸敏感词键（`PASSWORD`／`API_KEY`）会被抹）。
#   · `_SEG_PRE`：词前可有任意多个「段＋分隔符」（`POSTGRES_`／`MYSQL_ROOT_`／`AWS_`）；
#   · `_SEG_POST`：词后可有任意多个「分隔符＋段」（`_KEY`／`_ACCESS_KEY`／`_VALUE`）。
# 方向是**加抹**（更多键被判为敏感），不引入任何放行分支；`MONKEY`（`key` 不作裸子串）、`PATH`／
# `HOSTNAME`／`PORT`／`A_B_C` 等非敏感键名不受影响（无敏感段即不命中）。
_SEG_PRE = r"(?:(?-i:[A-Za-z0-9]+)[-_])*"
_SEG_POST = r"(?:[-_](?-i:[A-Za-z0-9]+))*"
_SEGMENTED = (r"(?:" + _SEG_PRE + r"(?:" + _SEG_WORDS + r")" + _PLURAL + _KEYNUM
              + _SEG_POST + r")")
_PFX = r"(?P<pfx>" + _CAMEL + r")"
_KEY = r"(?P<k>(?:" + _SEGMENTED + r"|(?:" + _PLAIN_WORDS + r")" + _PLURAL + _KEYNUM + r"))"
_AUTH_WORD = r"(?P<ak>(?:" + _AUTH + r")" + _PLURAL + r")"

# 引号可被反斜杠转义（内层 JSON 串）：键引号与值引号两侧都允许 `\`。
_QUOTE = r"(?:\\*[\"'])?"
_DQ = r'\\*"(?:[^"\\]|\\.)*\\*"'
_SQ = r"\\*'(?:[^'\\]|\\.)*\\*'"
# 值形态：前引号＋值体＋后引号。值体**非贪心**：贪心会把尾引号前的 `\` 吃进值体，
# `\"X\"` 于是只剩尾部 `"`，脱敏后转义不对称。
_QUOTED_VALUE = re.compile(r"(?s)(?P<lead>\\*[\"'])(?P<body>.*?)(?P<tail>\\*[\"'])$")
_VALUE_TAIL_BREAK = ",}]) \t\r\n"


def _value_cut(body):
    """内层转义串里**真实值的结束位置**：转义引号之后紧跟分隔符或已到值体末尾。

    `{"data": "{\\"token\\":\\"X\\"}"}` 这类「内层 JSON 串」里，正则按转义对贪婪切分会把
    内层串的闭合 `"}` 一并吃进值体；按下标重切可把该残片还原为原样保留的尾部，
    从而既不漏抹也不产出被破坏的转义。普通值体（含 `"a\\"b"` 这种值内含转义引号）
    找不到这样的切点，一律返回 None、保持原行为。
    """
    for index in range(len(body) - 1):
        if body[index] == "\\" and body[index + 1] in "\"'":
            after = body[index + 2:index + 3]
            if not after or after in _VALUE_TAIL_BREAK:
                return index
    return None


def _quote_swap(value):
    """只替换引号值**内部**，两侧引号（含其转义反斜杠）与重切出的残片原样保留。"""
    matched = _QUOTED_VALUE.match(value)
    if not matched:
        return REDACTED
    lead, body, tail = matched.group("lead"), matched.group("body"), matched.group("tail")
    cut = _value_cut(body)
    if cut is not None:
        tail = body[cut:] + tail
    return lead + REDACTED + tail


def _key_label(matched):
    """命中文本＝可选驼峰前缀＋敏感键（含复数），替换时须整体保留。"""
    return matched.group("pfx") + matched.group("k")


def _quoted_marker(key_quote, text=REDACTED):
    """按命中键引号的转义形态产出标记：内层 JSON 串里须同样转义，否则输出不再是合法串。"""
    inner = '\\"' if "\\" in key_quote else '"'
    return "%s%s%s" % (inner, text, inner)


# 1a) 认证字段的引号值（JSON/结构化形态；键与值之间允许换行缩进，覆盖多行 JSON）。
#     双引号值与单引号值**分别**按各自引号的转义规则匹配——用一种引号的字符类排他，
#     会让「双引号值里含单引号」这种合法 JSON 整个漏抹。
_AUTH_QUOTED = re.compile(
    r"(?i)(?P<qk>" + _QUOTE + r")(?:\b|(?<=\\n))" + _PFX + _AUTH_WORD + r"(?P=qk)"
    r"(?P<sep>\s*[:=]\s*)(?P<val>" + _DQ + r"|" + _SQ + r")")


def _auth_quoted(matched):
    return "%s%s%s%s%s" % (matched.group("qk"), matched.group("ak"), matched.group("qk"),
                           matched.group("sep"), _quote_swap(matched.group("val")))


# 1b) 认证字段带方案词（Bearer/Basic/Digest/...）→ 取该字段整行值，覆盖逗号多段与 Digest 参数
_AUTH_SCHEME = re.compile(
    r"(?i)(?P<qk>" + _QUOTE + r")(?:\b|(?<=\\n))" + _PFX + _AUTH_WORD + r"(?P=qk)"
    r"(?P<sep>[ \t]*[:=][ \t]*)(?P<val>" + _AUTH_SCHEMES + r"\b[^\n]*)")


def _auth_scheme(matched):
    return '%s%s%s%s"<redacted>"' % (matched.group("qk"), matched.group("ak"),
                                     matched.group("qk"), matched.group("sep"))


# 1c) 其余认证字段值：止于逗号/分号/换行，**不**把 `}`/`]` 当终止符
#     （否则 `Authorization: SYNTH}SECRET` 会在闭合符处截断、后半段泄漏）。
#     本规则只处理「已抹除标记」这一种残留：标记由本步上一条规则产出，不能信任输入中
#     的同形字符串，故一律丢弃标记之后的全部残余（含看似诊断字段的内容）——
#     即「认证裸行整段视为敏感值」的输出契约；仅当残余**全部**是结构闭合符时才保留，
#     以免吃掉 JSON 的 `}`。
_AUTH_BARE = re.compile(
    r"(?i)(?P<qk>" + _QUOTE + r")(?:\b|(?<=\\n))" + _PFX + _AUTH_WORD + r"(?P=qk)"
    r"(?P<sep>[ \t]*[:=][ \t]*)(?P<val>[^\n,;]+)")
_MARKERS = ('"<redacted>"', "'<redacted>'", '\\"<redacted>\\"', "\\'<redacted>\\'")


def _auth_bare(matched):
    value = matched.group("val")
    head = "%s%s%s%s" % (matched.group("qk"), matched.group("ak"), matched.group("qk"),
                         matched.group("sep"))
    for marker in _MARKERS:
        if value.startswith(marker):
            rest = value[len(marker):]
            keep = rest if rest and set(rest) <= set("}] \t\r\\") else ""
            return head + marker + keep
    return head + '"<redacted>"'

# 2) 敏感键的数组/对象值（如 {"tokens":["A","B"]}）：整段值替换
_KEY_CONTAINER = re.compile(
    r"(?i)(?P<qk>" + _QUOTE + r")(?:\b|(?<=\\n))" + _PFX + _KEY + r"(?P=qk)"
    r"(?P<sep>\s*[:=]\s*)(?P<val>\[[^\[\]]*\]|\{[^{}]*\})")
_CONTAINER_VALUE = re.compile(r"(?s)(?P<lead>[\[{])(?P<body>.*)(?P<tail>[\]}])$")


def _container_cut(body):
    """内层转义串里容器**真实闭合符**的位置：其后只剩闭合符／转义／空白。"""
    for index in range(len(body) - 1, -1, -1):
        if body[index] in "}]" and (index == 0 or body[index - 1] != "\\"):
            rest = body[index:]
            if set(rest) <= set("}]{[]\"'\\ \t\r"):
                return index
    return None


def _container_swap(value):
    """容器整体替换；内层转义串里被正则多吃的一层残片按原样保留。"""
    matched = _CONTAINER_VALUE.match(value)
    if not matched:
        return REDACTED
    lead, body, tail = matched.group("lead"), matched.group("body"), matched.group("tail")
    cut = _container_cut(body)
    if cut is not None:
        return lead + REDACTED + body[cut:] + tail
    return lead + REDACTED + tail


def _key_container(matched):
    return "%s%s%s%s[%s]" % (matched.group("qk"), _key_label(matched), matched.group("qk"),
                             matched.group("sep"),
                             _quoted_marker(matched.group("qk"), _container_swap(
                                 matched.group("val")).strip("[]{}")))


# 2b) 容器值的**形状兜底**（fail-closed）：敏感键后是容器开头、但形态不是上面能整值替换的
#     单层容器（嵌套 `[[ … ]]`／`{ a = b }`／未闭合）时，把**该逻辑行剩余部分整段隐藏**，
#     不猜内容、不按字段外形放行。输出沿用 `_key_container()` 的规范形（`["<redacted>"]`），
#     故与 2) 规则互为幂等；已由 2) 处理完的单层容器不会走到这里，内层 JSON 串的后续键也
#     不会被吃掉。
#     `rest` **必须从容器开头起匹配**（2026-10-12 R1 第③类复现）：旧式 `rest` 接受任意裸值，
#     于是 `psk = A, token = { B }` 这类「前置裸值键＋同行后续键」会被本规则整行吃进匹配并
#     原样返回——`re.sub` 的扫描位置随即跳到该匹配之后，同行后续敏感键再也轮不到任何规则，
#     整行泄漏；锚定容器开头后，非容器 `rest` 根本不进本规则，扫描位置不被消耗。
_KEY_CONTAINER_TAIL = re.compile(
    r"(?i)(?P<qk>" + _QUOTE + r")(?:\b|(?<=\\n))" + _PFX + _KEY + r"(?P=qk)"
    r"(?P<sep>\s*[:=]\s*)(?P<rest>[ \t]*[\[{](?:(?!\\n)[^\n])*)")
_CONTAINER_LEAD = re.compile(r"^[ \t]*[\[\{]")


def _key_container_tail(matched):
    rest = matched.group("rest")
    if _CONTAINER_LEAD.match(rest) is None:
        return matched.group(0)
    if (sum(rest.count(c) for c in "[{") > 1
            or sum(rest.count(c) for c in "]}") == 0):
        return "%s%s%s%s[%s]" % (matched.group("qk"), _key_label(matched), matched.group("qk"),
                                 matched.group("sep"), _quoted_marker(matched.group("qk")))
    return matched.group(0)


# 3) 敏感键的带引号值（键可带引号，值支持转义引号）
_KEY_QUOTED = re.compile(
    r"(?i)(?P<qk>" + _QUOTE + r")(?:\b|(?<=\\n))" + _PFX + _KEY + r"(?P=qk)"
    r"(?P<sep>\s*[:=]\s*)(?P<val>" + _DQ + r"|" + _SQ + r")")


def _key_quoted(matched):
    return "%s%s%s%s%s" % (matched.group("qk"), _key_label(matched), matched.group("qk"),
                           matched.group("sep"), _quote_swap(matched.group("val")))


# 3b) 引号尾段兜底（fail-closed，**非代理行**面）：敏感键的值里出现引号、但形态不是 3) 能整值
#     替换的**闭合**引号值时整段隐藏。两类：值以引号开头却没在本逻辑行内闭合（`password="a,b`
#     被裸值规则在逗号处截断、尾段 `b` 因此外泄）；或裸值之后紧跟引号字段（`password=a,"b,c"`）。
#     判据与 `_redact_fields()` 的引号尾段兜底同口径（2026-10-12 F6）；已闭合且闭合符后是
#     分隔符／行尾的引号值交由 3) 处理，故内层转义 JSON 的后续键不被吃掉。
_KEY_QUOTE_TAIL = re.compile(
    r"(?i)(?P<qk>" + _QUOTE + r")(?:\b|(?<=\\n))" + _PFX + _KEY + r"(?P=qk)"
    r"(?P<sep>[ \t]*[:=][ \t]*)(?P<rest>(?:(?!\\n)[^\n])*)")
_LEAD_QUOTED = re.compile(r"^(?P<q>\\*[\"'])")
# 「整段就是规范标记容器」的形态（2) 规则的输出形）：只有它才跳过 3b) 兜底。判据是整段
# fullmatch，不再看「首段是否含标记」，以免输入自带标记就自我豁免。
_CANONICAL_MARKER_LINE = re.compile(
    r"^[ \t]*[\[{][ \t]*\\*[\"']?" + re.escape(REDACTED) + r"\\*[\"']?[ \t]*[\]}][ \t\r]*$")


def _key_quote_tail(matched, allow_container=False):
    rest = matched.group("rest")
    head = "%s%s%s%s" % (matched.group("qk"), _key_label(matched), matched.group("qk"),
                         matched.group("sep"))
    if not rest or not any(q in rest for q in "\"'"):
        return matched.group(0)
    # 只豁免**整段即规范标记容器**的形态（`[<redacted>]`／`["<redacted>"]`／其转义引号变体）。
    # 旧式「首段含 `REDACTED` 就返回原文」的短路可被输入自身满足——`password="<redacted>,<标记>`
    # 的首段正是 `<redacted>`，短路后标记原样输出（2026-10-12 R1 第②类复现）。fullmatch 判据
    # 多一个字符（尾随内容／逗号／别的元素）即失效，照旧整段隐藏；2) 规则产出的规范形仍幂等。
    if _CANONICAL_MARKER_LINE.match(rest):
        return matched.group(0)
    # **容器值不属于本规则**，但该豁免**只在整份输入已确认为合法 JSON 文档时成立**
    # （2026-10-12 R3 定向复审判 N1）：值位置是容器开头时不适用尾段兜底——容器形态由 2)／2b)
    # **整值**处理（单层容器 → 规范形；嵌套／未闭合 → 同形兜底），本规则只针对**引号值**尾段
    # （见 3b 的判据）。改前此处落到下面的 `head + REDACTED`：2) 刚产出的规范形连同同行后续的
    # JSON 结构被整段吃掉，`{"tokens": ["A", "B"]}` → `{"tokens": <redacted>`（丢闭合符、占位符
    # 未加引号）⇒ 不再是合法 JSON，违反「合法 JSON 走结构化分支、输出保持可解析」的契约（R2 发布
    # 方实测复现）。
    # 但豁免**不得反过来无条件成立**（R2 引入时即为无条件，R3 复审判 N1）：**「容器开头」本身
    # 不足以排除尾段秘密**——非 JSON 文本里 2)／2b) 的括号计数会被引号内字符骗过
    # （`token=["x]", "ZQA"` 的 `]`、`token={"x": "}", "ZQB"` 的 `}` 都落在引号里），或用
    # `_KEY_BARE` 剪掉已闭合容器后只剩「携密引号尾段」（`token=[ "a" ], "ZQC"`），三条形态的尾段
    # 标记都原样输出且不幂等（R3 发布方实测复现）。合法 JSON 文档则相反：括号必须配对，「容器
    # 开头」确实意味着尾段属于容器值，且该路径另有结构化／token 路由保证不残留。
    # 故豁免改由 `redact_text()` 仅在 `_json_document(source) is not None` 时传入
    # `allow_container=True`；其余输入一律落回下面的 `head + REDACTED`（fail-closed，方向是加抹）。
    # 本条不是放宽：合法 JSON 路径的容器值仍由 2)／2b) 整值抹除（证据：R2 逐字节形状用例）。
    if allow_container and _CONTAINER_LEAD.match(rest) is not None:
        return matched.group(0)
    lead = _LEAD_QUOTED.match(rest)
    if lead is not None:
        after = rest[len(lead.group("q")):]
        close = after.find(lead.group("q")[-1])
        if close >= 0 and (not after[close + 1:] or after[close + 1] in _VALUE_TAIL_BREAK):
            return matched.group(0)
    return head + REDACTED


# 4) 敏感键的裸值：以逗号/分号/空白为界；值内**不得跨字面 `\n`**（F8：`\n` 是记录边界，
#    否则 `\nauth-key=X\nhostname=h` 会把后续 `hostname` 一并吞进秘密值）。
_KEY_BARE = re.compile(r"(?i)(?:\b|(?<=\\n))" + _PFX + _KEY
                       + r"\b\s*[:=]\s*(?:(?!\\n)[^\s,;])+")


def _key_bare(matched):
    return _key_label(matched) + "=<redacted>"


# 5) 已知 token 前缀（含云厂商 key id 前缀：`AIza`＝Google、`AKIA`／`ASIA`＝AWS）
_TOKEN_PREFIX = re.compile(r"(?i)\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}"
                           r"|\bAIza[0-9A-Za-z_\-]{20,}"
                           r"|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")


# 6) Surge Profile 代理行：`NAME = <type>, <host>, <port>, <凭据...>`。
#    位置表按类型给凭据位（类型后 0 基下标 ＋ 连续个数）。**已对照官方手册核验凭据语法与键名**
#    （2026-10-12 抓取 `policies/overview.html`、`http.html`、`socks5.html`、`ssh.html`、
#    `trojan.html`、`snell.html`、`vmess.html`、`hysteria2.html`、`tuic.html`；原文：「For all
#    server-based proxy types, the first two arguments are the server hostname and port. The
#    remaining parameters are written as key=value pairs.」）：
#      · http/https/socks5/socks5-tls 支持端口后的**可选位置式** `[, <username>, <password>]` ⇒ (2,2)；
#      · ssh/trojan/snell/vmess/hysteria2/tuic 官方用**命名凭据参数**（`username=`／`password=`／
#        `private-key=`／`psk=`／`token=`），官方只给示例顺序、**未保证**命名参数恒定处于下标 2
#        ⇒ 本表对后六类保留 (2,1)（ssh 为 (2,2)）的**防御性位置兜底**，不代表官方保证该下标或支持
#        裸位置式凭据；任意位置的命名凭据由上面的裸键值规则处理。
#    未列类型（`ss`／`tuic-v5`／`h2-connect`／`anytls`／`masque` 等）由本表之下的**形状兜底规则**
#    `_PROXY_LINE_ANY` 处理：协议名不在表内时，按 `NAME = <类型>, <host>, <port>, …` 形状识别，
#    并把**端口之后的一切整段抹除**（fail-closed；host/port 保持可读）。位置表仍只列上表类型。
_PROXY_CREDENTIALS = {
    "http": (2, 2), "https": (2, 2), "socks5": (2, 2), "socks5-tls": (2, 2), "ssh": (2, 2),
    "trojan": (2, 1), "snell": (2, 1), "vmess": (2, 1), "hysteria2": (2, 1), "tuic": (2, 1),
}
# 行首：真行首／`\n`（内层转义串）／行内引号之后，可选 `git diff` 的 `+`／`-` 标记。
_PROXY_LINE = re.compile(
    r"(?im)(?P<pfx>(?:^|[ \t]|\\n|[\"'])[ \t]*(?:[+-][ \t]*)?[ \t]*[\w.\-\u0080-\U0010ffff]+[ \t]*=[ \t]*)"
    r"(?P<type>" + "|".join(sorted(_PROXY_CREDENTIALS, key=len, reverse=True)) + r")"
    r"(?P<sep>[ \t]*,[ \t]*)"
    r"""(?P<fields>(?:(?!\\n)[^\n"']|"(?:\\[\s\S]|[^"\\])*(?:"|\\?$)|'(?:\\[\s\S]|[^'\\])*(?:'|\\?$))*)""")


def _redact_fields(fields, start, count):
    """按下标整值替换逗号分隔字段，保留原有分隔符与空白对齐。

    **不放行「按字段外形跳过」**（2026-10-12 定向审查 F1／F2）：位置式口令本身写成白名单
    形（如 `sni=…`）会被漏抹；更确定的是可携密容器参数（`headers=`／`ws-headers=` 里的
    Cookie）会由**抹除**变成**保留**——已用基线对照实测为新增漏抹。本模块对秘密面一律
    fail-closed：宁可多抹，不按外形猜测。
    """
    # host/port 已经定位；**含引号的剩余尾段不再猜字段边界**（F6，2026-10-12）：官方明写
    # 「Quote a value if it contains commas」，而 `split(",")` 会把 `"a,b"` 拆成两段、只抹掉
    # 头部而泄漏尾段。此处不解析引号是否合法：只要尾段出现任一引号，整段按凭据抹除
    # （host/port 与更前面的字段保持可读）。代价＝该行尾段的诊断参数一并隐藏，属保守过抹。
    prefix = fields.split(",", start)
    if len(prefix) > start and any(q in prefix[-1] for q in "\"'"):
        return ",".join(prefix[:-1]) + ", " + REDACTED
    parts = fields.split(",")
    if len(parts) <= start:
        return fields
    for index in range(start, min(start + count, len(parts))):
        if not parts[index].strip(" \t"):
            continue
        lead = len(parts[index]) - len(parts[index].lstrip(" \t"))
        tail = len(parts[index]) - len(parts[index].rstrip(" \t"))
        parts[index] = " " * lead + REDACTED + " " * tail
    return ",".join(parts)


def _proxy_line(matched):
    start, count = _PROXY_CREDENTIALS[matched.group("type").lower()]
    # 纯文本路径按完整字段处理：**不得**在行尾猜测并剔除 JSON 包装字符——那会把真实字段的
    # 引号尾缀当包装剥掉、导致最后凭据位被跳过（2026-10-11 定向复审判 N4）。JSON 文档的包装
    # 由 `redact_boundary()` 的字符串 token 层处理。
    return "%s%s%s%s" % (matched.group("pfx"), matched.group("type"), matched.group("sep"),
                         _redact_fields(matched.group("fields"), start, count))


# 6b) 未列协议的**形状兜底**（fail-closed）：协议名不在位置表内时，只要行形如
#     `NAME = <类型>, <host>, <端口数字>, <其余…>` 就把**端口之后的全部内容**整段抹除——不猜
#     哪个字段是凭据，也不为保留诊断参数而放行任何字段（与 2026-10-12 定向审查 F1／F2 同一
#     判据：秘密面宁可多抹）。协议名与 host／port 保持可读；端口位须是**完整字段**（其后为
#     行尾／逗号），故 `Group = select, A, B` 类策略组行与 `dns-server = system, 8.8.8.8, 1.1.1.1`
#     类多值行不受影响。
# 排除的是**完整的已列协议字段**（协议名＋紧随的逗号），不是协议名前缀：按 `\b` 排除前缀会把
# 复合名（`tuic-v5`／`socks5-udp`／`https-tls`）连前缀一起排除、整行落空（2026-10-12 R1 第①类
# 复现）。长名优先排序仍保留，避免 `socks5-tls` 被截成 `socks5`。此处只判「是不是已列表的整
# 字段」，仍不按字段外形放行任何内容。
_UNLISTED_TYPE = (r"(?!(?:" + "|".join(sorted(_PROXY_CREDENTIALS, key=len, reverse=True))
                  + r")[ \t]*,)")
_PROXY_LINE_ANY = re.compile(
    r"(?im)(?P<pfx>(?:^|[ \t]|\\n|[\"'])[ \t]*(?:[+-][ \t]*)?[ \t]*[\w.\-\u0080-\U0010ffff]+[ \t]*=[ \t]*)"
    r"(?P<type>" + _UNLISTED_TYPE + r"[a-z][a-z0-9\-]*)(?P<sep>[ \t]*,[ \t]*)"
    r"(?P<host>[^,\n\"']+?)(?P<portsep>[ \t]*,[ \t]*)(?P<port>[0-9]{1,5})"
    r"(?=[ \t]*(?:,|\\n|$))(?P<rest>(?:(?!\\n)[^\n])*)")


def _proxy_line_any(matched):
    head = "%s%s%s%s%s%s" % (matched.group("pfx"), matched.group("type"), matched.group("sep"),
                             matched.group("host"), matched.group("portsep"),
                             matched.group("port"))
    rest = matched.group("rest")
    if not rest.strip(" \t,\r"):
        return head + rest
    return head + ", " + REDACTED


# 2c) Cookie 字段（**非代理行**上下文，即 `headers=Cookie:…` 以外的出现形态）：`Cookie:`／
#     `Set-Cookie:`／`cookie=` 一律整值抹除；值以引号闭合时按引号形态替换，其余**隐藏到逻辑
#     行末**（Cookie 值可含空格与分号，按标点切分必漏尾段；宁可连同同行后续参数一起隐藏）。
_COOKIE = re.compile(
    r"(?i)(?P<qk>" + _QUOTE + r")(?:\b|(?<=\\n))(?P<ck>set[-_]?cookie|cookie)(?P=qk)"
    r"(?P<sep>[ \t]*[:=][ \t]*)(?P<val>" + _DQ + r"|" + _SQ + r"|(?:(?!\\n)[^\n])*)")


def _cookie(matched):
    head = "%s%s%s%s" % (matched.group("qk"), matched.group("ck"), matched.group("qk"),
                         matched.group("sep"))
    value = matched.group("val")
    if value[:1] in ("\"", "'"):
        return head + _quote_swap(value)
    return head + REDACTED


# 7) 与键名无关的秘密面（fail-closed）：URL userinfo、PEM 私钥块、JWT、长不透明串。
#    这些形态的**值本身就是凭据**，未列键／未知键下同样抹除——不按字段外形放行。
_USERINFO = re.compile(r"(?i)(?P<scheme>\b[a-z][a-z0-9+.\-]*://)(?P<ui>[^/\s?#@\"'\\]*@)")
_PEM_BLOCK = re.compile(r"-----BEGIN [A-Z0-9 ]{0,40}KEY[A-Z0-9 ]{0,20}-----[\s\S]*?"
                        r"-----END [A-Z0-9 ]{0,40}-----")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{2,}")
_BLOB = re.compile(r"(?<![A-Za-z0-9+/_\-=])[A-Za-z0-9+/_\-]{40,}={0,2}(?![A-Za-z0-9+/_\-=])")


def _userinfo(matched):
    return matched.group("scheme") + REDACTED + "@"


# 1) Keystore 段：段内的**值整段隐藏**（键名与行结构保留，便于阅读 diff）。段内值的形态不确定
#    （`base64=…`／裸 blob 行／其它键），故不按字段外形放行；无分隔符的行整行隐藏。
_KEYSTORE_SECTION = re.compile(r"(?im)^(?P<hdr>[ \t]*\[keystore[^\]\n]*\][ \t]*(?:\r?\n|\Z))"
                               r"(?P<body>(?:(?!^[ \t]*\[)[\s\S])*)")


def _keystore_values(text):
    def hide(matched):
        hidden = []
        for line in matched.group("body").split("\n"):
            cut = min([index for index in (line.find("="), line.find(":")) if index >= 0],
                      default=-1)
            if not line.strip():
                hidden.append(line)
            elif cut < 0:
                hidden.append(REDACTED)
            else:
                hidden.append(line[:cut].rstrip() + " = " + REDACTED)
        return matched.group("hdr") + "\n".join(hidden)

    return _KEYSTORE_SECTION.sub(hide, str(text))


_RULES = (
    # 代理行**先于**其它规则（F6，2026-10-12）：裸键值规则会先吃掉开引号（`password="a,b` 的
    # `"` 被当作值首字符吞掉），使尾段兜底看不到引号、逐段切分后泄漏尾段。
    (_PROXY_LINE, _proxy_line),
    (_PROXY_LINE_ANY, _proxy_line_any),
    (_AUTH_QUOTED, _auth_quoted),
    (_AUTH_SCHEME, _auth_scheme),
    (_AUTH_BARE, _auth_bare),
    (_COOKIE, _cookie),
    (_KEY_CONTAINER, _key_container),
    (_KEY_CONTAINER_TAIL, _key_container_tail),
    (_KEY_QUOTED, _key_quoted),
    (_KEY_QUOTE_TAIL, _key_quote_tail),
    (_KEY_BARE, _key_bare),
    (_PEM_BLOCK, lambda matched: REDACTED),
    (_JWT, lambda matched: REDACTED),
    (_USERINFO, _userinfo),
    (_BLOB, lambda matched: REDACTED),
    (_TOKEN_PREFIX, lambda matched: REDACTED),
)

# 结构化路径的键名判据：与文本路径**同源**（同一组 `_KEY` 词法与分隔段扩展），不得各写一套。
_SENSITIVE_KEY = re.compile(
    r"^(?:" + _CAMEL + r"(?:" + _SEGMENTED
    + r"|(?:" + _PLAIN_WORDS + r")" + _PLURAL + _KEYNUM
    + r"|(?:" + _AUTH + r")" + _PLURAL + _KEYNUM + r"))$", re.I)


# 7) 跨**物理行**的敏感容器（fail-closed，定向）：规则流水线按逻辑行（`\n` 与字面 `\\n` 为界）
#    工作，`token = [ [` 这类「首行只开容器、续行才是内容」的形态只隐藏首行，续行原样输出
#    （2026-10-12 R1 第④类及其引号变体复现）。判据＝物理行内「敏感键 + `:`/`=` + 可选引号 +
#    容器开头」且该行括号**不平衡**（开多于闭）⇒ 判为泄漏面，整份返回 `REDACTED`：不猜续行
#    内容、不按字段外形放行。**代价（登记）**：命中的整份文本连普通诊断字段一起变成单一
#    `<redacted>`，不再保留可读结构；正常 profile 与各布局合法 JSON 不受影响（合法 JSON 走
#    `redact_boundary()` 的结构化分支、不经本判据，同行闭合的容器走既有规则）。
#    **`rest` 必须从容器开头起匹配**（2026-10-12 R3 定向复审判 N2）：旧式 `rest` 接受任意裸值，
#    于是物理行里「前置裸值键 ＋ 同行后续敏感容器键」的形态（`psk=A, token = [ [` ＋ 续行内容）
#    被**前置键**的匹配整行吃进——该 `rest` 里确实含容器开头，但非重叠扫描从 `psk` 起算，
#    `token` 键不再单独成匹配，`<redacted>` 整份 fail-closed 因此不触发、续行原样输出（发布方
#    实测复现；对照组「单独跨行嵌套容器」正确整份 fail-closed）。锚定容器开头后，非容器 `rest`
#    根本不进本规则，每处匹配都以容器开头收尾，括号计数才与本规则判据同口径。
_CONTAINER_OPEN = re.compile(
    r"(?i)(?P<qk>" + _QUOTE + r")(?:\b|(?<=\\n))" + _PFX + _KEY + r"(?P=qk)"
    r"(?P<sep>[ \t]*[:=][ \t]*)"
    r"(?P<rest>[ \t]*(?:\\*[\"'])?[ \t]*[\[{](?:(?!\\n)[^\n])*)")
_CONTAINER_HEAD = re.compile(r"^[ \t]*(?:\\*[\"'])?[ \t]*[\[{]")


def _has_unclosed_container(text):
    """任一物理行出现「敏感键＝/：容器开头」且括号在本行内不平衡 ⇒ 命中跨行容器漏面。

    匹配已锚定容器开头（`_CONTAINER_OPEN` 的 `rest` 必须以 `[`／`{` 收尾），故同行前置的
    非容器键不会吃走扫描位置、把同行后续的容器键挡在本判据之外。
    """
    for line in str(text).split("\n"):
        for matched in _CONTAINER_OPEN.finditer(line):
            rest = matched.group("rest")
            if _CONTAINER_HEAD.match(rest) is None:
                continue
            if rest.count("[") > rest.count("]") or rest.count("{") > rest.count("}"):
                return True
    return False


def redact_text(text):
    """文本路径：先按段处理 Keystore，再依规则抹掉凭据值（代理行、结构化形态、转义形态、
    Cookie、裸键值、token 前缀，以及与键名无关的 URL userinfo／PEM／JWT／长不透明串）。

    **跨物理行**的敏感容器（首行开容器、续行才是内容）命中即**整份**返回 `REDACTED`
    ——规则流水线按逻辑行工作，续行无法在行内判定是否属于秘密值，故不猜内容（代价已登记）。

    **合法 JSON 文档契约兜底**（2026-10-12 R2）：输入整段是**可解析的 JSON 文档**时，本路径的
    输出必须同样可解析——这是模块「合法 JSON 走结构化分支、输出保持可解析」契约在**文本路径**
    上的落点。判据只在「输入是合法 JSON 文档 **且** 流水线输出不再是合法 JSON 文档」时生效，
    此时改走 `_json_route()`（与 `redact_boundary()` 同一路由），从而**不丢结构**。属于
    *正确性* 兜底，不是放宽：改走的结构化路径把命中键的**整个值**（含嵌套容器）替换为
    `"<redacted>"`，抹除范围只增不减；抹除方向、键名集、fail-closed 规则一律不变。
    """
    source = str(text)
    document = _json_document(source)
    if _has_unclosed_container(source):
        out = REDACTED
    else:
        out = _keystore_values(source)
        for pattern, replacement in _RULES:
            # 3b 的容器豁免**只对整份已确认为合法 JSON 文档的输入**开启（2026-10-12 R3 复审判 N1）：
            # 非 JSON 文本里「容器开头」不足以排除尾段秘密（括号计数被引号内字符骗过／已闭合容器＋
            # 携密引号尾段），无条件豁免会把尾段原样放过。其余输入一律 fail-closed（方向是加抹）。
            if document is not None and pattern is _KEY_QUOTE_TAIL:
                out = pattern.sub(
                    lambda hit: _key_quote_tail(hit, allow_container=True), out)
            else:
                out = pattern.sub(replacement, out)
    if document is not None and _json_document(out) is None:
        return _json_route(source, document)
    return out


def _is_sensitive_key(key):
    return isinstance(key, str) and _SENSITIVE_KEY.match(key) is not None


def redact_obj(value):
    """结构化路径：命中敏感键即把**整个值**（含嵌套对象/数组）替换为 `"<redacted>"`。"""
    if isinstance(value, dict):
        return {key: (REDACTED if _is_sensitive_key(key) else redact_obj(item))
                for key, item in value.items()}
    if isinstance(value, list):
        return [redact_obj(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_obj(item) for item in value)
    if isinstance(value, str):
        # 字符串值在**序列化之前**处理；走完整边界入口，使「值本身是 JSON 文档」时也按结构
        # 处理。不得在序列化后再跑文本路径——那会吃掉 JSON 包装字符（2026-10-11 复审判 N1）。
        return redact_boundary(value)
    return value


def dumps_redacted(value, **kwargs):
    """结构化结果：按键递归整值替换，字符串值在**序列化前**过文本路径，再编码。

    **不得**在 `json.dumps()` 之后再跑文本路径——代理行规则会把序列化文本的尾引号与闭合符
    一并吃掉，使输出成为非法 JSON（2026-10-11 定向复审判 N1）。
    """
    options = {"ensure_ascii": False}
    options.update(kwargs)
    return json.dumps(redact_obj(value), **options)


_JSON_STRING = re.compile(r'"(?:[^"\\]|\\.)*"')
_JSON_DECODER = json.JSONDecoder()


def _json_document(text):
    """整段文本是**可解析的 JSON 文档**时返回解析结果，否则返回 None。

    只对首字符像 JSON 的文本试解析（`{`／`[`／顶层字符串的 `"`），故普通 profile／诊断文本
    的文本路径不付解析代价。顶层字符串同样是文档（`json.dumps("…")`）。
    """
    stripped = text.strip()
    if stripped[:1] not in ("{", "[", '"'):
        return None
    try:
        return json.loads(stripped)
    except ValueError:
        return None


def _json_route(text, parsed):
    """已确认合法的 JSON 文档：紧凑布局走结构化整文档，其它布局就地按 token 脱敏。

    **不得**对已结构化的 JSON 结果再跑一遍 `redact_text()`——那会把序列化文本的包装字符
    一并吃掉，使输出成为非法 JSON（2026-10-11 定向复审判 N1）。
    """
    if json.dumps(parsed, ensure_ascii=False, separators=(",", ":")) == text.strip():
        return dumps_redacted(parsed, separators=(",", ":"))
    return _redact_json_layout(text)


def _redact_json_layout(text):
    """已确认合法的 JSON：按字符串 token 就地脱敏，**保留未改变部分的字节布局**。

    不把 JSON 包装字符交给代理行正则（那正是 N1 的成因）：键位置按敏感键整值替换，值位置
    递归走 `redact_boundary()`。
    """
    pieces = []
    cursor = 0
    while True:
        matched = _JSON_STRING.search(text, cursor)
        if matched is None:
            pieces.append(text[cursor:])
            return "".join(pieces)
        pieces.append(text[cursor:matched.start()])
        token = matched.group(0)
        value = json.loads(token)
        end = matched.end()
        following = end
        while following < len(text) and text[following].isspace():
            following += 1
        if following < len(text) and text[following] == ":":
            pieces.append(token)
            if _is_sensitive_key(value):
                value_start = following + 1
                while text[value_start].isspace():
                    value_start += 1
                _, value_end = _JSON_DECODER.raw_decode(text, value_start)
                pieces.append(text[end:value_start])
                pieces.append(json.dumps(REDACTED))
                cursor = value_end
                continue
        else:
            clean = redact_boundary(value)
            pieces.append(token if clean == value else json.dumps(clean, ensure_ascii=False))
        cursor = end


def redact_boundary(text):
    """输出边界入口：JSON 文档按字符串 token 结构化处理，其余走文本路径。

    - 紧凑 JSON（`json.dumps` 可逐字节重排）：整文档结构化，布局不变；
    - 其它布局的合法 JSON：`_redact_json_layout()` 就地按 token 脱敏，保留布局；
    - 其余文本：`redact_text()` 规则流水线（含 Profile 代理行）。

    **不得**对已结构化的 JSON 结果再跑一遍 `redact_text()`——那会把序列化文本的包装字符
    一并吃掉，使输出成为非法 JSON（2026-10-11 定向复审判 N1）。
    """
    text = str(text)
    # 顶层 JSON **字符串**同样是文档（`json.dumps("…")`）：走文本路径会把闭合引号当末字段吃掉，
    # 使输出成为非法 JSON（2026-10-11 第四轮复审判 N5）。
    parsed = _json_document(text)
    if parsed is not None:
        return _json_route(text, parsed)
    return redact_text(text)


def redact(value):
    """统一入口（单值）：dict/list 走结构化序列化（字符串值在序列化前过输出边界），其余走输出边
    界入口（`redact_boundary()`）。"""
    if isinstance(value, (dict, list)):
        return dumps_redacted(value, indent=2, sort_keys=True)
    return redact_boundary(value)


def api_base_problem(base, label="SURGE_HTTP_API_BASE", allow_remote_env="SURGE_ALLOW_REMOTE"):
    """出网凭据边界：scheme／URL userinfo／非本机主机三项统一判定。

    返回问题描述字符串；通过则返回 None。非本机主机须显式设置 `SURGE_ALLOW_REMOTE=1`
    （认默认值，不看调用方），URL 内嵌凭据一律拒绝——凭据只从 `SURGE_API_KEY`／
    `--password-stdin` 取。
    """
    parsed = urlparse(str(base))
    if parsed.scheme not in ("http", "https"):
        return "%s must use http or https" % label
    if parsed.username is not None or parsed.password is not None:
        return "%s must not embed URL credentials; use SURGE_API_KEY" % label
    if parsed.hostname not in _LOOPBACK and os.getenv(allow_remote_env) != "1":
        return "Remote Surge API blocked; set SURGE_ALLOW_REMOTE=1 explicitly"
    return None
