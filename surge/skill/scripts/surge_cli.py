#!/usr/bin/env python3
"""Surge CLI-compatible client for Surge External Controller on iOS."""
from __future__ import annotations
import base64, difflib, json, os, signal, socket, sys
import urllib.error, urllib.request
from datetime import datetime
from pathlib import Path

# 脚本可能被 install.sh 以符号链接落到 PATH，故用 realpath 解析同级共享模块所在目录。
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _privacy import dumps_redacted, redact_boundary  # noqa: E402

signal.signal(signal.SIGPIPE, signal.SIG_DFL)

DEFAULT_REMOTE = os.getenv("SURGE_CLI_REMOTE", "127.0.0.1:6170")
VALIDATE_URL = "https://services.nssurge.com/v1/config/validate"
CONTINUOUS_COMMANDS = {("log", "watch"), ("diagnostics",)}
FINITE_STREAM_COMMANDS = {("test-policy-bandwidth",), ("benchmark", "encryption"), ("test-ponte",)}

MAIN_HELP = """Surge CLI (Minis Controller Edition)
Usage: surge-cli <command> [arguments]

Command groups:
  Status       status, summary, version
  Routing      mode, global-policy, policy-group, rule match, rule temp
  Profile      profile, module, feature, managed-profile, external-resource
  Network      dns, geoip, http probe, test, diagnostics, flush dns
  Inspection   dump, watch, log, logbook, proxy-runtime-status
  Automation   script, script-log, benchmark
  Gateway      device, vmnet, security ban
  Control      reload, restart-engine, switch-profile, kill, stop, unattended-upgrade
  Environment  environment, set, set-log-level

Use `help <command>` for detailed usage, for example:
  help rule match
  help dump
  help test

Available parameters:
  --raw - Output raw JSON instead of human-readable format
  --remote/-r <host:port> - Connect to a remote Surge instance
  --password-stdin - Read the remote password from stdin
  Remote password: SURGE_API_KEY 或 --password-stdin（不读凭据文件，也不交互补取）
Utilities:
  --check/-c <path> - Validate a profile with the official Surge beta service (uploads profile content)

Minis defaults:
  Controller: 127.0.0.1:6170
  Credential: SURGE_API_KEY in Minis Environment Variables
"""

HELP = {
"status":"Usage: status\n\nShow the current profile and path, outbound mode, feature states, uptime, and version.",
"summary":"Usage: summary\n\nShow network configuration, DNS state, and warnings without running active tests.",
"version":"Usage: version\n\nShow Surge, Core, Controller protocol, system, and device versions.",
"mode":"Usage: mode [get | set <rule|direct|proxy>]\n\nShow or change the outbound mode.",
"global-policy":"Usage: global-policy [get | set <policy>]\n\nShow or change the global proxy policy.",
"policy-group":"Usage:\n  policy-group list\n  policy-group get <group>\n  policy-group set <group> <policy|auto>",
"rule":"Usage: rule <match|explain> <host|url> [port] [key=value ...]\n       rule temp <list | add | remove | set-policy | flush>\n\nEvaluate active rules or manage temporary rules.",
"rule temp":"Usage:\n  rule temp list\n  rule temp add <rule>\n  rule temp remove <rule>\n  rule temp set-policy <rule> <policy>\n  rule temp flush",
"profile":"Usage: profile <list | current | diff | check <name> | switch <name>>",
"module":"Usage: module <list | enable <name...> | disable <name...>>",
"feature":"Usage: feature <list | get <name> | set <name> <on|off>>\n\nFeatures: mitm, rewrite, scripting, capture, packet-capture, cellular-mode.",
"dns":"Usage:\n  dns lookup <domain> [interface=<bsd-name>]\n  dns trace <domain> [interface=<bsd-name>]",
"geoip":"Usage: geoip <ip-address>",
"http":"Usage: http probe <url> [policy]",
"test":"Network and policy tests:\n  test-network\n  test-policy <policy-name>\n  test-policy-udp <policy-name>\n  test-policy-external-ip <policy-name>\n  test-policy-nat-type <policy-name>\n  test-policy-bandwidth <download|upload> <policy-name>\n  test-all-policies\n  test-group <group-name>\n  test <v4-router|dns|encrypted-dns|external-ip|nat-type>\n  test-ponte <device-ponte-name>",
"diagnostics":"Usage: diagnostics\n\nRun streaming network diagnostics.",
"flush":"Usage: flush dns",
"dump":"Usage: dump <type> [arguments]\n\nTypes include active, recent, request, traffic, traffic-stat, rule, policy, profile, dns, event, performance, rule-usage and virtual-ip.",
"watch":"Usage: watch <request|speed>\n\nContinuously print events; press Ctrl-C to unsubscribe.",
"log":"Usage:\n  log [file|memory] [line-count]\n  log watch",
"logbook":"Usage: logbook <limit>",
"script":"Usage:\n  script list\n  script run <cron-name>\n  script evaluate <script-js-path> [mock-script-type] [timeout]",
"benchmark":"Usage: benchmark <encryption [data-size-mib] | rule-matching>",
"vmnet":"Usage: vmnet <status|arp|ndp|ra>\n\nInspect the VMNET virtual interface used by Enhanced/Gateway Mode. Available on macOS only.\n\n  status  Interface configuration, addresses, MTU, and table sizes\n  arp     IPv4 neighbors learned from Gateway Mode clients\n  ndp     IPv6 neighbor table\n  ra      IPv6 Router Advertisement takeover state",
"reload":"Usage: reload\n\nApply changed profile sections whenever possible while preserving unaffected runtime state.",
"restart-engine":"Usage: restart-engine\n\nCompletely restart the Surge engine, close active connections, and clear caches and temporary rules.",
"kill":"Usage: kill <connection-id>",
"stop":"Usage: stop\n\nShut down Surge.",
"environment":"Usage: environment",
"set":"Usage: set <key-path>=<value> [...]",
"set-log-level":"Usage: set-log-level <log-level>",
}

