"use client"

import { charStatuses } from "@/lib/typing-diff"

/**
 * 逐字符渲染用户已输入的内容。
 *
 * `revealErrors` 决定**什么时候**把错的字母标红，这是刻意分开的两态：
 *
 *   false（敲字过程中）—— 全部正常着色。用户敲到一半时前缀本来就不匹配
 *     （"tom" 之于 "tomorrow" 是对的，但 "tomx" 也还没确认），如果边敲边红，
 *     每个词打到一半都在闪红，反馈噪音把真正的错误淹没了；
 *     而且"我还想改一下"和"我打错了"在视觉上分不出来。
 *   true（按 Enter / 空格确认之后）—— 对上的字符保持正常色，错的标红。
 *     用户一眼看出错在第几个字母，而不是面对一个全红的词整词退格硬猜。
 *
 * 所以调用方要在「已确认」时才传 true：练习页传 `ws.status === "error"`，
 * 复习页同口径（两页共用这个实现，避免判错口径再次漂移）。
 */
export function TypedChars({
  value,
  expected,
  revealErrors = false,
}: {
  value: string
  expected: string
  revealErrors?: boolean
}) {
  if (!value) return null
  // 未确认时完全不比对：省掉一次逐字符计算，也保证不会"手滑"着色
  if (!revealErrors) return <>{value}</>

  const statuses = charStatuses(value, expected)
  return (
    <>
      {Array.from(value).map((ch, i) => (
        <span key={i} className={statuses[i] === "ok" ? undefined : "text-red-500"}>
          {ch}
        </span>
      ))}
    </>
  )
}
