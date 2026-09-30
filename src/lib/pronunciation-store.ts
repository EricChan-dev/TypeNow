import { db } from "@/lib/db"
import { pronunciationScores } from "@/lib/db/schema"
import type { EvaluateResult } from "@/lib/pronunciation"
import { and, eq } from "drizzle-orm"

/**
 * 跟读评分的持久化。**单条分数的读写都经这里** —— 写入、取上一句评语都收敛在
 * 本模块，避免查询逻辑散落在路由与组件里。
 *
 * 唯一例外是 `api/courses/sentences` 的**批量** LEFT JOIN：它按 lesson 一次性把
 * 整节课（含每句的跟读分）取出来，是"一次查询 vs 每句一次请求"的取舍 —— 走本模块
 * 就等于 N 次往返。那个 JOIN 必须自带 `userId` 条件（否则会挂上别人的分），
 * 而且它只读、不写。
 *
 * 响应形状也**不在这里**重复描述：以 `src/types/index.ts` 的 `Sentence.pronunciation`
 * 为唯一权威（speed 在库里是 DECIMAL、读出来是字符串，路由转成 number；updatedAt
 * 在响应里是 ISO 字符串 —— 在这里再写一份 interface 只会与它对不上）。
 */

/**
 * 列宽必须与 DDL 同值 —— 权威是 db/migrations/00033_pronunciation_scores.sql。
 * 这里不是"防御性编程"，是**这个函数唯一能挡住静默丢行的地方**（见下方说明）。
 */
const COMMENT_MAX = 500
/**
 * sentence_id 的列宽（VARCHAR(36)）。**这是拒绝阈值，不是截断宽度** ——
 * 它是 UNIQUE(user_id, sentence_id) 的一部分，超长只能拒写，见写入处的说明。
 */
const SENTENCE_ID_MAX_LEN = 36
/** DECIMAL(6,2)：6 位总精度里 2 位给小数，整数部分只剩 4 位 → 上限 9999.99。 */
const SPEED_MAX = 9999.99

/**
 * speed 落 DECIMAL(6,2) 前的收敛。
 *
 * 越界**不能夹到 9999.99**：那是把一个已知错误的值伪装成一个真实语速，
 * 比丢掉它更坏 —— 下游会拿它当"用户读得快"来解读。越界只说明「这个语速存不了」，
 * 而 schema 里 null 的语义恰好就是「不知道语速」（有道本来就可能不给 speed），
 * 所以越界一律存 null。
 *
 * 先舍入再 `String()`：舍入后的非零值最小 0.01、最大 9999.99，JS 的 `String()`
 * 在这个区间**只会**输出普通十进制，不会输出 `1e+21` 那种指数形式 ——
 * 而指数形式的字面量正是会被 MySQL 判成越界、连累整行的那一种。
 */
function toDecimalSpeed(speed: number | null): string | null {
  if (speed === null) return null
  // NaN / ±Infinity 的 String() 是 "NaN"/"Infinity"，MySQL 同样不接受 → 也要 null。
  if (!Number.isFinite(speed)) return null
  // 上限按**舍入后**的值判断：写 DECIMAL(6,2) 时 MySQL 会先四舍五入，
  // 9999.999 本身没越界，舍入成 10000.00 就 out of range 了。
  const rounded = Math.round(speed * 100) / 100
  if (Math.abs(rounded) > SPEED_MAX) return null
  return String(rounded)
}

/**
 * 写入（覆盖式）。
 *
 * 一句话一行：`UNIQUE(user_id, sentence_id)` + `onDuplicateKeyUpdate`，
 * 重录即覆盖。产品决定只留最新一次，所以这里是 upsert 而不是 insert。
 *
 * **返回 boolean 而不是抛错**：调用方是评分接口，写库失败**不该让用户看不到分数**。
 * 分数已经算出来了，存不上是我们的问题，要记日志但不该毁掉这次响应。
 *
 * 代价是：**任何被 MySQL 拒绝的写入都会变成一条只有 console.error 的静默丢行**
 * （用户照样看到分数，库里却没有）。所以凡是"调用方可以影响、而列是定宽的"值，
 * 都必须在进 SQL 之前处理 —— 见下面的收敛与拒写。
 */
