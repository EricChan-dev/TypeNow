import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { TypingClient } from "@/components/home/TypingClient"

export default async function TypingPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <TypingClient />
}
