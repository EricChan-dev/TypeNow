import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { lessonDeleteImpact } from "@/lib/soft-delete"

/** 「删这个课时会影响多少句子」，供删除前的二次确认展示。见 courses/[id]/impact。 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const impact = await lessonDeleteImpact(id)
  return NextResponse.json({ data: impact })
}
