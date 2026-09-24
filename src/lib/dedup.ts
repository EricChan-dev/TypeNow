/**
 * 同一 key 的并发请求去重。
 *
 * ⚠️ 不要把调用者自己的 AbortSignal 传进 `fn`。
 *   本模块共享的是**同一个 Promise**，而 AbortSignal 属于**单个调用者**。
 *   两者天生冲突：任何一个调用者 abort，都会把这唯一的在途请求打掉，但
 *   dedup 表里仍留着那个注定失败的 Promise，于是后续调用者会立刻收到同一个
 *   失败——表现为"无故网络错误"。
 *
 *   这不是理论风险，是实测踩过的坑：`SentenceKnowledge` 曾在 effect 里
 *   一边 dedup 一边 abort，在 React StrictMode 的
 *   挂载→卸载→重挂载序列下**必然**把「AI 讲解」渲染成「网络连接失败」。
 *   需要取消语义时，应该改用本地 cancelled 标记忽略结果，让请求自己跑完。
 */
const TTL_MS = 30_000
const pendingRequests = new Map<string, Promise<unknown>>()

/**
 * 等待超时的专用错误类型。
 *
 * 为什么不能只抛普通 Error：
 *   超时时底层 fetch 并没有失败，只是我们不愿再等。若上层拿不到区分信号，
 *   就只会看到「错误里没有 HTTP 状态码」，进而把超时误报成网络故障，
 *   让用户去排查一个其实正常的网络。
 */
export class DedupTimeoutError extends Error {
  constructor(key: string) {
    super(`dedup timeout: ${key}`)
    this.name = "DedupTimeoutError"
  }
}

export async function dedupRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (pendingRequests.has(key)) return pendingRequests.get(key) as Promise<T>

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new DedupTimeoutError(key)), TTL_MS),
  )

  const promise = Promise.race([fn(), timeout])
    .finally(() => pendingRequests.delete(key))

  pendingRequests.set(key, promise)
  return promise as Promise<T>
}
