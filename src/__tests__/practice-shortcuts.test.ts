import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import {
  DEFAULT_SHORTCUTS,
  VISIBLE_SHORTCUT_IDS,
  extractComboFromEvent,
  findShortcutConflict,
  isBrowserReserved,
  isDefaultShortcuts,
  loadShortcuts,
  matchShortcut,
  mergeShortcuts,
  resetShortcuts,
  saveShortcuts,
  shortcutKbdParts,
  validateCombo,
  type ShortcutId,
} from "@/lib/practice-shortcuts"

/**
 * 快捷键配置的行为契约。
 *
 * 这些用例锁定的都是「改了会让用户按不出来」的地方：修饰键必须完全一致、
 * Enter/空格不许绑、冲突要拦、存储里的脏数据要回退默认。参考站对应实现见
 * `句子练习 - 句游英语_files/shortcut-config.js` 与 `practice-sys-controls.js`。
 */

/** 造一个 KeyboardEvent 形状的对象，够 matchShortcut 判就行。 */
function keyEvent(
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  } as KeyboardEvent
}

describe("practice-shortcuts", () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    }
    vi.stubGlobal("localStorage", storage)
    // 模块里读的是 `window.localStorage`（浏览器语义），而 vitest 跑在 node 环境
    // 下没有 window —— 只 stub 全局 localStorage 的话，`window.localStorage`
    // 仍会抛 ReferenceError，被模块自己的 try/catch 吞掉，于是「写盘」静默失效。
    vi.stubGlobal("window", { localStorage: storage })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("默认表里 play/answer/favorite 与参考站逐字一致", () => {
    // 参考站 shortcut-config.js:12-20。改这里等于改用户默认手感。
    expect(DEFAULT_SHORTCUTS.play).toMatchObject({ key: "p", ctrl: true, shift: false, alt: false })
    expect(DEFAULT_SHORTCUTS.answer).toMatchObject({ key: "a", ctrl: true, shift: false, alt: false })
    expect(DEFAULT_SHORTCUTS.favorite).toMatchObject({ key: "u", ctrl: true, shift: false, alt: false })
    expect(DEFAULT_SHORTCUTS.prevSent).toMatchObject({ key: "ArrowLeft", ctrl: true })
    expect(DEFAULT_SHORTCUTS.nextSent).toMatchObject({ key: "ArrowRight", ctrl: true })
  })

  it("弹窗只渲染 5 项，slow 与 wordSpeak 被隐藏", () => {
    // 参考站 practice-sys-controls.js:637 明确跳过这两个
    expect(VISIBLE_SHORTCUT_IDS).toHaveLength(5)
    expect(VISIBLE_SHORTCUT_IDS).not.toContain("slow")
    expect(VISIBLE_SHORTCUT_IDS).not.toContain("wordSpeak")
  })

  it("matchShortcut 要求修饰键完全一致", () => {
    const sc = mergeShortcuts(null)
    // 绑了 ctrl：按 ctrl 或 meta 都算
    expect(matchShortcut(keyEvent("p", { ctrl: true }), "play", sc)).toBe(true)
    expect(matchShortcut(keyEvent("p", { meta: true }), "play", sc)).toBe(true)
    // 没按修饰键 → 不算
    expect(matchShortcut(keyEvent("p"), "play", sc)).toBe(false)
    // 多按了 shift/alt → 不算（否则 ⌘+Shift+P 会误触发）
    expect(matchShortcut(keyEvent("p", { ctrl: true, shift: true }), "play", sc)).toBe(false)
    expect(matchShortcut(keyEvent("p", { ctrl: true, alt: true }), "play", sc)).toBe(false)
  })

  it("matchShortcut 对方向键用 e.key 原名比较", () => {
    const sc = mergeShortcuts(null)
    expect(matchShortcut(keyEvent("ArrowLeft", { ctrl: true }), "prevSent", sc)).toBe(true)
    expect(matchShortcut(keyEvent("ArrowRight", { ctrl: true }), "nextSent", sc)).toBe(true)
    // 左键不该命中「下一句」
    expect(matchShortcut(keyEvent("ArrowLeft", { ctrl: true }), "nextSent", sc)).toBe(false)
  })

  it("mergeShortcuts 丢弃 Enter/空格，回退到默认", () => {
    // 参考站 shortcut-config.js:52 的 FORBIDDEN_KEYS
    const merged = mergeShortcuts({ play: { key: "Enter", ctrl: true } })
    expect(merged.play.key).toBe("p")
    const merged2 = mergeShortcuts({ play: { key: " ", ctrl: true } })
    expect(merged2.play.key).toBe("p")
  })

  it("mergeShortcuts 保留合法自定义值，并用默认补齐缺项", () => {
    const merged = mergeShortcuts({ answer: { key: "b", ctrl: true, shift: true, alt: false } })
    expect(merged.answer.key).toBe("b")
    expect(merged.answer.shift).toBe(true)
    // 没写的项仍是默认
    expect(merged.play.key).toBe("p")
  })

  it("mergeShortcuts 对损坏输入不抛异常，全部回默认", () => {
    expect(mergeShortcuts("not an object").play.key).toBe("p")
    expect(mergeShortcuts(null).answer.key).toBe("a")
  })

  it("保存/读取走同一个键，且不落 label", () => {
    const sc = { ...mergeShortcuts(null), answer: { ...DEFAULT_SHORTCUTS.answer, key: "b" } }
    saveShortcuts(sc)
    const raw = JSON.parse(localStorage.getItem("practice_shortcuts") as string)
    expect(raw.answer.key).toBe("b")
    // label 是展示文案，不该进存储（参考站 shortcut-config.js:97-104）
    expect(raw.answer.label).toBeUndefined()
    expect(loadShortcuts().answer.key).toBe("b")
  })

  it("isDefaultShortcuts 只在全部等于默认时为真", () => {
    const base = mergeShortcuts(null)
    expect(isDefaultShortcuts(base)).toBe(true)
    const changed = { ...base, play: { ...base.play, key: "o" } }
    expect(isDefaultShortcuts(changed)).toBe(false)
    // 只改修饰键也算「非默认」
    const shifted = { ...base, play: { ...base.play, shift: true } }
    expect(isDefaultShortcuts(shifted)).toBe(false)
  })

  it("resetShortcuts 把改过的值全部收回默认并落盘", () => {
    const sc = { ...mergeShortcuts(null), play: { ...DEFAULT_SHORTCUTS.play, key: "o" } }
    saveShortcuts(sc)
    expect(isDefaultShortcuts(loadShortcuts())).toBe(false)
    resetShortcuts()
    expect(isDefaultShortcuts(loadShortcuts())).toBe(true)
  })

  it("isBrowserReserved 只拦「无 shift/alt 的浏览器键」", () => {
    // 参考站 shortcut-config.js:23-40 + isBrowserReserved 的 !shift && !alt
    expect(isBrowserReserved({ key: "c", ctrl: true, shift: false, alt: false })).toBe(true)
    expect(isBrowserReserved({ key: "c", ctrl: true, shift: true, alt: false })).toBe(false)
    expect(isBrowserReserved({ key: "k", ctrl: true, shift: false, alt: false })).toBe(false)
  })

  it("findShortcutConflict 找出占用了同一组合的其它动作", () => {
    const sc = mergeShortcuts(null)
    // ⌘+U 已归 favorite
    expect(findShortcutConflict("play", { key: "u", ctrl: true, shift: false, alt: false }, sc)).toBe(
      "收藏句子",
    )
    // 自己不跟自己冲突
    expect(findShortcutConflict("favorite", { key: "u", ctrl: true, shift: false, alt: false }, sc)).toBeNull()
    expect(findShortcutConflict("play", { key: "o", ctrl: true, shift: false, alt: false }, sc)).toBeNull()
  })

  it("validateCombo 逐条拦住不可用的组合", () => {
    const sc = mergeShortcuts(null)
    // 回车 / 空格
    expect(validateCombo("play", { key: "Enter", ctrl: false, shift: false, alt: false }, sc)?.reason).toBe(
      "forbidden",
    )
    expect(validateCombo("play", { key: " ", ctrl: true, shift: false, alt: false }, sc)?.reason).toBe(
      "forbidden",
    )
    // 单字符且无 Ctrl/Alt
    expect(validateCombo("play", { key: "b", ctrl: false, shift: false, alt: false }, sc)?.reason).toBe(
      "single-char",
    )
    // 功能键单按是允许的
    expect(validateCombo("play", { key: "F5", ctrl: false, shift: false, alt: false }, sc)).toBeNull()
    // 浏览器保留键
    expect(validateCombo("play", { key: "c", ctrl: true, shift: false, alt: false }, sc)?.reason).toBe(
      "reserved",
    )
    // 与其它动作冲突
    const conflict = validateCombo("play", { key: "u", ctrl: true, shift: false, alt: false }, sc)
    expect(conflict?.reason).toBe("conflict")
    expect(conflict?.conflictLabel).toBe("收藏句子")
    // 合法
    expect(validateCombo("play", { key: "o", ctrl: true, shift: false, alt: false }, sc)).toBeNull()
  })

  it("extractComboFromEvent 忽略纯修饰键，单字符转小写", () => {
    expect(extractComboFromEvent(keyEvent("Control", { ctrl: true }))).toBeNull()
    expect(extractComboFromEvent(keyEvent("Meta", { meta: true }))).toBeNull()
    expect(extractComboFromEvent(keyEvent("P", { ctrl: true }))).toEqual({
      key: "p",
      ctrl: true,
      shift: false,
      alt: false,
    })
    // 功能键保留原名
    expect(extractComboFromEvent(keyEvent("F5"))?.key).toBe("F5")
  })

  it("shortcutKbdParts 按段拆分，修饰键与主键分开", () => {
    const sc = mergeShortcuts(null)
    const parts = shortcutKbdParts("play", sc)
    // 最后一段是主键，前面是修饰键 —— 顺序与参考站 getShortcutKbd 一致
    expect(parts[parts.length - 1]).toBe("P")
    expect(parts.length).toBeGreaterThanOrEqual(2)
    // 单一事实源：把 Shift 打开后必须多出一段
    const withShift = { ...sc, play: { ...sc.play, shift: true } }
    expect(shortcutKbdParts("play", withShift)).toHaveLength(parts.length + 1)
  })

  it("每个动作都能渲染出非空快捷键片段", () => {
    const sc = mergeShortcuts(null)
    for (const id of Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[]) {
      const parts = shortcutKbdParts(id, sc)
      expect(parts.length).toBeGreaterThan(0)
      expect(parts.every((p) => p.length > 0)).toBe(true)
    }
  })
})
