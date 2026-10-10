import Link from "next/link"
import { AlertTriangle, ArrowRight } from "lucide-react"
import { ATTRIBUTION_WINDOW_DAYS, COMMISSION_RATE } from "@/lib/partner-rules"

/**
 * 推广返利 · 非合伙人拦截页。
 *
 * 版式移植自参考页 `/User/PromotionRebate` 对非会员渲染的 `.not-partner-card`：
 * 居中卡片 + 顶部黄色警告图标 + 标题 + 一段说明 + 一个深色按钮。
 *
 * ── 与参考页**故意不同**的三处 ────────────────────────────────────────────────
 *
 * 1. **佣金比例用本仓真实值**（`COMMISSION_RATE`：首单 50% / 续费 30%），
 *    不抄参考页的「首单至高 60%、续费至高 40%」。那组数字在本仓是假的，
 *    而且"至高"是上限话术 —— 真实规则见 lib/partner-rules。
 * 2. **删掉"睡后收入"**：参考页原文是"轻松实现睡后收入"，属收益承诺型表述，
 *    与 docs/distribution-compliance.md 第七节的禁用词同一类，不搬。
 * 3. **按钮指向本仓招募页** `/home/partner`（对应参考页的 PartnerRecruit），
 *    不是外链。
 *
 * 归因窗口天数同样从 lib/partner-rules 取，不写死 —— 那个数是对推广员的
 * 对外承诺，改一处必须全站一致。
 */
export default function PromotionGate() {
  const firstPct = `${COMMISSION_RATE.first * 100}%`
  const renewPct = `${COMMISSION_RATE.renewal * 100}%`

  return (
    <div className="promotion-gate">
      <div className="gate-card">
        <AlertTriangle className="gate-icon" aria-hidden="true" />
        <h2 className="gate-title">该功能仅对合伙人开放</h2>
        <p className="gate-desc">
          开通合伙人版后，可按实际成交获得推广佣金：首单 {firstPct}、续费{" "}
          {renewPct}，归因窗口 {ATTRIBUTION_WINDOW_DAYS} 天。推广资格、结算规则与
          物料使用说明详见合伙人计划。
        </p>
        <Link href="/home/partner" className="gate-btn">
          了解合伙人计划
          <ArrowRight className="gate-btn-arrow" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
