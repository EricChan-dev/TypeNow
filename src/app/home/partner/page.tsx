import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import PartnerDashboard from "./PartnerDashboard"
import PartnerJoin from "./PartnerJoin"

/**
 * 推广中心。
 *
 * ── 2026-09-29 合规改造 ─────────────────────────────────────────────────────
 *
 * 入口对**所有注册用户**开放，不再要求先购买 ¥499 终身会员。
 * 门禁依据从 `is_partner` 改成了 `partner_agreed_at`：
 *
 *   · `partner_agreed_at` —— 用户**免费主动同意**《推广合作协议》的时间，
 *     正是合规检查要看的留档证据；
 *   · `is_partner` —— 语义已收窄为「持有终身会员」（一个纯消费商品）。
 *
 * ⚠️ **不要用 `is_partner` 做这里的门禁**：那等于"付了钱才能推广"，
 * 命中《禁止传销条例》第七条(二)的「变相入门费」，正是本次改造要消除的那件事。
 * 完整依据见 docs/distribution-compliance.md 与 docs/business-model.md §7。
 */
export default async function PartnerPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  let agreed = false
  if (db) {
    const [user] = await db
      .select({ partnerAgreedAt: users.partnerAgreedAt })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
    agreed = !!user?.partnerAgreedAt
  }

  return agreed ? <PartnerDashboard /> : <PartnerJoin />
}
