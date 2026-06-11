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
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp
  return "127.0.0.1"
}
