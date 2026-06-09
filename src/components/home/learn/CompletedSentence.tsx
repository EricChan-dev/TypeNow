"use client"

import { useState } from "react"
import type { Word, Phonetic } from "@/types"
import { WordDetailPopover } from "./WordDetailPopover"

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

const POS_COLOR: Record<string, string> = {
  // 中文词性（兼容旧数据）
  "代词":    "rgba(251,146,60,0.7)",   // amber
  "动词":    "rgba(239,68,68,0.7)",    // red
  "助动词":  "rgba(59,130,246,0.7)",   // blue
  "情态动词":"rgba(59,130,246,0.7)",
  "不定式":  "rgba(30,64,175,0.7)",    // dark-blue
  "形容词":  "rgba(139,92,246,0.7)",   // violet
  "名词":    "rgba(37,99,235,0.7)",    // blue-600
  "专有名词":"rgba(16,185,129,0.7)",   // emerald
  "人名":    "rgba(16,185,129,0.7)",
  "冠词":    "rgba(13,148,136,0.7)",   // teal
  "限定词":  "rgba(13,148,136,0.7)",
  "数词":    "rgba(13,148,136,0.7)",
  "副词":    "rgba(8,145,178,0.7)",    // cyan
  "介词":    "rgba(75,85,99,0.7)",     // gray
  "并列连词":"rgba(109,40,217,0.7)",   // purple
  "从属连词":"rgba(109,40,217,0.7)",
  "连词":    "rgba(109,40,217,0.7)",
  "感叹词":  "rgba(219,39,119,0.7)",   // pink
  "助词":    "rgba(75,85,99,0.7)",
  // 英文词性（句乐部导入）
  "NOUN":    "#3b82f6",                // 名词 → 蓝色
  "VERB":    "#22c55e",                // 动词 → 绿色
  "ADJ":     "#a855f7",                // 形容词 → 紫色
  "ADV":     "#eab308",                // 副词 → 黄色
  "PRON":    "#ef4444",                // 代词 → 红色
  "ADP":     "#6366f1",                // 介词 → 靛蓝
  "CONJ":    "#ec4899",                // 连词 → 粉色
  "INTJ":    "#f97316",                // 感叹词 → 橙色
  "DET":     "#14b8a6",                // 限定词/冠词 → 青色
  "AUX":     "#22c55e",                // 助动词 → 绿色
  "PROPN":   "#3b82f6",                // 专有名词 → 蓝色
  "NUM":     "#a855f7",                // 数词 → 紫色
  "PART":    "#6b7280",                // 小品词 → 灰色
}

const POS_LABEL: Record<string, string> = {
  "不定式": "不定式标记",
  "助词":   "助词",
}

function getBg(pos: string) {
  return POS_COLOR[pos] ?? "rgba(75,85,99,0.7)"
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
              className={`${phoneticClass} text-white/45 font-mono leading-none`}
              title={phoneticAlt(word.phonetic) ? `美式: ${phoneticAlt(word.phonetic)}` : undefined}
            >
              {phoneticDisplay(word.phonetic)}
            </span>

            {/* Word chip */}
            <span
              className={`${wordClass} font-bold text-white leading-snug rounded-xl px-3 py-0.5 transition-all duration-150 select-none cursor-pointer ${
                isHov ? "brightness-125 scale-105" : ""
              }`}
              style={{ backgroundColor: getBg(word.pos) }}
            >
              {word.english}
            </span>

            {/* POS label */}
            <span className={`${labelClass} font-semibold text-white/60 mt-0.5 bg-white/10 border border-white/10 rounded-full px-2.5 py-0.5`}>
              {POS_LABEL[word.pos] ?? word.pos}
            </span>

            {/* Chinese */}
            <span className={`${labelClass} font-medium text-white/75`}>
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
