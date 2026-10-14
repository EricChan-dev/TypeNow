#!/usr/bin/env python3
"""品牌锁标合成：喵学社 品牌名 + 彩色版徽标，排版生成纵向/横向两种锁标。

为什么不再从 AI 原图 (5)/(6) 抠取：原图右下角水印带与文字带同色（深藏青），
亮度/颜色键控都会把水印当内容；且 AI 生成的文字笔画发虚、字体不可控。
改用真实字体排版：文字矢量渲染、颜色精确、放大不糊。

字体：站酷快乐体（ZCOOL KuaiLe, OFL 1.1）——专为俏皮场景设计的开源中文字体。
许可全文见 tools/fonts/OFL-KuaiLe.txt，可随仓库再分发。

原文案考证：对原图 (5) 文字带做逐字位图结构分析（口+苗=喵、冖+子=学、礻+土=社），
确认为「喵学社」。文字主色取自原图实测中位数：(0,19,55) / (1,27,65)。

用法：先跑 build-web-logo.py 生成 source/color.png，再跑本脚本。
环境变量：WAVE=0 关闭逐字跳动（默认开）。
"""
from __future__ import annotations

import base64
import os
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]           # brand/web-logo
FONT = Path(__file__).resolve().parent / "fonts" / "ZCOOLKuaiLe-Regular.ttf"

TEXT = "喵学社"
NAVY = (0, 23, 60, 255)      # 原图文字主色 (0,19,55)/(1,27,65) 的中位
WAVE = os.environ.get("WAVE", "1") != "0"

VERT_RATIO = (0.46, 0.14)    # 纵向：字高/徽标高、间距/徽标高 —— 实测原 (5)：305/669、92/669
HORZ_RATIO = (0.70, 0.12)    # 横向：字高/徽标高（原 (6) 的 0.78 偏大，因原图徽标更扁）、间距/徽标宽


