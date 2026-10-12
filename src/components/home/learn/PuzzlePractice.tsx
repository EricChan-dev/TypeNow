"use client"

/**
 * 拼图（拼拼乐）模式 —— `puzzle.js`（213 行）的 React 重写。
 *
 * 参考站把这一整个模式单独放在 `puzzle.js`：
 *   initPuzzleMode(container)  puzzle.js:18   —— 建 DOM
 *   selectPuzzleWord(...)      puzzle.js:107  —— 点词
 *   undoLastWord()             puzzle.js:149
 *   clearAllWords()            puzzle.js:165
 *   updatePuzzleAnswer()       puzzle.js:182  —— 重绘答案条
 *
 * 为什么是重写而不是"照着抄命令式 DOM"：参考站那 213 行是纯命令式
 * （`selectedWords` 是模块级数组、按钮用 `onclick` 直接绑），
 * 与本仓的 React 声明式渲染对不上。但**可观察行为**必须一致，
 * 所以每个函数的分支、阈值、类名、延迟都按原文搬。
 *
 * 与参考站的三处对应关系（都逐字核过）：
 *
 * 1. **词表**：参考站用全局 `words`（`practice.js:4207-4212` 归一：
 *    小写 + 抹 `[.,!?;:"()—]` + 按空白切分）。本仓 `dictationTokens()`
 *    （`src/lib/dictation-tokens.ts:43`）与之逐字等价 —— 所以拼图的按钮
 *    文字也是**全小写**的，这不是笔误。
 *
 * 2. **打乱**：`puzzleWords = [...words].sort(() => Math.random() - 0.5)`
 *    （puzzle.js:26）。照抄这个有偏的洗牌，不改成 Fisher-Yates ——
 *    分布差异用户看不出来，但"逐字复刻"是我们的验收标准。
 *
 * 3. **选满自动判题**：`if (selectedWords.length === words.length)
 *    setTimeout(() => checkAnswer(), 300)`（puzzle.js:143）。**300ms 是参考站
 *    自己的**，去掉它会让最后一个词刚点下去界面就跳走，连"选上了"都看不清。
 *
 * 判题本身不在这里：参考站 `checkAnswer()`（practice.js:6791+）的拼图分支
 * 与听写分支共用同一个函数体（成功/失败后的上报、进复习屏、写错题本全在
 * 那边）。本仓同理 —— 组件只把"选了什么"交回给父组件，由
 * `handlePuzzleResult` 走与听写同一条成功/失败路径。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { dictationTokens } from "@/lib/dictation-tokens"
import { playTyping } from "@/lib/sfx"

interface PuzzleItem {
  /** 打乱前的原始下标 —— 同一句话里出现两个 "the" 时靠它区分按钮。 */
  id: number
  word: string
}

interface PuzzlePracticeProps {
  /** 当前句英文原文。 */
  text: string
  /**
   * 选满并判题后回调。
   *
   * `correct` 为true 时父组件走听写的答对路径（记完成 + 上报 + 进复习屏），
   * false 时走答错路径（错误音 + 错误计数 + 结果条）。参考站两个模式在这
   * 两条路径上只有**写错题本**一处不同（`practice.js:6979` 的外层条件含
   * `practiceMode === 'dictation'`），那处差异由父组件负责。
   *
   * `userInput` 是用户拼出的句子（空格连接），答错时供准确率统计用；
   * 参考站拼图**不**把它提交到错题本，所以父组件在拼图分支里不会用到它。
   */
  onResult: (correct: boolean, userInput: string) => void
}

