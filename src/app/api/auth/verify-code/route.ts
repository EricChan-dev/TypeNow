import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

const PHONE_REGEX = /^1[3-9]\d{9}$/

function isDevMode() {
  return (
    process.env.NODE_ENV === "development" &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")
  )
}

export async function POST(request: Request) {
  let body: { phone?: string; code?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const phone = body.phone?.trim()
  const code = body.code?.trim()

  if (!phone || !PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: "请输入有效的手机号" }, { status: 400 })
  }

  if (!code || code.length !== 6) {
    return NextResponse.json({ error: "请输入6位验证码" }, { status: 400 })
  }

  const supabaseAdmin = createServiceClient()

  // Dev mode: accept 123456
  if (isDevMode()) {
    if (code === "123456") {
      // If Supabase is not configured at all, just return success
      if (!supabaseAdmin) {
        return NextResponse.json({ success: true })
      }

      // Try to create a real session in dev mode if Supabase is configured
      return await createSession(phone!, supabaseAdmin)
    }
    return NextResponse.json({ error: "验证码错误（开发模式请输入 123456）" }, { status: 400 })
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: "服务配置错误" }, { status: 500 })
  }

  // Verify code from database
  const { data: record } = await supabaseAdmin
    .from("verification_codes")
    .select("*")
    .eq("phone", phone!)
    .eq("code", code!)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!record) {
    return NextResponse.json({ error: "验证码错误或已过期" }, { status: 400 })
  }

  // Mark code as used
  await supabaseAdmin
    .from("verification_codes")
    .update({ used: true })
    .eq("id", record.id)

  return await createSession(phone!, supabaseAdmin)
}

async function createSession(
  phone: string,
  supabaseAdmin: ReturnType<typeof createServiceClient>
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "服务配置错误" }, { status: 500 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const email = `phone_${phone}@typenow.local`
  const password = crypto.randomUUID()

  try {
    // Check if user exists by phone in profiles table
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, phone")
      .eq("phone", phone)
      .maybeSingle()

    if (profile) {
      // Existing user: update password
      await supabaseAdmin.auth.admin.updateUserById(profile.id, { password })
    } else {
      // New user: create with synthetic email + phone
      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        phone: `+86${phone}`,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { phone },
      })

      if (createError) {
        // If race condition, try signing in anyway (user might have been created)
        if (createError.code !== "duplicate") {
          return NextResponse.json(
            { error: createError.message || "用户创建失败" },
            { status: 500 }
          )
        }
      }
    }

    // Sign in to create session
    const cookieStore = await cookies()
    const supabaseSsr = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    })

    const { data: authData, error: authError } =
      await supabaseSsr.auth.signInWithPassword({ email, password })

    if (authError) {
      return NextResponse.json(
        { error: authError.message || "登录失败" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      user: { id: authData.user?.id, phone },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "登录失败" },
      { status: 500 }
    )
  }
}
