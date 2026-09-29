/**
 * 链路三之三：教材同步（学段 → 年级 → 版本 三级筛选）。
 *
 * 这一段的重点是**筛选的正确性与安全性**：
 *   - `stage` 必须展开成该学段的年级集合；
 *   - **未知 stage 必须返回空结果，绝不能退化成"不加条件"** ——
 *     否则一个拼错的 URL 会把整个课程库倒出来（这是本文件最重要的一条）；
 *   - 版本为 NULL（迁移已跑、回填未跑）时，facets 要如实报告 versionReady=false，
 *     且版本筛选不能返回任何东西；
 *   - 软删除的课程既不出现在列表里，也不计入 facets 的计数。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { seedFixtures, q } from "./helpers/db"
import { insertCourse } from "./helpers/content"

/** facets 的响应形状（只声明本文件用到的部分） */
interface Facets {
  stages: {
    key: string
    label: string
    total: number
    versionUnclassified: number
    versions: { key: string; label: string; count: number }[]
    grades: {
      key: string
      label: string
      total: number
      versions: { key: string; label: string; count: number }[]
    }[]
  }[]
  versionReady: boolean
}

/** 列表接口的响应形状 */
interface ListResponse {
  data: { id: string; title: string; subCategoryKey: string | null; textbookVersion: string | null }[]
  total: number
}

/**
 * 灌一批中小学同步课程。
 *
 * 标题用**生产库真实写法**（含缺括号、错别字），但版本值直接写死 ——
 * 标题解析的规则由 src/__tests__/textbook-taxonomy.test.ts 单测覆盖，
 * 这里要验的是**筛选与计数**，不该把解析也拖进来（失败了分不清是哪一层坏）。
 */
async function seedTextbookCourses() {
  const rows: { title: string; grade: string; version: string | null; published?: number }[] = [
    { title: "【人教版】一年级上册【PEP课本同步】", grade: "grade_1", version: "pep" },
    { title: "【人教版】一年级下册【新起点版课本同步】", grade: "grade_1", version: "pep" },
    { title: "【译林版】一年级上册【课本同步】", grade: "grade_1", version: "yilin" },
    { title: "幼儿启蒙英语", grade: "grade_1", version: "other" },
    { title: "【人教版】三年级上册【PEP课本同步】", grade: "grade_3", version: "pep" },
    { title: "【外研版 三起点】三年级上册【课本同步】", grade: "grade_3", version: "fltrp" },
    { title: "【人教版】七年级上册【课本同步】", grade: "grade_7", version: "pep" },
    { title: "人教版高中必修一(单词)", grade: "high_school", version: "pep" },
    { title: "高中英语：写作与表达", grade: "high_school", version: "other" },
    // 未发布：不该出现在任何 facet 与列表里
    { title: "【人教版】一年级下册（未发布）", grade: "grade_1", version: "pep", published: 0 },
  ]
  for (const r of rows) {
    await insertCourse({
      title: r.title,
      categoryKey: "school_sync",
      subCategoryKey: r.grade,
      textbookVersion: r.version,
      isPublished: r.published ?? 1,
    })
  }
}

beforeEach(async () => {
  await seedFixtures()
})

