import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { wordDictionaryCache, wordbookItems } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"

type RawEntry = {
  language?: { code?: string; name?: string }
  partOfSpeech?: string
  pronunciations?: { type?: string; text?: string; tags?: string[] }[]
  forms?: { word?: string; tags?: string[] }[]
  senses?: {
    definition?: string
    examples?: string[]
    synonyms?: string[]
    antonyms?: string[]
    translations?: { language?: { code?: string; name?: string }; word?: string }[]
  }[]
}

type RawResponse = {
  word?: string
  entries?: RawEntry[]
}

/**
 * 上游（freedictionaryapi.com）把「中文」这一坨混在一起，只按 code 过滤会取到垃圾。
 *
 * 实测 tomorrow 的上游响应有 468 条 translation、约 200 种语言，其中
 * `language.code === "zh"` 的条目既包含我们要的普通话，也包含**根本不是中文**的：
 *
 *   {code:"zh", name:"Chinese",          word:"минтян"}   ← 西里尔字母（鞑靼语一类被误标成 zh）
 *   {code:"zh", name:"Chinese",          word:"мир"}
 *   {code:"zh", name:"Chinese",          word:"миргә"}
 *   {code:"zh", name:"Chinese",          word:"明仔日"}    ← 闽南语
 *   {code:"zh", name:"Chinese",          word:"明仔载"}
 *   {code:"zh", name:"Chinese Mandarin", word:"明天"}      ← 这才是要的
 *
 * 而原来的实现只看 code、按顺序取前 5 条，于是界面上出现了
 * 「минтян；мир；миргә；明仔日；明仔载」这种四不像。
 *
 * 所以这里加三道闸：
 *   1. **普通话优先**：name 含 "Mandarin"（或 code 为 cmn）的排最前，
 *      有普通话就别用那个大杂烩的 "Chinese" 桶；
 *   2. **必须含汉字**：滤掉西里尔/纯拉丁拼写 —— "中文释义"里不该出现 "минтян"；
 *   3. 繁简并存的形式（"明兒 /明儿"）取斜杠后的简体。
 */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function isMandarin(t: { language?: { code?: string; name?: string } }): boolean {
  const code = (t.language?.code ?? "").toLowerCase()
  const name = (t.language?.name ?? "").toLowerCase()
  return code === "cmn" || name.includes("mandarin")
}

/** 只保留真正含汉字的条目，并把「繁 /简」取简体那一半。 */
export function cleanChineseWord(word: string): string | null {
  let w = word.trim()
  if (!w) return null
  // 上游用 "AA /BB" 表示「繁体 /简体」。取后半（简体）——
  // 本站面向简体用户，展示 "明兒 /明儿" 这种双写反而像数据坏了。
  // 只有一侧有内容时（"明天/"、"/明天"）就用那一侧：否则斜杠会被留在释义里。
  if (w.includes("/")) {
    const parts = w.split("/").map((x) => x.trim()).filter(Boolean)
    if (parts.length >= 1) w = parts[parts.length - 1]
  }
  if (!CJK_RE.test(w)) return null
  return w
}

function pickPhonetic(entries: RawEntry[], wanted: "us" | "uk"): string | null {
  const usTags = ["General American", "GenAm", "American"]
  const ukTags = ["Received Pronunciation", "RP", "British"]
  const wantedTags = wanted === "us" ? usTags : ukTags
  for (const e of entries) {
    for (const p of e.pronunciations ?? []) {
      if (p.type !== "ipa" || !p.text) continue
      if ((p.tags ?? []).some((t) => wantedTags.includes(t))) return p.text
    }
  }
  // fallback: first IPA available
  if (wanted === "us") {
    for (const e of entries) {
      for (const p of e.pronunciations ?? []) {
        if (p.type === "ipa" && p.text) return p.text
      }
    }
  }
  return null
}

