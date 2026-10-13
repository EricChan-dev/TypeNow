#!/usr/bin/env python3
"""从参考站 `courseDetail.css` 抽取「课程详情」页所需规则，并把选择器收敛到 `.course-detail` 下。

为什么又要一个抽取脚本：课程详情页是独立的参考页（`我的课程-课程详情 - 句游英语.html`），
它的页面级样式在 `courseDetail.css` 里，与练习页的 `practice-cyber.css` 不同源。
沿用本仓既有约定（见 practice.css / membership-upgrade.css）：**只搬表现层**，
所有规则挂在本页根节点 `.course-detail` 下，不污染站内其它页面。

用法：python3 scripts/extract-course-detail-css.py
源文件：~/Downloads/我的课程-课程详情 - 句游英语_files/courseDetail.css   （页面级）
        ~/Downloads/我的课程-课程详情 - 句游英语_files/common.css         （.location 等外壳件）
        ~/Downloads/我的课程-课程详情 - 句游英语_files/reset.css          （CSS 变量表）
输出：  src/app/home/courses/course-detail.css
"""
import os
import re
import sys

HOME = os.path.expanduser("~")
REF = os.path.join(HOME, "Downloads", "我的课程-课程详情 - 句游英语_files")
SRC = os.path.join(REF, "courseDetail.css")
SRC_COMMON = os.path.join(REF, "common.css")
SRC_RESET = os.path.join(REF, "reset.css")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "src/app/home/courses/course-detail.css")
PREFIX = ".course-detail"

# 页面真正用到的类族。参考 CSS 里还有「复习建议 / 练习历史」两整块
# （review-suggestion-section / practice-history-section / history-* / mode-tag …），
# 页面 HTML 里**一个都没有**（grep 计数 0），是参考站遗留的未启用区块，不收。
INCLUDE = [
    # 课程头
    "detailname", "course-meta-line", "difficulty-tag", "meta-divider",
    "enroll-count", "course-tag", "rate", "course-actions", "course-primary-action",
    "btn-unenroll", "btn-unlock-course", "course-locked-tip", "course-actions-locked",
    # 学习统计
    "study-stats-section", "stats-cards", "stat-card", "stat-icon",
    "stat-info", "stat-value", "stat-label",
    # 课程目录
    "lesson-list-section", "section-header", "header-right", "lesson-count",
    "recent-lesson", "lesson-list", "lesson-item-wrapper", "lesson-item",
    "lesson-status", "lesson-number", "lesson-content", "lesson-title",
    "lesson-description", "lesson-right", "sentence-count", "last-practice-time",
    "lesson-toggle-icon", "lesson-actions", "btn-preview", "btn-start",
    "btn-continue", "btn-review", "btn-locked", "pay-locked",
    # 课节展开后的详情
    "lesson-detail", "detail-section", "detail-label", "detail-tags",
    "tag-vocab", "tag-phrase", "tag-grammar", "detail-complexity",
    "complexity-badge", "complexity-reason",
    # 艾宾浩斯说明弹窗
    "review-modal", "review-stage-list", "review-stage-item", "stage-badge",
    # 容器
    "maxWidth",
]

# 刻意排除：
#   · `:root[themes="dark"]` 深色分支 —— 本仓 2026-10 已删掉整套暗色令牌，
#     搬进来只会留下一堆永不命中的死规则（与 home-ref.css / partner-recruit.css 同口径）。
#   · `.courselist li .tit .icon i.icon-suo` —— 参考站旧课程列表（字体图标 + 旧 DOM），
#     新页面用的是 .lesson-* 那套。
EXCLUDE_DARK = True

# common.css 里页面依赖的外壳件（返回条 + 居中容器）。逐块精确提取，不做全文扫描。
COMMON_BLOCKS = [
    ".location",
    ".location .back",
    ".location .back:hover",
    ".location a i",
    ".location h2",
    ".location h2 span",
    ".maxWidth",
]


