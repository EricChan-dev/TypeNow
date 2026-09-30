"use client"

import { X, Volume2 } from "lucide-react"
import {
  LOW_SCORE_THRESHOLD,
  scoreColor,
  type EvaluateResult,
  type EvaluateWordScore,
} from "@/lib/pronunciation"
import { cn } from "@/lib/utils"

/**
 * 跟读评分弹窗（布局 C：句子为骨架、分数挂在词下面）。
 *
 * 设计见 docs/superpowers/specs/2026-09-30-pronunciation-scoring-redesign-design.md §3.1。
 * 这个组件是**纯展示**：录音、评分、听发音都由调用方负责，它只接收数据与回调。
 * 这样它不需要处理 MediaRecorder 的生命周期，也就能被单独推理。
 */

interface PronunciationModalProps {
  /** 逐词分。**用有道返回的 words[]**，不用句子字段切词 —— 那边标点是独立 token。 */
  words: EvaluateWordScore[]
  /**
   * 去掉 `words` 的评分结果，与 `EvaluateResult` 同源而不是重抄一遍字段：
   * 三个维度可空这件事是这套界面的核心契约，抄一份出来就会各自漂移。
   */
  result: Omit<EvaluateResult, "words">
  /** 本次会话内上一次的分数，用于显示「61 → 84」。没有就不显示。 */
  previousScore?: number | null
  speaking: boolean
  evaluating: boolean
  /**
   * 是否正在录音。**录音期间必须禁用「听发音」**：参考音会被麦克风采进去，
   * 评出虚高的分；而评分是 upsert 的，这个假分会被落库、之后一直显示。
   * 这个组件自己听不到录音机，所以由调用方把状态传进来（同 VoicePanel 在开录
   * 前先 stopSpeaking() 的道理）。
   */
  recording: boolean
  onSpeak: () => void
  onRetry: () => void
  onClose: () => void
}

function Bar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full transition-all"
          style={{
            // 维度缺失时不画进度条（宽度 0），并显示「—」而不是 0
            width: value === null ? "0%" : `${Math.max(0, Math.min(100, value))}%`,
            background: scoreColor(value),
          }}
        />
      </div>
      <b className="w-8 shrink-0 text-right text-xs tabular-nums">{value ?? "—"}</b>
    </div>
  )
}

export function PronunciationModal({
  words,
  result,
  previousScore,
  speaking,
  evaluating,
  recording,
  onSpeak,
  onRetry,
  onClose,
}: PronunciationModalProps) {
  const { score, accuracy, fluency, integrity, speed, comment } = result

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* 标题栏：「听发音」常驻右侧 —— 进行中要变「停止」，藏起来就没法中断朗读 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">跟读评分</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onSpeak}
              // 录音期间也禁用：参考音进麦克风 → 假高分 → 被 upsert 落库
              disabled={evaluating || recording}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                speaking
                  ? "border-blue-500/50 bg-blue-500/15 text-blue-400"
                  : "border-accent/50 text-accent hover:bg-accent/10 disabled:hover:bg-transparent",
                // 用 disabled: 变体而不是外挂条件类：视觉状态由属性本身推导，不会与它脱节
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              <Volume2 className="h-3.5 w-3.5" />
              {/* 标签只看 speaking：录音时按钮是禁用的，不该改文案 */}
              {speaking ? "停止" : "听发音"}
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 逐词分：词在上、分在下 */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-4 py-5">
          {words.length === 0 ? (
            <p className="text-xs text-muted-foreground">这次没有拿到逐词分析</p>
          ) : (
            words.map((w, i) => (
              <span
                key={`${w.word}-${i}`}
                className="text-center"
                style={
                  // `!== null` 不能省：字段缺失是中性灰，不是"读错了"
                  w.score !== null && w.score < LOW_SCORE_THRESHOLD
                    ? { background: "rgba(239,68,68,.12)", borderRadius: 6, padding: "0 4px" }
                    : undefined
                }
              >
                <span className="block text-base text-foreground">{w.word}</span>
                <span className="block text-sm font-bold tabular-nums" style={{ color: scoreColor(w.score) }}>
                  {w.score === null ? "—" : w.score}
                </span>
              </span>
            ))
          )}
        </div>

        {/* 多维进度条 */}
        <div className="flex flex-col gap-2 px-4 pb-4">
          <Bar label="准确度" value={accuracy} />
          <Bar label="流利度" value={fluency} />
          <Bar label="完整度" value={integrity} />
          <div className="flex items-center gap-2.5">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">语速</span>
            {/* 语速不在 0–100 上，画空进度条会被读成「0 分 / 100」；
                这里只要一个同高的占位，保证数字列对齐 */}
            <div className="h-2 flex-1" aria-hidden />
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
              {speed === null ? "—" : `${Math.round(speed)} 词/分`}
            </span>
          </div>
        </div>

        {/* 总分 + 评语：总分一定有值，所以这块常驻、不折叠；评语是可选字段（映射器不产生它），
            为 null 时就只是少一段文字，不补占位符、不留空行 */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-4">
          <b className="text-2xl tabular-nums" style={{ color: scoreColor(score) }}>
            {score}
          </b>
          <div className="min-w-0 text-xs leading-relaxed text-foreground">
            {previousScore != null && previousScore !== score && (
              <span className="mr-2 text-muted-foreground tabular-nums">
                {previousScore} → {score}
              </span>
            )}
            {comment}
          </div>
        </div>

        <div className="flex gap-3 border-t border-border px-4 py-3">
          <button
            onClick={onRetry}
            disabled={evaluating || recording}
            className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60 disabled:hover:bg-accent"
          >
            再试一次
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border py-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/5"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
