import type { Metadata } from "next"
import { MyCoursesClient } from "@/components/home/store/MyCoursesClient"
import { BRAND } from "@/lib/brand"
// 卡片与课程广场共用同一份生成的样式（scoped 到 .store-market-page）——
// 用户要求两处卡片统一，所以这里也引入，而不是各写一份 Tailwind。
import "../store/store-market.css"

export const metadata: Metadata = {
  title: `我的课程 - ${BRAND.nameZh}`,
}

export default function CoursesPage() {
  return <MyCoursesClient />
}
