#!/usr/bin/env python3
"""从句游英语参考站的 `market.css` 生成 src/app/home/store/store-market.css，并把选择器收敛到 `.store-market-page` 下。

背景：归档目录 ~/Downloads 里**没有保存课程市场页本身**（句游的 /User/CourseMarket），
只有指向它的导航链接。但课程市场和课本同步**共用同一份 market.css**，而课本同步页已完整
存档 —— 于是课程广场的版式可以按 market.css 里「课程市场独有」的类族复刻：

  · market-hero-section / modern-search —— 标题 + 副标题 + 右侧搜索框
  · courseTab / fixedTab                —— 两级筛选标签（主标签黑底选中、子标签小胶囊）
  · TypeList / market-course-card / market-card-info / market-card-footer
                                        —— 自适应网格卡片（16:9 封面 + hover 上浮）
  · modern-tip-card                     —— 蓝色提示条 + 客服按钮

刻意不收的类族：
  · `level-badge`（cj/zj/gj 三档难度）—— 本库 courses 表没有难度字段，卡片不渲染该徽章
    （no-fake-data；与本仓 extract-market-course-css.py 对 difficulty 标签的裁定一致）。
  · `TypeName*` 渐变色块封面 —— 本仓已有更完整的三层降级封面体系（src/lib/course-cover.ts），
    搬进来只会留下永不命中的死规则。
  · `cardList` / `cardList0` 统计卡 —— 课程市场页没有这两块。
  · `:root[themes="dark"]` 深色分支 —— 本仓 2026-10 已删掉整套暗色令牌。
  · `.course-market .maxWidth`（1400px 宽约束）—— 参考站该规则锚定根节点上的 `.course-market`，
    而本页根节点是 `.store-market-page` 本身（不是它的后代），直接搬会变成永不命中的后代选择器。
    改为在 SHELL 里以 `.store-market-page .maxWidth` 重写（取值逐字来自 market.css:938 + common.css 的 margin）。

用法：python3 scripts/extract-store-market-css.py
源文件：~/Downloads/课本同步 - 句游英语_files/market.css  （课程市场共享样式）
        ~/Downloads/课本同步 - 句游英语_files/reset.css    （CSS 变量表）
输出：  src/app/home/store/store-market.css
"""
import os
import re
import sys

HOME = os.path.expanduser("~")
REF_DIR = os.path.join(HOME, "Downloads", "课本同步 - 句游英语_files")
SRC_MARKET = os.path.join(REF_DIR, "market.css")
SRC_RESET = os.path.join(REF_DIR, "reset.css")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "src/app/home/store/store-market.css")
PREFIX = ".store-market-page"

# 课程市场页真正用到的类族（小写子串匹配）。参考页 DOM 里的类一个不多一个不少。
# 注意 `.maxWidth` 与 `.course-market` 不在此列 —— 见文件头对 SHELL 的说明。
INCLUDE = [
    # hero + 搜索框
    "market-hero-section", "hero-left", "hero-subtitle", "hero-right",
    "searchinp", "modern-search", "search-icon-main", "search-clear",
    # 两级筛选标签
    "coursetab", "fixedtab",
    # 课程卡网格
    "typelist", "market-course-card", "market-card-info", "market-card-footer",
    "img-wrap", "img-placeholder", "course-cover-img", "skeleton",
    # 提示条
    "modern-tip-card", "tip-left", "tip-right", "kefu-btn",
]

# 暗色系色值（浅色为基时的典型深底/深边）。用于漏搬警告（color: 文字色不算）。
DARK_COLOR_RE = re.compile(
    r"#(?:0f172a|1e293b|1a1f2e|141821|334155)\b|rgba\(0\s*,\s*0\s*,\s*0\s*,\s*0\.[3-9]"
)

# 逐条排除：这些规则命中了 INCLUDE 的关键词，但属于参考页的**旧版卡片族**，
# 课程市场页的新卡片（market-course-card + market-card-info/footer）不再使用它们。
# 与 extract-market-course-css.py 排除 .btn-favorite「死样式」同一裁定。
EXCLUDE_SEL_RE = re.compile(
    "|".join(
        [
            r"\.TypeName",              # 旧版渐变字块封面 —— 本仓用 course-cover.ts 三层降级
            r"\.info \.time",           # 旧版卡片的「倒计时 + 加入」按钮列
            r"\.TypeList li \.info",    # 旧版信息块 —— 新卡片用 .market-card-info/.market-card-footer
            r"\.TypeList li \.img em",  # 免费/价格角标 —— courses 表无价格字段
            r"\.add\b",                 # 虚线「添加课程」占位卡 —— 广场页没有
            r"button\.kt",              # 旧版按钮
            r"cardlist",                # 统计卡 —— 课程市场页没有这两块
            r"drawer-open",             # 参考站移动端抽屉 —— 本仓外壳不实现该抽屉
        ]
    )
)

EXCLUDE_DARK = True

