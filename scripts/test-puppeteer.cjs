require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") })
const C = process.env.JULEBU_COOKIE, puppeteer = require("/tmp/puppeteer-tmp/node_modules/puppeteer")

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new", args: ["--no-sandbox", "--window-size=1280,800"]
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })

  for (const pair of C.split(";").map(c => c.trim())) {
    const eq = pair.indexOf("=")
    if (eq === -1) continue
    const n = pair.slice(0, eq).trim()
    if (!n.startsWith("__Secure-julebu")) continue
    await page.setCookie({ name: n, value: pair.slice(eq + 1).trim(), domain: ".julebu.co", path: "/", secure: true, sameSite: "Lax" })
  }

  let captured = null
  page.on("response", async (r) => {
    if (!r.url().includes("courses.findOne")) return
    try {
      const text = await r.text()
      for (const item of JSON.parse(text)) {
        const j = item?.result?.data?.json
        if (j?.sentences?.length > 0) captured = { id: j.id, title: j.title, count: j.sentences.length, first: j.sentences[0] }
      }
    } catch {}
  })

  console.log("Navigating...")
  await page.goto(
    "https://julebu.co/game/course/rwtocajplud9ld732ep5u8ec/r0h3kjyefkttp47tijduvvlc?mode=chinese_to_english&presetKey=advanced",
    { waitUntil: "networkidle2", timeout: 30000 }
  )

  for (let w = 0; w < 20; w++) { await new Promise(r => setTimeout(r, 1000)); if (captured) break }

  if (captured) {
    console.log("✅ 成功! 课程:", captured.title, "句子:", captured.count)
    console.log("第一句:", JSON.stringify(captured.first).slice(0, 300))
  } else {
    console.log("❌ 未捕获")
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 500))
    console.log("Body:", body)
  }
  await browser.close()
}
main().catch(e => { console.error("Error:", e.message); process.exit(1) })
