import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"

const MAX_SIZE = 1 * 1024 * 1024 // 1MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  /**
   * 先看 Content-Length 再读 body。
   *
   * 原来只在一个 `await request.formData()` **之后**才检查 file.size ——
   * 而 formData() 会把整个 multipart 体读进内存，那时限制已经晚了：
   * 一个 500MB 的"图片"足以把这台 3.6GB 内存的机器打挂。
   *
   * 注意这里**不能**只看这个头就当校验通过：chunked 编码下没有 Content-Length，
   * 而且客户端可以谎报。所以它是"提前拒绝"的快速闸门，下面解析完的真实
   * file.size 检查仍然保留 —— 两道缺一不可。
   */
  const declared = Number(request.headers.get("content-length") ?? "")
  // multipart 除文件本身还有边界与表单字段，留 64KB 余量
  if (Number.isFinite(declared) && declared > MAX_SIZE + 64 * 1024) {
    return NextResponse.json(
      { error: `图片不能超过 ${Math.floor(MAX_SIZE / 1024 / 1024)}MB（请求体过大，已提前拒绝）` },
      { status: 413 },
    )
  }

  const formData = await request.formData()
  const file = formData.get("file") as File | null

  if (!file) return NextResponse.json({ error: "未提供文件" }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "仅支持 JPEG/PNG/WebP/GIF 格式" }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "图片不能超过 1MB" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const base64 = buffer.toString("base64")
  const dataUrl = `data:${file.type};base64,${base64}`

  return NextResponse.json({ dataUrl })
}
