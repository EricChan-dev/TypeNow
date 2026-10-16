import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { TextbookSyncClient } from "@/components/home/TextbookSyncClient"
import { BRAND } from "@/lib/brand"
import "./textbook-sync.css"

/**
 * 课本同步（教材同步）。
 *
 * 内容就是课程广场的课程（`category_key = 'school_sync'`），
 * 但筛选项是**年级 → 版本** 这套面向 K12 的扁平双行维度，
 * 与课程广场的「类别 → 子类」不是一回事。所以独立成页。
 * 纯逻辑在 src/lib/textbook-sync.ts，样式由 scripts/extract-textbook-sync-css.py 生成。
 */
export const metadata: Metadata = {
  title: `课本同步 - ${BRAND.nameZh}`,
}

export default async function TextbookPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <TextbookSyncClient />
}
