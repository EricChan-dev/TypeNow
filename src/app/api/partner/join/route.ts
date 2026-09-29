import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { and, eq, isNull } from "drizzle-orm"

/**
 * 免费加入推广计划。
 *
 * ── 为什么需要这个接口 ──────────────────────────────────────────────────────
 *
 * 2026-09-29 合规改造把「取得推广资格」从付费商品上解绑：任何注册用户都可以推广、
 * 按被推荐人的实际付费金额拿佣金。这消除了《禁止传销条例》第七条(二)的
 * 「变相入门费」要件（它曾是自查里唯一命中的一条）。
 *
 * 但**只改准入判断是不够的**。合规检查要看的是：用户是不是**免费、主动**加入了？
 * 而证据就是本接口写入的 `partner_agreed_at` —— 改造前这个时间戳只在
 * 「付了 ¥399」那一刻产生，免费加入之后就没有任何留档，等于
 * "实质合规但拿不出证据"。
 *
 * ── 为什么用条件更新 ────────────────────────────────────────────────────────
 *
 * `WHERE partner_agreed_at IS NULL` 使写入天然幂等，且**保留首次同意时间**：
 * 协议同意时间是不可篡改的证据，重复点击"加入"不该把它刷成今天。
 * 这与 lib/trial.ts 的 claimTrial 是同一套模式（条件更新 + affectedRows）。
 *
 * ── 边界（不要越界实现）────────────────────────────────────────────────────
 *
 * 本接口**只**写协议同意时间，不授予任何佣金之外的权益、不涉及支付。
 * 佣金准入本身不需要字段：见 lib/subscription.ts 的 triggerCommission，
 * 那里只判断"推荐人存在"。
 */
export async function POST() {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  await db
    .update(users)
    .set({ partnerAgreedAt: new Date() })
    .where(and(eq(users.id, session.userId), isNull(users.partnerAgreedAt)))

  // 回读真实值：已加入过的人拿到的是**首次**同意时间，而不是刚刚这次的时间。
  const [row] = await db
    .select({ partnerAgreedAt: users.partnerAgreedAt })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  return NextResponse.json({
    success: true,
    agreedAt: row?.partnerAgreedAt ?? null,
  })
}
