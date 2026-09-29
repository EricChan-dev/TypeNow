"use client"

import { X } from "lucide-react"

interface Props {
  open: boolean
  onClose: () => void
  /** 今日已练习的**句数**（不是钻石 —— 门槛语义见 lib/coins.ts） */
  todaySentences: number
  checkInGoal: number
  onOpenSettings: () => void
}

/**
 * 签到打卡规则。
 *
 * 2026-09-29：门槛从「当日累积钻石数」改为「当日练习句数」。
 * 文案里的单位必须跟着改 —— 继续写「颗钻石」会和接口判定完全对不上，
 * 用户会以为自己达标了却打不上卡。
 */
export function CheckInRulesModal({ open, onClose, todaySentences, checkInGoal, onOpenSettings }: Props) {
  if (!open) return null

  const progress = checkInGoal > 0 ? Math.min(100, Math.round((todaySentences / checkInGoal) * 100)) : 0
  const remaining = Math.max(0, checkInGoal - todaySentences)
  const done = todaySentences >= checkInGoal

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[360px] rounded-2xl overflow-hidden shadow-2xl"
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
            style={{ background: done ? "rgba(34,197,94,0.15)" : "rgba(124,58,237,0.15)" }}
          >
            {done ? "✅" : "📅"}
          </div>
          <h2 className="text-[18px] font-bold text-foreground">签到打卡规则</h2>
          <p className="text-sm text-muted-foreground text-center">
            当天练够目标句数，即可打卡签到
          </p>
        </div>

        {/* Progress */}
        <div className="px-6 pb-5">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="text-muted-foreground">今日进度</span>
            <span className="font-bold">
              <span className={done ? "text-emerald-400" : "text-violet-400"}>{todaySentences}</span>
              <span className="text-muted-foreground"> / {checkInGoal} 句</span>
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background: done
                  ? "linear-gradient(90deg, #22c55e, #16a34a)"
                  : "linear-gradient(90deg, #7c3aed, #a855f7)",
              }}
            />
          </div>
          {done ? (
            <p className="text-emerald-400 text-xs mt-2 font-semibold text-center">
              🎉 目标达成！可以签到打卡了
            </p>
          ) : (
            <p className="text-muted-foreground text-xs mt-2 text-center">
              还差 <span className="text-amber-400 font-bold">{remaining}</span> 句可签到
            </p>
          )}
        </div>

        {/* Rule explanation */}
        <div
          className="mx-5 mb-5 rounded-xl px-4 py-3"
          style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}
        >
          <p className="text-[13px] text-foreground/75 leading-relaxed">
            💡 打卡要求的是**当天练习的句子数**（练一遍算一句，同一句重复练不重复计数）。
            目标可以自己设置，默认 10 句。打卡成功后会获得金币奖励，连续打卡每天更多。
          </p>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={onClose}
            className="py-4 text-sm font-medium text-foreground/50 hover:bg-muted/50 transition-colors"
          >
            关闭
          </button>
          <button
            onClick={() => { onClose(); onOpenSettings() }}
            className="py-4 text-sm font-bold text-violet-400 hover:bg-violet-500/10 transition-colors"
          >
            修改目标
          </button>
        </div>
      </div>
    </div>
  )
}
