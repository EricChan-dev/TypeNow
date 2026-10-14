#!/usr/bin/env python3
"""从 brand/mimi/webp/mimi-ai-{1,2,3}.webp 导出网站用的轻量三态素材到 public/mimi/。

要点：
- 统一画布：三支视频取并集 bbox（含 6px padding）后统一裁剪，保证睡觉/互动/坐立
  三态切换时猫不会跳位。
- 预乘缩放：直通 alpha 直接 LANCZOS 会在半透明边缘产生暗边，先 premultiply 再缩放
  再 unpremultiply。
- 12fps：隔帧抽取（97→49 帧），duration=83ms；364px 宽足够 2x 视网膜显示。
- 静态降级：各态首帧出 PNG（prefers-reduced-motion 用 + 聊天面板头像）。
"""

import os
import sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = {
    "sleep": os.path.normpath(os.path.join(ROOT, "..", "webp", "mimi-ai-1.webp")),
    "awake": os.path.normpath(os.path.join(ROOT, "..", "webp", "mimi-ai-2.webp")),
    "sit": os.path.normpath(os.path.join(ROOT, "..", "webp", "mimi-ai-3.webp")),
}
OUT_DIR = os.path.normpath(os.path.join(ROOT, "..", "..", "..", "public", "mimi"))
OUT_W = 364          # 显示约 176-190 CSS px，留 2x 余量
FPS_DIV = 2          # 24fps → 12fps
QUALITY = 72
PAD = 6

# 统一画布 (x0, x1, y0, y1)：首次全量导出时由三态所有帧的并集算出（含 6px padding），
# 之后固定不变 —— 否则单独重导某一态会算出不同画布，三态切换时猫会跳位。
CROP = (35, 640, 0, 360)

# 结尾裁帧数（@24fps）：用户要求 (2)/awake 裁掉最后 0.5s = 12 帧（97 → 85 帧）
TRIM_TAIL = {"awake": 12}

# 循环规则（用户钦定）：动画一/三无限循环；动画二只播一次——播完定格在坐姿末帧，
# 由前端接上动画三循环（衔接：坐好 → 坐姿循环）
LOOP = {"sleep": 0, "awake": 1, "sit": 0}


def load_frames(path):
    im = Image.open(path)
    frames = []
    for k in range(im.n_frames):
        im.seek(k)
        frames.append(np.asarray(im.convert("RGBA")).copy())
    return frames


def frame_bbox(a, thr=8):
    op = a[:, :, 3] > thr
    rows = np.where(op.any(1))[0]
    cols = np.where(op.any(0))[0]
    return rows.min(), rows.max(), cols.min(), cols.max()


def premul_resize(a, w_out):
    h, w = a.shape[:2]
    h_out = int(round(h * w_out / w))
    f = a.astype(np.float32)
    al = f[:, :, 3:4] / 255.0
    pm = np.dstack([f[:, :, :3] * al, f[:, :, 3]])
    im = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8)).resize((w_out, h_out), Image.LANCZOS)
    o = np.asarray(im).astype(np.float32)
    a2 = o[:, :, 3:4] / 255.0
    rgb = np.clip(o[:, :, :3] / np.maximum(a2, 1e-3), 0, 255)
    return np.dstack([rgb, o[:, :, 3]]).astype(np.uint8)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    only = set(sys.argv[1:]) or None
    data = {}
    for name, p in SRC.items():
        if only is not None and name not in only:
            continue
        fr = load_frames(p)
        cut = TRIM_TAIL.get(name)
        if cut:
            fr = fr[: len(fr) - cut]
            print(f"  {name}: 裁掉结尾 {cut} 帧（0.5s）→ {len(fr)} 帧")
        data[name] = fr

    x0, x1, y0, y1 = CROP
    print(f"统一画布 crop x[{x0}:{x1}] y[{y0}:{y1}]  → {x1-x0}x{y1-y0}")

    for name, frames in data.items():
        cropped = [a[y0:y1, x0:x1] for a in frames]
        small = [premul_resize(a, OUT_W) for a in cropped]
        keep = small[::FPS_DIV]
        dur = int(round(1000 * FPS_DIV / 24))
        out_webp = os.path.join(OUT_DIR, f"mimi-{name}.webp")
        Image.fromarray(keep[0]).save(
            out_webp, save_all=True, append_images=[Image.fromarray(f) for f in keep[1:]],
            duration=dur, loop=LOOP[name], quality=QUALITY, method=6, format="WEBP")
        out_png = os.path.join(OUT_DIR, f"mimi-{name}-static.png")
        Image.fromarray(small[0]).save(out_png, optimize=True)
        kb = lambda p: os.path.getsize(p) / 1024
        print(f"  mimi-{name}: {len(keep)} 帧 {keep[0].shape[1]}x{keep[0].shape[0]}  "
              f"webp {kb(out_webp):.0f}KB  png {kb(out_png):.0f}KB")


if __name__ == "__main__":
    main()
