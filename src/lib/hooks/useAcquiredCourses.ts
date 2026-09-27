"use client"

import { useState, useEffect, useCallback, useMemo } from "react"

const STORAGE_KEY = "typenow_acquired_courses"

/**
 * 「我的课程」的归属判断。
 *
 * ── 这里修的是一个真实 bug ────────────────────────────────────────────────────
 *
 * 原先"是否已获取"只存在 localStorage：`typenow_acquired_courses`。
 * 而「我的课程」列表是按 `已获取 ∪ 已练习过` 算出来的（已练习来自服务端 progress）。
 * 两者数据源不同，于是**清一次浏览器数据**就出现矛盾：
 *   - 课程因为"练习过"仍然留在我的课程列表里；
 *   - 点进去，详情页读到的是被清空的 localStorage → 显示「获取课程」。
 * 用户看到的就是"列表里有，点进去说我没有"。
 *
 * ── 现在的口径 ──────────────────────────────────────────────────────────────
 *
 *   isAcquired = 服务端已获取 ∪ 本地已获取 ∪ 已练习过
 *
 * 三个来源都要算，缺一个就会出现上面那种"两页说法不一致"：
 *   - 服务端：跨设备、清缓存不丢（权威）
 *   - 本地：离线/请求失败时的兜底，也负责"刚点完立刻生效"的即时反馈
 *   - 已练习过：与「我的课程」列表口径对齐 —— 练过的课当然算我的课
 *
 * 已练习那部分刻意**只信服务端**（/api/user/progress），不再另读 localStorage 的
 * study_history：那是列表页的历史包袱，两边各读一份又会分叉。
 */
export function useAcquiredCourses() {
  const [remoteIds, setRemoteIds] = useState<Set<string>>(new Set())
  const [studiedIds, setStudiedIds] = useState<Set<string>>(new Set())
  const [localIds, setLocalIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    // 本地先读：请求回来之前也不该把已经获取过的课显示成"未获取"
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setLocalIds(new Set(JSON.parse(raw) as string[]))
    } catch {
      /* 脏数据忽略 */
    }

    let cancelled = false
    fetch("/api/user/acquired-courses")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { ids?: string[] } | null) => {
        if (cancelled || !json?.ids) return
        setRemoteIds(new Set(json.ids))
        // 服务端有而本地没有的，补进本地：下次离线也能立刻判断对
        setLocalIds((prev) => {
          const next = new Set([...prev, ...json.ids!])
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
          } catch {
            /* 配额问题忽略 */
          }
          return next
        })
      })
      .catch(() => {
        /* 请求失败就用本地那份，不阻塞页面 */
      })

    /**
     * 已练习过的课程：与「我的课程」列表**完全同一份输入**。
     *
     * 服务端 progress 是权威，但列表页还额外读了一份本地 study_history
     * （用于按最近练习时间排序）。如果这里只读服务端，会出现"本地练过、
     * 服务端那次上报失败"的课在列表里有、点进去却没有 —— 又是同一类矛盾。
     * 所以两边都读。
     */
    const localStudied = new Set<string>()
    try {
      const raw = localStorage.getItem("typenow_study_history")
      if (raw) {
        for (const k of Object.keys(JSON.parse(raw) as Record<string, unknown>)) {
          localStudied.add(k)
        }
      }
    } catch {
      /* 脏数据忽略 */
    }
    if (localStudied.size > 0) setStudiedIds(new Set(localStudied))

    fetch("/api/user/progress")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { courseId: string }[] } | null) => {
        if (cancelled || !json?.data) return
        setStudiedIds((prev) => new Set([...prev, ...json.data!.map((row) => row.courseId)]))
      })
      .catch(() => {
        /* 拿不到就只按已获取 + 本地的判断 */
      })

    return () => {
      cancelled = true
    }
  }, [])

  const acquire = useCallback((courseId: string) => {
    // 先本地生效，保证点完立刻变「已获取」，不等网络往返
    setLocalIds((prev) => {
      const next = new Set(prev)
      next.add(courseId)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      } catch {
        /* 配额问题忽略 */
      }
      return next
    })
    // 再落服务端。失败不回滚本地：本地仍然记住，且下次进页面会再拉一次服务端；
    // 而"点完却显示未获取"是更糟的体验
    fetch("/api/user/acquired-courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId }),
    })
      .then((r) => {
        if (r.ok) setRemoteIds((prev) => new Set([...prev, courseId]))
      })
      .catch(() => {
        /* 网络问题：本地已记下，下次同步 */
      })
  }, [])

  /** 三个来源的并集。用 useMemo 缓存，避免每次渲染重建 Set（它是 useCallback 的依赖） */
  const acquiredIds = useMemo(
    () => new Set([...remoteIds, ...localIds, ...studiedIds]),
    [remoteIds, localIds, studiedIds],
  )

  const isAcquired = useCallback(
    (courseId: string) => acquiredIds.has(courseId),
    [acquiredIds],
  )

  return { acquiredIds, acquire, isAcquired }
}
