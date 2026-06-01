import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { userFeedback, users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { getOAGlobalAccessToken } from "@/lib/wechat"

const CATEGORY_LABELS: Record<string, string> = {
  bug: "🐛 Bug 反馈",
  feature: "✨ 功能建议",
  suggestion: "💡 使用建议",
  other: "📝 其他",
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const { category, content } = await request.json()
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "请填写反馈内容" }, { status: 400 })
  }
  if (content.length > 500) {
    return NextResponse.json({ error: "内容不能超过 500 字" }, { status: 400 })
  }

  const validCategory = ["bug", "feature", "suggestion", "other"].includes(category)
    ? (category as "bug" | "feature" | "suggestion" | "other")
    : "other"

  await db.insert(userFeedback).values({
    userId: session.userId,
    category: validCategory,
    content: content.trim(),
  })

  const adminOpenid = process.env.WECHAT_FEEDBACK_ADMIN_OPENID
  if (adminOpenid) {
    try {
      const [userRow] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1)

      const token = await getOAGlobalAccessToken()
      const label = CATEGORY_LABELS[validCategory] ?? validCategory
      const msgContent = `${label}\n用户: ${userRow?.name ?? "未知"}\n\n${content.trim()}`

      await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            touser: adminOpenid,
            msgtype: "text",
            text: { content: msgContent },
          }),
        }
      )
    } catch (e) {
      console.error("[feedback] WeChat push failed:", e)
    }
  }

  return NextResponse.json({ success: true })
}
