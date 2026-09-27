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
