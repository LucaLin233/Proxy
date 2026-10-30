#!/bin/sh
# Install the bundled Minis Surge CLI. Credentials belong in Minis environment variables.
set -eu
SELF_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
TARGET="${SURGE_CLI_LINK:-/usr/local/bin/surge-cli}"

chmod 755 "$SELF_DIR"/*.py "$SELF_DIR"/*.sh
ln -sf "$SELF_DIR/surge_cli.py" "$TARGET"

# --installed recompiles the package and proves the new entry resolves back into it;
# a link that dangles or points elsewhere must never be reported as success. 核验走
# PATH 里的 `surge-cli`（名字，不是刚建的 $TARGET），否则 PATH 未含该目录或前方
# 有同名旧副本时仍会报安装成功，而之后的默认调用不会使用本次安装的包（F1）。
if ! SURGE_CLI_BIN=surge-cli sh "$SELF_DIR/acceptance.sh" --installed; then
  echo "Install failed: $TARGET does not resolve to $SELF_DIR/surge_cli.py" >&2
  exit 1
fi

echo "Installed: $TARGET -> $SELF_DIR/surge_cli.py"
if [ -n "${SURGE_API_KEY:-}" ]; then
  echo "SURGE_API_KEY: set"
  echo "Run: $SELF_DIR/acceptance.sh"
else
  echo "SURGE_API_KEY: missing"
  echo "Set it in Minis Settings -> Environment Variables, then run:"
  echo "  $SELF_DIR/acceptance.sh"
fi
