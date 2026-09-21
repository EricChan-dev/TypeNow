import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "yelvkghtsgonglegoslo.supabase.co" },
      { protocol: "https", hostname: "thirdwx.qlogo.cn" },
      { protocol: "https", hostname: "wx.qlogo.cn" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // 本站只提供 HTTPS（nginx 已把 80 端口 301 到 https）。
          // 此前没有 HSTS：用户首次以 http:// 访问时该请求不加密，可被中间人
          // 剥离后降级，登录态与验证码都会暴露在明文里。HSTS 让浏览器此后只走 HTTPS。
          // 暂不加 includeSubDomains / preload：前者会影响其它子域，后者有独立的
          // 提交审核流程，两者都应在确认全部子域已 HTTPS 后再单独评估。
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
})