describe("教材同步 · 筛选面 /api/courses/textbook-facets", () => {
  it("按学段/年级/版本给出准确计数，且只列出有内容的项", async () => {
    await seedTextbookCourses()

    const res = await ApiClient.anonymous().get<Facets>("/api/courses/textbook-facets")
    expect(res.status).toBe(200)

    // 只列出**真的有内容**的学段（夹具没有中职课，所以中职不出现），顺序按 STAGES
    expect(res.body.stages.map((s) => s.key)).toEqual(["primary", "junior", "senior"])

    const primary = res.body.stages.find((s) => s.key === "primary")!
    // 小学：grade_1 四门已发布（pep2 + yilin1 + other1）+ grade_3 两门 = 6
    expect(primary.total).toBe(6)
    // 未发布的课不计入
    expect(primary.grades.map((g) => g.key)).toEqual(["grade_1", "grade_3"])

    const grade1 = primary.grades.find((g) => g.key === "grade_1")!
    expect(grade1.label).toBe("一年级")
    expect(grade1.total).toBe(4)
    const pepInG1 = grade1.versions.find((v) => v.key === "pep")!
    expect(pepInG1.count).toBe(2)
    expect(pepInG1.label).toBe("人教版")
    expect(grade1.versions.find((v) => v.key === "yilin")?.count).toBe(1)
    expect(grade1.versions.find((v) => v.key === "other")?.count).toBe(1)

    // 学段级版本汇总是各年级之和
    expect(primary.versions.find((v) => v.key === "pep")?.count).toBe(3)
    expect(primary.versions.find((v) => v.key === "fltrp")?.count).toBe(1)

    // 版本按数量倒序（用户最可能选的排前面）
    expect(primary.versions[0].key).toBe("pep")

    expect(res.body.versionReady).toBe(true)
  })

  it("版本尚未回填（全 NULL）时 versionReady=false，且计数仍按年级给出", async () => {
    // 只灌两门都不带版本的课，模拟"迁移已跑、回填脚本未跑"
    await insertCourse({ title: "某课 A", categoryKey: "school_sync", subCategoryKey: "grade_1" })
    await insertCourse({ title: "某课 B", categoryKey: "school_sync", subCategoryKey: "grade_1" })

    const res = await ApiClient.anonymous().get<Facets>("/api/courses/textbook-facets")
    expect(res.status).toBe(200)
    expect(res.body.versionReady).toBe(false)

    const primary = res.body.stages.find((s) => s.key === "primary")!
    // 年级总数照常（否则前端会显示"这个年级没课"，而其实是没归类）
    expect(primary.total).toBe(2)
    expect(primary.grades[0].total).toBe(2)
    // 但没有任何版本选项
    expect(primary.grades[0].versions).toEqual([])
    expect(primary.versions).toEqual([])
    // 明确告知有多少课尚未归类版本，前端可据此提示
    expect(primary.versionUnclassified).toBe(2)
  })

  it("没有任何中小学同步课程时返回空数组，而不是报错", async () => {
    const res = await ApiClient.anonymous().get<Facets>("/api/courses/textbook-facets")
    expect(res.status).toBe(200)
    expect(res.body.stages).toEqual([])
  })

  it("软删除的课程不计入任何计数", async () => {
    await seedTextbookCourses()
    await q("UPDATE courses SET deleted_at = NOW(), deleted_batch = UUID() WHERE title = ?", [
      "【译林版】一年级上册【课本同步】",
    ])

    const res = await ApiClient.anonymous().get<Facets>("/api/courses/textbook-facets")
    const primary = res.body.stages.find((s) => s.key === "primary")!
    expect(primary.total).toBe(5)
    expect(primary.grades.find((g) => g.key === "grade_1")!.total).toBe(3)
  })
})

describe("教材同步 · 课程列表过滤 /api/courses/list", () => {
  it("stage=primary 只返回小学年级的课（1-6 年级）", async () => {
    await seedTextbookCourses()

    const res = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&stage=primary&pageSize=50",
    )
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(6)

    const grades = new Set(res.body.data.map((c) => c.subCategoryKey))
    expect([...grades].sort()).toEqual(["grade_1", "grade_3"])
    // 初中/高中的课绝不能出现
    expect(res.body.data.some((c) => c.title.includes("七年级"))).toBe(false)
    expect(res.body.data.some((c) => c.title.includes("高中"))).toBe(false)
  })

  it("stage=senior 只返回高中", async () => {
    await seedTextbookCourses()
    const res = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&stage=senior&pageSize=50",
    )
    expect(res.body.total).toBe(2)
    expect(res.body.data.every((c) => c.subCategoryKey === "high_school")).toBe(true)
  })

  it("年级 + 版本 组合过滤", async () => {
    await seedTextbookCourses()
    const res = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&subCategoryKey=grade_1&textbookVersion=pep&pageSize=50",
    )
    expect(res.body.total).toBe(2)
    expect(res.body.data.every((c) => c.textbookVersion === "pep")).toBe(true)
    expect(res.body.data.every((c) => c.subCategoryKey === "grade_1")).toBe(true)
  })

  it("subCategoryKey 优先于 stage（同时传时以年级为准，避免自相矛盾的条件）", async () => {
    await seedTextbookCourses()
    const res = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&stage=senior&subCategoryKey=grade_1&pageSize=50",
    )
    // 精确年级赢：返回 grade_1，而不是高中
    expect(res.body.total).toBe(4)
    expect(res.body.data.every((c) => c.subCategoryKey === "grade_1")).toBe(true)
  })

  it("**未知 stage 必须返回空，绝不能退化成返回全库**", async () => {
    await seedTextbookCourses()
    // 同时灌一门非 school_sync 的课，用来验证"没有退化成不加条件"
    await insertCourse({ title: "普通课程", categoryKey: "practical", subCategoryKey: "daily_oral" })

    const res = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&stage=university&pageSize=50",
    )
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(0)
    expect(res.body.data).toEqual([])
  })

  it("版本筛选在未回填时返回空（不能因为都是 NULL 就把所有课都算命中）", async () => {
    await insertCourse({ title: "某课", categoryKey: "school_sync", subCategoryKey: "grade_1" })
    const res = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&textbookVersion=pep&pageSize=50",
    )
    expect(res.body.total).toBe(0)
  })

  it("软删除的课程不出现在列表里", async () => {
    await seedTextbookCourses()
    await q("UPDATE courses SET deleted_at = NOW(), deleted_batch = UUID() WHERE title = ?", [
      "【人教版】三年级上册【PEP课本同步】",
    ])
    const res = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&stage=primary&pageSize=50",
    )
    expect(res.body.total).toBe(5)
  })

  it("未发布的课程不出现在列表里", async () => {
    await seedTextbookCourses()
    const res = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&subCategoryKey=grade_1&pageSize=50",
    )
    // grade_1 有 4 门已发布 + 1 门未发布
    expect(res.body.total).toBe(4)
    expect(res.body.data.some((c) => c.title.includes("未发布"))).toBe(false)
  })
})

