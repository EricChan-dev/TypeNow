/**
 * 确定性洗牌：课时内混排的基础设施。
 *
 * 需求：练习题序不再等于课本顺序（对着课本背「下一句是什么」是无效记忆），
 * 但 practice_sessions.current_index 存的是「下一句要练的**下标**」——
 * 题目顺序如果在两次请求之间漂移，恢复下标就会指到另一句。
 *
 * 因此混排必须是**确定性**的：同一个 (user, lesson) 永远得到同一个乱序，
 * 恢复下标天然有效；不同用户之间彼此不同（也顺带防「背别人答案」）。
 * 不能用 Math.random()：每次刷新顺序都变，恢复下标立刻失效。
 *
 * 为什么种子不含「会话」：practice_sessions 的行是按 (user, lesson, mode)
 * upsert 复用的（重练同一槽位不新增行），行 id 与 startedAt 都不随重练变化，
 * 拿它们当熵源只会得到「看起来会换、实际永远不换」的假象，还得多一次查表。
 * 固定 user×lesson 种子是当前会话模型下唯一不撒谎的选择。
 */

/** FNV-1a 32 位：把任意字符串压成稳定的 32 位无符号种子 */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32：32 位种子的小型 PRNG，够快、够散、无依赖 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 练习题序的种子输入：NUL 分隔，避免 ("ab","c") 与 ("a","bc") 拼出同串 */
export function practiceOrderSeed(userId: string, lessonId: string): number {
  return fnv1a(`${userId}\u0000${lessonId}`)
}

/**
 * Fisher-Yates 洗牌（种子版）：返回新数组，不改入参。
 *
 * 纯函数是刻意的——调用方（/api/courses/sentences）拿到的是刚查出来的列表，
 * 就地打乱也没人受害，但纯函数才能用「同种子同结果」的单测锁住行为。
 */
export function shuffledBySeed<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice()
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}