def strip_comments(s: str) -> str:
    return re.sub(r"/\*.*?\*/", "", s, flags=re.S)


def strip_at_statements(s: str) -> str:
    """删掉 @import / @charset。同 practice 抽取脚本：留着会把后面的 prelude 污染掉。"""
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


def scope_one(p: str, prefix: str = PREFIX) -> str:
    """把单个复合选择器的 :root / html / body 换成作用域前缀。"""
    m = re.match(r"^(?:html)?((?:\s*\[[^\]]*\])*)\s*body\b(.*)$", p, re.S)
    if m:
        return prefix + m.group(1) + m.group(2)
    m = re.match(r"^:root(.*)$", p, re.S)
    if m:
        return prefix + m.group(1)
    m = re.match(r"^(?:html|body)(.*)$", p, re.S)
    if m:
        return prefix + m.group(1)
    if p.startswith(prefix):
        return p
    return prefix + " " + p


def scope_selector(sel: str, prefix: str = PREFIX) -> str:
    return ", ".join(scope_one(p, prefix) for p in split_commas(sel))


def keep_selectors(prelude: str, body: str, include=None):
    keys = INCLUDE if include is None else include
    sels = split_commas(prelude)
    low = prelude.lower()
    if is_var_block(body):
        return sels
    # 两边都要小写化再比。INCLUDE 里"maxWidth"这种驼峰键一旦只小写一侧，
    # 就永远匹配不上 `.course-detail .maxWidth` —— 于是页面那段
    # `min-width: unset` 的响应式覆盖被静默丢弃，只剩 common.css 的
    # `min-width:1140px`，窄屏直接横向溢出。
    if any(k.lower() in low for k in keys):
        return sels
    return []


def process(s: str, collected_vars: list, include=None):
    out, kept = [], 0
    for prelude, body in parse_rules(s):
        pl = prelude.strip()
        if is_var_block(body):
            for name in re.findall(r"(--[\w-]+)\s*:", body):
                collected_vars.append(name)
        # 深色分支一律丢
        if EXCLUDE_DARK and "themes=\"dark\"" in pl:
            continue
        if pl.startswith(("@media", "@supports", "@layer")):
            inner, k = process(body, collected_vars, include)
            if k:
                out.append(pl + " {\n" + inner + "}\n")
                kept += k
            continue
        if "keyframes" in pl or pl.startswith(("@font-face", "@charset", "@import")):
            continue
        kept_sels = keep_selectors(pl, body, include)
        if kept_sels:
            out.append(scope_selector(", ".join(kept_sels)) + " {" + body + "}")
            kept += 1
    return "\n".join(out), kept


def extract_named_blocks(s: str, names: list):
    """从 common.css 里按选择器名精确取块（含各自的 @media 变体）。"""
    want, out = set(names), []
    for prelude, body in parse_rules(s):
        pl = prelude.strip()
        if pl.startswith("@media"):
            inner, _ = extract_named_blocks(body, names)
            if inner.strip():
                out.append(pl + " {\n" + inner + "}\n")
            continue
        plain = split_commas(pl)
        if all(p in want for p in plain) and plain:
            out.append(scope_selector(", ".join(plain)) + " {" + body + "}")
    return "\n".join(out), len(out)


