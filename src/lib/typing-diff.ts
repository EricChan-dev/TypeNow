/**
 * 逐字符错误定位。
 *
 * 存在的理由：错词现在整格变红，**不指出哪个字母错**，而答案默认又不显示，
 * 用户唯一出路是退格硬猜。这是练习闭环里最断的一环：反馈有情绪、没有信息。
 *
 * 判定口径必须与 isTypingMatch 同源（都走 normalizeForTyping），
 * 否则会出现「判对但标红」这种自相矛盾的画面。
 */
import { normalizeForTyping } from "@/lib/typing-compare"

export type CharStatus = "ok" | "wrong" | "missing"

/**
 * 把用户输入与期望逐位比对。
 *
 * 返回数组长度 = max(输入, 期望)：这样多敲出来的字符也有位置可标（"wrong"），
 * 渲染时不会有字符因为「没有对应位」而丢失。
 */
export function charStatuses(input: string, expected: string): CharStatus[] {
  const a = normalizeForTyping(input ?? "").toLowerCase()
  const b = normalizeForTyping(expected ?? "").toLowerCase()
  const len = Math.max(a.length, b.length)
  const out: CharStatus[] = []
  for (let i = 0; i < len; i++) {
    if (i >= a.length) out.push("missing")
    else if (i >= b.length) out.push("wrong")
    else out.push(a[i] === b[i] ? "ok" : "wrong")
  }
  return out
}

/** 当前输入是否与期望不符（少敲/敲错/多敲都算）。 */
export function hasMismatch(input: string, expected: string): boolean {
  return normalizeForTyping(input ?? "").toLowerCase() !== normalizeForTyping(expected ?? "").toLowerCase()
}
