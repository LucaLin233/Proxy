# surge skill（LobeHub 安装源）

本目录是 LUNO Pro 专属技能 `surge` 在 LobeHub 端的安装源。

- `SKILL.md`、`references/`、`scripts/`、`agents/` —— 技能正文与资源（本目录只有这些）
- 打包产物 ZIP **不是本目录的项目**：`scripts/package_release.py` 拒绝把输出写进技能目录，默认写到目录外的持久路径 `/var/minis/shared/release/surge-skill-YYYYMMDD.zip`，再经**私有 R2 桶的预签名 URL**投递给 `lh skill install`

本目录的源树与同目录 `surge-skill.zip` **仅为镜像**，不是平台条目的来源证明；ZIP 根为 `SKILL.md` 等（无顶层目录）；平台仍经**私有短时签名 URL** 投递，不记 URL、不公开对象。第三方内容的来源与许可通知见 `references/SOURCE.md`〈第三方内容来源与许可通知〉。

## 打包

打包只用经审查的 `scripts/package_release.py`，不要另写第二份实现；输出默认写到**目录外**的持久目录（`/var/minis/workspace`、`/tmp` 在本机不跨 shell 进程保留，脚本已不再默认写那里）：

```sh
python3 scripts/package_release.py
# 默认输出：/var/minis/shared/release/surge-skill-YYYYMMDD.zip（目录外产物）
python3 scripts/package_release.py /var/minis/shared/release/surge-skill-20260927.zip
# 显式路径仍可覆盖；路径落在技能目录内会被拒绝
```

公开镜像包要从**独占暂存树**打：打包器以 `scripts/` 的上级目录为源、递归收成员，只按固定名字与后缀排除，把这棵目录整个交出去会把同目录的旧 `surge-skill.zip` 和 `README.md` 一起打进包。所以只把成员（`SKILL.md`、`agents/`、`references/`、`scripts/`）放进暂存树，在树内运行同一份打包器，产物写到暂存树之外；整个过程用**普通用户**在当前目录下运行，不必 `su` 到 root，也不需要放宽工作树权限。在 Minis/iSH 的 root 下实测，`os.access(X_OK)` 对 644 文件也返回真，成员会被写成 755（Linux 上行为相反，见 `access(2)`），所以这里只把它当本机限制、不当通用事实：用普通用户运行即可得到 644。`README.md` 与旧 ZIP 都不入包，所以只改本文件不必重打 ZIP（重打可用 `sha256sum` 与旧包比对，内容未变则哈希一致）：

```sh
set -eu
# 在 surge/skill 目录下以普通用户运行；下面的路径都相对当前目录，不写死本机路径
WORK=$(mktemp -d "$PWD/.pkg.XXXXXX")      # 本次独占的工作树，收尾整体删除
STAGE=$WORK/stage                         # 只放待发布成员
OUT=$PWD/surge-skill-YYYYMMDD.zip         # 产物写当前目录，暂存树之外
mkdir -p "$STAGE"
tar cf - SKILL.md references scripts agents | (cd "$STAGE" && tar xf -)   # 不带 README.md 与旧 ZIP
find "$STAGE" -type d -exec chmod 755 {} +; find "$STAGE" -type f -exec chmod 644 {} +
(cd "$STAGE" && python3 scripts/package_release.py "$OUT")
# 产物已带日期名写到当前目录；核对成员集合与 sha256 后，再按需改名覆盖同名 surge-skill.zip
rm -rf -- "${WORK:?}"
```

归档条目落在 **ZIP 根**（`SKILL.md`、`agents/…`、`references/…`、`scripts/…`，无顶层目录），即 `lh skill install` 消费的布局；固定时间戳；按可执行位写 755/644。写入前拒绝符号链接，排除 `__pycache__`、日志与密钥类目录/文件名以及 `.pem`、`.key`、`.conf` 等后缀，并扫描私钥块与 `sk-`/`ghp_`/`github_pat`/`xox*` 等 token 前缀——命中即中止；输出 ZIP 必须位于技能目录之外。禁止打包凭据、profile、抓包、请求正文、数据库与运行输出；打包前按 `references/SOURCE.md` 的验收要求核对内容。

## 投递与安装

ZIP 存放在**私有 R2 桶**中，安装时按需生成约 **600 秒**有效的预签名 GET URL，再用该 URL 安装：

```sh
lh skill install "<R2 预签名 ZIP URL>"
```

- 预签名 URL 携带临时凭据：仅在需要时生成，不写入回复、日志或文件，约 600 秒后失效，过期重新签名即可；不把对象设为公开可读。
- **不先删技能**：平台侧的安装/更新与 identifier 实际语义以当次平台回读为准，不以「同名技能须先删除」为前提。
- 重发同名 ZIP 时**沿用既有 object key**（改名不换 key）。若确需换 key，先核当次平台侧 identifier 与技能 ID/引用；迁移属另一次授权动作，不在打包动作内做。
