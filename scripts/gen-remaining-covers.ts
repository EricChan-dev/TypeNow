/**
 * 给「还没有专属图」的课程批量生成封面（智谱 CogView-3-Flash，免费）。
 *
 * 用法：
 *   npx tsx scripts/gen-remaining-covers.ts --step=state     # 选课 + 分配风格
 *   npx tsx scripts/gen-remaining-covers.ts --step=scenes    # DeepSeek 写场景描述
 *   npx tsx scripts/gen-remaining-covers.ts --step=images    # 出图（免费额度）
 *   npx tsx scripts/gen-remaining-covers.ts --step=qc        # 免费视觉模型自动质检
 *   npx tsx scripts/gen-remaining-covers.ts --step=compress  # PNG → WebP
 *   npx tsx scripts/gen-remaining-covers.ts --step=apply --apply   # 备份后写 cover_url
 *
 * ── 三条从前面几轮实测得到的硬规律 ──────────────────────────────────────────
 *
 * **1. 提示词必须短。** 给万相写的那套长结构（风格 + 场景 + 构图 + 空白约束 + 风格复述，
 * 约 290 字）在 CogView-3-Flash 上完全失效：130 字的提示词把「老师带孩子看蜗牛」
 * 画成了无关的水彩小镇，35 字的画得很准。所以这里只拼「风格 + 场景 + 画面铺满」。
 *
 * **2. 必须正向写明人种。** CogView-3-Flash 不支持负向词，不写人种它就默认出欧美人 ——
 * 实测「小学六年级：体育竞技精神」被画成两个金发外国孩子。教材同步是中文本土课程，
 * 所以在提示词里正向写「中国」。
 *
 * **3. 结尾句式会影响成功率。** 用「画面铺满全幅。」结尾比用「中景，主体占画面大部分。」
 * 稳得多：后者在 21 项里崩了 4 张（航拍村庄、人群糊成一团、画面过暗、黑白人群）。
 *
 * ── 为什么要有 qc 这一步 ────────────────────────────────────────────────────
 *
 * CogView-3-Flash 命中率约 50~65%，失败模式有：出成照片而非插画、出成无关场景
 * （霓虹夜景、水泥墙、白板、航拍）、画出可辨识的乱码文字。464 张靠人眼全看一遍不现实，
 * 所以用智谱同样免费的视觉模型（GLM-4.6V-Flash）先筛一遍，人只看被标记的和抽样。
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { config as loadEnv } from "dotenv"
import { createConnection } from "mysql2/promise"

const ROOT = path.join(__dirname, "..")
loadEnv({ path: path.join(ROOT, ".env.local") })

const STATE_FILE = path.join(ROOT, ".covers-build", "remaining-covers.json")
const PNG_DIR = path.join(ROOT, ".covers-build", "remaining")
const WEB_DIR = path.join(ROOT, "public", "images", "courses")

const cwdRequire = createRequire(path.join(ROOT, "scripts", ".resolve-anchor.cjs"))
const sharp = createRequire(cwdRequire.resolve("next/package.json"))("sharp") as typeof import("sharp")

// ─── 需求方指定的三种风格 ──────────────────────────────────────────────────
type StyleKey = "water" | "gouache" | "photo"

const STYLES: Record<StyleKey, { name: string; lead: string }> = {
  water: {
    name: "水彩手绘",
    lead: "水彩手绘插画，粗纹水彩纸质感，温暖治愈",
  },
  gouache: {
    name: "水粉厚涂",
    lead: "水粉厚涂插画，饱和柔和的笔触，纸质底纹",
  },
  photo: {
    name: "写实摄影",
    lead: "写实摄影风格，35mm 定焦镜头，柔和自然光，真实材质质感",
  },
}

const STYLE_CYCLE: StyleKey[] = ["water", "gouache", "photo"]

const CN_CATEGORIES = new Set(["school_sync", "graded_reading"])

interface Item {
  courseId: string
  title: string
  categoryKey: string | null
  style: StyleKey
  /** 教材同步/分级阅读面向国内孩子，提示词里要写明中国 */
  chinese: boolean
  scene?: string
  /** QC 结果 */
  qc?: { ok: boolean; reason: string }
}

