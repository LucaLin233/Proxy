#!/bin/sh
# Default: prepare only; no active files are changed.
set -eu
SELF_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
if [ "$#" -eq 0 ]; then
  exec python3 "$SELF_DIR/update_upstream.py" prepare
fi
exec python3 "$SELF_DIR/update_upstream.py" "$@"
