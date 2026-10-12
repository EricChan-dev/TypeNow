import { describe, it, expect } from "vitest"
import {
  DEFAULT_PRACTICE_MODE,
  PRACTICE_MODE_FULL_LABELS,
  PRACTICE_MODE_LABELS,
  PRACTICE_MODES,
  isPracticeMode,
  modeStorageKey,
  normalizePracticeMode,
  resolvePracticeMode,
  switchModeConfirmText,
} from "@/lib/practice-mode"

/**
 * 练习模式词汇表与模式恢复的行为契约。
 *
 * 这里锁的都是「改了会让老进度读不回来」或「文案与参考站不一致」的地方：
 * 取值本身、存储键名、优先级顺序、确认文案的逐字内容。
 */

describe("practice-mode", () => {
  it("四种模式的取值与参考站逐字一致", () => {
    // 参考站 data-mode 依次是 dictation / puzzle / learning / speaking。
    // 这些字符串会写进 practice_sessions.mode，漂移会让存量进度失效。
    expect(PRACTICE_MODES).toEqual(["dictation", "puzzle", "learning", "speaking"])
    expect(DEFAULT_PRACTICE_MODE).toBe("dictation")
  })

  it("中文名与参考站下拉菜单一致", () => {
    expect(PRACTICE_MODE_LABELS).toEqual({
      dictation: "听写",
      puzzle: "拼图",
      learning: "学习",
      speaking: "口语",
    })
    // 确认弹窗里用的是全称
    expect(PRACTICE_MODE_FULL_LABELS.dictation).toBe("听写模式")
    expect(PRACTICE_MODE_FULL_LABELS.speaking).toBe("口语模式")
  })

  it("isPracticeMode 只认四个合法值", () => {
    expect(isPracticeMode("dictation")).toBe(true)
    expect(isPracticeMode("speaking")).toBe(true)
    expect(isPracticeMode("typing")).toBe(false)
    expect(isPracticeMode("")).toBe(false)
    expect(isPracticeMode(null)).toBe(false)
    expect(isPracticeMode(undefined)).toBe(false)
    expect(isPracticeMode(1)).toBe(false)
  })

  it("normalizePracticeMode 把脏值收敛成默认，而不是抛错", () => {
    // URL ?mode= 与 localStorage 里的旧值都可能脏；出错时应「当听写继续用」
    expect(normalizePracticeMode("puzzle")).toBe("puzzle")
    expect(normalizePracticeMode("garbage")).toBe(DEFAULT_PRACTICE_MODE)
    expect(normalizePracticeMode(null)).toBe(DEFAULT_PRACTICE_MODE)
    expect(normalizePracticeMode({ mode: "dictation" })).toBe(DEFAULT_PRACTICE_MODE)
  })

  it("存储键名与参考站同款 lesson_<lessonId>_mode", () => {
    // 同名是刻意的：从参考站迁移过来的用户，偏好是同一份数据
    expect(modeStorageKey("abc-123")).toBe("lesson_abc-123_mode")
  })

  it("恢复优先级：URL > localStorage > 默认", () => {
    expect(resolvePracticeMode({ urlMode: "puzzle", storedMode: "speaking" })).toBe("puzzle")
    expect(resolvePracticeMode({ urlMode: "puzzle" })).toBe("puzzle")
    expect(resolvePracticeMode({ storedMode: "speaking" })).toBe("speaking")
    expect(resolvePracticeMode({})).toBe("dictation")
    // URL 脏但 localStorage 合法 → 用 localStorage
    expect(resolvePracticeMode({ urlMode: "nope", storedMode: "learning" })).toBe("learning")
    // 两者都脏 → 默认
    expect(resolvePracticeMode({ urlMode: "nope", storedMode: "nope" })).toBe("dictation")
  })

  it("确认文案逐字对齐参考站，且按当前模式动态取名", () => {
    // 参考站 practice.js:1287
    expect(switchModeConfirmText("dictation", "speaking")).toBe(
      "确定要从【听写模式】切换到【口语模式】吗？\n\n切换模式会结束当前进度，并从第一句重新开始。",
    )
    // 来源不能写死成「听写模式」：从拼图切学习时也必须说拼图
    expect(switchModeConfirmText("puzzle", "learning")).toBe(
      "确定要从【拼图模式】切换到【学习模式】吗？\n\n切换模式会结束当前进度，并从第一句重新开始。",
    )
    // 每个方向的文案都要带正确的两端
    for (const from of PRACTICE_MODES) {
      for (const to of PRACTICE_MODES) {
        const text = switchModeConfirmText(from, to)
        expect(text).toContain(PRACTICE_MODE_FULL_LABELS[from])
        expect(text).toContain(PRACTICE_MODE_FULL_LABELS[to])
      }
    }
  })
})
