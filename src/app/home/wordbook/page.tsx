import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { WordbookClient } from "@/components/home/WordbookClient"

export default async function WordbookPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <WordbookClient />
}
