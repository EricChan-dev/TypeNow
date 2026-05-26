import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { materialImports } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const formData = await request.formData()
  const file = formData.get("file") as File | null
  const lessonId = formData.get("lesson_id") as string | null

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

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
  return NextResponse.json({ data: row }, { status: 201 })
}