# ── 输出边界（统一脱敏）───────────────────────────────────────────────────
# 这些命令的响应体可能含 Profile 全文、代理行凭据、订阅 URL、请求正文与日志；
# 错误输出同样来自服务端。**所有** stdout／stderr 写出都经这里，而不是只给
# `--raw` 分支加正则——`Error:` 分支、render 的格式化分支、`profile diff`、
# `--check` 校验服务的错误详情、`die()` 的本地错误消息一并覆盖。
# 端口形态/换行一律保持：先脱敏再 print，不改变既有格式。
def _emit(stream, text, end="\n"):
    stream.write(redact_boundary(text) + end)
    if stream is sys.stdout:
        sys.stdout.flush()


def out(text="", end="\n"):
    """默认空串：`render_summary`／`render_vmnet ra` 用 `out()` 输出小节后的空行。"""
    _emit(sys.stdout, text, end)


def out_literal(text, end="\n"):
    """输出**编译期字面量**（帮助/用法文本）：不经脱敏。

    这些字符串来自本文件常量、不含任何运行时数据，脱敏只会产生假阳性——例如帮助里的
    `Remote password: SURGE_API_KEY` 与 `Credential: SURGE_API_KEY` 是**变量名**，
    却被敏感键启发式（`password`／`credential`）当成凭据值抹掉，破坏既有帮助文本。
    """
    sys.stdout.write(text + end)
    sys.stdout.flush()


def err(text, end="\n"):
    _emit(sys.stderr, text, end)


def die(msg: str, code: int = 1):
    err(msg)
    raise SystemExit(code)

def split_hostport(value: str):
    if value.startswith("["):
        end=value.find("]")
        if end<0 or end+1>=len(value) or value[end+1] != ":": die("Invalid remote address")
        try:
            return value[1:end], int(value[end+2:])
        except ValueError:
            die("Invalid remote port")
    if ":" not in value: die("Remote address must be host:port")
    host, port=value.rsplit(":",1)
    try: return host, int(port)
    except ValueError: die("Invalid remote port")

def credential(stdin_mode: bool):
    if stdin_mode:
        value=sys.stdin.readline().rstrip("\r\n")
    else:
        value=os.getenv("SURGE_API_KEY", "")
        # 不再在 TTY 下交互补取：秘密只来自已注入变量或 --password-stdin。
    if not value: die("A remote controller password is required. Set SURGE_API_KEY or use --password-stdin.")
    return value

