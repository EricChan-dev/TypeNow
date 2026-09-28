/**
 * 「唯一键冲突」的判定。
 *
 * 为什么需要单独收敛一份：很多发放逻辑把**唯一键当幂等锁**用 —— 先 INSERT 一行
 * 记账，插得进去说明是第一次、插不进去说明已经发过。此时「插不进去」的原因必须
 * 被准确区分：
 *
 *   · ER_DUP_ENTRY  → 已发过，**应该**当作正常情况静默返回；
 *   · 其它任何错误  → 是故障（连接抖动、字段超长、库不可用），**不该**被当成
 *                     「已发过」而悄悄吞掉 —— 这正是 lib/auth/invite.ts 曾经
 *                     少发会员天数的形状：一个 `catch {}` 把两类错误混为一谈。
 *
 * drizzle 会把驱动错误包一层 DrizzleQueryError，原始错误挂在 `cause` 上，
 * 所以两层都要看。`code` 与 `errno` 任一命中即可（不同驱动/包装层给的字段不同）。
 */

/** MySQL 唯一键冲突的错误码。 */
export const DUPLICATE_KEY_ERRNO = 1062
export const DUPLICATE_KEY_CODE = "ER_DUP_ENTRY"

interface ErrorLike {
  code?: unknown
  errno?: unknown
  cause?: unknown
}

function matches(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as ErrorLike
  return e.code === DUPLICATE_KEY_CODE || Number(e.errno) === DUPLICATE_KEY_ERRNO
}

/** 这个错误是不是「唯一键冲突」。会向下看一层 `cause`（drizzle 的包装）。 */
export function isDuplicateKeyError(err: unknown): boolean {
  if (matches(err)) return true
  const cause = (err as ErrorLike | null | undefined)?.cause
  return matches(cause)
}
