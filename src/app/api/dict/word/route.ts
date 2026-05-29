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
        const code = t.language?.code
        if ((code === "cmn" || code === "zh") && t.word) {
          if (!translations.includes(t.word)) translations.push(t.word)
        }
      }
    }
  }

  return {
    phonetic,
    phoneticUk,
    pos: pos.slice(0, 20),
    translations: translations.slice(0, 30),
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
