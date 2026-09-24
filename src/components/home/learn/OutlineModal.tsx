"use client"

import { useState } from "react"
import { X, Play } from "lucide-react"
import type { Sentence } from "@/types"

interface OutlineModalProps {
  sentences: Sentence[]
  currentIndex: number
  onClose: () => void
  onJumpTo: (index: number) => void
  /**
   * 本次练习里已经做完的句子 id。
   *
   * 这个弹窗原先对每一句都直接渲染 `s.english` —— 也就是把整节课的答案
   * 一次性摊在用户面前，「大纲」变成了「答案册」。练习页其它地方
   * （语法树、句子解析）都设了剧透闸门，这里漏一个就等于全白设。
   * 现在只对已完成（或当前正在做）的句子显示英文，其余显示中文题干。
   */
  revealedIds?: Set<string>
}

export function OutlineModal({ sentences, currentIndex, onClose, onJumpTo, revealedIds }: OutlineModalProps) {
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
            {sentences.map((s, i) => {
              // 只认「做完过」的记录，不用 `i < currentIndex` 也不要放行当前句：
              //   - 下标不可靠：跳着练、回头练、打乱之后 i 与进度已经对不上；
              //   - 当前句的英文此刻在题面上是**藏着**的（只有中文题干和词格），
              //     放行它等于让用户按一下 Ctrl+1 就看到正在做的这句答案。
              const revealed = !!revealedIds?.has(s.id)
              return (
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
                  <span className={`text-sm ${i === selectedIndex ? "text-foreground font-medium" : revealed ? "text-foreground/60" : "text-foreground/40"}`}>
                    {revealed ? s.english : s.chinese}
                  </span>
                  {i === currentIndex && (
                    <span className="ml-2 text-[10px] text-accent/60 font-medium">当前</span>
                  )}
                  {!revealed && i !== currentIndex && (
                    <span className="ml-2 text-[10px] text-foreground/25 font-medium">未练</span>
                  )}
                  {revealed && i !== currentIndex && (
                    <span className="ml-2 text-[10px] text-emerald-400/50 font-medium">已完成</span>
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
              )
            })}
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
