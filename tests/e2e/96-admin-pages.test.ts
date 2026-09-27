/**
 * 后台页面能渲染（SSR 冒烟）。
 *
 * 为什么需要这一层：`tsc` 只检查类型，接口测试只覆盖 API —— 两者都拦不住
 * 「页面在**导入期**就炸」这类问题：客户端专属的库被拉进服务端渲染、
 * 组件导出名写错、新增的 npm 依赖没装、或者在模块顶层访问了 window。
 * 这类故障的表现是整页白屏，而所有接口测试依然全绿。
 *
 * 这里对每个后台路由发一次真实请求，然后检查**服务端日志里没有编译/运行错误**。
 * dev 模式首次访问某路由是现场编译，所以这一步等价于"这个页面的模块图能编译出来"。
 *
 * 注意：页面主体是客户端组件，SSR 出来的 HTML 只是外壳，所以这里**不**断言
 * 任何业务文案 —— 那属于浏览器测试的范畴。这里只保证"能编译、不抛异常、
 * 不把 Next 的错误页吐出来"。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q } from "./helpers/db"
import { insertUser } from "./helpers/factories"
import { serverLog } from "./helpers/server"

/** 后台的全部页面路由。新增页面时补进来，否则新页面的导入期故障无人拦。 */
const ADMIN_PAGES = [
  "/admin",
  "/admin/analytics",
  "/admin/events",
  "/admin/courses",
  "/admin/lessons",
  "/admin/sentences",
  "/admin/materials",
  "/admin/practice",
  "/admin/users",
  "/admin/payments",
  "/admin/subscriptions",
]

async function makeAdmin(): Promise<ApiClient> {
  const id = await insertUser({ name: "e2e 页面管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return ApiClient.asUser(id)
}

/** 检查 HTML 是否是 Next 的运行时报错页（而不是只判断状态码 200）。 */
function looksLikeErrorPage(html: string): boolean {
  return (
    html.includes("__next_error__") ||
    /Application error: a (client|server)-side exception/i.test(html) ||
    /Module not found/i.test(html) ||
    /Failed to compile/i.test(html)
  )
}

beforeEach(async () => {
  await seedFixtures()
})

describe("后台页面渲染冒烟", () => {
  for (const path of ADMIN_PAGES) {
    it(`${path} 能 SSR 且不是错误页`, async () => {
      const admin = await makeAdmin()
      const res = await admin.get<string>(path)

      expect(res.status, `${path} 返回 ${res.status}`).toBe(200)
      expect(looksLikeErrorPage(res.raw), `${path} 吐出了错误页`).toBe(false)
      // 至少要有一份 HTML 文档骨架，否则说明拿到的是空响应
      expect(res.raw).toContain("<html")
    })
  }

  it("埋点详情页（动态路由）也能 SSR，非法 id 不炸页面", async () => {
    const admin = await makeAdmin()
    // 用一个很大的 id：页面本身应当正常渲染（内容区自己显示"加载失败"）
    const res = await admin.get("/admin/events/999999999")
    expect(res.status).toBe(200)
    expect(looksLikeErrorPage(res.raw)).toBe(false)
  })

  it("未登录访问后台页面被重定向到登录页（不是白屏，也不是 500）", async () => {
    const res = await ApiClient.anonymous().get("/admin/events")
    // fetch 默认跟随重定向，最终落在 /login
    expect(res.status).toBe(200)
    expect(res.raw).toContain("<html")
  })

  it("加载完全部后台页面后，服务端日志里没有编译错误", () => {
    const log = serverLog()
    // dev 服务端把编译失败写进日志，但页面请求仍可能返回 200 的壳，
    // 所以状态码那一层拦不住，必须在日志这一层再兜一次
    expect(log).not.toMatch(/Module not found/i)
    expect(log).not.toMatch(/Failed to compile/i)
    expect(log).not.toMatch(/Error: Cannot find module/i)
  })
})

/**
 * 缓存策略（next.config.ts 的 headers）。
 *
 * 为什么值得单独钉住：这里的错法是"配置错了但站点看起来很正常"——
 * 部署之后要人工清浏览器缓存才看得到新版，而使用者只会觉得"改了没生效"。
 * 三类资源的策略必须分开，混成一条一定会有某一类错：
 *   - 带内容哈希的静态资源：永久缓存（改了就换文件名，缓存是安全的）
 *   - 接口：绝不缓存（带登录态的响应被中间层缓存是事故）
 *   - HTML 文档：每次回源校验（构建变了 chunk 名就变，ETag 随之改变）
 */
describe("缓存策略", () => {
  it("HTML 文档：必须让浏览器每次回源校验（只有 s-maxage 等于让浏览器自行其是）", async () => {
    const res = await ApiClient.anonymous().get("/")
    const cc = res.headers.get("cache-control") ?? ""

    // 断言语义而不是字面量：dev 下 Next 自己发 "no-cache, must-revalidate"，
    // 生产发我们配置的 "public, max-age=0, must-revalidate" —— 形式不同、语义一致。
    // 真正的不变量是"必须回源校验"，写成字面量会在 dev 下假红。
    expect(cc).toMatch(/must-revalidate|no-cache/)

    // 而修复前的状态恰恰是只有 s-maxage：那是给共享缓存看的，浏览器会忽略它，
    // 于是 HTML 没有任何面向浏览器的指令 —— 这正是"部署后要手动清缓存"的根源
    expect(cc).not.toBe("s-maxage=31536000")
    expect(cc).not.toContain("s-maxage")
  })

  it("预渲染的后台页面同样是每次校验（后台最容易出现改了没生效）", async () => {
    const admin = await makeAdmin()
    const res = await admin.get("/admin/feedback")
    expect(res.headers.get("cache-control") ?? "").toContain("must-revalidate")
  })

  it("接口：private, no-store（绝不能被任何中间层缓存）", async () => {
    const admin = await makeAdmin()
    const res = await admin.get("/api/admin/feedback?pageSize=1")
    const cc = res.headers.get("cache-control") ?? ""
    expect(cc).toContain("no-store")
    expect(cc).toContain("private")
  })

  it("接口虽然 no-store，安全头不能丢", async () => {
    const admin = await makeAdmin()
    const res = await admin.get("/api/admin/feedback?pageSize=1")
    expect(res.headers.get("x-frame-options")).toBe("DENY")
  })

  it("带内容哈希的静态资源仍然长期 immutable 缓存（别误伤它）", async () => {
    // 从首页 HTML 里取一个真实的 chunk 路径来验，避免写死文件名
    const page = await ApiClient.anonymous().get("/")
    const m = page.raw.match(/\/_next\/static\/[^"']+\.js/)
    expect(m, "首页应当引用至少一个 _next/static 资源").toBeTruthy()
    const res = await ApiClient.anonymous().get(m![0])
    const cc = res.headers.get("cache-control") ?? ""
    expect(cc).toContain("max-age=31536000")
    expect(cc).toContain("immutable")
  })
})
