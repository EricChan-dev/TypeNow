"use client"

import { useState } from "react"
import type { Word, Phonetic } from "@/types"
import { WordDetailPopover } from "./WordDetailPopover"
import { getPosColor } from "@/lib/pos-color"

/** 提取 phonetic 展示字符串：兼容 string 和 {uk,us} 两种格式 */
function phoneticDisplay(phonetic: Word["phonetic"]): string {
  if (!phonetic) return " "
  if (typeof phonetic === "string") return phonetic
  // {uk, us} object — 默认显示英式，hover 显示美式
  return phonetic.uk || phonetic.us || " "
}

function phoneticAlt(phonetic: Word["phonetic"]): string | null {
  if (!phonetic || typeof phonetic === "string") return null
  return phonetic.us && phonetic.us !== phonetic.uk ? phonetic.us : null
}

interface CompletedSentenceProps {
  words: Word[]
  small?: boolean
  sentenceId?: string
}

export function CompletedSentence({ words, small, sentenceId }: CompletedSentenceProps) {
  const [hovered, setHovered] = useState<number | null>(null)

  const phoneticClass = small ? "text-sm" : "text-lg"
  const wordClass    = small ? "text-3xl" : "text-5xl"
  const labelClass   = small ? "text-[11px]" : "text-[13px]"
  const gapClass     = small ? "gap-x-2 gap-y-3" : "gap-x-5 gap-y-6"

  return (
    <div className={`flex flex-wrap justify-center items-end ${gapClass}`}>
      {words.map((word, i) => {
        const isPunct = word.pos === "标点"
        const isHov   = hovered === i && !isPunct

        if (isPunct) {
          return (
            <div key={i} className="flex flex-col items-center gap-1.5 self-end pb-1">
              {!small && <span className="invisible text-lg">.</span>}
              <span className={`${wordClass} font-bold text-foreground/70`}>{word.english}</span>
              {!small && <span className="invisible text-[13px]">.</span>}
              {!small && <span className="invisible text-[13px]">.</span>}
            </div>
          )
        }

        const wordBlock = (
          <div
            className="relative flex flex-col items-center gap-1.5"
            onMouseEnter={() => !small && setHovered(i)}
            onMouseLeave={() => !small && setHovered(null)}
          >
            {/* Phonetic — 兼容 string 和 {uk,us} */}
            <span
              className={`${phoneticClass} text-foreground/45 font-mono leading-none`}
              title={phoneticAlt(word.phonetic) ? `美式: ${phoneticAlt(word.phonetic)}` : undefined}
            >
              {phoneticDisplay(word.phonetic)}
            </span>

            {/* Word chip */}
            <span
              className={`${wordClass} font-bold text-white leading-snug rounded-xl px-3 py-0.5 transition-all duration-150 select-none cursor-pointer ${
                isHov ? "brightness-125 scale-105" : ""
              }`}
              style={{ backgroundColor: getPosColor(word.pos) }}
            >
              {word.english}
            </span>

            {/* POS label */}
            <span className={`${labelClass} font-semibold text-foreground/60 mt-0.5 bg-foreground/10 border border-foreground/10 rounded-full px-2.5 py-0.5`}>
              {word.pos}
            </span>

            {/* Chinese */}
            <span className={`${labelClass} font-medium text-foreground/75`}>
              {word.chinese || ""}
            </span>
          </div>
        )

        if (small) return <div key={i}>{wordBlock}</div>

        return (
          <WordDetailPopover key={i} word={word.english} sentenceId={sentenceId}>
            {wordBlock}
          </WordDetailPopover>
        )
      })}
    </div>
  )
}
