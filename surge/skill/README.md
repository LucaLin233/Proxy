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

归档条目落在 **ZIP 根**（`SKILL.md`、`agents/…`、`references/…`、`scripts/…`，无顶层目录），即 `lh skill install` 消费的布局；固定时间戳；按可执行位写 755/644。写入前拒绝符号链接，排除 `__pycache__`、日志与密钥类目录/文件名以及 `.pem`、`.key`、`.conf` 等后缀，并扫描私钥块与 `sk-`/`ghp_`/`github_pat`/`xox*` 等 token 前缀——命中即中止；输出 ZIP 必须位于技能目录之外。禁止打包凭据、profile、抓包、请求正文、数据库与运行输出；打包前按 `references/SOURCE.md` 的验收要求核对内容。

## 投递与安装

ZIP 存放在**私有 R2 桶**中，安装时按需生成约 **600 秒**有效的预签名 GET URL，再用该 URL 安装：

```sh
lh skill install "<R2 预签名 ZIP URL>"
```

- 预签名 URL 携带临时凭据：仅在需要时生成，不写入回复、日志或文件，约 600 秒后失效，过期重新签名即可；不把对象设为公开可读。
- **不先删技能**：平台侧的安装/更新与 identifier 实际语义以当次平台回读为准，不以「同名技能须先删除」为前提。
- 重发同名 ZIP 时**沿用既有 object key**（改名不换 key）。若确需换 key，先核当次平台侧 identifier 与技能 ID/引用；迁移属另一次授权动作，不在打包动作内做。
