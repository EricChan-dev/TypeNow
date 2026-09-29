/**
 * Admin 表格布局探针：验证"列多时不挤压 + 横向滚动 + 操作列固定"。
 *
 * 用法（需要 ADMIN_DEV_BYPASS=1 让接口放行）：
 *   E2E_PORT=3311 TYPENOW_DIST_DIR=.next-e2e ADMIN_DEV_BYPASS=1 \
 *     npx tsx scripts/probe-admin-table.mts <路径> <截图输出>
 *
 * 它做两件事：
 *   1. 量：容器是否真的可以横向滚动（scrollWidth > clientWidth）、
 *      操作列是否是右侧 sticky（position/right 的 computed style）；
 *   2. 拍：截一张图给人看 —— 布局问题最终要靠眼睛确认。
 *
 * 判定页面是否正常加载而不是空表：数一下行数。
 */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { seedFixtures } from "../tests/e2e/helpers/db"
import { startServer, stopServer } from "../tests/e2e/helpers/server"

const PORT = Number(process.env.E2E_PORT ?? 3311)
const BASE = `http://localhost:${PORT}`
const CDP_PORT = 9224
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

// 用法：probe-admin-table.mts <路径1,路径2,...> [截图路径]
// 传多个路径时逐页巡检（每页一行结论），传截图路径时只在最后一页截图。
const targetPaths = (process.argv[2] ?? "/admin/sentences").split(",").map((x) => x.trim())
const shotPath = process.argv[3] ?? ""

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  private ws: WebSocket
  private id = 0
  private pending = new Map<number, (v: unknown) => void>()
  private listeners: ((msg: { method?: string; params?: Record<string, unknown> }) => void)[] = []
  constructor(url: string) {
    this.ws = new WebSocket(url)
  }
  async ready(): Promise<void> {
    await new Promise<void>((res, rej) => {
      this.ws.addEventListener("open", () => res())
      this.ws.addEventListener("error", () => rej(new Error("CDP 连接失败")))
    })
    // 响应处理必须在 ready() 里注册，而不是交给可选的 on()。
    // 第一版把它放在 on() 里，而这个探针从不调 on() → 没有任何响应被读取 →
    // 每个 send 都等到超时（表现为"连上了但 Page.enable 一直不回"）。
    this.ws.addEventListener("message", (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && this.pending.has(msg.id)) {
        // CDP 载荷在 msg.result 下（内层才是 Runtime.evaluate 的返回值）
        this.pending.get(msg.id)!(msg.result)
        this.pending.delete(msg.id)
        return
      }
      for (const l of this.listeners) l(msg)
    })
  }
  send<T = { result?: { value?: unknown } }>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30000,
  ): Promise<T> {
    const id = ++this.id
    return new Promise<T>((res, rej) => {
      // 每个 CDP 调用都要有超时：否则某一步不回包会静默挂死整个探针
      // （这个探针第一版就是这样卡了 10 分钟没有任何输出）
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rej(new Error(`CDP 超时: ${method}`))
      }, timeoutMs)
      this.pending.set(id, (v) => {
        clearTimeout(timer)
        res(v as T)
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  /** 追加一个只读事件监听（控制台错误、网络请求等）。 */
  on(listener: (msg: { method?: string; params?: Record<string, unknown> }) => void): void {
    this.listeners.push(listener)
  }
  close() {
    this.ws.close()
  }
}

async function main() {
  const log = (m: string) => console.log(`  · ${m}`)

  // 端口预检：必须在没有遗留服务时才开跑。
  // 踩过的坑：stopServer() 只对 npx 进程发 SIGTERM，next dev 子进程会成为孤儿
  // 继续占着端口；下一次 startServer 绑定失败，但就绪轮询却命中那个**跑着旧代码**
  // 的孤儿 —— 于是"改动前/后"两次跑的是同一份代码，对照组彻底失效（而且不报错）。
  try {
    const res = await fetch(`${BASE}/api/courses/list?pageSize=1`, {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) {
      throw new Error(
        `端口 ${PORT} 上已有服务在跑（很可能是上次探针的孤儿进程）。` +
          `请先结束它，或换一个 E2E_PORT —— 否则本次测的是那份旧代码。`,
      )
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("孤儿")) throw err
    // 连不上 = 端口空闲，正是我们要的
  }
  log(`端口 ${PORT} 空闲，开始`)
  log("seedFixtures…")
  await seedFixtures()
  log("启动 dev server…")
  await startServer()
  log(`server ready: ${BASE}`)

  log("启动 Chrome…")
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${CDP_PORT}`,
      // 固定 profile 但每次 SIGKILL，确保 localStorage 之类状态不残留
      "--user-data-dir=/tmp/chrome-admin-probe",
      "--window-size=1180,820",
      "about:blank",
    ],
    { stdio: "ignore" },
  )

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
        /* 还没起来 */
      }
      await sleep(250)
    }
    if (!page) throw new Error("没找到 Chrome 页面 target")

    log(`CDP target 就绪`)
    const cdp = new Cdp(page.webSocketDebuggerUrl)
    await cdp.ready()
    log("CDP 已连接")
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    // 必须禁用 HTTP 缓存：Chrome 的 profile 是持久化的，上一次探针的 JS chunk
    // 会留在磁盘缓存里 —— 于是"改了源码、起了新服务"之后，浏览器执行的可能仍是
    // 上一版代码（对照组失效且不报错，实际踩到过）。
    await cdp.send("Network.enable")
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
    // 视口按"窄屏笔记本"设：列多时一定会溢出，才能看出固定列是否生效
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1180,
      height: 820,
      deviceScaleFactor: 2,
      mobile: false,
    })

    const checkPage = async (targetPath: string) => {
      await cdp.send("Page.navigate", { url: `${BASE}${targetPath}` })
      await sleep(11000)
      const probe = await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const wrap = document.querySelector('.ant-table-content') || document.querySelector('.ant-table-body')
          const table = document.querySelector('.ant-table table')
          const fixedCells = [...document.querySelectorAll('.ant-table-cell-fix-right')]
          const headFixed = [...document.querySelectorAll('.ant-table-thead th.ant-table-cell-fix-right')]
          const fixedStyle = headFixed.length ? getComputedStyle(headFixed[0]) : null
          const rows = document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length
          const headTexts = [...document.querySelectorAll('.ant-table-thead th')].map((th) => th.innerText.trim())
          return JSON.stringify({
            rows, columnCount: headTexts.length, headTexts,
            clientWidth: wrap ? wrap.clientWidth : 0,
            scrollWidth: wrap ? wrap.scrollWidth : 0,
            overflows: wrap ? wrap.scrollWidth > wrap.clientWidth + 2 : false,
            tableWidth: table ? Math.round(table.getBoundingClientRect().width) : 0,
            fixedCellCount: fixedCells.length,
            fixedPosition: fixedStyle ? fixedStyle.position : null,
            fixedRight: fixedStyle ? fixedStyle.right : null,
          })
        })()`,
      })
      return JSON.parse(String(probe.result.value ?? "{}"))
    }

    console.log("")
    console.log("  页面                          行数 列数  溢出  操作列sticky  表格宽/容器宽")
    console.log("  " + "-".repeat(74))
    for (const targetPath of targetPaths) {
      const r = await checkPage(targetPath)
      const sticky = r.fixedPosition === "sticky" && r.fixedRight === "0px"
      const label = targetPath.replace("/admin/", "").padEnd(28)
      console.log(
        `  ${label} ${String(r.rows).padStart(4)} ${String(r.columnCount).padStart(4)}  ` +
          `${(r.overflows ? "✓" : "—").padStart(4)}  ${(sticky ? "✓" : "✗").padStart(10)}  ` +
          `${String(r.tableWidth).padStart(6)}/${String(r.clientWidth).padEnd(6)}`,
      )
      if (!sticky) console.log(`        ↑ 列: ${(r.headTexts || []).join(" | ")}`)
    }
    if (shotPath) {
      log("截图…")
      const shot = await cdp.send<{ data?: string }>("Page.captureScreenshot", { format: "png" }, 60000)
      if (shot.data) {
        mkdirSync("/tmp", { recursive: true })
        writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
        console.log(`  截图已保存: ${shotPath}`)
      }
    }
    cdp.close()
  } finally {
    chrome.kill("SIGKILL")
    await stopServer()
  }
  process.exit(0)
}

main().catch((e) => {
  console.error("探针失败:", e)
  process.exit(1)
})
