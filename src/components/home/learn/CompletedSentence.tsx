"use client"

import { useState } from "react"
import { posLabel } from "@/lib/pos-labels"
import type { Word, Phonetic } from "@/types"
import { WordDetailPopover } from "./WordDetailPopover"
import { wrapPhonetic } from "@/lib/dict-display"
import { getPosColor } from "@/lib/pos-color"

/** 提取 phonetic 展示字符串：兼容 string 和 {uk,us} 两种格式 */
/**
 * 展示用的音标。
 *
 * 一律包进 `/ /`（IPA 惯例）：库里存的 phonetic 大多是 `{uk, us}` 且**不带斜杠**，
 * 直接渲染出来是一串光秃秃的音标符号，看着不像音标也不像单词。
 * wrapPhonetic 是幂等的，所以词典接口那份本就带斜杠的不会被包成 `//x//`。
 *
 * 没音标时返回一个空格（不是空串）：这一列是 grid 的一行，返回空串会让
 * 词块高度塌陷、整行文字上下跳动。
 */
function phoneticDisplay(phonetic: Word["phonetic"]): string {
  if (!phonetic) return " "
  if (typeof phonetic === "string") return wrapPhonetic(phonetic) || " "
  // {uk, us} object — 默认显示英式，hover 显示美式
  return wrapPhonetic(phonetic.uk || phonetic.us) || " "
}

function phoneticAlt(phonetic: Word["phonetic"]): string | null {
  if (!phonetic || typeof phonetic === "string") return null
  if (!phonetic.us || phonetic.us === phonetic.uk) return null
  // hover 提示里的美式音标同样包斜杠，保持与主显示一致
  return wrapPhonetic(phonetic.us)
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
              {posLabel(word.pos)}
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
