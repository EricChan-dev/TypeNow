/**
 * 后台表格的约定：**每张表都要能横向滚动，每个操作列都要固定**。
 *
 * ── 为什么值得写一条闸门 ────────────────────────────────────────────────────
 *
 * 这两件事是同一个可用性问题的两半，而且都容易在新增页面时漏掉：
 *
 *   · 列一多，Ant Design 的表格会把内容挤进容器宽度 —— 表头折行、按钮被裁掉。
 *     实测 6 列时「添加时间」被折成三行、最右的「删除」按钮有一半在容器外。
 *   · 加了横向滚动之后，如果不把操作列固定，用户向右滚动就看不到按钮了。
 *
 * 后台有 15 张表，逐个手改必然会漏（加这张表的人不一定会想起那 14 张）。
 * 所以这里用源码扫描把它变成一条可检查的约定 —— 新增表格时会直接失败。
 *
 * 注意扫描要跳过字符串与嵌套括号：标签里含箭头函数和 JS 字符串，
 * 朴素正则会在这里出错（改这批文件时先用正则试过，确实出错）。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

const ADMIN_DIR = path.join(process.cwd(), "src/app/admin")

function adminPages(dir: string = ADMIN_DIR): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...adminPages(full))
    else if (entry.name.endsWith(".tsx")) out.push(full)
  }
  return out
}

/** 从 `<` 开始找到该标签的结束 `>`，跳过字符串与嵌套的 {} / ()。 */
function tagEnd(src: string, start: number): number {
  let depth = 0
  let j = start
  while (j < src.length) {
    const c = src[j]
    if (c === '"' || c === "'") {
      const quote = c
      j++
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\") j++
        j++
      }
    } else if (c === "{" || c === "(") depth++
    else if (c === "}" || c === ")") depth--
    else if (c === ">" && depth === 0) return j
    j++
  }
  throw new Error("标签未闭合")
}

/** 对象字面量的结束位置（从 `{` 之后开始扫到配对的 `}`）。 */
function objectEnd(src: string, openBrace: number): number {
  let depth = 0
  let j = openBrace
  while (j < src.length) {
    const c = src[j]
    if (c === '"' || c === "'") {
      const quote = c
      j++
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\") j++
        j++
      }
    } else if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return j
    }
    j++
  }
  throw new Error("对象未闭合")
}

interface Finding {
  file: string
  line: number
  kind: "table" | "action"
  text: string
}

function scan(): { tables: Finding[]; actions: Finding[] } {
  const tables: Finding[] = []
  const actions: Finding[] = []
  for (const file of adminPages()) {
    const src = fs.readFileSync(file, "utf8")
    const rel = path.relative(process.cwd(), file)
    const lineOf = (idx: number) => src.slice(0, idx).split("\n").length

    for (const m of src.matchAll(/<Table(?=[\s>])/g)) {
      const i = m.index!
      const j = tagEnd(src, i)
      tables.push({ file: rel, line: lineOf(i), kind: "table", text: src.slice(i, j + 1) })
    }

    // JSX 形式的操作列
    for (const m of src.matchAll(/<Table\.Column\b/g)) {
      const i = m.index!
      const j = tagEnd(src, i)
      const tag = src.slice(i, j + 1)
      if (tag.includes('title="操作"')) {
        actions.push({ file: rel, line: lineOf(i), kind: "action", text: tag })
      }
    }

    // 对象形式的操作列（columns 是独立数组时用这种写法）
    for (const m of src.matchAll(/title: "操作",/g)) {
      const i = m.index!
      // 往外扩到包含它的那个对象：向前找最近的未配对 '{'
      let open = i
      let depth = 0
      while (open > 0) {
        const c = src[open]
        if (c === "}") depth++
        else if (c === "{") {
          if (depth === 0) break
          depth--
        }
        open--
      }
      const end = objectEnd(src, open)
      actions.push({ file: rel, line: lineOf(i), kind: "action", text: src.slice(open, end + 1) })
    }
  }
  return { tables, actions }
}

describe("后台表格约定", () => {
  const { tables, actions } = scan()

  it("扫描到了表格（防止扫描逻辑失效后变成空断言）", () => {
    expect(tables.length).toBeGreaterThanOrEqual(15)
    expect(actions.length).toBeGreaterThanOrEqual(5)
  })

  it("每张表都设置了 scroll —— 否则列多时内容会被挤压", () => {
    const bad = tables.filter((t) => !t.text.includes("scroll"))
    expect(
      bad.map((b) => `${b.file}:${b.line}`),
      "缺 scroll={{ x: ... }} 的表格",
    ).toEqual([])
  })

  it("每个操作列都固定了 —— 否则横向滚动后按钮会滑出视野", () => {
    const bad = actions.filter((a) => !a.text.includes("fixed"))
    expect(
      bad.map((b) => `${b.file}:${b.line}`),
      "缺 fixed=\"right\" 的操作列",
    ).toEqual([])
  })
})
