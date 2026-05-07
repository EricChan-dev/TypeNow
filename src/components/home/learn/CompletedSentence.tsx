"use client"

import type { Word } from "@/types"

function getColorByPos(pos: string): string {
  switch (pos) {
    case "代词": return "rgba(180, 83, 9, 0.5)"
    case "动词": return "rgba(185, 28, 28, 0.5)"
    case "助动词":
    case "情态动词":
    case "不定式": return "rgba(30, 64, 175, 0.5)"
    case "形容词": return "rgba(124, 58, 237, 0.5)"
    case "名词": return "rgba(29, 78, 216, 0.5)"
    case "冠词":
    case "数词": return "rgba(13, 148, 136, 0.5)"
    case "副词": return "rgba(8, 145, 178, 0.5)"
    case "介词": return "rgba(75, 85, 99, 0.5)"
    case "连词": return "rgba(109, 40, 217, 0.5)"
    case "感叹词": return "rgba(219, 39, 119, 0.5)"
    default: return "rgba(75, 85, 99, 0.5)"
  }
}

function getPosLabel(pos: string): string {
  if (pos === "不定式") return "(引导不定式)"
  return pos
}

interface CompletedSentenceProps {
  words: Word[]
  small?: boolean
}

export function CompletedSentence({ words, small }: CompletedSentenceProps) {
  const phoneticClass = small ? "text-base" : "text-xl"
  const wordClass = small ? "text-3xl" : "text-6xl"
  const labelClass = small ? "text-[11px]" : "text-sm"
  const gapClass = small ? "gap-x-2 gap-y-3" : "gap-x-4 gap-y-6"
  const placeholderClass = small ? "scale-75" : ""

  return (
    <div className={`flex flex-wrap justify-center items-end ${gapClass}`}>
      {words.map((word, i) =>
        word.pos === "标点" ? (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <span className={`${phoneticClass} text-white/50 leading-none bg-white/20 rounded-[2px] px-1.5 py-0.5 mb-2 invisible ${placeholderClass}`}>.</span>
            <span className={`${wordClass} font-bold text-foreground leading-snug rounded-lg px-2`}>
              {word.english}
            </span>
            <span className={`${labelClass} font-bold text-white/80 mt-1.5 bg-white/15 border border-white/10 rounded-full px-3 py-0.5 invisible ${placeholderClass}`}>.</span>
            <span className={`${labelClass} font-bold text-white/85 invisible`}>.</span>
          </div>
        ) : (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <span className={`${phoneticClass} text-white/50 leading-none bg-white/20 rounded-[2px] px-1.5 py-0.5 mb-2`}>
              {word.phonetic}
            </span>
            <span
              className={`${wordClass} font-bold text-white leading-snug rounded-lg px-2`}
              style={{ backgroundColor: getColorByPos(word.pos) }}
            >
              {word.english}
            </span>
            <span className={`${labelClass} font-bold text-white/80 mt-1.5 bg-white/15 border border-white/10 rounded-full px-3 py-0.5`}>
              {getPosLabel(word.pos)}
            </span>
            <span className={`${labelClass} font-bold text-white/85`}>
              {word.chinese || ""}
            </span>
          </div>
        )
      )}
    </div>
  )
}
