import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { DictionaryClient } from "@/components/home/DictionaryClient"

export default async function DictionaryPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <DictionaryClient />
}
