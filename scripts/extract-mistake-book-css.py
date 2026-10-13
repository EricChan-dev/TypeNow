#!/usr/bin/env python3
"""从句游英语「错题本」存档页生成 src/app/home/review/mistake-book.css，并把选择器收敛到 `.mistake-book-content` 下。

错题本是独立参考页（~/Downloads/错题本 - 句游英语.html，句游的 /User/MistakeBook）。
与课程详情/市场详情两页不同，这一页的页面级样式有**两个来源**：
  · 页内大段内联 <style>（334 条规则，仪表盘/课程卡/课节 tabs/列表/确认弹窗）；
  · mistake.css（48 条规则，工具条与空态，本身已挂在 `.mistake-book-content` 下）。

主题极性与前两页**相反**：存档时 html[themes="dark"]，内联 CSS 是「暗色为基」——
裸规则直接写暗色，亮色以 [themes="white"] / [themes="light"] 前缀覆盖。
本仓只有亮色，所以主题变换是：
  1. 丢弃选择器含 themes="dark" 的规则（暗色专属覆盖，35 条）；
  2. [themes="white"] / [themes="light"] 前缀剥掉，当作普通亮色规则；
  3. 裸规则原样保留 —— 真站亮色用户看到的就是 基 + 亮色覆盖 的级联结果。
生成后对「裸规则含暗色系色值、却没有对应亮色覆盖」的选择器打警告，人工核对是否漏搬。

刻意排除（EXCLUDE_DYING）：页面上存在过两代设计。参考 DOM 与渲染模板里已经
不出现的旧族不搬 —— mistake.css 的 mistakeT 表格版/second_tab/旧 .tit p label
图标族/旧 .detail(.xq/.AI/.anser/Chinse_anser/error_anser/.question/Anser_short)，
内联里的另一版仪表盘（review-card/breakdown-*/mini-stat/favorite-stats/
review-header/review-tomorrow/review-stats/total-count/card-header/section-title/
meta-pill/ai-title/ai-body/ai-suggestion/today-new/user-answer-block）。
新设计实际用的是：today-badge / big-num / simple-stat-block / analysis-simple-grid /
stat-group-row / dist-bar-*（静态 DOM 里都在）。

用法：python3 scripts/extract-mistake-book-css.py
源文件：~/Downloads/错题本 - 句游英语.html                （页内联 <style>，取最大的块）
        ~/Downloads/错题本 - 句游英语_files/mistake.css    （工具条/空态）
        ~/Downloads/错题本 - 句游英语_files/common.css     （.maxWidth 外壳件）
        ~/Downloads/错题本 - 句游英语_files/reset.css      （CSS 变量表）
输出：  src/app/home/review/mistake-book.css
"""
import os
import re
import sys

HOME = os.path.expanduser("~")
REF_DIR = os.path.join(HOME, "Downloads", "错题本 - 句游英语_files")
REF_HTML = os.path.join(HOME, "Downloads", "错题本 - 句游英语.html")
SRC_MISTAKE = os.path.join(REF_DIR, "mistake.css")
SRC_COMMON = os.path.join(REF_DIR, "common.css")
SRC_RESET = os.path.join(REF_DIR, "reset.css")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "src/app/home/review/mistake-book.css")
PREFIX = ".mistake-book-content"

# 旧设计死族（选择器含这些子串就丢）。逐条依据见文件头注释。
EXCLUDE_DYING = [
    "mistakeT", "second_tab", "Anser_short", ".xq", ".AI", ".anser",
    "Chinse_anser", "error_anser", ".question", ".yf", ".lj", ".ch",
    ".tit p",
    "review-card", "breakdown-", "mini-stat", "favorite-stats",
    "review-header", "review-tomorrow", "review-stats", "total-count",
    "card-header", "section-title", "meta-pill", "ai-title", "ai-body",
    "ai-suggestion", "today-new", "user-answer-block",
]

