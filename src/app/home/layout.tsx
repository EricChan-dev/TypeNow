import { redirect } from "next/navigation"
import { getUser, isSupabaseConfigured } from "@/app/actions/auth"
import { createClient } from "@/lib/supabase/server"
import { ConditionalTopbar } from "@/components/home/ConditionalTopbar"
import { HomeShell } from "@/components/home/HomeShell"

export default async function HomeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUser()
  const supabaseReady = await isSupabaseConfigured()

  if (supabaseReady && !user) {
    redirect("/login")
  }

  // Fetch profile from DB for avatar (not available in auth metadata for non-OAuth users)
  let profile: { name: string | null; avatar: string | null; is_pro: boolean; level: number } | null = null
  if (supabaseReady && user) {
    const supabase = await createClient()
    if (supabase) {
      const { data } = await supabase
        .from("profiles")
        .select("name, avatar, is_pro, level")
        .maybeSingle()
      profile = data
    }
  }

  const serverUser = user
    ? {
        name: profile?.name || user.user_metadata?.name || user.email?.split("@")[0] || null,
        avatar: profile?.avatar || user.user_metadata?.avatar_url || null,
        email: user.email || null,
        is_pro: profile?.is_pro || false,
        level: profile?.level || 1,
      }
    : null

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <ConditionalTopbar serverUser={serverUser} />
      <HomeShell>{children}</HomeShell>
    </div>
  )
}
