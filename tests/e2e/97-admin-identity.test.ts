/**
 * 链路：管理员判定的一致性 + 上传前置闸门 + robots
 *
 * 三件事的共同点是"看不见的接线"：
 *   1. 管理员判定曾在四处各写一遍，其中 me 接口的 dev 兜底与 proxy/
 *      requireAdmin 不一致 —— 于是开发态"前端说你是管理员、接口全 401"。
 *      这里钉住的核心不变量是：me 接口与 whoami 接口必须给出一致的判定。
 *   2. 上传接口原先在 `await request.formData()`（整段进内存）之后才检查大小，
 *      1MB/10MB 的上限形同虚设。这里断言"超限的请求体在解析之前就被 413 拒掉"。
 *   3. robots.txt 此前不存在（线上 404），爬虫会白跑 /admin 与 /api/*。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q } from "./helpers/db"
import { insertUser } from "./helpers/factories"

async function makeAdminByRole(): Promise<string> {
  const id = await insertUser({ name: "e2e 角色管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

interface WhoAmI {
  isAdmin: boolean
  userId: string | null
  via: string | null
}
interface MeBody {
  user: { role?: string } | null
}

beforeEach(async () => {
  await seedFixtures()
})

describe("管理员判定：前端问服务端，服务端只有一份规则", () => {
  it("role=admin 的用户：whoami 与 me 都说是", async () => {
    const api = ApiClient.asUser(await makeAdminByRole())

    const who = await api.get<WhoAmI>("/api/admin/whoami")
    expect(who.status).toBe(200)
    expect(who.body.isAdmin).toBe(true)
    expect(who.body.via).toBe("role")

    const me = await api.get<MeBody>("/api/auth/me")
    expect(me.body.user?.role).toBe("admin")
  })

  it("普通用户：whoami 说否，me 也不把他标成 admin", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)

    const who = await api.get<WhoAmI>("/api/admin/whoami")
    // 这里刻意返回 200 + isAdmin:false，而不是 401：
    // 这是状态查询，前端要能拿到"否"这个答案来做跳转
    expect(who.status).toBe(200)
    expect(who.body.isAdmin).toBe(false)
    expect(who.body.via).toBeNull()

    const me = await api.get<MeBody>("/api/auth/me")
    expect(me.body.user?.role).not.toBe("admin")
  })

  it("未登录：whoami 返回 200 + isAdmin:false（不是 401）", async () => {
    const res = await ApiClient.anonymous().get<WhoAmI>("/api/admin/whoami")
    expect(res.status).toBe(200)
    expect(res.body.isAdmin).toBe(false)
  })

  it("**核心不变量**：me 说是 admin 的人，whoami 也必须说是（两侧判定不能分叉）", async () => {
    // 这条以前会失败：me 用自己那份带 dev 兜底的规则，whoami/requireAdmin 用另一份。
    // 谁改动判定规则却漏改一处，这条就会红。
    for (const userId of [await makeAdminByRole(), FIXTURE.userFree, FIXTURE.userPartner]) {
      const api = ApiClient.asUser(userId)
      const meAdmin = (await api.get<MeBody>("/api/auth/me")).body.user?.role === "admin"
      const whoAdmin = (await api.get<WhoAmI>("/api/admin/whoami")).body.isAdmin
      expect(whoAdmin, `me 与 whoami 对 ${userId} 的判定分叉了`).toBe(meAdmin)
    }
  })

  it("非管理员访问后台接口仍然是 401（whoami 的 200 不代表放开了别的接口）", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    expect((await api.get("/api/admin/users")).status).toBe(401)
    expect((await api.get("/api/admin/whoami")).status).toBe(200)
  })

  it("已删除的邮箱登录接口不再存在（死路径已清理）", async () => {
    const res = await ApiClient.anonymous().request("POST", "/api/admin/auth/login", {
      json: { email: "a@b.c", password: "x" },
    })
    // 路由已删：404（而不是 401/400，那说明接口还在）
    expect(res.status).toBe(404)
  })

  it("登出接口仍然可用", async () => {
    const api = ApiClient.asUser(await makeAdminByRole())
    const res = await api.request("POST", "/api/admin/auth/logout", { json: {} })
    expect(res.status).toBe(200)
  })
})

describe("上传：超限请求体在解析之前就被拒（413）", () => {
  const BOUNDARY = "----typenow-e2e-boundary"

  /** 构造一个合法的 multipart 请求体，可按需把文件内容撑到指定大小。 */
  function multipartBody(fileBytes: number, filename = "a.txt"): string {
    const head =
      `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    const tail = `\r\n--${BOUNDARY}--\r\n`
    return head + "x".repeat(fileBytes) + tail
  }

  const multipartHeaders = { "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` }

  it("upload/image：真实超限请求体 → 413，且是**前置**拒绝（不是解析后才报）", async () => {
    const admin = ApiClient.asUser(await makeAdminByRole())
    // 真的发 2MB（上限 1MB）。不能用"伪造 content-length + 空 body"——
    // 那种请求在 HTTP 层就坏了（实测 500），验不到前置闸门
    const res = await admin.request("POST", "/api/admin/upload/image", {
      headers: multipartHeaders,
      rawBody: multipartBody(2 * 1024 * 1024, "big.png"),
    })
    expect(res.status).toBe(413)
    // 文案要能区分是前置闸门拦的，还是解析后按 file.size 拦的
    expect(String((res.body as { error?: string }).error)).toContain("已提前拒绝")
  })

  it("materials/upload：真实超限请求体 → 413", async () => {
    const admin = ApiClient.asUser(await makeAdminByRole())
    // 上限 10MB，发 11MB
    const res = await admin.request("POST", "/api/admin/materials/upload", {
      headers: multipartHeaders,
      rawBody: multipartBody(11 * 1024 * 1024, "big.txt"),
    })
    expect(res.status).toBe(413)
    expect(String((res.body as { error?: string }).error)).toContain("已提前拒绝")
  })

  it("未登录仍然是 401（鉴权先于体积判定，不能先回 413 泄露接口存在）", async () => {
    const res = await ApiClient.anonymous().request("POST", "/api/admin/upload/image", {
      headers: multipartHeaders,
      rawBody: multipartBody(2 * 1024 * 1024),
    })
    expect(res.status).toBe(401)
  })

  it("正常体积的请求不被前置闸门误伤（能走到真实的内容校验）", async () => {
    const admin = ApiClient.asUser(await makeAdminByRole())
    // 小体积：闸门不该拦它，请求应当进到真正的解析与内容校验里。
    // 这里用一个 text/plain 的假图片，所以最终是**内容**报错
    // （"仅支持 JPEG/PNG/WebP/GIF"）—— 关键是它不是体积错误、也不是 413
    const res = await admin.request("POST", "/api/admin/upload/image", {
      headers: multipartHeaders,
      rawBody: multipartBody(8),
    })
    expect(res.status).toBe(400)
    const msg = String((res.body as { error?: string }).error)
    expect(msg).toContain("仅支持")
    expect(msg).not.toContain("过大")
  })

  it("体积刚好在上限内的图片能通过（不能把正常文件挡掉）", async () => {
    const admin = ApiClient.asUser(await makeAdminByRole())
    // 0.5MB < 1MB 上限：应当进入真实解析（这个 multipart 里没有 file 字段，
    // 所以最终仍是 400，但**不能**是 413）
    const res = await admin.request("POST", "/api/admin/upload/image", {
      headers: multipartHeaders,
      rawBody: multipartBody(512 * 1024),
    })
    expect(res.status).not.toBe(413)
  })
})

describe("robots.txt", () => {
  it("有 robots.txt，禁掉后台与接口，放行公开页", async () => {
    const res = await ApiClient.anonymous().get("/robots.txt")
    expect(res.status).toBe(200)
    const text = res.raw
    expect(text).toContain("Disallow: /admin")
    expect(text).toContain("Disallow: /api/")
    expect(text).toContain("Disallow: /home")
    // 公开页要放行，否则落地页也进不了索引
    expect(text).toContain("Allow: /")
  })
})