# 手工维护的页面外壳件。取值为参考站原值，来源逐条注明。
SHELL = """\
/* ── 页面外壳（手工维护，逐字取自参考站）── */
/* 参考站 .course-market .maxWidth（market.css:938）把课程市场放宽到 1400px；
   水平居中来自 common.css 里 .maxWidth 的 margin: 0 auto。 */
.store-market-page .maxWidth {
  max-width: 1400px;
  min-width: unset;
  width: 100%;
  box-sizing: border-box;
  padding: 0 20px;
  margin: 0 auto;
}
"""


def strip_comments(s: str) -> str:
    return re.sub(r"/\*.*?\*/", "", s, flags=re.S)


def strip_at_statements(s: str) -> str:
    """删掉 @import / @charset。留着会把后面的 prelude 污染掉。"""
    s = re.sub(r"@charset\s+[^;]+;", "", s)
    s = re.sub(r"@import\s+(?:url\([^)]*\)|[^;]+);", "", s)
    return s


def split_commas(s: str):
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return [p.strip() for p in parts]


def parse_rules(s: str):
    """切成顶层 (prelude, body) 列表，body 可能是嵌套块（@media）。"""
    rules, i, n = [], 0, len(s)
    while i < n:
        j = s.find("{", i)
        if j < 0:
            break
        prelude = s[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if s[k] == "{":
                depth += 1
            elif s[k] == "}":
                depth -= 1
            k += 1
        rules.append((prelude, s[j + 1:k - 1]))
        i = k
    return rules


def is_var_block(body: str) -> bool:
    return re.search(r"--[\w-]+\s*:", body) is not None


def strip_light_prefix(p: str) -> str:
    """剥掉亮色主题前缀：[themes="white"] / [themes="light"]（可带 html）。"""
    return re.sub(r'^(?:html\s*)?\[themes="(?:white|light)"\]\s*', "", p)


def scope_one(p: str, prefix: str = PREFIX) -> str:
    """把单个复合选择器的 :root / html / body 换成作用域前缀；
    已含本页前缀的原样保留。"""
    if PREFIX in p:
        return p
    m = re.match(r"^(?:html)?((?:\s*\[[^\]]*\])*)\s*body\b(.*)$", p, re.S)
    if m:
        return prefix + m.group(1) + m.group(2)
    m = re.match(r"^:root(.*)$", p, re.S)
    if m:
        return prefix + m.group(1)
    m = re.match(r"^(?:html|body)(.*)$", p, re.S)
    if m:
        return prefix + m.group(1)
    return prefix + " " + p


def scope_selector(sel: str, prefix: str = PREFIX) -> str:
    return ", ".join(scope_one(p, prefix) for p in split_commas(sel))


def included(sel: str):
    """INCLUDE 关键词子串匹配（双侧小写）。命中返回关键词，否则 None。
    先过 EXCLUDE_SEL_RE —— 被排除的旧版卡片族即使命中关键词也不收。"""
    if EXCLUDE_SEL_RE.search(sel):
        return None
    low = sel.lower()
    for key in INCLUDE:
        if key.lower() in low:
            return key
    return None


def process(s: str, collected_vars: list, stats: dict, light_selectors: set):
    """主题变换 + INCLUDE 过滤 + 收敛作用域。返回 (css, kept)。"""
    out, kept = [], 0
    for prelude, body in parse_rules(s):
        pl = prelude.strip()
        if is_var_block(body):
            for name in re.findall(r"(--[\w-]+)\s*:", body):
                collected_vars.append(name)
        if EXCLUDE_DARK and 'themes="dark"' in pl:
            stats["dark_dropped"] += 1
            continue
        if pl.startswith(("@media", "@supports", "@layer")):
            inner, k = process(body, collected_vars, stats, light_selectors)
            if k:
                out.append(pl + " {\n" + inner + "}\n")
                kept += k
            continue
        if "keyframes" in pl or pl.startswith(("@font-face", "@charset", "@import")):
            # @keyframes 原样保留（不能加前缀，动画名引用会断）
            if "keyframes" in pl:
                out.append(pl + " {" + body + "}")
                kept += 1
            continue
        light_hit = bool(re.search(r'\[themes="(?:white|light)"\]', pl))
        sels = [strip_light_prefix(p) for p in split_commas(pl)]
        sel_text = ", ".join(sels)
        if included(sel_text) is None:
            stats["excluded"] += 1
            continue
        if light_hit:
            stats["light_stripped"] += 1
            for p in sels:
                light_selectors.add(" ".join(p.split()))
        else:
            # 浅色为基：深色系仅当用作底色/边框/阴影才可疑，color 文字色不算。
            decls = re.sub(r"(?i)(?:^|;)\s*color\s*:[^;]*", "", body)
            if DARK_COLOR_RE.search(decls) and not any(
                " ".join(p.split()) in light_selectors for p in sels
            ):
                stats.setdefault("dark_leak_warn", []).append(sel_text[:80])
        out.append(scope_selector(sel_text) + " {" + body + "}")
        kept += 1
    return "\n".join(out), kept


def main():
    for p in (SRC_MARKET, SRC_RESET):
        if not os.path.exists(p):
            sys.exit(f"源文件不存在：{p}")

    stats = {"dark_dropped": 0, "light_stripped": 0, "excluded": 0}
    collected: list = []
    light_selectors: set = set()

    market_raw = strip_at_statements(
        strip_comments(open(SRC_MARKET, encoding="utf-8").read())
    )
    # 两遍处理：第一遍只跑统计，把亮色变体选择器全收进 light_selectors ——
    # 亮色覆盖在源里总是写在后面，单遍处理核对会漏掉后面才出现的变体（误报）。
    process(market_raw, collected, dict(stats), light_selectors)
    market_css, kept_market = process(market_raw, collected, stats, light_selectors)

    # ── 变量表：只发本文件实际引用到的，取值逐字来自参考 reset.css 浅色 :root ──
    reset_raw = strip_at_statements(strip_comments(open(SRC_RESET, encoding="utf-8").read()))
    ref_vars = {}
    for prelude, b in parse_rules(reset_raw):
        if not is_var_block(b):
            continue
        if "dark" in prelude.lower():
            continue
        for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;]+);", b):
            ref_vars.setdefault(m.group(1), m.group(2).strip())

    used_vars = sorted(set(re.findall(r"var\((--[\w-]+)", market_css + SHELL)))
    missing = [v for v in used_vars if v not in ref_vars]
    var_lines = [f"  {v}: {ref_vars[v]};" for v in used_vars if v in ref_vars]
    vars_css = (f"{PREFIX} {{\n" + "\n".join(var_lines) + "\n}\n") if var_lines else ""

    header = (
        "/* 自动生成 —— 请勿手改。\n"
        " * 来源：句游英语参考站 market.css（课程市场 / 课本同步共享样式）+ reset.css（变量表）。\n"
        " * 生成器：scripts/extract-store-market-css.py（选择器已收敛到 " + PREFIX + " 下）。\n"
        " * 重新生成：python3 scripts/extract-store-market-css.py\n"
        " *\n"
        " * 为什么用 market.css：归档里**没有保存课程市场页本身**（只有导航链接），\n"
        " * 但课程市场与课本同步共用这份样式表，课本同步页已完整存档 —— 于是按\n"
        " * market.css 中「课程市场独有」的类族复刻版式（hero/搜索、两级标签、卡片网格、提示条）。\n"
        " *\n"
        " * 其它搬运约定（与 home-ref.css / textbook-sync.css 同口径）：\n"
        " *   1. 字号/行高/内边距/圆角/阴影/色值全部保留参考页原值，不做「优化」。\n"
        " *   2. 参考页用 remixicon 字体图标（<i class=\"ri-*\">），本仓统一用 lucide\n"
        " *      组件；字体图标的 font-size 规则改写成 svg 的宽高（在组件里给 size）。\n"
        " *   3. 卡片难度徽章（.level-badge cj/zj/gj）与 TypeName 渐变封面刻意不搬：\n"
        " *      本库 courses 表无难度字段（no-fake-data），封面另有 course-cover.ts 三层降级。\n"
        " */\n\n"
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(header + vars_css + "\n" + SHELL
                + "\n\n/* ── 共享基样式：hero/搜索框/两级标签/卡片/提示条（来自 market.css）── */\n"
                + market_css + "\n")

    text = open(OUT, encoding="utf-8").read()
    bad = re.findall(r"(?m)^\s*(?:body|html|:root)(?![\w-])[\s,{:]", text)
    unscoped = 0
    for m in re.finditer(r"(?m)^(?!\s*(?:@|/\*))(?P<sel>[^{}\n@/][^{}\n]*)\{", text):
        sel = m.group("sel").strip()
        for part in split_commas(sel):
            # @keyframes 步进（0%/100%/from/to）随多行 body 换行后命中本检查。
            if re.match(r"^(?:\d+%|from|to)$", part):
                continue
            if PREFIX not in part:
                unscoped += 1
                print(f"UNSCOPED: {sel[:90]}")
                break
    print(f"kept rules (market.css): {kept_market}")
    print(f"dropped: dark {stats['dark_dropped']}, excluded {stats['excluded']}, "
          f"light-stripped {stats['light_stripped']}")
    print(f"vars emitted: {len(var_lines)}   used: {len(used_vars)}")
    print(f"lines: {text.count(chr(10))}   bytes: {os.path.getsize(OUT)}")
    print(f"UNSCOPED: {unscoped}   global selectors: {len(bad)}")
    if missing:
        print(f"vars referenced but NOT in reference reset.css: {', '.join(missing)}")
    for sel in stats.get("dark_leak_warn", []):
        print(f"暗色裸规则无亮色覆盖（人工核对）: {sel}")
    if unscoped or bad:
        sys.exit(1)


main()
