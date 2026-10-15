/**
 * 指法跟打（第一期）静态数据：键位分区、手指映射、渐进式练习关卡。
 *
 * 第一期口径：
 *   · 纯前端静态数据，不接数据库；每关最佳成绩记 localStorage（与音标页
 *     「不记进度」不同：指法练习的进步反馈本身就是动力，本机记录够用，
 *     等第二期接 progress 表时再迁移）；
 *   · 练习文本全部小写：第一期不练 Shift 与大小写切换，专注键位-手指映射，
 *     大写字母在录入时按不区分大小写宽容处理（见 TypingClient）；
 *   · 手指映射为标准盲打分工：ASDF 左手 / JKL; 右手，食指各管两列（含 6/7 与 4/5），
 *     拇指只管空格；键盘可视化用 8 色区分手指，颜色写死 hex（Tailwind 拼不了动态类名）。
 */

export type FingerId =
  | "lp" // 左手小指
  | "lr" // 左手无名指
  | "lm" // 左手中指
  | "li" // 左手食指
  | "ri" // 右手食指
  | "rm" // 右手中指
  | "rr" // 右手无名指
  | "rp" // 右手小指
  | "th" // 拇指（空格）

export const FINGER_LABELS: Record<FingerId, string> = {
  lp: "左手小指",
  lr: "左手无名指",
  lm: "左手中指",
  li: "左手食指",
  ri: "右手食指",
  rm: "右手中指",
  rr: "右手无名指",
  rp: "右手小指",
  th: "拇指",
}

/** 8 指各一色 + 拇指灰，内联 hex：Tailwind v4 不支持运行时拼接类名 */
export const FINGER_COLORS: Record<FingerId, string> = {
  lp: "#f472b6",
  lr: "#a78bfa",
  lm: "#60a5fa",
  li: "#34d399",
  ri: "#fbbf24",
  rm: "#fb923c",
  rr: "#f87171",
  rp: "#e879f9",
  th: "#94a3b8",
}

/** 键盘展示行：数字行 + 三排字母（含 ; , . /），第一期不画上档符号与功能区 */
export const KEYBOARD_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
]

/** 标准盲打分工表：每个可敲键 → 负责手指 */
export const KEY_FINGER: Record<string, FingerId> = {
  "1": "lp",
  "2": "lr",
  "3": "lm",
  "4": "li",
  "5": "li",
  "6": "ri",
  "7": "ri",
  "8": "rm",
  "9": "rr",
  "0": "rp",
  q: "lp",
  w: "lr",
  e: "lm",
  r: "li",
  t: "li",
  y: "ri",
  u: "ri",
  i: "rm",
  o: "rr",
  p: "rp",
  a: "lp",
  s: "lr",
  d: "lm",
  f: "li",
  g: "li",
  h: "ri",
  j: "ri",
  k: "rm",
  l: "rr",
  ";": "rp",
  z: "lp",
  x: "lr",
  c: "lm",
  v: "li",
  b: "li",
  n: "ri",
  m: "ri",
  ",": "rm",
  ".": "rr",
  "/": "rp",
  " ": "th",
}

export function fingerOfKey(key: string): FingerId | null {
  return KEY_FINGER[key] ?? null
}

/** 标准口径：1 词 = 5 字符；未开始（elapsed<=0）或 0 字符返回 0 */
export function computeWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || correctChars <= 0) return 0
  return Math.round(correctChars / 5 / (elapsedMs / 60_000))
}

/** 正确率百分数（0-100）；没有击键时不给 100%，给 0，避免「没练也满分」 */
export function accuracyOf(correct: number, keystrokes: number): number {
  if (keystrokes <= 0) return 0
  return Math.round((correct / keystrokes) * 100)
}

export interface TypingDrill {
  /** 稳定 id：localStorage 最佳成绩的 key，不要改名 */
  id: string
  title: string
  text: string
  tip?: string
}

export interface TypingLesson {
  id: string
  title: string
  /** 本关引入的键位，列表页展示 */
  keys: string[]
  drills: TypingDrill[]
}

