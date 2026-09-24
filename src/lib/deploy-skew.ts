/**
 * 部署错位（deploy skew）识别。
 *
 * 每次部署都会生成新的 chunk 文件名与 Server Action ID。用户若在部署前打开了页面，
 * 部署后浏览器仍在用旧标识：
 *   - 按旧 URL 取 chunk → ChunkLoadError（白屏，或点导航没反应）
 *   - 点击绑定 Server Action 的按钮 → "Failed to find Server Action"（点击无反应）
 *
 * 生产日志实测：ChunkLoadError 572 次，"Failed to find Server Action" 2739 次
 * （226 个不同 action id），且最近一次 ChunkLoadError 距日志末尾仅 186 行——
 * 说明原子替换构建产物之后这类失败仍在发生，不是历史遗留。
 */

/** chunk 取不到：页面已经不可用，重载是唯一出路。 */
export function isChunkLoadFailure(text: string): boolean {
  if (!text) return false
  return (
    text.includes("ChunkLoadError") ||
    text.includes("Failed to load chunk") ||
    text.includes("Loading chunk") ||
    text.includes("Importing a module script failed")
  )
}

/**
 * Server Action 失效：页面本身还能用，只是这次交互没有到达服务端。
 * 这类字符串同时会出现在 Next.js 自己的错误文案里
 * （"... might be from an older or newer deployment"），也一并匹配。
 */
export function isStaleServerAction(text: string): boolean {
  if (!text) return false
  return (
    text.includes("Failed to find Server Action") ||
    text.includes("older or newer deployment") ||
    (text.includes("Server Action") && text.includes("not found"))
  )
}

/** 把 error / rejection 的各种形状压成一个可匹配的字符串。 */
export function describeError(reason: unknown): string {
  if (reason == null) return ""
  if (typeof reason === "string") return reason
  // 读属性可能触发 getter 抛异常（跨域脚本错误、被代理过的 Error 等）。
  // 这里在错误处理路径上，再抛一次会让事件监听器自己挂掉，所以整体兜住。
  try {
    const e = reason as { name?: unknown; message?: unknown }
    const name = typeof e.name === "string" ? e.name : ""
    const message = typeof e.message === "string" ? e.message : ""
    if (name || message) return `${name} ${message}`
    return String(reason)
  } catch {
    return ""
  }
}
