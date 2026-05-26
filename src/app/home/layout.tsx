import { redirect } from "next/navigation"
import { getUser, isDbConfigured } from "@/app/actions/auth"
import { ConditionalTopbar } from "@/components/home/ConditionalTopbar"
import { HomeShell } from "@/components/home/HomeShell"

export default async function HomeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const dbReady = await isDbConfigured()
  const user = await getUser()

  if (dbReady && !user) {
    redirect("/login")
  }

  const serverUser = user
    ? {
        name: user.name || null,
        avatar: user.avatar || null,
        email: user.email || null,
        is_pro: !!user.isPro,
        level: user.level,
      }
    : null

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <ConditionalTopbar serverUser={serverUser} />
      <HomeShell>{children}</HomeShell>
    </div>
  )
}
