"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { toast } from "sonner"
import QRCode from "qrcode"
import { PaymentSuccessModal } from "@/components/payment/PaymentSuccessModal"

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

const COPY_SCRIPTS = [
  {
    scene: "朋友圈",
    text: "发现一个超好用的 AI 英语打字练习 App，边打字边学英语，有音标有词性分析，比背单词效率高太多了！免费注册体验👉",
  },
  {
    scene: "私聊",
    text: "给你推荐个学英语的神器，我用了一段时间感觉进步很明显，主要是每天练几分钟，不用死记硬背。你可以用我的邀请码注册试试",
  },
  {
    scene: "抖音评论",
    text: "用码上英语练打字真的会了很多地道表达，推荐给英语想进步的小伙伴，我有邀请码可以优先注册",
  },
]

const fmt = (fen: number) => `¥${(fen / 100).toFixed(2)}`

export default function PartnerDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [withdrawals, setWithdrawals] = useState<{ amount: number; status: string; createdAt: string }[]>([])
  const [tab, setTab] = useState<"link" | "poster" | "scripts">("link")
  const [withdrawAmount, setWithdrawAmount] = useState("")
  const [withdrawing, setWithdrawing] = useState(false)
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const [generatingPoster, setGeneratingPoster] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    fetch("/api/partner/dashboard")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => toast.error("加载数据失败"))

    fetch("/api/partner/commissions")
      .then((r) => r.json())
      .then((d) => setCommissions(d.data ?? []))

    fetch("/api/partner/withdrawals")
      .then((r) => r.json())
      .then((d) => setWithdrawals(d.data ?? []))
  }, [])

  const inviteLink = data?.inviteCode
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/ref/${data.inviteCode}`
    : ""

  function copyLink() {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink).then(() => toast.success("邀请链接已复制"))
  }

  function copyScript(text: string, fullText: string) {
    navigator.clipboard.writeText(fullText).then(() => toast.success("话术已复制"))
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
    if (!amount || amount < 5000) {
      toast.error("最低提现 ¥50")
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
      toast.success(`提现成功！¥${(amount / 100).toFixed(2)} 已转入微信零钱`)
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

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <canvas ref={canvasRef} className="hidden" />

      <div className="max-w-lg mx-auto px-4 pt-8 flex flex-col gap-6">
        <div className="text-2xl font-bold">合伙人中心</div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="累计佣金" value={fmt(data.totalEarned)} />
          <StatCard label="可提现余额" value={fmt(data.available)} accent />
          <StatCard label="待生效" value={fmt(data.cooling)} sub="15天冷静期" />
          <StatCard label="邀请注册" value={String(data.referredCount)} sub={`付费 ${data.paidCount} 人 · 转化 ${conversionRate}%`} />
        </div>

        {/* Material tabs */}
        <div className="bg-muted/40 border border-border rounded-2xl overflow-hidden">
          <div className="flex border-b border-border">
            {([["link", "邀请链接"], ["poster", "分享海报"], ["scripts", "推广话术"]] as const).map(([key, label]) => (
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
              </div>
            )}

            {tab === "scripts" && (
              <div className="flex flex-col gap-3">
                {COPY_SCRIPTS.map((s) => (
                  <div key={s.scene} className="bg-muted/60 rounded-xl p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">{s.scene}</span>
                      <button
                        onClick={() => copyScript(s.scene, s.text + " " + inviteLink)}
                        className="text-xs text-sky-400 hover:text-sky-300"
                      >
                        复制
                      </button>
                    </div>
                    <p className="text-sm text-foreground/70 leading-relaxed">{s.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Withdraw */}
        <div className="bg-muted/40 border border-border rounded-2xl p-4 flex flex-col gap-4">
          <div className="font-medium">申请提现</div>
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
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder={`最低 ¥50，余额 ${fmt(data.available)}`}
                className="w-full bg-muted/60 border border-border rounded-xl py-3 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30"
              />
            </div>
            <button
              onClick={handleWithdraw}
              disabled={withdrawing || !data.hasWechat || data.available < 5000}
              className="px-5 py-3 rounded-xl bg-foreground text-background font-medium text-sm hover:bg-foreground/90 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {withdrawing ? "处理中" : "提现"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground/70">提现后将实时转入微信零钱，可在微信中提现至银行卡</p>
        </div>

        {/* Commission list */}
        {commissions.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-foreground/70">佣金明细</div>
            {commissions.map((c) => (
              <div key={c.id} className="bg-muted/40 border border-border rounded-xl p-3 flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-foreground/80">
                    {c.referredUserPhone ?? "用户"} · {c.commissionType === "first" ? "首次" : "续费"}
                  </span>
                  <span className="text-xs text-muted-foreground/70">{new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-sm font-medium text-emerald-400">{fmt(c.commissionAmount)}</span>
                  <StatusBadge status={c.status} availableAt={c.availableAt} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        <PaymentSuccessModal />
      </Suspense>
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-muted/40 border border-border rounded-2xl p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-xl font-bold ${accent ? "text-emerald-400" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>}
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
