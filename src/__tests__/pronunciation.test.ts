/**
 * 跟读评分的响应映射、错误翻译与失败文案（src/lib/pronunciation.ts）。
 *
 * 这一处曾经**从未成功过**，所以测试里刻意包含两条防线：
 *   1. 用官方文档给出的响应结构验证字段映射（旧代码读的是 result.* 与
 *      words[].content/accuracy，与文档完全不同）；
 *   2. 用源码断言钉住「接口地址/参数不能再写回旧的那一套」——
 *      旧实现打的 speechevaluateapi 实测返回 404，是个不存在的地址。
 *
 * 文档：https://ai.youdao.com/DOCSIRMA/html/tts/api/yypc/index.html
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  EVALUATE_UNCONFIGURED_CODE,
  describeEvaluateFailure,
  describeYoudaoError,
  isYoudaoSuccess,
  mapYoudaoEvaluate,
  youdaoErrorCode,
} from "@/lib/pronunciation"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

/**
 * 去掉注释后再做否定断言。
 *
 * 这一步必须有：这些文件的注释里**故意**写了旧实现用错的接口名与字段名
 * （"旧实现打的是 speechevaluateapi"、"读的是 result.accuracy"），
 * 直接对整个源码做 not.toContain 会把解释性文字当成代码，测试变成假红。
 * 只对真实代码做否定判断才是它该守的东西。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // 行注释：前面不是 ':' 才算（避免误伤 "https://…"）
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** 官方文档里的成功响应（截取我们读取的字段，含真实数值）。 */
const DOC_RESPONSE = {
  errorCode: "0",
  refText: "have a good day",
  integrity: 100,
  fluency: 100,
  pronunciation: 92.5,
  overall: 96.3,
  speed: 242.42,
  words: [
    { word: "have", pronunciation: 70.2 },
    { word: "a", pronunciation: 100 },
    { word: "good", pronunciation: 100 },
    { word: "day", pronunciation: 95.9 },
  ],
}

describe("youdaoErrorCode / isYoudaoSuccess", () => {
  it("成功判定按 errorCode === '0'（数字 0 也算）", () => {
    expect(youdaoErrorCode({ errorCode: "0" })).toBe("0")
    expect(youdaoErrorCode({ errorCode: 0 })).toBe("0")
    expect(isYoudaoSuccess({ errorCode: "0" })).toBe(true)
    expect(isYoudaoSuccess({ errorCode: "108" })).toBe(false)
  })

  it("没有 errorCode 时视为未知，而不是成功", () => {
    expect(youdaoErrorCode({})).toBeNull()
    expect(youdaoErrorCode(null)).toBeNull()
    expect(youdaoErrorCode("whatever")).toBeNull()
    expect(isYoudaoSuccess({})).toBe(false)
  })
})