export const TYPING_LESSONS: TypingLesson[] = [
  {
    id: "home",
    title: "基准键位",
    keys: ["a", "s", "d", "f", "j", "k", "l", ";"],
    drills: [
      { id: "home-1", title: "食指回家", text: "asdf jkl;", tip: "食指放在 F、J 上，这两个键有凸点，不用看键盘也能摸到" },
      { id: "home-2", title: "指法交替", text: "fad sad lad; ask a lass", tip: "敲完立刻回到基准位，手指不离家" },
      { id: "home-3", title: "小短句", text: "a sad lass adds a salad", tip: "节奏比速度重要，敲稳每一个键" },
    ],
  },
  {
    id: "top",
    title: "上排键位",
    keys: ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    drills: [
      { id: "top-1", title: "向上伸展", text: "qwer tyui op", tip: "从基准位向上够，敲完回位，手腕不要翘" },
      { id: "top-2", title: "上排词", text: "quite a type write your trip", tip: "t、y 由食指负责，两列都归它" },
      { id: "top-3", title: "小短句", text: "your quiet puppy trips on a rope", tip: "p 用右手小指，够不到就整个手微微上移" },
    ],
  },
  {
    id: "bottom",
    title: "下排键位",
    keys: ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
    drills: [
      { id: "bottom-1", title: "向下伸展", text: "zxcv bnm ,. /", tip: "下排最容易低头看键盘，忍住，靠手指记忆" },
      { id: "bottom-2", title: "下排词", text: "zigzag van comb brave mazes", tip: "b 由左手食指管，n、m 由右手食指管" },
      { id: "bottom-3", title: "标点混练", text: "come, one, two. go. no, run.", tip: "逗号右手中指、句点右手无名指，问号感叹号第一期不练" },
    ],
  },
  {
    id: "digits",
    title: "数字行",
    keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    drills: [
      { id: "digits-1", title: "顺序指法", text: "1234 5678 90", tip: "5、6 都归左手食指，是数字行最容易错的一对" },
      { id: "digits-2", title: "跳着敲", text: "1 3 5 7 9 2 4 6 8 0", tip: "跳键强迫手指回基准位再出发" },
      { id: "digits-3", title: "混入生活场景", text: "room 20 page 3 call 0571 8888", tip: "数字要练到不看键盘，场景词帮助记忆" },
    ],
  },
  {
    id: "words",
    title: "综合词句",
    keys: ["全部键位"],
    drills: [
      { id: "words-1", title: "全字母句", text: "the quick brown fox jumps over the lazy dog", tip: "这句话覆盖 26 个字母，指法练习的经典句" },
      { id: "words-2", title: "常用短句", text: "practice makes perfect", tip: "accuracy 优先：宁可慢，不要错" },
      { id: "words-3", title: "谚语", text: "time and tide wait for no man", tip: "试着不看屏幕敲完，再回看正确率" },
    ],
  },
]

/** 本机最佳成绩（localStorage），key 为 drill id */
export const TYPING_BEST_KEY = "typenow_typing_best"

export interface TypingBest {
  wpm: number
  accuracy: number
}

export function loadTypingBest(): Record<string, TypingBest> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(TYPING_BEST_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    // 只认「每项都是 {wpm, accuracy} 数值」的形状，坏数据直接丢弃重来
    if (typeof parsed !== "object" || parsed === null) return {}
    const out: Record<string, TypingBest> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof v === "object" &&
        v !== null &&
        typeof (v as TypingBest).wpm === "number" &&
        typeof (v as TypingBest).accuracy === "number"
      ) {
        out[k] = { wpm: (v as TypingBest).wpm, accuracy: (v as TypingBest).accuracy }
      }
    }
    return out
  } catch {
    return {}
  }
}

/** 新成绩在 wpm 与正确率都不低于旧成绩时才算刷新（任一更高即覆盖更宽松，这里取双达标） */
export function isBetterScore(next: TypingBest, prev: TypingBest | undefined): boolean {
  if (!prev) return true
  return next.wpm > prev.wpm || (next.wpm === prev.wpm && next.accuracy > prev.accuracy)
}

export function saveTypingBest(drillId: string, best: TypingBest): Record<string, TypingBest> {
  const all = loadTypingBest()
  if (isBetterScore(best, all[drillId])) {
    all[drillId] = best
    try {
      window.localStorage.setItem(TYPING_BEST_KEY, JSON.stringify(all))
    } catch {
      // 隐私模式等写入失败不阻塞练习，成绩只丢本次
    }
  }
  return all
}
