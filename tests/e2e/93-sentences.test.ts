/**
 * 链路：句子列表的范围化浏览与搜索 + AI 接口配额
 *
 * 句子列表此前是"全局按 sort_order 排序的 46 万行表"，有两个独立的问题：
 *
 *   1. **语义错**：sort_order 是课内顺序（全表只有 0..960，单课最多 960 句），
 *      全局按它排会把 16,891 个课时的第 1 句混在一起 ——
 *      实测 `ORDER BY sort_order LIMIT 10` 取到 10 个不同课时。
 *   2. **性能差**：没有可用索引，EXPLAIN 是 type=ALL + Using filesort，
 *      另有一条每次都要跑的 COUNT(*)。
 *
 * 所以这里断言的是"给了课时范围 → 只在课内、按课内顺序、total 精确"，
 * 以及"没给范围时不许做全库模糊搜索"。后者是刻意的拒绝，不是缺陷：
 * 前导通配符 LIKE 在 46 万行 / 2.9GB 上要全表扫（实测 1.3~25 秒）。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q } from "./helpers/db"
import { insertUser } from "./helpers/factories"

async function makeAdmin(): Promise<string> {
  const id = await insertUser({ name: "e2e 句子管理员" })
  await q("UPDATE users SET role = 'admin' WHERE id = ?", [id])
  return id
}

interface SentencesBody {
  data: Array<{
    id: string
    lessonId: string | null
    sortOrder: number | null
    chinese: string | null
    english: string | null
  }>
  total: number
  orderedBy?: "sortOrder" | "createdAt"
  totalIsCached?: boolean
}

/** 往某个课时里插一句指定 sort_order 的句子，便于断言课内顺序。 */
async function insertSentence(
  lessonId: string,
  sortOrder: number,
  chinese: string,
  english: string,
): Promise<string> {
  const id = crypto.randomUUID()
  await q(
    `INSERT INTO sentences (id, chinese, english, lesson_id, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [id, chinese, english, lessonId, sortOrder],
  )
  return id
}

beforeEach(async () => {
  await seedFixtures()
})

describe("句子列表：按课时范围浏览", () => {
  it("未登录 → 401；非管理员 → 401", async () => {
    expect((await ApiClient.anonymous().get("/api/admin/sentences")).status).toBe(401)
    expect((await ApiClient.asUser(FIXTURE.userFree).get("/api/admin/sentences")).status).toBe(401)
  })

  it("给了 lessonId：只返回该课时的句子", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "第一句", "First one")
    await insertSentence(FIXTURE.lessonA1, 2, "第二句", "Second one")
    await insertSentence(FIXTURE.lessonB1, 1, "别的课时的句子", "Another lesson")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&pageSize=100`,
    )
    expect(res.status).toBe(200)
    expect(res.body.data.every((s) => s.lessonId === FIXTURE.lessonA1)).toBe(true)
    expect(res.body.data.some((s) => s.chinese === "别的课时的句子")).toBe(false)
  })

  it("给了 lessonId：按**课内** sort_order 升序（这是这次修的核心）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    // 故意乱序插入：如果接口仍按全局 sort_order 排，跨课时的行会混进来
    await insertSentence(FIXTURE.lessonA1, 3, "甲三", "A3")
    await insertSentence(FIXTURE.lessonA1, 1, "甲一", "A1")
    await insertSentence(FIXTURE.lessonA1, 2, "甲二", "A2")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&pageSize=100`,
    )
    const orders = res.body.data
      .filter((s) => s.chinese?.startsWith("甲"))
      .map((s) => Number(s.sortOrder))
    expect(orders).toEqual([1, 2, 3])
    expect(res.body.orderedBy).toBe("sortOrder")
  })

  it("给了 lessonId：total 是该课时的精确条数（不是全库 46 万）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    // 夹具本身往 lessonA1 里放了 3 句，所以用**增量**断言，不写死绝对值
    // （写死会让这条测试在夹具变化时莫名其妙地红）
    const before = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&pageSize=1`,
    )
    const baseTotal = before.body.total

    await insertSentence(FIXTURE.lessonA1, 1, "一", "one")
    await insertSentence(FIXTURE.lessonA1, 2, "二", "two")
    // 另一课时插一句，用来证明 total 不会被别的课时污染
    await insertSentence(FIXTURE.lessonB1, 1, "三", "three")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&pageSize=100`,
    )
    expect(res.body.total).toBe(baseTotal + 2)
    // 有范围时 total 是精确计数的，不该标成缓存值
    expect(res.body.totalIsCached).toBe(false)
  })

  it("没给 lessonId：按添加时间倒序，并回显 orderedBy=createdAt", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<SentencesBody>("/api/admin/sentences?pageSize=5")
    expect(res.status).toBe(200)
    expect(res.body.orderedBy).toBe("createdAt")
    // 无范围时 total 走 stats-cache（与仪表盘「句子库」同一个数）
    expect(res.body.totalIsCached).toBe(true)
    expect(typeof res.body.total).toBe("number")
  })

  it("没给 lessonId：不再按 sort_order 排（那会把各课时的第 1 句混在一起）", async () => {
    const admin = await makeAdmin()
    // 造两句：A 课时 sort_order 很大但刚插入，B 课时 sort_order 很小但很旧。
    // 按 sort_order 排会把 B 排前面；按 created_at 倒序应把 A（刚插的）排前面。
    await q(
      `INSERT INTO sentences (id, chinese, english, lesson_id, sort_order, created_at)
       VALUES (UUID(), '旧的但序号小', 'old', ?, 1, DATE_SUB(NOW(), INTERVAL 1 DAY))`,
      [FIXTURE.lessonB1],
    )
    await insertSentence(FIXTURE.lessonA1, 900, "新的但序号大", "new")

    const res = await ApiClient.asUser(admin).get<SentencesBody>(
      "/api/admin/sentences?pageSize=50",
    )
    const chineses = res.body.data.map((x) => x.chinese)
    const newIdx = chineses.indexOf("新的但序号大")
    const oldIdx = chineses.indexOf("旧的但序号小")
    // 关键断言是这两行的**相对顺序**：旧的那句 sort_order 更小，
    // 若接口还按 sort_order 排它会排在前面。夹具自身的句子可能插在中间，
    // 所以不能写死 data[0]（同秒插入的夹具行会与之并列，顺序不稳定）
    expect(newIdx).toBeGreaterThanOrEqual(0)
    expect(oldIdx).toBeGreaterThanOrEqual(0)
    expect(newIdx).toBeLessThan(oldIdx)
  })
})

describe("句子列表：课时内精确搜索 + 全库全文搜索", () => {
  it("不给 lessonId 也能搜全库（走全文索引，不再 400）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "全库搜索能命中这一句", "global search hits this")
    await insertSentence(FIXTURE.lessonB1, 1, "这一句不该被命中", "nope")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?q=${encodeURIComponent("全库搜索")}&pageSize=20`,
    )
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.data[0].chinese).toBe("全库搜索能命中这一句")
    // 有搜索条件时 total 必须精确计数，不能复用「全表未删除总数」那个缓存
    expect(res.body.totalIsCached).toBe(false)
  })

  it("单字关键词 → 400 并说明（全文分词长度是 2，搜不到；绝不能静默返回空）", async () => {
    // 实测 MATCH ... AGAINST('"天"') = 0 条，而 LIKE '%天%' 命中全部。
    // 静默返回空会让管理员以为库里没有 —— 所以必须报错并给出替代路径。
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "含天字的句子", "has the character")

    const res = await admin.get<{ error: string; code?: string }>(
      `/api/admin/sentences?q=${encodeURIComponent("天")}&pageSize=20`,
    )
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("query_too_short")
    // 错误信息要能指导下一步：说明长度下限，并指向"先选课时"
    expect(res.body.error).toMatch(/2/)
    expect(res.body.error).toMatch(/课时/)
  })

  it("同一个单字，选了课时就能搜到（课时内是 LIKE 精确子串，没有分词限制）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "含天字的句子", "has the character")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&q=${encodeURIComponent("天")}&pageSize=20`,
    )
    expect(res.status).toBe(200)
    // 不写死条数：夹具里本来就有含「天」的句子，写死会让这条测试依赖夹具内容。
    // 要断言的是"单字在课时内**能**搜到"（与全库那条 400 形成对照）。
    expect(res.body.data.map((x) => x.chinese)).toContain("含天字的句子")
  })

  it("★ 中文关键词能同时命中 chinese 与 english 两列（拼接列的存在理由）", async () => {
    // 「一个拼接列 + 一个索引」这个设计对**中文**场景仍然必要：
    // 生产库有 435 条句子的 english 里含中文，若只搜 chinese 列会漏掉它们。
    // 而给两列各建一个 FULLTEXT 再用 OR 连接会让索引完全失效（见 00031）。
    const admin = ApiClient.asUser(await makeAdmin())
    // 关键词只出现在 english 列里
    await insertSentence(FIXTURE.lessonA1, 1, "完全无关的中文", "这句英文里混了特殊关键词")
    await insertSentence(FIXTURE.lessonB1, 1, "另一句无关的", "nothing special here")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?q=${encodeURIComponent("特殊关键词")}&pageSize=20`,
    )
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.data[0].english).toContain("特殊关键词")
  })

  it("★ 纯英文关键词 → 400（实测全文索引对英文不可靠，宁可拒绝也不返回错结果）", async () => {
    // 生产库实测（MATCH 带引号短语 vs LIKE 全表）：
    //   James 4414 vs 94（多 47 倍，命中的句子只含 am/me/es）
    //   jam      0 vs 4（明明有包含关系却一条不返回）
    // 受控实验复现：4 行数据里 "james" 返回第 1、2、3 行，而 2、3 行不含 james。
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "来吧Robbie，我们赶紧走", "Come on, let us go")

    const res = await admin.get<{ error: string; code?: string }>(
      "/api/admin/sentences?q=Robbie&pageSize=20",
    )
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("query_not_cjk")
    // 说明必须给出替代路径（选课时后精确匹配），而不是只说失败
    expect(res.body.error).toContain("课时")
    expect(res.body.error).toContain("纯中文")
  })

  it("★ 中英混合关键词 → 400，且原因与纯英文区分开", async () => {
    // 生产实测：与Allen → MATCH 1331 条，而 LIKE 是 0 条（凭空造出假结果）
    const admin = ApiClient.asUser(await makeAdmin())
    const res = await admin.get<{ error: string; code?: string }>(
      `/api/admin/sentences?q=${encodeURIComponent("与Allen")}&pageSize=20`,
    )
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("query_mixed")
  })

  it("英文关键词选了课时就能精确搜到（课时内是 LIKE，没有分词限制）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "来吧Robbie，我们赶紧走", "Come on, let us go")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&q=Robbie&pageSize=20`,
    )
    expect(res.status).toBe(200)
    expect(res.body.data.map((x) => x.chinese)).toContain("来吧Robbie，我们赶紧走")
  })

  it("课时内搜索转义 LIKE 通配符：搜 % 不该命中该课时全部句子", async () => {
    // 原先没转义 —— 搜 `%` 会变成「匹配任意」，看起来像"搜索没生效"。
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "百分之百", "hundred percent")
    await insertSentence(FIXTURE.lessonA1, 2, "另一句", "another")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&q=${encodeURIComponent("%")}&pageSize=50`,
    )
    expect(res.status).toBe(200)
    // 没有句子含字面量 % → 应为 0 条；不转义会命中该课时的全部 2 句
    expect(res.body.total).toBe(0)
  })

  it("同时给 q 和 lessonId → 在该课时内搜索中文", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "独一无二的中文串", "unique match")
    await insertSentence(FIXTURE.lessonA1, 2, "普通句子", "ordinary")
    await insertSentence(FIXTURE.lessonB1, 1, "独一无二的中文串", "unique match in other lesson")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&q=${encodeURIComponent("独一无二")}&pageSize=50`,
    )
    expect(res.status).toBe(200)
    // 只命中本课时那条，另一课时里的同名句子不能出现
    expect(res.body.total).toBe(1)
    expect(res.body.data[0].lessonId).toBe(FIXTURE.lessonA1)
  })

  it("同时给 q 和 lessonId → 也能搜英文", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "中文", "pineapple express")

    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&q=pineapple&pageSize=50`,
    )
    expect(res.body.total).toBe(1)
  })

  it("搜不到时返回空数组而不是报错", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    await insertSentence(FIXTURE.lessonA1, 1, "中文", "english")
    const res = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${FIXTURE.lessonA1}&q=zzz-nothing-matches&pageSize=50`,
    )
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(0)
    expect(res.body.data).toEqual([])
  })
})

