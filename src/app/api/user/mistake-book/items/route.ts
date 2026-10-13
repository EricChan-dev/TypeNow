import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getSession } from "@/app/actions/auth"
import { parsePagination } from "@/lib/pagination"
import {
  MAX_SEARCH_LENGTH,
  mistakeBookCount,
  mistakeBookInner,
  mistakeBookPage,
  parseMistakeSource,
  type MistakeBookRow,
  type MistakeSource,
} from "@/lib/mistake-book"

/**
 * 错题本统一列表：错题 + 收藏句子 + 收藏单词按统一时间序混排、统一分页
 * （参考站 GetMistakeList 是一张列表，sourceType 只是过滤器）。
 *
 * 分页参数收敛走 parsePagination（NaN 会变成 LIMIT NULL 绕过上限，见该模块注释）。
 * drizzle 0.45 的 mysql2 db.execute 返回原始二元组 [rows, fields]，解构一层拿 rows
 * （src/app/api/lessons/[id]/insight/route.ts:55 有实测记录）。
 */

/** 单条记录的 kind（列表行级别；"all" 只是查询时的过滤器取值）。 */
export type MistakeItemKind = Exclude<MistakeSource, "all">

/** 客户端消费的行形态：ts 转成 ISO 字符串，数值列 Number() 归一。 */
export interface MistakeBookItem {
  kind: MistakeItemKind
  key: string
  ts: string | null
  english: string
  chinese: string | null
  word: string | null
  courseTitle: string | null
  lessonTitle: string | null
  courseId: string | null
  lessonId: string | null
  userWrong: string | null
  reviewCount: number
}

function toItem(r: MistakeBookRow): MistakeBookItem {
  const ts = r.ts ? new Date(r.ts) : null
  return {
    kind: r.kind,
    key: r.item_key,
    ts: ts && !Number.isNaN(ts.getTime()) ? ts.toISOString() : null,
    english: r.english ?? "",
    chinese: r.chinese,
    word: r.word,
    courseTitle: r.courseTitle,
    lessonTitle: r.lessonTitle,
    courseId: r.courseId,
    lessonId: r.lessonId,
    userWrong: r.userWrong,
    reviewCount: Number(r.reviewCount ?? 0),
  }
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const source = parseMistakeSource(searchParams.get("sourceType"))
  const courseId = searchParams.get("courseId") || null
  const lessonId = searchParams.get("lessonId") || null
  // 参考站搜索框收首尾空格；超长直接截断（脏输入不该打到 LIKE 上）。
  const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH) || null
  const { page, pageSize, offset } = parsePagination(searchParams, 20)

  const inner = mistakeBookInner(source, {
    userId: session.userId,
    courseId,
    lessonId,
    q,
  })

  const [rowsRes, countRes] = await Promise.all([
    db.execute(mistakeBookPage(inner, pageSize, offset)),
    db.execute(mistakeBookCount(inner)),
  ])
  const rows = (rowsRes as unknown as [MistakeBookRow[]])[0] ?? []
  const total = Number((countRes as unknown as [Array<{ total?: number }>])[0]?.[0]?.total ?? 0)

  return NextResponse.json({
    items: rows.map(toItem),
    total,
    page,
    pageSize,
  })
}

/**
 * 单条删除（参考站 DeleteMistake / RemoveFavorite；单词走收藏接口的 DELETE）。
 *
 * key 的含义随 kind 而变 —— 这是聚合列表的代价，必须在这里收敛成一张对照表：
 *   · mistake  → review_queue.sentence_id（原句级，UNIQUE(user_id, sentence_id)）
 *   · sentence → sentence_favorites.id（收藏行主键；练习项级快照行）
 *   · word     → wordbook_items.word（UNIQUE(user_id, word)）
 * 全部幂等：重复删除按成功返回（参考站 RemoveFavorite 重复调用也不报错）。
 * 删除错题只摘 review_queue 行，practice_records 历史保留（练过就是练过）。
 */
export async function DELETE(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const kind = parseMistakeSource(searchParams.get("kind"))
  const key = (searchParams.get("key") ?? "").trim()
  if (kind === "all" || key.length === 0 || key.length > 128) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }

  if (kind === "mistake") {
    await db.execute(sql`
      DELETE FROM review_queue WHERE user_id = ${session.userId} AND sentence_id = ${key}
    `)
  } else if (kind === "sentence") {
    await db.execute(sql`
      DELETE FROM sentence_favorites WHERE user_id = ${session.userId} AND id = ${key}
    `)
  } else {
    await db.execute(sql`
      DELETE FROM wordbook_items WHERE user_id = ${session.userId} AND word = ${key}
    `)
  }

  return NextResponse.json({ success: true })
}
