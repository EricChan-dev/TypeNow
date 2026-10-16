import { NextResponse } from "next/server"
import crypto from "crypto"
import { db } from "@/lib/db"
import { captchaChallenges, verificationCodes } from "@/lib/db/schema"
import { eq, and, gte, gt, lt, count } from "drizzle-orm"
import { sendVerificationCode } from "@/lib/aliyun-sms"
import { getClientIP } from "@/lib/rate-limit"
import { verifySliderAnswer } from "@/lib/slider-captcha"

const PHONE_REGEX = /^1[3-9]\d{9}$/

function isDevMode() {
  return process.env.NODE_ENV === "development" && !process.env.DATABASE_URL
}

export async function POST(request: Request) {
  let body: {
    phone?: string
    captcha?: { id?: unknown; x?: unknown; duration?: unknown; trail?: unknown }
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const phone = body.phone?.trim()
  if (!phone || !PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: "请输入有效的手机号" }, { status: 400 })
  }

  // Dev mode (no DB): use fixed code 123456
  if (isDevMode() || !db) {
    return NextResponse.json({ success: true, message: "验证码已发送（开发模式：输入 123456）" })
  }

  // ── 人机校验（自建滑块拼图）───────────────────────────────────────────────
  // 题目由 GET /api/auth/captcha 服务端现画（pngjs），缺口答案只存
  // captcha_challenges，不落客户端。这里先**原子认领**（used 0→1：一题一用、
  // 无论对错，防止对同一题枚举 x），再按 ±5px 容差判分。原阿里云方案对
  // "unavailable" 放行；自建方案没有外部依赖，一律 fail-closed：缺参 /
  // 认领失败（不存在、已用、已过期）/ 判分不过都拒。
  // captchaFailed 让前端区分「人机验证没过」（滑块要刷新重试）与「短信发送
  // 失败」（人机已通过，不能把用户赶回去重拖一次）。
  const captcha = body.captcha
  if (!captcha || typeof captcha.id !== "string" || !captcha.id) {
    return NextResponse.json(
      { error: "人机验证无效，请刷新后重试", captchaFailed: true },
      { status: 400 }
    )
  }

  const claim = await db
    .update(captchaChallenges)
    .set({ used: 1 })
    .where(
      and(
        eq(captchaChallenges.id, captcha.id),
        eq(captchaChallenges.used, 0),
        gt(captchaChallenges.expiresAt, new Date())
      )
    )
  if ((claim[0]?.affectedRows ?? 0) === 0) {
    return NextResponse.json(
      { error: "人机验证已失效，请刷新后重试", captchaFailed: true },
      { status: 400 }
    )
  }

  const [challenge] = await db
    .select({ answerX: captchaChallenges.answerX })
    .from(captchaChallenges)
    .where(eq(captchaChallenges.id, captcha.id))

  if (
    !challenge ||
    !verifySliderAnswer({
      expectedX: challenge.answerX,
      x: captcha.x,
      duration: captcha.duration,
      trail: captcha.trail,
    })
  ) {
    return NextResponse.json(
      { error: "人机验证未通过，请重试", captchaFailed: true },
      { status: 400 }
    )
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