# 暗色系色值（内联 CSS 暗色为基时的典型底色/阴影）。用于漏搬警告。
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
    已含 .mistake-book-content 的（mistake.css 自带的）原样保留。"""
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


def is_dying(sel: str):
    """命中死族返回命中的关键词，否则返回 None。"""
    low = sel.lower()
    for key in EXCLUDE_DYING:
        if key.lower() in low:
            return key
    return None


def process(s: str, collected_vars: list, stats: dict, light_selectors: set):
    """主题变换 + 收敛作用域。返回 (css, kept)。light_selectors 收集亮色变体的
    归一化选择器，供跨规则核对「裸暗色规则有没有亮色覆盖」。"""
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
        dead = is_dying(sel_text)
        if dead:
            stats["dying_dropped"] += 1
            continue
        if light_hit:
            stats["light_stripped"] += 1
            for p in sels:
                light_selectors.add(" ".join(p.split()))
        else:
            # 暗色裸规则有没有亮色覆盖，要跨规则核对（同名选择器的 light 变体）。
            # 只看底色/边框/阴影：#1e293b 这类深灰做**文字色**在亮色站本来就有，
            # 不算漏搬。核对不上才进人工核对清单。
            decls = re.sub(r"(?i)(?:^|;)\s*color\s*:[^;]*", "", body)
            if DARK_COLOR_RE.search(decls) and not any(
                " ".join(p.split()) in light_selectors for p in sels
            ):
                stats.setdefault("dark_leak_warn", []).append(sel_text[:80])
        out.append(scope_selector(sel_text) + " {" + body + "}")
        kept += 1
    return "\n".join(out), kept


def extract_maxwidth(s: str):
    """common.css 的 .maxWidth（居中容器）。参考页根元素是 `maxWidth mistake-book-content`
    二合一，所以收敛成复合选择器 .mistake-book-content.maxWidth（后代选择器匹配不到根元素自己）。"""
    out = 0
    chunks = []
    for prelude, body in parse_rules(s):
        pl = prelude.strip()
        if pl.startswith("@media"):
            inner, k = extract_maxwidth(body)
            if k:
                chunks.append(pl + " {\n" + inner + "}\n")
                out += k
            continue
        plain = split_commas(pl)
        if all(p == ".maxWidth" for p in plain) and plain:
            chunks.append(PREFIX + ".maxWidth {" + body + "}")
            out += 1
    return "\n".join(chunks), out


def main():
    for p in (REF_HTML, SRC_MISTAKE, SRC_COMMON, SRC_RESET):
        if not os.path.exists(p):
            sys.exit(f"源文件不存在：{p}")

    html = open(REF_HTML, encoding="utf-8").read()
    styles = re.findall(r"<style[^>]*>(.*?)</style>", html, re.S)
    if not styles:
        sys.exit("参考 HTML 里没有 <style> 块")
    # 页面主样式 = 最大的那个内联块。**必须先剥注释**：内联块里有成段的
    # /* 旧规则 */ 注释（甚至带花括号），不剥掉会打乱花括号配对——@media 的
    # prelude 前面粘上注释残渣后 startswith("@media") 判否，整个 media 块被
    # 当普通规则原样写入，内部选择器一个都没收敛（首轮生成踩过的坑）。
    inline = strip_at_statements(strip_comments(max(styles, key=len)))

    stats = {"dark_dropped": 0, "light_stripped": 0, "dying_dropped": 0}
    collected: list = []
    light_selectors: set = set()

    # 层叠顺序 = 参考页真实顺序：mistake.css（<head> link）在前，内联 <style>（页内）在后。
    mistake_raw = strip_at_statements(strip_comments(open(SRC_MISTAKE, encoding="utf-8").read()))
    # 第一遍只跑统计，把亮色变体选择器全收进 light_selectors —— 亮色覆盖在源里
    # 总是写在暗色裸规则**后面**，单遍处理时核对会漏掉后面才出现的变体（误报）。
    process(mistake_raw, collected, dict(stats), light_selectors)
    process(inline, collected, dict(stats), light_selectors)
    mistake_css, kept_mistake = process(mistake_raw, collected, stats, light_selectors)
    inline_css, kept_inline = process(inline, collected, stats, light_selectors)

    common_raw = strip_at_statements(strip_comments(open(SRC_COMMON, encoding="utf-8").read()))
    common_css, kept_common = extract_maxwidth(common_raw)

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

    used_vars = sorted(set(re.findall(r"var\((--[\w-]+)", mistake_css + inline_css + common_css)))
    missing = [v for v in used_vars if v not in ref_vars]
    var_lines = [f"  {v}: {ref_vars[v]};" for v in used_vars if v in ref_vars]
    vars_css = (f"{PREFIX} {{\n" + "\n".join(var_lines) + "\n}\n") if var_lines else ""

    header = (
        "/* 自动生成 —— 请勿手改。\n"
        " * 来源：句游英语错题本参考页（/User/MistakeBook）页内联 <style> + mistake.css + common.css（.maxWidth）。\n"
        " * 生成器：scripts/extract-mistake-book-css.py（选择器已收敛到 " + PREFIX + " 下）。\n"
        " * 重新生成：python3 scripts/extract-mistake-book-css.py\n"
        " *\n"
        " * 主题极性与课程详情/市场详情两页相反：这页内联 CSS 是「暗色为基」（存档时\n"
        " * html[themes=\"dark\"]），亮色以 [themes=\"white\"]/[themes=\"light\"] 前缀覆盖。\n"
        " * 本仓只有亮色，所以：themes=\"dark\" 规则丢弃；white/light 前缀剥掉当普通规则；\n"
        " * 裸规则原样保留 —— 真站亮色用户看到的就是 基+亮色覆盖 的级联结果。\n"
        " *\n"
        " * 其它三条搬运约定（与 home-ref.css / course-detail.css 同口径）：\n"
        " *   1. 字号/行高/内边距/圆角/阴影/色值全部保留参考页原值，不做「优化」。\n"
        " *   2. 参考页用 remixicon 字体图标（<i class=\"ri-*\">），本仓统一用 lucide\n"
        " *      组件；字体图标的 font-size 规则改写成 svg 的宽高（在组件里给 size）。\n"
        " *   3. 参考页有过两代设计，死掉的旧族（mistakeT 表格版 / second_tab /\n"
        " *      review-card breakdown-* 等）不搬，依据见生成器头注释。\n"
        " */\n\n"
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(header + vars_css + "\n"
                + "/* ── 外壳件（来自 common.css，参考页根元素是 maxWidth mistake-book-content 二合一）── */\n"
                + common_css
                + "\n\n/* ── 工具条/空态（来自 mistake.css，参考页 <head> 中先加载）── */\n"
                + mistake_css
                + "\n\n/* ── 页面样式（来自参考页内联 <style>，页内后加载、覆盖前者）── */\n"
                + inline_css + "\n")

    text = open(OUT, encoding="utf-8").read()
    bad = re.findall(r"(?m)^\s*(?:body|html|:root)(?![\w-])[\s,{:]", text)
    unscoped = 0
    for m in re.finditer(r"(?m)^(?!\s*(?:@|/\*))(?P<sel>[^{}\n@/][^{}\n]*)\{", text):
        sel = m.group("sel").strip()
        for part in split_commas(sel):
            # 参考页根元素是 `maxWidth mistake-book-content` 二合一，mistake.css 的
            # 根选择器写作 `.maxWidth.mistake-book-content`（原样保留）——只要选择器
            # 提到本页根类就算已收敛，不强求以前缀开头。
            if PREFIX not in part:
                unscoped += 1
                print(f"UNSCOPED: {sel[:90]}")
                break
    print(f"kept rules (mistake.css): {kept_mistake}")
    print(f"kept rules (inline <style>): {kept_inline}")
    print(f"kept rules (common.css .maxWidth): {kept_common}")
    print(f"dropped: dark {stats['dark_dropped']}, dying {stats['dying_dropped']}, light-stripped {stats['light_stripped']}")
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