describe("mapYoudaoEvaluate · 字段映射", () => {
  it("按文档取顶层字段（不是 result.*）", () => {
    const r = mapYoudaoEvaluate(DOC_RESPONSE)
    expect(r).not.toBeNull()
    expect(r!.score).toBe(96) // overall
    // 文档这份响应三个维度都给了，所以这是数字；缺字段的情形见下一条用例。
    expect(typeof r!.accuracy).toBe("number")
    expect(r!.accuracy).toBe(93) // pronunciation → 四舍五入
    expect(r!.fluency).toBe(100)
    expect(r!.integrity).toBe(100)
    expect(r!.speed).toBeCloseTo(242.42)
  })

  it("回归：响应里缺 fluency 时是 null，绝不兜底成 0", () => {
    // 这是「缺字段」与「得了 0 分」被混为一谈后代价最大的一处：
    // 评语规则是「该维度 < 75 就出短板建议」，而 JS 里 `0 < 75` 为真、`null < 75`
    // 也为真 —— 所以维度为 null 时不但字面显示成 0 分，还会被误判成短板，
    // 给一个字段缺失的用户生成「流利度偏低，试着连贯一些、少停顿。」并落库。
    const r = mapYoudaoEvaluate({
      errorCode: "0",
      overall: 90,
      pronunciation: 90,
      integrity: 100,
    })!
    expect(r.fluency).toBeNull()
    expect(r.fluency).not.toBe(0)
    // 同一份响应里给了的维度照常映射
    expect(r.accuracy).toBe(90)
    expect(r.integrity).toBe(100)
  })

  it("三个维度全缺时都是 null，而总分仍有值", () => {
    // 维度与总分是两套策略：维度没有兜底链，必须如实为 null；
    // 总分有 overall → pronunciation → integrity → 0 的链，必须仍是非空数字。
    const r = mapYoudaoEvaluate({ errorCode: "0", overall: 88 })!
    expect([r.accuracy, r.fluency, r.integrity]).toEqual([null, null, null])
    expect(r.score).toBe(88)
  })

  it("词级分数取 words[].word 与 words[].pronunciation", () => {
    const r = mapYoudaoEvaluate(DOC_RESPONSE)!
    expect(r.words.map((w) => w.word)).toEqual(["have", "a", "good", "day"])
    expect(r.words[0].score).toBe(70)
    expect(r.words[3].score).toBe(96)
  })

  it("回归：词缺少 pronunciation 时是 null，绝不兜底成 0", () => {
    // 旧实现用 `?? 0`，字段一变就把整句词标成红色 0 分，用户以为全读错了。
    const r = mapYoudaoEvaluate({ errorCode: "0", words: [{ word: "hello" }] })!
    expect(r.words[0].score).toBeNull()
  })

  it("丢弃没有 word 的空条目（避免界面上出现无字标签）", () => {
    const r = mapYoudaoEvaluate({
      errorCode: "0",
      words: [{ pronunciation: 80 }, { word: "ok", pronunciation: 90 }],
    })!
    expect(r.words).toEqual([{ word: "ok", score: 90 }])
  })

  it("综合分按 overall → pronunciation → integrity 退让", () => {
    expect(mapYoudaoEvaluate({ errorCode: "0", overall: 88 })!.score).toBe(88)
    expect(mapYoudaoEvaluate({ errorCode: "0", pronunciation: 77 })!.score).toBe(77)
    expect(mapYoudaoEvaluate({ errorCode: "0", integrity: 66 })!.score).toBe(66)
  })

  it("非成功响应返回 null —— 调用方必须判空，不能用 0 分冒充结果", () => {
    expect(mapYoudaoEvaluate({ errorCode: "108" })).toBeNull()
    expect(mapYoudaoEvaluate({ errorCode: "0", overall: undefined, words: [] })).not.toBeNull()
    expect(mapYoudaoEvaluate(null)).toBeNull()
  })

  it("words 不是数组时不抛错，返回空数组", () => {
    expect(mapYoudaoEvaluate({ errorCode: "0", words: "oops" })!.words).toEqual([])
  })

  it("speed 缺失时为 null（界面据此不显示语速，而不是显示 0 词/分）", () => {
    expect(mapYoudaoEvaluate({ errorCode: "0" })!.speed).toBeNull()
  })
})

describe("describeYoudaoError · 错误分类", () => {
  it("配置类 → 503 + unconfigured（重试没有意义）", () => {
    for (const code of ["108", "110", "111", "202", "203", "401"]) {
      const v = describeYoudaoError(code)
      expect(v.status).toBe(503)
      expect(v.retriable).toBe(false)
      expect(v.code).toBe(EVALUATE_UNCONFIGURED_CODE)
    }
    // 203 是有道侧的 IP 白名单 —— 换机器部署时最容易踩，提示要点明
    expect(describeYoudaoError("203").reason).toContain("IP")
  })

  it("音频类 → 400（是客户端该修的，重试同一段音频没用）", () => {
    // 11001 与 11003 是实测得到的：传 mp3 得 11001、channel=2 得 11003
    for (const code of ["11001", "11002", "11003", "3001", "3002", "3003", "9002"]) {
      expect(describeYoudaoError(code).status).toBe(400)
      expect(describeYoudaoError(code).retriable).toBe(false)
    }
  })

  it("录音太短/无有效语音 → 400 且给出可照做的提示", () => {
    expect(describeYoudaoError("11010").reason).toContain("太短")
    expect(describeYoudaoError("11011").reason).toContain("有效语音")
  })

  it("限流类 → 429 且可重试", () => {
    for (const code of ["411", "2411", "9411", "11303"]) {
      const v = describeYoudaoError(code)
      expect(v.status).toBe(429)
      expect(v.retriable).toBe(true)
    }
  })

  it("其余服务端异常 → 502 且可重试", () => {
    const v = describeYoudaoError("303")
    expect(v.status).toBe(502)
    expect(v.retriable).toBe(true)
    expect(describeYoudaoError(null).status).toBe(502)
  })
})

