# -*- coding: utf-8 -*-
"""下载 logo 所需的开源字体到 brand/tools/fonts/。

    python3 brand/tools/fetch-fonts.py

两个字族都是 SIL Open Font License 1.1，可商用、可嵌入、可修改：
- Inter        —— 拉丁标 TypeNow（与站点正文同族，next/font 用的也是它）
- Noto Sans SC —— 中文标 句学社

之所以自己下一份 TTF 而不是复用 .next/static/media 里的 woff2：那批文件按 unicode-range
切成了多个子集，且读取需要 brotli 扩展。TTF 一次到位。
"""
import os
import time
import urllib.request

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
TARGETS = [
    ("Inter.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"),
    ("NotoSansSC.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"),
]


def size_of(path):
    """文件可能在下半途被外部清掉（本机 /tmp 就曾被系统清理），拿不到就当作 0 重来。"""
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def fetch(name, url, tries=15):
    """下到 <name>.part，长度对得上才改名。半成品留在原地会被构建脚本当成完整字体读，
    报出莫名其妙的 sfnt 断言错误。"""
    dst = os.path.join(FONTS, name)
    tmp = dst + ".part"
    for attempt in range(1, tries + 1):
        have = size_of(tmp)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0",
                                                   "Range": f"bytes={have}-"})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                resume = resp.status == 206 and have > 0
                total = int(resp.headers.get("Content-Length", 0)) + (have if resume else 0)
                with open(tmp, "ab" if resume else "wb") as fh:
                    while True:
                        chunk = resp.read(1 << 18)
                        if not chunk:
                            break
                        fh.write(chunk)
        except Exception as exc:                # 断点续传：下一轮带 Range 接着下
            print(f"  {name} 第 {attempt} 次中断（{type(exc).__name__}），已有 {size_of(tmp)} 字节")
            time.sleep(2)
            continue
        got = size_of(tmp)
        if total and got != total:
            print(f"  {name} 第 {attempt} 次不完整（{got}/{total}），继续续传")
            continue
        os.replace(tmp, dst)
        print(f"  ✓ {name}  {got/1048576:.2f} MB")
        return dst
    raise SystemExit(f"{name} 多次下载失败，请手动下载到 {dst}")


def usable(path):
    """目录里可能躺着上一轮没下完的半成品：半成品也能读出 head 表，
    所以必须校验整张表目录都落在文件长度内。不用文件大小做启发式——子集字体只有几 KB。"""
    try:
        from fontTools.ttLib import TTFont

        f = TTFont(path, lazy=True)
        size = os.path.getsize(path)
        return bool(f.reader.tables) and all(e.offset + e.length <= size
                                             for e in f.reader.tables.values())
    except Exception:
        return False


def main():
    os.makedirs(FONTS, exist_ok=True)
    for name, url in TARGETS:
        dst = os.path.join(FONTS, name)
        if usable(dst):
            print(f"  = {name} 已存在且可用，跳过")
            continue
        if os.path.exists(dst):                 # 半成品降级为续传起点
            os.replace(dst, dst + ".part")
            print(f"  ! {name} 之前没下完，从 {os.path.getsize(dst + '.part')} 字节续传")
        fetch(name, url)
    print("字体就绪：", FONTS)


if __name__ == "__main__":
    main()
