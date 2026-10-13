import "../course-detail.css"
import { CourseDetailClient } from "@/components/home/courses/CourseDetailClient"

/**
 * 我的课程 · 课程详情页（复刻参考站 /User/CourseDetail/{id}）。
 *
 * 练习页的「返回」一直指向这里（DictationPractice.tsx 的 goBack：
 * `/home/courses/${courseId}`），在本路由落地前那是个 404 —— 本页同时修掉它。
 * 商城详情 /home/store/[courseId] 是另一条产品线（发现→获取），保持不动。
 */
export default async function MyCourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = await params
  return <CourseDetailClient courseId={courseId} />
}
