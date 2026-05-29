"use client"

import { useState } from "react"
import { X, Target, Volume2 } from "lucide-react"
import { toast } from "sonner"

interface Props {
  open: boolean
  onClose: () => void
  initialGoal?: number
}

type Tab = "sound" | "checkin"

const TABS = [
  { id: "checkin" as Tab, icon: Target, label: "打卡设置" },
  { id: "sound" as Tab, icon: Volume2, label: "声音" },
]

export function GlobalSettingsModal({ open, onClose, initialGoal = 50 }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("checkin")
  const [goal, setGoal] = useState(initialGoal)
  const [saving, setSaving] = useState(false)

  if (!open) return null

  async function saveGoal() {
    const val = Math.round(goal)
    if (val < 10 || val > 300) {
      toast.error("目标值须在 10~300 之间")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkInGoal: val }),
      })
      if (!res.ok) {
        const d = await res.json()
        toast.error(d.error ?? "保存失败")
      } else {
        toast.success("签到目标已更新")
      }
    } catch {
      toast.error("网络错误，请重试")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[560px] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--card)", border: "1px solid var(--border)", maxHeight: "90vh" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2 className="text-[16px] font-bold text-foreground">设置</h2>
          <button
            onClick={onClose}
            className="text-foreground/30 hover:text-foreground/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div
            className="w-40 shrink-0 py-3 flex flex-col gap-1"
            style={{ borderRight: "1px solid var(--border)", background: "var(--muted)/30" }}
          >
            {TABS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors text-left mx-2 rounded-lg"
                style={
                  activeTab === id
                    ? { background: "var(--accent)", color: "var(--accent-foreground)" }
                    : { color: "var(--muted-foreground)" }
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "checkin" && (
              <div className="flex flex-col gap-5">
                <div>
                  <h3 className="font-semibold text-foreground mb-1">每日签到钻石目标</h3>
                  <p className="text-sm text-muted-foreground">
                    当天获得的钻石达到此数量后，才可完成签到打卡
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">目标值</span>
                    <span className="text-2xl font-black text-violet-400">{goal} 💎</span>
                  </div>

                  <input
                    type="range"
                    min={10}
                    max={300}
                    step={5}
                    value={goal}
                    onChange={(e) => setGoal(Number(e.target.value))}
                    className="w-full accent-violet-500"
                  />

                  <div className="flex justify-between text-[11px] text-muted-foreground/60">
                    <span>轻松 (10)</span>
                    <span>均衡 (50)</span>
                    <span>进阶 (150)</span>
                    <span>挑战 (300)</span>
                  </div>
                </div>

                <div
                  className="rounded-xl px-4 py-3"
                  style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}
                >
                  <p className="text-[13px] text-foreground/70 leading-relaxed">
                    💡 练习 <strong className="text-violet-400">{Math.ceil(goal / 5)}</strong> 句以上（含连击加成）可达成目标
                  </p>
                </div>

                <button
                  onClick={saveGoal}
                  disabled={saving}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
                >
                  {saving ? "保存中…" : "保存设置"}
                </button>
              </div>
            )}

            {activeTab === "sound" && (
              <div className="flex flex-col gap-5">
                <div>
                  <h3 className="font-semibold text-foreground mb-1">声音设置</h3>
                  <p className="text-sm text-muted-foreground">控制练习中的音效与朗读</p>
                </div>
                <div className="text-sm text-muted-foreground/60 text-center py-8">
                  声音偏好设置即将开放
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
