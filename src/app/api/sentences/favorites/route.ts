import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { sentenceFavorites } from "@/lib/db/schema"
import { and, desc, eq, inArray, sql } from "drizzle-orm"

/**
 * 收藏句子（听写页底栏的星标，快捷键 ⌘/Ctrl+U）。
 *
 * 与基准实现 `/User/Api/Favorite/Sentence` 的口径对齐：收藏的是**练习项**
 * （可能带 `_c<order>` 后缀），不是原句 —— 带 chunks 的句子在练习页会展开成
 * 多个分块练习项，各自可独立收藏（与 `pronunciation_scores` 一致）。
 *
 * 为什么不复用 `wordbook_items`：那是**单词**收藏的存储，一个词一行、
 * UNIQUE(user_id, word)，把句子塞进去会和单词本混在一起。基准实现自己也是
 * 两个独立接口。
 */

const MAX_SENTENCE_ID_LEN = 64

/** 单条收藏状态查询：`?sentenceId=` */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const sentenceId = request.nextUrl.searchParams.get("sentenceId")

  // 传了 sentenceId 就是「这一句收藏了吗」——练习页切句时每次都问一次，
  // 必须走唯一索引，不能把整个收藏夹拉回来。
  if (sentenceId) {
    const [row] = await db
      .select({ id: sentenceFavorites.id })
      .from(sentenceFavorites)
      .where(
        and(
          eq(sentenceFavorites.userId, session.userId),
          eq(sentenceFavorites.sentenceId, sentenceId),
        ),
      )
      .limit(1)
    return NextResponse.json({ favorited: !!row })
  }

  // 否则是收藏夹列表
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? "1"))
  const size = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("size") ?? "50")))
  const offset = (page - 1) * size

  const items = await db
    .select()
    .from(sentenceFavorites)
    .where(eq(sentenceFavorites.userId, session.userId))
    .orderBy(desc(sentenceFavorites.createdAt))
    .limit(size)
    .offset(offset)

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(sentenceFavorites)
    .where(eq(sentenceFavorites.userId, session.userId))

  return NextResponse.json({ items, total: Number(total ?? 0), page, size })
}

/**
 * 批量查询若干句的收藏状态（收藏夹列表页一次渲染多句时用）。
 * `?sentenceIds=a,b,c`
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const raw = request.nextUrl.searchParams.get("sentenceIds") ?? ""
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_SENTENCE_ID_LEN)
    .slice(0, 200)
  if (ids.length === 0) return NextResponse.json({ favorited: [] })

  const rows = await db
    .select({ sentenceId: sentenceFavorites.sentenceId })
    .from(sentenceFavorites)
    .where(
      and(
        eq(sentenceFavorites.userId, session.userId),
        inArray(sentenceFavorites.sentenceId, ids),
      ),
    )
  return NextResponse.json({ favorited: rows.map((r) => r.sentenceId) })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const body = (await request.json().catch(() => ({}))) as {
    sentenceId?: string
    courseId?: string
    lessonId?: string
    sentenceText?: string
  }
  const sentenceId = (body.sentenceId ?? "").trim()
  if (!sentenceId || sentenceId.length > MAX_SENTENCE_ID_LEN) {
    return NextResponse.json({ error: "invalid_sentence_id" }, { status: 400 })
  }

  // 重复收藏不是错误：用户可能连点或两个标签页同时操作，unique 索引保证不会
  // 出现两行。用 onDuplicateKeyUpdate 让这条路径天然幂等（而非抛 500）。
  await db
    .insert(sentenceFavorites)
    .values({
      userId: session.userId,
      sentenceId,
      courseId: body.courseId ?? null,
      lessonId: body.lessonId ?? null,
      sentenceText: body.sentenceText ?? null,
    })
    .onDuplicateKeyUpdate({ set: { sentenceText: body.sentenceText ?? null } })

  return NextResponse.json({ ok: true, favorited: true, sentenceId })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const sentenceId = (request.nextUrl.searchParams.get("sentenceId") ?? "").trim()
  if (!sentenceId || sentenceId.length > MAX_SENTENCE_ID_LEN) {
    return NextResponse.json({ error: "invalid_sentence_id" }, { status: 400 })
  }

  await db
    .delete(sentenceFavorites)
    .where(
      and(
        eq(sentenceFavorites.userId, session.userId),
        eq(sentenceFavorites.sentenceId, sentenceId),
      ),
    )

  // 取消一个本来就没收藏的句子同样返回成功：DELETE 是幂等的，客户端只关心
  // 最终状态是「未收藏」。
  return NextResponse.json({ ok: true, favorited: false, sentenceId })
}
