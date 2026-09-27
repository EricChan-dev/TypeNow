import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { materialImports } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { logAdminAction } from "@/lib/admin-audit"
import { eq } from "drizzle-orm"

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  // 先看 Content-Length 再读 body：formData() 会把整个请求体读进内存，
  // 在它之后再检查 file.size 已经晚了（见 upload/image 的同类注释）。
  // 头部缺失（chunked）或谎报时下面的真实大小检查仍然兜底。
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > MAX_FILE_SIZE + 64 * 1024) {
    return NextResponse.json(
      { error: `文件大小不能超过 ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)}MB（请求体过大，已提前拒绝）` },
      { status: 413 },
    )
  }

  const formData = await request.formData()
  const file = formData.get("file") as File | null
  const lessonId = formData.get("lesson_id") as string | null

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "文件大小不能超过 10MB" }, { status: 400 })
  }

  const filename = file.name
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext !== "pdf" && ext !== "txt") {
    return NextResponse.json({ error: "Only PDF and TXT files are supported" }, { status: 400 })
  }

  const fileType = ext as "pdf" | "txt"
  let rawText = ""

  if (fileType === "txt") {
    rawText = await file.text()
  } else {
    const buffer = Buffer.from(await file.arrayBuffer())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParseMod = (await import("pdf-parse")) as any
    const pdfParse = pdfParseMod.default ?? pdfParseMod
    const parsed = await pdfParse(buffer)
    rawText = parsed.text
  }

  const id = randomUUID()
  await db.insert(materialImports).values({
    id,
    lessonId: lessonId ?? undefined,
    filename,
    fileType,
    rawText,
    status: "pending",
    createdBy: auth.userId,
  })

  const [row] = await db.select().from(materialImports).where(eq(materialImports.id, id)).limit(1)
  // 上传的教材正文（rawText）**不进日志**：它可能是整本教材，几十上百 KB，
  // 记进去既撑爆日志又没有意义。审计只需要"谁在什么时候传了什么文件"。
  await logAdminAction(auth, {
    action: "upload",
    targetType: "material",
    targetId: id,
    targetLabel: filename,
    detail: { filename, fileType, lessonId: lessonId ?? null, charCount: rawText.length },
  }, request)
  return NextResponse.json({ data: row }, { status: 201 })
}
