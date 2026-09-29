/**
 * 后台时间格式化（src/lib/admin-time.ts）。
 *
 * 这一处的错法非常隐蔽：把接口返回的 UTC ISO 串 `slice(0,19)` 当本地时间显示，
 * 结果后台"练习时间比注册时间早 8 小时"，看起来像数据错乱，实际是显示错了。
 * 而且同一批页面里另有一半用的是正确的 `toLocaleString` —— 两页对不上时
 * 从界面根本判断不出哪个是真的。
 *
 * 所以这里把两种输入形态都钉住，尤其钉住"UTC 串绝不能被当成墙上时间"。
 */
import { describe, it, expect } from "vitest"
import { formatAdminTime } from "@/lib/admin-time"

describe("formatAdminTime · 带时区的输入要折算成上海时间", () => {
  it("**关键回归**：UTC 的 ISO 串不能原样显示（那会早 8 小时）", () => {
    // 这就是当时用户看到的那条：真实 10:27:38 的练习，库里/接口是 02:27:38Z
    const out = formatAdminTime("2026-09-29T02:27:38.000Z")
    expect(out).toBe("2026-09-29 10:27:38")
    expect(out).not.toBe("2026-09-29 02:27:38")
  })

  it("带 +08:00 偏移的串按同一规则处理", () => {
    expect(formatAdminTime("2026-09-29T10:27:38+08:00")).toBe("2026-09-29 10:27:38")
    expect(formatAdminTime("2026-09-29T02:27:38+00:00")).toBe("2026-09-29 10:27:38")
  })

  it("跨日的 UTC 值会落到上海的下一天（不能只改钟点）", () => {
    expect(formatAdminTime("2026-09-28T16:30:00.000Z")).toBe("2026-09-29 00:30:00")
  })

  it("真正的 Date 对象也能直接传（接口在服务端渲染时给的是 Date）", () => {
    expect(formatAdminTime(new Date("2026-09-29T02:27:38.000Z"))).toBe("2026-09-29 10:27:38")
  })
})

describe("formatAdminTime · 不带时区的墙上时间要原样保留", () => {
  it("空格分隔的 YYYY-MM-DD HH:MM:SS 原样输出", () => {
    expect(formatAdminTime("2026-09-29 10:27:38")).toBe("2026-09-29 10:27:38")
  })

  it("T 分隔但无时区的也按墙上时间处理（不能按 UTC 再折算一次）", () => {
    expect(formatAdminTime("2026-09-29T10:27:38")).toBe("2026-09-29 10:27:38")
    // 若误当 UTC 处理会变成 18:27:38
    expect(formatAdminTime("2026-09-29T10:27:38")).not.toBe("2026-09-29 18:27:38")
  })

  it("毫秒会被截掉，只到秒", () => {
    expect(formatAdminTime("2026-09-29 10:27:38.123")).toBe("2026-09-29 10:27:38")
  })
})

describe("formatAdminTime · 边界", () => {
  it("空值统一给占位符，避免表格里出现 undefined/Invalid Date", () => {
    for (const v of [null, undefined, ""]) expect(formatAdminTime(v)).toBe("—")
  })

  it("无法解析的值做兜底，不抛错也不显示 Invalid Date", () => {
    const out = formatAdminTime("不是时间")
    expect(out).toBe("不是时间")
    expect(out).not.toContain("Invalid")
  })

  it("输出始终是 YYYY-MM-DD HH:MM:SS 形态（可字典序排序）", () => {
    for (const v of ["2026-09-29T02:27:38.000Z", "2026-09-29 10:27:38", "2026-01-02T03:04:05Z"]) {
      expect(formatAdminTime(v)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    }
  })
})

describe("源码约束：后台不该再出现把 UTC 串 slice 出来的写法", () => {
  it("admin 页面里不再有 `replace(\"T\", \" \").slice(0, 19)` 这种朴素格式化", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const dir = path.join(process.cwd(), "src/app/admin")
    const offenders: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name.endsWith(".tsx")) {
          const src = fs.readFileSync(full, "utf8")
          if (src.includes('replace("T", " ").slice(0, 19)')) {
            offenders.push(path.relative(process.cwd(), full))
          }
        }
      }
    }
    walk(dir)
    expect(offenders, "这些页面仍在把 UTC 串当本地时间显示").toEqual([])
  })
})
