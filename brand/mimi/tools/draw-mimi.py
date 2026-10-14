#!/usr/bin/env python3
"""AI 小咪吉祥物静态形象图生成（m00898）。

四张 480×480 透明底 PNG，配色取自 brand/web-logo/png/icon-tight.png 实测主色
（奶白身体 / 藏青五官 / 浅蓝虎斑与书 / 蜜桃耳内与腮红）——与 logo 同血统。
纯 PIL 矢量式绘制（无图片生成模型），几何经 ASCII 墨迹图盲检。

姿态：
  sleep       趴睡（默认态）：闭眼 + Zzz
  sleep-book  趴睡 + 拿 logo 同款书当枕头（变体）
  awake       醒来（hover 态）：睁眼，无 Zzz
  sit         坐立（click 态）：举手打招呼 + 气泡「尽管问～」
"""

from PIL import Image, ImageDraw, ImageFont
import numpy as np
import os

SIZE = 480
OUT = os.path.join(os.path.dirname(__file__), "..", "png")

# ── 品牌色（icon-tight.png 实测主色）──
BODY = (242, 240, 236, 255)          # 奶白身体
NAVY = (16, 48, 80, 255)             # 藏青：五官 / 书脊 / 咪牌
BLUE = (144, 208, 240, 255)          # 浅蓝：虎斑 / 尾尖
TEAL = (48, 144, 176, 255)           # 青：书封
PEACH = (240, 208, 176, 255)         # 蜜桃：耳内
NOSE = (214, 140, 120, 255)          # 鼻/唇
TONGUE = (235, 130, 120, 255)        # 舌头
PAGES = (252, 250, 244, 255)         # 书页
BELLY = (249, 241, 229, 255)         # 肚底微暖

A_NAVY = (16, 48, 80, 215)
A_SOFT = (16, 48, 80, 110)           # 胡须
A_BLUSH = (244, 168, 158, 82)
A_SHADOW = (16, 48, 80, 28)
A_BUBBLE = (255, 255, 255, 240)


def layer():
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def ell(d, cx, cy, rx, ry, fill):
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=fill)


def chain_tail(d, pts, r0, r1, fill, tip_fill, tip_n=2):
    """圆链尾巴：沿折线画渐缩圆，末端 tip_n 个用 tip_fill。"""
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        r = r0 + (r1 - r0) * i / (n - 1)
        col = tip_fill if i >= n - tip_n else fill
        ell(d, x, y, r, r, col)


def draw_z(d, x, y, s, col):
    """手绘 Z：上横杠 + 对角杠 + 下横杠（不依赖字体）。"""
    d.rectangle((x, y, x + s, y + 0.22 * s), fill=col)
    d.rectangle((x, y + 0.78 * s, x + s, y + s), fill=col)
    d.polygon([(x + 0.72 * s, y + 0.22 * s), (x + s, y + 0.22 * s),
               (x + 0.28 * s, y + 0.78 * s), (x, y + 0.78 * s)], fill=col)


def open_eye(d, cx, cy, r=12):
    ell(d, cx, cy, r, r, NAVY)
    ell(d, cx - r * 0.3, cy - r * 0.35, r * 0.32, r * 0.32, (255, 255, 255, 255))


def closed_eye(d, cx, cy):
    d.arc((cx - 20, cy - 12, cx + 20, cy + 12), 0, 180, fill=NAVY, width=5)


def omega(d, cx, y, w=13, h=12, width=3):
    d.arc((cx - w, y, cx - 1, y + h), 0, 180, fill=NAVY, width=width)
    d.arc((cx + 1, y, cx + w, y + h), 0, 180, fill=NAVY, width=width)


def nose(d, cx, y):
    d.polygon([(cx - 7, y), (cx + 7, y), (cx, y + 9)], fill=NOSE)


def blush(ov, x0, y0, x1, y1):
    ImageDraw.Draw(ov).ellipse((x0, y0, x1, y1), fill=A_BLUSH)


def whiskers(d, anchors):
    for (x0, y0, x1, y1) in anchors:
        d.line((x0, y0, x1, y1), fill=A_SOFT, width=3)


