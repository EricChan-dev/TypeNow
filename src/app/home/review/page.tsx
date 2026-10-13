import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/user"
import { MistakeBookClient } from "@/components/home/MistakeBookClient"
import "./mistake-book.css"

export default async function ReviewPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <MistakeBookClient />
}
