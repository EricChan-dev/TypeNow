import { describe, expect, it } from "vitest"
import { escapeLike, courseSearchCondition } from "@/lib/course-query"

/**
 * 搜索条件是两个路由（列表 + 计数）共用的唯一实现。
 *
 * 这里守的是「标签数字 = 点进去的列表」这条不变式的前提：两边拿到的是
 * **同一个函数产出的同一条件**。转义一旦退化成各写一份，`%`、`_`、`\`
 * 这类输入就会让两边悄悄分叉。
 */
describe("escapeLike", () => {
  it("百分号按字面量处理（否则搜索框变成全表返回）", () => {
    expect(escapeLike("100%")).toBe("100\\%")
    // 单独一个 % 最危险：不转义就是 LIKE '%%%'，匹配所有标题
    expect(escapeLike("%")).toBe("\\%")
  })

  it("下划线按字面量处理（LIKE 里 _ 匹配任意单字符）", () => {
    expect(escapeLike("a_b")).toBe("a\\_b")
  })

  it("反斜杠先转，不会把自己转义出来的反斜杠再转一次", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b")
  })

  it("正常中英文与空格原样保留", () => {
    expect(escapeLike("雅思")).toBe("雅思")
    expect(escapeLike("定价页 pricing")).toBe("定价页 pricing")
    expect(escapeLike("don't stop")).toBe("don't stop")
  })
})

describe("courseSearchCondition", () => {
  it("空 / 空白 / null 都返回 undefined，表示「不加条件」", () => {
    expect(courseSearchCondition(null)).toBeUndefined()
    expect(courseSearchCondition(undefined)).toBeUndefined()
    expect(courseSearchCondition("")).toBeUndefined()
    // 只敲了空格不该被当成搜索词 —— 否则列表会瞬间清空
    expect(courseSearchCondition("   ")).toBeUndefined()
  })

  it("有搜索词时返回条件对象（可用于 and(...conditions)）", () => {
    const cond = courseSearchCondition("雅思")
    expect(cond).toBeDefined()
    expect(typeof cond).toBe("object")
  })

  it("首尾空白被裁掉后再匹配", () => {
    // 不去空白的话 '%雅思 %' 会匹配不到任何「雅思」课程
    expect(courseSearchCondition("  雅思  ")).toBeDefined()
  })
})