function dbUrl(): string {
  const m = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/^DATABASE_URL=(.+)$/m)
  if (!m) throw new Error("找不到 DATABASE_URL")
  return m[1].trim()
}

function zhipuKey(): string {
  const m = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/^ZHIPU_API_KEY=(.+)$/m)
  if (!m) throw new Error("找不到 ZHIPU_API_KEY")
  return m[1].trim()
}

// ─── 选课 ──────────────────────────────────────────────────────────────────
async function stepState() {
  const conn = await createConnection(dbUrl())
  const [rows] = await conn.query(
    `SELECT id, title, category_key, learner_count
       FROM courses
      WHERE is_published = 1 AND (cover_url IS NULL OR cover_url = '')
      ORDER BY learner_count DESC`,
  )
  await conn.end()
  const list = rows as { id: string; title: string; category_key: string | null; learner_count: number }[]

  const items: Item[] = list.map((c, i) => ({
    courseId: c.id,
    title: c.title,
    categoryKey: c.category_key,
    style: STYLE_CYCLE[i % STYLE_CYCLE.length],
    chinese: CN_CATEGORIES.has(c.category_key ?? ""),
  }))

  // 保留已有场景与 QC 结果（脚本可反复跑）
  if (fs.existsSync(STATE_FILE)) {
    const old: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    const byId = new Map(old.map((o) => [o.courseId, o]))
    for (const it of items) {
      const o = byId.get(it.courseId)
      if (o?.scene) it.scene = o.scene
      if (o?.qc) it.qc = o.qc
    }
  }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))

  const byStyle = new Map<string, number>()
  for (const it of items) byStyle.set(it.style, (byStyle.get(it.style) ?? 0) + 1)
  console.log(`[state] 待生成 ${items.length} 门（无 cover_url 的在架课程）`)
  console.log(`  风格分配: ${[...byStyle.entries()].map(([k, v]) => `${STYLES[k as StyleKey].name}=${v}`).join("  ")}`)
  console.log(`  需写「中国」: ${items.filter((i) => i.chinese).length} 门（教材同步 / 分级阅读）`)
  console.log(`  已有场景: ${items.filter((i) => i.scene).length}`)
}

// ─── 场景描述 ──────────────────────────────────────────────────────────────
const SCENE_SYSTEM = `你是英语课程封面插画的分镜师。为给定的英语课程写一句画面描述（中文，15~30字），供 AI 生成封面插画。

必须遵守：
1. 只描述可视的场景，不要提课程名里的单词、字母、书名、知识点名称
2. 禁止「有人正在使用文字载体」的动作：不要在黑板/白板上写字或讲解、不要用单词卡片、不要翻词典内页、不要做试卷、不要记笔记
3. 纸张、书本、白板、屏幕、积木只能写「合上的」「收起的」或「空白的」
4. **避免出现教室、黑板、白板、屏幕** —— 实测只要场景是教室，模型就会补一块写满乱码的黑板上去
5. 人物 1~3 个，要有明确动作（交谈、倾听、手指着、递给、抬头看、并肩走…）
6. 场景要贴合课程主题
7. 不要用抽象比喻，不要出现品牌、商标、真人姓名
8. **严格遵守每门课后面括号里的「出镜人物」要求**

只输出 JSON 数组，不要解释、不要代码块标记：[{"id":"课程id","scene":"画面描述"}]`

const RISKY = ["写字", "书写", "板书", "白板上", "黑板上", "教室", "卡片", "试卷", "练习册", "记笔记", "单词", "字母", "积木", "方块"]

