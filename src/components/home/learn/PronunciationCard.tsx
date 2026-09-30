"use client"

import { scoreColor } from "@/lib/pronunciation"

/**
 * 关闭弹窗后留在练习页上的评分卡片。
 *
 * 有历史分时也用它（附「3 天前」），见设计 §3.6。
 *
 * scoreColor 从 lib/pronunciation 取，**不在这里再抄一份色表**：色值与阈值
 * 一旦在组件间各留一份就会各自漂移（对比 lib/pos-color 的由来）。
 */
interface PronunciationCardProps {
  score: number
  /** 三个维度可空：null = 有道没给这个字段，显示「—」而不是 0。 */
  accuracy: number | null
  fluency: number | null
  integrity: number | null
  /** 已经有值时会显示「3 天前」这种相对时间。 */
  updatedAt?: Date | null
  onClick: () => void
}

/**
 * 相对时间。只给到"天" —— 更细的粒度（几分钟前、几小时前）对"上次跟读是什么时候"
 * 这个问题没有意义，本组件刻意比仓库里其它的相对时间函数粗一档。
 *
 * 按**日历日**算而不是按 24 小时块：昨天 23:00 录的，今天 22:00 看是 23 小时前，
 * 按小时块会显示成「刚刚」—— 用户昨天明明练过。先各自归零到当天 0 点再相减。
 * 将来时间戳（时钟偏移）会得到负数，一并落在「刚刚」，不显示"-1 天前"。
 */
function relativeDay(d: Date): string {
  const startOfDay = (t: number) => {
    const x = new Date(t)
    x.setHours(0, 0, 0, 0)
    return x.getTime()
  }
  const days = Math.round((startOfDay(Date.now()) - startOfDay(d.getTime())) / 86_400_000)
  if (days <= 0) return "刚刚"
  if (days === 1) return "昨天"
  return `${days} 天前`
}

export function PronunciationCard({
  score,
  accuracy,
  fluency,
  integrity,
  updatedAt,
  onClick,
}: PronunciationCardProps) {
  const color = scoreColor(score)
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-accent/60 bg-accent/5 px-3.5 py-3 text-left transition-colors hover:bg-accent/10"
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] text-sm font-black tabular-nums"
        style={{ borderColor: color, color }}
      >
        {score}
      </span>
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block text-sm font-semibold text-foreground">跟读评分 {score}</span>
        <span className="block text-xs text-muted-foreground">
          准确 {accuracy ?? "—"} · 流利 {fluency ?? "—"} · 完整 {integrity ?? "—"}
          {updatedAt ? ` · ${relativeDay(updatedAt)}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-accent">查看详情 ›</span>
    </button>
  )
}
