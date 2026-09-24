/**
 * 沉浸式练习路由判定。
 *
 * 练习页 / 复习作答页都是 `fixed inset-0` 的全屏界面：首页 layout 里那些
 * 「会员即将到期」横幅和弹窗会直接盖在题目上 —— 卡片挡住正在打的句子，
 * 弹窗还会把正在进行的练习顶掉，用户只能中断练习去处理。
 * 所以这些组件必须知道自己在哪儿，在这些路由上整体退出渲染。
 *
 * 判定刻意写成「精确路径 + 带斜杠的目录前缀」两张表，而不是 `startsWith("/home/learn")`：
 * 后者一旦有人写出 `/home/learner` 就会误伤，前缀相同的路由不该被吞掉。
 */
const IMMERSIVE_EXACT = new Set<string>([
  "/home/review/session",
])

const IMMERSIVE_PREFIXES: string[] = [
  "/home/learn/",
]

export function isImmersivePracticeRoute(pathname?: string | null): boolean {
  if (!pathname) return false
  // 去掉结尾斜杠再比，/home/learn/abc/ 与 /home/learn/abc 是同一个页面
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  if (!normalized) return false
  if (IMMERSIVE_EXACT.has(normalized)) return true
  return IMMERSIVE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}