def parse_cli(args):
    raw=False; remote=DEFAULT_REMOTE; stdin_mode=False; check_path=None; command=[]; i=0
    while i<len(args):
        a=args[i]
        if a=="--raw": raw=True
        elif a in ("--remote","-r"):
            i+=1
            if i>=len(args): die(f"{a} requires host:port",2)
            remote=args[i]
        elif a=="--password-stdin": stdin_mode=True
        elif a in ("--help","-h") and not command: out_literal(MAIN_HELP); raise SystemExit
        elif a in ("--check","-c"):
            i+=1
            if i>=len(args): die(f"{a} requires a profile path",2)
            if check_path is not None: die("Only one profile can be checked at a time",2)
            check_path=args[i]
        else: command.append(a)
        i+=1
    if check_path is not None and command:
        die("--check/-c cannot be combined with a Controller command",2)
    return raw,remote,stdin_mode,check_path,command

def validate_profile(path: str, raw: bool):
    try:
        profile=Path(path).read_text(encoding="utf-8")
    except UnicodeDecodeError:
        die(f"Profile is not valid UTF-8: {path}",2)
    except OSError as e:
        die(f"Cannot read profile file {path}: {e}",2)
    body=json.dumps({"profile":profile},ensure_ascii=False,separators=(",",":")).encode()
    request=urllib.request.Request(
        VALIDATE_URL,data=body,method="POST",
        headers={"Content-Type":"application/json","Accept":"application/json","User-Agent":"surge-cli-minis/1"},
    )
    try:
        with urllib.request.urlopen(request,timeout=30) as response:
            result=json.loads(response.read())
    except urllib.error.HTTPError as e:
        detail=e.read().decode(errors="replace").strip()
        die(f"Official validation service returned HTTP {e.code}"+(f": {detail}" if detail else ""))
    except (urllib.error.URLError,TimeoutError,OSError) as e:
        die(f"Cannot reach official validation service: {e}")
    except (json.JSONDecodeError,UnicodeDecodeError):
        die("Official validation service returned an invalid response")
    if not isinstance(result,dict) or not isinstance(result.get("valid"),bool):
        die("Official validation service returned an unexpected response")
    if raw:
        out(dumps_redacted(result, separators=(",",":")))
    elif result["valid"]:
        out("OK")
    else:
        error=result.get("error")
        message=error.get("message") if isinstance(error,dict) else error
        err(f"Failed: {message or 'Invalid profile'}")
    raise SystemExit(0 if result["valid"] else 1)

def normalize(argv):
    """Apply client-side argument conversions used by official surge-cli."""
    if argv==["summary"]: return ["dump","summary"]
    if argv==["profile","diff"]: return ["dump","profile"]
    if argv[:3]==["rule","temp","list"] and len(argv)==3: return ["dump","temp-rule"]
    if argv[:3]==["rule","temp","add"]: return ["add-temp-rule",*argv[3:]]
    if argv[:3]==["rule","temp","remove"]: return ["del-temp-rule",*argv[3:]]
    if argv[:3]==["rule","temp","set-policy"]: return ["update-temp-rule",*argv[3:]]
    if argv==["rule","temp","flush"]: return ["flush-temp-rule"]
    if argv[:2]==["watch","speed"]: return ["watch","real-time-speed",*argv[2:]]
    if argv[:2]==["script","evaluate"] and len(argv)>=3:
        path=argv[2]
        try:
            script=Path(path).read_bytes()
        except OSError as e:
            die(f"Cannot read script file {path}: {e}",2)
        tail=argv[3:]
        mock_types={"generic":"0","http-response":"1","http-request":"2","cron":"3","event":"4","rule":"5","dns":"6"}
        if tail:
            if tail[0] not in mock_types:
                die(f"Unknown mock script type: {tail[0]}",2)
            tail=[mock_types[tail[0]],*tail[1:]]
        return ["script","evaluate",base64.b64encode(script).decode(),*tail]
    return argv

