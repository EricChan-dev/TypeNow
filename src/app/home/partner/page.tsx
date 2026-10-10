import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import PartnerDashboard from "./PartnerDashboard"
import PartnerJoin from "./PartnerJoin"

// 合伙人招募页的版式样式（1:1 移植参考页）。与会员页同样的做法：
// 全部规则挂在 `.home-ref-shell` 作用域下，不会波及站内其它页面。
import "./partner-recruit.css"

/**
 * 推广中心。
 *
 * ── 2026-10-10 变更（⚠️ 未经律师复核）────────────────────────────────────────
 *
 * 门禁**改回 `is_partner`**：只有开通了合伙人版（¥699）的用户才能进入推广中心。
 *
 * 2026-09-29 曾把这里改成对所有注册用户开放（门禁＝免费同意《推广合作协议》的
 * `partner_agreed_at`），以消除《禁止传销条例》第七条(二)「变相入门费」要件 ——
 * 那曾是自查九要件里唯一命中、且权重最高的一条。
 *
 * ⚠️ **本页现在的门禁等于"付了钱才能推广"**，这正是那一条要件。
 * 这同时对应 docs/distribution-compliance.md:27-28 的复核触发条件
 * （「把推广资格与任何付费商品重新绑定」→ 改代码前先找律师），复核尚未进行；
 * 决策方已书面确认承担风险。见 docs/membership-alignment-risk-2026-10.md。
 */
export default async function PartnerPage() {
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

  return (
    <>
      {/* 「返回」条。会员中心的合伙人卡 CTA 现在会跳到本页（`了解合伙人计划`），
          所以本页必须给一条明确的回路，否则用户只能靠浏览器后退键。
          用 <Link href="/home/membership"> 而不是 router.back()：本页也能被
          侧边栏直接进入，那种情况下历史里未必有会员中心。 */}
      <div className="partner-back-bar">
        <Link href="/home/membership" className="partner-back-link">
          <ArrowLeft aria-hidden="true" />
          返回会员中心
        </Link>
      </div>
      {isPartner ? <PartnerDashboard /> : <PartnerJoin />}
    </>
  )
}
