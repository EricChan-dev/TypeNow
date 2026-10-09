# -*- coding: utf-8 -*-
"""字体字形 → SVG path。logo 里的文字必须转曲，否则换台机器就会因缺字体而变形。

字体按「先小后大、先开源后系统」的顺序挑，并且**按字符覆盖选**：候选里第一个覆盖全部
所需字符的胜出。改了标头文案而子集字体没那个字时，会自动落到完整字体，不会静默出错字。

1. tools/fonts/TypeNowLogoCJK.ttf / TypeNowLogoLatin.ttf —— subset-fonts.py 生成的
   子集，共约 5KB，跟着仓库走，构建不需要联网（OFL 1.1，已按 OFL 要求改名）
2. tools/fonts/NotoSansSC.ttf / Inter.ttf —— fetch-fonts.py 下的完整字体（OFL 1.1）
3. .next/static/media/*.woff2 —— next/font 落的 Inter 子集（需要 brotli）
4. macOS 苹方 —— 仅兜底预览，**不可对外发布**（系统字体授权不允许）
"""
import glob
import os

from fontTools.ttLib import TTFont, TTCollection
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform
from fontTools.varLib import instancer

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(TOOLS))
FONT_DIR = os.path.join(TOOLS, "fonts")
CJK_TTF = os.path.join(FONT_DIR, "NotoSansSC.ttf")
INTER_TTF = os.path.join(FONT_DIR, "Inter.ttf")
CJK_SUBSET = os.path.join(FONT_DIR, "TypeNowLogoCJK.ttf")
LATIN_SUBSET = os.path.join(FONT_DIR, "TypeNowLogoLatin.ttf")
HIRAGINO = "/System/Library/Fonts/Hiragino Sans GB.ttc"

_cache = {}


def _instance(path, weight, axes=("wght",)):
    f = TTFont(path, lazy=False)
    if "fvar" in f:
        loc = {a: weight for a in axes if any(x.axisTag == a for x in f["fvar"].axes)}
        f = instancer.instantiateVariableFont(f, loc, inplace=False)
    return f


def _covers(font, chars):
    cmap = font.getBestCmap()
    return all(ord(c) in cmap for c in chars)


def font_complete(path):
    """半成品 TTF 也能读出 head 表，所以必须校验整张表目录是否都落在文件长度内。"""
    try:
        f = TTFont(path, lazy=True)
        size = os.path.getsize(path)
        return all(e.offset + e.length <= size for e in f.reader.tables.values())
    except Exception:
        return False


def _safe_instance(path, weight):
    """下到一半的字体文件会解析失败或读出越界表，降级成 None 让调用方走回退路径。"""
    if not font_complete(path):
        print(f"  ! {os.path.basename(path)} 不完整（多半是没下完），"
              f"先跑 `python3 brand/tools/fetch-fonts.py`；本次改用回退字体")
        return None
    try:
        return _instance(path, weight)
    except Exception as exc:
        print(f"  ! {os.path.basename(path)} 无法解析（{type(exc).__name__}），本次改用回退字体")
        return None


def _from_next_inter(chars):
    """.next 里的 Inter 按 unicode-range 切成多份，挑覆盖所需字符且最全的那份。"""
    best = None
    for p in glob.glob(os.path.join(REPO, ".next/static/media/*.woff2")):
        try:
            f = TTFont(p, lazy=False)
        except Exception:                     # 读不了 woff2 通常是缺 brotli
            continue
        if f["name"].getDebugName(1) != "Inter" or not _covers(f, chars):
            continue
        if best is None or f["maxp"].numGlyphs > best["maxp"].numGlyphs:
            best = f
    return best


def latin(chars, weight=700):
    """拉丁标字体（Inter / OFL）。chars 为本次要用到的全部字符。"""
    key = ("latin", frozenset(chars), weight)
    if key in _cache:
        return _cache[key]
    cands = []
    if os.path.exists(LATIN_SUBSET):
        cands.append((LATIN_SUBSET, lambda: _safe_instance(LATIN_SUBSET, weight)))
    if os.path.exists(INTER_TTF):
        cands.append((INTER_TTF, lambda: _safe_instance(INTER_TTF, weight)))
    for path, loader in cands:
        f = loader()
        if f is not None:
            if _covers(f, chars):
                _cache[key] = f
                return f
            print(f"  ! {os.path.basename(path)} 缺字 "
                  f"{''.join(sorted(c for c in chars if ord(c) not in f.getBestCmap()))}，换下一个候选")
    f = _from_next_inter(chars)
    if f is not None:
        f = instancer.instantiateVariableFont(f, {"wght": weight}, inplace=False)
        _cache[key] = f
        return f
    raise RuntimeError(
        f"找不到覆盖 {''.join(sorted(chars))} 的拉丁字体。跑 "
        f"`python3 brand/tools/subset-fonts.py` 生成子集，或 `python3 brand/tools/fetch-fonts.py` 下完整字体"
    )


def cjk(chars, weight=700):
    """中文黑体。chars 为本次要用到的全部字符。"""
    key = ("cjk", frozenset(chars), weight)
    if key in _cache:
        return _cache[key]
    for path in (CJK_SUBSET, CJK_TTF):
        if not os.path.exists(path):
            continue
        f = _safe_instance(path, weight)
        if f is not None:
            if _covers(f, chars):
                _cache[key] = f
                return f
            print(f"  ! {os.path.basename(path)} 缺字 "
                  f"{''.join(sorted(c for c in chars if ord(c) not in f.getBestCmap()))}，换下一个候选")
    if os.path.exists(HIRAGINO):
        print("  ! 未找到覆盖所需字符的开源中文字体，回退苹方 W6 —— 仅供预览；"
              "正式发布请先跑 subset-fonts.py 或 fetch-fonts.py")
        f = TTCollection(HIRAGINO, lazy=False).fonts[2]      # index 2 == W6
        _cache[key] = f
        return f
    raise RuntimeError(
        f"找不到覆盖 {''.join(sorted(chars))} 的中文字体。跑 "
        f"`python3 brand/tools/subset-fonts.py` 生成子集，或 `python3 brand/tools/fetch-fonts.py` 下完整字体"
    )


def layout(font, text, tracking=0.0):
    """排成一行的 path。返回 (d, 总advance)。tracking 单位 em，负值收紧。"""
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    gs = font.getGlyphSet()
    parts, x = [], 0.0
    for ch in text:
        gn = cmap.get(ord(ch))
        if gn is None:
            raise ValueError(f"字体缺字：{ch!r}")
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        gs[gn].draw(TransformPen(pen, Transform(1, 0, 0, -1, x, 0)))  # y 轴翻转为 SVG 方向
        if pen.getCommands():
            parts.append(pen.getCommands())
        x += hmtx[gn][0] + tracking * upm
    return " ".join(parts), x


def normalized(font, text, size, tracking=0.0):
    """返回 (d, width, scale)：path 单位为字体单位、基线在 y=0，需再乘 scale。"""
    d, adv = layout(font, text, tracking)
    s = size / font["head"].unitsPerEm
    return d, adv * s, s


def ink_bounds(font, ch):
    """单个字形的墨迹框（字体坐标，y 向上）与 advance。"""
    from fontTools.pens.boundsPen import BoundsPen

    gs = font.getGlyphSet()
    gn = font.getBestCmap()[ord(ch)]
    pen = BoundsPen(gs)
    gs[gn].draw(pen)
    return pen.bounds, font["hmtx"][gn][0]
