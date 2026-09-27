/**
 * 后台列表的回收站视图（src/lib/soft-delete-view.ts）。
 *
 * 这个模块看着只有三行 switch，但它决定了"删掉的东西还能不能找回来"。
 * 一旦 `?deleted=` 的解析或映射写歪，后果是**内容在回收站里也看不到** ——
 * 在使用者眼里就是永久丢了，而软删除的全部意义就是避免这件事。
 * 所以三个档位各断言一遍，并钉住"非法值回落正常视图"（不能回落成 all，
 * 那会让日常列表突然混进已删除内容）。
 */
import { describe, it, expect } from "vitest"
import { isNull, sql } from "drizzle-orm"
import {
  DEFAULT_DELETED_SCOPE,
  DELETED_SCOPES,
  deletedCondition,
  deletedScope,
} from "@/lib/soft-delete-view"

const alive = isNull(sql`deleted_at`)
const deleted = sql`deleted_at IS NOT NULL`

/** 用 MySQL dialect 渲染成可比较的 SQL 文本。 */
import { MySqlDialect } from "drizzle-orm/mysql-core"
const dialect = new MySqlDialect()
const render = (c: ReturnType<typeof deletedCondition>) => dialect.sqlToQuery(c).sql

describe("deletedScope", () => {
  it("三个合法值原样返回", () => {
    for (const s of DELETED_SCOPES) {
      expect(deletedScope(s)).toBe(s)
    }
  })

  it("缺省与空串回落正常视图（不是 all）", () => {
    expect(deletedScope(null)).toBe(DEFAULT_DELETED_SCOPE)
    expect(deletedScope(undefined)).toBe("normal")
    expect(deletedScope("")).toBe("normal")
  })

  it("非法值回落正常视图，且不会漏出已删除内容", () => {
    // 回落成 all 会让日常列表突然混进已删除内容，是比报错更糟的失败方式
    for (const bad of ["true", "1", "ONLY", "deleted", "only ", "drop"]) {
      expect(deletedScope(bad), `${bad} 应回落 normal`).toBe("normal")
    }
  })
})

describe("deletedCondition", () => {
  it("normal → 未删除谓词", () => {
    expect(render(deletedCondition("normal", alive, deleted))).toBe(render(alive))
  })

  it("only → 已删除谓词（回收站靠它才找得到东西）", () => {
    expect(render(deletedCondition("only", alive, deleted))).toBe(render(deleted))
  })

  it("all → 恒真（排查时要能同时看到两边的行）", () => {
    const text = render(deletedCondition("all", alive, deleted))
    expect(text.toUpperCase()).toContain("TRUE")
  })

  it("三个档位互不相同（否则某个视图就是假的）", () => {
    const set = new Set(
      DELETED_SCOPES.map((s) => render(deletedCondition(s, alive, deleted))),
    )
    expect(set.size).toBe(DELETED_SCOPES.length)
  })
})
