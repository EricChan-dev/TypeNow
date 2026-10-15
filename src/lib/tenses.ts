/**
 * 英语 16 时态知识库（静态数据，第一期不接数据库、不记进度）。
 *
 * 参照站把「英语 16 时态全景」放在【音标/语法】入口下；我们挂独立侧边栏项
 * /home/tenses，页面结构与音标页同构：总览（按时间分组 × 体）+ 详情卡。
 *
 * 16 时态 = 4 个时间（现在 / 过去 / 将来 / 过去将来）× 4 个体
 * （一般 / 进行 / 完成 / 完成进行）。例句围绕同一主人公 she + work / do
 * 一族动词展开，方便横向对比各时态的形态差异。
 */

export type TimeId = "present" | "past" | "future" | "past-future"
export type AspectId = "simple" | "continuous" | "perfect" | "perfect-continuous"

export interface TenseExample {
  en: string
  zh: string
}

export interface TenseInfo {
  id: string
  time: TimeId
  aspect: AspectId
  /** 中文名，如「现在完成时」。 */
  name: string
  /** 英文名，如 Present Perfect。 */
  enName: string
  /** 肯定句构成公式。 */
  formula: string
  /** 否定句构成公式。 */
  negative: string
  /** 疑问句构成公式。 */
  question: string
  /** 什么时候用（1-2 句话）。 */
  usage: string
  /** 常见时间标志词（用于识别该时态）。 */
  markers: string[]
  examples: TenseExample[]
}

export const TIME_LABELS: Record<TimeId, string> = {
  present: "现在",
  past: "过去",
  future: "将来",
  "past-future": "过去将来",
}

export const ASPECT_LABELS: Record<AspectId, string> = {
  simple: "一般",
  continuous: "进行",
  perfect: "完成",
  "perfect-continuous": "完成进行",
}

/** 时间在总览页的展示顺序。 */
export const TIME_ORDER: TimeId[] = ["present", "past", "future", "past-future"]
/** 体在组内的展示顺序。 */
export const ASPECT_ORDER: AspectId[] = [
  "simple",
  "continuous",
  "perfect",
  "perfect-continuous",
]

const PAST = "worked" // 规则动词过去式/过去分词样例

