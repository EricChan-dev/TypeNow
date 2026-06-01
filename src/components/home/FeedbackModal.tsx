"use client"

import { useState } from "react"
import { X, MessageSquarePlus } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const CATEGORIES = [
  { value: "bug", label: "🐛 Bug 反馈" },
  { value: "feature", label: "✨ 功能建议" },
  { value: "suggestion", label: "💡 使用建议" },
  { value: "other", label: "📝 其他" },
] as const

interface FeedbackModalProps {
  open: boolean
  onClose: () => void
}

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState<string>("suggestion")
  const [content, setContent] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  async function handleSubmit() {
    if (!content.trim()) { toast.error("请填写反馈内容"); return }
    setSubmitting(true)
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, content }),
      })
      if (res.ok) {
        toast.success("感谢您的反馈！我们会认真改进 🙏")
        setContent("")
        onClose()
      } else {
        const data = await res.json()
        toast.error(data.error ?? "提交失败，请稍后重试")
      }
    } catch {
      toast.error("网络错误，请稍后重试")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-violet-500/15">
            <MessageSquarePlus className="h-5 w-5 text-violet-500" />
          </div>
          <h2 className="text-base font-semibold text-foreground">用户反馈</h2>
        </div>

        {/* Category */}
        <div className="flex flex-wrap gap-2 mb-4">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                category === c.value
                  ? "bg-violet-500/20 text-violet-500 border-violet-500/40"
                  : "bg-muted text-muted-foreground border-transparent hover:border-border"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Text area */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, 500))}
          placeholder="请描述您的问题或建议，我们会认真阅读每一条反馈…"
          className="w-full h-32 resize-none rounded-xl bg-muted border border-border px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-violet-500/50 transition"
        />
        <p className="text-xs text-muted-foreground/50 text-right mt-1">{content.length}/500</p>

        <button
          onClick={handleSubmit}
          disabled={submitting || !content.trim()}
          className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
        >
          {submitting ? "提交中…" : "提交反馈"}
        </button>
      </div>
    </div>
  )
}