export function PuzzlePractice({ text, onResult }: PuzzlePracticeProps) {
  const [canonical] = useState<string[]>(() => dictationTokens(text))

  /**
   * 待选按钮的**打乱**副本 —— 对应参考站 `puzzleWords`（puzzle.js:26）。
   *
   * 用 **lazy initializer** 而不是 `useMemo`：`useMemo` 的工厂函数在
   * 渲染期被调用，里面出现 `Math.random()` 会被 `react-hooks/purity` 判为
   * 「渲染中调用不纯函数」。`useState(() => …)` 的初值函数只在挂载时跑一次，
   * 语义正好 —— 洗牌本来就该每句只发生一次。
   *
   * 为什么不依赖 `text` 变化重算：外层用 `key={sentence.id}` 挂载本组件，
   * 换句即整体重挂，`items` 与 `selected` 一起归零 —— 与参考站
   * `initPuzzleMode()` 里 `container.innerHTML = ''` 重建 DOM 的效果一致。
   * 这样也顺带消掉了「用 effect 重置 state」那条级联渲染告警。
   *
   * ⚠️ 判题**不能**用这个数组，必须用 `canonical` —— 参考站
   * `checkAnswer()` 比的是 `words[index]`（原句顺序），`puzzleWords`
   * 只是按钮的展示顺序。二者混用会让「正序点满」也判错。
   */
  const [items] = useState<PuzzleItem[]>(() =>
    canonical
      .map((word, id) => ({ id, word }))
      .sort(() => Math.random() - 0.5),
  )

  /** 已选中的项，按点击顺序 —— 对应参考站 `selectedWords`。 */
  const [selected, setSelected] = useState<PuzzleItem[]>([])
  /** 答错抖动。参考站给 `#puzzleAnswerArea` 加 `.shake-animation` 500ms。 */
  const [shaking, setShaking] = useState(false)

  /** 抖动动画的收尾定时器 —— 卸载时要清掉，否则会对已卸载组件 setState。 */
  const shakeTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current)
    }
  }, [])

  /**
   * 选满后自动判题。
   *
   * 参考站 `selectPuzzleWord` 末尾：
   *   if (selectedWords.length === words.length) setTimeout(() => checkAnswer(), 300)
   *
   * 这里用 `selected.length === canonical.length && canonical.length > 0` 复现
   * （`canonical` 与 `items` 等长，用前者是为了和判题口径保持一致）。
   * `> 0` 是必要的：空句时 0 === 0 会立刻判一次"全对"。
   */
  const submitTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (submitTimerRef.current !== null) {
      window.clearTimeout(submitTimerRef.current)
      submitTimerRef.current = null
    }
    if (canonical.length === 0 || selected.length !== canonical.length) return
    submitTimerRef.current = window.setTimeout(() => {
      submitTimerRef.current = null
      // 逐位比对 —— 参考站 `selectedWords.forEach((item, index) => …`
      // 比的是 `words[index]`（**原句顺序**，practice.js:6807），不是
      // `puzzleWords[index]`（按钮的洗牌顺序）。用错数组会让「正序点满」
      // 也判错，且错得很有迷惑性：抖动照常出现，用户以为是自己拼错了。
      const correct = selected.every((item, i) => item.word === canonical[i])
      if (!correct) {
        // 参考站 practice.js:6838-6840：加类 → 500ms 后摘掉。
        // 不清空选择 —— 参考站的错误分支只加抖动，用户自己按撤销/清空改。
        setShaking(true)
        if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current)
        shakeTimerRef.current = window.setTimeout(() => setShaking(false), 500)
      }
      onResult(correct, selected.map((i) => i.word).join(" "))
    }, 300)
    return () => {
      if (submitTimerRef.current !== null) {
        window.clearTimeout(submitTimerRef.current)
        submitTimerRef.current = null
      }
    }
    // `onResult` 故意不进依赖：它每次渲染都是新引用（父组件内联箭头会变），
    // 进来会让这个 effect 每渲染重跑一次，把 300ms 计时器反复重置成"永远不判"。
    // `canonical` 是挂载时定下的常量数组，引用恒定，进依赖无害。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, canonical])

  /** 点词 —— 对应 `selectPuzzleWord`（puzzle.js:107）。 */
  const selectWord = useCallback((item: PuzzleItem) => {
    setSelected((prev) => {
      // 参考站 `if (btn.disabled) return` 早退：同一个按钮点两次无效。
      if (prev.some((s) => s.id === item.id)) return prev
      // 参考站先 `playTypingSound()`（puzzle.js:111），再入数组。
      playTyping()
      return [...prev, item]
    })
  }, [])

  /** 撤销一个 —— `undoLastWord()`（puzzle.js:149）。 */
  const undoLast = useCallback(() => {
    setSelected((prev) => prev.slice(0, -1))
  }, [])

  /** 全部清空 —— `clearAllWords()`（puzzle.js:165）。 */
  const clearAll = useCallback(() => {
    setSelected([])
  }, [])

  const usedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected])
  const hasWords = selected.length > 0

  return (
    <div className="puzzle-container">
      <div className="puzzle-answer-wrapper">
        <div
          id="puzzleAnswerArea"
          className={`puzzle-answer-area${shaking ? " shake-animation" : ""}`}
        >
          {/*
            答案条上方的撤销/清空小按钮。
            参考站 `updatePuzzleAnswer()`（puzzle.js:182-207）先把这块从 DOM
            取出来暂存，因为它下面要 `innerHTML` 覆写整个答案区；React 里
            没有这个问题，直接作为兄弟节点渲染即可 —— DOM 顺序保持一致。
          */}
          <div className="puzzle-inline-actions">
            <button
              type="button"
              id="puzzleUndoBtn"
              className="puzzle-inline-btn puzzle-undo-btn"
              title="撤销上一个"
              aria-label="撤销上一个"
              disabled={!hasWords}
              onClick={undoLast}
            >
              {/* 参考站 puzzle.js:41-45 的原样 SVG（16×16、stroke-width 2.5）。 */}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 7v6h6" />
                <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
              </svg>
            </button>
            <button
              type="button"
              id="puzzleClearBtn"
              className="puzzle-inline-btn puzzle-clear-btn"
              title="清空全部"
              aria-label="清空全部"
              disabled={!hasWords}
              onClick={clearAll}
            >
              {/* 参考站 puzzle.js:55-58。 */}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {hasWords ? (
            selected.map((item) => (
              /*
                每次新增元素都重新挂载 → `.puzzle-answer-word` 的
                `animation: puzzleSnapIn .3s …` 自然重放（参考站靠 innerHTML
                覆写达到同样效果）。key 用 `id` 而不是数组下标：撤销后下标会
                整体前移，用下标做 key 会让 React 复用错元素、动画不重放。
              */
              <span className="puzzle-answer-word" key={item.id}>
                {item.word}
              </span>
            ))
          ) : (
            <span className="puzzle-placeholder">点击下方单词按钮组成句子</span>
          )}
        </div>
      </div>

      {/*
        待选词按钮区。
        参考站 `puzzle.js:96-104` 每个词建一个 `button.puzzle-word-btn`，
        `textContent = word`、`dataset.index`、`dataset.word`。
        disabled 判据是**按钮自身**是否已被点过（`usedIds` 按 `id` 判），
        不是"这个词是否出现过" —— 同一句里两个 "the" 是两个独立按钮。
      */}
      <div className="puzzle-word-buttons" id="puzzleWordButtons">
        {items.map((item) => {
          const used = usedIds.has(item.id)
          return (
            <button
              type="button"
              key={item.id}
              className={`puzzle-word-btn${used ? " selected" : ""}`}
              data-index={item.id}
              data-word={item.word}
              disabled={used}
              onClick={() => selectWord(item)}
            >
              {item.word}
            </button>
          )
        })}
      </div>
    </div>
  )
}
