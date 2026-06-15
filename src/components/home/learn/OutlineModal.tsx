"use client"

import { useState } from "react"
import { X, Play } from "lucide-react"
import type { Sentence } from "@/types"

interface OutlineModalProps {
  sentences: Sentence[]
  currentIndex: number
  onClose: () => void
  onJumpTo: (index: number) => void
}

export function OutlineModal({ sentences, currentIndex, onClose, onJumpTo }: OutlineModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(currentIndex)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[95vw] max-w-2xl h-[85vh] rounded-2xl bg-card border border-border shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 px-6 py-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">内容大纲</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-foreground/40 hover:text-foreground hover:bg-foreground/10 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body: sentence list only */}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto">
            {sentences.map((s, i) => (
              <div
                key={s.id}
                className={`flex items-center group border-b border-foreground/5 transition-colors ${
                  i === selectedIndex
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-foreground/5 border-l-2 border-l-transparent"
                } ${i === currentIndex ? "ring-1 ring-inset ring-accent/20" : ""}`}
              >
                <button
                  onClick={() => setSelectedIndex(i)}
                  className="flex-1 text-left px-5 py-3.5 min-w-0"
                >
                  <span className="text-xs text-foreground/30 mr-2">{i + 1}.</span>
                  <span className={`text-sm ${i === selectedIndex ? "text-foreground font-medium" : "text-foreground/60"}`}>
                    {s.english}
                  </span>
                  {i === currentIndex && (
                    <span className="ml-2 text-[10px] text-accent/60 font-medium">当前</span>
                  )}
                </button>
                <button
                  onClick={() => { onJumpTo(i); onClose() }}
                  className={`shrink-0 px-3 py-3.5 transition-all ${
                    i === currentIndex
                      ? "text-accent"
                      : "text-foreground/15 opacity-0 group-hover:opacity-100 group-hover:text-foreground/50 hover:!text-accent"
                  }`}
                  title="从这句开始"
                >
                  <Play className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end shrink-0 px-6 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="rounded-xl bg-accent px-6 py-2 text-sm font-semibold text-foreground hover:bg-accent/90 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
