/**
 * 打字按键语义 —— 练习页与复习页共用的唯一口径。
 *
 * 存在的理由：这两页历史上各写各的，空格键语义直接冲突。
 *   LearnClient  —— 空格 = 确认当前词（`e.key === " "` → confirmWord）
 *   ReviewClient —— 空格被当作普通字符追加进输入（`e.key.length === 1`），
 *                   于是「hel␣l」经 normalizeForTyping 折叠空白后必然判错，
 *                   用户用正常打字习惯敲空格，词中每个空格都记一次错误。
 *
 * 统一口径：空格 = 确认当前词（两页一致）。Ctrl/Alt/Meta 组合一律不归口，
 * 交给各页自己的快捷键分支；Enter 也不归口（练习页用 Enter 提交整句，
 * 复习页用 Enter 选评分按钮），避免改动既有行为。
 *
 * 注意「逐词模式」与「自由文本模式」的空格语义不同，这是有意的：
 *   - 逐词模式（word）：空格 = 确认当前词 —— confirmWord
 *   - 自由文本模式（chunk）：整段文本本身就是答案，空格是答案的一部分
 *     （"in the morning"），必须能打出来，确认走 Enter
 * 分类器只负责把空格识别成 confirm 这个动作，由调用方按模式决定怎么用。
 */

export type TypingKeyAction = "ignore" | "letter" | "backspace" | "confirm"

export interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export interface EditableTargetInfo {
  tagName?: string | null
  isContentEditable?: boolean | null
  /** 是否是练习页那个「用来唤起软键盘」的隐藏 input（它必须被放行）。 */
  isSoftKeyboardInput?: boolean | null
}

/**
 * 把按键归到练习页能处理的动作上。
 * 组合键一律 ignore —— 各页的 Ctrl+X 快捷键在调用本函数之前就已处理完。
 */
export function classifyTypingKey(e: KeyLike): TypingKeyAction {
  if (!e.key) return "ignore"
  if (e.ctrlKey || e.metaKey || e.altKey) return "ignore"
  if (e.key === "Backspace") return "backspace"
  if (e.key === " ") return "confirm"
  // 单字符即为可输入字符（含标点）；Enter/Tab/Shift/方向键等长度 > 1，交给各页
  if (e.key.length === 1) return "letter"
  return "ignore"
}

/**
 * 按键是否落在可编辑元素上。
 *
 * 返回 true 表示练习页必须放手：用户正在真实的输入框里打字（设置弹窗的
 * 数值输入、浏览器自动填充、未来的搜索框），不能被抢进题目。
 * 唯一例外是软键盘捕获框 —— 手机上没有它就没有软键盘，键盘事件全靠它带过来。
 */
export function isEditableTarget(info: EditableTargetInfo): boolean {
  if (info.isSoftKeyboardInput) return false
  if (info.isContentEditable) return true
  const tag = (info.tagName ?? "").toUpperCase()
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}