class Controller:
    def __init__(self, remote, password, timeout=30):
        self.host,self.port=split_hostport(remote)
        try:
            self.sock=socket.create_connection((self.host,self.port),timeout=8)
            self.sock.settimeout(timeout); self.fp=self.sock.makefile("rwb",buffering=0)
            self.fp.write(password.encode()+b"\r\n")
            line=self.fp.readline()
        except (OSError,TimeoutError) as e: die(f"Cannot connect to Surge Controller at {remote}: {e}")
        if not line: die("Controller closed the connection during authentication")
        try: self.welcome=json.loads(line)
        except Exception: die("Invalid Controller welcome response")
        if "error" in self.welcome: die(str(self.welcome["error"]))
        if self.welcome.get("result") != "Welcome to Surge CLI": die("Authorization denied")
    def send(self,argv):
        if not argv:
            die("Controller command is empty",2)
        if any("\r" in str(a) or "\n" in str(a) for a in argv):
            die("Controller command arguments must not contain newlines",2)
        # Official surge-cli 6.9.0 (formal build 12250) uses one textual command line:
        # the command verb is bare and every following argv item is quoted.
        payload=(str(argv[0])+"".join(f' \"{a}\"' for a in argv[1:])+"\r\n").encode()
        try: self.fp.write(payload)
        except OSError as e: die(f"Failed to send Controller command: {e}")
    def read_one(self):
        try: line=self.fp.readline()
        except socket.timeout: die("The controller command timed out without progress")
        if not line: die("The controller connection has been closed")
        try: return json.loads(line)
        except json.JSONDecodeError: return {"result":line.decode(errors="replace").rstrip()}
    def stream(self, finite=False):
        previous_timeout=self.sock.gettimeout()
        if not finite:
            self.sock.settimeout(None)
        try:
            while True:
                value=self.read_one()
                yield value
                if finite and isinstance(value,dict) and value.get("hasMore") is False:
                    return
        except KeyboardInterrupt:
            return
        finally:
            self.sock.settimeout(previous_timeout)
    def close(self):
        try: self.fp.close()
        except OSError: pass
        try: self.sock.close()
        except OSError: pass

def duration(v):
    try: s=int(v)
    except Exception: return str(v)
    d,s=divmod(s,86400); h,s=divmod(s,3600); m,s=divmod(s,60)
    return " ".join(x for x in (f"{d}d" if d else "",f"{h}h" if h else "",f"{m}m" if m else "",f"{s}s" if s or not (d or h or m) else "") if x)
def onoff(v): return "On" if v else "Off"
def scalar(v):
    if v is None:return "(none)"
    if isinstance(v,bool):return onoff(v)
    return str(v)

def render_status(o):
    started=o.get("start-time")
    st=datetime.fromtimestamp(started).astimezone().strftime("%Y-%m-%d %H:%M:%S %z") if isinstance(started,(int,float)) else scalar(started)
    out(f"Surge {o.get('version','?')} ({o.get('build','?')})")
    out(f"Core: {o.get('core-version','?')}\nController Protocol: {o.get('controller-protocol','?')}")
    out(f"System: {o.get('system','?')} {o.get('system-version','')}")
    out(f"Device: {o.get('device-name','?')} [{o.get('device-identifier','?')}]\n")
    out(f"Profile: {o.get('profile','?')}\nProfile Path: {o.get('profile-path','?')}")
    out(f"Mode: {o.get('mode','?')}\nGlobal Policy: {scalar(o.get('global-policy'))}")
    out(f"Started: {st}\nUptime: {duration(o.get('uptime',0))}\n\nFeatures:")
    for k,v in sorted(o.get("features",{}).items()): out(f"  {k}: {onoff(v)}")
def render_version(o):
    out(f"Surge {o.get('version','?')} ({o.get('build','?')})\nCore: {o.get('core-version','?')}\nController Protocol: {o.get('controller-protocol','?')}\nSystem: {o.get('system','?')} {o.get('system-version','')}\nDevice: {o.get('device-name','?')} [{o.get('device-identifier','?')}]")
def render_group(g):
    out(f"{g.get('name','?')} ({g.get('type','?')})\n  Selected: {scalar(g.get('selected'))}\n  Options:")
    for x in g.get("options",[]):
        details=[]
        if x.get("typeDescription"): details.append(x["typeDescription"])
        if x.get("isGroup"): details.append("Group")
        if not x.get("enabled",True): details.append("disabled")
        tail=f" ({', '.join(details)})" if details else ""
        h=f" [{x['lineHash']}]" if x.get("lineHash") else ""
        out(f"    {x.get('name','?')}{tail}{h}")
