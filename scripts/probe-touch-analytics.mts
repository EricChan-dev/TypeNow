/**
 * 浏览器探针：验证「触屏设备提示」这条测量链真的能产出数据。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 *
 * 埋点是**客户端**行为，而本仓库的单测跑在 node 环境（无 jsdom），
 * 因此 track() 到底有没有发出去、发的 properties 对不对，单测证明不了。
 * 之前做这类验证靠 puppeteer 临时脚本，但 puppeteer 已经不在依赖里了 ——
 * 也就是说仓库目前没有浏览器验证手段。
 *
 * 这个脚本用**系统 Chrome + 原生 CDP**（Node 内置 WebSocket），不引入任何依赖。
 *
 * ── 怎么跑 ──────────────────────────────────────────────────────────────────
 *
 *   pnpm e2e:db:up            # 起测试库（3399）
 *   npx tsx scripts/probe-touch-analytics.mts
 *
 * 环境变量与 e2e 一致（E2E_DATABASE_URL / E2E_PORT / TYPENOW_DIST_DIR）。
 *
 * ── 它验证什么 ──────────────────────────────────────────────────────────────
 *
 * 同一页面跑两次，构成一组**对照实验**：
 *   1. 桌面设备（matchMedia 报 pointer:fine / hover:hover）→ 不该出现提示，
 *      也不该有任何 touch_notice_* 事件；
 *   2. 触屏设备（覆盖 matchMedia 为 coarse/no-hover）→ 提示出现、
 *      两个事件都要落库，且 properties.device === "touch"。
 *
 * 只跑第 2 步证明不了什么 —— 事件可能是无条件发的。有第 1 步当对照，
 * 才能说明这个埋点真的在区分设备。
 *
 * ── 两个踩过的坑 ────────────────────────────────────────────────────────────
 *
 *   · **必须用 http://localhost，不能用 127.0.0.1。** Next 16 会对 127.0.0.1 源
 *     拦截 HMR，hydration 永不完成 —— 客户端组件根本不渲染，页面看起来"没报错但
 *     就是没有提示"（见 CLAUDE.md「本地开发要点」）。
 *   · 练习页需要 `?lesson=<id>`，否则会渲染「缺少课程信息」。
 */
import { spawn } from "node:child_process"
import { FIXTURE, seedFixtures, q } from "../tests/e2e/helpers/db"
import { startServer, stopServer } from "../tests/e2e/helpers/server"

const PORT = Number(process.env.E2E_PORT ?? 3311)
const BASE = `http://localhost:${PORT}`
const CDP_PORT = 9223
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PRACTICE_URL = `${BASE}/home/learn/${FIXTURE.coursePublished}?lesson=${FIXTURE.lessonA1}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 极简 CDP 客户端（Node 24 自带 WebSocket，无需 ws/puppeteer）。 */
class Cdp {
  private ws: WebSocket
  private id = 0
  private pending = new Map<number, (v: unknown) => void>()

  constructor(url: string) {
    this.ws = new WebSocket(url)
  }

  async ready(): Promise<void> {
    await new Promise<void>((res, rej) => {
      this.ws.addEventListener("open", () => res())
      this.ws.addEventListener("error", () => rej(new Error("CDP WebSocket 连接失败")))
    })
  }

  send<T = { result?: { value?: string } }>(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.id
    return new Promise<T>((res) => {
      this.pending.set(id, res as (v: unknown) => void)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** 注册一个只读的事件监听（用于抓控制台错误与网络请求）。 */
  on(listener: (msg: { method?: string; params?: Record<string, unknown> }) => void): void {
    this.ws.addEventListener("message", (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && this.pending.has(msg.id)) {
        // 注意层级：CDP 的**响应载荷**在 msg.result 下，
        // 即 { id, result: { result: { type, value } } }（外层是 CDP 包装，
        // 内层是 Runtime.evaluate 的返回值）。传整条 msg 出去会得到
        // 静默的 undefined —— 曾据此误判成"提示没渲染"。
        this.pending.get(msg.id)!(msg.result)
        this.pending.delete(msg.id)
        return
      }
      listener(msg)
    })
  }

  close() {
    this.ws.close()
  }
}

interface CaseResult {
  noticeRendered: boolean
  events: string[]
  props: Record<string, unknown>[]
}

/** 打开练习页、按需模拟触屏设备、点掉提示条，然后读回埋点结果。 */
async function runCase(cdp: Cdp, opts: { fakeTouch: boolean }): Promise<CaseResult> {
  await cdp.send("Page.navigate", {
    url: `${PRACTICE_URL}&forcetouch=${opts.fakeTouch ? "1" : "0"}`,
  })
  await sleep(6000)

  const probe = await cdp.send<Record<string, unknown>>("Runtime.evaluate", {
    returnByValue: true,
    expression: `document.body.innerText.includes('打字练习需要物理键盘')`,
  })
  const noticeRendered = (probe.result as { value?: unknown } | undefined)?.value === true

  // 提示在时才点：桌面用例里没有这个按钮，点了也没意义
  if (noticeRendered) {
    await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const btns = [...document.querySelectorAll('button[aria-label="关闭"]')]
        const btn = btns.find((b) => (b.closest('div')?.innerText || '').includes('物理键盘'))
        if (btn) btn.click()
        return !!btn
      })()`,
    })
    await sleep(2500)
  }

  const rows = (await q(
    "SELECT event_type, properties FROM analytics_events WHERE event_type LIKE 'touch_notice%' ORDER BY created_at",
    [],
  )) as { event_type: string; properties: unknown }[]

  return {
    noticeRendered,
    events: rows.map((r) => r.event_type),
    props: rows.map((r) =>
      typeof r.properties === "string" ? JSON.parse(r.properties) : (r.properties as Record<string, unknown>),
    ),
  }
}

