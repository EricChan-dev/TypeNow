/**
 * 练习模式的词汇表 —— 客户端与服务端共用同一份定义。
 *
 * 基准实现有四种模式，`data-mode` 分别是 dictation / puzzle / learning / speaking，
 * 下拉菜单里的名字依次是「听写 / 拼图 / 学习 / 口语」。这里照抄它的取值，
 * 因为 `practice_sessions.mode` 这一列要把它们存下来，取值一旦漂移，
 * 存量进度就会读不回来。
 *
 * 纯净模块：不 import 数据库、不 import React，服务端与浏览器端都能用。
 */

export const PRACTICE_MODES = ["dictation", "puzzle", "learning", "speaking"] as const

export type PracticeMode = (typeof PRACTICE_MODES)[number]

/** 默认模式。与基准实现一致：没有任何记录时进听写。 */
export const DEFAULT_PRACTICE_MODE: PracticeMode = "dictation"

/**
 * 模式的中文名。刻意对齐基准实现下拉菜单，不在这里做「更准确」的改写：
 * 用户看到的文案必须和基准实现一模一样。
 */
export const PRACTICE_MODE_LABELS: Record<PracticeMode, string> = {
  dictation: "听写",
  puzzle: "拼图",
  learning: "学习",
  speaking: "口语",
}

/** 切换模式确认弹窗里用的全称（基准实现文案：「听写模式」）。 */
export const PRACTICE_MODE_FULL_LABELS: Record<PracticeMode, string> = {
  dictation: "听写模式",
  puzzle: "拼图模式",
  learning: "学习模式",
  speaking: "口语模式",
}

export function isPracticeMode(value: unknown): value is PracticeMode {
  return typeof value === "string" && (PRACTICE_MODES as readonly string[]).includes(value)
}

/**
 * 把来路不明的值收敛成合法模式，退化为默认值而不是抛错。
 *
 * URL 里的 `?mode=`、localStorage 里的旧值都可能脏；这些地方出错时
 * 应该「当成听写」继续能用，而不是整页报错。
 */
export function normalizePracticeMode(value: unknown): PracticeMode {
  return isPracticeMode(value) ? value : DEFAULT_PRACTICE_MODE
}

/**
 * 模式记忆的 localStorage 键名 —— 与基准实现一致（`lesson_<lessonId>_mode`）。
 *
 * 同名是刻意的：这样从基准实现迁移过来的用户，两种产品里「上次用哪个模式」
 * 的偏好是同一份数据；将来若做导入也不必转换键名。
 */
export function modeStorageKey(lessonId: string): string {
  return `lesson_${lessonId}_mode`
}

/**
 * 模式恢复优先级，与基准实现一致：URL `?mode=` > localStorage > 默认听写。
 *
 * URL 优先是因为分享链接/书签里带的模式意图最明确；localStorage 是「上次用的」；
 * 都没有才回落到听写。
 */
export function resolvePracticeMode(input: {
  urlMode?: unknown
  storedMode?: unknown
}): PracticeMode {
  if (isPracticeMode(input.urlMode)) return input.urlMode
  if (isPracticeMode(input.storedMode)) return input.storedMode
  return DEFAULT_PRACTICE_MODE
}

/**
 * 切换模式时的确认文案 —— 与基准实现一致。
 *
 * 之所以要确认：切换会结束当前进度并从第一句重新开始（各模式进度独立，
 * 但当前这一遍的「本轮已完成」会被清空），误触的代价是用户白练。
 */
export function switchModeConfirmText(from: PracticeMode, to: PracticeMode): string {
  return `确定要从【${PRACTICE_MODE_FULL_LABELS[from]}】切换到【${PRACTICE_MODE_FULL_LABELS[to]}】吗？\n\n切换模式会结束当前进度，并从第一句重新开始。`
}
