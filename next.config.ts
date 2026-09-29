import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

/**
 * 安全响应头。抽成常量是因为下面三条缓存规则都要带上它们 ——
 * 复制三份的话，将来加一个头很容易只加到其中一条路径上。
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera 与 geolocation 本站不用，一律禁用；**microphone 必须是 (self)**。
  //
  // 这里原本写的是 `microphone=()` —— 那是对**所有来源**禁用麦克风，属于文档级
  // 硬禁止：只要这个响应头在，`getUserMedia` 必然抛 NotAllowedError，
  // `navigator.permissions.query({name:'microphone'})` 也恒为 denied，
  // **无论用户在地址栏的锁图标里把麦克风设成什么都不起作用**。
  //
  // 后果是跟读评分（录音 → 有道语音评测）对任何人都不可用，而界面上给出的提示是
  // "请点锁图标允许麦克风" —— 让用户去改一个改了也没用的开关。
  // 这个头是安全头的通用模板抄来的，当时没意识到它会禁掉自家功能。
  //
  // `(self)` 表示只允许同源文档使用，第三方 iframe 仍被拒 —— 安全性没有损失。
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=()",
  },
  // 本站只提供 HTTPS（nginx 已把 80 端口 301 到 https）。
  // 此前没有 HSTS：用户首次以 http:// 访问时该请求不加密，可被中间人
  // 剥离后降级，登录态与验证码都会暴露在明文里。HSTS 让浏览器此后只走 HTTPS。
  // 暂不加 includeSubDomains / preload：前者会影响其它子域，后者有独立的
  // 提交审核流程，两者都应在确认全部子域已 HTTPS 后再单独评估。
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
]

const nextConfig: NextConfig = {
  // 构建产物目录。默认 .next；部署脚本会把它指到一个暂存目录，构建成功后再
  // 原子替换掉 .next（见 deploy.sh）。直接就地构建时，一旦构建中途失败，
  // 线上 .next 会留下残缺产物，而旧进程仍在服务，用户请求尚未加载的 chunk 即 404。
  // 运行时不设该变量，所以 `next start` 仍然读取 .next。
  distDir: process.env.TYPENOW_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "thirdwx.qlogo.cn" },
      { protocol: "https", hostname: "wx.qlogo.cn" },
    ],
  },
  async headers() {
    return [
      /**
       * ── 缓存策略（部署后必须能看到新版，否则这一整块就是错的）──────────────
       *
       * 背景：Next 给预渲染页面发的头**只有** `Cache-Control: s-maxage=31536000` ——
       * 那是给共享缓存（CDN）看的，浏览器按规范会忽略它，于是 HTML 文档没有任何
       * 面向浏览器的缓存指令。结果就是"重新部署后要手动清缓存才看得到新版"：
       * 浏览器把文档和（immutable 的）旧 chunk 一起留着，直接跑上一个版本的代码。
       *
       * 三类资源必须分开对待，混成一条规则一定会错：
       *
       *   1. `/_next/static/*` —— 文件名带内容哈希，改了就换名字，
       *      所以可以永久缓存（immutable 还能省掉重新校验的往返）。
       *   2. `/api/*` —— 带登录态的响应被任何中间层缓存都是事故，
       *      一律 no-store。
       *   3. 其余（HTML 文档、RSC 载荷）—— `max-age=0, must-revalidate`：
       *      每次导航都带 ETag 回源校验。构建真的变了，HTML 引用的 chunk 名就变了，
       *      ETag 随之改变 → 200 拿到新文档；构建没变 → 304，内容本就相同。
       *      两种情况下使用者都不需要清缓存。
       *
       * `_next/image` 刻意**不**匹配第 3 条：图片优化接口有自己的缓存头，
       * 用 must-revalidate 覆盖它会让每次看图都回源。
       */
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/api/:path*",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        // api 必须排除掉：Next 对同一个头是**后面的规则覆盖前面的**，
        // 这条通用规则会盖掉上面 /api 的 no-store（实测过）。
        // 靠"顺序"来保证正确太脆，直接在匹配上排除。
        source: "/((?!_next/static|_next/image|api/).*)",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
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
