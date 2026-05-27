#!/usr/bin/env tsx
/**
 * Seed script: generates courses for all sub-categories via AI
 * Run: pnpm seed
 *
 * Key design:
 * - db/index.ts reads DATABASE_URL at init time, so we create our own pool here AFTER dotenv
 * - llm.ts reads DEEPSEEK_API_KEY at call time, so static import is fine
 * - Schema module is pure type defs, safe to import statically
 * - Processes 3 courses concurrently to balance speed vs API rate limits
 * - Skips courses that already exist by (title + sub_category_key)
 */

import { config } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"
import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"
import { and, eq } from "drizzle-orm"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env.local BEFORE any code that uses process.env
config({ path: join(__dirname, "..", ".env.local") })

// Now import things that read env at call time (not import time)
import { courses, lessons, sentences } from "../src/lib/db/schema"
import { llmCall } from "../src/lib/llm"

// ─── DB setup (AFTER env is loaded) ───────────────────────────────────────────
const pool = mysql.createPool(process.env.DATABASE_URL!)
const db = drizzle(pool, { schema: { courses, lessons, sentences }, mode: "default" })

// ─── Types ────────────────────────────────────────────────────────────────────
interface CourseDef {
  title: string
  description: string
  learningGoal: string
  categoryKey: string
  subCategoryKey: string
  coverSeed: string  // used for picsum.photos/seed/{coverSeed}/640/360
}

interface AiLesson {
  title: string
  summary: string
  sentences: { english: string; chinese: string }[]
}

// ─── Cover image helper ───────────────────────────────────────────────────────
function coverUrl(seed: string): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/640/360`
}

// ─── AI content generation ────────────────────────────────────────────────────
async function generateCourseContent(course: CourseDef): Promise<AiLesson[]> {
  const prompt = `你是英语打字练习课程设计专家。请为以下英语学习课程生成完整的练习内容。

课程名称：${course.title}
课程说明：${course.description}
学习目标：${course.learningGoal}

生成要求：
- 生成 5~6 个章节（Lesson），每章围绕一个清晰主题
- 每章生成 6~8 个完整英文句子，适合打字练习（句子地道、完整）
- 每章提供简洁标题和1句中文概括
- 句子难度与课程定位匹配

