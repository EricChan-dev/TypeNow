import "../market-course-detail.css"
import { CourseDetailClient } from "@/components/home/store/CourseDetailClient"

/**
 * 课程市场 · 课程详情页。
 *
 * 页面级样式是生成物（scripts/extract-market-course-css.py，选择器收敛在
 * .course-market-detail 下），在这里整页引入；组件见 CourseDetailClient.tsx。
 */
export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = await params
  return <CourseDetailClient courseId={courseId} />
}
