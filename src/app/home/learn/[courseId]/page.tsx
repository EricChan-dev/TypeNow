import { LearnClient } from "@/components/home/learn/LearnClient"

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>
  searchParams: Promise<{ lesson?: string }>
}) {
  const { courseId } = await params
  const { lesson: lessonId } = await searchParams

  if (!lessonId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm font-medium text-muted-foreground">缺少课程信息</p>
        <p className="text-xs text-muted-foreground/70 mt-1">请从课程详情页进入</p>
      </div>
    )
  }

  // 这里**不再**把非会员重定向到 /pricing。
  //
  // 原先是「非会员一律 redirect('/pricing?reason=learn')」，用户连练习页都进不去，
  // 等于在体验产品核心价值之前就先看到收费墙。现在改为放行，由
  // /api/courses/sentences 只下发每课前 FREE_TRIAL_SENTENCES 句试学，
  // 练完后在客户端展示付费引导。会员校验仍在服务端，不依赖页面层。
  return <LearnClient courseId={courseId} lessonId={lessonId} />
}
