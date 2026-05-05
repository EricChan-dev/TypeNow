import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { sendVerificationCode } from "@/lib/aliyun-sms"

const PHONE_REGEX = /^1[3-9]\d{9}$/

function isDevMode() {
  return (
    process.env.NODE_ENV === "development" &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")
  )
}

export async function POST(request: Request) {
  let body: { phone?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const phone = body.phone?.trim()

  if (!phone || !PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: "请输入有效的手机号" }, { status: 400 })
  }

  // Dev mode: skip real SMS, just store a dev code
  if (isDevMode()) {
    const supabase = createServiceClient()
    if (supabase) {
      await supabase.from("verification_codes").insert({
        phone,
        code: "123456",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
    }
    return NextResponse.json({ success: true, message: "验证码已发送（开发模式：输入 123456）" })
  }

  // Rate limiting: check if code was sent to this phone in the last 60 seconds
  const supabase = createServiceClient()
  if (supabase) {
    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString()
    const { data: recent } = await supabase
      .from("verification_codes")
      .select("created_at")
      .eq("phone", phone)
      .gte("created_at", sixtySecondsAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recent) {
      const elapsed = Math.floor(
        (Date.now() - new Date(recent.created_at).getTime()) / 1000
      )
      const remaining = 60 - elapsed
      return NextResponse.json(
        { error: `发送过于频繁，请${remaining}秒后再试`, cooldown: remaining },
        { status: 429 }
      )
    }
  }

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString()

  // Check Aliyun credentials
  if (!process.env.ALIYUN_ACCESS_KEY_ID || !process.env.ALIYUN_ACCESS_KEY_SECRET) {
    return NextResponse.json({ error: "短信服务未配置" }, { status: 500 })
  }

  // Send SMS via Aliyun
  const result = await sendVerificationCode(phone, code)

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "短信发送失败，请稍后重试" },
      { status: 500 }
    )
  }

  // Store code in database
  if (supabase) {
    await supabase.from("verification_codes").insert({
      phone,
      code,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })

    // Clean up old expired codes for this phone
    await supabase
      .from("verification_codes")
      .delete()
      .eq("phone", phone)
      .eq("used", false)
      .lt("expires_at", new Date().toISOString())
  }

  return NextResponse.json({ success: true, message: "验证码已发送" })
}
