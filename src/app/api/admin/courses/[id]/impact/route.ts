import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { courseDeleteImpact } from "@/lib/soft-delete"

/**
 * 「删这门课会连带影响多少内容」。
 *
 * 为什么单独一个接口而不是塞进列表里：删除按钮在列表页上，而列表页一次有 20 行，
 * 逐行算影响面就是 20 次 join 统计（N+1）。改成点删除时才按需查一次，
 * 既省查询又保证弹窗里的数字是点下去那一刻的真实值。
 *
 * 这个数字是软删除方案里"确认"这一环的核心：没有它，
 * 「删除」按钮和「删掉 16,891 条课时」在界面上长得一模一样。
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const impact = await courseDeleteImpact(id)
  return NextResponse.json({ data: impact })
}
