# -*- coding: utf-8 -*-
"""生成字体对比演示页。自包含：字体以 base64 内嵌，双击即可打开。

    python3 brand/tools/fetch-font-samples.py brand/tools/font-sample-chars.txt
    python3 brand/tools/build-font-compare.py

产物 brand/font-compare.html **不进 public/** —— 它是挑字体阶段给人看的一次性
对照页（573KB，内嵌 12 份字体）。放 public 会随构建一起部署上线，成为线上可访问
的垃圾文件；放 brand/ 下则只跟着仓库走，用 file:// 双击打开即可。
"""
import base64, json, os

TOOLS = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.dirname(TOOLS)
CACHE = os.path.join(TOOLS, ".cache", "font-samples")

# 候选元数据（含体积/分类）由 fetch-font-samples.py 写出；样本字体在 .cache 下
fonts = json.load(open(os.path.join(TOOLS, "font-candidates.json"), encoding="utf-8"))
for f in fonts:
    # font-candidates.json 里记的是绝对路径（生成时落盘用的），这里统一按
    # 「样本目录 + 文件名」重新定位，保证换台机器/换目录后仍能重跑。
    f["path"] = os.path.join(CACHE, os.path.basename(f["path"]))
    f["b64"] = base64.b64encode(open(f["path"], "rb").read()).decode()

# 落地页真实标题文案
HERO_L1, HERO_L2 = "马上一小句，", "人生一大步"
SEC = "三种玩法，全方位攻克句法语感"
SEC2 = "准备好开始你的英语游戏了吗？"
CARDS = ["单词拼图模式", "键盘打字模式", "语音口语模式"]
PICK = "选择适合你的方案"
BRANDS = ["句学社", "句游英语", "TypeNow"]
BODY = "告别单一枯燥的死记单词。在句学社，通过多维互动输入，让你在轻松闯关中自然形成英语语感。"

def face(f):
    return f"""@font-face{{font-family:"{f['name']}";src:url(data:font/woff2;base64,{f['b64']}) format("woff2");font-weight:400;font-style:normal;font-display:block;}}"""

css_faces = "\n".join(face(f) for f in fonts)

# 每款字体一张卡：同一套真实标题，横向可对比
def card(f):
    fam = f["name"]
    fit_badge = {"强烈":"b-best","可":"b-ok","弱":"b-weak"}[f["fit"]]
    return f"""
<section class="card" data-font="{fam}">
  <header class="chead">
    <div class="cname">{f['name']}</div>
    <div class="cmeta">
      <span class="tag {fit_badge}">适合度 {f['fit']}</span>
      <span class="tag">{f['cat']}</span>
      <span class="tag mono">{f['bytes']:,} B</span>
    </div>
  </header>
  <p class="cdesc">{f['desc']}</p>

  <div class="spec hero-spec" style="font-family:'{fam}'">
    <div class="lbl">首屏主标 · 60px</div>
    <h1>{HERO_L1}<br><span class="accent">{HERO_L2}</span></h1>
  </div>

  <div class="spec" style="font-family:'{fam}'">
    <div class="lbl">章节标题 · 36px</div>
    <h2>{SEC}</h2>
  </div>

  <div class="spec" style="font-family:'{fam}'">
    <div class="lbl">次级标题 · 30px</div>
    <h2 class="sm">{SEC2}</h2>
  </div>

  <div class="spec">
    <div class="lbl">卡片标题 · 20px</div>
    <div class="cards" style="font-family:'{fam}'">
      {''.join(f'<div class="mini"><div class="mt">{c}</div><div class="mp">这里是卡片说明文字，用正文字体。</div></div>' for c in CARDS)}
    </div>
  </div>

  <div class="spec" style="font-family:'{fam}'">
    <div class="lbl">品牌锁定标 · 26px</div>
    <div class="brandrow">{''.join(f'<span class="bl">{b}</span>' for b in BRANDS)}</div>
  </div>

  <div class="spec">
    <div class="lbl">正文对照（正文字体 Inter，标题字只用于标题）</div>
    <p class="bodytxt">{BODY}</p>
  </div>
</section>"""

