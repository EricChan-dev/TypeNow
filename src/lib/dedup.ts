const TTL_MS = 30_000
const pendingRequests = new Map<string, Promise<unknown>>()

export async function dedupRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (pendingRequests.has(key)) return pendingRequests.get(key) as Promise<T>

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`dedup timeout: ${key}`)), TTL_MS),
  )

  const promise = Promise.race([fn(), timeout])
    .finally(() => pendingRequests.delete(key))

  pendingRequests.set(key, promise)
  return promise as Promise<T>
}
