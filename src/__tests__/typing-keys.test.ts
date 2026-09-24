/**
 * 练习页 / 复习页共用的按键语义（src/lib/typing-keys.ts）。
 *
 * 这里锁定的是「两页必须一致」这件事本身：历史上空格键在两页语义冲突，
 * 复习页用正常打字习惯敲空格会被判错。
 */
import { describe, it, expect } from "vitest"
import { classifyTypingKey, isEditableTarget } from "@/lib/typing-keys"

describe("classifyTypingKey — 空格必须归为 confirm，不能当普通字符", () => {
  it("空格 → confirm（两页统一：确认当前词）", () => {
    expect(classifyTypingKey({ key: " " })).toBe("confirm")
  })

  it("字母与标点 → letter", () => {
    expect(classifyTypingKey({ key: "a" })).toBe("letter")
    expect(classifyTypingKey({ key: "Z" })).toBe("letter")
    expect(classifyTypingKey({ key: "'" })).toBe("letter")
    expect(classifyTypingKey({ key: "-" })).toBe("letter")
    expect(classifyTypingKey({ key: "3" })).toBe("letter")
  })

  it("Backspace → backspace", () => {
    expect(classifyTypingKey({ key: "Backspace" })).toBe("backspace")
  })

  it("组合键一律 ignore —— 各页自己的 Ctrl+X 快捷键在调用前已处理", () => {
    expect(classifyTypingKey({ key: "p", ctrlKey: true })).toBe("ignore")
    expect(classifyTypingKey({ key: " ", ctrlKey: true })).toBe("ignore")
    expect(classifyTypingKey({ key: "a", metaKey: true })).toBe("ignore")
    expect(classifyTypingKey({ key: "a", altKey: true })).toBe("ignore")
  })

  it("Enter 与长度大于 1 的键不归口（练习页用 Enter 提交整句，复习页用 Enter 选评分）", () => {
    expect(classifyTypingKey({ key: "Enter" })).toBe("ignore")
    expect(classifyTypingKey({ key: "Tab" })).toBe("ignore")
    expect(classifyTypingKey({ key: "ArrowRight" })).toBe("ignore")
    expect(classifyTypingKey({ key: "Shift" })).toBe("ignore")
    // 中文输入法等产生的组合态按键
    expect(classifyTypingKey({ key: "Process" })).toBe("ignore")
    expect(classifyTypingKey({ key: "Unidentified" })).toBe("ignore")
  })

  it("空 key 不炸也不误判", () => {
    expect(classifyTypingKey({ key: "" })).toBe("ignore")
  })
})

describe("isEditableTarget — 焦点在输入框时必须放手", () => {
  it("input / textarea / select → 放手", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true)
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true)
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true)
    // 大小写不敏感（不同浏览器给的大小写不一致）
    expect(isEditableTarget({ tagName: "input" })).toBe(true)
  })

  it("contenteditable → 放手", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true)
  })

  it("软键盘捕获框必须放行 —— 否则手机上完全没有输入", () => {
    expect(isEditableTarget({ tagName: "INPUT", isSoftKeyboardInput: true })).toBe(false)
  })

  it("普通元素 / 未知目标 → 接管", () => {
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false)
    expect(isEditableTarget({ tagName: "BODY" })).toBe(false)
    expect(isEditableTarget({})).toBe(false)
    expect(isEditableTarget({ tagName: null })).toBe(false)
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: false })).toBe(false)
  })
})
