/**
 * 词性（POS）标签的中文映射。
 *
 * 词性来自句子的 words[].pos，取值是 **Universal Dependencies 的英文标签**
 * （NOUN / VERB / PRON …）。生产库 3 万行样本的实际分布：
 *   NOUN 31636、VERB 22733、PRON 18880、DET 13747、ADP 13094、ADJ 10661、
 *   AUX 8832、ADV 7482、PART 3790、CCONJ 3588、PROPN_PERSON 2762、SCONJ 1710、
 *   NUM 1381、INTJ 1260、PROPN 921、SYM 65、X 43、CONJ 4
 *
 * 界面上直接显示这些英文对中文使用者没有意义（"VerB" 既不是英语单词该有的样子，
 * 也不是谁都认识的语法术语），所以统一在这里翻成中文。
 *
 * 刻意**不在**这里做数据清洗：库里存的是 UD 标准标签，标准标签有其价值
 * （将来接语法分析、做错题归类都靠它）。翻译只发生在展示层。
 */

/**
 * UD 标签 → 中文。键统一大写，查表前把输入大写化 ——
 * 库里存的是标准大写形式，但历史/导入数据里出现过大小写混写。
 */
const POS_LABELS: Record<string, string> = {
  NOUN: "名词",
  VERB: "动词",
  ADJ: "形容词",
  ADV: "副词",
  PRON: "代词",
  DET: "限定词",
  ADP: "介词",
  AUX: "助动词",
  PART: "小品词",
  CCONJ: "并列连词",
  SCONJ: "从属连词",
  CONJ: "连词",
  NUM: "数词",
  INTJ: "感叹词",
  PROPN: "专有名词",
  // 人名是 PROPN 的细分标签，单独给一个更贴切的说法
  PROPN_PERSON: "人名",
  PROPN_LOC: "地名",
  PROPN_ORG: "机构名",
  SYM: "符号",
  PUNCT: "标点",
  X: "其他",
  // 库里用中文"标点"标记不可输入的符号位（见 getInputWords），保持一致
  标点: "标点",

  // ── 词典接口（freedictionaryapi）用的**全称**形式 ──
  //
  // 注意这套取值与上面的 UD 缩写是**两套词汇**：
  //   UD 给的是 NOUN / VERB / PRON（缩写、全大写）
  //   词典给的是 noun / adverb / pronoun（全称、小写）
  // 悬浮单词卡里显示的 "pronoun" 就来自后者 —— 它确实是词性，
  // 只是因为没登记中文而原样露出了英文。
  PRONOUN: "代词",
  ADJECTIVE: "形容词",
  ADVERB: "副词",
  PREPOSITION: "介词",
  CONJUNCTION: "连词",
  INTERJECTION: "感叹词",
  DETERMINER: "限定词",
  NUMERAL: "数词",
  ARTICLE: "冠词",
  PARTICLE: "小品词",
  PHRASE: "短语",
  "PROPER NOUN": "专有名词",
  "AUXILIARY VERB": "助动词",
  "MODAL VERB": "情态动词",
  "PHRASAL VERB": "动词短语",
  "NOUN PHRASE": "名词短语",
  "VERB PHRASE": "动词短语",
  CONTRACTION: "缩略形式",
  ABBREVIATION: "缩写",
  EXCLAMATION: "感叹词",
  PREFIX: "前缀",
  SUFFIX: "后缀",
  AFFIX: "词缀",
  SYMBOL: "符号",
  WORD: "单词",
  LETTER: "字母",
  PUNCTUATION: "标点",
  ORDINAL: "序数词",
  CARDINAL: "基数词",
}

/**
 * 取词性的中文名。
 *
 * 未知标签**原样返回**而不是显示"未知"：UD 标签本身是标准化的、有信息量的，
 * 遇到没登记的新标签时露出原文比一律糊成"未知"更有助于发现问题。
 * 空值返回空串（调用方据此决定要不要渲染这块）。
 */
export function posLabel(pos: string | null | undefined): string {
  if (!pos) return ""
  const raw = String(pos).trim()
  if (!raw) return ""
  return POS_LABELS[raw.toUpperCase()] ?? POS_LABELS[raw] ?? raw
}