describe("describeEvaluateFailure · 客户端话术", () => {
  it("超时优先判定，不会被当成网络故障", () => {
    const v = describeEvaluateFailure(null, null, { timedOut: true })
    expect(v.title).toContain("耗时")
    expect(v.canRetry).toBe(true)
  })

  it("未配置（code 或 503）→ 明确说服务未配置，且不给重试按钮", () => {
    const byCode = describeEvaluateFailure(500, { code: EVALUATE_UNCONFIGURED_CODE })
    expect(byCode.canRetry).toBe(false)
    expect(byCode.title).toContain("暂未开放")
    expect(describeEvaluateFailure(503, {}).canRetry).toBe(false)
  })

  it("429 → 说明今日次数用完，并提示会员有更多次数", () => {
    const v = describeEvaluateFailure(429, { error: "今日免费评测次数已用完（每天 3 次）" })
    expect(v.title).toContain("次数")
    expect(v.detail).toContain("每天 3 次")
  })

  it("400 / 413 → 归到「这段录音无法评分」并建议重录", () => {
    expect(describeEvaluateFailure(400, {}).title).toContain("录音")
    expect(describeEvaluateFailure(413, {}).canRetry).toBe(true)
  })

  it("401 → 请先登录", () => {
    expect(describeEvaluateFailure(401, {}).title).toContain("登录")
  })

  it("status 为 null → 网络故障，可重试", () => {
    const v = describeEvaluateFailure(null, null)
    expect(v.title).toContain("网络")
    expect(v.canRetry).toBe(true)
  })

  it("透出服务端给的原因（否则用户只看到一句无从下手的通用文案）", () => {
    const v = describeEvaluateFailure(502, { error: "有道服务端异常" })
    expect(v.detail).toBe("有道服务端异常")
  })
})

