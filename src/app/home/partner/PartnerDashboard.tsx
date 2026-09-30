"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { toast } from "sonner"
import QRCode from "qrcode"
import { ChevronRight, ArrowLeft, AlertTriangle } from "lucide-react"
import { PaymentSuccessModal } from "@/components/payment/PaymentSuccessModal"
import {
  ATTRIBUTION_WINDOW_DAYS,
  COMMISSION_RATE,
  COMMISSION_TYPE_LABELS,
  COMMISSION_COOLING_DAYS,
  MIN_WITHDRAW_FEN,
  fmtFen as fmt,
  withdrawProgress,
} from "@/lib/partner-rules"
import {
  PROMOTION_MATERIALS_VERSION,
  buildCopyText,
  materialsForPlatform,
  ruleForPlatform,
  type PromotionMaterial,
  type PromotionPlatform,
} from "@/lib/promotion-materials"

interface DashboardData {
  inviteCode: string
  hasWechat: boolean
  totalEarned: number
  available: number
  cooling: number
  referredCount: number
  paidCount: number
}

interface Commission {
  id: string
  commissionAmount: number
  commissionType: "first" | "renewal"
  status: string
  availableAt: string
  createdAt: string
  referredUserPhone: string | null
}

/** 我邀请的人（见 /api/partner/invites）。 */
interface Invite {
  userId: string
  phone: string | null
  name: string | null
  registeredAt: string
  practiced: boolean
  paid: boolean
  /** 归因窗口剩余天数；已付费的人为 null */
  daysLeft: number | null
  expired: boolean
}

interface InviteSummary {
  total: number
  paidCount: number
  pendingCount: number
  /** 未付费**且**归因窗口还没过期 —— 现在值得花时间跟进的那批 */
  pendingInWindow: number
}

/**
 * 平台展示顺序：**微信排第一**。
 *
 * 微信是唯一可以自由放链接和二维码的场景，也就是唯一能把人直接带到产品的场景；
 * 小红书/抖音只能做"内容种草 + 让人自己去搜"。推广员的时间应该先花在转化率最高的地方，
 * 所以素材默认打开微信这一栏。
 */
const PLATFORM_ORDER: PromotionPlatform[] = ["微信", "小红书", "抖音"]

/** 归因窗口的中文标签。数值来自 lib/partner-rules，这里只负责显示。 */
const ATTRIBUTION_WINDOW_LABEL = `${ATTRIBUTION_WINDOW_DAYS} 天`

