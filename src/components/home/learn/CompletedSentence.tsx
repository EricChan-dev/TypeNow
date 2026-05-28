"use client"

import { useState } from "react"
import type { Word } from "@/types"

const POS_COLOR: Record<string, string> = {
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
}

const POS_LABEL: Record<string, string> = {
  "不定式": "不定式标记",
  "助词":   "助词",
}

const POS_ROLE: Record<string, { role: string; desc: string }> = {
  "代词":    { role: "代词",      desc: "代替名词，指代人或事物，避免重复" },
  "动词":    { role: "动词",      desc: "表示动作、状态或变化，通常作谓语" },
  "助动词":  { role: "助动词",    desc: "帮助构成时态、语态或疑问句" },
  "情态动词":{ role: "情态动词",  desc: "表示可能、能力、义务等情态意义" },
  "不定式":  { role: "不定式标记",desc: "引导不定式短语（to + 动词原形），表目的、结果等" },
  "形容词":  { role: "形容词",    desc: "描述名词的性质或特征，作定语或表语" },
  "名词":    { role: "名词",      desc: "表示人、事物、地点或抽象概念" },
  "专有名词":{ role: "专有名词",  desc: "特指某一具体的人、地点或机构" },
  "人名":    { role: "人名",      desc: "特指某人的名字" },
  "冠词":    { role: "冠词",      desc: "限定名词，the 特指，a/an 泛指" },
  "限定词":  { role: "限定词",    desc: "限定名词的数量、范围或所属" },
  "数词":    { role: "数词",      desc: "表示数量（基数）或顺序（序数）" },
  "副词":    { role: "副词",      desc: "修饰动词、形容词或其他副词，表方式/程度/时间等" },
  "介词":    { role: "介词",      desc: "引导介词短语，表示时间、地点、方式等关系" },
  "并列连词":{ role: "并列连词",  desc: "连接并列成分，如 and / but / or" },
  "从属连词":{ role: "从属连词",  desc: "引导从句，如 because / when / if / that" },
  "连词":    { role: "连词",      desc: "连接词、短语或句子" },
  "感叹词":  { role: "感叹词",    desc: "表达情感或呼唤，不参与句子语法结构" },
  "助词":    { role: "助词",      desc: "语法功能词，辅助构成句法结构" },
}

function getBg(pos: string) {
  return POS_COLOR[pos] ?? "rgba(75,85,99,0.7)"
}

interface CompletedSentenceProps {
  words: Word[]
  small?: boolean
}

export function CompletedSentence({ words, small }: CompletedSentenceProps) {
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
        const roleInfo = POS_ROLE[word.pos]

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

        return (
          <div
            key={i}
            className="relative flex flex-col items-center gap-1.5"
            onMouseEnter={() => !small && setHovered(i)}
            onMouseLeave={() => !small && setHovered(null)}
          >
            {/* Phonetic */}
            <span className={`${phoneticClass} text-white/45 font-mono leading-none`}>
              {word.phonetic || " "}
            </span>

            {/* Word chip */}
            <span
              className={`${wordClass} font-bold text-white leading-snug rounded-xl px-3 py-0.5 transition-all duration-150 select-none ${
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

            {/* Hover tooltip */}
            {isHov && roleInfo && (
              <div
                className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 z-50
                  w-48 rounded-xl border border-white/10 bg-[#1a1a2e]/95 backdrop-blur-sm
                  px-3.5 py-2.5 shadow-2xl pointer-events-none"
              >
                {/* Arrow */}
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 rounded-sm border-b border-r border-white/10 bg-[#1a1a2e]" />

                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: getBg(word.pos) }}
                  />
                  <span className="text-[13px] font-bold text-white/90">{roleInfo.role}</span>
                </div>
                <p className="text-[11px] text-white/55 leading-relaxed">{roleInfo.desc}</p>
                {word.chinese && (
                  <p className="text-[12px] font-semibold text-white/80 mt-1.5 pt-1.5 border-t border-white/8">
                    {word.chinese}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
