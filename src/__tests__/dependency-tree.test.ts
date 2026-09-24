/**
 * 依存句子树的排版计算。
 *
 * 存在的理由：`dependency_analysis` 覆盖率 95%，但前端一次都没渲染过，
 * 是最典型「数据已就位、代码没用过」的一项。而它又必须算得对才敢画：
 * 弧线一旦交叉，语法关系就读不出来了，比不画还糟。
 *
 * 这里只做纯计算（谁挂在谁下面、每条弧放在第几层），渲染交给组件，
 * 这样排版规则可以被单测锁住，不用靠肉眼看图。
 */
import { describe, it, expect } from "vitest"
import {
  buildDependencyLayout,
  depLabelZh,
  type DependencyAnalysisLike,
  type DependencyNodeLike,
} from "@/lib/dependency-tree"

/**
 * 固定装置一定带 nodes，所以单独收窄返回类型。
 * `nodes` 在生产类型里是可选的（DB 的 JSON 不可信），但测试里不该为它加 `!`。
 */
type FixtureTree = DependencyAnalysisLike & { nodes: DependencyNodeLike[] }

/** 造一棵最小的树：this(0) / is(1) / Green(2)，is 是根。 */
function miniTree(): FixtureTree {
  return {
    root: 1,
    sentence: "this is Green",
    nodes: [
      { id: 0, word: "this", dep: "nsubj", pos: "PRON", head_id: 1, start_idx: 0, end_idx: 0, children: [] },
      { id: 1, word: "is", dep: "ROOT", pos: "AUX", head_id: 1, start_idx: 1, end_idx: 1, children: [0, 2] },
      { id: 2, word: "Green", dep: "attr", pos: "PROPN", head_id: 1, start_idx: 2, end_idx: 2, children: [] },
    ],
    edges: [
      { source: 1, target: 0, label: "nsubj" },
      { source: 1, target: 2, label: "attr" },
    ],
  }
}

describe("buildDependencyLayout — 叶子顺序", () => {
  it("按 start_idx 排成句中词序，而不是按输入数组顺序", () => {
    const tree = miniTree()
    tree.nodes = [tree.nodes[2], tree.nodes[0], tree.nodes[1]]
    const layout = buildDependencyLayout(tree)
    expect(layout.nodes.map((n) => n.word)).toEqual(["this", "is", "Green"])
    expect(layout.nodes.map((n) => n.leafIndex)).toEqual([0, 1, 2])
  })

  it("标记出根节点", () => {
    const layout = buildDependencyLayout(miniTree())
    expect(layout.nodes.filter((n) => n.isRoot).map((n) => n.word)).toEqual(["is"])
  })

  it("深度按距根的距离算：根是 0，直接依存于根的是 1", () => {
    const layout = buildDependencyLayout(miniTree())
    const byWord = Object.fromEntries(layout.nodes.map((n) => [n.word, n.depth]))
    expect(byWord).toEqual({ is: 0, this: 1, Green: 1 })
  })

  it("多层嵌套时深度逐层递增", () => {
    const layout = buildDependencyLayout({
      root: 0,
      nodes: [
        { id: 0, word: "a", dep: "ROOT", pos: "VERB", head_id: 0, start_idx: 0, end_idx: 0 },
        { id: 1, word: "b", dep: "nsubj", pos: "NOUN", head_id: 0, start_idx: 1, end_idx: 1 },
        { id: 2, word: "c", dep: "det", pos: "DET", head_id: 1, start_idx: 2, end_idx: 2 },
      ],
    })
    const byWord = Object.fromEntries(layout.nodes.map((n) => [n.word, n.depth]))
    expect(byWord).toEqual({ a: 0, b: 1, c: 2 })
  })
})

