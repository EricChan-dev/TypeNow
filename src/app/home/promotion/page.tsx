import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import PartnerDashboard from "../partner/PartnerDashboard"
import PromotionGate from "./PromotionGate"

// 拦截卡片样式（1:1 移植参考页 `.not-partner-card`）。与会员页/招募页同样的做法：
// 全部规则挂在 `.home-ref-shell` 作用域下，不会波及站内其它页面。
import "./promotion.css"

/**
 * 推广返利。
 *
 * 对应参考页侧边栏的第三项「推广返利」（`/User/PromotionRebate`）。
 *
 * ── 与 `/home/partner` 的分工（2026-10-10）────────────────────────────────────
 *
 * 参考页把「合伙人招募」和「推广返利」拆成两个独立入口：招募页讲政策、带货；
 * 推广返利页才是真正的数据后台。本仓原先只有一个 `/home/partner`，对合伙人
 * 渲染看板、对非合伙人渲染招募页，两件事挤在一个路由里。
 *
 * 现在按用户的要求拆开：
 *   · `/home/promotion` —— 推广返利。**合伙人**看到的就是现有推广中心看板
 *     （直接复用 `PartnerDashboard`，不另写一套）；**非合伙人**看到句游英语式的
 *     拦截卡片，按钮把人引到招募页。
 *   · `/home/partner`   —— 保持原状（合伙人看板 / 非合伙人招募页）。
 *
 * ⚠️ 两处的门禁都是 `is_partner`，即"付了 ¥699 才能推广"。这正是
 * 《禁止传销条例》第七条(二)「变相入门费」的要件，复核尚未进行 —— 详见本目录
 * 上一级 `partner/page.tsx` 的完整说明与 docs/membership-alignment-risk-2026-10.md。
 */
export default async function PromotionPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  let isPartner = false
  if (db) {
    const [user] = await db
      .select({ isPartner: users.isPartner })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
    isPartner = !!user?.isPartner
  }

  return isPartner ? <PartnerDashboard /> : <PromotionGate />
}
