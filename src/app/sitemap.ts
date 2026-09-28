import type { MetadataRoute } from "next"

/**
 * sitemap.xml（Next App Router 的约定文件，自动挂在 /sitemap.xml）。
 *
 * 此前本站**没有 sitemap**：/sitemap.xml 返回 404，robots.ts 里也刻意没写
 * Sitemap 行。后果是搜索引擎只能靠外链慢慢发现页面 —— 而本站是新站、几乎没有
 * 外链，实测百度与必应的权重、关键词数、收录量全部为 0。
 * sitemap 是最便宜的一步：它把「有哪些页面值得收录」直接告诉爬虫。
 *
 * 收录范围与 robots.ts 的 allow 列表**保持一致**，避免出现
 * 「sitemap 提交了、robots 却禁掉」这种自相矛盾：
 * 登录后才可见的 /home、/practice 等私有页，以及后台 /admin、接口 /api/*
 * 都不在这里 —— 它们未登录访问会 307 到登录页，收录进去只会得到一堆重复的登录页。
 * /ref/[code] 同样排除：那是每个用户各自的推广链接，robots.ts 已 Disallow /ref/。
 */

/**
 * 站点规范域名。这里刻意写死而不是读环境变量：
 * sitemap 必须始终输出**生产域名的绝对 URL**，否则在本地或预发环境渲染时会生成
 * 指向 localhost 的 <loc>，被爬虫取到就是无效条目。仓库里其它需要绝对地址的地方
 * （微信支付回调、测试夹具）也都是直接写 typenow.cn。
 */
const SITE_URL = "https://typenow.cn"

export default function sitemap(): MetadataRoute.Sitemap {
  /**
   * 刻意**不**给 lastModified。
   *
   * 常见写法是 `lastModified: new Date()`，但那等于每次爬虫来都声称「所有页面刚改过」。
   * Google 明确表示只在 lastmod 稳定可信时才采信它，长期不可信的 lastmod 会让这个
   * 字段被整体忽略 —— 比不写更糟。这 5 个页面是静态 TSX，运行时拿不到真实的
   * 文件修改时间（构建产物会被原子替换，见 next.config.ts 的 distDir 说明），
   * 所以宁可不写。将来若这些页改为从数据库或 CMS 取内容，再把内容自身的更新时间填进来。
   */
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/partner-agreement`, changeFrequency: "yearly", priority: 0.3 },
  ]
}
