/**
 * 结构化答案视图的展示层。
 *
 * 基准实现是把 `renderStructuredAnswer()` 拼好的 HTML 字符串 `innerHTML` 进
 * `#sentenceHintContent` / 复习屏容器；这里改成 React 渲染同一套 DOM，
 * 好处是题库里的句子（用户可编辑）不需要自己写转义。
 *
 * **类名与嵌套结构必须对齐基准实现** —— 移植过来的 `practice.css` 里
 * `.structured-answer` / `.answer-component` / `.component-*` 那几族
 * 全靠这些类名生效：
 *
 *   有标签：
 *     <span class="answer-component component-<type>[ contraction-suffix]"
 *           data-word-start data-word-end>
 *       <span class="component-label">主语</span>
 *       <span class="component-text"><span class="clickable-word" data-word>…</span>标点</span>
 *       [<span class="component-phonetics">音标</span> | 占位 span]
 *       [<span class="component-meaning">成分释义</span>]
 *     </span>
 *
 *   无标签：
 *     <span class="answer-component-plain[ contraction-suffix]" data-word-start data-word-end>
 *       <span class="clickable-word" data-word>…</span>[标点][<span class="component-phonetics">…</span>]
 *     </span>
 *
 * 注意基准实现在「有标签」分支里把音标放在 `.component-text` **之后**、
 * `.component-meaning` 之前；「无标签」分支则把音标直接接在文本后面。
 * 顺序不同是因为两套 CSS 的 flex 排列方向不同，照抄。
 */
import type { StructuredAnswer, StructuredPart } from "@/lib/structured-answer"

/** 一个成分里的文本段（可点单词会被包成 `.clickable-word`）。 */
function PartText({ part }: { part: StructuredPart }) {
  return (
    <>
      {part.tokens.map((t, i) =>
        t.query ? (
 // `data-word` 是查词键（原形），基准实现 makeTextClickable 的输出
          <span className="clickable-word" data-word={t.query} key={i}>
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
      {/*
        句末标点补在最后一个非空成分的文本里（不是它的外面）——
 基准实现写在 `.component-text` 内部，好让标点跟着词一起排列。
      */}
      {part.trailingPunctuation ? (
        <span className="answer-terminal-punctuation">{part.trailingPunctuation}</span>
      ) : null}
    </>
  )
}

function Phonetics({ part }: { part: StructuredPart }) {
  if (part.phonetics.length > 0) {
    return <span className="component-phonetics">{part.phonetics.join(" ")}</span>
  }
  // 缩写后缀（'s / 're）查不到音标时插一个不可见占位，
 // 让它下面的中文释义与相邻成分对齐（基准实现原样行为）。
  if (part.phoneticsPlaceholder) {
    return (
      <span className="component-phonetics" style={{ visibility: "hidden" }}>
        {"\u00a0"}
      </span>
    )
  }
  return null
}

function Part({ part, highlightedIndex }: { part: StructuredPart; highlightedIndex: number | null }) {
  // 禁用高亮时（整句存在撇号开头的成分）两个属性都不输出，
 // 基准实现给的是空串。React 传 undefined 即不渲染该属性。
  const highlight =
    part.wordStart === null || part.wordEnd === null
      ? {}
      : { "data-word-start": part.wordStart, "data-word-end": part.wordEnd }

  const contraction = part.contractionSuffix ? " contraction-suffix" : ""

 // 「聚焦第 N 格 → 高亮第 N 格所属成分」。基准实现是 highlightAnswerWord()
  // 直接往 DOM 加 `.answer-highlight`（practice.js:9047），判据完全相同，
  // 但那边要 querySelector 找面板；我们在 React 里直接按区间判断，
  // 结果等价且不受面板是否存在影响。
  const active =
    highlightedIndex !== null &&
    part.wordStart !== null &&
    part.wordEnd !== null &&
    highlightedIndex >= part.wordStart &&
    highlightedIndex <= part.wordEnd
  const highlightClass = active ? " answer-highlight" : ""

  if (part.label) {
    const componentClass = part.componentType ? `component-${part.componentType}` : ""
    return (
      <span
        className={`answer-component ${componentClass}${contraction}${highlightClass}`
          .replace(/\s+/g, " ")
          .trim()}
        {...highlight}
      >
        <span className="component-label">{part.label}</span>
        <span className="component-text">
          <PartText part={part} />
        </span>
        <Phonetics part={part} />
        {part.meaning ? <span className="component-meaning">{part.meaning}</span> : null}
      </span>
    )
  }

  return (
    <span className={`answer-component-plain${contraction}${highlightClass}`} {...highlight}>
      <PartText part={part} />
      <Phonetics part={part} />
    </span>
  )
}

/**
 * 结构化答案本体（不含外层容器）。
 *
 * `structured === false` 时渲染基准实现的降级形态
 * `<span class="answer-text-plain">`，调用方不用自己分支。
 *
 * @param highlightedIndex 当前聚焦的输入格下标；为 null 时不加
 * `.answer-highlight`。基准实现对应 `highlightAnswerWord(index, word)`
 *   —— 我们只实现它的**策略 1**（按 `data-word-start/end` 区间高亮），
 *   没有实现策略 2（按单词文本兜底匹配 `.clickable-word`）：策略 2 是给
 *   「结构数据的分段与输入框对不上」时兜底的，而我们的 `start/end` 来自
 *   数据库、已实测与 `dictationTokens()` 切法一致，不需要文本兜底。
 */
export function StructuredAnswerView({
  answer,
  highlightedIndex = null,
}: {
  answer: StructuredAnswer
  highlightedIndex?: number | null
}) {
  if (!answer.structured) {
    return <span className="answer-text-plain">{answer.plainText}</span>
  }
  return (
    <div className="structured-answer">
      {answer.parts.map((p, i) => (
        <Part part={p} highlightedIndex={highlightedIndex} key={i} />
      ))}
    </div>
  )
}
