import { NextRequest, NextResponse } from "next/server"
import { and, count, eq, inArray } from "drizzle-orm"
import { getSession, deleteSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import {
  partnerCommissions,
  sessions,
  userNotes,
  users,
  verificationCodes,
  withdrawalRequests,
  wordbookItems,
} from "@/lib/db/schema"
import {
  DELETION_CONFIRM_PHRASE,
  anonymizedProfile,
  decideAccountDeletion,
  isConfirmPhraseValid,
} from "@/lib/account-deletion"

/**
 * 自助注销账号。
 *
 * 口径与"清了什么、留了什么"的完整说明见 lib/account-deletion —— 隐私政策里
 * 的表述必须与那份清单一致，否则又会出现"文案承诺了但实现没做"。
 *
 * 为什么不是 DELETE /api/user/profile：注销不是"更新资料"，它是一次不可逆的
 * 身份清空，单独一条路由更好审、也更容易在日志里被认出来。
 *
 * 安全性：
 *   · 需要登录（会话即身份，只能注销自己）；
 *   · 需要手动输入确认词 —— 防误触，也防"顺手调一下接口"就把号删了；
 *   · 非管理员、无未结佣金、无在途提现才放行（见 decideAccountDeletion）。
 * 会话 cookie 是 SameSite=Lax，跨站 POST 不会带上它，因此不额外加 CSRF token。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

    let body: { confirm?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
    }

    if (!isConfirmPhraseValid(body.confirm)) {
      return NextResponse.json(
        { error: `请在确认框中输入「${DELETION_CONFIRM_PHRASE}」`, code: "confirm_required" },
        { status: 400 },
      )
    }

    const [me] = await db
      .select({ role: users.role, phone: users.phone, isPartner: users.isPartner })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
    if (!me) return NextResponse.json({ error: "账号不存在" }, { status: 404 })

    // 两项前置查询：有未结佣金或在途提现就必须拦住 ——
    // 注销会把 partner_id 变成再也没人能登录的内部 id，钱会永久卡住。
    const [[unsettled], [inFlight]] = await Promise.all([
      db
        .select({ n: count() })
        .from(partnerCommissions)
        .where(
          and(
            eq(partnerCommissions.partnerId, session.userId),
            inArray(partnerCommissions.status, ["cooling", "available"]),
          ),
        ),
      db
        .select({ n: count() })
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.partnerId, session.userId),
            inArray(withdrawalRequests.status, ["pending", "processing"]),
          ),
        ),
    ])

    const decision = decideAccountDeletion({
      role: me.role,
      isPartner: !!me.isPartner,
      unsettledCommissionCount: Number(unsettled?.n ?? 0),
      inFlightWithdrawalCount: Number(inFlight?.n ?? 0),
    })
    if (decision.blocked) {
      return NextResponse.json({ error: decision.reason, code: "blocked" }, { status: 409 })
    }

    await db.transaction(async (tx) => {
      // 1) 用户自有内容：只对本人有意义，注销后没有留存理由
      await tx.delete(userNotes).where(eq(userNotes.userId, session.userId))
      await tx.delete(wordbookItems).where(eq(wordbookItems.userId, session.userId))

      // 2) 全部会话：注销要"全端登出"，否则别的设备上还留着有效会话
      await tx.delete(sessions).where(eq(sessions.userId, session.userId))

      // 3) 该手机号下的验证码：这张表按手机号存，行里还有 IP，
      //    属于必须一并清除的个人信息
      if (me.phone) {
        await tx.delete(verificationCodes).where(eq(verificationCodes.phone, me.phone))
      }

      // 4) 最后清空账户信息（放最后：上面几步还要用到 phone）
      await tx.update(users).set(anonymizedProfile()).where(eq(users.id, session.userId))
    })

    // 会话行已在上面的删除里清掉，这里只需把浏览器上的 cookie 也清掉
    await deleteSession()

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[user/delete]", e)
    return NextResponse.json({ error: "注销失败，请稍后重试或联系客服" }, { status: 500 })
  }
}
