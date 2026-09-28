#!/usr/bin/env bash
#
# Build the extension and zip it so Chrome can actually load it.
#
#   extension-new/scripts/package.sh            production build
#   extension-new/scripts/package.sh --test     test build (permissions granted
#                                               up front, [poppin-spot] logging)
#   extension-new/scripts/package.sh --dir DIR  zip a directory that is ALREADY
#                                               built — no build step at all
#
# --dir exists because the owner's local test build lives outside this repo, at
# ~/v2tests/dist (see ~/v2tests/build.sh), and that is the tree actually loaded
# in Chrome while working. Zipping the thing you have been testing beats
# rebuilding something adjacent to it and hoping they match.
#
# WHAT A TEST BUILD CARRIES, because it is easy to send one by accident:
# scripting/tabs/<all_urls> are promoted from optional to REQUIRED, so the
# installer shows "read and change all your data" — and [poppin-spot] logging
# is on. Right for a tester, wrong for anybody else.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
# A tester on Windows hit "Manifest dosyası eksik veya okunamıyor" pointing at
# Downloads\dist. The build was fine — manifest.json was at the root of dist/
# the whole time. The zip was the problem: zipping the FOLDER puts `dist/` at
# the archive root, Windows then extracts that into a folder the user names
# `dist`, and the manifest ends up at Downloads\dist\dist\manifest.json. Chrome
# is told to load Downloads\dist, finds no manifest one level up from it, and
# reports a broken build that was never broken.
#
# So this zips the CONTENTS, not the folder. manifest.json sits at the archive
# root, and every extraction — Windows Explorer, macOS Archive Utility, unzip —
# produces exactly one folder with a manifest in it. There is no arrangement of
# "extract here" that can nest it.
#
# It also refuses to ship an archive without a manifest at the root, because
# that is the failure this file is named after and it should never leave a
# machine twice.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/poppin-extension.zip"

SRC="$ROOT/dist"

if [ "${1:-}" = "--dir" ]; then
  [ -n "${2:-}" ] || { echo "✗ --dir needs a path" >&2; exit 1; }
  SRC="${2%/}"
  echo "→ no build; packaging $SRC as it stands"
elif [ "${1:-}" = "--test" ]; then
  echo "→ test build (permissions granted up front, debug logging on)"
  POPPIN_TEST_BUILD=true npm run build
else
  echo "→ production build"
  npm run build
fi

[ -f "$SRC/manifest.json" ] || {
  echo "✗ $SRC/manifest.json is missing — that is not a loadable extension," >&2
  echo "  so there is nothing worth zipping." >&2
  exit 1
}

# Say it out loud rather than letting the archive carry it quietly. A test
# build looks identical from the outside and asks for far more at install.
if grep -q '"host_permissions"' "$SRC/manifest.json"; then
  echo "  ⚠ TEST BUILD — host permissions are REQUIRED, not optional, and"
  echo "    [poppin-spot] logging is on. Fine for a tester; not for a user."
fi

rm -f "$OUT"
# -r from INSIDE dist, so the archive root is the manifest's directory.
( cd "$SRC" && zip -qr "$OUT" . -x '*.DS_Store' '__MACOSX/*' )

# The check that matters, done on the ARTEFACT rather than on the intent: list
# the archive and confirm the manifest is at depth zero.
#
# THE HERESTRING IS LOAD-BEARING. Written as `unzip -l "$OUT" | grep -q ...`
# this guard failed on a perfectly good archive, twice, and sent me looking at
# the regex both times. The regex was right. `grep -q` exits the moment it
# finds a match, which breaks the pipe, which kills `unzip` with SIGPIPE —
# and `set -o pipefail` at the top of this file then reports the whole
# pipeline as failed. A successful match was being read as a failure. No pipe,
# no pipefail, no trap.
LIST=$(unzip -l "$OUT")
if ! grep -qE ' manifest\.json$' <<<"$LIST"; then
  echo "✗ manifest.json is not at the archive root — do not send this." >&2
  echo "$LIST" | head -20 >&2
  rm -f "$OUT"
  exit 1
fi

VERSION=$(grep -oE '"version"[^,]*' "$SRC/manifest.json" | head -1 | grep -oE '[0-9.]+')
echo
echo "✓ $OUT  (v${VERSION:-?}, $(du -h "$OUT" | cut -f1))"
echo
echo "  Chrome'da: chrome://extensions → Developer mode → Load unpacked"
echo "  Zip'i açtıktan sonra manifest.json'ın GÖRÜNDÜĞÜ klasörü seç."