async function deepseek(batch: Item[]): Promise<Map<string, string>> {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) throw new Error("找不到 DEEPSEEK_API_KEY")
  const user = batch
    .map(
      (b) =>
        `- id=${b.courseId}｜课程名：${b.title}｜出镜人物：${
          b.chinese ? "中国学生或中国年轻人（务必写明「中国」）" : "与课程主题相称的人，1~3 个"
        }`,
    )
    .join("\n")
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-flash",
      temperature: 0.95,
      messages: [
        { role: "system", content: SCENE_SYSTEM },
        { role: "user", content: `为下面 ${batch.length} 门课各写一句画面描述：\n${user}` },
      ],
    }),
  })
  const json: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`)
  const text: string = json?.choices?.[0]?.message?.content ?? ""
  const s = text.indexOf("[")
  const e = text.lastIndexOf("]")
  if (s < 0 || e < 0) throw new Error("模型未返回 JSON 数组")
  const arr = JSON.parse(text.slice(s, e + 1)) as { id: string; scene: string }[]
  const known = new Set(batch.map((b) => b.courseId))
  const map = new Map<string, string>()
  let unknown = 0
  for (const x of arr) {
    if (!x.id || !x.scene) continue
    if (RISKY.some((w) => x.scene.includes(w))) continue
    if (!known.has(x.id)) {
      unknown++
      continue
    }
    map.set(x.id, x.scene)
  }
  // 全军覆没通常意味着 id 对不上，而不是模型答错了 —— 直接抛出让上层重试并暴露出来
  if (map.size === 0) throw new Error(`本批 0 条可用（回传 id 无法匹配 ${unknown} 条）`)
  return map
}

async function stepScenes() {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const todo = items.filter((i) => !i.scene)
  console.log(`[scenes] 需要生成 ${todo.length} 条`)
  const BATCH = 10
  let done = 0
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const map = await deepseek(batch)
        for (const it of batch) {
          const sc = map.get(it.courseId)
          if (sc) it.scene = sc
        }
        break
      } catch (err) {
        if (attempt === 3) console.log(`  ✗ 第 ${Math.floor(i / BATCH) + 1} 批放弃：${err instanceof Error ? err.message : err}`)
      }
    }
    done += batch.length
    fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))
    process.stdout.write(`\r  进度 ${Math.min(done, todo.length)}/${todo.length}`)
  }
  console.log()
  console.log(`[scenes] 就绪 ${items.filter((i) => i.scene).length}/${items.length}`)
}

// ─── 出图 ──────────────────────────────────────────────────────────────────
async function genOne(item: Item): Promise<Buffer> {
  // 短提示词 —— 这是这门模型能遵循场景的前提（长提示词会整段丢失）
  const cn = item.chinese ? "中国" : ""
  const prompt = `${STYLES[item.style].lead}。${cn}${item.scene}。画面铺满全幅。`
  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${zhipuKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "cogview-3-flash", prompt, size: "1248x832", watermark_enabled: false }),
  })
  const json: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`)
  const url = json?.data?.[0]?.url
  if (!url) throw new Error(`响应无图片：${JSON.stringify(json).slice(0, 200)}`)
  return Buffer.from(await (await fetch(url)).arrayBuffer())
}

async function stepImages() {
  fs.mkdirSync(PNG_DIR, { recursive: true })
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const missing = items.filter((i) => !i.scene)
  if (missing.length) throw new Error(`还有 ${missing.length} 门没有场景描述，先跑 --step=scenes`)

  const todo = items.filter((i) => !fs.existsSync(path.join(PNG_DIR, `${i.courseId}.bin`)))
  console.log(`[images] 共 ${items.length} 张，本次生成 ${todo.length} 张（智谱免费额度）`)

  let ok = 0
  let consecutive = 0
  for (let i = 0; i < todo.length; i++) {
    const it = todo[i]
    try {
      const buf = await genOne(it)
      fs.writeFileSync(path.join(PNG_DIR, `${it.courseId}.bin`), buf)
      ok++
      consecutive = 0
      process.stdout.write(`\r  ${i + 1}/${todo.length}  成功 ${ok}  ${it.title.slice(0, 22).padEnd(24)}`)
    } catch (err) {
      consecutive++
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err)
      console.log(`\n  ✗ ${it.title.slice(0, 20)}: ${msg}`)
      // 额度类错误直接停，别把剩下几百张各失败一遍
      if (/quota|额度|balance|Arrearage|too many|rate/i.test(msg)) {
        console.log("\n[images] 判定为额度/限流问题，终止（已生成的保留，可续跑）")
        break
      }
      if (consecutive >= 8) {
        console.log("\n[images] 连续失败 8 次，终止")
        break
      }
    }
  }
  console.log(`\n[images] 成功 ${ok}，累计 ${items.filter((i) => fs.existsSync(path.join(PNG_DIR, `${i.courseId}.bin`))).length}/${items.length}`)
}

