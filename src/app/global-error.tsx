"use client"

import { isChunkLoadFailure, isStaleServerAction } from "@/lib/deploy-skew"

/**
 * 根级错误边界。Next.js 只会在「根布局本身出错」时渲染它，因此它必须自带
 * <html>/<body>，也不能依赖 globals.css 已加载——所以这里全部用内联样式。
 *
 * 主要目的是接住部署错位导致的 chunk 加载失败：以前这种情况下页面直接白屏，
 * 用户除了手动刷新没有别的线索。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const text = `${error?.name || ""} ${error?.message || ""}`
  const skew = isChunkLoadFailure(text) || isStaleServerAction(text)

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "0 20px",
          background: "#ffffff",
          color: "#111827",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: 18, fontWeight: 700 }}>
          {skew ? "网站已更新" : "页面加载出错"}
        </p>
        <p style={{ fontSize: 14, color: "#6b7280", maxWidth: 420, lineHeight: 1.6 }}>
          {skew
            ? "本站刚发布了新版本，当前页面用的是旧版本文件，需要重新加载才能继续。"
            : "抱歉，页面加载过程中出现了问题，请稍后重试。"}
        </p>
        <button
          type="button"
          onClick={() => {
            if (skew) window.location.reload()
            else reset()
          }}
          style={{
            marginTop: 8,
            border: "none",
            borderRadius: 12,
            padding: "10px 24px",
            fontSize: 14,
            fontWeight: 600,
            color: "#ffffff",
            background: "#111827",
            cursor: "pointer",
          }}
        >
          重新加载
        </button>
      </body>
    </html>
  )
}