describe("句子总数缓存：写入后失效", () => {
  it("新增句子后，无范围列表的 total 立刻包含它（不被 10 分钟 TTL 拖住）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())

    // 先读一次，把缓存写下来
    const before = await admin.get<SentencesBody>("/api/admin/sentences?pageSize=5")
    const baseTotal = before.body.total

    // 再新增一句（POST 会失效缓存）
    const lessonId = FIXTURE.lessonA1
    const created = await admin.post("/api/admin/sentences", {
      chinese: "缓存要失效",
      english: "cache must be invalidated",
      lessonId,
      sortOrder: 99,
    })
    expect([200, 201]).toContain(created.status)

    const after = await admin.get<SentencesBody>("/api/admin/sentences?pageSize=5")
    // 如果忘了失效缓存，这里仍然等于 baseTotal —— 使用者会以为"保存没生效"
    expect(after.body.total).toBe(baseTotal + 1)
  })
})

describe("AI 接口配额", () => {
  /**
   * 只断言"鉴权先于配额、且未超限时不会被拦"。真正的配额耗尽要发 60 次请求，
   * 而且这些接口会真的调用 LLM —— 在本机 e2e 里外部服务是被屏蔽的，
   * 所以配额的计数逻辑由单测（admin-ai-quota.test.ts）覆盖，
   * 这里只确认接线正确：未登录仍然 401，而不是 429。
   */
  const AI_ENDPOINTS: Array<[string, string]> = [
    ["POST", "/api/admin/materials/analyze"],
    ["POST", "/api/admin/ai/extract-sentences"],
    ["POST", `/api/admin/sentences/${FIXTURE.sentA1Plain}/analyze`],
    ["POST", `/api/admin/sentences/${FIXTURE.sentA1Plain}/split`],
    ["POST", `/api/admin/courses/${FIXTURE.coursePublished}/ai-generate`],
  ]

  for (const [method, path] of AI_ENDPOINTS) {
    it(`${path} 未登录 → 401（鉴权在配额之前，不能先回 429 泄露接口存在）`, async () => {
      const res = await ApiClient.anonymous().request(method, path, { json: {} })
      expect(res.status).toBe(401)
    })
  }

  it("非管理员 → 401", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).request(
      "POST",
      `/api/admin/sentences/${FIXTURE.sentA1Plain}/split`,
      { json: {} },
    )
    expect(res.status).toBe(401)
  })
})

