/**
 * 审计日志的动作 / 对象类型词表。
 *
 * 单独成模块的理由与 admin-range.ts 一样：**它必须是无服务端依赖的纯模块**。
 * 后台页面是客户端组件，而写入侧的 lib/admin-audit.ts 会 import `@/lib/db`
 * （mysql2）—— 从页面直接 import 它，数据库驱动就会被打进浏览器包里。
 *
 * 两边共用这一份的另一个原因：接口按它校验筛选值，页面按它渲染选项与中文标签。
 * 各写一份的话，加了新动作就会出现"页面能选、接口不认"或反过来的情况。
 */

/** 动作词表。新增动作时**必须**在这里加一条，否则页面上只会显示英文原值 */
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "restore",
  "reorder",
  "split",
  "analyze",
  "upload",
  "import",
  "handle",
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** 对象类型词表 */
export const AUDIT_TARGET_TYPES = [
  "user",
  "course",
  "lesson",
  "sentence",
  "material",
  "feedback",
] as const
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number]

const ACTION_LABELS: Record<string, string> = {
  create: "新建",
  update: "编辑",
  delete: "移入回收站",
  restore: "从回收站恢复",
  reorder: "重排顺序",
  split: "AI 拆分",
  analyze: "AI 解析",
  upload: "上传教材",
  import: "批量导入",
  handle: "处理反馈",
}

const TARGET_LABELS: Record<string, string> = {
  user: "用户",
  course: "课程",
  lesson: "课时",
  sentence: "句子",
  material: "教材",
  feedback: "反馈",
}

/**
 * 认不出的值**原样返回**，不回落到"其它"。
 * 日志是历史的：将来删掉某个动作名，旧日志仍要能读出来当时写的是什么。
 */
export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function auditTargetLabel(targetType: string): string {
  return TARGET_LABELS[targetType] ?? targetType
}

/** 一行日志的人话摘要：「编辑 用户」 */
export function auditSummary(action: string, targetType: string): string {
  return `${auditActionLabel(action)} ${auditTargetLabel(targetType)}`
}

/** 用于筛选下拉的选项（值 + 中文标签），顺序按词表固定，不随数据变化抖动 */
export const AUDIT_ACTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  AUDIT_ACTIONS.map((a) => ({ value: a, label: auditActionLabel(a) }))

export const AUDIT_TARGET_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  AUDIT_TARGET_TYPES.map((t) => ({ value: t, label: auditTargetLabel(t) }))
