import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sql, type SQL } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"
import { parseMistakeSource, type MistakeSource } from "@/lib/mistake-book"

/**
 * 批量删除。
 *
 * 聚合列表的复选框勾的是三类混合行，所以请求体是 [{kind, key}] 的异构列表，
 * 服务端按 kind 分派到对应的表。全部在一个事务里执行：要么全删要么全不删，
 * 避免「删了一半失败」之后列表与计数对不上。
 */

/** 单条记录的 kind（"all" 只是查询过滤器的取值，批量删除里非法）。 */
type BatchKind = Exclude<MistakeSource, "all">

interface BatchItem {
  kind: BatchKind
  key: string
}

/** 单批上限：前端全选后可一次性提交大量行，这里给个防滥用的硬闸。 */
const MAX_BATCH = 200

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }

  const rawItems = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }
  if (rawItems.length > MAX_BATCH) {
    return NextResponse.json({ error: "Too many items" }, { status: 400 })
  }

  const items: BatchItem[] = []
  for (const raw of rawItems) {
    const kind = parseMistakeSource((raw as { kind?: unknown } | null)?.kind as string | null)
    const key = String((raw as { key?: unknown } | null)?.key ?? "").trim()
    if (kind === "all" || key.length === 0 || key.length > 128) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 })
    }
    items.push({ kind, key })
  }

  // 按 kind 分组，同表合并成一条 IN 删除，减少事务里的语句数。
  const byKind: Record<"mistake" | "sentence" | "word", string[]> = {
    mistake: [],
    sentence: [],
    word: [],
  }
  for (const { kind, key } of items) byKind[kind].push(key)

  const deleted = await db.transaction(async (tx) => {
    let n = 0
    for (const kind of ["mistake", "sentence", "word"] as const) {
      const keys = byKind[kind]
      if (keys.length === 0) continue
      const keyColumn =
        kind === "mistake" ? "sentence_id" : kind === "sentence" ? "id" : "word"
      const table = kind === "mistake" ? "review_queue" : kind === "sentence" ? "sentence_favorites" : "wordbook_items"
      const placeholders = sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )
      const where: SQL = sql`user_id = ${session.userId} AND ${sql.raw(keyColumn)} IN (${placeholders})`
      const [result] = (await tx.execute(
        sql`DELETE FROM ${sql.raw(table)} WHERE ${where}`,
      )) as unknown as [{ affectedRows?: number }]
      n += result?.affectedRows ?? 0
    }
    return n
  })

  return NextResponse.json({ success: true, deleted })
}
