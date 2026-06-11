"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Circle, Share2, Users, CalendarDays, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface TaskStatus {
  checkIn: boolean
  share: boolean
  inviteTotal: number
  inviteCode: string | null
  diamonds: number
}

export function DailyTasks({ className, refreshKey }: { className?: string; refreshKey?: number }) {
  const [status, setStatus] = useState<TaskStatus | null>(null)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    fetch("/api/tasks/status")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => null)
  }, [refreshKey])

  async function handleShare() {
    if (!status || status.share) return
    setSharing(true)
    try {
      const res = await fetch("/api/tasks/share", { method: "POST" })
      const data = await res.json()
      if (data.alreadyClaimed) {
        toast.info("今日分享奖励已领取")
        setStatus((s) => s && { ...s, share: true })
        return
      }
      if (data.success) {
        setStatus((s) => s && { ...s, share: true, diamonds: s.diamonds + 10 })
        toast.success("🎉 +10 💎 分享奖励已到账！")
      }
    } catch {
      toast.error("操作失败，请稍后重试")
    } finally {
      setSharing(false)
    }

    const inviteLink = status?.inviteCode
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/register?ref=${status.inviteCode}`
      : typeof window !== "undefined" ? window.location.origin : ""

    if (navigator.share) {
      navigator.share({ title: "TypeNow · 码上英语", text: "我在用 TypeNow 学英语，邀请你一起来练习！", url: inviteLink }).catch(() => null)
    } else {
      try {
        await navigator.clipboard.writeText(inviteLink)
        toast.success("邀请链接已复制！")
      } catch {
        null
      }
    }
  }

  const tasks = [
    {
      key: "checkIn",
      icon: CalendarDays,
      color: "text-violet-400",
      bgColor: "bg-violet-500/10",
      label: "今日打卡完成",
      reward: "达标即签到",
      done: status?.checkIn ?? false,
      action: null as null | (() => void),
    },
    {
      key: "share",
      icon: Share2,
      color: "text-blue-400",
      bgColor: "bg-blue-500/10",
      label: "分享给好友",
      reward: "+10 💎",
      done: status?.share ?? false,
      action: handleShare,
    },
    {
      key: "invite",
      icon: Users,
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
      label: "好友成功注册",
      reward: `已邀请 ${status?.inviteTotal ?? 0} 人 · 双方+3天`,
      done: (status?.inviteTotal ?? 0) > 0,
      action: null as null | (() => void),
    },
  ]

  return (
    <div
      className={cn("anim-card rounded-2xl border p-5 flex flex-col", className)}
      style={{ background: "var(--surface-alt)", borderColor: "var(--surface-border)" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base">📋</span>
        <h3 className="text-sm font-semibold text-foreground/70">每日任务</h3>
      </div>

      <div className="space-y-3">
        {tasks.map(({ key, icon: Icon, color, bgColor, label, reward, done, action }) => (
          <div
            key={key}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-3 transition-colors",
              done ? "opacity-60" : "opacity-100"
            )}
            style={{ background: "var(--surface)", border: "1px solid var(--surface-border)" }}
          >
            <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg shrink-0", bgColor)}>
              <Icon className={cn("h-4 w-4", color)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{reward}</p>
            </div>
            {action ? (
              done ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              ) : (
                <button
                  onClick={action}
                  disabled={sharing}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}
                >
                  {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "去分享"}
                </button>
              )
            ) : done ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground/30 shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
