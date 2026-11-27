#!/usr/bin/env bash
# Рендерит контрольные кадры: scripts/stills.sh 30 90 160 ...
set -e
cd "$(dirname "$0")/.."
mkdir -p out/stills
for f in "$@"; do npx remotion still src/index.ts "${COMP:-Promo}" "out/stills/${COMP:-Promo}-f$(printf %04d "$f").png" --frame="$f" --scale=0.5 >/dev/null 2>&1 && echo "f$f"; done
