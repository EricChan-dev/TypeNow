import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sentences } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin-auth"
import { eq } from "drizzle-orm"

/**
 * 保存课时内的句子顺序。
 *
 * ⚠️ 这个接口**只接受完整的课时句子列表**，并且现在会强制校验。
 *
 * 为什么：sortOrder 是按**数组下标**赋的（`index`），所以这个接口的语义是
 * "用给你的这个顺序整体重写这一课的序号"。如果调用方只拿到了一部分句子
 * （前端按 pageSize 拉取、而接口把 pageSize 钳到 MAX_PAGE_SIZE=100），它会：
 *   - 给这 100 句写入 sortOrder 0..99；
 *   - 剩下的句子保留原来的 1..960；
 * 同一课里于是出现大量重复序号，课时顺序彻底乱掉 —— 而线上有 **753 个课时
 * 超过 100 句（合计 136,092 句，占全表 29%）**，最大的一课 960 句。
 * 更糟的是它由拖动触发、自动保存，属于"正常操作静默毁数据"。
 *
 * 所以这里做集合校验：请求里的 id 集合必须与该课时实际的 id 集合完全一致。
 * 宁可返回 400 让前端的问题暴露出来，也不要用半份数据重写顺序。
 * （前端已同步改为分页拉全，见课时详情页的 fetchAllSentences。）
 *
 * 写入放进事务：960 条 update 中途失败时不会留下"改了一半"的顺序。
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
  const database = db

  const { id: lessonId } = await params
  const body = await request.json().catch(() => ({}))
  const { orderedIds } = body as { orderedIds?: unknown }

  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "orderedIds 必须是字符串数组" }, { status: 400 })
  }
  const ids = orderedIds as string[]

  // 重复 id 会让下面的集合比较失真，先单独拦掉
  const payload = new Set(ids)
  if (payload.size !== ids.length) {
    return NextResponse.json({ error: "orderedIds 中存在重复的句子 id" }, { status: 400 })
  }

  const rows = await database
    .select({ id: sentences.id })
    .from(sentences)
    .where(eq(sentences.lessonId, lessonId))
  const actual = new Set(rows.map((r) => r.id))

  if (actual.size !== payload.size) {
    return NextResponse.json(
      {
        error:
          `顺序未保存：请求包含 ${payload.size} 句，但该课时实际有 ${actual.size} 句。` +
          `为避免把课时顺序写乱，只接受完整的句子列表。`,
        code: "incomplete_payload",
        expected: actual.size,
        received: payload.size,
      },
      { status: 400 },
    )
  }
  for (const id of actual) {
    if (!payload.has(id)) {
      return NextResponse.json(
        {
          error:
            `顺序未保存：请求里缺少该课时的句子 ${id}。` +
            `为避免把课时顺序写乱，只接受完整的句子列表。`,
          code: "incomplete_payload",
        },
        { status: 400 },
      )
    }
  }

  await database.transaction(async (tx) => {
    for (let index = 0; index < ids.length; index++) {
      await tx.update(sentences).set({ sortOrder: index }).where(eq(sentences.id, ids[index]))
    }
  })

  return NextResponse.json({ data: { lessonId, count: ids.length } })
}
