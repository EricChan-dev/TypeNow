/**
 * 后台展示用的脱敏工具。
 *
 * 手机号在后台列表/详情里只用于"辨认是谁"，完整号码对运营没有额外价值，
 * 但一旦出现在页面源码、截图或前端日志里就是一条泄露。所以统一脱敏，
 * 需要完整号码时走人工查库，不给界面开口子。
 */

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  // 位数不够就整体打掉：只留 "***" 而不是露出部分数字，
  // 否则 7 位以下的号码会被原样或半原地展示出来
  if (phone.length < 7) return "***"
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}
