import type { Word } from "@/types"
import { isTypingMatch, tokenizeEnglish } from "@/lib/typing-compare"

/**
 * 可输入的 token（字母/数字/撇号/连字符，且**至少含一个字母或数字**）——其余视为标点。
 *
 * 必须有「至少含一个字母数字」这一条：`writer's` 会被切成 `writer` `'` `s`，
 * 单独一个 `'` 若算成词，练习页就会多出一个只用来敲撇号的输入格；`5 - 3` 里的
 * `-` 同理。
 */
const WORD_RE = /^(?=.*[a-zA-Z\d])[a-zA-Z\d'-]+$/

function plainWord(token: string): Word {
  return {
    english: token,
    chinese: null,
    phonetic: null,
    pos: WORD_RE.test(token) ? "词" : "标点",
  }
}

/**
 * 把一句英文的 `words` 对齐到 `english` 的分词结果上。
 *
 * 为什么必须做：练习页那行「空格 + 标点」的渲染完全依赖 `words` 数组。而导入的
 * 语料里 `words` 普遍**没带标点**（或带错），线上实测 335,291 条有 words 的句子里
 * 有 134,052 条（40%）标点与 `english` 对不上：
 *
 *   chinese: 今天是星期几？   english: What day is today ?        words 标点: NULL
 *   chinese: "你们无数次…"    english: " You saved me … ."        words 标点: NULL
 *   chinese: 情态动词如'可能'… english: Modal verbs such as 'may'… words 标点: ''''.
 *
 * 于是用户在练习页看到的那行，标点要么缺失、要么出现多余符号。
 *
 * 解决口径：**以 `english` 的分词为唯一骨架**（标点必然与翻译一致），`words`
 * 只用来就地补音标 / 词性 / 释义。这与 `/api/courses/sentences` 原先「words 为空
 * 时才用分词兜底」的差异，正是漏掉标点的原因。
 *
 * 另注：分词走 `tokenizeEnglish`，会先把弯引号、破折号、省略号归一化成键盘可敲的
 * 等价写法（don’t → don't）。这与判题口径同源，所以显示的标点就是用户该敲的标点。
 */
export function alignWordsWithEnglish(
  english: string | null | undefined,
  stored?: Word[] | null,
): Word[] {
  const tokens = tokenizeEnglish(english ?? "")
  if (tokens.length === 0) return stored?.length ? stored : []

  const skeleton = tokens.map(plainWord)

  // 全句没有可输入的词（例如整句只有符号）：保留库里的原样，
  // 否则会产出「一个输入框都没有」的句子。
  if (skeleton.every((w) => w.pos === "标点")) {
    return stored?.length ? stored : skeleton
  }

  if (!stored || stored.length === 0) return skeleton

  // 顺序扫描匹配：token 与 stored 都是同一句话的切分，正常情况下位置一一对应；
  // 库里缺标点时，标点 token 匹配不上就退回 plainWord，游标不前进。
  // 先往后找（尊重顺序），确实找不到时才在**未被占用**的条目里取最近的一个兜底，
  // 这样库里顺序错乱也不会把音标戴到别的词头上，更不会重复使用同一个条目。
  const used = new Array(stored.length).fill(false)
  const result: Word[] = []
  let cursor = 0
  for (const token of tokens) {
    let matched: Word | null = null
    let matchedAt = -1
    for (let i = cursor; i < stored.length; i++) {
      if (!used[i] && isTypingMatch(token, stored[i].english)) {
        matched = stored[i]
        matchedAt = i
        break
      }
    }
    if (matched === null) {
      for (let i = 0; i < stored.length; i++) {
        if (!used[i] && isTypingMatch(token, stored[i].english)) {
          matched = stored[i]
          matchedAt = i
          break
        }
      }
    }
    if (matched !== null) {
      used[matchedAt] = true
      cursor = Math.max(cursor, matchedAt + 1)
      // 库里标点的 pos 不可信：线上有 757 条句子的标点被词性标注器打了 SYM/PART
      // 之类的标签（例如单独一个 `'` 标成 PART，共 67 处）。pos 不是「标点」时
      // 练习页会把它当成要用户敲的输入格，所以这里以 token 本身为准覆盖 pos。
      result.push(WORD_RE.test(token) ? matched : { ...matched, pos: "标点" })
      continue
    }
    result.push(plainWord(token))
  }
  return result
}