cards = "\n".join(card(f) for f in fonts)
nav = "".join(f'<a href="#f{i}">{f["name"]}</a>' for i, f in enumerate(fonts))
# 给每张卡补 id
for i, f in enumerate(fonts):
    cards = cards.replace(f'data-font="{f["name"]}"', f'id="f{i}" data-font="{f["name"]}"', 1)

HTML = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>句学社 · 标题字体候选对比</title>
<style>
{css_faces}
:root{{--ink:#0f172a;--muted:#64748b;--blue:#2563eb;--line:#e2e8f0;--amber:#f59e0b;}}
*{{box-sizing:border-box}}
body{{margin:0;font-family:Inter,-apple-system,"PingFang SC",sans-serif;color:var(--ink);background:#f8fafc;line-height:1.6}}
.wrap{{max-width:1100px;margin:0 auto;padding:32px 20px 80px}}
.top{{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:9;padding:14px 20px}}
.top h1{{margin:0 0 4px;font-size:20px}}
.top p{{margin:0;color:var(--muted);font-size:13px}}
nav{{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}}
nav a{{font-size:12px;padding:3px 9px;border:1px solid var(--line);border-radius:99px;color:var(--ink);text-decoration:none;background:#f8fafc}}
nav a:hover{{background:var(--blue);color:#fff;border-color:var(--blue)}}
.card{{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:22px 0;scroll-margin-top:150px}}
.chead{{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:12px}}
.cname{{font-size:19px;font-weight:700}}
.cmeta{{display:flex;gap:6px;flex-wrap:wrap}}
.tag{{font-size:11px;padding:2px 8px;border-radius:99px;background:#f1f5f9;color:var(--muted);border:1px solid var(--line)}}
.tag.mono{{font-family:ui-monospace,monospace}}
.b-best{{background:#dcfce7;color:#166534;border-color:#bbf7d0}}
.b-ok{{background:#fef9c3;color:#854d0e;border-color:#fde68a}}
.b-weak{{background:#fee2e2;color:#991b1b;border-color:#fecaca}}
.cdesc{{color:var(--muted);font-size:13px;margin:10px 0 0}}
.spec{{margin-top:20px;padding-top:14px;border-top:1px dashed var(--line)}}
.lbl{{font-size:11px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px;font-family:ui-monospace,monospace}}
.spec h1{{font-size:60px;line-height:1.08;margin:0;font-weight:400;letter-spacing:-.02em}}
.spec h2{{font-size:36px;line-height:1.2;margin:0;font-weight:400;letter-spacing:-.02em}}
.spec h2.sm{{font-size:30px}}
.accent{{color:var(--blue);position:relative;display:inline-block}}
.accent::after{{content:"";position:absolute;left:0;right:0;bottom:-6px;height:9px;border-bottom:5px solid var(--amber);border-radius:50%;opacity:.8}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}}
.mini{{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:#fcfdfe}}
.mt{{font-size:20px;line-height:1.3;margin-bottom:4px}}
.mp{{font-size:13px;color:var(--muted);font-family:Inter,"PingFang SC",sans-serif}}
.brandrow{{display:flex;gap:26px;align-items:baseline;flex-wrap:wrap}}
.bl{{font-size:26px;line-height:1.1}}
.bodytxt{{font-size:15px;color:#475569;margin:0;max-width:62ch}}
.hero-spec h1{{font-size:60px}}
@media(max-width:640px){{.spec h1,.hero-spec h1{{font-size:38px}}.spec h2{{font-size:26px}}.spec h2.sm{{font-size:22px}}}}
</style></head>
<body>
<div class="top">
  <h1>句学社 · 标题字体候选对比</h1>
  <p>每张卡用<b>落地页真实标题文案</b>排同一组版式。共 {len(fonts)} 款，全部 SIL OFL 免费商用。字体已按标题字符子集内嵌，故此页可直接双击打开、离线可看。</p>
  <nav>{nav}</nav>
</div>
<div class="wrap">
{cards}
</div>
</body></html>"""

out = "/Users/opay-20260168/Documents/trae_projects/TypeNow/brand/font-compare.html"
open(out, "w", encoding="utf-8").write(HTML)
print(f"已生成 {out}  ({os.path.getsize(out):,} B)")
