import { getCurrentUser } from "@/lib/auth/user"
import { HomeClient } from "@/components/home/HomeClient"

export default async function HomePage() {
  const user = await getCurrentUser()
  const name = user?.name || "同学"

  return <HomeClient name={name} />
}