只输出 JSON，不要任何解释，格式：
{"lessons":[{"title":"...","summary":"...","sentences":[{"english":"...","chinese":"..."}]}]}`

  const raw = await llmCall({
    systemPrompt: "你是英语教学内容设计专家，专门为打字练习课程创作高质量英文句子。",
    userMessage: prompt,
    temperature: 0.5,
  })

  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`AI returned no JSON for course: ${course.title}`)
  const result: { lessons: AiLesson[] } = JSON.parse(match[0])
  if (!Array.isArray(result.lessons) || result.lessons.length === 0) {
    throw new Error(`AI returned empty lessons for: ${course.title}`)
  }
  return result.lessons
}

// ─── DB write ─────────────────────────────────────────────────────────────────
async function seedCourse(course: CourseDef): Promise<void> {
  // Skip if already exists
  const existing = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.title, course.title), eq(courses.subCategoryKey, course.subCategoryKey)))
    .limit(1)

  if (existing.length > 0) {
    console.log(`  ⏭  skipping (exists): ${course.title}`)
    return
  }

  console.log(`  ⏳ generating: ${course.title}`)
  const aiLessons = await generateCourseContent(course)

  // Insert course
  const courseId = randomUUID()
  await db.insert(courses).values({
    id: courseId,
    title: course.title,
    description: course.description,
    coverUrl: coverUrl(course.coverSeed),
    categoryKey: course.categoryKey,
    subCategoryKey: course.subCategoryKey,
    sourceName: "官方",
    isPublished: 1,
  })

  // Insert lessons + sentences
  for (let li = 0; li < aiLessons.length; li++) {
    const lesson = aiLessons[li]
    const lessonId = randomUUID()
    await db.insert(lessons).values({
      id: lessonId,
      courseId,
      title: lesson.title,
      summary: lesson.summary ?? "",
      sortOrder: li,
    })

    for (let si = 0; si < lesson.sentences.length; si++) {
      const s = lesson.sentences[si]
      await db.insert(sentences).values({
        id: randomUUID(),
        english: s.english,
        chinese: s.chinese,
        lessonId,
        sortOrder: si,
      })
    }
  }

  const totalSentences = aiLessons.reduce((sum, l) => sum + l.sentences.length, 0)
  console.log(`  ✓  created: ${course.title} (${aiLessons.length} lessons, ${totalSentences} sentences)`)
}

// ─── Course definitions ───────────────────────────────────────────────────────
const COURSES: CourseDef[] = [
  // ── 分级阅读 > 牛津树 ──────────────────────────────────────────────────
  {
    title: "牛津树：Biff和Chip的日常故事",
    description: "牛津阅读树经典系列，围绕Biff、Chip和Kipper一家的日常生活展开，适合初级英语学习者。",
    learningGoal: "掌握日常家庭场景词汇，学习简单对话句型",
    categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree",
    coverSeed: "oxford-tree-family",
  },
  {
    title: "牛津树：魔法钥匙大冒险",
    description: "魔法钥匙系列，孩子们通过神奇的钥匙穿越到不同时空，展开精彩冒险。",
    learningGoal: "学习冒险故事场景词汇，练习过去时态叙述",
    categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree",
    coverSeed: "oxford-magic-key",
  },
  {
    title: "牛津树：学校和朋友",
    description: "以学校生活为背景的牛津树故事，涵盖课堂、操场、午餐等场景。",
    learningGoal: "掌握学校场景词汇与简单社交用语",
    categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree",
    coverSeed: "oxford-school-friends",
  },
  {
    title: "牛津树：节日与庆典",
    description: "围绕圣诞节、万圣节、生日等英语国家节日的精彩故事集。",
    learningGoal: "了解英国文化节日，学习节日相关词汇与表达",
    categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree",
    coverSeed: "oxford-festivals",
  },
  {
    title: "牛津树：动物与自然",
    description: "以动物和自然为主题的牛津树故事，培养孩子对自然的热爱。",
    learningGoal: "学习动植物名称与自然环境描述",
    categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree",
    coverSeed: "oxford-animals-nature",
  },

  // ── 分级阅读 > RAZ ──────────────────────────────────────────────────────
  {
    title: "RAZ Levels A-C：萌芽读者入门",
    description: "RAZ最低级别系列，用超简单句型和大量重复帮助零基础读者建立信心。",
    learningGoal: "建立基础词汇认知，学会短句朗读与跟打",
    categoryKey: "graded_reading", subCategoryKey: "raz",
    coverSeed: "raz-emergent-reader",
  },
  {
    title: "RAZ Levels D-F：早期阅读训练",
    description: "RAZ早期阅读系列，内容涵盖家庭、动物、食物等熟悉主题。",
    learningGoal: "扩展基础词汇量，练习简单陈述句与疑问句",
    categoryKey: "graded_reading", subCategoryKey: "raz",
    coverSeed: "raz-early-reader",
  },
  {
    title: "RAZ Levels G-J：成长中的读者",
    description: "RAZ过渡级别读物，故事情节更丰富，句子结构更多样。",
    learningGoal: "学习复合句和从句基础，扩大词汇量",
    categoryKey: "graded_reading", subCategoryKey: "raz",
    coverSeed: "raz-transitional",
  },
  {
    title: "RAZ 科学主题读物",
    description: "RAZ非虚构科学系列，涵盖生物、地球科学、物理等基础概念。",
    learningGoal: "学习科学词汇，练习说明文句型",
    categoryKey: "graded_reading", subCategoryKey: "raz",
    coverSeed: "raz-science-stories",
  },
  {
    title: "RAZ Levels K-M：流畅阅读提升",
    description: "RAZ流畅读物系列，故事复杂度提升，适合有一定基础的学习者。",
    learningGoal: "提升阅读流畅度，掌握更复杂的叙述句型",
    categoryKey: "graded_reading", subCategoryKey: "raz",
    coverSeed: "raz-fluency-builder",
  },

  // ── 分级阅读 > 海尼曼 ──────────────────────────────────────────────────
  {
    title: "海尼曼 PM Starters：起步阅读",
    description: "海尼曼PM系列入门读物，用简单重复的句子帮助学习者建立阅读基础。",
    learningGoal: "建立基础阅读自信，认识高频词",
    categoryKey: "graded_reading", subCategoryKey: "heinemann",
    coverSeed: "heinemann-starters",
  },
  {
    title: "海尼曼：我们的世界",
    description: "海尼曼非虚构系列，介绍世界各地的地理、文化和人文知识。",
    learningGoal: "学习地理与文化词汇，练习描述性语言",
    categoryKey: "graded_reading", subCategoryKey: "heinemann",
    coverSeed: "heinemann-our-world",
  },
  {
    title: "海尼曼：自然探秘",
    description: "海尼曼自然科学系列，探索动植物、天气和地球的奥秘。",
    learningGoal: "学习自然科学词汇，掌握解释性文本句型",
    categoryKey: "graded_reading", subCategoryKey: "heinemann",
    coverSeed: "heinemann-nature",
  },
  {
    title: "海尼曼：日常事物",
    description: "以日常生活中的事物为主题，内容贴近学习者的生活经验。",
    learningGoal: "掌握日常生活词汇，练习描述物体的句子",
    categoryKey: "graded_reading", subCategoryKey: "heinemann",
    coverSeed: "heinemann-everyday",
  },
  {
    title: "海尼曼：人物与地方",
    description: "介绍不同职业、社区和地点的海尼曼系列读物。",
    learningGoal: "学习职业与地点词汇，练习介绍性句型",
    categoryKey: "graded_reading", subCategoryKey: "heinemann",
    coverSeed: "heinemann-people-places",
  },

  // ── 分级阅读 > 大猫 ────────────────────────────────────────────────────
  {
    title: "大猫分级：Band 1-2 自然拼读入门",
    description: "大猫分级阅读最低阶，结合自然拼读帮助学习者建立字母和发音基础。",
    learningGoal: "掌握自然拼读规则，建立基础词汇",
    categoryKey: "graded_reading", subCategoryKey: "big_cat",
    coverSeed: "big-cat-phonics",
  },
  {
    title: "大猫分级：Band 3-4 信心建立",
    description: "大猫中低级读物，故事情节简单有趣，词汇量逐步增加。",
    learningGoal: "扩展词汇量，练习简单叙述句",
    categoryKey: "graded_reading", subCategoryKey: "big_cat",
    coverSeed: "big-cat-early",
  },
  {
    title: "大猫分级：非虚构系列",
    description: "大猫非虚构读物，涵盖科学、历史和社会主题，培养学术阅读能力。",
    learningGoal: "学习非虚构文体写作，掌握说明文句型",
    categoryKey: "graded_reading", subCategoryKey: "big_cat",
    coverSeed: "big-cat-nonfiction",
  },
  {
    title: "大猫分级：Band 5-6 提升阶段",
    description: "大猫中级读物，故事更丰富，对话更自然，适合有一定基础的学习者。",
    learningGoal: "提升阅读理解能力，学习对话句型",
    categoryKey: "graded_reading", subCategoryKey: "big_cat",
    coverSeed: "big-cat-building",
  },
  {
    title: "大猫分级：诗歌与韵文",
    description: "大猫诗歌系列，用押韵、节奏帮助学习者感受英语语言的韵律美。",
    learningGoal: "感受英语节奏与韵律，练习朗读与记忆",
    categoryKey: "graded_reading", subCategoryKey: "big_cat",
    coverSeed: "big-cat-poetry",
  },

  // ── 分级阅读 > 红火箭 ──────────────────────────────────────────────────
  {
    title: "红火箭：萌芽级别",
    description: "红火箭最低级别读物，用极简单的句子和重复模式帮助零基础学习者。",
    learningGoal: "建立最基础的英文阅读能力，认识常见词",
    categoryKey: "graded_reading", subCategoryKey: "red_rocket",
    coverSeed: "red-rocket-emergent",
  },
  {
    title: "红火箭：早期阅读系列",
    description: "红火箭早期读物，涵盖家庭、学校、游戏等亲切场景。",
    learningGoal: "扩展常用词汇，练习简单句描述",
    categoryKey: "graded_reading", subCategoryKey: "red_rocket",
    coverSeed: "red-rocket-early",
  },
  {
    title: "红火箭：流畅阅读训练",
    description: "红火箭中级读物，故事内容丰富，帮助学习者进入流畅阅读阶段。",
    learningGoal: "提升阅读速度与流畅度，掌握复杂句型",
    categoryKey: "graded_reading", subCategoryKey: "red_rocket",
    coverSeed: "red-rocket-fluency",
  },
  {
    title: "红火箭：非虚构科学A辑",
    description: "红火箭非虚构科学系列A辑，涵盖动物、植物和环境主题。",
    learningGoal: "学习科学词汇，练习说明性句型",
    categoryKey: "graded_reading", subCategoryKey: "red_rocket",
    coverSeed: "red-rocket-science-a",
  },
  {
    title: "红火箭：非虚构社会B辑",
    description: "红火箭非虚构社会系列B辑，介绍职业、社区和世界文化。",
    learningGoal: "学习社会科学词汇，了解多元文化",
    categoryKey: "graded_reading", subCategoryKey: "red_rocket",
    coverSeed: "red-rocket-social",
  },

  // ── 分级阅读 > Let's Go ─────────────────────────────────────────────────
  {
    title: "Let's Go 1：你好！英语世界",
    description: "Let's Go第一册，从问候、颜色、数字开始，轻松进入英语世界。",
    learningGoal: "掌握基础问候语、颜色和数字词汇",
    categoryKey: "graded_reading", subCategoryKey: "lets_go",
    coverSeed: "lets-go-1-hello",
  },
  {
    title: "Let's Go 2：我的家庭和家",
    description: "Let's Go第二册，围绕家庭成员和家居场景展开学习。",
    learningGoal: "学习家庭成员词汇，练习描述家庭的句子",
    categoryKey: "graded_reading", subCategoryKey: "lets_go",
    coverSeed: "lets-go-2-family",
  },
  {
    title: "Let's Go 3：学校与课外活动",
    description: "Let's Go第三册，涵盖学校科目、课外活动和兴趣爱好。",
    learningGoal: "学习学校和活动词汇，练习表达喜好",
    categoryKey: "graded_reading", subCategoryKey: "lets_go",
    coverSeed: "lets-go-3-school",
  },
  {
    title: "Let's Go 4：自然与动物",
    description: "Let's Go第四册，探索自然界的动植物和季节变化。",
    learningGoal: "学习自然和动物词汇，练习描述季节",
    categoryKey: "graded_reading", subCategoryKey: "lets_go",
    coverSeed: "lets-go-4-nature",
  },
  {
    title: "Let's Go：拼音歌谣与歌曲",
    description: "Let's Go配套歌谣与歌曲练习，用韵律帮助学习者记忆词汇和句型。",
    learningGoal: "通过歌曲强化词汇记忆，培养语感",
    categoryKey: "graded_reading", subCategoryKey: "lets_go",
    coverSeed: "lets-go-songs",
  },

  // ── 分级阅读 > 牛津书虫 ────────────────────────────────────────────────
  {
    title: "牛津书虫 Starter：经典故事入门",
    description: "牛津书虫入门级改编名著，用简单英语讲述世界经典故事。",
    learningGoal: "阅读简化版经典文学，建立文学阅读兴趣",
    categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm",
    coverSeed: "bookworms-starter",
  },
  {
    title: "牛津书虫 Level 1：初级经典",
    description: "牛津书虫1级，包含《弗兰肯斯坦》《动物庄园》等改编作品。",
    learningGoal: "掌握初级文学词汇，理解叙事结构",
    categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm",
    coverSeed: "bookworms-level1",
  },
  {
    title: "牛津书虫 Level 2：文学经典",
    description: "牛津书虫2级，改编自简·奥斯丁、狄更斯等作家的经典作品。",
    learningGoal: "学习文学描写手法，提升阅读理解能力",
    categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm",
    coverSeed: "bookworms-level2",
  },
  {
    title: "牛津书虫 Level 3：中级文学",
    description: "牛津书虫3级，进入更复杂的文学世界，词汇量和句型难度提升。",
    learningGoal: "掌握中级文学词汇，理解复杂叙事",
    categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm",
    coverSeed: "bookworms-level3",
  },
  {
    title: "牛津书虫 Level 4：名著精读",
    description: "牛津书虫4级，包含世界顶级文学名著的改编版本。",
    learningGoal: "深入理解英语文学，掌握高级叙述句型",
    categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm",
    coverSeed: "bookworms-level4",
  },

  // ── 中小学同步 > 一年级 ────────────────────────────────────────────────
  {
    title: "小学一年级：你好！认识一下",
    description: "一年级英语起步，学习最基础的问候语和自我介绍，配合人教版教材。",
    learningGoal: "学会打招呼、介绍自己的名字和年龄",
    categoryKey: "school_sync", subCategoryKey: "grade_1",
    coverSeed: "grade1-greetings",
  },
  {
    title: "小学一年级：颜色、数字与形状",
    description: "一年级颜色、数字1-10和基本形状的英语学习。",
    learningGoal: "认识颜色单词、数字1-10和基本形状",
    categoryKey: "school_sync", subCategoryKey: "grade_1",
    coverSeed: "grade1-colors-numbers",
  },
  {
    title: "小学一年级：学习用品大集合",
    description: "围绕书包、铅笔、橡皮等学习用品的一年级英语词汇课。",
    learningGoal: "掌握常见学习用品的英语名称",
    categoryKey: "school_sync", subCategoryKey: "grade_1",
    coverSeed: "grade1-school-items",
  },
  {
    title: "小学一年级：我的家人",
    description: "介绍家庭成员：爸爸、妈妈、爷爷、奶奶等，配合简单对话练习。",
    learningGoal: "学会用英语介绍家庭成员",
    categoryKey: "school_sync", subCategoryKey: "grade_1",
    coverSeed: "grade1-family",
  },
  {
    title: "小学一年级：身体部位与动作",
    description: "学习头、手、脚等身体部位，配合简单动作指令练习。",
    learningGoal: "认识身体部位词汇，理解简单指令",
    categoryKey: "school_sync", subCategoryKey: "grade_1",
    coverSeed: "grade1-body-actions",
  },

  // ── 中小学同步 > 二年级 ────────────────────────────────────────────────
  {
    title: "小学二年级：农场里的动物",
    description: "认识牛、羊、马等农场动物，学习动物的叫声和习性表达。",
    learningGoal: "掌握常见农场动物词汇和简单描述句",
    categoryKey: "school_sync", subCategoryKey: "grade_2",
    coverSeed: "grade2-farm-animals",
  },
  {
    title: "小学二年级：美食与饮料",
    description: "学习各种食物和饮料的英语名称，练习点餐和表达喜好。",
    learningGoal: "学会用英语说出喜欢和不喜欢的食物",
    categoryKey: "school_sync", subCategoryKey: "grade_2",
    coverSeed: "grade2-food-drinks",
  },
  {
    title: "小学二年级：衣服与四季",
    description: "认识各种衣物名称，结合四季变化学习穿衣搭配表达。",
    learningGoal: "掌握衣物词汇，学会描述季节和穿着",
    categoryKey: "school_sync", subCategoryKey: "grade_2",
    coverSeed: "grade2-clothes-seasons",
  },
  {
    title: "小学二年级：我的家和房间",
    description: "介绍客厅、卧室、厨房等家居场景，学习位置介词。",
    learningGoal: "掌握家居词汇，学会描述物品位置",
    categoryKey: "school_sync", subCategoryKey: "grade_2",
    coverSeed: "grade2-home-rooms",
  },
  {
    title: "小学二年级：一天的生活",
    description: "从早晨起床到晚上睡觉，学习描述日常作息的英语表达。",
    learningGoal: "学会用英语描述日常作息时间",
    categoryKey: "school_sync", subCategoryKey: "grade_2",
    coverSeed: "grade2-daily-routine",
  },

  // ── 中小学同步 > 三年级 ────────────────────────────────────────────────
  {
    title: "小学三年级：我住在哪里",
    description: "学习城市、乡村、街道等地点词汇，练习描述居住环境。",
    learningGoal: "学会描述居住地点和环境",
    categoryKey: "school_sync", subCategoryKey: "grade_3",
    coverSeed: "grade3-where-i-live",
  },
  {
    title: "小学三年级：购物与金钱",
    description: "学习购物场景词汇，练习询问价格、表达数量的句型。",
    learningGoal: "掌握购物对话，学会用英语购物",
    categoryKey: "school_sync", subCategoryKey: "grade_3",
    coverSeed: "grade3-shopping",
  },
  {
    title: "小学三年级：运动与爱好",
    description: "介绍各类体育运动和课外爱好，学习频率副词的使用。",
    learningGoal: "学会表达运动爱好和频率",
    categoryKey: "school_sync", subCategoryKey: "grade_3",
    coverSeed: "grade3-sports-hobbies",
  },
  {
    title: "小学三年级：天气与自然",
    description: "学习晴天、下雨、下雪等天气词汇，练习天气描述句型。",
    learningGoal: "掌握天气词汇，学会询问和描述天气",
    categoryKey: "school_sync", subCategoryKey: "grade_3",
    coverSeed: "grade3-weather",
  },
  {
    title: "小学三年级：交通与出行",
    description: "学习各种交通工具，练习问路、描述路线的表达。",
    learningGoal: "掌握交通词汇，学会基本问路对话",
    categoryKey: "school_sync", subCategoryKey: "grade_3",
    coverSeed: "grade3-transport",
  },

  // ── 中小学同步 > 四年级 ────────────────────────────────────────────────
  {
    title: "小学四年级：我的学校生活",
    description: "介绍学校各学科、课程安排和校园活动，提升学校场景表达能力。",
    learningGoal: "流利描述学校生活和课程安排",
    categoryKey: "school_sync", subCategoryKey: "grade_4",
    coverSeed: "grade4-school-life",
  },
  {
    title: "小学四年级：各行各业",
    description: "认识医生、老师、消防员等职业，学习用英语描述职业和工作。",
    learningGoal: "掌握常见职业词汇，学会简单职业描述",
    categoryKey: "school_sync", subCategoryKey: "grade_4",
    coverSeed: "grade4-jobs",
  },
  {
    title: "小学四年级：健康生活",
    description: "学习身体健康、锻炼和饮食均衡等主题，培养健康生活理念。",
    learningGoal: "学会表达健康生活方式和给出健康建议",
    categoryKey: "school_sync", subCategoryKey: "grade_4",
    coverSeed: "grade4-healthy-living",
  },
  {
    title: "小学四年级：世界节日文化",
    description: "了解圣诞节、感恩节、元旦等节日的起源和庆祝方式。",
    learningGoal: "了解英语国家节日文化，学习节日相关表达",
    categoryKey: "school_sync", subCategoryKey: "grade_4",
    coverSeed: "grade4-festivals",
  },
  {
    title: "小学四年级：科技与日常生活",
    description: "了解手机、电脑、互联网等现代科技词汇和基本使用描述。",
    learningGoal: "掌握现代科技基本词汇，学会描述日常科技使用",
    categoryKey: "school_sync", subCategoryKey: "grade_4",
    coverSeed: "grade4-technology",
  },

  // ── 中小学同步 > 五年级 ────────────────────────────────────────────────
  {
    title: "小学五年级：保护环境",
    description: "学习环保主题词汇，讨论垃圾分类、节约资源、保护动物等议题。",
    learningGoal: "学会用英语讨论环保话题，表达环保观点",
    categoryKey: "school_sync", subCategoryKey: "grade_5",
    coverSeed: "grade5-environment",
  },
  {
    title: "小学五年级：日常生活中的科学",
    description: "用英语探索水、光、声音等日常科学现象，培养科学思维。",
    learningGoal: "学习基础科学词汇，练习解释日常现象",
    categoryKey: "school_sync", subCategoryKey: "grade_5",
    coverSeed: "grade5-science",
  },
  {
    title: "小学五年级：历史与文化",
    description: "了解长城、故宫等中国文化遗产，学习向外国朋友介绍中国文化。",
    learningGoal: "学会用英语介绍中国历史文化",
    categoryKey: "school_sync", subCategoryKey: "grade_5",
    coverSeed: "grade5-history-culture",
  },
  {
    title: "小学五年级：描述人物外貌与性格",
    description: "学习描述人物外貌特征和性格特点的词汇与句型。",
    learningGoal: "掌握人物描述词汇，能用英语描写人物",
    categoryKey: "school_sync", subCategoryKey: "grade_5",
    coverSeed: "grade5-describing-people",
  },
  {
    title: "小学五年级：寓言与童话故事",
    description: "学习《狐狸与乌鸦》《三只小猪》等经典故事，提升叙事能力。",
    learningGoal: "学习故事叙述句型，掌握故事类词汇",
    categoryKey: "school_sync", subCategoryKey: "grade_5",
    coverSeed: "grade5-fables",
  },

  // ── 中小学同步 > 六年级 ────────────────────────────────────────────────
  {
    title: "小学六年级：未来的梦想",
    description: "讨论理想职业、未来计划，学习表达愿望和目标的句型。",
    learningGoal: "学会用英语表达梦想和未来计划",
    categoryKey: "school_sync", subCategoryKey: "grade_6",
    coverSeed: "grade6-future-dreams",
  },
  {
    title: "小学六年级：全球视野",
    description: "了解世界各国的文化差异、国旗、首都等基础地理知识。",
    learningGoal: "拓展英语国际视野，学习地理相关词汇",
    categoryKey: "school_sync", subCategoryKey: "grade_6",
    coverSeed: "grade6-global-issues",
  },
  {
    title: "小学六年级：艺术与娱乐",
    description: "介绍音乐、绘画、电影等艺术形式，学习表达艺术欣赏的语言。",
    learningGoal: "学会用英语讨论艺术和娱乐活动",
    categoryKey: "school_sync", subCategoryKey: "grade_6",
    coverSeed: "grade6-arts",
  },
  {
    title: "小学六年级：体育竞技精神",
    description: "围绕奥运会、世界杯等体育赛事，学习体育竞技相关词汇。",
    learningGoal: "掌握体育竞技词汇，学习运动精神表达",
    categoryKey: "school_sync", subCategoryKey: "grade_6",
    coverSeed: "grade6-sports",
  },
  {
    title: "小学六年级：阅读理解综合练习",
    description: "六年级英语阅读提升，涵盖记叙文、说明文等多种文体。",
    learningGoal: "提升综合阅读理解能力，为初中做准备",
    categoryKey: "school_sync", subCategoryKey: "grade_6",
    coverSeed: "grade6-reading",
  },

  // ── 中小学同步 > 七年级 ────────────────────────────────────────────────
  {
    title: "七年级英语：初中英语起航",
    description: "初一上册核心内容，完成小学到初中的英语过渡。",
    learningGoal: "巩固小学词汇，掌握初中英语基础句型",
    categoryKey: "school_sync", subCategoryKey: "grade_7",
    coverSeed: "grade7-start",
  },
  {
    title: "七年级英语：环游世界",
    description: "学习世界各大洲、主要国家和城市，练习旅行和地理描述。",
    learningGoal: "掌握地理词汇，学会描述国家和地点",
    categoryKey: "school_sync", subCategoryKey: "grade_7",
    coverSeed: "grade7-around-world",
  },
  {
    title: "七年级英语：社交场景英语",
    description: "涵盖邀请朋友、打电话、写信等日常社交场景的英语表达。",
    learningGoal: "掌握社交场景中常用的英语表达",
    categoryKey: "school_sync", subCategoryKey: "grade_7",
    coverSeed: "grade7-social",
  },
  {
    title: "七年级英语：生物与健康",
    description: "学习人体系统、健康饮食等生物健康主题的英语词汇。",
    learningGoal: "掌握基础生物与健康词汇",
    categoryKey: "school_sync", subCategoryKey: "grade_7",
    coverSeed: "grade7-biology",
  },
  {
    title: "七年级英语：英雄与榜样",
    description: "讲述历史英雄和现代榜样的故事，学习评价和描述人物的表达。",
    learningGoal: "学会用英语评价和描述名人事迹",
    categoryKey: "school_sync", subCategoryKey: "grade_7",
    coverSeed: "grade7-heroes",
  },

  // ── 中小学同步 > 八年级 ────────────────────────────────────────────────
  {
    title: "八年级英语：科学史上的发现",
    description: "讲述牛顿、爱因斯坦等科学家的重要发现，学习科学叙述文体。",
    learningGoal: "学习科学词汇，掌握过去时叙述句型",
    categoryKey: "school_sync", subCategoryKey: "grade_8",
    coverSeed: "grade8-science-history",
  },
  {
    title: "八年级英语：环境保护行动",
    description: "深入讨论气候变化、垃圾问题等环保议题，学习议论文表达。",
    learningGoal: "学会用英语表达环保观点和提出建议",
    categoryKey: "school_sync", subCategoryKey: "grade_8",
    coverSeed: "grade8-environment",
  },
  {
    title: "八年级英语：数字化生活",
    description: "探讨社交媒体、网络安全、在线学习等现代数字生活话题。",
    learningGoal: "掌握数字化生活相关词汇，学会讨论科技利弊",
    categoryKey: "school_sync", subCategoryKey: "grade_8",
    coverSeed: "grade8-digital",
  },
  {
    title: "八年级英语：文化交流",
    description: "探讨中西方文化差异，学习文化包容与交流的相关表达。",
    learningGoal: "学会用英语讨论文化异同，提升跨文化意识",
    categoryKey: "school_sync", subCategoryKey: "grade_8",
    coverSeed: "grade8-culture",
  },
  {
    title: "八年级英语：文学欣赏入门",
    description: "阅读简单的英语诗歌和短篇故事，培养文学审美能力。",
    learningGoal: "初步理解英语文学，学习文学鉴赏词汇",
    categoryKey: "school_sync", subCategoryKey: "grade_8",
    coverSeed: "grade8-literature",
  },

  // ── 中小学同步 > 九年级 ────────────────────────────────────────────────
  {
    title: "九年级英语：社会与价值观",
    description: "讨论诚信、责任、公平等社会价值观话题，提升思辨能力。",
    learningGoal: "学会用英语讨论社会价值观，表达个人观点",
    categoryKey: "school_sync", subCategoryKey: "grade_9",
    coverSeed: "grade9-society",
  },
  {
    title: "九年级英语：职业规划",
    description: "探讨职业选择、技能培养和人生规划，为高中和未来做准备。",
    learningGoal: "学会用英语讨论职业和人生规划",
    categoryKey: "school_sync", subCategoryKey: "grade_9",
    coverSeed: "grade9-career",
  },
  {
    title: "九年级英语：世界历史纵览",
    description: "了解世界重要历史事件，学习历史叙述和分析的英语表达。",
    learningGoal: "掌握历史词汇，学会用英语叙述历史事件",
    categoryKey: "school_sync", subCategoryKey: "grade_9",
    coverSeed: "grade9-history",
  },
  {
    title: "九年级英语：复杂文本阅读",
    description: "练习理解和分析长篇复杂文本，为中考阅读做充分准备。",
    learningGoal: "提升复杂文本阅读理解能力",
    categoryKey: "school_sync", subCategoryKey: "grade_9",
    coverSeed: "grade9-reading",
  },
  {
    title: "九年级英语：中考全面冲刺",
    description: "系统梳理初中三年英语核心知识，全面冲刺中考。",
    learningGoal: "全面复习初中英语，提升中考得分能力",
    categoryKey: "school_sync", subCategoryKey: "grade_9",
    coverSeed: "grade9-review",
  },

  // ── 中小学同步 > 高中 ──────────────────────────────────────────────────
  {
    title: "高中英语：自我与社会",
    description: "高中必修1核心内容，探讨个人成长、家庭关系和社会责任。",
    learningGoal: "掌握高中英语必修词汇，提升书面表达能力",
    categoryKey: "school_sync", subCategoryKey: "high_school",
    coverSeed: "highschool-self-society",
  },
  {
    title: "高中英语：自然与科技",
    description: "高中必修2核心内容，涵盖生物多样性、科技发展等主题。",
    learningGoal: "学习自然科学词汇，掌握学术英语写作基础",
    categoryKey: "school_sync", subCategoryKey: "high_school",
    coverSeed: "highschool-nature-science",
  },
  {
    title: "高中英语：文学与文化",
    description: "高中选修文学课内容，阅读英美文学经典片段，提升人文素养。",
    learningGoal: "提升文学鉴赏能力，丰富英语表达的文学性",
    categoryKey: "school_sync", subCategoryKey: "high_school",
    coverSeed: "highschool-literature",
  },
  {
    title: "高中英语：阅读理解强化",
    description: "针对高考阅读理解题型的专项训练，涵盖各类文章体裁。",
    learningGoal: "提升高考阅读理解正确率",
    categoryKey: "school_sync", subCategoryKey: "high_school",
    coverSeed: "highschool-reading",
  },
  {
    title: "高中英语：写作与表达",
    description: "高考英语写作专项，包括应用文、图表作文等各类写作题型。",
    learningGoal: "掌握高考写作模板，提升书面表达分数",
    categoryKey: "school_sync", subCategoryKey: "high_school",
    coverSeed: "highschool-writing",
  },

  // ── 中小学同步 > 中职英语 ─────────────────────────────────────────────
  {
    title: "中职英语：职场沟通基础",
    description: "针对中职生的职场英语入门，涵盖工作场合的日常沟通。",
    learningGoal: "掌握职场基础沟通表达",
    categoryKey: "school_sync", subCategoryKey: "vocational",
    coverSeed: "vocational-workplace",
  },
  {
    title: "中职英语：服务行业英语",
    description: "针对餐饮、酒店、零售等服务行业的实用英语培训。",
    learningGoal: "掌握服务行业常用英语对话",
    categoryKey: "school_sync", subCategoryKey: "vocational",
    coverSeed: "vocational-service",
  },
  {
    title: "中职英语：技术文档阅读",
    description: "学习阅读产品说明书、技术规格等英语技术文档。",
    learningGoal: "能够阅读和理解基础英语技术文档",
    categoryKey: "school_sync", subCategoryKey: "vocational",
    coverSeed: "vocational-technical",
  },
  {
    title: "中职英语：商务信函写作",
    description: "学习撰写英语商务邮件、请假条、申请书等商务文体。",
    learningGoal: "掌握基础商务英语写作格式和表达",
    categoryKey: "school_sync", subCategoryKey: "vocational",
    coverSeed: "vocational-business-letters",
  },
  {
    title: "中职英语：面试与求职",
    description: "专为职业求职准备的英语训练，包括简历写作和面试对话。",
    learningGoal: "能用英语完成基本的求职面试",
    categoryKey: "school_sync", subCategoryKey: "vocational",
    coverSeed: "vocational-job-interview",
  },

  // ── 应试考试 > 中考 ────────────────────────────────────────────────────
  {
    title: "中考英语：词汇1600精讲",
    description: "系统梳理中考英语核心词汇1600个，附例句和记忆技巧。",
    learningGoal: "掌握中考必考词汇，提升词汇运用能力",
    categoryKey: "exam_prep", subCategoryKey: "zhongkao",
    coverSeed: "zhongkao-vocab",
  },
  {
    title: "中考英语：阅读理解精练",
    description: "针对中考阅读理解题型的专项训练，涵盖记叙文、说明文等文体。",
    learningGoal: "掌握中考阅读题解题技巧，提升正确率",
    categoryKey: "exam_prep", subCategoryKey: "zhongkao",
    coverSeed: "zhongkao-reading",
  },
  {
    title: "中考英语：写作常用句型",
    description: "中考书面表达必备句型汇总，覆盖各类作文话题。",
    learningGoal: "掌握中考写作高分句型，提升写作得分",
    categoryKey: "exam_prep", subCategoryKey: "zhongkao",
    coverSeed: "zhongkao-writing",
  },
  {
    title: "中考英语：完形填空技巧",
    description: "系统讲解完形填空的解题策略，配合真题练习。",
    learningGoal: "掌握完形填空答题技巧，提升准确率",
    categoryKey: "exam_prep", subCategoryKey: "zhongkao",
    coverSeed: "zhongkao-cloze",
  },
  {
    title: "中考英语：真题模拟训练",
    description: "精选历年中考英语真题，全面模拟中考考试场景。",
    learningGoal: "熟悉中考题型和难度，提升应试能力",
    categoryKey: "exam_prep", subCategoryKey: "zhongkao",
    coverSeed: "zhongkao-mock",
  },

  // ── 应试考试 > 高考 ────────────────────────────────────────────────────
  {
    title: "高考英语：核心词汇3500",
    description: "覆盖高考英语大纲全部3500词，配合例句和语境记忆。",
    learningGoal: "系统掌握高考英语词汇，提升词汇运用能力",
    categoryKey: "exam_prep", subCategoryKey: "gaokao",
    coverSeed: "gaokao-vocab",
  },
  {
    title: "高考英语：阅读高频话题",
    description: "精讲高考阅读理解的高频话题文章，掌握阅读答题策略。",
    learningGoal: "熟悉高考阅读常见话题，提升阅读速度和准确率",
    categoryKey: "exam_prep", subCategoryKey: "gaokao",
    coverSeed: "gaokao-reading",
  },
  {
    title: "高考英语：完形填空专训",
    description: "系统训练高考完形填空，覆盖记叙文、说明文等各类文体。",
    learningGoal: "掌握高考完形填空解题思路和技巧",
    categoryKey: "exam_prep", subCategoryKey: "gaokao",
    coverSeed: "gaokao-cloze",
  },
  {
    title: "高考英语：书面表达模板",
    description: "高考应用文和话题作文的高分模板和万能句式汇总。",
    learningGoal: "掌握高考写作模板，快速写出高分作文",
    categoryKey: "exam_prep", subCategoryKey: "gaokao",
    coverSeed: "gaokao-writing",
  },
  {
    title: "高考英语：听力专项训练",
    description: "针对高考英语听力部分的专项训练，包含各类题型和材料。",
    learningGoal: "提升高考英语听力理解能力和得分",
    categoryKey: "exam_prep", subCategoryKey: "gaokao",
    coverSeed: "gaokao-listening",
  },

  // ── 应试考试 > 学位英语 ────────────────────────────────────────────────
  {
    title: "学位英语：阅读理解专项",
    description: "针对学士学位英语考试的阅读理解专项训练。",
    learningGoal: "掌握学位英语阅读题型和答题技巧",
    categoryKey: "exam_prep", subCategoryKey: "degree_english",
    coverSeed: "degree-reading",
  },
  {
    title: "学位英语：完形填空与语法",
    description: "学位英语完形填空和语法结构题的专项突破训练。",
    learningGoal: "提升完形填空和语法题的正确率",
    categoryKey: "exam_prep", subCategoryKey: "degree_english",
    coverSeed: "degree-cloze-grammar",
  },
  {
    title: "学位英语：翻译技巧精讲",
    description: "系统讲解英译汉和汉译英的翻译方法和技巧。",
    learningGoal: "掌握学位英语翻译题的解题方法",
    categoryKey: "exam_prep", subCategoryKey: "degree_english",
    coverSeed: "degree-translation",
  },
  {
    title: "学位英语：写作范文精析",
    description: "精选学位英语写作高分范文，分析写作结构和表达技巧。",
    learningGoal: "提升学位英语写作得分",
    categoryKey: "exam_prep", subCategoryKey: "degree_english",
    coverSeed: "degree-writing",
  },
  {
    title: "学位英语：真题全真模拟",
    description: "历年学位英语真题精讲，全面备考。",
    learningGoal: "熟悉学位英语考试题型，提升综合成绩",
    categoryKey: "exam_prep", subCategoryKey: "degree_english",
    coverSeed: "degree-mock",
  },

  // ── 应试考试 > 专升本 ──────────────────────────────────────────────────
  {
    title: "专升本英语：高频词汇突破",
    description: "专升本英语必考词汇系统梳理，配合记忆技巧。",
    learningGoal: "掌握专升本高频词汇，提升词汇题得分",
    categoryKey: "exam_prep", subCategoryKey: "zhuan_sheng_ben",
    coverSeed: "zsb-vocab",
  },
  {
    title: "专升本英语：阅读与理解",
    description: "针对专升本阅读理解题型的专项突破训练。",
    learningGoal: "提升专升本阅读理解题正确率",
    categoryKey: "exam_prep", subCategoryKey: "zhuan_sheng_ben",
    coverSeed: "zsb-reading",
  },
  {
    title: "专升本英语：语法精讲",
    description: "专升本必考语法知识点全面梳理，配合大量例句练习。",
    learningGoal: "掌握专升本核心语法，提升语法题得分",
    categoryKey: "exam_prep", subCategoryKey: "zhuan_sheng_ben",
    coverSeed: "zsb-grammar",
  },
  {
    title: "专升本英语：写作专项",
    description: "专升本英语写作的题型分析和高分策略。",
    learningGoal: "掌握专升本写作模板，快速拿分",
    categoryKey: "exam_prep", subCategoryKey: "zhuan_sheng_ben",
    coverSeed: "zsb-writing",
  },
  {
    title: "专升本英语：综合模拟冲刺",
    description: "专升本英语综合模拟练习，全面检验备考成果。",
    learningGoal: "提升专升本综合应试能力",
    categoryKey: "exam_prep", subCategoryKey: "zhuan_sheng_ben",
    coverSeed: "zsb-mock",
  },

  // ── 应试考试 > 四六级 ──────────────────────────────────────────────────
  {
    title: "四六级英语：核心词汇4500",
    description: "CET-4/6必考词汇系统梳理，附语境例句和词根记忆法。",
    learningGoal: "系统掌握四六级词汇，提升词汇运用能力",
    categoryKey: "exam_prep", subCategoryKey: "cet_4_6",
    coverSeed: "cet-vocab",
  },
  {
    title: "四六级英语：阅读理解精讲",
    description: "四六级阅读理解题型全解析，包括仔细阅读和长篇阅读。",
    learningGoal: "掌握四六级阅读答题技巧，提升正确率",
    categoryKey: "exam_prep", subCategoryKey: "cet_4_6",
    coverSeed: "cet-reading",
  },
  {
    title: "四六级英语：翻译能力提升",
    description: "四六级段落翻译专项训练，覆盖中国文化、社会等高频主题。",
    learningGoal: "提升四六级翻译得分，掌握翻译技巧",
    categoryKey: "exam_prep", subCategoryKey: "cet_4_6",
    coverSeed: "cet-translation",
  },
  {
    title: "四六级英语：写作必备句式",
    description: "四六级写作高分句型汇总，涵盖议论文、问题解决型等文体。",
    learningGoal: "掌握四六级写作高分句式，提升写作得分",
    categoryKey: "exam_prep", subCategoryKey: "cet_4_6",
    coverSeed: "cet-writing",
  },
  {
    title: "四六级英语：听力强化训练",
    description: "四六级听力理解专项训练，包含短对话、长对话和讲座类题型。",
    learningGoal: "提升四六级听力理解能力和得分",
    categoryKey: "exam_prep", subCategoryKey: "cet_4_6",
    coverSeed: "cet-listening",
  },

  // ── 应试考试 > 考研 ────────────────────────────────────────────────────
  {
    title: "考研英语：阅读精读精讲",
    description: "考研英语一/二阅读理解核心篇章精讲，培养深度阅读能力。",
    learningGoal: "掌握考研阅读解题策略，提升得分",
    categoryKey: "exam_prep", subCategoryKey: "postgraduate",
    coverSeed: "postgrad-reading",
  },
  {
    title: "考研英语：长难句深度剖析",
    description: "系统训练考研英语长难句的分析和理解，突破阅读瓶颈。",
    learningGoal: "攻克考研长难句，提升文本理解能力",
    categoryKey: "exam_prep", subCategoryKey: "postgraduate",
    coverSeed: "postgrad-sentences",
  },
  {
    title: "考研英语：大作文写作",
    description: "考研英语大作文全题型训练，掌握图表作文、话题作文写法。",
    learningGoal: "提升考研写作得分，掌握高分写作技巧",
    categoryKey: "exam_prep", subCategoryKey: "postgraduate",
    coverSeed: "postgrad-writing",
  },
  {
    title: "考研英语：翻译专项突破",
    description: "考研英语翻译题专项训练，掌握直译、意译和文化转换技巧。",
    learningGoal: "提升考研翻译准确性和表达流畅度",
    categoryKey: "exam_prep", subCategoryKey: "postgraduate",
    coverSeed: "postgrad-translation",
  },
  {
    title: "考研英语：新题型完全指南",
    description: "考研英语新题型（信息匹配、段落排序等）的系统训练。",
    learningGoal: "掌握考研新题型解题方法，稳拿新题型分数",
    categoryKey: "exam_prep", subCategoryKey: "postgraduate",
    coverSeed: "postgrad-new-types",
  },

  // ── 应试考试 > 专四专八 ────────────────────────────────────────────────
  {
    title: "专四英语：词汇与语法精讲",
    description: "英语专业四级词汇和语法知识点全面梳理与强化训练。",
    learningGoal: "掌握专四词汇和语法考点，提升得分",
    categoryKey: "exam_prep", subCategoryKey: "tem_4_8",
    coverSeed: "tem4-vocab-grammar",
  },
  {
    title: "专四英语：阅读与完形",
    description: "英语专业四级阅读理解和完形填空的专项突破训练。",
    learningGoal: "提升专四阅读和完形得分",
    categoryKey: "exam_prep", subCategoryKey: "tem_4_8",
    coverSeed: "tem4-reading",
  },
  {
    title: "专八英语：阅读理解深度训练",
    description: "英语专业八级高难度阅读理解训练，含学术文章和时评文章。",
    learningGoal: "提升专八阅读理解能力，突破阅读难关",
    categoryKey: "exam_prep", subCategoryKey: "tem_4_8",
    coverSeed: "tem8-reading",
  },
  {
    title: "专八英语：人文知识背景",
    description: "专八英语人文知识题的系统梳理，涵盖英美文学、历史、文化等。",
    learningGoal: "掌握专八人文知识考点，提升综合素养",
    categoryKey: "exam_prep", subCategoryKey: "tem_4_8",
    coverSeed: "tem8-humanities",
  },
  {
    title: "专八英语：写作与翻译",
    description: "专八英语写作和翻译的技巧讲解与大量练习。",
    learningGoal: "提升专八写作和翻译的综合能力",
    categoryKey: "exam_prep", subCategoryKey: "tem_4_8",
    coverSeed: "tem8-writing-translation",
  },

  // ── 应试考试 > 雅思托福 ────────────────────────────────────────────────
  {
    title: "雅思学术类：阅读技巧精讲",
    description: "IELTS Academic阅读三种题型的系统训练，掌握快速阅读技巧。",
    learningGoal: "提升雅思阅读得分至6.5+",
    categoryKey: "exam_prep", subCategoryKey: "ielts_toefl",
    coverSeed: "ielts-reading",
  },
  {
    title: "雅思通用类：热门话题词汇",
    description: "雅思考试高频话题词汇汇总，涵盖教育、环境、科技等主题。",
    learningGoal: "掌握雅思高频话题词汇，提升口语和写作表达",
    categoryKey: "exam_prep", subCategoryKey: "ielts_toefl",
    coverSeed: "ielts-topics",
  },
  {
    title: "托福阅读：学术文章精读",
    description: "TOEFL阅读学术文章精讲，涵盖自然科学、社会科学等学科。",
    learningGoal: "提升托福阅读理解能力，目标25+",
    categoryKey: "exam_prep", subCategoryKey: "ielts_toefl",
    coverSeed: "toefl-reading",
  },
  {
    title: "雅思托福：写作高分Task 2",
    description: "雅思Task 2和托福写作的高分策略和优质范文分析。",
    learningGoal: "提升雅思/托福写作评分",
    categoryKey: "exam_prep", subCategoryKey: "ielts_toefl",
    coverSeed: "ielts-toefl-writing",
  },
  {
    title: "雅思：口语流利度训练",
    description: "针对雅思口语Part 1-3的系统训练，提升表达流利度和自然度。",
    learningGoal: "提升雅思口语流利度，目标7.0+",
    categoryKey: "exam_prep", subCategoryKey: "ielts_toefl",
    coverSeed: "ielts-speaking",
  },

  // ── 应试考试 > KET ─────────────────────────────────────────────────────
  {
    title: "KET词汇基础：1500核心词",
    description: "剑桥英语KET考试必备词汇系统学习，配合生活场景例句。",
    learningGoal: "掌握KET考试词汇，建立基础词汇量",
    categoryKey: "exam_prep", subCategoryKey: "ket",
    coverSeed: "ket-vocab",
  },
  {
    title: "KET阅读与书写",
    description: "KET考试阅读与书写题型的专项训练，涵盖各类题目形式。",
    learningGoal: "熟悉KET阅读和书写题型，提升得分",
    categoryKey: "exam_prep", subCategoryKey: "ket",
    coverSeed: "ket-reading-writing",
  },
  {
    title: "KET听力理解练习",
    description: "KET考试听力部分专项训练，包括选图题、填空题等。",
    learningGoal: "提升KET听力理解能力，通过听力部分",
    categoryKey: "exam_prep", subCategoryKey: "ket",
    coverSeed: "ket-listening",
  },
  {
    title: "KET口语备考",
    description: "KET口语考试的备考训练，包括对话和描述图片。",
    learningGoal: "做好KET口语考试准备，自信作答",
    categoryKey: "exam_prep", subCategoryKey: "ket",
    coverSeed: "ket-speaking",
  },
  {
    title: "KET全真模拟冲刺",
    description: "KET考试全真模拟练习，全面检验备考水平。",
    learningGoal: "熟悉KET考试节奏，通过正式考试",
    categoryKey: "exam_prep", subCategoryKey: "ket",
    coverSeed: "ket-mock",
  },

  // ── 应试考试 > PET ─────────────────────────────────────────────────────
  {
    title: "PET词汇进阶：2500核心词",
    description: "剑桥英语PET考试词汇系统学习，比KET难度提升一个档次。",
    learningGoal: "掌握PET考试必备词汇",
    categoryKey: "exam_prep", subCategoryKey: "pet",
    coverSeed: "pet-vocab",
  },
  {
    title: "PET阅读策略提升",
    description: "PET考试阅读题型专项训练，掌握各类阅读技巧。",
    learningGoal: "提升PET阅读部分得分",
    categoryKey: "exam_prep", subCategoryKey: "pet",
    coverSeed: "pet-reading",
  },
  {
    title: "PET写作技能训练",
    description: "PET考试书写部分专项训练，包括短文写作和邮件写作。",
    learningGoal: "掌握PET写作题型，提升写作分数",
    categoryKey: "exam_prep", subCategoryKey: "pet",
    coverSeed: "pet-writing",
  },
  {
    title: "PET口语表达练习",
    description: "PET考试口语部分专项训练，提升英语口语自信。",
    learningGoal: "提升PET口语表达流利度",
    categoryKey: "exam_prep", subCategoryKey: "pet",
    coverSeed: "pet-speaking",
  },
  {
    title: "PET综合备考全攻略",
    description: "PET考试四个部分的综合备考，全面提升应试能力。",
    learningGoal: "系统备考PET，通过正式考试",
    categoryKey: "exam_prep", subCategoryKey: "pet",
    coverSeed: "pet-complete",
  },

  // ── 应试考试 > FCE ─────────────────────────────────────────────────────
  {
    title: "FCE英语运用：词汇与语法",
    description: "FCE考试Use of English部分专项训练，词汇和语法综合提升。",
    learningGoal: "掌握FCE英语运用题型，提升词汇语法能力",
    categoryKey: "exam_prep", subCategoryKey: "fce",
    coverSeed: "fce-use-of-english",
  },
  {
    title: "FCE阅读深度精讲",
    description: "FCE考试阅读部分专项训练，涵盖各类文体阅读题型。",
    learningGoal: "提升FCE阅读得分和阅读速度",
    categoryKey: "exam_prep", subCategoryKey: "fce",
    coverSeed: "fce-reading",
  },
  {
    title: "FCE写作高分课程",
    description: "FCE考试写作专项，掌握文章写作和邮件写作的高分技巧。",
    learningGoal: "提升FCE写作得分，达到B2水平",
    categoryKey: "exam_prep", subCategoryKey: "fce",
    coverSeed: "fce-writing",
  },
  {
    title: "FCE口语流利提升",
    description: "FCE考试口语部分专项训练，提升互动交流和话题描述能力。",
    learningGoal: "提升FCE口语流利度和准确性",
    categoryKey: "exam_prep", subCategoryKey: "fce",
    coverSeed: "fce-speaking",
  },
  {
    title: "FCE综合模拟测试",
    description: "FCE考试全科模拟练习，模拟真实考试环境进行综合训练。",
    learningGoal: "熟悉FCE考试节奏，通过正式考试",
    categoryKey: "exam_prep", subCategoryKey: "fce",
    coverSeed: "fce-mock",
  },

  // ── 应试考试 > PTE ─────────────────────────────────────────────────────
  {
    title: "PTE学术英语：阅读专项",
    description: "PTE Academic阅读部分专项训练，掌握多项选择、拖拽排序等题型。",
    learningGoal: "提升PTE阅读模块得分",
    categoryKey: "exam_prep", subCategoryKey: "pte",
    coverSeed: "pte-reading",
  },
  {
    title: "PTE学术英语：听力专项",
    description: "PTE Academic听力部分专项训练，提升听力理解和记录能力。",
    learningGoal: "提升PTE听力模块得分",
    categoryKey: "exam_prep", subCategoryKey: "pte",
    coverSeed: "pte-listening",
  },
  {
    title: "PTE学术英语：写作专项",
    description: "PTE Academic写作部分专项训练，包括摘要写作和议论文写作。",
    learningGoal: "提升PTE写作模块得分",
    categoryKey: "exam_prep", subCategoryKey: "pte",
    coverSeed: "pte-writing",
  },
  {
    title: "PTE学术英语：口语专项",
    description: "PTE Academic口语部分专项训练，包括复述短文、描述图片等。",
    learningGoal: "提升PTE口语模块得分",
    categoryKey: "exam_prep", subCategoryKey: "pte",
    coverSeed: "pte-speaking",
  },
  {
    title: "PTE评分策略全解",
    description: "深入了解PTE自动评分系统的逻辑，优化答题策略。",
    learningGoal: "了解PTE评分机制，最大化各模块得分",
    categoryKey: "exam_prep", subCategoryKey: "pte",
    coverSeed: "pte-scoring",
  },

  // ── 应试考试 > GRE ─────────────────────────────────────────────────────
  {
    title: "GRE词汇：高频3000词精讲",
    description: "GRE考试高频词汇系统学习，配合词根词缀记忆法和语境例句。",
    learningGoal: "掌握GRE高频词汇，提升语文推理得分",
    categoryKey: "exam_prep", subCategoryKey: "gre",
    coverSeed: "gre-vocab",
  },
  {
    title: "GRE阅读理解深度训练",
    description: "GRE语文推理阅读部分专项训练，掌握学术文章分析技巧。",
    learningGoal: "提升GRE阅读理解能力，达到目标分数",
    categoryKey: "exam_prep", subCategoryKey: "gre",
    coverSeed: "gre-reading",
  },
  {
    title: "GRE分析性写作",
    description: "GRE Analytical Writing两种题型的系统训练，提升论证写作能力。",
    learningGoal: "提升GRE写作评分，目标4.5+",
    categoryKey: "exam_prep", subCategoryKey: "gre",
    coverSeed: "gre-writing",
  },
  {
    title: "GRE语文推理精讲",
    description: "GRE语文推理题型全面解析，包括填空题、等价题等。",
    learningGoal: "掌握GRE语文推理各题型解法",
    categoryKey: "exam_prep", subCategoryKey: "gre",
    coverSeed: "gre-verbal",
  },
  {
    title: "GRE数量推理：文字题训练",
    description: "GRE数量推理中的文字题和应用题，提升数学英语阅读能力。",
    learningGoal: "提升GRE数量推理中的英语理解能力",
    categoryKey: "exam_prep", subCategoryKey: "gre",
    coverSeed: "gre-quant",
  },

  // ── 应试考试 > 托业 ────────────────────────────────────────────────────
  {
    title: "托业TOEIC：语法与词汇",
    description: "TOEIC Part 5-6语法和词汇题专项训练，系统梳理考点。",
    learningGoal: "提升TOEIC语法和词汇题正确率",
    categoryKey: "exam_prep", subCategoryKey: "toeic",
    coverSeed: "toeic-grammar-vocab",
  },
  {
    title: "托业TOEIC：阅读理解",
    description: "TOEIC Part 7单篇和多篇文章阅读理解专项训练。",
    learningGoal: "提升TOEIC阅读理解得分",
    categoryKey: "exam_prep", subCategoryKey: "toeic",
    coverSeed: "toeic-reading",
  },
  {
    title: "托业TOEIC：商务词汇600",
    description: "TOEIC高频商务词汇系统学习，涵盖人力资源、财务、营销等场景。",
    learningGoal: "掌握TOEIC必备商务词汇",
    categoryKey: "exam_prep", subCategoryKey: "toeic",
    coverSeed: "toeic-business-vocab",
  },
  {
    title: "托业TOEIC：听力原文精讲",
    description: "TOEIC听力部分原文解析和训练，提升听力理解能力。",
    learningGoal: "提升TOEIC听力得分",
    categoryKey: "exam_prep", subCategoryKey: "toeic",
    coverSeed: "toeic-listening",
  },
  {
    title: "托业TOEIC：全真模拟200题",
    description: "TOEIC全真模拟练习，在真实考试节奏下检验备考成果。",
    learningGoal: "熟悉TOEIC考试节奏，提升综合得分",
    categoryKey: "exam_prep", subCategoryKey: "toeic",
    coverSeed: "toeic-mock",
  },

  // ── 实用英语 > 听力口语 ────────────────────────────────────────────────
  {
    title: "美式英语发音精讲",
    description: "系统学习美式英语发音规则，包括元音、辅音、连读和弱读。",
    learningGoal: "掌握美式英语标准发音，减少口音",
    categoryKey: "practical", subCategoryKey: "listening_speaking",
    coverSeed: "american-pronunciation",
  },
  {
    title: "BBC新闻英语听力训练",
    description: "用BBC新闻材料训练英式英语听力，提升对正式英语的理解。",
    learningGoal: "提升英式英语听力理解能力",
    categoryKey: "practical", subCategoryKey: "listening_speaking",
    coverSeed: "bbc-listening",
  },
  {
    title: "日常对话开口说",
    description: "从问候到告别，掌握日常生活各场景的英语对话开场白。",
    learningGoal: "自信开口说英语，掌握日常对话启动句",
    categoryKey: "practical", subCategoryKey: "listening_speaking",
    coverSeed: "daily-conversation",
  },
  {
    title: "TED演讲词汇与表达",
    description: "从精选TED演讲中提取高频词汇和地道表达，提升英语格调。",
    learningGoal: "学习TED演讲的地道表达，提升英语层次",
    categoryKey: "practical", subCategoryKey: "listening_speaking",
    coverSeed: "ted-vocabulary",
  },
  {
    title: "母语者语速听力特训",
    description: "针对母语者自然语速的专项听力训练，突破快速英语理解障碍。",
    learningGoal: "适应母语者语速，提升真实场景听力能力",
    categoryKey: "practical", subCategoryKey: "listening_speaking",
    coverSeed: "native-speed",
  },

  // ── 实用英语 > 经典教材 ────────────────────────────────────────────────
  {
    title: "新概念英语第一册",
    description: "新概念英语第一册经典内容，从零开始系统学习英语基础。",
    learningGoal: "掌握英语入门基础，建立语法框架",
    categoryKey: "practical", subCategoryKey: "classic_textbooks",
    coverSeed: "new-concept-1",
  },
  {
    title: "新概念英语第二册",
    description: "新概念英语第二册核心内容，进一步巩固和扩展英语能力。",
    learningGoal: "提升英语综合能力，掌握常用句型",
    categoryKey: "practical", subCategoryKey: "classic_textbooks",
    coverSeed: "new-concept-2",
  },
  {
    title: "朗文英语语法系列",
    description: "基于朗文语法教材的系统语法学习，附大量语境例句。",
    learningGoal: "系统掌握英语语法规则和用法",
    categoryKey: "practical", subCategoryKey: "classic_textbooks",
    coverSeed: "longman-grammar",
  },
  {
    title: "Murphy英语语法实用教程",
    description: "基于Murphy's Grammar in Use，用简洁方式讲解实用语法。",
    learningGoal: "用实用方法掌握英语语法",
    categoryKey: "practical", subCategoryKey: "classic_textbooks",
    coverSeed: "murphy-grammar",
  },
  {
    title: "牛津词汇技能：基础与进阶",
    description: "基于Oxford Word Skills教材，系统扩展英语词汇量。",
    learningGoal: "系统扩展词汇量，提升词汇运用能力",
    categoryKey: "practical", subCategoryKey: "classic_textbooks",
    coverSeed: "oxford-word-skills",
  },

  // ── 实用英语 > 语法词汇 ────────────────────────────────────────────────
  {
    title: "英语语法必备规则",
    description: "涵盖时态、语态、从句等核心语法规则，配合海量例句练习。",
    learningGoal: "系统掌握英语核心语法，减少语法错误",
    categoryKey: "practical", subCategoryKey: "grammar_vocab",
    coverSeed: "grammar-rules",
  },
  {
    title: "英语常用句型500句",
    description: "最常用的500个英语句型模板，覆盖日常沟通的各种场景。",
    learningGoal: "掌握500个核心句型，快速提升表达能力",
    categoryKey: "practical", subCategoryKey: "grammar_vocab",
    coverSeed: "sentence-patterns",
  },
  {
    title: "英语短语动词全攻略",
    description: "系统学习英语短语动词（Phrasal Verbs），突破口语表达障碍。",
    learningGoal: "掌握常用短语动词，提升口语地道性",
    categoryKey: "practical", subCategoryKey: "grammar_vocab",
    coverSeed: "phrasal-verbs",
  },
  {
    title: "高级词汇与搭配",
    description: "学习高级词汇和地道搭配，提升英语表达的精准度和层次感。",
    learningGoal: "掌握高级词汇和地道搭配，提升表达质量",
    categoryKey: "practical", subCategoryKey: "grammar_vocab",
    coverSeed: "advanced-vocab",
  },
  {
    title: "词汇搭配与语境应用",
    description: "学习英语词汇的固定搭配和语境用法，避免中式英语。",
    learningGoal: "掌握词汇搭配规律，写出地道英语",
    categoryKey: "practical", subCategoryKey: "grammar_vocab",
    coverSeed: "collocations",
  },

  // ── 实用英语 > 日常口语 ────────────────────────────────────────────────
  {
    title: "英语早晨：开启一天的对话",
    description: "学习从早晨起床到出门的一系列英语对话，轻松开启英语日。",
    learningGoal: "掌握日常晨间场景英语表达",
    categoryKey: "practical", subCategoryKey: "daily_oral",
    coverSeed: "morning-english",
  },
  {
    title: "购物点餐：实战英语对话",
    description: "超市购物、餐厅点餐、咖啡厅对话的实用英语场景训练。",
    learningGoal: "能用英语流利完成购物和点餐",
    categoryKey: "practical", subCategoryKey: "daily_oral",
    coverSeed: "shopping-ordering",
  },
  {
    title: "电话与消息：现代英语沟通",
    description: "学习打电话、发短信、写邮件等现代通讯场景的英语表达。",
    learningGoal: "掌握电话和信息场景英语表达",
    categoryKey: "practical", subCategoryKey: "daily_oral",
    coverSeed: "phone-messages",
  },
  {
    title: "社交闲聊：英语小谈",
    description: "掌握天气、工作、周末计划等日常闲聊话题，轻松社交。",
    learningGoal: "自然融入英语社交对话，掌握闲聊技巧",
    categoryKey: "practical", subCategoryKey: "daily_oral",
    coverSeed: "small-talk",
  },
  {
    title: "表达观点：英语高情商沟通",
    description: "学习用英语委婉表达意见、表示赞同或不同意的地道方式。",
    learningGoal: "学会用英语高情商地表达和交流观点",
    categoryKey: "practical", subCategoryKey: "daily_oral",
    coverSeed: "expressing-opinions",
  },

  // ── 实用英语 > 旅游英语 ────────────────────────────────────────────────
  {
    title: "机场与飞机：旅行英语第一课",
    description: "涵盖值机、安检、登机等机场全流程的实用英语对话。",
    learningGoal: "能用英语独立完成机场全流程",
    categoryKey: "practical", subCategoryKey: "travel_english",
    coverSeed: "airport-english",
  },
  {
    title: "酒店入住：旅行住宿英语",
    description: "学习预订房间、办理入住、提出要求等酒店场景英语。",
    learningGoal: "能用英语顺利完成酒店住宿全程",
    categoryKey: "practical", subCategoryKey: "travel_english",
    coverSeed: "hotel-english",
  },
  {
    title: "观光导览：看世界说英语",
    description: "旅游景点、问路、乘坐公共交通的实用英语表达。",
    learningGoal: "能用英语自由游览景点和问路",
    categoryKey: "practical", subCategoryKey: "travel_english",
    coverSeed: "sightseeing",
  },
  {
    title: "紧急情况：旅行应急英语",
    description: "学习就医、报警、求助等紧急情况的英语表达，保障旅行安全。",
    learningGoal: "能用英语处理旅行中的紧急情况",
    categoryKey: "practical", subCategoryKey: "travel_english",
    coverSeed: "travel-emergency",
  },
  {
    title: "文化礼仪：各国旅行须知",
    description: "了解英美澳等国的文化礼仪和禁忌，避免文化冲突。",
    learningGoal: "了解旅行目的地文化礼仪，尊重当地习俗",
    categoryKey: "practical", subCategoryKey: "travel_english",
    coverSeed: "cultural-etiquette",
  },

  // ── 实用英语 > 商务职场 ────────────────────────────────────────────────
  {
    title: "商务邮件写作精讲",
    description: "专业英语邮件的写作格式、常用表达和礼貌用语系统学习。",
    learningGoal: "写出专业地道的英文商务邮件",
    categoryKey: "practical", subCategoryKey: "business_career",
    coverSeed: "business-email",
  },
  {
    title: "会议室英语：高效沟通",
    description: "学习开会、讨论、汇报等职场会议场景的地道英语表达。",
    learningGoal: "能用英语有效参与和主持职场会议",
    categoryKey: "practical", subCategoryKey: "business_career",
    coverSeed: "meeting-english",
  },
  {
    title: "商务演讲与汇报",
    description: "掌握英语商务演讲的结构、开场白和结语等关键表达。",
    learningGoal: "能用英语自信完成商务演讲和汇报",
    categoryKey: "practical", subCategoryKey: "business_career",
    coverSeed: "business-presentation",
  },
  {
    title: "商务谈判英语",
    description: "学习价格谈判、条款讨论、达成协议的专业英语表达。",
    learningGoal: "掌握商务谈判英语，提升谈判能力",
    categoryKey: "practical", subCategoryKey: "business_career",
    coverSeed: "negotiation",
  },
  {
    title: "职场面试：英文求职全攻略",
    description: "从简历投递到面试通过的全流程英文求职训练。",
    learningGoal: "能用英语顺利完成外企求职面试",
    categoryKey: "practical", subCategoryKey: "business_career",
    coverSeed: "job-interview",
  },

  // ── 实用英语 > 电影与故事 ─────────────────────────────────────────────
  {
    title: "迪士尼经典电影台词",
    description: "从《狮子王》《冰雪奇缘》等迪士尼经典中提取地道英语表达。",
    learningGoal: "通过迪士尼电影学习地道英语表达",
    categoryKey: "practical", subCategoryKey: "movies_stories",
    coverSeed: "disney-classics",
  },
  {
    title: "名著英语节选精读",
    description: "精选简·奥斯丁、狄更斯等名家作品经典段落，感受文学英语。",
    learningGoal: "提升英语文学阅读能力，感受经典文学语言",
    categoryKey: "practical", subCategoryKey: "movies_stories",
    coverSeed: "novel-excerpts",
  },
  {
    title: "英语短篇故事集",
    description: "收录欧·亨利等作家的精彩英语短篇故事，语言地道优美。",
    learningGoal: "提升英语阅读理解，感受英语故事魅力",
    categoryKey: "practical", subCategoryKey: "movies_stories",
    coverSeed: "short-stories",
  },
  {
    title: "影视对白精选",
    description: "精选《老友记》《唐顿庄园》等热门影视的地道英语对白。",
    learningGoal: "学习影视中的地道英语表达，提升口语感",
    categoryKey: "practical", subCategoryKey: "movies_stories",
    coverSeed: "screen-dialogues",
  },
  {
    title: "励志演讲与名言",
    description: "乔布斯、奥巴马等名人演讲精华和英文名言，激励学习。",
    learningGoal: "学习名人演讲的高级英语表达，汲取人生智慧",
    categoryKey: "practical", subCategoryKey: "movies_stories",
    coverSeed: "inspirational-speeches",
  },
]

// ─── Concurrency helper ───────────────────────────────────────────────────────
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let index = 0
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\n🚀 TypeNow Course Seed Script`)
  console.log(`   Total courses to process: ${COURSES.length}`)
  console.log(`   Database: ${process.env.DATABASE_URL?.split("@")[1] ?? "unknown"}`)
  console.log(`   Concurrency: 3\n`)

  let created = 0
  let skipped = 0
  let failed = 0

  await runWithConcurrency(COURSES, 3, async (course, i) => {
    const prefix = `[${String(i + 1).padStart(3, "0")}/${COURSES.length}]`
    try {
      const existing = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.title, course.title), eq(courses.subCategoryKey, course.subCategoryKey)))
        .limit(1)

      if (existing.length > 0) {
        console.log(`${prefix} ⏭  SKIP  ${course.subCategoryKey} / ${course.title}`)
        skipped++
        return
      }

      console.log(`${prefix} ⏳ GEN   ${course.subCategoryKey} / ${course.title}`)
      const aiLessons = await generateCourseContent(course)

      const courseId = randomUUID()
      await db.insert(courses).values({
        id: courseId,
        title: course.title,
        description: course.description,
        coverUrl: coverUrl(course.coverSeed),
        categoryKey: course.categoryKey,
        subCategoryKey: course.subCategoryKey,
        sourceName: "官方",
        isPublished: 1,
      })

      for (let li = 0; li < aiLessons.length; li++) {
        const lesson = aiLessons[li]
        const lessonId = randomUUID()
        await db.insert(lessons).values({
          id: lessonId,
          courseId,
          title: lesson.title,
          summary: lesson.summary ?? "",
          sortOrder: li,
        })

        for (let si = 0; si < lesson.sentences.length; si++) {
          const s = lesson.sentences[si]
          await db.insert(sentences).values({
            id: randomUUID(),
            english: s.english,
            chinese: s.chinese,
            lessonId,
            sortOrder: si,
          })
        }
      }

      const total = aiLessons.reduce((sum, l) => sum + l.sentences.length, 0)
      console.log(`${prefix} ✓  DONE  ${course.title} (${aiLessons.length}ch / ${total}s)`)
      created++
    } catch (err) {
      console.error(`${prefix} ✗  FAIL  ${course.title}:`, err instanceof Error ? err.message : err)
      failed++
    }
  })

  console.log(`\n✅ Seed complete!`)
  console.log(`   Created: ${created}`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Failed:  ${failed}`)

  await pool.end()
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
