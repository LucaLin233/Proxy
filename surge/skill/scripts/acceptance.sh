#!/bin/sh
# Non-destructive acceptance test for Minis Surge CLI.
# Tiers: --offline (default: syntax + local links only), --installed (offline plus
# the PATH entry must resolve into this package), --controller (adds read-only
# queries against the local instance), --network (additionally uploads a synthetic
# secret-free Profile and sends DNS requests). No tier changes Surge settings;
# --network never uploads a real profile.
set -eu
SELF_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
CLI="${SURGE_CLI_BIN:-surge-cli}"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }
json_check() {
  python3 - "$1" <<'PY' || fail "$2 returned invalid or error JSON"
import json,sys
x=json.load(open(sys.argv[1]))
assert not (isinstance(x,dict) and x.get("error")), x.get("error") if isinstance(x,dict) else ""
PY
  pass "$2 JSON"
}

command -v python3 >/dev/null || fail "python3 is unavailable"
MODE="${1:---offline}"
case "$MODE" in --offline|--installed|--controller|--network) ;; *) fail 'Use --offline, --installed, --controller or --network' ;; esac
python3 - "$SELF_DIR" <<'PY'
import sys,re
from pathlib import Path
root=Path(sys.argv[1]).parent
for p in (root/'scripts').glob('*.py'): compile(p.read_text(),str(p),'exec')
for p in root.rglob('*.md'):
    # Official snapshots use their original upstream directory layout.
    if p.name.startswith('upstream-'): continue
    for link in re.findall(r'\]\(([^)]+)\)',p.read_text()):
        if '://' in link or link.startswith('#'): continue
        target=link.split('#')[0]
        if target and not (p.parent/target).exists(): raise SystemExit(f'Broken link: {p.name}: {link}')
PY
pass "Offline syntax and local links"

# --installed: the PATH entry must be a live link into *this* package. Renaming or
# moving the skill directory leaves the old symlink dangling while every in-package
# check still passes. SURGE_CLI_BIN (name or path) redirects the lookup so fixture
# runs stay isolated from the host install point.
if [ "$MODE" = --installed ]; then
  python3 - "$SELF_DIR/surge_cli.py" "$CLI" <<'PY' || fail "Installed surge-cli does not resolve into this package"
import os,sys
expected=os.path.realpath(sys.argv[1])
name=sys.argv[2]
def die(why):
    sys.stderr.write("installed-check: %s: %s\n" % (why,name))
    raise SystemExit(1)
if os.sep in name:
    found=name
else:
    found=next((os.path.join(d or ".",name) for d in os.environ.get("PATH","").split(os.pathsep)
                if os.path.lexists(os.path.join(d or ".",name))),None)
    if found is None: die("not found on PATH")
if not os.path.exists(found): die("missing target (broken link)")
if not (os.stat(found).st_mode & 0o111): die("not executable")
real=os.path.realpath(found)
if real != expected:
    sys.stderr.write("installed-check: points elsewhere: %s -> %s (expected %s)\n" % (name,real,expected))
    raise SystemExit(1)
PY
  pass "Installed surge-cli resolves to this package"
  exit 0
fi
[ "$MODE" != --offline ] || exit 0

# The temp workspace is only needed once a connected tier actually runs.
TMP="$(mktemp -d /tmp/surge-cli-accept.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT INT TERM

command -v "$CLI" >/dev/null || fail "surge-cli is not installed"
python3 - "$SELF_DIR/surge_cli.py" "$SELF_DIR/surge_ios.py" "$SELF_DIR/adapt_upstream_reference.py" <<'PY'
import sys
for name in sys.argv[1:]:
    source=open(name,encoding="utf-8").read()
    compile(source,name,"exec")
PY
pass "Python syntax"

"$CLI" --raw version > "$TMP/version.json"; json_check "$TMP/version.json" "version"
if [ "$MODE" = --network ]; then
cat > "$TMP/minimal.conf" <<'EOF'
[General]
loglevel = notify

[Rule]
FINAL,DIRECT
EOF
"$CLI" --check "$TMP/minimal.conf" > "$TMP/check.txt"
grep -qx 'OK' "$TMP/check.txt" || fail "official profile validation service check failed"
pass "official profile validation service"
fi
if [ -n "${SURGE_API_KEY:-}" ]; then
  python3 "$SELF_DIR/surge_ios.py" metrics > "$TMP/metrics.txt"
  grep -q '^# TYPE surge_build_info gauge$' "$TMP/metrics.txt" || fail "Prometheus metrics output is invalid"
  pass "Prometheus metrics endpoint"
fi
python3 - "$TMP/version.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x.get("controller-protocol",0)>=20, "Controller Protocol 20+ required"
assert x.get("system") in ("iOS","macOS"), "Unexpected Surge platform"
PY
pass "Controller handshake and capability"

"$CLI" --raw status > "$TMP/status.json"; json_check "$TMP/status.json" "status"
"$CLI" --raw summary > "$TMP/summary.json"; json_check "$TMP/summary.json" "summary"
"$CLI" --raw dump performance > "$TMP/performance.json"; json_check "$TMP/performance.json" "dump performance"
"$CLI" --raw rule match example.com > "$TMP/rule.json"; json_check "$TMP/rule.json" "rule match"
"$CLI" --raw rule temp list > "$TMP/temp-rules.json"; json_check "$TMP/temp-rules.json" "temporary rule list"
if [ "$MODE" = --network ]; then
  "$CLI" --raw dns lookup example.com > "$TMP/dns.json"; json_check "$TMP/dns.json" "dns lookup"
fi
"$CLI" --raw feature list > "$TMP/features.json"; json_check "$TMP/features.json" "feature list"
"$CLI" --raw module list > "$TMP/modules.json"; json_check "$TMP/modules.json" "module list"

if command -v timeout >/dev/null; then
  timeout 3 "$CLI" --raw watch speed > "$TMP/watch.jsonl" 2>/dev/null || code=$?
  code=${code:-0}
  [ "$code" -eq 0 ] || [ "$code" -eq 124 ] || [ "$code" -eq 143 ] || fail "watch speed failed"
  sed -n '1p' "$TMP/watch.jsonl" > "$TMP/watch-first.json"
  [ -s "$TMP/watch-first.json" ] || fail "watch speed produced no subscription frame"
  json_check "$TMP/watch-first.json" "watch speed first frame"
fi

printf '\nAcceptance passed: read-only commands only; no Surge settings were changed.\n'
