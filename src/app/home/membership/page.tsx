import { redirect } from "next/navigation"
import { BookOpen, Gem, ShieldCheck, Zap } from "lucide-react"
import { getUser } from "@/app/actions/auth"
import { getActiveSubscription } from "@/lib/subscription"
import { memberTierLabel, type MemberTier } from "@/lib/pricing"
import { BRAND } from "@/lib/brand"
import { COMPARISON_NOTE, COMPARISON_ROWS, NOT_APPLICABLE } from "@/lib/membership-benefits"
import { MembershipHistory } from "./MembershipHistory"
import { MembershipPlans } from "./MembershipPlans"
import "./membership-upgrade.css"

/**
 * 会员权益页。
 *
 * 版式沿用登录页（app/login）与首页内容区（app/home/home-ref.css）的先例：
 * 只搬**表现层**，业务逻辑、路由与全部数字仍走本项目的事实源。
 *
 * 写这个页面时守住的几条规矩：
 * 1. 定价不写死在 button 的 `data-price` 属性里 —— 那种写法改价时必然漂移，
 *      数字一律从 `lib/pricing` 取。
 * 2. 对比表不写我们**没有的功能**
 *      （如「发音偏好选择」「分段练习」「高级 AI 语音引擎」）。写上去等于虚假宣传，
 *      正是 `lib/membership-benefits` 文件头记录过的「7 条里 4 条是代码里不存在的
 *      功能」那个坑。所以表格里只渲染 `COMPARISON_ROWS` 的行。
 * 3. 「练习时长 30 分钟」这类免费限额我们没有（打字练习人人不限次），
 *      首页 hero 的三枚胶囊相应改成我们真实的差异点。
 *
 * 三张套餐卡在 `./MembershipPlans`（客户端组件）—— 畅学版卡上有月/季/年切换。
 */

