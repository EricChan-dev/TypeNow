/**
 * 依存句子树的排版计算。
 *
 * 存在的理由：`dependency_analysis` 覆盖率 95%，但前端一次都没渲染过，
 * 是最典型「数据已就位、代码没用过」的一项。而它又必须算得对才敢画：
 * 弧线一旦交叉，语法关系就读不出来了，比不画还糟。
 *
 * 这里只做纯计算（谁挂在谁下面、每条弧放在第几层），渲染交给组件，
 * 这样排版规则可以被单测锁住，不用靠肉眼看图。
 *
 * 口径说明：**父子关系一律以 `head_id` 为准，不读 `children` 数组**。
 * 两者理论上互为镜像，但导入数据的 `children` 有缺失/自相矛盾的可能，
 * 而 `head_id` 是标注工具直接产出、更接近原始事实；只信一个来源，
 * 就不会出现「按 children 画出来和 head_id 不一致」这种诡异图。
 */

/** 依存分析里一个词的原始形态（只声明用到的字段，多出来的忽略）。 */
export interface DependencyNodeLike {
  id: number
  word: string
  dep: string
  pos?: string
  head_id: number
  start_idx: number
  end_idx?: number
  children?: number[]
  phrase?: string
  lemma?: string
}

export interface DependencyAnalysisLike {
  root?: number
  sentence?: string
  nodes?: DependencyNodeLike[]
  edges?: Array<{ source: number; target: number; label: string }>
}

export interface LayoutNode {
  id: number
  word: string
  dep: string
  pos: string
  /** 句中词序下标（0 基），由 start_idx 排定 */
  leafIndex: number
  /** 距根的距离，根为 0 */
  depth: number
  isRoot: boolean
  /** 有效上级的 id；没有有效上级（根 / 脏数据）时为 null */
  headId: number | null
}

export interface LayoutArc {
  /** 两端按词序摆好：from 恒 < to，弧线永远从左画到右 */
  from: number
  to: number
  /** 上级所在词序下标（方向信息，标注「谁修饰谁」用） */
  headLeafIndex: number
  depLeafIndex: number
  label: string
  labelZh: string
  /** 第几层。同层弧线必定互不重叠，所以可以共用一个高度 */
  level: number
}

export interface DependencyLayout {
  nodes: LayoutNode[]
  arcs: LayoutArc[]
  /** 最大层号；没有任何弧时为 -1（调用方据此判断「画不出来」） */
  maxLevel: number
  /** 原始句子（用于和词序对照），可能为空 */
  sentence: string
}

const EMPTY_LAYOUT: DependencyLayout = { nodes: [], arcs: [], maxLevel: -1, sentence: "" }

/** 两个区间是否真正交叉。共享端点不算交叉 —— 箭头汇到同一个词上是常态。 */
function overlaps(a: LayoutArc, b: LayoutArc): boolean {
  return a.from < b.to && b.from < a.to
}

/**
 * 建树 + 定层。
 *
 * 定层用「按跨度从小到大贪心」：先放短弧，短弧占据最低的可用层，
 * 长弧再去找第一个不与已有弧交叉的层。跨度大的弧天然更容易交叉，
 * 放到外圈（更高层）视觉上也更像真正的树，读者顺着弧线就能走回句子的主干。
 */
