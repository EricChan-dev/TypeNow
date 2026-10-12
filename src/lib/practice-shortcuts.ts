/**
 * 快捷键配置。移植参考站 `句子练习 - 句游英语_files/shortcut-config.js`。
 *
 * 为什么要有这一层：练习页的五个全局快捷键（播放/答案/上一句/下一句/收藏）
 * 在参考站里是**用户可改**的，改完存 `localStorage.practice_shortcuts`，
 * 设置面板的「自定义快捷键」卡片就是入口（弹窗里逐行录制按键）。
 * 改键之后，悬浮提示条、按钮 title、全局 keydown 匹配都必须读同一份配置，
 * 否则会出现「提示写着 ⌘+A、实际按 ⌘+A 没反应」这种自相矛盾的状态 ——
 * 所以这里做成唯一事实源，由 `DictationPractice.tsx` 统一消费。
 *
 * 参考站把 `slow`（慢声发音）和 `wordSpeak`（焦点词发音）也列在默认表里，
 * 但渲染列表时明确跳过（`practice-sys-controls.js:637` 注释
 * 「[暂时] 慢声发音和焦点词发音功能已隐藏」）。这里同样保留它们的默认值
 * （保持存储结构与参考站一致，换回来时不用迁移），只是不渲染、不匹配。
 */

// 平台判定统一走 platform.ts，避免出现「两处各判一次 Mac」的分裂。
import { modifierKeyLabel, prefersMetaKey } from "@/lib/platform"

const SHORTCUT_STORAGE_KEY = "practice_shortcuts"

/** 动作 id 的联合。参考站用字符串键，这里收窄成字面量联合以便类型检查。 */
export type ShortcutId =
  | "play"
  | "slow"
  | "answer"
  | "wordSpeak"
  | "prevSent"
  | "nextSent"
  | "favorite"

export interface ShortcutBinding {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  label: string
}

/** 默认绑定，逐条对应 `shortcut-config.js:12-20`。 */
export const DEFAULT_SHORTCUTS: Record<ShortcutId, ShortcutBinding> = {
  play: { key: "p", ctrl: true, shift: false, alt: false, label: "播放语音" },
  slow: { key: "m", ctrl: true, shift: false, alt: false, label: "慢声发音" },
  answer: { key: "a", ctrl: true, shift: false, alt: false, label: "显示答案" },
  wordSpeak: { key: "k", ctrl: true, shift: false, alt: false, label: "焦点词发音" },
  prevSent: { key: "ArrowLeft", ctrl: true, shift: false, alt: false, label: "上一句" },
  nextSent: { key: "ArrowRight", ctrl: true, shift: false, alt: false, label: "下一句" },
  favorite: { key: "u", ctrl: true, shift: false, alt: false, label: "收藏句子" },
}

/** 参考站渲染弹窗列表时跳过的动作（`practice-sys-controls.js:637`）。 */
const HIDDEN_SHORTCUT_IDS: readonly ShortcutId[] = ["slow", "wordSpeak"]

/** 弹窗里逐行展示的动作，顺序即参考站 `for (const id in shortcuts)` 的顺序。 */
export const VISIBLE_SHORTCUT_IDS: readonly ShortcutId[] = (
  Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[]
).filter((id) => !HIDDEN_SHORTCUT_IDS.includes(id))

/**
 * 浏览器保留键，不许用户占用（`shortcut-config.js:23-40`）。
 * 仅当**没有** shift/alt 时才拒（参考站 `isBrowserReserved` 里的
 * `!combo.shift && !combo.alt`），所以 Ctrl+Shift+C 之类是允许的。
 */
const BROWSER_RESERVED_KEYS: ReadonlyArray<{ key: string; ctrl: boolean }> = [
  { key: "c", ctrl: true },
  { key: "v", ctrl: true },
  { key: "x", ctrl: true },
  { key: "z", ctrl: true },
  { key: "y", ctrl: true },
  { key: "s", ctrl: true },
  { key: "f", ctrl: true },
  { key: "r", ctrl: true },
  { key: "w", ctrl: true },
  { key: "t", ctrl: true },
  { key: "n", ctrl: true },
  { key: "l", ctrl: true },
  { key: "h", ctrl: true },
  { key: "j", ctrl: true },
  { key: "d", ctrl: true },
  { key: "Tab", ctrl: true },
]

/**
 * 不许作为主键的值。Enter 是答题提交/切句，空格是输入与滚动，
 * 参考站两处独立判定：加载时 `FORBIDDEN_KEYS`（`shortcut-config.js:52`）
 * 与录制时 `lowerKey`（`practice-sys-controls.js:733`）。这里合二为一。
 */
const FORBIDDEN_KEYS = new Set(["enter", " ", "space", "spacebar"])

function isForbiddenKey(k: unknown): boolean {
  return typeof k === "string" && FORBIDDEN_KEYS.has(k.toLowerCase())
}

