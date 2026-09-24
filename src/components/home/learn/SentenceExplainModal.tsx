"use client"

import { useState } from "react"
import { X, AlertTriangle, Sparkles, MessageCircle } from "lucide-react"
import type { Sentence } from "@/types"
import { SentenceKnowledge } from "@/components/home/learn/SentenceKnowledge"
import { requestOpenAiChat } from "@/lib/ai-chat"

interface SentenceExplainModalProps {
  sentence: Sentence
  /** 本句是否已经完成 / 已看过答案。 */
  revealed: boolean
  onClose: () => void
}

/**
 * AI 句子讲解弹窗（Ctrl+/）。
 *
 * 这是 `SentenceKnowledge.tsx` 的**第一个调用方** —— 那个组件写完之后全库零引用，
 * 一直是死代码，而它做的恰好就是「针对当前句子的讲解」。
 *
 * 为什么不直接把 AI 助手的浮窗按钮放到练习页：练习页是全屏沉浸界面，
 * 右下角的浮窗会盖住快捷键提示和题目区，用户每敲一句都被挡一次。所以按钮仍然
 * 隐藏，改由 Ctrl+/ 进入；需要自由问答时，从这里一键唤醒 layout 上的助手面板。
 *
 * 与语法树同理：讲解里含整句英文，未完成时必须先确认一次再展示。
 */
export function SentenceExplainModal({ sentence, revealed, onClose }: SentenceExplainModalProps) {
  const [confirmed, setConfirmed] = useState(revealed)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[95vw] max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <h2 className="text-lg font-bold text-foreground">AI 讲解</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!confirmed ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <AlertTriangle className="h-9 w-9 text-amber-400/70" />
              <p className="text-base font-semibold text-foreground">讲解里会给出整句英文</p>
              <p className="max-w-sm text-sm text-foreground/45">
                中文解释、语法分析、例句都会直接引用原句。想自己先打完，就先关掉这里。
              </p>
              <button
                onClick={() => setConfirmed(true)}
                className="mt-1 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-accent/90"
              >
                仍然查看
              </button>
            </div>
          ) : (
            <SentenceKnowledge sentence={sentence} />
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-3">
          <button
            onClick={() => {
              onClose()
              requestOpenAiChat()
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground/70 transition-colors hover:bg-muted"
          >
            <MessageCircle className="h-4 w-4" />
            问小码 AI 老师
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-accent px-6 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent/90"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
