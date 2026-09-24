"use client"

import { useState } from "react"
import { X, AlertTriangle, GitBranch } from "lucide-react"
import type { Sentence } from "@/types"
import { buildDependencyLayout, depLabelZh, type DependencyAnalysisLike } from "@/lib/dependency-tree"
import { getPosColor } from "@/lib/pos-color"

/** 层高：两层弧线之间留出的垂直距离，够放一行中文标签。 */
const LEVEL_H = 30
/** 弧线区顶部留白，最高一层弧不要贴边。 */
const TOP_PAD = 16
/** 弧线起点/终点与词之间的空隙，避免曲线穿进词块。 */
const WORD_GAP = 12

function slotWidth(word: string): number {
  // 手写估算而不是测量 DOM：这里要的是「稳定、可预测」，不是像素级精确。
  // 每个字符按 9px 计（13px 字号下英文近等宽），下限 46px 保证单字母词也有下划线感。
  return Math.max(46, word.length * 9 + 16)
}

/**
 * 依存语法树（SVG）。
 *
 * 数据来自 `dependency_analysis`（可达句覆盖率 95%），本组件是它唯一的消费方 ——
 * 在此之前这份数据在库里躺了很久，前端一次都没渲染过。
 *
 * 为什么用 SVG 而不是 canvas：句乐部那边是 canvas，所以拿不到 DOM、也没法被选中和
 * 无障碍读取。这里的图要能被截图、被读屏、能跟着主题色走，SVG 更合适，
 * 而且这点规模（一句话最多二十几个词）根本不需要 canvas 的性能。
 */
export function DependencyTree({ analysis }: { analysis: DependencyAnalysisLike | null | undefined }) {
  const layout = buildDependencyLayout(analysis)

  if (layout.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <GitBranch className="h-8 w-8 text-foreground/15" />
        <p className="text-sm text-foreground/40">这句还没有语法树数据</p>
        <p className="text-xs text-foreground/25">全库约 95% 的句子有；这一句恰好落在缺的那 5% 里</p>
      </div>
    )
  }

  const widths = layout.nodes.map((n) => slotWidth(n.word))
  /** 每个词的中心 x */
  const centers: number[] = []
  let cursor = 0
  for (const w of widths) {
    centers.push(cursor + w / 2)
    cursor += w
  }
  const totalWidth = Math.max(320, cursor)

  const arcHeight = Math.max(0, (layout.maxLevel + 1) * LEVEL_H)
  const baseY = TOP_PAD + arcHeight
  const height = baseY + 46

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <svg
          width={totalWidth}
          height={height}
          viewBox={`0 0 ${totalWidth} ${height}`}
          className="block"
          role="img"
          aria-label={`依存语法树：${layout.nodes.map((n) => n.word).join(" ")}`}
        >
          {/* 弧线：两端落在词的正上方，标签贴在弧顶 */}
          {layout.arcs.map((arc, i) => {
            const x1 = centers[arc.from]
            const x2 = centers[arc.to]
            const midX = (x1 + x2) / 2
            const topY = baseY - (arc.level + 1) * LEVEL_H
            // 二次贝塞尔的峰值在 t=0.5，正好是控制点高度与基线的一半
            const apexY = (topY + baseY) / 2
            return (
              <g key={i}>
                <path
                  d={`M ${x1} ${baseY - WORD_GAP} Q ${midX} ${topY} ${x2} ${baseY - WORD_GAP}`}
                  fill="none"
                  stroke="var(--surface-border, rgba(255,255,255,0.18))"
                  strokeWidth={1.5}
                />
                <text
                  x={midX}
                  y={apexY - 5}
                  textAnchor="middle"
                  fontSize={11}
                  fill="currentColor"
                  className="text-foreground/50"
                >
                  {arc.labelZh}
                </text>
              </g>
            )
          })}

          {/* 词：颜色跟着词性走，根节点加一个圆点 */}
          {layout.nodes.map((node, i) => {
            const x = centers[i]
            const color = getPosColor(node.pos)
            return (
              <g key={node.id}>
                {node.isRoot && <circle cx={x} cy={baseY + 2} r={4} fill={color} opacity={0.9} />}
                <text
                  x={x}
                  y={baseY + 24}
                  textAnchor="middle"
                  fontSize={14}
                  fontWeight={node.isRoot ? 700 : 500}
                  fill={color}
                >
                  {node.word}
                </text>
                <text
                  x={x}
                  y={baseY + 40}
                  textAnchor="middle"
                  fontSize={10}
                  fill="currentColor"
                  opacity={0.5}
                >
                  {node.pos}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
        <span className="text-[11px] font-semibold text-foreground/40">词性</span>
        {Array.from(new Set(layout.nodes.map((n) => n.pos).filter(Boolean))).map((pos) => (
          <span key={pos} className="inline-flex items-center gap-1.5 text-[11px] text-foreground/50">
            <span className="h-2 w-2 rounded-full" style={{ background: getPosColor(pos) }} />
            {pos}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-foreground/25">
          {layout.nodes.length} 词 · {layout.arcs.length} 条依存关系
        </span>
      </div>
    </div>
  )
}

interface SentenceTreeModalProps {
  sentence: Sentence
  /** 本句是否已经完成 / 已看过答案。未揭晓时不能直接展示语法树。 */
  revealed: boolean
  onClose: () => void
}

/**
 * 语法树弹窗。
 *
 * 关键约束：**语法树本身就是答案**（树上写着这句话的每一个词）。所以它不能像
 * 大纲那样随手打开，必须先确认「我知道这会显示答案」。已经完成的句子不用再问，
 * 那正是最适合回头看语法的时刻。
 */
export function SentenceTreeModal({ sentence, revealed, onClose }: SentenceTreeModalProps) {
  const [confirmed, setConfirmed] = useState(revealed)
  const hasTree = !!sentence.dependencyAnalysis

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[95vw] max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-accent" />
            <h2 className="text-lg font-bold text-foreground">句子结构</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!confirmed ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <AlertTriangle className="h-9 w-9 text-amber-400/70" />
              <p className="text-base font-semibold text-foreground">语法树会显示整句英文</p>
              <p className="max-w-sm text-sm text-foreground/45">
                树上写着这句话的每个词，等于直接看答案。想自己先打完，就先关掉这里。
              </p>
              <button
                onClick={() => setConfirmed(true)}
                className="mt-1 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-accent/90"
              >
                仍然查看
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* 中文题干始终可见：它是题目本身，不是答案 */}
              <p className="text-center text-lg font-semibold text-foreground/70">{sentence.chinese}</p>
              <DependencyTree analysis={sentence.dependencyAnalysis} />
              {hasTree && (
                <p className="text-center text-xs text-foreground/25">
                  弧线从上级词指向依存词，标签是语法关系（{depLabelZh("nsubj")}、
                  {depLabelZh("dobj")}、{depLabelZh("amod")} …）。带圆点的是全句的谓语核心。
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end border-t border-border px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-xl bg-accent px-6 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent/90"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
