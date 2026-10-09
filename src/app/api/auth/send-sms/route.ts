import { NextResponse } from "next/server"
import crypto from "crypto"
import { db } from "@/lib/db"
import { verificationCodes } from "@/lib/db/schema"
import { eq, and, gte, lt, count } from "drizzle-orm"
import { sendVerificationCode } from "@/lib/aliyun-sms"
import { getClientIP } from "@/lib/rate-limit"
import { isCaptchaConfigured, verifyCaptcha } from "@/lib/aliyun-captcha"

const PHONE_REGEX = /^1[3-9]\d{9}$/

function isDevMode() {
  return process.env.NODE_ENV === "development" && !process.env.DATABASE_URL
}

export async function POST(request: Request) {
  let body: { phone?: string; captchaVerifyParam?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const phone = body.phone?.trim()
  if (!phone || !PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: "请输入有效的手机号" }, { status: 400 })
  }

  // ── 人机校验（阿里云验证码 2.0）─────────────────────────────────────────────
  // 放在手机号校验之后、限流之前：参数不合法就不必再查库。
  // 未配置环境变量时 (isCaptchaConfigured() === false) 整段跳过，
  // 本地开发与尚未开通验证码的环境不受影响。
  if (isCaptchaConfigured()) {
    const captchaVerifyParam =
      typeof body.captchaVerifyParam === "string" ? body.captchaVerifyParam : ""

    // 缺参必须**拒**，这是刻意的 fail-closed：
    // 官方 FAQ Q17 说明验证码脚本初始化失败时仍会触发 captchaVerifyCallback，
    // 调用时参数为空。若这里放行，攻击者只要屏蔽验证码 CDN (o.alicdn.com)
    // 就能完全绕过人机校验，把这条防线变成摆设。
    if (!captchaVerifyParam.trim()) {
      return NextResponse.json(
        { error: "人机验证无效，请刷新页面后重试", captchaFailed: true },
        { status: 400 }
      )
    }

    const verdict = await verifyCaptcha(captchaVerifyParam)
    if (verdict.result === "fail") {
      // captchaFailed 让前端区分「人机验证没过」与「短信发送失败」：
      // 前者要把 captchaResult 回传成 false，让验证码控件刷新、用户重试；
      // 后者是人机已通过、业务失败，不能刷新验证码把用户赶回去重拖一次。
      return NextResponse.json(
        { error: "人机验证未通过，请重试", captchaFailed: true },
        { status: 400 }
      )
    }
    // verdict.result === "unavailable" → 阿里云侧异常/未配好 → **放行**。
    // 官方口径：验证码是安全增强手段，不应成为业务可用性的单点故障。
    // verifyCaptcha 内部已 console.error 留痕，这里不再重复。
  }

  // Dev mode (no DB): use fixed code 123456
  if (isDevMode() || !db) {
    return NextResponse.json({ success: true, message: "验证码已发送（开发模式：输入 123456）" })
  }

  // 必须用共享的 getClientIP：它优先取 nginx 覆盖写入的 X-Real-IP。
  // 原先取 X-Forwarded-For 的最左值，而该段由客户端自带、可任意伪造，
  // 导致「IP 3 次/分钟」的限流形同虚设，短信可被批量刷取。
  const ip = getClientIP(request).slice(0, 50)
  const now = Date.now()
  const minus1min = new Date(now - 60 * 1000)
  const minus1hr = new Date(now - 60 * 60 * 1000)
  const minus24hr = new Date(now - 24 * 60 * 60 * 1000)

  // IP: max 3 per minute
  const [{ ipCount }] = await db
    .select({ ipCount: count() })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.ip, ip), gte(verificationCodes.createdAt, minus1min)))
  if (ipCount >= 3) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 })
  }

  // Phone: max 5 per hour
  const [{ ph1h }] = await db
    .select({ ph1h: count() })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.phone, phone), gte(verificationCodes.createdAt, minus1hr)))
  if (ph1h >= 5) {
    return NextResponse.json({ error: "发送次数超限，请1小时后再试" }, { status: 429 })
  }

  // Phone: max 10 per 24h
  const [{ ph24h }] = await db
    .select({ ph24h: count() })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.phone, phone), gte(verificationCodes.createdAt, minus24hr)))
  if (ph24h >= 10) {
    return NextResponse.json({ error: "今日发送次数已达上限，请明天再试" }, { status: 429 })
  }

  // Phone: 60s cooldown
  const [recent] = await db
    .select({ createdAt: verificationCodes.createdAt })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.phone, phone), gte(verificationCodes.createdAt, minus1min)))
    .orderBy(verificationCodes.createdAt)
    .limit(1)

  if (recent) {
    const elapsed = Math.floor((now - recent.createdAt.getTime()) / 1000)
    const remaining = 60 - elapsed
    return NextResponse.json(
      { error: `发送过于频繁，请${remaining}秒后再试`, cooldown: remaining },
      { status: 429 }
    )
  }

  const code = crypto.randomInt(100000, 999999).toString()

  if (!process.env.ALIYUN_ACCESS_KEY_ID || !process.env.ALIYUN_ACCESS_KEY_SECRET) {
    return NextResponse.json({ error: "短信服务未配置" }, { status: 500 })
  }

  const result = await sendVerificationCode(phone, code)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "短信发送失败，请稍后重试" },
      { status: 500 }
    )
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
  await db.insert(verificationCodes).values({ phone, code, ip, expiresAt })

  // 清理该手机号已过期的验证码（fire-and-forget）。
  // 原条件 gt(expiresAt, new Date(0)) 恒为真（new Date(0) 是 1970 年），
  // 实际会删除该手机号的全部验证码，包括上面刚插入的那条有效码，
  // 使 verify-code 永远查不到记录 —— 短信登录因此彻底失效。
  // 正确语义是「已过期」：expiresAt < now。
  void db
    .delete(verificationCodes)
    .where(
      and(
        eq(verificationCodes.phone, phone),
        lt(verificationCodes.expiresAt, new Date())
      )
    )
    .catch(() => {})

  return NextResponse.json({ success: true, message: "验证码已发送" })
}