/**
 * 中职与「未分级」。
 *
 * 这两块是**发布前核对查询发现的缺口**：第一版学段只覆盖 grade_1..9 + high_school，
 * 于是 `vocational`（7 门）和 `sub_category_key IS NULL`（11 门）共 18 门课
 * 在教材同步页完全不可见。这里的用例锁住它们不会再被藏起来。
 */
describe("教材同步 · 中职学段与未分级分组", () => {
  it("中职是一个独立学段，且它的课能被筛出来", async () => {
    await insertCourse({
      title: "中职英语：职场沟通基础",
      categoryKey: "school_sync",
      subCategoryKey: "vocational",
      textbookVersion: "other",
    })
    await insertCourse({
      title: "中职必备2000以上词汇",
      categoryKey: "school_sync",
      subCategoryKey: "vocational",
      textbookVersion: "other",
    })

    const facets = await ApiClient.anonymous().get<Facets>("/api/courses/textbook-facets")
    const voc = facets.body.stages.find((s) => s.key === "vocational")
    expect(voc, "中职学段必须出现（否则这 7 门课在页面上消失）").toBeTruthy()
    expect(voc!.label).toBe("中职")
    expect(voc!.total).toBe(2)
    expect(voc!.grades.map((g) => g.key)).toEqual(["vocational"])

    const list = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&stage=vocational&pageSize=50",
    )
    expect(list.body.total).toBe(2)
    expect(list.body.data.every((c) => c.subCategoryKey === "vocational")).toBe(true)
  })

  it("未分级的课不会被藏起来：作为独立分组可筛出，且没有年级子层", async () => {
    await insertCourse({
      title: "初中英语1674单词",
      categoryKey: "school_sync",
      subCategoryKey: null,
      textbookVersion: "other",
    })
    await insertCourse({
      title: "外研社选必三",
      categoryKey: "school_sync",
      subCategoryKey: null,
      textbookVersion: "fltrp",
    })

    const facets = await ApiClient.anonymous().get<Facets>("/api/courses/textbook-facets")
    const ungraded = facets.body.stages.find((s) => s.key === "ungraded")
    expect(ungraded, "有未分级课程时必须出现这个分组").toBeTruthy()
    expect(ungraded!.label).toBe("未分级")
    expect(ungraded!.total).toBe(2)
    // 没有年级子层 —— 前端据此不渲染年级栏
    expect(ungraded!.grades).toEqual([])
    expect(ungraded!.versions.map((v) => v.key).sort()).toEqual(["fltrp", "other"])

    const list = await ApiClient.anonymous().get<ListResponse>(
      "/api/courses/list?categoryKey=school_sync&stage=ungraded&pageSize=50",
    )
    expect(list.body.total).toBe(2)
    expect(list.body.data.every((c) => c.subCategoryKey === null)).toBe(true)
  })

  it("未分级的课不会混进任何真实学段（stage 展开不能漏成 NULL）", async () => {
    await insertCourse({
      title: "某无年级课",
      categoryKey: "school_sync",
      subCategoryKey: null,
      textbookVersion: "other",
    })
    await insertCourse({
      title: "某一年级课",
      categoryKey: "school_sync",
      subCategoryKey: "grade_1",
      textbookVersion: "pep",
    })

    for (const st of ["primary", "junior", "senior", "vocational"]) {
      const r = await ApiClient.anonymous().get<ListResponse>(
        `/api/courses/list?categoryKey=school_sync&stage=${st}&pageSize=50`,
      )
      expect(
        r.body.data.some((c) => c.subCategoryKey === null),
        `${st} 里混进了无年级课程`,
      ).toBe(false)
    }
  })

  it("没有未分级课程时不出现这个分组（避免一个点进去空的标签）", async () => {
    await insertCourse({
      title: "某课",
      categoryKey: "school_sync",
      subCategoryKey: "grade_1",
      textbookVersion: "pep",
    })
    const res = await ApiClient.anonymous().get<Facets>("/api/courses/textbook-facets")
    expect(res.body.stages.map((s) => s.key)).not.toContain("ungraded")
  })
})
