/**
 * Simple in-memory rate limiter — single server, no Redis needed.
 * Each window tracks up to `maxAttempts` per key.
 * Cleanup runs every 5 minutes to remove expired buckets.
 */

interface Bucket {
  timestamps: number[]
  /**
   * 这个桶的窗口长度。**必须随桶存，不能用固定值清理**。
   *
   * 清理函数此前硬编码 `3600_000`，于是任何超过 1 小时的窗口都会被悄悄截短成
   * 1 小时：`checkRateLimit` 自己按传入的 windowMs 判断是对的，但每 5 分钟一次的
   * 清理会把更早的时间戳直接删掉 —— 结果「每天 30 次」的每日额度在第一个小时后
   * 就被清空，等于没有额度。现有调用点窗口都 ≤ 1 小时，所以这个 bug 一直没暴露，
   * 但它会静默改变语义，而不是报错。
   */
  windowMs: number
}

const stores = new Map<string, Map<string, Bucket>>()

function getStore(name: string): Map<string, Bucket> {
  if (!stores.has(name)) {
    stores.set(name, new Map())
  }
  return stores.get(name)!
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now()
  for (const store of stores.values()) {
    for (const [key, bucket] of store) {
      // 用桶自己的窗口，而不是固定的 1 小时（见 Bucket.windowMs 的说明）。
      bucket.timestamps = bucket.timestamps.filter((t) => now - t < bucket.windowMs)
      if (bucket.timestamps.length === 0) store.delete(key)
    }
  }
}, 300_000)

/**
 * Check if a key has exceeded the rate limit.
 * Returns `{ allowed: true }` or `{ allowed: false, retryAfter: seconds }`.
 */
export function checkRateLimit(
  storeName: string,
  key: string,
  maxAttempts: number,
  windowMs: number,
): { allowed: boolean; retryAfter?: number } {
  const store = getStore(storeName)
  const now = Date.now()

  let bucket = store.get(key)
  if (!bucket) {
    bucket = { timestamps: [], windowMs }
    store.set(key, bucket)
  } else {
    // 同一 key 被不同 windowMs 调用时以最后一次为准（现有调用点每个 store 只用一个窗口）
    bucket.windowMs = windowMs
  }

  // Clean expired timestamps from this bucket
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs)

  if (bucket.timestamps.length >= maxAttempts) {
    const oldest = bucket.timestamps[0]
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000)
    return { allowed: false, retryAfter }
  }

  bucket.timestamps.push(now)
  return { allowed: true }
}

/**
 * Get the client IP from a Next.js request.
 */
export function getClientIP(request: Request): string {
  // 绝不取 X-Forwarded-For 的最左值：nginx 以
  //   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  // 填充该头部，其语义是「客户端自带的取值 + ", " + 真实对端地址」，
  // 因此最左段完全由请求方控制。取最左等于信任攻击者输入，
  // 使所有基于 IP 的限流可被一个随机头部逐请求绕过。
  //
  // X-Real-IP 由 nginx 以 proxy_set_header X-Real-IP $remote_addr 覆盖写入，
  // 请求方无法伪造，故优先采用；XFF 仅作兜底且取最右（可信）段。
  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp.trim()

  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }

  return "127.0.0.1"
}
