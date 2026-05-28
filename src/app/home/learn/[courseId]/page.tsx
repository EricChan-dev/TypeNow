import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"
import { checkAndExpirePro } from "@/lib/subscription"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
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

  // Membership gate: require active pro to access learning
  if (db) {
    const session = await getSession()
    if (session) {
      await checkAndExpirePro(session.userId)
      const [user] = await db
        .select({ isPro: users.isPro })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1)
      if (user && !user.isPro) {
        redirect("/pricing?reason=learn")
      }
    }
  }

  return <LearnClient courseId={courseId} lessonId={lessonId} />
}
