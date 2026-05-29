import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { NotesClient } from "@/components/home/NotesClient"

export default async function NotesPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <NotesClient />
}