function parseDictionary(raw: RawResponse) {
  const entries = raw.entries ?? []
  const phonetic = pickPhonetic(entries, "us")
  const phoneticUk = pickPhonetic(entries, "uk")

  const pos: { pos: string; meaning: string }[] = []
  const translations: string[] = []
  /** 普通话释义单独攒：大杂烩的 "Chinese" 桶（含闽南语等）不能排在它前面 */
  const mandarin: string[] = []
  const synonyms = new Set<string>()
  const examples: { en: string; zh: string }[] = []

  for (const e of entries) {
    const partOfSpeech = e.partOfSpeech ?? ""
    for (const s of e.senses ?? []) {
      if (s.definition) {
        pos.push({ pos: partOfSpeech, meaning: s.definition })
      }
      for (const syn of s.synonyms ?? []) {
        if (syn) synonyms.add(syn)
      }
      for (const ex of s.examples ?? []) {
        if (ex) examples.push({ en: ex, zh: "" })
      }
      for (const t of s.translations ?? []) {
        const code = (t.language?.code ?? "").toLowerCase()
        if ((code === "cmn" || code === "zh") && t.word) {
          const cleaned = cleanChineseWord(t.word)
          if (!cleaned) continue
          // 普通话优先：先分开攒、最后合并 ——
          // 否则那个大杂烩的 "Chinese" 桶（含闽南语）会插在普通话前面
          if (isMandarin(t)) mandarin.push(cleaned)
          else if (!translations.includes(cleaned)) translations.push(cleaned)
        }
      }
    }
  }

  return {
    phonetic,
    phoneticUk,
    pos: pos.slice(0, 20),
    // 有普通话就**只用**普通话：那个大杂烩的 "Chinese" 桶里混着闽南语
    // （明仔日 / 明仔载）—— 是汉字但不是普通话，作为"中文释义"展示会误导
    // 一个在学普通话的人。只有整条词目都不含普通话时才回退到通用桶。
    translations: Array.from(new Set(mandarin.length > 0 ? mandarin : translations)).slice(0, 30),
    synonyms: Array.from(synonyms).slice(0, 20),
    examples: examples.slice(0, 6),
  }
}

async function fetchFreeDictionary(word: string) {
  const url = `https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(word)}?translations=true`
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  })
  if (!res.ok) return { ok: false as const, status: res.status }
  const data = (await res.json()) as RawResponse
  return { ok: true as const, data }
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })

  const rawWord = request.nextUrl.searchParams.get("word") ?? ""
  const word = rawWord.trim().toLowerCase()
  if (!word || word.length > 64 || !/^[a-z][a-z'\- ]*$/i.test(word)) {
    return NextResponse.json({ error: "invalid_word" }, { status: 400 })
  }

  const [cached] = await db
    .select()
    .from(wordDictionaryCache)
    .where(eq(wordDictionaryCache.word, word))
    .limit(1)

  const [inBook] = await db
    .select({ id: wordbookItems.id })
    .from(wordbookItems)
    .where(and(eq(wordbookItems.userId, session.userId), eq(wordbookItems.word, word)))
    .limit(1)

  if (cached) {
    return NextResponse.json({
      word,
      phonetic: cached.phonetic,
      phoneticUk: cached.phoneticUk,
      translations: cached.translations,
      pos: cached.pos,
      synonyms: cached.synonyms,
      examples: cached.examples,
      inWordbook: !!inBook,
      cached: true,
    })
  }

  const result = await fetchFreeDictionary(word)
  if (!result.ok) {
    if (result.status === 404) {
      return NextResponse.json({ error: "not_found", word, inWordbook: !!inBook }, { status: 404 })
    }
    return NextResponse.json({ error: "lookup_failed", status: result.status }, { status: 502 })
  }

  const parsed = parseDictionary(result.data)
  if (parsed.pos.length === 0 && parsed.translations.length === 0) {
    return NextResponse.json({ error: "empty_result", word, inWordbook: !!inBook }, { status: 404 })
  }

  await db.insert(wordDictionaryCache).values({
    word,
    phonetic: parsed.phonetic,
    phoneticUk: parsed.phoneticUk,
    translations: parsed.translations,
    pos: parsed.pos,
    synonyms: parsed.synonyms,
    examples: parsed.examples,
    webTranslations: null,
    raw: result.data as unknown as object,
  }).onDuplicateKeyUpdate({
    set: {
      phonetic: parsed.phonetic,
      phoneticUk: parsed.phoneticUk,
      translations: parsed.translations,
      pos: parsed.pos,
      synonyms: parsed.synonyms,
      examples: parsed.examples,
    },
  })

  return NextResponse.json({
    word,
    phonetic: parsed.phonetic,
    phoneticUk: parsed.phoneticUk,
    translations: parsed.translations,
    pos: parsed.pos,
    synonyms: parsed.synonyms,
    examples: parsed.examples,
    inWordbook: !!inBook,
    cached: false,
  })
}
