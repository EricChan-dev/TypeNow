#!/usr/bin/env python3
"""把豆包生成的 7 张 logo 原图，做成网站需要的全套资产。

    python3 brand/web-logo/tools/build-web-logo.py        # 默认 SRC_DIR=~/Downloads

输入：`~/Downloads/生成猫碗换书的logo*.png`。
产物：`brand/web-logo/source/`（去水印原图）、`brand/web-logo/png/`（各尺寸）、
      `brand/web-logo/favicon.ico`、`brand/web-logo/preview.html`。

三处「为什么这么写」，避免后人重走：

1. **水印靠「带检测 + 区域钳位」切掉，不靠修补。** 7 张原图的右下角水印是同一个
   独立横带（1536 高图实测 y1452–1506 / x1263–1501；2688×896 那张 y847–878 /
   x2529–2667），与正文之间隔着 ≥100 行空白。两道保险：
   (a) 算内容 bbox 时把「水印区」（x ≥ 75%w 且 y ≥ 90%h）从墨迹掩码里剔除；
   (b) 裁切框下缘硬性钳位在 90%h —— 比水印带起点（94.5%h）还低 4.5%，
   数学上保证水印像素进不了画面。inpaint 类修补在干净底色上必留涂抹痕迹，
   这里整带切除反而零痕迹。

2. **7 张按三种方式处理，对应用户给变体起的名字。**
   - `flood`（3 张彩色图）：边缘 8 个种子泛洪挖掉白底。图形内部的封闭白
     （书页、猫脸）是设计的一部分，保留为不透明纯白 —— 站点是浅色底，不可见。
   - `opaque`（line / line-reverse）：线条版与反白线条版，只去水印、保底色。
     用户命名里就分了两套：不带 -bg 的是「保留底色版」。
   - `lum`（line-bg / line-reverse-bg）：灰度线条的透明背景版。泛洪会把封闭
     圈里的灰底留成灰块（白底页面上是脏斑），所以改用亮度键控：|lum − bg_lum|
     超过死区 16 后线性映射到 α（实测灰底噪声 |Δlum| ≤ 15，死区整片归零；
     (2) 底部还有一条 lum≈207 的暗色边带，按墨迹极性自动归透明）。
     极性由掩码内亮度均值 vs 背景亮度判定：黑线白底 / 白线灰底，同一套代码。
   原图全部是 RGB 无透明通道（「透明背景版」其实被压平到纯色底了），
   真 alpha 在这里重建。

3. **XMP 不写出。** 原图 XMP 内嵌 TC260 AIGC 标签（ContentProducer=doubao），
   保存时不传 pnginfo，PIL 就不会把它带进产物。
"""

from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ── 路径与角色映射（映射依据见 README「7 张源图怎么认出来的」）───────────────
ROOT = Path(__file__).resolve().parents[1]           # brand/web-logo
SRC_DIR = Path(os.environ.get("SRC_DIR", Path.home() / "Downloads"))
SRC_STEM = "生成猫碗换书的logo"

ROLES: dict[str, str] = {
    "": "color",                 # 彩色版（猫头 + 摊开的书，无文字）
    "(1)": "line",               # 线条版（黑线白底）
    "(2)": "line-reverse-bg",    # 反白线条透明背景版（白线灰底 → 键控）
    "(3)": "line-reverse",       # 反白线条版（白线深底）
    "(4)": "line-bg",            # 线条透明背景版（黑线白底 → 键控）
    # (5)/(6) 品牌锁标不再从 AI 原图抠取：原图文字带被水印带污染，且 AI 生成的
    # 字体不可控。两种锁标改由 build-brand-lockup.py 用真实字体排版合成。
    "(5)": None,
    "(6)": None,
}

PROCESS: dict[str, str] = {
    "color": "flood",
    "line": "opaque",
    "line-reverse": "opaque",
    "line-bg": "lum",
    "line-reverse-bg": "lum",
}

# ── 常量 ────────────────────────────────────────────────────────────────────
WHITE = (255, 255, 255, 255)     # maskable / apple-touch 垫白底（图形主体是深蓝）
PAD_RATIO = 0.04                 # 内容 bbox 外的留白，按内容边长算
KEY_TOL = 48                     # 泛洪容差（RGB 三通道绝对差之和）
DEAD = 16                        # 亮度键控死区，噪声(≤15)整片归零
INK_THRESH = 45                  # 墨迹判定阈值（RGB 绝对差之和）
WM_X0, WM_Y0 = 0.75, 0.90        # 水印区起点 + 裁切下缘钳位线


