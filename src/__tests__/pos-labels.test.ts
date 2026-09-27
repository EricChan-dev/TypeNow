/**
 * 词性标签中文映射（src/lib/pos-labels.ts）。
 *
 * 为什么值得测：这个映射的输入是**生产库里真实存在的 UD 标签**（我从 3 万行
 * 样本里统计出来的 18 种），任何一个漏掉都会在界面上露出英文 ——
 * 而"界面上露出 VerB"正是用户报的问题。所以这里把那份清单钉死。
 */
import { describe, it, expect } from "vitest"
import { posLabel } from "@/lib/pos-labels"

/** 生产库 3 万行样本里实际出现的全部标签（按出现次数降序）。 */
const PRODUCTION_POS = [
  "NOUN",
  "VERB",
  "PRON",
  "DET",
  "ADP",
  "ADJ",
  "AUX",
  "ADV",
  "PART",
  "CCONJ",
  "PROPN_PERSON",
  "SCONJ",
  "NUM",
  "INTJ",
  "PROPN",
  "SYM",
  "X",
  "CONJ",
] as const

describe("posLabel：生产库出现过的标签全部有中文", () => {
  it("一个都不漏，且都不是原文", () => {
    for (const tag of PRODUCTION_POS) {
      const zh = posLabel(tag)
      expect(zh, `${tag} 没有中文映射`).toBeTruthy()
      expect(zh, `${tag} 仍显示英文`).not.toBe(tag)
      // 中文标签里不该再混进拉丁字母
      expect(zh).not.toMatch(/[A-Za-z]/)
    }
  })

  it("几个高频标签的具体译名", () => {
    expect(posLabel("NOUN")).toBe("名词")
    expect(posLabel("VERB")).toBe("动词")
    expect(posLabel("PRON")).toBe("代词")
    expect(posLabel("PROPN_PERSON")).toBe("人名")
  })
})

describe("posLabel：健壮性", () => {
  it("大小写混写也能命中（历史/导入数据出现过 'VerB' 这类写法）", () => {
    // 用户原话里看到的就是 "VerB"
    expect(posLabel("VerB")).toBe("动词")
    expect(posLabel("noun")).toBe("名词")
  })

  it("库里用来标记不可输入位的「标点」保持中文", () => {
    // getInputWords 用 `pos === "标点"` 判定是否可输入，展示层同样要认得它
    expect(posLabel("标点")).toBe("标点")
  })

  it("空白返回空串（调用方据此决定要不要渲染这一块）", () => {
    expect(posLabel("")).toBe("")
    expect(posLabel("   ")).toBe("")
    expect(posLabel(null)).toBe("")
    expect(posLabel(undefined)).toBe("")
  })

  it("未登记的新标签**原样返回**而不是糊成「未知」", () => {
    // UD 标签本身是标准化且有信息量的：露出原文比一律显示"未知"更有助于
    // 发现"上游加了新标签"，也让排查有线索
    expect(posLabel("NEW_TAG_2030")).toBe("NEW_TAG_2030")
  })

  it("不会因为前后空格而丢失映射", () => {
    expect(posLabel(" NOUN ")).toBe("名词")
  })
})