def main():
    for p in (SRC, SRC_COMMON, SRC_RESET):
        if not os.path.exists(p):
            sys.exit(f"源文件不存在：{p}")

    raw = strip_at_statements(strip_comments(open(SRC, encoding="utf-8").read()))
    defined: list = []
    body, kept = process(raw, defined)

    common_raw = strip_at_statements(strip_comments(open(SRC_COMMON, encoding="utf-8").read()))
    common_css, kept_common = extract_named_blocks(common_raw, COMMON_BLOCKS)

    # ── 变量表 ────────────────────────────────────────────────────────────────
    # 参考 CSS 用的是**无前缀**变量名（--bodyT / --f1f5f9 …），定义在 reset.css 的 :root。
    # 本仓不能全局声明这些名字（会溢出到其它页面），所以只为**这份文件实际引用到**的
    # 变量生成一份挂在 `.course-detail` 上的令牌块，取值逐字来自参考 reset.css 浅色分支。
    reset_raw = strip_at_statements(strip_comments(open(SRC_RESET, encoding="utf-8").read()))
    ref_vars = {}
    for prelude, b in parse_rules(reset_raw):
        if not is_var_block(b):
            continue
        # 只取浅色 :root，跳过 :root[themes="dark"]
        if "dark" in prelude.lower():
            continue
        for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;]+);", b):
            ref_vars.setdefault(m.group(1), m.group(2).strip())

    used_vars = sorted(set(re.findall(r"var\((--[\w-]+)", body + common_css)))
    missing = [v for v in used_vars if v not in ref_vars]
    var_lines = []
    for v in used_vars:
        if v in ref_vars:
            var_lines.append(f"  {v}: {ref_vars[v]};")
    vars_css = (f"{PREFIX} {{\n" + "\n".join(var_lines) + "\n}\n") if var_lines else ""

    header = (
        "/* 自动生成 —— 请勿手改。\n"
        " * 来源：句游英语参考站 courseDetail.css（课程详情页）+ common.css（.location / .maxWidth）。\n"
        " * 生成器：scripts/extract-course-detail-css.py（选择器已收敛到 " + PREFIX + " 下）。\n"
        " * 重新生成：python3 scripts/extract-course-detail-css.py\n"
        " *\n"
        " * 三条搬运约定（与 home-ref.css / membership-upgrade.css 同口径）：\n"
        " *   1. 字号/行高/内边距/圆角/阴影/色值全部保留参考页原值，不做「优化」。\n"
        " *   2. 参考页用 remixicon 字体图标（<i class=\"ri-*\">），本仓统一用 lucide\n"
        " *      组件；字体图标的 font-size 规则改写成 svg 的宽高（在组件里给 size）。\n"
        " *   3. `:root[themes=\"dark\"]` 深色分支一律不搬 —— 本仓 2026-10 已删掉整套暗色令牌。\n"
        " *\n"
        " * 文件顶部的令牌块同样是生成物：参考页的变量定义在 reset.css 的 :root 上，\n"
        " * 全局声明会溢出到其它页面，所以只把**本文件引用到的**那些挂在 " + PREFIX + " 上。\n"
        " */\n\n"
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        # 顺序必须是 common.css 在前、courseDetail.css 在后 —— 这是参考页的真实层叠顺序：
        # common.css 在 <head> 里，courseDetail.css 在 <body> 内联引入，后者靠"更晚出现"
        # 覆盖前者。两份里都有 `.maxWidth`（同为 0,1,0 特异性），
        # common 给 `min-width:1140px`、页面给 `min-width:unset`，写反就把
        # 窄屏覆盖吃掉、页面横向溢出。这条不是排版偏好，是层叠正确性。
        f.write(header + vars_css + "\n"
                + "/* ── 外壳件（来自 common.css，参考页 <head> 中先加载）── */\n"
                + common_css
                + "\n\n/* ── 页面样式（来自 courseDetail.css，参考页中后加载、覆盖前者）── */\n"
                + body + "\n")

    text = open(OUT, encoding="utf-8").read()
    bad = re.findall(r"(?m)^\s*(?:body|html|:root)(?![\w-])[\s,{:]", text)
    print(f"kept rules (courseDetail.css): {kept}")
    print(f"kept rules (common.css):       {kept_common}")
    print(f"vars emitted: {len(var_lines)}   used: {len(used_vars)}")
    print(f"lines: {text.count(chr(10))}   bytes: {os.path.getsize(OUT)}")
    print(f"UNSCOPED global selectors: {len(bad)}")
    if missing:
        print(f"vars referenced but NOT in reference reset.css: {', '.join(missing)}")
    if bad:
        sys.exit(1)


main()