def edge_bg(a: np.ndarray) -> np.ndarray:
    """背景色 = 四边 6px 带的中位数，比取单角稳。"""
    border = np.concatenate([
        a[0:6].reshape(-1, 3), a[-6:].reshape(-1, 3),
        a[:, 0:6].reshape(-1, 3), a[:, -6:].reshape(-1, 3),
    ])
    return np.median(border, 0)


def ink_mask(a: np.ndarray, bg: np.ndarray) -> np.ndarray:
    return np.abs(a - bg).sum(2) > INK_THRESH


def drop_wm_zone(m: np.ndarray) -> np.ndarray:
    """从墨迹掩码里剔除水印区（就地修改并返回）。"""
    h, w = m.shape
    m[int(h * WM_Y0):, int(w * WM_X0):] = False
    return m


def bbox_from_mask(m: np.ndarray) -> tuple[int, int, int, int]:
    """(左,上,右,下) 半开区间。行列阈值 = max(3, 0.2% 边长)，孤噪点撑不爆 bbox。"""
    rows = np.where(m.sum(1) > max(3, int(0.002 * m.shape[1])))[0]
    cols = np.where(m.sum(0) > max(3, int(0.002 * m.shape[0])))[0]
    if not len(rows) or not len(cols):
        raise RuntimeError("没找到内容，检查背景色估计是否失败")
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def lum_key(a: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """灰度线条版专用：α = (|lum − bg_lum| − DEAD) 线性归一，超白不超。"""
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    bg_lum = float(0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2])
    m = drop_wm_zone(ink_mask(a, bg))
    if not m.any():
        raise RuntimeError("键控前没找到墨迹")
    light_ink = float(lum[m].mean()) > bg_lum          # 白线(亮墨) vs 黑线(暗墨)
    if light_ink:
        denom = max(255.0 - bg_lum - DEAD, 1.0)
        alpha = (lum - bg_lum - DEAD) / denom * 255.0
    else:
        denom = max(bg_lum - DEAD, 1.0)
        alpha = (bg_lum - lum - DEAD) / denom * 255.0
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    return np.dstack([a.astype(np.uint8), alpha])


def flood_key(im: Image.Image, tol: int = KEY_TOL) -> Image.Image:
    """从四边种子泛洪挖外部底色；封闭内部白不受影响。alpha 轻模糊一档抗锯齿。"""
    rgb = im.convert("RGB")
    w, h = rgb.size
    sentinel = (255, 0, 254)          # 原图几乎不可能出现的标记色
    work = rgb.copy()
    for seed in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
                 (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)):
        if work.getpixel(seed) != sentinel:
            ImageDraw.floodfill(work, seed, sentinel, thresh=tol)
    arr = np.asarray(work)
    flooded = (arr[:, :, 0] == 255) & (arr[:, :, 1] == 0) & (arr[:, :, 2] == 254)
    alpha = np.where(flooded, 0, 255).astype(np.uint8)
    alpha = np.asarray(
        Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.6))
    ).astype(np.uint8)
    out = rgb.convert("RGBA")
    out.putalpha(Image.fromarray(alpha))
    return out


def build_source(path: Path, role: str) -> tuple[Image.Image, str]:
    """一张原图 → 去水印 + 抠图 + 补边距后的 RGBA 图，外加一行诊断信息。"""
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    h, w = a.shape[:2]
    bg = edge_bg(a)
    proc = PROCESS[role]
    if proc == "lum":
        rgba = lum_key(a, bg)
        # 水印是暗色文字，在全图键控时也会拿到 alpha，把 bbox 底边撑到水印带
        # （裁切有钳位兜底，但 padding 会被撑大、底部多出大片透明死区）——同样剔除。
        m = drop_wm_zone(rgba[:, :, 3] > 16)
    else:
        m = drop_wm_zone(ink_mask(a, bg))
    x0, y0, x1, y1 = bbox_from_mask(m)
    px, py = int((x1 - x0) * PAD_RATIO), int((y1 - y0) * PAD_RATIO)
    cx0, cx1 = max(0, x0 - px), min(w, x1 + px)
    cy0 = max(0, y0 - py)
    cy1 = min(h, y1 + py, int(h * WM_Y0))    # 钳位：水印带起点在 94.5%h，进不来
    if proc == "lum":
        out = Image.fromarray(rgba[cy0:cy1, cx0:cx1])
    elif proc == "opaque":
        rgb = a[cy0:cy1, cx0:cx1].astype(np.uint8)
        out = Image.fromarray(np.dstack([rgb, np.full(rgb.shape[:2], 255, np.uint8)]))
    else:
        out = flood_key(Image.fromarray(a[cy0:cy1, cx0:cx1].astype(np.uint8)))
    note = f"clip y[{cy0},{cy1}) ≤ 钳位{int(h * WM_Y0)}"
    return out, note


