export interface MasteryInput {
  status: string
  intervalDays: number
}

export interface MasteryLabel {
  label: string
  color: string
}

export function masteryLabel(item: MasteryInput): MasteryLabel {
  if (item.status === "done") {
    return { label: "已掌握", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" }
  }
  if (item.intervalDays >= 6) {
    return { label: "接近掌握", color: "text-violet-400 bg-violet-500/10 border-violet-500/30" }
  }
  if (item.intervalDays >= 2) {
    return { label: "复习中", color: "text-blue-400 bg-blue-500/10 border-blue-500/30" }
  }
  return { label: "初学", color: "text-foreground/50 bg-foreground/5 border-foreground/15" }
}

export function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / 86400000)
  if (diffDays <= 0) return "今日"
  if (diffDays === 1) return "明日"
  return `${diffDays} 天后`
}

/**
 * Generates a random 4-digit suffix (1000-9999).
 */
export function randomSuffix(): number {
  return Math.floor(1000 + Math.random() * 9000)
}

export function defaultName(type: "phone" | "wechat"): string {
  const suffix = randomSuffix()
  return type === "wechat" ? `微信用户${suffix}` : `用户${suffix}`
}
