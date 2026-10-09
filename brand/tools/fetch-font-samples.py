# -*- coding: utf-8 -*-
"""按「标题真实字符集」逐族向 Google Fonts 要子集 woff2。

    python3 brand/tools/fetch-font-samples.py brand/tools/font-sample-chars.txt

关键：`&text=` 参数让 Google 只回传包含这些字的 kit —— 中文字体动辄 5~20MB，
整包下载既慢又没必要，演示页只要标题用到的那一百多个字。这既让演示页体积可控，
也顺带验证了「真要用某款字体时该子集到多少字节」。

产物落在 tools/.cache/font-samples/（已在 brand/.gitignore 里忽略）：字体样本是
「挑字体」阶段的一次性素材，挑完就把选中的那款正式子集进 public/fonts/，
没必要把十几份候选字体都留在仓库里。

注意：得意黑（Smiley Sans）不在 Google Fonts 上，走 GitHub Release，见
fetch_smiley()。它要整包下载 5.7MB 再本地子集，所以单独处理。
"""
import json, os, re, sys, urllib.parse, urllib.request, zipfile, io

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

TOOLS = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(TOOLS, ".cache", "font-samples")
os.makedirs(OUT, exist_ok=True)

# 候选族：(显示名, CSS2 family 参数, 说明)
FAMS = [
    ("ZCOOL KuaiLe",        "ZCOOL+KuaiLe",                    "站酷快乐体 · 现用品牌字"),
    ("ZCOOL QingKe HuangYou","ZCOOL+QingKe+HuangYou",          "站酷庆科黄油体"),
    ("ZCOOL XiaoWei",       "ZCOOL+XiaoWei",                   "站酷小薇"),
    ("Ma Shan Zheng",       "Ma+Shan+Zheng",                   "马善政毛笔楷书"),
    ("Long Cang",           "Long+Cang",                       "龙藏体"),
    ("Zhi Mang Xing",       "Zhi+Mang+Xing",                   "志莽行书"),
    ("Liu Jian Mao Cao",    "Liu+Jian+Mao+Cao",                "刘建毛草"),
    ("Noto Sans SC 900",    "Noto+Sans+SC:wght@900",           "思源黑体 Heavy"),
    ("Noto Serif SC 900",   "Noto+Serif+SC:wght@900",          "思源宋体 Heavy"),
    ("LXGW WenKai TC",      "LXGW+WenKai+TC",                  "霞鹜文楷"),
    ("Noto Sans HK 900",    "Noto+Sans+HK:wght@900",           "思源黑体 HK Heavy"),
]

# 逐款的人话点评与「适合做本产品标题」的判断。放在脚本里而不是只写进产物 JSON：
# 产物是重新生成的，手改会被下一次 fetch 覆盖掉。判断依据是各自的气质取向，不是
# 单纯的好坏 —— 楷书/行书/草书本身很好，只是做「游戏感」的功能型标题不合适。
META = {
    "zcool-kuaile":          ("俏皮圆体", "圆头圆角、字面开阔，童趣不幼稚；现用品牌字", "强烈"),
    "smiley-sans-oblique":   ("潮流斜体", "整体 8° 右倾、笔画收口利落，最有「速度感／游戏感」", "强烈"),
    "zcool-qingke-huangyou": ("粗壮方正", "笔画极粗、切口平直，力量型；远看像加重黑体", "可"),
    "noto-sans-sc-900":      ("现代黑体", "中性无衬线 heavy，最稳、最不出错，但也最没性格", "可"),
    "noto-sans-hk-900":      ("现代黑体", "与思源黑 SC 同源，字形偏港台写法", "可"),
    "lxgw-wenkai-tc":        ("温润楷体", "楷体骨架带手写温度，适合「陪伴感」调性", "可"),
    "noto-serif-sc-900":     ("宋体力量", "宋体 heavy，横细竖粗对比强，偏正式／出版感", "弱"),
    "zcool-xiaowei":         ("清秀文雅", "宋楷过渡、笔画纤细，气质偏文学", "弱"),
    "ma-shan-zheng":         ("毛笔楷书", "毛笔楷，书法味浓；做标题偏传统", "弱"),
    "long-cang":             ("细笔手写", "笔画极细且飞白，60px 以下会看不清", "弱"),
    "zhi-mang-xing":         ("奔放行书", "行书连笔，辨识度下降，不适合功能型标题", "弱"),
    "liu-jian-mao-cao":      ("狂草",     "草书，可读性最低，只适合做装饰", "弱"),
}


