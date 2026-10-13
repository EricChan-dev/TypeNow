#!/usr/bin/env python3
"""从句游英语「课本同步」参考页生成 src/app/home/textbook/textbook-sync.css，并把选择器收敛到 `.textbook-sync-page` 下。

课本同步列表是独立参考页（~/Downloads/课本同步 - 句游英语.html，句游的 /User/TextbookSync）。
与错题本不同，这页样式全部来自 <head> 的 link 文件，没有页内大段 <style>，共三层：
  · common.css         —— .pages 分页器族 + .maxWidth（居中容器）；
  · market.css         —— 与课程市场共享的 hero/搜索框/课程卡样式（market-hero-section、
                          searchInp、market-course-card、TypeList 等）；
  · textbook-sync.css  —— 页面专属的筛选卡/状态工具条/空态（sync-* 族）。

层叠顺序 = 参考页真实加载顺序：common → market → textbook-sync，输出也按此排列，
让页内覆盖（如 .searchInp .search-clear:hover）排在共享基样式之后。

主题极性与 market.css 同族：浅色为基，html[themes="dark"] 是覆盖分支 —— dark 规则
直接丢弃（本仓 2026-10 已删整套暗色令牌），其余原样保留。生成后对「裸规则含暗色系
色值、却没有对应亮色覆盖」的选择器打警告，人工核对是否漏搬。

参考页根元素是 `mainBox course-market sync-market-page` 三合一：.mainBox 内容底板已由
home-shell.css 复刻（不搬），但 .course-market / .sync-market-page 两个类要保留在
本页根节点上 —— market.css:938 `.course-market .maxWidth`（1400px 宽度约束）与
textbook-sync.css `.sync-market-page .market-hero-section.sync-hero` 都锚定它们。

用法：python3 scripts/extract-textbook-sync-css.py
源文件：~/Downloads/课本同步 - 句游英语_files/textbook-sync.css （页面专属）
        ~/Downloads/课本同步 - 句游英语_files/market.css       （共享 hero/搜索/卡片）
        ~/Downloads/课本同步 - 句游英语_files/common.css       （.pages 分页器 + .maxWidth）
        ~/Downloads/课本同步 - 句游英语_files/reset.css        （CSS 变量表）
输出：  src/app/home/textbook/textbook-sync.css
"""
import os
import re
import sys

HOME = os.path.expanduser("~")
REF_DIR = os.path.join(HOME, "Downloads", "课本同步 - 句游英语_files")
SRC_PAGE = os.path.join(REF_DIR, "textbook-sync.css")
SRC_MARKET = os.path.join(REF_DIR, "market.css")
SRC_COMMON = os.path.join(REF_DIR, "common.css")
SRC_RESET = os.path.join(REF_DIR, "reset.css")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "src/app/home/textbook/textbook-sync.css")
PREFIX = ".textbook-sync-page"

# 页面真正用到的类族（小写子串匹配，双侧小写）。参考页 DOM 里的类一个不多一个不少：
#   hero 区、搜索框、筛选卡（年级/版本）、状态工具条（计数/chips/恢复/重置）、
#   课程卡、空态。market.css 里课程市场列表页独有的（CourseTabs、course-grid、
#   filter-bar、drawer/fixedTab 等）本页不用，全部不收。
INCLUDE = [
    # hero + 搜索框
    "market-hero-section", "sync-hero", "hero-left", "hero-title-row",
    "hero-sync-badge", "hero-subtitle", "hero-right",
    "searchinp", "modern-search", "search-icon-main", "search-clear",
    # 筛选卡
    "sync-filter-wrapper", "sync-filter-card", "filter-row", "filter-label",
    "filter-body", "textbook-grades-tab", "filter-row-divider", "publisher-tags",
    # 状态工具条
    "sync-status-toolbar", "status-left", "result-count", "active-filter-chips",
    "chip-divider", "chip-label", "filter-chip", "chip-text", "status-right",
    "btn-restore-last", "restore-text", "btn-clear-all",
    # 课程卡列表
    "typelist", "market-course-card", "sync-textbook-card", "img-wrap",
    "img-placeholder", "course-cover-img", "card-main-content", "book-title",
    "card-meta-row", "meta-left", "meta-item", "meta-dot", "btn-enter-study",
    # 空态
    "sync-empty-state", "empty-icon-box", "empty-title", "empty-desc",
    "empty-actions", "btn-empty-reset",
    # market.css:938 的 .course-market .maxWidth 宽度约束（根节点带 course-market 类）
    "maxwidth",
]

# common.css 里页面依赖的外壳件：.pages 分页器族 + .maxWidth。逐块精确提取。
COMMON_KEYS = [".pages", ".maxWidth"]

# 暗色系色值（浅色为基时的典型深底/深边）。用于漏搬警告（color: 文字色不算）。
DARK_COLOR_RE = re.compile(
    r"#(?:0f172a|1e293b|1a1f2e|141821|334155)\b|rgba\(0\s*,\s*0\s*,\s*0\s*,\s*0\.[3-9]"
)

EXCLUDE_DARK = True


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
    """INCLUDE 关键词子串匹配（双侧小写）。命中返回关键词，否则 None。"""
    low = sel.lower()
    for key in INCLUDE:
        if key.lower() in low:
            return key
    return None


def process(s: str, collected_vars: list, stats: dict, light_selectors: set):
    """主题变换 + INCLUDE 过滤 + 收敛作用域。返回 (css, kept)。
    light_selectors 收集亮色变体的归一化选择器，供跨规则核对。"""
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


