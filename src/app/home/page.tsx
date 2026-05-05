import Link from "next/link"
import { redirect } from "next/navigation"
import { getUser, isSupabaseConfigured } from "@/app/actions/auth"
import { ProgressCard } from "@/components/home/ProgressCard"
import { SceneSelector } from "@/components/home/SceneSelector"
import { ReviewReminder } from "@/components/home/ReviewReminder"
import { WeeklyStats } from "@/components/home/WeeklyStats"

export default async function HomePage() {
  const user = await getUser()
  const supabaseReady = await isSupabaseConfigured()

  // Only redirect if Supabase is configured and user isn't logged in
  if (supabaseReady && !user) {
    redirect("/login")
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-8 space-y-8">
      {/* Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">
            欢迎回来{user?.user_metadata?.name ? `，${user.user_metadata.name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {supabaseReady
              ? "继续你的英语学习之旅"
              : "开发模式 - Supabase 未配置"}
          </p>
        </div>
        <Link
          href="/practice"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          开始练习
        </Link>
      </div>

      {/* Progress overview */}
      <ProgressCard />

      {/* Scene selection */}
      <section>
        <h2 className="text-lg font-semibold mb-4">选择场景开始练习</h2>
        <SceneSelector />
      </section>

      {/* Review reminder + Weekly stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ReviewReminder />
        <WeeklyStats />
      </div>
    </div>
  )
}
