#!/bin/bash
# 用无头 Chrome 把 brand/svg/*.svg 光栅化成 brand/png/*.png（带透明通道）。
#
#   bash brand/tools/export-png.sh
#
# 两个坑：
# 1. Chrome headless=new 把截图写盘后不会自行退出，会一直挂着 —— 所以这里「轮询产物
#    完整性 + 立即 kill」，不能只等进程结束。
# 2. 每次都要用全新的 --user-data-dir，复用同一目录会因 SingletonLock 直接启动失败。
set -u

TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(dirname "$TOOLS")"
SRC="$OUT/svg"
DST="$OUT/png"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="${TMPDIR:-/tmp}/typenow-brand-export"
rm -rf "$TMP"; mkdir -p "$DST" "$TMP"

if [ ! -x "$CHROME" ]; then
  echo "找不到 Chrome：$CHROME（可用 CHROME=/path/to/chrome 覆盖）" >&2
  exit 1
fi

emit() {  # $1 源 svg  $2 输出名  $3 宽  $4 高
  local src="$1" out="$2" W="$3" H="$4" prof="$TMP/prof-$RANDOM$RANDOM"
  rm -f "$DST/$out"
  python3 - "$SRC/$src" "$TMP/w-$out.svg" "$W" "$H" <<'PY'
import re, sys
src, dst, W, H = sys.argv[1:5]
s = open(src, encoding="utf-8").read()
s = re.sub(r'width="[\d.]+" height="[\d.]+"', f'width="{W}" height="{H}"', s, count=1)
open(dst, "w", encoding="utf-8").write(s)
PY
  "$CHROME" --headless=new --no-sandbox --disable-gpu --disable-crash-reporter --hide-scrollbars \
    --crash-dumps-dir="$TMP/crash" --user-data-dir="$prof" --default-background-color=00000000 \
    --force-device-scale-factor=1 --window-size="$W,$H" --screenshot="$DST/$out" \
    "file://$TMP/w-$out.svg" >/dev/null 2>&1 &
  local pid=$!
  # PNG 结束标记是最后 4 个字节前的 IEND；文件出现≠写完了，所以查 IEND 再收工。
  for _ in $(seq 1 120); do
    if [ -s "$DST/$out" ] && tail -c 12 "$DST/$out" | grep -qa "IEND"; then break; fi
    sleep 0.25
  done
  sleep 0.4
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  rm -rf "$prof"
  if [ -s "$DST/$out" ]; then printf '  ✓ %-36s %s×%s\n' "$out" "$W" "$H"
  else printf '  ✗ %-36s 失败\n' "$out"; fi
}

emit icon-a.svg                    typenow-icon-1024.png            1024 1024
emit icon-a.svg                    typenow-icon-512.png              512  512
emit icon-a.svg                    typenow-icon-180.png              180  180
emit icon-a.svg                    typenow-icon-108.png              108  108
emit icon-a.svg                    typenow-icon-32.png                32   32
emit icon-a-simple.svg             typenow-icon-simple-32.png         32   32
emit icon-a-simple.svg             typenow-icon-simple-16.png         16   16
emit icon-mono-ink.svg             typenow-icon-mono-512.png         512  512
emit icon-mono-white.svg           typenow-icon-mono-white-512.png   512  512
emit logo-horizontal-a.svg         typenow-logo-2x.png               570  192
emit logo-horizontal-a.svg         typenow-logo-1x.png               285   96
emit logo-horizontal-a-reverse.svg typenow-logo-reverse-2x.png       570  192
emit logo-compact-a.svg            typenow-logo-compact-2x.png       488  192
emit logo-compact-a-simple.svg     typenow-logo-compact-simple-2x.png 488 192

# preview.png：Chrome 的 --screenshot 只截窗口大小，所以先用 --dump-dom 问出页面真实内容
# 高度（preview.py 把它写在 data-page-height 上），再按该高度整页截。
echo "  测量 preview.html 内容高度…"
"$CHROME" --headless=new --no-sandbox --disable-gpu --disable-crash-reporter --hide-scrollbars \
  --user-data-dir="$TMP/prof-dom" --window-size=1120,600 --virtual-time-budget=3000 \
  --dump-dom "file://$OUT/preview.html" > "$TMP/dom.html" 2>/dev/null &
DOM_PID=$!
for _ in $(seq 1 100); do
  grep -qa 'data-page-height' "$TMP/dom.html" 2>/dev/null && break
  sleep 0.25
done
kill "$DOM_PID" 2>/dev/null; wait "$DOM_PID" 2>/dev/null
PAGE_H="$(grep -o 'data-page-height="[0-9]*"' "$TMP/dom.html" 2>/dev/null | head -1 | grep -o '[0-9]*')"
PAGE_H="${PAGE_H:-1500}"
echo "  内容高度 ${PAGE_H}px"
rm -f "$OUT/preview.png"
"$CHROME" --headless=new --no-sandbox --disable-gpu --disable-crash-reporter --hide-scrollbars \
  --crash-dumps-dir="$TMP/crash" --user-data-dir="$TMP/prof-prev" \
  --force-device-scale-factor=1.5 --window-size="1120,$PAGE_H" \
  --screenshot="$OUT/preview.png" "file://$OUT/preview.html" >/dev/null 2>&1 &
PREV_PID=$!
for _ in $(seq 1 120); do
  if [ -s "$OUT/preview.png" ] && tail -c 12 "$OUT/preview.png" | grep -qa "IEND"; then break; fi
  sleep 0.25
done
sleep 0.4
kill "$PREV_PID" 2>/dev/null; wait "$PREV_PID" 2>/dev/null
if [ -s "$OUT/preview.png" ]; then echo "  ✓ preview.png 1120×${PAGE_H} @1.5x"
else echo "  ✗ preview.png 失败"; fi
echo "完成 → $DST"
