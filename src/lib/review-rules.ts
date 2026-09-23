/**
 * 复习接口的入参校验规则（纯函数，无 IO）。
 *
 * 从 /api/review/complete 里抽出来，是为了让「什么算合法入参」只有一处定义、
 * 能被单元测试直接覆盖，而不必每次起一个 HTTP 服务端。
 */

export type ReviewCompletionInput = {
  sentenceId?: unknown
  grade?: unknown
  mastered?: unknown
}

export type ReviewCompletion =
  | { ok: true; sentenceId: string; mastered: boolean; grade: number | null }
  | { ok: false; error: string }

/**
 * 归一化 grade。
 *
 * 只接受 0-5 的整数（数字，或能完整解析成数字的字符串）。返回 undefined 表示
 * 这个值不能当 grade 用 —— 注意不能返回 NaN，否则调用方拿它去比较会全部为 false，
 * 悄悄落到 grade 5 的分支（历史上 `grade < 0 || grade > 5` 就是这个漏洞）。
 */
export function coerceGrade(grade: unknown): number | undefined {
  if (typeof grade === "number") return Number.isInteger(grade) ? grade : undefined
  if (typeof grade === "string" && grade.trim() !== "") {
    const n = Number(grade)
    return Number.isInteger(n) ? n : undefined
  }
  return undefined
}

export function parseReviewCompletion(input: ReviewCompletionInput): ReviewCompletion {
  const sentenceId = typeof input.sentenceId === "string" ? input.sentenceId.trim() : ""
  if (!sentenceId) return { ok: false, error: "sentenceId required" }

  // mastered 只认真正的布尔 true：之前用真值判断，字符串 "false" 会被当成已掌握，
  // 用户点「还不熟」反而把句子标记成掌握了。
  const mastered = input.mastered === true
  if (mastered) return { ok: true, sentenceId, mastered: true, grade: null }

  if (input.grade === undefined || input.grade === null) {
    return { ok: false, error: "grade or mastered required" }
  }

  const grade = coerceGrade(input.grade)
  if (grade === undefined || grade < 0 || grade > 5) {
    return { ok: false, error: "grade must be an integer 0-5" }
  }

  return { ok: true, sentenceId, mastered: false, grade }
}
