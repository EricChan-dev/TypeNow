/**
 * Simple in-memory rate limiter — single server, no Redis needed.
 * Each window tracks up to `maxAttempts` per key.
 * Cleanup runs every 5 minutes to remove expired buckets.
 */

interface Bucket {
  timestamps: number[]
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
  for (const store of stores.values()) {
    for (const [key, bucket] of store) {
      const now = Date.now()
      bucket.timestamps = bucket.timestamps.filter((t) => now - t < 3600_000)
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
    bucket = { timestamps: [] }
    store.set(key, bucket)
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
