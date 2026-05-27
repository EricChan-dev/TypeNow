import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import PartnerDashboard from "./PartnerDashboard"
import PartnerJoin from "./PartnerJoin"

export default async function PartnerPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  let isPartner = false
  if (db) {
    const [user] = await db
      .select({ isPartner: users.isPartner })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
    isPartner = !!user?.isPartner
  }

  return isPartner ? <PartnerDashboard /> : <PartnerJoin />
}
