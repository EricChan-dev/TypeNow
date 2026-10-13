import type { Sentence } from "@/types"
import { alignWordsWithEnglish } from "@/lib/word-align"

/**
 * 只做 words 归一，**不摊平**分块：一句就是一条练习项，`chunks` 原样保留。
 *
 * 这是听写模式（`DictationPractice`）该走的路径。参考站没有任何「按分块练习」的概念
 * —— 它的 `chunks` 只有一处用途，就是**分段练习**的数据源
 * （practice.js:2743/3019/4455/4746 四处都是 `Chunks || chunks || fragments`，
 * 全部落在分段练习分支里；speaking.js 里 `chunk` 出现 0 次）。
 * 而 `fragmentsForSentence()` 恰恰要读 `sentence.chunks`，一旦这些句子被摊平、
 * `chunks` 被置 null，分段练习就永远进不去 —— 而且**不会报错**，只是默默失效。
 *
 * words 仍需归一：导入的 words 普遍缺标点，直接用会让练习页那行的标点与翻译对不上。
 */
export function normalizeSentences(raw: Sentence[]): Sentence[] {
  return raw.map((s) => ({ ...s, words: alignWordsWithEnglish(s.english, s.words) }))
}

/**
 * 把接口下发的句子摊平成「练习项」列表。
 *
 * 为什么要摊平：有 chunks（分块）的句子，**重写前的旧版练习页**要的是每个分块
 * 一条练习项，以便分块各自独立朗读、独立跟读评分，所以它们必须有各自的 id。
 *
 * 这个函数原本是 `LearnClient.tsx` 里的一个私有函数，只被它自己的一处调用点使用。
 * 重写听写模式时它必须被两个实现共用，否则"分块 id 怎么拼"这件事会有两份实现，
 * 一旦其中一份改了，同一个句子的进度就会分裂到两个 id 上 —— 而且不会报错，
 * 只表现为"练过的句子没有进度"。所以提到这里作为唯一事实源。
 *
 * 分块 id 形态 `<原句 id>_c<order>` 是**对外契约**：`review/complete`、`wordbook`、
 * 跟读评分、`baseSentenceId()` 都按这个形态解析。改这里等于改协议。
 *
 * ⚠️ 当前**没有生产调用点**：唯一调用者 LearnClient 已随 B4 删除，四种模式现在
 * 全部走 `normalizeSentences()`（保留 chunks），所以 `_c<n>` 形态的练习项 id
 * 已不再被生产出来。之所以保留而不是删掉：`/api/youdao/evaluate` 仍在用
 * `isChunkPracticeItemId()` 校验传入的 id 形状（route.ts:38），
 * `baseSentenceId()` 也仍按同一正则剥离后缀 —— 契约的**消费端**还活着，
 * 这里保留的是它的定义与测试；一旦连消费端也移除，这个函数才能一起删。
 *
 * ⚠️ **不要**在听写模式里调用 —— 听写模式走 `normalizeSentences()`，
 * 理由见上方注释。
 */
export function expandSentences(raw: Sentence[]): Sentence[] {
  return raw.flatMap((s) => {
    if (!s.chunks || s.chunks.length === 0) {
      // words 以 english 的分词为骨架重建：导入的 words 普遍缺标点，
      // 直接用会让练习页那行的标点与翻译对不上。
      const normalized: Sentence = { ...s, words: alignWordsWithEnglish(s.english, s.words) }
      return [normalized]
    }
    const parentWords = s.words ?? []
    return [...s.chunks]
      .sort((a, b) => a.order - b.order)
      .map((chunk) => ({
        id: `${s.id}_c${chunk.order}`,
        english: chunk.text,
        chinese: chunk.chinese,
        words_count: chunk.text.trim().split(/\s+/).length,
        category: s.category ?? "daily",
        difficulty: s.difficulty ?? 1,
        tags: s.tags ?? [],
        lesson_id: s.lesson_id,
        words: alignWordsWithEnglish(chunk.text, parentWords),
        chunks: null,
        // ⚠️ 这里**不能**继承 s.pronunciation：跟读分是按**练习项**存的，每个分块
        // 是独立朗读、独立评分的一段文字，各有各的一行。父行的分属于"整句"这个
        // 练习项（只有没被展开时才存在），把它挂到每个分块上会让大纲里三个分块
        // 都显示同一个分、包括从没录过的那个；也会让历史卡片显示另一段录音的分。
        // 分块自己的分由 /api/courses/sentences 按练习项 id 匹配下发。
      }))
  })
}

/** 每条原句在摊平后会变成几条练习项（无 chunks 为 1）。 */
function practiceItemCount(s: Sentence): number {
  return s.chunks && s.chunks.length > 0 ? s.chunks.length : 1
}

/**
 * 判断一条会话记录存的下标属于**摊平空间**还是**原句空间**。
 *
 * 听写模式改成分块不摊平之后，`current_index` 的坐标系变了：以前 10 句话带分块
 * 的课会存到 74，现在最多存到 9。老记录如果直接当原句下标用，`clampResumeIndex`
 * 会把它夹到最后一句 —— 用户看到的是「进度被重置到末尾」，而不是从头，方向诡异。
 *
 * 判据是 `sentence_count`：它和下标**同一次上报**写入，所以两者坐标系必然一致。
 * 存的是摊平空间的条数（> 原句数）时，下标也就是摊平空间的。
 *
 * 只认「严格大于」：相等时两个空间无法区分（课里根本没有分块句），此时按原句
 * 空间处理是安全的 —— 这两种情况下每个原句恰好都是一个练习项，下标含义相同。
 */
export function isExpandedIndexSpace(
  storedSentenceCount: number,
  raw: Sentence[],
): boolean {
  const count = Math.floor(Number(storedSentenceCount))
  return Number.isFinite(count) && count > raw.length
}

/**
 * 把摊平空间的下标折算回原句空间：落在哪个原句的哪一块，就恢复成哪个原句。
 *
 * 例：原句 2 有 7 个分块、原句 3 有 1 个（共占摊平下标 7..14）；
 * 摊平下标 9 → 原句 2（用户当时正在练它的第 3 块），恢复成整句重练。
 *
 * 越界时夹到最后一句：与 `clampResumeIndex` 的方向一致 —— 宁可让用户补最后一句，
 * 也不无声地把他送回开头。任何非法输入回退到 0。
 */
export function mapExpandedIndexToRawIndex(
  expandedIndex: number,
  raw: Sentence[],
): number {
  const target = Math.floor(Number(expandedIndex))
  if (!Number.isFinite(target) || target <= 0 || raw.length === 0) return 0

  let acc = 0
  for (let i = 0; i < raw.length; i++) {
    acc += practiceItemCount(raw[i])
    if (target < acc) return i
  }
  return raw.length - 1
}
