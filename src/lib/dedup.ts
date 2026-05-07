const pendingRequests = new Map<string, Promise<unknown>>()

export async function dedupRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (pendingRequests.has(key)) return pendingRequests.get(key) as Promise<T>
  const promise = fn().finally(() => pendingRequests.delete(key))
  pendingRequests.set(key, promise)
  return promise
}
