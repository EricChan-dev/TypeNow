"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"

interface SubRecord {
  id: string
  plan: string
  status: string
  startsAt: string
  expiresAt: string
}

const PLAN_LABELS: Record<string, string> = {
  monthly: "月度会员",
  yearly: "年度会员",
  partner: "永久会员",
  trial: "体验会员",
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: "生效中", className: "text-green-600 dark:text-green-400" },
  expired: { label: "已到期", className: "text-muted-foreground" },
  cancelled: { label: "已取消", className: "text-red-500" },
}

function formatDate(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function MembershipHistory() {
  const [rows, setRows] = useState<SubRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/user/subscriptions")
      .then((r) => r.json())
      .then(({ data }) => setRows(data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">加载中…</span>
      </div>
    )
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">暂无订阅记录</p>
  }

  return (
    <div className="divide-y divide-border">
      {rows.map((row) => {
        const status = STATUS_LABELS[row.status] ?? { label: row.status, className: "text-muted-foreground" }
        return (
          <div key={row.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
            <div>
              <p className="text-sm font-medium text-foreground">{PLAN_LABELS[row.plan] ?? row.plan}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDate(row.startsAt)} → {row.expiresAt ? formatDate(row.expiresAt) : "永久"}
              </p>
            </div>
            <span className={`text-xs font-semibold ${status.className}`}>{status.label}</span>
          </div>
        )
      })}
    </div>
  )
}