/** 纯函数：把存储里的部分配置合并到默认表上。抽出来是为了能单测。 */
export function mergeShortcuts(saved: unknown): Record<ShortcutId, ShortcutBinding> {
  const parsed = (saved ?? null) as Partial<Record<string, Partial<ShortcutBinding>>> | null
  const result = {} as Record<ShortcutId, ShortcutBinding>
  for (const id of Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[]) {
    const def = DEFAULT_SHORTCUTS[id]
    const got = parsed?.[id]
    // 有值、有 key、且不是禁用键才采纳；否则整项回退默认
    // （参考站 `shortcut-config.js:62`）。
    if (got && got.key && !isForbiddenKey(got.key)) {
      result[id] = {
        ...def,
        key: got.key,
        ctrl: got.ctrl !== undefined ? got.ctrl : true,
        shift: got.shift || false,
        alt: got.alt || false,
      }
    } else {
      result[id] = { ...def }
    }
  }
  return result
}

/** 从 `localStorage` 读取配置（读失败一律回默认，不抛）。 */
export function loadShortcuts(): Record<ShortcutId, ShortcutBinding> {
  try {
    const raw = window.localStorage.getItem(SHORTCUT_STORAGE_KEY)
    return mergeShortcuts(raw ? JSON.parse(raw) : null)
  } catch {
    return mergeShortcuts(null)
  }
}

/**
 * 写回 `localStorage`。只存 key/ctrl/shift/alt 四个字段，
 * **不存 label**（参考站 `shortcut-config.js:97-104` 同款）——
 * label 是展示文案，存进去会让改文案变成一次数据迁移。
 */
export function saveShortcuts(shortcuts: Record<ShortcutId, ShortcutBinding>): void {
  const toSave: Record<string, { key: string; ctrl: boolean; shift: boolean; alt: boolean }> = {}
  for (const id of Object.keys(shortcuts) as ShortcutId[]) {
    const sc = shortcuts[id]
    toSave[id] = { key: sc.key, ctrl: sc.ctrl, shift: sc.shift, alt: sc.alt }
  }
  try {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(toSave))
  } catch {
    /* ignore */
  }
}

/** 全部恢复默认并落盘（参考站 `resetShortcuts`）。 */
export function resetShortcuts(): Record<ShortcutId, ShortcutBinding> {
  const fresh = mergeShortcuts(null)
  saveShortcuts(fresh)
  return fresh
}

/**
 * 判断是否有任意一项偏离默认 —— 决定 `#shortcutDisplay` 显示「默认」还是「自定义」
 * （参考站 `updateShortcutDisplay`，`practice-sys-controls.js:861-874`）。
 */
export function isDefaultShortcuts(shortcuts: Record<ShortcutId, ShortcutBinding>): boolean {
  for (const id of Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[]) {
    const sc = shortcuts[id]
    const def = DEFAULT_SHORTCUTS[id]
    if (sc.key !== def.key || sc.ctrl !== def.ctrl || sc.shift !== def.shift || sc.alt !== def.alt) {
      return false
    }
  }
  return true
}

/**
 * 键盘事件是否命中某个动作（参考站 `matchShortcut`，`shortcut-config.js:126`）。
 *
 * 要点：修饰键要求**完全一致** —— 绑了 ctrl 的项，没按 ctrl 不算；
 * 没绑 ctrl 的项，按了 ctrl 也不算。shift/alt 同理。主键比较大小写不敏感。
 */
export function matchShortcut(
  e: KeyboardEvent,
  actionId: ShortcutId,
  shortcuts: Record<ShortcutId, ShortcutBinding>,
): boolean {
  const sc = shortcuts[actionId]
  if (!sc) return false
  const ctrlMatch = sc.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey
  const shiftMatch = sc.shift ? e.shiftKey : !e.shiftKey
  const altMatch = sc.alt ? e.altKey : !e.altKey
  const keyMatch = e.key.toLowerCase() === sc.key.toLowerCase() || e.key === sc.key
  return ctrlMatch && shiftMatch && altMatch && keyMatch
}

/** 主键的友好显示名（参考站 `getShortcutDisplay` 的 `keyNames`）。 */
function keyDisplayName(key: string): string {
  const mac = prefersMetaKey()
  const names: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    control: mac ? "⌃ Control" : "Ctrl",
    meta: mac ? "⌘ Command" : "Win",
    shift: "⇧ Shift",
    alt: mac ? "⌥ Option" : "Alt",
  }
  return names[key] || key.toUpperCase()
}

