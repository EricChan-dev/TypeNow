/**
 * 句 id 的基础化（去掉分块后缀）。
 *
 * 练习页会把「有 chunks 的句子」展开成若干条练习项，id 形如
 * `<原句 id>_c<order>`（见 LearnClient 的 expandSentences）。但所有下游
 * 接口 —— review/complete、wordbook、practice/record —— 认的都是原句 id，
 * 数据库里并不存在 `xxx_c0` 这一行。
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