export default function PartnerDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [withdrawals, setWithdrawals] = useState<{ amount: number; status: string; createdAt: string }[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteSummary, setInviteSummary] = useState<InviteSummary | null>(null)
  const [tab, setTab] = useState<"link" | "poster" | "scripts">("link")
  const [materialPlatform, setMaterialPlatform] = useState<PromotionPlatform>("微信")
  const [detailPanel, setDetailPanel] = useState<"withdrawals" | "commissions" | "invites" | null>(null)
  const [withdrawAmount, setWithdrawAmount] = useState("")
  const [withdrawing, setWithdrawing] = useState(false)
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const [generatingPoster, setGeneratingPoster] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    fetch("/api/partner/dashboard")
      .then((r) => r.json())
      .then((d) => { setData(d); setWithdrawAmount(String(d.available / 100)) })
      .catch(() => toast.error("加载数据失败"))

    fetch("/api/partner/commissions")
      .then((r) => r.json())
      .then((d) => setCommissions(d.data ?? []))

    fetch("/api/partner/withdrawals")
      .then((r) => r.json())
      .then((d) => setWithdrawals(d.data ?? []))

    // 待付费邀请记录 —— 推广员唯一能自己动手做转化的抓手（见 invites 路由的注释）
    fetch("/api/partner/invites")
      .then((r) => r.json())
      .then((d) => { setInvites(d.data ?? []); setInviteSummary(d.summary ?? null) })
      .catch(() => { /* 列表拿不到不影响主流程，不打断 */ })
  }, [])

  const inviteLink = data?.inviteCode
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/ref/${data.inviteCode}`
    : ""

  function copyLink() {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink).then(() => toast.success("邀请链接已复制"))
  }

  /**
   * 复制素材。
   *
   * 走 `buildCopyText` 而不是自己拼链接：小红书禁止发布站外链接/二维码
   * （《交易导流违规管理细则》，处罚可到永久封禁账号），所以那里**必须**省略链接。
   * 省略时要如实告诉推广员，而不是静默丢掉 —— 否则他会以为链接已经在里面了。
   */
  function copyMaterial(m: PromotionMaterial, which: "skeleton" | "example") {
    const raw = which === "skeleton"
      ? m.skeleton.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : m.example
    const { text, linkIncluded } = buildCopyText(raw, m.platform, inviteLink)
    navigator.clipboard.writeText(text).then(() => {
      if (linkIncluded) {
        toast.success("已复制（含你的邀请链接）")
      } else {
        toast.success(`${m.platform}不能放链接，已只复制文字 —— 请引导对方搜索「码上英语」`)
      }
    })
  }

  const generatePoster = useCallback(async () => {
    if (!data?.inviteCode || !canvasRef.current) return
    setGeneratingPoster(true)
    try {
      const canvas = canvasRef.current
      const ctx = canvas.getContext("2d")!
      canvas.width = 750
      canvas.height = 1334

      // Background gradient
      const grad = ctx.createLinearGradient(0, 0, 0, 1334)
      grad.addColorStop(0, "#0a0a0a")
      grad.addColorStop(1, "#1a0a00")
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 750, 1334)

      // Brand name
      ctx.fillStyle = "#ffffff"
      ctx.font = "bold 64px system-ui"
      ctx.textAlign = "center"
      ctx.fillText("码上英语", 375, 200)

      ctx.fillStyle = "rgba(255,255,255,0.5)"
      ctx.font = "32px system-ui"
      ctx.fillText("AI 全程陪练，打字练就地道英语", 375, 260)

      // Divider
      ctx.fillStyle = "rgba(255,255,255,0.1)"
      ctx.fillRect(60, 310, 630, 1)

      // Invite text
      ctx.fillStyle = "rgba(255,255,255,0.7)"
      ctx.font = "36px system-ui"
      ctx.fillText("我的朋友邀请你加入", 375, 400)

      // QR Code
      const qrDataUrl = await QRCode.toDataURL(inviteLink, {
        width: 300,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      })
      const qrImg = new Image()
      await new Promise<void>((res) => { qrImg.onload = () => res(); qrImg.src = qrDataUrl })
      ctx.fillStyle = "#ffffff"
      ctx.roundRect(375 - 170, 440, 340, 340, 16)
      ctx.fill()
      ctx.drawImage(qrImg, 375 - 150, 460, 300, 300)

      // Invite code
      ctx.fillStyle = "rgba(245,158,11,0.9)"
      ctx.font = "bold 40px monospace"
      ctx.fillText(data.inviteCode, 375, 860)

      ctx.fillStyle = "rgba(255,255,255,0.4)"
      ctx.font = "28px system-ui"
      ctx.fillText("扫码注册 · 免费体验", 375, 920)

      // Features
      const features = ["AI 智能拆句练习", "音标 + 词性即时反馈", "科学间隔复习"]
      features.forEach((f, i) => {
        ctx.fillStyle = "rgba(255,255,255,0.5)"
        ctx.font = "26px system-ui"
        ctx.fillText(`✓  ${f}`, 375, 1020 + i * 60)
      })

      setPosterUrl(canvas.toDataURL("image/png"))
    } catch (e) {
      toast.error("海报生成失败")
      console.error(e)
    } finally {
      setGeneratingPoster(false)
    }
  }, [data?.inviteCode, inviteLink])

  async function handleWithdraw() {
    const amount = Math.round(parseFloat(withdrawAmount) * 100)
    if (!amount || amount < MIN_WITHDRAW_FEN) {
      toast.error(`最低提现 ${fmt(MIN_WITHDRAW_FEN)}`)
      return
    }
    setWithdrawing(true)
    try {
      const res = await fetch("/api/partner/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "提现失败")
      toast.success(`提现成功！${fmt(amount)} 已转入微信零钱`)
      setWithdrawAmount("")
      // Refresh dashboard
      const refreshed = await fetch("/api/partner/dashboard").then((r) => r.json())
      setData(refreshed)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "提现失败")
    } finally {
      setWithdrawing(false)
    }
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">加载中...</div>
      </div>
    )
  }

  const conversionRate = data.referredCount > 0
    ? ((data.paidCount / data.referredCount) * 100).toFixed(1)
    : "0.0"

  const progress = withdrawProgress(data.available)
  const platformMaterials = materialsForPlatform(materialPlatform)
  const platformRule = ruleForPlatform(materialPlatform)

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <canvas ref={canvasRef} className="hidden" />

      <div className="max-w-lg mx-auto px-4 pt-8 flex flex-col gap-6">
        <div className="text-2xl font-bold">推广中心</div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="累计佣金" value={fmt(data.totalEarned)} onClick={() => setDetailPanel("commissions")} clickable />
          <StatCard label="可提现余额" value={fmt(data.available)} accent />
          <StatCard label="待生效" value={fmt(data.cooling)} sub={`${COMMISSION_COOLING_DAYS}天冷静期`} />
          <StatCard
            label="邀请注册"
            value={String(data.referredCount)}
            sub={`付费 ${data.paidCount} 人 · 转化 ${conversionRate}%`}
            onClick={() => setDetailPanel("invites")}
            clickable
          />
        </div>

        {/* Material tabs */}
        <div className="bg-muted/40 border border-border rounded-2xl overflow-hidden">
          <div className="flex border-b border-border">
            {([["link", "邀请链接"], ["poster", "分享海报"], ["scripts", "推广素材"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === key ? "text-foreground border-b-2 border-foreground" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === "link" && (
              <div className="flex flex-col gap-3">
                <div className="bg-muted/60 rounded-xl p-3 text-sm text-foreground/70 font-mono break-all">{inviteLink}</div>
                <button onClick={copyLink} className="w-full py-3 rounded-xl bg-foreground text-background font-medium text-sm hover:bg-foreground/90 transition-colors">
                  复制邀请链接
                </button>
                <div className="text-xs text-muted-foreground/70 text-center">邀请码：{data.inviteCode}</div>
                <div className="text-xs text-muted-foreground/60 text-center leading-relaxed">
                  被推荐人注册后 {ATTRIBUTION_WINDOW_LABEL} 内首次付款，你拿订单实付金额的{" "}
                  {COMMISSION_RATE.first * 100}%；之后续费拿 {COMMISSION_RATE.renewal * 100}%。
                </div>
              </div>
            )}

            {tab === "poster" && (
              <div className="flex flex-col gap-3">
                {posterUrl ? (
                  <>
                    <img src={posterUrl} alt="分享海报" className="w-full rounded-xl" />
                    <p className="text-xs text-muted-foreground text-center">长按图片保存到相册</p>
                    <button onClick={() => setPosterUrl(null)} className="text-xs text-muted-foreground/70 text-center">重新生成</button>
                  </>
                ) : (
                  <button
                    onClick={generatePoster}
                    disabled={generatingPoster}
                    className="w-full py-3 rounded-xl bg-foreground text-background font-medium text-sm hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                  >
                    {generatingPoster ? "生成中..." : "生成分享海报"}
                  </button>
                )}
                {/* 海报里带二维码，而小红书明令禁止二维码/水印 —— 必须在这里说清楚，
                    否则等于平台在教推广员踩线（处罚可到永久封禁账号）。 */}
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-400 leading-relaxed">
                  这张海报<b>带二维码</b>，只能用在<b>微信朋友圈 / 私聊</b>。
                  小红书明令禁止二维码、水印与站外链接，发在那里会被限流甚至封号 ——
                  小红书请改用「推广素材」里的小红书版本。
                </div>
              </div>
            )}

            {tab === "scripts" && (
              <div className="flex flex-col gap-3">
                {/* 平台切换：默认微信（唯一能直接放链接的场景） */}
                <div className="flex gap-2">
                  {PLATFORM_ORDER.map((p) => (
                    <button
                      key={p}
                      onClick={() => setMaterialPlatform(p)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                        materialPlatform === p
                          ? "bg-foreground text-background"
                          : "bg-muted/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                {/* 该平台的红线。asOf 必须显示 —— 平台规则会变，
                    一张不标日期的"红线表"比没有更危险。 */}
                {platformRule && (
                  <div
                    className={`rounded-xl p-3 text-xs leading-relaxed border ${
                      platformRule.linkAllowed
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {platformRule.linkAllowed ? "可以放链接和二维码" : "不能放链接，也不能放二维码"}
                    </div>
                    <p className="mt-1 opacity-90">{platformRule.note}</p>
                    <p className="mt-1 opacity-60">{platformRule.asOf}</p>
                  </div>
                )}

                {platformMaterials.map((m) => (
                  <div key={m.id} className="bg-muted/60 rounded-xl p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">{m.scene}</span>
                      <button
                        onClick={() => copyMaterial(m, "example")}
                        className="text-xs text-sky-400 hover:text-sky-300"
                      >
                        复制示例
                      </button>
                    </div>

                    {/* 骨架：告诉推广员"按什么顺序说"，不是让他抄 */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] text-muted-foreground/70">按这个结构用自己的话写：</span>
                      {m.skeleton.map((s, i) => (
                        <div key={i} className="flex gap-2 text-xs text-foreground/70 leading-relaxed">
                          <span className="text-muted-foreground/50 shrink-0">{i + 1}.</span>
                          <span>{s}</span>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-border/50 pt-3">
                      <span className="text-[11px] text-muted-foreground/70">示例（记得改成你自己的话）：</span>
                      <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line mt-1">{m.example}</p>
                    </div>

                    <details className="text-xs">
                      <summary className="text-muted-foreground/70 cursor-pointer">为什么这样写</summary>
                      <p className="text-foreground/60 leading-relaxed mt-2">{m.why}</p>
                    </details>

                    <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-2.5 flex flex-col gap-1">
                      {m.avoid.map((a, i) => (
                        <div key={i} className="flex gap-1.5 text-[11px] text-red-400/80 leading-relaxed">
                          <span className="shrink-0">·</span>
                          <span>{a}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="text-[11px] text-muted-foreground/50 text-center">
                  素材库版本 {PROMOTION_MATERIALS_VERSION} · 不要承诺收益或收入，只需如实描述你自己的使用体验
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Withdraw */}
        <div className="bg-muted/40 border border-border rounded-2xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">申请提现</span>
            <button onClick={() => setDetailPanel("withdrawals")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              提现记录 <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          {/* 差多少才能提现 —— 必须写出来。
              只把一个禁用的按钮摆在那里，赚了 ¥14.5 的推广员只会得出"这是骗人的"。
              推广体系信任崩塌最常见的就是这一秒。 */}
          {!progress.canWithdraw && (
            <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 text-xs text-sky-400 leading-relaxed">
              距离可提现还差 <b>{fmt(progress.shortfallFen)}</b>（满 {fmt(MIN_WITHDRAW_FEN)} 可申请）。
              {data.cooling > 0 && (
                <> 另有 {fmt(data.cooling)} 在 {COMMISSION_COOLING_DAYS} 天冷静期内，到期后自动转为可提现。</>
              )}
            </div>
          )}

          {!data.hasWechat && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-400">
              请先在个人设置中绑定微信账号，提现将转入微信零钱
            </div>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">¥</span>
              <input
                type="number"
                value={withdrawAmount || String(data.available / 100)}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder={`全额提现 ${fmt(data.available)}`}
                className="w-full bg-muted/60 border border-border rounded-xl py-3 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30"
              />
            </div>
            <button
              onClick={handleWithdraw}
              disabled={withdrawing || !data.hasWechat || !progress.canWithdraw}
              className="px-5 py-3 rounded-xl bg-foreground text-background font-medium text-sm hover:bg-foreground/90 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {withdrawing ? "处理中" : "提现"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground/70">提现后将实时转入微信零钱，可在微信中提现至银行卡</p>
        </div>

      </div>

      {/* Detail Panel — slide-over */}
      {detailPanel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDetailPanel(null)} />
          <div className="relative w-full sm:w-[400px] h-full bg-card border-l border-border shadow-2xl overflow-y-auto animate-slidein">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
              <button onClick={() => setDetailPanel(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
                返回
              </button>
              <span className="text-sm font-semibold">
                {detailPanel === "withdrawals" ? "提现记录" : detailPanel === "commissions" ? "佣金明细" : "邀请记录"}
              </span>
              <div className="w-12" />
            </div>

            <div className="p-4">
              {detailPanel === "withdrawals" && (
                withdrawals.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">暂无提现记录</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {withdrawals.map((w, i) => (
                      <div key={i} className="bg-muted/40 border border-border rounded-xl p-3 flex items-center justify-between">
                        <div>
                          <span className="text-sm text-foreground/80">{fmt(w.amount)}</span>
                          <div className="text-xs text-muted-foreground/70 mt-0.5">{new Date(w.createdAt).toLocaleDateString()}</div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${w.status === "completed" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                          {w.status === "completed" ? "已到账" : w.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              )}

              {detailPanel === "commissions" && (
                commissions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">暂无佣金记录</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {commissions.map((c) => (
                      <div key={c.id} className="bg-muted/40 border border-border rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-foreground/80">
                            {c.referredUserPhone ?? "用户"} · {COMMISSION_TYPE_LABELS[c.commissionType]}
                          </span>
                          <span className="text-sm font-medium text-emerald-400">{fmt(c.commissionAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted-foreground/70">{new Date(c.createdAt).toLocaleDateString()}</span>
                          <StatusBadge status={c.status} availableAt={c.availableAt} />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {detailPanel === "invites" && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-3 gap-2">
                    <MiniStat label="邀请注册" value={inviteSummary?.total ?? data.referredCount} />
                    <MiniStat label="已付费" value={inviteSummary?.paidCount ?? data.paidCount} accent />
                    <MiniStat
                      label="待跟进"
                      value={inviteSummary?.pendingInWindow ?? 0}
                      hint="还赶得上"
                    />
                  </div>

                  {inviteSummary && inviteSummary.pendingInWindow > 0 && (
                    <p className="text-xs text-muted-foreground/70 leading-relaxed">
                      这 {inviteSummary.pendingInWindow} 位好友还没付费、而且归因窗口还没过 ——
                      现在跟进正是时候。窗口一过，他再付款你也不会拿到佣金。
                    </p>
                  )}

                  {invites.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      还没有人通过你的链接注册
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {invites.map((v) => (
                        <div key={v.userId} className="bg-muted/40 border border-border rounded-xl p-3 flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-foreground/80">
                              {v.phone ?? v.name ?? "好友"}
                            </span>
                            {v.paid ? (
                              <span className="text-[11px] text-emerald-400">已付费</span>
                            ) : v.expired ? (
                              <span className="text-[11px] text-muted-foreground/50">窗口已过</span>
                            ) : (
                              <span className="text-[11px] text-amber-400">还剩 {v.daysLeft} 天</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
                            <span>{new Date(v.registeredAt).toLocaleDateString()} 注册</span>
                            <span>·</span>
                            <span>{v.practiced ? "已开始练习" : "还没开始练"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground/50 text-center mt-2 leading-relaxed">
                    邀请好友注册并购买会员，即可获得佣金。首次购买佣金 {COMMISSION_RATE.first * 100}%，
                    续费佣金 {COMMISSION_RATE.renewal * 100}% · 归因窗口 {ATTRIBUTION_WINDOW_LABEL} ·
                    冷静期 {COMMISSION_COOLING_DAYS} 天
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <PaymentSuccessModal />
      </Suspense>
    </div>
  )
}

function StatCard({ label, value, sub, accent, onClick, clickable }: { label: string; value: string; sub?: string; accent?: boolean; onClick?: () => void; clickable?: boolean }) {
  const Comp = clickable ? "button" : "div"
  return (
    <Comp onClick={onClick} className={`bg-muted/40 border border-border rounded-2xl p-4 text-left ${clickable ? "hover:bg-muted/60 transition-colors active:scale-[0.98]" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        {clickable && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
      </div>
      <div className={`text-xl font-bold ${accent ? "text-emerald-400" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>}
    </Comp>
  )
}

function MiniStat({ label, value, accent, hint }: { label: string; value: number; accent?: boolean; hint?: string }) {
  return (
    <div className="bg-muted/40 border border-border rounded-xl p-3 text-center">
      <div className={`text-xl font-bold ${accent ? "text-emerald-400" : "text-foreground"}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
      {hint && <div className="text-[10px] text-muted-foreground/50">{hint}</div>}
    </div>
  )
}

function StatusBadge({ status, availableAt }: { status: string; availableAt: string }) {
  const daysLeft = Math.ceil((new Date(availableAt).getTime() - Date.now()) / 86400000)
  const map: Record<string, { label: string; color: string }> = {
    cooling: { label: daysLeft > 0 ? `冷静期 ${daysLeft}天` : "待解冻", color: "text-amber-400" },
    available: { label: "可提现", color: "text-emerald-400" },
    withdrawn: { label: "已提现", color: "text-white/30" },
    clawed_back: { label: "已回扣", color: "text-red-400" },
  }
  const s = map[status] ?? { label: status, color: "text-muted-foreground/70" }
  return <span className={`text-[11px] ${s.color}`}>{s.label}</span>
}
