/**
 * drizzle + mysql2 的 update 返回 `[ResultSetHeader, ...]`，受影响行数在第一个元素里。
 *
 * 这个判定此前在 chat / payment.notify / payment.order-status 三处各抄了一份，
 * 而「条件更新是否真的占用了这一行」是幂等与防并发的关键依据（订单只能被占用一次、
 * 试用只能被领取一次），抄错或改错任何一份都会静默变成「重复发放」。
 * 因此收敛到一处，新增调用点一律 import 这里。
 */
export function affectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: number } | undefined
    return Number(header?.affectedRows ?? 0)
  }
  return 0
}
