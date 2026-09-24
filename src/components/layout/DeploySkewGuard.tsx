"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import {
  describeError,
  isChunkLoadFailure,
  isStaleServerAction,
} from "@/lib/deploy-skew"

/**
 * 部署错位兜底（见 src/lib/deploy-skew.ts 的说明）。
 *
 * 两种失败的自救策略不同：
 *   - chunk 取不到：整个页面已不可用，自动重载一次（带冷却，避免刷新循环）。
 *   - Server Action 失效：页面还在，自动刷新会丢掉用户正在输入的内容
 *     （练习页尤其可惜），所以只提示 + 给一个手动刷新入口。
 */

const RELOAD_KEY = "typenow_skew_reloaded_at"
const RELOAD_COOLDOWN_MS = 60_000

/** 只有能写下冷却标记时才自动重载，避免拿不到标记导致无限刷新。 */
function tryAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function DeploySkewGuard() {
  useEffect(() => {
    let actionToastShown = false

    const handle = (text: string) => {
      if (isChunkLoadFailure(text)) {
        if (tryAutoReload()) {
          toast.loading("网站已更新，正在重新加载…", { id: "deploy-skew" })
        } else {
          toast("网站已更新，请刷新页面", {
            id: "deploy-skew-manual",
            duration: 10_000,
            action: { label: "刷新", onClick: () => window.location.reload() },
          })
        }
        return
      }
      if (isStaleServerAction(text)) {
        if (actionToastShown) return
        actionToastShown = true
        toast("网站已更新，本次操作未生效，请刷新后重试", {
          id: "deploy-skew-action",
          duration: 10_000,
          action: { label: "刷新", onClick: () => window.location.reload() },
        })
      }
    }

    // 捕获阶段监听：chunk / script 加载失败是资源错误，不冒泡。
    const onError = (event: ErrorEvent) => {
      handle(`${event.message || ""} ${describeError(event.error)}`)
    }
    // 动态 import 失败、Server Action 调用失败都以 rejection 形式出现。
    const onRejection = (event: PromiseRejectionEvent) => {
      handle(describeError(event.reason))
    }

    window.addEventListener("error", onError, true)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error", onError, true)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])

  return null
}
