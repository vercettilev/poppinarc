#!/usr/bin/env bash
#
# Build the Arc edition of the extension into ~/v2tests/dist-arc, or its
# Arc mainnet build into ~/v2tests/dist-arc-mainnet.
#
#   ~/projects/poppinarc/extension/scripts/build-arc.sh            (testnet)
#   ~/projects/poppinarc/extension/scripts/build-arc.sh mainnet    (mainnet)
#
# Deliberately NOT ~/v2tests/build.sh: that one builds the live product from
# ~/projects/commentin-mono and pins the store id. This builds from poppinarc,
# with its own name and no manifest key, so it installs next to the
# store build instead of replacing it. Load it once with chrome://extensions →
# Load unpacked → ~/v2tests/dist-arc, then just press reload after each build.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-testnet}" in
  testnet) MODE=arc; DEST="$HOME/v2tests/dist-arc"; NAME="Poppin Arc (testnet)" ;;
  mainnet) MODE=arc-mainnet; DEST="$HOME/v2tests/dist-arc-mainnet"; NAME="Poppin on Arc" ;;
  *) echo "usage: build-arc.sh [testnet|mainnet]" >&2; exit 2 ;;
esac

cd "$REPO"
echo "→ building the Arc edition ($MODE) from $REPO"
POPPIN_TEST_BUILD=true npx vite build --mode "$MODE"
npx vite build -c vite.bridge.config.ts

python3 - "$REPO/dist/manifest.json" "$NAME" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
assert "key" not in m, "the Arc build must not carry the store key"
assert m["name"] == sys.argv[2], m["name"]
assert m.get("host_permissions"), "test build must grant host permissions"
print("manifest ok:", m["name"], m["version"])
PY

rm -rf "$DEST.new"
cp -R "$REPO/dist" "$DEST.new"
rm -rf "$DEST"
mv "$DEST.new" "$DEST"
echo "hazır → $DEST (chrome://extensions → reload; ilk kez ise Load unpacked)"