describe("buildDependencyLayout — 弧线分层（决定图能不能读）", () => {
  it("互不重叠的弧可以共用同一层", () => {
    // a b c d：a→b 与 c→d 两段完全不重叠，应该都落在第 0 层
    const layout = buildDependencyLayout({
      root: 0,
      nodes: [
        { id: 0, word: "a", dep: "ROOT", pos: "VERB", head_id: 0, start_idx: 0, end_idx: 0 },
        { id: 1, word: "b", dep: "nsubj", pos: "NOUN", head_id: 0, start_idx: 1, end_idx: 1 },
        { id: 2, word: "c", dep: "ROOT", pos: "VERB", head_id: 0, start_idx: 2, end_idx: 2 },
        { id: 3, word: "d", dep: "dobj", pos: "NOUN", head_id: 2, start_idx: 3, end_idx: 3 },
      ],
    })
    const arcByLabel = Object.fromEntries(layout.arcs.map((a) => [a.label, a.level]))
    expect(arcByLabel.nsubj).toBe(0)
    expect(arcByLabel.dobj).toBe(0)
  })

  it("互相嵌套的弧必须分层，否则两条线会重叠在一起", () => {
    // a b c：a→c 跨过 b，b 又挂在 c 上 —— 两条弧必然嵌套
    const layout = buildDependencyLayout({
      root: 0,
      nodes: [
        { id: 0, word: "a", dep: "ROOT", pos: "VERB", head_id: 0, start_idx: 0, end_idx: 0 },
        { id: 1, word: "b", dep: "det", pos: "DET", head_id: 2, start_idx: 1, end_idx: 1 },
        { id: 2, word: "c", dep: "nsubj", pos: "NOUN", head_id: 0, start_idx: 2, end_idx: 2 },
      ],
    })
    const levels = layout.arcs.map((a) => a.level).sort()
    expect(levels).toEqual([0, 1])
    expect(layout.maxLevel).toBe(1)
  })

  it("弧的两端按词序摆好，左侧永远在左（不依赖父子谁前谁后）", () => {
    const layout = buildDependencyLayout(miniTree())
    const attr = layout.arcs.find((a) => a.label === "attr")!
    // attr 的 head 是 is(1)、依存是 Green(2)，方向是 右挂左 → 从左往右
    expect(attr.from).toBe(1)
    expect(attr.to).toBe(2)
    const nsubj = layout.arcs.find((a) => a.label === "nsubj")!
    // nsubj 的 head 是 is(1)、依存是 this(0)，两端顺序相反
    expect(Math.min(nsubj.from, nsubj.to)).toBe(0)
    expect(Math.max(nsubj.from, nsubj.to)).toBe(1)
  })

  it("ROOT 节点自己不是一条弧（根没有上级）", () => {
    const layout = buildDependencyLayout(miniTree())
    expect(layout.arcs).toHaveLength(2)
    expect(layout.arcs.some((a) => a.label === "ROOT")).toBe(false)
  })

  it("弧上带的 headWord 便于标注「谁修饰谁」", () => {
    const layout = buildDependencyLayout(miniTree())
    const nsubj = layout.arcs.find((a) => a.label === "nsubj")!
    expect(layout.nodes[nsubj.headLeafIndex].word).toBe("is")
  })
})

describe("buildDependencyLayout — 脏数据与降级", () => {
  it("没有分析结果 → 空排版，不抛异常", () => {
    for (const bad of [null, undefined, {} as DependencyAnalysisLike]) {
      const layout = buildDependencyLayout(bad as DependencyAnalysisLike)
      expect(layout.nodes).toEqual([])
      expect(layout.arcs).toEqual([])
      expect(layout.maxLevel).toBe(-1)
    }
  })

  it("nodes 为空数组 → 空排版", () => {
    const layout = buildDependencyLayout({ root: 0, nodes: [], edges: [] })
    expect(layout.nodes).toEqual([])
    expect(layout.maxLevel).toBe(-1)
  })

  it("head_id 指向不存在的节点时，该词当成根处理，不会死循环", () => {
    const layout = buildDependencyLayout({
      root: 0,
      nodes: [
        { id: 0, word: "a", dep: "ROOT", pos: "VERB", head_id: 0, start_idx: 0, end_idx: 0 },
        { id: 1, word: "b", dep: "nsubj", pos: "NOUN", head_id: 99, start_idx: 1, end_idx: 1 },
      ],
    })
    expect(layout.nodes).toHaveLength(2)
    expect(layout.nodes.find((n) => n.word === "b")!.depth).toBe(0)
    expect(layout.arcs).toHaveLength(0)
  })

  it("互相指认父子（环）时不死循环", () => {
    const layout = buildDependencyLayout({
      root: 0,
      nodes: [
        { id: 0, word: "a", dep: "ROOT", pos: "VERB", head_id: 1, start_idx: 0, end_idx: 0 },
        { id: 1, word: "b", dep: "nsubj", pos: "NOUN", head_id: 0, start_idx: 1, end_idx: 1 },
      ],
    })
    expect(layout.nodes).toHaveLength(2)
    expect(layout.nodes.every((n) => Number.isFinite(n.depth))).toBe(true)
  })

  it("起点与终点同一个词的弧被丢弃（画不出任何东西）", () => {
    const layout = buildDependencyLayout({
      root: 0,
      nodes: [{ id: 0, word: "a", dep: "ROOT", pos: "VERB", head_id: 0, start_idx: 0, end_idx: 0 }],
    })
    expect(layout.arcs).toEqual([])
  })
})

describe("depLabelZh — 依存关系的中文标签", () => {
  it("常见关系有中文标签", () => {
    expect(depLabelZh("nsubj")).toBe("主语")
    expect(depLabelZh("ROOT")).toBe("谓语核心")
    expect(depLabelZh("dobj")).toBe("宾语")
    expect(depLabelZh("det")).toBe("限定词")
    expect(depLabelZh("amod")).toBe("形容词修饰")
    expect(depLabelZh("punct")).toBe("标点")
  })

  it("大小写与空白容错", () => {
    expect(depLabelZh(" NSUBJ ")).toBe("主语")
    expect(depLabelZh("root")).toBe("谓语核心")
  })

  it("没收录的标签原样返回，绝不返回空串 —— 宁可露英文，也不要让用户看到一个空白标签", () => {
    expect(depLabelZh("weird_label")).toBe("weird_label")
    expect(depLabelZh("")).toBe("")
    expect(depLabelZh(null)).toBe("")
  })
})
