"use client"

import { useSyncExternalStore } from "react"
import { isSpeaking, subscribeSpeaking } from "@/lib/hooks/useTTSSettings"
import { cn } from "@/lib/utils"

/**
 * 发音时的声纹可视化（练习页底部、快捷键提示上方）。
 *
 * ── 为什么能"和发音时间一致" ────────────────────────────────────────────────
 *
 * 不自己计时：订阅 useTTSSettings 的 speaking。那个状态是在**音频真正开始播放**
 * 时置 true、在 ended / error / 被 stopSpeaking() 打断时置 false，
 * 所以动画的起止就是播放的起止。若改用固定时长的动画，长句会提前停、
 * 短句会拖尾，久而久之就成了"这个波形是假的"。
 *
 * ── 静息态为什么留着淡柱子 ─────────────────────────────────────────────────
 *
 * 若发声时才渲染整块，每次发音都会撑开/收起底部一行、把下面的快捷键挤动。
 * 所以容器高度恒定，静息态是暗色的扁平柱子，发声时它们变亮并跳动 ——
 * 既没有布局跳动，也一眼能看出"现在有没有在响"。
 */

/** 各柱的高度系数：中间高两边低，避免看起来像等宽的进度条 */
const BAR_HEIGHTS = [0.34, 0.58, 0.8, 1, 0.86, 0.66, 0.92, 1, 0.72, 0.5, 0.3]
/** 每根柱子错开的延迟，制造流动感 */
const BAR_DELAYS = [0, 0.12, 0.24, 0.06, 0.3, 0.18, 0.36, 0.09, 0.27, 0.15, 0.33]

export function Voiceprint() {
  const speaking = useSyncExternalStore(
    subscribeSpeaking,
    isSpeaking,
    // 服务端渲染期间一律按"没有发声"渲染，保证首帧一致
    () => false,
  )

  return (
    <div
      className="flex items-center justify-center gap-[3px] h-7 sm:h-8 shrink-0 px-3"
      role="status"
      aria-live="off"
      aria-label={speaking ? "正在发声" : undefined}
    >
      {BAR_HEIGHTS.map((height, i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full transition-colors duration-200",
            speaking ? "animate-voiceprint bg-accent" : "bg-foreground/15",
          )}
          style={{
            height: `${Math.round(height * 100)}%`,
            animationDelay: speaking ? `${BAR_DELAYS[i]}s` : undefined,
          }}
        />
      ))}
    </div>
  )
}