def render_rule(o, explain=False):
    if not explain:
        out(f"Matched rule: {o.get('rule','?')}\nPolicy: {o.get('policy','?')}")
        return
    out(f"Matched rule: {o.get('rule','?')}")
    if o.get("steps"):
        out("\nDecision path:")
        for x in o["steps"]:
            out(f"  {x.get('group','?')} ({x.get('type','?')}) -> {x.get('selected','?')}  [{x.get('reason','?')}]")
    out(f"\nFinal policy: {o.get('final','?')} ({o.get('final-type','?')})")
    if o.get("duration-ms") is not None: out(f"Duration: {o['duration-ms']:.2f} ms")
    if o.get("notes"):
        out("\nNotes:")
        for n in o["notes"]: out(f"  {n}")
def render_dns(o):
    out(f"Domain: {o.get('domain','?')}\nIPv4: {', '.join(o.get('v4Addresses',[])) or '(none)'}\nIPv6: {', '.join(o.get('v6Addresses',[])) or '(none)'}\nServer: {scalar(o.get('server'))}\nInterface: {scalar(o.get('interface'))}\nPath: {scalar(o.get('path'))}\nDuration: {o.get('duration-ms','?')} ms")
    if o.get("logs"):
        out("Logs:")
        for x in o["logs"]: out(f"  {x}")
def render_vmnet(argv,o):
    sub=argv[1] if len(argv)>1 else ""
    if sub=="status":
        fields=(
            ("Running","running",lambda v:"yes" if v else "no"),
            ("Main interface","main-interface",scalar),("Main interface MAC","main-interface-mac",scalar),
            ("VMNET MAC","self-mac",scalar),("MTU","mtu",scalar),("IPv4 self","self-ip",scalar),
            ("IPv4 router","router-ip",scalar),("IPv6 link-local","self-ipv6-link-local",scalar),
            ("IPv6 global","self-ipv6-global",scalar),("IPv6 prefix","ipv6-prefix",scalar),
            ("IPv6 router","router-ipv6",scalar),("ARP entries","arp-entries",scalar),
            ("NDP entries","nd-entries",scalar),("RA clients","ra-clients",scalar),
            ("RA blacklist","ra-blacklist",scalar),("Known routers","known-routers",scalar),
        )
        for title,key,fmt in fields: out(f"{title}: {fmt(o.get(key))}")
        return
    if sub in ("arp","ndp"):
        entries=o.get("entries",[])
        if not entries: out("(none)")
        for x in entries: out(f"{x.get('ip','?'):<44} {x.get('mac','?')}  (age {x.get('age-seconds','?')}s)")
        return
    if sub=="ra":
        for title,key in (("RA takeover clients","clients"),("Known routers","routers"),("Blacklisted clients","blacklist")):
            values=o.get(key,[]); out(f"{title} ({len(values)}):")
            if not values: out("  (none)")
            for x in values: out("  "+dumps_redacted(x, separators=(",",":")))
            out()
        return
    out(dumps_redacted(o, indent=2))

def render_summary(o):
    sections=o.get("sections",[])
    if not isinstance(sections,list):
        out(dumps_redacted(o, indent=2)); return
    for section in sections:
        out(f"{section.get('section','Summary')}:")
        for line in section.get("lines",[]):
            # **先对整段 content 脱敏，再分行输出**（2026-10-12 N1）：逐行脱敏会把跨行引号口令
            # 拆散——首行只剩开引号、续行没有凭据上下文，尾段（如 `"a,b"` 的后半）原样泄漏。
            content=redact_boundary(str(line.get("content","")))
            parts=content.splitlines() or [""]
            out(f"  {line.get('title','?')}: {parts[0]}")
            for extra in parts[1:]: out(f"    {extra}")
        out()