describe("源码约束：不许写回旧的那一套（防回退）", () => {
  const route = read("src/app/api/youdao/evaluate/route.ts")
  // 否定判断只看代码，不看注释（注释里正是要说明旧实现错在哪）
  const routeCode = stripComments(route)

  it("接口地址是 iseapi —— speechevaluateapi 实测 404，不存在", () => {
    const urls = [...routeCode.matchAll(/fetch\(\s*"([^"]+)"/g)].map((m) => m[1])
    expect(urls).toContain("https://openapi.youdao.com/iseapi")
    expect(urls.some((u) => u.includes("speechevaluateapi"))).toBe(false)
  })

  it("参数按文档：signType=v2、type=1、没有 audioType", () => {
    expect(routeCode).toContain('signType: "v2"')
    expect(routeCode).toContain('type: "1"')
    // type=2 实测让有道返回 303；audioType 是文档里不存在的字段
    expect(routeCode).not.toContain("audioType")
    expect(routeCode).not.toContain('type: "2"')
  })

  it("未配置时回 503 + code，而不是笼统的 500", () => {
    expect(routeCode).toContain("EVALUATE_UNCONFIGURED_CODE")
    expect(routeCode).toContain("503")
  })

  it("调用有道带超时，避免一直转圈", () => {
    expect(routeCode).toContain("AbortSignal.timeout")
  })

  it("响应解析走纯函数（可单测），不在路由里手写字段名", () => {
    expect(routeCode).toContain("mapYoudaoEvaluate")
    // 旧实现是拿有道**原始响应**直接取字段（youdaoData.result.accuracy、
    // words[].content），而文档里这两个路径都不存在，于是永远读不到值。
    // 所以禁止的是「绕过映射函数去读原始 payload」；读**映射后**的 result
    // （result.accuracy）才是正确写法，不能一并禁掉 —— 这条规则只针对
    // youdaoData 这个名字上的属性访问，不针对 result。
    //
    // 用正则而不是字面量：`youdaoData?.result` 与 `youdaoData["result"]`
    // 都是同一处越界，而 `not.toContain("youdaoData.result")` 只挡得住第一种
    //（可选链与下标取值都能直接绕过去）。原始 payload 只允许整体传给
    // youdaoErrorCode / mapYoudaoEvaluate / JSON.stringify，不许取字段。
    expect(routeCode).not.toMatch(/youdaoData\s*\??\s*[.[]/)
    expect(routeCode).not.toContain(".content")
  })

  it("先读上一句评语、再覆盖写（顺序反了「不重复上一次评语」就永远不生效）", () => {
    // 评语规则要求"不与上一句相同"，而写入是 upsert —— 一旦先写后读，
    // 读到的永远是刚写进去的那句，previousComment 就等于本次评语，规则形同不存在。
    // 这条只能靠源码顺序钉住：直接调 store 的单测天然看不到路由里的先后。
    const readAt = routeCode.indexOf("getPreviousComment(")
    const writeAt = routeCode.indexOf("savePronunciationScore(")
    expect(readAt).toBeGreaterThan(-1)
    expect(writeAt).toBeGreaterThan(-1)
    expect(readAt).toBeLessThan(writeAt)
  })
})

describe("源码约束：录音侧必须真的产出 WAV", () => {
  const panelCode = stripComments(read("src/components/home/learn/VoicePanel.tsx"))

  it("录音后编码成 16k 单声道 WAV（不能再把 webm 当 wav 发出去）", () => {
    expect(panelCode).toContain("encodePcm16WavMono")
    expect(panelCode).toContain("OfflineAudioContext")
    expect(panelCode).toContain("EVALUATE_SAMPLE_RATE")
  })

  it("有特性探测与 mimeType 协商，不是硬编码 webm", () => {
    expect(panelCode).toContain("detectRecordingSupport")
    expect(panelCode).toContain("isTypeSupported")
    expect(panelCode).not.toContain('new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" })')
  })

  it("录音前停掉朗读（否则参考音被录进去会评出假高分）", () => {
    const idx = panelCode.indexOf("await navigator.mediaDevices.getUserMedia")
    expect(idx).toBeGreaterThan(-1)
    expect(panelCode.slice(0, idx)).toContain("stopSpeaking()")
  })

  it("定时器被保存并清理（旧实现的定时器会把下一次录音掐断）", () => {
    expect(panelCode).toContain("stopTimerRef")
    expect(panelCode).toContain("clearTimers")
    expect(panelCode).toContain("clearTimeout")
  })

  it("卸载时释放麦克风并作废这次录音", () => {
    expect(panelCode).toContain("discardRef")
    expect(panelCode).toContain("releaseStream")
    expect(panelCode).toContain("getTracks().forEach")
  })

  it("上传的 sentenceId 是**练习项自己的 id**，不能改写成原句 id", () => {
    // 跟读分按**练习项**存：有 chunks 的句子会被 LearnClient 展开成
    // `<原句 id>_c<order>`（expandSentences），而每个分块是独立朗读、独立评分的
    // 一段文字，各有各的一行。若在这里统一改写成 baseSentenceId(sentence.id)，
    // 一句 3 个分块就只剩一个分数格 —— 录完分块 1 再录分块 2 会把前一个覆盖掉。
    // 所以这里断言"没有发生那次改写"，而不只是断言某个字符串存在。
    expect(panelCode).toContain("const sentenceId = sentence.id")
    expect(panelCode).not.toContain("baseSentenceId(sentence.id)")
  })
})