/** 当前身份的一句话摘要（压成 hero 下方一行，不占版面）。 */
function statusLine(memberTier: MemberTier, proExpires: Date | null): string {
  if (memberTier === "partner") return `${memberTierLabel(memberTier)} · 永久有效，无需续费`
  if (memberTier === "free") return `${memberTierLabel(memberTier)} · 尚未开通付费权益`
  const plan = memberTierLabel(memberTier)
  if (!proExpires) return plan
  const d = proExpires
  return `${plan} · 有效期至 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 服务承诺（4 张卡的结构与长度；措辞按我们的真实能力写，不写不可验证的承诺）。 */
const SERVICE_PROMISES = [
  {
    Icon: ShieldCheck,
    title: "提供永久免费体验",
    body: "还在犹豫是否订阅？没关系。平台保留了永久免费的体验版本。每天都有可练习的内容，不用花一分钱也能持续学习。",
  },
  {
    Icon: Zap,
    title: "高可用极速体验",
    body: "采用高可用云服务架构与就近接入节点，语音评测与 AI 讲解均为在线实时响应，让您的学习不因等待而中断。",
  },
  {
    Icon: BookOpen,
    title: "长期研发与教研投入",
    body: "团队持续迭代产品与课程内容，不断补充新的句子与 AI 语料。您只需一次付费，即可持续享受新增内容带来的价值。",
  },
  {
    Icon: Gem,
    title: "坚持底线的亲民定价",
    body: "拒绝暴利溢价和隐藏消费。我们把运营成本压缩到极致，价格远低行业均值，只为让 AI 能力服务于每一位学习者。",
  },
] as const

/** 需要按「金额胶囊」渲染合伙人列的佣金类行（值形如 `50%` / `30%`）。 */
const COMMISSION_FEATURES = new Set(["首次付款佣金", "续费佣金"])

export default async function MembershipPage() {
  const user = await getUser()
  if (!user) redirect("/login")

  let memberTier: MemberTier = "free"
  if (user.isPartner) memberTier = "partner"
  else if (user.isPro) {
    const sub = await getActiveSubscription(user.id)
    memberTier = (sub?.plan as "monthly" | "quarterly" | "yearly") ?? "trial"
  }

  const isPartner = memberTier === "partner"
  // `users.is_pro` / `users.is_partner` 是 tinyint，Drizzle 推出来是 number；
  // 客户端组件的 props 声明成 boolean，这里显式收敛，别把 0/1 漏下去。
  const isPro = memberTier !== "free"

 // 「价格」行在 `COMPARISON_ROWS` 里按价格页的历史顺序排在最后；这里把它调到
  // 对比表的**第一行**渲染。只调整顺序，不另写一份数字 —— 曾经额外补过一行价格，
  // 结果是同一个表格里出现两遍价格。
  const priceRow = COMPARISON_ROWS.find((row) => row.feature === "价格")
  const comparisonRows = priceRow
    ? [priceRow, ...COMPARISON_ROWS.filter((row) => row !== priceRow)]
    : COMPARISON_ROWS

  return (
    <div className="mainBox membership-upgrade-page">
      <div className="maxWidth">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="upgrade-hero">
          <div className="title upgrade-title-block">
            <h2>
              解锁 <b className="brand-text-gradient">{BRAND.nameZh}</b> 全部潜力
            </h2>
          </div>
 {/* 我们没有时长限制，三枚胶囊改为三条真实的差异点（内容门禁 / 额度 / 终身）。 */}
          <div className="hero-highlights">
            <span>免费版每课可试学</span>
            <span>畅学版解锁全部课程</span>
            <span>合伙人版终身畅享</span>
          </div>
          <p className="hero-status">{statusLine(memberTier, user.proExpires ?? null)}</p>
        </section>

        <div className="introduce simple-upgrade-page">
          {/* ── 三张套餐卡（客户端：畅学版可切月/季/年）────────────────────── */}
          <MembershipPlans memberTier={memberTier} isPro={isPro} isPartner={isPartner} />

          {/* ── 感谢语 ──────────────────────────────────────────────────────── */}
          <div className="gratitude-msg-box">
            <Gem />
            <span>
              您的每一分付费，都将促进产品体验的提升与课程内容的持续丰富。感谢您的支持！
            </span>
          </div>

          {/* ── 详细权益对比 ────────────────────────────────────────────────── */}
          <div className="function compact-comparison">
            <h3>详细权益对比</h3>
            <div
              className="upgrade-comparison-scroll"
              tabIndex={0}
              role="region"
              aria-label="详细权益对比，可左右滑动查看"
            >
              <div className="inner">
                <div className="head three-col-head">
                  <label>
                    <small>核心功能</small>
                  </label>
                  <span>
                    <b>免费版</b>
                  </span>
                  <span>
                    <b>畅学版</b>
                  </span>
                  <span>
                    <b>合伙人版</b>
                  </span>
                </div>

                <div className="body three-col-body">
                  {comparisonRows.map((row) => (
                    <p key={row.feature}>
                      <label>
                        <strong>{row.feature}</strong>
                      </label>
                      {(
                        [
                          ["col-free", row.free],
                          ["col-pro", row.quarterly],
                          ["col-partner", row.lifetime],
                        ] as const
                      ).map(([cls, value]) => (
                        <span key={cls} className={cls}>
                          {value === NOT_APPLICABLE ? (
                            <span className="tc-text-muted">—</span>
                          ) : COMMISSION_FEATURES.has(row.feature) && cls === "col-partner" ? (
                            <span className="tc-badge-pill highlight">
                              <span className="tc-badge-data">{value}</span>
                            </span>
                          ) : (
                            <b>{value}</b>
                          )}
                        </span>
                      ))}
                    </p>
                  ))}
                </div>
              </div>
            </div>
            <p className="comparison-note">{COMPARISON_NOTE}</p>
          </div>

          {/* ── 我们的服务承诺 ──────────────────────────────────────────────── */}
          <div className="service-promise-title">
            <h3>
              我们的服务承诺
              <span />
            </h3>
          </div>
          <div className="upgrade-service-grid">
            {SERVICE_PROMISES.map(({ Icon, title, body }) => (
              <div key={title} className="upgrade-svc-card">
                <div>
                  <span>
                    <Icon />
                  </span>
                  <strong>{title}</strong>
                </div>
                <p>{body}</p>
              </div>
            ))}
          </div>

          {/* ── 订阅记录 ────────────────────────────────────────────────────── */}
          <div className="membership-history-card">
            <h3>订阅记录</h3>
            <MembershipHistory />
          </div>
        </div>
      </div>
    </div>
  )
}
