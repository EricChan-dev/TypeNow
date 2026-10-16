/**
 * 口语跟读模式的评分口径（纯函数）。
 *
 * ── 为什么单独抽一个模块 ────────────────────────────────────────────────────
 *
 * 这些规则覆盖：分数等级文案、环形进度条颜色、评语、逐词状态阈值。
 * 它们此前混在组件的 DOM 操作中间。抽成纯函数有两个直接好处：
 *
 *   1. 本仓库的 vitest 是 `environment: "node"`（`vitest.config.ts:6`），
 *      **没有 jsdom、也不允许加依赖**（见 AGENTS 约束），组件根本没法单测。
 *      把这些规则抽出来，它们才第一次有了测试覆盖。
 *   2. 组件只负责「什么时候显示」，不负责「显示成什么」。
 *
 * ── 分数口径 ────────────────────────────────────────────────────
 *
 * `EvaluateResult` 来自有道（`lib/pronunciation.ts` 的 `mapYoudaoEvaluate`），
 * 有道的 `pronunciation` 本来就是 **0–100** 百分制 —— 这里**不要**再乘 20，
 * 否则会把 80 分变成 1600 分。
 */

import type { EvaluateResult } from "@/lib/pronunciation"

/** 分数 → 等级文案与样式类。 */
export function getSpeakingScoreLevel(score: number): { text: string; className: string } {
  if (score >= 90) return { text: "Outstanding", className: "excellent" }
  if (score >= 80) return { text: "Excellent", className: "good" }
  if (score >= 60) return { text: "Good", className: "fair" }
  return { text: "Keep Trying", className: "poor" }
}

/**
 * 分数对应的颜色。
 *
 * 返回的是 **CSS 变量名**，不是色值 —— 主题有三套（深色/浅色/护眼），
 * 变量表写在 `.practice-shell[data-theme=…]` 上，硬编码色值在浅色主题下
 * 会是一团看不清的霓虹。
 *
 * 特别提醒：**不要**改用 `lib/pronunciation.ts` 的 `scoreColor()`
 * （`:91`）—— 那个返回硬编码 hex，是给内联口语条的弹窗用的，两处色表
 * 不同源正是文档里点名过的漂移风险。
 */
export function getScoreColor(score: number): string {
  if (score >= 90) return "var(--score-excellent)"
  if (score >= 80) return "var(--score-good)"
  if (score >= 60) return "var(--score-fair)"
  return "var(--score-poor)"
}

/** 分数 → 评语文案（五档）。 */
export function getFeedbackMessage(score: number): string {
  if (score >= 90) return "发音完美，甚至超越了原音！"
  if (score >= 80) return "发音清晰，非常地道！"
  if (score >= 70) return "不错，继续保持！"
  if (score >= 60) return "勉强及格，多加练习。"
  return "请大声一点，或者再多听几遍原音。"
}

/**
 * 逐词状态。三段阈值：`< 60` 红（error）、`< 80` 黄（warning）、其余青（correct）；
 * 「漏读」单独一档（`isMissing`），优先级最高。
 */
export type SpeakingWordStatus = "missing" | "error" | "warning" | "correct"

export function speakingWordStatus(totalScore: number, isMissing: boolean): SpeakingWordStatus {
  if (isMissing) return "missing"
  if (totalScore < 60) return "error"
  if (totalScore < 80) return "warning"
  return "correct"
}

/** 逐词的展示数据。 */
export interface SpeakingWordDetail {
  content: string
 /** 百分制（0–100），有道的映射里已换算好。 */
  totalScore: number
 /** 是否漏读（评测没给分的词按漏读处理）。 */
  isMissing: boolean
}

/**
 * 把 `EvaluateResult.words` 映射成逐词展示数据。
 *
 * 处理规则：
 *
 * · 输入来自有道映射（`mapYoudaoEvaluate`）产出的 `{ word, score }`，逐词取
 *     `word` 作内容、`score` 作分数。
 * · 跳过 `content ==='sil' ||'silv'`（静音占位）—— 有道目前不返回这种
 *     条目，但过滤保留，避免未来出现时空词进 DOM。
 *   · `score === null` 代表有道没给这个词的分数，**不是 0 分**。这种情况下
 *     不显示数字（`word-score` 留空）而不是画一个 0 分红字 ——
 *     与 `EvaluateWordScore.score` 的契约一致（见 `lib/pronunciation.ts:41`）。
 */
export function mapEvaluateToSpeakingWords(result: EvaluateResult | null): SpeakingWordDetail[] {
  if (!result || !Array.isArray(result.words)) return []
  const out: SpeakingWordDetail[] = []
  for (const w of result.words) {
    const content = w.word
    if (!content) continue
    if (content === "sil" || content === "silv") continue
    out.push({
      content,
      // null 时用 0 只是为了让「状态」有个确定值；渲染层靠 score 是否缺失
      // 决定显不显示数字（见 SpeakingWordDetail 的注释）。
      totalScore: w.score ?? 0,
      isMissing: w.score === null,
    })
  }
  return out
}

/**
 * 「今日评测次数已用完」的文案：服务端给了 message 就用服务端的，否则按
 * `currentCount/maxCount` 拼。
 */
export function buildSpeakingLimitMessage(state: {
  message?: string
  currentCount: number
  maxCount: number
}): string {
  if (state.message) return state.message
  if (state.maxCount > 0) {
    return `今日口语评测 ${state.currentCount}/${state.maxCount} 次已用完，明天 00:00 后恢复。`
  }
  return "今日口语评测次数已用完，明天 00:00 后恢复。"
}

/** 环形进度条的一圈长度。SVG `viewBox="0 0 36 36"`、r=15.9155 → 周长 100。 */
export const SCORE_RING_CIRCUMFERENCE = 100

/** 秒 → `mm:ss`。 */
export function formatSpeakingClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}
