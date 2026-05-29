"use client"

import { X } from "lucide-react"

interface Props {
  open: boolean
  onClose: () => void
}

const RULES = [
  { action: "练习任意一句（有错误）", diamonds: "5" },
  { action: "完美完成（连击 ×1）", diamonds: "5 + 1 = 6" },
  { action: "完美连击 ×2", diamonds: "5 + 2 = 7" },
  { action: "完美连击 ×N", diamonds: "5 + N（最多 +20）" },
  { action: "完成章节", diamonds: "+30" },
  { action: "完成课程", diamonds: "+100" },
]

export function DiamondRulesModal({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[380px] rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-foreground/30 hover:text-foreground/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center px-6 pt-8 pb-5 gap-2">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl mb-1"
            style={{ background: "rgba(99,102,241,0.15)" }}
          >
            💎
          </div>
          <h2 className="text-[18px] font-bold text-foreground">钻石获取规则</h2>
          <p className="text-sm text-muted-foreground text-center">
            练习越专注，连击越多，钻石越丰厚
          </p>
        </div>

        <div className="px-6 pb-2">
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <div
              className="grid grid-cols-2 px-4 py-2 text-[11px] font-bold text-muted-foreground uppercase tracking-wider"
              style={{ background: "var(--muted)" }}
            >
              <span>行为</span>
              <span className="text-right">钻石</span>
            </div>
            {RULES.map((r, i) => (
              <div
                key={r.action}
                className="grid grid-cols-2 px-4 py-3 text-sm"
                style={{ borderTop: i === 0 ? undefined : "1px solid var(--border)" }}
              >
                <span className="text-foreground/75">{r.action}</span>
                <span className="text-right font-semibold text-violet-400">{r.diamonds}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="mx-5 my-5 rounded-xl px-4 py-3"
          style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)" }}
        >
          <p className="text-violet-400 font-bold text-[13px]">🎯 如何使用钻石</p>
          <p className="text-muted-foreground text-xs mt-1 leading-relaxed">
            每日累积钻石达到目标值即可签到打卡，目标值可在设置中自定义（10~300 颗）
          </p>
        </div>

        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={onClose}
            className="w-full py-4 text-sm font-semibold text-foreground/70 hover:bg-muted/50 transition-colors"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}
