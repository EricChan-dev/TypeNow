"use client"

import { useState } from "react"

/**
 * 首屏右栏的「趣味拼词演示」卡片 —— 首屏互动演示模块。
 *
 * 交互行为：
 *
 *   1. 点过的备选单词**不移出、不隐藏**，只在原地加 `.selected` 置灰下沉
 *      （opacity .35 + grayscale + translateY(2px) + pointer-events:none）。
 *      若把已选词从列表里删掉，剩下的卡片会回流重排，整块看起来就会「跳」，
 * 所以这里不这样做。
 *   2. 「偷看答案」**不填入句子框**，只把按钮上的文字换成正确语序（如
 *      `AI technology helps you learn English faster`），再点一次换回「偷看答案」。
 *   3. 拼对时除了弹出成功条，还要给句子框加绿框绿底
 *      （`border-emerald-400` + `bg-emerald-50/50`）。
 *   4. 撤销：句子槽里的卡片 hover 变红并显示 ✕，点击后回到备选区并恢复可点。
 *
 * 两点刻意为之：
 * · 乱序顺序固定（helps / faster / AI / you / English / learn /
 *   technology），不重新洗牌 —— 换顺序会让「拼对」看起来像另一道题。
 * · 这纯粹是**演示**，不接 lib/practice-score 的真实判分，也不写任何学习记录。
 *   真实练习在 /practice。
 */

/** 乱序备选词，顺序固定 */
const WORD_BANK = [
  "helps",
  "faster",
  "AI",
  "you",
  "English",
  "learn",
  "technology",
]

/** 正确语序，对应题干中文「AI 技术帮助你更快地学习英语」 */
const ANSWER = ["AI", "technology", "helps", "you", "learn", "English", "faster"]

export function PuzzleDemoCard() {
  // placed 存的是单词在 WORD_BANK 里的**下标**而不是单词本身：
  // 用下标定位，也不会在出现重复词时串位。
  const [placed, setPlaced] = useState<number[]>([])
  const [peeking, setPeeking] = useState(false)

  const sentence = placed.map((i) => WORD_BANK[i])
  const isCorrect =
    sentence.length === WORD_BANK.length &&
    sentence.every((word, k) => word === ANSWER[k])

  function place(i: number) {
    if (isCorrect || placed.includes(i)) return
    setPlaced((p) => [...p, i])
  }

 /** 点击句子槽里的卡片 = 撤销：按下标删。 */
  function remove(slotIndex: number) {
    if (isCorrect) return
    setPlaced((p) => p.filter((_, k) => k !== slotIndex))
  }

 /** 偷看/收起答案：只切换按钮文字，不动句子槽 */
  function peek() {
    setPeeking((v) => !v)
  }

  function reset() {
    setPlaced([])
    setPeeking(false)
  }

  return (
    <div className="relative mx-auto max-w-md bg-white rounded-3xl p-6 sm:p-7 shadow-2xl shadow-blue-500/10 border border-slate-100 ring-1 ring-slate-900/5">
      {/* 窗口顶栏模拟 */}
      <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-rose-400"></span>
          <span className="w-3 h-3 rounded-full bg-amber-400"></span>
          <span className="w-3 h-3 rounded-full bg-emerald-400"></span>
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 bg-slate-50 px-2.5 py-1 rounded-md">
          🎮 趣味拼词演示
        </span>
      </div>

      {/* 关卡任务 */}
      <div className="mb-4">
        <div className="text-xs font-semibold text-blue-600 mb-1">
          拼图关卡 · 体验版
        </div>
        <h3 className="text-lg font-bold text-slate-900">
          请将乱序单词拼成完整句子：
        </h3>
        <p className="text-xs text-slate-500 mt-1">中文：AI 技术帮助你更快地学习英语</p>
      </div>

 {/* 拼图放入区域。拼对时加绿框绿底 */}
      <div
        className={`min-h-[72px] p-3 rounded-2xl border-2 border-dashed flex flex-wrap items-center gap-2 mb-4 transition-all ${
          isCorrect
            ? "border-emerald-400 bg-emerald-50/50"
            : "bg-slate-50 border-slate-200"
        }`}
      >
        {placed.length === 0 ? (
          <span className="text-xs font-medium text-slate-400 select-none animate-pulse w-full text-center py-2">
            👇 点击下方单词卡片拼入句子
          </span>
        ) : (
          placed.map((i, slotIndex) => (
            <button
              key={i}
              type="button"
              onClick={() => remove(slotIndex)}
              disabled={isCorrect}
              title="点击撤销此单词"
              className="puzzle-slot-btn disabled:cursor-default"
            >
              {WORD_BANK[i]}
            </button>
          ))
        )}
      </div>

      {/* 乱序备选单词卡片。
          已选中的卡片保留在列表中、只加 .selected 置灰 —— 不移除，避免回流。 */}
      <div className="flex flex-wrap gap-2 mb-6">
        {WORD_BANK.map((word, i) => (
          <button
            key={i}
            type="button"
            onClick={() => place(i)}
            className={`word-btn${placed.includes(i) ? " selected" : ""}`}
          >
            {word}
          </button>
        ))}
      </div>

      {/* 底部操作按钮 */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
        <button
          type="button"
          onClick={peek}
          className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-semibold px-2 py-1 rounded hover:bg-blue-50 transition-colors"
        >
          <span>💡</span>
          <span>{peeking ? ANSWER.join(" ") : "偷看答案"}</span>
        </button>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 font-medium px-2 py-1 rounded hover:bg-slate-100 transition-colors"
        >
          <span>🔄</span>
          <span>重置关卡</span>
        </button>
      </div>

      {/* 拼装成功反馈弹条 */}
      {isCorrect && (
        <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold text-center">
          🎉 拼词正确！这就是游戏化学习的乐趣！
        </div>
      )}
    </div>
  )
}
