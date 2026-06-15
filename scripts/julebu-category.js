/**
 * 句乐部课程包 → TypeNow 分类映射
 *
 * 用法：
 *   node scripts/julebu-category.js hide     # 隐藏非爬虫课程（is_published=0）
 *   node scripts/julebu-category.js rename   # 句乐部 → 官方（source_name）
 *   node scripts/julebu-category.js map      # 查看映射结果（不写入DB）
 *   node scripts/julebu-category.js update   # 更新已爬取课程的分类到DB
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") })
const fs = require("fs"), path = require("path")

const CATEGORY_RULES = [
  // ── 分级阅读 ──
  { match: /牛津树|牛津阅读树/i,                                    cat: "graded_reading", sub: "oxford_reading_tree" },
  { match: /RAZ|Reading[-\s]?Z/i,                                  cat: "graded_reading", sub: "raz" },
  { match: /海尼曼/i,                                               cat: "graded_reading", sub: "heinemann" },
  { match: /大猫分级|大猫阅读/i,                                    cat: "graded_reading", sub: "big_cat" },
  { match: /红火箭/i,                                               cat: "graded_reading", sub: "red_rocket" },
  { match: /Let'?s\s*Go/i,                                         cat: "graded_reading", sub: "lets_go" },
  { match: /牛津书虫|书虫分级/i,                                    cat: "graded_reading", sub: "oxford_bookworm" },
  { match: /分级阅读/i,                                             cat: "graded_reading", sub: null },
  { match: /粒粒.*Guided Reading|Guided Reading/i,                 cat: "graded_reading", sub: null },
  { match: /Little\s*Fox/i,                                        cat: "graded_reading", sub: null },
  { match: /【RE\s+F级】|Reading Explorer/i,                       cat: "graded_reading", sub: null },
  { match: /Tire Town|Big Green Forest|Bird and Kip|分级动画/i,    cat: "graded_reading", sub: null },

  // ── 中小学同步 ──
  { match: /人教版|人教PEP|人教精通|人教新起点|人教.*版|PEP.*课本/,   cat: "school_sync", sub: null },
  { match: /外研版|外研社|外研.*版|外研.*课本|外研.*同步/,          cat: "school_sync", sub: null },
  { match: /译林版|译林.*版|译林.*课本|译林.*同步/,                cat: "school_sync", sub: null },
  { match: /北师大|北师大版/,                                      cat: "school_sync", sub: null },
  { match: /鲁科|鲁教版/,                                          cat: "school_sync", sub: null },
  { match: /沪教版|沪教牛津/,                                      cat: "school_sync", sub: null },
  { match: /教科版/,                                               cat: "school_sync", sub: null },
  { match: /冀教版/,                                               cat: "school_sync", sub: null },
  { match: /科普版/,                                               cat: "school_sync", sub: null },
  { match: /闽教版/,                                               cat: "school_sync", sub: null },
  { match: /陕旅版/,                                               cat: "school_sync", sub: null },
  { match: /重庆版/,                                               cat: "school_sync", sub: null },
  { match: /粤人版/,                                               cat: "school_sync", sub: null },
  { match: /仁爱.*(七年级|八年级|九年级)/,                          cat: "school_sync", sub: null },
  { match: /新交际/,                                               cat: "school_sync", sub: null },
  { match: /全校默写/i,                                            cat: "school_sync", sub: null },
  { match: /太原.*默写/i,                                          cat: "school_sync", sub: null },
  { match: /Grade\s*7-1/i,                                        cat: "school_sync", sub: "grade_7" },
  { match: /牛津上海.*(同步|课程)/i,                                cat: "school_sync", sub: null },
  // 年级识别
  { match: /一(年|下|上|年级)/,                                    cat: "school_sync", sub: "grade_1" },
  { match: /二(年|下|上|年级)/,                                    cat: "school_sync", sub: "grade_2" },
  { match: /三(年|下|上|年级)/,                                    cat: "school_sync", sub: "grade_3" },
  { match: /四(年|下|上|年级)/,                                    cat: "school_sync", sub: "grade_4" },
  { match: /五(年|下|上|年级)/,                                    cat: "school_sync", sub: "grade_5" },
  { match: /六(年|下|上|年级)/,                                    cat: "school_sync", sub: "grade_6" },
  { match: /七(年|下|上|年级)/,                                    cat: "school_sync", sub: "grade_7" },
  { match: /八(年|下|上|年级)/,                                    cat: "school_sync", sub: "grade_8" },
  { match: /九(年|下|上|年级)/,                                    cat: "school_sync", sub: "grade_9" },
  { match: /高一|高中必修|高[中]?中?必修|必修[一二三]|高中[:：]/i,    cat: "school_sync", sub: "high_school" },
  { match: /中职|基础模块/,                                        cat: "school_sync", sub: "vocational" },
  // 泛中小学
  { match: /(小学|初中|课本同步|课文).*(单词|默写|词汇|阅读)/,       cat: "school_sync", sub: null },
  { match: /小学英语.*(单词|词汇|短语)/,                            cat: "school_sync", sub: null },
  { match: /初中.*(单词|词汇|阅读|短语)/,                            cat: "school_sync", sub: null },
  { match: /Unit\s*\d+\s+The art/i,                               cat: "school_sync", sub: null },
  { match: /幼儿.*英语|儿童.*英语|英语启蒙/i,                       cat: "school_sync", sub: "grade_1" },
  { match: /1年纪英语|一(年|下|上)/,                                cat: "school_sync", sub: "grade_1" },

  // ── 应试考试 ──
  { match: /中考/i,                                                cat: "exam_prep", sub: "zhongkao" },
  { match: /高考|高中.*词汇|高中.*单词|新课标.*高考/,                cat: "exam_prep", sub: "gaokao" },
  { match: /学位英语/,                                             cat: "exam_prep", sub: "degree_english" },
  { match: /专升本|专生本|专转本/,                                  cat: "exam_prep", sub: "zhuan_sheng_ben" },
  { match: /四级|CET.?4/i,                                        cat: "exam_prep", sub: "cet_4_6" },
  { match: /六级|CET.?6/i,                                        cat: "exam_prep", sub: "cet_4_6" },
  { match: /考研|研究生|考研英语|红宝书/i,                            cat: "exam_prep", sub: "postgraduate" },
  { match: /专四|专八|TEM.?[48]|华研.*专[四八]/i,                   cat: "exam_prep", sub: "tem_4_8" },
  { match: /雅思|IELTS/i,                                          cat: "exam_prep", sub: "ielts_toefl" },
  { match: /托福|TOEFL/i,                                          cat: "exam_prep", sub: "ielts_toefl" },
  { match: /KET/i,                                                 cat: "exam_prep", sub: "ket" },
  { match: /PET(?!E|[-\s]?Writing|.*Speaking)/i,                  cat: "exam_prep", sub: "pet" },
  { match: /FCE/i,                                                 cat: "exam_prep", sub: "fce" },
  { match: /PTE/i,                                                 cat: "exam_prep", sub: "pte" },
  { match: /GRE[^A-Z]/i,                                           cat: "exam_prep", sub: "gre" },
  { match: /托业|TOEIC/i,                                          cat: "exam_prep", sub: "toeic" },
  { match: /自考英语|英语.*二.*自学|英语二/,                          cat: "exam_prep", sub: "zhuan_sheng_ben" },
  { match: /DSE/i,                                                 cat: "exam_prep", sub: null },
  { match: /CATTI/i,                                               cat: "exam_prep", sub: null },
  { match: /IGCSE|IG经济/i,                                        cat: "exam_prep", sub: null },
  { match: /考bar|ACCA/i,                                          cat: "exam_prep", sub: null },
  { match: /考研|研究生|红宝书/i,                                   cat: "exam_prep", sub: "postgraduate" },
  // PTE task types: WFD, SST
  { match: /WFD/,                                                  cat: "exam_prep", sub: "pte" },
  { match: /SST[-:：\s]/,                                          cat: "exam_prep", sub: "pte" },
  { match: /【专升本】/,                                            cat: "exam_prep", sub: "zhuan_sheng_ben" },
  // Popular exam-prep teachers
  { match: /刘晓燕|晓艳.*(词|单词|四级)/,                            cat: "exam_prep", sub: null },

  // ── 实用英语 ──
  // 听力口语
  { match: /听力|口语|音标|发音|跟读|精听/,                          cat: "practical", sub: "listening_speaking" },
  { match: /English Pod/i,                                         cat: "practical", sub: "listening_speaking" },
  { match: /The english we speak/i,                                cat: "practical", sub: "listening_speaking" },
  { match: /Speaking Time/i,                                       cat: "practical", sub: "listening_speaking" },
  { match: /VOA|BBC.*英语|慢速英语|新闻英语/i,                       cat: "practical", sub: "listening_speaking" },
  { match: /TED[^-]|TED\s/,                                        cat: "practical", sub: "listening_speaking" },
  { match: /pike.*Listening|英语听力|精听/i,                        cat: "practical", sub: "listening_speaking" },
  { match: /英语播客|Podcast/i,                                    cat: "practical", sub: "listening_speaking" },
  { match: /Engoo.*News/i,                                         cat: "practical", sub: "listening_speaking" },
  // 经典教材
  { match: /新概念|赖世雄|走遍美国|Family Album/i,                   cat: "practical", sub: "classic_textbooks" },
  { match: /Grammar in Use|Essential Grammar/i,                    cat: "practical", sub: "classic_textbooks" },
  { match: /人人学英语|【DK】.*(英语|Level|商务|语法|入门)/i,          cat: "practical", sub: "classic_textbooks" },
  { match: /English vocabulary in use/i,                           cat: "practical", sub: "classic_textbooks" },
  { match: /Power\s*Up|power\s*up/i,                               cat: "practical", sub: "classic_textbooks" },
  { match: /新视野大学英语|新生代英语|新技能英语|基础模块/i,           cat: "practical", sub: "classic_textbooks" },
  { match: /星荣.*英语|星荣零基础/i,                                 cat: "practical", sub: "classic_textbooks" },
  { match: /游美英语|甜心英语|American textbook/i,                  cat: "practical", sub: "classic_textbooks" },
  { match: /Reading for Vocabulary/i,                              cat: "practical", sub: "classic_textbooks" },
  { match: /曹胖.*词|15000英语单词轻松背|1000词全4册/i,              cat: "practical", sub: "classic_textbooks" },
  { match: /英语动作流入门/i,                                       cat: "practical", sub: "classic_textbooks" },
  // 语法词汇
  { match: /语法|词汇|时态|动词过去式|动词过去分词|谓语动词|非谓语/i,      cat: "practical", sub: "grammar_vocab" },
  { match: /单词.*记忆|复合词|词根|词缀|词以类|速记|速.*背|单词.*记/i,    cat: "practical", sub: "grammar_vocab" },
  { match: /Wordly Wise|4000词|NGSL|常用.*单词|核心.*词汇/i,         cat: "practical", sub: "grammar_vocab" },
  { match: /Alphablocks|Phonics|自然拼读|音标|单词拼读|字母/i,       cat: "practical", sub: "grammar_vocab" },
  { match: /记完.*单词|搞定.*词|速记|记住.*单词|背单词|背.*单.*词/i,    cat: "practical", sub: "grammar_vocab" },
  { match: /【DK】.*(习语|短语|基础\d+词)/i,                         cat: "practical", sub: "grammar_vocab" },
  { match: /动词.*学会|动词.*变化|不规则.*动词/i,                    cat: "practical", sub: "grammar_vocab" },
  { match: /惊讶.*625.*单词/i,                                      cat: "practical", sub: "grammar_vocab" },
  { match: /700个ACCA|基础英语练习|全球最高频1200句/i,               cat: "practical", sub: "grammar_vocab" },
  { match: /高频句式|常用万能造句|延伸造句|.*让你记住.*单词/i,          cat: "practical", sub: "grammar_vocab" },
  // 日常口语
  { match: /日常口语|日常对话|每天.*口语|每日.*口语|日常.*句子|日常.*表达|常用.*英语|实用.*口语|日常.*英语|常用.*句|日常.*短语|常用谚语/i, cat: "practical", sub: "daily_oral" },
  { match: /美国家庭万用亲子|亲子英语/i,                             cat: "practical", sub: "daily_oral" },
  { match: /句型|情景|场景|对话.*句|表达课|造句|实用口语|日常.*练/i,   cat: "practical", sub: "daily_oral" },
  { match: /句乐部.*表达课|从.*词开始说英语|学会这些.*单词|美剧.*常用|日常.*背诵/i, cat: "practical", sub: "daily_oral" },
  { match: /向外国人一样学|学英语就是直接|零基础.*核心短句|零基础.*自学.*英语/i, cat: "practical", sub: "daily_oral" },
  { match: /How to|Stop Lying|提高.*流利|实用.*入门|入门.*词/i,        cat: "practical", sub: "daily_oral" },
  { match: /Easy English|My English|English\s*Pod/i,              cat: "practical", sub: "daily_oral" },
  { match: /实用入门单词|常用对话|日常.*对话|英语美文/i,               cat: "practical", sub: "daily_oral" },
  // 旅游英语
  { match: /旅游|出国|乘务|航空|客舱|航海|动车/i,                     cat: "practical", sub: "travel_english" },
  // 商务职场
  { match: /商务|职场|外贸|商务.*职场|商务.*英语|商务.*词汇|会议|工作英语|English at work|AMR/i, cat: "practical", sub: "business_career" },
  { match: /法律英语|医学|化工|石油|金融|数据.*结构|钻井|软件.*开发|Python|产销存|高屏厂家|SBL|IMC/i, cat: "practical", sub: "business_career" },
  // 电影与故事
  { match: /电影|故事|[Ff]ilm|[Mm]ovie|美剧|歌曲|音乐|英文歌|歌词|演唱会|BGM|原声|电台|OP曲|EP曲/i, cat: "practical", sub: "movies_stories" },
  { match: /佩奇|小谢尔顿|老友记|Young Sheldon|摩登家庭|疯狂动物城|暮光|哈利.*波特|Harry Potter|夏洛特|Charlotte|纳瓦尔|小王子|彼得兔|伊索|寻梦|白雪|童话|绘本|迪士尼|漫威|Marvel/i, cat: "practical", sub: "movies_stories" },
  { match: /Eerie Elementary|Percy Jackson|Wonder|诺丁山|Journey.*West|西游记|Sherlock|丛林|Jungle.*Book|毒液|Zoo|Bird and Kip|Big Green Forest|Tire Town|动画/i, cat: "practical", sub: "movies_stories" },
  { match: /名.*演讲|名人.*演讲|Quote|TED演讲/i,                     cat: "practical", sub: "movies_stories" },
  { match: /Taylor.*Swift|Imagine Dragons|Eminem|Let me holler|NBA|恭喜发财|当幸福来敲门|番石榴/i, cat: "practical", sub: "movies_stories" },
  { match: /经典.*英文.*歌|经典英文|英文.*歌曲|小红帽|丫米|崩坏|穹铁道|绝区零|鸣潮|羊驼|HOYO-MiX|Mili for ProjectMoon|元?素周期表|小谢尔顿|甜心/i, cat: "practical", sub: "movies_stories" },
  { match: /English\s*lyrics|英文歌词/i,                            cat: "practical", sub: "movies_stories" },
  { match: /情感语录/i,                                              cat: "practical", sub: "movies_stories" },
  // 泛实用英语
  { match: /新闻|外刊|Engoo|每日.*英语|阅读.*文章|短文|阅读|story|stories|reading|Reader/i, cat: "practical", sub: null },
  { match: /写作|作文|范文|模板|金句|翻译|写.*句子|英语论文|读后续写|读后续写表达/i, cat: "practical", sub: null },
  { match: /中国文化|中国故事|中国.*传统|许渊冲|伤寒论|心理类型|The Yellow River|Why.*Chinese/i, cat: "practical", sub: null },
  { match: /学习|练习|打卡|期末|考试.*单词|英语教程|第一组|my lesson|unit\d*$/i, cat: "practical", sub: null },
  { match: /成长与认知|情感|自我.*提升/i,                              cat: "practical", sub: null },
  { match: /UNBELIEVABLE Sports|travel guide/i,                     cat: "practical", sub: "travel_english" },
  { match: /Vlogs in English/i,                                     cat: "practical", sub: "listening_speaking" },
  { match: /PET\s*Writing/i,                                        cat: "exam_prep", sub: "pet" },
  { match: /SST$|^SST[\s-]*\d/i,                                    cat: "exam_prep", sub: "pte" },
  { match: /500基础单词常用短剧|实用！英语日常对白|实用日常对白/i,       cat: "practical", sub: "daily_oral" },
  { match: /小菜.*自学|跟着.*学英语|自学.*英语.*零基础/i,              cat: "practical", sub: "daily_oral" },
  { match: /初中\d+词按词性分|词性分|按词性分/i,                       cat: "practical", sub: "grammar_vocab" },
  { match: /2DEF|Group.*English|多邻国/i,                            cat: "practical", sub: "grammar_vocab" },
]

// SubCategory fallback: school_sync 教材版但没年级 → 根据年级关键词细分
const GRADE_RULES = [
  { match: /一(年|下|上|年级)/, sub: "grade_1" },
  { match: /二(年|下|上|年级)/, sub: "grade_2" },
  { match: /三(年|下|上|年级)/, sub: "grade_3" },
  { match: /四(年|下|上|年级)/, sub: "grade_4" },
  { match: /五(年|下|上|年级)/, sub: "grade_5" },
  { match: /六(年|下|上|年级)/, sub: "grade_6" },
  { match: /七(年|下|上|年级)/, sub: "grade_7" },
  { match: /八(年|下|上|年级)/, sub: "grade_8" },
  { match: /九(年|下|上|年级)/, sub: "grade_9" },
  { match: /高一|高中必修|高中[:：]?必修|必修[一二三]/, sub: "high_school" },
  { match: /中职|基础模块/, sub: "vocational" },
]

function classify(title) {
  const t = title.trim()

  let best = null
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(t)) {
      if (!best) {
        best = { cat: rule.cat, sub: rule.sub }
      } else if (rule.sub !== null) {
        // Prefer rules with explicit subCategory over null
        if (best.sub === null) {
          best = { cat: rule.cat, sub: rule.sub }
        }
      }
    }
  }

  if (!best) return { categoryKey: null, subCategoryKey: null }

  // For school_sync without a specific sub, try to infer from grade keywords
  if (best.cat === "school_sync" && best.sub === null) {
    for (const gr of GRADE_RULES) {
      if (gr.match.test(t)) {
        best.sub = gr.sub
        break
      }
    }
  }

  return { categoryKey: best.cat, subCategoryKey: best.sub }
}

// ── DB Operations ──

async function getDb() {
  const mysql = require("mysql2/promise")
  const url = new URL(process.env.DATABASE_URL)
  return mysql.createPool({
    host: url.hostname, port: url.port || 3306,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.replace("/", ""), connectionLimit: 3,
  })
}

async function hideNonCrawlerCourses() {
  const pool = await getDb()
  const [info] = await pool.query("SELECT COUNT(*) as cnt FROM courses WHERE (category_key IS NOT NULL AND category_key != '') AND is_published = 1")
  console.log(`\n🙈 隐藏非爬虫课程（有分类的）: ${info[0].cnt} 条`)
  if (info[0].cnt === 0) { await pool.end(); return }

  await pool.query("UPDATE courses SET is_published = 0 WHERE category_key IS NOT NULL AND category_key != ''")
  console.log("✅ 隐藏完成（is_published = 0）")
  await pool.end()
}

async function mapCategories(dryRun = true) {
  const pool = await getDb()

  const [rows] = await pool.query("SELECT id, title FROM courses WHERE (category_key IS NULL OR category_key = '') AND source_name = '句乐部'")
  console.log(`\n📊 句乐部课程总数（无分类）: ${rows.length}`)

  const stats = {}
  const classified = []
  const unclassified = []

  for (const row of rows) {
    const cls = classify(row.title)
    if (cls.categoryKey) {
      classified.push({ id: row.id, title: row.title, ...cls })
      const key = `${cls.categoryKey}/${cls.subCategoryKey || "general"}`
      stats[key] = (stats[key] || 0) + 1
    } else {
      unclassified.push({ id: row.id, title: row.title })
    }
  }

  console.log("\n📈 分类统计:")
  Object.entries(stats).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`))
  console.log(`\n❓ 未分类: ${unclassified.length}`)
  if (unclassified.length > 0) {
    console.log("  未分类课程:")
    unclassified.forEach(r => console.log(`    - ${r.title}`))
  }

  if (!dryRun) {
    for (const c of classified) {
      await pool.query("UPDATE courses SET category_key = ?, sub_category_key = ? WHERE id = ?", [c.categoryKey, c.subCategoryKey, c.id])
    }
    console.log(`\n✅ 已更新 ${classified.length} 门课程分类`)
  } else {
    console.log(`\nℹ️  试运行模式，未写入数据库。加 update 参数执行写入。`)
  }

  await pool.end()
  return { classified, unclassified }
}

async function renameSourceName() {
  const pool = await getDb()
  const [info] = await pool.query("SELECT COUNT(*) as cnt FROM courses WHERE source_name = '句乐部'")
  console.log(`\n🏷  句乐部课程: ${info[0].cnt} 条`)
  if (info[0].cnt === 0) { await pool.end(); return }

  await pool.query("UPDATE courses SET source_name = '官方' WHERE source_name = '句乐部'")
  console.log("✅ source_name: 句乐部 → 官方")
  await pool.end()
}

// ── Main ──

async function main() {
  const cmd = process.argv[2]
  if (cmd === "hide") {
    await hideNonCrawlerCourses()
  } else if (cmd === "rename") {
    await renameSourceName()
  } else if (cmd === "map") {
    await mapCategories(true)
  } else if (cmd === "update") {
    await mapCategories(false)
  } else {
    console.log("用法: node scripts/julebu-category.js hide|rename|map|update")
    console.log("  hide    隐藏非爬虫课程（is_published=0）")
    console.log("  rename  句乐部 → 官方（source_name）")
    console.log("  map     查看分类映射结果（试运行）")
    console.log("  update  执行分类更新到数据库")
  }
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1) })

module.exports = { classify }
