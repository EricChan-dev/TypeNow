/**
 * 审计日志**纯逻辑**单测。
 *
 * 这里刻意不碰数据库：写入路径（logAdminAction）的失败语义由 e2e 覆盖，
 * 而"脱敏、截断、差异计算"这些决定日志**能不能读、会不会泄密**的规则
 * 是纯函数，用单测把每条边界钉住更快也更可靠。
 */
import { describe, it, expect } from "vitest"
import {
  truncateAuditText,
  sanitizeAuditDetail,
  diffAuditFields,
  describeAuditActor,
} from "@/lib/admin-audit"
// clientIpOf 已收敛到 lib/request-meta（注册归因也要用同一份实现）
import { clientIpOf } from "@/lib/request-meta"

describe("truncateAuditText", () => {
  it("null / undefined 保持为 null（而不是空串）", () => {
    expect(truncateAuditText(null, 10)).toBeNull()
    expect(truncateAuditText(undefined, 10)).toBeNull()
  })

  it("不超长时原样返回", () => {
    expect(truncateAuditText("abc", 10)).toBe("abc")
    expect(truncateAuditText("0123456789", 10)).toBe("0123456789")
  })

  it("超长时截到列宽以内并带省略号 —— 不能超，否则 INSERT 报 Data too long 后整条日志丢失", () => {
    const out = truncateAuditText("x".repeat(50), 10)
    expect(out!.length).toBe(10)
    expect(out!.endsWith("…")).toBe(true)
  })

  it("非字符串也能处理（数字、布尔）", () => {
    expect(truncateAuditText(123, 10)).toBe("123")
    expect(truncateAuditText(true, 10)).toBe("true")
  })
})

describe("sanitizeAuditDetail", () => {
  it("丢弃疑似凭据的键（大小写与下划线/连字符变体都算）", () => {
    const out = sanitizeAuditDetail({
      level: 5,
      accessToken: "abc",
      refresh_token: "abc",
      password: "abc",
      PASSWORD: "abc",
      wechatOpenid: "oX",
      unionid: "u",
      apiKey: "k",
      "api-key": "k",
      app_SECRET: "s",
      authorization: "Bearer x",
    }) as Record<string, unknown>

    expect(out.level).toBe(5)
    for (const k of [
      "accessToken", "refresh_token", "password", "PASSWORD",
      "wechatOpenid", "unionid", "apiKey", "api-key", "app_SECRET", "authorization",
    ]) {
      expect(out[k], `${k} 必须被丢弃`).toBeUndefined()
    }
  })

  it("嵌套对象与数组同样逐层脱敏", () => {
    const out = sanitizeAuditDetail({
      before: { name: "旧名", token: "t" },
      after: { name: "新名", token: "t" },
      items: [{ id: 1, secret: "s" }, { id: 2 }],
    }) as Record<string, unknown>

    expect(out.before).toEqual({ name: "旧名" })
    expect(out.after).toEqual({ name: "新名" })
    expect(out.items).toEqual([{ id: 1 }, { id: 2 }])
  })

  it("层级过深时截断，不会跟着对象无限递归", () => {
    let deep: Record<string, unknown> = { value: "底" }
    for (let i = 0; i < 10; i++) deep = { nested: deep }
    const out = sanitizeAuditDetail(deep) as Record<string, unknown>
    // 只需要"没有炸"且深处被标记省略；具体层级由 MAX_DEPTH 决定
    expect(JSON.stringify(out)).toContain("层级过深")
  })

  it("Date 转 ISO 字符串（json 列里 Date 会变成难看的东西）", () => {
    const d = new Date("2030-01-01T00:00:00.000Z")
    expect(sanitizeAuditDetail({ at: d })).toEqual({ at: "2030-01-01T00:00:00.000Z" })
  })

  it("过长的字符串值被截断", () => {
    const out = sanitizeAuditDetail({ text: "长".repeat(1000) }) as Record<string, string>
    expect(out.text.length).toBe(500)
    expect(out.text.endsWith("…")).toBe(true)
  })

  it("数组元素数量有上限（批量导入不能把一行日志撑爆）", () => {
    const out = sanitizeAuditDetail({ ids: Array.from({ length: 200 }, (_, i) => i) }) as {
      ids: number[]
    }
    expect(out.ids.length).toBe(50)
  })

  it("null / undefined / 函数 / symbol 归一为 null", () => {
    expect(sanitizeAuditDetail(null)).toBeNull()
    expect(sanitizeAuditDetail(undefined)).toBeNull()
    expect(sanitizeAuditDetail(() => 1)).toBeNull()
    expect(sanitizeAuditDetail(Symbol("s"))).toBeNull()
  })

  it("bigint 转字符串（JSON 不支持 bigint，直接写会抛）", () => {
    expect(sanitizeAuditDetail({ n: BigInt(7) })).toEqual({ n: "7" })
  })
})

