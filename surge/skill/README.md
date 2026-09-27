# surge skill（LobeHub 安装源）

本目录是 LUNO Pro 专属技能 `surge` 在 LobeHub 端的安装源。

- `SKILL.md`、`references/`、`scripts/`、`agents/`、`assets/` —— 技能正文与资源（本目录只有这些）
- 打包产物 ZIP **不是本目录的项目**：`scripts/package_release.py` 拒绝把输出写进技能目录，默认写到目录外的持久路径 `/var/minis/shared/release/surge-skill-YYYYMMDD.zip`，再经**私有 R2 桶的预签名 URL**投递给 `lh skill install`

## 打包

打包只用经审查的 `scripts/package_release.py`，不要另写第二份实现；输出默认写到**目录外**的持久目录（`/var/minis/workspace`、`/tmp` 在本机不跨 shell 进程保留，脚本已不再默认写那里）：

```sh
python3 scripts/package_release.py
# 默认输出：/var/minis/shared/release/surge-skill-YYYYMMDD.zip（目录外产物）
python3 scripts/package_release.py /var/minis/shared/release/surge-skill-20260927.zip
# 显式路径仍可覆盖；路径落在技能目录内会被拒绝
```

包内以 `surge/` 为根，相对路径与本技能目录一致；固定时间戳；按可执行位写 755/644。写入前拒绝符号链接，排除 `__pycache__`、日志与密钥类目录/文件名以及 `.pem`、`.key`、`.conf` 等后缀，并扫描私钥块与 `sk-`/`ghp_`/`github_pat`/`xox*` 等 token 前缀——命中即中止；输出 ZIP 必须位于技能目录之外。禁止打包凭据、profile、抓包、请求正文、数据库与运行输出；打包前按 `references/SOURCE.md` 的验收要求核对内容。

## 投递与安装

ZIP 存放在**私有 R2 桶**中，安装时按需生成约 **600 秒**有效的预签名 GET URL，再用该 URL 安装：

```sh
lh skill install "<R2 预签名 ZIP URL>"
```

- 预签名 URL 携带临时凭据：仅在需要时生成，不写入回复、日志或文件，约 600 秒后失效，过期重新签名即可；不把对象设为公开可读。
- `lh skill install` 只做**新建**：同名技能须先 `lh skill delete <id> --yes`。
- identifier 由 URL 的 **host + path** 派生：复用同一 object key 即可保持 identifier 稳定，换 key 会被当成新技能；平台不接受自定义 identifier。