def annotate(rec):
    """补上气质分类/点评/适合度。判断只在 META 里维护一份。"""
    cat, desc, fit = META.get(rec["slug"], ("其他", "", "可"))
    rec.update(cat=cat, desc=desc, fit=fit)
    return rec


def subset(name, fam, chars):
    url = ("https://fonts.googleapis.com/css2?family=" + fam
           + "&text=" + urllib.parse.quote(chars) + "&display=swap")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    css = urllib.request.urlopen(req, timeout=25).read().decode()
    m = re.search(r"src:\s*url\((https://[^)]+)\)", css)
    if not m:
        return None, css[:200]
    woff = urllib.request.urlopen(urllib.request.Request(m.group(1), headers={"User-Agent": UA}), timeout=40).read()
    slug = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()
    p = os.path.join(OUT, slug + ".woff2")
    open(p, "wb").write(woff)
    # 记下 unicode-range，确认真的只含我们要的字
    ur = re.search(r"unicode-range:\s*([^;}]+)", css)
    return {"slug": slug, "path": p, "bytes": len(woff),
            "range": (ur.group(1).strip() if ur else ""),
            "glyphs": len(set(re.findall(r"U\+([0-9A-Fa-f]+)", ur.group(1)))) if ur else 0}, None


SMILEY_ZIP = "https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip"
SMILEY_NAME = "Smiley Sans Oblique"


def fetch_smiley(chars):
    """得意黑：不在 Google Fonts 上（作者只发 GitHub Release），只能整包下载后本地子集。

    整包 5.7MB，但仍比「放弃这款字体」划算——它是这批候选里气质最贴产品的一款
    （整体右倾、笔画收口利落，最像「游戏感」）。
    """
    sys.path.insert(0, TOOLS)
    import nodebrotli                                 # noqa: E402  垫上 brotli 才能写 woff2
    nodebrotli.install()
    from fontTools import subset                      # noqa: E402
    from fontTools.ttLib import TTFont               # noqa: E402

    zip_bytes = urllib.request.urlopen(
        urllib.request.Request(SMILEY_ZIP, headers={"User-Agent": UA}), timeout=180).read()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        ttf_name = next(n for n in z.namelist() if n.endswith(".ttf") and "Oblique" in n)
        ttf_bytes = z.read(ttf_name)
    src = os.path.join(OUT, "SmileySans-Oblique.ttf")
    open(src, "wb").write(ttf_bytes)

    f = TTFont(src, lazy=False)
    cmap = f.getBestCmap()
    missing = "".join(sorted(c for c in set(chars) if ord(c) not in cmap))
    if missing:
        print(f"  ! {SMILEY_NAME} 缺字：{missing}")

    opt = subset.Options()
    opt.layout_features = []
    opt.drop_tables += ["DSIG"]
    opt.notdef_outline = True
    sub = subset.Subsetter(options=opt)
    sub.populate(text=chars)
    sub.subset(f)
    p = os.path.join(OUT, "smiley-sans-oblique.woff2")
    f.flavor = "woff2"
    f.save(p)
    n = os.path.getsize(p)
    print(f"  ✓ {SMILEY_NAME:<24} {n:>7,} B   字形 {len(TTFont(p, lazy=True).getBestCmap()):>3}")
    return {"slug": "smiley-sans-oblique", "path": p, "bytes": n,
            "glyphs": len(TTFont(p, lazy=True).getBestCmap()),
            "range": "", "name": SMILEY_NAME, "note": "得意黑 · 倾斜潮流 · OFL",
            "source": "github"}


if __name__ == "__main__":
    chars = open(sys.argv[1], encoding="utf-8").read().strip()
    print(f"目标字符 {len(set(chars))} 个  →  {OUT}\n")
    out = []
    for name, fam, note in FAMS:
        try:
            r, err = subset(name, fam, chars)
        except Exception as e:
            r, err = None, f"{type(e).__name__}: {e}"
        if r:
            print(f"  ✓ {name:<24} {r['bytes']:>7,} B   字形 {r['glyphs']:>3}")
            r.update(name=name, note=note)
            out.append(annotate(r))
        else:
            print(f"  ✗ {name:<24} 失败：{err}")

    # 得意黑单独走一条路；失败不该拖垮其余 11 款
    try:
        out.append(annotate(fetch_smiley(chars)))
    except Exception as e:
        print(f"  ✗ {SMILEY_NAME:<24} 失败：{type(e).__name__}: {e}")

    json.dump(out, open(os.path.join(TOOLS, "font-candidates.json"), "w"),
              ensure_ascii=False, indent=1)
    print(f"\n成功 {len(out)} 款，合计 {sum(x['bytes'] for x in out):,} B")
    print("下一步：python3 brand/tools/build-font-compare.py")