/** 快捷键的纯文本展示，如 `⌘+P` / `Ctrl+Shift+A`。 */
export function shortcutDisplay(
  actionId: ShortcutId,
  shortcuts: Record<ShortcutId, ShortcutBinding>,
): string {
  const sc = shortcuts[actionId]
  if (!sc) return ""
  const parts: string[] = []
  if (sc.ctrl) parts.push(modifierKeyLabel())
  if (sc.shift) parts.push("Shift")
  if (sc.alt) parts.push(prefersMetaKey() ? "⌥" : "Alt")
  parts.push(keyDisplayName(sc.key))
  return parts.join("+")
}

/** 快捷键的 `<kbd>` 片段，逐段包标签（参考站 `getShortcutKbd`）。 */
export function shortcutKbdParts(
  actionId: ShortcutId,
  shortcuts: Record<ShortcutId, ShortcutBinding>,
): string[] {
  const sc = shortcuts[actionId]
  if (!sc) return []
  const parts: string[] = []
  if (sc.ctrl) parts.push(modifierKeyLabel())
  if (sc.shift) parts.push("Shift")
  if (sc.alt) parts.push(prefersMetaKey() ? "⌥" : "Alt")
  parts.push(keyDisplayName(sc.key))
  return parts
}

/** 是否是浏览器保留键（`shortcut-config.js:217`）。 */
export function isBrowserReserved(combo: {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}): boolean {
  return BROWSER_RESERVED_KEYS.some(
    (r) =>
      r.key.toLowerCase() === combo.key.toLowerCase() &&
      r.ctrl === combo.ctrl &&
      !combo.shift &&
      !combo.alt,
  )
}

/** 与其它动作是否冲突，返回冲突项的 label（参考站 `findShortcutConflict`）。 */
export function findShortcutConflict(
  actionId: ShortcutId,
  combo: { key: string; ctrl: boolean; shift: boolean; alt: boolean },
  shortcuts: Record<ShortcutId, ShortcutBinding>,
): string | null {
  for (const id of Object.keys(shortcuts) as ShortcutId[]) {
    if (id === actionId) continue
    const sc = shortcuts[id]
    if (
      sc.key.toLowerCase() === combo.key.toLowerCase() &&
      sc.ctrl === combo.ctrl &&
      sc.shift === combo.shift &&
      sc.alt === combo.alt
    ) {
      return sc.label
    }
  }
  return null
}

/** 从键盘事件提取组合。纯修饰键返回 null（由调用方在 keyup 上另判）。 */
export function extractComboFromEvent(
  e: KeyboardEvent,
): { key: string; ctrl: boolean; shift: boolean; alt: boolean } | null {
  if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return null
  return {
    key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
  }
}

/**
 * 录制一个新组合时的合法性校验。返回 `null` 表示可接受，
 * 否则返回「为什么不行」——类型决定提示语气，message 决定提示文案，
 * 与参考站 `_processShortcutCombo`（`practice-sys-controls.js:726-806`）逐条对应。
 */
export type ComboRejection = {
  reason: "forbidden" | "single-char" | "reserved" | "conflict"
  message: string
  /** 行内替换的提示文案（参考站把 `.shortcut-key-display` 换成警示文本）。 */
  inline: string
  conflictLabel?: string
}

/** 不带修饰键时可单独使用的「安全键」（参考站 `safeSingleKeys`）。 */
const SAFE_SINGLE_KEYS = [
  "Escape", "Enter", "Backspace", "Tab",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "PageUp", "PageDown", "Home", "End", "Insert", "Delete",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  "Control", "Meta", "Shift", "Alt",
]

export function validateCombo(
  actionId: ShortcutId,
  combo: { key: string; ctrl: boolean; shift: boolean; alt: boolean },
  shortcuts: Record<ShortcutId, ShortcutBinding>,
): ComboRejection | null {

  if (isForbiddenKey(combo.key)) {
    return {
      reason: "forbidden",
      message: "回车键和空格键不能作为快捷键，请改用其他按键",
      inline: "⚠ 回车/空格不可用，请按其他键…",
    }
  }

  // 单字符键且没有 Ctrl/Alt → 会跟打字冲突
  if (!combo.ctrl && !combo.alt && combo.key.length === 1 && !SAFE_SINGLE_KEYS.includes(combo.key)) {
    return {
      reason: "single-char",
      message: "单字符键会影响打字，请搭配 Ctrl / Alt 使用，或使用功能键/修饰键",
      inline: "⚠ 请搭配 Ctrl / Alt 按键…",
    }
  }

  if (isBrowserReserved(combo)) {
    return {
      reason: "reserved",
      message: "该快捷键已被浏览器占用，无法使用",
      inline: "⚠ 浏览器保留键，请按其他键…",
    }
  }

  const conflict = findShortcutConflict(actionId, combo, shortcuts)
  if (conflict) {
    return {
      reason: "conflict",
      message: `该快捷键已被「${conflict}」使用`,
      inline: `⚠ 与「${conflict}」冲突，请按其他键…`,
      conflictLabel: conflict,
    }
  }

  return null
}
