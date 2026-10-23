#!/usr/bin/env bash
# GitHub Pages 静态导出。访客 Demo 不调用 /api/*；构建时暂移开以免 output: export 失败。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ASIDE=""
cleanup() {
  if [[ -n "$ASIDE" && -d "$ASIDE" ]]; then
    mkdir -p "$ROOT/app"
    mv "$ASIDE" "$ROOT/app/api"
  fi
}
trap cleanup EXIT

if [[ -d app/api ]]; then
  ASIDE="$(mktemp -d)"
  mv app/api "$ASIDE/api"
  ASIDE="$ASIDE/api"
fi

COMMIT="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
BUSINESS="013aa9d56a16fb32f485d5ac8d072e5fb3af0abd"
PAGES_BASE_PATH="${PAGES_BASE_PATH:-/cooec-fixed-demo}"
PAGES_BASE_PATH="${PAGES_BASE_PATH%/}"
mkdir -p public/deliverables
cat > public/deliverables/r32-build.json <<EOF
{"version":"cooec-fixed-demo","commit":"$SHORT","full":"$COMMIT","business_commit":"$BUSINESS","basePath":"$PAGES_BASE_PATH","stamped_at":"github-pages-build"}
EOF
echo "[pages] 打入部署提交 $SHORT ，业务版本 $BUSINESS ，basePath=$PAGES_BASE_PATH"

export GITHUB_PAGES=1
export PAGES_BASE_PATH
export NEXT_TELEMETRY_DISABLED=1
npm run build
touch out/.nojekyll
# 无尾斜杠的地址在 GitHub Pages 上不会打开目录里的 index.html，因此另存一份同名页面。
python3 - <<'PY'
import os
import shutil
root = "out"
for dirpath, dirnames, filenames in os.walk(root):
    if "index.html" not in filenames or dirpath == root:
        continue
    dest = os.path.join(os.path.dirname(dirpath), os.path.basename(dirpath) + ".html")
    if os.path.exists(dest):
        continue
    shutil.copy2(os.path.join(dirpath, "index.html"), dest)
PY
echo "[pages] 静态导出完成：out/ （basePath=${PAGES_BASE_PATH}, trailingSlash） 提交 $SHORT"
