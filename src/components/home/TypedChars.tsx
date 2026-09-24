"use client"

import { charStatuses } from "@/lib/typing-diff"

/**
 * 逐字符渲染用户已输入的内容。
 *
 * 出错时不再把整格染红：对上的字符保持正常颜色，错的字符标红。用户一眼就知道
 * 错在第几个字母，而不是面对一个全红的词只能整词退格硬猜 —— 这是练习闭环里
 * 原先最断的一环（反馈有情绪、没有信息）。
 *
 * 练习页与复习页共用这一个实现，避免两页的判错口径再次漂移。
 */
export function TypedChars({ value, expected }: { value: string; expected: string }) {
  if (!value) return null
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