def render_profile_diff(o):
    original=o.get("originalProfile")
    effective=o.get("profile")
    if not isinstance(original,str) or not isinstance(effective,str):
        out(dumps_redacted(o, indent=2)); return
    # **先脱敏整份 profile，再分行做 diff**（2026-10-12 N2）：逐行脱敏会把跨行引号口令截断
    # （尾段连同换行被抹掉），而 difflib 仍按原行数写 `@@` 头 ⇒ hunk 计数与正文不符、相邻行
    # 粘连。整份先脱敏后，`@@` 计数与正文都按**脱敏后**的文本计算，结构自洽；代价＝仅凭据
    # 不同的差异会随脱敏一并消失（非敏感差异仍可见）。
    # **边界**：本输出只表示**脱敏文本**的差异——空输出不证明原始配置相同，不得用于配置等价
    # 判定或回导（凭据差异、以及保守脱敏尾段里的非敏感差异都可能不可见）。
    out("".join(difflib.unified_diff(
        redact_boundary(original).splitlines(keepends=True),
        redact_boundary(effective).splitlines(keepends=True),
        fromfile="original",tofile="effective"
    )), end="")

def render(argv,o,original_argv=None):
    shown=original_argv or argv
    key=tuple(argv[:2]); cmd=argv[0] if argv else ""
    if shown==["summary"]: return render_summary(o)
    if shown==["profile","diff"]: return render_profile_diff(o)
    if cmd=="status": return render_status(o)
    if cmd=="version": return render_version(o)
    if cmd=="mode" and "mode" in o: out(o["mode"]); return
    if cmd=="global-policy" and "policy" in o: out(scalar(o["policy"])); return
    if cmd=="feature" and "features" in o:
        for k,v in sorted(o["features"].items()): out(f"{k}: {onoff(v)}")
        return
    if key==("policy-group","list") and "groups" in o:
        for g in o["groups"]: out(f"{g.get('name','?')}: {scalar(g.get('selected'))} ({g.get('type','?')})")
        return
    if key==("policy-group","get"):
        g=o.get("group",o)
        if isinstance(g,dict): return render_group(g)
    if key in (("rule","match"),("rule","explain")): return render_rule(o,key[1]=="explain")
    if cmd=="vmnet": return render_vmnet(argv,o)
    if key in (("dns","lookup"),("dns","trace")): return render_dns(o)
    if cmd=="profile" and "profile" in o and len(o)==1: out(o["profile"]); return
    if key==("module","list"):
        enabled=set(o.get("enabled",[])); out("Modules:")
        for n in o.get("available",[]): out(f"  {'[x]' if n in enabled else '[ ]'} {n}")
        return
    if cmd=="geoip":
        for k in ("address","country","asn","organization","geoip-db-date","asn-db-date"):
            if k in o: out(f"{k}: {scalar(o[k])}")
        return
    if key==("dump","performance"):
        for k,v in o.items(): out(f"{k}: {v}")
        return
    if "result" in o and len(o)==1: out(scalar(o["result"])); return
    out(dumps_redacted(o, indent=2))

def main():
    raw,remote,stdin_mode,check_path,argv=parse_cli(sys.argv[1:])
    if check_path is not None:
        validate_profile(check_path,raw)
    if not argv: out_literal(MAIN_HELP); return
    if argv[0]=="help":
        key=" ".join(argv[1:3]) if " ".join(argv[1:3]) in HELP else (argv[1] if len(argv)>1 else "")
        out_literal(HELP.get(key,MAIN_HELP)); return
    original_argv=list(argv)
    argv=normalize(argv)
    c=Controller(remote,credential(stdin_mode))
    try:
        c.send(argv)
        continuous=(len(argv)>1 and argv[0]=="watch") or any(tuple(argv[:len(k)])==k for k in CONTINUOUS_COMMANDS)
        finite=any(tuple(argv[:len(k)])==k for k in FINITE_STREAM_COMMANDS)
        values=c.stream(finite=finite) if continuous or finite else (c.read_one(),)
        code=0
        for o in values:
            if isinstance(o,dict) and o.get("error"):
                err(dumps_redacted(o, separators=(",",":")) if raw else f"Error: {o['error']}")
                code=1
                break
            if raw: out(dumps_redacted(o, separators=(",",":")))
            else: render(argv,o,original_argv)
        raise SystemExit(code)
    finally: c.close()
if __name__=="__main__": main()
