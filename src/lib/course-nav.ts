/**
 * 课时导航 —— 完成一课后找「下一课」。
 *
 * 存在的理由：完成弹窗只有「再来一次 / 返回课程」，没有「继续下一课」，
 * 用户学完一课必须自己回课程详情页重新找，学习流在这里断掉。
 *
 * 顺序以调用方传入的数组为准（/api/courses/[id]/lessons 已按 sort_order 升序返回），
 * 本函数不重新排序，避免出现「接口顺序」与「前端顺序」两套口径。
 */

export interface LessonRef {
  id: string
}

/**
 * 返回当前课时的下一课；当前课时是最后一课、不在列表里、或列表为空时返回 null。
 * 找不到当前课时时不猜（不返回第一课）—— 那会让用户以为自己跳到了下一课。
 */
export function findNextLesson<T extends LessonRef>(
  lessons: readonly T[] | null | undefined,
  currentId: string | null | undefined,
): T | null {
  if (!lessons || lessons.length === 0) return null
  if (!currentId) return null
  const idx = lessons.findIndex((l) => l.id === currentId)
  if (idx === -1) return null
  return lessons[idx + 1] ?? null
}
