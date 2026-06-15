/**
 * 句乐部全量爬虫 + 自动入库
 *
 * 爬取所有课程包的句子数据 → 保存 JSON → 写入数据库
 * 断点续传，后台运行：nohup node scripts/crawl-all-julebu.cjs > crawl.log 2>&1 &
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") })
const fs = require("fs"), path = require("path")
const { classify } = require("./julebu-category")
const DATA_DIR = path.join(__dirname, "..", ".data", "julebu")
const C = process.env.JULEBU_COOKIE
const MAX_PACKS = process.env.MAX_PACKS ? Number(process.env.MAX_PACKS) : Infinity
if (!C) { console.error("❌ No cookie"); process.exit(1) }

const allPacks = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "all-packs.json"), "utf-8"))
console.log(`📊 ${allPacks.length} 个课程包, ${allPacks.reduce((s,p) => s + p.courses.length, 0)} 课`)

const existingTitles = new Set()
for (const fn of fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json") && !f.startsWith("sentences-") && !["all-packs.json","packs-metadata.json"].includes(f))) {
  try { const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR,fn),"utf-8")); if (d.title) existingTitles.add(d.title) } catch {}
}
const pending = allPacks.filter(p => !existingTitles.has(p.title) && p.courses.length > 0).slice(0, MAX_PACKS)
console.log(`📋 待爬: ${pending.length} 包, ${pending.reduce((s,p) => s + p.courses.length, 0)} 课`)
if (pending.length === 0) { console.log("✅ 全部完成"); process.exit(0) }

// ── 数据库模块 ──
const mysql = require("mysql2/promise")
let dbPool
async function getDb() {
  if (!dbPool) dbPool = mysql.createPool(process.env.DATABASE_URL)
  return dbPool
}

async function importPackToDB(pack, packFile) {
  const pool = await getDb()
  let data
  try {
    data = JSON.parse(fs.readFileSync(packFile, "utf-8"))
    if (!data.courses?.length) return { lessons: 0, sentences: 0 }

    // Check if already exists
    const [rows] = await pool.query("SELECT id FROM courses WHERE title = ? AND source_name = '官方' LIMIT 1", [data.title])
    if (rows.length > 0) return { lessons: 0, sentences: 0 }

    const courseId = require("crypto").randomUUID()
    const cls = classify(data.title)
    await pool.query("INSERT INTO courses (id, title, description, source, source_name, learner_count, usage_count, is_published, category_key, sub_category_key) VALUES (?,?,?,'official','官方',0,0,1,?,?)",
      [courseId, data.title, data.title, cls.categoryKey, cls.subCategoryKey])

    let lessonCount = 0, sentenceCount = 0
    for (const jc of data.courses) {
      if (!jc.sentences?.length) continue
      const lessonId = require("crypto").randomUUID()
      await pool.query("INSERT INTO lessons (id, course_id, title, summary, sort_order) VALUES (?,?,?,'',?)",
        [lessonId, courseId, jc.title, jc.order ?? 0])
      lessonCount++

      // Batch insert sentences (100 at a time)
      const batch = []
      for (const s of jc.sentences) {
        const sid = require("crypto").randomUUID()
        const words = s.wordDetails?.map(w => ({ english: w.word, chinese: w.definition ?? null, phonetic: String(w.phonetic ?? ""), pos: w.pos })) ?? null
        batch.push([sid, s.chinese ?? "", s.english ?? "", lessonId, s.sortOrder ?? 0,
          words ? JSON.stringify(words) : null,
          s.dependencyAnalysis ? JSON.stringify(s.dependencyAnalysis) : null,
          s.sentenceStructure ? JSON.stringify(s.sentenceStructure) : null])
        sentenceCount++
      }
      // Insert in batches
      for (let i = 0; i < batch.length; i += 100) {
        const chunk = batch.slice(i, i + 100)
        const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?)").join(",")
        const flat = chunk.flat()
        await pool.query(`INSERT INTO sentences (id, chinese, english, lesson_id, sort_order, words, dependency_analysis, sentence_structure) VALUES ${placeholders}`, flat)
      }
    }
    return { lessons: lessonCount, sentences: sentenceCount }
  } catch (e) {
    console.error(`  ❌ DB import error for ${data?.title}: ${e.message}`)
    return { lessons: 0, sentences: 0 }
  }
}

// ── 爬虫核心 ──
async function main() {
  const puppeteer = require("/tmp/puppeteer-tmp/node_modules/puppeteer")
  console.log("🖥 启动浏览器...")
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new", args: ["--no-sandbox", "--window-size=800,600"]
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 800, height: 600 })

  for (const pair of C.split(";").map(c => c.trim())) {
    const eq = pair.indexOf("="); if (eq === -1) continue
    const n = pair.slice(0, eq).trim()
    if (!n.startsWith("__Secure-julebu")) continue
    await page.setCookie({ name: n, value: pair.slice(eq + 1).trim(), domain: ".julebu.co", path: "/", secure: true, sameSite: "Lax" })
  }

  let responseQueue = []
  page.on("response", r => {
    if (r.url().includes("courses.findOne")) {
      r.text().then(text => {
        try { for (const item of JSON.parse(text)) { const j = item?.result?.data?.json; if (j?.sentences?.length) responseQueue.push(j) } } catch {}
      }).catch(() => {})
    }
  })

  let packDone = 0, courseDone = 0, totalFailed = 0, totalDbLessons = 0, totalDbSentences = 0
  const startTime = Date.now()

  for (const pack of pending) {
    const packFile = path.join(DATA_DIR, `${pack.title.replace(/[\/?%*:|"<>]/g, "_")}.json`)
    const loaded = { packId: pack.id, title: pack.title, courses: [] }
    const doneIds = new Set()

    if (fs.existsSync(packFile)) {
      const existing = JSON.parse(fs.readFileSync(packFile, "utf-8"))
      existing.courses.forEach(c => { if (c.sentences?.length) { doneIds.add(c.id); loaded.courses.push(c) } })
    }

    const toDo = pack.courses.filter(c => !doneIds.has(c.id))
    if (toDo.length === 0) {
      // Already crawled — try DB import
      const dbRes = await importPackToDB(pack, packFile)
      if (dbRes.lessons > 0) console.log(`\n📚 ${pack.title}: 已缓存, 入库 ${dbRes.lessons}课/${dbRes.sentences}句`)
      packDone++; continue
    }

    process.stdout.write(`\n📚 [${packDone+1}/${pending.length}] ${pack.title} (${toDo.length}/${pack.courses.length})`)

    // First course: navigate fresh
    if (courseDone === 0 && toDo.length > 0) {
      const c = toDo[0]
      responseQueue = []
      try {
        await page.goto(
          `https://julebu.co/game/course/${pack.id}/${c.id}?mode=chinese_to_english&presetKey=advanced`,
          { waitUntil: "networkidle2", timeout: 30000 }
        )
        await new Promise(r => setTimeout(r, 2000))
        while (responseQueue.length > 0) {
          const j = responseQueue.shift()
          loaded.courses.push({ id: c.id, title: c.title, order: c.order, sentences: j.sentences })
          courseDone++
        }
        toDo.shift()
        process.stdout.write(`.`)
      } catch { process.stdout.write(`✗`); totalFailed++; toDo.shift() }
    }

    // Remaining courses
    for (const course of toDo) {
      responseQueue = []
      try {
        await page.goto(
          `https://julebu.co/game/course/${pack.id}/${course.id}?mode=chinese_to_english&presetKey=advanced`,
          { waitUntil: "networkidle2", timeout: 30000 }
        )
        await new Promise(r => setTimeout(r, 2000))
        let found = false
        while (responseQueue.length > 0) {
          const j = responseQueue.shift()
          loaded.courses.push({ id: course.id, title: course.title, order: course.order, sentences: j.sentences })
          courseDone++; found = true
        }
        if (!found) { totalFailed++; process.stdout.write(`✗`) } else process.stdout.write(`.`)
      } catch { totalFailed++; process.stdout.write(`✗`) }

      if (loaded.courses.length % 5 === 0) fs.writeFileSync(packFile, JSON.stringify(loaded, null, 2))
    }

    // Save file
    fs.writeFileSync(packFile, JSON.stringify(loaded, null, 2))

    // Import to database
    const dbRes = await importPackToDB(pack, packFile)
    totalDbLessons += dbRes.lessons
    totalDbSentences += dbRes.sentences

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const rate = courseDone > 0 ? Math.round(elapsed / courseDone) : 0
    packDone++
    process.stdout.write(` ✅ ${courseDone}课 ${dbRes.lessons}/${dbRes.sentences}入库 ${rate}s/课`)
  }

  await browser.close()
  if (dbPool) await dbPool.end()
  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n\n✅ 全部完成! 爬取 ${courseDone}课, 失败 ${totalFailed}, 入库 ${totalDbLessons}课/${totalDbSentences}句`)
  console.log(`   耗时 ${Math.floor(totalTime/3600)}h${Math.floor(totalTime%3600/60)}m`)
}

main().catch(e => { console.error("\nFatal:", e.message); process.exit(1) })
