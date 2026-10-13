import { PracticeModeGate } from "@/components/home/learn/PracticeModeGate"
// 相对本文件上一级：CSS 落在 `src/app/home/learn/`（与 route 目录同级，
// 不是路由段内部），所以用 `../`。写成 `./` 会让 Turbopack 去找
// `[courseId]/practice.css` 并报 Module not found。
import "../practice.css"
import "../practice-fonts.css"
// 模式切换器的样式单独一份：它是听写页与非听写页共用的组件，最初非听写模式
// 走的是旧 LearnClient（不在 `.practice-shell` 里），`practice.css` 里那套
// `.practice-shell …` 前缀的选择器在那儿一条都命中不了。两份文件同源
// （都由 scripts/extract-practice-css.py 从参考 CSS 抽取），作用域前缀不同。
// 旧界面虽已删除，这份仍不能省：它的规则带 `:not(:where(.practice-shell) *)`
// 守卫，在壳内依然命中 mode-dropdown / mdt- / custom-modal 三族（见
// ModeSwitcher.tsx 顶部注释），删掉下拉会退化成无样式裸按钮。
import "../mode-switcher.css"

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>
  searchParams: Promise<{ lesson?: string; mode?: string }>
}) {
  const { courseId } = await params
  const { lesson: lessonId, mode } = await searchParams

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
  //
  // 模式分发在客户端做（PracticeModeGate）：URL 上的 `?mode=` 服务端就能读到，
  // 但 localStorage 里的「上次用的模式」读不到（服务端没有 window），
  // 所以最终由客户端决定渲染哪一套界面。CSS 统一在这里引入 ——
  // `practice.css` 是抽取产物、选择器全部收敛在 `.practice-shell` 下，
  // 全局引入不会污染其它页面。
  // 只传数据，不传组件/函数：RSC 的序列化边界只能过可序列化的值。
  // 两个实现由 PracticeModeGate 自己 import（它是客户端组件）。
  return <PracticeModeGate urlMode={mode} lessonId={lessonId} courseId={courseId} />
}