export async function savePronunciationScore(params: {
  userId: string
  sentenceId: string
  result: EvaluateResult
  comment: string
  now: Date
}): Promise<boolean> {
  if (!db) return false
  const { userId, sentenceId, result, comment, now } = params

  // ── 进 SQL 前按列宽收敛（键列除外，键列是拒写）────────────────────────────
  //
  // comment(VARCHAR(500)) / sentence_id(VARCHAR(36)) / speed(DECIMAL(6,2)) 都是
  // 定宽列。MySQL 8 默认 STRICT_TRANS_TABLES：超长或越界**不是截断，是拒绝整条
  // 语句**（1406 Data too long / 1264 Out of range）。而本函数的约定是
  //「写库失败不影响返回分数」，于是表现成：用户每次都能看到分数，行却**永久、
  // 静默地**没写进去，唯一的信号是一行 console.error —— 也就是迁移文件里点名的
  // 那个"最贵的坑"（同 id 漏默认值那次的失败形状一模一样）。
  //
  // 其中 comment 尤其危险：它由 buildComment 拼出来，里面插了客户端传来的 text
  // 里的"单词"，长度不受我们控制 —— 一个超长"单词"能把整行（分数、逐词分、
  // 历史评语）一起带走。所以边界挡在这里，而不是指望调用方每次都对。
  //
  // 但处理手法要按字段语义分，不能一律截断：
  //   · comment —— 散文，少几个字只是**降级**，截断可接受；
  //   · speed   —— 越界存 null，而 null 的语义恰好就是"不知道语速"，也可接受；
  //   · sentence_id —— **键列**，`UNIQUE(user_id, sentence_id)` 的一部分。
  //     截断不是降级，是**悄悄把这一行改挂到另一个 key 上**：调用方拿 id A 来
  //     写，库里却落在 A 的前 36 字符下；两个前 36 字符相同、其后分叉的不同句子
  //     还会撞进同一行互相覆盖。把用户的分数记到别的句子头上，比这一行没写进去
  //     **严格更坏**：丢行只是"没有数据"，改 key 是"错的数据被当成对的"。
  //     所以超长一律拒写，绝不 slice。
  //
  // 每个字段只留一个局部变量，`.values()` 与 `onDuplicateKeyUpdate({ set })`
  // 共用它：两处写的是同一行，值一旦不一致，重录（UPDATE 分支）就会与首次
  // 写入（INSERT 分支）落成不同的内容，而这种漂移只在"重录"时才现形。
  // sentence_id 没有局部变量，因为它的"处理"就是不处理 —— 原样进 SQL。
  //
  // 注：路由目前只会传客户端给的真实 sentence id（Task 6 才开始传），所以这条
  // 拒写分支不该出现在实际流量里；它挡的是畸形/恶意值，不是常规路径。
  if (sentenceId.length > SENTENCE_ID_MAX_LEN) {
    // 必须留下能定位问题的信息：长度说明"为什么被拒"，前缀说明"是哪个值"。
    // 前缀要截断 —— 畸形值可能有几 MB，整条打进日志会把真正有用的上下文冲掉。
    console.error(
      `[pronunciation-store] sentence_id 超长被拒（长度 ${sentenceId.length} > 列宽 ${SENTENCE_ID_MAX_LEN}），已放弃写入:`,
      sentenceId.slice(0, 64),
    )
    return false
  }

  const clampedComment = comment.slice(0, COMMENT_MAX)
  const clampedSpeed = toDecimalSpeed(result.speed)

  try {
    await db
      .insert(pronunciationScores)
      .values({
        userId,
        sentenceId,
        score: result.score,
        accuracy: result.accuracy,
        fluency: result.fluency,
        integrity: result.integrity,
        speed: clampedSpeed,
        words: result.words,
        comment: clampedComment,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          score: result.score,
          accuracy: result.accuracy,
          fluency: result.fluency,
          integrity: result.integrity,
          speed: clampedSpeed,
          words: result.words,
          comment: clampedComment,
          updatedAt: now,
        },
      })
    return true
  } catch (e) {
    console.error("[pronunciation-store] 写入失败:", e)
    return false
  }
}

/** 读上一次的评语 —— 生成新评语时用来避免连着两次说同一句话。 */
export async function getPreviousComment(
  userId: string,
  sentenceId: string,
): Promise<string | null> {
  if (!db) return null
  try {
    const [row] = await db
      .select({ comment: pronunciationScores.comment })
      .from(pronunciationScores)
      .where(
        and(eq(pronunciationScores.userId, userId), eq(pronunciationScores.sentenceId, sentenceId)),
      )
      .limit(1)
    return row?.comment ?? null
  } catch (e) {
    console.error("[pronunciation-store] 读取上一次评语失败:", e)
    return null
  }
}
