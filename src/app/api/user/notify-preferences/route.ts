import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { getNotifyPreference, optInNotifications, optOutNotifications } from "@/lib/notify"

/**
 * 服务通知的退订开关。
 *
 * 隐私政策 §2.1 与用户协议 §9 都承诺了「可以随时在设置中关闭服务通知」——
 * 这个接口就是那条承诺的实现。**删掉它会让那两句变成虚假陈述**，
 * 所以它不是一个可选功能。
 *
 * 只允许操作**自己**的开关：userId 一律取自会话，从不接受请求体里的 userId。
 * 一个「能改别人退订状态」的接口会同时是一个骚扰工具和一个合规漏洞。
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const pref = await getNotifyPreference(session.userId)
  return NextResponse.json({
    opted_out: pref.optedOut,
    opted_out_at: pref.optedOutAt?.toISOString() ?? null,
  })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  let body: { opted_out?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  if (typeof body.opted_out !== "boolean") {
    return NextResponse.json({ error: "opted_out 必须是布尔值" }, { status: 400 })
  }

  if (body.opted_out) {
    await optOutNotifications(session.userId)
  } else {
    await optInNotifications(session.userId)
  }

  const pref = await getNotifyPreference(session.userId)
  return NextResponse.json({
    success: true,
    opted_out: pref.optedOut,
    opted_out_at: pref.optedOutAt?.toISOString() ?? null,
  })
}
