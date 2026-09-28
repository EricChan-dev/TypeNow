/**
 * 匿名访客标识（visitor id）。
 *
 * 要解决的问题：埋点里的匿名事件此前只有 sessionId，而它存在 sessionStorage 里 ——
 * 关掉标签页就没了，多开标签页还各自一个。于是匿名的数据只能数 PV 和"会话数"，
 * 数不出人数，更没法回答"这个访客后来注册了吗"。没有稳定身份，匿名流量就只是
 * 一堆无法归人的记录，首启漏斗也就只能从「注册」那一步开始画。
 *
 * 所以这里多一个一年期的 cookie，把同一个人跨会话、跨标签页串成同一个 visitor。
 *
 * 几条刻意的取舍（与 lib/first-touch.ts 同一套路）：
 *
 * 1. **和首触 cookie 分开存**，不合并。首触是「最早从哪个渠道来」，写一次就冻住；
 *    visitor 是「这台浏览器是谁」，从头到尾不变。两者生命周期与语义都不同，
 *    合成一个 cookie 会让"清掉归因"顺带"换一个人"。
 *
 * 2. **只接受自己生成的 UUID 格式**。cookie 是可控输入，放行任意字符串等于让人
 *    随便往 visitor_id 列里灌垃圾、凭空造出无数个"访客"，报表的独立访客数随即失真。
 *    这里不是安全边界（客户端本来就能改），但至少保证格式与长度可控。
 *
 * 3. **cookie 不是 HttpOnly**：必须由 JS 写在首次浏览那一刻（同 first-touch）。
 *
 * 4. 读不到 visitor_id 时（旧数据、隐私模式、拦截器）**不报错也不丢事件**，
 *    报表侧用 COALESCE(visitor_id, session_id) 兜底降级。
 */

/** cookie 名。带 typ_ 前缀与其它 cookie 区分开 */
export const VISITOR_COOKIE = "typ_vid"

/** 一年。visitor 是"这台浏览器是谁"，比归因窗口（90 天）长是应该的 */
export const VISITOR_MAX_AGE_DAYS = 365

/** analytics_events.visitor_id 的列宽（见 lib/db/schema.ts） */
export const VISITOR_ID_MAX_LENGTH = 64

/** 只认标准 UUID（crypto.randomUUID 的输出） */
const VISITOR_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 造一个新 visitor id。crypto.randomUUID 在浏览器与 Node 18+ 都是全局可用的 */
export function newVisitorId(): string {
  return crypto.randomUUID()
}

/** 是不是一个可用的 visitor id（格式与长度都合规） */
export function isVisitorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 36 &&
    VISITOR_ID_PATTERN.test(value)
  )
}

/**
 * 解析 cookie 里的值。非法/缺失一律返回 null —— 调用方据此决定"重新生成"
 * 还是"这次不带 visitor"。
 *
 * 不接受 URL 编码：cookie 值是 UUID，没有需要转义的字符；做一次
 * decodeURIComponent 只会让 `%zz` 之类的输入抛错，反而多一条崩溃路径。
 */
export function parseVisitorId(raw: string | null | undefined): string | null {
  return isVisitorId(raw) ? raw : null
}
