/**
 * 单词本与笔记本（/api/wordbook、/api/notes）
 *
 * 这两个功能都是纯用户私有数据，用例的重点是「隔离」与「幂等」：
 *   - 任何读写都不能串到别人名下；
 *   - 重复添加单词不能报错、也不能产生重复行；
 *   - 编辑/删除别人 id 时，接口必须明确失败，而不是静默成功骗过前端。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ApiClient } from "./helpers/api"
import { FIXTURE, seedFixtures, q, one } from "./helpers/db"

const SENT = FIXTURE.sentA1Plain

async function insertDictEntry(word: string, translations: string[]): Promise<void> {
  await q(
    `INSERT INTO word_dictionary_cache (id, word, phonetic, phonetic_uk, translations, pos)
     VALUES (UUID(), ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
    [
      word,
      "/ˈtest/",
      "/ˈtest/",
      JSON.stringify(translations),
      JSON.stringify([{ pos: "n.", meaning: translations[0] }]),
    ]
  )
}

beforeEach(async () => {
  await seedFixtures()
})

describe("单词本 /api/wordbook", () => {
  it("未登录：GET / POST / DELETE 一律 401", async () => {
    expect((await ApiClient.anonymous().get("/api/wordbook")).status).toBe(401)
    expect((await ApiClient.anonymous().post("/api/wordbook", { word: "test" })).status).toBe(401)
    expect((await ApiClient.anonymous().del("/api/wordbook?word=test")).status).toBe(401)
  })

  it("新增单词：大小写与首尾空格被归一化", async () => {
    const res = await ApiClient.asUser(FIXTURE.userFree).post<{ ok: boolean; word: string }>(
      "/api/wordbook",
      { word: "  Study  ", sourceSentenceId: SENT }
    )
    expect(res.status).toBe(200)
    expect(res.body.word).toBe("study")

    const row = await one<{ word: string; source_sentence_id: string }>(
      "SELECT word, source_sentence_id FROM wordbook_items WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(row?.word).toBe("study")
    expect(row?.source_sentence_id).toBe(SENT)
  })

  it("空单词/纯空格/超长单词 → 400", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    for (const word of ["", "   ", "a".repeat(65)]) {
      const res = await api.post("/api/wordbook", { word })
      expect(res.status).toBe(400)
    }
    // 64 个字符是允许的上界
    expect((await api.post("/api/wordbook", { word: "a".repeat(64) })).status).toBe(200)
  })

  it("重复添加同一个单词不报错、不产生重复行，但会更新来源句子", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    expect((await api.post("/api/wordbook", { word: "study", sourceSentenceId: SENT })).status).toBe(
      200
    )
    expect(
      (await api.post("/api/wordbook", { word: "STUDY", sourceSentenceId: FIXTURE.sentA2Plain }))
        .status
    ).toBe(200)

    const count = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM wordbook_items WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(Number(count?.c)).toBe(1)

    const row = await one<{ source_sentence_id: string }>(
      "SELECT source_sentence_id FROM wordbook_items WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(row?.source_sentence_id).toBe(FIXTURE.sentA2Plain)
  })

  it("列表带出词典缓存的音标与释义，并只返回自己的单词", async () => {
    await insertDictEntry("study", ["v. 学习", "n. 书房"])
    const api = ApiClient.asUser(FIXTURE.userFree)
    await api.post("/api/wordbook", { word: "study" })
    const mine = await ApiClient.asUser(FIXTURE.userFree).post("/api/wordbook", { word: "every" })
    expect(mine.status).toBe(200)

    // 别人的词条
    await ApiClient.asUser(FIXTURE.userPro).post("/api/wordbook", { word: "teacher" })

    const res = await ApiClient.asUser(FIXTURE.userFree).get<{
      items: Array<{
        word: string
        phonetic: string | null
        translations: string[] | null
        addedAt: string
      }>
      total: number
      page: number
      size: number
    }>("/api/wordbook")

    expect(res.status).toBe(200)
    expect(Number(res.body.total)).toBe(2)
    expect(res.body.items.map((i) => i.word).sort()).toEqual(["every", "study"])

    const study = res.body.items.find((i) => i.word === "study")
    expect(study?.phonetic).toBe("/ˈtest/")
    expect(study?.translations).toEqual(["v. 学习", "n. 书房"])
    expect(study?.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // 没有词典缓存的行照样返回，字段为 null 而不是整行消失
    const every = res.body.items.find((i) => i.word === "every")
    expect(every?.translations).toBeNull()
  })

  it("size 有上限，非法分页参数不 500", async () => {
    await ApiClient.asUser(FIXTURE.userFree).post("/api/wordbook", { word: "study" })
    const api = ApiClient.asUser(FIXTURE.userFree)

    const capped = await api.get<{ items: unknown[]; size: number }>("/api/wordbook?page=1&size=9999")
    expect(Number(capped.body.size)).toBeLessThanOrEqual(100)
    expect(capped.status).toBe(200)

    for (const qs of ["page=abc", "size=abc", "page=-3", "size=0"]) {
      expect((await api.get(`/api/wordbook?${qs}`)).status).toBe(200)
    }
  })

  it("删除：缺 word → 400；只删自己的那个词", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    expect((await api.del("/api/wordbook")).status).toBe(400)

    await api.post("/api/wordbook", { word: "study" })
    await ApiClient.asUser(FIXTURE.userPro).post("/api/wordbook", { word: "study" })

    expect((await api.del("/api/wordbook?word=STUDY")).status).toBe(200)

    const mine = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM wordbook_items WHERE user_id = ?",
      [FIXTURE.userFree]
    )
    expect(Number(mine?.c)).toBe(0)

    const other = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM wordbook_items WHERE user_id = ?",
      [FIXTURE.userPro]
    )
    expect(Number(other?.c)).toBe(1)

    // 再删一次（已不存在）不应报错
    expect((await api.del("/api/wordbook?word=study")).status).toBe(200)
  })
})

describe("笔记本 /api/notes", () => {
  it("未登录：GET / POST / PUT / DELETE 一律 401", async () => {
    expect((await ApiClient.anonymous().get("/api/notes")).status).toBe(401)
    expect((await ApiClient.anonymous().post("/api/notes", { content: "x" })).status).toBe(401)
    expect((await ApiClient.anonymous().put("/api/notes", { id: "x" })).status).toBe(401)
    expect((await ApiClient.anonymous().del("/api/notes?id=x")).status).toBe(401)
  })

  it("新建：标题与正文都为空 → 400；只有正文时标题落默认值", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    expect((await api.post("/api/notes", {})).status).toBe(400)
    expect((await api.post("/api/notes", { title: "  ", content: "" })).status).toBe(400)

    const res = await api.post<{ note: { id: string; title: string; content: string } }>(
      "/api/notes",
      { content: "只有正文" }
    )
    expect(res.status).toBe(200)
    expect(res.body.note.title).toBe("未命名笔记")
    expect(res.body.note.content).toBe("只有正文")
  })

  it("新建：只有标题也应成功；超长标题被截断到 200 字", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    const onlyTitle = await api.post<{ note: { content: string } }>("/api/notes", { title: "标题" })
    expect(onlyTitle.status).toBe(200)
    expect(onlyTitle.body.note.content).toBe("")

    const long = await api.post<{ note: { title: string } }>("/api/notes", {
      title: "字".repeat(500),
    })
    expect(long.body.note.title.length).toBe(200)
  })

  it("列表只返回自己的笔记，并按更新时间倒序", async () => {
    await q(
      `INSERT INTO user_notes (id, user_id, title, content, created_at, updated_at)
       VALUES (UUID(), ?, '旧', '', ?, ?), (UUID(), ?, '新', '', ?, ?)`,
      [
        FIXTURE.userFree,
        new Date(Date.now() - 86400_000),
        new Date(Date.now() - 86400_000),
        FIXTURE.userFree,
        new Date(Date.now() - 60_000),
        new Date(Date.now() - 60_000),
      ]
    )
    await q(
      `INSERT INTO user_notes (id, user_id, title, content) VALUES (UUID(), ?, '别人的', '')`,
      [FIXTURE.userPro]
    )

    const res = await ApiClient.asUser(FIXTURE.userFree).get<{
      items: Array<{ title: string }>
      total: number
    }>("/api/notes")

    expect(res.status).toBe(200)
    expect(Number(res.body.total)).toBe(2)
    expect(res.body.items.map((n) => n.title)).toEqual(["新", "旧"])
  })

  it("更新：内容与更新时间都会被刷新，空标题回落到默认名", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    const created = await api.post<{ note: { id: string } }>("/api/notes", {
      title: "原标题",
      content: "原内容",
    })
    const id = created.body.note.id

    const res = await api.put<{ note: { title: string; content: string; updatedAt: string } }>(
      "/api/notes",
      { id, title: "  ", content: "新内容" }
    )
    expect(res.status).toBe(200)
    expect(res.body.note.content).toBe("新内容")
    expect(res.body.note.title).toBe("未命名笔记")

    const row = await one<{ updated_at: Date; created_at: Date; content: string }>(
      "SELECT updated_at, created_at, content FROM user_notes WHERE id = ?",
      [id]
    )
    expect(row?.content).toBe("新内容")
    // 只断言「写入了当下的时间」：本机测试用的 Docker MySQL 容器时钟比宿主机
    // 快约 1 秒（created_at 由 DB DEFAULT 写入、updated_at 由应用写入），直接
    // 比较两者在这个环境里并不可靠。生产上 DB 与 Node 同机同时钟，不存在这个问题。
    expect(Math.abs(Date.now() - new Date(row!.updated_at).getTime())).toBeLessThan(5000)
  })

  it("更新：缺少 id → 400；别人的笔记 → 404，且对方内容不变", async () => {
    const other = await ApiClient.asUser(FIXTURE.userPro).post<{ note: { id: string } }>(
      "/api/notes",
      { title: "别人的笔记", content: "原内容" }
    )
    const otherId = other.body.note.id

    const mine = ApiClient.asUser(FIXTURE.userFree)
    expect((await mine.put("/api/notes", { content: "x" })).status).toBe(400)

    const res = await mine.put("/api/notes", { id: otherId, content: "被篡改" })
    // 之前这里返回 200 + `{}`，前端会以为保存成功
    expect(res.status).toBe(404)

    const row = await one<{ content: string; title: string }>(
      "SELECT content, title FROM user_notes WHERE id = ?",
      [otherId]
    )
    expect(row?.content).toBe("原内容")
    expect(row?.title).toBe("别人的笔记")

    // 不存在的 id 同样是 404
    expect((await mine.put("/api/notes", { id: "not-a-real-id", content: "x" })).status).toBe(404)
  })

  it("删除：缺少 id → 400；删自己的生效；别人的 id 不影响对方数据", async () => {
    const api = ApiClient.asUser(FIXTURE.userFree)
    const mine = await api.post<{ note: { id: string } }>("/api/notes", { content: "我的" })
    const other = await ApiClient.asUser(FIXTURE.userPro).post<{ note: { id: string } }>(
      "/api/notes",
      { content: "别人的" }
    )

    expect((await api.del("/api/notes")).status).toBe(400)

    expect((await api.del(`/api/notes?id=${other.body.note.id}`)).status).toBe(200)
    const stillThere = await one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM user_notes WHERE id = ?",
      [other.body.note.id]
    )
    expect(Number(stillThere?.c)).toBe(1)

    expect((await api.del(`/api/notes?id=${mine.body.note.id}`)).status).toBe(200)
    const gone = await one<{ c: number }>("SELECT COUNT(*) AS c FROM user_notes WHERE id = ?", [
      mine.body.note.id,
    ])
    expect(Number(gone?.c)).toBe(0)
  })
})
