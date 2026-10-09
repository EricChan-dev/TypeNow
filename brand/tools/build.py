# -*- coding: utf-8 -*-
"""句学社 · TypeNow 品牌资产生成器。

    PYTHONPATH=/tmp/pylibs python3 brand/tools/build.py

输出 brand/svg/*.svg。文字全部转曲，副图例「中」也用字形而非几何拼装（几何版方框
压扁后会读成 φ），因此产物不依赖任何系统字体。

几何基准（96×96 网格）：外框＝键身、内框＝键面。两层同心圆角矩形是「键帽」最干净的
表达——早期试过「上宽下窄的梯形侧壁」，渲染出来读成火把/铲子，已废弃。
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outline import cjk, ink_bounds, latin, normalized          # noqa: E402

TOOLS = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(TOOLS)
SVG = os.path.join(OUT, "svg")
os.makedirs(SVG, exist_ok=True)

# ── 品牌色：--primary / --accent 取自 src/app/globals.css ─────────────────
AMBER = "#f59e0b"
AMBER_MID = "#d97706"
AMBER_DEEP = "#b45309"
BLUE = "#1e40af"
INK = "#0f172a"
INK_REV = "#f1f5f9"
MUTED = "#64748b"
MUTED_REV = "#94a3b8"
WHITE = "#ffffff"

# ── 键帽几何 ─────────────────────────────────────────────────────────────
VB = 96.0
BODY = (6.0, 5.0, 84.0, 86.0, 18.0)      # 键身
FACE = (12.0, 11.0, 72.0, 68.0, 13.0)    # 键面：上/左右内缩 6，底部内缩 12 → 形成正面壁

# ── 标头文案。改动这里要同步下面的字符集，字体选择按「是否覆盖全部字符」自动挑 ──
# 2026-10-08 由「码上英语」更名为「句学社」：字符集、子集字体、SVG 里转曲的字形
# 全部由这一行派生，所以改名只动这里，再跑 subset-fonts.py + build.py 即可。
CJK_TEXT, LATIN_TEXT = "句学社", "TypeNow"
CJK_CHARS = set(CJK_TEXT) | {"中"}        # 标头 3 字 ＋ 图标左上副图例
LATIN_CHARS = set(LATIN_TEXT) | {"A"}   # 标头 TypeNow ＋ 图标主图例 A

CJK = lambda: cjk(CJK_CHARS)             # noqa: E731
INTER_B = lambda: latin(LATIN_CHARS)     # noqa: E731


def f(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def rr_d(b):
    x, y, w, h, r = b
    return (f"M {f(x + r)} {f(y)} L {f(x + w - r)} {f(y)} A {f(r)} {f(r)} 0 0 1 {f(x + w)} {f(y + r)} "
            f"L {f(x + w)} {f(y + h - r)} A {f(r)} {f(r)} 0 0 1 {f(x + w - r)} {f(y + h)} "
            f"L {f(x + r)} {f(y + h)} A {f(r)} {f(r)} 0 0 1 {f(x)} {f(y + h - r)} "
            f"L {f(x)} {f(y + r)} A {f(r)} {f(r)} 0 0 1 {f(x + r)} {f(y)} Z")


def rr(b, fill):
    return f'<path d="{rr_d(b)}" fill="{fill}"/>'


def place_glyph(font, ch, ink_h, cx=None, cy=None, box=None, color=WHITE):
    """按墨迹框对齐单个字形（而不是用基线+估计坐标），box 为墨迹框左上角。"""
    (x0, y0, x1, y1), _ = ink_bounds(font, ch)
    s = ink_h / (y1 - y0)
    w, h = (x1 - x0) * s, (y1 - y0) * s
    if box:
        bx, by = box[0] - x0 * s, box[1] + y1 * s
    else:
        bx, by = cx - w / 2 - x0 * s, cy - h / 2 + y1 * s
    d = normalized(font, ch, 1000)[0]
    return f'<g transform="translate({f(bx)} {f(by)}) scale({f(s)})"><path d="{d}" fill="{color}"/></g>'


def zhong(x, y, h, color=WHITE):
    return place_glyph(CJK(), "中", h, box=(x, y), color=color)


def content_dual():
    """方案 A 键面：主图例大 A ＋ 左上副图例「中」—— 真实键盘的双注音排法。"""
    return (place_glyph(INTER_B(), "A", 37, cx=49.0, cy=45.0) + zhong(17.5, 14.5, 13.5))


def content_a_only():
    return place_glyph(INTER_B(), "A", 44, cx=48.5, cy=44.0)


def content_zh_en():
    """方案 B 键面：中 / A。斜杠即「中英对照」的最短写法。"""
    return (zhong(14.0, 28.0, 30.0)
            + '<path d="M 46.5 57 L 54.0 25" stroke="#ffffff" stroke-width="4.4" stroke-linecap="round"/>'
            + place_glyph(INTER_B(), "A", 29, cx=72.5, cy=44.0))


def content_arrow(color=WHITE):
    """方案 C 键面：45° 上行箭。寓意「码上」——按键即练、快速提升。"""
    k = math.sqrt(0.5)
    dx, dy, px, py = k, -k, k, k          # 方向 / 垂直分量
    cx, cy = 48.0, 44.0
    sx, sy = cx - 21 * dx, cy - 21 * dy
    tx, ty = cx + 22 * dx, cy + 22 * dy
    hw, hh, hl = 5.2, 12.5, 13.0          # 杆半宽 / 头半宽 / 头长
    bx, by = tx - hl * dx, ty - hl * dy
    pts = [(sx + hw * px, sy + hw * py), (bx + hw * px, by + hw * py),
           (bx + hh * px, by + hh * py), (tx, ty),
           (bx - hh * px, by - hh * py), (bx - hw * px, by - hw * py),
           (sx - hw * px, sy - hw * py)]
    return '<path d="M ' + " L ".join(f"{f(x)} {f(y)}" for x, y in pts) + f' Z" fill="{color}"/>'


def keycap(body_fill, face_fill, content=""):
    return rr(BODY, body_fill) + rr(FACE, face_fill) + content


ICONS = {
    "a": ("双注音键帽 · 大 A ＋ 左上「中」（深蓝键身）", lambda: keycap(BLUE, AMBER, content_dual())),
    "b": ("中 / A 键帽（暖调键身）", lambda: keycap(AMBER_MID, AMBER, content_zh_en())),
    "c": ("上行箭键帽", lambda: keycap(BLUE, AMBER, content_arrow())),
}
BODY_OF = {"a": (BLUE, AMBER), "b": (AMBER_MID, AMBER), "c": (BLUE, AMBER)}

# ── 文字标 ───────────────────────────────────────────────────────────────
CJK_EM, LATIN_EM = 56.0, 25.0
CJK_TRACK, LATIN_TRACK = -0.03, 0.02      # 中文收紧、英文拉开，是标头字距的常规做法
LINE_GAP = 11.0


def text_stack(text_color, sub_color):
    cd, cw, cs = normalized(CJK(), CJK_TEXT, CJK_EM, CJK_TRACK)
    ld, lw, ls = normalized(INTER_B(), LATIN_TEXT, LATIN_EM, LATIN_TRACK)
    cjk_base = 0.88 * CJK_EM                       # 让中文墨迹块垂直居中于图标
    lat_base = cjk_base + LINE_GAP + 0.727 * LATIN_EM
    h = lat_base + 0.24 * LATIN_EM                 # 24% 留给 y 的下伸部
    body = (f'<g transform="translate(0 {f(cjk_base)}) scale({f(cs)})"><path d="{cd}" fill="{text_color}"/></g>'
            f'<g transform="translate(0 {f(lat_base)}) scale({f(ls)})"><path d="{ld}" fill="{sub_color}"/></g>')
    return body, max(cw, lw), h


def lockup(name, icon, text_color, sub_color):
    gap, (body, tw, th) = 26.0, text_stack(text_color, sub_color)
    W = VB + gap + tw
    # aria-label / <title> 也走 CJK_TEXT / LATIN_TEXT，改名时不会漏掉无障碍文案
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(W)} {f(VB)}" width="{f(W)}" '
           f'height="{f(VB)}" role="img" aria-label="{CJK_TEXT} {LATIN_TEXT}">'
           f'<title>{CJK_TEXT} · {LATIN_TEXT}</title>'
           f'{icon()}<g transform="translate({f(VB + gap)} {f((VB - th) / 2)})">{body}</g></svg>')
    write(name, svg)
    return W, VB


def compact(name, icon, text_color):
    gap, em = 20.0, 44.0
    d, wdt, s = normalized(CJK(), CJK_TEXT, em, CJK_TRACK)
    W = VB + gap + wdt
    base = VB / 2 + 0.88 * em / 2 - 0.05 * em
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(W)} {f(VB)}" width="{f(W)}" '
           f'height="{f(VB)}" role="img" aria-label="{CJK_TEXT}"><title>{CJK_TEXT}</title>{icon()}'
           f'<g transform="translate({f(VB + gap)} {f(base)}) scale({f(s)})">'
           f'<path d="{d}" fill="{text_color}"/></g></svg>')
    write(name, svg)
    return W, VB


def icon_only(name, icon):
    write(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(VB)} {f(VB)}" width="{f(VB)}" '
                f'height="{f(VB)}" role="img" aria-label="{CJK_TEXT}">'
                f'<title>{CJK_TEXT} · {LATIN_TEXT}</title>{icon()}</svg>')


def icon_mono(name, color, legend):
    """单色版：even-odd 一次挖出键帽环，不用 mask、不依赖背景色。"""
    ring = f'<path fill-rule="evenodd" d="{rr_d(BODY)} {rr_d(FACE)}" fill="{color}"/>'
    write(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(VB)} {f(VB)}" width="{f(VB)}" '
                f'height="{f(VB)}" role="img" aria-label="{CJK_TEXT}">'
                f'<title>{CJK_TEXT} · {LATIN_TEXT}</title>{ring}{legend}</svg>')


def write(name, svg):
    with open(os.path.join(SVG, name), "w", encoding="utf-8") as fh:
        fh.write(svg)
    print(f"  {name:34s} {len(svg):>6d} B")


def main():
    print("生成 SVG：")
    sizes = {}
    for k, (label, fn) in ICONS.items():
        icon_only(f"icon-{k}.svg", fn)
        sizes[f"logo-horizontal-{k}"] = lockup(f"logo-horizontal-{k}.svg", fn, INK, MUTED)
        lockup(f"logo-horizontal-{k}-reverse.svg", fn, INK_REV, MUTED_REV)
        sizes[f"logo-compact-{k}"] = compact(f"logo-compact-{k}.svg", fn, INK)
    for k, (bc, fc) in BODY_OF.items():
        simple = lambda b=bc, c=fc: keycap(b, c, content_a_only())   # noqa: E731
        icon_only(f"icon-{k}-simple.svg", simple)
        compact(f"logo-compact-{k}-simple.svg", simple, INK)
    icon_mono("icon-mono-ink.svg", INK, place_glyph(INTER_B(), "A", 44, cx=48.5, cy=44.0, color=INK))
    icon_mono("icon-mono-white.svg", WHITE, place_glyph(INTER_B(), "A", 44, cx=48.5, cy=44.0, color=WHITE))
    icon_mono("icon-mono-arrow.svg", INK, content_arrow(INK))
    with open(os.path.join(OUT, "sizes.json"), "w") as fh:
        json.dump(sizes, fh, indent=1)
    print("尺寸：", {k: [round(a, 1), round(b, 1)] for k, (a, b) in sizes.items()})


if __name__ == "__main__":
    main()
