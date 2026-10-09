# -*- coding: utf-8 -*-
"""给 fontTools 装一个 brotli 垫片，用 Node 内置的 zlib 实现。

读 woff2 需要 brotli 扩展，而 `pip install brotli` 在部分环境里装不上（本机就是：pip 能下载
但没权限写 site-packages）。Node 自带 brotli，而 fontTools 对 brotli 的依赖只有两处
—— `brotli.decompress(data)` 与 `brotli.compress(data, mode=…)`（见 fontTools/ttLib/woff2.py）
——所以垫一层即可。

最初只实现了 decompress（读 Google Fonts 的切片、给 SVG 描边用）。生成**网页字体**
（public/fonts/*.woff2，见 build-webfont.py）需要写出 woff2，于是补上 compress。

compress 走 Node 的 `zlib.brotliCompressSync`。mode 必须映射到 Node 的 constants：
fontTools 传的是 brotli.MODE_FONT，真实 brotli 模块里 MODE_GENERIC=0 / MODE_TEXT=1 /
MODE_FONT=2；Node 的 BROTLI_MODE_* 取值一致。**这里早期写错过**（把 MODE_FONT 当成 0），
所以下面不再硬编码，而是直接从 Node 的 constants 读回来，避免又对不上。

用法：在 import fontTools 之前 `import nodebrotli`。
"""
import json
import shutil
import subprocess
import sys
import types

_DECOMPRESS_JS = ("const z=require('zlib'),c=[];"
                  "process.stdin.on('data',d=>c.push(d));"
                  "process.stdin.on('end',()=>process.stdout.write(z.brotliDecompressSync(Buffer.concat(c))));")

# 传 mode 与 quality；quality 11 是 brotli 最高档，woff2 字体本来就该按最高档压
# （体积换一次构建时间，收益是长期传输量）。
_COMPRESS_JS = ("const z=require('zlib'),c=[];"
                "const mode=parseInt(process.argv[1],10),q=parseInt(process.argv[2],10);"
                "process.stdin.on('data',d=>c.push(d));"
                "process.stdin.on('end',()=>process.stdout.write("
                "z.brotliCompressSync(Buffer.concat(c),{params:{"
                "[z.constants.BROTLI_PARAM_QUALITY]:q,"
                "[z.constants.BROTLI_PARAM_MODE]:mode}})));")

# 从 Node 读回常量，杜绝再出现「垫片里的 MODE_FONT 与真实 brotli 不一致」。
_CONSTS_JS = ("const z=require('zlib').constants;"
              "process.stdout.write(JSON.stringify({"
              "generic:z.BROTLI_MODE_GENERIC,text:z.BROTLI_MODE_TEXT,font:z.BROTLI_MODE_FONT}))")


def _node():
    node = shutil.which("node")
    if not node:
        raise RuntimeError("需要 node 才能读写 woff2；或改跑 `python3 brand/tools/fetch-fonts.py` 用完整 TTF")
    return node


def _node_constants():
    out = subprocess.run([_node(), "-e", _CONSTS_JS], stdout=subprocess.PIPE, check=True).stdout
    return json.loads(out)


_C = _node_constants()

# 真实 brotli 模块的取值（供 install() 暴露给 fontTools）
MODE_GENERIC = _C["generic"]
MODE_TEXT = _C["text"]
MODE_FONT = _C["font"]


def decompress(data, **kwargs):
    proc = subprocess.run([_node(), "-e", _DECOMPRESS_JS], input=data,
                          stdout=subprocess.PIPE, check=True)
    return proc.stdout


def compress(data, mode=MODE_GENERIC, quality=11, **kwargs):
    """按 mode 压缩。fontTools 只在写 woff2 时调用，传 mode=MODE_FONT。"""
    proc = subprocess.run([_node(), "-e", _COMPRESS_JS, str(mode), str(quality)],
                          input=data, stdout=subprocess.PIPE, check=True)
    return proc.stdout


def install():
    """把垫片注册成 brotli 模块，只在真的缺 brotli 时生效。"""
    if "brotli" in sys.modules:
        return False
    try:
        import brotli                                    # noqa: F401
        return False
    except ImportError:
        pass
    mod = types.ModuleType("brotli")
    mod.decompress = decompress
    mod.compress = compress
    mod.MODE_GENERIC = MODE_GENERIC
    mod.MODE_TEXT = MODE_TEXT
    mod.MODE_FONT = MODE_FONT
    mod.__doc__ = "node-brotli shim (see brand/tools/nodebrotli.py)"
    sys.modules["brotli"] = mod
    return True


INSTALLED = install()
