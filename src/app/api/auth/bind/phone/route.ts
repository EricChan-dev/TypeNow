import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { practiceRecords, sessions, users, verificationCodes } from "@/lib/db/schema"
import { eq, and, gt, count as sqlCount } from "drizzle-orm"
import { createSession, getSession } from "@/lib/auth/session"
import { getUserByPhone } from "@/lib/auth/user"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"
import { decideBindCollision } from "@/lib/phone-gate"
import { anonymizedProfile } from "@/lib/account-deletion"

const PHONE_REGEX = /^1[3-9]\d{9}$/

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 500 })
  }

  // Must be logged in
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }

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

  // 防验证码枚举：IP（10次/分钟）+ 手机号（5次/5分钟）双维度限流。
  // 手机号维度是关键——否则单个 IP 可对同一号码高速试 6 位码（10^6 空间）。
  // 阈值与 verify-code 保持一致（5次/5分钟），一个有效验证码一次即可通过，不影响正常用户。
  const ip = getClientIP(request)
  const ipLimit = checkRateLimit("bind-phone-ip", ip, 10, 60_000)
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: `尝试次数过多，请${ipLimit.retryAfter}秒后重试` }, { status: 429 })
  }
  const phoneLimit = checkRateLimit("bind-phone-phone", phone, 5, 300_000)
  if (!phoneLimit.allowed) {
    return NextResponse.json({ error: `该号码尝试次数过多，请${phoneLimit.retryAfter}秒后重试` }, { status: 429 })
  }

  // Verify SMS code
  const [record] = await db
    .select()
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.phone, phone),
        eq(verificationCodes.code, code),
        eq(verificationCodes.used, 0),
        gt(verificationCodes.expiresAt, new Date())
      )
    )
    .orderBy(verificationCodes.createdAt)
    .limit(1)

  if (!record) {
    return NextResponse.json({ error: "验证码错误或已过期" }, { status: 400 })
  }

  // 撞号判定不再写死成"拒绝"：策略收敛在 lib/phone-gate（纯函数、有单测）。
  //
  // 背景：走到撞号的人几乎都是同一种处境 —— 先用手机号注册过，后来又用微信登录，
  // 于是同一人拥有两个账号。系统**没有数据合并能力**（22 张表按 user_id 挂载，
  // 其中 8 个唯一约束会冲突），所以不能把两个有数据的账号合起来。
  //
  // 但"强制绑定放在进站之前"使撞号变得可自动处理：那时微信壳账号刚由关注事件
  // 建出来、还没有任何练习数据，于是只需把微信身份转到手机号账号上，
  // 再把壳账号清空（复用注销那套口径）。
  const [existingUser, me] = await Promise.all([
    getUserByPhone(phone),
    db
      .select({ wechatOpenid: users.wechatOpenid, wechatUnionid: users.wechatUnionid })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
      .then((r) => r[0]),
  ])

  const [{ n: practiceCount }] = await db
    .select({ n: sqlCount() })
    .from(practiceRecords)
    .where(eq(practiceRecords.userId, session.userId))

  const verdict = decideBindCollision({
    currentUserId: session.userId,
    currentWechatOpenid: me?.wechatOpenid ?? null,
    existingUserId: existingUser?.id ?? null,
    existingWechatOpenid: existingUser?.wechatOpenid ?? null,
    currentHasPracticeData: Number(practiceCount) > 0,
  })

  if (verdict.action === "already_bound") {
    return NextResponse.json({ error: "该手机号已绑定当前账号" }, { status: 409 })
  }
  if (verdict.action === "refuse") {
    return NextResponse.json(
      { error: verdict.reason, code: "PHONE_TAKEN" },
      { status: 409 },
    )
  }

  // 验证通过后才标记验证码已用
  await db
    .update(verificationCodes)
    .set({ used: 1 })
    .where(eq(verificationCodes.id, record.id))

  if (verdict.action === "bind" || !existingUser) {
    await db.update(users).set({ phone }).where(eq(users.id, session.userId))
    return NextResponse.json({ success: true, phone })
  }

  // ── transfer：把微信身份转到手机号账号，壳账号清空 ────────────────────────
  // 顺序很重要：openid 是 UNIQUE，不先把它从壳账号上摘掉，就无法挂到另一个账号
  const targetId = existingUser.id
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ wechatOpenid: null, wechatUnionid: null })
      .where(eq(users.id, session.userId))
    await tx
      .update(users)
      .set({ wechatOpenid: me?.wechatOpenid ?? null, wechatUnionid: me?.wechatUnionid ?? null })
      .where(eq(users.id, targetId))
    // 壳账号按注销口径清空（清 PII、权益归零、角色回落为 user）
    await tx.update(users).set(anonymizedProfile()).where(eq(users.id, session.userId))
    // 壳账号的全部会话作废，避免旧 cookie 还能用它
    await tx.delete(sessions).where(eq(sessions.userId, session.userId))
  })

  // 换成手机号账号的会话：用户接下来用的是那个"带着历史记录"的账号
  await createSession(targetId)

  return NextResponse.json({ success: true, phone, switched: true })
}