export const TENSES: TenseInfo[] = [
  // ── 现在 ────────────────────────────────────────────────────────────────
  {
    id: "present-simple",
    time: "present",
    aspect: "simple",
    name: "一般现在时",
    enName: "Present Simple",
    formula: "主语 + 动词原形（第三人称单数 +s/es）",
    negative: "don't / doesn't + 动词原形",
    question: "Do / Does + 主语 + 动词原形?",
    usage: "表示习惯性、规律性的动作或客观事实与状态。",
    markers: ["always", "usually", "often", "every day", "on Mondays"],
    examples: [
      { en: "She works in a bank.", zh: "她在一家银行工作。" },
      { en: "The sun rises in the east.", zh: "太阳从东方升起。" },
    ],
  },
  {
    id: "present-continuous",
    time: "present",
    aspect: "continuous",
    name: "现在进行时",
    enName: "Present Continuous",
    formula: "am / is / are + 动词-ing",
    negative: "am / is / are + not + 动词-ing",
    question: "Am / Is / Are + 主语 + 动词-ing?",
    usage: "表示此刻或现阶段正在进行的动作。",
    markers: ["now", "right now", "at the moment", "Look!", "Listen!"],
    examples: [
      { en: "She is working right now.", zh: "她现在正在工作。" },
      { en: "Look! It is raining.", zh: "看！正在下雨。" },
    ],
  },
  {
    id: "present-perfect",
    time: "present",
    aspect: "perfect",
    name: "现在完成时",
    enName: "Present Perfect",
    formula: "have / has + 过去分词",
    negative: "have / has + not + 过去分词",
    question: "Have / Has + 主语 + 过去分词?",
    usage: "过去发生、对现在有影响的动作；或从过去持续到现在的状态。",
    markers: ["already", "just", "yet", "ever / never", "since / for"],
    examples: [
      { en: `She has ${PAST} here for five years.`, zh: "她已经在这里工作五年了。" },
      { en: "I have just finished my homework.", zh: "我刚写完作业。" },
    ],
  },
  {
    id: "present-perfect-continuous",
    time: "present",
    aspect: "perfect-continuous",
    name: "现在完成进行时",
    enName: "Present Perfect Continuous",
    formula: "have / has been + 动词-ing",
    negative: "have / has + not + been + 动词-ing",
    question: "Have / Has + 主语 + been + 动词-ing?",
    usage: "从过去某时一直持续到现在（且常继续）的动作，强调过程与时长。",
    markers: ["for two hours", "since morning", "all day", "recently"],
    examples: [
      { en: "She has been working all morning.", zh: "她一上午都在工作。" },
      { en: "How long have you been waiting?", zh: "你等了多久了？" },
    ],
  },
  // ── 过去 ────────────────────────────────────────────────────────────────
  {
    id: "past-simple",
    time: "past",
    aspect: "simple",
    name: "一般过去时",
    enName: "Past Simple",
    formula: "主语 + 动词过去式（-ed / 不规则变化）",
    negative: "didn't + 动词原形",
    question: "Did + 主语 + 动词原形?",
    usage: "表示过去某时发生的动作或状态，现在已经结束。",
    markers: ["yesterday", "last week", "two days ago", "in 2020"],
    examples: [
      { en: "She worked late last night.", zh: "她昨晚工作到很晚。" },
      { en: "We visited Beijing in 2019.", zh: "我们 2019 年去过北京。" },
    ],
  },
  {
    id: "past-continuous",
    time: "past",
    aspect: "continuous",
    name: "过去进行时",
    enName: "Past Continuous",
    formula: "was / were + 动词-ing",
    negative: "was / were + not + 动词-ing",
    question: "Was / Were + 主语 + 动词-ing?",
    usage: "表示过去某时正在进行的动作，或为后文铺垫背景。",
    markers: ["at 8 last night", "when", "while", "at that time"],
    examples: [
      { en: "She was working when I called.", zh: "我打电话时她正在工作。" },
      { en: "While he was cooking, the phone rang.", zh: "他做饭时电话响了。" },
    ],
  },
  {
    id: "past-perfect",
    time: "past",
    aspect: "perfect",
    name: "过去完成时",
    enName: "Past Perfect",
    formula: "had + 过去分词",
    negative: "had + not + 过去分词",
    question: "Had + 主语 + 过去分词?",
    usage: "「过去的过去」：过去某时之前已经完成的动作。",
    markers: ["by the time", "before", "after", "already"],
    examples: [
      { en: `She had ${PAST} there before she moved.`, zh: "她搬走之前一直在那儿工作。" },
      { en: "The train had left when we arrived.", zh: "我们到时火车已经开走了。" },
    ],
  },
  {
    id: "past-perfect-continuous",
    time: "past",
    aspect: "perfect-continuous",
    name: "过去完成进行时",
    enName: "Past Perfect Continuous",
    formula: "had been + 动词-ing",
    negative: "had + not + been + 动词-ing",
    question: "Had + 主语 + been + 动词-ing?",
    usage: "过去某时之前一直在进行的动作，强调持续到那个过去时点。",
    markers: ["for hours", "since 2010", "before lunch", "all that day"],
    examples: [
      { en: "She had been working for hours before lunch.", zh: "午饭前她已经连续工作好几个小时了。" },
      { en: "They had been living there since 2010.", zh: "自 2010 年起他们就住在那儿。" },
    ],
  },
  // ── 将来 ────────────────────────────────────────────────────────────────
  {
    id: "future-simple",
    time: "future",
    aspect: "simple",
    name: "一般将来时",
    enName: "Future Simple",
    formula: "will + 动词原形（或 be going to + 动词原形）",
    negative: "will not (won't) + 动词原形",
    question: "Will + 主语 + 动词原形?",
    usage: "表示将来要发生的动作、临时决定或对将来的预测。",
    markers: ["tomorrow", "next week", "soon", "in the future"],
    examples: [
      { en: "She will work tomorrow.", zh: "她明天要上班。" },
      { en: "I think it will rain tonight.", zh: "我觉得今晚会下雨。" },
    ],
  },
  {
    id: "future-continuous",
    time: "future",
    aspect: "continuous",
    name: "将来进行时",
    enName: "Future Continuous",
    formula: "will be + 动词-ing",
    negative: "will not (won't) be + 动词-ing",
    question: "Will + 主语 + be + 动词-ing?",
    usage: "表示将来某时点正在进行的动作。",
    markers: ["at this time tomorrow", "at 9 tonight", "this time next week"],
    examples: [
      { en: "She will be working at 9 tonight.", zh: "今晚九点她会在工作。" },
      { en: "This time tomorrow we will be flying to Paris.", zh: "明天这个时候我们会正在飞往巴黎。" },
    ],
  },
  {
    id: "future-perfect",
    time: "future",
    aspect: "perfect",
    name: "将来完成时",
    enName: "Future Perfect",
    formula: "will have + 过去分词",
    negative: "will not (won't) have + 过去分词",
    question: "Will + 主语 + have + 过去分词?",
    usage: "表示到将来某时为止将已完成的动作。",
    markers: ["by 8 pm", "by 2030", "by then", "by next month"],
    examples: [
      { en: `She will have ${PAST} ten hours by 8 pm.`, zh: "到晚上八点她将已工作十个小时。" },
      { en: "By 2030 he will have finished the project.", zh: "到 2030 年他将完成这个项目。" },
    ],
  },
  {
    id: "future-perfect-continuous",
    time: "future",
    aspect: "perfect-continuous",
    name: "将来完成进行时",
    enName: "Future Perfect Continuous",
    formula: "will have been + 动词-ing",
    negative: "will not (won't) have been + 动词-ing",
    question: "Will + 主语 + have been + 动词-ing?",
    usage: "表示到将来某时为止将一直持续进行的动作，强调时长。",
    markers: ["by June", "by then", "by this time next year"],
    examples: [
      { en: "By June she will have been working here for five years.", zh: "到六月她在这里工作就满五年了。" },
      { en: "By 6 pm I will have been driving for six hours.", zh: "到下午六点我就开了六个小时的车了。" },
    ],
  },
  // ── 过去将来 ────────────────────────────────────────────────────────────
  {
    id: "future-in-the-past-simple",
    time: "past-future",
    aspect: "simple",
    name: "一般过去将来时",
    enName: "Future in the Past (Simple)",
    formula: "would + 动词原形（或 was / were going to）",
    negative: "would not (wouldn't) + 动词原形",
    question: "多用于宾语从句，一般不用疑问倒装",
    usage: "立足过去某一时刻看将来：过去说、想、计划中「将要」发生的动作。",
    markers: ["said", "thought", "told me", "planned"],
    examples: [
      { en: "She said she would work late.", zh: "她说她会工作到很晚。" },
      { en: "I thought he would come.", zh: "我原以为他会来。" },
    ],
  },
  {
    id: "future-in-the-past-continuous",
    time: "past-future",
    aspect: "continuous",
    name: "过去将来进行时",
    enName: "Future in the Past (Continuous)",
    formula: "would be + 动词-ing",
    negative: "would not (wouldn't) be + 动词-ing",
    question: "多用于宾语从句，一般不用疑问倒装",
    usage: "从过去看将来某时点正在进行的动作。",
    markers: ["said", "told me", "that evening"],
    examples: [
      { en: "He said he would be working at 8 that evening.", zh: "他说那天晚上八点他会在工作。" },
      { en: "She told me she would be waiting at the gate.", zh: "她告诉我她会在大门口等着。" },
    ],
  },
  {
    id: "future-in-the-past-perfect",
    time: "past-future",
    aspect: "perfect",
    name: "过去将来完成时",
    enName: "Future in the Past (Perfect)",
    formula: "would have + 过去分词",
    negative: "would not (wouldn't) have + 过去分词",
    question: "多用于宾语从句，一般不用疑问倒装",
    usage: "从过去看将来某时点之前将已完成的动作。",
    markers: ["said", "believed", "by Friday"],
    examples: [
      { en: "She said she would have finished the report by Friday.", zh: "她说到周五她会写完报告。" },
      { en: "He believed he would have arrived by noon.", zh: "他相信到中午他会已经到达。" },
    ],
  },
  {
    id: "future-in-the-past-perfect-continuous",
    time: "past-future",
    aspect: "perfect-continuous",
    name: "过去将来完成进行时",
    enName: "Future in the Past (Perfect Continuous)",
    formula: "would have been + 动词-ing",
    negative: "would not (wouldn't) have been + 动词-ing",
    question: "多用于宾语从句，一般不用疑问倒装",
    usage: "从过去看到将来某时为止将一直持续进行的动作，强调时长。",
    markers: ["said", "knew", "by May"],
    examples: [
      { en: "She said by May she would have been working there for ten years.", zh: "她说到五月她在那儿工作就满十年了。" },
      { en: "He knew that by dusk he would have been sailing for 12 hours.", zh: "他知道到黄昏时他就已经航行十二个小时了。" },
    ],
  },
]

/** 按时间分好的总览分组（顺序：现在 → 过去 → 将来 → 过去将来）。 */
export const TENSE_GROUPS: Array<{ time: TimeId; items: TenseInfo[] }> = TIME_ORDER.map(
  (time) => ({
    time,
    items: ASPECT_ORDER.map(
      (aspect) => TENSES.find((t) => t.time === time && t.aspect === aspect)!,
    ),
  }),
)

export function tenseById(id: string): TenseInfo | undefined {
  return TENSES.find((t) => t.id === id)
}
