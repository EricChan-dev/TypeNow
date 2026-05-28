import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { ReviewClient } from "@/components/home/ReviewClient"

export default async function ReviewPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <ReviewClient />
}
