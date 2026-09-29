import type { Metadata } from "next"
import { TextbookClient } from "@/components/home/store/TextbookClient"

/**
 * 教材同步。
 *
 * 内容就是课程广场的课程（`category_key = 'school_sync'`），
 * 但筛选项是**学段 → 年级 → 版本** 这套面向 K12 的维度，与课程广场的
 * 「类别 → 子类」不是一回事。所以独立成页、复用课程卡片（见 TextbookClient 的注释）。
 */
export const metadata: Metadata = {
  title: "教材同步 - TypeNow",
}

export default function TextbookPage() {
  return <TextbookClient />
}