describe("课时内排序：必须提交完整列表（否则会写乱 sortOrder）", () => {
  /**
   * 这个守卫来自一个真实事故风险：reorder 按**数组下标**赋 sortOrder，
   * 而课时详情页曾用 `pageSize=200` 拉句子、被服务端钳到 100 ——
   * 于是拖一下就会给前 100 句写 0..99、其余保留 1..960，序号大面积重复。
   * 线上有 753 个课时超过 100 句（136,092 句），最大 960 句。
   */
  async function lessonWithSentences(n: number): Promise<{ lessonId: string; ids: string[] }> {
    const lessonId = crypto.randomUUID()
    await q(
      `INSERT INTO lessons (id, course_id, title, sort_order) VALUES (?, ?, '排序测试课时', 0)`,
      [lessonId, FIXTURE.coursePublished],
    )
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      ids.push(await insertSentence(lessonId, i, `第 ${i} 句`, `sentence ${i}`))
    }
    return { lessonId, ids }
  }

  it("未登录 → 401", async () => {
    const { lessonId, ids } = await lessonWithSentences(2)
    const res = await ApiClient.anonymous().request(
      "PUT",
      `/api/admin/lessons/${lessonId}/sentences/reorder`,
      { json: { orderedIds: ids } },
    )
    expect(res.status).toBe(401)
  })

  it("提交完整列表 → 按提交顺序重写 sortOrder", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const { lessonId, ids } = await lessonWithSentences(3)
    // 倒序提交
    const reversed = [...ids].reverse()

    const res = await admin.request("PUT", `/api/admin/lessons/${lessonId}/sentences/reorder`, {
      json: { orderedIds: reversed },
    })
    expect(res.status).toBe(200)

    const after = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${lessonId}&pageSize=50`,
    )
    expect(after.body.data.map((x) => x.id)).toEqual(reversed)
    expect(after.body.data.map((x) => Number(x.sortOrder))).toEqual([0, 1, 2])
  })

  it("**只提交一部分 → 400 且不写库**（这正是会毁数据的那种调用）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const { lessonId, ids } = await lessonWithSentences(5)

    // 只提交前 2 句 —— 修复前这会写入 sortOrder 0,1，其余 3 句保持 2,3,4，
    // 表面看没问题；但真实场景是前 100 句写 0..99、其余 1..960，大量重复
    const res = await admin.request("PUT", `/api/admin/lessons/${lessonId}/sentences/reorder`, {
      json: { orderedIds: ids.slice(0, 2) },
    })
    expect(res.status).toBe(400)
    expect((res.body as { code?: string }).code).toBe("incomplete_payload")

    // 关键：库里必须一个字节都没改
    const after = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${lessonId}&pageSize=50`,
    )
    expect(after.body.data.map((x) => Number(x.sortOrder))).toEqual([0, 1, 2, 3, 4])
  })

  it("提交不属于该课时的 id → 400（张冠李戴同样会写乱）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const a = await lessonWithSentences(2)
    const b = await lessonWithSentences(2)

    // 数量对得上，但内容是另一课时的句子
    const res = await admin.request("PUT", `/api/admin/lessons/${a.lessonId}/sentences/reorder`, {
      json: { orderedIds: b.ids },
    })
    expect(res.status).toBe(400)
  })

  it("含有重复 id → 400（重复会让集合比较失真）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const { lessonId, ids } = await lessonWithSentences(2)
    const res = await admin.request("PUT", `/api/admin/lessons/${lessonId}/sentences/reorder`, {
      json: { orderedIds: [ids[0], ids[0]] },
    })
    expect(res.status).toBe(400)
  })

  it("非数组 / 非字符串元素 → 400", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    const { lessonId } = await lessonWithSentences(1)
    for (const bad of [undefined, null, "abc", [1, 2], [{}]]) {
      const res = await admin.request("PUT", `/api/admin/lessons/${lessonId}/sentences/reorder`, {
        json: { orderedIds: bad },
      })
      expect(res.status, `orderedIds=${JSON.stringify(bad)} 应被拒`).toBe(400)
    }
  })

  it("大于 100 句的课时也能一次提交完整列表（前端分页拉全的前提）", async () => {
    const admin = ApiClient.asUser(await makeAdmin())
    // 一个 120 句的课时：正是被 pageSize=200→100 钳制影响的规模
    const { lessonId, ids } = await lessonWithSentences(120)

    // 第一页只有 100 句
    const page1 = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${lessonId}&pageSize=100&current=1`,
    )
    expect(page1.body.data.length).toBe(100)
    expect(page1.body.total).toBe(120)

    // 提交完整的 120 个 id 应当成功
    const res = await admin.request("PUT", `/api/admin/lessons/${lessonId}/sentences/reorder`, {
      json: { orderedIds: [...ids].reverse() },
    })
    expect(res.status).toBe(200)

    const after = await admin.get<SentencesBody>(
      `/api/admin/sentences?lessonId=${lessonId}&pageSize=100&current=1`,
    )
    // 倒序后第一句应当是原来最后那一句
    expect(after.body.data[0].id).toBe(ids[119])
    expect(Number(after.body.data[0].sortOrder)).toBe(0)
  })
})
