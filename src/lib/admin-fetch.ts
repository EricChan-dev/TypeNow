"use client"

/**
 * 后台页面的取数 hook。
 *
 * 存在的理由不只是省几行：它把 loading 变成**派生值**而不是 state。
 *
 * 常见写法是在 effect 里先 `setLoading(true)` 再发请求，但那样每次 url 变化
 * 都会触发一次额外的同步 setState → 额外一轮渲染，React 的
 * `set-state-in-effect` 规则会直接报错。这里改为记住"已经拿到的是哪个 url 的结果"，
 * `loading` 由 `已加载的 key !== 当前 key` 推出来 —— 一次渲染就到位，
 * 也天然避免了"筛选变了但还在显示上一批数据"的中间态（旧数据 key 不匹配，
 * 立即判定为加载中，而不是先把旧数据画出来再闪一下）。
 */

import { useEffect, useState } from "react"

interface FetchState<T> {
  key: string
  data?: T
  error?: string
}

export interface AdminFetchResult<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  /** 手动重取（"刷新"按钮）。 */
  refetch: () => void
}

/**
 * @param url 传 null 表示"暂不请求"（例如依赖的参数还没拿到）
 */
export function useAdminFetch<T>(url: string | null): AdminFetchResult<T> {
  const [state, setState] = useState<FetchState<T> | null>(null)
  // 手动刷新靠递增这个数：URL 没变但需要重新请求。
  // 把它拼进 key 里，这样"已加载的 key !== 当前 key"依然能正确推出 loading
  const [nonce, setNonce] = useState(0)

  const key = url === null ? null : `${nonce}:${url}`

  useEffect(() => {
    if (!url) return
    // 组件卸载 / url 变化后丢弃过期响应：筛选切得快时，先发的慢请求
    // 可能后到，不丢弃的话图表会显示上一次筛选的数据
    let cancelled = false
    const k = `${nonce}:${url}`

    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          // 接口的失败信息（比如 Events 接口的 400 Invalid id）比 HTTP 状态码有用
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((data: T) => {
        if (!cancelled) setState({ key: k, data })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ key: k, error: String((e as Error)?.message ?? e) })
      })

    return () => {
      cancelled = true
    }
  }, [url, nonce])

  const current = key !== null && state?.key === key ? state : null

  return {
    data: current?.data,
    error: current?.error ?? null,
    loading: current === null && key !== null,
    refetch: () => setNonce((n) => n + 1),
  }
}
