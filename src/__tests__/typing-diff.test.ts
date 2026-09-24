/**
 * 逐字符错误定位（src/lib/typing-diff.ts）。
 *
 * 存在的理由：错词现在整格变红，**不指出哪个字母错**，而答案默认又不显示，
 * 用户唯一出路是退格硬猜。这是练习闭环里最断的一环：反馈有情绪、没有信息。
 *
 * 判定口径必须与 isTypingMatch 同源（都走 normalizeForTyping），
 * 否则会出现「判对但标红」这种自相矛盾的画面。
 */
import { describe, it, expect } from "vitest"
import { charStatuses, hasMismatch } from "@/lib/typing-diff"

describe("charStatuses — 标出错误位置", () => {
  it("全对时每个字符都是 ok", () => {
    expect(charStatuses("hello", "hello")).toEqual(["ok", "ok", "ok", "ok", "ok"])
  })

  it("中间敲错 → 只有那一位 wrong，后面的位继续比对", () => {
    // helo vs hello：第 4 位 o≠l，第 5 位用户还没敲
    expect(charStatuses("helo", "hello")).toEqual(["ok", "ok", "ok", "wrong", "missing"])
  })

  it("多敲了字符 → 多出来的位是 wrong（不再静默吞键）", () => {
    expect(charStatuses("helloo", "hello")).toEqual(["ok", "ok", "ok", "ok", "ok", "wrong"])
  })

  it("大小写不敏感（与 isTypingMatch 一致）", () => {
    expect(charStatuses("Hello", "hello")).toEqual(["ok", "ok", "ok", "ok", "ok"])
  })

  it("弯引号等排版字符归一化后算对（与判题同源）", () => {
    expect(charStatuses("don't", "don\u2019t")).toEqual(["ok", "ok", "ok", "ok", "ok"])
  })

  it("空输入 → 期望的每一位都还是 missing", () => {
    expect(charStatuses("", "ab")).toEqual(["missing", "missing"])
  })

  it("期望为空时不产出任何位，且不炸", () => {
    expect(charStatuses("", "")).toEqual([])
    expect(charStatuses("abc", "")).toEqual(["wrong", "wrong", "wrong"])
  })
})

describe("hasMismatch — 当前输入是否与期望不符", () => {
  it("完全一致（含大小写与排版字符差异）不算错", () => {
    expect(hasMismatch("hello", "hello")).toBe(false)
    expect(hasMismatch("Hello", "hello")).toBe(false)
    expect(hasMismatch("don't", "don\u2019t")).toBe(false)
  })

  it("少敲、敲错、多敲都算错", () => {
    expect(hasMismatch("helo", "hello")).toBe(true)
    expect(hasMismatch("helloo", "hello")).toBe(true)
    expect(hasMismatch("", "hello")).toBe(true)
  })
})
