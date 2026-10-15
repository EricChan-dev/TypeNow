import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { TensesClient } from "@/components/home/TensesClient"

export default async function TensesPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <TensesClient />
}
