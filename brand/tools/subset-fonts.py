# -*- coding: utf-8 -*-
"""从 Google Fonts 的按 unicode-range 切片生成 logo 专用小字体。

    python3 brand/tools/subset-fonts.py

为什么不用 fetch-fonts.py 下整包：Noto Sans SC 完整变量字体 17MB、Inter 0.9MB，而这个
logo 一共只用到 6 个字（句学社中 TypeNow… 拉丁 7 个字母）。切片 + 子集化之后总计约 10KB，
可以直接跟着仓库走，构建就不需要联网了。

产物（tools/fonts/）：
- TypeNowLogoCJK.ttf   句学社中
- TypeNowLogoLatin.ttf TypeNow

两个产物都改名了：源字体带有 OFL 的 Reserved Font Name（Noto Sans SC 派生自 Adobe 的
Source Han Sans，保留名 'Source'），而 OFL 要求「修改版不得使用保留名」。copyright 与
license 字段原样保留 —— OFL 同时要求随附版权声明与许可证。
"""
import hashlib
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nodebrotli                                    # noqa: E402,F401  —— 装上 brotli 垫片
from build import CJK_CHARS, LATIN_CHARS             # noqa: E402  —— 字符集单一来源，避免漏字

from fontTools import subset                         # noqa: E402
from fontTools.merge import Merger                   # noqa: E402
from fontTools.ttLib import TTFont                   # noqa: E402

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache", "slices")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def css_slices(family, weight, chars):
    """问 Google Fonts 要 CSS，挑出覆盖目标字符的切片 URL（css2 按 unicode-range 切片）。"""
    url = f"https://fonts.googleapis.com/css2?family={family}:wght@{weight}&display=swap"
    css = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}),
                                 timeout=60).read().decode()
    need = {ord(c) for c in chars}
    out = []
    for block in re.findall(r"@font-face\s*\{(.*?)\}", css, re.S):
        ur = re.search(r"unicode-range:\s*([^;]+);", block)
        src = re.search(r"url\((https://[^)]+)\)", block)
        if not ur or not src:
            continue
        cov = set()
        for part in ur.group(1).split(","):
            part = part.strip().lower().replace("u+", "")
            if "-" in part:
                lo, hi = part.split("-")
                cov.update(range(int(lo, 16), int(hi, 16) + 1))
            else:
                cov.add(int(part, 16))
        if need & cov:
            out.append(src.group(1))
    return out


def download(urls, tag):
    os.makedirs(CACHE, exist_ok=True)
    paths = []
    for i, u in enumerate(urls):
        # 缓存键必须包含 URL 本身：只按序号命名时，改了字符集（比如改名后
        # 「码上英语」→「句学社」）会命中上一轮的切片，然后报「缺少字形」，
        # 让人误以为字体没覆盖那个字。至少用 URL 的哈希区分。
        digest = hashlib.sha1(u.encode()).hexdigest()[:10]
        p = os.path.join(CACHE, f"{tag}-{i}-{digest}.woff2")
        if not os.path.exists(p):
            urllib.request.urlretrieve(u, p)
        paths.append(p)
    return paths


def build(name, chars, tag, family, weight, latin=False):
    dst = os.path.join(FONTS, name)
    urls = css_slices(family, weight, chars)
    print(f"  {name}: 命中 {len(urls)} 个切片")
    files = download(urls, tag)
    font = Merger().merge(files) if len(files) > 1 else TTFont(files[0])
    cmap = font.getBestCmap()
    miss = [c for c in chars if ord(c) not in cmap]
    if miss:
        raise SystemExit(f"{name} 缺少字形：{miss}")

    opt = subset.Options()
    opt.name_IDs = ["*"]
    opt.name_legacy = True
    opt.name_languages = ["*"]
    opt.layout_features = []              # logo 只用轮廓，不需要 GPOS/GSUB
    opt.notdef_outline = True
    opt.drop_tables += ["DSIG"]
    sub = subset.Subsetter(options=opt)
    sub.populate(unicodes=[ord(c) for c in chars])
    sub.subset(font)

    rename(font, name.replace(".ttf", ""), latin=latin)
    font.flavor = None                    # 来源是 woff2，不清掉会再被压回 woff2
    font.save(dst)
    print(f"    ✓ {dst}  {os.path.getsize(dst)} B  字形 {font['maxp'].numGlyphs}")


def rename(font, new_name, latin=False):
    """去掉 OFL 保留名。copyright / license / licenseURL 原样保留。"""
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17, 21, 22):
            name.removeNames(rec.nameID, rec.platformID, rec.platEncID, rec.langID)
    ps = new_name.replace(" ", "")
    for nid, val in ((1, new_name), (3, f"{new_name}:logo"), (4, new_name),
                     (6, ps), (16, new_name), (17, "Regular")):
        name.setName(val, nid, 3, 1, 0x409)
        name.setName(val, nid, 1, 0, 0)


if __name__ == "__main__":
    os.makedirs(FONTS, exist_ok=True)
    print("生成 logo 专用子集字体：")
    build("TypeNowLogoCJK.ttf", "".join(sorted(CJK_CHARS)), "cjk", "Noto+Sans+SC", 700)
    build("TypeNowLogoLatin.ttf", "".join(sorted(LATIN_CHARS)), "latin", "Inter", 700, latin=True)
    print("完成 →", FONTS)