def get_font(size):
    for path, idx in [("/System/Library/Fonts/Hiragino Sans GB.ttc", 0)]:
        try:
            return ImageFont.truetype(path, size, index=idx)
        except Exception:
            continue
    return ImageFont.load_default()


def build(kind):
    shadow, base, ov = layer(), layer(), layer()
    ds, d, dov = ImageDraw.Draw(shadow), ImageDraw.Draw(base), ImageDraw.Draw(ov)

    if kind in ("sleep", "sleep-book", "awake"):
        ell(ds, 245, 418, 165, 17, A_SHADOW)
        chain_tail(d, [(375, 385), (412, 368), (434, 330), (430, 290), (405, 266)],
                   13, 9, BODY, BLUE)
        d.rounded_rectangle((110, 290, 380, 410), radius=60, fill=BODY)
        d.rounded_rectangle((295, 292, 317, 344), radius=11, fill=BLUE)
        d.rounded_rectangle((332, 292, 354, 330), radius=11, fill=BLUE)
        if kind == "sleep-book":
            # logo 同款书当枕头：青封 + 米页 + 藏青书脊/书签
            d.rounded_rectangle((92, 366, 282, 420), radius=10, fill=TEAL)
            d.rounded_rectangle((99, 372, 275, 405), radius=6, fill=PAGES)
            d.rectangle((92, 366, 103, 420), fill=NAVY)
            d.polygon([(262, 372), (277, 372), (277, 400), (269, 390), (262, 400)], fill=NAVY)
        # 耳朵（先画，头盖住耳根）
        d.polygon([(115, 225), (140, 130), (185, 185)], fill=BODY)
        d.polygon([(130, 203), (144, 150), (175, 184)], fill=PEACH)
        d.polygon([(255, 225), (230, 130), (185, 185)], fill=BODY)
        d.polygon([(240, 203), (226, 150), (195, 184)], fill=PEACH)
        ell(d, 185, 285, 92, 92, BODY)  # 头
        # 脸
        if kind == "awake":
            open_eye(d, 152, 285)
            open_eye(d, 218, 285)
        else:
            closed_eye(d, 152, 285)
            closed_eye(d, 218, 285)
        nose(d, 185, 298)
        omega(d, 185, 307)
        blush(ov, 123, 298, 155, 318)
        blush(ov, 215, 298, 247, 318)
        whiskers(d, [(140, 292, 96, 284), (140, 302, 98, 306),
                     (230, 292, 274, 284), (230, 302, 272, 306)])
        # 前爪（sleep-book 时搭在书上）
        py = 382 if kind == "sleep-book" else 380
        ell(d, 162, py + 11, 24, 12, BODY)
        ell(d, 218, py + 11, 24, 12, BODY)
        if kind != "awake":
            draw_z(dov, 296, 166, 34, A_NAVY)
            draw_z(dov, 342, 130, 26, A_NAVY)
            draw_z(dov, 378, 102, 20, A_NAVY)

    elif kind == "sit":
        ell(ds, 240, 432, 150, 16, A_SHADOW)
        chain_tail(d, [(322, 418), (360, 402), (382, 366), (380, 328)],
                   12, 9, BODY, BLUE)
        ell(d, 245, 337, 95, 87, BODY)          # 立身
        ell(d, 245, 358, 50, 44, BELLY)          # 肚底
        ell(d, 194, 412, 32, 16, BODY)           # 后脚
        ell(d, 286, 412, 32, 16, BODY)
        d.polygon([(160, 150), (185, 45), (235, 110)], fill=BODY)
        d.polygon([(168, 132), (189, 72), (224, 104)], fill=PEACH)
        d.polygon([(320, 150), (295, 45), (245, 110)], fill=BODY)
        d.polygon([(312, 132), (291, 72), (256, 104)], fill=PEACH)
        ell(d, 240, 205, 100, 100, BODY)         # 头
        d.rounded_rectangle((205, 110, 221, 146), radius=8, fill=BLUE)  # 额纹
        d.rounded_rectangle((232, 106, 248, 148), radius=8, fill=BLUE)
        d.rounded_rectangle((259, 110, 275, 146), radius=8, fill=BLUE)
        open_eye(d, 205, 210)
        open_eye(d, 275, 210)
        nose(d, 240, 222)
        d.pieslice((220, 232, 260, 264), 0, 180, fill=NAVY)   # 张嘴笑
        d.pieslice((230, 246, 250, 264), 0, 180, fill=TONGUE)
        blush(ov, 152, 235, 190, 256)
        blush(ov, 290, 235, 328, 256)
        whiskers(d, [(160, 232, 112, 224), (160, 242, 114, 248),
                     (320, 232, 368, 224), (320, 242, 366, 248)])
        # 举起挥手的左爪（画在头之后 → 爪在脸颊前）
        d.line((172, 300, 132, 212), fill=BODY, width=30)
        ell(d, 132, 212, 15, 15, BODY)
        ell(d, 122, 192, 30, 30, BODY)
        ell(d, 290, 320, 28, 22, BODY)           # 右爪搭胸前
        # 气泡「尽管问～」
        dov.rounded_rectangle((298, 38, 464, 118), radius=22, fill=A_BUBBLE)
        dov.polygon([(368, 114), (352, 146), (392, 115)], fill=A_BUBBLE)
        f = get_font(30)
        dov.text((381, 78), "尽管问～", font=f, fill=NAVY, anchor="mm")

    out = Image.alpha_composite(Image.alpha_composite(shadow, base), ov)
    return out


