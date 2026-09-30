/**
 * 句 id 的两种形态：原句 id 与「分块练习项」id。
 *
 * 练习页会把「有 chunks 的句子」展开成若干条练习项，id 形如
 * `<原句 id>_c<order>`（见 LearnClient 的 expandSentences）。于是同一个页面上
 * 有**两套 id 口径**，用错了都不会当场报错：
 *
 *   · **练习进度**类接口（review/complete、wordbook、practice/record）认**原句 id**，
 *     数据库里并不存在 `xxx_c0` 这一行 → 用 `baseSentenceId()`。
 *   · **跟读评分**认**练习项 id**，因为分块是各自独立朗读与评分的：
 *     一句有 3 个分块就有 3 个分块各自的分数，落到自己那一行。
 *     每个分块都被朗读一次，所以"整句一个分"是没有意义的。
 *
 * 这个后缀原本在 LearnClient 里被就地手写了 4 遍，漏掉任何一处，
 * 用户看到的就是「Review item not found」这类无迹可寻的失败。
 */

/**
 * 剥掉 `_c<数字>` 分块后缀，得到下游接口认的原句 id。
 *
 * 刻意要求后缀是 `_c` + **纯数字**：id 里出现 `_c` 是可能的（slug 形态的 id、
 * 甚至 `my_course`），只按 `includes("_c")` 切会把这些 id 削断。
 *
 * 若剥离结果为空（id 本身就长成 `_c0`），原样返回 —— 给下游一个空 id
 * 只会换来更难查的 400，不如让请求带着原值失败得明明白白。
 */
export function baseSentenceId(id: string | null | undefined): string {
  if (typeof id !== "string" || id.length === 0) return ""
  const match = /_c\d+$/.exec(id)
  if (!match) return id
  const base = id.slice(0, match.index)
  return base.length > 0 ? base : id
}

/**
 * 这是不是一个「分块练习项」的 id（`<原句 id>_c<order>`）。
 *
 * 与 baseSentenceId 用同一个正则，别处不要另写一份判断 —— 两处规则一旦不一致，
 * 就会出现"按原句 id 存、按分块 id 读"这类查不出来的错配。
 */
export function isChunkPracticeItemId(id: string | null | undefined): boolean {
  return typeof id === "string" && /_c\d+$/.test(id)
}
