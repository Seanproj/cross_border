#!/bin/bash
# 공식 출처 페이지를 내려받아 텍스트로 변환합니다 (출처 검증용 스냅샷, 저장소에 커밋하지 않음).
# usage: SNAPSHOT_DIR=/path/to/snapshots scripts/curation/fetch.sh <snapshot_name> <url>
set -euo pipefail
DIR="${SNAPSHOT_DIR:?set SNAPSHOT_DIR}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR"
code=$(curl -sL -A "Mozilla/5.0 (cross-border-life-os source check)" -m 30 -o "$DIR/$1.html" -w '%{http_code} %{url_effective}' "$2")
echo "$1 $code"
python3 -I "$HERE/totext.py" "$DIR/$1.html" > "$DIR/$1.txt"