export function buildDependencyLayout(analysis: DependencyAnalysisLike | null | undefined): DependencyLayout {
  const rawNodes = analysis?.nodes
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) return EMPTY_LAYOUT

  // 词序由 start_idx 决定，不信输入数组的顺序
  const ordered = [...rawNodes].sort((a, b) => {
    const sa = Number.isFinite(a.start_idx) ? a.start_idx : 0
    const sb = Number.isFinite(b.start_idx) ? b.start_idx : 0
    if (sa !== sb) return sa - sb
    return (a.id ?? 0) - (b.id ?? 0)
  })

  const byId = new Map<number, DependencyNodeLike>()
  for (const n of ordered) byId.set(n.id, n)

  const leafIndexOf = new Map<number, number>()
  ordered.forEach((n, i) => leafIndexOf.set(n.id, i))

  // 有效上级：必须是真实存在的节点，且不能是自己（自指 = 根）
  const parentOf = new Map<number, number | null>()
  for (const n of ordered) {
    const head = n.head_id
    const valid = typeof head === "number" && head !== n.id && byId.has(head)
    parentOf.set(n.id, valid ? head : null)
  }

  // ── 深度：从「没有有效上级」的词出发做 BFS ──────────────────────────────
  // 环（互为父子）会让递归爆栈，所以用 visited 集合兜住。
  const childOf = new Map<number, number[]>()
  for (const n of ordered) childOf.set(n.id, [])
  for (const n of ordered) {
    const p = parentOf.get(n.id)
    // Map.get 的 undefined 与「没有上级」的 null 是两回事，必须分开收窄
    if (typeof p === "number") childOf.get(p)!.push(n.id)
  }

  const depthOf = new Map<number, number>()
  const roots = ordered.filter((n) => parentOf.get(n.id) === null).map((n) => n.id)
  // 全是环（没有任何无父节点）时，用声明的 root 当入口，再退到第一个词
  const seed = roots.length > 0
    ? roots
    : [typeof analysis?.root === "number" && byId.has(analysis.root) ? analysis.root : ordered[0].id]

  const queue: Array<{ id: number; depth: number }> = seed.map((id) => ({ id, depth: 0 }))
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    const seen = depthOf.get(id)
    // 同一个词可能从多条路径到达；保留更浅的深度，并且不重复展开
    if (seen !== undefined) continue
    depthOf.set(id, depth)
    for (const c of childOf.get(id) ?? []) {
      if (!depthOf.has(c)) queue.push({ id: c, depth: depth + 1 })
    }
  }

  const nodes: LayoutNode[] = ordered.map((n, i) => {
    const headId = parentOf.get(n.id) ?? null
    return {
      id: n.id,
      word: n.word ?? "",
      dep: n.dep ?? "",
      pos: n.pos ?? "",
      leafIndex: i,
      // 理论上 BFS 覆盖所有节点；真出现孤儿时按根处理，绝不输出 NaN
      depth: depthOf.get(n.id) ?? 0,
      isRoot: headId === null,
      headId: headId !== null && leafIndexOf.has(headId) ? headId : null,
    }
  })

  const arcs: LayoutArc[] = []
  for (const n of ordered) {
    const headId = parentOf.get(n.id)
    if (typeof headId !== "number") continue
    const headLeaf = leafIndexOf.get(headId)
    const depLeaf = leafIndexOf.get(n.id)
    if (headLeaf === undefined || depLeaf === undefined || headLeaf === depLeaf) continue
    arcs.push({
      from: Math.min(headLeaf, depLeaf),
      to: Math.max(headLeaf, depLeaf),
      headLeafIndex: headLeaf,
      depLeafIndex: depLeaf,
      label: n.dep ?? "",
      labelZh: depLabelZh(n.dep),
      level: 0,
    })
  }

  // ── 定层 ────────────────────────────────────────────────────────────────
  const bySpanAsc = [...arcs].sort((a, b) => {
    const spanDiff = (a.to - a.from) - (b.to - b.from)
    if (spanDiff !== 0) return spanDiff
    return a.from - b.from
  })
  const levelSlots: LayoutArc[][] = []
  for (const arc of bySpanAsc) {
    let level = 0
    while (levelSlots[level]?.some((placed) => overlaps(placed, arc))) level++
    arc.level = level
    if (!levelSlots[level]) levelSlots[level] = []
    levelSlots[level].push(arc)
  }

  return {
    nodes,
    arcs,
    maxLevel: levelSlots.length - 1,
    sentence: analysis?.sentence ?? "",
  }
}

/**
 * 依存关系 → 中文标签。
 *
 * 标注来自 spaCy，混着 v2/v3 两代命名（`attr`/`dobj` 是 v2，`obj`/`acl` 是 v3），
 * 所以两代的写法都收。查不到的原样返回：宁可露一个英文标签，
 * 也不要让用户看到一个空白 —— 空白等于这条弧没有含义。
 */
const DEP_LABELS: Record<string, string> = {
  root: "谓语核心",
  // 主语 / 宾语 / 表语
  nsubj: "主语",
  nsubjpass: "被动主语",
  csubj: "从句主语",
  dobj: "宾语",
  obj: "宾语",
  iobj: "间接宾语",
  pobj: "介词宾语",
  attr: "表语",
  acomp: "主语补足语",
  oprd: "宾语补足语",
  dative: "双宾",
  // 谓语与动词结构
  aux: "助动词",
  auxpass: "被动助动词",
  cop: "系动词",
  neg: "否定",
  expl: "形式主语",
  // 修饰
  det: "限定词",
  predet: "前限定词",
  poss: "所有格",
  amod: "形容词修饰",
  advmod: "副词修饰",
  npadvmod: "名词性状语",
  nummod: "数词修饰",
  quantmod: "量词修饰",
  appos: "同位语",
  nmod: "名词修饰",
  // 介词 / 从句
  prep: "介词",
  case: "格标记",
  mark: "从句标记",
  ccomp: "宾语从句",
  xcomp: "补语从句",
  acl: "修饰从句",
  relcl: "定语从句",
  advcl: "状语从句",
  parataxis: "并列分句",
  // 并列与连接
  conj: "并列成分",
  cc: "并列连词",
  // 其它
  punct: "标点",
  compound: "复合词",
  prt: "动词小品词",
  agent: "施事",
  vocative: "呼语",
  discourse: "话语标记",
  intj: "感叹",
  meta: "元信息",
  dep: "依存",
}

export function depLabelZh(dep: string | null | undefined): string {
  if (typeof dep !== "string") return ""
  const trimmed = dep.trim()
  if (!trimmed) return ""
  return DEP_LABELS[trimmed.toLowerCase()] ?? trimmed
}

/** 全量标签表（供图例/提示复用，避免 UI 里再抄一份）。 */
export { DEP_LABELS }