def extract_common(s: str):
    """common.css 里按 COMMON_KEYS 提取外壳件（.pages 分页器 + .maxWidth）。
    本页根元素不是 maxWidth（与错题本相反），一律收敛成后代选择器。"""
    out, kept = [], 0
    for prelude, body in parse_rules(s):
        pl = prelude.strip()
        if pl.startswith("@media"):
            inner, k = extract_common(body)
            if k:
                out.append(pl + " {\n" + inner + "}\n")
                kept += k
            continue
        sels = split_commas(pl)
        if any(any(k in p for k in COMMON_KEYS) for p in sels):
            out.append(scope_selector(pl) + " {" + body + "}")
            kept += 1
    return "\n".join(out), kept


def main():
    for p in (SRC_PAGE, SRC_MARKET, SRC_COMMON, SRC_RESET):
        if not os.path.exists(p):
            sys.exit(f"源文件不存在：{p}")

    stats = {"dark_dropped": 0, "light_stripped": 0, "excluded": 0}
    collected: list = []
    light_selectors: set = set()

    # 层叠顺序 = 参考页 <head> 真实加载顺序：common → market → textbook-sync。
    market_raw = strip_at_statements(strip_comments(open(SRC_MARKET, encoding="utf-8").read()))
    page_raw = strip_at_statements(strip_comments(open(SRC_PAGE, encoding="utf-8").read()))
    # 两遍处理：第一遍只跑统计，把亮色变体选择器全收进 light_selectors ——
    # 亮色覆盖在源里总是写在后面，单遍处理核对会漏掉后面才出现的变体（误报）。
    process(market_raw, collected, dict(stats), light_selectors)
    process(page_raw, collected, dict(stats), light_selectors)
    market_css, kept_market = process(market_raw, collected, stats, light_selectors)
    page_css, kept_page = process(page_raw, collected, stats, light_selectors)

    common_raw = strip_at_statements(strip_comments(open(SRC_COMMON, encoding="utf-8").read()))
    common_css, kept_common = extract_common(common_raw)

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

    used_vars = sorted(set(re.findall(r"var\((--[\w-]+)", market_css + page_css + common_css)))
    missing = [v for v in used_vars if v not in ref_vars]
    var_lines = [f"  {v}: {ref_vars[v]};" for v in used_vars if v in ref_vars]
    vars_css = (f"{PREFIX} {{\n" + "\n".join(var_lines) + "\n}\n") if var_lines else ""

    header = (
        "/* 自动生成 —— 请勿手改。\n"
        " * 来源：句游英语课本同步参考页（/User/TextbookSync）的 textbook-sync.css + market.css\n"
        " * （共享 hero/搜索/卡片）+ common.css（.pages 分页器/.maxWidth）。\n"
        " * 生成器：scripts/extract-textbook-sync-css.py（选择器已收敛到 " + PREFIX + " 下）。\n"
        " * 重新生成：python3 scripts/extract-textbook-sync-css.py\n"
        " *\n"
        " * 层叠顺序 = 参考页真实加载顺序：common → market → textbook-sync，\n"
        " * 页内覆盖（.searchInp .search-clear:hover 等）因此排在共享基样式之后。\n"
        " * 参考页根元素 mainBox course-market sync-market-page 三合一：mainBox 底板\n"
        " * 由 home-shell.css 复刻，course-market/sync-market-page 两个类保留在本页根节点。\n"
        " *\n"
        " * 其它搬运约定（与 home-ref.css / course-detail.css 同口径）：\n"
        " *   1. 字号/行高/内边距/圆角/阴影/色值全部保留参考页原值，不做「优化」。\n"
        " *   2. 参考页用 remixicon 字体图标（<i class=\"ri-*\">），本仓统一用 lucide\n"
        " *      组件；字体图标的 font-size 规则改写成 svg 的宽高（在组件里给 size）。\n"
        " */\n\n"
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(header + vars_css + "\n"
                + "/* ── 外壳件：.pages 分页器 + .maxWidth（来自 common.css，最先加载）── */\n"
                + common_css
                + "\n\n/* ── 共享基样式：hero/搜索框/课程卡（来自 market.css）── */\n"
                + market_css
                + "\n\n/* ── 页面专属：筛选卡/状态工具条/空态（来自 textbook-sync.css，最后加载覆盖前者）── */\n"
                + page_css + "\n")

    text = open(OUT, encoding="utf-8").read()
    bad = re.findall(r"(?m)^\s*(?:body|html|:root)(?![\w-])[\s,{:]", text)
    unscoped = 0
    for m in re.finditer(r"(?m)^(?!\s*(?:@|/\*))(?P<sel>[^{}\n@/][^{}\n]*)\{", text):
        sel = m.group("sel").strip()
        for part in split_commas(sel):
            # @keyframes 步进（0%/100%/from/to）随多行 body 换行后命中本检查，
            # 不是未收敛选择器（mistake-book 源里没有 keyframes，这坑第一次踩）。
            if re.match(r"^(?:\d+%|from|to)$", part):
                continue
            if PREFIX not in part:
                unscoped += 1
                print(f"UNSCOPED: {sel[:90]}")
                break
    print(f"kept rules (common.css .pages/.maxWidth): {kept_common}")
    print(f"kept rules (market.css): {kept_market}")
    print(f"kept rules (textbook-sync.css): {kept_page}")
    print(f"dropped: dark {stats['dark_dropped']}, excluded {stats['excluded']}, light-stripped {stats['light_stripped']}")
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