# ── 文字渲染 ────────────────────────────────────────────────────────────────
def char_tile(ch: str, font: ImageFont.FreeTypeFont, color: tuple) -> Image.Image:
    """单字画到透明画布后按墨迹紧裁。
    墨迹框必须用 PIL getbbox：本机 numpy 2.0.2 的 np.where 对二维布尔数组会返回
    错乱（乱序/反界）的列坐标（实测 bug，行与一维投影正常），不能用来取 bbox。"""
    s = font.size
    img = Image.new("RGBA", (s * 2, s * 2), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((s // 2, s // 2), ch, font=font, fill=color)
    box = img.getbbox()          # 画布纯透明 (0,0,0,0)，bbox 即墨迹范围
    if box is None:
        raise RuntimeError(f"字符 {ch!r} 渲染为空——字体缺字形（豆腐块）")
    return img.crop(box)


def render_text(text: str, char_h: int, color: tuple, wave: bool) -> Image.Image:
    """整行字。逐字渲染才能做逐字变换；字距手动控（快乐体自带留白很小，取字高 10%）。"""
    ss = 3                                  # 先 3 倍超采样再缩小，旋转与缩放边缘更顺
    font = ImageFont.truetype(str(FONT), round(char_h * ss))
    tiles = [char_tile(ch, font, color) for ch in text]
    gap = round(char_h * ss * 0.10)
    row = Image.new("RGBA", (sum(t.width for t in tiles) + gap * (len(tiles) - 1),
                             max(t.height for t in tiles) + round(char_h * ss * 0.10)),
                    (0, 0, 0, 0))
    x = 0
    for i, t in enumerate(tiles):
        ang = (4 if i % 2 == 0 else -4) if wave else 0          # 交替微倾，俏皮不散架
        dy = round(char_h * ss * 0.03) * (1 if i % 2 == 0 else -1) if wave else 0
        tr = t.rotate(ang, expand=True, resample=Image.BICUBIC)
        row.alpha_composite(tr, (x, (row.height - tr.height) // 2 + dy))
        x += t.width + gap
    box = row.getbbox()
    row = row.crop(box)
    w = max(1, round(row.width * char_h / row.height))
    return row.resize((w, round(char_h)), Image.LANCZOS)


def audit_text(row: Image.Image) -> None:
    """程序化核验渲染文字：3 个字簇、墨量合理（10–40%），防豆腐块/空渲染。"""
    m = np.asarray(row)[:, :, 3] > 16
    proj = m.sum(0)
    idx = np.where(proj > max(3, int(0.02 * m.shape[0])))[0]
    clusters, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - p > m.shape[0] * 0.08:
            clusters.append((s, p))
            s = i
        p = i
    clusters.append((s, p))
    ink = float(m.mean())
    assert len(clusters) == len(TEXT), f"字簇数 {len(clusters)} ≠ {len(TEXT)}: {clusters}"
    assert 0.10 < ink < 0.40, f"墨占比 {ink:.1%} 越界，疑似渲染异常"


# ── 两种锁标 ────────────────────────────────────────────────────────────────
def build_vertical(logo: Image.Image, char_ratio: float, gap_ratio: float) -> Image.Image:
    """纵向锁标：徽标在上、名字在下（比例实测自原 (5)）。"""
    h = round(logo.height * 1.0)
    txt = render_text(TEXT, round(h * char_ratio), NAVY, WAVE)
    gap = round(h * gap_ratio)
    pad = round(max(logo.width, txt.width) * 0.04)
    cv = Image.new("RGBA", (max(logo.width, txt.width) + 2 * pad,
                            h + gap + txt.height + 2 * pad), (0, 0, 0, 0))
    cv.alpha_composite(logo, ((cv.width - logo.width) // 2, pad))
    cv.alpha_composite(txt, ((cv.width - txt.width) // 2, pad + h + gap))
    return cv


def build_horizontal(logo: Image.Image, char_ratio: float, gap_ratio: float) -> Image.Image:
    """横向锁标：徽标在左、名字在右并垂直居中。"""
    h = logo.height
    txt = render_text(TEXT, round(h * char_ratio), NAVY, WAVE)
    gap = round(logo.width * gap_ratio)
    pad = round(h * 0.05)
    cv = Image.new("RGBA", (pad + logo.width + gap + txt.width + pad,
                            h + 2 * pad), (0, 0, 0, 0))
    cv.alpha_composite(logo, (pad, pad))
    cv.alpha_composite(txt, (pad + logo.width + gap, pad + (h - txt.height) // 2))
    return cv


# ── 派生与输出 ──────────────────────────────────────────────────────────────
def fit_height(im: Image.Image, height: int) -> Image.Image:
    w = max(1, round(im.width * height / im.height))
    return im.resize((w, height), Image.LANCZOS)


def save_png(im: Image.Image, path: Path) -> None:
    im.save(path, format="PNG")          # 不传 pnginfo：XMP/AIGC 元数据一并不带出


def main() -> int:
    if not FONT.exists():
        print(f"缺字体 {FONT}", file=sys.stderr)
        return 1
    src_out, png = ROOT / "source", ROOT / "png"

    logo = Image.open(src_out / "color.png").convert("RGBA")
    print(f"徽标 source/color.png {logo.size[0]}x{logo.size[1]}  字体 {FONT.name}  跳动={'开' if WAVE else '关'}")

    # 旧 AI 抠取版留档对比
    for role in ("brand-vertical", "brand-horizontal"):
        old = src_out / f"{role}.png"
        bak = src_out / f"{role}-ai.png"
        if old.exists() and not bak.exists():
            shutil.copy2(old, bak)

    built: dict[str, Image.Image] = {
        "brand-vertical": build_vertical(logo, *VERT_RATIO),
        "brand-horizontal": build_horizontal(logo, *HORZ_RATIO),
    }
    for name, im in built.items():
        a = np.asarray(im)[:, :, 3]
        corners = [a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]]
        audit_text(render_text(TEXT, 160, NAVY, WAVE))     # 渲染文字独立核验
        save_png(im, src_out / f"{name}.png")
        print(f"  ✓ source/{name}.png {im.size[0]}x{im.size[1]}  四角α={corners}")

    heights = {"brand-vertical": (128, 256, 512), "brand-horizontal": (48, 96, 192, 512)}
    for name, hs in heights.items():
        for h in hs:
            save_png(fit_height(built[name], h), png / f"{name}-{h}.png")
        print(f"  ✓ png/{name}-{{{','.join(map(str, hs))}}}.png")

    write_preview(built)
    print(f"完成 -> {ROOT}")
    return 0


# ── 预览页 ──────────────────────────────────────────────────────────────────
ALT_FONTS = [   # 仅预览对比用；主输出只用快乐体
    ("站酷快乐体（本次采用）", str(FONT), 0),
    ("Hiragino Sans GB W3", "/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
    ("Noto Sans SC", "/Applications/Companion.app/Contents/Resources/assets/Fonts/NotoSansSC-Regular.ttf", 0),
    ("汉仪楷体（WPS 内嵌）", "/Applications/wpsoffice.app/Contents/Resources/office6/fonts/HYKaiTiJ.ttf", 0),
]


def write_preview(built: dict[str, Image.Image]) -> None:
    def uri_img(im: Image.Image) -> str:
        import io
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    def uri_file(p: Path) -> str:
        return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()

    v, hz = built["brand-vertical"], built["brand-horizontal"]
    flat = build_vertical(Image.open(ROOT / "source" / "color.png").convert("RGBA"), *VERT_RATIO) \
        if WAVE else None
    alts = []
    for label, path, idx in ALT_FONTS:
        try:
            ft = ImageFont.truetype(path, 120, index=idx)
            tiles = [char_tile(ch, ft, NAVY) for ch in TEXT]
            w = sum(t.width for t in tiles) + 24
            hh = max(t.height for t in tiles) + 16
            row = Image.new("RGBA", (w, hh), (0, 0, 0, 0))
            x = 8
            for t in tiles:
                row.alpha_composite(t, (x, (hh - t.height) // 2))
                x += t.width + 8
            alts.append(f'<figure><img src="{uri_img(row)}">'
                        f'<figcaption>{label}</figcaption></figure>')
        except Exception:
            continue

    old_rows = "\n".join(
        f'<figure><img src="{uri_file(ROOT / "source" / f"{n}-ai.png")}">'
        f'<figcaption>旧 · AI 原图抠取（留档）</figcaption></figure>'
        for n in ("brand-vertical", "brand-horizontal")
        if (ROOT / "source" / f"{n}-ai.png").exists())

    def checker(uri: str, maxw: int) -> str:
        return f'<div class="board"><img src="{uri}" style="max-width:{maxw}px"></div>'

    html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>喵学社 · 品牌锁标（俏皮字体版）</title>
<style>
 body{{margin:0 auto;max-width:1200px;padding:24px;font:14px/1.6 -apple-system,"PingFang SC",sans-serif;color:#1c2430;background:#f6f7f9}}
 h1{{font-size:22px}} h2{{font-size:16px;margin:32px 0 8px;border-left:4px solid #0b3a6b;padding-left:8px}}
 .board{{background:repeating-conic-gradient(#e9ecf1 0 25%,#fff 0 50%) 0 0/20px 20px;display:inline-block;padding:12px;border-radius:8px;margin:4px}}
 figure{{margin:0;display:inline-block;vertical-align:top;text-align:center}}
 figcaption{{font-size:12px;color:#5b6472;margin-top:4px}}
 small{{color:#8a93a3;margin-left:6px}}
 img{{display:block;margin:0 auto}}
 .note{{color:#5b6472;font-size:13px}}
</style></head><body>
<h1>喵学社 · 品牌锁标（俏皮字体版）</h1>
<p class="note">字体：站酷快乐体（OFL 1.1，可随仓库分发）· 文字色 {(0,23,60)}（取自原图实测）·
逐字交替微倾 ±4° + 起伏 3%（WAVE=0 可关）· 徽标取去水印彩色版</p>

<h2>新 · 纵向锁标（名字在下方）</h2>
{checker(uri_img(v), 460)}
{checker(uri_file(ROOT / 'png' / 'brand-vertical-256.png'), 256)}

<h2>新 · 横向锁标（名字在右边）</h2>
{checker(uri_img(hz), 900)}
{checker(uri_file(ROOT / 'png' / 'brand-horizontal-192.png'), 480)}

<h2>跳动开关对比（下图=关 WAVE=0；默认输出=开，见顶部纵向锁标）</h2>
{checker(uri_img(flat), 300) if flat else ''}

<h2>字体对比（同一文案）</h2>
{''.join(alts)}

<h2>旧版对比（AI 原图抠取，留档为 source/*-ai.png）</h2>
{old_rows}
</body></html>"""
    (ROOT / "preview-lockup.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    import sys
    sys.exit(main())