# ── 排版与落盘 ──────────────────────────────────────────────────────────────
def fit_square(im: Image.Image, size: int, fill_ratio: float = 1.0,
               background: tuple[int, int, int, int] | None = None) -> Image.Image:
    """等比缩进正方形画布，居中。fill_ratio<1 用于 maskable / apple 的安全区。"""
    box = int(size * fill_ratio)
    scale = min(box / im.width, box / im.height)
    new = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                    Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    canvas.alpha_composite(new, ((size - new.width) // 2, (size - new.height) // 2))
    return canvas


def fit_height(im: Image.Image, height: int) -> Image.Image:
    scale = height / im.height
    return im.resize((max(1, round(im.width * scale)), height), Image.LANCZOS)


def save_png(im: Image.Image, path: Path) -> None:
    """保存 PNG。不传 pnginfo —— XMP / TC260 AIGC 标签不会被带进产物。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)


# ── 主流程 ──────────────────────────────────────────────────────────────────
def main() -> int:
    src_files = sorted(SRC_DIR.glob(f"{SRC_STEM}*.png"))
    if not src_files:
        print(f"在 {SRC_DIR} 找不到 {SRC_STEM}*.png", file=sys.stderr)
        return 1

    png_dir, src_out = ROOT / "png", ROOT / "source"
    built: dict[str, Path] = {}

    print(f"源目录 {SRC_DIR}")
    for path in src_files:
        suffix = path.stem[len(SRC_STEM):].strip()
        role = ROLES.get(suffix)
        if role is None:
            note = "（锁标改由 build-brand-lockup.py 合成）" if suffix in ROLES else ""
            print(f"  ? 跳过变体 {path.name} {note}")
            continue
        out, note = build_source(path, role)
        dst = src_out / f"{role}.png"
        save_png(out, dst)
        coverage = 1 - (np.asarray(out)[:, :, 3] == 0).mean()
        built[role] = dst
        print(f"  ✓ {path.name:36s} -> source/{role}.png {out.size[0]}x{out.size[1]} "
              f"不透明 {coverage:.1%}  {note}")

    # ── 网站图标：全部从彩色版派生 ──────────────────────────────────────────
    color = Image.open(built["color"]).convert("RGBA")
    ICON_SIZES = (16, 32, 48, 64, 96, 128, 144, 180, 192, 256, 512)
    for size in ICON_SIZES:
        save_png(fit_square(color, size), png_dir / f"icon-{size}.png")
    print(f"  ✓ png/icon-{{{ICON_SIZES[0]}…{ICON_SIZES[-1]}}}.png")

    # maskable：Android 裁圆，图形压到 72% 保安全区；垫白底（图形主体是深蓝）。
    for size in (192, 512):
        save_png(fit_square(color, size, 0.72, WHITE), png_dir / f"icon-maskable-{size}.png")
    print("  ✓ png/icon-maskable-{192,512}.png（白底）")

    # apple-touch-icon：iOS 对透明通道合成结果不可预测，必须实底白。
    save_png(fit_square(color, 180, 0.88, WHITE), png_dir / "apple-touch-icon.png")
    print("  ✓ png/apple-touch-icon.png（180，白底）")

    fit_square(color, 256).save(ROOT / "favicon.ico", format="ICO",
                                sizes=[(16, 16), (32, 32), (48, 48)])
    print("  ✓ favicon.ico (16/32/48)")

    # ── 品牌锁标 ────────────────────────────────────────────────────────────
    for role, heights in (("brand-horizontal", (48, 96, 192)),
                          ("brand-vertical", (128, 256))):
        if role not in built:
            continue
        lock = Image.open(built[role]).convert("RGBA")
        for h in heights:
            save_png(fit_height(lock, h), png_dir / f"{role}-{h}.png")
        print(f"  ✓ png/{role}-{{{','.join(map(str, heights))}}}.png")

    # ── 线条系只留一张 512 备用（站点当前用不到更小的）──────────────────────
    for role in ("line", "line-reverse", "line-bg", "line-reverse-bg"):
        if role in built:
            save_png(Image.open(built[role]).convert("RGBA"), png_dir / f"{role}-512.png")
    print("  ✓ png/line*-512.png")

    write_preview(built)
    print(f"完成 -> {ROOT}")
    return 0


# ── 预览页 ──────────────────────────────────────────────────────────────────
PREVIEW_LABELS = {
    "color": ("彩色版", "泛洪抠透明底"),
    "line": ("线条版", "保白底"),
    "line-bg": ("线条透明背景版", "亮度键控"),
    "line-reverse": ("反白线条版", "保深底"),
    "line-reverse-bg": ("反白线条透明背景版", "亮度键控"),
}


def write_preview(built: dict[str, Path]) -> None:
    """自包含预览页：所有图内联成 data URI，双击即开，不依赖服务器。"""
    def uri(p: Path) -> str:
        return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()

    # 品牌锁标（brand-vertical/horizontal）由 build-brand-lockup.py 单独出预览页
    order = ["color", "line", "line-bg", "line-reverse", "line-reverse-bg"]
    rows = "\n".join(
        f'<figure><img src="{uri(built[k])}" alt="{k}">'
        f'<figcaption>{PREVIEW_LABELS[k][0]}<small>{k}.png · {PREVIEW_LABELS[k][1]}</small>'
        f'</figcaption></figure>'
        for k in order if k in built
    )
    png = ROOT / "png"
    strip = "\n".join(
        f'<figure><img src="{uri(png / f"icon-{w}.png")}" style="width:{w}px;height:{w}px">'
        f'<figcaption>icon-{w}</figcaption></figure>'
        for w in (16, 32, 48, 64, 96, 128, 180, 192)
    ) + "\n".join(
        f'<figure><img class="pad" src="{uri(png / f"icon-maskable-{w}.png")}" '
        f'style="width:{min(w, 128)}px;height:{min(w, 128)}px">'
        f'<figcaption>maskable-{w}<small>白底·72%安全区</small></figcaption></figure>'
        for w in (192, 512)
    ) + f'<figure><img class="pad" src="{uri(png / "apple-touch-icon.png")}" ' \
        f'style="width:128px;height:128px"><figcaption>apple-touch-icon<small>白底实底</small>' \
        f'</figcaption></figure>'
    dark = "\n".join(
        f'<figure><img class="noname" src="{uri(built[k])}">'
        f'<figcaption>{PREVIEW_LABELS[k][0]}</figcaption></figure>'
        for k in ("line-reverse",) if k in built
    )
    html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>喵学社 · 网站 logo 资产</title>
<style>
  body {{ font: 14px/1.6 -apple-system, "PingFang SC", sans-serif; margin: 40px auto;
         max-width: 1120px; padding: 0 24px; color: #0f172a; background: #fff; }}
  h1 {{ font-size: 20px; }} h2 {{ font-size: 15px; margin-top: 44px; color: #475569; }}
  .grid {{ display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-end; }}
  figure {{ margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }}
  img {{ max-width: 260px; max-height: 200px;
         background: repeating-conic-gradient(#eef2f6 0 25%, #fff 0 50%) 0 0/16px 16px;
         border: 1px solid #e2e8f0; border-radius: 6px; }}
  img.pad {{ background: #fff; }} img.noname {{ border: none; background: none; }}
  figcaption {{ font-size: 12px; color: #64748b; text-align: center; }}
  figcaption small {{ display: block; color: #94a3b8; }}
  .dark {{ background: #0b1220; padding: 24px; border-radius: 8px; }}
  p.note {{ color: #64748b; font-size: 12px; }}
</style></head><body>
<h1>喵学社 · 网站 logo 资产（去水印 + 抠图 + 全尺寸）</h1>
<p class="note">棋盘格 = 透明。全部由 <code>brand/web-logo/tools/build-web-logo.py</code>
从豆包原图生成；水印带整条切除，XMP/AIGC 元数据不写出。核对无误后再接入站点。</p>

<h2>七个变体（去水印后原图）</h2>
<div class="grid">{rows}</div>

<h2>网站图标（取自彩色版）</h2>
<div class="grid">{strip}</div>

<h2>深色底检查</h2>
<div class="dark"><div class="grid">{dark}</div></div>
</body></html>
"""
    (ROOT / "preview.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