describe("diffAuditFields", () => {
  it("只记真的变了的字段，并带上前后值", () => {
    const before = { level: 1, role: "user", name: "张三" }
    const after = { level: 5, role: "user", name: "张三" }
    expect(diffAuditFields(before, after, ["level", "role", "name"])).toEqual({
      level: { from: 1, to: 5 },
    })
  })

  it("字段白名单之外的列不会被记进来", () => {
    const before = { level: 1, phone: "13900000000" }
    const after = { level: 1, phone: "13911111111" }
    expect(diffAuditFields(before, after, ["level"])).toEqual({})
  })

  it("null 与 undefined 视为同一个值（「没设置」不构成一次变更）", () => {
    expect(diffAuditFields({ x: null }, { x: undefined }, ["x"])).toEqual({})
    expect(diffAuditFields({ x: undefined }, { x: null }, ["x"])).toEqual({})
  })

  it("null → 有值 会被记录（例如清空会员到期时间）", () => {
    expect(diffAuditFields({ proExpires: null }, { proExpires: new Date("2030-01-01T00:00:00Z") }, ["proExpires"]))
      .toEqual({ proExpires: { from: null, to: "2030-01-01T00:00:00.000Z" } })
  })

  it("Date 按时间比较 —— 同一个时刻的不同 Date 对象不算变更", () => {
    const a = new Date("2030-01-01T00:00:00.000Z")
    const b = new Date("2030-01-01T00:00:00.000Z")
    expect(diffAuditFields({ at: a }, { at: b }, ["at"])).toEqual({})
  })

  it("任一侧为 null/undefined 时返回空（没有可比较的前后状态）", () => {
    expect(diffAuditFields(null, { x: 1 }, ["x"])).toEqual({})
    expect(diffAuditFields({ x: 1 }, null, ["x"])).toEqual({})
  })
})

describe("describeAuditActor", () => {
  it("姓名 + 脱敏手机号", () => {
    expect(describeAuditActor({ name: "张三", phone: "16634482010" }, "uid-1")).toBe("张三(166****2010)")
  })

  it("只有姓名 / 只有手机号都能降级", () => {
    expect(describeAuditActor({ name: "张三", phone: null }, "uid-1")).toBe("张三")
    expect(describeAuditActor({ name: null, phone: "16634482010" }, "uid-1")).toBe("166****2010")
  })

  it("查不到用户时用 id 兜底；dev 旁路单独标注", () => {
    expect(describeAuditActor(null, "uid-1")).toBe("uid-1")
    expect(describeAuditActor(null, "dev-admin")).toBe("dev-admin(开发旁路)")
  })

  it("空白姓名不算姓名", () => {
    expect(describeAuditActor({ name: "   ", phone: "16634482010" }, "uid-1")).toBe("166****2010")
  })
})

describe("clientIpOf", () => {
  const mk = (h: Record<string, string>) => new Request("http://x/", { headers: h })

  it("取 x-forwarded-for 的第一段（经 nginx 后最后一段是代理自己）", () => {
    expect(clientIpOf(mk({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4")
  })

  it("没有 xff 时回落到 x-real-ip；都没有则 null", () => {
    expect(clientIpOf(mk({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8")
    expect(clientIpOf(mk({}))).toBeNull()
    expect(clientIpOf(null)).toBeNull()
  })
})