async function main() {
  await seedFixtures()
  await startServer()

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${CDP_PORT}`,
      // 固定 profile 目录，但每次都以 SIGKILL 结束进程 —— Chrome 来不及把
      // localStorage 刷盘，所以「关闭过提示」这个状态不会残留到下一次运行
      // （否则第二次跑就不再出现提示，看起来像功能坏了）。
      "--user-data-dir=/tmp/chrome-touch-probe",
      "about:blank",
    ],
    { stdio: "ignore" },
  )

  let failed = false
  const check = (label: string, ok: boolean) => {
    if (!ok) failed = true
    console.log(`  ${ok ? "✓" : "✗"} ${label}`)
  }

  try {
    let page: { webSocketDebuggerUrl: string } | undefined
    for (let i = 0; i < 40; i++) {
      try {
        const list = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json())) as {
          type: string
          webSocketDebuggerUrl: string
        }[]
        page = list.find((t) => t.type === "page")
        if (page) break
      } catch {
        /* CDP 还没起来 */
      }
      await sleep(250)
    }
    if (!page) throw new Error("没找到 Chrome 页面 target")

    const cdp = new Cdp(page.webSocketDebuggerUrl)
    await cdp.ready()
    const consoleErrors: string[] = []
    cdp.on((msg) => {
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params as { exceptionDetails?: { exception?: { description?: string } } }
        consoleErrors.push((d.exceptionDetails?.exception?.description ?? "").slice(0, 160))
      }
    })
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    await cdp.send("Network.enable")

    // 在文档脚本运行**之前**覆盖 matchMedia：由 URL 上的 forcetouch 决定报什么。
    // 除这一步之外，页面自己的判定、订阅、上报全部走真实代码路径。
    //
    // 必须是**普通对象桩**，不能用 Proxy 包住真实 MediaQueryList：
    // subscribeDesktopNotice 会对返回值调 `mq.addEventListener("change", ...)`，
    // 经 Proxy 取到的 native 方法在调用时 `this` 指向 Proxy 而不是 MediaQueryList，
    // 浏览器直接抛 "Illegal invocation" —— 订阅抛错 → 组件不渲染 → 提示永远不出现，
    // 而现象是"页面没报错、就是没有提示"，极难判断（这里实际踩过一次）。
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const orig = window.matchMedia.bind(window)
        window.matchMedia = (q) => {
          if (!/pointer:\\s*coarse|hover:\\s*none/.test(q)) return orig(q)
          return {
            matches: location.search.includes('forcetouch=1'),
            media: q,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() { return false },
          }
        }
      })()`,
    })

    // dev 登录旁路（NODE_ENV=development 下直接生效，见 CLAUDE.md）
    await cdp.send("Network.setCookie", {
      url: BASE,
      name: "typenow_session",
      value: `dev:${FIXTURE.userPro}`,
      path: "/",
    })

    console.log("=== 对照组：桌面设备（不该出现提示与事件）===")
    const desktop = await runCase(cdp, { fakeTouch: false })
    check("提示未渲染", !desktop.noticeRendered)
    check("没有任何 touch_notice_* 事件", desktop.events.length === 0)

    console.log("=== 实验组：触屏设备 ===")
    const touch = await runCase(cdp, { fakeTouch: true })
    check("提示已渲染", touch.noticeRendered)
    check("touch_notice_shown 已上报", touch.events.includes("touch_notice_shown"))
    check("touch_notice_dismissed 已上报", touch.events.includes("touch_notice_dismissed"))
    check(
      "每个事件都带 device=touch（漏斗才能按设备拆开）",
      touch.props.length > 0 && touch.props.every((p) => p.device === "touch"),
    )

    if (consoleErrors.length) {
      console.log(`  （页面控制台有 ${consoleErrors.length} 条异常，供参考）`)
      for (const e of consoleErrors.slice(0, 3)) console.log(`    ${e}`)
    }

    cdp.close()
  } finally {
    chrome.kill("SIGKILL")
    await stopServer()
  }

  console.log(failed ? "\n❌ 有断言未通过" : "\n✅ 全部通过")
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error("探针失败:", e)
  process.exit(1)
})
