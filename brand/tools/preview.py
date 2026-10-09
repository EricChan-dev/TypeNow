# -*- coding: utf-8 -*-
"""生成 brand/preview.html —— 自包含的 logo 对照看板（SVG 内联为 data URI，双击即可打开）。

    python3 brand/tools/preview.py && open brand/preview.html
"""
import base64
import os

TOOLS = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(TOOLS)
SVG = os.path.join(OUT, "svg")

ICONS = [("a", "方案 A · 双注音键帽（大 A ＋ 左上「中」）"),
         ("b", "方案 B · 中 / A（暖调键身）"),
         ("c", "方案 C · 上行箭键帽")]
SIMPLE = [("a", "A"), ("c", "C")]


def uri(name):
    with open(os.path.join(SVG, name), "rb") as fh:
        return "data:image/svg+xml;base64," + base64.b64encode(fh.read()).decode()


def im(name, style=""):
    return f'<img src="{uri(name)}" style="{style}">'


def card(title, inner):
    return f'<section><h2>{title}</h2>{inner}</section>'


def build():
    h = ['<meta charset="utf-8"><style>*{box-sizing:border-box}'
         'body{margin:0;font:14px/1.5 -apple-system,"PingFang SC",sans-serif;background:#fff;color:#0f172a}'
         'h1{font-size:15px;font-weight:600;margin:0;padding:18px 26px;border-bottom:1px solid #e5e7eb}'
         'h1 small{color:#64748b;font-weight:400;margin-left:10px}'
         'section{padding:20px 26px;border-bottom:1px solid #eef0f3}'
         'h2{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;margin:0 0 16px}'
         '.row{display:flex;align-items:flex-end;gap:22px;flex-wrap:wrap}'
         '.cell{display:flex;flex-direction:column;align-items:center;gap:9px}'
         '.cell>span{font-size:11px;color:#94a3b8;white-space:nowrap}'
         '.dk{background:#060608;padding:16px 20px;border-radius:12px}'
         '.lt{background:#fff;padding:16px 20px;border:1px solid #eef0f3;border-radius:12px}'
         'img{display:block}.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}'
         '.hero{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;'
         'background:#fafafa;border:1px solid #eef0f3;border-radius:12px;padding:28px 20px}'
         '.hero.d{background:#060608;border-color:#1e1e2a}.tag{font-size:11px;color:#b45309;font-weight:600}'
         '</style>']

    h.append(card("① 图形方案 · 132px", '<div class="row">' + "".join(
        f'<div class="cell lt">{im(f"icon-{k}.svg", "width:132px")}<span>{l}</span></div>' for k, l in ICONS)
        + f'<div class="cell lt">{im("icon-mono-ink.svg", "width:132px")}<span>单色版（负形键环）</span></div>'
        + '</div>'))

    for k, l in ICONS:
        strip = "".join(
            f'<div class="cell lt">{im(f"icon-{k}.svg", f"width:{p}px")}<span>{p}</span></div>'
            for p in (64, 48, 36, 28, 24, 20, 16))
        strip += (f'<div class="cell lt">{im(f"icon-{k}-simple.svg", "width:28px")}<span>simple 28</span></div>'
                  f'<div class="cell lt">{im(f"icon-{k}-simple.svg", "width:16px")}<span>simple 16</span></div>')
        h.append(card(f"② 小尺寸可读性 · 方案 {k.upper()}", f'<div class="row">{strip}</div>'))

    h.append(card("③ 横向组合标 · 浅色底", '<div class="g3">' + "".join(
        f'<div class="hero">{im(f"logo-horizontal-{k}.svg", "width:100%")}<span class="tag">{l}</span></div>'
        for k, l in ICONS) + '</div>'))
    h.append(card("④ 横向组合标 · 深色底", '<div class="g3">' + "".join(
        f'<div class="hero d">{im(f"logo-horizontal-{k}-reverse.svg", "width:100%")}</div>'
        for k, l in ICONS) + '</div>'))

    comp = "".join(
        f'<div class="cell lt">{im(f"logo-compact-{k}.svg", "height:30px")}<span>{l}</span></div>' for k, l in ICONS)
    comp += (f'<div class="cell lt">{im("logo-compact-a-simple.svg", "height:30px")}<span>compact simple</span></div>'
             f'<div class="cell lt">{im("icon-a.svg", "width:28px")}<span>28px</span></div>'
             f'<div class="cell lt">{im("icon-a-simple.svg", "width:16px")}<span>favicon 16</span></div>')
    h.append(card("⑤ 顶栏紧凑单行（30px 高）／ favicon", f'<div class="row">{comp}</div>'))

    h.append(card("⑥ 单色版 · 单色印刷 / 刻印 / 超小尺寸", '<div class="row">'
        + f'<div class="cell lt">{im("icon-mono-ink.svg", "width:96px")}<span>#0f172a</span></div>'
        + f'<div class="cell dk">{im("icon-mono-white.svg", "width:96px")}<span>反白</span></div>'
        + f'<div class="cell lt">{im("icon-mono-arrow.svg", "width:96px")}<span>箭头单色</span></div>'
        + f'<div class="cell lt">{im("icon-mono-ink.svg", "width:28px")}<span>28px</span></div>'
        + f'<div class="cell lt">{im("icon-mono-ink.svg", "width:16px")}<span>16px</span></div></div>'))

    h.insert(0, '<h1>句学社 · TypeNow — Logo 方案'
                '<small>amber #f59e0b ＋ blue #1e40af ｜ 文字已转曲 ｜ 96×96 基准网格</small></h1>')
    # Chrome 的 --screenshot 只截窗口大小，所以把真实内容高度写到 DOM 上，
    # export-png.sh 先用 --dump-dom 读出来，再按这个高度截整页。
    h.append('<script>window.addEventListener("load",function(){'
             'document.documentElement.setAttribute("data-page-height",document.body.scrollHeight)})</script>')
    path = os.path.join(OUT, "preview.html")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("<!doctype html><html lang=zh>" + "".join(h) + "</html>")
    print("写出", path, os.path.getsize(path), "B")


if __name__ == "__main__":
    build()
