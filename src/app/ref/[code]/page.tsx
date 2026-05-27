import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import RefLandingClient from "./RefLandingClient"

interface Props {
  params: Promise<{ code: string }>
}

export default async function RefPage({ params }: Props) {
  const { code } = await params
  const inviteCode = code.toUpperCase()

  let partner: { name: string | null; avatar: string | null } | null = null

  if (db) {
    const [row] = await db
      .select({ name: users.name, avatar: users.avatar })
      .from(users)
      .where(eq(users.inviteCode, inviteCode))
      .limit(1)
    partner = row ?? null
  }

  if (!partner) return notFound()

  return <RefLandingClient inviteCode={inviteCode} partnerName={partner.name} partnerAvatar={partner.avatar} />
}
