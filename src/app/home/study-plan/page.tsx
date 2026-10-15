import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { StudyPlanClient } from "@/components/home/StudyPlanClient"

export default async function StudyPlanPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <StudyPlanClient />
}
