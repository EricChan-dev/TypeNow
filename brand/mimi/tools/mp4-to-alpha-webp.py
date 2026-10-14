#!/usr/bin/env python3
"""MP4(灰底) → 透明背景动画 WebP  v2

用户反馈（m01218）：1 和 3 转换后有"黑影"。
根因：v1 的 alpha 曾用 max(warmth斜坡, dist斜坡)，其中 dist（与底色亮度差）会把
猫轮廓外那圈「比底色暗但一点不暖」的投影/描边一起判成前景 → 输出里变成深色硬边。
修法：alpha 只由暖色通道判据决定（非暖的投影、白水印、灰雾自然全部透明），
再补内部孔洞（闭运算）、收 1px 去掉混色环、轻微羽化，最后去溢色但不许压黑。

用法: python3 mp4-to-alpha-webp.py [1|2|3 ...]
"""

import subprocess
import sys
import numpy as np
from PIL import Image, ImageFilter
import os

SRC_DIR = os.path.expanduser("~/Downloads")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "webp")
W, H = 1280, 720
DEG, BX, BY = 2, 32, 18
OUT_W = 640
FPS = 24
QUALITY = 82

# warmth 斜坡 (lo, hi)、闭运算核、收边核
PARAMS = {
    1: dict(warm=(18, 38), close=15, erode=5),
    2: dict(warm=(8, 22), close=15, erode=3),
    3: dict(warm=(13, 33), close=15, erode=5),
}
NAMES = {1: "mimi-ai-1", 2: "mimi-ai-2", 3: "mimi-ai-3"}


def basis(x, y, deg=DEG):
    u = x / W * 2 - 1
    v = y / H * 2 - 1
    t = [np.ones_like(u, dtype=float)]
    for d in range(1, deg + 1):
        for i in range(d + 1):
            t.append((u ** (d - i)) * (v ** i))
    return np.stack(t, axis=-1)


def fit_bg(a):
    """分块中值 + 迭代硬剔除猫块 → 二阶多项式背景场。"""
    meds, cx, cy = [], [], []
    for i in range(BY):
        for j in range(BX):
            y0, y1 = i * H // BY, (i + 1) * H // BY
            x0, x1 = j * W // BX, (j + 1) * W // BX
            meds.append(np.median(a[y0:y1, x0:x1].reshape(-1, 3)[::3], axis=0))
            cx.append((x0 + x1) / 2)
            cy.append((y0 + y1) / 2)
    meds = np.array(meds)
    X = basis(np.array(cx, float), np.array(cy, float))
    w = np.ones(len(meds))
    for it in range(5):
        coef = np.linalg.lstsq(X * w[:, None], meds * w[:, None], rcond=None)[0]
        res = np.sqrt(((meds - X @ coef) ** 2).sum(1))
        thr = np.percentile(res, 70) if it == 0 else max(1.5, 3.0 * np.median(res))
        w = (res < thr).astype(float)
    Y, Xg = np.mgrid[0:H, 0:W]
    B = (basis(Xg.ravel().astype(float), Y.ravel().astype(float)) @ coef).reshape(H, W, 3)
    print(f"    背景拟合：用块 {int((w>0).sum())}/{len(meds)}，块残差 p50={np.median(res[w>0]):.2f}")
    return B


def _f(al, kind, k):
    im = Image.fromarray((al * 255).astype(np.uint8), "L")
    filt = ImageFilter.MaxFilter if kind == "max" else ImageFilter.MinFilter
    return np.asarray(im.filter(filt(k))).astype(np.float32) / 255.0


def close_a(al, k):
    return _f(_f(al, "max", k), "min", k)


def erode_a(al, k):
    return _f(al, "min", k)


def blur_a(al, r):
    return np.asarray(Image.fromarray((al * 255).astype(np.uint8), "L")
                      .filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0


def key_frame(a, B, prm):
    warm = np.clip((a[:, :, 0] - a[:, :, 2]) - (B[:, :, 0] - B[:, :, 2]), 0, None)
    lo, hi = prm["warm"]
    al = np.clip((warm - lo) / (hi - lo), 0, 1)
    al = close_a(al, prm["close"])          # 补内部孔洞（眼睛/鼻/嘴）
    al = erode_a(al, prm["erode"])          # 收掉最外圈与底色混色的硬边
    al = blur_a(al, 1.2)                    # 重新羽化，边缘不留锯齿
    # 去溢色：按 alpha 反解前景，但设置下限，绝不把边缘压黑
    safe = np.maximum(al, 0.45)[..., None]
    fg = np.clip((a - (1 - al)[..., None] * B) / safe, 0, 255)
    fg = np.maximum(fg, a * 0.72)
    return fg, al


def premul_resize(rgb, alpha, w_out):
    h_out = int(round(H * w_out / W))
    pm = np.dstack([rgb * alpha[..., None], alpha * 255.0])
    im = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8)).resize((w_out, h_out), Image.LANCZOS)
    out = np.asarray(im).astype(np.float32)
    a2 = out[:, :, 3] / 255.0
    rgb2 = np.clip(out[:, :, :3] / np.maximum(a2, 1e-3)[..., None], 0, 255)
    return Image.fromarray(np.dstack([rgb2, out[:, :, 3]]).astype(np.uint8), "RGBA")


def decode(path):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-an",
                          "-vf", "format=rgb24", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    n = W * H * 3
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32)
    p.stdout.close()
    p.wait()


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    todo = [int(x) for x in sys.argv[1:]] or [1, 2, 3]
    for idx in todo:
        src = os.path.join(SRC_DIR, f"生成透明背景猫咪静态图 ({idx}).mp4")
        out = os.path.join(OUT_DIR, NAMES[idx] + ".webp")
        prm = PARAMS[idx]
        print(f"\n=== ({idx}) → {os.path.basename(out)}  warm{prm['warm']} close{prm['close']} erode{prm['erode']} ===")
        frames, B, ring_old, ring_new = [], None, [], []
        for i, a in enumerate(decode(src)):
            if B is None:
                B = fit_bg(a)
            rgb, al = key_frame(a, B, prm)
            if i == 0:
                # 对比新旧半透明环的亮度：旧版带 dist 判据，环里混了底色→偏暗（黑影）
                lo, hi = prm["warm"]
                warm = np.clip((a[:, :, 0] - a[:, :, 2]) - (B[:, :, 0] - B[:, :, 2]), 0, None)
                d = np.sqrt(((a - B) ** 2).sum(2))
                old_al = np.maximum(np.clip((warm - 15) / 20, 0, 1), np.clip((d - 50) / 40, 0, 1))
                ob = (old_al > 0.15) & (old_al < 0.85)
                nb = (al > 0.15) & (al < 0.85)
                print(f"    半透明环均亮：旧(带 dist) {a.mean(2)[ob].mean():.1f} → 新(仅暖色) "
                      f"{rgb.mean(2)[nb].mean():.1f}   环像素 {ob.sum()} → {nb.sum()}")
            frames.append(premul_resize(rgb, al, OUT_W))
        frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / FPS),
                       loop=0, quality=QUALITY, method=6, format="WEBP")
        size = os.path.getsize(out) / 1024
        cov = np.array([np.asarray(f)[:, :, 3].mean() / 255 for f in frames])
        print(f"    帧数 {len(frames)}  {frames[0].size}  {size:.0f}KB  "
              f"alpha 均值 {cov.min()*100:.1f}%~{cov.max()*100:.1f}%")


if __name__ == "__main__":
    main()