def ascii_map(im, cols=40, rows=40):
    a = np.array(im)
    cell = SIZE // cols
    out = []
    for r in range(rows):
        line = ""
        for c in range(cols):
            blk = a[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell]
            m = blk[:, :, 3] > 30
            if not m.any():
                line += " "
                continue
            px = blk[m][:, :3].astype(int)
            mean = px.mean(axis=0)
            R, G, B = mean
            if R < 70 and G < 90 and B < 130:
                ch = "#"
            elif B > 150 and B > R + 40:
                ch = "~"
            elif R > 200 and G < 225 and B < 210 and R > B + 30:
                ch = "*"
            elif R > 222 and G > 218 and B > 210:
                ch = "."
            else:
                ch = "?"
            line += ch
        out.append(line)
    return "\n".join(out)


def check(im, name):
    a = np.array(im)
    m = a[:, :, 3] > 30
    ys, xs = np.where(m.any(axis=1))[0], np.where(m.any(axis=0))[0]
    cov = m.mean() * 100
    px = a[m][:, :3].astype(int)
    navy = int(((px[:, 0] < 70) & (px[:, 1] < 90) & (px[:, 2] < 130)).sum())
    blue = int(((px[:, 2] > 150) & (px[:, 2] > px[:, 0] + 40)).sum())
    white = int(((px[:, 0] > 222) & (px[:, 1] > 218) & (px[:, 2] > 210)).sum())
    print(f"[{name}] bbox x[{xs.min()},{xs.max()}] y[{ys.min()},{ys.max()}] "
          f"cover {cov:.1f}% navy {navy} blue {blue} white {white}")
    assert xs.min() >= 4 and xs.max() <= SIZE - 4, f"{name}: 越界"
    assert 8 <= cov <= 45, f"{name}: 覆盖率异常 {cov:.1f}%"
    assert navy > 150 and white > 4000, f"{name}: 主色缺失"


def main():
    os.makedirs(OUT, exist_ok=True)
    names = {"sleep": "mimi-sleep", "sleep-book": "mimi-sleep-book",
             "awake": "mimi-awake", "sit": "mimi-sit"}
    for kind, name in names.items():
        im = build(kind)
        p = os.path.join(OUT, name + ".png")
        im.save(p)
        check(im, name)
    print("\n=== ASCII mimi-sleep ===")
    print(ascii_map(build("sleep")))
    print("\n=== ASCII mimi-sit ===")
    print(ascii_map(build("sit")))
    print("\nOK ->", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