// ─── 自动质检（用同样免费的视觉模型）────────────────────────────────────────
const QC_SYSTEM = `你是插画质检员。给定一张课程封面图和它应该表现的内容，判断这张图能不能用。

判为不可用（回答 NO）的情况，只要命中任一条：
1. 画面内容与描述明显不符（比如描述「孩子们在操场跑步」，图上却是城市夜景、空房间、水泥墙）
2. 画面里出现**可辨识的文字**（汉字、英文字母、单词），尤其是乱码般的假字
3. 画面风格明显是照片而描述要求的是插画，或反之
4. 画面里没有人物，但描述要求有人物
5. 画面严重模糊、糊成一团、或主体被裁掉

回答 YES 的情况：内容基本相符、没有可辨识文字、风格一致、主体完整。
允许小瑕疵：水彩签名般的淡痕、背景里不可辨认的横线、轻微的手部不自然。

只输出 JSON：{"ok":true或false,"reason":"一句话说明，中文，20字以内"}`

async function stepQc() {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const todo = items.filter((i) => i.scene && fs.existsSync(path.join(PNG_DIR, `${i.courseId}.bin`)) && !i.qc)
  console.log(`[qc] 待质检 ${todo.length} 张`)
  let okCount = 0
  let badCount = 0
  for (let i = 0; i < todo.length; i++) {
    const it = todo[i]
    try {
      const b64 = fs.readFileSync(path.join(PNG_DIR, `${it.courseId}.bin`)).toString("base64")
      const res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${zhipuKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "glm-4.6v-flash",
          messages: [
            { role: "system", content: QC_SYSTEM },
            {
              role: "user",
              content: [
                { type: "text", text: `应表现的内容：${it.scene}\n要求的风格：${STYLES[it.style].name}` },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
              ],
            },
          ],
        }),
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(json).slice(0, 160)}`)
      const text: string = json?.choices?.[0]?.message?.content ?? ""
      const s = text.indexOf("{")
      const e = text.lastIndexOf("}")
      const parsed = s >= 0 && e >= 0 ? JSON.parse(text.slice(s, e + 1)) : null
      if (!parsed || typeof parsed.ok !== "boolean") throw new Error(`无法解析：${text.slice(0, 100)}`)
      it.qc = { ok: parsed.ok, reason: String(parsed.reason ?? "").slice(0, 40) }
      parsed.ok ? okCount++ : badCount++
      if (!parsed.ok) console.log(`\n  ✗ ${it.title.slice(0, 22)} — ${it.qc.reason}`)
    } catch (err) {
      // 质检失败不阻塞，保持未质检状态，下次重跑
      if (/rate|too many|quota|额度/i.test(err instanceof Error ? err.message : "")) {
        console.log(`\n[qc] 限流，已质检 ${okCount + badCount} 张后暂停（可续跑）`)
        break
      }
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(items, null, 2))
    process.stdout.write(`\r  质检 ${i + 1}/${todo.length}  通过 ${okCount}  标记 ${badCount}`)
  }
  console.log()
  const all = items.filter((i) => i.qc)
  console.log(`[qc] 已质检 ${all.length}；通过 ${all.filter((i) => i.qc!.ok).length}，标记重做 ${all.filter((i) => !i.qc!.ok).length}`)
}

async function stepCompress() {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  let ok = 0
  for (const it of items) {
    const bin = path.join(PNG_DIR, `${it.courseId}.bin`)
    if (!fs.existsSync(bin)) continue
    // 质检标记为不可用的不落盘，等重做
    if (it.qc && !it.qc.ok) continue
    const buf = await sharp(bin).webp({ quality: 80, effort: 5 }).toBuffer()
    fs.writeFileSync(path.join(WEB_DIR, `${it.courseId}.webp`), buf)
    ok++
  }
  console.log(`[compress] 转码 ${ok}/${items.length}（跳过质检未通过与未生成的）`)
}

async function stepApply(apply: boolean) {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const ready = items.filter((i) => fs.existsSync(path.join(WEB_DIR, `${i.courseId}.webp`)))
  console.log(`将写入 ${ready.length} 行 cover_url`)
  if (!apply) {
    console.log("（dry-run）加 --apply 写库")
    return
  }
  const url = new URL(dbUrl())
  const backupDir = path.join(ROOT, "db-backup")
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)
  const backup = path.join(backupDir, `courses-before-remaining-${stamp}.sql`)
  const dump = execFileSync(
    "mysqldump",
    [
      "-h", url.hostname, "-P", url.port || "3306",
      "-u", decodeURIComponent(url.username), `-p${decodeURIComponent(url.password)}`,
      "--single-transaction", "--no-tablespaces", "--skip-add-locks",
      url.pathname.replace(/^\//, ""), "courses",
    ],
    { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024 },
  )
  fs.writeFileSync(backup, dump)
  const rows = (dump.toString("utf8").match(/\),\n?\(/g) ?? []).length + 1
  console.log(`[backup] ${(dump.length / 1024).toFixed(0)}KB，行数约 ${rows} → ${path.relative(ROOT, backup)}`)
  if (dump.length < 10_000 || rows < 700) throw new Error("备份疑似残缺，已中止")

  const conn = await createConnection(dbUrl())
  await conn.beginTransaction()
  try {
    for (const it of ready) {
      await conn.execute("UPDATE courses SET cover_url = ? WHERE id = ?", [`/images/courses/${it.courseId}.webp`, it.courseId])
    }
    await conn.commit()
    console.log(`[apply] 已写入 ${ready.length} 行`)
  } catch (e) {
    await conn.rollback()
    throw e
  }
  const [[check]]: any = await conn.execute(
    "SELECT COUNT(*) total, SUM(cover_url IS NOT NULL AND cover_url <> '') with_cover FROM courses WHERE is_published = 1",
  )
  console.log(`[verify] 在架 ${check.total}，已有 cover_url ${check.with_cover}`)
  await conn.end()
}

async function stepReport() {
  const items: Item[] = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  const gen = items.filter((i) => fs.existsSync(path.join(PNG_DIR, `${i.courseId}.bin`)))
  const qc = items.filter((i) => i.qc)
  const webp = items.filter((i) => fs.existsSync(path.join(WEB_DIR, `${i.courseId}.webp`)))
  console.log(`[report] 计划 ${items.length}`)
  console.log(`  场景就绪 : ${items.filter((i) => i.scene).length}`)
  console.log(`  已出图   : ${gen.length}`)
  console.log(`  已质检   : ${qc.length}（通过 ${qc.filter((i) => i.qc!.ok).length}，标记 ${qc.filter((i) => !i.qc!.ok).length}）`)
  console.log(`  成品 WebP: ${webp.length}`)
}

async function main() {
  const step = process.argv.find((a) => a.startsWith("--step="))?.slice(7) ?? "state"
  switch (step) {
    case "state": await stepState(); break
    case "scenes": await stepScenes(); break
    case "images": await stepImages(); break
    case "qc": await stepQc(); break
    case "compress": await stepCompress(); break
    case "apply": await stepApply(process.argv.includes("--apply")); break
    case "report": await stepReport(); break
    default:
      console.error(`未知 --step=${step}（state | scenes | images | qc | compress | apply | report）`)
      process.exit(1)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1) })
