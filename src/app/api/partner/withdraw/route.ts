import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { partnerCommissions, withdrawalRequests, users } from "@/lib/db/schema"
import { getSession } from "@/lib/auth/session"
import { eq, and, inArray, lte } from "drizzle-orm"
import { randomUUID } from "crypto"
import { wechatTransferBatch, isWeChatPayConfigured, WechatPayError } from "@/lib/wechat-pay"
import {
  UNCERTAIN_WITHDRAW_MESSAGE,
  UNCERTAIN_WITHDRAW_REASON,
  classifyTransferFailure,
} from "@/lib/withdraw-safety"

const MIN_WITHDRAW = 5000 // ¥50 in fen

export async function POST(request: Request) {
  if (!db) return NextResponse.json({ error: "服务未配置" }, { status: 500 })

  const session = await getSession()
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 })

  // 门禁依据是**免费主动同意《推广合作协议》**（partner_agreed_at），不是付费 ——
  // 「付费才能取得推广资格」命中《禁止传销条例》第七条(二)。
  //
  // 另外提现**必须**已绑定微信：那是收款账户要求，不是资格门槛
  // （没有 openid 就无法用商家转账打款）。
  const [promoter] = await db
    .select({ partnerAgreedAt: users.partnerAgreedAt, wechatOpenid: users.wechatOpenid })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!promoter) {
    return NextResponse.json({ error: "账号不存在" }, { status: 403 })
  }
  if (!promoter.partnerAgreedAt) {
    return NextResponse.json({ error: "请先加入推广计划" }, { status: 403 })
  }

  if (!promoter.wechatOpenid) {
    return NextResponse.json({ error: "请先绑定微信账号以接收转账" }, { status: 400 })
  }

  let body: { amount?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 })
  }

  const amount = Math.floor(Number(body.amount))
  if (!amount || amount < MIN_WITHDRAW) {
    return NextResponse.json({ error: `最低提现金额为 ¥${MIN_WITHDRAW / 100}` }, { status: 400 })
  }

  const outBatchNo = `WD-${Date.now().toString(36).toUpperCase()}-${randomUUID().replace(/-/g, "").substring(0, 6).toUpperCase()}`
  const requestId = randomUUID()
  const appId = process.env.WECHAT_APP_ID ?? process.env.NEXT_PUBLIC_WECHAT_APP_ID ?? ""

  // ── Step 0: Thaw matured commissions ──────────────────────────────────────
  // 佣金的「冷却转可提现」此前只发生在 dashboard / commissions 两个读接口里（写
  // 在读路径上）。如果客户端不先打开这两页就直接提现，明明已经到期的佣金仍停在
  // cooling，会被判成「可提现余额不足」。提现是资金动作，必须自己保证前提成立。
  await db
    .update(partnerCommissions)
    .set({ status: "available" })
    .where(
      and(
        eq(partnerCommissions.partnerId, session.userId),
        eq(partnerCommissions.status, "cooling"),
        lte(partnerCommissions.availableAt, new Date())
      )
    )

  // ── Step 1: Atomically claim commissions ──────────────────────────────────
  // FOR UPDATE locks the rows so concurrent withdrawals on the same partner
  // serialize at the DB level — no double-withdrawal possible.
  let lockedAmount = 0
  // 记录本次真正被占用的佣金行。回滚时必须只恢复这些行：
  // 早先的实现按 (partnerId, status='withdrawn') 恢复，会把历史上**已成功
  // 打款**的批次也一并退回 available，同一笔佣金因此可以被重复提现。
  const claimedIds: string[] = []
  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: partnerCommissions.id,
          commissionAmount: partnerCommissions.commissionAmount,
        })
        .from(partnerCommissions)
        .where(
          and(
            eq(partnerCommissions.partnerId, session.userId),
            eq(partnerCommissions.status, "available"),
          ),
        )
        .for("update")

      lockedAmount = rows.reduce((s: number, r) => s + r.commissionAmount, 0)
      claimedIds.push(...rows.map((r) => r.id))

      if (lockedAmount === 0) {
        throw new Error("INSUFFICIENT_BALANCE")
      }

      // Full-withdrawal-only policy: the requested amount must equal
      // the actually-locked amount (which is race-free).
      if (amount !== lockedAmount) {
        throw new Error("PARTIAL_NOT_ALLOWED")
      }

      await tx
        .update(partnerCommissions)
        .set({ status: "withdrawn" })
        .where(
          and(
            eq(partnerCommissions.partnerId, session.userId),
            eq(partnerCommissions.status, "available"),
          ),
        )
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === "INSUFFICIENT_BALANCE") {
      return NextResponse.json({ error: "可提现余额不足" }, { status: 400 })
    }
    if (msg === "PARTIAL_NOT_ALLOWED") {
      return NextResponse.json({
        error: `当前只能全额提现 ¥${(lockedAmount / 100).toFixed(2)}，不支持部分提现。请提现全部可提余额`,
      }, { status: 400 })
    }
    // Unexpected error — re-throw to 500
    console.error("[Withdraw] Claim transaction failed:", e)
    return NextResponse.json({ error: "提现失败，请稍后重试" }, { status: 500 })
  }

  // ── Step 2: WeChat transfer (outside transaction) ─────────────────────────
  // transferDone 一旦为 true 表示钱**已经转出**，此后任何失败都不允许回滚佣金，
  // 否则会出现"钱已打给对方、佣金又变回可提现"的重复打款。
  let transferDone = false
  try {
    // 标成 not_sent：请求根本没发出去，钱一定没动，调用方可以安全回滚
    if (!isWeChatPayConfigured()) {
      throw new WechatPayError("微信支付未配置，请联系管理员", "not_sent")
    }

    const { batchId } = await wechatTransferBatch({
      appId,
      outBatchNo,
      openid: promoter.wechatOpenid,
      amount: lockedAmount,
      remark: "TypeNow 推广佣金提现",
    })
    transferDone = true

    await db.insert(withdrawalRequests).values({
      id: requestId,
      partnerId: session.userId,
      amount: lockedAmount,
      wechatOpenid: promoter.wechatOpenid,
      partnerTradeNo: outBatchNo,
      wxTransferId: batchId,
      status: "completed",
      completedAt: new Date(),
    })

    return NextResponse.json({ success: true, amount: lockedAmount, outBatchNo })
  } catch (e) {
    const failReason = e instanceof Error ? e.message : String(e)
    console.error("[Withdraw] Transfer failed:", failReason)

    // 转账已成功、仅本地记账失败：绝不回滚佣金，改为人工核对。
    if (transferDone) {
      console.error(
        "[Withdraw] CRITICAL: 转账已成功但记账失败，佣金保持 withdrawn，需要人工核对 outBatchNo=",
        outBatchNo,
      )
      return NextResponse.json(
        { error: "提现已提交，请稍后联系客服确认到账" },
        { status: 500 },
      )
    }

    // ── Step 2b: 结果未知 —— **绝不回滚** ───────────────────────────────────
    // 超时/网络中断/5xx/429/应答验签失败都意味着"请求可能已经被微信处理"。
    // 此时若把佣金退回 available，用户立刻能再提一次，而第一次可能已经到账：
    // 那就是同一笔钱打款两次，且不可逆。
    //
    // 代价是这笔钱暂时卡住、需要人工核对 —— 相对重复打款，这个代价是值得的。
    if (classifyTransferFailure(e) === "uncertain") {
      console.error(
        "[Withdraw] CRITICAL: 转账结果未知，佣金保持 withdrawn，待人工核对 outBatchNo=",
        outBatchNo,
      )
      try {
        // 落一条 processing 的流水（而不是 failed）：我们确实还不知道结果，
        // 记成 failed 是假的。failReason 写清原因供人工核对。
        await db.insert(withdrawalRequests).values({
          id: requestId,
          partnerId: session.userId,
          amount: lockedAmount,
          wechatOpenid: promoter.wechatOpenid,
          partnerTradeNo: outBatchNo,
          status: "processing",
          failReason: UNCERTAIN_WITHDRAW_REASON,
        })
      } catch (recordErr) {
        // 连待核对的流水都写不进去，只能靠上面的 CRITICAL 日志
        console.error("[Withdraw] CRITICAL: 待核对流水写入失败!", recordErr)
      }
      return NextResponse.json({ error: UNCERTAIN_WITHDRAW_MESSAGE }, { status: 500 })
    }

    // ── Step 3: Rollback — 只恢复本次占用的佣金行 ──────────────────────────
    // 必须限定 claimedIds：按 (partnerId, status='withdrawn') 恢复会把历史
    // 上已成功打款的批次也退回 available，造成重复提现。
    try {
      await db.transaction(async (tx) => {
        if (claimedIds.length > 0) {
          await tx
            .update(partnerCommissions)
            .set({ status: "available" })
            .where(
              and(
                eq(partnerCommissions.partnerId, session.userId),
                eq(partnerCommissions.status, "withdrawn"),
                inArray(partnerCommissions.id, claimedIds),
              ),
            )
        }

        await tx.insert(withdrawalRequests).values({
          id: requestId,
          partnerId: session.userId,
          amount: lockedAmount,
          wechatOpenid: promoter.wechatOpenid,
          partnerTradeNo: outBatchNo,
          status: "failed",
          failReason,
        })
      })
    } catch (rollbackErr) {
      // If rollback also fails, the commission rows stay in "withdrawn" state.
      // This is an emergency situation requiring manual intervention.
      console.error("[Withdraw] CRITICAL: Rollback transaction failed!", rollbackErr)
    }

    return NextResponse.json({ error: "提现失败，请联系客服处理" }, { status: 500 })
  }
}
