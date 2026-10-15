import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { PhoneticsClient } from "@/components/home/PhoneticsClient"

export default async function PhoneticsPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <PhoneticsClient />
}
