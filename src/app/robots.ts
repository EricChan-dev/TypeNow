import type { MetadataRoute } from "next"

/**
 * robots.txt（Next App Router 的约定文件，自动挂在 /robots.txt）。
 *
 * 这个站此前**没有 robots.txt**（线上 404），也没有任何 noindex：
 * 爬虫会去抓 /admin 与 /api/*。虽然 proxy.ts 会把未登录的后台请求 307 到登录页、
 * 接口返回 401 而不是内容，但让爬虫反复请求这些路径纯属浪费（而且会把
 * 登录页收进索引）。这里明确 Disallow。
 *
 * 只放行真正想被收录的公开页：落地页、定价、条款、隐私。
 * 用户私有区域（/home、/practice、/profile 等）与后台、接口一律禁掉。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/terms", "/privacy", "/partner-agreement"],
        disallow: [
          // 后台与接口：没有任何理由被索引
          "/admin",
          "/api/",
          // 需要登录的用户私有区域（未登录访问会 307 到 /login，
          // 收录进去只会得到一堆重复的登录页）
          "/home",
          "/practice",
          "/profile",
          "/strengthen",
          "/share",
          "/ref/",
          // 已废弃的内部面板
          "/admin-app",
        ],
      },
    ],
    // 刻意**不**写 sitemap：仓库里还没有 sitemap.xml，引用一个 404 的地址
    // 指给爬虫还不如不指。（要做的话是另加 src/app/sitemap.ts，届时再补这一行。）
  }
}
